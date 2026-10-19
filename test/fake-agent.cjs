// 测试用的假 Codex / Claude CLI：参数以 exec 开头按 Codex 格式输出，否则按 Claude Code 格式。
// 提示词里含 SLOW 时每步停 1.5 秒；含 EXPENSIVE 时报很大的用量。
const fs = require('node:fs');
if (process.argv[2] === '--version') { console.log('fake-agent 1.0.0'); process.exit(0); }
const engine = process.argv[2] === 'exec' ? 'codex' : 'claude';
fs.appendFileSync('args.log', JSON.stringify(process.argv.slice(2)) + '\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (engine === 'codex') {
  let text = '';
  process.stdin.on('data', (c) => { text += c; });
  process.stdin.on('end', async () => {
    const slow = /SLOW/.test(text), big = /EXPENSIVE/.test(text), live = /LIVECAP/.test(text);
    const resumed = process.argv.includes('resume');
    const id = resumed ? process.argv[process.argv.indexOf('-') - 1] : (/THREAD-(\w+)/.exec(text)?.[1] ? 'th-' + /THREAD-(\w+)/.exec(text)[1] : 'th-123');
    // 设了 CODEX_HOME 时像真 Codex 一样写 rollout：累计用量随工作增长，turn.completed 报的也是累计值
    const home = process.env.CODEX_HOME, path = require('node:path');
    let roll = '', prev = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
    if (home) {
      const d = new Date(), pad = (n) => String(n).padStart(2, '0');
      const dir = path.join(home, 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
      fs.mkdirSync(dir, { recursive: true });
      roll = path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith(id + '.jsonl')) || `rollout-${Date.now()}-${id}.jsonl`);
      if (fs.existsSync(roll)) for (const l of fs.readFileSync(roll, 'utf8').split('\n')) { try { const j = JSON.parse(l); if (j.payload?.type === 'token_count') prev = j.payload.info.total_token_usage; } catch { /* */ } }
      fs.appendFileSync(roll, JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.1-codex' } }) + '\n');
    }
    const add = (u) => { prev = { input_tokens: prev.input_tokens + u[0], cached_input_tokens: prev.cached_input_tokens + u[1], output_tokens: prev.output_tokens + u[2] }; if (roll) fs.appendFileSync(roll, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: prev } } }) + '\n'); };
    out({ type: 'thread.started', thread_id: id });
    out({ type: 'turn.started' });
    if (slow) await wait(1500);
    out({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'dir', status: 'in_progress' } });
    fs.writeFileSync('课件.html', '<h1>' + text.trim().slice(0, 40) + '</h1>');
    out({ type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: process.cwd() + '\\课件.html', kind: 'add' }] } });
    if (live) { add([3e6, 0, 1e6]); await wait(8000); }
    if (slow) await wait(1500);
    out({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: '完成：' + text.trim().slice(0, 40) } });
    const turn = big ? [5e6, 0, 2e6] : [12000, 2000, 800];
    add(turn);
    out({ type: 'turn.completed', usage: roll ? prev : { input_tokens: turn[0], cached_input_tokens: turn[1], output_tokens: turn[2] } });
  });
} else {
  let buf = '', inited = false, queue = Promise.resolve(), cost = 0;
  process.stdin.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line), text = msg.message.content[0].text;
      queue = queue.then(async () => {
        if (!inited) { inited = true; out({ type: 'system', subtype: 'init', session_id: 'cl-456', model: 'claude-sonnet-4-5' }); }
        out({ type: 'assistant', message: { content: [{ type: 'text', text: '收到：' + text.slice(0, 40) }, { type: 'tool_use', name: 'Write', input: { file_path: process.cwd() + '\\题目.md' } }] } });
        if (/SLOW/.test(text)) await wait(1500);
        fs.appendFileSync('题目.md', text + '\n');
        cost += /EXPENSIVE/.test(text) ? 3 : 0.05;
        out({ type: 'result', subtype: 'success', is_error: false, session_id: 'cl-456', total_cost_usd: cost, usage: { input_tokens: 900, cache_read_input_tokens: 3000, cache_creation_input_tokens: 100, output_tokens: 400 }, result: 'ok' });
      });
    }
  });
  process.stdin.on('end', () => { queue.then(() => process.exit(0)); });
}
