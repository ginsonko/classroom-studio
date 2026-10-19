// 真实鼠标点击浮层（系统级输入，走 Windows 命中测试）：sendInputEvent 绕过了窗口形状和激活逻辑，测不出"看得见点不动"。
// 用法：npx electron test/dock-realclick.cjs   （会短暂移动鼠标并点击 4~6 次，结束后把鼠标放回原处）
const fs = require('node:fs'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'realclick-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const { app, screen } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await Promise.resolve().then(fn).catch(() => false); if (v) return v; await sleep(80); } return false; };
const PS = `Add-Type -Namespace R -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern bool GetCursorPos(out System.Drawing.Point p); [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint f); [DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(System.Drawing.Point p); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);' -ReferencedAssemblies System.Drawing; [R.M]::SetProcessDPIAware() | Out-Null;`;
const ps = (body) => execFileSync('powershell.exe', ['-NoProfile', '-Command', PS + body], { encoding: 'utf8' }).trim();
const results = [];
(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const d = screen.getPrimaryDisplay(), wa = d.workArea, k = d.scaleFactor;
  student.setBounds({ x: wa.x + 100, y: wa.y + 60, width: 1000, height: 640 }); student.show(); if (process.env.CS_NOTOP === '1') student.moveTop(); else student.setAlwaysOnTop(true, 'screen-saver');
  const dock = await api.dock.ensure(); if (process.env.CS_NOTOP !== '1') dock.setAlwaysOnTop(true, 'screen-saver');
  await until(() => dock.webContents.executeJavaScript(`!!document.querySelector('.tdock')`)); await sleep(1200);
  // CS_FG=teacher：先让教师窗口成为前台窗口（老师刚在导播台里操作完，再去点浮层）
  // CS_FG=other：前台是别的程序（比如腾讯会议、浏览器），导播台窗口都不是活动窗口
  if (process.env.CS_FG === 'other') { const { BrowserWindow } = require('electron'); const o = new BrowserWindow({ x: wa.x + 1150, y: wa.y + 60, width: 500, height: 400, title: 'OTHER APP' }); o.loadURL('data:text/html,<h1>other'); o.setAlwaysOnTop(true, 'screen-saver'); o.focus(); await sleep(700); }
  if (process.env.CS_FG === 'student') { student.focus(); await sleep(500); }
  if (process.env.CS_FG === 'teacher') { teacher.setBounds({ x: wa.x + 1150, y: wa.y + 60, width: 600, height: 500 }); teacher.show(); teacher.setAlwaysOnTop(true, 'screen-saver'); teacher.focus(); await sleep(500); }
  const cs = path.join(__dirname, '../.out/winstyles.cs');
  if (fs.existsSync(cs)) console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${cs}'); [W]::Run(${process.pid})`], { encoding: 'utf8' }));
  const saved = ps(`$p=New-Object System.Drawing.Point; [R.M]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`);
  const click = async (sel, label) => {
    const r = await dock.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!r) { results.push({ label, ok: false, why: 'not found ' + sel }); return; }
    const b = dock.getContentBounds(), zoom = 1, hwnd = dock.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const sx = Math.round((b.x + r.x * zoom) * k), sy = Math.round((b.y + r.y * zoom) * k);
    await dock.webContents.executeJavaScript(`window.__clicks=[];addEventListener('pointerdown',e=>__clicks.push(e.target.closest('[data-tip],button')?.dataset?.tip||e.target.className),{capture:true,once:true});true`);
    const under = ps(`[R.M]::SetCursorPos(${sx},${sy}) | Out-Null; Start-Sleep -Milliseconds 120; $p=New-Object System.Drawing.Point; [R.M]::GetCursorPos([ref]$p) | Out-Null; $h=[R.M]::WindowFromPoint($p); $s=New-Object Text.StringBuilder 200; [R.M]::GetWindowText($h,$s,200) | Out-Null; $f=[R.M]::GetForegroundWindow(); $fs=New-Object Text.StringBuilder 200; [R.M]::GetWindowText($f,$fs,200) | Out-Null; "$($p.X),$($p.Y) under=$h fg=$f $fs"; $root=[R.M]::GetAncestor($h,2); "root=$root"; if ($root -eq [IntPtr]${hwnd}) { [R.M]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 40; [R.M]::mouse_event(4,0,0,0,0) } else { "SKIPPED: not over dock" }`);
    console.log(label, { scale: k, dockBounds: dock.getContentBounds(), r, sx, sy, under });
    await sleep(400);
    const got = await dock.webContents.executeJavaScript('window.__clicks');
    results.push({ label, ok: got.length > 0, got, at: [sx, sy] }); console.log(label, got.length ? 'RECEIVED ' + got[0] : 'NOT RECEIVED');
  };
  try {
    await click('.tdock .tp-g .tp-b', 'tool button (guard off)');
    await click('.tdock-grip button', 'minimize button');
    await sleep(500);
    const mini = await dock.webContents.executeJavaScript(`!!document.querySelector('.tdock-mini')`);
    results.push({ label: 'mini shown', ok: mini }); console.log('mini shown', mini);
    if (mini) { await click('.tdock-mini', 'mini dot (expand)'); await sleep(500); }
    const back = await dock.webContents.executeJavaScript(`!!document.querySelector('.tdock')`); results.push({ label: 'rail back', ok: back }); console.log('rail back', back);
    if (back) await click('.tdock .tp-g .tp-b', 'tool button after expand');
    await teacher.webContents.executeJavaScript(`window.csHost.call('setSettings',{captureGuard:true})`); await sleep(600);
    await click('.tdock .tp-g .tp-b', 'tool button (guard on)');
    await teacher.webContents.executeJavaScript(`window.csHost.call('setSettings',{captureGuard:false})`); await sleep(600);
    await click('.tdock .tp-g .tp-b', 'tool button (guard off again)');
  } finally {
    const [x, y] = saved.split(','); ps(`[R.M]::SetCursorPos(${x},${y}) | Out-Null`);
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log('RESULT ' + out);
  for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); app.exit(1); });
