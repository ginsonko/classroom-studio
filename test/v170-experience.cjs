// 1.7.0 E 体验改进：网络波动自动重试（课堂 AI / 工坊 / 小羽）、取消、确定性错误不重试、「帮我查查」免费自检、硬盘快满检测。
// 纯 Node + 本机假站点 + 假 CLI，不联网、不花钱。运行：node test/v170-experience.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-v170e-'));
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-netdrop.cjs');
process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-netdrop.cjs');
process.env.CODEX_HOME = path.join(tmp, 'codex-home');
const netRetry = require('../electron/netRetry.cjs');
const diskWatch = require('../electron/diskWatch.cjs');
const { diagnose } = require('../electron/diagnose.cjs');
const tier = require('../electron/tier.cjs');
const ai = require('../electron/ai.cjs');
const { Agents } = require('../electron/agents.cjs');
const { Assistant } = require('../electron/assistant.cjs');
tier.setTestHosts(['127.0.0.1']);

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok  ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '\n', e.stack); } };
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 30)); } throw new Error('等待超时'); };
const D = [5, 5, 5, 5, 5];

/** 本机假中转站：按 plan 依次决定每次 /chat/completions 怎么回 */
function fakeSite() {
  const s = { hits: 0, plan: [], models: 200, chatProbe: 400, respProbe: 400, scopeProbe: null, seen: [] };
  s.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      s.seen.push({ url: req.url, method: req.method, body, scope: req.headers['x-route-scope'] || '' });
      if (req.url.endsWith('/models')) { res.writeHead(s.models, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'gpt-6-astra' }, { id: 'gpt-6.1-sol' }] })); return; }
      if (body === '{}') { // 自检的空请求：不调用模型
        if (req.headers['x-route-scope'] && s.scopeProbe) { res.writeHead(s.scopeProbe.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: s.scopeProbe.msg } })); return; }
        const st = req.url.endsWith('/responses') ? s.respProbe : s.chatProbe;
        res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'model is required' } })); return;
      }
      s.hits += 1;
      const step = s.plan.shift() || 'ok';
      if (step === 'reset') { req.socket.destroy(); return; }
      if (typeof step === 'number') { res.writeHead(step, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: step === 402 ? '余额不足' : step === 422 ? 'content blocked by moderation' : 'upstream error' } })); return; }
      if (step === 'nochannel') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: '当前分组 default 下对于模型 x 无可用渠道' } })); return; }
      if (step === 'halfstream') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: 'gpt-6-astra', choices: [{ message: { content: '好的' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((r) => s.server.listen(0, '127.0.0.1', () => { s.url = `http://127.0.0.1:${s.server.address().port}/v1`; r(s); }));
}

(async () => {
  const site = await fakeSite();
  const cfg = { baseUrl: site.url, model: 'gpt-6-astra', key: Buffer.from('sk-test-123456').toString('base64') };
  const chat = (opts = {}, value = {}) => ai._test.chat(cfg, { messages: [{ role: 'user', content: '你好' }], stream: false, ...value }, null, '', { delays: D, ...opts });

  // ── 1. 判定：哪些算临时错误 ──
  await test('netRetry：断连、超时、DNS、流中断、502/503/504 算临时；400/401/402/422、无可用分组、手动取消不算', () => {
    for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) assert.equal(netRetry.isTransient({ message: 'x', code }), true, code);
    assert.equal(netRetry.isTransient(new TypeError('fetch failed')), true);
    assert.equal(netRetry.isTransient({ message: '连不上 AI 服务：回复中途断开（已收到 2 字）' }), true);
    for (const s of [502, 503, 504]) assert.equal(netRetry.isTransient({ status: s, message: 'AI 服务暂时出错（' + s + '）' }), true, String(s));
    assert.equal(netRetry.isTransient({ status: 503, message: 'x', body: '无可用渠道' }), false, '无可用渠道走去头回退，不在这里重试');
    for (const s of [400, 401, 402, 403, 404, 422, 429]) assert.equal(netRetry.isTransient({ status: s, message: 'x' }), false, String(s));
    assert.equal(netRetry.isTransient({ message: '账户余额或额度不足' }), false);
    assert.equal(netRetry.isTransient({ message: 'AI 响应超时（10 秒），可以换个更快的模型或稍后重试' }), false, '单次调用整体响应超时不叠加 5 次重试');
    assert.equal(netRetry.isTransient(netRetry.abortErrorOf()), false);
    assert.equal(netRetry.isTransientText('stream disconnected before completion'), true);
    assert.equal(netRetry.isTransientText('unexpected status 402 Payment Required: 余额不足'), false);
    assert.deepEqual(netRetry.DELAYS, [1000, 2000, 4000, 8000, 15000], '生产默认 1、2、4、8、15 秒');
    assert.equal(netRetry.retryText(2), '网络波动，正在自动重连（第 2/5 次）…');
  });

  await test('netRetry.retry：间隔递增、最多重试 5 次（共 6 次调用），第 5 次后放弃', async () => {
    let calls = 0; const waits = [];
    await assert.rejects(netRetry.retry(async () => { calls++; throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }); }, { delays: [1, 2, 3, 4, 5], onRetry: (x) => waits.push([x.attempt, x.max, x.wait]) }), /fetch failed/);
    assert.equal(calls, 6);
    assert.deepEqual(waits, [[1, 5, 1], [2, 5, 2], [3, 5, 3], [4, 5, 4], [5, 5, 5]]);
    const env = process.env.CS_RETRY_DELAYS; process.env.CS_RETRY_DELAYS = '7,8';
    assert.deepEqual(netRetry.delays(), [7, 8], '测试可用环境变量注入短间隔');
    if (env === undefined) delete process.env.CS_RETRY_DELAYS; else process.env.CS_RETRY_DELAYS = env;
  });

  // ── 2. 课堂 AI ──
  await test('课堂 AI：连接被重置、502、503、504 依次出现 → 自动重试 4 次后成功，进度回调带「第 n/5 次」', async () => {
    site.hits = 0; site.plan = ['reset', 502, 503, 504, 'ok'];
    const seen = [];
    const r = await chat({ onRetry: (x) => seen.push(netRetry.retryText(x.attempt, x.max)) });
    assert.equal(r.content, '好的');
    assert.equal(site.hits, 5);
    assert.deepEqual(seen, [1, 2, 3, 4].map((n) => `网络波动，正在自动重连（第 ${n}/5 次）…`));
  });
  await test('课堂 AI：流式回复中途断开也自动重试', async () => {
    site.hits = 0; site.plan = ['halfstream', 'ok'];
    const r = await chat({}, { stream: true });
    assert.equal(r.content, '好的'); assert.equal(site.hits, 2);
  });
  await test('课堂 AI：一直断 → 最多重试 5 次（共 6 次请求）后报人话错误', async () => {
    site.hits = 0; site.plan = Array(10).fill(503);
    await assert.rejects(chat(), /AI 服务暂时出错（503）/);
    assert.equal(site.hits, 6);
  });
  await test('课堂 AI：402 余额不足、422 内容拦截、401 Key 不对只请求一次，绝不重试', async () => {
    for (const [code, re] of [[402, /余额|额度/], [422, /AI 请求失败（422）|拦截|422/], [401, /Key 无效/]]) {
      site.hits = 0; site.plan = [code, 'ok', 'ok'];
      await assert.rejects(chat(), re);
      assert.equal(site.hits, 1, String(code));
    }
  });
  await test('课堂 AI：老师取消 → 等待中的重试立刻停，不再发请求', async () => {
    site.hits = 0; site.plan = Array(10).fill(503);
    const ctl = new AbortController();
    const p = chat({ signal: ctl.signal, delays: [400, 400, 400, 400, 400] });
    await until(() => site.hits >= 1);
    ctl.abort();
    const t0 = Date.now();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    assert.ok(Date.now() - t0 < 300, '取消后立刻返回');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(site.hits, 1, '取消后不再请求');
  });

  // ── 3. 工坊 ──
  const mkAgents = () => new Agents({ dir: path.join(tmp, 'agents-' + Math.random().toString(36).slice(2, 7)), emit: () => {}, retryDelays: [30, 30, 30, 30, 30], autoPrewarm: false });
  const argsOf = (t) => fs.readFileSync(path.join(t.work, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  await test('工坊：网络断了 3 次 → 每次 resume 原会话接着做，进度显示「第 n/5 次」，最后完成', async () => {
    const agents = mkAgents();
    const task = agents.start({ engine: 'codex', prompt: '出一份练习 DROP3', cap: 5 });
    await until(() => { const t = agents.tasks.get(task.id); return t.status === 'done' && !t.child && !t.retryTimer; });
    const t = agents.tasks.get(task.id);
    const notes = t.events.filter((e) => e.kind === 'note' && e.retry).map((e) => e.text);
    assert.deepEqual(notes, [1, 2, 3].map((n) => `网络波动，正在自动重连（第 ${n}/5 次）…`));
    const args = argsOf(t);
    assert.equal(args.length, 4);
    for (const a of args.slice(1)) { assert.ok(a.includes('resume'), '重连用 exec resume'); assert.ok(a.includes('th-net'), '接回原会话'); }
    assert.equal(t.resumes, 0, '成功后计数清零');
  });
  await test('工坊（Claude Code）：网络断了 2 次 → 每次用 --resume 接回原会话重试，最后完成', async () => {
    const agents = mkAgents();
    const task = agents.start({ engine: 'claude', prompt: '出一份讲义 DROP2', cap: 5 });
    await until(() => { const t = agents.tasks.get(task.id); return t.status === 'done' && !t.child && !t.retryTimer; });
    const t = agents.tasks.get(task.id);
    const args = argsOf(t);
    assert.equal(args.length, 3);
    for (const a of args.slice(1)) { const i = a.indexOf('--resume'); assert.ok(i >= 0 && a[i + 1] === 'cl-net', 'Claude 用 --resume cl-net 接回原会话'); }
  });
  await test('工坊：一直断 → 最多 5 次重连后报失败', async () => {
    const agents = mkAgents();
    const task = agents.start({ engine: 'codex', prompt: '出一份练习 DROP9', cap: 5 });
    await until(() => { const t = agents.tasks.get(task.id); return t.status === 'failed' && !t.child && !t.retryTimer; });
    const t = agents.tasks.get(task.id);
    assert.equal(argsOf(t).length, 6);
    assert.equal(t.events.filter((e) => e.retry).length, 5);
  });
  await test('工坊：402 余额不足不重试，直接失败', async () => {
    const agents = mkAgents();
    const task = agents.start({ engine: 'codex', prompt: '出一份练习 FATAL402', cap: 5 });
    await until(() => { const t = agents.tasks.get(task.id); return t.status === 'failed' && !t.child; });
    const t = agents.tasks.get(task.id);
    assert.equal(argsOf(t).length, 1);
    assert.equal(t.events.filter((e) => e.retry).length, 0);
  });
  await test('工坊：等待重连时老师点停止 → 立即终止，不再启动', async () => {
    const agents = new Agents({ dir: path.join(tmp, 'agents-stop'), emit: () => {}, retryDelays: [800, 800, 800, 800, 800], autoPrewarm: false });
    const task = agents.start({ engine: 'codex', prompt: '出一份练习 DROP9', cap: 5 });
    await until(() => !!agents.tasks.get(task.id).retryTimer);
    agents.stop(task.id);
    const t = agents.tasks.get(task.id);
    assert.equal(t.status, 'stopped'); assert.equal(t.retryTimer, null);
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(argsOf(t).length, 1, '停止后没有再启动');
  });
  await test('工坊：没手动选模型时默认推荐强模型 gpt-6-astra，AI 设置里是 6.1-sol 也不用它', () => {
    assert.equal(tier.strongModel(''), 'gpt-6-astra');
    assert.equal(tier.strongModel('gpt-6.1-sol'), 'gpt-6-astra');
    assert.equal(tier.strongModel('claude-opus-5-5'), 'claude-opus-5-5', '够强的模型照用');
    const agents = new Agents({ dir: path.join(tmp, 'agents-model'), emit: () => {}, autoPrewarm: false, credentials: () => ({ baseUrl: site.url, key: 'sk-x', model: 'gpt-6.1-sol' }) });
    assert.equal(agents.modelFor({ engine: 'codex', useStudioKey: true }), 'gpt-6-astra');
    assert.equal(agents.modelFor({ engine: 'codex', useStudioKey: true, pick: 'gpt-6.1-sol' }), 'gpt-6.1-sol', '老师手动选的照用');
  });

  // ── 4. 小羽 ──
  await test('小羽：网络断了 → thread/resume 接回原会话重试，第 5 次后放弃；余额不足不重试；停止立刻终止', async () => {
    const as = new Assistant({ dir: path.join(tmp, 'assistant'), emit: () => {}, retryDelays: [20, 20, 20, 20, 20] });
    const c = as.create({ title: '测试' });
    const sent = [];
    as.send = async (o) => { sent.push(o); return as.meta(c); };
    c.threadId = 'th-xy';
    as.lastOpts.set(c.id, { id: c.id, text: '帮我出题' });
    for (let i = 1; i <= 5; i++) {
      assert.equal(as.scheduleRetry(c, 'stream disconnected before completion'), true, '第 ' + i + ' 次');
      assert.equal(as.meta(c).retrying, true);
      await until(() => sent.length === i);
      assert.equal(sent[i - 1].resume, true); assert.equal(sent[i - 1].id, c.id);
    }
    assert.match(c.items.filter((x) => x.retry).map((x) => x.text).join('|'), /第 5\/5 次/);
    assert.equal(as.scheduleRetry(c, 'stream disconnected'), false, '5 次后放弃');
    assert.equal(as.scheduleRetry(c, '402 余额不足'), false, '确定性错误不重试');
    as.retries.delete(c.id);
    as.retryDelays = [600, 600, 600, 600, 600];
    assert.equal(as.scheduleRetry(c, 'ECONNRESET'), true);
    const before = sent.length;
    await as.stop(c.id);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(sent.length, before, '停止后不再重连');
    assert.match(c.items[c.items.length - 1].text, /不再自动重连/);
    as.stopAll?.();
  });

  // ── 5. 帮我查查 ──
  const account = (o) => ({ view: () => o.view || { signedIn: false }, self: async () => { if (o.fail) throw new Error('登录过期'); return { balance: o.balance }; } });
  const tiers = (m) => ({ all: () => m });
  const by = (r, id) => r.items.find((x) => x.id === id);
  await test('自检：没账号没 Key → 账号项「需处理」，连通项提示先登录；不发任何请求', async () => {
    const n = site.seen.length;
    const r = await diagnose({ cfg: { baseUrl: site.url }, key: '', account: account({}), tiers: tiers({}) });
    assert.equal(by(r, 'account').level, 'bad'); assert.equal(by(r, 'account').action, 'account');
    assert.equal(by(r, 'network').level, 'bad');
    assert.equal(r.ok, false); assert.equal(site.seen.length, n);
  });
  await test('自检：登录玲珑账号、余额充足、档位正常、环境就绪 → 全部正常；只用 GET /models 和空请求', async () => {
    site.seen = [];
    const r = await diagnose({ cfg: { baseUrl: site.url, model: 'gpt-6-astra' }, key: 'sk-x', account: account({ view: { signedIn: true, username: 'teacher', site: { name: '玲珑' } }, balance: 30 }), tiers: tiers({ chat: 'balanced', workshop: 'quality' }), codexHome: { view: () => ({ phase: 'ready' }) }, defects: [], fallbacks: [] });
    assert.equal(r.ok, true, JSON.stringify(r.items));
    assert.match(by(r, 'network').detail, /模型列表 200（\d+ 毫秒，2 个模型）；聊天接口可用；\/v1\/responses 可用/);
    assert.match(by(r, 'balance').detail, /¥30\.00/);
    assert.ok(site.seen.every((x) => x.method === 'GET' || x.body === '{}'), '没有一次真正的模型调用');
  });
  await test('自检：余额 ¥0.5 → 余额项「需留意」给「去充值」；余额 0 → 「需处理」', async () => {
    let r = await diagnose({ cfg: { baseUrl: site.url }, key: 'sk-x', account: account({ view: { signedIn: true }, balance: 0.5 }), tiers: tiers({}), defects: [], fallbacks: [] });
    assert.equal(by(r, 'balance').level, 'warn'); assert.equal(by(r, 'balance').action, 'topup');
    r = await diagnose({ cfg: { baseUrl: site.url }, key: 'sk-x', account: account({ view: { signedIn: true }, balance: 0 }), tiers: tiers({}), defects: [], fallbacks: [] });
    assert.equal(by(r, 'balance').level, 'bad');
  });
  await test('自检：/models 返回 401 → 提示 Key 不对；站点不支持 /responses → 提示小羽和工坊用不了', async () => {
    site.models = 401;
    let r = await diagnose({ cfg: { baseUrl: site.url }, key: 'sk-x', account: account({}), tiers: tiers({}) });
    assert.equal(by(r, 'network').level, 'bad'); assert.match(by(r, 'network').advice, /Key 不对/);
    site.models = 200; site.respProbe = 404;
    r = await diagnose({ cfg: { baseUrl: site.url }, key: 'sk-x', account: account({}), tiers: tiers({}), defects: [], fallbacks: [] });
    assert.equal(by(r, 'network').level, 'warn'); assert.match(by(r, 'network').advice, /\/v1\/responses/);
    site.respProbe = 400;
  });
  await test('自检：连不上服务 → 「连不上 AI 服务」+ 检查网络的建议', async () => {
    const r = await diagnose({ cfg: { baseUrl: 'http://127.0.0.1:1/v1' }, key: 'sk-x', account: account({}), tiers: tiers({}) });
    assert.equal(by(r, 'network').level, 'bad'); assert.match(by(r, 'network').detail, /连不上 AI 服务/);
  });
  await test('自检：档位下没有可用分组 → 「档位与分组」需留意并给「去改档位」；站点报分组范围不兼容 → 需处理', async () => {
    site.scopeProbe = { status: 503, msg: '当前分组 default 下对于模型 x 无可用渠道' };
    let r = await diagnose({ cfg: { baseUrl: site.url }, key: 'sk-x', account: account({}), tiers: tiers({ chat: 'quality', workshop: 'quality' }), defects: [], fallbacks: [] });
    assert.equal(by(r, 'tier').level, 'warn', JSON.stringify(by(r, 'tier'))); assert.equal(by(r, 'tier').action, 'tier');
    assert.match(by(r, 'tier').detail, /没有可用分组/);
    site.scopeProbe = null;
    r = await diagnose({ cfg: { baseUrl: site.url }, key: 'sk-x', account: account({}), tiers: tiers({ chat: 'quality' }), defects: [{ kind: 'invalid_route_scope' }], fallbacks: [] });
    assert.equal(by(r, 'tier').level, 'bad');
    r = await diagnose({ cfg: { baseUrl: 'https://api.openai.com/v1' }, key: '', account: account({}), tiers: tiers({ chat: 'quality' }) });
    assert.match(by(r, 'tier').advice, /档位不起作用/, '第三方接口档位不起作用');
  });
  await test('自检：工坊环境正在准备显示进度；没准备给「立即准备」；登录了但读不到余额提示重新登录', async () => {
    let r = await diagnose({ cfg: {}, key: '', account: account({}), tiers: tiers({}), codexHome: { view: () => ({ phase: 'running', pct: 42, step: '初始化沙箱' }) } });
    assert.equal(by(r, 'warmup').level, 'warn'); assert.equal(by(r, 'warmup').pct, 42); assert.match(by(r, 'warmup').detail, /42%/);
    r = await diagnose({ cfg: {}, key: '', account: account({}), tiers: tiers({}), codexHome: { view: () => ({ phase: 'idle' }) } });
    assert.equal(by(r, 'warmup').action, 'warmup');
    r = await diagnose({ cfg: {}, key: '', account: account({ view: { signedIn: true }, fail: true }), tiers: tiers({}) });
    assert.equal(by(r, 'balance').level, 'warn'); assert.match(by(r, 'balance').advice, /重新登录/);
  });

  // ── 6. 硬盘快满 ──
  const fakeFs = (gb) => async () => ({ bavail: Math.round(gb * 1024 ** 3 / 4096), bsize: 4096, blocks: 250000000 });
  await test('硬盘：剩 4.2 GB（<5 GB）→ 提醒「X 盘只剩 4.2 GB…」；剩 5.1 GB 不提醒；同一个盘只算一次', async () => {
    let r = await diskWatch.check([{ role: 'recordings', dir: 'D:\\录课' }, { role: 'data', dir: 'D:\\数据' }], { statfs: fakeFs(4.2) });
    assert.equal(r.disks.length, 1); assert.deepEqual(r.disks[0].roles, ['recordings', 'data']);
    assert.equal(r.low.length, 1);
    assert.equal(r.low[0].message, 'D 盘只剩 4.2 GB，建议及时清理或换盘，免得录课半路中断');
    r = await diskWatch.check([{ role: 'recordings', dir: 'D:\\录课' }], { statfs: fakeFs(5.1) });
    assert.equal(r.low.length, 0);
    r = await diskWatch.check([{ role: 'recordings', dir: 'D:\\录课' }, { role: 'data', dir: 'E:\\数据' }], { statfs: fakeFs(3) });
    assert.equal(r.low.length, 2);
  });
  await test('硬盘：目录还不存在时往上找到盘根；真实 statfs 能读出本机剩余空间', async () => {
    const r = await diskWatch.check([{ role: 'data', dir: path.join(tmp, '不存在', '更深') }]);
    assert.ok(r.disks[0].free > 0, '读到真实剩余空间');
  });
  await test('硬盘：启动提醒今天点过「今天不再提醒」就不再弹，换天恢复', () => {
    const now = new Date(2026, 10, 17, 9);
    assert.equal(diskWatch.shouldShowAtStartup('', now), true);
    assert.equal(diskWatch.shouldShowAtStartup('2026-11-17', now), false);
    assert.equal(diskWatch.shouldShowAtStartup('2026-11-17', new Date(2026, 10, 18, 8)), true);
  });

  site.server.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 子进程可能还占着 */ }
  process.exit(failed.length ? 1 : 0);
})();
