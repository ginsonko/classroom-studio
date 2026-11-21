// 生成「玲珑课堂」软件图标：build/icon.png（1024）、build/icon-256.png、build/icon.ico（Windows）、build/icon.icns（macOS）、build/icon.svg。
// 视觉识别：深邃温润的「砚台墨玉」底板 + 后层「琉璃青翠智慧预监窗（配玲珑四芒星徽）」+ 前层「暖金玉白课堂主屏（物理波形板书金线 + 朱砂录课点睛徽章）」。
// 兼顾 1024px 精致通透感与任务栏 16px/24px 极小尺寸下的高对比锐利辨识度。
// 用法：npx electron scripts/brand-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });

const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 1024 1024">
  <defs>
    <!-- 砚台墨玉深色护眼底板 -->
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#162638"/>
      <stop offset="52%" stop-color="#0f1b29"/>
      <stop offset="100%" stop-color="#080f18"/>
    </linearGradient>
    <!-- 顶部琉璃柔光反射 -->
    <radialGradient id="topGlow" cx="28%" cy="16%" r="68%">
      <stop offset="0%" stop-color="#2dd4bf" stop-opacity=".22"/>
      <stop offset="55%" stop-color="#38bdf8" stop-opacity=".06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <!-- 后窗：琉璃青翠导播预监窗 -->
    <linearGradient id="jade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3ce8d0"/>
      <stop offset="100%" stop-color="#149cb8"/>
    </linearGradient>
    <!-- 前窗：暖玉课堂主屏 -->
    <linearGradient id="board" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f3447"/>
      <stop offset="100%" stop-color="#132231"/>
    </linearGradient>
    <!-- 暖珀金边与板书轨迹线 -->
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffe08a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
    <!-- 朱砂点睛录课徽章 -->
    <linearGradient id="cinnabar" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff6b57"/>
      <stop offset="100%" stop-color="#e03a2d"/>
    </linearGradient>
    <filter id="cardShadow" x="-20%" y="-20%" width="145%" height="145%">
      <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#02060c" flood-opacity=".62"/>
    </filter>
  </defs>

  <!-- 圆角方章主体 -->
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#topGlow)"/>
  <rect x="67" y="67" width="890" height="890" rx="205" fill="none" stroke="#7dd3fc" stroke-opacity=".16" stroke-width="6"/>

  <!-- 后层：琉璃青翠预监窗（老师导播与 AI 智慧备课） -->
  <g filter="url(#cardShadow)">
    <rect x="166" y="206" width="468" height="364" rx="76" fill="url(#jade)" fill-opacity=".2" stroke="url(#jade)" stroke-width="44"/>
    <!-- 玲珑四芒星徽 -->
    <path d="M312 290 L328 334 L372 350 L328 366 L312 410 L296 366 L252 350 L296 334 Z" fill="#67f3e0"/>
  </g>

  <!-- 前层：课堂展示黑板主屏 -->
  <g filter="url(#cardShadow)">
    <rect x="358" y="380" width="504" height="416" rx="84" fill="url(#board)" stroke="url(#gold)" stroke-width="38"/>
    <!-- 课堂物理波峰/抛物线金弧板书轨迹 -->
    <path d="M438 648 C 498 512, 568 512, 620 604 S 724 680, 782 544" fill="none" stroke="url(#gold)" stroke-width="42" stroke-linecap="round"/>
    <!-- 右上温润朱砂点睛圆点（象征课堂开讲与准时录课护航） -->
    <circle cx="766" cy="476" r="38" fill="url(#cinnabar)"/>
    <circle cx="766" cy="476" r="16" fill="#fff5f2"/>
  </g>
</svg>`;

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

function icns(by) {
  const parts = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256],
    ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ].map(([type, size]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(8 + by[size].length, 4);
    return Buffer.concat([h, by[size]]);
  });
  const body = Buffer.concat(parts), h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii');
  h.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([h, body]);
}

app.whenReady().then(async () => {
  const left = Math.min(...(require('electron').screen.getAllDisplays().map((d) => d.bounds.x))) - 2200;
  const win = new BrowserWindow({ show: false, x: left, y: 0, width: 1024, height: 1024, frame: false, transparent: true });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg(1024)}</body></html>`));
  win.showInactive();
  await new Promise((r) => setTimeout(r, 800));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 400));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const by = {};
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    by[size] = (size === 1024 ? big : big.resize({ width: size, height: size, quality: 'best' })).toPNG();
  }
  fs.writeFileSync(path.join(out, 'icon.png'), by[1024]);
  fs.writeFileSync(path.join(out, 'icon-256.png'), by[256]);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: by[size] }))));
  fs.writeFileSync(path.join(out, 'icon.icns'), icns(by));
  fs.writeFileSync(path.join(out, 'icon.svg'), svg(1024));
  // 同步更新官网海报目录图标
  const posterIcon = path.join(__dirname, '../../site/poster/icon.png');
  if (fs.existsSync(path.dirname(posterIcon))) {
    fs.copyFileSync(path.join(out, 'icon-256.png'), posterIcon);
  }
  console.log('linglong classroom icons written to', out);
  app.exit(0);
});
