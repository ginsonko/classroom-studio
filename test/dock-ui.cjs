// 教师浮层 + 学生工具条的桌面验收（真实 Electron 窗口，窗口全透明且不接收鼠标，不打扰正在使用电脑的人）。
// 运行：node_modules\electron\dist\electron.exe test/dock-ui.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(__dirname, '../.out/A/dock-ui-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
// 老版本存档：学生工具是 locked，升级后应迁移为开放
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, drawAuthor: 'student', studentTools: 'locked' }, local: { roots: [], students: [], slots: [], learning: {} } }));
const { app, BrowserWindow } = require('electron'); const results = [], errors = [];
// 测试窗口不抢前台焦点（使用这台电脑的人可能正在上课）
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') errors.push(e.level + ': ' + String(e.message).slice(0, 600)); }); });
app.on('browser-window-created', (_e, w) => { try { w.setOpacity(0); w.setIgnoreMouseEvents(true); } catch { /* 部分窗口创建早期不可设置 */ } });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await Promise.resolve().then(fn).catch(() => false); if (v) return v; await sleep(80); } throw Error('Timed out: ' + fn); };
const mark = (name, d = {}) => { results.push({ name, ok: true, ...d }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('dock-ui timed out'); app.exit(1); }, 160000);
(async () => {
  const api = await until(async () => globalThis.classroomStudioTest);
  const teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA')); await until(() => call(student, '!!window.__studioQA'));
  const T = (expr) => call(teacher, `__studioQA.useStore.getState().${expr}`);

  assert.equal(await T('studentTools'), 'open'); mark('old locked workspace migrates to student tools open');
  assert.equal(await T('drawAuthor'), 'teacher'); mark('pen starts with the teacher even if the last session ended with the student holding it');
  // 0.9.1：工具和老师一样多，默认收起成小圆钮；点一下展开
  await until(() => call(student, `!!document.querySelector('.sbar .sbar-fab')&&!document.querySelector('.sbar .sbar-panel')`));
  await call(student, `document.querySelector('.sbar-fab').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:3,button:0,buttons:1,clientX:10,clientY:10}));document.querySelector('.sbar-fab').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3,button:0,buttons:0,clientX:10,clientY:10}));true`);
  await until(() => call(student, `!!document.querySelector('.sbar .sbar-panel')`));
  mark('student bar starts collapsed and opens with one click');

  // 学生点工具 → 接过笔
  await call(student, `document.querySelector('.sbar .tp-b[aria-label^="钢笔"]').click(); true`);
  await until(async () => (await T('drawAuthor')) === 'student');
  assert.ok(await call(student, `document.querySelector('.sbar').classList.contains('s-writing')`));
  mark('one click on a student tool hands the pen to the student');

  // 收起 / 展开 与拖动位置（PointerEvent 直接派发到圆钮）
  const fab = (type, x, y) => `document.querySelector('.sbar-fab').dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerId:7,button:0,buttons:${type === 'pointerup' ? 0 : 1},clientX:${x},clientY:${y}}))`;
  const r0 = await call(student, `JSON.stringify(document.querySelector('.sbar-fab').getBoundingClientRect())`).then(JSON.parse);
  const cx = r0.x + r0.width / 2, cy = r0.y + r0.height / 2;
  await call(student, `${fab('pointerdown', cx, cy)};${fab('pointerup', cx, cy)};true`); await sleep(120);
  assert.equal(await call(student, `!!document.querySelector('.sbar-panel')`), false);
  await call(student, `${fab('pointerdown', cx, cy)};${fab('pointerup', cx, cy)};true`); await sleep(120);
  assert.equal(await call(student, `!!document.querySelector('.sbar-panel')`), true);
  mark('fab click collapses and expands the bar');
  const W = await call(student, 'innerWidth');
  await call(student, `${fab('pointerdown', cx, cy)};${fab('pointermove', cx + 40, cy - 30)};${fab('pointermove', W - 60, 120)};${fab('pointerup', W - 60, 120)};true`); await sleep(150);
  const moved = await call(student, `({cls:document.querySelector('.sbar').className,open:!!document.querySelector('.sbar-panel'),pos:localStorage.getItem('cs.sbar.pos'),r:document.querySelector('.sbar-fab').getBoundingClientRect().toJSON()})`);
  assert.ok(moved.open, 'drag must not toggle'); assert.ok(moved.cls.includes('to-left')); assert.ok(moved.pos); assert.ok(Math.abs(moved.r.x + moved.r.width / 2 - (W - 60)) < 4);
  student.webContents.reload(); await until(() => call(student, `!!document.querySelector('.sbar-fab')`).catch(() => false));
  const after = await call(student, `document.querySelector('.sbar-fab').getBoundingClientRect().toJSON()`);
  assert.ok(Math.abs(after.x + after.width / 2 - (W - 60)) < 4);
  mark('fab drags, flips the bar to the left near the right edge, remembers its place after reload', { pos: moved.pos });

  // 教师浮层
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock')`).catch(() => false));
  const shapes = []; const orig = api.dock.message;
  api.dock.message = (m) => { if (m?.type === 'shape') shapes.push(m.rects); return orig(m); };
  await until(() => call(dock, `!!document.querySelector('.tdock-reclaim')`));
  mark('dock shows "student is writing · take back" while the student holds the pen');

  await call(dock, `document.querySelector('[aria-label="物理器材库"]').click(); true`);
  await until(() => call(dock, `!!document.querySelector('.obj-pop')`));
  await sleep(400);
  const geo = await call(dock, `({w:innerWidth,h:innerHeight,pop:document.querySelector('.obj-pop').getBoundingClientRect().toJSON()})`);
  const last = shapes.at(-1);
  assert.ok(last && last.length === 1 && last[0].x === 0 && last[0].y === 0 && Math.round(last[0].width) === geo.w && Math.round(last[0].height) === geo.h, 'shape must cover the whole window while a popover is open: ' + JSON.stringify(last));
  assert.ok(geo.pop.left >= 0 && geo.pop.top >= 0 && geo.pop.right <= geo.w && geo.pop.bottom <= geo.h, 'popover inside window ' + JSON.stringify(geo));
  mark('object library popover is fully inside the dock window and the window shape exposes it', geo);
  await call(dock, `document.querySelector('.obj-pop .obj-tile').click(); true`);
  await until(() => call(dock, `!document.querySelector('.obj-pop')`));
  await until(async () => shapes.at(-1)?.[0]?.width < geo.w / 2, 3000).catch(() => {});
  const closed = shapes.at(-1);
  assert.ok(closed.length >= 1 && closed[0].width < geo.w / 2, 'shape shrinks back to the rail: ' + JSON.stringify(closed));
  mark('picking an object closes the popover and the click-through shape returns to the rail');

  // 学科包：数学学生的浮层不显示物理器材库，物理学生显示
  await call(teacher, `__studioQA.useStore.getState().set({ students: [{ id: 'm1', name: '小舟', grade: '高二', subject: 'math', hue: 260, textbook: '人教A版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }, { id: 'p1', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'm1' }); true`);
  await until(() => call(dock, `!document.querySelector('[aria-label="物理器材库"]')`));
  mark('dock hides the physics object library for a math student');
  await call(teacher, `__studioQA.useStore.getState().set({ studentId: 'p1' }); true`);
  await until(() => call(dock, `!!document.querySelector('[aria-label="物理器材库"]')`));
  mark('dock shows the physics object library again for a physics student');
  await call(teacher, `__studioQA.useStore.getState().set({ students: [], studentId: 'junyu' }); true`);
  await until(() => call(dock, `!!document.querySelector('[aria-label="物理器材库"]')`));

  await call(dock, `document.querySelector('.tdock .tp-g .tp-b').click(); true`);
  await until(async () => (await T('drawAuthor')) === 'teacher');
  assert.equal(await call(dock, `!!document.querySelector('.tdock-reclaim')`), false);
  mark('one click on a dock tool takes the pen back');

  // 弹出菜单（多工具组）一击打开
  const flyOk = await call(dock, `(async()=>{const g=[...document.querySelectorAll('.tdock .tp-g')].find(x=>x.querySelector('.tp-caret'));const b=g.querySelector('.tp-b');b.click();await new Promise(r=>setTimeout(r,50));if(!b.classList.contains('on'))b.click();await new Promise(r=>setTimeout(r,80));return !!document.querySelector('.tp-fly');})()`);
  assert.ok(flyOk); await sleep(250);
  const flyShape = shapes.at(-1); assert.ok(flyShape[0].width === geo.w || Math.round(flyShape[0].width) === geo.w);
  await call(dock, `document.querySelector('.tp-fly .tp-fi').click(); true`); await until(() => call(dock, '!document.querySelector(".tp-fly")'));
  mark('tool group flyout opens, is exposed by the shape, and closes on pick');

  // 放大
  const z0 = await call(dock, `document.querySelector('.tdock').getBoundingClientRect().height`);
  await call(dock, `document.querySelector('.tdock-zoom').click(); true`); await sleep(200);
  const z1 = await call(dock, `document.querySelector('.tdock').getBoundingClientRect().height`);
  assert.ok(z1 > z0 * 1.12, `zoom ${z0} -> ${z1}`);
  const bounds = dock.getBounds(); assert.ok(bounds.height >= z1, 'dock window grows with the rail');
  await call(dock, `document.querySelector('.tdock-zoom').click(); document.querySelector('.tdock-zoom').click(); true`);
  mark('dock size button enlarges the rail and the window follows', { z0, z1 });

  // 真实输入事件（经 Chromium 输入管线，不动系统鼠标）：学生接笔 → 浮层「收回」
  const realClick = async (w, x, y) => {
    x = Math.round(x); y = Math.round(y);
    w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  };
  const inside = (r, s) => s.some((q) => r.left >= q.x - 0.5 && r.top >= q.y - 0.5 && r.right <= q.x + q.width + 0.5 && r.bottom <= q.y + q.height + 0.5);
  const sb = await call(student, `document.querySelector('.sbar .tp-b[aria-label^="钢笔"]').getBoundingClientRect().toJSON()`);
  await realClick(student, sb.x + sb.width / 2, sb.y + sb.height / 2);
  await until(async () => (await T('drawAuthor')) === 'student');
  await until(() => call(dock, `!!document.querySelector('.tdock-reclaim')`));
  await sleep(300);
  const rc = await call(dock, `(()=>{const b=document.querySelector('.tdock-reclaim');return {btn:b.getBoundingClientRect().toJSON(),parts:[...b.querySelectorAll('*')].map(e=>e.getBoundingClientRect().toJSON()),rail:document.querySelector('.tdock').getBoundingClientRect().toJSON(),over:b.scrollWidth-b.clientWidth}})()`);
  await until(async () => inside(rc.btn, shapes.at(-1) ?? []), 3000).catch(() => {});
  assert.ok(rc.over <= 0, 'reclaim label must not overflow its button: ' + rc.over);
  for (const r of [rc.btn, ...rc.parts]) { assert.ok(r.right <= rc.rail.right + 0.5 && r.left >= rc.rail.left - 0.5, 'reclaim part outside rail ' + JSON.stringify(r)); assert.ok(inside(r, shapes.at(-1)), 'reclaim part outside clickable shape ' + JSON.stringify(r)); }
  mark('the whole take-back button sits inside the rail and the clickable window shape');

  // 悬停提示：放在浮层旁边，完整可见（在窗口内、也在窗口形状内）
  dock.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rc.btn.x + rc.btn.width / 2), y: Math.round(rc.btn.y + rc.btn.height / 2) });
  await until(() => call(dock, `!!document.querySelector('.tip')`), 6000);
  await sleep(300);
  const tip = await call(dock, `({r:document.querySelector('.tip').getBoundingClientRect().toJSON(),w:innerWidth,h:innerHeight})`);
  await until(async () => inside(tip.r, shapes.at(-1) ?? []), 3000).catch(() => {});
  assert.ok(tip.r.left >= rc.rail.right && tip.r.right <= tip.w && tip.r.top >= 0 && tip.r.bottom <= tip.h, 'tooltip beside the rail and inside the window ' + JSON.stringify(tip));
  assert.ok(inside(tip.r, shapes.at(-1)), 'tooltip inside the window shape ' + JSON.stringify({ tip: tip.r, shape: shapes.at(-1) }));
  await fs.promises.writeFile(path.join(out, 'dock-reclaim.png'), (await dock.webContents.capturePage()).toPNG());
  mark('dock tooltip opens beside the rail and is fully visible', tip.r);

  const target = rc.parts.at(-1); // 「点我收回」
  await realClick(dock, target.x + target.width - 3, target.y + target.height / 2);
  await until(async () => (await T('drawAuthor')) === 'teacher');
  await until(async () => (await call(student, `__studioQA.useStore.getState().drawAuthor`)) === 'teacher');
  await until(() => call(dock, `!document.querySelector('.tdock-reclaim')`));
  await until(() => call(dock, `!document.querySelector('.tip')`), 3000);
  mark('a real click near the right edge of "take back" returns the pen to the teacher everywhere');

  // 老师端顶栏也能收回（浮层被隐藏时的兜底）
  await realClick(student, sb.x + sb.width / 2, sb.y + sb.height / 2);
  await until(async () => (await T('drawAuthor')) === 'student');
  await until(() => call(teacher, `!!document.querySelector('.tb-pen')`));
  await call(teacher, `document.querySelector('.tb-pen').click(); true`);
  await until(async () => (await call(student, `__studioQA.useStore.getState().drawAuthor`)) === 'teacher');
  mark('teacher console top bar shows the pen holder and takes the pen back');

  // 锁定后学生点工具无效
  await call(teacher, `__studioQA.useStore.getState().setShared({studentTools:'locked'});true`);
  await until(() => call(student, `document.querySelector('.sbar').classList.contains('s-locked')`));
  await call(student, `document.querySelector('.sbar .tp-b[aria-label^="钢笔"]')?.click(); __studioQA.useStore.getState().setShared({drawAuthor:'student'}); true`);
  await sleep(300); assert.equal(await T('drawAuthor'), 'teacher');
  mark('locked student tools cannot take the pen');

  // 老师在学生窗口画图形：教师端要记下笔迹和撤销记录（存档里的撤销记录来自 contextBridge，曾因不可扩展而抛错）
  await call(teacher, `__studioQA.useStore.getState().setShared({studentTools:'open',drawAuthor:'teacher'});true`);
  await until(async () => (await call(student, `__studioQA.useStore.getState().drawAuthor`)) === 'teacher');
  const key = await T(`pgm.materialId+'#'+__studioQA.useStore.getState().pgm.page`);
  const rectId = 'rect-' + Date.now();
  await call(student, `__studioQA.useStore.getState().addStroke(${JSON.stringify(key)},{id:'${rectId}',author:'teacher',layer:'public',tool:'rect',color:'red',size:3,pts:[0.2,0.2,0.5,0.4,0.4,0.5]});true`);
  await until(async () => (await T(`ink[${JSON.stringify(key)}]?.some(s=>s.id==='${rectId}')`)));
  await call(dock, `document.querySelector('.tdock .tdock-row .tp-b').click(); true`); // 浮层「撤销」
  await until(async () => !(await call(student, `__studioQA.useStore.getState().ink[${JSON.stringify(key)}]?.some(s=>s.id==='${rectId}')`)));
  assert.ok(!errors.some((e) => /not extensible/.test(e)), errors.join('\n'));
  mark('a shape drawn in the student window is recorded by the teacher console and the dock can undo it');

  // 浮层页面崩溃 / 卡死：自动重建，重建后一击可用
  student.showInactive(); api.dock.sync(); await sleep(300);
  const rebuilt = async (oldId, ms) => until(() => { const w = api.windows.get('dock'); return w && !w.isDestroyed() && w.webContents.id !== oldId && call(w, `!!document.querySelector('.tdock')`).catch(() => false); }, ms);
  const id0 = api.windows.get('dock').webContents.id;
  api.windows.get('dock').webContents.forcefullyCrashRenderer();
  await rebuilt(id0, 15000);
  const d1 = api.windows.get('dock');
  await call(d1, `document.querySelector('.tdock .tp-b[aria-label^="钢笔"]').click(); true`);
  await until(async () => (await T('tool')) === 'pen');
  mark('a crashed dock page is rebuilt automatically and works again');
  const id1 = d1.webContents.id;
  void d1.webContents.executeJavaScript('for(;;){}').catch(() => {});
  await rebuilt(id1, 20000);
  mark('a hung dock page is detected by the heartbeat and rebuilt');
  const logText = fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'logs', 'app.log'), 'utf8');
  assert.ok(/浮层页面退出/.test(logText) && /浮层没有响应/.test(logText) && /浮层 点击/.test(logText), 'diagnostic log records dock crash, hang and clicks');
  mark('diagnostic log records dock crashes, hangs and clicks');

  await fs.promises.writeFile(path.join(out, 'student.png'), (await student.webContents.capturePage()).toPNG());
  await fs.promises.writeFile(path.join(out, 'dock.png'), (await api.windows.get('dock').webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, errors }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: e.stack, results, errors }, null, 2)); console.error(e); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
