// PPT 分步：翻页笔先把这一页的单击动画一下一下放完，再翻到下一页；往回翻也是一下一下退。
import type { Material, PageInfo, StepFrame, View } from './types';

/** 这一页一共要按几下（没开分步、没有动画是 0） */
export function clicksOf(mat: Material, page: number, on = true): number {
  const p = mat.pages[page];
  return on && mat.kind === 'slides' && p?.steps?.length ? p.clicks ?? 0 : 0;
}

/** 当前已按了几下；页对不上（刚换页、跳页、刚打开）就是这一页开头 */
export function builtOf(mat: Material, view: View, on = true): number {
  const n = clicksOf(mat, view.page, on);
  if (!n) return 0;
  return view.build && view.build[0] === view.page ? Math.max(0, Math.min(n, view.build[1])) : 0;
}

/** 在这一页里前进 / 后退一下；已经到头返回 null（该翻页了） */
export function stepBuild(mat: Material, v: View, dir: 1 | -1, on = true): View | null {
  if (v.fit === 'slides') return null;
  const n = clicksOf(mat, v.page, on);
  if (!n) return null;
  const c = builtOf(mat, v, on);
  if (dir > 0 && c < n) return { ...v, build: [v.page, c + 1] };
  if (dir < 0 && c > 0) return { ...v, build: [v.page, c - 1] };
  return null;
}

/** 翻到新的一页：往后翻从开头放，往前翻是放完的样子（和 PowerPoint 一样） */
export function enterPage(mat: Material, v: View, dir: 1 | -1, on = true): View {
  const n = clicksOf(mat, v.page, on);
  if (!n) return v.build ? { ...v, build: undefined } : v;
  return { ...v, build: [v.page, dir > 0 ? 0 : n] };
}

/** 按了 c 下之后要依次显示的帧（最后一帧停住）；放完了没有单独的帧就是整页原图 */
export function framesAt(page: PageInfo, c: number): StepFrame[] {
  const list = (page.steps ?? []).filter((f) => f.click === c);
  return list.length ? list : [{ click: c, wait: 0 }];
}

/** 一帧对应的画面：没有单独出图的就是原来那一页 */
export function framePage(page: PageInfo, f: StepFrame): PageInfo {
  return f.src || f.doc ? { w: page.w, h: page.h, src: f.src, doc: f.doc } : page;
}

/** 主进程算好的分步结果合进课件（图片路径换成可显示的地址） */
export interface StepsResult { pages: { page: number; clicks: number; frames: { click: number; wait: number; path?: string; pdf?: string; index?: number }[] }[] }
export function withSteps(mat: Material, r: StepsResult | null | undefined, url: (path: string) => string): Material {
  if (!r?.pages?.length) return mat;
  const pages = mat.pages.slice();
  let changed = false;
  for (const s of r.pages) {
    const p = pages[s.page];
    if (!p || !(s.clicks > 0) || !s.frames?.length) continue;
    const steps: StepFrame[] = s.frames.map((f) => ({
      click: f.click, wait: f.wait,
      ...(f.path ? { src: url(f.path) } : f.pdf && Number.isInteger(f.index) ? { doc: { pdf: f.pdf, index: f.index! } } : {}),
    }));
    pages[s.page] = { ...p, clicks: s.clicks, steps };
    changed = true;
  }
  return changed ? { ...mat, pages } : mat;
}

/** 分步画面晚到时：正在显示的那一页按「已放完」处理，不让画面突然缩回开头 */
export function settleView(mat: Material, v: View): View {
  const n = clicksOf(mat, v.page);
  return n && !(v.build && v.build[0] === v.page) ? { ...v, build: [v.page, n] } : v;
}
