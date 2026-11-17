// 1.7.0 玲珑账号 + 档位 + 收费闸：主进程模块的单元测试（不开 Electron，对假站点）。node --test test/v170-account.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const site = require('./fake-site-account.cjs');
const tier = require('../electron/tier.cjs');
const { Account } = require('../electron/account.cjs');
const charge = require('../electron/charge.cjs');

const CLIENT = 'classroom/' + require('../package.json').version;
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-acc-' + n + '-'));
// 假的安全存储：加个前缀再 base64，看得出「加密过」
const crypt = { available: true, encrypt: (s) => 'ENC:' + Buffer.from(s).toString('base64'), decrypt: (v) => Buffer.from(String(v).slice(4), 'base64').toString() };
const sitesFor = (url) => [{ id: 'linglong', name: '玲珑账号', origin: url, app: true }, { id: 'yinzi', name: '银子API', origin: url, loginOnly: true }];
tier.setTestHosts(['127.0.0.1']);

test('档位：只认银子 API 系站点，图片接口不带，三档的值', () => {
  assert.equal(tier.applies('https://api.yinziapi.top/v1'), true);
  assert.equal(tier.applies('https://changfengapi.cn/v1'), true);
  assert.equal(tier.applies('https://x.fuyaoapi.cn/v1'), true);
  assert.equal(tier.applies('https://qingyunapi.cn'), true);
  assert.equal(tier.applies('https://api.openai.com/v1'), false);
  assert.equal(tier.applies('https://fakeyinziapi.top/v1'), false, '只认整段域名');
  assert.deepEqual(tier.headersFor('https://api.yinziapi.top/v1/chat/completions', 'quality'), { 'X-Route-Scope': 'tier=A' });
  assert.deepEqual(tier.headersFor('https://api.yinziapi.top/v1/responses', 'balanced'), { 'X-Route-Scope': 'B' });
  assert.deepEqual(tier.headersFor('https://api.yinziapi.top/v1/chat/completions', 'save'), {}, '省钱优先不收窄');
  assert.deepEqual(tier.headersFor('https://api.yinziapi.top/v1/images/generations', 'quality'), {}, '图片线路也有评级，带了会全被筛掉');
  assert.deepEqual(tier.headersFor('https://api.openai.com/v1/chat/completions', 'quality'), {}, '第三方 Key 不带');
  assert.deepEqual(tier.codexArgs('https://api.yinziapi.top/v1', 'quality'), ['-c', `model_providers.classroom.http_headers={ "X-Omni-Client" = "${CLIENT}", "X-Route-Scope" = "tier=A" }`]);
  assert.deepEqual(tier.codexArgs('https://api.yinziapi.top/v1', 'save'), ['-c', `model_providers.classroom.http_headers={ "X-Omni-Client" = "${CLIENT}" }`], '省钱优先也带来源头');
  assert.deepEqual(tier.codexArgs('https://api.openai.com/v1', 'quality'), []);
  assert.deepEqual(tier.claudeEnv('https://api.yinziapi.top/v1', 'balanced'), { ANTHROPIC_CUSTOM_HEADERS: `X-Omni-Client: ${CLIENT}
X-Route-Scope: B` });
  assert.deepEqual(tier.claudeEnv('https://changfengapi.cn', ''), { ANTHROPIC_CUSTOM_HEADERS: `X-Omni-Client: ${CLIENT}` });
  assert.deepEqual(tier.claudeEnv('https://api.anthropic.com', 'quality'), {});
  assert.equal(tier.isNoRoute(400, '{"error":{"message":"这个范围里没有可用分组"}}'), true);
  assert.equal(tier.isNoRoute(503, 'No available channel for model gpt-x'), true);
  assert.equal(tier.isNoRoute(400, 'model not found'), false);
  for (const m of ['gpt-6.1-sol', 'gpt-4o-mini', 'gemini-3-flash', 'claude-haiku-4', 'gpt-6-luna']) assert.equal(tier.weakModel(m), true, m);
  for (const m of ['gpt-6-astra', 'claude-opus-5-5', 'gpt-5.4']) assert.equal(tier.weakModel(m), false, m);
  for (const t of ['不对', '错了，重做', '太笨了', '做得太差']) assert.equal(tier.complaint(t), true, t);
  for (const t of ['好不好看都行', '帮我做个课件', '对的']) assert.equal(tier.complaint(t), false, t);
  assert.equal(tier.lowRoute('tier=C; groups=2'), true);
  assert.equal(tier.lowRoute('tier>=B; groups=4'), false);
  assert.equal(tier.lowRoute(''), false);
});

