// 学生画面的「桌面」：黑板垫底，打开过的课件各占一项、各自记住页码。
// 这里只放纯函数（store 和测试共用）；正在操作的一项始终是 pgm / pgmMat。
import type { DeskWin, Material, View } from './types';
import { isLong, screenLabel } from './longBoard';

export const BASE = 'board';
/** 学生窗口同时打开的课件数默认上限（不含黑板）；0 表示不限 */
export const DEFAULT_LIMIT = 10;

/** 笔迹键 → 课件 id（键是「课件 id#页码」，课件 id 里可能有冒号，但不会有 #） */
export const matOfKey = (key: string) => key.slice(0, key.lastIndexOf('#'));

export function deskIds(pgmMatId: string, desk: DeskWin[] | undefined): Set<string> {
  return new Set([pgmMatId, ...(desk ?? []).map((w) => w.id)]);
}

export const topZ = (desk: DeskWin[]) => desk.reduce((m, w) => Math.max(m, w.z), 0);

/** 新窗口的位置：在画面中间偏右，依次错开一点，像系统窗口那样叠放 */
export function cascade(desk: DeskWin[]): [number, number, number, number] {
  const n = desk.filter((w) => w.mode === 'normal').length % 6;
  return [0.2 + n * 0.035, 0.08 + n * 0.045, 0.56, 0.62];
}

/** 把正在操作的一项（pgm）写回 desk；黑板和当前项不在 desk 里时补上 */
export function syncDesk(desk: DeskWin[] | undefined, pgmMat: Material, pgm: View, sim: unknown, board: () => Material, view: (m: Material) => View): DeskWin[] {
  const out = (desk ?? []).map((w) => (w.id === pgmMat.id ? { ...w, mat: pgmMat, view: pgm, sim: simOf(sim, pgmMat.id) ?? w.sim } : w));
  if (!out.some((w) => w.id === BASE)) {
    const b = pgmMat.id === BASE ? pgmMat : board();
    out.unshift({ id: BASE, mat: b, view: pgmMat.id === BASE ? pgm : view(b), rect: [0, 0, 1, 1], mode: 'max', z: 0, at: 0 });
  }
  if (!out.some((w) => w.id === pgmMat.id)) out.push({ id: pgmMat.id, mat: pgmMat, view: pgm, rect: cascade(out), mode: 'max', z: topZ(out) + 1, at: Date.now(), sim: simOf(sim, pgmMat.id) });
  return out;
}

const simOf = (sim: unknown, id: string) => (sim && typeof sim === 'object' && (sim as { matId?: string }).matId === id ? sim : undefined);

/** 超过上限时关掉最久没用的课件。黑板（普通 / 长黑板）都不自动关：关了板书就找不到入口了。limit <= 0 不限。 */
export function trimDesk(desk: DeskWin[], keep: string, limit: number): DeskWin[] {
  if (!(limit > 0)) return desk;
  const docs = desk.filter((w) => w.mat.kind !== 'board');
  const extra = docs.length - limit;
  if (extra <= 0) return desk;
  const drop = new Set(docs.filter((w) => w.id !== keep).sort((a, b) => a.at - b.at).slice(0, extra).map((w) => w.id));
  return desk.filter((w) => !drop.has(w.id));
}

/** 最近用过的那块黑板（long = 长黑板 / 普通黑板），没有返回 undefined */
export function latestBoard(desk: DeskWin[], long: boolean): DeskWin | undefined {
  return desk.filter((w) => w.mat.kind === 'board' && isLong(w.mat) === long).sort((a, b) => b.at - a.at)[0];
}

/**
 * 学生画面上实际画出来的层：当前项是「占满」时只画它；否则画黑板 + 所有浮动窗口（按叠放次序）。
 * 返回的 mat / view 已经用 pgm 替换过当前项。
 */
export function visibleLayers(desk: DeskWin[], pgmMat: Material, pgm: View): { full: DeskWin | null; base: DeskWin | null; floating: DeskWin[] } {
  const live = desk.map((w) => (w.id === pgmMat.id ? { ...w, mat: pgmMat, view: pgm } : w));
  const cur = live.find((w) => w.id === pgmMat.id) ?? { id: pgmMat.id, mat: pgmMat, view: pgm, rect: [0, 0, 1, 1] as DeskWin['rect'], mode: 'max' as const, z: 0, at: 0 };
  if (cur.id !== BASE && cur.mode === 'max') return { full: cur, base: null, floating: [] };
  const base = live.find((w) => w.id === BASE) ?? (cur.id === BASE ? cur : null);
  return { full: null, base, floating: live.filter((w) => w.id !== BASE && w.mode === 'normal').sort((a, b) => a.z - b.z) };
}

