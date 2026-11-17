// 键鼠真机测试用的靶子窗口（单独的 Electron 进程，不是教辅自己的窗口，否则会被「不碰自己的窗口」规则拒绝）。
// 放在主屏右下角、小小的一块；被按下 / 被点中 / 被输入时往标准输出打一行，测试读到后关掉。
const { app, BrowserWindow, screen } = require('electron');
if (process.env.CS_DESK_PRECHECK_CONFIRMED !== '1') app.exit(2);
process.on('uncaughtException', (e) => { console.log('ERROR ' + e.message); app.exit(1); });
const PAGE = `<body style="margin:0;font:16px sans-serif">
<button id="b" style="position:absolute;left:20px;top:20px;width:120px;height:50px">点我</button>
<input id="i" style="position:absolute;left:20px;top:90px;width:240px;height:36px">
<script>
document.addEventListener('mousedown', (e) => console.log('DOWN ' + e.clientX + ',' + e.clientY));
document.getElementById('b').addEventListener('click', () => console.log('CLICKED'));
document.getElementById('i').addEventListener('input', (e) => console.log('TYPED:' + e.target.value));
</script></body>`;
app.whenReady().then(async () => {
  try {
    const wa = screen.getPrimaryDisplay().workArea, W = 300, H = 160;
    const w = new BrowserWindow({ width: W, height: H, x: wa.x + wa.width - W - 20, y: wa.y + wa.height - H - 20, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false, title: '键鼠测试靶子', backgroundColor: '#ffffff', webPreferences: { sandbox: true, contextIsolation: true } });
    w.webContents.on('before-input-event', (_e, i) => { if (i.type === 'mouseDown') console.log('INPUT mouseDown'); });
    w.webContents.on('console-message', (e) => { const m = String(e.message || ''); if (/^(CLICKED|TYPED:|DOWN)/.test(m)) console.log(m); });
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
    // 只有主测试先检查前台并获本次授权才允许到这里。首个点击不能只是激活窗口。
    w.show(); w.focus();
    await new Promise((r) => setTimeout(r, 600));
    const b = w.getContentBounds();
    const btn = screen.dipToScreenRect(w, { x: b.x + 20, y: b.y + 20, width: 120, height: 50 });
    const inp = screen.dipToScreenRect(w, { x: b.x + 20, y: b.y + 90, width: 240, height: 36 });
    const handle = w.getNativeWindowHandle();
    const hwnd = Number(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE());
    console.log('READY ' + JSON.stringify({ btn, inp, pid: process.pid, hwnd, focused: w.isFocused() }));
    setTimeout(() => app.exit(0), 60000);
  } catch (e) { console.log('ERROR ' + e.message); app.exit(1); }
});