test('来源头 X-Omni-Client：公共函数统一判断，我们站点和合作站一律带（含图片、模型列表），第三方一律不带', async () => {
  assert.equal(tier.CLIENT, CLIENT, '版本号从 package.json 读');
  for (const u of ['https://api.yinziapi.top/v1/chat/completions', 'https://api.yinziapi.top/v1/responses', 'https://yinziapi.top/v1/images/generations', 'https://changfengapi.cn/v1/models', 'https://fuyaoapi.cn/v1/audio/transcriptions', 'https://qingyunapi.cn/v1/chat/completions'])
    assert.equal(tier.siteHeaders(u)['X-Omni-Client'], CLIENT, u);
  for (const u of ['https://api.openai.com/v1/chat/completions', 'https://api.deepseek.com/v1/responses', 'https://my-relay.example.com/v1/images/generations', 'not a url'])
    assert.deepEqual(tier.siteHeaders(u, 'quality'), {}, u);
  assert.deepEqual(tier.siteHeaders('https://api.yinziapi.top/v1/chat/completions', 'quality'), { 'X-Omni-Client': CLIENT, 'X-Route-Scope': 'tier=A' });
  assert.deepEqual(tier.siteHeaders('https://api.yinziapi.top/v1/images/generations', 'quality'), { 'X-Omni-Client': CLIENT }, '图片只带来源，不带档位');
  // 全局 fetch 兜底：命中站点补上，第三方原样
  const seen = [];
  const g = { fetch: async (input, init) => { seen.push(new Headers(init?.headers).get('X-Omni-Client')); return new Response('{}'); } };
  tier.installFetch(g); tier.installFetch(g);
  await g.fetch('https://api.yinziapi.top/v1/chat/completions', { method: 'POST' });
  await g.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' });
  await g.fetch('https://api.yinziapi.top/v1/models', { headers: { 'X-Omni-Client': 'kept' } });
  assert.deepEqual(seen, [CLIENT, null, 'kept']);
});

test('档位存取：默认按 D.2（工坊质量优先、其余均衡），改了能读回来，乱填报错', () => {
  const d = tmp('tier'), s = new tier.TierStore(path.join(d, 'tiers.json'));
  assert.deepEqual(s.all(), { chat: 'balanced', workshop: 'quality', background: 'balanced' });
  s.set('chat', 'quality');
  assert.equal(new tier.TierStore(path.join(d, 'tiers.json')).get('chat'), 'quality');
  assert.throws(() => s.set('chat', 'max'));
  assert.throws(() => s.set('nope', 'save'));
  assert.equal(s.view('https://api.openai.com/v1').applies, false);
});

