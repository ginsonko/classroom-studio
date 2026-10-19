// 网页课件保活：本地网页课件的 iframe 不随画面切换销毁，而是停到页面外的「停车区」里；
// 再切回来时用 Element.moveBefore 原样挪回（Chromium 133+ 移动时不重载 iframe），课件进度、动画状态都保留。
// 也可以提前把本课要用的网页课件放进停车区加载（预加载）。停车区里的课件静音（htmlshim 里的静音垫片）。
// 只保活 lesson:// 本地课件：远程网页没有静音垫片，离开画面就销毁，和以前一样。
import { assetUrl } from './pdf';

const HTML_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock';
const HTML_ALLOW = "autoplay; fullscreen; camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'";
const MAX_PARKED = 4;
const MUTED_NAME = 'cs-muted';

export interface WebFrame { el: HTMLIFrameElement; path: string; local: boolean; busy: boolean; loaded: boolean; failed: boolean; used: number; warm: boolean; subs: Set<() => void> }

const frames: WebFrame[] = [];
let lot: HTMLDivElement | null = null;
const canMove = typeof Element !== 'undefined' && 'moveBefore' in Element.prototype;

function parking() {
  if (lot?.isConnected) return lot;
  lot = document.createElement('div');
  lot.className = 'web-keep-lot';
  lot.setAttribute('aria-hidden', 'true');
  // 不能 display:none / visibility:hidden，否则部分课件以为自己不可见、停在初始化前
  Object.assign(lot.style, { position: 'fixed', left: '-20000px', top: '0', width: '1280px', height: '720px', overflow: 'hidden', pointerEvents: 'none' });
  document.body.appendChild(lot);
  return lot;
}

const isLocal = (path: string) => !/^https?:/i.test(path);

function create(path: string, title: string): WebFrame {
  const local = isLocal(path), el = document.createElement('iframe');
  el.title = title;
  el.setAttribute('sandbox', local ? HTML_SANDBOX : 'allow-scripts allow-forms');
  el.setAttribute('allow', HTML_ALLOW);
  el.referrerPolicy = 'no-referrer';
  const f: WebFrame = { el, path, local, busy: false, loaded: false, failed: false, used: Date.now(), warm: false, subs: new Set() };
  el.addEventListener('load', () => { f.loaded = true; f.subs.forEach((s) => s()); });
  el.addEventListener('error', () => { f.failed = true; f.subs.forEach((s) => s()); });
  el.src = assetUrl(path);
  return f;
}

/** 静音：初始状态靠 iframe 的 name（垫片在页面最开始读），之后靠 postMessage */
export function setMuted(f: WebFrame, on: boolean) {
  if (!f.local) return;
  f.el.name = on ? MUTED_NAME : '';
  try { f.el.contentWindow?.postMessage({ __cs: 'mute', on }, '*'); } catch {}
}

function park(f: WebFrame) {
  f.busy = false; f.used = Date.now();
  if (!f.local || !canMove || !f.el.isConnected || f.failed) { drop(f); return; }
  setMuted(f, true);
  f.el.style.pointerEvents = 'none';
  try { parking().moveBefore(f.el, null); } catch { drop(f); return; }
  trim();
}

function drop(f: WebFrame) {
  const i = frames.indexOf(f);
  if (i >= 0) frames.splice(i, 1);
  f.subs.clear();
  f.el.remove();
}

function trim() {
  const idle = frames.filter((f) => !f.busy).sort((a, b) => Number(b.warm) - Number(a.warm) || b.used - a.used);
  for (const f of idle.slice(MAX_PARKED)) drop(f);
}

/** 画面要显示某个网页课件：优先拿停车区里同一路径的那份（不重载） */
export function acquire(path: string, title: string, fresh = false): WebFrame {
  if (fresh) for (const f of frames.filter((x) => x.path === path && !x.busy)) drop(f);
  let f = frames.find((x) => x.path === path && !x.busy && !x.failed);
  if (!f) { f = create(path, title); frames.push(f); }
  f.busy = true; f.used = Date.now();
  return f;
}

/** 把 iframe 放进画面里的插槽 */
export function attach(f: WebFrame, slot: HTMLElement) {
  if (f.el.parentElement === slot) return;
  if (f.el.isConnected && canMove) { try { slot.moveBefore(f.el, null); return; } catch {} }
  slot.appendChild(f.el);
}

export function release(f: WebFrame) { park(f); }

/** 预加载：确保这些本地网页课件都在停车区里（静音）；不在列表里的预加载项可以被挤掉 */
export function warm(list: { path: string; title?: string }[]) {
  if (!canMove) return;
  const want = new Set(list.filter((x) => isLocal(x.path)).slice(0, MAX_PARKED).map((x) => x.path));
  for (const f of frames) if (f.warm && !want.has(f.path)) f.warm = false;
  for (const x of list) {
    if (!want.has(x.path)) continue;
    const have = frames.find((f) => f.path === x.path && !f.failed);
    if (have) { have.warm = true; continue; }
    const f = create(x.path, x.title || '预加载课件');
    f.warm = true; f.el.name = MUTED_NAME; f.el.style.pointerEvents = 'none';
    frames.push(f);
    parking().appendChild(f.el);
  }
  trim();
}

/** 测试与诊断用 */
export function keepState() {
  return { canMove, frames: frames.map((f) => ({ path: f.path, busy: f.busy, loaded: f.loaded, warm: f.warm, parked: f.el.parentElement === lot })) };
}
if (typeof window !== 'undefined' && window.csHost?.test) (window as unknown as { csWebKeep: typeof keepState }).csWebKeep = keepState;
