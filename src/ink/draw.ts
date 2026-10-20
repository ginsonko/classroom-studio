import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../lib/types';
import { drawObj } from '../physics/drawObj';
import { hitObject, strokeBounds } from './geometry';
import { compileExpression } from './expression';
import { drawTexShape, texShape } from './texCache';
import { atPx, fillTextPx } from './pxText';
import { boardImage } from './imgCache';

/**
 * 坐标系：页宽 = 1；size 以页宽的 1/1000 为单位。
 * draw() 在调用前已经把 ctx 缩放到「1 单位 = 页面像素宽度」。
 */
export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  scale: number;                 // 页面像素宽度
  color: (c: string) => string;  // 语义色 → 实际色
  dark: boolean;                 // 深色黑板
}

const U = 1 / 1000;

/**
 * perfect-freehand 内部有按像素写死的阈值（例如「离末端 < 3 个单位的点直接跳过」）。
 * 我们的坐标以页宽为 1，整条笔画都 < 3，会被裁成只剩首尾两个半圆端帽。
 * 所以先放大到 1000 倍（≈ 页宽 1000px）计算，再缩回去。
 */
const FK = 1000;
function pairs(pts: number[]) {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < pts.length + 1; i += 3) out.push([pts[i] * FK, pts[i + 1] * FK, pts[i + 2] ?? 0.5]);
  return out;
}
function unscale(outline: number[][]) {
  return outline.map(([x, y]) => [x / FK, y / FK]);
}

