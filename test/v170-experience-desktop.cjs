// 1.7.0 E 体验改进离屏桌面测试（不联网、不花钱、不动真实鼠标键盘）：
//   1. 「这次更新了什么」弹窗排在 AccountGate 登录遮罩之后（绝不叠弹），跳过/登录后自动弹一次，「去看看」跳转并记住已读；
//   2. 「帮助 → 关于与更新 → 查看本次更新内容」随时重开；
//   3. AI 设置与各处报错条上的「帮我查查」零消耗免费自检（5 项状态 + 操作按钮）；
//   4. 磁盘 <5 GB 顶栏提醒（启动按天去重 + 每次录课前提醒）；
//   5. 1440×900 下小羽浮球自动避让右侧学生卡「收题」按钮；上课彩排第一步「登录或配置 AI」登录后自动打勾；
//   6. AI 工坊默认强模型 gpt-6-astra，任务卡片与详情头部清晰显示模型名与档位名；
//   7. 内置说明书新增「玲珑账号」「档位切换」两章并更新「AI 工坊」「一键导入 AI」。
// 用法：CS_DIST=.out/dist-me [CS_SHOT_OUT=<截图目录>] npx electron test/quiet.cjs test/v170-experience-desktop.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const out = process.env.CS_SHOT_OUT || path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out'), 'v170-experience');
fs.mkdirSync(out, { recursive: true });
const dataRoot = fs.mkdtempSync(path.join(path.resolve(process.env.CS_TEST_OUT || path.join(__dirname, '../.out')), 'exp-data-'));
process.env.CS_TEST = '1';
process.env.CS_DATA_DIR = dataRoot;
process.env.CS_TIER_HOSTS = '127.0.0.1';
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-dual.cjs');
process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');

fs.mkdirSync(path.join(dataRoot, 'study'), { recursive: true });
fs.writeFileSync(path.join(dataRoot, 'study', 'study.json'), JSON.stringify({ questions: [], attempts: [], homework: [], notes: [], portraits: {}, sorts: [], lessons: [], preps: [], files: [] }));
fs.writeFileSync(path.join(dataRoot, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false, autoMap: false, transcribe: false },
  local: {
    roots: [],
    students: [{ id: 'stu-a', name: '莫莫', grade: '高一', hue: 190, textbook: '人教版 2019', tags: ['受力分析'], lessons: 3, lastTopic: '牛顿第二定律', lastAt: '2026-11-15', subject: 'physics' }],
    studentId: 'stu-a',
    slots: [],
    learning: {},
  },
}));

const electron = require('electron');
const { app } = electron;
const site = require('./fake-site-account.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => {
  const t = Date.now(); let last;
  while (Date.now() - t < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(120);
  }
  throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : ''));
};
const timer = setTimeout(() => { console.error('v170 experience desktop timed out'); app.exit(1); }, 300000);
const errors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); });
  wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason));
});
const results = [];
const ok = (name) => { results.push(name); console.log('ok - ' + name); };

