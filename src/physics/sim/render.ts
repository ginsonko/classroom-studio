// ── 仿真画面：场景 + 教学叠加层（矢量、轨迹、频闪、事件、读数卡、图像卡） ─────────────
// 全部画在页面坐标里（1 = 页宽），老师端和学生窗口画出来完全一样。
import { DYN_KINDS, num, type BState, type SimRun } from './engine';
import { drawBody, drawRope, drawSpring } from './look';
import type { Corner, Graph, Ov, P, Preset, Row } from './presetKit';
import { alpha, arrow, BODY_COLORS, card, dot, line, LW, pill, VEC_COLOR, type SD } from './prim';
import { drawSym, drawText, fmt, measureSym, textW } from './text';

export const PAGE_H = 900 / 1600;

export interface RenderOpts { preset?: Preset; params: P; ov: Ov; ratio?: number }

const tintOf = (run: SimRun, i: number) => {
  const id = run.bodies[i].id;
  return id === 'A' ? 0 : id === 'B' ? 1 : i;
};

// ── 比例尺：力 / 速度 → 页面长度（随计算进度更新，算完后固定）──
const SCALES = new WeakMap<SimRun, { n: number; fs: number; vs: number }>();
export function scales(run: SimRun, focus?: string[]) {
  let s = SCALES.get(run);
  if (s && (s.n === run.frames.length || (run.done && s.n > 0 && s.n >= run.frames.length))) return s;
  let fmax = 0, vmax = 0;
  const idx = run.bodies.map((b, i) => (!focus || focus.includes(b.id) ? i : -1)).filter((i) => i >= 0);
  for (let k = 0; k < run.frames.length; k += 6) {
    const fr = run.frames[k];
    for (const i of idx) {
      const b = fr.b[i];
      if (!b.alive) continue;
      vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
      for (const f of mergeForces(b)) fmax = Math.max(fmax, Math.hypot(f.x, f.y));
    }
  }
  s = { n: run.frames.length, fs: fmax > 0 ? 0.095 / fmax : 0, vs: vmax > 0 ? 0.085 / vmax : 0 };
  SCALES.set(run, s);
  return s;
}

/** 同一施力物体的同类力合并（多个接触点 → 一个 F_N） */
function mergeForces(b: BState) {
  const out: { k: string; label: string; x: number; y: number }[] = [];
  for (const f of b.f) {
    const ex = out.find((o) => o.k === f.k && o.label === f.label);
    if (ex) { ex.x += f.x; ex.y += f.y; } else out.push({ ...f });
  }
  return out;
}

