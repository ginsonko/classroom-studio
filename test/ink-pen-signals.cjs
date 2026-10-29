// 数位板抬笔信号不规范时笔迹不能丢（macOS 上高漫等驱动的问题）：
//   A 抬笔报成 mouse（pointerId 不同）  B 只发 pointercancel  C 只发 lostpointercapture
//   D 没有 pointerup，只来一个 buttons=0 的 move  E 抬笔信号整个丢了，下一笔落下时补存上一笔
//   F 真实鼠标快速一划立刻松开  G 第二根手指按下不打断正在写的一笔
// 每种情况都要留下一笔；最后笔迹总数精确对上。
// 用法：npm run build 后 npx electron test/quiet.cjs test/ink-pen-signals.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'ink-pen-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));
const { app } = require('electron'); const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('ink pen test timed out'); app.exit(1); }, 180000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error(r.__err); return r; };
  await T(`s.set({page:'console',aiOpen:false});s.setShared({tool:'pen'});return true`);
  // 多显示器缩放不同时，窗口挪到屏幕外后 Windows 会在一秒左右后按那块屏的 DPI 再缩放一次：等窗口宽度稳定再找画布
  for (let i = 0, last = -1, same = 0; i < 48 && same < 6; i++) { await sleep(250); const w = await call(teacher, 'innerWidth'); same = w === last ? same + 1 : 0; last = w; }
  let prev = '';
  const box = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];if(!c)return null;const e=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);return e&&e.classList.contains('ink-c')?{x:c.x,y:c.y,w:c.width,h:c.height}:null`).then(async (b) => { await sleep(300); const j = JSON.stringify(b); const ok = b && j === prev; prev = j; return ok ? b : null; }), 8000, 'writable canvas');
  // 合成的指针事件没有真实指针，setPointerCapture 会抛错：测试里换成空操作
  await T(`HTMLElement.prototype.setPointerCapture=function(){};HTMLElement.prototype.releasePointerCapture=function(){};HTMLElement.prototype.hasPointerCapture=function(){return false};return true`);
  const pens = () => T(`return Object.values(s.ink).flat().filter(x=>x.tool==='pen').length`);
  const pt = (fx, fy) => [Math.round(box.x + box.w * fx), Math.round(box.y + box.h * fy)];
  /** steps: [type, pointerId, pointerType, fx, fy, buttons, pressure] 依次派发到画布上 */
  const fire = (steps) => T(`const c=document.elementFromPoint(${Math.round(box.x + box.w / 2)},${Math.round(box.y + box.h / 2)});
    for(const [type,id,kind,x,y,buttons,pressure] of ${JSON.stringify(steps.map(([t, id, k, fx, fy, b, p]) => [t, id, k, ...pt(fx, fy), b, p]))}){
      c.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:kind,isPrimary:true,clientX:x,clientY:y,button:type==='pointerdown'||type==='pointerup'?0:-1,buttons,pressure}));
    } return true`);
  const stroke = (id, kind, y, from = .15, to = .45) => [['pointerdown', id, kind, from, y, 1, .5], ...Array.from({ length: 8 }, (_, i) => ['pointermove', id, kind, from + (to - from) * (i + 1) / 8, y + .01 * Math.sin(i), 1, .5])];
  const results = [];
  const expect = async (name, n) => { const got = await until(async () => { const v = await pens(); return v === n ? v : null; }, 3000, name + ' → ' + n + ' 笔').catch(async () => pens()); assert.equal(got, n, name); results.push(name); console.log('PASS', name, n); };

  await fire([...stroke(2, 'pen', .15), ['pointerup', 1, 'mouse', .45, .15, 0, 0]]);
  await expect('A 抬笔报成 mouse', 1);
  await fire([...stroke(2, 'pen', .25), ['pointercancel', 2, 'pen', .45, .25, 0, 0]]);
  await expect('B 只有 pointercancel', 2);
  await fire([...stroke(2, 'pen', .35), ['lostpointercapture', 2, 'pen', .45, .35, 0, 0]]);
  await expect('C 只有 lostpointercapture', 3);
  await fire([...stroke(2, 'pen', .45), ['pointermove', 2, 'pen', .5, .45, 0, 0], ['pointermove', 2, 'pen', .6, .45, 0, 0]]);
  await expect('D buttons=0 的 move 当作抬笔', 4);
  const d = await T(`const p=Object.values(s.ink).flat().filter(x=>x.tool==='pen').at(-1).pts;return p[p.length-3]`);
  assert.ok(d < .48, '抬笔后的移动不再连进这一笔：' + d);
  await fire([...stroke(2, 'pen', .55)]);
  await fire([...stroke(2, 'pen', .65), ['pointerup', 2, 'pen', .45, .65, 0, 0]]);
  await expect('E 抬笔丢了，下一笔落下时补存', 6);
  // 悬停（没按下）的 move 不会生出笔迹
  await fire([['pointermove', 2, 'pen', .3, .7, 0, 0], ['pointermove', 2, 'pen', .35, .7, 0, 0]]);
  await expect('悬停不出笔迹', 6);
  // 真实鼠标（Electron 输入事件）：快速一划立刻松开
  const [x0, y0] = pt(.55, .2), [x1, y1] = pt(.85, .25);
  teacher.webContents.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
  teacher.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) teacher.webContents.sendInputEvent({ type: 'mouseMove', x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6, button: 'left', modifiers: ['leftButtonDown'] });
  teacher.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
  await expect('F 鼠标快速一划立刻松开', 7);
  // 两根手指：第二根按下、抬起都不打断第一根
  await fire([...stroke(11, 'touch', .8, .55, .7), ['pointerdown', 12, 'touch', .9, .9, 1, .5], ['pointerup', 12, 'touch', .9, .9, 0, 0], ['pointermove', 11, 'touch', .8, .82, 1, .5], ['pointerup', 11, 'touch', .8, .82, 0, 0]]);
  await expect('G 第二根手指不打断', 8);
  const last = await T(`const p=Object.values(s.ink).flat().filter(x=>x.tool==='pen').at(-1).pts;return p.length/3`);
  assert.ok(last >= 9, '触摸这一笔点数 ' + last);
  fs.writeFileSync(path.join(out, 'shot.png'), (await teacher.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, [], 'renderer errors');
  console.log('INK PEN OK', results.length, out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('INK PEN FAIL', e); app.exit(1); });
