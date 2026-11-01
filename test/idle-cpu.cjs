// 空闲时各进程占多少 CPU：软件开着、老师什么都不做（上课间隙、开着腾讯会议时最常见），不应该有进程一直在忙。
// 采样 12 秒的 app.getAppMetrics()，按窗口列出平均 CPU%，并统计每个页面里每秒的 rAF 帧数和定时器回调次数。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/idle-cpu.cjs
const fs = require('node:fs'); const path = require('node:path');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'idle-cpu-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', tool: 'pen', color: 'ink', size: 3, boardSkin: process.env.CS_IDLE_SKIN || 'chalk' },
  local: { roots: [], students: [stu('stu-a', '张三')], studentId: 'stu-a', slots: [], learning: {} },
}));
const { app, screen } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw Error('timeout'); };
setTimeout(() => { console.error('idle cpu timed out'); app.exit(1); }, 120000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const onScreen = process.env.CS_SHOW === '1';
  const left = onScreen ? 0 : Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left - (onScreen ? 0 : 2000), y: 30, width: 1440, height: 900 }); teacher.showInactive();
  student.setBounds({ x: left + (onScreen ? 300 : 0), y: 60, width: 1600, height: 900 }); student.showInactive();
  await api.dock.ensure();
  await sleep(8000);
  const probe = `(()=>{const W=window;const P=W.__idle={raf:0,timers:0,intervals:0};const raf=W.requestAnimationFrame.bind(W);W.requestAnimationFrame=(cb)=>raf((t)=>{P.raf++;cb(t)});
    const st=W.setTimeout.bind(W),si=W.setInterval.bind(W);W.setTimeout=(f,ms,...a)=>st((...x)=>{P.timers++;typeof f==='function'&&f(...x)},ms,...a);W.setInterval=(f,ms,...a)=>si((...x)=>{P.intervals++;typeof f==='function'&&f(...x)},ms,...a);return true})()`;
  const wins = { teacher, student, dock: api.dock.window };
  for (const [n, w] of Object.entries(wins)) if (w && !w.isDestroyed()) await w.webContents.executeJavaScript(probe).catch(() => {});
  const pidOf = Object.fromEntries(Object.entries(wins).filter(([, w]) => w && !w.isDestroyed()).map(([n, w]) => [w.webContents.getOSProcessId(), n]));
  const acc = {}; const N = 12;
  for (let i = 0; i < N; i++) {
    await sleep(1000);
    for (const m of app.getAppMetrics()) { const k = pidOf[m.pid] || m.type + (m.serviceName ? ':' + m.serviceName : ''); acc[k] = (acc[k] || 0) + m.cpu.percentCPUUsage; }
  }
  const cpu = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +(v / N).toFixed(2)]).sort((a, b) => b[1] - a[1]));
  const pages = {};
  for (const [n, w] of Object.entries(wins)) if (w && !w.isDestroyed()) { const p = await w.webContents.executeJavaScript('window.__idle').catch(() => null); if (p) pages[n] = { rafPerSec: +(p.raf / N).toFixed(1), timeoutsPerSec: +(p.timers / N).toFixed(1), intervalsPerSec: +(p.intervals / N).toFixed(1) }; }
  const r = { cpu, pages }; console.log(JSON.stringify(r, null, 1)); fs.writeFileSync(path.join(out, 'idle.json'), JSON.stringify(r, null, 2));
  app.exit(0);
})().catch((e) => { console.error(e); app.exit(1); });