test('站点还没开放 v4：登录页写「暂未开放」，玲珑登录和注册都不发请求', async () => {
  const s = await site.start({ caps: null });
  try {
    const a = new Account({ dir: tmp('off'), crypt, client: CLIENT, sites: sitesFor(s.url) });
    const info = await a.siteInfo('linglong');
    assert.equal(info.reachable, true); assert.equal(info.login, false); assert.equal(info.register, false);
    assert.match(info.note, /注册暂未开放/);
    await assert.rejects(a.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' }), (e) => e.code === 'app_login_off');
    await assert.rejects(a.register({ site: 'linglong', username: 'n1', password: 'pass-12345', email: 'a@b.cn', code: '888888' }), (e) => e.code === 'commercial_disabled');
    await assert.rejects(a.sendCode({ site: 'linglong', email: 'a@b.cn' }), (e) => e.code === 'commercial_disabled');
    assert.ok(!s.st.log.some((l) => /\/api\/app\/v1\/(login|register)|verification/.test(l.path)), '没开放就不打软件登录、注册接口');
    // 合作站照常能登录
    const p = await a.siteInfo('yinzi');
    assert.equal(p.login, true); assert.equal(p.register, false);
  } finally { await s.close(); }
});

test('玲珑账号：登录 → 安全存储加密 → 自动建「最强网课教辅系统」专用 Key → 页面看不到 Key；每个请求都带 X-Omni-Client', async () => {
  const s = await site.start();
  try {
    const dir = tmp('ll'), a = new Account({ dir, crypt, client: CLIENT, sites: sitesFor(s.url) });
    const info = await a.siteInfo('linglong');
    assert.equal(info.login, true); assert.equal(info.register, true); assert.equal(info.note, '');
    const v = await a.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' });
    assert.equal(v.signedIn, true); assert.equal(v.kind, 'linglong'); assert.equal(v.username, 'teacher');
    assert.ok(!JSON.stringify(v).includes('session='), '页面拿不到会话');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'account.json'), 'utf8'));
    assert.match(saved.cookie, /^ENC:/, '登录状态加密保存');
    assert.ok(!JSON.stringify(saved).includes('pass-1234'), '不保存密码');
    const k = await a.ensureKey();
    assert.match(k.key, /^sk-fake/); assert.equal(k.baseUrl, s.url + '/v1');
    assert.equal(s.st.tokens.length, 1); assert.equal(s.st.tokens[0].name, '最强网课教辅系统'); assert.equal(s.st.tokens[0].group, 'auto', '站点有智能路由就开着，档位才起作用');
    await a.ensureKey();
    assert.equal(s.st.tokens.length, 1, '再连一次用同一把 Key，不重复建');
    assert.ok(!JSON.stringify(a.view()).includes(k.key), 'view 里没有 Key');
    // 重新打开软件：从加密的状态里接着用
    const b = new Account({ dir, crypt, client: CLIENT, sites: sitesFor(s.url) });
    assert.equal(b.signedIn, true);
    const me = await b.self();
    assert.equal(me.balance, 25); assert.equal(me.commercial, true);
    assert.ok(!('group' in me), '不显示分组');
    const logs = await b.logs();
    assert.equal(logs.items[0].cost, 0.31); assert.equal(logs.spent, 0.31);
    assert.ok(!JSON.stringify(logs).match(/ratio|vip/), '明细不带分组、倍率');
    const top = await b.topupInfo();
    assert.deepEqual(top.methods.map((m) => m.type), ['alipay', 'wxpay'], '海外支付方式不显示');
    assert.equal((await b.redeem('GIFT-10')).added, 10);
    const pay = await b.pay(30, 'alipay');
    assert.equal(pay.url, 'https://pay.example.test/submit');
    const board = await charge.fetchBoard(b, {});
    assert.equal(board.ready, true);
    assert.equal(board.tiers.map((t) => t.name).join('/'), '省钱优先/均衡/质量优先');
    assert.ok(!JSON.stringify(board).match(/group_ratio|original_price/), '价格板只留白名单字段');
    assert.ok(s.st.log.every((l) => l.client === CLIENT || l.path.startsWith('/v1/')), '账号接口全都带 X-Omni-Client');
    b.signOut();
    assert.equal(b.signedIn, false);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, 'account.json'), 'utf8')).cookie);
  } finally { await s.close(); }
});

