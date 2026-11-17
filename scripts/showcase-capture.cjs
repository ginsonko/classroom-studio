'use strict';
/**
 * 1.7.0-A 示例预览自动录制与轮播截图脚本（纯离屏 Electron，不弹窗、不抢焦点、零外部付费调用）
 *
 * 用法：
 *   npx electron test/quiet.cjs scripts/showcase-capture.cjs                         # 录制全部互动类预览（courseware-html, plugin-dev, custom）
 *   npx electron test/quiet.cjs scripts/showcase-capture.cjs --only courseware-html  # 只跑指定目标（逗号分隔）
 *   npx electron test/quiet.cjs scripts/showcase-capture.cjs --shots <技能名> [文件...] # 给指定技能的 HTML / PNG 截取轮播 WebP（shot-1..N.webp）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session, net, protocol } = require('electron');
const { Plugins } = require('../electron/plugins.cjs');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'electron', 'agent-kit', 'examples');
const TMP_ROOT = path.join(ROOT, '.out', 'jia', 'capture-' + process.pid);
fs.mkdirSync(path.join(TMP_ROOT, 'udata'), { recursive: true });
app.setPath('userData', path.join(TMP_ROOT, 'udata'));

// 离屏静默保护：即使没通过 test/quiet.cjs 启动也绝不弹窗抢焦点
protocol.registerSchemesAsPrivileged([
  { scheme: 'plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
app.on('browser-window-created', (_e, w) => { try { w.setOpacity(0); w.setIgnoreMouseEvents(true); } catch { /* ignore */ } });
app.on('window-all-closed', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFfmpeg() {
  const bundled = path.join(ROOT, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(bundled)) return bundled;
  return 'ffmpeg';
}
const FFMPEG = findFfmpeg();

function encodeWebp(pngFile, outWebp, { width = 1280, quality = 75 } = {}) {
  fs.mkdirSync(path.dirname(outWebp), { recursive: true });
  const tmpOut = outWebp + '.tmp.webp';
  try { fs.rmSync(tmpOut, { force: true }); } catch {}
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', pngFile,
    '-vf', `scale='min(${width},iw)':-2:flags=lanczos`,
    '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6', '-q:v', String(quality),
    tmpOut,
  ], { stdio: 'pipe' });
  fs.renameSync(tmpOut, outWebp);
  return fs.statSync(outWebp).size;
}

function encodeWebm(framesDir, outWebm, { fps = 30, maxBytes = 1.5 * 1024 * 1024 } = {}) {
  fs.mkdirSync(path.dirname(outWebm), { recursive: true });
  const pattern = path.join(framesDir, 'frame-%04d.png');
  const passes = [
    { crf: '32', bv: '900k', maxrate: '1300k' },
    { crf: '37', bv: '620k', maxrate: '920k' },
    { crf: '42', bv: '450k', maxrate: '680k' },
  ];
  for (const p of passes) {
    const tmpOut = outWebm + '.tmp.webm';
    try { fs.rmSync(tmpOut, { force: true }); } catch {}
    execFileSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-framerate', String(fps),
      '-i', pattern,
      '-an',
      '-vf', 'scale=1280:720:flags=lanczos',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuv420p',
      '-b:v', p.bv,
      '-maxrate', p.maxrate,
      '-bufsize', '2000k',
      '-crf', p.crf,
      '-row-mt', '1',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-g', '60',
      tmpOut,
    ], { stdio: 'pipe' });
    const sz = fs.statSync(tmpOut).size;
    fs.renameSync(tmpOut, outWebm);
    if (sz <= maxBytes) return sz;
  }
  return fs.statSync(outWebm).size;
}

async function captureFrame(win, destPng) {
  win.webContents.invalidate();
  await sleep(18);
  let img = await win.webContents.capturePage();
  if (img.isEmpty()) {
    await sleep(60);
    img = await win.webContents.capturePage();
  }
  fs.writeFileSync(destPng, img.toPNG());
}

