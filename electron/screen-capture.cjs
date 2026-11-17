'use strict';
// 搬自万能创作终端 0.7.0（electron/screen-capture.cjs），只改了提示里的软件名；要改行为先同步上游。
// Read-only screenshots of whole displays for vision models. Never moves the mouse or types.
const { fitSize } = require('./ai-browser-policy.cjs');
const displays = require('./displays.cjs');

const MAX_WIDTH = 1600;
const CAPTURE_MS = 15000;

function listDisplays(screen, o) {
  return displays.listDisplays(screen, o);
}

/** Output size of one display's screenshot: the long edge fits `max` (portrait screens too), never upscaled. */
function shotSize(phys, max = MAX_WIDTH) {
  return fitSize(phys.width, phys.height, max, max);
}

/**
 * Long edge of each picture when several displays go out together. Up to two keep the full size; from three
 * on each gets narrower, so all of them together cost about as much as two single screenshots.
 */
function eachWidth(n, maxWidth) {
  return n <= 2 ? maxWidth : Math.max(640, Math.round(maxWidth * Math.sqrt(2 / n)));
}

/** The cursor in DIP, when Electron can tell. */
function cursorOf(screen) {
  try {
    return typeof screen.getCursorScreenPoint === 'function' ? screen.getCursorScreenPoint() : null;
  } catch {
    return null;
  }
}

/**
 * Screenshots of one or more displays as downscaled JPEGs, one picture per display.
 * @param {{screen: any, desktopCapturer: any}} electron
 * @param {string|number|number[]|undefined} which 1-based number, display id, "primary", "all", or empty for `active`
 * @param {{maxWidth?: number, quality?: number, active?: number|'all'|null, platform?: string, timeoutMs?: number}} [o]
 *   active: the display a look means when none is named (else the cursor's display, else the primary one)
 * @returns {Promise<{shots: {data: Buffer, width: number, height: number, display: {index: number, label: string, title: string}}[],
 *   displays: object[], all: boolean, missing: number[]}>}
 */
async function captureDisplays(electron, which, { maxWidth = MAX_WIDTH, quality = 72, active, platform, timeoutMs = CAPTURE_MS } = {}) {
  const { screen, desktopCapturer } = electron;
  const list = listDisplays(screen, { platform });
  const auto = active ?? (displays.isAuto(which) ? displays.activeDisplay(list, { cursor: cursorOf(screen) })?.index : undefined);
  const picked = displays.pickDisplays(list, which, auto);
  if (!picked) throw Object.assign(new Error(`没有这个屏幕。可选：${list.map((x) => x.title).join('、')}，或者 all（全部屏幕）`), { displays: list });
  const each = picked.length > 1 ? eachWidth(picked.length, maxWidth) : maxWidth;
  const sizes = picked.map((d) => shotSize(d.phys, each));
  // One capture for every display: thumbnails come scaled to fit this box, then each is cut down to its own size.
  const box = { width: Math.max(...sizes.map((s) => s.width)), height: Math.max(...sizes.map((s) => s.height)) };
  // getSources can hang (a display waking up, a locked session); a turn waiting on it would hang with it.
  let timer = null;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`截图 ${Math.round(timeoutMs / 1000)} 秒没有完成，屏幕现在可能截不了`)), timeoutMs);
  });
  const sources = await Promise.race([desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box, fetchWindowIcons: false }), late]).finally(() => clearTimeout(timer));
  const raw = screen.getAllDisplays();
  const shots = [];
  const missing = [];
  picked.forEach((d, i) => {
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || (sources.length === raw.length && !sources.some((s) => s.display_id) ? sources[d.index - 1] : null) || (raw.length === 1 ? sources[0] : null);
    if (!src || src.thumbnail.isEmpty()) return void missing.push(d.index);
    let img = src.thumbnail;
    const got = img.getSize();
    const want = sizes[i];
    if ((got.width > want.width + 1 || got.height > want.height + 1) && typeof img.resize === 'function') img = img.resize({ width: want.width, height: want.height, quality: 'good' });
    const size = img.getSize();
    shots.push({ data: img.toJPEG(quality), width: size.width, height: size.height, display: { index: d.index, label: d.label, title: d.title } });
  });
  if (!shots.length) throw new Error(process.platform === 'darwin' ? '没能截图：请在「系统设置 → 隐私与安全性 → 屏幕录制」里允许最强网课教辅系统' : '没能截图，这个屏幕现在不能捕获');
  return { shots, displays: list, all: picked.length > 1, missing };
}

/**
 * One display as a downscaled JPEG (the first one when `which` names several).
 * @returns {Promise<{data: Buffer, width: number, height: number, display: {index: number, label: string, title: string}, displays: object[], shots: object[]}>}
 */
async function captureDisplay(electron, which, o = {}) {
  const r = await captureDisplays(electron, which, o);
  const s = r.shots[0];
  return { data: s.data, width: s.width, height: s.height, display: s.display, displays: r.displays, shots: r.shots };
}

module.exports = { captureDisplay, captureDisplays, listDisplays, shotSize, eachWidth, MAX_WIDTH, CAPTURE_MS };