// ── 主入口 ────────────────────────────────────────────────
export function drawSim(d: SD, run: SimRun, t: number, o: RenderOpts) {
  const { ctx } = d, k = run.ppm, ov = o.ov, pre = o.preset;
  const ratio = o.ratio ?? PAGE_H;
  const sc = scales(run, pre?.focus);

  // 1 场区、静止物体、装饰
  for (const f of run.fields) drawBody(d, f.obj, { t });
  for (const s of run.statics) {
    const obj = s.obj.kind === 'conveyor' ? { ...s.obj, props: { ...s.obj.props, ppm: k } } : s.obj;
    drawBody(d, obj, { t });
    if (s.obj.kind === 'conveyor') belt(d, s.obj, t, k);
  }
  for (const x of run.decor) drawBody(d, x, { t });

  // 2 连接件（画在物体下面，绳子从物体中心「穿进去」看起来就是系在物体上）
  run.conns.forEach((cn, i) => {
    if (cn.kind === 'track') return;
    const c = run.conn(i, t);
    if (cn.kind === 'spring') {
      const w = Math.max(0.014, Math.min(0.03, cn.obj.h || 0.022));
      if (c.active) drawSpring(d, c.ax * k, c.ay * k, c.bx * k, c.by * k, w);
      else {
        const L = Math.hypot(c.bx - c.ax, c.by - c.ay) || 1, ux = (c.bx - c.ax) / L, uy = (c.by - c.ay) / L;
        drawSpring(d, c.ax * k, c.ay * k, (c.ax + ux * cn.L0) * k, (c.ay + uy * cn.L0) * k, w, 11, alpha(d.color('ink'), 0.6));
      }
    } else if (cn.kind === 'pulley' && cn.via) {
      const v = cn.via;
      const a0 = Math.atan2(v.gay - v.cy, v.gax - v.cx), a1 = Math.atan2(v.gby - v.cy, v.gbx - v.cx);
      drawRope(d, [c.ax * k, c.ay * k, v.gax * k, v.gay * k]);
      drawRope(d, [v.gbx * k, v.gby * k, c.bx * k, c.by * k]);
      ctx.save(); ctx.strokeStyle = alpha(d.color('ink'), 0.85); ctx.lineWidth = LW.line * 0.9;
      ctx.beginPath(); ctx.arc(v.cx * k, v.cy * k, v.r * k, a0, a1, v.gax > v.gbx); ctx.stroke(); ctx.restore();   // 绳从滑轮顶上绕过
    } else {
      // 绳松弛时画成下垂的弧线
      const L = Math.hypot(c.bx - c.ax, c.by - c.ay), Lmax = num(cn.obj, 'L', L);
      if (cn.kind === 'rope' && c.force < 1e-6 && L < Lmax * 0.985) {
        const sag = Math.sqrt(Math.max(0, Lmax * Lmax - L * L)) * 0.5 * k;
        const mx = ((c.ax + c.bx) / 2) * k, my = ((c.ay + c.by) / 2) * k + sag;
        ctx.save(); ctx.strokeStyle = alpha(d.color('ink'), 0.85); ctx.lineWidth = LW.line * 0.9;
        ctx.beginPath(); ctx.moveTo(c.ax * k, c.ay * k); ctx.quadraticCurveTo(mx, my, c.bx * k, c.by * k); ctx.stroke(); ctx.restore();
      } else drawRope(d, [c.ax * k, c.ay * k, c.bx * k, c.by * k], cn.kind === 'rod' ? 'rod' : 'rope');
    }
  });

  // 3 轨迹与频闪
  const moving = run.bodies.map((b, i) => (pre?.trails ? pre.trails.includes(b.id) : true) && (b.kind === 'particle' || DYN_KINDS.has(b.obj.kind)) ? i : -1).filter((i) => i >= 0);
  if (ov.trail) {
    const [iNow] = run.index(t);
    for (const i of moving) {
      const pts: number[] = [];
      for (let j = 0; j <= iNow; j += 2) { const s = run.frames[j].b[i]; pts.push(s.x * k, s.y * k); }
      const s = run.state(i, t); pts.push(s.x * k, s.y * k);
      if (pts.length < 6) continue;
      const span = Math.hypot(pts[pts.length - 2] - pts[0], pts[pts.length - 1] - pts[1]);
      if (span < 0.01 && !pre?.trails) continue;
      line(ctx, pts, alpha(d.color(BODY_COLORS[tintOf(run, i) % BODY_COLORS.length]), 0.55), LW.line * 0.8);
    }
    const dtS = pre?.strobe?.(o.params);
    if (dtS && dtS > 0) {
      for (const i of moving) for (let tt = 0; tt <= t + 1e-9; tt += dtS) drawBody(d, run.objAt(i, tt), { tint: tintOf(run, i), ghost: true });
    }
  }

  // 4 物体
  run.bodies.forEach((_, i) => drawBody(d, run.objAt(i, t), { tint: tintOf(run, i), t }));

  // 5 预设专属标注
  pre?.decorate?.(d, run, t, o.params, { ov, fs: sc.fs, vs: sc.vs });

  // 6 矢量
  const multi = run.bodies.filter((b) => b.kind === 'particle' || DYN_KINDS.has(b.obj.kind)).length > 1;
  run.bodies.forEach((b, i) => {
    if (pre?.focus && !pre.focus.includes(b.id)) return;
    const s = run.state(i, t);
    if (!s.alive && b.kind === 'particle') return;
    const cx = s.x * k, cy = s.y * k;
    if (ov.f && sc.fs > 0) {
      const fl = mergeForces(s).filter((f) => Math.hypot(f.x, f.y) * sc.fs > 0.007);
      const placed: number[][] = [];
      for (const f of fl) {
        const ex = cx + f.x * sc.fs, ey = cy + f.y * sc.fs;
        const col = d.color(VEC_COLOR[f.k] ?? 'ink');
        arrow(ctx, cx, cy, ex, ey, col);
        const L = Math.hypot(ex - cx, ey - cy), ux = (ex - cx) / L, uy = (ey - cy) / L;
        let lx = ex + ux * 0.02, ly = ey + uy * 0.02;
        for (const p of placed) if (Math.hypot(p[0] - lx, p[1] - ly) < 0.03) { lx += -uy * 0.028; ly += ux * 0.028; }
        placed.push([lx, ly]);
        drawSym(ctx, f.label, lx, ly, 0.023, col, 'center', d.paper);
      }
    }
    if (ov.v && sc.vs > 0 && s.alive !== false) {
      const sp = Math.hypot(s.vx, s.vy);
      if (sp * sc.vs > 0.006) {
        const box = b.obj.kind !== 'ball' && b.kind !== 'particle';
        const lift = box ? b.obj.h / 2 + 0.016 : 0;
        const ax = cx + Math.sin(s.a) * lift, ay = cy - Math.cos(s.a) * lift;
        const ex = ax + s.vx * sc.vs, ey = ay + s.vy * sc.vs;
        const col = d.color(VEC_COLOR.v);
        arrow(ctx, ax, ay, ex, ey, col, LW.vec * 0.9, 0.013);
        const ux = (ex - ax) / (sp * sc.vs), uy = (ey - ay) / (sp * sc.vs);
        const lab = multi ? `v_{${b.obj.label || b.id}}` : 'v';
        drawSym(ctx, lab, ex + ux * 0.016 - uy * 0.014, ey + uy * 0.016 + ux * 0.014, 0.024, col, 'center', d.paper);
      }
    }
  });

  // 7 事件
  const evs = run.events.filter((e) => e.t <= t + 1e-9).slice(-4);
  const used: number[][] = [];
  for (const e of evs) {
    const age = t - e.t, fresh = age < 0.7;
    let x = e.x * k, y = e.y * k;
    const bi = run.bodies.findIndex((b) => b.id === e.id || e.id.startsWith(b.id + '@') || e.id.startsWith(b.id + '|'));
    if (bi >= 0 && run.bodies[bi].kind !== 'particle') y -= Math.min(0.05, run.bodies[bi].obj.h / 2);
    for (const u of used) if (Math.abs(u[0] - x) < 0.16 && Math.abs(u[1] - y) < 0.045) y = u[1] - 0.045;
    used.push([x, y]);
    const label = e.kind === 'apex' && e.v !== undefined ? (e.v < 0.05 ? `${e.label} v=0` : `${e.label} v=${fmt(e.v)} m/s`) : e.label;
    const fg = d.color(e.kind === 'cospeed' ? 'green' : e.kind === 'collide' || e.kind === 'hit' ? 'red' : e.kind === 'apex' ? 'violet' : e.kind === 'field' ? 'blue' : 'orange');
    ctx.save(); ctx.globalAlpha *= fresh ? 1 : 0.78;
    pill(d, x, y, label, fg, d.dark ? 'rgba(12,16,22,.86)' : 'rgba(255,255,255,.94)', fresh ? 0.019 : 0.017, fresh ? 0.02 * d.scale * (1 - age / 0.7) : 0);
    ctx.restore();
  }

  // 8 读数卡与图像卡
  const rows = pre?.readouts ? pre.readouts(run, t, o.params) : genericRows(run, t);
  const title = pre?.title ?? run.scene.title ?? '物理演示';
  const lay = pre?.layout ?? {};
  readCard(d, title, rows, lay.read ?? 'tl', ratio);
  if (ov.graph !== false) {
    const graphs = pre?.graphs ? pre.graphs(o.params) : genericGraphs(run);
    graphCards(d, run, t, graphs, lay.graph ?? 'tr', ratio);
  }
}

