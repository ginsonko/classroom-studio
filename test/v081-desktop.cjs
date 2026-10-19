// 0.8.1 桌面验收：橡皮默认局部擦除（旧存档迁移、学生窗口同步）、整笔擦除仍可选、橡皮大小；侧栏「演示」直接打开三科演示库。
// 所有输入都发给屏幕外的窗口（webContents.sendInputEvent），不动真实鼠标。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v081-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v081-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
// 0.8.0 的存档：整笔擦除（旧默认值），没有 eraserV
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', inkOptions: { eraserMode: 'stroke', shapeSnap: false } },
  local: { roots: [], students: [{ id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'stu-w', slots: [], learning: {} },
}));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v081 desktop timed out'); app.exit(1); }, 180000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})||b.getAttribute('aria-label')===${JSON.stringify(text)}` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});b.click();return true`);
  const drag = async (w, pts) => {
    const [x0, y0] = pts[0];
    w.webContents.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    w.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { w.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
    const [x1, y1] = pts.at(-1); w.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }); await sleep(150);
  };
  const line = (a, b, n = 24) => Array.from({ length: n + 1 }, (_, i) => [Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n)]);

  // ── 1. 旧存档迁移：老师和学生窗口都是局部擦除 ──
  await T(`s.set({page:'console',aiOpen:false});return true`);
  const opt = await T(`return s.inkOptions`), sopt = await S(`return s.inkOptions`);
  assert.equal(opt.eraserMode, 'segment'); assert.equal(opt.eraserSize, 'm'); assert.equal(opt.shapeSnap, false, 'other options kept');
  assert.equal(sopt.eraserMode, 'segment', 'student window gets the migrated option too');
  mark('0.8.0 save with whole-stroke eraser migrates to partial erase on both windows, other ink options kept', opt);

  // ── 2. 在教师端可书写的画布上画一条横线，再用橡皮竖着擦过中间 → 断成两段 ──
  await T(`s.setShared({tool:'pen'});return true`);
  // 布局有过渡动画：位置连续两次一样才算稳定
  let prevBox = '';
  const box = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];if(!c)return null;const e=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);return e&&e.classList.contains('ink-c')?{x:c.x,y:c.y,w:c.width,h:c.height}:null`).then(async (b) => { await sleep(300); const j = JSON.stringify(b); const ok = b && j === prevBox; prevBox = j; return ok ? b : null; }), 8000, 'writable canvas');
  const P = (fx, fy) => [Math.round(box.x + box.w * fx), Math.round(box.y + box.h * fy)];
  const pens = () => T(`return Object.entries(s.ink).flatMap(([k,v])=>v.filter(x=>x.tool==='pen').map(x=>({k,id:x.id,n:x.pts.length/3,x0:x.pts[0],x1:x.pts.at(-3)})))`);
  await drag(teacher, line(P(.2, .5), P(.8, .5)));
  const drawn = await until(async () => { const p = await pens(); return p.length === 1 ? p : null; }, 4000, 'pen stroke');
  await T(`s.setShared({tool:'eraser'});return true`);
  await sleep(150);
  teacher.webContents.sendInputEvent({ type: 'mouseMove', x: P(.5, .3)[0], y: P(.5, .3)[1] }); await sleep(120);
  await shot(teacher, 'v081-1-eraser-cursor.png', 100);
  assert.equal(await T(`return [...document.querySelectorAll('.ink')].find(e=>e.style.pointerEvents==='auto').style.cursor`), 'none', 'system cursor hidden, the round eraser is drawn instead');
  await drag(teacher, line(P(.5, .35), P(.5, .65), 12));
  const cut = await until(async () => { const p = await pens(); return p.length === 2 ? p : null; }, 4000, 'stroke cut in two');
  assert.ok(cut.every((p) => p.k === drawn[0].k), 'same page');
  const sorted = cut.sort((a, b) => a.x0 - b.x0);
  assert.ok(sorted[0].x1 < .5 && sorted[1].x0 > .5 - .01 && sorted[0].x1 > .3, 'gap around the middle: ' + JSON.stringify(sorted));
  const stu = await until(async () => { const n = await S(`return (s.ink[${JSON.stringify(drawn[0].k)}]||[]).filter(x=>x.tool==='pen').length`); return n === 2 ? n : null; }, 4000, 'student sees two pieces');
  await shot(teacher, 'v081-2-partial-erase.png');
  mark('partial erase: a vertical eraser pass cuts a pen line into two pieces (also on the student window)', { pieces: sorted.map((p) => [+p.x0.toFixed(3), +p.x1.toFixed(3)]), stu });

  // ── 3. 橡皮选项：再点一次橡皮打开，换整笔擦除 + 大号；整笔擦除删掉碰到的那一段 ──
  // 老师的工具栏在浮层窗口（dock）里
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock')`).catch(() => false), 8000, 'dock');
  if (process.env.CS_SHOW !== '1') dock.setPosition(left, 30);
  const D = run(dock, 'dock');
  const dclick = (sel, text) => D(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.innerText.includes(${JSON.stringify(text)})||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + text)});b.click();return true`);
  await dclick('.tdock .tp-b', '橡皮 · 再点一次选局部 / 整笔擦除和大小，笔尾也能擦');
  await until(() => D(`return !!document.querySelector('.eraser-options')`), 3000, 'eraser options open');
  const opts = await D(`const e=document.querySelector('.eraser-options');return {modes:[...e.querySelectorAll('.eo-row:not(.eo-size) button')].map(b=>b.innerText.split('\\n')[0]),on:e.querySelector('.eo-row button.on b').innerText,sizes:e.querySelectorAll('.eo-size button').length}`);
  assert.deepEqual(opts, { modes: ['局部擦除', '整笔擦除'], on: '局部擦除', sizes: 3 });
  await shot(dock, 'v081-3-eraser-options.png', 200);
  await dclick('.eraser-options .eo-row button', '整笔擦除');
  await dclick('.eraser-options .eo-size button', '橡皮大');
  await until(() => T(`return s.inkOptions.eraserMode==='stroke'&&s.inkOptions.eraserSize==='l'`), 3000, 'options saved');
  assert.equal(await S(`return s.inkOptions.eraserMode`), 'stroke', 'student window follows');
  await T(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true`);
  await drag(teacher, line(P(.3, .42), P(.3, .58), 6));
  const left1 = await until(async () => { const p = await pens(); return p.length === 1 ? p : null; }, 4000, 'whole piece removed');
  assert.ok(left1[0].x0 > .45, 'the right piece survives: ' + JSON.stringify(left1));
  mark('eraser options: whole-stroke mode and size are one click away; whole-stroke erase removes only the piece it touches', opts);

  // ── 4. 直线也能局部擦；箭头仍然整笔擦 ──
  await T(`s.setShared({inkOptions:{...s.inkOptions,eraserMode:'segment',eraserSize:'m'}});const k=Q.inkKey(s.pgmMat.id,s.pgm.page);s.editInk(k,{upsert:[{id:'ln1',tool:'line',color:'ink',size:3,pts:[.15,.3,.5,.85,.3,.5],author:'teacher',layer:'public'},{id:'ar1',tool:'arrow',color:'ink',size:3,pts:[.15,.4,.5,.85,.4,.5],author:'teacher',layer:'public'}]},'teacher');return k`);
  const shapes = () => T(`return Object.values(s.ink).flat().filter(x=>x.tool==='line'||x.tool==='arrow').map(x=>x.tool)`);
  const before = await shapes();
  if (before.length === 2) {
    const k0 = await T(`return Q.inkKey(s.pgmMat.id,s.pgm.page)`);
    // 只在节目区画布上有这两笔时验证（可书写画布就是节目区的情况）
    const onCanvas = await T(`return (s.ink[${JSON.stringify(drawn[0].k)}]||[]).some(x=>x.id==='ln1')`);
    if (onCanvas) {
      // 笔迹坐标按宽度归一（y 也除以宽度）：y=.3 / .4 在画面高度的 53% / 71% 处；左边那段笔迹已经擦掉，x=.4 处没有别的
      await drag(teacher, line(P(.4, .45), P(.4, .8), 16));
      const after = await until(async () => { const a = await shapes(); return !a.includes('arrow') || a.length > 2 ? a : null; }, 4000, 'line cut / arrow removed');
      assert.deepEqual(after.sort(), ['line', 'line'], 'line split in two, arrow erased whole');
      mark('partial erase also cuts straight lines; arrows are still erased whole', { key: k0 });
    } else mark('line/arrow erase skipped: writable canvas is not the program page', { key: k0, canvasKey: drawn[0].k });
  }

  // ── 5. 侧栏「演示」：打开 AI 面板并展开演示库（三科标签），再点关掉 ──
  await T(`s.setShared({tool:'pen'});return true`);
  await click('.rail-b', '演示');
  await until(() => T(`return s.aiOpen&&!!document.querySelector('.ai-lib.open .ai-lib-tabs')`), 4000, 'library open from rail');
  const tabs = await T(`return [...document.querySelectorAll('.ai-lib-tabs button')].map(b=>b.innerText.replace(/\\s+/g,''))`);
  assert.deepEqual(tabs, ['物理15', '数学12', '化学6']);
  await click('.ai-lib-tabs button', '化学');
  await until(() => T(`return document.querySelectorAll('.ai-lib-grid button').length===6`), 3000, 'chem tab');
  await click('.ai-lib-grid button', '分子与晶体');
  await until(() => T(`return s.reader.mat.scene?.preset==='c.molecule'`), 4000, 'chem demo opened in a physics class');
  assert.ok(await T(`return document.querySelector('.rail-b[aria-label="演示"]').classList.contains('on')`));
  await sleep(300);
  assert.equal(await T(`return document.querySelector('.ai-lib-tabs button.on')?.innerText.replace(/\\s+/g,'')`), '化学6', 'library stays on the chem tab after opening a demo');
  await shot(teacher, 'v081-4-rail-demos.png');
  await click('.rail-b', '演示');
  await until(() => T(`return !s.aiOpen`), 3000, 'closed again');
  mark('rail 演示 opens the AI panel with the three-subject library; a chem demo opens in a physics class; clicking again closes', { tabs });

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
