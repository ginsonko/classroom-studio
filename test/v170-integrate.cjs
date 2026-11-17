'use strict';
// 1.7.0 合并后必修项单元测试（纯 Node + 本地模拟服务器，不联网、不花钱、不动真实键鼠）：
// 1. 独立 CODEX_HOME + Windows [windows] sandbox 配置 + 后台预热进度 + 只读沙箱降级保护
// 2. 400「没有可用分组」共用函数去 X-Route-Scope 重发一次（课堂 AI / 工坊 Codex / 工坊 Claude / 小羽）；其它 400 不重发；「无法识别的分组范围」记缺陷日志；第三方站点不带头
// 3. 工坊单轮上限 60 分钟（TURN_LIMIT_MS = 3600000）及超时停止
// 4. 75% 收尾预留、收尾轮禁联网、收尾小幅缓冲不误杀
// 5. 工作手册与题库类技能强调「找到一道就先写成品 / 第一轮落盘」
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const { CodexHome, ensureCodexConfig } = require('../electron/codexHome.cjs');
const tier = require('../electron/tier.cjs');
const { Agents, TURN_LIMIT_MS, WRAP_RATIO, wrapGrace } = require('../electron/agents.cjs');
const { Assistant } = require('../electron/assistant.cjs');
const kit = require('../electron/agentKit.cjs');

const mkTmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `cs-170-int-${tag}-`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000, what = 'condition') => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(40);
  }
  throw new Error('Timed out: ' + what);
};

test('必修1：工坊与小羽共用独立 CODEX_HOME，自动写好 Windows 沙箱配置，不读老师全局 ~/.codex', async () => {
  const root = mkTmp('home');
  const fakeUserHome = path.join(root, 'user-home');
  fs.mkdirSync(path.join(fakeUserHome, '.codex'), { recursive: true });
  // 模拟全局配置里的外部技能与 MCP，确认不会混进软件自己的 CODEX_HOME
  fs.writeFileSync(path.join(fakeUserHome, '.codex', 'config.toml'), '[mcp_servers.ap_vibe]\ncommand = "node"\n');
  fs.writeFileSync(path.join(fakeUserHome, '.codex', 'AGENTS.md'), '无需新建 AP-Vibe 项目\n');

  const dataHome = path.join(root, 'data', 'codex-home');
  ensureCodexConfig(dataHome, { platform: 'win32', winSandbox: 'elevated' });
  const cfgText = fs.readFileSync(path.join(dataHome, 'config.toml'), 'utf8');
  assert.match(cfgText, /\[windows\]/);
  assert.match(cfgText, /sandbox\s*=\s*"elevated"/);
  assert.doesNotMatch(cfgText, /ap_vibe/);
  assert.equal(fs.existsSync(path.join(dataHome, 'AGENTS.md')), false);

  const ch = new CodexHome({ dir: dataHome, platform: 'win32', locate: () => null });
  const ag = new Agents({ dir: path.join(root, 'data', 'agents'), codexHome: ch, credentials: () => ({ baseUrl: 'https://api.yinziapi.top/v1', key: 'sk-test-only', model: 'gpt-6-astra' }) });
  const env = ag.env({ id: 't1', engine: 'codex', useStudioKey: true, permission: 'full', tier: 'quality', work: root });
  assert.equal(path.resolve(env.CODEX_HOME), path.resolve(dataHome));
  assert.notEqual(path.resolve(env.CODEX_HOME), path.resolve(path.join(fakeUserHome, '.codex')));

  const argvLog = path.join(root, 'as-argv.jsonl');
  const prevCli = process.env.CS_AGENT_CODEX, prevArgv = process.env.FAKE_ARGV;
  process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-app-server-argv.cjs');
  process.env.FAKE_ARGV = argvLog;
  const as = new Assistant({ dir: path.join(root, 'data', 'assistant'), codexHome: ch, credentials: () => ({ baseUrl: 'https://api.yinziapi.top/v1', key: 'sk-test-only', model: 'gpt-6-astra' }) });
  try {
    const chat = as.create({ title: '隔离检查' });
    await as.send({ id: chat.id, text: '你好', studio: true });
    await until(() => !as.get(chat.id).running);
    const rec = JSON.parse(fs.readFileSync(argvLog, 'utf8').trim().split('\n')[0]);
    assert.equal(path.resolve(rec.home), path.resolve(dataHome));
    assert.ok(!rec.argv.some((a) => a.includes('ap_vibe')), '不混入全局 ~/.codex 的 MCP');
  } finally {
    as.stopAll();
    if (prevCli === undefined) delete process.env.CS_AGENT_CODEX; else process.env.CS_AGENT_CODEX = prevCli;
    if (prevArgv === undefined) delete process.env.FAKE_ARGV; else process.env.FAKE_ARGV = prevArgv;
  }
});

