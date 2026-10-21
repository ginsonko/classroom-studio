// 用手写笔时黑板上的十字由软件自己画，悬空、落笔、写字过程中一直显示（Windows Ink 落笔会藏系统光标）；
// 换回鼠标用回系统十字；笔离开黑板十字消失；橡皮擦不画十字。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v121-pen-cursor.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'pen-cursor-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', boardSkin: 'ivory' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));
const { app } = require('electron'); const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('pen cursor test timed out'); app.exit(1); }, 120000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error(r.__err); return r; };
  await T(`s.set({page:'console',aiOpen:false});s.setShared({tool:'pen'});return true`);
  let prev = '';
  const box = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];if(!c)return null;const e=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);return e&&e.classList.contains('ink-c')?{x:c.x,y:c.y,w:c.width,h:c.height}:null`).then(async (b) => { await sleep(300); const j = JSON.stringify(b); const ok = b && j === prev; prev = j; return ok ? b : null; }), 8000, 'writable canvas');
  await T(`HTMLElement.prototype.setPointerCapture=function(){};HTMLElement.prototype.releasePointerCapture=function(){};HTMLElement.prototype.hasPointerCapture=function(){return false};return true`);
  const pt = (fx, fy) => [Math.round(box.x + box.w * fx), Math.round(box.y + box.h * fy)];
  const fire = (steps) => T(`const c=document.elementFromPoint(${Math.round(box.x + box.w / 2)},${Math.round(box.y + box.h / 2)});
    for(const [type,id,kind,x,y,buttons,pressure] of ${JSON.stringify(steps.map(([t, id, k, fx, fy, b, p]) => [t, id, k, ...pt(fx, fy), b, p]))}){
      c.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:kind,isPrimary:true,clientX:x,clientY:y,button:type==='pointerdown'||type==='pointerup'?0:-1,buttons,pressure}));
    } return true`);
  const cursor = () => T(`const c=document.elementFromPoint(${Math.round(box.x + box.w / 2)},${Math.round(box.y + box.h / 2)});return c.closest('.ink').style.cursor`);
  /** 十字竖臂上（笔尖正上方 6 像素）是否画了东西：横着写的笔迹不会落在那里 */
  const crossAt = (fx, fy, off = 6) => T(`const c=document.elementFromPoint(${Math.round(box.x + box.w / 2)},${Math.round(box.y + box.h / 2)});const live=c.closest('.ink').querySelectorAll('canvas')[1];
    const r=live.getBoundingClientRect(),k=live.width/r.width,x=Math.round((${pt(fx, fy)[0]}-r.left)*k),y=Math.round((${pt(fx, fy)[1]}-${off}-r.top)*k);
    const d=live.getContext('2d').getImageData(x-1,y-1,3,3).data;let a=0;for(let i=3;i<d.length;i+=4)a=Math.max(a,d[i]);return a`);
  const settle = () => sleep(120);
  const results = [];
  const ok = (name, cond, detail) => { assert.ok(cond, name + ' ' + (detail ?? '')); results.push(name); console.log('PASS', name, detail ?? ''); };

  ok('鼠标时用系统十字', await cursor() === 'crosshair', await cursor());
  await fire([['pointermove', 2, 'pen', .3, .3, 0, 0]]); await settle();
  ok('笔悬空：系统光标藏起来', await cursor() === 'none', await cursor());
  ok('笔悬空：软件画十字', await crossAt(.3, .3) > 100, await crossAt(.3, .3));
  await fire([['pointerdown', 2, 'pen', .3, .4, 1, .5], ['pointermove', 2, 'pen', .35, .4, 1, .5], ['pointermove', 2, 'pen', .4, .4, 1, .5]]); await settle();
  ok('落笔写字时十字还在（跟着笔尖）', await crossAt(.4, .4) > 100, await crossAt(.4, .4));
  ok('原来的位置没有残影', await crossAt(.3, .3) === 0, await crossAt(.3, .3));
  await fire([['pointermove', 2, 'pen', .45, .4, 1, .5], ['pointerup', 2, 'pen', .45, .4, 0, 0]]); await settle();
  ok('抬笔后十字还在', await crossAt(.45, .4) > 100, await crossAt(.45, .4));
  { const [cx, cy] = pt(.45, .4); fs.writeFileSync(path.join(out, 'cross.png'), (await teacher.webContents.capturePage({ x: cx - 60, y: cy - 40, width: 120, height: 80 })).resize({ width: 480 }).toPNG()); }
  ok('这一笔照常保存', await T(`return Object.values(s.ink).flat().filter(x=>x.tool==='pen').length`) === 1);
  await fire([['pointermove', 2, 'pen', .6, .6, 0, 0], ['pointerout', 2, 'pen', .99, .6, 0, 0]]); await settle();
  ok('笔离开黑板十字消失', await crossAt(.6, .6) === 0, await crossAt(.6, .6));
  await fire([['pointermove', 2, 'pen', .5, .7, 0, 0]]); await settle();
  await T(`s.setShared({boardSkin:'chalk'});return true`); await sleep(250);
  await fire([['pointermove', 2, 'pen', .5, .7, 0, 0]]); await settle();
  const darkPx = await T(`const c=document.elementFromPoint(${Math.round(box.x + box.w / 2)},${Math.round(box.y + box.h / 2)});const live=c.closest('.ink').querySelectorAll('canvas')[1];
    const r=live.getBoundingClientRect(),k=live.width/r.width,x=Math.round((${pt(.5, .7)[0]}-r.left)*k),y=Math.round((${pt(.5, .7)[1]}-6-r.top)*k);const d=live.getContext('2d').getImageData(x-4,y,9,1).data,px=[];for(let i=0;i<d.length;i+=4)px.push([d[i],d[i+3]]);return px`);
  const solid = darkPx.filter(([, a]) => a > 200);
  ok('深色黑板上十字是亮色', solid.length > 0 && solid.every(([r]) => r > 200), JSON.stringify(darkPx));
  await T(`s.setShared({boardSkin:'ivory'});return true`); await sleep(250);
  await fire([['pointermove', 3, 'mouse', .7, .7, 0, 0]]); await settle();
  ok('换回鼠标：系统十字', await cursor() === 'crosshair', await cursor());
  ok('换回鼠标：不再画软件十字', await crossAt(.7, .7) === 0 && await crossAt(.5, .7) === 0);
  // 部分驱动写字时夹杂 mouse 事件：写到一半来的 mouse move 不切回系统光标
  await fire([['pointermove', 2, 'pen', .2, .8, 0, 0], ['pointerdown', 2, 'pen', .2, .8, 1, .5], ['pointermove', 1, 'mouse', .25, .8, 1, 0], ['pointermove', 2, 'pen', .3, .8, 1, .5]]); await settle();
  ok('写字中夹杂鼠标事件不闪', await cursor() === 'none' && await crossAt(.3, .8) > 100, await cursor());
  await fire([['pointerup', 2, 'pen', .3, .8, 0, 0]]); await settle();
  await T(`s.setShared({tool:'eraser'});return true`); await sleep(200);
  await fire([['pointermove', 2, 'pen', .8, .3, 0, 0]]); await settle();
  // 橡皮圈的半径随画布大小变，取十字臂外端（8 像素）那一点，橡皮圈落不到那里
  ok('橡皮擦不画十字', await crossAt(.8, .3, 8) === 0, await crossAt(.8, .3, 8));
  fs.writeFileSync(path.join(out, 'shot.png'), (await teacher.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, [], 'renderer errors');
  console.log('PEN CURSOR OK', results.length, out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('PEN CURSOR FAIL', e); app.exit(1); });