function polygon(ctx: CanvasRenderingContext2D, outline: number[][]) {
  if (outline.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[i + 1];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

function head(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number) {
  const a = Math.atan2(y1 - y0, x1 - x0), len = Math.max(w * 4.2, 9 * U), spread = 0.42;
  ctx.beginPath();
  ctx.moveTo(x1 + Math.cos(a) * w * 0.6, y1 + Math.sin(a) * w * 0.6);
  ctx.lineTo(x1 - Math.cos(a - spread) * len, y1 - Math.sin(a - spread) * len);
  ctx.quadraticCurveTo(x1 - Math.cos(a) * len * 0.62, y1 - Math.sin(a) * len * 0.62, x1 - Math.cos(a + spread) * len, y1 - Math.sin(a + spread) * len);
  ctx.closePath();
  ctx.fill();
}

/** 力的符号：支持 F_N、v_0 这样的下标，斜体衬线 */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const [base, sub] = text.split('_');
  atPx(ctx, x, y, (k) => {
    const px = size * k, Y = px * 0.35;
    ctx.font = `italic 600 ${px}px "Times New Roman", "Cambria Math", serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(base, 0, Y);
    if (sub) {
      const w = ctx.measureText(base).width;
      ctx.font = `italic 500 ${px * 0.62}px "Times New Roman", serif`;
      ctx.fillText(sub, w + px * 0.04, Y + px * 0.2);
    }
  });
}

export function bbox(pts: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

export function draw(d: DrawCtx, s: Stroke) {
  const { ctx } = d;
  const col = d.color(s.color);
  const w = s.size * U;
  const p = s.pts;
  if (p.length < 3) return;
  const ax = p[0], ay = p[1], bx = p[p.length - 3], by = p[p.length - 2];
  ctx.save();
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.layer === 'private') ctx.globalAlpha = 0.85;

  if (s.tool === 'obj' && s.obj) { drawObj(d, s.obj, { color: col }); ctx.restore(); return; }
  if (s.tool === 'image') { drawImage(d, s); ctx.restore(); return; }
  if (!s.plot) switch (s.tool) {
    case 'pen':
    case 'marker': {
      const pressure = s.tool === 'pen';
      const outline = unscale(getStroke(pairs(p), {
        size: w * FK * (pressure ? 2.4 : 3.2),
        thinning: pressure ? 0.55 : 0.05,
        smoothing: 0.6,
        streamline: 0.45,
        simulatePressure: p.every((v, i) => i % 3 !== 2 || v === 0.5),
        last: true,
      }));
      if (d.dark && s.tool === 'pen') { ctx.shadowColor = col; ctx.shadowBlur = w * d.scale * 0.6; }
      polygon(ctx, outline);
      break;
    }
    case 'highlighter': {
      ctx.globalAlpha = d.dark ? 0.32 : 0.38;
      ctx.globalCompositeOperation = d.dark ? 'screen' : 'multiply';
      ctx.lineWidth = w * 9;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
      break;
    }
    case 'line':
    case 'dashed':
    case 'arrow':
    case 'darrow':
    case 'force': {
      const lw = s.tool === 'force' ? w * 2.1 : w * 1.6;
      ctx.lineWidth = lw;
      if (s.tool === 'dashed') ctx.setLineDash([lw * 3.2, lw * 2.6]);
      const tip = s.tool === 'line' || s.tool === 'dashed' ? 0 : lw * 2.6;
      const a = Math.atan2(by - ay, bx - ax);
      const sx = s.tool === 'darrow' ? ax + Math.cos(a) * tip : ax, sy = s.tool === 'darrow' ? ay + Math.sin(a) * tip : ay;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(bx - Math.cos(a) * tip, by - Math.sin(a) * tip);
      ctx.stroke();
      ctx.setLineDash([]);
      if (tip) head(ctx, ax, ay, bx, by, lw);
      if (s.tool === 'darrow') head(ctx, bx, by, ax, ay, lw);
      if (s.tool === 'force') {
        ctx.beginPath(); ctx.arc(ax, ay, lw * 1.5, 0, Math.PI * 2); ctx.fill();
        if (s.text) {
          const fs = Math.max(18 * U, w * 7);
          const nx = -Math.sin(a), ny = Math.cos(a);
          const side = ny > 0 ? -1 : 1;
          label(ctx, s.text, bx + nx * fs * 0.7 * side + Math.cos(a) * fs * 0.25, by + ny * fs * 0.7 * side, fs);
        }
      }
      break;
    }
    case 'curve': {
      ctx.lineWidth = w * 1.6;
      // Curve geometry already uses normalized page units; only freehand outlines use FK.
      const pts = Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3], p[i * 3 + 1]]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      ctx.lineTo(bx, by);
      ctx.stroke();
      const k = Math.max(0, pts.length - 6);
      if (pts.length > 2) head(ctx, pts[k][0], pts[k][1], bx, by, w * 1.6);
      break;
    }
    case 'rect':
    case 'ellipse':
    case 'triangle': {
      ctx.lineWidth = w * 1.6;
      const x0 = Math.min(ax, bx), y0 = Math.min(ay, by), ww = Math.abs(bx - ax), hh = Math.abs(by - ay);
      ctx.beginPath();
      if (s.tool === 'rect') ctx.roundRect(x0, y0, ww, hh, Math.min(ww, hh) * 0.02);
      else if (s.tool === 'ellipse') ctx.ellipse(x0 + ww / 2, y0 + hh / 2, ww / 2, hh / 2, 0, 0, Math.PI * 2);
      else if (s.shape === 'plain') {
        ctx.moveTo(x0, y0 + hh); ctx.lineTo(x0 + ww, y0 + hh); ctx.lineTo(x0 + ww / 2, y0); ctx.closePath();
      } else {
        // 斜面：直角在拖动方向的远端下方
        const right = bx >= ax;
        ctx.moveTo(right ? x0 : x0 + ww, y0 + hh);
        ctx.lineTo(right ? x0 + ww : x0, y0 + hh);
        ctx.lineTo(right ? x0 + ww : x0, y0);
        ctx.closePath();
        ctx.stroke();
        // 地面阴影线
        ctx.lineWidth = w * 0.9;
        const n = Math.max(4, Math.round(ww / (14 * U)));
        for (let i = 0; i <= n; i++) {
          const x = x0 + (ww * i) / n;
          ctx.beginPath(); ctx.moveTo(x, y0 + hh); ctx.lineTo(x - 8 * U, y0 + hh + 8 * U); ctx.stroke();
        }
        break;
      }
      ctx.stroke();
      break;
    }
    case 'axes': {
      const ox = Math.min(ax, bx), oy = Math.max(ay, by), ex = Math.max(ax, bx), ey = Math.min(ay, by);
      ctx.lineWidth = w * 1.3;
      ctx.beginPath(); ctx.moveTo(ox - 10 * U, oy); ctx.lineTo(ex, oy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + 10 * U); ctx.lineTo(ox, ey); ctx.stroke();
      head(ctx, ox, oy, ex + 6 * U, oy, w * 1.3);
      head(ctx, ox, oy, ox, ey - 6 * U, w * 1.3);
      const fs = Math.max(15 * U, w * 6);
      const [xl, yl] = (s.text ?? 't,v').split(',');
      label(ctx, xl, ex + 8 * U, oy + fs * 0.6, fs);
      label(ctx, yl, ox - fs * 0.85, ey + fs * 0.1, fs);
      label(ctx, 'O', ox - fs * 0.9, oy + fs * 0.65, fs * 0.9);
      break;
    }
    case 'poly': {
      ctx.lineWidth = w * 1.6;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
      ctx.closePath();
      ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    }
    case 'text': {
      const shape = s.tex ? texShape(s.tex) : null;
      if (shape === undefined) break;
      if (shape) { const b = strokeBounds(s); drawTexShape(ctx, shape, b.x0, b.y0, b.x1, b.y1); break; }
      const fs = Math.max(16 * U, w * 8);
      atPx(ctx, ax, ay, (k) => {
        ctx.font = `500 ${fs * k}px "Noto Sans SC", "Microsoft YaHei UI", sans-serif`;
        ctx.textBaseline = 'top';
        (s.text ?? '').split('\n').forEach((line, i) => ctx.fillText(line, 0, i * fs * k * 1.35));
      });
      break;
    }
  }
  if (s.plot) drawPlot(d, s);
  ctx.restore();
}

function drawImage(d: DrawCtx, s: Stroke) {
  const { ctx } = d, { x0, y0, x1, y1 } = bbox(s.pts), img = s.img ? boardImage(s.img) : null;
  if (img) { ctx.globalAlpha = 1; ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0); return; }
  // 加载中 / 文件丢了：画一个虚线框占位，老师知道这里本来有图
  ctx.globalAlpha = 0.5; ctx.strokeStyle = d.color('ink'); ctx.lineWidth = 1.5 / d.scale; ctx.setLineDash([6 / d.scale, 5 / d.scale]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.textBaseline = 'top';
  if (img === null) fillTextPx(ctx, '图片已丢失', x0 + 8 / d.scale, y0 + 8 / d.scale, 14 / d.scale, (px) => `500 ${px}px "Microsoft YaHei UI", sans-serif`);
}

// ── 函数图像（AI 画图与坐标工具共用）──────────────────────
function drawPlot(d: DrawCtx, s: Stroke) {
  const { ctx } = d;
  const P = s.plot!;
  if (![P.x0, P.x1, P.y0, P.y1].every(Number.isFinite) || P.x1 <= P.x0 || P.y1 <= P.y0) return;
  const { x0, y0, x1, y1 } = bbox(s.pts);
  const exprs = P.expr.split(';').map((e) => e.trim()).filter(Boolean);
  if (!exprs.length) return;
  const fs_ = exprs.map(compileExpression);
  const f = fs_[0];
  const X = (v: number) => x0 + ((v - P.x0) / (P.x1 - P.x0)) * (x1 - x0);
  const Y = (v: number) => y1 - ((v - P.y0) / (P.y1 - P.y0)) * (y1 - y0);
  const col = d.color(s.color);
  const w = s.size * U;
  // 网格
  ctx.save();
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 0.7 * U;
  const stepX = niceStep(P.x1 - P.x0), stepY = niceStep(P.y1 - P.y0);
  for (let v = Math.ceil(P.x0 / stepX) * stepX; v <= P.x1; v += stepX) { ctx.beginPath(); ctx.moveTo(X(v), y0); ctx.lineTo(X(v), y1); ctx.stroke(); }
  for (let v = Math.ceil(P.y0 / stepY) * stepY; v <= P.y1; v += stepY) { ctx.beginPath(); ctx.moveTo(x0, Y(v)); ctx.lineTo(x1, Y(v)); ctx.stroke(); }
  ctx.restore();
  // 面积（位移）
  if (P.shade && P.shade.every(Number.isFinite) && P.shade[1] > P.shade[0]) {
    ctx.save();
    ctx.fillStyle = d.color('orange');
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.moveTo(X(P.shade[0]), Y(Math.max(0, P.y0)));
    for (let i = 0; i <= 80; i++) { const v = P.shade[0] + (P.shade[1] - P.shade[0]) * i / 80, value = f(v); if (Number.isFinite(value)) ctx.lineTo(X(v), Y(value)); }
    ctx.lineTo(X(P.shade[1]), Y(Math.max(0, P.y0)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // 坐标轴
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = w * 1.2;
  const oy = Y(Math.max(P.y0, 0)), ox = X(Math.max(P.x0, 0));
  ctx.beginPath(); ctx.moveTo(x0, oy); ctx.lineTo(x1 + 8 * U, oy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, y1); ctx.lineTo(ox, y0 - 8 * U); ctx.stroke();
  head(ctx, x0, oy, x1 + 14 * U, oy, w * 1.2);
  head(ctx, ox, y1, ox, y0 - 14 * U, w * 1.2);
  const fs = 14 * U;
  const mono = (px: number) => `500 ${px}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.75;
  for (let v = Math.ceil(P.x0 / stepX) * stepX; v <= P.x1; v += stepX) if (Math.abs(v) > 1e-9) fillTextPx(ctx, fmt(v), X(v) - fs * 0.25, oy + fs * 0.35, fs * 0.8, mono);
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(P.y0 / stepY) * stepY; v <= P.y1; v += stepY) if (Math.abs(v) > 1e-9) fillTextPx(ctx, fmt(v), ox - fs * 1.6, Y(v), fs * 0.8, mono);
  ctx.globalAlpha = 1;
  label(ctx, P.xl, x1 + 16 * U, oy + fs * 0.1, fs * 1.25);
  label(ctx, P.yl, ox + fs * 0.4, y0 - fs * 0.6, fs * 1.25);
  // 曲线
  const curveCols = ['red', 'blue', 'green', 'violet'];
  exprs.forEach((ex, k) => {
    const g = fs_[k];
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0 - 4 * U, x1 - x0 + 8 * U, y1 - y0 + 8 * U); ctx.clip();
    ctx.strokeStyle = d.color(curveCols[k % 4]);
    ctx.lineWidth = w * 1.8;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 200; i++) {
      const v = P.x0 + ((P.x1 - P.x0) * i) / 200, r = g(v);
      if (!isFinite(r)) { started = false; continue; }
      if (!started) { ctx.moveTo(X(v), Y(r)); started = true; } else ctx.lineTo(X(v), Y(r));
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = d.color(curveCols[k % 4]);
    ctx.textBaseline = 'bottom';
    const at = P.x0 + (P.x1 - P.x0) * (0.86 - k * 0.1);
    const name = exprs.length > 1 ? `${P.yl}${k + 1}` : P.yl;
    fillTextPx(ctx, `${name} = ${ex.replace(/\*/g, '').replace(/\^(-?\d+)/g, (_m, n: string) => [...n].map((c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]).join(''))}`, X(at) - fs * 3.2, Y(g(at)) - fs * 0.45, fs * 1.05, (px) => `italic 600 ${px}px "Times New Roman", serif`);
  });
}

function niceStep(range: number) {
  const raw = range / 6, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}
const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1));

