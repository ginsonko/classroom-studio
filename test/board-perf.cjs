// 黑板书写性能基准：在一块已经写了很多笔的黑板（学生窗口，老师通过浮层在这里写字）上模拟连续书写，
// 量每帧画布耗时、帧间隔、输入到上屏的延迟，以及停笔后自动存盘时主进程卡住多久（笔的输入要先经过主进程）。
// 用法：npm run build 后 npx electron test/quiet.cjs test/board-perf.cjs
//   CS_PERF_STROKES=600 已有笔数   CS_PERF_SKIN=wheat|chalk   CS_PERF_SOFT=1 关闭硬件加速（模拟显卡被拉黑的电脑）
//   CS_PERF_DPR=1.5 强制缩放比例   CS_PERF_HISTORY=1 预置大份撤销记录（约 20 MB 的存档）   CS_TEST_OUT 输出目录
const fs = require('node:fs'); const path = require('node:path');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'board-perf-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const { app, screen } = require('electron');
if (process.env.CS_PERF_SOFT === '1') app.disableHardwareAcceleration();
if (process.env.CS_PERF_DPR) app.commandLine.appendSwitch('force-device-scale-factor', process.env.CS_PERF_DPR);

// ── 造一份像真实课堂的存档 ─────────────────────────────
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const N = Number(process.env.CS_PERF_STROKES || 600), PTS = 48;
const pen = (id, x, y) => { const pts = []; let a = rnd() * 6; for (let i = 0; i < PTS; i++) { a += (rnd() - .5) * .9; pts.push(+(x + Math.cos(a) * .012 + i * .0006).toFixed(5), +(y + Math.sin(a) * .012).toFixed(5), +(.35 + rnd() * .4).toFixed(3)); } return { id, tool: 'pen', color: 'ink', size: 3, pts, author: 'teacher', layer: 'public' }; };
const page = (prefix, n) => Array.from({ length: n }, (_, i) => pen(prefix + i, .04 + (i % 30) * .031, .04 + Math.floor(i / 30) * .028 % .5));
const board = page('s', N);
const ink = { 'board#0': board };
const history = {};
if (process.env.CS_PERF_HISTORY === '1') {
  for (let p = 0; p < 40; p++) {
    const strokes = page('k' + p + '-', 50); ink['doc' + p + '#0'] = strokes;
    history['doc' + p + '#0|teacher'] = { undo: strokes.slice(0, 50).map((s, i) => ({ before: [], after: [s], beforeOrder: strokes.slice(0, i).map((x) => x.id), afterOrder: strokes.slice(0, i + 1).map((x) => x.id) })), redo: [] };
  }
  history['board#0|teacher'] = { undo: board.slice(-120).map((s, i) => ({ before: [], after: [s], beforeOrder: board.slice(0, N - 120 + i).map((x) => x.id), afterOrder: board.slice(0, N - 119 + i).map((x) => x.id) })), redo: [] };
}
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink, boardSkin: process.env.CS_PERF_SKIN || 'wheat', pattern: 'grid', studentTools: 'open', tool: 'pen', color: 'ink', size: 3 },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} }, history,
}));
const wsBytes = fs.statSync(path.join(process.env.CS_DATA_DIR, 'workspace.json')).size;

