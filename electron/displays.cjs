'use strict';
// 搬自万能创作终端 0.7.0（electron/displays.cjs），只改了提示里的软件名；要改行为先同步上游。
// Every monitor for looking and pointing: its DIP and physical rectangle, how the model hears about it,
// which one a look means, which windows show on it and where the emergency-stop corners are.
// No Electron in here (the `screen` module is passed in), so mixed-DPI layouts are unit tested.

/**
 * A display's rectangle in physical pixels (what SendInput, the cursor and window rects use). On Windows the
 * origin comes from `screen.dipToScreenRect` because with mixed scale factors DIP origins are not simply
 * DIP x scale (a 100 % screen left of a 125 % primary sits at DIP -2784 but physical -3000).
 * @param {{bounds: {x:number,y:number,width:number,height:number}, size?: {width:number,height:number}, scaleFactor?: number}} d
 * @param {((r: object) => {x:number,y:number}) | null} toScreen
 */
function physicalRect(d, toScreen) {
  const sf = d.scaleFactor || 1;
  const size = d.size || d.bounds;
  let origin = null;
  try {
    origin = toScreen ? toScreen(d.bounds) : null;
  } catch {
    origin = null;
  }
  const ok = origin && Number.isFinite(origin.x) && Number.isFinite(origin.y);
  // The converter's size is exact for fractional scale factors (125% of 1366 is not size x 1.25 rounded).
  const sized = ok && Number.isFinite(origin.width) && Number.isFinite(origin.height) && origin.width > 0 && origin.height > 0;
  return {
    x: Math.round(ok ? origin.x : d.bounds.x * sf),
    y: Math.round(ok ? origin.y : d.bounds.y * sf),
    width: Math.max(1, Math.round(sized ? origin.width : size.width * sf)),
    height: Math.max(1, Math.round(sized ? origin.height : size.height * sf)),
  };
}

const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Where a display is from the primary one, in words: 主屏右边, 主屏左边，紧挨着主屏 / 主屏左边，再往外一块, 主屏上面 … */
function placeWords(list) {
  const p = list.find((d) => d.primary) || list[0];
  const pc = centre(p.bounds);
  const side = (d) => {
    const c = centre(d.bounds);
    const dx = c.x - pc.x;
    const dy = c.y - pc.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? '左边' : '右边';
    return dy < 0 ? '上面' : '下面';
  };
  const out = new Map();
  for (const s of ['左边', '右边', '上面', '下面']) {
    const far = (d) => {
      const c = centre(d.bounds);
      return Math.abs(s === '左边' || s === '右边' ? c.x - pc.x : c.y - pc.y);
    };
    const group = list.filter((d) => d !== p && side(d) === s).sort((a, b) => far(a) - far(b));
    // No ordinal: next to 「屏幕 3」 a 「第 1 块」 reads as another screen's number, and the model clicks on that one.
    group.forEach((d, i) => out.set(d.id, `主屏${s}${group.length > 1 ? (i ? `，再往外${'一两三四五六七八'[i - 1] || '几'}块` : '，紧挨着主屏') : ''}`));
  }
  return out;
}

/**
 * Every display as the looking code sees it, in Electron's order (screen 1, 2, …).
 * width/height are DIP, the way Windows names the resolution at that scale; phys is physical pixels.
 * @returns {{index: number, id: any, primary: boolean, width: number, height: number, scale: number, rotation: number,
 *   bounds: object, workArea: object, phys: {x:number,y:number,width:number,height:number}, label: string, title: string}[]}
 */