// ── 命中测试（橡皮）──────────────────────────────────────
export function hit(s: Stroke, x: number, y: number, r: number) {
  if (s.obj) return hitObject(s.obj, x, y, r);
  const p = s.pts;
  if (s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'triangle' || s.tool === 'axes' || s.tool === 'text' || s.tool === 'image' || s.plot) {
    const b = strokeBounds(s);
    const pad = r + (s.tool === 'text' ? 0.02 : 0);
    const inside = x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad;
    if (!inside) return false;
    if (s.tool === 'text' || s.tool === 'image' || s.plot) return true;
    return !(x > b.x0 + pad && x < b.x1 - pad && y > b.y0 + pad && y < b.y1 - pad);
  }
  const rr = r + (s.size * U) * (s.tool === 'highlighter' ? 4.5 : 1.2);
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) < rr;
  const segs = s.tool === 'pen' || s.tool === 'marker' || s.tool === 'highlighter' || s.tool === 'curve'
    ? p : [p[0], p[1], 0, p[p.length - 3], p[p.length - 2], 0];
  for (let i = 0; i + 5 < segs.length; i += 3) {
    if (segDist(x, y, segs[i], segs[i + 1], segs[i + 3], segs[i + 4]) < rr) return true;
  }
  return false;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// ── 形状识别：笔停顿后把手绘规整成标准图形 ─────────────────
