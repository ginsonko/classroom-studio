// 长黑板：一整条往下延伸的黑板。只有一页（宽 1600），画面是其中 16:9 的一段，用 view.y 记位置。
// 页面高度随滚动自动加长（下面始终留一屏空白），最长 MAX_SCREENS 屏。
import type { Material, View } from './types';

/** 一屏的高度，按页宽计 */
export const SCREEN = 9 / 16;
export const MAX_SCREENS = 20;
const START_SCREENS = 3;
const W = 1600;

export const isLong = (m: Pick<Material, 'kind' | 'long'> | undefined | null) => !!m && m.kind === 'board' && !!m.long;
export const longRatio = (m: Material) => { const p = m.pages[0]; return p && p.w > 0 ? p.h / p.w : SCREEN * START_SCREENS; };

export function longMaterial(n: number): Material {
  return { id: 'board-long-' + Date.now().toString(36), kind: 'board', long: true, title: '长黑板' + (n > 1 ? ' ' + n : ''), pages: [{ w: W, h: Math.round(W * SCREEN * START_SCREENS) }], total: 1 };
}

/** 把位置限制在页面里 */
export function clampY(m: Material, y: number) {
  return Math.max(0, Math.min(longRatio(m) - SCREEN, Number.isFinite(y) ? y : 0));
}

/** 往下滚 dy（按页宽计，负数往上） */
export function scrollView(m: Material, v: View, dy: number): View {
  return { ...v, page: 0, slide: 0, fit: 'page', region: undefined, y: clampY(m, (v.y ?? 0) + dy) };
}

/** 画面下面不到一屏空白时加长（返回新的 Material；不用加长返回 null） */
export function grownFor(m: Material, y: number): Material | null {
  const ratio = longRatio(m), max = SCREEN * MAX_SCREENS;
  if (y + SCREEN * 2 <= ratio + 1e-6 || ratio >= max - 1e-6) return null;
  const want = Math.min(max, Math.ceil((y + SCREEN * 2) / SCREEN - 1e-6) * SCREEN);
  return { ...m, pages: [{ ...m.pages[0], h: Math.round(m.pages[0].w * want) }] };
}

export const atEnd = (m: Material, v: View) => longRatio(m) >= SCREEN * MAX_SCREENS - 1e-6 && (v.y ?? 0) >= longRatio(m) - SCREEN - 1e-3;

/** 第几屏（画面中线所在的那一屏） / 共几屏 */
export function screenLabel(m: Material, v: View) {
  const total = Math.max(1, Math.round(longRatio(m) / SCREEN));
  const cur = Math.min(total, Math.floor(((v.y ?? 0) + SCREEN / 2) / SCREEN) + 1);
  return `${cur} / ${total} 屏`;
}
