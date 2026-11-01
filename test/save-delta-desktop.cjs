// 存盘只发改动的部分：写一笔、撤销、清空桌面再恢复之后，存档里每一页的笔迹和每一组撤销记录都要和教师窗口一致，
// 没改动的页面原样保留，被清掉的撤销记录不残留、恢复后又回来。
// 用法：npm run build 后 npx electron test/quiet.cjs test/save-delta-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'save-delta-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const pen = (id, y, layer = 'public') => ({ id, tool: 'pen', color: 'ink', size: 3, pts: [.1, y, .5, .2, y + .01, .5, .3, y, .5], author: 'teacher', layer });
const doc = { id: 'doc-a', kind: 'pdf', title: '讲义', pages: [{ w: 1000, h: 1400 }, { w: 1000, h: 1400 }], total: 2 };
const entry = (s, before) => ({ before: [], after: [s], beforeOrder: before, afterOrder: [...before, s.id] });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 },
    desk: [{ id: 'board', mat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, view: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, rect: [0, 0, 1, 1], mode: 'max', z: 0, at: 1 }],
    ink: { 'board#0': [pen('b1', .1), pen('b2', .2)], 'doc-a#0': [pen('d1', .1), pen('dp', .3, 'private')], 'doc-a#1': [pen('e1', .1)] }, studentTools: 'open' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
  history: { 'board#0|teacher': { undo: [entry(pen('b1', .1), []), entry(pen('b2', .2), ['b1'])], redo: [] }, 'doc-a#0|teacher': { undo: [entry(pen('d1', .1), [])], redo: [] } },
}));
const { app } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('save delta timed out'); app.exit(1); }, 120000);
const file = () => JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), 'utf8'));
const ids = (list) => (list ?? []).map((s) => s.id).sort().join(',');

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(`(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`).then((r) => { if (r && r.__err) throw Error(r.__err); return r; });
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const results = [];
  const ok = (name) => { results.push(name); console.log('PASS', name); };
  const flush = () => call(`await Q.flushStore();return true`);
  const inkNow = () => call(`return Q.useStore.getState().ink`);
  const sameInk = async (what) => { const t = await inkNow(), f = file().shared.ink; assert.deepEqual(Object.keys(f).sort(), Object.keys(t).sort(), what + '：页面名单'); for (const k of Object.keys(t)) assert.equal(ids(f[k]), ids(t[k]), what + '：' + k); };

  await call(`s.addStroke('board#0',{id:'b3',tool:'pen',color:'ink',size:3,pts:[.1,.3,.5,.2,.31,.5],author:'teacher',layer:'public'});return true`);
  await flush();
  await sameInk('写一笔之后');
  assert.equal(file().history['board#0|teacher'].undo.length, 3, '当前页撤销记录多一条');
  assert.equal(file().history['doc-a#0|teacher'].undo.length, 1, '没动过的页面撤销记录原样保留');
  assert.ok(file().shared.ink['doc-a#0'].some((x) => x.id === 'dp' && x.layer === 'private'), '没动过的页面私有笔迹还在');
  ok('写一笔：只发改动，其余原样保留');

  await call(`s.undo('board#0','teacher');return true`);
  await flush();
  await sameInk('撤销之后');
  assert.equal(file().history['board#0|teacher'].undo.length, 2); assert.equal(file().history['board#0|teacher'].redo.length, 1);
  ok('撤销：撤销 / 重做记录同步');

  await call(`s.addStroke('doc-a#1',{id:'e2',tool:'pen',color:'ink',size:3,pts:[.1,.5,.5,.2,.51,.5],author:'teacher',layer:'private'});return true`);
  await flush();
  await sameInk('另一页写私有笔迹之后');
  assert.ok(file().shared.ink['doc-a#1'].some((x) => x.id === 'e2'));
  ok('另一页的私有笔迹存下');

  const snapKeys = await call(`window.__snap=s.clearDesk();return Object.keys(window.__snap.history)`);
  assert.ok(snapKeys.includes('board#0|teacher'), '清空桌面拿走了黑板的撤销记录');
  await flush();
  assert.equal(file().history['board#0|teacher'], undefined, '清空后存档里不残留黑板的撤销记录');
  await sameInk('清空桌面之后');
  await call(`Q.useStore.getState().restoreDesk(window.__snap);return true`);
  await flush();
  assert.equal(file().history['board#0|teacher']?.undo.length, 2, '恢复后黑板的撤销记录回到存档里');
  await sameInk('恢复桌面之后');
  ok('清空桌面再恢复：撤销记录不残留、能回来');

  // 存档必须是合法、完整的 JSON（逐段拼起来的）
  const raw = fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), 'utf8');
  assert.equal(JSON.stringify(JSON.parse(raw)), raw, '存档 JSON 完整');
  ok('存档 JSON 完整');
  console.log('SAVE DELTA OK', results.length, out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('SAVE DELTA FAIL', e); app.exit(1); });
