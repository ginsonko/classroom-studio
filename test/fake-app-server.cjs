'use strict';
// 假的 `codex app-server`：按老师说的话走固定剧本，用来测 AI 助教的整条链路（不联网、不花钱）。
//   含「加学生」→ 调 add_student；「删课 <id>」→ 调 delete_lesson；「运行命令」→ 请求命令审批；
//   「慢慢说」→ 一直输出直到 turn/interrupt；其它 → 流式回一句话。
// 收到的每个请求记到 FAKE_LOG（一行一条 JSON），测试据此断言工具清单、上下文等。
const fs = require('node:fs');
if (!process.argv.includes('app-server')) { process.stdout.write('codex-cli 0.0.0-fake\n'); process.exit(0); }
const LOG = process.env.FAKE_LOG || '';
const log = (m) => { if (LOG) fs.appendFileSync(LOG, JSON.stringify(m) + '\n'); };
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const note = (method, params) => send({ jsonrpc: '2.0', method, params });
let seq = 0; const id = (p) => p + '-' + (++seq);
const waiting = new Map();
const ask = (method, params) => new Promise((ok) => { const rid = id('srv'); waiting.set(rid, ok); send({ jsonrpc: '2.0', id: rid, method, params }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Map();

async function say(threadId, turnId, text) {
  const itemId = id('msg');
  note('item/started', { threadId, turnId, item: { id: itemId, type: 'agentMessage', text: '' } });
  for (const ch of text.match(/.{1,4}/gsu) || []) { note('item/agentMessage/delta', { threadId, turnId, itemId, delta: ch }); await sleep(15); }
  note('item/completed', { threadId, turnId, item: { id: itemId, type: 'agentMessage', text } });
}
async function tool(threadId, turnId, name, args) {
  const callId = id('call');
  note('item/started', { threadId, turnId, item: { id: callId, type: 'dynamicToolCall', tool: name, arguments: args } });
  const r = await ask('item/tool/call', { threadId, turnId, callId, tool: name, arguments: args });
  note('item/completed', { threadId, turnId, item: { id: callId, type: 'dynamicToolCall', tool: name, arguments: args, success: r.success } });
  return r;
}
const done = (threadId, turnId, status = 'completed') => { running.delete(threadId); note('turn/completed', { threadId, turn: { id: turnId, status } }); };

async function play(threadId, turnId, text) {
  note('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
  note('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total: { inputTokens: 1200, cachedInputTokens: 200, outputTokens: 80 } } });
  if (text.includes('加学生')) {
    const r = await tool(threadId, turnId, 'add_student', { name: '测试小王', grade: '初二', subject: 'physics' });
    await say(threadId, turnId, '好啦，加好了。' + (r.contentItems?.[0]?.text || '').slice(0, 60));
    return done(threadId, turnId);
  }
  const del = text.match(/删课 (\S+)/);
  if (del) {
    const r = await tool(threadId, turnId, 'delete_lesson', { id: del[1] });
    await say(threadId, turnId, (r.success ? '删掉了：' : '没删：') + (r.contentItems?.[0]?.text || ''));
    return done(threadId, turnId);
  }
  if (text.includes('运行命令')) {
    const r = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: id('cmd'), command: 'dir C:\\Users', reason: '看看文件夹里有什么', cwd: 'C:\\' });
    await say(threadId, turnId, 'decision=' + r.decision);
    return done(threadId, turnId);
  }
  if (text.includes('慢慢说')) {
    const itemId = id('msg');
    note('item/started', { threadId, turnId, item: { id: itemId, type: 'agentMessage', text: '' } });
    while (running.get(threadId) === turnId) { note('item/agentMessage/delta', { threadId, turnId, itemId, delta: '嗯' }); await sleep(100); }
    return;
  }
  await say(threadId, turnId, '老师好！我是小羽，有什么要我帮忙的？');
  done(threadId, turnId);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.id !== undefined && !m.method) { const w = waiting.get(m.id); waiting.delete(m.id); log({ reply: m.result }); w?.(m.result || {}); continue; }
    log({ method: m.method, params: m.params });
    const ok = (result) => send({ jsonrpc: '2.0', id: m.id, result });
    const p = m.params || {};
    switch (m.method) {
      case 'initialize': ok({ userAgent: 'fake' }); break;
      case 'thread/start': ok({ thread: { id: id('thr') }, model: 'fake-model' }); break;
      case 'thread/resume': ok({ thread: { id: p.threadId } }); break;
      case 'turn/start': { const t = id('turn'); running.set(p.threadId, t); ok({ turn: { id: t, status: 'inProgress' } }); void play(p.threadId, t, String(p.input?.[0]?.text || '')); break; }
      case 'turn/steer': ok({}); break;
      case 'turn/interrupt': { ok({}); if (running.get(p.threadId) === p.turnId) done(p.threadId, p.turnId, 'interrupted'); break; }
      default: if (m.id !== undefined) ok({});
    }
  }
});
process.stdin.on('end', () => process.exit(0));
