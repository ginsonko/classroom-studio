// ── 仿真里的物体外观 ─────────────────────────────────────────────
// 优先用工作流 C 的 drawObj（与黑板上放置的器材同一套画法）。drawObj 还是契约桩
// （只画带字的矩形）时，用这里的课本风格画法兜底；C 的实现一合入就自动切换，无需改代码。
import { drawObj } from '../drawObj';
import type { PhysObj } from '../model';
import { flag, inclineVerts, num, texRad } from './engine';
import { alpha, BODY_COLORS, dot, line, LW, type SD } from './prim';
import { drawSym } from './text';

const SRC = String(drawObj);
/** drawObj 是否仍是契约桩（strokeRect + label ?? kind，且很短） */
export const DRAWOBJ_IS_STUB = /strokeRect/.test(SRC) && /\.label\s*\?\?\s*\w+\.kind/.test(SRC) && SRC.length < 1600;

/** 由页面选项强制（测试页用）：'auto' | 'own' | 'drawObj' */
let mode: 'auto' | 'own' | 'drawObj' = 'auto';
export function setLookMode(m: typeof mode) { mode = m; }
const useBoard = () => (mode === 'drawObj' ? true : mode === 'own' ? false : !DRAWOBJ_IS_STUB);

export interface LookOpts { tint?: number; ghost?: boolean; t?: number }

export function drawBody(d: SD, o: PhysObj, opts: LookOpts = {}) {
  if (useBoard()) { drawObj(d, o, { ghost: opts.ghost }); return; }
  const { ctx } = d;
  ctx.save();
  if (opts.ghost) ctx.globalAlpha *= 0.32;
  ctx.translate(o.x, o.y);
  ctx.rotate(o.rot);
  own(d, o, opts);
  ctx.restore();
}

function hatch(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, dir: 1 | -1, color: string, step = 0.011, len = 0.011) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = LW.thin;
  ctx.beginPath();
  for (let x = x0 + step * 0.5; x < x1; x += step) { ctx.moveTo(x, y); ctx.lineTo(x - len * 0.75, y + dir * len); }
  ctx.stroke();
  ctx.restore();
}