function listDisplays(screen, { platform = process.platform } = {}) {
  const primary = screen.getPrimaryDisplay().id;
  const toScreen = platform === 'win32' && screen.dipToScreenRect ? (b) => screen.dipToScreenRect(null, b) : null;
  const raw = screen.getAllDisplays();
  const list = raw.map((d0, i) => {
    const size = d0.size || d0.bounds;
    const d = d0.bounds ? d0 : { ...d0, bounds: { x: 0, y: 0, width: size.width, height: size.height } };
    return {
      index: i + 1,
      id: d.id,
      primary: d.id === primary,
      width: size.width,
      height: size.height,
      scale: d.scaleFactor || 1,
      rotation: d.rotation || 0,
      bounds: d.bounds,
      workArea: d.workArea || d.bounds,
      phys: physicalRect(d, toScreen),
      work: physicalRect({ bounds: d.workArea || d.bounds, size: d.workArea ? { width: d.workArea.width, height: d.workArea.height } : size, scaleFactor: d.scaleFactor }, toScreen),
      label: `屏幕 ${i + 1}`,
      title: '',
    };
  });
  const where = list.length > 1 ? placeWords(list) : new Map();
  for (const d of list) {
    const bits = [d.primary && list.length > 1 ? '主屏' : '', `${d.width}×${d.height}`, d.scale !== 1 ? `缩放 ${Math.round(d.scale * 100)}%` : '', d.height > d.width ? '竖屏' : '', where.get(d.id) || ''];
    d.title = `${d.label}（${bits.filter(Boolean).join('，')}）`;
  }
  return list;
}

const ALL = /^(all|\*|全部|所有|全部屏幕|所有屏幕)$/i;
const AUTO = /^(auto|active|current|当前|当前屏幕)$/i;
const PRIMARY = /^(primary|main|主屏|主屏幕)$/i;

/** Whether a `display` argument asks for every screen. */
function wantsAll(which) {
  return ALL.test(String(which ?? '').trim());
}

/** Whether a `display` argument leaves the choice to us (empty, "auto"). */
function isAuto(which) {
  const s = String(which ?? '').trim();
  return !s || AUTO.test(s);
}

/**
 * Which displays a look means: a 1-based number, a display id, "primary", "all", a list of numbers, or empty
 * for `active` (the display that matters right now; the primary one when unknown). null when it names none.
 */
function pickDisplays(list, which, active) {
  if (!list.length) return null;
  const primary = list.find((d) => d.primary) || list[0];
  if (Array.isArray(which)) {
    const out = [];
    for (const w of which) {
      const d = pickDisplays(list, w, active);
      if (!d || d.length !== 1) return null;
      if (!out.includes(d[0])) out.push(d[0]);
    }
    return out.length ? out : null;
  }
  if (wantsAll(which)) return list.slice();
  if (isAuto(which)) {
    const a = active === 'all' ? null : list.find((d) => d.index === Number(active));
    return active === 'all' ? list.slice() : [a || primary];
  }
  if (PRIMARY.test(String(which).trim())) return [primary];
  const n = Number(which);
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return [list[n - 1]];
  const byId = list.find((d) => String(d.id) === String(which).trim());
  return byId ? [byId] : null;
}

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
const distance = (r, x, y) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.width - 1)), Math.max(r.y - y, 0, y - (r.y + r.height - 1)));

