// 1.5.1 微信分段桌面验收（屏幕外窗口）：
//   1. 设置里「自动切成每段不到 1 小时」默认不勾，能勾上、存住
//   2. 回放页：超过 59 分钟的回放有「切成微信分段」，点了切好显示段数、能打开文件夹，提示条说切了几段
//   3. 勾上以后：回放生成完自动切
// 为了快，用 3 分钟的小视频，把每段上限缩到 60 秒（CS_PART_LIMITS）
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v151-split-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v151-split-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); process.env.CS_PART_LIMITS = JSON.stringify({ max: 60, limit: 70 });
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false },
  local: { roots: [], students: [stu('stu-a', '张三')], studentId: 'stu-a', slots: [], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const { runProcess } = require('../electron/recording.cjs');
const FFMPEG = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(120); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v151 split desktop timed out'); app.exit(1); }, 300000);

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

  // ── 1. 设置 ──
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="split-wechat"]')`), 8000, '设置面板');
  assert.equal(await T(`return document.querySelector('[data-qa="split-wechat"]').checked`), false, '默认不勾');
  assert.equal((await T(`return Q.host.call('settings')`)).splitWeChat, false);
  await T(`document.querySelector('[data-qa="split-wechat"]').scrollIntoView({block:'center'});return true`);
  await shot('v151-1-settings.png');
  await T(`document.querySelector('[data-qa="split-wechat"]').click();return true`);
  await until(() => T(`return Q.host.call('settings').then(x=>x.splitWeChat===true)`), 5000, '勾上');
  await T(`document.querySelector('[data-qa="split-wechat"]').click();return true`);
  await until(() => T(`return Q.host.call('settings').then(x=>x.splitWeChat===false)`), 5000, '取消');
  await T(`Q.useRecording.setState({panel:false});return true`);
  mark('setting: auto split for WeChat is off by default and persists');

  // ── 2. 回放页手动分段 ──
  const recDir = api.recording.directory;
  const makeRec = async (id, title, { seconds = 180, minutes = 70, webm = false } = {}) => {
    const folder = path.join(recDir, '2026-11-01-' + id); fs.mkdirSync(folder, { recursive: true });
    const codec = webm ? ['-c:v', 'libvpx', '-b:v', '200k', '-deadline', 'realtime', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac'];
    await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=10:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, ...codec, '-shortest', path.join(folder, webm ? 'capture.webm' : '课堂回放.mp4')], { timeout: 180000 });
    const now = Date.now();
    fs.writeFileSync(path.join(folder, 'recording.json'), JSON.stringify({ id, title, studentId: 'stu-a', createdAt: new Date(2026, 10, 1, 19).toISOString(), phase: webm ? 'recoverable' : 'complete', startedAt: now - minutes * 60000, endedAt: now, chapters: [], ...(webm ? { pending: true } : {}) }));
    return folder;
  };
  const f1 = await makeRec('rec-1', '追及相遇');
  await makeRec('rec-short', '短课', { minutes: 40 });
  await T(`Q.useStore.getState().set({page:'replay'});return true`);
  await until(() => T(`return document.querySelectorAll('.rp-row').length===2`), 8000, '回放列表');
  assert.equal(await T(`return document.querySelectorAll('[data-qa="rp-split"]').length`), 1, '只有超过 59 分钟的那段有分段按钮');
  await T(`document.querySelector('[data-qa="rp-split"]').click();return true`);
  const text = await until(() => T(`return document.querySelector('[data-qa="rp-parts"]:not(.busy)')?.innerText`), 60000, '切好');
  assert.match(text, /微信分段 3 段，每段约 1 分钟/);
  const parts = fs.readdirSync(path.join(f1, '微信分段')).sort();
  assert.deepEqual(parts, ['张三 11月1日 追及相遇 第1段（共3段）.mp4', '张三 11月1日 追及相遇 第2段（共3段）.mp4', '张三 11月1日 追及相遇 第3段（共3段）.mp4']);
  assert.ok((await toasts()).some((t) => /「追及相遇」已切成 3 段，每段不到 1 小时/.test(t)), JSON.stringify(await toasts()));
  assert.equal(await T(`return document.querySelectorAll('[data-qa="rp-split"]').length`), 0, '切好以后按钮收起');
  await shot('v151-2-replay-parts.png');
  mark('replay page: split long replay into parts, shows count and toast', { parts });

  // ── 3. 勾上以后自动切 ──
  await T(`await Q.host.call('setSettings',{splitWeChat:true});return true`);
  const f2 = await makeRec('rec-2', '自动分段课', { seconds: 100, webm: true });
  await api.recording.enqueue(f2, { id: 'rec-2', title: '自动分段课', studentId: 'stu-a' });
  const auto = fs.readdirSync(path.join(f2, '微信分段'));
  assert.equal(auto.length, 2, auto.join(','));
  await until(() => T(`return [...document.querySelectorAll('[data-qa="rp-parts"]')].some(e=>e.innerText.includes('微信分段 2 段'))`), 10000, '回放页刷新显示');
  assert.ok((await toasts()).some((t) => /「自动分段课」已切成 2 段/.test(t)));
  mark('setting on: replay is split automatically after it is generated');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); app.exit(0);
})().catch(async (e) => { console.error('FAIL', e.stack || e); if (errors.length) console.error('console: ' + errors.join(' | ')); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } clearTimeout(timer); app.exit(1); });
