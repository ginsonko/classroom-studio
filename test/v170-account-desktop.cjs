// 1.7.0 玲珑账号 + 档位 + 收费闸：真窗口离屏测试，对假站点（不联网、不花钱），顺手截 1440×900 和 1920×1080 的界面图。
// 用法：CS_DIST=.out/dist-me [CS_SHOT_OUT=<截图目录>] npx electron test/quiet.cjs test/v170-account-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const assert = require('node:assert/strict');
const out = process.env.CS_SHOT_OUT || path.join(__dirname, '../.out/v170-account'); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1';
process.env.CS_DATA_DIR = fs.mkdtempSync(path.join(path.resolve(process.env.CS_TEST_OUT || path.join(__dirname, '../.out')), 'acc-data-'));
process.env.CS_TIER_HOSTS = '127.0.0.1';
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-dual.cjs');
process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');
process.env.FAKE_ARGV = path.join(process.env.CS_DATA_DIR, 'appserver-argv.jsonl');
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(path.join(DATA, 'study'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'study', 'study.json'), JSON.stringify({ questions: [], attempts: [], homework: [], notes: [], portraits: {}, sorts: [], lessons: [], preps: [], files: [] }));
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false, autoMap: false, transcribe: false },
  local: { roots: [], students: [{ id: 'stu-a', name: '莫莫', grade: '高一', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' }], studentId: 'stu-a', slots: [], learning: {} },
}));
const electron = require('electron'); const { app } = electron;
const site = require('./fake-site-account.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('v170 account desktop timed out'); app.exit(1); }, 300000);
const results = [];
const ok = (name) => { results.push(name); console.log('ok - ' + name); };

(async () => {
  const s = await site.start({ caps: null });
  const other = await site.start();
  const sites = [{ id: 'linglong', name: '玲珑账号', origin: s.url, app: true }, { id: 'yinzi', name: '银子API', origin: s.url, loginOnly: true }, { id: 'changfeng', name: '长风API', origin: s.url, loginOnly: true }, { id: 'fuyao', name: '扶摇API', origin: s.url, loginOnly: true }, { id: 'qingyun', name: '青云API', origin: s.url, loginOnly: true }];
  process.env.CS_ACCOUNT_SITES = JSON.stringify(sites);
  require('../electron/main.cjs');
  const api = await until(() => globalThis.classroomStudioTest, 30000, 'app'), teacher = api.windows.get('teacher');
  const T = async (code) => { const r = await teacher.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'), 30000, 'QA');
  const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  const size = (w, h) => { teacher.setBounds({ x: left, y: 30, width: w, height: h }); teacher.showInactive(); };
  size(1440, 900);
  const shot = async (name, sel) => {
    await sleep(350);
    let rect;
    if (sel) rect = await T(`const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'nearest'});await new Promise(r=>setTimeout(r,200));const r=e.getBoundingClientRect();return {x:Math.max(0,r.x-12),y:Math.max(0,r.y-12),width:Math.min(innerWidth,r.width+24),height:Math.min(innerHeight,r.height+24)}`);
    const img = await teacher.webContents.capturePage(rect ? { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.floor(rect.width), height: Math.floor(rect.height) } : undefined);
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); console.log('SHOT ' + name);
  };
  const has = (sel) => T(`return !!document.querySelector(${JSON.stringify(sel)})`);
  const text = (sel) => T(`return document.querySelector(${JSON.stringify(sel)})?.innerText||''`);
  const click = (sel) => T(`const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('没有 '+${JSON.stringify(sel)});e.click();return true`);
  const fill = (sel, v) => T(`const e=document.querySelector(${JSON.stringify(sel)});const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;set.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const call = (m, v) => T(`return await Q.host.call(${JSON.stringify(m)},${JSON.stringify(v ?? null)})`);
  const overlap = (a, b) => T(`const A=document.querySelector(${JSON.stringify(a)}),B=document.querySelector(${JSON.stringify(b)});if(!A||!B)return false;const r=A.getBoundingClientRect(),q=B.getBoundingClientRect();return !(r.right<=q.left||q.right<=r.left||r.bottom<=q.top||q.bottom<=r.top)`);
  try {
    await until(() => T(`return Q.account.useAccount.getState().checked`), 15000, '账号状态');

    // ── 1. 三样都没有：要弹登录页；站点还没开放 v4 时写明白 ──
    let g = await call('account.gate');
    assert.equal(g.show, true); assert.equal(g.why, 'none');
    await T(`await Q.account.checkGate(true);return true`);
    await until(() => has('[data-qa="account-gate"]'), 5000, '登录页');
    await until(async () => /注册暂未开放/.test(await text('[data-qa="acc-note"]')), 8000, '未开放提示');
    assert.equal(await has('[data-qa="acc-tab-register"]'), false, '开关拿不到时隐藏玲珑注册');
    assert.equal(await T(`return document.querySelector('[data-qa="acc-user"]').disabled`), true, '没开放时玲珑登录框不可填');
    await shot('01-登录页-站点还没开放玲珑账号-1440');
    // 合作站登录照常可用
    await click('[data-qa="opt-partner"]'); await sleep(300);
    assert.equal(await T(`return document.querySelector('[data-qa="acc-user"]').disabled`), false, '合作站登录不受影响');
    await click('[data-qa="opt-linglong"]'); await sleep(200);
    ok('三样都没有时弹登录页；开关接口拿不到时写「注册暂未开放」并隐藏注册，合作站照常可登录');

    // 跳过：这次不拦，下次启动（再判断一次）还会弹
    await click('[data-qa="opt-skip"]');
    await until(async () => !(await has('[data-qa="account-gate"]')), 3000, '跳过');
    assert.equal(await T(`return Q.useStore.getState().aiOpen`), true, '跳过后打开 AI 设置');
    g = await call('account.gate'); assert.equal(g.show, true, '跳过后下次还会弹');
    // 以后不再自动弹出
    await T(`await Q.account.checkGate(true);return true`);
    await until(() => has('[data-qa="acc-never"]'), 3000);
    await click('[data-qa="acc-never"]');
    await until(async () => (await call('account.gate')).why === 'never', 3000, '不再弹');
    assert.equal((await call('account.gate')).show, false);
    await click('[data-qa="acc-never"]');
    await until(async () => (await call('account.gate')).show === true, 3000);
    ok('跳过后下次照样弹；勾「以后不再自动弹出」就不弹，取消勾又会弹');

    // 有一把测通过的 Key：不弹；Key 无效：照样弹
    await call('ai.setConfig', { baseUrl: other.url + '/v1', key: 'sk-own-teacher-key-1' });
    g = await call('account.gate'); assert.equal(g.show, false); assert.equal(g.why, 'key');
    assert.equal((await call('ai.getConfig')).tested, true, '免费读模型列表读通了就记成测通过');
    await call('ai.setConfig', { key: 'sk-bad-0000' });
    g = await call('account.gate'); assert.equal(g.show, true, 'Key 无效（401）算没有');
    await call('ai.setConfig', { key: 'sk-own-teacher-key-1' });
    ok('有测通过的 Key 不弹；Key 无效照样弹');

    // ── 2. 站点开放以后：玲珑账号登录（不更新软件，自动出现） ──
    s.st.caps = { app_login: true, commercial_register: true, price_board: true, commercial_quote: true };
    api.account.caps.clear();
    await T(`Q.account.closeAccount();await new Promise(r=>setTimeout(r,100));Q.account.openAccount('signin');return true`);
    await until(async () => !(await has('[data-qa="acc-note"]')) && !(await T(`return document.querySelector('[data-qa="acc-user"]')?.disabled`)), 8000, '登录框可用');
    await shot('02-登录页-三选一-1440');
    await until(() => has('[data-qa="acc-tab-register"]'), 5000, '开放后出现注册');
    await click('[data-qa="acc-tab-register"]'); await sleep(300);
    assert.equal(await has('[data-qa="acc-note"]'), false, '开放了就能注册');
    await shot('02b-登录页-玲珑账号注册-1440');
    await click('[data-qa="opt-partner"]'); await sleep(300);
    assert.match(await text('[data-qa="acc-form-partner"]'), /银子API[\s\S]*长风API[\s\S]*扶摇API[\s\S]*青云API/);
    assert.match(await text('[data-qa="acc-form-partner"]'), /只登录，不在这里注册/);
    await shot('02c-登录页-合作站账号-1440');
    await click('[data-qa="opt-linglong"]'); await sleep(300);
    await fill('[data-qa="acc-user"]', 'teacher'); await fill('[data-qa="acc-pass"]', 'pass-1234');
    await click('[data-qa="acc-login"]');
    await until(() => has('[data-qa="acc-start"]'), 20000, '登录完成');
    const done = await text('[data-qa="account-gate"]');
    assert.match(done, /已登录并接好 AI/);
    await shot('03-登录成功-自动接好AI-1440');
    const cfg = await call('ai.getConfig');
    assert.equal(cfg.hasKey, true); assert.equal(cfg.account.kind, 'linglong'); assert.equal(cfg.keyHint, '', '页面看不到 Key 尾号');
    assert.equal(cfg.baseUrl, s.url + '/v1');
    assert.equal(cfg.model, 'gpt-6-astra', '按推荐挑了模型');
    assert.equal(s.st.tokens.length, 1); assert.equal(s.st.tokens[0].name, '玲珑课堂');
    assert.ok(s.st.log.filter((l) => l.path.startsWith('/api/')).every((l) => l.client === 'classroom/' + require('../package.json').version), '账号接口都带 X-Omni-Client');
    const accFile = fs.readFileSync(path.join(DATA, 'account.json'), 'utf8');
    assert.ok(!accFile.includes('session=') && !accFile.includes('pass-1234'), '登录状态加密、不存密码');
    assert.ok(!fs.readFileSync(path.join(DATA, 'ai.json'), 'utf8').includes('sk-fake'), 'Key 加密保存');
    const { Account, makeCrypt } = require('../electron/account.cjs');
    assert.equal(new Account({ dir: DATA, crypt: makeCrypt(electron.safeStorage), client: 'x', sites }).signedIn, true, 'safeStorage 加密的登录状态重开软件能读回来');
    assert.equal((await call('account.gate')).show, false, '登录以后不再弹');
    assert.equal(await T(`return localStorage.getItem('cs.agent.studioKey')`), '1', 'AI 工坊默认用导播台的接口');
    await click('[data-qa="acc-start"]');
    ok('玲珑账号登录：自动建专用 Key、挑模型、测连接；安全存储加密；以后不再弹');

    // ── 3. 账号页：余额、充值、明细、价格板、档位 ──
    await until(() => T(`return !!Q.account.useAccount.getState().view?.signedIn`), 5000);
    assert.match(await T(`return document.querySelector('[data-qa="tb-account"]').dataset.tip`), /玲珑账号：teacher/, '窄窗口只留图标，账号名在提示里');
    await click('[data-qa="tb-account"]');
    await until(async () => /25\.0|¥25/.test(await text('[data-qa="acc-balance"]')), 8000, '余额');
    await until(() => has('[data-qa="acc-topup"] .acc-amts'), 8000, '充值');
    await shot('04-账号页-余额和充值-1440');
    await click('[data-qa="acc-tab-logs"]');
    await until(async () => /gpt-6-astra/.test(await text('[data-qa="account-page"]')), 8000, '明细');
    assert.doesNotMatch(await text('[data-qa="account-page"]'), /vip|倍率|原价|分组/);
    await shot('05-账号页-消费明细-1440');
    await click('[data-qa="acc-tab-price"]');
    await until(() => has('[data-qa="acc-board"] table'), 8000, '价格板');
    assert.match(await text('[data-qa="acc-board"]'), /仅估算/);
    await shot('06-账号页-价格和档位-1440');
    await T(`Q.account.closeAccount();return true`);
    ok('账号页：余额、充值、站点实扣明细、价格板（仅估算）、档位，不露分组倍率');

    // ── 4. 档位请求头：课堂 AI / 后台请求 ──
    const lastScope = () => s.st.sent.filter((x) => x.path === '/v1/chat/completions').at(-1)?.scope;
    await call('ai.chat', { messages: [{ role: 'user', content: '讲题' }], feature: 'AI 讲题' });
    assert.equal(lastScope(), 'B', '课堂 AI 默认均衡');
    await call('ai.chat', { messages: [{ role: 'user', content: '总结' }], feature: '课后总结' });
    assert.equal(lastScope(), 'B', '后台默认均衡');
    await call('ai.setTier', { use: 'background', tier: 'quality' });
    await call('ai.chat', { messages: [{ role: 'user', content: '总结' }], feature: '录像分析' });
    assert.equal(lastScope(), 'tier=A', '后台改成质量优先');
    await call('ai.setTier', { use: 'background', tier: 'save' });
    await call('ai.chat', { messages: [{ role: 'user', content: '总结' }], feature: '课后总结' });
    assert.equal(lastScope(), '', '省钱优先不带');
    await call('ai.setTier', { use: 'background', tier: 'balanced' });
    const ver = 'classroom/' + require('../package.json').version;
    const model = s.st.log.filter((l) => l.path.startsWith('/v1/'));
    assert.ok(model.length >= 5 && model.every((l) => l.client === ver), '发到站点的模型请求（模型列表、聊天、/responses 测试）全都带 X-Omni-Client');
    ok('软件自己发的请求按用途带档位头（课堂 AI、后台自动），省钱优先不带；所有模型请求都带来源头');

    // ── 5. 收费闸：课件插图先报价确认 ──
    const img = call('ai.image', { prompt: '电梯里的体重秤', feature: '课件插图', model: 'gpt-image-2' });
    await until(() => has('[data-qa="quote-confirm"]'), 8000, '报价确认');
    assert.match(await text('[data-qa="quote-confirm"]'), /这次生成 ¥0\.12（1 张）/);
    await shot('07-画图前报价确认-1440');
    await click('[data-qa="quote-yes"]');
    const r = await img;
    assert.match(r.image, /^data:image\//); assert.equal(r.cny, 0.12);
    assert.match(s.st.sent.filter((x) => x.path === '/v1/images/generations').at(-1).quote, /^q1\./);
    assert.equal(s.st.sent.filter((x) => x.path === '/v1/images/generations').at(-1).scope, '', '图片接口不带档位');
    assert.equal(s.st.log.filter((l) => l.path === '/v1/images/generations').at(-1).client, 'classroom/' + require('../package.json').version, '画图也带来源头');
    // 不同意：不提交
    const n0 = s.st.sent.length;
    const img2 = call('ai.image', { prompt: '再来一张', feature: '课件插图', model: 'gpt-image-2' }).then(() => 'ok', (e) => e.message);
    await until(() => has('[data-qa="quote-confirm"]'), 8000);
    await click('[data-qa="quote-no"]');
    assert.match(await img2, /没有扣费/);
    assert.equal(s.st.sent.length, n0, '没同意就不提交');
    ok('玲珑账号画图先报价确认；同意才提交并带报价；不同意不提交不扣费');

    // ── 6. AI 工坊：新任务模型旁的档位、任务里换档、Codex 每轮带头 ──
    await T(`Q.useStore.getState().set({page:'agents',aiOpen:false});return true`);
    await until(() => has('[data-qa="tier-chip-new"]'), 10000, '工坊档位');
    assert.match(await text('[data-qa="tier-chip-new"]'), /质量优先/, '工坊默认质量优先');
    assert.equal(await overlap('[data-qa="tier-chip-new"]', '.ags-model-row .mp-trigger'), false, '档位和模型选择不叠');
    await shot('08-AI工坊-新任务-模型旁的档位-1440');
    const t = await call('agents.start', { engine: 'codex', title: '超重失重 · 互动课件', prompt: '做一个课件', useStudioKey: true, permission: 'full', cap: 5 });
    assert.equal(t.tier, 'quality');
    const argsOf = () => fs.readFileSync(path.join(t.work, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).join(' '));
    await until(async () => (await call('agents.get', t.id)).status !== 'running', 20000, '任务一轮');
    assert.match(argsOf().at(-1), /http_headers=\{ "X-Omni-Client" = "classroom\/[\d.]+", "X-Route-Scope" = "tier=A" \}/, '工坊 Codex 带来源头和档位头');
    await call('agents.configure', { id: t.id, tier: 'balanced' });
    await call('agents.inject', { id: t.id, text: '不对' });
    await until(async () => (await call('agents.get', t.id)).status !== 'running', 20000);
    assert.match(argsOf().at(-1), /"X-Route-Scope" = "B"/, '换档下一轮生效');
    await call('agents.inject', { id: t.id, text: '还是错了，重做' });
    await until(async () => (await call('agents.get', t.id)).status !== 'running', 20000);
    const t2 = await call('agents.get', t.id);
    assert.equal(t2.suggest?.why, '你连着两次说做得不对');
    const ct = await call('agents.start', { engine: 'claude', title: 'Claude 任务', prompt: '做一个讲义', useStudioKey: true, permission: 'full', cap: 5 });
    assert.equal(ct.tier, 'quality');
    await until(async () => (await call('agents.get', ct.id)).status !== 'running', 20000);
    const env = api.agents.env(api.agents.tasks.get(ct.id));
    assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, `X-Omni-Client: classroom/${require('../package.json').version}
X-Route-Scope: tier=A`, '工坊 Claude Code 带来源头和档位头');
    await until(() => T(`const b=[...document.querySelectorAll('.ags-item')].find(x=>x.innerText.includes('超重失重'));b&&b.click();return !!b`), 8000, '任务列表');
    await until(() => has('[data-qa="ags-suggest"]'), 8000, '工坊提醒');
    await until(() => has('[data-qa="tier-chip-task"]'), 8000, '任务里的档位');
    await shot('09-AI工坊-任务里换档和变笨提醒-1440');
    await click('[data-qa="ags-suggest"] button');
    await until(async () => (await call('agents.get', t.id)).tier === 'quality', 8000);
    await until(async () => (await call('agents.get', t.id)).status !== 'running', 20000);
    assert.match(argsOf().at(-1), /tier=A/, '点「切到质量优先再做一遍」：下一轮用质量优先');
    ok('AI 工坊：新任务默认质量优先；Codex 每轮带档位头、换档下一轮生效；Claude Code 用自定义请求头；连着说不对时提醒一次，点了就用质量优先重做');

    // ── 7. 小羽：输入框旁的档位，换档后接回原会话；变笨提醒 ──
    await T(`Q.useStore.getState().set({page:'console'});await Q.assistant.openAssistant();return true`);
    await until(() => has('[data-qa="tier-chip-chat"]'), 10000, '小羽档位');
    await T(`await Q.assistant.send('你好');return true`);
    await until(() => T(`const c=Q.assistant.useAssistant.getState().chats.find(x=>x.id===Q.assistant.useAssistant.getState().chat?.id);return c&&!c.running`), 15000);
    await T(`await Q.account.setTier('chat','quality');return true`);
    await T(`await Q.assistant.send('不对');return true`);
    await until(() => T(`const c=Q.assistant.useAssistant.getState().chats.find(x=>x.id===Q.assistant.useAssistant.getState().chat?.id);return c&&!c.running`), 15000);
    const argv = fs.readFileSync(process.env.FAKE_ARGV, 'utf8').trim().split('\n').map((l) => JSON.parse(l).argv.join(' '));
    assert.match(argv[0], /"X-Route-Scope" = "B"/); assert.match(argv.at(-1), /"X-Route-Scope" = "tier=A"/);
    await T(`await Q.account.setTier('chat','balanced');return true`);
    await T(`await Q.assistant.send('还是错了，重做');return true`);
    await until(() => has('[data-qa="as-suggest"]'), 15000, '小羽提醒');
    await shot('10-小羽-输入框旁档位和变笨提醒-1440', '.as-drawer');
    ok('小羽：输入框旁换档，下一句重启内核带新档位；连着说不对时回复下面提醒');

    // ── 8. AI 设置：账号入口和三个用途的档位 ──
    await T(`Q.assistant.closeAssistant?.();Q.useStore.getState().set({aiOpen:true});await new Promise(r=>setTimeout(r,300));dispatchEvent(new Event('cs-ai-settings'));return true`);
    await until(() => has('[data-qa="ai-tiers"]'), 8000, 'AI 设置档位');
    assert.match(await text('[data-qa="ai-acc"]'), /已登录玲珑账号/);
    await shot('11-AI设置-账号和档位-1440', '.ai-dock');
    // 课堂 AI（问一问）：输入框旁也有档位；用的是偏弱的模型时，卡片下面提醒切到质量优先
    assert.equal(await has('.ai-compose [data-qa="tier-chip-chat"]'), true);
    await call('ai.setConfig', { model: 'gpt-6.1-sol' });
    await fill('.ai-compose textarea', '斜面上的物块受几个力？');
    await T(`const e=document.querySelector('.ai-compose textarea');e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true`);
    await until(() => has('[data-qa="ai-suggest"]'), 15000, '课堂 AI 提醒');
    await shot('11b-课堂AI-偏弱模型时提醒质量优先-1440', '[data-qa="ai-suggest"]');
    await call('ai.setConfig', { model: 'gpt-6-astra' });
    await T(`Q.useStore.getState().set({page:'agents'});return true`);
    ok('AI 设置里有账号入口和全局默认档位；课堂 AI 输入框旁能换档，偏弱模型时提醒');

    // ── 9. 余额不足：报错给「去充值」，点了打开账号页 ──
    const me = s.st.users.get('teacher'); const keep = me.quota; me.quota = 0;
    const err = await call('ai.chat', { messages: [{ role: 'user', content: 'x' }], feature: '课后总结' }).then(() => '', (e) => e.message);
    assert.match(err, /余额/);
    me.quota = keep;
    // 工坊任务报余额不足：日志上方给「去充值」，点了打开软件里的账号页
    await T(`Q.useStore.getState().set({page:'agents',aiOpen:false});return true`);
    await until(() => T(`const b=[...document.querySelectorAll('.ags-item')].find(x=>x.innerText.includes('超重失重'));b&&b.click();return !!b`), 8000, '任务列表');
    const tk = api.agents.tasks.get(t.id);
    api.agents.push(tk, { kind: 'error', text: '账户余额或额度不足，请到站点充值（服务返回：余额不足）' }); api.agents.setStatus(tk, 'failed', '余额不足');
    await until(() => T(`const b=[...document.querySelectorAll('.ai-trouble button')].find(x=>x.innerText==='去充值');return !!b`), 8000, '去充值按钮');
    await shot('16-余额不足-去充值按钮-1440', '.ai-trouble');
    await T(`[...document.querySelectorAll('.ai-trouble button')].find(x=>x.innerText==='去充值').click();return true`);
    await until(() => has('[data-qa="account-page"]'), 5000, '去充值打开账号页');
    await T(`Q.account.closeAccount();return true`);
    ok('余额不足：报错里给「去充值」，登录了账号就直接打开软件里的账号页');

    // ── 10. 1920×1080 ──
    size(1920, 1080); await sleep(500);
    await T(`Q.account.openAccount('signin');return true`);
    await until(() => has('[data-qa="account-gate"]'), 5000);
    await shot('12-登录页-1920');
    await T(`Q.account.closeAccount();Q.account.openAccount();return true`);
    await until(() => has('[data-qa="account-page"]'), 5000);
    await shot('13-账号页-1920');
    await T(`Q.account.closeAccount();Q.useStore.getState().set({page:'agents',aiOpen:false});return true`);
    await T(`document.querySelector('.ags-new')?.click();return true`);
    await sleep(500);
    await shot('14-AI工坊-1920');
    size(1440, 900); await sleep(400);
    // 顶栏账号按钮不和别的按钮叠在一起
    const tb = await T(`const bs=[...document.querySelectorAll('.tb > *')].filter(e=>e.offsetWidth).map(e=>{const r=e.getBoundingClientRect();return [e.className,r.left,r.right]});return bs`);
    for (let i = 1; i < tb.length; i++) assert.ok(tb[i][1] >= tb[i - 1][2] - 1, `顶栏 ${tb[i - 1][0]} 和 ${tb[i][0]} 叠在一起了`);
    await shot('15-顶栏-账号按钮-1440', '.tb');
    ok('1920×1080 界面截图；顶栏账号按钮不挤压别的按钮');

    // ── 11. 第三方 Key：不显示档位、请求不带头 ──
    const third = await site.start(); // 地址用 localhost，不在银子 API 系站点里
    await call('ai.setConfig', { baseUrl: third.url.replace('127.0.0.1', 'localhost') + '/v1', key: 'sk-own-third-1' });
    await T(`window.dispatchEvent(new Event('cs-ai-config'));return true`);
    await until(() => T(`return Q.account.useAccount.getState().tiers?.applies===false`), 5000);
    await call('ai.chat', { messages: [{ role: 'user', content: 'x' }], feature: 'AI 讲题' });
    assert.equal(third.st.sent.at(-1).scope, '', '第三方 Key 不带档位头');
    assert.ok(third.st.log.every((l) => !l.client), '第三方 Key 一个请求都不带 X-Omni-Client');
    assert.equal(await has('[data-qa="tier-chip-new"]'), false, '第三方 Key 不显示档位');
    await third.close();
    ok('手填的第三方 Key：不显示档位，请求不带档位头');

    // ── 12. 退出登录：账号的 Key 拿掉，登录前自己配的放回来 ──
    await call('ai.setConfig', { baseUrl: other.url + '/v1', key: 'sk-own-teacher-key-1' });
    await call('account.login', { site: 'linglong', username: 'teacher', password: 'pass-1234' });
    assert.equal((await call('ai.getConfig')).account.kind, 'linglong');
    await call('account.signOut');
    const back = await call('ai.getConfig');
    assert.equal(back.account, null); assert.equal(back.baseUrl, other.url + '/v1'); assert.equal(back.keyHint, 'ey-1', '登录前自己配的 Key 放回来了');
    ok('退出登录：账号的 Key 拿掉，登录前老师自己配的连接放回来');

    // ── 13. 合作站账号登录 ──
    await call('account.login', { site: 'yinzi', username: 'plain', password: 'pass-1234' });
    const pv = await call('account.view');
    assert.equal(pv.kind, 'partner'); assert.equal(pv.ai.account.name, '银子API');
    await call('account.signOut');
    ok('合作站账号登录也能自动接好');

    console.log('RESULT pass ' + results.length);
    clearTimeout(timer);
    await s.close(); await other.close();
    app.exit(0);
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    try { await shot('FAIL-现场'); } catch { /* */ }
    app.exit(1);
  }
})();
