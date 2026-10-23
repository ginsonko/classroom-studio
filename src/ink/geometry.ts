import type { PhysObj, Stroke } from '../lib/types';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Point { x: number; y: number }
export const freshId = () => crypto.randomUUID();
export function bounds(pts: number[]): Box {
  if (!pts.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); y0 = Math.min(y0, pts[i + 1]); x1 = Math.max(x1, pts[i]); y1 = Math.max(y1, pts[i + 1]); }
  return { x0, y0, x1, y1 };
}
export function objectCorners(o: PhysObj): number[] {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].flatMap(([x, y]) => [o.x + c * x * o.w - s * y * o.h, o.y + s * x * o.w + c * y * o.h, .5]);
}
export function withObject(stroke: Stroke, obj: PhysObj): Stroke {
  const b = bounds(objectCorners(obj));
  return { ...stroke, obj, pts: [b.x0, b.y0, .5, b.x1, b.y1, .5] };
}
/** 旋转后的贴图四个角（x, y, 压力 三元组） */
export function imageCorners(s: Stroke): number[] {
  const b = bounds(s.pts), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
  const c = Math.cos(s.rot ?? 0), sn = Math.sin(s.rot ?? 0);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].flatMap(([x, y]) => [cx + c * x - sn * y, cy + sn * x + c * y, .5]);
}
export function strokeBounds(s: Stroke): Box {
  if (s.obj) return bounds(objectCorners(s.obj));
  if (s.tool === 'image' && s.rot) return bounds(imageCorners(s));
  const b = bounds(s.pts);
  if (s.tool === 'text' && !(s.tex && s.pts.length >= 6)) {
    const fs = Math.max(.016, s.size * .008), lines = (s.text ?? '').split('\n');
    return { ...b, x1: b.x0 + Math.max(1, ...lines.map((l) => [...l].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : .62), 0))) * fs, y1: b.y0 + lines.length * fs * 1.35 };
  }
  return b;
}
export function selectionBounds(strokes: Stroke[]): Box {
  if (!strokes.length) return bounds([]);
  const bs = strokes.map(strokeBounds);
  return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
}
export function hitObject(o: PhysObj, x: number, y: number, pad = .005): boolean {
  const dx = x - o.x, dy = y - o.y, c = Math.cos(o.rot), s = Math.sin(o.rot);
  return Math.abs(c * dx + s * dy) <= o.w / 2 + pad && Math.abs(-s * dx + c * dy) <= o.h / 2 + pad;
}
export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function insideLasso(s: Stroke, poly: number[]): boolean {
  if (s.obj) return pointInPolygon(s.obj.x, s.obj.y, poly);
  let n = 0;
  for (let i = 0; i < s.pts.length; i += 3) if (pointInPolygon(s.pts[i], s.pts[i + 1], poly)) n++;
  return n / (s.pts.length / 3) >= .7;
}

