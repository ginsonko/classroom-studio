// 安静地运行桌面验收：窗口透明、不接收鼠标、不抢焦点（这台电脑可能正有人在用）。
// 用法：electron test/quiet.cjs test/desktop-smoke.cjs
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// 透明窗口被别的全屏程序盖住时 Windows 会判定为"被遮挡"并停止绘制，截图就是旧画面
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
BrowserWindow.prototype.show = function () { this.showInactive(); };
BrowserWindow.prototype.focus = function () {};
app.on('browser-window-created', (_e, w) => { try { w.setOpacity(0); w.setIgnoreMouseEvents(true); } catch { /* 忽略 */ } });
require(path.resolve(process.argv.find((a) => a.endsWith('.cjs') && !a.endsWith('quiet.cjs'))));
