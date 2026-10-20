// 课堂动画引擎桌面验收：载入样片，抽查若干帧确实画出了内容且在动，导出两小段 MP4（一段带配乐）验证编码封装。
// 用法：npx electron test/quiet.cjs test/v120-motion-desktop.cjs   （用 .out/dist-me 里的 motion.html；CS_DIST 可换）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'motion-' + Date.now()); fs.mkdirSync(out, { recursive: true });
const { app, BrowserWindow } = require('electron'); const errors = []; const results = [];
app.commandLine.appendSwitch('ignore-gpu-blocklist');
const timer = setTimeout(() => { console.error('motion desktop timed out'); app.exit(1); }, 240000);
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 960, height: 540, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, d) => { if (d?.level >= 2 && !/Autofill|Electron Security/.test(d.message)) errors.push(d.message); });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('renderer-gone:' + d.reason));
  const dist = process.env.CS_DIST || 'dist';
  await win.loadURL('file://' + path.resolve(__dirname, '..', dist, 'motion.html').replace(/\\/g, '/'));
  const js = (s) => win.webContents.executeJavaScript(s);
  const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* 页面还没起来 */ } await new Promise((r) => setTimeout(r, 100)); } throw Error('Timed out ' + what); };
  await until(() => js('!!window.__motion'), 20000, 'motion page');

  // 1. 载入样片：12 个镜头、约 88 秒
  const info = await js('window.__motion.load()');
  assert.equal(info.shots.length, 12); assert.ok(info.duration > 85 && info.duration < 91, 'duration ' + info.duration);
  mark('load', { duration: +info.duration.toFixed(1), shots: info.shots.length });

  // 2. 抽查帧：每个学科镜头各一帧，画面不能是空的（jpg 太小就是没画出东西）
  const frames = {};
  for (const t of [3, 8, 18, 25, 34, 42, 49, 55, 62, 70, 76, 84]) {
    const r = await js(`window.__motion.frame(${t})`);
    assert.ok(r.url.length > 40000, `t=${t}s 画面太小 ${r.url.length}`);
    frames[t] = r.url;
  }
  // 同一个镜头的两个时刻必须不一样（确实在动）
  assert.notEqual(frames[8], await js('window.__motion.frame(10)').then((r) => r.url), '开普勒镜头没在动');
  assert.notEqual(frames[62], await js('window.__motion.frame(64)').then((r) => r.url), '历史镜头没在动');
  mark('frames', { n: Object.keys(frames).length });

  // 3. 无配乐导出一小段（开普勒镜头），分块取回，验证是合法 MP4
  const e1 = await js('window.__motion.export({from:6.5,to:9.5,music:false})');
  assert.ok(e1.size > 300000, 'no-music size ' + e1.size); assert.equal(e1.frames, 90);
  let buf = Buffer.alloc(0);
  for (let i = 0; ; i++) { const c = await js(`window.__motion.chunk(${i})`); if (!c) break; buf = Buffer.concat([buf, Buffer.from(c, 'base64')]); }
  assert.equal(buf.length, e1.size); assert.equal(buf.subarray(4, 8).toString(), 'ftyp');
  fs.writeFileSync(path.join(out, 'clip.mp4'), buf);
  mark('export-video', { KB: Math.round(e1.size / 1024), ms: Math.round(e1.ms) });

  // 4. 带配乐导出片尾一秒，验证音频轨能编出来
  const e2 = await js('window.__motion.export({from:82,to:83.5,music:true})');
  assert.ok(e2.size > 200000, 'music size ' + e2.size); assert.ok(e2.audio === 'aac' || e2.audio === 'opus', 'audio ' + e2.audio);
  mark('export-audio', { codec: e2.audio, KB: Math.round(e2.size / 1024) });

  const bad = errors.filter((m) => !/WebGL|GPU|swiftshader|Automatic fallback|fallback to software/i.test(m));
  assert.equal(bad.length, 0, bad.slice(0, 3).join(' | '));
  clearTimeout(timer);
  console.log(`RESULT v120-motion-desktop ${results.length}/${results.length}`);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results }, null, 1));
  app.exit(0);
}).catch((e) => { console.error('FAIL', e.message); app.exit(1); });