/** 1. 录制 courseware-html：手画 a–t 曲线 + 电梯积分运动 + 切换完全失重预设（8s / 240帧 / 30fps） */
async function captureCourseware() {
  const htmlFile = path.join(EXAMPLES, 'courseware-html', '_showcase', '超重与失重.html');
  if (!fs.existsSync(htmlFile)) throw new Error('缺少 ' + htmlFile);
  const framesDir = path.join(TMP_ROOT, 'cw-frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const part = 'cap-cw-' + Date.now();
  const ses = session.fromPartition(part);
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob):/i.test(d.url) }));

  const win = new BrowserWindow({
    show: false, width: 1280, height: 720, useContentSize: true, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { partition: part, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);

  try {
    await win.loadFile(htmlFile);
    await win.webContents.executeJavaScript(`document.fonts ? document.fonts.ready.then(() => 1) : 1`);
    await sleep(500);

    // 进入第 5 页「电梯实验室」，挂载平滑演示光标与确定性步进器
    await win.webContents.executeJavaScript(`(() => {
      const st = document.createElement('style');
      st.textContent = '.cs-page, .cs-step { animation: none !important; transition: none !important; } ' +
        '#__cur { position: fixed; left: -100px; top: -100px; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; ' +
        'background: rgba(199, 106, 50, 0.28); border: 3px solid #c76a32; box-shadow: 0 4px 14px rgba(0,0,0,0.22); z-index: 9999; pointer-events: none; } ' +
        '#__cur.down { transform: scale(0.84); background: rgba(199, 106, 50, 0.55); }';
      document.head.appendChild(st);
      const cur = document.createElement('div');
      cur.id = '__cur';
      document.body.appendChild(cur);
      CS.go(4, { fromEnd: true });
      window.lessonLab.lift.pause();
      window.lessonLab.lift.reset();

      window.__capStep = (frame) => {
        const lab = window.lessonLab;
        const atEl = document.getElementById('at');
        const fire = (type, x, y) => {
          const target = type === 'pointerup' ? window : atEl;
          target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 }));
        };
        const moveCur = (x, y, down) => {
          cur.style.left = x + 'px';
          cur.style.top = y + 'px';
          cur.classList.toggle('down', !!down);
        };

        // 阶段 1 (0..59, 2.0s)：在 a–t 图上从左到右画出超重→失重→超重曲线
        if (frame <= 59) {
          const u = frame / 59;
          const tVal = 0.05 + u * 9.85;
          const aVal = tVal < 3.0 ? 3.5 : tVal < 6.8 ? -4.5 : 2.0;
          const pt = lab.screen(tVal, aVal);
          moveCur(pt.x, pt.y, true);
          fire(frame === 0 ? 'pointerdown' : 'pointermove', pt.x, pt.y);
          if (frame === 59) {
            fire('pointerup', pt.x, pt.y);
            lab.lift.pause();
            lab.lift.reset();
          }
          return;
        }

        // 阶段 2 (60..154, 3.17s)：松手后电梯按手绘曲线高速积分运动（走完 0 → 8.4s）
        if (frame <= 154) {
          const pt = lab.screen(9.6, 2.0);
          moveCur(pt.x + 28, pt.y + 34, false);
          const dt = 8.4 / 95;
          const sub = 8;
          for (let i = 0; i < sub; i++) {
            const s = lab.lift.state;
            if (s.t < 10) {
              const a = lab.curve.at(s.t);
              s.v += a * (dt / sub);
              s.y += s.v * (dt / sub);
              s.t += dt / sub;
            }
          }
          lab.lift.redraw();
          return;
        }

        // 阶段 3 (155..172, 0.6s)：光标滑向「自由落体：完全失重」预设按钮并点击
        const fallBtn = document.querySelectorAll('#presets button')[2];
        const br = fallBtn.getBoundingClientRect();
        const bx = br.left + br.width * 0.52, by = br.top + br.height * 0.54;
        if (frame <= 172) {
          const p0 = lab.screen(9.6, 2.0);
          const u = Math.min(1, (frame - 155) / 14);
          const ease = u * u * (3 - 2 * u);
          moveCur(p0.x + 28 + (bx - p0.x - 28) * ease, p0.y + 34 + (by - p0.y - 34) * ease, frame >= 169);
          if (frame === 171) {
            lab.preset('fall');
            lab.lift.pause();
            lab.lift.reset();
            // 推进到 t=0.85s 即将进入自由落体
            lab.lift.state.t = 0.85;
            lab.lift.redraw();
          }
          return;
        }

        // 阶段 4 (173..239, 2.23s)：演示自由落体完全失重（F_N = 0，秤针归零）→ 缓冲段超重
        moveCur(bx + 36, by + 26, false);
        const dt = 3.6 / 67;
        const sub = 8;
        for (let i = 0; i < sub; i++) {
          const s = lab.lift.state;
          if (s.t < 10) {
            const a = lab.curve.at(s.t);
            s.v += a * (dt / sub);
            s.y += s.v * (dt / sub);
            s.t += dt / sub;
          }
        }
        lab.lift.redraw();
      };
    })()`);
    await sleep(120);

    for (let f = 0; f < 240; f++) {
      await win.webContents.executeJavaScript(`window.__capStep(${f})`);
      const png = path.join(framesDir, `frame-${String(f).padStart(4, '0')}.png`);
      await captureFrame(win, png);
    }

    const outDir = path.join(EXAMPLES, 'courseware-html', '_showcase');
    const webmSize = encodeWebm(framesDir, path.join(outDir, 'preview.webm'));
    const posterSize = encodeWebp(path.join(framesDir, 'frame-0082.png'), path.join(outDir, 'poster.webp'));
    console.log(`OK courseware-html: preview.webm ${(webmSize / 1024).toFixed(1)} KB, poster.webp ${(posterSize / 1024).toFixed(1)} KB`);
  } finally {
    win.destroy();
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/** 2. 录制 plugin-dev：左教师面板拖滑块/点阶段 + 右学生大屏实时同步（8s / 240帧 / 30fps） */
async function capturePlugin() {
  const pluginSrc = path.join(EXAMPLES, 'plugin-dev', 'elevator-scale');
  if (!fs.existsSync(path.join(pluginSrc, 'plugin.json'))) throw new Error('缺少 ' + pluginSrc);
  const framesDir = path.join(TMP_ROOT, 'pl-frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const tmpPluginData = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cap-pl-'));
  const plugins = new Plugins({ dir: tmpPluginData });
  const st = plugins.stage(pluginSrc);
  plugins.install(st.token);

  const STAGE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #080d15; font-family: "PingFang SC", "Microsoft YaHei UI", sans-serif; color: #eef4fb; }
    .layout { display: grid; grid-template-columns: 356px 1fr; gap: 14px; padding: 14px; width: 1280px; height: 720px; }
    .pane { display: flex; flex-direction: column; border-radius: 14px; overflow: hidden; border: 1px solid rgba(98,145,190,0.26); background: #13161c; box-shadow: 0 12px 32px rgba(0,0,0,0.45); }
    .pane-h { height: 34px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 700; background: #192231; border-bottom: 1px solid rgba(98,145,190,0.2); color: #b8cde4; }
    .pane-h em { font-style: normal; font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(61,217,235,0.15); color: #4ce2f5; }
    iframe { flex: 1; width: 100%; border: 0; background: transparent; }
    #__cur { position: fixed; left: 180px; top: 360px; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; background: rgba(61,217,235,0.28); border: 3px solid #3dd9eb; box-shadow: 0 4px 14px rgba(0,0,0,0.45); z-index: 9999; pointer-events: none; }
    #__cur.down { transform: scale(0.82); background: rgba(255,181,71,0.55); border-color: #ffb547; }
  </style></head><body>
    <div class="layout">
      <div class="pane"><div class="pane-h"><span>导播台 · 教师控制面板</span><em>仅老师可见</em></div><iframe id="f-panel" src="plugin://elevator-scale/index.html"></iframe></div>
      <div class="pane"><div class="pane-h"><span>课堂展示 · 学生窗口实时画面</span><em>storage 同步</em></div><iframe id="f-screen" src="plugin://elevator-scale/screen.html"></iframe></div>
    </div>
    <div id="__cur"></div>
    <script>
      const store = {};
      const fPanel = document.getElementById('f-panel');
      const fScreen = document.getElementById('f-screen');
      window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.__csp !== 1) return;
        if (d.t === 'ready') {
          const where = e.source === fPanel.contentWindow ? 'console' : 'lesson';
          e.source.postMessage({ __csp: 1, t: 'event', name: 'init', data: { where, scheme: 'dark', theme: {} } }, '*');
        } else if (d.t === 'call') {
          let val = null;
          if (d.method === 'storage.set') {
            store[d.args.key] = d.args.value;
            val = true;
            if (d.args.key === 'state' && fScreen.contentWindow && fScreen.contentWindow.__elevatorScreen) {
              fScreen.contentWindow.__elevatorScreen.applyState(d.args.value);
            }
          } else if (d.method === 'storage.get') {
            val = store[d.args.key] ?? null;
          } else if (d.method === 'storage.keys') {
            val = Object.keys(store);
          } else {
            val = true;
          }
          e.source.postMessage({ __csp: 1, t: 'res', id: d.id, ok: true, value: val }, '*');
        }
      });
    </script>
  </body></html>`;

  const part = 'cap-pl-' + Date.now();
  const ses = session.fromPartition(part);
  ses.protocol.handle('plugin', async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/__stage.html') {
      return new Response(STAGE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const r = plugins.resolve(req.url);
    if (!r) return new Response('Not found', { status: 404 });
    const resp = await net.fetch(pathToFileURL(r.file).href);
    const headers = new Headers(resp.headers);
    headers.set('Content-Security-Policy', plugins.csp(r.manifest || plugins.manifest(r.id)));
    if (/\.html?$/i.test(r.file)) {
      headers.delete('content-length');
      headers.set('content-type', 'text/html; charset=utf-8');
      return new Response(plugins.inject(Buffer.from(await resp.arrayBuffer())), { status: 200, headers });
    }
    return new Response(resp.body, { status: 200, headers });
  });

  const win = new BrowserWindow({
    show: false, width: 1280, height: 720, useContentSize: true, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { partition: part, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);

  try {
    await win.loadURL('plugin://elevator-scale/__stage.html');
    for (let i = 0; i < 60; i++) {
      const ok = await win.webContents.executeJavaScript(`!!(document.getElementById('f-panel')?.contentWindow?.__elevatorPanel && document.getElementById('f-screen')?.contentWindow?.__elevatorScreen)`);
      if (ok) break;
      await sleep(50);
    }
    await sleep(250);

    await win.webContents.executeJavaScript(`(() => {
      const fp = document.getElementById('f-panel');
      const fs = document.getElementById('f-screen');
      const cur = document.getElementById('__cur');
      const rectInStage = (el) => {
        const ir = fp.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { left: ir.left + r.left, top: ir.top + r.top, width: r.width, height: r.height };
      };
      const moveCur = (x, y, down) => {
        cur.style.left = x + 'px';
        cur.style.top = y + 'px';
        cur.classList.toggle('down', !!down);
      };
      const sliderPos = (id, min, max, val) => {
        const r = rectInStage(fp.contentDocument.getElementById(id));
        const ratio = (val - min) / (max - min);
        return { x: r.left + 10 + ratio * (r.width - 20), y: r.top + r.height * 0.5 };
      };
      const btnCenter = (sel) => {
        const r = rectInStage(fp.contentDocument.querySelector(sel));
        return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
      };

      window.__plStep = (frame) => {
        const panel = fp.contentWindow.__elevatorPanel;
        const screen = fs.contentWindow.__elevatorScreen;

        // 阶段 1 (0..69, 2.33s)：拖动加速度滑块 +2.0 → +4.5（强超重）→ -3.5（失重）
        if (frame <= 69) {
          let a;
          if (frame < 30) a = 2.0 + (frame / 29) * 2.5;
          else a = 4.5 - ((frame - 30) / 39) * 8.0;
          a = Math.round(a * 2) / 2;
          panel.setAccel(a);
          const p = sliderPos('sl-a', -10, 6, a);
          moveCur(p.x, p.y, true);
        }
        // 阶段 2 (70..109, 1.33s)：拖动质量滑块 50 → 60 kg，再点「匀速」
        else if (frame <= 109) {
          if (frame <= 90) {
            const m = Math.round((50 + ((frame - 70) / 20) * 10) / 5) * 5;
            panel.setMass(m);
            const p = sliderPos('sl-m', 30, 100, m);
            moveCur(p.x, p.y, true);
          } else {
            const b = btnCenter('[data-stage="cruise"]');
            moveCur(b.x, b.y, frame >= 96 && frame <= 100);
            if (frame === 97) panel.setStage('cruise');
          }
        }
        // 阶段 3 (110..174, 2.17s)：切「下行电梯 ↓」+ 点「制动」（展示减速下降也是超重！）
        else if (frame <= 174) {
          if (frame <= 128) {
            const b = btnCenter('#dir-down');
            moveCur(b.x, b.y, frame >= 120 && frame <= 125);
            if (frame === 122) panel.setDirection(-1);
          } else {
            const b = btnCenter('[data-stage="brake"]');
            moveCur(b.x, b.y, frame >= 136 && frame <= 141);
            if (frame === 138) panel.setStage('brake');
          }
        }
        // 阶段 4 (175..239, 2.17s)：点「自由落体」（完全失重 F_N = 0）
        else {
          const b = btnCenter('[data-stage="fall"]');
          moveCur(b.x, b.y, frame >= 182 && frame <= 187);
          if (frame === 184) panel.setStage('fall');
        }

        screen.stepFrame(1 / 30);
      };
    })()`);

    for (let f = 0; f < 240; f++) {
      await win.webContents.executeJavaScript(`window.__plStep(${f})`);
      const png = path.join(framesDir, `frame-${String(f).padStart(4, '0')}.png`);
      await captureFrame(win, png);
    }

    const outDir = path.join(EXAMPLES, 'plugin-dev', '_showcase');
    const webmSize = encodeWebm(framesDir, path.join(outDir, 'preview.webm'));
    const posterSize = encodeWebp(path.join(framesDir, 'frame-0158.png'), path.join(outDir, 'poster.webp'));
    console.log(`OK plugin-dev: preview.webm ${(webmSize / 1024).toFixed(1)} KB, poster.webp ${(posterSize / 1024).toFixed(1)} KB`);
  } finally {
    win.destroy();
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(tmpPluginData, { recursive: true, force: true });
  }
}

/** 3. 录制 custom 的 3 张轮播 WebP（shot-1..3.webp） */
async function captureCustom() {
  const showDir = path.join(EXAMPLES, 'custom', '_showcase');
  const longPng = path.join(showDir, '月考错题归因与提分路线分析长图.png');
  const dictHtml = path.join(showDir, '高一力学经典模型速查网页.html');
  const gameHtml = path.join(showDir, '超重与失重·太空电梯闯关小游戏.html');
  if (!fs.existsSync(longPng) || !fs.existsSync(dictHtml) || !fs.existsSync(gameHtml)) {
    console.log('SKIP custom: 样板文件尚未全部就绪');
    return;
  }

  const tmpDir = path.join(TMP_ROOT, 'custom-shots');
  fs.mkdirSync(tmpDir, { recursive: true });
  const part = 'cap-custom-' + Date.now();
  const ses = session.fromPartition(part);
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob):/i.test(d.url) }));

  const win = new BrowserWindow({
    show: false, width: 1280, height: 720, useContentSize: true, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { partition: part, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });

  try {
    // Shot 1：长图双栏画廊展示框（左上半部核心归因雷达 + 右下半部提分路线，1280x720 高清完整呈现）
    const b64 = fs.readFileSync(longPng).toString('base64');
    const galleryHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); display: flex; align-items: center; justify-content: center; gap: 28px; padding: 26px 40px; font-family: "PingFang SC", "Microsoft YaHei UI", sans-serif; }
      .card { width: 560px; height: 668px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.14); background: #fff; position: relative; }
      .card img { width: 100%; display: block; position: absolute; left: 0; }
      .card.top img { top: 0; }
      .card.bot img { bottom: 0; }
      .tag { position: fixed; right: 24px; bottom: 18px; padding: 5px 14px; border-radius: 99px; background: rgba(15,23,42,0.82); color: #e2e8f0; font-size: 13px; border: 1px solid rgba(255,255,255,0.18); }
    </style></head><body>
      <div class="card top"><img src="data:image/png;base64,${b64}"></div>
      <div class="card bot"><img src="data:image/png;base64,${b64}"></div>
      <div class="tag">学情诊断长图 · 上下分段同屏预览</div>
    </body></html>`;
    const galFile = path.join(tmpDir, 'gallery.html');
    fs.writeFileSync(galFile, galleryHtml);
    await win.loadFile(galFile);
    await sleep(450);
    const s1Png = path.join(tmpDir, 's1.png');
    await captureFrame(win, s1Png);
    const s1Sz = encodeWebp(s1Png, path.join(showDir, 'shot-1.webp'));

    // Shot 2：高一力学经典模型速查网页
    await win.loadFile(dictHtml);
    await win.webContents.executeJavaScript(`document.fonts ? document.fonts.ready.then(() => 1) : 1`);
    await sleep(450);
    await win.webContents.executeJavaScript(`if (window.__showcasePose) window.__showcasePose();`);
    await sleep(250);
    const s2Png = path.join(tmpDir, 's2.png');
    await captureFrame(win, s2Png);
    const s2Sz = encodeWebp(s2Png, path.join(showDir, 'shot-2.webp'));

    // Shot 3：超重与失重·太空电梯闯关小游戏
    await win.loadFile(gameHtml);
    await win.webContents.executeJavaScript(`document.fonts ? document.fonts.ready.then(() => 1) : 1`);
    await sleep(450);
    await win.webContents.executeJavaScript(`if (window.__showcasePose) window.__showcasePose();`);
    await sleep(250);
    const s3Png = path.join(tmpDir, 's3.png');
    await captureFrame(win, s3Png);
    const s3Sz = encodeWebp(s3Png, path.join(showDir, 'shot-3.webp'));

    console.log(`OK custom: shot-1 ${(s1Sz / 1024).toFixed(1)} KB, shot-2 ${(s2Sz / 1024).toFixed(1)} KB, shot-3 ${(s3Sz / 1024).toFixed(1)} KB`);
  } finally {
    win.destroy();
  }
}

/** 4. 通用 `--shots <技能名> [输入文件...]`：给任意技能的 HTML / PNG 截取轮播图 shot-1..N.webp */
async function captureGenericShots(skill, extraFiles) {
  const showDir = path.join(EXAMPLES, skill, '_showcase');
  fs.mkdirSync(showDir, { recursive: true });
  let inputs = extraFiles.map((f) => path.resolve(f));
  if (!inputs.length) {
    inputs = fs.readdirSync(showDir)
      .filter((n) => /\.(html?|png|jpe?g)$/i.test(n) && !/^(poster|shot-\d+)\./i.test(n))
      .map((n) => path.join(showDir, n));
  }
  if (!inputs.length) throw new Error(`在 ${showDir} 未找到可用于截图的 HTML/PNG 文件`);

  const tmpDir = path.join(TMP_ROOT, 'shots-' + skill);
  fs.mkdirSync(tmpDir, { recursive: true });
  const part = 'cap-shots-' + Date.now();
  const ses = session.fromPartition(part);
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob):/i.test(d.url) }));

  const win = new BrowserWindow({
    show: false, width: 1280, height: 720, useContentSize: true, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { partition: part, offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });

  let idx = 0;
  try {
    for (const file of inputs) {
      if (idx >= 4) break;
      if (/\.(png|jpe?g)$/i.test(file)) {
        idx++;
        const outWebp = path.join(showDir, `shot-${idx}.webp`);
        // 若是竖版长图，裁取顶部高信息密度 16:9 区域；若是横图直接转 WebP
        execFileSync(FFMPEG, [
          '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
          '-vf', "scale=1280:-2:flags=lanczos,crop=1280:'min(720,ih)':0:0",
          '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6', '-q:v', '75',
          outWebp,
        ], { stdio: 'pipe' });
        console.log(`SHOT ${outWebp} (${(fs.statSync(outWebp).size / 1024).toFixed(1)} KB)`);
      } else if (/\.html?$/i.test(file)) {
        await win.loadFile(file);
        await win.webContents.executeJavaScript(`document.fonts ? document.fonts.ready.then(() => 1) : 1`).catch(() => {});
        await sleep(450);
        const deckPages = await win.webContents.executeJavaScript(`window.CS && CS.deck ? CS.deck.pages.length : 0`).catch(() => 0);
        if (deckPages >= 3) {
          const picks = [0, Math.floor(deckPages / 2), deckPages - 2].slice(0, 4 - idx);
          for (const p of picks) {
            idx++;
            await win.webContents.executeJavaScript(`CS.go(${p}, { fromEnd: true })`);
            await sleep(250);
            const png = path.join(tmpDir, `p-${idx}.png`);
            await captureFrame(win, png);
            const outWebp = path.join(showDir, `shot-${idx}.webp`);
            const sz = encodeWebp(png, outWebp);
            console.log(`SHOT ${outWebp} (${(sz / 1024).toFixed(1)} KB)`);
          }
        } else {
          idx++;
          const png = path.join(tmpDir, `p-${idx}.png`);
          await captureFrame(win, png);
          const outWebp = path.join(showDir, `shot-${idx}.webp`);
          const sz = encodeWebp(png, outWebp);
          console.log(`SHOT ${outWebp} (${(sz / 1024).toFixed(1)} KB)`);
        }
      }
    }
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  const args = process.argv.slice(1).filter((a) => !a.endsWith('electron.exe') && !a.endsWith('quiet.cjs') && !a.endsWith('showcase-capture.cjs'));
  try {
    const shotsIdx = args.indexOf('--shots');
    if (shotsIdx >= 0) {
      const skill = args[shotsIdx + 1];
      if (!skill) throw new Error('用法：--shots <技能名> [文件...]');
      await captureGenericShots(skill, args.slice(shotsIdx + 2));
      return;
    }
    const onlyIdx = args.indexOf('--only');
    const targets = onlyIdx >= 0 && args[onlyIdx + 1]
      ? args[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
      : ['courseware-html', 'plugin-dev', 'custom'];

    if (targets.includes('courseware-html')) await captureCourseware();
    if (targets.includes('plugin-dev')) await capturePlugin();
    if (targets.includes('custom')) await captureCustom();
  } finally {
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  }
  app.exit(0);
}).catch((e) => {
  console.error('showcase-capture failed:', e);
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  app.exit(1);
});