// ── 传送带：表面的移动标记 + 速度方向 ──
function belt(d: SD, o: { x: number; y: number; w: number; h: number; rot: number; props: Record<string, unknown> }, t: number, k: number) {
  const { ctx } = d;
  const sp = Number(o.props.speed) || 0;
  ctx.save();
  ctx.translate(o.x, o.y); ctx.rotate(o.rot);
  const hw = o.w / 2, hh = o.h / 2, gap = 0.026;
  const phase = ((((sp * k * t) % gap) + gap) % gap);
  ctx.beginPath(); ctx.rect(-hw, -hh, o.w, o.h); ctx.clip();
  ctx.strokeStyle = alpha(d.color('ink'), 0.45); ctx.lineWidth = LW.thin;
  const dir = Math.sign(sp) || 1;
  for (let x = -hw - gap + phase; x < hw + gap; x += gap) {
    // 上表面：沿运动方向的小折线；下表面反向
    const yT = -hh + hh * 0.42, yB = hh - hh * 0.42, s = hh * 0.32;
    ctx.beginPath(); ctx.moveTo(x - dir * s, yT - s); ctx.lineTo(x, yT); ctx.lineTo(x - dir * s, yT + s); ctx.stroke();
    const xb = -x;
    ctx.beginPath(); ctx.moveTo(xb + dir * s, yB - s); ctx.lineTo(xb, yB); ctx.lineTo(xb + dir * s, yB + s); ctx.stroke();
  }
  ctx.restore();
  if (!sp) return;
  // 下方的速度箭头
  const nx = -Math.sin(o.rot), ny = Math.cos(o.rot), ux = Math.cos(o.rot) * dir, uy = Math.sin(o.rot) * dir;
  const cx = o.x + nx * (hh + 0.024) - ux * 0.06, cy = o.y + ny * (hh + 0.024) - uy * 0.06;
  const col = d.color('orange');
  arrow(ctx, cx - ux * 0.035, cy - uy * 0.035, cx + ux * 0.035, cy + uy * 0.035, col, LW.line, 0.011);
  drawSym(ctx, `v=${fmt(Math.abs(sp), Math.abs(sp) % 1 ? 1 : 0)} m/s`, cx + ux * 0.05 + nx * 0.004, cy + uy * 0.05 + ny * 0.004, 0.016, col, 'left', d.paper);
}

