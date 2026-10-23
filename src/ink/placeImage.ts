// 贴图放在哪：纯计算，不碰窗口，Node 里可以直接测试。
import type { Stroke, View } from '../lib/types';
import { strokeBounds, type Box } from './geometry';

const overlaps = (a: Box, b: Box, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * 在可见区域里给一张宽高比为 aspect 的图找位置：最多占可见区的 62%，水平居中、略偏上。
 * 已经有图时不叠上去（连着贴「题干图 + 题目图」很常见）：依次试已有图的下面、右边、上面、左边，
 * 放不下就把新图缩小再试；实在没有空位才在原位置错开一点。返回页面坐标（x 以页宽为 1，y 以页宽为单位）。
 */
export function placeImage(aspect: number, ratio: number, view: Pick<View, 'fit' | 'region'>, existing: Stroke[]): [number, number, number, number] {
  const [rx, ry, rw, rh] = view.fit === 'region' && view.region ? view.region : [0, 0, 1, 1];
  const vw = rw, vh = rh * ratio, top = ry * ratio, V: Box = { x0: rx, y0: top, x1: rx + vw, y1: top + vh };
  let w = Math.min(vw * 0.62, vh * 0.62 * aspect), h = w / aspect;
  // 扁长截图（一行题目）不要太小：宽度至少占一半
  if (aspect > 2.2) { w = Math.min(vw * 0.8, Math.max(w, vw * 0.5)); h = w / aspect; }
  const x = rx + (vw - w) / 2, y = top + Math.max(0.02 * vh, (vh - h) * 0.3);
  // 后贴的图在前：优先挨着最近贴的那张
  const imgs = existing.filter((s) => s.tool === 'image').map(strokeBounds).filter((b) => overlaps(b, V)).reverse();
  const gap = 0.012 * vw;
  const fits = (b: Box) => b.x0 >= V.x0 - 1e-9 && b.x1 <= V.x1 + 1e-9 && b.y0 >= V.y0 - 1e-9 && b.y1 <= V.y1 + 1e-9 && !imgs.some((o) => overlaps(o, b, gap * 0.5));
  const first: Box = { x0: x, y0: y, x1: x + w, y1: y + h };
  if (!imgs.length || fits(first)) return [x, y, x + w, y + h];
  const clampX = (x0: number, ww: number) => Math.min(Math.max(x0, V.x0 + gap), V.x1 - gap - ww);
  const clampY = (y0: number, hh: number) => Math.min(Math.max(y0, V.y0 + gap), V.y1 - gap - hh);
  for (const k of [1, 0.8, 0.65, 0.5, 0.38]) {
    const ww = w * k, hh = h * k, tries: [number, number][] = [];
    for (const b of imgs) {
      tries.push([clampX(b.x0, ww), b.y1 + gap]);        // 下面，左边对齐
      tries.push([b.x1 + gap, clampY(b.y0, hh)]);        // 右边，上沿对齐
      tries.push([clampX(b.x0, ww), b.y0 - gap - hh]);   // 上面
      tries.push([b.x0 - gap - ww, clampY(b.y0, hh)]);   // 左边
    }
    tries.push([V.x0 + gap, V.y0 + gap], [V.x1 - gap - ww, V.y0 + gap], [V.x0 + gap, V.y1 - gap - hh], [V.x1 - gap - ww, V.y1 - gap - hh]);
    for (const [tx, ty] of tries) { const b = { x0: tx, y0: ty, x1: tx + ww, y1: ty + hh }; if (fits(b)) return [tx, ty, tx + ww, ty + hh]; }
  }
  let sx = x, sy = y;
  const near = (s: Stroke) => s.tool === 'image' && Math.abs(s.pts[0] - sx) < 0.01 && Math.abs(s.pts[1] - sy) < 0.01;
  for (let n = 0; n < 8 && existing.some(near); n++) { sx += 0.025 * vw; sy += 0.025 * vw; }
  return [sx, sy, sx + w, sy + h];
}
