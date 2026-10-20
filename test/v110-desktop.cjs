// 1.1.0 桌面验收（屏幕外窗口，不动真实鼠标）：
//   1. 录像：下课后回放在后台生成，不挡下一节；「下一节」连堂切换；生成完删掉原始 WebM；回放页能看占用、删除；
//      录课中关学生窗口会问「下课并保存」，选了就直接关；
//   2. 截图：Ctrl+V 粘贴 / 直接调用都贴成黑板上的贴图，学生窗口同步看到；图上和周围都能写字，橡皮不会擦掉图；
//   3. 框选截屏：截整屏 → 在截图上框选 → 裁剪后贴到黑板；
//   4. 设置里有「添加桌面快捷方式」。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v110-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v110-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [stu], studentId: 'stu-w', slots: [], learning: {} },
}));

const electron = require('electron'); const { app, BrowserWindow } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
// 录课中关学生窗口会弹系统对话框：测试里记下问了什么，并选「下课并保存录像」
const asked = [];
electron.dialog.showMessageBox = async (_w, o) => { asked.push(o.message); return { response: /还在录像/.test(o.message) ? 1 : 0 }; };
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v110 desktop timed out'); app.exit(1); }, 300000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  let student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = () => run(api.windows.get('student'), 'student');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const drag = async (w, pts) => {
    const [x0, y0] = pts[0];
    w.webContents.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
    w.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { w.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
    const [x1, y1] = pts.at(-1); w.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }); await sleep(150);
  };
  const line = (a, b, n = 24) => Array.from({ length: n + 1 }, (_, i) => [Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n)]);
  await T(`s.set({page:'console',aiOpen:false});s.setShared({tool:'pen'});return true`);

  // ── 1. 录像：后台生成 + 下一节 + 回放页 ──（CS_SKIP_REC=1 跳过，调试后面几节用）
  if (process.env.CS_SKIP_REC !== '1') {
  await T(`await window.csHost.call('startLesson',{synthetic:true,title:'第一节',studentId:'stu-w'});return true`);
  await until(() => api.recording.status.phase === 'recording', 20000, 'recording 1');
  await sleep(2600);
  assert.ok(await T(`return !!document.querySelector('.tb-next')`), '下一节 button while recording');
  const firstId = api.recording.status.id;
  await T(`document.querySelector('.tb-next').click();return true`);
  await until(() => api.recording.status.phase === 'recording' && api.recording.status.id !== firstId, 30000, 'second lesson recording');
  const secondId = api.recording.status.id;
  // 第一节的回放在后台生成（可能已经生成完了：合成录像很短），但第二节已经在录
  const rows1 = await T(`return await window.csHost.call('recordings')`);
  assert.ok(rows1.some((r) => r.id === firstId), 'first lesson listed');
  await until(async () => (await T(`return await window.csHost.call('recordings')`)).find((r) => r.id === firstId)?.phase === 'complete', 60000, 'first lesson mp4');
  await sleep(2600);
  // 下课：阶段马上到 saved（不再是「正在保存…」挡着），然后后台生成完变 complete
  const phases = new Set();
  const watch = setInterval(() => phases.add(api.recording.status.phase), 20);
  await T(`await window.csHost.call('stopLesson');return true`);
  await until(() => api.recording.status.phase === 'complete', 60000, 'second lesson complete');
  clearInterval(watch);
  assert.ok(phases.has('saved'), 'saved phase seen: ' + [...phases].join(','));
  assert.ok(!phases.has('converting'), 'no blocking converting phase');
  const rows = await T(`return await window.csHost.call('recordings')`);
  for (const id of [firstId, secondId]) {
    const r = rows.find((x) => x.id === id); assert.ok(r, 'row ' + id); assert.equal(r.phase, 'complete');
    assert.ok(fs.statSync(r.mp4).size > 5000, 'mp4 has data'); assert.ok(!fs.existsSync(r.raw), 'raw webm removed after mp4');
  }
  mark('recording: 下一节 switches lessons instantly, MP4s are made in the background, raw WebM deleted afterwards', { phases: [...phases] });

  await until(() => T(`const n=document.querySelector('.saved-notice');return n&&/回放已生成/.test(n.innerText)`), 5000, 'saved notice');
  await T(`[...document.querySelectorAll('.saved-notice button')].find(b=>b.innerText==='全部回放').click();return true`);
  await until(() => T(`return s.page==='replay'||Q.useStore.getState().page==='replay'`), 3000, 'replay page');
  const page = await until(() => T(`const r=[...document.querySelectorAll('.rp-row')];const d=document.querySelector('.rp-disk');return r.length===2&&d?{rows:r.map(x=>x.innerText.replace(/\\s+/g,' ')),disk:d.innerText.replace(/\\s+/g,' ')}:null`), 6000, 'replay rows');
  assert.match(page.disk, /保存位置/); assert.match(page.disk, /还剩/);
  assert.ok(page.rows.every((r) => /小林/.test(r) && /MP4 已生成/.test(r)), page.rows.join('\n'));
  await shot(teacher, 'v110-1-replay.png');
  const info = await T(`return await window.csHost.call('recordingsInfo')`);
  assert.equal(info.count, 2); assert.ok(info.used > 10000);
  await T(`window.confirm=()=>true;[...document.querySelectorAll('.rp-row')][1].querySelector('button[aria-label="删除"]').click();return true`);
  await until(() => T(`return document.querySelectorAll('.rp-row').length===1`), 6000, 'one row after delete');
  const left1 = await T(`return await window.csHost.call('recordings')`);
  assert.equal(left1.length, 1);
  assert.ok(!fs.existsSync(rows.find((r) => r.id === firstId).folder), 'deleted folder is gone');
  mark('replay page: shows disk usage and per-lesson rows; delete removes the recording', { info: { count: info.count, used: info.used } });

  // 录课中关学生窗口：问一句，选「下课并保存录像」就保存并关窗口
  await T(`s.set({page:'console'});await window.csHost.call('startLesson',{synthetic:true,title:'第三节',studentId:'stu-w'});return true`);
  await until(() => api.recording.status.phase === 'recording', 20000, 'recording 3');
  await sleep(2600);
  api.windows.get('student').close();
  await until(() => !api.windows.get('student'), 30000, 'student window closed after saving');
  assert.ok(asked.some((m) => /还在录像/.test(m)), 'asked: ' + asked.join(' | '));
  await until(() => api.recording.status.phase === 'complete', 60000, 'third lesson complete');
  mark('closing the student window during a lesson asks once, then saves and closes without waiting for the MP4', { asked });
  await T(`await window.csHost.call('student');return true`);
  await until(() => api.windows.get('student'), 10000, 'student reopened');
  student = api.windows.get('student'); student.setBounds({ x: left, y: 960, width: 1280, height: 720 }); student.showInactive();
  await until(() => call(student, '!!window.__studioQA'), 10000, 'student ready');
  }

  // ── 2. 粘贴截图 ──
  await T(`s.focusWin('board');s.clearInk(Q.inkKey('board',0));return true`);
  // 页面 CSP 不允许 fetch(data:)：直接从画布拿 Blob
  const blob = (w, h, color) => `await new Promise(r=>{const c=document.createElement('canvas');c.width=${w};c.height=${h};const x=c.getContext('2d');x.fillStyle='${color}';x.fillRect(0,0,${w},${h});c.toBlob(r,'image/png');})`;
  const png = (w, h, color) => `(()=>{const c=document.createElement('canvas');c.width=${w};c.height=${h};const x=c.getContext('2d');x.fillStyle='${color}';x.fillRect(0,0,${w},${h});x.fillStyle='#fff';x.font='bold 60px sans-serif';x.fillText('截图 ${w}x${h}',30,90);return c.toDataURL('image/png');})()`;
  await T(`await Q.paste.pasteToBoard(${png(1200, 260, '#1d4ed8')});return true`);
  const img1 = await until(() => T(`const k=Q.inkKey('board',0);const a=(Q.useStore.getState().ink[k]||[]).filter(x=>x.tool==='image');return a.length===1?a[0]:null`), 5000, 'image stroke');
  assert.match(img1.img, /^lesson:/);
  const [x0, y0, , x1, y1] = img1.pts;
  assert.ok(Math.abs((x1 - x0) / (y1 - y0) - 1200 / 260) < 0.05, 'keeps aspect');
  assert.ok(x1 - x0 >= 0.5 - 1e-9 && x1 - x0 <= 0.8 + 1e-9, 'wide screenshot is at least half the board: ' + (x1 - x0));
  assert.ok(y1 < 0.5625, 'fits on the board');
  assert.ok(await T(`return Q.useToast.getState().list.some(t=>/贴到黑板/.test(t.message))`), 'toast shown');
  // Ctrl+V：浏览器的 paste 事件里带图片文件
  await T(`const b=${blob(500, 400, '#047857')};const dt=new DataTransfer();dt.items.add(new File([b],'shot.png',{type:'image/png'}));document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}));return true`);
  await until(() => T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.tool==='image').length===2`), 5000, 'pasted image');
  // 输入框里粘贴不贴图
  await T(`const i=document.createElement('input');document.body.appendChild(i);const b=${blob(100, 100, '#000')};const dt=new DataTransfer();dt.items.add(new File([b],'x.png',{type:'image/png'}));i.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}));i.remove();return true`);
  await sleep(800);
  assert.equal(await T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.tool==='image').length`), 2, 'paste into an input is left alone');
  // 学生窗口同步看到，图片真的画出来了
  await until(() => run(student, 'student')(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.tool==='image').length===2`), 5000, 'student sees images');
  const blue = await until(() => run(student, 'student')(`const w=[...document.querySelectorAll('.ink')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];const c=w.querySelector('canvas');const k=Q.useStore.getState().ink[Q.inkKey('board',0)].find(x=>x.tool==='image');const px=c.getContext('2d').getImageData(Math.round((k.pts[0]+0.01)*c.width),Math.round((k.pts[1]+0.01)*c.width),1,1).data;return px[2]>180&&px[0]<80?[...px]:null`), 8000, 'student canvas draws the image');
  // 在图上和图下面写字
  const box = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null`), 5000, 'canvas');
  const P = (fx, fy) => [Math.round(box.x + box.w * fx), Math.round(box.y + box.h * fy)];
  const cy = ((y0 + y1) / 2) / 0.5625;
  await drag(teacher, line(P(.3, cy), P(.6, cy)));
  await drag(teacher, line(P(.2, .92), P(.7, .9)));
  await until(() => T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.tool==='pen').length===2`), 4000, 'two pen strokes');
  // 橡皮（整笔模式）擦过图片：笔迹没了，图还在
  await T(`s.setShared({tool:'eraser',inkOptions:{...s.inkOptions,eraserMode:'stroke'}});return true`);
  await sleep(200);
  await drag(teacher, line(P(.25, cy), P(.65, cy)));
  await until(() => T(`const a=Q.useStore.getState().ink[Q.inkKey('board',0)]||[];return a.filter(x=>x.tool==='pen').length===1&&a.filter(x=>x.tool==='image').length===2`), 4000, 'eraser keeps images');
  await T(`s.setShared({tool:'pen',inkOptions:{...s.inkOptions,eraserMode:'segment'}});return true`);
  await shot(teacher, 'v110-2-paste.png');
  await shot(student, 'v110-3-student-paste.png');
  mark('paste: Ctrl+V and pasteToBoard put screenshots on the board as images; students see them; ink works on and around them; eraser leaves images', { img: img1.pts, blue });

  // ── 3. 框选截屏 ──
  const before = await T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.tool==='image').length`);
  await T(`window.__snip=Q.paste.snipToBoard().then(id=>({id}),e=>({err:String(e.message)}));return true`);
  const snipWin = await until(() => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /snip\.html/.test(w.webContents.getURL()) && w.isVisible()), 15000, 'snip window');
  await until(() => call(snipWin, `document.getElementById('shot').complete&&document.getElementById('shot').naturalWidth>0`), 8000, 'screenshot shown');
  await call(snipWin, `window.snip.done({x:40,y:60,width:320,height:180,viewW:innerWidth,viewH:innerHeight});true`);
  const snipped = await until(() => T(`return window.__snip&&Promise.race([window.__snip,new Promise(r=>setTimeout(()=>r(null),50))])`), 15000, 'snip result');
  assert.ok(!snipped.err, snipped.err);
  const imgs = await T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.tool==='image')`);
  assert.equal(imgs.length, before + 1);
  const last = imgs.find((x) => x.id === snipped.id);
  assert.ok(Math.abs((last.pts[3] - last.pts[0]) / (last.pts[4] - last.pts[1]) - 320 / 180) < 0.08, 'snip keeps the selected aspect');
  assert.ok(teacher.getOpacity() === 1, 'teacher window visible again');
  // 取消：右键 / Esc 什么都不贴
  await T(`window.__snip=Q.paste.snipToBoard().then(id=>({id}),e=>({err:String(e.message)}));return true`);
  const snip2 = await until(() => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /snip\.html/.test(w.webContents.getURL()) && w.isVisible()), 15000, 'snip window 2');
  await call(snip2, `window.snip.cancel();true`);
  const cancelled = await until(() => T(`return window.__snip&&Promise.race([window.__snip,new Promise(r=>setTimeout(()=>r(null),50))])`), 15000, 'cancel result');
  assert.equal(cancelled.id, null);
  mark('screen snip: full-screen capture overlay, drag a box, the crop is pasted to the board; cancel pastes nothing');

  // ── 4. 桌面快捷方式按钮 ──
  await T(`Q.useRecording.setState({panel:true});return true`);
  const sc = await until(() => T(`const h=[...document.querySelectorAll('.desktop-section h3')].find(h=>/桌面快捷方式|应用程序/.test(h.innerText));return h?h.parentElement.innerText.replace(/\\s+/g,' '):null`), 5000, 'shortcut section');
  assert.match(sc, process.platform === 'darwin' ? /应用程序/ : /快捷方式/);
  const state = await T(`return await window.csHost.call('shortcut.state')`);
  assert.equal(state.platform, process.platform);
  await shot(teacher, 'v110-5-settings.png');
  await T(`Q.useRecording.setState({panel:false});return true`);
  mark('settings has an 添加桌面快捷方式 / 移到应用程序 button', { sc, state });

  // ── 5. 绘图库：各学科都有，顶栏 / 浮层的学科标签能切，自由课堂记住学科 ──
  await T(`s.set({studentId:'free'});s.focusWin('board');s.clearInk(Q.inkKey('board',0));return true`);
  await until(() => T(`return s.subject==='physics'`), 5000, 'free classroom starts as physics');
  await T(`document.querySelector('.tb-subj').click();return true`);
  await until(() => T(`return !!document.querySelector('.subj-pop')`), 5000, 'subject popover');
  await T(`const row=[...document.querySelectorAll('.subj-level')].find(r=>r.querySelector('i').innerText==='高中');[...row.querySelectorAll('button')].find(b=>b.innerText==='数学').click();return true`);
  await until(() => T(`return s.subject==='math'&&s.freeSubject==='math'`), 5000, 'switched to math');
  await T(`s.set({studentId:'stu-w'});return true`);
  await until(() => T(`return s.subject==='physics'`), 5000, 'student subject');
  await T(`s.set({studentId:'free'});return true`);
  await until(() => T(`return s.subject==='math'`), 5000, 'free classroom remembers math');
  await api.dock.ensure(); const dock = api.windows.get('dock'); const D = run(dock, 'dock');
  await until(() => call(dock, '!!window.__studioQA&&!!document.querySelector(".tdock-subj")').catch(() => false), 15000, 'dock ready');
  await until(() => D(`return s.subject==='math'`), 5000, 'dock subject');
  assert.match(await D(`return document.querySelector('.tdock-subj').innerText`), /数学/);
  assert.equal(await D(`return [...document.querySelectorAll('.tdock [aria-label]')].some(b=>/^力 /.test(b.getAttribute('aria-label')))`), false, 'math dock has no force tool');
  await D(`document.querySelector('[aria-label="绘图库"]').click();return true`);
  await until(() => D(`return !!document.querySelector('.obj-pop .obj-libs')`), 5000, 'drawing library');
  assert.equal(await D(`return document.querySelector('.obj-libs .on').innerText`), '数学图形');
  await D(`[...document.querySelectorAll('.obj-tabs button')].find(b=>b.innerText==='立体图形').click();return true`);
  await D(`document.querySelector('.obj-tile[aria-label="放置圆锥"]').click();return true`);
  await until(() => T(`return s.tool==='obj'&&s.objKind==='m-cone'`), 5000, 'cone picked');
  const box2 = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null`), 5000, 'canvas');
  const P2 = (fx, fy) => [Math.round(box2.x + box2.w * fx), Math.round(box2.y + box2.h * fy)];
  await drag(teacher, line(P2(.1, .15), P2(.3, .5)));
  const cone = await until(() => T(`return (s.ink[Q.inkKey('board',0)]||[]).find(x=>x.obj&&x.obj.kind==='m-cone')?.obj||null`), 5000, 'cone placed');
  const coneDefault = await T(`const c=Q.objects.OBJECT_CATALOG['m-cone'];return c.h/c.w`);
  assert.ok(Math.abs(cone.h / cone.w - coneDefault) < .02 && cone.w > .15, 'cone keeps its proportions: ' + JSON.stringify(cone));
  // 改参数：圆锥的高变了，外框跟着变高
  await T(`const k=Q.inkKey('board',0),x=s.ink[k].find(x=>x.obj&&x.obj.kind==='m-cone');s.editInk(k,{upsert:[Q.withObject(x,Q.objects.updateObject(x.obj,{props:{...x.obj.props,H:3}}))]});return true`);
  const taller = await T(`return s.ink[Q.inkKey('board',0)].find(x=>x.obj&&x.obj.kind==='m-cone').obj`);
  assert.ok(taller.h > cone.h * 1.2, 'aspect follows the height parameter');
  // 数学课的三角形不带斜面阴影线，坐标系默认 x、y
  await T(`s.setShared({tool:'triangle'});return true`); await sleep(150);
  await drag(teacher, line(P2(.5, .2), P2(.7, .45)));
  await T(`s.setShared({tool:'axes'});return true`); await sleep(150);
  await drag(teacher, line(P2(.75, .45), P2(.95, .15)));
  const shapes = await until(() => T(`const a=s.ink[Q.inkKey('board',0)]||[];const t=a.find(x=>x.tool==='triangle'),ax=a.find(x=>x.tool==='axes');return t&&ax?{t:t.shape,ax:ax.text}:null`), 4000, 'shapes');
  assert.deepEqual(shapes, { t: 'plain', ax: 'x,y' });
  await shot(teacher, 'v110-6-math-board.png');
  // 全部数学图形和化学仪器各铺一页，学生窗口截图看画法
  const gallery = async (lib, cols, rows, name) => {
    await T(`const k=Q.inkKey('board',0);s.clearInk(k);const items=Q.objects.OBJECTS.filter(o=>Q.objects.libOfKind(o.kind)==='${lib}');const cw=1/${cols},ch=0.5625/${rows};
      items.forEach((it,i)=>{const cx=(i%${cols}+.5)*cw,cy=(Math.floor(i/${cols})+.42)*ch;const o=Q.objects.createObject(it.kind,cx,cy);const k2=Math.min(cw*.8/o.w,ch*.66/o.h);o.w*=k2;o.h*=k2;o.label=it.name;
        s.addStroke(k,Q.withObject({id:'g'+i,tool:'obj',color:'ink',size:3,pts:[cx,cy,.5],author:'teacher',layer:'public'},o));});return items.length`);
    await until(() => run(student, 'student')(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).length>3`), 5000, 'student gallery');
    await shot(student, name, 700);
  };
  await gallery('math', 6, 4, 'v110-7-math-gallery.png');
  await gallery('chem', 6, 3, 'v110-8-chem-gallery.png');
  await T(`s.clearInk(Q.inkKey('board',0));s.setShared({tool:'pen'});return true`);
  mark('drawing library: subject tag switches subjects (free classroom remembers it); math/chem libraries render and place with proportions; math triangle/axes are plain', { cone, shapes });

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