test('二次验证、合作站只登录、商业号走合作站被拦、站点不认客户端时说人话', async () => {
  const s = await site.start({ clients: ['omni', 'linglong', 'huozhou'] });
  try {
    const a = new Account({ dir: tmp('2fa'), crypt, client: CLIENT, sites: sitesFor(s.url) });
    await assert.rejects(a.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' }), (e) => e.code === 'client_unknown' && /白名单/.test(e.message));
    s.st.clients = null;
    const r = await a.login({ site: 'linglong', username: 'otp', password: 'pass-1234' });
    assert.equal(r.need2fa, true); assert.equal(r.signedIn, false);
    await assert.rejects(a.verify2fa('000000'));
    const v = await a.verify2fa('123456');
    assert.equal(v.signedIn, true); assert.equal(v.username, 'otp');
    a.signOut();
    const p = await a.login({ site: 'yinzi', username: 'plain', password: 'pass-1234' });
    assert.equal(p.kind, 'partner');
    assert.ok(s.st.log.some((l) => l.path === '/api/user/login'));
    await assert.rejects(a.register({ site: 'yinzi', username: 'x', password: 'pass-12345', email: 'a@b.cn', code: '1' }), (e) => e.code === 'login_only');
    a.signOut();
    await assert.rejects(a.login({ site: 'yinzi', username: 'teacher', password: 'pass-1234' }), (e) => e.code === 'commercial_app_only');
    await assert.rejects(a.login({ site: 'linglong', username: 'teacher', password: 'wrong' }), /密码/);
  } finally { await s.close(); }
});

test('注册：开了才注册，走软件接口并带客户端标识；注册完直接登录', async () => {
  const s = await site.start();
  try {
    const a = new Account({ dir: tmp('reg'), crypt, client: CLIENT, sites: sitesFor(s.url) });
    assert.equal(await a.sendCode({ site: 'linglong', email: 'new@school.cn' }), true);
    await assert.rejects(a.register({ site: 'linglong', username: 'newt', password: 'short', email: 'new@school.cn', code: '888888' }), /8 位/);
    const v = await a.register({ site: 'linglong', username: 'newt', password: 'pass-12345', email: 'new@school.cn', code: '888888' });
    assert.equal(v.signedIn, true); assert.equal(v.kind, 'linglong');
    assert.equal(s.st.users.get('newt').client, CLIENT);
    assert.ok(!s.st.log.some((l) => l.path === '/api/user/register'), '不在网页注册接口注册');
  } finally { await s.close(); }
});

test('没有系统安全存储：登录状态只放内存，不落盘', async () => {
  const s = await site.start();
  try {
    const dir = tmp('nocrypt'), weak = { available: false, encrypt: () => null, decrypt: () => '' };
    const a = new Account({ dir, crypt: weak, client: CLIENT, sites: sitesFor(s.url) });
    await a.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' });
    assert.equal(a.signedIn, true);
    assert.ok(!fs.readFileSync(path.join(dir, 'account.json'), 'utf8').includes('session'), '明文会话不落盘');
    assert.equal(new Account({ dir, crypt: weak, client: CLIENT, sites: sitesFor(s.url) }).signedIn, false, '重开软件要重新登录');
  } finally { await s.close(); }
});

test('收费闸：玲珑账号画图先报价；任务上限内不弹框直接记账；超了问老师；不同意就不提交；409 重新报价；普通账号不报价', async () => {
  const s = await site.start();
  try {
    const a = new Account({ dir: tmp('gate'), crypt, client: CLIENT, sites: sitesFor(s.url) });
    await a.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' });
    const k = await a.ensureKey();
    const asked = [];
    let answer = true;
    const confirm = new charge.PriceConfirm({ emit: (m) => { if (m.confirm) { asked.push(m.confirm); setTimeout(() => confirm.answer(m.confirm.id, answer), 5); } } });
    const task = { id: 't1', cap: 1, cny: 0.5 };
    const gate = new charge.ChargeGate({ account: a, confirm, preauth: charge.taskPreauth({ agents: { tasks: new Map([['t1', task]]) }, ledger: { budget: { caps: { month: 200 } }, spent: () => ({ month: 10 }) } }) });
    assert.equal(gate.covers(k.baseUrl), true);
    assert.equal(gate.covers('https://api.openai.com/v1'), false);
    const send = (fields) => async (headers) => {
      const r = await fetch(k.baseUrl + '/images/generations', { method: 'POST', headers: { authorization: 'Bearer ' + k.key, 'content-type': 'application/json', ...headers }, body: JSON.stringify(fields) });
      return { status: r.status, text: await r.text() };
    };
    const f = { model: 'gpt-image-2', prompt: '电梯', size: '1024x1024', n: 1 };
    // 1) 工坊任务：0.5 + 0.12 ≤ 1，不弹框
    let r = await gate.run({ fields: f, ctx: { taskId: 't1' } }, send(f));
    assert.equal(r.value.status, 200); assert.equal(r.cny, 0.12); assert.equal(r.via, 'cap'); assert.equal(asked.length, 0);
    // 2) 课件插图（没有任务）：弹框，同意
    r = await gate.run({ fields: f, ctx: { feature: '课件插图' } }, send(f));
    assert.equal(r.via, 'user'); assert.equal(asked.length, 1); assert.equal(asked[0].totalCny, 0.12); assert.equal(asked[0].count, 1);
    // 3) 任务快花完了：0.95 + 0.12 > 1，要问
    task.cny = 0.95;
    r = await gate.run({ fields: f, ctx: { taskId: 't1' } }, send(f));
    assert.equal(r.via, 'user'); assert.equal(asked.length, 2);
    // 4) 不同意：不提交
    answer = false;
    const before = s.st.sent.length;
    await assert.rejects(gate.run({ fields: f, ctx: {} }, send(f)), (e) => e.code === 'quote_declined' && /没有扣费/.test(e.message));
    assert.equal(s.st.sent.length, before, '没同意就一个请求都不发');
    answer = true;
    // 5) 409：报价对不上（提交时改了参数）→ 重新报价再发，不多扣
    let first = true;
    r = await gate.run({ fields: f, ctx: { taskId: 't1' } }, async (h) => { const body = first ? { ...f, prompt: '改过' } : f; first = false; return send(body)(h); });
    assert.equal(r.value.status, 200);
    assert.ok(s.st.sent.filter((x) => x.path === '/v1/images/generations').every((x) => x.quote.startsWith('q1.')), '商业账号的每次提交都带报价');
    // 6) 站点没开放报价：直接拦，不裸提交
    s.st.caps = { ...s.st.caps, commercial_quote: false }; a.caps.clear();
    await assert.rejects(gate.run({ fields: f, ctx: {} }, send(f)), (e) => e.code === 'quote_unavailable');
    // 7) 普通（非商业）账号：不报价、不弹框
    s.st.caps = { ...s.st.caps, commercial_quote: true };
    a.signOut(); await a.login({ site: 'linglong', username: 'plain', password: 'pass-1234' }).catch(() => null);
  } finally { await s.close(); }
});

test('收费闸：普通账号原样提交，不报价不弹框', async () => {
  const s = await site.start();
  try {
    const a = new Account({ dir: tmp('plain'), crypt, client: CLIENT, sites: sitesFor(s.url) });
    await a.login({ site: 'linglong', username: 'plain', password: 'pass-1234' });
    const k = await a.ensureKey();
    let asked = 0;
    const gate = new charge.ChargeGate({ account: a, confirm: { ask: async () => { asked++; return { yes: true }; } } });
    const f = { model: 'gpt-image-2', prompt: 'x', n: 1 };
    const r = await gate.run({ fields: f }, async (h) => { const x = await fetch(k.baseUrl + '/images/generations', { method: 'POST', headers: { authorization: 'Bearer ' + k.key, 'content-type': 'application/json', ...h }, body: JSON.stringify(f) }); return { status: x.status, text: await x.text() }; });
    assert.equal(r.value.status, 200); assert.equal(r.via, 'plain'); assert.equal(asked, 0);
    assert.equal(s.st.sent.at(-1).quote, '');
  } finally { await s.close(); }
});

test('报价确认框：同时到的几张合成一个，过期没答当没同意', async () => {
  const events = [];
  const pc = new charge.PriceConfirm({ emit: (m) => events.push(m) });
  const offer = (cny, ms) => ({ quoteId: 'q1.' + cny, payableCny: cny, exact: true, units: 1, expiresAt: Date.now() + ms });
  const a = pc.ask({ mode: 'images', model: 'm', offer: offer(0.1, 60000) });
  const b = pc.ask({ mode: 'images', model: 'm', offer: offer(0.2, 60000) });
  assert.equal(pc.pending().items.length, 2); assert.equal(pc.pending().totalCny, 0.3);
  pc.answer(pc.pending().id, true);
  assert.deepEqual(await a, { yes: true }); assert.deepEqual(await b, { yes: true });
  const c = pc.ask({ mode: 'images', model: 'm', offer: offer(0.1, 30) });
  const r = await c;
  assert.equal(r.yes, false); assert.match(r.reason, /过期/);
  assert.equal(events.at(-1).confirm, null);
});

test('AI 工坊：Codex 在 provider 配置里加档位请求头，Claude Code 用自定义请求头环境变量；第三方 Key 不带；换档下一轮生效；「变笨了」只提醒一次', () => {
  const { Agents } = require('../electron/agents.cjs');
  let base = 'https://api.yinziapi.top/v1';
  const ag = new Agents({ dir: tmp('agents'), credentials: () => ({ baseUrl: base, key: 'sk-test', model: 'gpt-6-astra' }), log: null, tierOf: () => 'quality' });
  const mk = (engine, extra = {}) => ({ id: 'x-' + engine, engine, useStudioKey: true, permission: 'full', tier: 'quality', cap: 5, cny: 0, events: [], queue: [], work: os.tmpdir(), kind: '', ...extra });
  const codexArgs = ag.args(mk('codex'), 'hi').join(' ');
  assert.ok(codexArgs.includes(`model_providers.classroom.http_headers={ "X-Omni-Client" = "${CLIENT}", "X-Route-Scope" = "tier=A" }`), 'Codex 子进程带来源头和档位头');
  assert.match(ag.args(mk('codex', { tier: 'balanced' }), 'hi').join(' '), /"X-Route-Scope" = "B"/);
  assert.doesNotMatch(ag.args(mk('codex', { tier: 'save' }), 'hi').join(' '), /X-Route-Scope/, '省钱优先不带档位');
  assert.match(ag.args(mk('codex', { tier: 'save' }), 'hi').join(' '), /"X-Omni-Client" = "classroom\//, '省钱优先也带来源');
  assert.doesNotMatch(ag.args(mk('codex', { useStudioKey: false }), 'hi').join(' '), /X-Route-Scope/, '用 CLI 自己的账号时不带');
  assert.equal(ag.env(mk('claude')).ANTHROPIC_CUSTOM_HEADERS, `X-Omni-Client: ${CLIENT}
X-Route-Scope: tier=A`, 'Claude Code 子进程带来源头和档位头');
  assert.equal(ag.env(mk('claude', { tier: 'save' })).ANTHROPIC_CUSTOM_HEADERS, `X-Omni-Client: ${CLIENT}`);
  assert.equal(ag.env(mk('claude', { useStudioKey: false })).ANTHROPIC_CUSTOM_HEADERS, undefined, '用 Claude Code 自己的账号时不带');
  base = 'https://api.openai.com/v1';
  assert.doesNotMatch(ag.args(mk('codex'), 'hi').join(' '), /X-Route-Scope|X-Omni-Client|http_headers/, '第三方 Key 什么都不带');
  assert.equal(ag.env(mk('claude')).ANTHROPIC_CUSTOM_HEADERS, undefined);
  base = 'https://api.yinziapi.top/v1';
  // 换档：下一轮的参数就变了；提醒只一次
  const t = { ...mk('codex', { tier: 'balanced', id: 'sug' }), title: 't', created: Date.now(), updated: Date.now() };
  fs.mkdirSync(path.join(ag.dir, t.id), { recursive: true });
  ag.tasks.set(t.id, t);
  assert.equal(ag.suggestQuality(t, '你连着两次说做得不对'), true);
  assert.equal(ag.suggestQuality(t, '又一次'), false, '同一任务只提醒一次');
  assert.equal(ag.public(t).suggest.why, '你连着两次说做得不对');
  assert.equal(ag.public(t).tierSite, true);
  ag.configure(t.id, { tier: 'quality' });
  assert.equal(t.tier, 'quality'); assert.equal(t.suggest, null);
  assert.match(ag.args(t, 'x').join(' '), /tier=A/);
  assert.equal(ag.suggestQuality({ ...t, id: 'q2', suggested: false, tier: 'quality' }, 'x'), false, '已经是质量优先不提醒');
  base = 'https://api.openai.com/v1';
  assert.equal(ag.suggestQuality({ ...t, id: 'q3', suggested: false, tier: 'save' }, 'x'), false, '档位不起作用时不提醒');
  // 新任务默认用「AI 工坊出成品」的档位
  assert.equal(require('../electron/tier.cjs').clean(undefined, 'workshop'), 'quality');
});

test('小羽：常驻进程启动时带档位；换档后下一句重启进程并用 thread/resume 接回原会话；第三方 Key 不带', async () => {
  const { Assistant } = require('../electron/assistant.cjs');
  const dir = tmp('as'), argvLog = path.join(dir, 'argv.jsonl'), rpcLog = path.join(dir, 'rpc.jsonl');
  process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-app-server-argv.cjs');
  process.env.FAKE_ARGV = argvLog; process.env.FAKE_LOG = rpcLog;
  let level = 'balanced', base = 'https://api.yinziapi.top/v1';
  const as = new Assistant({ dir, credentials: () => ({ baseUrl: base, key: 'sk-test-key', model: 'gpt-6-astra' }), tierOf: () => level, log: null });
  const wait = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out'); };
  const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  try {
    const c = as.create({ title: 't' });
    await as.send({ id: c.id, text: '你好' });
    await wait(() => !as.get(c.id).running);
    let runs = lines(argvLog);
    assert.equal(runs.length, 1);
    assert.ok(runs[0].argv.join(' ').includes(`model_providers.classroom.http_headers={ "X-Omni-Client" = "${CLIENT}", "X-Route-Scope" = "B" }`), '小羽内核带来源头和档位头');
    const thread = as.get(c.id).threadId;
    assert.ok(thread);
    // 同一档位再说一句：不重启
    await as.send({ id: c.id, text: '再说一句' });
    await wait(() => !as.get(c.id).running);
    assert.equal(lines(argvLog).length, 1);
    // 换档：下一句重启进程（带新档位），用 thread/resume 接回同一个会话
    level = 'quality';
    await as.send({ id: c.id, text: '换个档位接着说' });
    await wait(() => !as.get(c.id).running);
    runs = lines(argvLog);
    assert.equal(runs.length, 2, '换档后重启了一次');
    assert.match(runs[1].argv.join(' '), /"X-Route-Scope" = "tier=A"/);
    assert.notEqual(runs[0].pid, runs[1].pid);
    const rpc = lines(rpcLog);
    assert.ok(rpc.some((m) => m.method === 'thread/resume' && m.params.threadId === thread), '接回原来的会话，上下文不丢');
    assert.equal(as.get(c.id).threadId, thread);
    assert.equal(as.status().tier, 'quality');
    // 连着两次说「不对」：这一轮答完，回复下面出提醒（已经是质量优先时不出）
    level = 'balanced';
    await as.send({ id: c.id, text: '不对' }); await wait(() => !as.get(c.id).running);
    await as.send({ id: c.id, text: '还是错了，重做' }); await wait(() => !as.get(c.id).running);
    await wait(() => as.get(c.id).items.some((x) => x.kind === 'suggest'));
    await as.send({ id: c.id, text: '不对' }); await wait(() => !as.get(c.id).running);
    await as.send({ id: c.id, text: '太笨了' }); await wait(() => !as.get(c.id).running);
    assert.equal(as.get(c.id).items.filter((x) => x.kind === 'suggest').length, 1, '一段对话只提醒一次');
    // 第三方 Key：不带档位
    base = 'https://api.openai.com/v1';
    const d = as.create({ title: 'u' });
    await as.send({ id: d.id, text: '你好' });
    await wait(() => !as.get(d.id).running);
    assert.doesNotMatch(lines(argvLog).at(-1).argv.join(' '), /X-Route-Scope|X-Omni-Client|http_headers/, '第三方 Key 什么都不带');
  } finally { as.stopAll(); }
});
