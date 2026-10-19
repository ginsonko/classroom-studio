'use strict';
// Teacher dock: a transparent window owned by the student window. It follows the student window and is shaped
// to its visible parts so the rest of the window passes clicks/pen strokes to the board below.
// It is focusable on purpose: as a focusable:false window, some whole sessions got hover (tooltips) but never a
// single pointerdown (see the input log), until the app was restarted. A focusable window always receives the
// activating click. After each click the page hands keyboard focus back to the student window ('focus' off).
const { BrowserWindow, screen } = require('electron');

const PAD = 14;          // room for shadows around the rail
const PANEL = 380;       // room for flyouts / popovers beside the rail
const MIN_H = 660;
const MAC = process.platform === 'darwin';

const HEARTBEAT = 3000, HUNG_AFTER = 2; // 连续 2 次（约 6–9 秒）没有回应就重建浮层

function createDock({ makeOptions, load, getStudent, settings, save, onVisibility, onCreate, log = { info() {}, warn() {}, error() {} } }) {
  let win = null, rail = { w: 96, h: 520 }, drag = null, timer = null, shape = null, beat = null, missed = 0, rebuilding = false;
  const st = () => { const s = typeof settings === 'function' ? settings() : settings; return s.dock ??= { visible: true, x: 18, y: 72, side: 'left' }; };
  const alive = () => win && !win.isDestroyed();
  // CS_QA_CAPTURE=1 只用于自动验收截图
  const guarded = () => { const s = typeof settings === 'function' ? settings() : settings; return !!s.captureGuard && process.env.CS_QA_CAPTURE !== '1'; };
  const studentOk = () => { const s = getStudent(); return s && !s.isDestroyed() && s.isVisible() && !s.isMinimized() ? s : null; };

  // macOS 的窗口不支持 setShape：整个浮层默认让鼠标穿透，光标移到工具条上时再接收点击
  let hit = [], hitTimer = null, through = null;
  function startHitTest() {
    if (hitTimer) return;
    hitTimer = setInterval(() => {
      if (!alive()) { clearInterval(hitTimer); hitTimer = null; through = null; return; }
      const p = screen.getCursorScreenPoint(), b = win.getBounds(), x = p.x - b.x, y = p.y - b.y;
      const inside = !!drag || hit.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
      if (through !== !inside) { through = !inside; win.setIgnoreMouseEvents(through, { forward: true }); }
    }, 40);
  }

  function bounds() {
    const s = getStudent(); if (!s || s.isDestroyed()) return null;
    const c = s.getContentBounds(), d = st();
    const x = Math.round(c.x + Math.max(0, Math.min(d.x, c.width - rail.w)));
    const y = Math.round(c.y + Math.max(0, Math.min(d.y, c.height - Math.min(rail.h, c.height))));
    const W = rail.w + PAD * 2 + PANEL, H = Math.max(MIN_H, rail.h + PAD * 2);
    return { x: d.side === 'right' ? x + rail.w + PAD - W : x - PAD, y: y - PAD, width: W, height: H };
  }
  function place() {
    if (!alive() || drag) return;
    const b = bounds(); if (b) win.setBounds(b);
  }
  function sync() {
    if (!alive()) return;
    if (st().visible && studentOk()) { place(); if (!win.isVisible()) win.showInactive(); }
    else if (win.isVisible()) win.hide();
    onVisibility?.(!!(st().visible && win.isVisible()));
  }
  async function ensure() {
    const s = getStudent();
    if (!s || s.isDestroyed()) return null;
    if (alive()) { sync(); return win; }
    win = new BrowserWindow({
      ...makeOptions(), parent: s, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: true, title: '教师浮层（仅老师可见）', ...(bounds() ?? {}),
    });
    // 防截屏默认关闭：开启后部分会议软件全屏共享时会在浮层位置显示黑块
    win.setContentProtection(guarded());
    shape = null; missed = 0; through = null;
    const self = win;
    log.info('浮层创建', bounds());
    onCreate?.(win);
    win.on('closed', () => { if (win === self) { win = null; clearInterval(timer); clearInterval(beat); drag = null; onVisibility?.(false); } });
    // 浮层页面崩溃或卡死时窗口还留在屏幕上、但什么都点不动：直接重建，而不是只提示
    win.webContents.on('render-process-gone', (_e, d) => { log.error('浮层页面退出，自动重建', d); void rebuild(); });
    if (!s.csDockHooked) {
      s.csDockHooked = true;
      for (const ev of ['move', 'resize', 'enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize', 'restore', 'show']) s.on(ev, ev === 'restore' || ev === 'show' ? sync : place);
      for (const ev of ['minimize', 'hide']) s.on(ev, sync);
    }
    await load(win);
    sync();
    clearInterval(beat);
    beat = setInterval(heartbeat, HEARTBEAT);
    return win;
  }
  async function heartbeat() {
    if (!alive() || !win.isVisible() || rebuilding) return;
    const wc = win.webContents;
    const ok = await Promise.race([wc.executeJavaScript('1').then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), HEARTBEAT - 200))]);
    if (ok) { if (missed) log.info('浮层恢复响应'); missed = 0; return; }
    missed++;
    log.warn('浮层没有响应', { missed });
    if (missed >= HUNG_AFTER) void rebuild();
  }
  async function rebuild() {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const old = win; win = null; clearInterval(beat); clearInterval(timer); drag = null; shape = null;
      if (old && !old.isDestroyed()) old.destroy();
      if (st().visible) await ensure();
      log.info('浮层已重建');
    } catch (e) { log.error('浮层重建失败', e); } finally { rebuilding = false; }
  }
  function message(m) {
    if (!alive() || !m || typeof m !== 'object') return;
    if (m.type === 'rail' && Number.isFinite(m.w) && Number.isFinite(m.h)) {
      const w = Math.max(40, Math.min(240, Math.ceil(m.w))), h = Math.max(40, Math.min(1400, Math.ceil(m.h)));
      if (w !== rail.w || h !== rail.h) { rail = { w, h }; place(); }
    } else if (m.type === 'shape' && Array.isArray(m.rects)) {
      const rects = m.rects.slice(0, 24).filter(r => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0)
        .map(r => ({ x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.ceil(r.width), height: Math.ceil(r.height) }));
      const key = JSON.stringify(rects);
      if (key === shape) return;
      shape = key;
      log.info('浮层形状', rects.map((r) => [r.x, r.y, r.width, r.height]));
      if (MAC) { hit = rects; startHitTest(); return; }
      try { win.setShape(rects.length ? rects : [{ x: 0, y: 0, width: 1, height: 1 }]); }
      catch (e) { log.error('设置浮层形状失败', e); win.setIgnoreMouseEvents(false); }
    } else if (m.type === 'drag') {
      if (m.phase === 'start') {
        const p = screen.getCursorScreenPoint(), b = win.getBounds();
        drag = { px: p.x, py: p.y, x: b.x, y: b.y };
        clearInterval(timer);
        timer = setInterval(() => {
          if (!drag || !alive()) return clearInterval(timer);
          const q = screen.getCursorScreenPoint();
          win.setPosition(Math.round(drag.x + q.x - drag.px), Math.round(drag.y + q.y - drag.py));
        }, 8);
      } else if (m.phase === 'end' && drag) {
        clearInterval(timer); drag = null;
        const s = getStudent();
        if (s && !s.isDestroyed()) {
          const c = s.getContentBounds(), b = win.getBounds(), d = st();
          const railX = d.side === 'right' ? b.x + b.width - PAD - rail.w : b.x + PAD;
          const side = railX + rail.w / 2 > c.x + c.width / 2 ? 'right' : 'left';
          d.x = Math.max(0, Math.min(railX - c.x, c.width - rail.w));
          d.y = Math.max(0, Math.min(b.y + PAD - c.y, c.height - 60));
          if (side !== d.side) { d.side = side; win.webContents.send('cs:event', { type: 'dock', side }); }
          save();
        }
        place();
      }
    } else if (m.type === 'log' && typeof m.text === 'string') {
      log.info('浮层', m.text.slice(0, 300));
    } else if (m.type === 'focus') {
      if (m.on) { log.info('浮层键盘输入 开启'); win.focus(); }
      else if (win.isFocused()) { const s = studentOk(); if (s) s.focus(); }
    } else if (m.type === 'mini') {
      st().mini = !!m.on; save();
    }
  }
  function setVisible(v) {
    st().visible = typeof v === 'boolean' ? v : !st().visible; save();
    if (st().visible) return ensure().then(() => st().visible);
    sync(); return Promise.resolve(false);
  }
  function protect() {
    if (!alive()) return;
    win.setContentProtection(guarded());
    win.webContents.send('cs:event', { type: 'dock', guard: guarded() });
  }
  return { ensure, sync, place, message, setVisible, protect, get window() { return win; }, get state() { return { ...st(), guard: guarded(), shown: !!(alive() && win.isVisible()) }; } };
}

module.exports = { createDock, DOCK_PAD: PAD };
