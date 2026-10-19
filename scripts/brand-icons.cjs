// 生成软件图标：build/icon.png（1024）、build/icon.ico（Windows）、build/icon.icns（macOS）。
// 图案和界面左上角的 Logo 一样：虚线框是「预览」，红色播放块是「学生正在看」。
// 用法：npx electron scripts/brand-icons.cjs
const fs = require('node:fs'); const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const out = path.join(__dirname, '..', 'build'); fs.mkdirSync(out, { recursive: true });

const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2633"/><stop offset="1" stop-color="#0b1118"/></linearGradient>
    <linearGradient id="live" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a52"/><stop offset="1" stop-color="#e5322b"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".45"/></filter>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <rect x="64.5" y="64.5" width="895" height="895" rx="199.5" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="3"/>
  <rect x="170" y="250" width="440" height="360" rx="70" fill="none" stroke="#3ddbd9" stroke-width="58" stroke-dasharray="96 70" stroke-linecap="round"/>
  <g filter="url(#sh)"><rect x="410" y="410" width="460" height="370" rx="80" fill="url(#live)"/></g>
  <path d="M590 520 L590 670 L715 595 Z" fill="#fff" stroke="#fff" stroke-width="24" stroke-linejoin="round"/>
</svg>`;

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

function icns(by) {
  // 新式 icns 每项直接放 PNG
  const parts = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
    .map(([type, size]) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(8 + by[size].length, 4); return Buffer.concat([h, by[size]]); });
  const body = Buffer.concat(parts), h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([h, body]);
}

app.whenReady().then(async () => {
  // 离屏渲染模式 capturePage 会卡住：放到屏幕外但正常显示（和验收测试一样）
  const left = Math.min(...(require('electron').screen.getAllDisplays().map((d) => d.bounds.x))) - 2200;
  const win = new BrowserWindow({ show: false, x: left, y: 0, width: 1024, height: 1024, frame: false, transparent: true });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg(1024)}</body></html>`));
  win.showInactive();
  await new Promise((r) => setTimeout(r, 800));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 400));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const by = {};
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) by[size] = (size === 1024 ? big : big.resize({ width: size, height: size, quality: 'best' })).toPNG();
  fs.writeFileSync(path.join(out, 'icon.png'), by[1024]);
  fs.writeFileSync(path.join(out, 'icon-256.png'), by[256]);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: by[size] }))));
  fs.writeFileSync(path.join(out, 'icon.icns'), icns(by));
  fs.writeFileSync(path.join(out, 'icon.svg'), svg(1024));
  console.log('icons written to', out);
  app.exit(0);
});
