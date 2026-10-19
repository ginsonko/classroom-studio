// ── 仿真画面的基本笔触：箭头、虚线、尺寸线、角度弧、标签胶囊、卡片 ─────────────
// 坐标单位 = 页宽（ctx 已缩放）。线宽常量也以页宽为单位。
import type { DrawCtx } from '../../ink/draw';
import { drawSym, drawText, textW } from './text';

export interface SD extends DrawCtx { paper: string }

export const LW = { thin: 0.0013, line: 0.0021, bold: 0.003, vec: 0.0034 };

/** 页面底色（与 tokens.css 的 --paper 一致），用于文字描边光晕 */
export const PAPER: Record<string, string> = {
  white: '#ffffff', ivory: '#fbf7ee', wheat: '#f4ecd2', bean: '#c7edcc', chalk: '#23392f',
  slate: '#2b2f36', space: '#0f1a33', night: '#0d0d0f', sepia: '#efe3c8',
};

export function alpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, w = LW.vec, head = 0.014) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  if (L < 1e-6) return;
  const ux = dx / L, uy = dy / L;
  const hl = Math.min(head, L * 0.6), hw = hl * 0.42;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * hl - uy * hw, y1 - uy * hl + ux * hw);
  ctx.lineTo(x1 - ux * hl * 0.78, y1 - uy * hl * 0.78);
  ctx.lineTo(x1 - ux * hl + uy * hw, y1 - uy * hl - ux * hw);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function line(ctx: CanvasRenderingContext2D, pts: number[], color: string, w = LW.line, dash?: number[]) {
  if (pts.length < 4) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
  ctx.restore();
}

export const DASH = [0.006, 0.005];

/** 尺寸线：两端短竖线 + 中间标签。off：沿法线方向偏移 */
export function dim(d: SD, x0: number, y0: number, x1: number, y1: number, label: string, color: string, size = 0.018, off = 0) {
  const { ctx } = d;
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const ax = x0 + nx * off, ay = y0 + ny * off, bx = x1 + nx * off, by = y1 + ny * off;
  const t = 0.006;
  line(ctx, [ax, ay, bx, by], color, LW.thin);
  line(ctx, [ax - nx * t, ay - ny * t, ax + nx * t, ay + ny * t], color, LW.thin);
  line(ctx, [bx - nx * t, by - ny * t, bx + nx * t, by + ny * t], color, LW.thin);
  if (off) {
    line(ctx, [x0, y0, ax, ay], color, LW.thin * 0.8, [0.003, 0.003]);
    line(ctx, [x1, y1, bx, by], color, LW.thin * 0.8, [0.003, 0.003]);
  }
  if (label) {
    const mx = (ax + bx) / 2 + nx * size * 0.9 * Math.sign(off || 1), my = (ay + by) / 2 + ny * size * 0.9 * Math.sign(off || 1);
    drawSym(ctx, label, mx, my, size, color, 'center', d.paper);
  }
}

/** 角度弧（a0→a1，弧度，y 向下的 canvas 角） */
export function angleArc(d: SD, cx: number, cy: number, r: number, a0: number, a1: number, label: string, color: string, size = 0.017) {
  const { ctx } = d;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = LW.thin * 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
  ctx.restore();
  if (label) {
    const am = (a0 + a1) / 2, rr = r + size * 0.95;
    drawSym(ctx, label, cx + Math.cos(am) * rr, cy + Math.sin(am) * rr, size, color, 'center', d.paper);
  }
}

/** 事件标签胶囊（带一根指向点的细线） */
export function pill(d: SD, x: number, y: number, text: string, fg: string, bg: string, size = 0.015, glow = 0) {
  const { ctx } = d;
  const w = textW(ctx, text, size, { weight: 650 }) + size * 1.1, h = size * 1.75;
  let px = x - w / 2, py = y - h - size * 1.2;
  px = Math.max(0.006, Math.min(1 - w - 0.006, px));
  py = Math.max(0.006, py);
  ctx.save();
  line(ctx, [x, y, x, py + h], fg, LW.thin);
  ctx.beginPath(); ctx.arc(x, y, size * 0.22, 0, Math.PI * 2); ctx.fillStyle = fg; ctx.fill();
  if (glow > 0) { ctx.shadowColor = fg; ctx.shadowBlur = glow; }
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(px, py, w, h, h / 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = LW.thin; ctx.strokeStyle = fg; ctx.stroke();
  ctx.restore();
  drawText(ctx, text, px + w / 2, py + h / 2 + size * 0.04, size, fg, { align: 'center', weight: 650 });
}

/** 浮在场景上的卡片 */
export function card(d: SD, x: number, y: number, w: number, h: number) {
  const { ctx } = d;
  ctx.save();
  ctx.fillStyle = d.dark ? 'rgba(10,14,20,.62)' : 'rgba(255,255,255,.82)';
  ctx.strokeStyle = d.dark ? 'rgba(255,255,255,.14)' : 'rgba(40,40,30,.14)';
  ctx.lineWidth = LW.thin * 0.8;
  ctx.shadowColor = d.dark ? 'rgba(0,0,0,.4)' : 'rgba(60,50,20,.12)'; ctx.shadowBlur = 0.012 * d.scale; ctx.shadowOffsetY = 0.002 * d.scale;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 0.008); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.stroke();
  ctx.restore();
}

/** 圆点 */
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, stroke?: string) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = LW.thin; ctx.stroke(); }
  ctx.restore();
}

/** 物体配色：按序号轮换（语义色名，经 d.color 解析） */
export const BODY_COLORS = ['blue', 'red', 'green', 'violet', 'orange'];
/** 矢量配色（课本惯例） */
export const VEC_COLOR: Record<string, string> = { G: 'red', N: 'blue', f: 'green', spring: 'orange', T: 'violet', rod: 'violet', E: 'orange', B: 'orange', F: 'violet', v: 'ai' };