test('必修1：Windows 沙箱后台预热推送进度、写就绪标记；任务遇预热中会显示进度等待，遇只读沙箱立即停下不白花钱', async () => {
  const root = mkTmp('prewarm');
  const states = [];
  const ch = new CodexHome({
    dir: path.join(root, 'codex-home'),
    platform: 'win32',
    tickMs: 40,
    allowOverride: true,
    locate: () => ({ cmd: 'fake-codex', pre: [], env: {}, where: 'bundled', version: '0.163.0' }),
    emit: (s) => states.push({ ...s }),
    spawn: (_cmd, args, opts) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 43210;
      child.exitCode = null;
      assert.equal(args[0], 'sandbox');
      assert.equal(path.resolve(opts.env.CODEX_HOME), path.resolve(path.join(root, 'codex-home')));
      setTimeout(() => {
        fs.writeFileSync(path.join(opts.cwd, 'probe.txt'), 'ok');
        child.exitCode = 0;
        child.emit('close', 0);
      }, 130);
      return child;
    },
  });

  // 预热进行中发起工坊任务：任务先出状态提示等预热，完成后自动执行
  const prevCli = process.env.CS_AGENT_CODEX;
  process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
  const ag = new Agents({ dir: path.join(root, 'agents'), codexHome: ch, autoPrewarm: true });
  try {
    const warmJob = ch.prewarm({ reason: 'startup' });
    assert.equal(ch.view().phase, 'running');
    const task = ag.start({ engine: 'codex', title: '预热等待测试', prompt: '做一份课件', permission: 'full', formats: [], cap: 2 });
    const eventsBefore = ag.get(task.id).events;
    assert.ok(eventsBefore.some((e) => e.kind === 'status' && /准备.*安全运行环境/.test(e.text)), '任务显示预热进度提示，不无提示卡住');
    const res = await warmJob;
    assert.equal(res.ok, true);
    assert.equal(ch.isReady(), true);
    assert.ok(states.some((s) => s.phase === 'running' && s.pct > 6), '预热期间持续推送进度');
    assert.equal(states.at(-1).phase, 'ready');
    await until(() => ag.get(task.id).status === 'done', 10000, '预热完成后任务自动跑完');
    assert.ok(fs.existsSync(path.join(ag.get(task.id).work, '课件.html')));

    // 只读沙箱降级兜底：rollout 报 read-only 时立即 halt，不继续烧钱
    const roll = path.join(root, 'ro-rollout.jsonl');
    fs.writeFileSync(roll, JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra', sandbox_policy: { type: 'read-only' } } }) + '\n');
    const roTask = { id: 'ro-1', engine: 'codex', title: 'ro', status: 'running', permission: 'full', cap: 2, cny: 0, tokens: 0, turns: 1, session: 'sess-ro', work: root, events: [], queue: [], rollout: roll };
    fs.mkdirSync(path.join(ag.dir, roTask.id), { recursive: true });
    ag.tasks.set(roTask.id, roTask);
    ag.peekCodex(roTask, true);
    assert.equal(roTask.status, 'failed');
    assert.match(roTask.note, /只读/);
    assert.ok(roTask.events.some((e) => e.kind === 'error' && /完全访问/.test(e.text)));
  } finally {
    if (prevCli === undefined) delete process.env.CS_AGENT_CODEX; else process.env.CS_AGENT_CODEX = prevCli;
  }
});

