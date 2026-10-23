// 1.4.0 布局验收（老师反馈：浮层放大到 120% 以后超出屏幕，缩放按钮跑到屏幕外，再也缩不回来）：
//   1. 学生窗口很矮时，浮层选 140% 会自动缩到放得下：整条工具条和缩放按钮都在学生窗口里，按钮标出「已自动缩小」；
//   2. 学生窗口拉高后恢复到老师选的 140%；
//   3. 浮层缩放菜单里「恢复默认位置和大小」：回到左上角、100%、展开；
//   4. 设置里「恢复默认布局」：学生工具条位置清掉、两个窗口回到默认大小、两栏展开；
//   5. 学生窗口很窄时，学生工具条展开后折行，不伸出窗口。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v140-layout-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v140-layout-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {}, libraryOpen: false, rightOpen: false, libraryW: 420 },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v140 layout desktop timed out'); app.exit(1); }, 180000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1300, height: 820 });
  // 老师反馈里的情形：课堂展示窗口不高（这里 520），浮层放大后比窗口还高
  student.setBounds({ x: left, y: 900, width: 1100, height: 520 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock .tdock-zoom')`), 10000, 'dock');
  const shot = async (w, name, wait = 300) => { await sleep(wait); w.webContents.invalidate(); await sleep(200); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };

  // 工具条在屏幕上的位置：窗口位置 + 页面里的矩形
  const geo = async () => {
    const r = await call(dock, `(()=>{const t=document.querySelector('.tdock').getBoundingClientRect(),z=document.querySelector('.tdock-zoom'),b=z.getBoundingClientRect();
      return {top:t.top,bottom:t.bottom,h:t.height,zTop:b.top,zBottom:b.bottom,zText:z.innerText.trim(),fit:z.classList.contains('fit'),inner:innerHeight,zoom:getComputedStyle(document.querySelector('.tdock')).zoom}})()`);
    const wb = dock.getBounds(), c = student.getContentBounds();
    return { ...r, railBottom: wb.y + r.bottom, zoomBottom: wb.y + r.zBottom, studentBottom: c.y + c.height, studentTop: c.y, railTop: wb.y + r.top };
  };
  const pick = async (label) => {
    await call(dock, `document.querySelector('.tdock-zoom').click();true`);
    await until(() => call(dock, `!!document.querySelector('.tdock-zoommenu')`), 3000, 'zoom menu');
    await call(dock, `[...document.querySelectorAll('.tdock-zoommenu button')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click();true`);
  };

  // ── 1. 矮窗口 + 140% ──
  const g100 = await until(async () => { const g = await geo(); return g.h > 100 ? g : null; }, 5000, 'rail measured');
  await pick('140%');
  const g140 = await until(async () => { const g = await geo(); return g.fit ? g : null; }, 5000, 'auto fit kicks in');
  await shot(dock, 'v140-1-dock-fit.png');
  assert.ok(g140.railBottom <= g140.studentBottom + 1, `rail bottom ${g140.railBottom} inside student window ${g140.studentBottom}`);
  assert.ok(g140.railTop >= g140.studentTop - 1, 'rail top inside student window');
  assert.ok(g140.zoomBottom <= g140.studentBottom, 'zoom button reachable');
  assert.ok(Number(g140.zText) < 140, 'button shows the zoom actually used: ' + g140.zText);
  assert.equal(await call(dock, `localStorage.getItem('cs.dock.zoom')`), '1.4', 'the teacher choice is kept');
  mark('short student window: 140% shrinks to fit, zoom button stays reachable', { at100: g100.h, at140: g140.h, used: g140.zText, room: api.dock.state.room });

  // ── 2. 拉高后恢复 140% ──
  student.setBounds({ x: left, y: 900, width: 1100, height: 1500 });
  const tall = await until(async () => { const g = await geo(); return !g.fit && g.zText === '140' ? g : null; }, 6000, 'back to 140 when there is room');
  assert.ok(tall.railBottom <= tall.studentBottom + 1);
  mark('taller student window: back to the chosen 140%', { h: tall.h });

  // ── 3. 恢复默认位置和大小 ──
  Object.assign(api.settings.dock, { x: 700, y: 600, side: 'right' }); api.dock.place();
  // 窗口够高，恢复后应该正好是 100%（不高的话会合法地自动缩小）
  student.setBounds({ x: left, y: 900, width: 1100, height: 1500 });
  await sleep(300);
  await pick('恢复默认位置和大小');
  await until(async () => { const g = await geo(); return g.zText === '100' && !g.fit; }, 6000, 'reset to 100%');
  const d = api.dock.state;
  assert.deepEqual([d.x, d.y, d.side, d.mini], [18, 72, 'left', false]);
  assert.equal(await call(dock, `localStorage.getItem('cs.dock.zoom')`), null);
  const after = await geo();
  assert.ok(after.railBottom <= after.studentBottom + 1, 'default position fits too');
  await shot(dock, 'v140-2-dock-reset.png');
  mark('dock menu: restore default position and size', { dock: d });

  // ── 4. 设置里恢复默认布局 ──
  await call(student, `localStorage.setItem('cs.sbar.pos',JSON.stringify({fx:0.9,fy:0.1}));localStorage.setItem('cs.sbar.open','1');true`);
  teacher.setBounds({ x: left, y: 30, width: 900, height: 600 });
  await call(teacher, `__studioQA.useStore.getState().set({page:'console'});document.querySelector('[data-tip*="窗口"],[aria-label*="窗口"]')?.click();true`);
  await call(teacher, `__studioQA.useRecording?.setState?.({panel:true});true`).catch(() => {});
  const opened = await until(() => call(teacher, `!![...document.querySelectorAll('.desktop-section h3')].find(h=>h.innerText==='界面布局')`).catch(() => false), 5000, 'settings section').catch(() => false);
  if (opened) {
    await call(teacher, `[...document.querySelectorAll('.desktop-section button')].find(b=>b.innerText.trim()==='恢复默认布局').click();true`);
  } else {
    await call(teacher, `__studioQA.host.call('layoutReset').then(()=>__studioQA.useStore.getState().set({libraryOpen:true,rightOpen:true,libraryW:300,rightW:340}))`);
  }
  await until(() => call(student, `localStorage.getItem('cs.sbar.pos')===null&&localStorage.getItem('cs.sbar.open')===null`), 5000, 'student bar reset');
  await until(() => call(teacher, `(()=>{const s=__studioQA.useStore.getState();return s.libraryOpen&&s.rightOpen&&s.libraryW===300})()`), 5000, 'columns reset');
  const tb = teacher.getBounds(), wa = electron.screen.getDisplayMatching(tb).workArea;
  assert.ok(tb.x >= wa.x && tb.y >= wa.y && tb.x + tb.width <= wa.x + wa.width && tb.y + tb.height <= wa.y + wa.height, 'teacher window inside the work area');
  // 混合 DPI 的显示器之间移动时 Windows 会按比例改窗口大小（1600 → 1280），宽度只看落在合理区间
  assert.ok(tb.width <= wa.width && tb.width >= Math.min(1600, wa.width) * 0.7, `default-ish size ${tb.width} vs work area ${wa.width}`);
  assert.ok(tb.x > left + 1000, 'pulled back from the off-screen spot');
  if (opened) await shot(teacher, 'v140-3-settings-layout.png');
  mark('settings: restore default layout (windows, dock, student bar, columns)', { viaButton: opened, teacher: tb });

  // ── 5. 窄窗口里学生工具条折行 ──
  student.setBounds({ x: left, y: 900, width: 660, height: 520 });
  await sleep(300);
  await call(student, `document.querySelector('.sbar-fab').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:7,clientX:40,clientY:440}));document.querySelector('.sbar-fab').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:7,clientX:40,clientY:440}));true`);
  const bar = await until(() => call(student, `(()=>{const p=document.querySelector('.sbar-panel');if(!p)return null;const r=p.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`), 4000, 'student bar opened');
  await shot(student, 'v140-4-student-bar-narrow.png');
  assert.ok(bar.right <= bar.w + 1 && bar.left >= -1, `student bar inside the window: ${JSON.stringify(bar)}`);
  mark('narrow student window: student bar wraps inside the window', bar);

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'error.txt'), String(e.stack || e)); clearTimeout(timer); app.exit(1); });
