// 1.0.0 桌面验收（屏幕外窗口，不动真实鼠标）：
//   1. 笔更细：粗细档位有「超细」，「自由调粗细」弹出滑块，最细 0.4，画出来的笔迹就是这个粗细；
//   2. 「临时加入的课件」可以逐个移除、一键清空，只是不再列出，电脑上的文件不动；
//   3. 下课保存录像后告诉老师录像在哪：绑定学生的归档到学生页，没绑定的去「窗口、录课与回放」找。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v100-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v100-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [stu], studentId: 'free', slots: [], learning: {} },
}));
// 临时课件：放在测试目录里，验证移除后文件还在
const loose = ['受力分析-例题.pdf', '牛顿第二定律.html', '课后练习.pdf'].map((n) => path.join(out, 'loose', n));
fs.mkdirSync(path.join(out, 'loose'), { recursive: true });
for (const f of loose) fs.writeFileSync(f, f.endsWith('.html') ? '<!doctype html><title>t</title><p>测试</p>' : '%PDF-1.4\n%%EOF\n');

const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v100 desktop timed out'); app.exit(1); }, 240000);

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
  const T = run(teacher, 'teacher');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const drag = async (w, pts) => {
    const [x0, y0] = pts[0];
    w.webContents.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    w.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { w.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
    const [x1, y1] = pts.at(-1); w.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }); await sleep(150);
  };
  const line = (a, b, n = 24) => Array.from({ length: n + 1 }, (_, i) => [Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n)]);

  // ── 1. 浮层工具条：超细 + 自由调粗细 ──
  await T(`s.set({page:'console',aiOpen:false});s.setShared({tool:'pen'});return true`);
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock .tp-sizes')`).catch(() => false), 8000, 'dock');
  if (process.env.CS_SHOW !== '1') dock.setPosition(left, 30);
  const D = run(dock, 'dock');
  const presets = await D(`return [...document.querySelectorAll('.tdock .tp-sizes > .tp-size:not(.tp-size-more)')].map(b=>b.getAttribute('aria-label'))`);
  assert.deepEqual(presets, ['粗细 超细', '粗细 细', '粗细 中', '粗细 粗']);
  await D(`document.querySelector('.tdock .tp-size[aria-label="粗细 超细"]').click();return true`);
  await until(() => T(`return s.size===1`), 3000, '超细 = 1');
  await D(`document.querySelector('.tdock .tp-size-more').click();return true`);
  const fly = await until(() => D(`const f=document.querySelector('.tdock .tp-size-fly');if(!f)return null;const r=f.getBoundingClientRect();return {x:r.left,y:r.top,r:r.right,b:r.bottom,w:innerWidth,h:innerHeight,marks:[...f.querySelectorAll('.tsf-marks button')].map(b=>b.innerText)}`), 3000, 'size popover');
  assert.ok(fly.x >= 0 && fly.y >= 0 && fly.r <= fly.w && fly.b <= fly.h, 'popover inside the dock window: ' + JSON.stringify(fly));
  assert.deepEqual(fly.marks, ['超细', '细', '中', '粗']);
  // React 的 range 输入监听 input 事件
  await D(`const i=document.querySelector('.tdock .tp-size-fly input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0.4');i.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  await until(() => T(`return Math.abs(s.size-0.4)<1e-6`), 3000, 'slider to 0.4');
  assert.equal(await D(`return document.querySelector('.tdock .tp-size-fly .tsf-h span').innerText`), '0.4');
  await shot(dock, 'v100-1-size-slider.png', 200);
  // 弹层外点一下关闭，再在老师画布上画一笔
  await D(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true`);
  await until(() => D(`return !document.querySelector('.tp-size-fly')`), 3000, 'popover closes');
  let prevBox = '';
  const box = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];if(!c)return null;const e=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);return e&&e.classList.contains('ink-c')?{x:c.x,y:c.y,w:c.width,h:c.height}:null`).then(async (b) => { await sleep(300); const j = JSON.stringify(b); const ok = b && j === prevBox; prevBox = j; return ok ? b : null; }), 8000, 'writable canvas');
  const P = (fx, fy) => [Math.round(box.x + box.w * fx), Math.round(box.y + box.h * fy)];
  await drag(teacher, line(P(.2, .5), P(.8, .45)));
  const pen = await until(() => T(`const p=Object.values(s.ink).flat().filter(x=>x.tool==='pen');return p.length===1?p[0]:null`), 4000, 'pen stroke');
  assert.ok(Math.abs(pen.size - 0.4) < 1e-6, 'stroke size ' + pen.size);
  await shot(teacher, 'v100-2-thin-stroke.png');
  mark('pen sizes: 超细 preset + free slider down to 0.4; the drawn stroke uses that size', { presets, size: pen.size });

  // 学生工具条同样有「超细」和滑块
  await call(student, `document.querySelector('.sbar-fab')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:3,button:0,buttons:1,clientX:10,clientY:10}));document.querySelector('.sbar-fab')?.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3,button:0,buttons:0,clientX:10,clientY:10}));true`);
  await until(() => call(student, `!!document.querySelector('.sbar .tp-size-more')`), 4000, 'student bar sizes');
  assert.ok(await call(student, `!!document.querySelector('.sbar .tp-size[aria-label="粗细 超细"]')`));
  mark('student toolbar has the same 超细 preset and slider button');

  // ── 2. 临时加入的课件：逐个移除 / 清空，不删文件 ──
  for (const f of loose) api.files.authorize(f); // 等同于老师拖进来 / 用「文件」按钮打开
  await T(`s.set({libraryOpen:true});await Q.importPaths(${JSON.stringify(loose)});return true`);
  await until(() => T(`return !!Q.useLib.getState().lib?.folders.get('loose:')`), 5000, 'loose folder');
  await until(() => T(`if(!document.querySelector('.lib-crumbs'))return false;const d=[...document.querySelectorAll('.lib-d')].find(d=>d.innerText.includes('临时加入的课件'));if(!d){document.querySelector('.lib-crumbs button').click();return false;}d.click();return true`), 5000, 'open loose folder');
  const names = () => T(`return [...document.querySelectorAll('.lib-list .lib-f .lib-t')].map(e=>e.innerText)`);
  await until(async () => (await names()).length === 3, 4000, 'three loose files listed');
  assert.ok(await T(`return /不删除电脑上的文件/.test(document.querySelector('.lib-list .lib-head')?.innerText||'')`), 'hint shown');
  await shot(teacher, 'v100-3-loose-list.png');
  await T(`const r=[...document.querySelectorAll('.lib-f')].find(f=>f.innerText.includes('课后练习'));r.querySelector('button.rm').click();return true`);
  await until(async () => { const n = await names(); return n.length === 2 && !n.some((x) => x.includes('课后练习')); }, 3000, 'one removed');
  assert.ok(fs.existsSync(loose[2]), 'file stays on disk');
  assert.equal(await T(`return JSON.parse(localStorage.getItem('cs.library.loose')).length`), 2);
  assert.ok(!(await T(`return Q.useLib.getState().lib.list.some(f=>f.title.includes('课后练习'))`)), 'not searchable any more');
  await T(`window.confirm=()=>true;[...document.querySelectorAll('.lib-crumbs button')].find(b=>b.innerText==='清空').click();return true`);
  await until(() => T(`return !Q.useLib.getState().lib.folders.get('loose:')&&JSON.parse(localStorage.getItem('cs.library.loose')).length===0`), 3000, 'cleared');
  assert.ok(loose.every((f) => fs.existsSync(f)), 'all files stay on disk');
  mark('临时加入的课件: × removes one, 清空 removes all; files on disk are untouched');

  // ── 3. 录像保存在哪 ──
  const lesson = async (studentId, title) => {
    await T(`await window.csHost.call('startLesson',{synthetic:true,title:${JSON.stringify(title)},studentId:${JSON.stringify(studentId)}});return true`);
    await until(() => api.recording.status.phase === 'recording', 20000, 'recording');
    await sleep(2600);
    await T(`await window.csHost.call('stopLesson');return true`);
    await until(() => api.recording.status.phase === 'complete' || api.recording.status.phase === 'recoverable', 60000, 'saved');
    assert.equal(api.recording.status.phase, 'complete', api.recording.status.error);
    return until(() => T(`const n=document.querySelector('.saved-notice');return n?{text:n.innerText,path:n.querySelector('code').innerText,buttons:[...n.querySelectorAll('button')].map(b=>b.innerText)}:null`), 5000, 'saved notice');
  };
  const free = await lesson('free', '自由课堂');
  assert.match(free.text, /没有绑定学生/);
  assert.match(free.text, /窗口、录课与回放/);
  assert.equal(free.path, api.recording.status.path);
  assert.deepEqual(free.buttons, ['播放', '打开文件夹', '全部录像', '关闭']);
  await shot(teacher, 'v100-4-saved-free.png');
  await T(`[...document.querySelectorAll('.saved-notice button')].find(b=>b.innerText==='全部录像').click();return true`);
  const rows = await until(() => T(`const r=[...document.querySelectorAll('.desktop-panel .record-row')];return r.length?r.map(x=>x.innerText.replace(/\\s+/g,' ')):null`), 5000, 'recordings panel');
  assert.ok(!(await T(`return !!document.querySelector('.saved-notice')`)), 'notice closes after jumping');
  assert.match(rows[0], /自由课堂/); assert.match(rows[0], /未绑定学生/);
  // 直接滚到「本地课堂回放」，不用在长面板里往下找
  await until(() => T(`const b=document.querySelector('.desktop-body').getBoundingClientRect(),r=document.querySelector('.desktop-panel .record-row').getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom`), 3000, 'recordings scrolled into view');
  await shot(teacher, 'v100-5-panel-rows.png');
  await T(`Q.useRecording.setState({panel:false});return true`);
  mark('unbound lesson: notice says where the video is and opens the full recordings list (rows marked 未绑定学生)', { free, rows });

  const bound = await lesson('stu-w', '小林 · 受力分析');
  assert.match(bound.text, /已归到「小林」的档案/);
  assert.deepEqual(bound.buttons, ['播放', '打开文件夹', '去学生页', '关闭']);
  await T(`[...document.querySelectorAll('.saved-notice button')].find(b=>b.innerText==='去学生页').click();return true`);
  await until(() => T(`return s.page==='students'&&Q.useStore.getState().studentId==='stu-w'`), 3000, 'student page');
  await until(() => T(`return [...document.querySelectorAll('.rec')].some(r=>r.innerText.includes('受力分析'))`), 5000, 'recording on student page');
  await shot(teacher, 'v100-6-student-page.png');
  mark('bound lesson: notice points to the student archive and 去学生页 shows the recording there', { bound: bound.text.replace(/\s+/g, ' ') });

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
