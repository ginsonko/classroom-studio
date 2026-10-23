import type { Stroke } from '../lib/types';
import { selectionBounds } from './geometry';

/**
 * 长黑板按 A4 一页一页往下切：每页能放 per（页宽单位）高。切口尽量落在没有笔迹跨过的地方
 * （在下面 25% 的范围里往上找），免得一行字被切成两半。返回每页的 [top, height]。
 */
export function sliceLong(strokes: Stroke[], total: number, per: number): [number, number][] {
  const spans = strokes.map((s) => selectionBounds([s])).filter((b) => Number.isFinite(b.y0) && Number.isFinite(b.y1)).map((b) => [b.y0, b.y1] as const);
  const crosses = (y: number) => spans.some(([a, b]) => a < y && b > y);
  const out: [number, number][] = [];
  for (let top = 0; top < total - 1e-6;) {
    let end = Math.min(total, top + per);
    if (end < total - 1e-6) {
      const step = per / 120;
      const floor = top + per * .75;
      // 切在一段空白的中间，上下两页的字都不贴边；空白太窄（贴着字）就继续往上找宽一点的
      let narrow = NaN;
      for (let y = end; y > floor;) {
        if (crosses(y)) { y -= step; continue; }
        let up = y;
        while (up - step > floor && !crosses(up - step) && y - up < per * .08) up -= step;
        if (y - up >= per * .02) { end = (y + up) / 2; narrow = NaN; break; }
        if (Number.isNaN(narrow)) narrow = (y + up) / 2;
        y = up - step;
      }
      if (!Number.isNaN(narrow)) end = narrow;
    }
    out.push([top, end - top]); top = end;
  }
  return out;
}
