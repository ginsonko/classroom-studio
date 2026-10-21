// 长黑板的滚动：滚轮、翻半屏、回到顶部、跳到最后写的地方、拖右侧滑条
import { inkKey, useStore } from '../lib/store';
import { SCREEN, clampY, isLong, scrollView } from '../lib/longBoard';
import { selectionBounds } from '../ink/geometry';
import type { Material } from '../lib/types';

const st = () => useStore.getState();

/** 当前项是长黑板时跳到 y（按页宽计，画面上沿） */
export function seekLong(y: number) {
  const s = st(); if (!isLong(s.pgmMat)) return;
  const next = clampY(s.pgmMat, y);
  if (Math.abs(next - (s.pgm.y ?? 0)) < 1e-4) return;
  s.setShared({ pgm: scrollView(s.pgmMat, s.pgm, next - (s.pgm.y ?? 0)), selectedInk: null });
}

/** 这块长黑板最下面那笔的下沿（没写过是 0） */
export function lastInkY(mat: Material) {
  let y = 0;
  for (const s of st().ink[inkKey(mat.id, 0)] ?? []) { const b = selectionBounds([s]); if (Number.isFinite(b.y1)) y = Math.max(y, b.y1); }
  return y;
}

/** 跳到最后写的地方：那一笔放在画面中间偏上，下面留出空白接着写 */
export function seekLastInk() {
  const m = st().pgmMat; if (!isLong(m)) return;
  const y = lastInkY(m);
  seekLong(y > 0 ? y - SCREEN * .4 : 0);
}

/** 滚轮：长黑板上下滚动（Ctrl + 滚轮什么都不做）。处理了返回 true */
export function longWheel(e: React.WheelEvent) {
  const s = st(); if (!isLong(s.pgmMat)) return false;
  // Ctrl + 滚轮在别的课件上是缩放；长黑板不缩放，也不当成滚动，免得老师以为在缩放结果画面跑了
  if (e.ctrlKey) return true;
  const page = (e.currentTarget as HTMLElement).querySelector('.page') as HTMLElement | null;
  const w = page?.getBoundingClientRect().width || 1000;
  // deltaMode 1 是按行滚（部分鼠标驱动），一行算 40px
  const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * w * SCREEN : e.deltaY;
  if (px) seekLong((s.pgm.y ?? 0) + px / w);
  return true;
}
