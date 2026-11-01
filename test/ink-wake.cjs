// 画布空闲时会停掉逐帧循环。这里确认停下之后，各种不经过本画布的变化都能马上把它叫醒重画：
// 别的窗口改了笔迹（同步过来的存档）、别的窗口正在写的一笔（实时笔迹）、激光笔、加载很慢的板面图片。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/ink-wake.cjs
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'ink-wake-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const line = (id, x0, y0, x1, y1) => ({ id, tool: 'line', color: 'ink', size: 6, pts: [x0, y0, .5, x1, y1, .5], author: 'teacher', layer: 'public' });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: { 'board#0': [line('a', .05, .05, .2, .05)] }, studentTools: 'open', tool: 'pen', color: 'ink', size: 3, boardSkin: 'wheat', pattern: 'none' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));

// 一张纯红的 PNG，故意晚 2.5 秒才返回：返回时画布早就停下了
const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const W = 32, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.concat(Array.from({ length: W }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(W * 3, Buffer.from([255, 0, 0]))])));
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
let imageSentAt = 0;
const server = http.createServer((req, res) => setTimeout(() => { imageSentAt = Date.now(); res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(png); }, 2500));

const { app, screen } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('ink wake timed out'); app.exit(1); }, 180000);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const run = async (w, code) => { const r = await w.webContents.executeJavaScript(`(async()=>{try{${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error(r.__err); return r; };
  await until(() => run(student, 'return !!window.__studioQA'));
  await until(() => run(teacher, 'return !!window.__studioQA'));
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left - 2000, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  student.setBounds({ x: left, y: 30, width: 1600, height: 900 }); student.showInactive();
  await sleep(3000);
  // 学生窗口里黑板那块画布：读页面坐标 (x, y) 处的像素（按页宽归一化），看笔迹层上有没有东西
  await run(student, `
    const layers = () => [...document.querySelectorAll('.ink')].filter((e) => e.getBoundingClientRect().width > 300);
    window.__inkAt = (x, y) => { let best = 0, rgb = null; for (const el of layers()) { const r = el.getBoundingClientRect(); for (const c of el.querySelectorAll('canvas.ink-c')) { if (!c.width) continue; const k = c.width / r.width, d = c.getContext('2d').getImageData(Math.round(x * r.width * k), Math.round(y * r.width * k), 1, 1).data; if (d[3] > best) { best = d[3]; rgb = [d[0], d[1], d[2]]; } } } return { alpha: best, rgb }; };
    // 每 5 ms 看一次，等到条件成立，返回成立时的时刻（Date.now，和其它窗口、主进程可比）
    window.__waitInk = (test, ms = 4000) => new Promise((res) => { const t0 = Date.now(); const f = () => { const v = test(); if (v || Date.now() - t0 > ms) res({ ok: !!v, at: Date.now() }); else setTimeout(f, 5); }; f(); });
    const raf = window.requestAnimationFrame.bind(window); window.__rafs = 0; window.requestAnimationFrame = (cb) => raf((t) => { window.__rafs++; cb(t); });
    return layers().length`);
  assert.ok((await run(student, 'return __inkAt(.12, .05).alpha')) > 0, '原有的笔迹画出来了');

  const report = {};
  // 1. 空闲时确实停下了
  await sleep(2500);
  await run(student, 'window.__rafs = 0; return true'); await sleep(1000);
  report.idleRafs = await run(student, 'return window.__rafs');
  assert.ok(report.idleRafs <= 2, '空闲时画布不应再逐帧循环：' + report.idleRafs);

  const measure = async (what, test, trigger) => {
    await sleep(2500);
    const wait = run(student, `return __waitInk(() => ${test})`);
    await sleep(50);
    const t0 = Date.now(); await trigger();
    const r = await wait; report[what] = r.ok ? r.at - t0 : 'missed';
    assert.ok(r.ok, what + '：没有重画');
  };
  // 2. 老师那边改了笔迹（存档同步过来，不经过学生画布的输入）
  await measure('syncedStroke', '__inkAt(.5, .3).alpha > 0', () => run(teacher, `__studioQA.useStore.getState().editInk('board#0', { upsert: [${JSON.stringify(line('b', .3, .3, .7, .3))}] }, 'teacher'); return true`));
  // 3. 别的窗口正在写的一笔（还没抬笔）
  await measure('liveDraft', '__inkAt(.5, .5).alpha > 0', () => run(teacher, `__studioQA.bus.post({ t: 'live', key: 'board#0', stroke: ${JSON.stringify(line('c', .3, .5, .7, .5))}, from: 'wake-test' }); return true`));
  await sleep(200);
  await run(teacher, `__studioQA.bus.post({ t: 'live', key: 'board#0', stroke: null, from: 'wake-test' }); return true`);
  await until(() => run(student, 'return __inkAt(.5, .5).alpha === 0'), 3000, '实时笔迹撤掉后清掉');
  // 4. 激光笔（别的窗口发来）
  await measure('remoteLaser', '__inkAt(.6, .42).alpha > 0', () => run(teacher, `__studioQA.bus.post({ t: 'laser', key: 'board#0', pts: [.6, .42], from: 'wake-test' }); return true`));
  await until(() => run(student, 'return __inkAt(.6, .42).alpha === 0'), 3000, '激光笔淡出后清掉');
  // 5. 加载很慢的图片：笔迹先到（画占位框），图片 2.5 秒后才到，到了要马上画上
  const img = { id: 'img', tool: 'image', img: `http://127.0.0.1:${port}/slow.png`, color: 'ink', size: 3, pts: [.8, .4, .5, .9, .52, .5], author: 'teacher', layer: 'public' };
  await sleep(2500);
  const wait = run(student, `return __waitInk(() => { const p = __inkAt(.85, .46); return p.alpha > 200 && p.rgb[0] > 200 && p.rgb[1] < 60; }, 8000)`);
  await run(teacher, `__studioQA.useStore.getState().editInk('board#0', { upsert: [${JSON.stringify(img)}] }, 'teacher'); return true`);
  const r = await wait; assert.ok(r.ok && imageSentAt, '慢图片没有画上');
  report.slowImage = r.at - imageSentAt;
  console.log('INK WAKE', JSON.stringify(report));
  // 叫醒都应在几帧之内，而不是等每秒一次的兜底检查
  for (const k of ['syncedStroke', 'liveDraft', 'remoteLaser', 'slowImage']) assert.ok(report[k] < 300, k + ' 重画太慢：' + report[k] + ' ms');
  console.log('INK WAKE OK');
  clearTimeout(timer); server.close(); app.exit(0);
})().catch((e) => { console.error('INK WAKE FAIL', e); app.exit(1); });