test('必修2：400「没有可用分组」共用函数去档位头重发一次（课堂 AI / 工坊 / 小羽）；其它 400 不重发；「无法识别的分组范围」记缺陷日志；第三方不带头', async () => {
  const root = mkTmp('tier400');
  const logDir = path.join(root, 'logs');
  const errLogs = [];
  tier.setTestHosts(['127.0.0.1']);
  tier.clearDefects();
  tier.setDefectLogger({ dir: logDir, log: { error: (...a) => errLogs.push(a.join(' ')) } });
  await tier.ensureSiteRelay();

  let mode = 'no_group_400';
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const scope = req.headers['x-route-scope'] || '';
      const client = req.headers['x-omni-client'] || '';
      seen.push({ path: req.url, scope, client });
      if (mode === 'no_group_400' && scope) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '这个范围里没有可用分组' } }));
        return;
      }
      if (mode === 'other_400') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid parameter: temperature' } }));
        return;
      }
      if (mode === 'invalid_scope' && scope) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '无法识别的分组范围: bad-tier- token sk-secret123456789' } }));
        return;
      }
      if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: 'gpt-6-astra', choices: [{ message: { role: 'assistant', content: '课堂恢复成功' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }));
        return;
      }
      // OpenAI /responses SSE（供工坊/小羽转发验证）
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'r1', object: 'response', status: 'in_progress', output: [] } })}\n\n`);
      res.write(`event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '去档位恢复成功', annotations: [] }] } })}\n\n`);
      res.write(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'r1', object: 'response', status: 'completed', output: [], usage: { input_tokens: 4, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 6 } } })}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const siteBase = `http://127.0.0.1:${port}/v1`;
  const thirdBase = `http://localhost:${port}/v1`;

  try {
    // 1) 共用函数经 relay 转发（工坊 / 小羽使用的通道）：400 没有可用分组 → 去档位头重发 1 次并成功
    const notes = [];
    const relayed = tier.relayBaseUrl(siteBase, { who: 'workshop-codex', key: 't-relay', onFallback: (f) => notes.push(f.scope) });
    assert.match(relayed, /^http:\/\/127\.0\.0\.1:\d+\/__cs_site\//);
    const r1 = await fetch(relayed + '/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tier.siteHeaders(siteBase, 'quality', { text: true }) },
      body: JSON.stringify({ model: 'gpt-6-astra', input: 'hi' }),
    });
    assert.equal(r1.status, 200);
    assert.match(await r1.text(), /去档位恢复成功/);
    assert.equal(seen.length, 2, '带档位 400 一次 + 去档位重发一次');
    assert.equal(seen[0].scope, 'tier=A');
    assert.equal(seen[0].client, tier.CLIENT);
    assert.equal(seen[1].scope, '', '重发去掉了 X-Route-Scope');
    assert.equal(seen[1].client, tier.CLIENT, '重发保留 X-Omni-Client');
    assert.deepEqual(notes, ['tier=A']);

    // 2) 别的 400 一律不重发
    seen.length = 0;
    mode = 'other_400';
    const r2 = await fetch(relayed + '/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tier.siteHeaders(siteBase, 'quality', { text: true }) },
      body: '{}',
    });
    assert.equal(r2.status, 400);
    assert.equal(seen.length, 1, '其它 400 绝不重发');
    assert.equal(tier.recentDefects().length, 0);

    // 3) 400「无法识别的分组范围」：不重发 + 记进缺陷日志（且脱敏 Key）
    seen.length = 0;
    mode = 'invalid_scope';
    const r3 = await fetch(relayed + '/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tier.siteHeaders(siteBase, 'balanced', { text: true }) },
      body: '{}',
    });
    assert.equal(r3.status, 400);
    assert.equal(seen.length, 1, '无法识别的分组范围绝不重发');
    assert.equal(tier.recentDefects().length, 1);
    const defectFile = fs.readFileSync(path.join(logDir, 'defects.jsonl'), 'utf8').trim();
    const defect = JSON.parse(defectFile);
    assert.equal(defect.kind, 'invalid_route_scope');
    assert.equal(defect.scope, 'B');
    assert.doesNotMatch(defect.message, /sk-secret123456789/, '缺陷日志自动脱敏 Key');
    assert.ok(errLogs.some((l) => l.includes('无法识别的分组范围')));

    // 4) 第三方站点：relayBaseUrl 原样返回、siteHeaders 为空
    assert.equal(tier.relayBaseUrl(thirdBase, { who: 'workshop-codex' }), thirdBase);
    assert.deepEqual(tier.siteHeaders(thirdBase, 'quality', { text: true }), {});

    // 5) 真实内置 codex.exe（工坊 + 小羽）在收到 400「没有可用分组」时无感去档位头恢复完成
    const codexSpec = require('../electron/agents.cjs').locate('codex', '');
    if (codexSpec && codexSpec.where !== 'override') {
      mode = 'no_group_400';
      seen.length = 0;
      const ch = new CodexHome({ dir: path.join(root, 'real-cli-home'), platform: 'win32', locate: () => codexSpec });
      const cred = () => ({ baseUrl: siteBase, key: 'sk-test-local', model: 'gpt-6-astra' });
      const ag = new Agents({ dir: path.join(root, 'ag-400'), codexHome: ch, credentials: cred, tierOf: () => 'quality' });
      const task = ag.start({ engine: 'codex', title: '工坊400恢复', prompt: '只回复在线', useStudioKey: true, permission: 'danger', formats: [], cap: 1 });
      await until(() => ag.get(task.id).status !== 'running', 90000, '工坊真实 codex.exe 400 去档位恢复');
      assert.equal(ag.get(task.id).status, 'done');
      assert.ok(ag.get(task.id).events.some((e) => e.kind === 'note' && /去掉档位头/.test(e.text)));
      assert.ok(seen.some((x) => x.scope === 'tier=A') && seen.some((x) => x.scope === ''));

      seen.length = 0;
      const as = new Assistant({ dir: path.join(root, 'as-400'), codexHome: ch, credentials: cred, tierOf: () => 'balanced' });
      try {
        const chat = as.create({ title: '小羽400恢复' });
        await as.send({ id: chat.id, text: '只回复在线', studio: true });
        await until(() => !as.get(chat.id).running, 90000, '小羽真实 app-server 400 去档位恢复');
        const fullChat = as.get(chat.id);
        assert.equal(fullChat.turns.at(-1).status, 'completed');
        assert.ok(fullChat.items.some((x) => x.kind === 'note' && /去掉档位头/.test(x.text)));
        assert.ok(seen.some((x) => x.scope === 'B') && seen.some((x) => x.scope === ''));
      } finally {
        as.stopAll();
      }
    }
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