(async () => {
  const s = await site.start();
  const sites = [
    { id: 'linglong', name: '玲珑账号', origin: s.url, app: true },
    { id: 'yinzi', name: '银子API', origin: s.url, loginOnly: true },
    { id: 'changfeng', name: '长风API', origin: s.url, loginOnly: true },
    { id: 'fuyao', name: '扶摇API', origin: s.url, loginOnly: true },
    { id: 'qingyun', name: '青云API', origin: s.url, loginOnly: true },
  ];
  process.env.CS_ACCOUNT_SITES = JSON.stringify(sites);
  require('../electron/main.cjs');

  const api = await until(() => globalThis.classroomStudioTest, 30000, 'app');
  const teacher = api.windows.get('teacher');
  const student = api.windows.get('student');
  const T = async (code) => {
    const r = await teacher.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`);
    if (r && r.__err) throw Error('page: ' + r.__err);
    return r;
  };
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'), 30000, 'QA');
  const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  teacher.showInactive();
  student.showInactive();

  const shot = async (name) => {
    await sleep(400);
    teacher.webContents.invalidate();
    await sleep(250);
    const img = await teacher.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    console.log('SHOT ' + name);
  };
  const has = (sel) => T(`return !!document.querySelector(${JSON.stringify(sel)})`);
  const text = (sel) => T(`return document.querySelector(${JSON.stringify(sel)})?.innerText||''`);
  const click = (sel) => T(`const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('没有 '+${JSON.stringify(sel)});e.click();return true`);
  const fill = (sel, v) => T(`const e=document.querySelector(${JSON.stringify(sel)});const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;set.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const call = (m, v) => T(`return await Q.host.call(${JSON.stringify(m)},${JSON.stringify(v ?? null)})`);

  try {
    await until(() => T(`return Q.account.useAccount.getState().checked`), 15000, '账号状态初始化');

    // ── 1. 1440×900 下小羽浮球自动避让右侧学生卡「收题」按钮 ──
    await T(`localStorage.removeItem('cs.assistant.pos');Q.useStore.getState().set({page:'console',rightOpen:true,aiOpen:false,studentId:'stu-a'});return true`);
    await sleep(800);
    const dodgeInfo = await until(() => T(`
      const me=document.querySelector('.as-float .as-me');
      const cap=[...document.querySelectorAll('.scard-ans button')].find(b=>b.innerText.includes('收题'));
      if(!me||!cap)return null;
      const a=me.getBoundingClientRect(), b=cap.getBoundingClientRect();
      if(!a.width||!b.width)return null;
      const hit=!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
      const anyHit=[...document.querySelectorAll('.scard-ans button')].some(el=>{
        const r=el.getBoundingClientRect();
        return r.width>0&&!(a.right<=r.left||r.right<=a.left||a.bottom<=r.top||r.bottom<=a.top);
      });
      return !hit&&!anyHit?{me:[Math.round(a.left),Math.round(a.top),Math.round(a.width),Math.round(a.height)],cap:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]}:null;
    `), 6000, '小羽避让收题按钮');
    assert.ok(dodgeInfo, '小羽浮球不压收题按钮');
    ok('1440×900 下小羽浮球自动避让右侧学生卡「收题」等作答按钮');

    // ── 2. 「这次更新了什么」排在 AccountGate 之后，不叠两层弹窗；点「去看看」跳转并记住已读 ──
    await T(`await Q.account.checkGate(true);Q.experience.enableWhatsNewAuto();return true`);
    await until(() => has('[data-qa="account-gate"]'), 5000, '启动登录遮罩层');
    await sleep(400);
    assert.equal(await has('[data-qa="whats-new"]'), false, 'AccountGate 显示期间绝不叠弹更新卡');
    await click('[data-qa="opt-skip"]');
    await until(async () => !(await has('[data-qa="account-gate"]')), 4000, '跳过登录页');
    await until(() => has('[data-qa="whats-new"]'), 5000, '关闭登录页后自动弹出更新卡');
    const wnItems = await T(`return [...document.querySelectorAll('[data-qa="whats-new"] ol li')].length`);
    assert.ok(wnItems >= 6 && wnItems <= 7, '列出 6～7 条核心亮点，实际 ' + wnItems);
    assert.match(await text('[data-qa="whats-new"]'), /学生窗口[\s\S]*家长版长图[\s\S]*玲珑账号[\s\S]*真题[\s\S]*KaTeX[\s\S]*内置浏览器[\s\S]*帮我查查/);
    // 收起底层 AI 抽屉让背景导播台干净整洁，截第 1 张交付图
    await T(`Q.useStore.getState().set({aiOpen:false});return true`);
    await shot('01-这次更新了什么卡片');

    await click('[data-qa="wn-go-3"]');
    await until(async () => !(await has('[data-qa="whats-new"]')), 3000, '点击去看看关闭卡片');
    assert.equal(await T(`return Q.useStore.getState().page`), 'agents', '跳转到 AI 工坊');
    const wnState = await call('whatsNew.state');
    assert.equal(wnState.seen, '1.7.0', '已记录 seenWhatsNewVersion');
    assert.equal(await T(`return await Q.experience.checkWhatsNew(true)`), false, '已读后不再重复自动弹出');
    ok('「这次更新了什么」排在 AccountGate 之后弹出一次，「去看看」关闭并跳转对应页面');

    // ── 3. 帮助 / 关于面板随时重开「这次更新了什么」 ──
    await click('.rail-b[aria-label="帮助"]');
    await until(() => has('.help'), 4000, '打开帮助');
    await T(`const b=[...document.querySelectorAll('.help-tabs button')].find(x=>x.innerText.includes('关于与更新'));b.click();return true`);
    await until(() => has('[data-qa="help-whatsnew"]'), 4000, '关于页查看本次更新内容按钮');
    await click('[data-qa="help-whatsnew"]');
    await until(() => has('[data-qa="whats-new"]'), 4000, '帮助里重开更新卡');
    assert.equal(await has('.help'), false, '重开更新卡时自动收起帮助弹窗');
    await click('[data-qa="wn-go-0"]');
    await until(async () => !(await has('[data-qa="whats-new"]')), 3000);
    assert.equal(await T(`return Q.useStore.getState().page`), 'schedule', '第 1 条去看看跳转到课表');
    ok('「帮助 → 关于与更新 → 查看本次更新内容」随时可重开更新卡并正常跳转');

    // ── 4. 上课彩排第一步「登录或配置 AI」：未配时等待，登录玲珑账号后自动打勾 ──
    await T(`Q.useStore.getState().set({page:'console'});localStorage.removeItem('cs.guide');localStorage.removeItem('cs.guide.snap');Q.guide.useGuide.setState({status:{}});Q.guide.startGuide('quick');return true`);
    await until(() => has('.guide-coach'), 5000, '彩排引导卡');
    assert.match(await text('.guide-coach h3'), /登录或配置 AI/);
    await sleep(500);
    assert.equal(await T(`return Q.guide.useGuide.getState().phase`), 'step', '未登录未配 Key 时停在第一步');

    // 打开登录页并登录玲珑账号
    await T(`Q.account.openAccount('signin');return true`);
    await until(() => has('[data-qa="acc-user"]'), 5000, '登录输入框');
    await fill('[data-qa="acc-user"]', 'teacher');
    await fill('[data-qa="acc-pass"]', 'pass-1234');
    await click('[data-qa="acc-login"]');
    await until(() => has('[data-qa="acc-start"]'), 20000, '玲珑账号登录完成');
    await click('[data-qa="acc-start"]');
    await until(() => T(`const g=Q.guide.useGuide.getState();return g.status.ai==='done'||g.phase==='cheer'`), 6000, '登录后第一步自动打勾');
    await T(`Q.guide.exitGuide();return true`);
    await until(() => T(`return !Q.guide.useGuide.getState().active`), 4000, '退出彩排');
    ok('上课彩排第一步改为「登录或配置 AI」，登录玲珑账号后自动判定完成打勾');

    // ── 5. 「帮我查查」免费自检（AI 设置入口 + 报错条入口 + 5 项分支 + 零模型消耗） ──
    await T(`Q.useToast.setState({list:[]});Q.useStore.getState().set({page:'console',aiOpen:true});await new Promise(r=>setTimeout(r,200));dispatchEvent(new Event('cs-ai-settings'));return true`);
    await until(() => has('.ai-cfg-b [data-qa="self-check-btn"]'), 5000, 'AI 设置里的帮我查查按钮');
    // 构造「余额偏低（¥0.80 < ¥2）+ 工坊沙箱未预热」场景，验证 5 项清晰展示和操作按钮，且零真实模型调用
    const me = s.st.users.get('teacher');
    const keepQuota = me.quota;
    me.quota = Math.round(0.8 * 500000);
    const sentBefore = s.st.sent.filter((x) => x.model).length;
    await click('.ai-cfg-b [data-qa="self-check-btn"]');
    await until(() => has('[data-qa="sc-account"]'), 10000, '自检结果渲染');
    for (const id of ['account', 'network', 'balance', 'tier', 'warmup']) {
      assert.equal(await has(`[data-qa="sc-${id}"]`), true, '自检项存在：' + id);
    }
    assert.equal(await T(`return document.querySelector('[data-qa="sc-account"]').dataset.level`), 'ok');
    assert.equal(await T(`return document.querySelector('[data-qa="sc-network"]').dataset.level`), 'ok');
    assert.match(await text('[data-qa="sc-network"]'), /模型列表 200[\s\S]*聊天接口可用[\s\S]*\/v1\/responses 可用/);
    assert.equal(await T(`return document.querySelector('[data-qa="sc-balance"]').dataset.level`), 'warn');
    assert.equal(await has('[data-qa="sc-act-topup"]'), true, '余额不足给去充值按钮');
    assert.equal(s.st.sent.filter((x) => x.model).length, sentBefore, '免费自检零模型调用消耗');
    await shot('02-帮我查查免费自检');

    // 点「去充值」直接跳到账号页
    await click('[data-qa="sc-act-topup"]');
    await until(() => has('[data-qa="account-page"]'), 5000, '跳到账号充值页');
    await T(`Q.account.closeAccount();return true`);
    me.quota = keepQuota;

    // 恢复充足余额 + 沙箱标记就绪 → 再查一次 5 项全绿
    const readyMarker = path.join(api.codexHome.dir, '.cs-sandbox-ready.json');
    fs.mkdirSync(api.codexHome.dir, { recursive: true });
    fs.writeFileSync(readyMarker, JSON.stringify({ ok: true, sandbox: 'elevated', version: 'test' }));
    api.codexHome.state = { phase: 'ready', ready: true, pct: 100, step: '已就绪', error: '' };
    await T(`Q.experience.openSelfCheck();return true`);
    await until(() => T(`const r=Q.experience.useSelfCheck.getState().report;return r&&r.ok===true`), 10000, '自检全部正常');
    await T(`Q.experience.useSelfCheck.getState().open&&document.querySelector('[data-qa="self-check"] .pri')?.click();Q.useStore.getState().set({aiOpen:false});return true`);
    await until(async () => !(await has('[data-qa="self-check"]')), 3000);
    ok('「帮我查查」免费自检逐项展示 5 项诊断状态与一键处理按钮，全程零模型消耗');

    // ── 6. 磁盘快满提前提醒（启动按天去重 + 每次录课前提醒） ──
    process.env.CS_FAKE_FREE_GB = '3.6';
    const d1 = await call('disk.status');
    assert.ok(d1 && /只剩 3\.6 GB/.test(d1.message), '低于 5 GB 返回提醒');
    await T(`await Q.host.call('disk.status');return true`);
    await until(() => has('[data-qa="disk-low"]'), 5000, '顶栏弹出磁盘不足提醒');
    assert.match(await text('[data-qa="disk-low"]'), /只剩 3\.6 GB，建议及时清理或换盘，免得录课半路中断/);
    assert.match(await text('[data-qa="disk-dismiss"]'), /今天不再提醒/);
    await shot('03-磁盘快满顶栏提醒');

    await click('[data-qa="disk-dismiss"]');
    await until(async () => !(await has('[data-qa="disk-low"]')), 3000, '关闭启动提醒');
    assert.equal(await call('disk.status'), null, '同一天内启动检查不再重复弹');

    // 开始录课前：即使当天点过「今天不再提醒」，录课前依然会提醒
    await call('startLesson', { synthetic: true, studentId: 'stu-a', title: '磁盘提醒测试课' });
    await until(() => has('[data-qa="disk-low"]'), 8000, '录课前再次弹出磁盘提醒');
    assert.equal(await text('[data-qa="disk-dismiss"]'), '知道了', '录课前提醒按钮为知道了');
    await click('[data-qa="disk-dismiss"]');
    await until(() => api.recording.status.phase === 'recording', 10000, '录课正常进行未被打断');
    await sleep(1200);
    await call('stopLesson');
    await until(() => !['starting', 'recording', 'stopping'].includes(api.recording.status.phase), 20000, '录课结束');
    delete process.env.CS_FAKE_FREE_GB;
    ok('磁盘 <5 GB 顶栏提醒：启动按天去重，每次开始录课前自动检查提醒且不打断讲课');

    // ── 7. 工坊默认推荐强模型 gpt-6-astra，任务卡片与详情头部清晰显示模型名与档位名 ──
    await call('ai.setConfig', { model: 'gpt-6.1-sol' });
    await T(`localStorage.setItem('cs.agent.model.codex','');localStorage.removeItem('cs.agent.model');Q.useStore.getState().set({page:'agents',aiOpen:false});return true`);
    await until(() => has('.ags-model-row .mp-trigger'), 6000, '工坊新任务页');
    assert.match(await text('.ags-model-row .mp-trigger'), /gpt-6-astra/, '模型未选时默认提示推荐强模型 gpt-6-astra');
    const task = await call('agents.start', {
      engine: 'codex', title: '超重与失重 · 练习题', prompt: '出一套超重与失重练习', useStudioKey: true, model: '', permission: 'full', cap: 5,
    });
    assert.equal(task.modelName, 'gpt-6-astra', 'AI 设置是 6.1-sol 时工坊仍默认选用强模型 gpt-6-astra');
    assert.equal(task.tierName, '质量优先');
    await until(async () => (await call('agents.get', task.id)).status !== 'running', 20000, '工坊任务跑完');
    const doneTask = await call('agents.get', task.id);
    const taskArgs = fs.readFileSync(path.join(task.work, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).join(' ')).join('\n');
    assert.match(taskArgs, /model="gpt-6-astra"/, 'CLI 实际收到 gpt-6-astra');
    await T(`const b=[...document.querySelectorAll('.ags-item')].find(x=>x.innerText.includes('超重与失重 · 练习题'));if(b)b.click();return !!b`);
    await until(() => has('[data-qa="detail-model"]'), 6000, '任务详情模型名');
    assert.ok(doneTask.modelName, '模型名非空');
    assert.match(await text('[data-qa="task-model"]'), new RegExp(doneTask.modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · 质量优先'));
    assert.equal(await text('[data-qa="detail-model"]'), doneTask.modelName);
    // 报错条也有「帮我查查」按钮
    const rawTask = api.agents.tasks.get(task.id);
    api.agents.push(rawTask, { kind: 'error', text: 'AI 服务暂时出错（503）' });
    api.agents.setStatus(rawTask, 'failed', '运行出错');
    await until(() => has('.ags-log [data-qa="self-check-btn"]'), 5000, '工坊报错条带帮我查查按钮');
    await call('ai.setConfig', { model: 'gpt-6-astra' });
    ok('AI 工坊未手选模型时默认用强模型 gpt-6-astra，任务卡片与详情头部清晰显示模型名和档位名，报错条带「帮我查查」');

    // ── 8. 内置说明书：新增「玲珑账号」「档位切换」两章，改写「AI 工坊」「一键导入 AI」 ──
    await click('.rail-b[aria-label="帮助"]');
    await until(() => has('.help-nav'), 5000, '打开说明书');
    const navText = await text('.help-nav');
    assert.match(navText, /玲珑账号/);
    assert.match(navText, /档位切换/);
    assert.match(navText, /一键导入 AI/);
    assert.match(navText, /AI 工坊：备课/);
    const bodyText = await text('.help-body');
    assert.match(bodyText, /联网查真题与原卷出处核对[\s\S]*\.cs-kit[\s\S]*内置浏览器与离屏截图自检[\s\S]*独立运行环境预热/);
    await T(`const b=[...document.querySelectorAll('.help-nav button')].find(x=>x.innerText.includes('玲珑账号'));b.scrollIntoView({block:'center'});b.click();return true`);
    await sleep(500);
    await shot('04-内置说明书新章节');
    await click('.help-x');
    ok('内置说明书新增「玲珑账号」「档位切换」两章，并同步改写「AI 工坊」与「一键导入 AI」');

    const bad = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning|favicon/i.test(e));
    assert.deepEqual(bad.filter((e) => /renderer-gone|Uncaught/i.test(e)), [], bad.join('\n'));
    console.log(`\nPASS ${results.length}/${results.length} v170-experience-desktop`);
    clearTimeout(timer);
    await s.close();
    for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy();
    app.exit(0);
  } catch (e) {
    console.error('FAIL', e);
    clearTimeout(timer);
    try { await s.close(); } catch { /* ignore */ }
    app.exit(1);
  }
})();
