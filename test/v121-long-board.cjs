// 1.2.1 长黑板与保存板书：在学生画面里新开长黑板、写字（坐标落在整条黑板上）、滚轮 / 翻页键 / 右侧滑条滚动、
// 往下滚自动加长并同步给老师、看不到的笔迹不画、跳到最后写的地方；保存板书按矢量重画：
// 长黑板一张长图，多页黑板拼成一张 / 每页一张 / 只存这一页，图片尺寸和内容都对。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v121-long-board.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'long-board-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const board = { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }, { w: 1600, h: 900 }, { w: 1600, h: 900 }], total: 3 };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: board, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', boardSkin: 'ivory', pattern: 'grid', drawAuthor: 'teacher', tool: 'pen', color: '#d03030', size: 8 },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));
const electron = require('electron'); const { app, nativeImage } = electron; const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('long board test timed out'); app.exit(1); }, 180000);
const SCREEN = 9 / 16;
const results = [];
const ok = (name, cond, detail) => { assert.ok(cond, name + ' ' + (detail ?? '')); results.push(name); console.log('PASS', name, detail ?? ''); };
/** 图片在 (x, y) 附近 5×5 里最红的那个点 */
const redAt = (img, x, y) => { const s = img.getSize(), bmp = img.toBitmap(); let best = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const px = Math.round(x) + dx, py = Math.round(y) + dy; if (px < 0 || py < 0 || px >= s.width || py >= s.height) continue; const i = (py * s.width + px) * 4; best = Math.max(best, bmp[i + 2] - bmp[i + 1]); } return best; }; // BGRA

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await call(teacher, `window.csHost.call('student')`);
  const student = await until(() => api.windows.get('student'), 15000, 'student window');
  await until(() => call(student, '!!window.__studioQA'), 15000, 'student ready');
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  await T(`s.set({page:'console',aiOpen:false});return true`);

  // ── 多页黑板：每页一道红色横线（第 n 页画在 y = 0.1 + 0.1n） ──
  await T(`for(let i=0;i<3;i++)s.addStroke(Q.inkKey('board',i),{id:'p'+i,tool:'pen',color:'#d03030',size:10,author:'teacher',pts:[.2,.1+.1*i,.5,.5,.1+.1*i,.5,.8,.1+.1*i,.5]});return true`);
  const save = async (mode, name) => T(`const p=await Q.boardExport.boardPngs(s.pgmMat,1,${JSON.stringify(mode)});return await Q.host.call('exportBoard',{title:s.pgmMat.title,pngs:p,to:${JSON.stringify(path.join(out, name))}})`);
  {
    const files = await save('stitch', '拼长图.png');
    ok('多页拼长图：一个文件', files.length === 1 && fs.existsSync(files[0]), JSON.stringify(files));
    const img = nativeImage.createFromPath(files[0]), sz = img.getSize();
    ok('多页拼长图：宽 1920，三页加两道缝', sz.width === 1920 && sz.height === 1080 * 3 + 28 * 2, JSON.stringify(sz));
    const ys = [0, 1, 2].map((i) => i * (1080 + 28) + (.1 + .1 * i) * 1920);
    ok('多页拼长图：每页的笔迹都在各自位置', ys.every((y) => redAt(img, 960, y) > 100), ys.map((y) => redAt(img, 960, y)).join(','));
    ok('多页拼长图：笔迹之外是纸面', redAt(img, 960, 1080 * .8) < 30);
    fs.copyFileSync(files[0], path.join(out, 'stitch-view.png'));
  }
  {
    const files = await save('pages', '每页.png');
    ok('每页一张：三个文件按 -01 -02 -03 编号', files.length === 3 && files.every((f, i) => f.endsWith(`每页-0${i + 1}.png`) && fs.existsSync(f)), files.map((f) => path.basename(f)).join(','));
    const imgs = files.map((f) => nativeImage.createFromPath(f));
    ok('每页一张：每张 1920×1080，笔迹在对应位置', imgs.every((im, i) => im.getSize().width === 1920 && im.getSize().height === 1080 && redAt(im, 960, (.1 + .1 * i) * 1920) > 100));
    const one = await save('page', '这一页.png');
    const im = nativeImage.createFromPath(one[0]);
    ok('只存这一页：第 2 页', one.length === 1 && redAt(im, 960, .2 * 1920) > 100 && redAt(im, 960, .1 * 1920) < 30);
  }
  let threw = '';
  try { await T(`return await Q.host.call('exportBoard',{title:'x',pngs:['data:image/png;base64,AAAA'],to:${JSON.stringify(path.join(out, 'bad.png'))}})`); } catch (e) { threw = e.message; }
  ok('不是 PNG 的数据拒收', /无效/.test(threw) && !fs.existsSync(path.join(out, 'bad.png')), threw.slice(0, 80));

  // ── 长黑板 ──
  await T(`s.newLongBoard();return true`);
  const longId = await until(() => T(`const st=Q.useStore.getState();return Q.longBoard.isLong(st.pgmMat)?st.pgmMat.id:null`), 5000, 'long board on air');
  ok('新开长黑板上屏，原来的黑板还在', await T(`const st=Q.useStore.getState();return st.pgmMat.title==='长黑板'&&st.pgm.y===0&&st.desk.some(w=>w.id==='board')&&st.desk.some(w=>w.id===st.pgmMat.id)`));
  await until(() => S(`return !!document.querySelector('[data-cur-stage] .stage.long .ink-c')`), 8000, 'student long stage');
  await S(`HTMLElement.prototype.setPointerCapture=function(){};HTMLElement.prototype.releasePointerCapture=function(){};HTMLElement.prototype.hasPointerCapture=function(){return false};return true`);
  const geo = () => S(`const st=document.querySelector('[data-cur-stage] .stage.long'),pg=st.querySelector('.page'),cs=st.querySelectorAll('.ink-c');const a=st.getBoundingClientRect(),p=pg.getBoundingClientRect(),c=cs[0].getBoundingClientRect();
    return {stage:{x:a.x,y:a.y,w:a.width,h:a.height},page:{x:p.x,y:p.y,w:p.width,h:p.height},canvas:{y:c.y,h:c.height,px:cs[0].height},y:Q.useStore.getState().pgm.y}`);
  let g = await until(async () => { const v = await geo(); return v.page.w > 100 && v.canvas.h > 0 ? v : null; }, 5000, 'geometry');
  ok('取景框 16:9，页面宽等于取景宽', Math.abs(g.page.w * SCREEN - Math.min(g.stage.h, g.stage.w * SCREEN)) < 2, JSON.stringify(g.page));
  ok('画布只盖住两屏（不是整条黑板）', Math.abs(g.canvas.h - g.page.w * SCREEN * 2) < 2 && g.page.h >= g.page.w * SCREEN * 3 - 1, `${g.canvas.h} / ${g.page.h}`);

  // 在画面中间写一笔：存下来的坐标是整条黑板上的位置
  const drawAt = (fy) => S(`const st=document.querySelector('[data-cur-stage] .stage.long'),a=st.getBoundingClientRect(),c=st.querySelectorAll('.ink-c')[1];
    const y=a.y+a.height*${fy};const xs=[.3,.4,.5,.6,.7].map(f=>a.x+a.width*f);
    const ev=(type,x,b)=>c.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,button:type==='pointermove'?-1:0,buttons:b,pressure:.5}));
    ev('pointerdown',xs[0],1);for(const x of xs.slice(1))ev('pointermove',x,1);ev('pointerup',xs.at(-1),0);return true`);
  const strokes = () => T(`const st=Q.useStore.getState();return (st.ink[Q.inkKey(st.pgmMat.id,0)]||[]).map(x=>({y:x.pts[1],tool:x.tool}))`);
  await drawAt(.5);
  let list = await until(async () => { const l = await strokes(); return l.length === 1 ? l : null; }, 5000, 'first stroke');
  ok('第一笔落在第一屏中间', Math.abs(list[0].y - SCREEN / 2) < .02, list[0].y.toFixed(3));

  // 滚轮
  await S(`document.querySelector('[data-cur-stage] .stage.long').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:300,deltaMode:0}));return true`);
  const y1 = await until(() => T(`const y=Q.useStore.getState().pgm.y;return y>0?y:null`), 5000, 'wheel scroll');
  ok('滚轮往下滚，老师那边同步', Math.abs(y1 - 300 / g.page.w) < .01, `${y1.toFixed(3)} ≈ ${(300 / g.page.w).toFixed(3)}`);
  await until(async () => { const v = await geo(); return Math.abs(v.page.y - (v.stage.y + (v.stage.h - v.page.w * SCREEN) / 2 - y1 * v.page.w)) < 2; }, 3000, 'page moved');
  ok('Ctrl + 滚轮不缩放也不滚动', await S(`document.querySelector('[data-cur-stage] .stage.long').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-200,ctrlKey:true}));await new Promise(r=>setTimeout(r,200));const p=Q.useStore.getState().pgm;return p.fit==='page'&&!p.region&&Math.abs(p.y-${y1})<1e-6`));

  // 翻页键一直往下：每次半屏，自动加长
  const ratio = () => T(`const m=Q.useStore.getState().pgmMat;return m.pages[0].h/m.pages[0].w`);
  const r0 = await ratio();
  for (let i = 0; i < 6; i++) { await S(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'PageDown',bubbles:true}));return true`); await sleep(120); }
  const y2 = await T(`return Q.useStore.getState().pgm.y`);
  ok('PageDown 每次往下半屏', Math.abs(y2 - (y1 + 6 * SCREEN / 2)) < .01, y2.toFixed(3));
  const r1 = await until(async () => { const r = await ratio(); return r > r0 + .1 ? r : null; }, 5000, 'grow');
  ok('往下滚自动加长，下面留着一屏空白', r1 >= y2 + SCREEN * 2 - 1e-3, `${(r0 / SCREEN).toFixed(1)} → ${(r1 / SCREEN).toFixed(1)} 屏`);
  ok('学生画面拿到加长后的黑板', Math.abs(await S(`const m=Q.useStore.getState().pgmMat;return m.pages[0].h/m.pages[0].w`) - r1) < 1e-6);
  ok('屏数显示', await S(`return document.querySelector('.dzoom-row b')?.textContent`) === `${Math.floor((y2 + SCREEN / 2) / SCREEN) + 1} / ${Math.round(r1 / SCREEN)} 屏`, await S(`return document.querySelector('.dzoom-row b')?.textContent`));

  // 这里写第二笔
  await sleep(200); await drawAt(.3);
  list = await until(async () => { const l = await strokes(); return l.length === 2 ? l : null; }, 5000, 'second stroke');
  ok('第二笔坐标在下面（整条黑板坐标）', Math.abs(list[1].y - (y2 + SCREEN * .3)) < .02, `${list[1].y.toFixed(3)} ≈ ${(y2 + SCREEN * .3).toFixed(3)}`);
  g = await geo();
  const bandTop = Math.max(0, (Math.floor(y2 / (SCREEN / 2) + 1e-6) - 1) * SCREEN / 2);
  ok('画布按半屏取整挪到当前位置，盖住整个画面', Math.abs(g.canvas.y - (g.page.y + bandTop * g.page.w)) < 2 && g.canvas.y <= g.stage.y + 1 && g.canvas.y + g.canvas.h >= g.stage.y + g.stage.h - 1, `${g.canvas.y.toFixed(1)}`);
  // 滚一点点（不到半屏）画布不挪
  await S(`document.querySelector('[data-cur-stage] .stage.long').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-20}));return true`);
  await until(() => T(`return Q.useStore.getState().pgm.y<${y2}-1e-4`), 3000, 'small scroll');
  { const g2 = await geo(), top2 = Math.max(0, (Math.floor(g2.y / (SCREEN / 2) + 1e-6) - 1) * SCREEN / 2);
    ok('小幅滚动画布仍盖住画面', Math.abs(g2.canvas.y - (g2.page.y + top2 * g2.page.w)) < 2 && g2.canvas.y <= g2.stage.y + 1 && g2.canvas.y + g2.canvas.h >= g2.stage.y + g2.stage.h - 1, `${g2.y.toFixed(3)} band ${top2.toFixed(3)}`); }
  await S(`document.querySelector('[data-cur-stage] .stage.long').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:20}));return true`);
  await until(() => T(`return Math.abs(Q.useStore.getState().pgm.y-${y2})<1e-4`), 3000, 'scroll back');
  /** 画布上某个页面坐标那一点的不透明度（不在画布范围里返回 -1） */
  const inkAt = (who, pageY) => who(`const st=document.querySelector('${who === S ? '[data-cur-stage] ' : '.mon-body '}.stage.long'),pg=st.querySelector('.page').getBoundingClientRect(),c=st.querySelectorAll('.ink-c')[0],r=c.getBoundingClientRect(),k=c.width/r.width;
    const cy=(pg.y+${pageY}*pg.width-r.y)*k,cx=(pg.x+.5*pg.width-r.x)*k;if(cy<0||cy>=c.height)return -1;const d=c.getContext('2d').getImageData(Math.round(cx)-2,Math.round(cy)-2,5,5).data;let a=0;for(let i=3;i<d.length;i+=4)a=Math.max(a,d[i]);return a`);
  // 测试窗口放在屏幕外，Chromium 会放慢它的动画帧：等它画完再看
  ok('当前这一笔画出来了', await until(async () => (await inkAt(S, list[1].y)) > 100, 5000, 'current stroke painted'));
  ok('上面看不到的第一笔不在画布里', await inkAt(S, list[0].y) === -1);

  // 右侧滑条拖到最上面
  await S(`const r=document.querySelector('[data-cur-stage] .long-rail.seek');const b=r.getBoundingClientRect();r.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:9,pointerType:'mouse',button:0,buttons:1,clientX:b.x+b.width/2,clientY:b.y+1}));r.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,pointerType:'mouse',button:0,buttons:0,clientX:b.x+b.width/2,clientY:b.y+1}));return true`);
  await until(() => T(`return Q.useStore.getState().pgm.y<.01`), 5000, 'rail to top');
  ok('拖滑条回到顶上，第一笔又画出来', await until(async () => (await inkAt(S, list[0].y)) > 100, 3000, 'first stroke repainted'));
  ok('老师的学生画面监视器也是长黑板，画着第一笔', await until(async () => (await inkAt(T, list[0].y)) > 100, 3000, 'monitor'));

  // 跳到最后写的地方
  await S(`Q.longNav.seekLastInk();return true`);
  const y3 = await until(() => T(`const y=Q.useStore.getState().pgm.y;return y>.1?y:null`), 5000, 'seek last');
  ok('跳到最后写的地方：最后一笔在画面里', list[1].y > y3 && list[1].y < y3 + SCREEN, `${y3.toFixed(3)} < ${list[1].y.toFixed(3)}`);
  const want = `${Math.floor((y3 + SCREEN / 2) / SCREEN) + 1} / ${Math.round(r1 / SCREEN)} 屏`;
  ok('学生画面跟着跳过去', await until(async () => (await S(`return document.querySelector('.dzoom-row b')?.textContent`)) === want && (await inkAt(S, list[1].y)) > 100, 3000, 'student follows'), want);
  await sleep(300);
  fs.writeFileSync(path.join(out, 'student.png'), (await student.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(out, 'teacher.png'), (await teacher.webContents.capturePage()).toPNG());

  // 保存长黑板：一张长图，只到写过的地方往下一点
  const longFiles = await T(`const p=await Q.boardExport.boardPngs(s.pgmMat,0,'stitch');return await Q.host.call('exportBoard',{title:s.pgmMat.title,pngs:p,to:${JSON.stringify(path.join(out, '长黑板.png'))}})`);
  const li = nativeImage.createFromPath(longFiles[0]), ls = li.getSize();
  const bottom = await T(`return Q.longNav.lastInkY(Q.useStore.getState().pgmMat)`);
  ok('长黑板存成一张长图', longFiles.length === 1 && ls.width === 1920 && Math.abs(ls.height - Math.round((bottom + SCREEN * .2) * 1920)) <= 1, JSON.stringify(ls));
  ok('长图里两笔都在原位', redAt(li, 960, list[0].y * 1920) > 100 && redAt(li, 960, list[1].y * 1920) > 100, `${redAt(li, 960, list[0].y * 1920)},${redAt(li, 960, list[1].y * 1920)}`);
  // 预览一段（文件很长）
  fs.writeFileSync(path.join(out, 'long-view.png'), li.resize({ width: 480 }).toPNG());

  // 关掉重开还在
  await T(`await Q.flushStore();return true`);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), 'utf8'));
  ok('存档里记着长黑板、位置和加长后的高度', saved.shared.pgmMat.long === true && saved.shared.pgmMat.id === longId && Math.abs(saved.shared.pgm.y - y3) < 1e-6 && saved.shared.pgmMat.pages[0].h / 1600 >= r1 - 1e-6);

  assert.deepEqual(errors, [], 'renderer errors');
  console.log('LONG BOARD OK', results.length, out);
  clearTimeout(timer); app.exit(0);
})().catch(async (e) => {
  console.error('LONG BOARD FAIL', e);
  try { const s = globalThis.classroomStudioTest?.windows.get('student'); if (s) fs.writeFileSync(path.join(out, 'failure.png'), (await s.webContents.capturePage()).toPNG()); } catch {}
  app.exit(1);
});
