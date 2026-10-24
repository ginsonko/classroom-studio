// 聚光灯 / 幕布能不能取消（老师反馈：打开以后找不到关的地方，撤销、清屏都没用）：
//   1. 存档里带着上一节课的聚光灯 / 幕布，启动后不恢复（否则重启后学生画面还是一片黑，又找不到关的地方）；
//   2. 打开聚光灯：学生画面和老师监视器都盖上，浮层多出一个「聚光灯」按钮，点一下两边都恢复；
//   3. 幕布：往下拖是揭开，拖到最下面整个收起，浮层上也有「幕布」按钮；
//   4. Esc 一次把聚光灯和幕布都关掉。
// 用法：npm run build 后 npx electron test/quiet.cjs test/overlay-off-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'overlay-off-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
// 存档里故意留着上一节课的聚光灯和幕布
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', drawAuthor: 'teacher', tool: 'pen', curtain: 0.4, spotlight: { x: .5, y: .5, r: .16 }, revealed: ['some-deck#3'] },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {}, libraryOpen: true, rightOpen: true, libraryW: 420, page: 'console' },
}));
const electron = require('electron'); const { app } = electron; const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('overlay off desktop timed out'); app.exit(1); }, 180000);
const results = [];
const ok = (name, cond, detail) => { assert.ok(cond, name + ' ' + (detail ?? '')); results.push(name); console.log('PASS', name, detail ?? ''); };

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await call(teacher, `window.csHost.call('student')`);
  const student = await until(() => api.windows.get('student'), 15000, 'student window');
  await until(() => call(student, '!!window.__studioQA'), 15000, 'student ready');
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1400, height: 880 }); student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock')`), 10000, 'dock');
  // 老师在学生窗口上书写：笔迹层盖住取景框，黑板是 16:9，所以纵向比例直接就是页面比例
  for (const w of [teacher, student]) await call(w, `HTMLElement.prototype.setPointerCapture=function(){};HTMLElement.prototype.releasePointerCapture=function(){};HTMLElement.prototype.hasPointerCapture=function(){return false};true`);
  await until(() => call(student, `document.querySelectorAll('[data-cur-stage] .ink-c').length===2`), 10000, 'student stage');

  const state = (w) => call(w, `(()=>{const s=__studioQA.useStore.getState();return {spotlight:!!s.spotlight,curtain:s.curtain,tool:s.tool}})()`);
  const has = (w, sel) => call(w, `!!document.querySelector(${JSON.stringify(sel)})`);
  const setTool = (t) => call(teacher, `__studioQA.useStore.getState().setShared({tool:${JSON.stringify(t)}});true`);
  /** 在学生窗口的笔迹层上按下再抬起；fy 是画面高度的比例（聚光灯落点、幕布揭开到哪儿） */
  const press = (fy) => call(student, `(()=>{const c=document.querySelectorAll('[data-cur-stage] .ink-c')[1],r=c.getBoundingClientRect();
    const x=r.left+r.width*.5,y=r.top+r.height*${fy};
    const ev=(t,b)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,button:t==='pointermove'?-1:0,buttons:b,pressure:.5}));
    ev('pointerdown',1);ev('pointerup',0);return true})()`);
  const dockBtn = () => call(dock, `(()=>{const b=document.querySelector('.tdock-overlay button');return b?b.innerText.trim():null})()`);
  const shot = async (w, name, wait = 350) => { await sleep(wait); w.webContents.invalidate(); await sleep(200); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };

  // ── 1. 存档里的遮挡不恢复 ──
  const boot = await state(teacher);
  ok('启动后不恢复存档里的聚光灯 / 幕布', !boot.spotlight && boot.curtain === null, JSON.stringify(boot));
  ok('启动后不恢复上一节课揭晓过的答案页', (await call(teacher, `__studioQA.useStore.getState().revealed.length`)) === 0);
  ok('启动后学生画面和老师监视器都没有遮挡', !(await has(student, '.spotlight')) && !(await has(student, '.curtain')) && !(await has(teacher, '.spotlight')) && !(await has(teacher, '.curtain')));
  ok('没开遮挡时浮层上没有多余的按钮', !(await has(dock, '.tdock-overlay')));

  // ── 2. 聚光灯：浮层上一个按钮就能关掉 ──
  await setTool('spotlight');
  await press(.35);
  const on = await until(async () => { const s = await state(teacher); return s.spotlight ? s : null; }, 5000, 'spotlight on');
  ok('聚光灯打开，学生画面和老师监视器都盖上', await has(student, '.spotlight') && await has(teacher, '.spotlight'), JSON.stringify(on.spotlight));
  const b1 = await until(() => dockBtn(), 5000, 'dock overlay button');
  ok('浮层上出现「聚光灯」按钮', b1 === '聚光灯', String(b1));
  await shot(dock, 'overlay-1-spotlight-dock.png'); await shot(student, 'overlay-2-spotlight-student.png');
  await call(dock, `document.querySelector('.tdock-overlay button').click();true`);
  await until(async () => !(await state(teacher)).spotlight, 5000, 'spotlight off');
  ok('点一下关掉：两个画面都恢复', !(await has(student, '.spotlight')) && !(await has(teacher, '.spotlight')) && !(await has(dock, '.tdock-overlay')));

  // ── 3. 幕布：往下拖是揭开，拖到底收起 ──
  await setTool('curtain');
  await press(.4);
  const cur = await until(async () => { const s = await state(teacher); return s.curtain !== null ? s : null; }, 5000, 'curtain on');
  ok('幕布盖住下方 60%', Math.abs(cur.curtain - .4) < .02 && await has(student, '.curtain') && await has(teacher, '.curtain'), String(cur.curtain));
  ok('浮层上出现「幕布」按钮', (await dockBtn()) === '幕布');
  await shot(dock, 'overlay-3-curtain-dock.png'); await shot(student, 'overlay-4-curtain-student.png');
  await press(.99);
  await until(async () => (await state(teacher)).curtain === null, 5000, 'curtain dragged away');
  ok('拖到最下面整个收起', !(await has(student, '.curtain')) && !(await has(teacher, '.curtain')) && !(await has(dock, '.tdock-overlay')));

  // 再开一次，用浮层按钮收起
  await press(.5);
  await until(async () => (await state(teacher)).curtain !== null, 5000, 'curtain on again');
  await call(dock, `document.querySelector('.tdock-overlay button').click();true`);
  await until(async () => (await state(teacher)).curtain === null, 5000, 'curtain closed by button');
  ok('浮层按钮也能收起幕布', !(await has(student, '.curtain')) && !(await has(dock, '.tdock-overlay')));

  // ── 4. Esc 一次关掉两个 ──
  await setTool('spotlight');
  await press(.3);
  await call(teacher, `__studioQA.useStore.getState().setShared({curtain:.5});true`);
  await until(async () => { const s = await state(teacher); return s.spotlight && s.curtain !== null; }, 5000, 'both on');
  ok('聚光灯和幕布可以同时开着', await has(student, '.spotlight') && await has(student, '.curtain'));
  // Esc 由画布上的快捷键处理：先让画布拿到焦点（老师点过画面之后就是这样）
  await call(student, `(()=>{const el=document.querySelector('[data-cur-stage] .ink');el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()`);
  await until(async () => { const s = await state(teacher); return !s.spotlight && s.curtain === null; }, 5000, 'escape cleared');
  ok('Esc 把两个都关掉，学生那边同步恢复', !(await has(student, '.spotlight')) && !(await has(student, '.curtain')) && !(await has(dock, '.tdock-overlay')));

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'error.txt'), String(e.stack || e)); clearTimeout(timer); app.exit(1); });
