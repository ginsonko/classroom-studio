// 屏幕录制实测：窗口真的显示在屏幕上，用系统截屏接口（和会议软件共享屏幕同一条路）看浮层是否被拍到。
// 用法：npx electron test/capture-onscreen.cjs   （会在屏幕上弹出窗口约 15 秒）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'capture-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const { app, desktopCapturer, screen } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw Error('Timed out'); };
const results = []; const mark = (name, d = {}) => { results.push({ name, ...d }); console.log('PASS ' + name, JSON.stringify(d)); };
const timer = setTimeout(() => { console.error('capture test timed out'); app.exit(1); }, 90000);

/** 截整块屏幕（物理像素），返回 NativeImage */
async function grabScreen(display) {
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })).find((s) => String(s.display_id) === String(display.id)) ?? (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }))[0];
  return src.thumbnail;
}
async function grabWindow(title) {
  const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 } });
  return srcs.find((s) => s.name.includes(title))?.thumbnail ?? null;
}
/** 区域里像素的平均差异（0-255），用来判断两张截图在浮层位置是否一样 */
function diff(a, b, rect) {
  const A = a.crop(rect).toBitmap(), B = b.crop(rect).toBitmap();
  let s = 0; for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
  return s / (A.length / 4) / 3;
}
/** 区域内是否接近纯黑（老系统上被保护的窗口会显示成黑块） */
function darkShare(img, rect) {
  const A = img.crop(rect).toBitmap(); let dark = 0;
  for (let i = 0; i < A.length; i += 4) if (A[i] + A[i + 1] + A[i + 2] < 30) dark++;
  return dark / (A.length / 4);
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const display = screen.getPrimaryDisplay(), wa = display.workArea, k = display.scaleFactor;
  teacher.setBounds({ x: wa.x + 20, y: wa.y + 20, width: Math.min(1100, wa.width - 40), height: Math.min(700, wa.height - 40) }); teacher.show();
  student.setBounds({ x: wa.x + 120, y: wa.y + 60, width: Math.min(1100, wa.width - 160), height: Math.min(700, wa.height - 100) }); student.show();
  // 这台电脑可能有人在用：置顶，免得别的窗口切到前面挡住被测区域
  teacher.setAlwaysOnTop(true, 'screen-saver'); student.setAlwaysOnTop(true, 'screen-saver');
  const dock = await api.dock.ensure(); assert.ok(dock, 'dock not created');
  dock.setAlwaysOnTop(true, 'screen-saver');
  await until(() => dock.isVisible(), 8000); await sleep(1500);
  const db = dock.getBounds();
  // 浮层左侧窄栏所在的屏幕区域（物理像素）
  const rail = { x: Math.round((db.x + 16 - display.bounds.x) * k), y: Math.round((db.y + 16 - display.bounds.y) * k), width: Math.round(80 * k), height: Math.round(300 * k) };

  // 1) 防截屏关闭（默认）：整屏截图里能看到浮层
  assert.equal(api.settings.captureGuard, false);
  const off = await grabScreen(display); fs.writeFileSync(path.join(out, 'screen-guard-off.png'), off.toPNG());
  // 2) 防截屏开启：浮层从屏幕录制里消失（或变黑块）
  await teacher.webContents.executeJavaScript(`window.csHost.call('setSettings',{captureGuard:true})`); await sleep(1200);
  const on = await grabScreen(display); fs.writeFileSync(path.join(out, 'screen-guard-on.png'), on.toPNG());
  // 3) 关回去
  await teacher.webContents.executeJavaScript(`window.csHost.call('setSettings',{captureGuard:false})`); await sleep(1200);
  const back = await grabScreen(display); fs.writeFileSync(path.join(out, 'screen-guard-off-again.png'), back.toPNG());
  fs.writeFileSync(path.join(out, 'rail-off.png'), off.crop(rail).toPNG()); fs.writeFileSync(path.join(out, 'rail-on.png'), on.crop(rail).toPNG());
  const dOn = diff(off, on, rail), dBack = diff(off, back, rail), black = darkShare(on, rail);
  mark('screen capture: dock visible when guard off, hidden/blacked when on', { diffOn: +dOn.toFixed(1), diffBack: +dBack.toFixed(1), blackShareOn: +black.toFixed(2) });
  assert.ok(dOn > 8, 'turning protection on did not change what screen capture sees');
  assert.ok(dBack < dOn / 2, 'turning protection off did not restore the dock in capture');

  // 4) 只共享学生窗口：浮层是另一个窗口，不会出现在学生窗口的画面里
  const sw = await grabWindow('课堂展示');
  if (sw) { fs.writeFileSync(path.join(out, 'share-student-window.png'), sw.toPNG()); mark('window share of the student window captured (see image)', { size: sw.getSize() }); }
  else mark('window share source not listed (skipped)');

  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: e.stack, results, out }, null, 2)); console.error(e); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