export function recognize(s: Stroke): Stroke | null {
  const p = s.pts;
  const n = p.length / 3;
  if (n < 6) return null;
  const b = bbox(p);
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
  if (diag < 0.02) return null;
  const ax = p[0], ay = p[1], bx = p[p.length - 3], by = p[p.length - 2];
  const chord = Math.hypot(bx - ax, by - ay);
  // 直线：所有点离首尾连线都很近
  let maxDev = 0;
  for (let i = 0; i < p.length; i += 3) maxDev = Math.max(maxDev, segDist(p[i], p[i + 1], ax, ay, bx, by));
  if (chord > diag * 0.9 && maxDev < chord * 0.06) {
    // 末端带「钩」的识别为箭头：最后 15% 的点偏离主方向
    return { ...s, tool: 'line', pts: [ax, ay, 0.5, bx, by, 0.5] };
  }
  // 闭合图形
  if (chord < diag * 0.22) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
    let err = 0, corners = 0;
    for (let i = 0; i < p.length; i += 3) {
      const e = Math.hypot((p[i] - cx) / rx, (p[i + 1] - cy) / ry);
      err += Math.abs(e - 1);
    }
    err /= n;
    // 粗略角点计数：方向突变
    for (let i = 6; i + 6 < p.length; i += 3) {
      const a1 = Math.atan2(p[i + 1] - p[i - 5], p[i] - p[i - 6]);
      const a2 = Math.atan2(p[i + 7] - p[i + 1], p[i + 6] - p[i]);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 0.9) { corners++; i += 9; }
    }
    if (err < 0.13 && corners < 2) return { ...s, tool: 'ellipse', pts: [b.x0, b.y0, 0.5, b.x1, b.y1, 0.5] };
    if (corners >= 3 && corners <= 5) return { ...s, tool: 'rect', pts: [b.x0, b.y0, 0.5, b.x1, b.y1, 0.5] };
  }
  return null;
}