function own(d: SD, o: PhysObj, opts: LookOpts) {
  const { ctx } = d;
  const ink = d.color('ink');
  const w = o.w, h = o.h, hw = w / 2, hh = h / 2;
  const tintName = BODY_COLORS[(opts.tint ?? 0) % BODY_COLORS.length];
  const tint = d.color(tintName);
  const fill = alpha(tint, d.dark ? 0.26 : 0.14);
  const label = (s?: string, size = Math.min(0.026, Math.max(0.013, Math.min(w, h) * 0.5))) => {
    if (!s) return;
    ctx.save(); ctx.rotate(-o.rot);
    drawSym(ctx, s, 0, 0, size, ink, 'center');
    ctx.restore();
  };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  switch (o.kind) {
    case 'block': case 'weight': {
      ctx.beginPath(); ctx.roundRect(-hw, -hh, w, h, Math.min(w, h) * 0.08);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = tint; ctx.lineWidth = LW.bold; ctx.stroke();
      if (o.kind === 'weight') { ctx.beginPath(); ctx.arc(0, -hh - 0.006, 0.005, Math.PI * 0.15, Math.PI * 1.85); ctx.strokeStyle = ink; ctx.lineWidth = LW.thin * 1.3; ctx.stroke(); }
      label(o.label);
      break;
    }
    case 'cart': {
      const r = Math.min(h * 0.28, w * 0.13);
      ctx.beginPath(); ctx.roundRect(-hw, -hh, w, h - r * 1.15, Math.min(w, h) * 0.12);
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = tint; ctx.lineWidth = LW.bold; ctx.stroke();
      for (const sx of [-1, 1]) {
        const cx = sx * (hw - r * 1.6), cy = hh - r;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = d.dark ? '#1c2026' : '#fff'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = LW.line; ctx.stroke();
        dot(ctx, cx, cy, r * 0.25, ink);
      }
      ctx.save(); ctx.translate(0, -r * 0.55); label(o.label, Math.min(0.024, h * 0.42)); ctx.restore();
      break;
    }
    case 'ball': {
      const r = Math.min(w, h) / 2;
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      g.addColorStop(0, d.dark ? alpha(tint, 0.9) : '#ffffff');
      g.addColorStop(1, alpha(tint, d.dark ? 0.55 : 0.42));
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = tint; ctx.lineWidth = LW.line; ctx.stroke();
      if (o.label && r > 0.012) label(o.label, r * 0.95);
      break;
    }
    case 'plank': {
      ctx.beginPath(); ctx.roundRect(-hw, -hh, w, h, h * 0.18);
      ctx.fillStyle = d.dark ? 'rgba(214,170,110,.32)' : '#efd9ae'; ctx.fill();
      ctx.strokeStyle = d.dark ? '#d9b27a' : '#8a5a22'; ctx.lineWidth = LW.line; ctx.stroke();
      ctx.save(); ctx.globalAlpha *= 0.35; ctx.lineWidth = LW.thin * 0.8;
      for (let i = 0; i < 3; i++) { const y = -hh + (h * (i + 1)) / 4; ctx.beginPath(); ctx.moveTo(-hw + w * 0.05, y); ctx.bezierCurveTo(-hw + w * 0.3, y - h * 0.08, hw - w * 0.3, y + h * 0.08, hw - w * 0.05, y); ctx.stroke(); }
      ctx.restore();
      if (o.label) { ctx.save(); ctx.translate(hw - Math.min(0.03, w * 0.1), 0); label(o.label, Math.min(0.02, h * 0.7)); ctx.restore(); }
      break;
    }
    case 'person': {
      const s = h;
      ctx.strokeStyle = tint; ctx.lineWidth = LW.bold;
      ctx.beginPath(); ctx.arc(0, -hh + s * 0.12, s * 0.11, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
      line(ctx, [0, -hh + s * 0.23, 0, hh - s * 0.38], tint, LW.bold);
      line(ctx, [-w * 0.42, -hh + s * 0.42, 0, -hh + s * 0.3, w * 0.42, -hh + s * 0.42], tint, LW.bold);
      line(ctx, [-w * 0.35, hh, 0, hh - s * 0.38, w * 0.35, hh], tint, LW.bold);
      if (o.label) { ctx.save(); ctx.translate(w * 0.75, -hh + s * 0.12); label(o.label, 0.018); ctx.restore(); }
      break;
    }
    case 'boat': {
      ctx.beginPath();
      ctx.moveTo(-hw, -hh); ctx.lineTo(hw, -hh); ctx.lineTo(hw - w * 0.08, hh); ctx.lineTo(-hw + w * 0.08, hh); ctx.closePath();
      ctx.fillStyle = d.dark ? 'rgba(214,170,110,.3)' : '#ecd3a4'; ctx.fill();
      ctx.strokeStyle = d.dark ? '#d9b27a' : '#7a4d1c'; ctx.lineWidth = LW.bold; ctx.stroke();
      if (o.label) label(o.label, Math.min(0.022, h * 0.6));
      break;
    }
    case 'car': case 'rocket': {
      ctx.beginPath(); ctx.roundRect(-hw, -hh, w, h, h * 0.3); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = tint; ctx.lineWidth = LW.bold; ctx.stroke();
      label(o.label ?? (o.kind === 'car' ? '车' : '箭'));
      break;
    }
    case 'incline': {
      const v = inclineVerts(o);
      ctx.beginPath(); ctx.moveTo(v[0][0], v[0][1]); ctx.lineTo(v[1][0], v[1][1]); ctx.lineTo(v[2][0], v[2][1]); ctx.closePath();
      ctx.fillStyle = d.dark ? 'rgba(255,255,255,.05)' : 'rgba(120,90,30,.06)'; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = LW.bold; ctx.stroke();
      hatch(ctx, -hw, hw, hh, 1, alpha(ink, 0.55));
      // 倾角
      const flip = flag(o, 'flip');
      const ax = flip ? hw : -hw, ay = hh;
      const ang = Math.atan2(h, w);
      const deg = o.props?.angle !== undefined ? num(o, 'angle', 0) : Math.round((ang * 180) / Math.PI);
      const r = Math.min(0.045, w * 0.18);
      ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = LW.thin * 1.2; ctx.beginPath();
      if (flip) ctx.arc(ax, ay, r, Math.PI, Math.PI + ang); else ctx.arc(ax, ay, r, -ang, 0);
      ctx.stroke(); ctx.restore();
      const am = flip ? Math.PI + ang / 2 : -ang / 2;
      drawSym(ctx, `θ=${deg}°`, ax + Math.cos(am) * (r + 0.028), ay + Math.sin(am) * (r + 0.012), 0.016, ink, 'center', d.paper);
      void texRad;
      break;
    }
    case 'ground': case 'ceiling': {
      const dir = o.kind === 'ground' ? 1 : -1;
      const y = dir === 1 ? -hh : hh;
      if (o.props?.water) {
        ctx.save();
        ctx.fillStyle = d.dark ? 'rgba(90,150,255,.16)' : 'rgba(60,130,220,.12)';
        ctx.fillRect(-hw, y, w, 0.05);
        ctx.strokeStyle = d.color('blue'); ctx.lineWidth = LW.line;
        ctx.beginPath();
        for (let x = -hw; x <= hw + 1e-9; x += 0.004) { const yy = y + Math.sin((x * 2 * Math.PI) / 0.035) * 0.0022; if (x === -hw) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
        ctx.stroke(); ctx.restore();
        break;
      }
      line(ctx, [-hw, y, hw, y], ink, LW.bold);
      hatch(ctx, -hw, hw, y, dir as 1 | -1, alpha(ink, 0.5));
      break;
    }
    case 'wall': {
      ctx.beginPath(); ctx.rect(-hw, -hh, w, h);
      ctx.fillStyle = d.dark ? 'rgba(255,255,255,.06)' : 'rgba(120,90,30,.08)'; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = LW.line; ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(-hw, -hh, w, h); ctx.clip();
      ctx.strokeStyle = alpha(ink, 0.32); ctx.lineWidth = LW.thin;
      ctx.beginPath(); for (let k = -hh - w; k < hh + w; k += 0.012) { ctx.moveTo(-hw, k); ctx.lineTo(hw, k + w); } ctx.stroke();
      ctx.restore();
      if (o.label) label(o.label, 0.016);
      break;
    }
    case 'conveyor': {
      const r = hh;
      ctx.beginPath(); ctx.roundRect(-hw - r * 0.2, -hh, w + r * 0.4, h, r);
      ctx.fillStyle = d.dark ? 'rgba(255,255,255,.06)' : 'rgba(30,30,30,.05)'; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = LW.bold; ctx.stroke();
      for (const sx of [-1, 1]) {
        const cx = sx * (hw - r * 0.8);
        ctx.beginPath(); ctx.arc(cx, 0, r * 0.78, 0, Math.PI * 2); ctx.strokeStyle = ink; ctx.lineWidth = LW.line; ctx.stroke();
        dot(ctx, cx, 0, r * 0.18, ink);
        // 转动标记（随时间旋转）
        const sp = num(o, 'speed', 0), ang = ((opts.t ?? 0) * sp) / Math.max(1e-6, r * 0.78 / Math.max(1e-6, num(o, 'ppm', 0.1)));
        ctx.save(); ctx.translate(cx, 0); ctx.rotate(ang);
        line(ctx, [0, 0, r * 0.66, 0], alpha(ink, 0.6), LW.thin);
        ctx.restore();
      }
      break;
    }
    case 'track-circle': {
      const r = w / 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.strokeStyle = ink; ctx.lineWidth = LW.bold * 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r + 0.006, 0, Math.PI * 2); ctx.strokeStyle = alpha(ink, 0.35); ctx.lineWidth = LW.thin; ctx.stroke();
      break;
    }
    case 'track-arc': {
      const r = w / 2, a0 = (num(o, 'a0', 0) * Math.PI) / 180, a1 = (num(o, 'a1', 180) * Math.PI) / 180;
      ctx.beginPath(); ctx.arc(0, 0, r, Math.min(a0, a1), Math.max(a0, a1)); ctx.strokeStyle = ink; ctx.lineWidth = LW.bold * 1.2; ctx.stroke();
      break;
    }
    case 'hinge': {
      const r = Math.min(w, h) / 2;
      dot(ctx, 0, 0, Math.max(0.004, r * 0.5), d.dark ? '#1c2026' : '#fff', ink);
      break;
    }
    case 'pulley': {
      const r = Math.min(w, h) / 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = d.dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.9)'; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = LW.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.strokeStyle = alpha(ink, 0.4); ctx.lineWidth = LW.thin; ctx.stroke();
      dot(ctx, 0, 0, r * 0.16, ink);
      break;
    }
    case 'field-b-in': case 'field-b-out': {
      ctx.save();
      ctx.fillStyle = d.dark ? 'rgba(127,178,255,.06)' : 'rgba(31,95,209,.035)';
      ctx.fillRect(-hw, -hh, w, h);
      ctx.strokeStyle = alpha(d.color('blue'), 0.55); ctx.lineWidth = LW.thin; ctx.setLineDash([0.006, 0.004]);
      ctx.strokeRect(-hw, -hh, w, h); ctx.setLineDash([]);
      const step = Math.max(0.035, Math.min(w, h) / 9);
      const col = alpha(d.color('blue'), 0.5), s = step * 0.14;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = LW.thin * 1.1;
      const nx = Math.max(1, Math.floor(w / step)), ny = Math.max(1, Math.floor(h / step));
      const ox = -hw + (w - (nx - 1) * step) / 2, oy = -hh + (h - (ny - 1) * step) / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const x = ox + i * step, y = oy + j * step;
        if (o.kind === 'field-b-in') { ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, Math.PI * 2); ctx.stroke(); dot(ctx, x, y, s * 0.35, col); }
      }
      ctx.restore();
      drawSym(ctx, 'B', hw - 0.02, -hh + 0.022, 0.02, d.color('blue'), 'center', d.paper);
      break;
    }
    case 'field-e': {
      const plates = flag(o, 'plates');
      const ang = (num(o, 'angle', 0) * Math.PI) / 180;
      const ex = Math.cos(ang), ey = -Math.sin(ang);
      ctx.save();
      if (plates) {
        // 上下极板
        const pc = d.color('ink');
        ctx.fillStyle = pc;
        ctx.fillRect(-hw, -hh - 0.006, w, 0.006);
        ctx.fillRect(-hw, hh, w, 0.006);
        const top = ey > 0 ? '+' : '−', bot = ey > 0 ? '−' : '+';
        for (let i = 0; i < 7; i++) {
          const x = -hw + (w * (i + 0.5)) / 7;
          drawSym(ctx, top, x, -hh - 0.019, 0.017, d.color(top === '+' ? 'red' : 'blue'), 'center');
          drawSym(ctx, bot, x, hh + 0.02, 0.017, d.color(bot === '+' ? 'red' : 'blue'), 'center');
        }
      } else {
        ctx.fillStyle = d.dark ? 'rgba(255,191,102,.06)' : 'rgba(224,122,18,.04)';
        ctx.fillRect(-hw, -hh, w, h);
        ctx.strokeStyle = alpha(d.color('orange'), 0.5); ctx.lineWidth = LW.thin; ctx.setLineDash([0.006, 0.004]); ctx.strokeRect(-hw, -hh, w, h); ctx.setLineDash([]);
      }
      // 电场线
      const col = alpha(d.color('orange'), 0.55);
      const n = Math.max(3, Math.round((Math.abs(ey) > 0.5 ? w : h) / 0.06));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        if (Math.abs(ey) > 0.5) {
          const x = -hw + w * f, y0 = -hh + 0.004, y1 = hh - 0.004;
          ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = LW.thin; ctx.setLineDash([0.004, 0.006]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.restore();
          const ym = 0, dir = Math.sign(ey);
          ctx.beginPath(); ctx.moveTo(x, ym + dir * 0.007); ctx.lineTo(x - 0.004, ym - dir * 0.003); ctx.lineTo(x + 0.004, ym - dir * 0.003); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
        } else {
          const y = -hh + h * f, dir = Math.sign(ex);
          ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = LW.thin; ctx.setLineDash([0.004, 0.006]); ctx.beginPath(); ctx.moveTo(-hw, y); ctx.lineTo(hw, y); ctx.stroke(); ctx.restore();
          ctx.beginPath(); ctx.moveTo(dir * 0.007, y); ctx.lineTo(-dir * 0.003, y - 0.004); ctx.lineTo(-dir * 0.003, y + 0.004); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
        }
      }
      ctx.restore();
      drawSym(ctx, 'E', hw - 0.02, -hh + 0.022, 0.02, d.color('orange'), 'center', d.paper);
      break;
    }
    case 'charge-pos': case 'charge-neg': {
      const r = Math.max(0.006, Math.min(w, h) / 2);
      const c = d.color(o.kind === 'charge-pos' ? 'red' : 'blue');
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = alpha(c, d.dark ? 0.4 : 0.18); ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = LW.line; ctx.stroke();
      ctx.save(); ctx.rotate(-o.rot);
      line(ctx, [-r * 0.5, 0, r * 0.5, 0], c, LW.line);
      if (o.kind === 'charge-pos') line(ctx, [0, -r * 0.5, 0, r * 0.5], c, LW.line);
      ctx.restore();
      break;
    }
    default: {
      ctx.strokeStyle = ink; ctx.lineWidth = LW.line;
      ctx.strokeRect(-hw, -hh, w, h);
      label(o.label ?? o.kind, 0.014);
    }
  }
}