export function moveStroke(s: Stroke, dx: number, dy: number): Stroke {
  if (s.obj) return withObject(s, { ...s.obj, x: s.obj.x + dx, y: s.obj.y + dy });
  return { ...s, pts: s.pts.map((v, i) => i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v) };
}
export function scaleStroke(s: Stroke, center: Point, scale: number): Stroke {
  const k = Math.max(.02, Math.min(50, scale));
  if (s.obj) return withObject(s, { ...s.obj, x: center.x + (s.obj.x - center.x) * k, y: center.y + (s.obj.y - center.y) * k, w: Math.max(.008, s.obj.w * k), h: Math.max(.008, s.obj.h * k) });
  return { ...s, size: Math.max(.3, Math.min(80, s.size * k)), pts: s.pts.map((v, i) => i % 3 === 0 ? center.x + (v - center.x) * k : i % 3 === 1 ? center.y + (v - center.y) * k : v) };
}
export function canRotate(s: Stroke): boolean { return !s.plot && !['text', 'axes'].includes(s.tool); }
const normAngle = (a: number) => { const t = a % (2 * Math.PI); const r = t > Math.PI ? t - 2 * Math.PI : t < -Math.PI ? t + 2 * Math.PI : t; return Math.abs(r) < 1e-9 ? 0 : r; };
export function rotateStroke(s: Stroke, center: Point, angle: number): Stroke {
  const c = Math.cos(angle), sn = Math.sin(angle);
  const xy = (x: number, y: number) => [center.x + (x - center.x) * c - (y - center.y) * sn, center.y + (x - center.x) * sn + (y - center.y) * c];
  if (s.obj) { const [x, y] = xy(s.obj.x, s.obj.y); return withObject(s, { ...s.obj, x, y, rot: s.obj.rot + angle }); }
  if (s.tool === 'image') {
    const b = bounds(s.pts), [x, y] = xy((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), dx = x - (b.x0 + b.x1) / 2, dy = y - (b.y0 + b.y1) / 2;
    return { ...s, pts: [b.x0 + dx, b.y0 + dy, .5, b.x1 + dx, b.y1 + dy, .5], rot: normAngle((s.rot ?? 0) + angle) };
  }
  if (!canRotate(s)) return s;
  let pts = s.pts, tool = s.tool;
  const b = bounds(pts);
  if (s.tool === 'rect') { pts = [b.x0, b.y0, .5, b.x1, b.y0, .5, b.x1, b.y1, .5, b.x0, b.y1, .5]; tool = 'poly'; }
  if (s.tool === 'triangle') { pts = s.shape === 'plain' ? [b.x0, b.y1, .5, b.x1, b.y1, .5, (b.x0 + b.x1) / 2, b.y0, .5] : [b.x0, b.y1, .5, b.x1, b.y1, .5, b.x1, b.y0, .5]; tool = 'poly'; }
  if (s.tool === 'ellipse') { pts = Array.from({ length: 64 }, (_, i) => { const a = i * Math.PI / 32; return [(b.x0 + b.x1) / 2 + (b.x1 - b.x0) / 2 * Math.cos(a), (b.y0 + b.y1) / 2 + (b.y1 - b.y0) / 2 * Math.sin(a), .5]; }).flat(); tool = 'poly'; }
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 3) out.push(...xy(pts[i], pts[i + 1]), pts[i + 2]);
  return { ...s, tool, pts: out };
}
/** 贴图左右翻转（按看到的样子翻：镜像后旋转角取反） */
export function flipImage(s: Stroke): Stroke {
  return s.tool === 'image' ? { ...s, flip: !s.flip, rot: normAngle(-(s.rot ?? 0)) } : s;
}
/** 贴图绕自己的中心转 90°（dir = 1 顺时针，-1 逆时针） */
export function turnImage(s: Stroke, dir: 1 | -1): Stroke {
  if (s.tool !== 'image') return s;
  const b = bounds(s.pts);
  return rotateStroke(s, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, dir * Math.PI / 2);
}
export function duplicateStroke(s: Stroke, offset = .018): Stroke {
  const copy = moveStroke(s, offset, offset), id = freshId();
  return { ...copy, id, obj: copy.obj ? { ...copy.obj, id, props: { ...copy.obj.props } } : undefined };
}

/** Exact line/circle clipping preserves pressure at both cut boundaries. */
export function eraseSegment(s: Stroke, cx: number, cy: number, radius: number): Stroke[] {
  if (!['pen', 'marker', 'highlighter', 'curve', 'line', 'dashed'].includes(s.tool)) return [s];
  const p = s.pts, rr = radius * radius;
  if (p.length === 3) return (p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= rr ? [] : [s];
  const fragments: number[][] = []; let part: number[] = [], changed = false;
  const flush = () => { if (part.length >= 6) fragments.push(part); part = []; };
  for (let i = 0; i + 5 < p.length; i += 3) {
    const ax = p[i], ay = p[i + 1], dx = p[i + 3] - ax, dy = p[i + 4] - ay, A = dx * dx + dy * dy;
    const B = 2 * ((ax - cx) * dx + (ay - cy) * dy), C = (ax - cx) ** 2 + (ay - cy) ** 2 - rr;
    const disc = B * B - 4 * A * C, cuts = [0, 1];
    if (A > 1e-20 && disc > 0) for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) if (t > 0 && t < 1) cuts.push(t);
    cuts.sort((a, b) => a - b);
    const point = (t: number) => [ax + dx * t, ay + dy * t, p[i + 2] + (p[i + 5] - p[i + 2]) * t];
    for (let j = 0; j < cuts.length - 1; j++) {
      const lo = cuts[j], hi = cuts[j + 1], mid = (lo + hi) / 2;
      if ((ax + dx * mid - cx) ** 2 + (ay + dy * mid - cy) ** 2 < rr) { changed = true; flush(); }
      else { if (!part.length) part.push(...point(lo)); part.push(...point(hi)); }
    }
  }
  flush();
  if (!changed) return [s];
  return fragments.map((pts, i) => ({ ...s, id: i ? freshId() : s.id, pts }));
}
