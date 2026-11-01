// 1.6.0 录像自动开关桌面验收（屏幕外窗口，假时钟，合成录像）：
//   1. 设置：按课表自动录课的几项默认值，改了能存住
//   2. 到点前 2 分钟出倒计时卡片；「这节不录」取消
//   3. 倒计时完自动开始：换到课表上的学生、录像标题用课名
//   4. 连堂：下一位学生到点，先存这一节再开下一节
//   5. 下课后 13 分钟出自动下课卡片，「再录 15 分钟」往后推；「现在下课」保存
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v160-autorecord-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v160-autorec-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); process.env.CS_SYNTHETIC_RECORD = '1';
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
// 2026-10-21 是周三（day 2）
const slots = [
  { id: 's-early', studentId: 'stu-b', day: 2, start: 18, len: 0.5, topic: '早课', repeat: true },
  { id: 's-a', studentId: 'stu-a', day: 2, start: 19, len: 1.5, topic: '追及相遇', repeat: true },
  { id: 's-b', studentId: 'stu-b', day: 2, start: 20.5, len: 1, topic: '牛顿第二定律', repeat: true },
];
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false, autoMap: false },
  local: { roots: [], students: [stu('stu-a', '小王'), stu('stu-b', '小李')], studentId: 'free', slots, learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(120); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v160 autorecord desktop timed out'); app.exit(1); }, 300000);
const at = (h, m = 0, s = 0) => new Date(2026, 9, 21, h, m, s).getTime();

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = async (code) => { try { return await teacher.webContents.executeJavaScript(code); } catch (e) { throw Error('executeJavaScript 失败：' + e.message + '\n' + String(code).slice(0, 240)); } };
  await until(() => call('!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(`(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  await T(`window.__toasts=[];Q.useToast.subscribe(st=>{for(const t of st.list)if(!window.__toasts.includes(t.message))window.__toasts.push(t.message)});return true`);
  const toasts = () => T(`return window.__toasts`);
  // 假时钟：页面里每秒照常跑一次，时间由测试拨
  await T(`window.__fakeNow=${at(17, 50)};Q.autoRecord.setClock(()=>window.__fakeNow);return true`);
  const setNow = async (t) => { await T(`window.__fakeNow=${t};Q.autoRecord.tick();return true`); };
  const card = () => T(`const c=document.querySelector('[data-qa="autorec-card"]');return c?{kind:c.dataset.kind,text:c.innerText}:null`);
  const phase = () => api.recording.status.phase;
  const click = (qa) => T(`document.querySelector('[data-qa="${qa}"]').click();return true`);

  // ── 1. 设置 ──
  const s0 = await T(`return (await Q.host.call('settings')).autoRec`);
  assert.deepEqual(s0, { start: true, lead: 5, stopAfter: 15, idle: true, idleMinutes: 20, adhoc: false, sound: false });
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="autorec-settings"]')`), 8000, '设置面板');
  assert.equal(await T(`return document.querySelector('[data-qa="autorec-start"]').checked`), true);
  assert.equal(await T(`return document.querySelector('[data-qa="autorec-stop-after"]').value`), '15');
  await T(`document.querySelector('[data-qa="autorec-settings"]').scrollIntoView({block:'start'});return true`);
  await shot('v160-1-settings.png');
  await T(`const el=document.querySelector('[data-qa="autorec-stop-after"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(el,'30');el.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await until(() => T(`return Q.host.call('settings').then(x=>x.autoRec.stopAfter===30)`), 5000, '改成 30 分钟');
  assert.equal(await T(`return Q.autoRecord.useAutoRecord.getState().settings.stopAfter`), 30, '改了马上生效');
  await T(`const el=document.querySelector('[data-qa="autorec-stop-after"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(el,'custom');el.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="autorec-stop-custom"]')`), 3000, '自定义输入框');
  await T(`const el=document.querySelector('[data-qa="autorec-stop-custom"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'25');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true`);
  await until(() => T(`return Q.host.call('settings').then(x=>x.autoRec.stopAfter===25)`), 5000, '自定义 25 分钟');
  await T(`await Q.host.call('setSettings',{autoRec:{stopAfter:15,lead:2}});Q.autoRecord.setAutoRecordSettings((await Q.host.call('settings')).autoRec);Q.useRecording.setState({panel:false});return true`);
  mark('settings: auto record defaults, preset and custom stop delay persist and apply at once');

  // ── 2. 倒计时卡片 + 这节不录 ──
  await setNow(at(17, 57, 59)); assert.equal(await card(), null);
  await setNow(at(17, 58));
  const c1 = await until(card, 3000, '倒计时卡片');
  assert.equal(c1.kind, 'start'); assert.match(c1.text, /10 秒后开始为「小李 · 早课」录像/);
  await shot('v160-2-countdown.png');
  await click('autorec-skip');
  await until(async () => (await card()) === null, 3000, '卡片收起');
  await setNow(at(18, 10)); await sleep(1500);
  assert.equal(await card(), null, '这节不再提示'); assert.equal(phase(), 'idle');
  assert.ok((await toasts()).some((t) => /「小李」这节不自动录了/.test(t)));
  mark('countdown card two minutes before class; skip cancels this lesson');

  // ── 3. 自动开始：换学生、用课名 ──
  await setNow(at(18, 58));
  await until(async () => (await card())?.kind === 'start', 3000, '小王的倒计时');
  await setNow(at(18, 58, 10));
  await until(() => phase() === 'recording', 15000, '开始录');
  assert.equal(api.recording.status.studentId, 'stu-a');
  assert.equal(api.recording.current.title, '追及相遇');
  assert.equal(await T(`return Q.useStore.getState().studentId`), 'stu-a', '顶栏换成小王');
  const firstId = api.recording.current.id;
  await until(async () => (await toasts()).some((t) => /已开始为「小王」录像/.test(t)), 3000, '提示开始');
  await sleep(3000); // 让合成录像写进几块
  mark('countdown finishes: switches to the scheduled student and records with the lesson topic');

  // ── 4. 连堂 ──
  await setNow(at(20, 29, 59)); assert.equal(await card(), null);
  await setNow(at(20, 30));
  const c2 = await until(card, 3000, '连堂卡片');
  assert.equal(c2.kind, 'next'); assert.match(c2.text, /连堂：10 秒后保存这一节，开始录「小李 · 牛顿第二定律」/);
  await shot('v160-3-next.png');
  await setNow(at(20, 30, 10));
  await until(() => phase() === 'recording' && api.recording.current?.id !== firstId, 30000, '下一节开始录');
  assert.equal(api.recording.status.studentId, 'stu-b');
  assert.equal(api.recording.current.title, '牛顿第二定律');
  await sleep(3000);
  const rows = await until(async () => { const r = await api.recording.list(); return r.length >= 2 && r; }, 10000, '两段录像');
  assert.ok(rows.some((r) => r.id === firstId && r.studentId === 'stu-a'), '上一节已保存');
  mark('back-to-back lessons: saves the current one and starts the next student');

  // ── 5. 自动下课：再录 15 分钟、现在下课 ──
  await setNow(at(21, 42, 59)); assert.equal(await card(), null);
  await setNow(at(21, 43));
  const c3 = await until(card, 3000, '自动下课卡片');
  assert.equal(c3.kind, 'stop'); assert.match(c3.text, /2:00后自动下课并保存录像/); assert.match(c3.text, /21:30 就下课了/);
  await shot('v160-4-stop.png');
  await click('autorec-extend');
  await until(async () => (await card()) === null, 3000);
  await setNow(at(21, 45, 30)); await sleep(1200);
  assert.equal(phase(), 'recording', '往后推了，没下课');
  await setNow(at(21, 58));
  await until(async () => (await card())?.kind === 'stop', 3000, '推后再提醒');
  await click('autorec-stop');
  await until(() => !['starting', 'recording', 'stopping'].includes(phase()), 20000, '下课');
  await setNow(at(22, 1)); await sleep(1500);
  assert.equal(await card(), null); assert.ok(!['starting', 'recording'].includes(phase()), '下课以后不会又开起来');
  mark('auto stop warning: extend pushes it back 15 minutes; stop now saves');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); app.exit(0);
})().catch(async (e) => { console.error('FAIL', e.stack || e); if (errors.length) console.error('console: ' + errors.join(' | ')); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } clearTimeout(timer); app.exit(1); });