/** 弹簧：从 (x0,y0) 到 (x1,y1) 的锯齿线（圈数固定，压缩时变密） */
export function drawSpring(d: SD, x0: number, y0: number, x1: number, y1: number, width = 0.022, coils = 11, color?: string) {
  const { ctx } = d;
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  if (L < 1e-5) return;
  if (useBoard()) {
    drawObj(d, { id: '_spring', kind: 'spring', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: L, h: width, rot: Math.atan2(dy, dx), props: {} });
    return;
  }
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const lead = Math.min(L * 0.12, 0.012);
  const pts = [x0, y0, x0 + ux * lead, y0 + uy * lead];
  const n = coils * 2;
  for (let i = 1; i < n; i++) {
    const s = lead + ((L - 2 * lead) * i) / n, a = (i % 2 ? 1 : -1) * width / 2;
    pts.push(x0 + ux * s + nx * a, y0 + uy * s + ny * a);
  }
  pts.push(x1 - ux * lead, y1 - uy * lead, x1, y1);
  line(ctx, pts, color ?? d.color('ink'), LW.line);
}

export function drawRope(d: SD, pts: number[], kind: 'rope' | 'rod' = 'rope') {
  const ink = d.color('ink');
  if (kind === 'rod') {
    line(d.ctx, pts, ink, LW.bold * 1.5);
    dot(d.ctx, pts[0], pts[1], 0.004, ink); dot(d.ctx, pts[pts.length - 2], pts[pts.length - 1], 0.004, ink);
  } else line(d.ctx, pts, alpha(ink, 0.85), LW.line * 0.9);
}
