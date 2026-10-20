// 1.2.0 学生窗口贴图桌面验收（屏幕外窗口）：
//   1. 剪贴板里是位图（QQ 截图）：网页粘贴事件拿不到时，主进程兜底读出来；
//   2. 剪贴板里是图片文件（微信里右键「复制」图片）；
//   3. 学生拿着笔、学生工具开放：贴的图算学生的，老师那边同步看到；
//   4. 学生工具锁定：不贴，并在学生窗口上给出提示；剪贴板没有图片也有提示；
//   5. 把图片文件拖进学生窗口。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v120-paste-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v120v-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });

const electron = require('electron'); const { app, BrowserWindow, clipboard, nativeImage, ClipboardItem } = electron;
const { execFileSync } = require('node:child_process');
const putImage = () => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png.toPNG()], { type: 'image/png' }) })]); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v120 paste desktop timed out'); app.exit(1); }, 180000);

// 一张 240×120 的测试图（红底），存成文件，模拟微信复制出来的图片文件
const png = (() => { const w = 240, h = 120, buf = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) buf.set([40, 40, 220, 255], i * 4); return nativeImage.createFromBitmap(buf, { width: w, height: h }); })();
const imgFile = path.join(out, '微信图片_20261020223101.png'); fs.writeFileSync(imgFile, png.toPNG());

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await call(teacher, `window.csHost.call('student')`);
  const student = await until(() => api.windows.get('student'), 15000, 'student window');
  await until(() => call(student, '!!window.__studioQA'), 15000, 'student ready');
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1280, height: 800 }); student.setBounds({ x: left, y: 860, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  const images = (who) => who(`const st=Q.useStore.getState(),k=Q.inkKey(st.pgm.materialId,st.pgm.page);return (st.ink[k]||[]).filter(x=>x.tool==='image').map(x=>({id:x.id,author:x.author,img:x.img}))`);
  // 合成一次粘贴：clipboardData 里什么都没有（和微信复制文件时网页看到的一样），只能靠主进程兜底
  const paste = () => S(`window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true}));return true`);

  // 1. 老师拿着笔，剪贴板里是位图
  clipboard.clear(); await putImage();
  await paste();
  const a = await until(async () => { const x = await images(T); return x.length === 1 ? x : null; }, 10000, 'bitmap pasted, teacher sees it');
  assert.equal(a[0].author, 'teacher');
  mark('bitmap on the clipboard (QQ screenshot) pastes from the student window while the teacher holds the pen', { img: a[0].img.slice(0, 30) });

  // 2. 剪贴板里是图片文件（Windows 的 FileNameW；mac 上跳过）
  if (process.platform === 'win32') {
    // 和资源管理器 / 微信「复制」文件一样，系统剪贴板里只有文件（CF_HDROP），没有位图
    execFileSync('powershell', ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath '${imgFile}'`]);
    assert.equal(await clipboard.has('image/png'), false, 'only a file, no bitmap');
    await paste();
    await until(async () => (await images(T)).length === 2, 10000, 'file pasted');
    mark('copied image file (WeChat right-click copy) pastes via the main-process clipboard fallback');
  }

  // 3. 学生拿笔（学生工具开放）
  await T(`s.setShared({studentTools:'open',drawAuthor:'student'});return true`);
  await until(() => S(`return Q.useStore.getState().drawAuthor==='student'`), 5000, 'student holds pen');
  clipboard.clear(); await putImage();
  await paste();
  const c = await until(async () => { const x = await images(T); return x.length === (process.platform === 'win32' ? 3 : 2) ? x : null; }, 10000, 'student paste');
  assert.equal(c.at(-1).author, 'student');
  mark('student holding the pen (tools open) can paste; the image is the student\'s and syncs to the teacher', { authors: c.map((x) => x.author) });

  // 4. 锁定学生工具：不贴、有提示；剪贴板为空也有提示
  await T(`s.setShared({studentTools:'locked'});return true`);
  await until(() => S(`return Q.useStore.getState().studentTools==='locked'`), 5000, 'locked');
  await paste();
  const locked = await until(() => S(`return document.querySelector('.sw-msg')?.innerText||''`), 5000, 'locked message');
  assert.match(locked, /锁定/);
  assert.equal((await images(T)).length, c.length, 'nothing pasted while locked');
  await T(`s.setShared({studentTools:'open',drawAuthor:'teacher'});return true`);
  await until(() => S(`return Q.useStore.getState().drawAuthor==='teacher'`), 5000, 'pen back');
  await S(`document.querySelector('.sw-msg')&&(document.querySelector('.sw-msg').innerText='');return true`);
  clipboard.clear();
  await paste();
  const empty = await until(() => S(`const t=document.querySelector('.sw-msg')?.innerText||'';return /没有图片/.test(t)?t:''`), 5000, 'empty clipboard message');
  mark('locked tools and empty clipboard show a message on the student window instead of failing silently', { locked, empty });

  // 5. 拖入图片文件
  const before = (await images(T)).length;
  await S(`const b=atob(${JSON.stringify(png.toPNG().toString('base64'))}),u=Uint8Array.from(b,c=>c.charCodeAt(0));const f=new File([u],'drag.png',{type:'image/png'});
    const dt=new DataTransfer();dt.items.add(f);const el=document.querySelector('.sw');
    el.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));el.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return true`);
  await until(async () => (await images(T)).length === before + 1, 10000, 'dropped image');
  await sleep(400); student.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, 'student.png'), (await student.webContents.capturePage()).toPNG());
  mark('dragging an image file onto the student window pastes it to the board');

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const s = globalThis.classroomStudioTest?.windows.get('student'); if (s) fs.writeFileSync(path.join(out, 'failure.png'), (await s.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
