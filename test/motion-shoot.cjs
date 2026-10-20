// 课堂动画引擎：载入样片，按时间点出帧存 JPG（逐帧检查用），可选导出整片 MP4。
// 用法：cd app; npx electron test/motion-shoot.cjs
//   MOTION_URL=http://localhost:5289/motion.html   用开发服务器（不设就用 dist/motion.html）
//   MOTION_AT=1.5,3,10                              只出这些时间点；不设则每个镜头取 3 帧
//   MOTION_SHOT=3                                   只出第 3 个镜头（从 0 数），每 0.5 秒一帧
//   MOTION_EXPORT=1                                 导出整片到 .out/motion/showcase.mp4
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const OUT = path.resolve(__dirname, '../.out/motion'); const FR = path.join(OUT, 'frames');
fs.mkdirSync(FR, { recursive: true });
app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 960, height: 540, show: !!process.env.CS_SHOW, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { const m = e.message ?? ''; if (!/Autofill|Electron Security/.test(m)) console.log('[page]', m.slice(0, process.env.MOTION_DEBUG ? 4000 : 400)); });
  const url = process.env.MOTION_URL || 'file://' + path.resolve(__dirname, '../dist/motion.html').replace(/\\/g, '/');
  await win.loadURL(url);
  const js = (s) => win.webContents.executeJavaScript(s);
  for (let i = 0; i < 100 && !(await js('!!window.__motion')); i++) await new Promise((r) => setTimeout(r, 100));
  try {
    const t0 = Date.now();
    // MOTION_SPEC：一段 JS 表达式，可用 S（样片规格）拼出要载入的片子，例如 {...S, shots:[S.shots[7]]}
    const info = await js(process.env.MOTION_SPEC ? `(()=>{const S=window.__motion.showcase; return window.__motion.load(${process.env.MOTION_SPEC});})()` : 'window.__motion.load()');
    console.log(`载入 ${Date.now() - t0} ms，片长 ${info.duration.toFixed(1)} 秒，${info.shots.length} 个镜头`);
    let times = [];
    if (process.env.MOTION_AT) times = process.env.MOTION_AT.split(',').map(Number);
    else if (process.env.MOTION_SHOT) { const s = info.shots[Number(process.env.MOTION_SHOT)]; for (let t = 0.1; t < s.dur; t += 0.5) times.push(s.start + t); }
    else for (const s of info.shots) times.push(s.start + s.dur * 0.15, s.start + s.dur * 0.5, s.start + s.dur * 0.85);
    let worst = 0;
    for (const t of times) {
      const r = await js(`window.__motion.frame(${t})`);
      worst = Math.max(worst, r.ms);
      const shot = info.shots.findLastIndex((s) => t >= s.start);
      const f = path.join(FR, `${t.toFixed(2).padStart(6, '0')}-s${shot}.jpg`);
      fs.writeFileSync(f, Buffer.from(r.url.split(',')[1], 'base64'));
    }
    if (process.env.MOTION_DEBUG) { const g = await js('window.__motion.gl()'); console.log('WebGL', g && JSON.stringify({ lost: g.lost, err: g.err, mem: g.info.memory, programs: g.info.programs?.length })); }
    console.log(`出帧 ${times.length} 张 → ${FR}（最慢一帧 ${worst.toFixed(0)} ms）`);
    if (process.env.MOTION_EXPORT) {
      const tick = setInterval(async () => { const p = await js('window.__motion.progress()'); process.stdout.write(`\r导出 ${(p.k * 100).toFixed(0)}% ${p.frame}/${p.total}   `); }, 3000);
      const r = await js(`window.__motion.export(${process.env.MOTION_RANGE ? JSON.stringify({ from: +process.env.MOTION_RANGE.split('-')[0], to: +process.env.MOTION_RANGE.split('-')[1] }) : '{}'})`);
      clearInterval(tick);
      const file = path.join(OUT, process.env.MOTION_FILE || 'showcase.mp4'); const fd = fs.openSync(file, 'w');
      for (let i = 0; ; i++) { const c = await js(`window.__motion.chunk(${i})`); if (!c) break; fs.writeSync(fd, Buffer.from(c, 'base64')); }
      fs.closeSync(fd);
      console.log(`\n导出完成：${file}  ${(r.size / 1048576).toFixed(1)} MB，${r.frames} 帧，音频 ${r.audio || '无'}，用时 ${(r.ms / 1000).toFixed(1)} 秒`);
    }
  } catch (e) { console.error('出错：', e.message || e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