test('必修3 & 必修4 & 必修5：工坊单轮上限 60 分钟、75% 收尾缓冲参数、手册与技能第一轮先写成品', async () => {
  // 必修 3：单轮上限 60 分钟，且超时可正常停下
  assert.equal(TURN_LIMIT_MS, 60 * 60 * 1000, '工坊单轮上限放宽为 60 分钟');
  const root = mkTmp('limit');
  const slowCli = path.join(root, 'hang-cli.cjs');
  fs.writeFileSync(slowCli, 'setInterval(() => {}, 1000);\n');
  const prevCli = process.env.CS_AGENT_CODEX;
  process.env.CS_AGENT_CODEX = slowCli;
  const ag = new Agents({ dir: path.join(root, 'agents'), turnLimitMs: 180 });
  try {
    const t = ag.start({ engine: 'codex', title: '超时检查', prompt: '慢任务', permission: 'safe', formats: [], cap: 1 });
    await until(() => ag.get(t.id).status === 'failed', 5000, '超时自动停止');
    assert.equal(ag.get(t.id).note, '运行超时');
  } finally {
    ag.stopAll();
    if (prevCli === undefined) delete process.env.CS_AGENT_CODEX; else process.env.CS_AGENT_CODEX = prevCli;
  }

  // 必修 4：75% 触发点与收尾容差
  assert.equal(WRAP_RATIO, 0.75);
  assert.ok(wrapGrace(0.9) >= 0.1 && wrapGrace(0.9) <= 0.2);

  // 必修 5：手册与题库类技能均写明「找到一道就先写成品 / 第一轮落盘」，且手册总长不超门限
  const inst = kit.instructions('', 'full');
  assert.ok(inst.length > 400 && inst.length < 4000, `工作手册长度 ${inst.length} 在合理范围`);
  assert.match(inst, /找到一道就先写成品/);
  assert.match(inst, /第一轮必须先让成品文件落盘/);
  for (const sk of ['practice-set', 'homework', 'quiz-paper', 'question-json']) {
    const md = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-kit', 'skills', sk, 'SKILL.md'), 'utf8');
    assert.match(md, /落盘|先写成品|先把.*写盘/, `${sk} 强调第一轮先落成品文件`);
  }
});