/** 侧边切换栏里的顺序：黑板在最前，其余按最近使用 */
export function deskOrder(desk: DeskWin[]): DeskWin[] {
  return [...desk].sort((a, b) => (a.id === BASE ? -1 : b.id === BASE ? 1 : b.at - a.at));
}

/** 放大 / 缩小：在当前可见区域上按倍数缩放（以 cx, cy 为中心，页面坐标 0~1）。返回 null 表示回到整页。 */
export function zoomRegion(view: View, page: { w: number; h: number; slides?: number[][] }, factor: number, aspect: number, cx = -1, cy = -1): [number, number, number, number] | null {
  const r = page.h / page.w;
  // 当前可见区域（宽以页宽为 1、高以页高为 1）；幻灯片模式从当前这一块开始放大
  const slide = view.fit === 'slides' ? page.slides?.[view.slide] : undefined;
  const cur = view.fit === 'region' && view.region ? view.region : slide && slide.length === 4 ? slide : [0, 0, 1, 1];
  let [x, y, w, h] = cur;
  if (cx < 0) cx = x + w / 2;
  if (cy < 0) cy = y + h / 2;
  let nw = w / factor;
  // 让框选区域和容器同比例（aspect = 容器宽 / 高），放大后铺满画面
  let nh = (nw / aspect) / r;
  if (nw >= 1 && nh >= 1) return null;
  if (nw > 1) { nh *= 1 / nw; nw = 1; }
  if (nh > 1) { nw *= 1 / nh; nh = 1; }
  if (nw < 0.04) return [x, y, w, h];
  x = Math.min(1 - nw, Math.max(0, cx - (cx - x) * (nw / w)));
  y = Math.min(1 - nh, Math.max(0, cy - (cy - y) * (nh / h)));
  return [x, y, nw, nh];
}

/** 并排摆放 n 个窗口：2 个左右各半，3 个三等分，4 个田字格，更多按列数自动排 */
export function tileRects(n: number): [number, number, number, number][] {
  if (n <= 1) return [[0, 0, 1, 1]];
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows]);
}

/** 选出要并排的窗口：当前项 + 最近用过的其它课件（不含黑板），最多 4 个 */
export function tileIds(desk: DeskWin[], current: string, max = 4): string[] {
  const others = desk.filter((w) => w.id !== BASE && w.id !== current).sort((a, b) => (a.mode === 'min' ? 1 : 0) - (b.mode === 'min' ? 1 : 0) || b.at - a.at);
  return [...(current !== BASE ? [current] : []), ...others.map((w) => w.id)].slice(0, max);
}

export function tileDesk(desk: DeskWin[], ids: string[]): DeskWin[] {
  const rects = tileRects(ids.length);
  let z = topZ(desk);
  return desk.map((w) => {
    const i = ids.indexOf(w.id);
    return i < 0 ? w : { ...w, rect: rects[i], mode: 'normal' as const, prev: undefined, z: ++z };
  });
}

/** 页码文字：3 / 12，幻灯片模式带块序号 */
export function pageLabel(mat: Material, v: View): string {
  if (isLong(mat)) return screenLabel(mat, v);
  if (mat.kind === 'html' || mat.kind === 'image' || mat.kind === 'sim' || mat.kind === 'video' || mat.kind === 'audio') return '';
  const s = v.fit === 'slides' && (mat.pages[v.page]?.slides?.length ?? 0) > 1 ? ` · ${v.slide + 1}` : '';
  return `${v.page + 1}${s} / ${Math.max(mat.total || 0, mat.pages.length)}`;
}

/** 平移放大后的区域（dx、dy 是页面坐标的位移） */
export function panRegion(region: [number, number, number, number], dx: number, dy: number): [number, number, number, number] {
  const [x, y, w, h] = region;
  return [Math.min(1 - w, Math.max(0, x + dx)), Math.min(1 - h, Math.max(0, y + dy)), w, h];
}