require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('board perf timed out'); app.exit(1); }, 300000);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(1); };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), max: +Math.max(0, ...a).toFixed(1) });

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(student, '!!window.__studioQA'));
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left - 2000, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  student.setBounds({ x: left, y: 30, width: 1600, height: 900 }); student.showInactive();
  for (let i = 0, last = -1, same = 0; i < 48 && same < 6; i++) { await sleep(250); const w = await call(student, 'innerWidth'); same = w === last ? same + 1 : 0; last = w; }
  const S = async (code) => { const r = await call(student, `(async()=>{try{${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error(r.__err); return r; };
  const box = await until(() => S(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height,dpr:devicePixelRatio,canvas:[...new Set([...document.querySelectorAll('.ink-c')].filter(x=>x.width>300).map(x=>x.width+'x'+x.height))]}:null`), 15000, 'student canvas');
  const strokes0 = await S(`return (__studioQA.useStore.getState().ink['board#0']||[]).length`);
  // 页面里：记录每帧所有 rAF 回调的总耗时（画布的 JS 部分）、帧间隔、每个指针事件到它之后第一帧画完的时间
  await S(`const W=window, raf=W.requestAnimationFrame.bind(W); const P=W.__perf={frames:[],gaps:[],lat:[],pending:[],cur:null,lastT:0};
    W.requestAnimationFrame=(cb)=>raf((t)=>{ if(P.cur!==t){ if(P.cur!==null) P.frames.push(P.sum); P.cur=t; P.sum=0; } const a=performance.now(); try{cb(t);}finally{ const e=performance.now(); P.sum+=e-a; if(P.pending.length){ for(const x of P.pending) P.lat.push(e-x); P.pending=[]; } } });
    const tick=(t)=>{ if(P.lastT) P.gaps.push(t-P.lastT); P.lastT=t; raf(tick); }; raf(tick);
    document.addEventListener('pointermove',(e)=>{ if(e.buttons) P.pending.push(e.timeStamp); },true);
    HTMLElement.prototype.setPointerCapture=function(){};HTMLElement.prototype.releasePointerCapture=function(){};HTMLElement.prototype.hasPointerCapture=function(){return false};
    return true`);
  await S(`__studioQA.useStore.getState().setShared({tool:'pen'});return true`);
  await sleep(600);
  await S(`const P=window.__perf;P.frames=[];P.gaps=[];P.lat=[];P.pending=[];return true`);

  // 主进程：每 4 ms 发一个鼠标移动（≈ 240 Hz 数位板），记下每次实际发出的时间比计划晚了多少：主进程卡住时笔的输入就是这样被耽误的
  const late = [];
  const send = (type, x, y, extra = {}) => student.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra });
  const writeStroke = async (row, col) => {
    const x0 = box.x + box.w * (.06 + col * .09), y0 = box.y + box.h * (.62 + row * .07), steps = 150;
    send('mouseMove', x0, y0); send('mouseDown', x0, y0, { button: 'left', clickCount: 1 });
    const t0 = performance.now();
    for (let i = 1; i <= steps; i++) {
      const due = t0 + i * 4; while (performance.now() < due) await new Promise((r) => setImmediate(r));
      late.push(performance.now() - due);
      const k = i / steps; send('mouseMove', x0 + box.w * .07 * k, y0 + Math.sin(k * 9) * box.h * .02, { button: 'left', modifiers: ['leftButtonDown'] });
    }
    send('mouseUp', x0 + box.w * .07, y0, { button: 'left', clickCount: 1 });
  };
  const T0 = performance.now();
  // 连续写 12 笔（笔与笔之间 150 ms），再停 1.2 秒（触发自动存盘），再写 12 笔，看停顿之后的第一笔有没有被存盘卡住
  for (let i = 0; i < 12; i++) { await writeStroke(0, i % 10); await sleep(150); }
  const lateA = late.splice(0);
  await sleep(1200);
  for (let i = 0; i < 12; i++) { await writeStroke(1, i % 10); await sleep(150); if (i === 0) await sleep(1200); }
  const lateB = late.splice(0);
  const elapsed = performance.now() - T0;
  await sleep(1500);
  const r = await S(`const P=window.__perf;return {frames:P.frames,gaps:P.gaps,lat:P.lat}`);
  const strokes1 = await S(`return (__studioQA.useStore.getState().ink['board#0']||[]).length`);
  const savedBytes = fs.statSync(path.join(process.env.CS_DATA_DIR, 'workspace.json')).size;
  const busy = r.frames.filter((x) => x > 0.05);
  const result = {
    config: { strokes: N, skin: process.env.CS_PERF_SKIN || 'wheat', soft: process.env.CS_PERF_SOFT === '1', dpr: box.dpr, canvas: box.canvas, workspaceMB: +(wsBytes / 1e6).toFixed(1), savedMB: +(savedBytes / 1e6).toFixed(1), gpu: app.getGPUFeatureStatus()['2d_canvas'] },
    wrote: strokes1 - strokes0, elapsedMs: Math.round(elapsed),
    paintMsPerFrame: stats(busy), frameGapMs: stats(r.gaps), slowFrames25: r.gaps.filter((g) => g > 25).length,
    inputToPaintMs: stats(r.lat),
    inputLateMs_continuous: stats(lateA), inputLateMs_afterPause: stats(lateB), inputStalls50: [...lateA, ...lateB].filter((x) => x > 50).length,
  };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1));
  console.log('BOARD PERF', JSON.stringify(result));
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('BOARD PERF FAIL', e); app.exit(1); });