// ── 卡片位置 ──
function corner(c: Corner, w: number, h: number, ratio: number, stackY = 0) {
  const m = 0.014;
  const x = c === 'tc' ? 0.435 - w / 2 : c === 'tl' || c === 'bl' ? m : 1 - m - w;
  const y = c === 'tl' || c === 'tr' || c === 'tc' ? m + stackY : ratio - m - h - stackY;
  return [x, y];
}

const isNum = (s: string) => /^[-−]?\d|^\d|×10|^…$|^—$/.test(s);

function readCard(d: SD, title: string, rows: Row[], c: Corner, ratio: number) {
  const { ctx } = d;
  const S = 0.021, RH = 0.0335, pad = 0.014;
  const ink = d.color('ink'), dim = alpha(ink, 0.55);
  const symW = Math.max(0.03, ...rows.map((r) => (isNum(r.val) ? measureSym(ctx, r.sym, S) : textW(ctx, r.sym, S * 0.8, { weight: 600 }))));
  const valW = Math.max(0.05, ...rows.map((r) => (isNum(r.val) ? textW(ctx, r.val, S, { mono: true, weight: 600 }) : textW(ctx, r.val, S * 0.9, { weight: 600 }))));
  const unitW = Math.max(0, ...rows.map((r) => (r.unit && isNum(r.val) ? textW(ctx, r.unit, S * 0.78) : 0)));
  const titleW = textW(ctx, title, S * 0.92, { weight: 700 });
  const w = Math.max(titleW, symW + valW + unitW + 0.03) + pad * 2;
  const h = pad * 1.4 + S * 1.3 + rows.length * RH + pad * 0.6;
  const [x, y] = corner(c, w, h, ratio);
  card(d, x, y, w, h);
  drawText(ctx, title, x + pad, y + pad + S * 0.55, S * 0.92, ink, { weight: 700 });
  rows.forEach((r, i) => {
    const yy = y + pad * 1.4 + S * 1.3 + i * RH + RH * 0.5;
    const col = r.color ? d.color(r.color) : ink;
    if (isNum(r.val)) {
      drawSym(ctx, r.sym, x + pad, yy, S, col);
      drawText(ctx, '=', x + pad + symW + 0.008, yy, S * 0.9, dim);
      const vx = x + pad + symW + 0.024 + valW;
      drawText(ctx, r.val, vx, yy, S, ink, { mono: true, weight: 600, align: 'right' });
      if (r.unit) drawText(ctx, r.unit, vx + 0.006, yy, S * 0.78, dim);
    } else {
      drawText(ctx, r.sym, x + pad, yy, S * 0.8, dim, { weight: 600 });
      drawText(ctx, r.val, x + pad + symW + 0.024, yy, S * 0.9, col, { weight: 650 });
    }
  });
}

