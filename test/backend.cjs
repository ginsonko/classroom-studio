// 后端单元测试（纯 Node，不启动 Electron）：AI 账本、课前提醒、后台任务中心（用假 CLI）。
// 运行：node test/backend.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Ledger } = require('../electron/ledger.cjs');
const { due } = require('../electron/remind.cjs');
const { Agents, readCodex, readClaude } = require('../electron/agents.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-backend-'));
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.stack]); } };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('等待超时'); };

(async () => {
  await test('账本：按价格表折算并累计', () => {
    const l = new Ledger(path.join(tmp, 'l1'));
    const e = l.record({ feature: '讲解', model: 'gpt-x', usage: { input: 1e6, cached: 0, output: 0 } });
    assert.equal(e.cny, 9, '没列出的模型按兜底价（官方 GPT-5 价）');
    assert.equal(l.cost('gpt-5.1-codex', { input: 1e6, cached: 1e6, output: 1e6 }), 9 + 0.9 + 72);
    assert.equal(l.cost('gpt-5-mini', { input: 1e6 }), 1.8, '更长的模型名优先');
    l.record({ feature: '讲解', model: 'gpt-x', usage: { input: 1e6 } }); l.record({ feature: '讲解', model: 'gpt-x', usage: { input: 1e6 } });
    assert.equal(Math.round(l.spent().day), 27);
    assert.throws(() => l.check(), /今天的 AI 花费已到上限/);
    const again = new Ledger(path.join(tmp, 'l1'));
    assert.equal(Math.round(again.spent().month), 27, '重启后账还在');
    again.setBudget({ caps: { day: 50 }, prices: { 'gpt-x': { input: 1, cached: 0, output: 2 } } });
    assert.doesNotThrow(() => again.check());
    assert.equal(again.cost('GPT-X-mini', { input: 1e6, output: 1e6 }), 3, '最长前缀匹配价格');
  });

  await test('课前提醒：提前量内只提醒一次', () => {
    const now = new Date(2026, 9, 19, 18, 52); // 周一
    const slots = [{ id: 'a', studentId: 's', day: 0, start: 19, len: 1, topic: '', repeat: true }, { id: 'b', studentId: 's', day: 0, start: 20, len: 1, topic: '' }];
    const sent = new Set();
    const first = due(slots, now, 10, sent);
    assert.deepEqual(first.map((x) => x.slot.id), ['a']);
    assert.equal(first[0].minutes, 8);
    sent.add(first[0].key);
    assert.equal(due(slots, now, 10, sent).length, 0);
    assert.equal(due(slots, now, 0, new Set()).length, 0, '提前量 0 表示关闭');
    assert.equal(due([{ id: 'c', studentId: 's', day: 1, start: 19, len: 1, date: '2026-10-20' }], now, 10, new Set()).length, 0);
  });

  await test('事件解析：Codex 与 Claude', () => {
    assert.equal(readCodex({ type: 'thread.started', thread_id: 'x' }).session, 'x');
    assert.equal(readCodex({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }).events[0].kind, 'text');
    assert.ok(readCodex({ type: 'turn.completed', usage: { input_tokens: 1 } }).usage);
    // 老师本机 config.toml 的配置提醒只算提示，真正的错误仍是错误
    assert.equal(readCodex({ type: 'item.completed', item: { type: 'error', message: 'Codex is ignoring 1 unrecognized configuration setting.' } }).events[0].kind, 'note');
    assert.equal(readCodex({ type: 'item.completed', item: { type: 'error', message: 'stream disconnected' } }).events[0].kind, 'error');
    const r = readClaude({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, usage: {}, total_cost_usd: 1 });
    assert.ok(r.failed && /花费上限/.test(r.events[0].text));
  });

  process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
  process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');
  process.env.CODEX_HOME = path.join(tmp, 'codex-home');
  const ledger = new Ledger(path.join(tmp, 'l2'));
  const events = [];
  const exported = [];
  const exporter = async (file, formats) => { exported.push([path.basename(file), formats]); const outs = formats.map((f) => file.replace(/\.md$/, '.' + f)); for (const o of outs) fs.writeFileSync(o, 'x'); return { out: outs, errors: [] }; };
  const agents = new Agents({ dir: path.join(tmp, 'agents'), ledger, credentials: () => ({ baseUrl: 'https://x/v1', key: 'k' }), emit: (e) => events.push(e), exporter });

  await test('任务中心：检测到 CLI', async () => {
    const d = await agents.detect();
    assert.ok(d.codex.found && d.claude.found, JSON.stringify(d));
  });

  await test('Codex 任务：运行、出文件、记账、继续对话', async () => {
    const t = agents.start({ engine: 'codex', prompt: '做一页斜面课件' });
    await until(() => agents.get(t.id).status === 'done');
    const g = agents.get(t.id);
    assert.ok(g.cny > 0 && g.tokens > 0, '已记账');
    assert.ok(fs.existsSync(path.join(g.work, '课件.html')));
    assert.ok(g.events.some((e) => e.kind === 'file') && g.events.some((e) => e.kind === 'text'));
    assert.equal(agents.files(t.id)[0].name, '课件.html');
    agents.inject(t.id, '再加一道题');
    await until(() => agents.get(t.id).status === 'done' && agents.get(t.id).turns === 2);
    const args = fs.readFileSync(path.join(g.work, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(args[1].slice(0, 2), ['exec', 'resume']);
    assert.ok(args[1].includes('th-123'), '续上同一个会话');
    assert.ok(!args.flat().some((a) => /dangerously|bypass/.test(a)), '没有绕过沙箱的参数');
    const mine = ledger.entries.filter((e) => e.taskId === t.id && e.source === 'task');
    assert.equal(mine.length, 2);
    for (const e of mine) {
      assert.equal(e.model, 'gpt-5.1-codex', '从 rollout 读到实际模型');
      assert.deepEqual([e.input, e.cached, e.output], [10000, 2000, 800], '续接时只记这一轮的增量，不重复记累计值');
    }
    assert.ok(Math.abs(agents.get(t.id).cny - 2 * 0.1494) < 1e-3, String(agents.get(t.id).cny));
    // 按中转站实际扣费校准：任务金额改成实际值，倍率按官方价反推
    const r = agents.calibrate(t.id, 0.05);
    assert.ok(Math.abs(r.factor - 0.05 / 0.2988) < 1e-3, String(r.factor));
    assert.ok(Math.abs(agents.get(t.id).cny - 0.05) < 1e-6);
    assert.ok(Math.abs(ledger.taskTotal(t.id) - 0.05) < 1e-6);
    const again2 = agents.calibrate(t.id, 0.05);
    assert.ok(Math.abs(again2.factor - r.factor) < 1e-9, '重复校准结果一样');
    assert.ok(Math.abs(ledger.cost('gpt-5', { input: 1e6 }) - 9 * r.factor) < 1e-9, '之后的估算乘倍率');
    ledger.setBudget({ factor: 1 });
  });

  await test('Claude 任务：运行中追加指令走输入流，美元折人民币', async () => {
    const t = agents.start({ engine: 'claude', prompt: 'SLOW 出三道题' });
    await until(() => agents.get(t.id).events.some((e) => e.kind === 'text'));
    agents.inject(t.id, '第三题改成多选');
    await until(() => agents.get(t.id).status === 'done');
    const g = agents.get(t.id);
    assert.equal(g.turns, 1, '同一个进程里处理');
    assert.equal(fs.readFileSync(path.join(g.work, '题目.md'), 'utf8').trim().split('\n').length, 2);
    assert.ok(Math.abs(g.cny - 0.1 * 7.2) < 0.01, '按累计美元差额记账：' + g.cny);
    const args = JSON.parse(fs.readFileSync(path.join(g.work, 'args.log'), 'utf8').split('\n')[0]);
    assert.ok(args.includes('--max-budget-usd') && args.includes('acceptEdits'));
    // 写出的 Markdown 自动排版成 Word + PDF（任务背景.md 不算成果）
    await until(() => exported.some(([n]) => n === '题目.md') && !agents.get(t.id).exporting);
    assert.deepEqual(exported.find(([n]) => n === '题目.md')[1], ['docx', 'pdf']);
    assert.ok(fs.existsSync(path.join(g.work, '题目.docx')) && fs.existsSync(path.join(g.work, '题目.pdf')));
    assert.ok(agents.get(t.id).events.some((e) => e.kind === 'out' && /题目\.docx/.test(e.text)));
    await assert.rejects(agents.exportFile(t.id, path.join(g.work, '..', 'task.json'), ['pdf']), /只能转换/);
    await assert.rejects(agents.exportFile(t.id, path.join(g.work, '题目.md'), ['exe']), /格式/);
    const r = await agents.exportFile(t.id, path.join(g.work, '题目.md'), ['pptx']);
    assert.equal(path.basename(r.out[0]), '题目.pptx');
  });

  await test('HTML 课件任务不自动导出', async () => {
    const before = exported.length;
    const t = agents.start({ engine: 'claude', prompt: '做互动课件', formats: [] });
    await until(() => agents.get(t.id).status === 'done');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(exported.length, before);
  });

  await test('单任务上限：一轮已做完才超额 → 成果保留、标注超额、不再继续', async () => {
    const t = agents.start({ engine: 'codex', prompt: 'EXPENSIVE THREAD-big', cap: 5 });
    await until(() => !agents.tasks.get(t.id).child && agents.get(t.id).status !== 'running');
    const g = agents.get(t.id);
    assert.equal(g.status, 'done'); assert.match(g.note, /超过上限/);
    assert.throws(() => agents.inject(t.id, '继续'), /花费上限/);
  });

  await test('手动停止：杀掉进程树', async () => {
    ledger.setBudget({ caps: { day: 100000, month: 100000 } });
    const t = agents.start({ engine: 'codex', prompt: 'SLOW 很慢的任务' });
    await until(() => agents.get(t.id).events.some((e) => e.kind === 'cmd'));
    agents.stop(t.id);
    await until(() => !agents.tasks.get(t.id).child);
    assert.equal(agents.get(t.id).status, 'stopped');
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(agents.get(t.id).status, 'stopped', '停止后不会被改回完成');
  });

  await test('Codex 实时用量：一轮还没结束就按上限停下', async () => {
    const t = agents.start({ engine: 'codex', prompt: 'LIVECAP THREAD-live', cap: 5 });
    const t0 = Date.now();
    await until(() => agents.get(t.id).status === 'budget', 7000);
    assert.ok(Date.now() - t0 < 7000, '没等到这一轮结束');
    assert.ok(agents.get(t.id).cny >= 5, String(agents.get(t.id).cny));
  });

  await test('每日上限：开始前拒绝', () => {
    ledger.setBudget({ caps: { day: 0.001 } });
    assert.throws(() => agents.start({ engine: 'codex', prompt: 'x' }), /上限/);
  });

  await test('重启后任务列表还在，运行中的标记为中断', () => {
    const again = new Agents({ dir: path.join(tmp, 'agents'), ledger });
    assert.ok(again.list().length >= 4);
    assert.ok(again.list().every((t) => t.status !== 'running'));
  });

  agents.stopAll();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 进程可能还占着文件 */ }
  for (const r of results) console.log(r[0], r[1], r[2] ? '\n' + r[2] : '');
  const failed = results.filter((r) => r[0] !== 'ok').length;
  console.log(`${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})();
