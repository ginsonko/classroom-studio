// 0.9.1 桌面验收：学生画面多窗口（黑板垫底、课件占满 / 浮动窗口 / 收起、各自记住页码、并排、上限）、
// 学生端切换栏 + 页面缩略图 + 翻页 / 放大、学生完整工具、锁定后学生不能动、浮动窗口里的答案页照样遮住。
// 所有输入都发给屏幕外的窗口（webContents.sendInputEvent），不动真实鼠标。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v091-desk.cjs   （CS_SHOW=1 显示窗口；CS_SHOTS=目录 另存截图）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v091desk-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
// 0.9.0 的存档：没有 desk
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }, { w: 1600, h: 900 }], total: 2 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', drawAuthor: 'teacher', subject: 'physics' },
  local: { roots: [], students: [{ id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'stu-w', slots: [], learning: {} },
}));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v091 desk timed out'); app.exit(1); }, 240000);
const shotsDir = process.env.CS_SHOTS; if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const doc = (id, title, n, extra = {}) => ({ id, kind: 'pdf', title, total: n, pages: Array.from({ length: n }, (_, i) => ({ src: `mock/pages/${extra.answer ? 'answer' : 'blank'}-${String(i % 10 + 1).padStart(2, '0')}.png`, w: 595, h: 842 })), ...extra });

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
  const shot = async (w, name, wait = 500) => { await sleep(wait); w.webContents.invalidate(); await sleep(300); const png = (await w.webContents.capturePage()).toPNG(); fs.writeFileSync(path.join(out, name), png); if (shotsDir) fs.writeFileSync(path.join(shotsDir, name), png); };
  const clickIn = (R, sel, text) => R(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `(b.innerText||'').includes(${JSON.stringify(text)})||b.getAttribute('aria-label')===${JSON.stringify(text)}` : 'true'});if(!b)throw Error('no element '+${JSON.stringify(sel + ' ' + (text || ''))});b.click();return true`);
  const drag = async (w, pts) => {
    const [x0, y0] = pts[0];
    w.webContents.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    w.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { w.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
    const [x1, y1] = pts.at(-1); w.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }); await sleep(200);
  };
  const line = (a, b, n = 16) => Array.from({ length: n + 1 }, (_, i) => [Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n)]);
  const sameDesk = async () => { const a = await T(`return JSON.stringify(s.desk.map(w=>[w.id,w.mode,w.rect.map(x=>+x.toFixed(3))]))+'|'+s.pgmMat.id+'|'+s.pgm.page`); return until(async () => (await S(`const s2=Q.useStore.getState();return JSON.stringify(s2.desk.map(w=>[w.id,w.mode,w.rect.map(x=>+x.toFixed(3))]))+'|'+s2.pgmMat.id+'|'+s2.pgm.page`)) === a ? a : null, 4000, 'student desk in sync'); };

  await T(`s.set({page:'console',aiOpen:false});return true`);
  // ── 1. 旧存档：黑板自动进 desk，两边一致 ──
  await until(() => T(`return s.desk.some(w=>w.id==='board')`), 5000, 'desk migrated');
  await sameDesk();
  mark('0.9.0 save gets a desk with the board as base layer, student window in sync');

  // ── 2. 上屏两份课件，切回第一份回到原来那页（页码记忆）；老师写的字切回来还在 ──
  const A = doc('t:A', '追及相遇 · 原卷', 8), B = doc('t:B', '追及相遇 · 答案', 6, { answer: true, answerPages: [0, 1, 2, 3, 4, 5] });
  await T(`s.showNow(${JSON.stringify(A)},{page:3});return true`);
  await T(`Q.useStore.getState().addStroke('t:A#3',{id:'ta3',author:'teacher',layer:'public',tool:'pen',color:'red',size:3,pts:[.2,.2,.5,.6,.6,.5]});return true`);
  await T(`Q.useStore.getState().showNow(${JSON.stringify(B)});return true`);
  await until(() => S(`return Q.useStore.getState().pgmMat.id==='t:B'&&!!document.querySelector('.desk-full .answer-cover')`), 5000, 'answer covered on student');
  await T(`Q.useStore.getState().focusWin('t:A');return true`);
  const back = await T(`const s2=Q.useStore.getState();return {id:s2.pgmMat.id,page:s2.pgm.page,n:s2.desk.length}`);
  assert.deepEqual(back, { id: 't:A', page: 3, n: 3 });
  await until(() => S(`const s2=Q.useStore.getState();return s2.pgm.page===3&&(s2.ink['t:A#3']||[]).some(x=>x.id==='ta3')`), 5000, 'student sees A page 3 with ink');
  await shot(student, '1-学生端-课件占满.png');
  mark('switching back to an open document returns to its page with its ink (page memory)', back);

  // ── 3. 变成浮动窗口：学生端看到黑板垫底 + 窗口；答案课件作为窗口时同样遮住 ──
  await T(`const st=Q.useStore.getState();st.setWin('t:A',{mode:'normal'});return true`);
  await T(`const st=Q.useStore.getState();st.focusWin('t:B');Q.useStore.getState().setWin('t:B',{mode:'normal'});Q.useStore.getState().setWin('t:B',{rect:[.55,.12,.4,.7]});Q.useStore.getState().focusWin('t:A');return true`);
  await sameDesk();
  const layers = await until(() => S(`const w=[...document.querySelectorAll('.dwin')].map(e=>({id:e.dataset.win,cur:e.classList.contains('cur'),cover:!!e.querySelector('.answer-cover')}));return document.querySelector('.desk-base')&&w.length===2&&[...document.querySelectorAll('.dwin')].every(e=>e.querySelector('.page'))?w:null`), 5000, 'two floating windows over the board');
  assert.ok(layers.find((w) => w.id === 't:B').cover, 'answer page covered inside a floating (not current) window');
  assert.ok(layers.find((w) => w.id === 't:A').cur);
  await shot(student, '2-学生端-黑板上两个窗口.png');
  mark('documents float as windows over the board; an answer document stays covered even when it is not the current item', { layers });

  // ── 4. 学生在学生窗口里拖动窗口标题栏、拖右下角缩放 → 老师端同步 ──
  const bar = await S(`const r=document.querySelector('.dwin[data-win="t:A"] .dwin-bar').getBoundingClientRect();return {x:r.x+60,y:r.y+r.height/2}`);
  const before = await T(`return Q.useStore.getState().desk.find(w=>w.id==='t:A').rect`);
  await drag(student, line([bar.x, bar.y], [bar.x - 120, bar.y + 60]));
  const moved = await until(async () => { const r = await T(`return Q.useStore.getState().desk.find(w=>w.id==='t:A').rect`); return Math.abs(r[0] - before[0]) > 0.05 ? r : null; }, 4000, 'move synced to teacher');
  const se = await S(`const r=document.querySelector('.dwin[data-win="t:A"] .dwin-rz.rz-se').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`);
  await drag(student, line([se.x, se.y], [se.x + 100, se.y + 50]));
  const resized = await until(async () => { const r = await T(`return Q.useStore.getState().desk.find(w=>w.id==='t:A').rect`); return r[2] > moved[2] + 0.04 ? r : null; }, 4000, 'resize synced to teacher');
  mark('student drags a window title bar and its corner; the teacher state follows', { before, moved, resized });

  // ── 5. 学生翻页和放大（右下角按钮）、键盘翻页 ──
  await clickIn(S, '.dzoom-row button', '下一页');
  await until(() => T(`return Q.useStore.getState().pgm.page===4`), 4000, 'student next page reaches teacher');
  await clickIn(S, '.dzoom-row button', '放大');
  const zoomed = await until(() => T(`const v=Q.useStore.getState().pgm;return v.fit==='region'&&v.region?v.region:null`), 4000, 'student zoom reaches teacher');
  await until(() => S(`return !!document.querySelector('.dzoom-map')`), 3000, 'minimap shown');
  const mm = await S(`const m=document.querySelector('.dzoom-map').getBoundingClientRect(),i=document.querySelector('.dzoom-map i').getBoundingClientRect();return {m:[m.x,m.y,m.width,m.height],i:[i.x,i.y,i.width,i.height],style:document.querySelector('.dzoom-map').getAttribute('style'),r:Q.useStore.getState().pgm.region}`);
  console.log('MINIMAP', JSON.stringify(mm));
  await shot(student, '3-学生端-放大和小地图.png');
  student.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); student.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await until(() => T(`const v=Q.useStore.getState().pgm;return v.page===5&&v.fit!=='region'`), 4000, 'arrow key paging from the student window');
  mark('student pages and zooms the current document from the student window (buttons, minimap, arrow keys)', { zoomed });

  // ── 6. 学生端左侧切换栏、右侧页面缩略图 ──
  await clickIn(S, '.drail-tab');
  await until(() => S(`return document.querySelectorAll('.drail-it').length===3`), 3000, 'rail lists board + 2 docs');
  await clickIn(S, '.dpages-tab');
  await until(() => S(`return document.querySelectorAll('.dpages .pthumb').length===8&&!!document.querySelector('.dpages .pthumb.on')`), 3000, 'page thumbnails');
  await sleep(800);
  await shot(student, '4-学生端-切换栏和页面缩略图.png');
  await S(`[...document.querySelectorAll('.dpages .pthumb')][1].click();return true`);
  await until(() => T(`return Q.useStore.getState().pgm.page===1`), 3000, 'thumbnail jump');
  await S(`const it=[...document.querySelectorAll('.drail-it')].find(e=>e.innerText.includes('答案'));it.querySelector('.drail-go').click();return true`);
  await until(() => T(`return Q.useStore.getState().pgmMat.id==='t:B'`), 3000, 'student switches to the other window');
  await S(`const it=[...document.querySelectorAll('.drail-it')].find(e=>e.innerText.includes('课堂黑板'));it.querySelector('.drail-go').click();return true`);
  await until(() => T(`return Q.useStore.getState().pgmMat.id==='board'`), 3000, 'student switches to the board');
  mark('student rail switches between open items and the page panel jumps pages');

  // ── 7. 并排：A 和 B 左右各半 ──
  await T(`Q.useStore.getState().focusWin('t:A');Q.useStore.getState().tileWins();return true`);
  const tiled = await T(`return Q.useStore.getState().desk.filter(w=>w.id!=='board').map(w=>({id:w.id,mode:w.mode,rect:w.rect}))`);
  assert.deepEqual(tiled.map((w) => [w.id, w.mode, w.rect]).sort(), [['t:A', 'normal', [0, 0, 0.5, 1]], ['t:B', 'normal', [0.5, 0, 0.5, 1]]]);
  await sameDesk();
  await shot(student, '5-学生端-并排.png');
  await shot(teacher, '6-教师端-打开的课件标签.png');
  mark('tile puts the current document and the last used one side by side', { tiled });

  // ── 8. 学生完整工具：工具组和老师一样 ──
  // 学生工具栏默认收起：点一下圆钮展开
  await S(`if(!document.querySelector('.sbar.open')){const b=document.querySelector('.sbar-fab'),r=b.getBoundingClientRect(),o={bubbles:true,pointerId:7,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2};b.dispatchEvent(new PointerEvent('pointerdown',o));b.dispatchEvent(new PointerEvent('pointerup',o));}return true`);
  const groups = await until(() => S(`const n=document.querySelectorAll('.sbar .tp-g').length;return n||null`), 3000, 'student palette');
  assert.equal(groups, 8, 'student gets all eight tool groups');
  mark('student palette has the same tool groups as the teacher', { groups });

  // ── 9. 上限：设成 2，开第三份课件 → 最久没用的被关掉；不限 → 不关 ──
  await T(`Q.useStore.getState().setShared({deskLimit:2});Q.useStore.getState().showNow(${JSON.stringify(doc('t:C', '第三份讲义', 3))});return true`);
  const ids = await T(`return Q.useStore.getState().desk.map(w=>w.id)`);
  assert.equal(ids.length, 3); assert.ok(ids.includes('board') && ids.includes('t:C'));
  await T(`Q.useStore.getState().setShared({deskLimit:0});for(let i=0;i<12;i++)Q.useStore.getState().showNow({id:'t:N'+i,kind:'board',title:'黑板 '+i,pages:[{w:1600,h:900}],total:1});return true`);
  const many = await T(`return Q.useStore.getState().desk.length`);
  assert.equal(many, 15, 'unlimited keeps all');
  await T(`Q.useStore.getState().setShared({deskLimit:10});for(let i=0;i<12;i++)Q.useStore.getState().closeWin('t:N'+i);return true`);
  mark('desk limit closes the least recently used item; 0 means unlimited', { ids, many });

  // ── 10. 锁定：学生不能翻页、不能切换，也不能伪造新课件 ──
  await T(`Q.useStore.getState().setShared({studentTools:'locked',drawAuthor:'student'});return true`);
  await until(() => S(`return Q.useStore.getState().studentTools==='locked'`), 3000);
  const p0 = await T(`return Q.useStore.getState().pgm.page`);
  await S(`const st=Q.useStore.getState();st.setShared({pgm:{...st.pgm,page:st.pgm.page+1}});st.setShared({pgmMat:{id:'evil',kind:'board',title:'x',pages:[],total:0}});return true`);
  await sleep(600);
  assert.equal(await T(`return Q.useStore.getState().pgm.page`), p0); assert.notEqual(await T(`return Q.useStore.getState().pgmMat.id`), 'evil');
  assert.equal(await S(`return document.querySelectorAll('.dzoom-row button').length`), 0, 'no paging buttons while locked');
  await T(`Q.useStore.getState().setShared({studentTools:'open',drawAuthor:'teacher'});return true`);
  mark('locked student tools cannot page, switch or inject materials');

  // ── 11. 保存：desk 进存档 ──
  await T(`await Q.flushStore();return true`);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), 'utf8'));
  assert.ok(Array.isArray(saved.shared.desk) && saved.shared.desk.some((w) => w.id === 't:A'));
  mark('desk is saved with the classroom', { saved: saved.shared.desk.map((w) => w.id) });

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { for (const r of ['teacher', 'student']) { const t = globalThis.classroomStudioTest?.windows.get(r); if (t) fs.writeFileSync(path.join(out, 'failure-' + r + '.png'), (await t.webContents.capturePage()).toPNG()); } } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
