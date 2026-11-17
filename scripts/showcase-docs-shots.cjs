'use strict';
// 1.7.0-A 文档类样板生成、导出、逐页核验与轮播截图工具（工人乙）
// 用法：
//   CS_DIST=.out/乙/dist npx electron test/quiet.cjs scripts/showcase-docs-shots.cjs --skill=lecture-slides
//   CS_DIST=.out/乙/dist npx electron test/quiet.cjs scripts/showcase-docs-shots.cjs --all
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const electron = require('electron');
const { app, BrowserWindow, protocol, session, net } = electron;

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'electron', 'agent-kit', 'examples');
const OUT_TMP = path.join(ROOT, '.out', '乙');
const DIST = path.resolve(ROOT, process.env.CS_DIST || path.join('.out', '乙', 'dist'));
const FFMPEG = path.join(ROOT, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const PY = process.env.CS_PY || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe');

/** 调本机 Python 精简脚本（PIL 调色板量化、PDF 字体子集化），不可用时跳过 */
function pyShrink(script, files) {
  if (!files.length || !fs.existsSync(PY)) return;
  const r = spawnSync(PY, ['-X', 'utf8', path.join(__dirname, script), ...files], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.stdout) process.stdout.write(r.stdout.split('\n').filter(Boolean).map((l) => '[shrink] ' + l + '\n').join(''));
  if (r.status !== 0) console.warn('[shrink] 失败：' + (r.stderr || '').slice(-400));
}

fs.mkdirSync(path.join(OUT_TMP, 'browser'), { recursive: true });
app.setPath('userData', path.join(OUT_TMP, 'browser'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  { scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'lesson', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const exporter = require('../electron/exporter.cjs');
const { OfficeConverter, closeWindow } = require('../electron/office.cjs');
const deliver = require('../electron/deliverCheck.cjs');
const pptSteps = require('../electron/pptSteps.cjs');
const { entries } = require('../electron/zipkit.cjs');

fs.mkdirSync(OUT_TMP, { recursive: true });

function within(base, file) {
  const r = path.relative(path.resolve(base), path.resolve(file));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

let sesReady = false;
function getSession() {
  const ses = session.fromPartition('studio-docs-showcase');
  if (!sesReady) {
    sesReady = true;
    ses.protocol.handle('studio', async (req) => {
      try {
        const u = new URL(req.url);
        if (u.hostname === 'vendor') {
          const rel = decodeURIComponent(u.pathname).replace(/^\//, '');
          const base = path.join(ROOT, 'node_modules');
          const file = path.resolve(base, rel);
          if (!within(base, file)) return new Response('Denied', { status: 403 });
          return await net.fetch(pathToFileURL(file).href);
        }
        if (u.hostname !== 'app') return new Response('Not found', { status: 404 });
        const rel = decodeURIComponent(u.pathname).replace(/^\//, '') || 'index.html';
        const file = path.resolve(DIST, rel);
        if (!within(DIST, file)) return new Response('Denied', { status: 403 });
        const res = await net.fetch(pathToFileURL(file).href);
        const headers = new Headers(res.headers);
        headers.set(
          'Content-Security-Policy',
          "default-src 'self' studio: lesson: data: blob:; script-src 'self' studio: 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' studio: 'unsafe-inline'; img-src 'self' studio: lesson: data: blob:; connect-src 'self' studio: lesson: data: blob:; worker-src 'self' studio: blob:; font-src 'self' studio: data:;"
        );
        return new Response(res.body, { status: res.status, headers });
      } catch (e) {
        return new Response('Error: ' + e.message, { status: 404 });
      }
    });
    ses.protocol.handle('lesson', async (req) => {
      try {
        const u = new URL(req.url);
        const raw = Buffer.from(decodeURIComponent(u.pathname).replace(/^\//, ''), 'base64url').toString('utf8');
        const file = path.resolve(raw);
        if (!within(ROOT, file)) return new Response('Denied', { status: 403 });
        const res = await net.fetch(pathToFileURL(file).href);
        const headers = new Headers(res.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(res.body, { status: res.status, headers });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
  }
  return ses;
}

function lessonUrl(file) {
  return 'lesson://local/' + Buffer.from(path.resolve(file), 'utf8').toString('base64url');
}

function makeWindow(width = 1600, height = 900) {
  const ses = getSession();
  const w = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  w.webContents.setFrameRate(30);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}

/** 用内置 ffmpeg 调色板量化无损感压缩大图 PNG（保持清晰锐利文字与透明通道） */
function optimizePngBuffer(pngBuf, maxColors = 256, dither = 'bayer:bayer_scale=3') {
  if (!fs.existsSync(FFMPEG) || pngBuf.length < 18 * 1024) return pngBuf;
  const dir = fs.mkdtempSync(path.join(OUT_TMP, 'pngopt-'));
  const inp = path.join(dir, 'in.png');
  const pal = path.join(dir, 'pal.png');
  const out = path.join(dir, 'out.png');
  try {
    fs.writeFileSync(inp, pngBuf);
    const r1 = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inp, '-vf', `palettegen=max_colors=${maxColors}:reserve_transparent=1:stats_mode=single`, pal]);
    if (r1.status !== 0 || !fs.existsSync(pal)) return pngBuf;
    const r2 = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inp, '-i', pal, '-lavfi', `paletteuse=dither=${dither}:alpha_threshold=128`, '-compression_level', '9', out]);
    if (r2.status !== 0 || !fs.existsSync(out)) return pngBuf;
    const next = fs.readFileSync(out);
    return next.length < pngBuf.length ? next : pngBuf;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function optimizePngFile(filePath, maxColors = 256) {
  const raw = fs.readFileSync(filePath);
  const opt = optimizePngBuffer(raw, maxColors);
  if (opt.length < raw.length) fs.writeFileSync(filePath, opt);
}

/** 压缩 .pptx / .docx 内部超过 10KB 的媒体 PNG（保持完全相同的像素宽高、XML 结构与动画） */
function optimizeZipMedia(zipFilePath) {
  const buf = fs.readFileSync(zipFilePath);
  const list = entries(buf, { maxBytes: 64 * 1024 * 1024 });
  let saved = 0;
  const updated = list.map((e) => {
    if (/\.(png)$/i.test(e.name) && /(ppt|word)\/media\//.test(e.name) && e.data.length >= 10 * 1024) {
      const colors = /-bg\.png$/i.test(e.name) ? 96 : 192;
      const opt = optimizePngBuffer(e.data, colors);
      if (opt.length < e.data.length) {
        saved += e.data.length - opt.length;
        return { name: e.name, data: opt };
      }
    }
    return { name: e.name, data: e.data };
  });
  if (saved > 0) fs.writeFileSync(zipFilePath, exporter.zip(updated));
  return saved;
}

/** 离屏渲染 SVG 为高清 PNG 并适度压体积 */
async function renderSvgToPng(svgFile, outPngFile, width, height) {
  const svgText = fs.readFileSync(svgFile, 'utf8');
  const w = makeWindow(width, height);
  try {
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff}svg{display:block;width:100%;height:100%}</style><body>${svgText}</body>`;
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await w.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(()=>1) : 1');
    await new Promise((r) => setTimeout(r, 150));
    w.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 120));
    let img = await w.webContents.capturePage({ x: 0, y: 0, width, height });
    if (img.getSize().width !== width) img = img.resize({ width, height, quality: 'best' });
    fs.mkdirSync(path.dirname(outPngFile), { recursive: true });
    // 扁平矢量插画不抖动：色块干净、压缩率高，嵌进 PPTX/PDF 也更小
    fs.writeFileSync(outPngFile, optimizePngBuffer(img.toPNG(), 96, 'none'));
  } finally {
    await closeWindow(w);
  }
}

async function pdfText(buf) {
  const w = makeWindow(800, 600);
  try {
    await w.loadURL('studio://app/export.html');
    for (let i = 0; i < 100 && !(await w.webContents.executeJavaScript('!!window.csExport')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return String(await w.webContents.executeJavaScript(`window.csExport.pdfText(${JSON.stringify(Buffer.from(buf).toString('base64'))})`) || '');
  } finally {
    await closeWindow(w);
  }
}

/** 在离屏窗口中用 pdf.js 把 PDF 各页渲染成高分 PNG DataURL，并合成为 1280x720 轮播 WebP */
async function renderShotsInBrowser(specs, outDir) {
  const w = makeWindow(1280, 720);
  try {
    await w.loadURL('studio://app/export.html');
    for (let i = 0; i < 100 && !(await w.webContents.executeJavaScript('!!window.csExport')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await w.webContents.executeJavaScript(`
      window.__renderHelper = (async () => {
        const pdfjs = await import('studio://vendor/pdfjs-dist/build/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = 'studio://vendor/pdfjs-dist/build/pdf.worker.min.mjs';
        const docCache = new Map();
        async function getDoc(url) {
          if (!docCache.has(url)) {
            const ab = await (await fetch(url)).arrayBuffer();
            const doc = await pdfjs.getDocument({
              data: new Uint8Array(ab),
              cMapUrl: 'studio://app/pdfjs/cmaps/',
              cMapPacked: true,
              standardFontDataUrl: 'studio://app/pdfjs/standard_fonts/',
              wasmUrl: 'studio://app/pdfjs/wasm/',
            }).promise;
            docCache.set(url, doc);
          }
          return docCache.get(url);
        }
        async function renderPdfPage(url, pageNo, targetW = 1400) {
          const doc = await getDoc(url);
          const p = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
          const vp0 = p.getViewport({ scale: 1 });
          const scale = targetW / vp0.width;
          const vp = p.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          await p.render({ canvasContext: ctx, viewport: vp }).promise;
          return c;
        }
        async function loadImg(url) {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.src = url;
          await im.decode();
          return im;
        }
        function drawBackdrop(ctx, W, H) {
          const g = ctx.createLinearGradient(0, 0, W, H);
          g.addColorStop(0, '#e8f0fc');
          g.addColorStop(0.55, '#f2f6fd');
          g.addColorStop(1, '#e5eefb');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.save();
          ctx.fillStyle = 'rgba(47, 111, 214, 0.06)';
          ctx.beginPath(); ctx.arc(W - 90, 80, 220, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(90, H - 60, 180, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        function roundRectPath(ctx, x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
        }
        return {
          async pdfInfo(url) {
            const doc = await getDoc(url);
            return { pages: doc.numPages };
          },
          async makeShot(spec) {
            const W = 1280, H = 720;
            const out = document.createElement('canvas');
            out.width = W; out.height = H;
            const ctx = out.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            if (spec.kind === 'slide') {
              const im = await loadImg(spec.url);
              ctx.drawImage(im, 0, 0, W, H);
            } else if (spec.kind === 'focus') {
              drawBackdrop(ctx, W, H);
              const pg = await renderPdfPage(spec.url, spec.page || 1, 2080);
              const cardW = spec.cardW || 1040;
              const scale = cardW / pg.width;
              const fullH = pg.height * scale;
              const cardX = Math.round((W - cardW) / 2);
              const cardY = 24;
              const viewH = H - 48;
              const maxScroll = Math.max(0, fullH - viewH);
              const sy = (maxScroll * (spec.yFrac ?? 0)) / scale;
              const sh = Math.min(pg.height - sy, viewH / scale);
              const dh = sh * scale;

              ctx.save();
              ctx.shadowColor = 'rgba(22, 51, 107, 0.16)';
              ctx.shadowBlur = 28;
              ctx.shadowOffsetY = 10;
              roundRectPath(ctx, cardX, cardY, cardW, dh, 14);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
              ctx.restore();

              ctx.save();
              roundRectPath(ctx, cardX, cardY, cardW, dh, 14);
              ctx.clip();
              ctx.drawImage(pg, 0, sy, pg.width, sh, cardX, cardY, cardW, dh);
              ctx.restore();

              ctx.save();
              roundRectPath(ctx, cardX, cardY, cardW, dh, 14);
              ctx.strokeStyle = 'rgba(47, 111, 214, 0.18)';
              ctx.lineWidth = 1.5;
              ctx.stroke();
              ctx.restore();
            } else if (spec.kind === 'spread') {
              drawBackdrop(ctx, W, H);
              const p1 = await renderPdfPage(spec.url1, spec.page1 || 1, 1200);
              const p2 = await renderPdfPage(spec.url2 || spec.url1, spec.page2 || 2, 1200);
              const padY = 28, availH = H - padY * 2;
              const pageW = Math.round(availH * (p1.width / p1.height));
              const gap = 34;
              const startX = Math.round((W - (pageW * 2 + gap)) / 2);
              for (const [idx, pg] of [[0, p1], [1, p2]]) {
                const x = startX + idx * (pageW + gap);
                ctx.save();
                ctx.shadowColor = 'rgba(22, 51, 107, 0.16)';
                ctx.shadowBlur = 24;
                ctx.shadowOffsetY = 8;
                roundRectPath(ctx, x, padY, pageW, availH, 10);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.restore();
                ctx.save();
                roundRectPath(ctx, x, padY, pageW, availH, 10);
                ctx.clip();
                ctx.drawImage(pg, x, padY, pageW, availH);
                ctx.restore();
              }
            } else if (spec.kind === 'mobile') {
              drawBackdrop(ctx, W, H);
              // 左侧：A4 教师答案卷或学生卷重点区；右侧：手机竖屏长图
              const pg = await renderPdfPage(spec.pdfUrl, spec.page || 1, 1600);
              const leftW = 730, leftX = 48, leftY = 28, leftH = H - 56;
              const lScale = leftW / pg.width;
              const lSh = Math.min(pg.height, leftH / lScale);
              const lSy = Math.max(0, Math.min(pg.height - lSh, (pg.height - lSh) * (spec.yFrac ?? 0)));
              ctx.save();
              ctx.shadowColor = 'rgba(22, 51, 107, 0.15)';
              ctx.shadowBlur = 24;
              ctx.shadowOffsetY = 8;
              roundRectPath(ctx, leftX, leftY, leftW, leftH, 14);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
              ctx.restore();
              ctx.save();
              roundRectPath(ctx, leftX, leftY, leftW, leftH, 14);
              ctx.clip();
              ctx.drawImage(pg, 0, lSy, pg.width, lSh, leftX, leftY, leftW, lSh * lScale);
              ctx.restore();

              const mob = await loadImg(spec.pngUrl);
              const phoneW = 410, phoneX = 822, phoneY = 22, phoneH = H - 44;
              ctx.save();
              ctx.shadowColor = 'rgba(16, 36, 78, 0.22)';
              ctx.shadowBlur = 28;
              ctx.shadowOffsetY = 10;
              roundRectPath(ctx, phoneX - 10, phoneY - 10, phoneW + 20, phoneH + 20, 28);
              ctx.fillStyle = '#1e293b';
              ctx.fill();
              ctx.restore();

              const mScale = phoneW / mob.width;
              const mSh = Math.min(mob.height, phoneH / mScale);
              const mSy = Math.max(0, Math.min(mob.height - mSh, (mob.height - mSh) * (spec.pngYFrac ?? 0)));
              ctx.save();
              roundRectPath(ctx, phoneX, phoneY, phoneW, phoneH, 20);
              ctx.clip();
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(phoneX, phoneY, phoneW, phoneH);
              ctx.drawImage(mob, 0, mSy, mob.width, mSh, phoneX, phoneY, phoneW, mSh * mScale);
              ctx.restore();
            }
            return out.toDataURL('image/webp', spec.quality || 0.68);
          }
        };
      })();
      true;
    `);

    const outFiles = [];
    for (let i = 0; i < specs.length; i++) {
      const s = { ...specs[i] };
      for (const k of ['url', 'url1', 'url2', 'pdfUrl', 'pngUrl']) {
        if (s[k] && !s[k].startsWith('lesson://')) s[k] = lessonUrl(s[k]);
      }
      const dataUrl = await w.webContents.executeJavaScript(`window.__renderHelper.then(h => h.makeShot(${JSON.stringify(s)}))`);
      const b64 = dataUrl.replace(/^data:image\/webp;base64,/, '');
      const dest = path.join(outDir, `shot-${i + 1}.webp`);
      fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
      outFiles.push(dest);
    }
    return outFiles;
  } finally {
    await closeWindow(w);
  }
}

const CONFIG = {
  'lecture-slides': {
    exports: [{ md: '超重与失重-课件.md', formats: ['pptx', 'pdf'] }],
    pptxVerify: { file: '超重与失重-课件.pptx', minSlides: 14 },
    shots: (scDir, pptxSlides) => [
      { kind: 'slide', url: pptxSlides[0] },
      { kind: 'slide', url: pptxSlides[1] },
      { kind: 'slide', url: pptxSlides[4] },
      { kind: 'slide', url: pptxSlides[6] },
    ],
  },
  'practice-set': {
    exports: [
      { md: '超重与失重-练习.md', formats: ['docx', 'pdf'] },
      { md: '超重与失重-答案.md', formats: ['docx', 'pdf'] },
      { md: '超重与失重-学生长图.md', formats: ['png'] },
    ],
    shots: (scDir) => [
      { kind: 'focus', url: path.join(scDir, '超重与失重-练习.pdf'), page: 1, yFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-练习.pdf'), page: 2, yFrac: 0.15 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-答案.pdf'), page: 1, yFrac: 0 },
      { kind: 'mobile', pdfUrl: path.join(scDir, '超重与失重-答案.pdf'), page: 3, yFrac: 0.6, pngUrl: path.join(scDir, '超重与失重-学生长图.png'), pngYFrac: 0 },
    ],
  },
  homework: {
    exports: [
      { md: '超重与失重-作业.md', formats: ['docx', 'pdf'] },
      { md: '超重与失重-作业答案.md', formats: ['docx', 'pdf'] },
      { md: '超重与失重-学生长图.md', formats: ['png'] },
    ],
    shots: (scDir) => [
      { kind: 'focus', url: path.join(scDir, '超重与失重-作业.pdf'), page: 1, yFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-作业答案.pdf'), page: 1, yFrac: 0 },
      { kind: 'mobile', pdfUrl: path.join(scDir, '超重与失重-作业.pdf'), page: 2, yFrac: 0.25, pngUrl: path.join(scDir, '超重与失重-学生长图.png'), pngYFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-作业答案.pdf'), page: 2, yFrac: 0.35 },
    ],
  },
  'quiz-paper': {
    exports: [
      { md: '超重与失重-测验.md', formats: ['docx', 'pdf'] },
      { md: '超重与失重-测验答案.md', formats: ['docx', 'pdf'] },
    ],
    shots: (scDir) => [
      { kind: 'focus', url: path.join(scDir, '超重与失重-测验.pdf'), page: 1, yFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-测验.pdf'), page: 3, yFrac: 0.15 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-测验答案.pdf'), page: 2, yFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-测验答案.pdf'), page: 3, yFrac: 0.1 },
    ],
  },
  'lesson-notes': {
    exports: [{ md: '超重与失重-讲义.md', formats: ['docx', 'pdf'] }],
    maxPdfPages: 2,
    shots: (scDir) => [
      { kind: 'focus', url: path.join(scDir, '超重与失重-讲义.pdf'), page: 1, yFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-讲义.pdf'), page: 1, yFrac: 0.95 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-讲义.pdf'), page: 2, yFrac: 0.1 },
      { kind: 'spread', url1: path.join(scDir, '超重与失重-讲义.pdf'), page1: 1, page2: 2 },
    ],
  },
  'lesson-plan': {
    exports: [{ md: '超重与失重-教案.md', formats: ['docx', 'pdf'] }],
    shots: (scDir) => [
      { kind: 'focus', url: path.join(scDir, '超重与失重-教案.pdf'), page: 1, yFrac: 0 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-教案.pdf'), page: 2, yFrac: 0.08 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-教案.pdf'), page: 3, yFrac: 0.4 },
      { kind: 'focus', url: path.join(scDir, '超重与失重-教案.pdf'), page: 5, yFrac: 0 },
    ],
  },
};

function dirBytes(dir) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return sum;
}

async function processSkill(skill) {
  const cfg = CONFIG[skill];
  if (!cfg) throw new Error('未知技能：' + skill);
  const skillDir = path.join(EXAMPLES, skill);
  const scDir = path.join(skillDir, '_showcase');
  fs.mkdirSync(scDir, { recursive: true });

  // 0. 配图 SVG 源（examples/<skill>/配图/*.svg）先离屏渲染成同名高清 PNG
  const svgDir = path.join(skillDir, '配图');
  if (fs.existsSync(svgDir)) {
    for (const f of fs.readdirSync(svgDir).filter((x) => x.endsWith('.svg'))) {
      const svgText = fs.readFileSync(path.join(svgDir, f), 'utf8');
      const vb = /viewBox="\s*0\s+0\s+(\d+)\s+(\d+)\s*"/.exec(svgText);
      const w = vb ? Number(vb[1]) : 1200;
      const h = vb ? Number(vb[2]) : 800;
      const outPng = path.join(skillDir, '配图', f.replace(/\.svg$/i, '.png'));
      await renderSvgToPng(path.join(svgDir, f), outPng, w, h);
      console.log(`[svg->png] ${skill}/配图/${path.basename(outPng)} (${(fs.statSync(outPng).size / 1024).toFixed(1)} KB)`);
    }
  }

  // 1. 调用真实 exporter.cjs 导出所有目标成品，并移入 _showcase/
  const exportedFiles = [];
  for (const item of cfg.exports) {
    const mdPath = path.join(skillDir, item.md);
    assert.ok(fs.existsSync(mdPath), `缺少源文件: ${mdPath}`);
    const r = await exporter.exportMarkdown(mdPath, item.formats, () => makeWindow(1600, 900));
    assert.deepEqual(r.errors, [], `${item.md} 导出报错: ${r.errors.join('; ')}`);
    for (const outPath of r.out) {
      const dest = path.join(scDir, path.basename(outPath));
      fs.rmSync(dest, { force: true });
      fs.renameSync(outPath, dest);
      if (!fs.existsSync(PY)) {
        if (dest.endsWith('.png')) optimizePngFile(dest, 256);
        if (dest.endsWith('.pptx') || dest.endsWith('.docx')) optimizeZipMedia(dest);
      }
      exportedFiles.push(dest);
      console.log(`[export] ${skill}/_showcase/${path.basename(dest)} (${(fs.statSync(dest).size / 1024).toFixed(1)} KB)`);
    }
  }

  // 1b. 体积精简：PDF 嵌图量化+字体子集化，PPTX/DOCX/PNG 媒体去重+无抖动量化
  pyShrink('showcase-pdf-shrink.py', exportedFiles.filter((f) => f.endsWith('.pdf')));
  pyShrink('showcase-ooxml-shrink.py', exportedFiles.filter((f) => /\.(pptx|docx|png)$/.test(f)));

  // 2. 内置 OfficeConverter 核验（PPTX 逐页渲染核验 + DOCX 渲染核验）
  const office = new OfficeConverter({ makeWindow: () => makeWindow(1600, 900), url: lessonUrl, log: console });
  let pptxSlidePngs = [];
  if (cfg.pptxVerify) {
    const pptxPath = path.join(scDir, cfg.pptxVerify.file);
    const verifyDir = path.join(OUT_TMP, 'pptx-verify', skill);
    fs.rmSync(verifyDir, { recursive: true, force: true });
    fs.mkdirSync(verifyDir, { recursive: true });
    const res = await office.builtinSlides({ input: pptxPath, folder: verifyDir, progress: () => {} });
    assert.equal(res.render, 'images');
    assert.ok(res.images.length >= cfg.pptxVerify.minSlides, `PPTX 页数不足: ${res.images.length}`);
    pptxSlidePngs = res.images.map((im) => im.path);
    const stepInfo = pptSteps.analyze(fs.readFileSync(pptxPath));
    const texts = JSON.parse(fs.readFileSync(path.join(verifyDir, 'slides', 'texts.json'), 'utf8'));
    console.log(`[pptx-verify] ${res.images.length} 页全部通过内置 PPTX 排版器逐页渲染；单击分步页: ${stepInfo.slides.map((s) => `第${s.page + 1}页(${s.clicks}步)`).join('、')}；文字页数=${texts.length}`);
  }

  // 核验所有导出的 DOCX 与 PDF
  for (const f of exportedFiles) {
    if (f.endsWith('.docx')) {
      const z = new Map(entries(fs.readFileSync(f)).map((e) => [e.name, e.data]));
      const xml = z.get('word/document.xml')?.toString('utf8') || '';
      assert.ok(xml.length > 200, `${path.basename(f)} document.xml 为空`);
      assert.doesNotMatch(xml, /\[图片缺失\]/, `${path.basename(f)} 含缺失图片`);
      const docVerifyDir = path.join(OUT_TMP, 'docx-verify', skill, path.basename(f, '.docx'));
      fs.rmSync(docVerifyDir, { recursive: true, force: true });
      fs.mkdirSync(docVerifyDir, { recursive: true });
      const dr = await office.builtinDoc({ input: f, folder: docVerifyDir, progress: () => {} }, '.docx');
      assert.equal(dr.render, 'pdf');
    }
    if (f.endsWith('.pdf')) {
      const txt = await pdfText(fs.readFileSync(f));
      assert.ok(txt.trim().length > 50, `${path.basename(f)} PDF 文本层为空`);
      assert.doesNotMatch(txt, /\[图片缺失/, `${path.basename(f)} PDF 含缺失图片`);
      if (cfg.maxPdfPages) {
        const w = makeWindow(800, 600);
        try {
          await w.loadURL('studio://app/export.html');
          const pages = await w.webContents.executeJavaScript(`(async()=>{const p=await import('studio://vendor/pdfjs-dist/build/pdf.min.mjs');p.GlobalWorkerOptions.workerSrc='studio://vendor/pdfjs-dist/build/pdf.worker.min.mjs';const ab=await (await fetch(${JSON.stringify(lessonUrl(f))})).arrayBuffer();const d=await p.getDocument({data:new Uint8Array(ab)}).promise;return d.numPages;})()`);
          console.log(`[pdf-pages] ${path.basename(f)}: ${pages} 页 A4`);
          assert.ok(pages <= cfg.maxPdfPages, `${path.basename(f)} 页数 ${pages} 超过上限 ${cfg.maxPdfPages}`);
        } finally {
          await closeWindow(w);
        }
      }
    }
  }

  // 3. 生成 4 张 1280×720 WebP 轮播图
  const specs = cfg.shots(scDir, pptxSlidePngs);
  const shots = await renderShotsInBrowser(specs, scDir);
  for (const s of shots) {
    console.log(`[shot] ${skill}/_showcase/${path.basename(s)} (${(fs.statSync(s).size / 1024).toFixed(1)} KB)`);
  }

  // 4. 运行 deliverCheck.cjs（零告警门禁）
  // 临时移开 说明.md 的 mtime 或确保 说明.md 也满足 checkMarkdown（无错公式、无断图）
  const checkRes = await deliver.checkDeliverables(skillDir, {
    since: 0,
    skill,
    fetch: (u, o) => net.fetch(u, o),
    pdfText,
    log: (m) => console.log(`[sourceCheck] ${m}`),
  });
  console.log(`[deliverCheck] ${skill}: problems=${checkRes.problems.length}, notes=${JSON.stringify(checkRes.notes)}`);
  assert.deepEqual(checkRes.problems, [], `${skill} deliverCheck 存在告警:\n` + checkRes.problems.join('\n'));

  // 5. 检查 card.json（如果已存在）引用路径是否全部真实存在
  const cardPath = path.join(scDir, 'card.json');
  if (fs.existsSync(cardPath)) {
    const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
    assert.equal(card.skill, skill);
    assert.equal(card.preview?.type, 'slides');
    for (const imgRel of card.preview.images || []) {
      assert.ok(fs.existsSync(path.join(EXAMPLES, imgRel)), `card.json preview 缺失: ${imgRel}`);
    }
    for (const fullItem of card.full || []) {
      assert.ok(fs.existsSync(path.join(EXAMPLES, fullItem.file)), `card.json full 缺失: ${fullItem.file}`);
    }
    for (const refRel of card.styleRef || []) {
      assert.ok(!refRel.includes('_showcase'), `styleRef 不应在 _showcase 内: ${refRel}`);
      assert.ok(fs.existsSync(path.join(EXAMPLES, refRel)), `card.json styleRef 缺失: ${refRel}`);
    }
  }

  const totalBytes = dirBytes(skillDir);
  console.log(`[size] ${skill} 总大小 = ${(totalBytes / 1024).toFixed(1)} KB (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  assert.ok(totalBytes <= 1024 * 1024, `${skill} 超过 1 MB 预算: ${totalBytes} bytes`);
}

// 核验窗口逐个关闭时不要让 Electron 以为程序结束
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    const argSkill = process.argv.find((a) => a.startsWith('--skill='))?.split('=')[1];
    const all = process.argv.includes('--all');
    const targets = all ? Object.keys(CONFIG) : argSkill ? [argSkill] : [];
    if (!targets.length) throw new Error('请指定 --skill=<name> 或 --all');
    for (const sk of targets) {
      console.log(`\n=== 处理 ${sk} ===`);
      await processSkill(sk);
    }
    if (all) {
      const sum = Object.keys(CONFIG).reduce((acc, sk) => acc + dirBytes(path.join(EXAMPLES, sk)), 0);
      console.log(`\n=== 六类合计体积: ${(sum / 1024).toFixed(1)} KB (${(sum / 1024 / 1024).toFixed(2)} MB) / 6.00 MB ===`);
      assert.ok(sum <= 6 * 1024 * 1024, `六类总体积超标: ${sum}`);
    }
    app.exit(0);
  } catch (e) {
    console.error('FAILED:', e);
    app.exit(1);
  }
});