// ── 图像卡 ──
interface GCache { n: number; t: number[]; v: number[][]; lo: number; hi: number; amax: number }
const GC = new WeakMap<SimRun, Map<string, GCache>>();
const STEP = 4;
function sampled(run: SimRun, gi: number, g: Graph): GCache {
  let m = GC.get(run);
  if (!m) { m = new Map(); GC.set(run, m); }
  const key = gi + ':' + g.title;
  let c = m.get(key);
  if (!c) { c = { n: 0, t: [], v: g.series.map(() => []), lo: 0, hi: 0, amax: 0 }; m.set(key, c); }
  for (let j = c.n * STEP; j < run.frames.length; j += STEP) {
    const fr = run.frames[j];
    c.t.push(fr.t);
    g.series.forEach((s, si) => {
      const y = s.f(run, fr);
      const v = Number.isFinite(y) ? y : 0;
      c!.v[si].push(v);
      c!.lo = Math.min(c!.lo, v); c!.hi = Math.max(c!.hi, v); c!.amax = Math.max(c!.amax, Math.abs(v));
    });
    c.n++;
  }
  return c;
}

function nice(span: number) {
  const raw = span / 4, p = 10 ** Math.floor(Math.log10(raw || 1)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

function graphCards(d: SD, run: SimRun, t: number, graphs: Graph[], c: Corner, ratio: number) {
  let stack = 0;
  graphs.forEach((g, gi) => {
    const w = 0.3, h = g.kind === 'line' ? 0.2 : 0.142;
    const [x, y] = corner(c, w, h, ratio, stack);
    stack += h + 0.012;
    card(d, x, y, w, h);
    if (g.kind === 'line') lineGraph(d, run, t, g, gi, x, y, w, h);
    else bars(d, run, t, g, gi, x, y, w, h);
  });
}

function lineGraph(d: SD, run: SimRun, t: number, g: Graph, gi: number, x: number, y: number, w: number, h: number) {
  const { ctx } = d;
  const ink = d.color('ink'), dim = alpha(ink, 0.55), grid = alpha(ink, 0.1);
  const c = sampled(run, gi, g);
  drawText(ctx, g.title, x + 0.012, y + 0.017, 0.015, ink, { weight: 700 });
  // 图例
  let lx = x + w - 0.012;
  for (let i = g.series.length - 1; i >= 0; i--) {
    const s = g.series[i], tw = textW(ctx, s.label, 0.0135, { weight: 600 });
    drawText(ctx, s.label, lx, y + 0.017, 0.0135, d.color(s.color), { align: 'right', weight: 600 });
    lx -= tw + 0.008;
    line(ctx, [lx - 0.016, y + 0.016, lx - 0.002, y + 0.016], d.color(s.color), LW.line, s.dash ? [0.004, 0.003] : undefined);
    lx -= 0.024;
  }
  const px0 = x + 0.042, px1 = x + w - 0.016, py0 = y + 0.034, py1 = y + h - 0.026;
  let lo = Math.min(0, c.lo), hi = Math.max(0, c.hi);
  if (hi - lo < 1e-9) { hi = lo + 1; }
  const padY = (hi - lo) * 0.1; hi += padY; if (lo < 0) lo -= padY;
  const T = run.duration;
  const X = (tt: number) => px0 + (tt / T) * (px1 - px0), Y = (v: number) => py1 - ((v - lo) / (hi - lo)) * (py1 - py0);
  // 网格与刻度
  const ty = nice(hi - lo);
  ctx.save();
  for (let v = Math.ceil(lo / ty) * ty; v <= hi + 1e-9; v += ty) {
    line(ctx, [px0, Y(v), px1, Y(v)], grid, LW.thin * 0.7);
    drawText(ctx, fmt(v, ty < 0.1 ? 2 : ty < 1 ? 1 : 0), px0 - 0.005, Y(v), 0.0118, dim, { align: 'right', mono: true });
  }
  const tx = nice(T);
  for (let v = 0; v <= T + 1e-9; v += tx) drawText(ctx, fmt(v, tx < 1 ? 1 : 0), X(v), py1 + 0.012, 0.0118, dim, { align: 'center', mono: true });
  ctx.restore();
  // 坐标轴
  arrow(ctx, px0, Y(0), px1 + 0.006, Y(0), alpha(ink, 0.7), LW.thin, 0.007);
  arrow(ctx, px0, py1, px0, py0 - 0.006, alpha(ink, 0.7), LW.thin, 0.007);
  drawSym(ctx, 't/s', px1 - 0.004, Y(0) - 0.011, 0.012, dim, 'right');
  if (g.ylab) drawSym(ctx, g.ylab, px0 + 0.006, py0 + 0.002, 0.012, dim, 'left');
  // 事件竖线
  for (const e of run.events) {
    if (e.t > t || !['cospeed', 'collide', 'leave', 'apex', 'land', 'release', 'slack'].includes(e.kind)) continue;
    line(ctx, [X(e.t), py0, X(e.t), py1], alpha(d.color('green'), 0.55), LW.thin, [0.003, 0.003]);
  }
  // 曲线（只画到当前时刻）
  const n = Math.min(c.t.length, Math.floor(t / (run.dt * STEP)) + 1);
  g.series.forEach((s, si) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(X(c.t[i]), Y(c.v[si][i]));
    const cur = s.f(run, run.frame(t));
    pts.push(X(Math.min(t, T)), Y(cur));
    const col = d.color(s.color);
    line(ctx, pts, col, LW.line * 1.05, s.dash ? [0.005, 0.004] : undefined);
    dot(ctx, X(Math.min(t, T)), Y(cur), 0.0035, col);
  });
  line(ctx, [X(Math.min(t, T)), py0, X(Math.min(t, T)), py1], alpha(d.color('ai'), 0.7), LW.thin);
}

function bars(d: SD, run: SimRun, t: number, g: Graph, gi: number, x: number, y: number, w: number, h: number) {
  const { ctx } = d;
  const ink = d.color('ink'), dim = alpha(ink, 0.55);
  const c = sampled(run, gi, g);
  drawText(ctx, g.title, x + 0.012, y + 0.017, 0.015, ink, { weight: 700 });
  const fr = run.frame(t);
  const vals = g.series.map((s) => s.f(run, fr));
  const amax = Math.max(1e-9, c.amax, ...vals.map(Math.abs));
  const py0 = y + 0.034, py1 = y + h - 0.03;
  const base = g.signed ? (py0 + py1) / 2 : py1, span = g.signed ? (py1 - py0) / 2 : py1 - py0;
  const n = g.series.length, bw = Math.min(0.04, (w - 0.05) / n * 0.55), gap = (w - 0.04) / n;
  line(ctx, [x + 0.016, base, x + w - 0.016, base], alpha(ink, 0.5), LW.thin);
  g.series.forEach((s, i) => {
    const cx = x + 0.02 + gap * (i + 0.5), v = vals[i], hgt = (v / amax) * span * 0.92;
    const col = d.color(s.color);
    ctx.save(); ctx.fillStyle = alpha(col, d.dark ? 0.75 : 0.82);
    ctx.beginPath(); ctx.roundRect(cx - bw / 2, Math.min(base, base - hgt), bw, Math.max(0.0015, Math.abs(hgt)), 0.002); ctx.fill(); ctx.restore();
    drawText(ctx, fmt(v, amax < 0.1 ? 4 : amax < 1 ? 3 : amax < 10 ? 2 : 1), cx, hgt >= 0 ? base - hgt - 0.009 : base - hgt + 0.009, 0.011, ink, { align: 'center', mono: true, weight: 600 });
    drawSym(ctx, s.label, cx, py1 + 0.014, 0.015, dim, 'center');
  });
  void dim;
}

// ── 没有预设（黑板 → 仿真、AI 场景）时的通用读数与图像 ──
function genericRows(run: SimRun, t: number): Row[] {
  const rows: Row[] = [{ sym: 't', val: fmt(t * run.ts), unit: 's' }];
  run.bodies.slice(0, 4).forEach((b, i) => {
    const s = run.state(i, t);
    rows.push({ sym: `v_{${b.obj.label || b.id}}`, val: fmt(Math.hypot(s.vx, s.vy)), unit: 'm/s', color: BODY_COLORS[tintOf(run, i) % BODY_COLORS.length] });
  });
  return rows;
}
function genericGraphs(run: SimRun): Graph[] {
  if (!run.bodies.length) return [];
  const ids = run.bodies.slice(0, 3).map((b, i) => ({ i, b }));
  const gs: Graph[] = [{
    kind: 'line', title: '速率 v–t', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
    series: ids.map(({ i, b }) => ({ label: b.obj.label || b.id, color: BODY_COLORS[tintOf(run, i) % BODY_COLORS.length], f: (_r, fr) => Math.hypot(fr.b[i].vx, fr.b[i].vy) })),
  }];
  if (run.bodies.some((b) => b.kind === 'dyn')) gs.push({ kind: 'bars', title: '能量 E/J', unit: 'J', series: [
    { label: 'E_k', color: 'blue', f: (_r, fr) => fr.ek },
    { label: 'E_p', color: 'green', f: (_r, fr) => fr.ep },
    { label: 'E_弹', color: 'orange', f: (_r, fr) => fr.es },
    { label: 'Q', color: 'red', f: (_r, fr) => fr.q },
  ] });
  return gs;
}