/** The display containing a physical point, else the nearest one. */
function displayAtPhysical(list, x, y) {
  if (!list.length || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  return list.find((d) => inside(d.phys, x, y)) || list.slice().sort((a, b) => distance(a.phys, x, y) - distance(b.phys, x, y))[0];
}

/** The display containing a DIP point (Electron window bounds, the cursor), else the nearest one. */
function displayAtDip(list, x, y) {
  if (!list.length || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  return list.find((d) => inside(d.bounds, x, y)) || list.slice().sort((a, b) => distance(a.bounds, x, y) - distance(b.bounds, x, y))[0];
}

/** The display a window (physical [left, top, right, bottom], as the desk helper reports it) shows on most. */
function displayOfRect(list, rect) {
  if (!Array.isArray(rect) || rect.length < 4 || !list.length) return null;
  const [l, t, r, b] = rect.map(Number);
  let best = null;
  let most = 0;
  for (const d of list) {
    const p = d.phys;
    const w = Math.min(r, p.x + p.width) - Math.max(l, p.x);
    const h = Math.min(b, p.y + p.height) - Math.max(t, p.y);
    const area = w > 0 && h > 0 ? w * h : 0;
    if (area > most) {
      most = area;
      best = d;
    }
  }
  return best || displayAtPhysical(list, (l + r) / 2, (t + b) / 2);
}

/**
 * The display that matters for a look nobody named: the owner's foreground window (unless it is this app's
 * own, which says nothing about the work), else the cursor, else the primary one.
 * @param {{window?: number[] | null, own?: boolean, cursor?: {x:number,y:number} | null}} hints window: physical rect; cursor: DIP
 * @returns {{index: number, by: 'window'|'cursor'|'primary'} | null}
 */
function activeDisplay(list, { window, own = false, cursor } = {}) {
  if (!list.length) return null;
  const w = !own ? displayOfRect(list, window) : null;
  if (w) return { index: w.index, by: 'window' };
  const c = cursor ? displayAtDip(list, cursor.x, cursor.y) : null;
  if (c) return { index: c.index, by: 'cursor' };
  return { index: (list.find((d) => d.primary) || list[0]).index, by: 'primary' };
}

// A window reaching less than this far onto a display (a shadow, a rounding pixel) is not on it.
const EDGE = 4;

/**
 * The windows a screenshot of one display can show: topmost first, those overlapping it, down to and including
 * the first opaque window that covers its whole work area (a maximized window: what lies under it cannot be
 * seen; the taskbar is above it in the z-order anyway).
 * @param {{rect: number[], opaque?: boolean}[]} windows top-level windows in z-order, topmost first
 * @param {{x:number,y:number,width:number,height:number}} phys the display, physical pixels
 * @param {{x:number,y:number,width:number,height:number}} [work] its work area, physical pixels
 */
function windowsOn(windows, phys, work = phys) {
  const out = [];
  for (const w of windows || []) {
    if (!Array.isArray(w?.rect) || w.rect.length < 4) continue;
    const [l, t, r, b] = w.rect.map(Number);
    const ow = Math.min(r, phys.x + phys.width) - Math.max(l, phys.x);
    const oh = Math.min(b, phys.y + phys.height) - Math.max(t, phys.y);
    if (!(ow > EDGE && oh > EDGE)) continue;
    out.push(w);
    if (w.opaque !== false && l <= work.x && t <= work.y && r >= work.x + work.width && b >= work.y + work.height) break;
  }
  return out;
}

/**
 * Physical points where a flung mouse stops in a top-left corner: a display's top-left pixel with no display
 * to its left or above it. With screens left of or above the primary, the virtual desktop's own top-left
 * often lies on no screen at all, so the cursor could never reach it.
 */
function corners(list) {
  const rects = list.map((d) => d.phys || d);
  const on = (x, y) => rects.some((r) => inside(r, x, y));
  return rects.filter((r) => !on(r.x - 1, r.y) && !on(r.x, r.y - 1)).map((r) => [r.x, r.y]);
}

/**
 * What the model is told about the screens: count, which is primary, sizes and places, where the pet and the
 * foreground window are. '' with a single display (nothing to choose).
 * @param {{pet?: number|null, window?: number|null}} at 1-based display numbers
 */
function describeDisplays(list, at = {}) {
  if (list.length < 2) return '';
  const bits = [`这台电脑有 ${list.length} 个屏幕：${list.map((d) => d.title).join('、')}`];
  if (at.window) bits.push(`主人现在的前台窗口在屏幕 ${at.window}`);
  if (at.pet) bits.push(`桌宠在屏幕 ${at.pet}`);
  return `${bits.join('；')}。`;
}

module.exports = { physicalRect, listDisplays, pickDisplays, wantsAll, isAuto, displayAtPhysical, displayAtDip, displayOfRect, activeDisplay, windowsOn, corners, describeDisplays };
