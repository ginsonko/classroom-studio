// 学生窗口改大小以后，教师端「学生正在看」监视器会不会一直跳：
// 改几次学生窗口大小（含最大化 / 还原），停手后观察 4 秒：监视器里页面的位置 / 大小、浮层窗口的位置、教师端共享状态各变了几次。
// 停手以后都应该是 0（顶多刚停时的一两次）。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/monitor-jump.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'monitor-jump-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const MAT = process.env.CS_JUMP_MAT || 'board';
const doc = { id: 'doc1', kind: 'pdf', title: '讲义', pages: [{ w: 1240, h: 1754 }, { w: 1240, h: 1754 }], total: 2 };
const board = { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: board, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: { 'board#0': [{ id: 's1', tool: 'pen', color: 'ink', size: 3, pts: [.1, .1, .5, .5, .5, .5], author: 'teacher', layer: 'public' }] }, studentTools: 'open', tool: 'pen', color: 'ink', size: 3 },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));
const { app, screen } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('monitor jump timed out'); app.exit(1); }, 180000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA')); await until(() => call(student, '!!window.__studioQA'));
  const onScreen = process.env.CS_SHOW === '1';
  const d0 = screen.getPrimaryDisplay().workArea;
  const left = onScreen ? d0.x : Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left - (onScreen ? 0 : 2000), y: d0.y, width: 1440, height: 900 }); teacher.showInactive();
  student.setBounds({ x: process.env.CS_JUMP_X ? +process.env.CS_JUMP_X : left + (onScreen ? 200 : 0), y: process.env.CS_JUMP_Y ? +process.env.CS_JUMP_Y : d0.y + 40, width: 1280, height: 720 }); student.showInactive();
  if (MAT === 'doc') await call(teacher, `(()=>{const s=__studioQA.useStore.getState();s.setShared({pgmMat:${JSON.stringify(doc)},pgm:{materialId:'doc1',page:0,slide:0,fit:'page',zoom:1}});return true})()`);
  await sleep(2500);
  const dock = () => api.windows.get('dock') || [...require('electron').BaseWindow.getAllWindows()].find((w) => w.getTitle?.().includes('教师浮层'));

  // 教师端：每帧记监视器里页面的位置大小；共享状态每次变化记下变了哪些字段
  await call(teacher, `(()=>{const W=window,P=W.__jump={rects:0,last:'',keys:{},n:0,on:false};
    const tick=()=>{const el=document.querySelector('.mon.pgm .page');if(el&&P.on){const r=el.getBoundingClientRect();const k=[r.x,r.y,r.width,r.height].map(v=>Math.round(v)).join(',');if(k!==P.last){P.rects++;P.last=k;}P.seen=k}requestAnimationFrame(tick)};requestAnimationFrame(tick);
    let prev=__studioQA.useStore.getState();__studioQA.useStore.subscribe((s)=>{if(P.on){P.n++;for(const k of Object.keys(s))if(s[k]!==prev[k])P.keys[k]=(P.keys[k]||0)+1;}prev=s});return true})()`);
  await call(student, `(()=>{const W=window,P=W.__jump={rects:0,last:'',keys:{},n:0,on:false};
    const tick=()=>{const el=document.querySelector('.page');if(el&&P.on){const r=el.getBoundingClientRect();const k=[r.x,r.y,r.width,r.height].map(v=>Math.round(v)).join(',');if(k!==P.last){P.rects++;P.last=k;}P.seen=k}requestAnimationFrame(tick)};requestAnimationFrame(tick);
    let prev=__studioQA.useStore.getState();__studioQA.useStore.subscribe((s)=>{if(P.on){P.n++;for(const k of Object.keys(s))if(s[k]!==prev[k])P.keys[k]=(P.keys[k]||0)+1;}prev=s});return true})()`);

  const sizes = [[1600, 900], [1000, 760], [1400, 600], [900, 900], [1280, 800]];
  const results = [];
  for (const [w, h] of [...sizes, 'max', 'restore']) {
    if (w === 'max') student.maximize(); else if (w === 'restore') student.unmaximize();
    else for (let k = 0; k < 6; k++) { const b = student.getBounds(); student.setBounds({ x: b.x, y: b.y, width: Math.round(b.width + (w - b.width) * (k + 1) / 6), height: Math.round(b.height + (h - b.height) * (k + 1) / 6) }); await sleep(40); }
    await sleep(900);
    const dk = dock(); let dockMoves = 0, lastB = dk && JSON.stringify(dk.getBounds());
    for (const win of [teacher, student]) await call(win, 'Object.assign(window.__jump,{rects:0,last:"",keys:{},n:0,on:true}),true');
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) { await sleep(50); if (dk && !dk.isDestroyed()) { const b = JSON.stringify(dk.getBounds()); if (b !== lastB) { dockMoves++; lastB = b; } } }
    const T = await call(teacher, 'window.__jump.on=false,JSON.parse(JSON.stringify(window.__jump))');
    const S = await call(student, 'window.__jump.on=false,JSON.parse(JSON.stringify(window.__jump))');
    assert.ok(T.seen && S.seen, '监视器 / 学生窗口里没找到页面：' + JSON.stringify([T.seen, S.seen]));
    const r = { seen: [T.seen, S.seen], size: typeof w === 'string' ? w : w + 'x' + h, teacherMonitorMoves: Math.max(0, T.rects - 1), teacherStoreUpdates: T.n, teacherKeys: T.keys, studentPageMoves: Math.max(0, S.rects - 1), studentStoreUpdates: S.n, studentKeys: S.keys, dockMoves };
    results.push(r); console.log(JSON.stringify(r));
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => r.teacherMonitorMoves > 1 || r.studentPageMoves > 1 || r.dockMoves > 1 || r.teacherStoreUpdates > 3 || r.studentStoreUpdates > 3);
  try { assert.equal(bad.length, 0, '停手以后还在变：' + JSON.stringify(bad)); console.log('PASS monitor stays still after the student window is resized'); clearTimeout(timer); app.exit(0); }
  catch (e) { console.error('FAIL ' + e.message); clearTimeout(timer); app.exit(1); }
})().catch((e) => { console.error(e); app.exit(1); });
