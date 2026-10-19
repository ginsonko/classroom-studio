// ── 力学预设：传送带、斜面、板块、碰撞、反冲、人船、平抛、圆周、振子、单摆、滑轮 ─────────
import { texRad } from './engine';
import { angleArc, arrow, dim, dot, line, LW, DASH, alpha, pill } from './prim';
import { drawSym, drawText, fmt } from './text';
import {
  acc, along, belt1D, clampN, fb, force, kn, memo, mkScene, ob, st, st0, U,
  type P, type Preset, type Row,
} from './presetKit';

const g_ = (p: P) => p.g ?? 10;
/** 弹簧力是显式施加的：子步细分让能量误差 < 0.1% */
const withSub = (n: number, sc: ReturnType<typeof mkScene>) => ({ ...sc, params: { ...sc.params, substeps: n } });
const deg = (p: P) => texRad(p.th);

// ═════════════ 0. 追及相遇 ═════════════
const planCh = memo((p: P) => {
  const a = p.a, v = p.v, d0 = p.d0 ?? 0;
  const tCo = v / a, gapMax = d0 + (v * v) / (2 * a);
  const tMeet = (v + Math.sqrt(v * v + 2 * a * d0)) / a, xMeet = 0.5 * a * tMeet * tMeet;
  const T = clampN(tMeet * 1.15 + 0.4, 1, 36);
  const span = Math.max(0.5 * a * T * T, d0 + v * T, 1);
  const x0 = 0.07, ppm = (0.86 - x0) / span;
  const tick = [0.5, 1, 2, 5, 10].find((c) => T / c <= 7) ?? 10;
  return { d0, tCo, gapMax, tMeet, xMeet, T, ppm, x0, tick, yB: 0.37, yC: 0.51, shown: tMeet <= T };
});
export const chase: Preset = {
  id: 'chase', title: '追及相遇', group: '力学',
  summary: '汽车由静止匀加速，自行车以恒定速度在前方行驶：两者速度相等时相距最远，此后汽车逐渐追上，位移相等时相遇。',
  params: [
    { key: 'a', label: '汽车加速度 a', unit: 'm/s²', min: 1, max: 6, step: 0.5, def: 3 },
    { key: 'v', label: '自行车速度 v', unit: 'm/s', min: 1, max: 12, step: 0.5, def: 6 },
    { key: 'd0', label: '自行车领先 d₀', unit: 'm', min: 0, max: 30, step: 1, def: 0 },
  ],
  build: (p) => {
    const C = planCh(p), cw = 0.085, ch = 0.04, bw = 0.062, bh = 0.054;
    return mkScene('chase', '追及相遇', p, C.ppm, C.T, [
      ob('roadB', 'ground', 0.5, C.yB + 0.0035, 0.98, 0.004, 0, { mu: 0, e: 0 }),
      ob('roadC', 'ground', 0.5, C.yC + 0.0035, 0.98, 0.004, 0, { mu: 0, e: 0 }),
      ob('car', 'car', C.x0, C.yC - ch / 2, cw, ch, 0, { ax: p.a, gravity: false, m: 1, mu: 0 }, '汽车'),
      ob('bike', 'car', C.x0 + C.d0 * C.ppm, C.yB - bh / 2, bw, bh, 0, { vx: p.v, gravity: false, m: 1, mu: 0, look: 'bike' }, '自行车'),
    ], ['vt']);
  },
  events: [],
  overlays: { v: true, f: false, trail: true, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  trails: [],
  graphs: () => [
    {
      kind: 'line', title: 'v–t 图像', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
      series: [
        { label: '汽车', color: 'blue', f: (r, fr) => fb(r, fr, 'car').vx },
        { label: '自行车', color: 'red', f: (r, fr) => fb(r, fr, 'bike').vx },
      ],
    },
  ],
  readouts: (r, t) => {
    const c = st(r, 'car', t), b = st(r, 'bike', t), c0 = st0(r, 'car');
    if (!c || !b || !c0) return [];
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_{汽车}', val: fmt(c.vx), unit: 'm/s', color: 'blue' },
      { sym: 'v_{自行车}', val: fmt(b.vx), unit: 'm/s', color: 'red' },
      { sym: 'x_{汽车}', val: fmt(c.x - c0.x), unit: 'm', color: 'blue' },
      { sym: 'x_{自行车}', val: fmt(b.x - c0.x), unit: 'm', color: 'red' },
      { sym: 'Δx', val: fmt(b.x - c.x), unit: 'm', color: 'green' },
    ];
  },
  formulas: (p) => {
    const C = planCh(p), d0 = C.d0 > 0 ? `${kn(C.d0)}+` : '';
    return [
      { tex: `x_{汽车}=\\tfrac12at^2,\\quad x_{自行车}=${d0}vt` },
      { tex: `at_1=v\\Rightarrow t_1=\\dfrac{v}{a}=${kn(C.tCo)}${U('s')}`, note: '速度相等时相距最远' },
      { tex: `\\Delta x_{\\text{max}}=${d0}\\dfrac{v^2}{2a}=${kn(C.gapMax)}${U('m')}` },
      { tex: `\\tfrac12at_2^2=${d0}vt_2\\Rightarrow t_2=${kn(C.tMeet)}${U('s')}`, note: C.shown ? `追上时两车位移相同，x = ${fmt(C.xMeet)} m` : '相遇时刻超出演示时长' },
    ];
  },
  decorate: (d, r, t, p) => {
    const C = planCh(p), k = r.ppm, ctx = d.ctx, ink = d.color('ink');
    const blue = d.color('blue'), red = d.color('red'), green = d.color('green');
    const c0 = st0(r, 'car');
    if (!c0) return;
    line(ctx, [C.x0, C.yB - 0.07, C.x0, C.yC + 0.012], alpha(ink, 0.35), LW.thin, DASH);
    drawText(ctx, '起点', C.x0, C.yC + 0.026, 0.012, alpha(ink, 0.6), { align: 'center' });
    // 每隔 tick 秒在路面上打点：自行车等间距、汽车间距越来越大
    for (let s = C.tick; s <= t + 1e-6; s += C.tick) {
      const b = st(r, 'bike', s), c = st(r, 'car', s);
      if (!b || !c) break;
      const lab = `${fmt(s, s % 1 ? 1 : 0)}s`;
      dot(ctx, b.x * k, C.yB + 0.0015, 0.0035, red);
      drawText(ctx, lab, b.x * k, C.yB + 0.024, 0.011, alpha(red, 0.85), { align: 'center' });
      dot(ctx, c.x * k, C.yC + 0.0015, 0.0035, blue);
      drawText(ctx, lab, c.x * k, C.yC + 0.024, 0.011, alpha(blue, 0.85), { align: 'center' });
    }
    const c = st(r, 'car', t), b = st(r, 'bike', t);
    if (!c || !b) return;
    const ym = C.yB + 0.06;
    if (t < C.tMeet - 0.01 && (b.x - c.x) * k > 0.018) dim(d, b.x * k, ym, c.x * k, ym, `Δx=${fmt(b.x - c.x)} m`, green, 0.016);
    const bg = d.dark ? 'rgba(12,16,22,.86)' : 'rgba(255,255,255,.94)';
    if (t >= C.tCo) {
      const bc = st(r, 'bike', C.tCo);
      if (bc) {
        line(ctx, [bc.x * k, C.yB, bc.x * k, C.yB - 0.062], alpha(green, 0.55), LW.thin, [0.003, 0.003]);
        pill(d, bc.x * k, C.yB - 0.062, `共速 t₁=${fmt(C.tCo)} s · Δx最大 ${fmt(C.gapMax)} m`, green, bg, 0.015);
      }
    }
    if (C.shown && t >= C.tMeet) {
      const xm = (c0.x + C.xMeet) * k;
      line(ctx, [xm, C.yB - 0.06, xm, C.yC + 0.01], alpha(red, 0.6), LW.line, [0.004, 0.003]);
      pill(d, xm, C.yB - 0.062, `相遇 t₂=${fmt(C.tMeet)} s`, red, bg, 0.016);
    }
  },
};

// ═════════════ 1. 水平传送带 ═════════════
const beltH = memo((p: P) => belt1D({ L: p.L, vb: p.v, v0: p.v0, gs: 0, gn: g_(p), mu: p.mu }));
const geoBH = (p: P) => {
  const ppm = 0.56 / p.L, x0 = 0.2, bw = 0.064, bh = 0.046, bH = 0.032, by = 0.37;
  return { ppm, x0, bw, bh, bH, by, len: bw / 2 + p.L * ppm, top: by - bH / 2 };
};
export const beltHorizontal: Preset = {
  id: 'belt-h', title: '水平传送带', group: '力学',
  summary: '物块轻放在匀速运动的水平传送带上：先在滑动摩擦力作用下匀加速，若带够长则与带共速后匀速。',
  params: [
    { key: 'v', label: '传送带速度 v', unit: 'm/s', min: 0.5, max: 8, step: 0.5, def: 2 },
    { key: 'mu', label: '动摩擦因数 μ', min: 0.05, max: 0.8, step: 0.05, def: 0.2 },
    { key: 'L', label: '传送带长 L', unit: 'm', min: 0.5, max: 12, step: 0.5, def: 4 },
    { key: 'v0', label: '物块初速度 v₀', unit: 'm/s', min: 0, max: 8, step: 0.5, def: 0 },
    { key: 'm', label: '物块质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 1 },
  ],
  build: (p) => {
    const G = geoBH(p), plan = beltH(p);
    const dur = plan.end === 'far' ? Math.min(25, plan.tEnd + 0.6) : 6;
    return mkScene('belt-h', '水平传送带', p, G.ppm, dur, [
      ob('belt', 'conveyor', G.x0 + G.len / 2, G.by, G.len, G.bH, 0, { speed: p.v, mu: p.mu }),
      ob('A', 'block', G.x0 + G.bw / 2, G.top - G.bh / 2 - 0.0002, G.bw, G.bh, 0, { m: p.m, mu: p.mu, vx: p.v0, pt: true }, 'A'),
    ]);
  },
  events: ['cospeed', 'leave'],
  overlays: { v: true, f: true, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  trails: ['A'],
  graphs: (p) => [{
    kind: 'line', title: 'v–t 图像', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
    series: [
      { label: '物块', color: 'blue', f: (r, fr) => fb(r, fr, 'A').vx },
      { label: '传送带', color: 'orange', f: () => p.v, dash: true },
    ],
  }],
  readouts: (r, t, p) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const plan = beltH(p);
    const off = plan.end === 'far' && t > plan.tEnd + 0.005;
    const co = !Number.isNaN(plan.tCo) && t >= plan.tCo - 0.005;
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_A', val: fmt(s.vx), unit: 'm/s', color: 'blue' },
      { sym: 'a', val: fmt(off ? 0 : acc(r, 'A', t, 1, 0)), unit: 'm/s²' },
      { sym: 'x', val: fmt(Math.min(p.L, s.x - s0.x)), unit: 'm' },
      { sym: '状态', val: off ? '离开传送带' : co ? '与带共速 · 匀速' : p.v0 < p.v ? '滑动摩擦 · 匀加速' : p.v0 > p.v ? '滑动摩擦 · 匀减速' : '匀速' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), a = p.mu * g, plan = beltH(p);
    if (p.v0 === p.v) return [{ tex: `v_0=v\\Rightarrow\\text{无相对滑动，一直匀速}` }];
    const up = p.v0 < p.v;
    const t1 = Math.abs(p.v - p.v0) / a, x1 = Math.abs(p.v * p.v - p.v0 * p.v0) / (2 * a);
    const out = [
      { tex: `a=\\mu g=${kn(p.mu)}\\times${kn(g)}=${kn(a)}${U('m/s^2')}`, note: up ? '摩擦力与运动同向，加速' : '物块比带快，摩擦力反向，减速' },
      { tex: `t_1=\\dfrac{|v-v_0|}{a}=${kn(t1)}${U('s')},\\quad x_1=\\dfrac{|v^2-v_0^2|}{2a}=${kn(x1)}${U('m')}` },
    ];
    if (x1 < p.L) out.push({ tex: `x_1<L\\Rightarrow\\text{先${up ? '加' : '减'}速后匀速},\\ t=t_1+\\dfrac{L-x_1}{v}=${kn(plan.tEnd)}${U('s')}` });
    else out.push({ tex: `x_1\\ge L\\Rightarrow\\text{一直${up ? '加' : '减'}速},\\ t=${kn(plan.tEnd)}${U('s')},\\ v=${kn(plan.vEnd)}${U('m/s')}` });
    return out;
  },
  decorate: (d, r, t, p) => {
    const G = geoBH(p), plan = beltH(p), ink = d.color('ink');
    const xs = G.x0 + G.bw / 2, xe = G.x0 + G.len, y = G.by + G.bH / 2 + 0.045;
    dim(d, xs, y, xe, y, `L=${fmt(p.L, p.L % 1 ? 1 : 0)} m`, alpha(ink, 0.75), 0.018);
    if (!Number.isNaN(plan.tCo) && t >= plan.tCo && plan.sCo < p.L) {
      const x1 = xs + plan.sCo * G.ppm;
      dim(d, xs, y + 0.04, x1, y + 0.04, `x₁=${fmt(plan.sCo)} m`, d.color('green'), 0.018);
    }
  },
};

// ═════════════ 2. 倾斜传送带 ═════════════
const geoBI = (p: P) => {
  const th = deg(p), c = Math.cos(th), s = Math.sin(th);
  const ppm = Math.min(0.56 / (p.L * c), 0.33 / (p.L * s));
  const bw = 0.06, bh = 0.044, bH = 0.03;
  const len = p.L * ppm + bw / 2;                              // 只在起点一侧留半个物块
  const Pt: [number, number] = [0.07, 0.13];                    // 高端（中线）
  const u: [number, number] = [c, s];                            // 沿带向下（y 向下坐标）
  const n: [number, number] = [s, -c];                           // 带面法线（向上）
  const ctr: [number, number] = [Pt[0] + (u[0] * len) / 2, Pt[1] + (u[1] * len) / 2];
  const Pb: [number, number] = [Pt[0] + u[0] * len, Pt[1] + u[1] * len];
  const down = p.dir !== 1;
  // 物块起点：向下运行放在高端，向上运行放在低端
  const sStart = down ? bw / 2 : len - bw / 2;              // 终点：向下 s=len，向上 s=0
  const surf = (sp: number): [number, number] => [Pt[0] + u[0] * sp + n[0] * (bH / 2), Pt[1] + u[1] * sp + n[1] * (bH / 2)];
  return { th, c, s, ppm, bw, bh, bH, len, Pt, Pb, u, n, ctr, down, sStart, surf };
};
const beltI = memo((p: P) => {
  const th = deg(p), g = g_(p);
  const down = p.dir !== 1;
  return belt1D({ L: p.L, vb: p.v, v0: 0, gs: (down ? 1 : -1) * g * Math.sin(th), gn: g * Math.cos(th), mu: p.mu });
});
export const beltIncline: Preset = {
  id: 'belt-incline', title: '倾斜传送带', group: '力学',
  summary: '物块轻放在倾斜传送带一端：共速前后摩擦力方向会变，μ 与 tanθ 的大小决定共速后是否继续加速。',
  params: [
    { key: 'th', label: '倾角 θ', unit: '°', min: 10, max: 60, step: 1, def: 37 },
    { key: 'v', label: '传送带速度 v', unit: 'm/s', min: 1, max: 15, step: 0.5, def: 10 },
    { key: 'L', label: '传送带长 L', unit: 'm', min: 2, max: 30, step: 1, def: 16 },
    { key: 'mu', label: '动摩擦因数 μ', min: 0.1, max: 1.2, step: 0.05, def: 0.5 },
    { key: 'dir', label: '传送带运行方向', min: 0, max: 1, step: 1, def: 0, options: [{ v: 0, label: '向下' }, { v: 1, label: '向上' }] },
    { key: 'm', label: '物块质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 1 },
  ],
  build: (p) => {
    const G = geoBI(p), plan = beltI(p);
    const dur = plan.end !== 'none' && Number.isFinite(plan.tEnd)
      ? Math.max(.5, Math.min(25, plan.tEnd + 0.45))
      : 8;
    const S = G.surf(G.sStart);
    const bx = S[0] + G.n[0] * (G.bh / 2 + 0.0004), by = S[1] + G.n[1] * (G.bh / 2 + 0.0004);
    return mkScene('belt-incline', '倾斜传送带', p, G.ppm, dur, [
      ob('belt', 'conveyor', G.ctr[0], G.ctr[1], G.len, G.bH, G.th, { speed: G.down ? p.v : -p.v, mu: p.mu }),
      ob('A', 'block', bx, by, G.bw, G.bh, G.th, { m: p.m, mu: p.mu, pt: true }, 'A'),
    ]);
  },
  events: ['cospeed', 'leave'],
  overlays: { v: true, f: true, trail: false, graph: true, formula: true },
  layout: { read: 'bl', graph: 'tr', formula: 'br' },
  graphs: (p) => {
    const G = geoBI(p), sg = G.down ? 1 : -1;
    return [{
      kind: 'line', title: 'v–t 图像（沿带运行方向）', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
      series: [
        { label: '物块', color: 'blue', f: (r, fr) => along(fb(r, fr, 'A'), sg * G.u[0], sg * G.u[1]) },
        { label: '传送带', color: 'orange', f: () => p.v, dash: true },
      ],
    }];
  },
  readouts: (r, t, p) => {
    const G = geoBI(p), sg = G.down ? 1 : -1;
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const plan = beltI(p);
    const off = plan.end !== 'none' && t > plan.tEnd + 0.005;
    const f = force(s, 'f');
    const fd = f.x * sg * G.u[0] + f.y * sg * G.u[1];
    const fdir = f.m < 1e-3 ? '无' : (fd > 0) === G.down ? '沿斜面向下' : '沿斜面向上';
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_A', val: fmt(along(s, sg * G.u[0], sg * G.u[1])), unit: 'm/s', color: 'blue' },
      { sym: 'a', val: fmt(off ? 0 : acc(r, 'A', t, sg * G.u[0], sg * G.u[1])), unit: 'm/s²' },
      { sym: 's', val: fmt(Math.min(p.L, Math.hypot(s.x - s0.x, s.y - s0.y))), unit: 'm' },
      { sym: 'f', val: off ? '—' : fdir, color: 'green' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), th = deg(p), si = Math.sin(th), co = Math.cos(th), plan = beltI(p);
    const tanT = Math.tan(th), down = p.dir !== 1;
    const out: { tex: string; note?: string }[] = [];
    const sv = `\\sin\\theta=${kn(si)},\\ \\cos\\theta=${kn(co)}`;
    if (down) {
      out.push({ tex: `a_1=g(\\sin\\theta+\\mu\\cos\\theta)=${kn(plan.a1)}${U('m/s^2')}`, note: `共速前摩擦力沿斜面向下（sinθ=${fmt(si)}，cosθ=${fmt(co)}）` });
      if (!Number.isNaN(plan.tCo)) {
        out.push({ tex: `t_1=\\dfrac{v}{a_1}=${kn(plan.tCo)}${U('s')},\\ x_1=\\dfrac{v^2}{2a_1}=${kn(plan.sCo)}${U('m')}` });
        if (p.mu < tanT) out.push({ tex: `\\mu<\\tan\\theta\\Rightarrow a_2=g(\\sin\\theta-\\mu\\cos\\theta)=${kn(plan.a2)}${U('m/s^2')}`, note: '共速后摩擦力反向，继续加速' });
        else out.push({ tex: `\\mu\\ge\\tan\\theta\\Rightarrow\\text{共速后与带一起匀速}` });
      } else out.push({ tex: `x=\\dfrac{v^2}{2a_1}\\ge L\\Rightarrow\\text{一直以 }a_1\\text{ 加速}` });
    } else {
      if (p.mu <= tanT) out.push({ tex: `\\mu\\le\\tan\\theta\\Rightarrow\\text{物块沿带下滑，带不动它}` });
      else {
        out.push({ tex: `a_1=g(\\mu\\cos\\theta-\\sin\\theta)=${kn(plan.a1)}${U('m/s^2')}`, note: `摩擦力沿斜面向上（sinθ=${fmt(si)}，cosθ=${fmt(co)}）` });
        if (!Number.isNaN(plan.tCo)) out.push({ tex: `t_1=\\dfrac{v}{a_1}=${kn(plan.tCo)}${U('s')},\\ x_1=${kn(plan.sCo)}${U('m')}\\Rightarrow\\text{之后匀速}` });
      }
    }
    if (plan.end !== 'none') out.push({ tex: `t_{总}=${kn(plan.tEnd)}${U('s')},\\quad v_{末}=${kn(Math.abs(plan.vEnd))}${U('m/s')}` });
    return out;
  },
  decorate: (d, _r, _t, p) => {
    const G = geoBI(p), ink = alpha(d.color('ink'), 0.75);
    // L 尺寸线（带下方）
    const off = -(G.bH / 2 + 0.05);
    const a = G.surf(G.sStart), b = G.surf(G.down ? G.len : 0);
    dim(d, a[0], a[1], b[0], b[1], `L=${fmt(p.L, 0)} m`, ink, 0.018, off);
    // 倾角：在低端画水平虚线
    const P0 = [G.Pb[0] + G.n[0] * -G.bH / 2, G.Pb[1] + G.n[1] * -G.bH / 2];
    line(d.ctx, [P0[0], P0[1], P0[0] - 0.16, P0[1]], ink, LW.thin, DASH);
    angleArc(d, P0[0], P0[1], 0.07, Math.PI, Math.PI + G.th, `θ=${p.th}°`, ink, 0.016);
  },
};

// ═════════════ 3. 斜面滑块 ═════════════
const geoIn = (p: P) => {
  const th = deg(p), wI = Math.min(0.5, 0.34 / Math.tan(th)), hI = wI * Math.tan(th);
  const x0 = 0.1, yb = 0.52, hyp = wI / Math.cos(th);
  const bw = 0.06, bh = 0.045;
  const ppm = (hyp - bw - 0.012) / p.L;
  const up: [number, number] = [Math.cos(th), -Math.sin(th)], n: [number, number] = [-Math.sin(th), -Math.cos(th)];
  const sEnd = bw / 2 + 0.006, sStart = sEnd + p.L * ppm;
  const at = (s: number): [number, number] => [x0 + up[0] * s + n[0] * (bh / 2 + 0.0004), yb + up[1] * s + n[1] * (bh / 2 + 0.0004)];
  return { th, wI, hI, x0, yb, ppm, bw, bh, up, n, sEnd, sStart, at };
};
const planIn = memo((p: P) => {
  const g = g_(p), th = deg(p), si = Math.sin(th), co = Math.cos(th);
  const slides = p.v0 > 0 || p.mu < Math.tan(th) - 1e-12;
  const a = slides ? g * (si - p.mu * co) : 0;
  let tEnd = NaN, stop = false;
  if (slides) {
    if (Math.abs(a) < 1e-9) tEnd = p.L / Math.max(1e-9, p.v0);
    else {
      const disc = p.v0 * p.v0 + 2 * a * p.L;
      if (disc >= 0) tEnd = (-p.v0 + Math.sqrt(disc)) / a;
      if (!(tEnd > 0)) { tEnd = NaN; stop = true; }
    }
  }
  return { a, slides, tEnd, stop, tStop: stop ? p.v0 / -a : NaN };
});
export const incline: Preset = {
  id: 'incline', title: '斜面滑块', group: '力学',
  summary: '物块在粗糙斜面上：μ < tanθ 时匀加速下滑 a = g(sinθ − μcosθ)；μ ≥ tanθ 时静止（静摩擦力 = mg sinθ）。',
  params: [
    { key: 'th', label: '倾角 θ', unit: '°', min: 10, max: 60, step: 1, def: 37 },
    { key: 'mu', label: '动摩擦因数 μ', min: 0, max: 1.2, step: 0.05, def: 0.5 },
    { key: 'm', label: '物块质量 m', unit: 'kg', min: 0.5, max: 10, step: 0.5, def: 2 },
    { key: 'L', label: '下滑距离 L', unit: 'm', min: 0.5, max: 8, step: 0.5, def: 3 },
    { key: 'v0', label: '沿斜面向下初速度 v₀', unit: 'm/s', min: 0, max: 6, step: 0.5, def: 0 },
  ],
  build: (p) => {
    const G = geoIn(p), plan = planIn(p);
    const dur = plan.slides && !Number.isNaN(plan.tEnd) ? Math.min(20, plan.tEnd) : plan.stop ? Math.min(20, plan.tStop + 1.5) : 3;
    const c = G.at(G.sStart);
    return mkScene('incline', '斜面滑块', p, G.ppm, dur, [
      ob('slope', 'incline', G.x0 + G.wI / 2, G.yb - G.hI / 2, G.wI, G.hI, 0, { angle: p.th, mu: p.mu }),
      ob('A', 'block', c[0], c[1], G.bw, G.bh, -G.th, { m: p.m, mu: p.mu, vx: -p.v0 * Math.cos(G.th), vy: -p.v0 * Math.sin(G.th) }, 'A'),
    ]);
  },
  events: ['cospeed'],
  overlays: { v: true, f: true, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'br' },
  graphs: () => [{
    kind: 'line', title: 'v–t 图像（沿斜面向下）', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
    series: [{ label: '物块', color: 'blue', f: (r, fr) => Math.hypot(fb(r, fr, 'A').vx, fb(r, fr, 'A').vy) }],
  }],
  readouts: (r, t, p) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const G = geoIn(p), plan = planIn(p);
    const fr = force(s, 'f'), N = force(s, 'N');
    const rows: Row[] = [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v', val: fmt(Math.hypot(s.vx, s.vy)), unit: 'm/s', color: 'blue' },
      { sym: 'a', val: fmt(Math.max(0, acc(r, 'A', t, -G.up[0], -G.up[1]))), unit: 'm/s²' },
      { sym: 'F_N', val: fmt(N.m), unit: 'N', color: 'blue' },
      { sym: 'f', val: fmt(fr.m), unit: 'N', color: 'green' },
    ];
    if (!plan.slides) rows.push({ sym: '状态', val: `静止（μ ≥ tanθ = ${fmt(Math.tan(G.th))}）` });
    return rows;
  },
  formulas: (p) => {
    const g = g_(p), th = deg(p), si = Math.sin(th), co = Math.cos(th), plan = planIn(p), tn = Math.tan(th);
    const head = { tex: `\\sin\\theta=${kn(si)},\\ \\cos\\theta=${kn(co)},\\ \\tan\\theta=${kn(tn)}` };
    if (!plan.slides) return [head,
      { tex: `\\mu=${kn(p.mu)}\\ge\\tan\\theta\\Rightarrow\\text{静止}`, note: '最大静摩擦力 ≥ 重力沿斜面的分力' },
      { tex: `f_{静}=mg\\sin\\theta=${kn(p.m * g * si)}${U('N')},\\ F_N=mg\\cos\\theta=${kn(p.m * g * co)}${U('N')}` }];
    const out = [head,
      { tex: `mg\\sin\\theta-\\mu mg\\cos\\theta=ma` },
      { tex: `a=g(\\sin\\theta-\\mu\\cos\\theta)=${kn(plan.a)}${U('m/s^2')}` }];
    if (!Number.isNaN(plan.tEnd)) out.push({ tex: `L=v_0t+\\tfrac12at^2\\Rightarrow t=${kn(plan.tEnd)}${U('s')},\\ v=${kn(p.v0 + plan.a * plan.tEnd)}${U('m/s')}` });
    else if (plan.stop) out.push({ tex: `\\text{减速到停：}t=\\dfrac{v_0}{|a|}=${kn(plan.tStop)}${U('s')}` });
    return out;
  },
  decorate: (d, r, t, p, x) => {
    if (!x.ov.f) return;
    const s = st(r, 'A', t);
    if (!s) return;
    const G = geoIn(p), cx = s.x * r.ppm, cy = s.y * r.ppm;
    const Gm = p.m * g_(p) * x.fs, col = d.color('orange');
    const a1 = [cx - G.up[0] * Gm * Math.sin(G.th), cy - G.up[1] * Gm * Math.sin(G.th)];
    const a2 = [cx - G.n[0] * Gm * Math.cos(G.th), cy - G.n[1] * Gm * Math.cos(G.th)];
    line(d.ctx, [cx, cy, a1[0], a1[1]], col, LW.line, DASH);
    line(d.ctx, [cx, cy, a2[0], a2[1]], col, LW.line, DASH);
    line(d.ctx, [a1[0], a1[1], cx, cy + Gm, a2[0], a2[1]], alpha(col, 0.5), LW.thin, [0.003, 0.004]);
    drawSym(d.ctx, 'G sinθ', a1[0] - 0.035, a1[1] + 0.006, 0.014, col, 'center', d.paper);
    drawSym(d.ctx, 'G cosθ', a2[0] + 0.004, a2[1] + 0.022, 0.014, col, 'center', d.paper);
  },
};

// ═════════════ 4. 板块模型 ═════════════
const planPk = memo((p: P) => {
  const g = g_(p), a1 = p.mu1 * g;
  const a2 = Math.max(0, (p.mu1 * p.m * g - p.mu2 * (p.m + p.M) * g) / p.M);
  const tCo = p.v0 / (a1 + a2), vCo = a2 * tCo;
  const xb = p.v0 * tCo - 0.5 * a1 * tCo * tCo, xp = 0.5 * a2 * tCo * tCo, rel = xb - xp;
  const leaves = rel > p.L;
  const tLeave = leaves ? (p.v0 - Math.sqrt(Math.max(0, p.v0 * p.v0 - 2 * (a1 + a2) * p.L))) / (a1 + a2) : NaN;
  const together = p.mu2 > 0 && !leaves ? Math.min(4, vCo / (p.mu2 * g)) : 1.5;
  const T = leaves ? tLeave + 1.0 : tCo + Math.max(1.2, together + 0.3);
  // 木板总位移（估计画面范围）
  const xpT = leaves ? 0.5 * a2 * T * T : xp + (p.mu2 > 0 ? vCo * together - 0.5 * p.mu2 * g * together * together : vCo * (T - tCo));
  return { a1, a2, tCo, vCo, xb, xp, rel, leaves, tLeave, T, xpT };
});
const geoPk = (p: P) => {
  const plan = planPk(p);
  const bw = 0.055, bh = 0.042, pH = 0.024, gy = 0.46, x0 = 0.07;
  const ppm = Math.min(0.12, 0.84 / (p.L + plan.xpT + 0.6));
  return { bw, bh, pH, gy, x0, ppm, plen: p.L * ppm + bw / 2 };
};
export const plank: Preset = {
  id: 'plank', title: '板块模型', group: '力学',
  summary: '物块以 v₀ 滑上静止长木板：物块减速、木板加速，共速后一起运动；比较相对位移 Δx 与板长 L 判断是否滑离。',
  params: [
    { key: 'v0', label: '物块初速度 v₀', unit: 'm/s', min: 1, max: 10, step: 0.5, def: 6 },
    { key: 'mu1', label: '块–板 μ₁', min: 0.05, max: 0.8, step: 0.05, def: 0.2 },
    { key: 'mu2', label: '板–地 μ₂', min: 0, max: 0.5, step: 0.05, def: 0 },
    { key: 'm', label: '物块质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 1 },
    { key: 'M', label: '木板质量 M', unit: 'kg', min: 0.5, max: 8, step: 0.5, def: 2 },
    { key: 'L', label: '木板长 L', unit: 'm', min: 2, max: 16, step: 0.5, def: 8 },
  ],
  build: (p) => {
    const G = geoPk(p), plan = planPk(p);
    const py = G.gy - G.pH / 2 - 0.0002;
    return mkScene('plank', '板块模型', p, G.ppm, Math.min(25, plan.T), [
      ob('ground', 'ground', 0.5, G.gy + 0.002, 0.98, 0.004, 0, { mu: p.mu2 }),
      ob('B', 'plank', G.x0 + G.plen / 2, py, G.plen, G.pH, 0, { m: p.M, mu: p.mu2 }, 'M'),
      ob('A', 'block', G.x0 + G.bw / 2, py - G.pH / 2 - G.bh / 2 - 0.0002, G.bw, G.bh, 0, { m: p.m, mu: p.mu1, vx: p.v0, pt: true }, 'm'),
    ]);
  },
  events: ['cospeed', 'leave'],
  overlays: { v: true, f: true, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  graphs: () => [{
    kind: 'line', title: 'v–t 图像', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
    series: [
      { label: '物块 m', color: 'blue', f: (r, fr) => fb(r, fr, 'A').vx },
      { label: '木板 M', color: 'red', f: (r, fr) => fb(r, fr, 'B').vx },
    ],
  }],
  readouts: (r, t) => {
    const a = st(r, 'A', t), b = st(r, 'B', t), a0 = st0(r, 'A'), b0 = st0(r, 'B');
    if (!a || !b || !a0 || !b0) return [];
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_块', val: fmt(a.vx), unit: 'm/s', color: 'blue' },
      { sym: 'v_板', val: fmt(b.vx), unit: 'm/s', color: 'red' },
      { sym: 'a_块', val: fmt(acc(r, 'A', t, 1, 0)), unit: 'm/s²', color: 'blue' },
      { sym: 'a_板', val: fmt(acc(r, 'B', t, 1, 0)), unit: 'm/s²', color: 'red' },
      { sym: 'Δx', val: fmt((a.x - a0.x) - (b.x - b0.x)), unit: 'm' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), plan = planPk(p);
    const out = [
      { tex: `a_{块}=\\mu_1g=${kn(plan.a1)}${U('m/s^2')}\\ (\\text{减速})` },
      { tex: `a_{板}=\\dfrac{\\mu_1mg-\\mu_2(m+M)g}{M}=${kn(plan.a2)}${U('m/s^2')}` },
    ];
    if (plan.a2 === 0 && p.mu2 > 0) out[1].tex = `\\mu_1mg\\le\\mu_2(m+M)g\\Rightarrow\\text{木板不动}`;
    if (!plan.leaves) {
      out.push({ tex: `v_0-a_{块}t=a_{板}t\\Rightarrow t=${kn(plan.tCo)}${U('s')},\\ v_{共}=${kn(plan.vCo)}${U('m/s')}` });
      out.push({ tex: `\\Delta x=x_{块}-x_{板}=${kn(plan.xb)}-${kn(plan.xp)}=${kn(plan.rel)}${U('m')}<L` });
    } else out.push({ tex: `\\Delta x=${kn(plan.rel)}${U('m')}>L\\Rightarrow\\text{物块在 }t=${kn(plan.tLeave)}${U('s')}\\text{ 滑离木板}` });
    void g;
    return out;
  },
  decorate: (d, r, t, p) => {
    const a = st(r, 'A', t), b = st(r, 'B', t), a0 = st0(r, 'A'), b0 = st0(r, 'B');
    if (!a || !b || !a0 || !b0) return;
    const G = geoPk(p), plan = planPk(p);
    if (plan.leaves && t > plan.tLeave) return;
    // 木板上的起点标记随木板移动
    const sx = (a0.x + (b.x - b0.x)) * r.ppm, ax = a.x * r.ppm, y = b.y * r.ppm - G.pH / 2 - G.bh - 0.03;
    const col = d.color('violet');
    line(d.ctx, [sx, b.y * r.ppm - G.pH / 2, sx, y + 0.008], alpha(col, 0.7), LW.thin, [0.003, 0.003]);
    if (ax - sx > 0.012) dim(d, sx, y, ax, y, `Δx=${fmt((a.x - a0.x) - (b.x - b0.x))} m`, col, 0.018);
  },
};

// ═════════════ 5. 碰撞 ═════════════
const planCo = memo((p: P) => {
  const { m1, m2, v1, v2, e } = p;
  const meets = v1 > v2;
  const v1p = (m1 * v1 + m2 * v2 - e * m2 * (v1 - v2)) / (m1 + m2);
  const v2p = (m1 * v1 + m2 * v2 + e * m1 * (v1 - v2)) / (m1 + m2);
  const gapP = 0.17, cw = 0.085;
  const xA = 0.15, xB = xA + cw + gapP;
  const after = 2.2;
  let ppm = 0.12;
  const rel = meets ? v1 - v2 : 1;
  if (meets) {
    const bxc = xB + (gapP * v2) / rel;          // 碰撞时 B 的位置（与 ppm 无关）
    const axc = xA + (gapP * v1) / rel;
    if (v2p > 0) ppm = Math.min(ppm, (0.95 - cw / 2 - bxc) / (after * v2p));
    if (v1p < 0) ppm = Math.min(ppm, (axc - cw / 2 - 0.03) / (after * -v1p));
    if (v1p > 0) ppm = Math.min(ppm, (0.95 - cw * 1.5 - axc) / (after * v1p));
  } else ppm = Math.min(ppm, 0.45 / (Math.max(Math.abs(v1), Math.abs(v2), 0.5) * 3));
  ppm = clampN(ppm, 0.01, 0.12);
  const tc = meets ? gapP / ppm / rel : NaN;
  const T = meets ? tc + after : 3;
  return { meets, v1p, v2p, ppm, tc, T, xA, xB, cw };
});
export const collision: Preset = {
  id: 'collision', title: '碰撞', group: '力学',
  summary: '两车在光滑水平面上正碰：动量守恒；恢复系数 e=1 弹性碰撞动能守恒，e=0 完全非弹性（碰后共速）动能损失最多。',
  params: [
    { key: 'm1', label: 'A 车质量 m₁', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 2 },
    { key: 'v1', label: 'A 车速度 v₁', unit: 'm/s', min: 0.5, max: 6, step: 0.5, def: 3 },
    { key: 'm2', label: 'B 车质量 m₂', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 1 },
    { key: 'v2', label: 'B 车速度 v₂', unit: 'm/s', min: -4, max: 4, step: 0.5, def: 0 },
    { key: 'e', label: '恢复系数 e', min: 0, max: 1, step: 0.1, def: 1, options: [{ v: 1, label: '弹性' }, { v: 0.5, label: '一般' }, { v: 0, label: '完全非弹性' }] },
  ],
  build: (p) => {
    const C = planCo(p), cy = 0.47, ch = 0.05;
    return mkScene('collision', '碰撞', p, C.ppm, C.T, [
      ob('ground', 'ground', 0.5, cy + 0.002, 0.98, 0.004, 0, { mu: 0, e: 0 }),
      ob('A', 'cart', C.xA, cy - ch / 2 - 0.0002, C.cw, ch, 0, { m: p.m1, vx: p.v1, e: p.e, mu: 0 }, 'A'),
      ob('B', 'cart', C.xB, cy - ch / 2 - 0.0002, C.cw, ch, 0, { m: p.m2, vx: p.v2, e: p.e, mu: 0 }, 'B'),
    ], ['vt', 'momentum']);
  },
  events: ['collide'],
  overlays: { v: true, f: false, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  graphs: (p) => [
    {
      kind: 'line', title: 'v–t 图像', ylab: 'v/(m·s⁻¹)', unit: 'm/s',
      series: [
        { label: 'A', color: 'blue', f: (r, fr) => fb(r, fr, 'A').vx },
        { label: 'B', color: 'red', f: (r, fr) => fb(r, fr, 'B').vx },
      ],
    },
    {
      kind: 'bars', title: '动量 p/(kg·m·s⁻¹)', unit: 'kg·m/s', signed: true,
      series: [
        { label: 'p_A', color: 'blue', f: (r, fr) => p.m1 * fb(r, fr, 'A').vx },
        { label: 'p_B', color: 'red', f: (r, fr) => p.m2 * fb(r, fr, 'B').vx },
        { label: 'p_总', color: 'ink', f: (r, fr) => p.m1 * fb(r, fr, 'A').vx + p.m2 * fb(r, fr, 'B').vx },
      ],
    },
  ],
  readouts: (r, t, p) => {
    const a = st(r, 'A', t), b = st(r, 'B', t);
    if (!a || !b) return [];
    const P0 = p.m1 * p.v1 + p.m2 * p.v2, E0 = 0.5 * p.m1 * p.v1 ** 2 + 0.5 * p.m2 * p.v2 ** 2;
    const Pn = p.m1 * a.vx + p.m2 * b.vx, En = 0.5 * p.m1 * a.vx ** 2 + 0.5 * p.m2 * b.vx ** 2;
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_A', val: fmt(a.vx), unit: 'm/s', color: 'blue' },
      { sym: 'v_B', val: fmt(b.vx), unit: 'm/s', color: 'red' },
      { sym: 'p_总', val: fmt(Pn), unit: 'kg·m/s' },
      { sym: 'E_k总', val: fmt(En), unit: 'J' },
      { sym: 'ΔE_k', val: fmt(En - E0), unit: 'J', color: 'orange' },
      { sym: 'Δp/p', val: fmt((100 * (Pn - P0)) / (Math.abs(P0) || 1), 2), unit: '%' },
    ];
  },
  formulas: (p) => {
    const C = planCo(p);
    if (!C.meets) return [{ tex: `v_1\\le v_2\\Rightarrow\\text{A 追不上 B，不会相碰}` }];
    const E0 = 0.5 * p.m1 * p.v1 ** 2 + 0.5 * p.m2 * p.v2 ** 2, E1 = 0.5 * p.m1 * C.v1p ** 2 + 0.5 * p.m2 * C.v2p ** 2;
    return [
      { tex: `m_1v_1+m_2v_2=m_1v_1'+m_2v_2'`, note: '动量守恒' },
      { tex: `v_2'-v_1'=e\\,(v_1-v_2),\\quad e=${kn(p.e)}`, note: p.e === 1 ? '弹性碰撞：动能也守恒' : p.e === 0 ? '完全非弹性：碰后共速' : '' },
      { tex: `v_1'=${kn(C.v1p)}${U('m/s')},\\quad v_2'=${kn(C.v2p)}${U('m/s')}` },
      { tex: `\\Delta E_k=${kn(E1 - E0)}${U('J')}` },
    ];
  },
};

// ═════════════ 6. 反冲（弹簧弹开两车）═════════════
const planRc = memo((p: P) => {
  const Ep = 0.5 * p.k * p.dx * p.dx;
  const v1 = Math.sqrt((2 * Ep * p.m2) / (p.m1 * (p.m1 + p.m2))), v2 = (p.m1 * v1) / p.m2;
  const mu = (p.m1 * p.m2) / (p.m1 + p.m2), tq = (Math.PI / 2) * Math.sqrt(mu / p.k);
  const after = 1.6;
  const d1 = v1 * after + (p.dx * p.m2) / (p.m1 + p.m2), d2 = v2 * after + (p.dx * p.m1) / (p.m1 + p.m2);
  const ppm = clampN(0.33 / Math.max(d1, d2, 0.1), 0.02, 1.5);
  return { Ep, v1, v2, tq, ppm, T: tq + after };
});
export const recoil: Preset = {
  id: 'recoil', title: '反冲 · 弹簧弹开两车', group: '力学',
  summary: '压缩的弹簧夹在两车之间，烧断细线后两车被弹开：系统总动量始终为零，v₁ : v₂ = m₂ : m₁，弹性势能全部变成动能。',
  params: [
    { key: 'm1', label: 'A 车质量 m₁', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 1 },
    { key: 'm2', label: 'B 车质量 m₂', unit: 'kg', min: 0.5, max: 5, step: 0.5, def: 2 },
    { key: 'k', label: '劲度系数 k', unit: 'N/m', min: 50, max: 1000, step: 50, def: 400 },
    { key: 'dx', label: '压缩量 Δx', unit: 'm', min: 0.05, max: 0.3, step: 0.01, def: 0.15 },
  ],
  build: (p) => {
    const R = planRc(p), cy = 0.46, cw = 0.08, ch = 0.05, gapP = 0.05;
    const L0 = p.dx + gapP / R.ppm;
    const yc = cy - ch / 2 - 0.0002;
    return mkScene('recoil', '反冲 · 弹簧弹开两车', p, R.ppm, R.T, [
      ob('ground', 'ground', 0.5, cy + 0.002, 0.98, 0.004, 0, { mu: 0 }),
      ob('A', 'cart', 0.5 - gapP / 2 - cw / 2, yc, cw, ch, 0, { m: p.m1, mu: 0 }, 'A'),
      ob('B', 'cart', 0.5 + gapP / 2 + cw / 2, yc, cw, ch, 0, { m: p.m2, mu: 0 }, 'B'),
      ob('S', 'spring', 0.5, yc - ch * 0.12, gapP, 0.022, 0, { k: p.k, L0, a: 'A', b: 'B', attached: false }),
    ], ['vt', 'momentum']);
  },
  events: ['release'],
  overlays: { v: true, f: false, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  graphs: (p) => [
    { kind: 'line', title: 'v–t 图像（向右为正）', ylab: 'v/(m·s⁻¹)', unit: 'm/s', series: [
      { label: 'A', color: 'blue', f: (r, fr) => fb(r, fr, 'A').vx },
      { label: 'B', color: 'red', f: (r, fr) => fb(r, fr, 'B').vx },
    ] },
    { kind: 'bars', title: '动量 p/(kg·m·s⁻¹)', unit: 'kg·m/s', signed: true, series: [
      { label: 'p_A', color: 'blue', f: (r, fr) => p.m1 * fb(r, fr, 'A').vx },
      { label: 'p_B', color: 'red', f: (r, fr) => p.m2 * fb(r, fr, 'B').vx },
      { label: 'p_总', color: 'ink', f: (r, fr) => p.m1 * fb(r, fr, 'A').vx + p.m2 * fb(r, fr, 'B').vx },
    ] },
  ],
  readouts: (r, t, p) => {
    const a = st(r, 'A', t), b = st(r, 'B', t), fr = r.frame(t);
    if (!a || !b) return [];
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_A', val: fmt(a.vx), unit: 'm/s', color: 'blue' },
      { sym: 'v_B', val: fmt(b.vx), unit: 'm/s', color: 'red' },
      { sym: 'p_总', val: fmt(p.m1 * a.vx + p.m2 * b.vx), unit: 'kg·m/s' },
      { sym: 'E_p弹', val: fmt(fr.es), unit: 'J', color: 'orange' },
      { sym: 'E_k', val: fmt(fr.ek), unit: 'J' },
    ];
  },
  formulas: (p) => {
    const R = planRc(p);
    return [
      { tex: `0=m_1v_1-m_2v_2`, note: '系统初动量为零，弹开后总动量仍为零' },
      { tex: `E_p=\\tfrac12k\\Delta x^2=${kn(R.Ep)}${U('J')}=\\tfrac12m_1v_1^2+\\tfrac12m_2v_2^2` },
      { tex: `v_1=\\sqrt{\\dfrac{2E_pm_2}{m_1(m_1+m_2)}}=${kn(R.v1)}${U('m/s')},\\ v_2=${kn(R.v2)}${U('m/s')}` },
      { tex: `v_1:v_2=m_2:m_1=${kn(p.m2)}:${kn(p.m1)}` },
    ];
  },
};

// ═════════════ 7. 人船模型 ═════════════
const geoPb = (p: P) => {
  const ppm = 0.4 / p.L, pw = 0.03, ph = 0.09, bh = 0.045, wy = 0.43;
  return { ppm, pw, ph, bh, wy, blen: p.L * ppm + pw, bx: 0.5 };
};
export const personBoat: Preset = {
  id: 'person-boat', title: '反冲 · 人船模型', group: '力学',
  summary: '人从静止小船的一端走到另一端（不计水的阻力）：人与船动量之和始终为零，m·x人 = M·x船，x人 + x船 = L。',
  params: [
    { key: 'm', label: '人的质量 m', unit: 'kg', min: 20, max: 120, step: 5, def: 50 },
    { key: 'M', label: '船的质量 M', unit: 'kg', min: 30, max: 300, step: 10, def: 100 },
    { key: 'L', label: '船长 L', unit: 'm', min: 1, max: 6, step: 0.5, def: 3 },
    { key: 'u', label: '人相对船的速度 u', unit: 'm/s', min: 0.5, max: 3, step: 0.1, def: 1 },
  ],
  build: (p) => {
    const G = geoPb(p);
    const by = G.wy - G.bh / 2 - 0.0002;
    const left = G.bx - G.blen / 2;
    return mkScene('person-boat', '反冲 · 人船模型', p, G.ppm, p.L / p.u + 1.0, [
      ob('water', 'ground', 0.5, G.wy + 0.002, 0.98, 0.004, 0, { mu: 0, water: true }),
      ob('B', 'boat', G.bx, by, G.blen, G.bh, 0, { m: p.M, mu: 0 }, 'M'),
      ob('A', 'person', left + G.pw / 2, by - G.bh / 2 - G.ph / 2 - 0.0005, G.pw, G.ph, 0, { m: p.m, walkOn: 'B', walkL: p.L, walk: p.u }, 'm'),
    ], ['vt', 'momentum']);
  },
  events: [],
  overlays: { v: true, f: false, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  graphs: (p) => [
    { kind: 'line', title: 'v–t 图像（向右为正）', ylab: 'v/(m·s⁻¹)', unit: 'm/s', series: [
      { label: '人', color: 'blue', f: (r, fr) => fb(r, fr, 'A').vx },
      { label: '船', color: 'red', f: (r, fr) => fb(r, fr, 'B').vx },
    ] },
    { kind: 'bars', title: '动量 p/(kg·m·s⁻¹)', unit: 'kg·m/s', signed: true, series: [
      { label: 'p_人', color: 'blue', f: (r, fr) => p.m * fb(r, fr, 'A').vx },
      { label: 'p_船', color: 'red', f: (r, fr) => p.M * fb(r, fr, 'B').vx },
      { label: 'p_总', color: 'ink', f: (r, fr) => p.m * fb(r, fr, 'A').vx + p.M * fb(r, fr, 'B').vx },
    ] },
  ],
  readouts: (r, t, p) => {
    const a = st(r, 'A', t), b = st(r, 'B', t), a0 = st0(r, 'A'), b0 = st0(r, 'B');
    if (!a || !b || !a0 || !b0) return [];
    const xa = a.x - a0.x, xb = b.x - b0.x;
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v_人', val: fmt(a.vx), unit: 'm/s', color: 'blue' },
      { sym: 'v_船', val: fmt(b.vx), unit: 'm/s', color: 'red' },
      { sym: 'x_人', val: fmt(xa), unit: 'm', color: 'blue' },
      { sym: 'x_船', val: fmt(xb), unit: 'm', color: 'red' },
      { sym: 'mx_人+Mx_船', val: fmt(p.m * xa + p.M * xb), unit: 'kg·m' },
    ];
  },
  formulas: (p) => [
    { tex: `mv_{人}=Mv_{船}\\ \\Rightarrow\\ mx_{人}=Mx_{船}`, note: '任一时刻动量和为零，位移也成反比' },
    { tex: `x_{人}+x_{船}=L` },
    { tex: `x_{船}=\\dfrac{m}{m+M}L=${kn((p.m * p.L) / (p.m + p.M))}${U('m')},\\quad x_{人}=${kn((p.M * p.L) / (p.m + p.M))}${U('m')}` },
  ],
  decorate: (d, r, t, p) => {
    const a = st(r, 'A', t), b = st(r, 'B', t), a0 = st0(r, 'A'), b0 = st0(r, 'B');
    if (!a || !b || !a0 || !b0) return;
    const G = geoPb(p), k = r.ppm;
    const yP = a.y * k - G.ph / 2 - 0.03, yB = G.wy + 0.045;
    if (Math.abs(a.x - a0.x) * k > 0.01) dim(d, a0.x * k, yP, a.x * k, yP, `x人=${fmt(a.x - a0.x)} m`, d.color('blue'), 0.018);
    const l0 = b0.x * k - G.blen / 2, l1 = b.x * k - G.blen / 2;
    line(d.ctx, [l0, G.wy - G.bh, l0, yB + 0.01], alpha(d.color('red'), 0.6), LW.thin, [0.003, 0.003]);
    if (Math.abs(l1 - l0) > 0.008) dim(d, l0, yB, l1, yB, `x船=${fmt(Math.abs(b.x - b0.x))} m`, d.color('red'), 0.018);
  },
};

// ═════════════ 8. 平抛 ═════════════
const geoPj = (p: P) => {
  const g = g_(p), tf = Math.sqrt((2 * p.h) / g), X = p.v0 * tf;
  const ppm = Math.min(0.34 / p.h, 0.55 / X);
  const gy = 0.52, tx0 = 0.24, tw = 0.09, r = 0.012;
  return { tf, X, ppm, gy, tx0, tw, r, ty: gy - p.h * ppm };
};
export const projectile: Preset = {
  id: 'projectile', title: '平抛运动', group: '力学',
  summary: '小球从高 h 处以 v₀ 水平抛出：水平方向匀速、竖直方向自由落体；频闪照片里水平间距相等，竖直间距 1:3:5…',
  params: [
    { key: 'h', label: '抛出点高度 h', unit: 'm', min: 1, max: 45, step: 1, def: 20 },
    { key: 'v0', label: '初速度 v₀', unit: 'm/s', min: 1, max: 30, step: 1, def: 10 },
    { key: 'dt', label: '频闪间隔 Δt', unit: 's', min: 0.05, max: 0.5, step: 0.05, def: 0.2, options: [{ v: 0.1, label: '0.1 s' }, { v: 0.2, label: '0.2 s' }, { v: 0.25, label: '0.25 s' }] },
  ],
  build: (p) => {
    const G = geoPj(p);
    return mkScene('projectile', '平抛运动', p, G.ppm, G.tf + 0.4, [
      ob('ground', 'ground', 0.5, G.gy + 0.002, 0.98, 0.004, 0, { mu: 1, e: 0 }),
      ob('table', 'wall', G.tx0 + G.tw / 2, (G.ty + G.gy) / 2, G.tw, G.gy - G.ty, 0, { e: 0 }),
      ob('A', 'ball', G.tx0 + G.tw + G.r + 0.0015, G.ty - G.r, G.r * 2, G.r * 2, 0, { m: 1, vx: p.v0, e: 0, mu: 1 }),
    ], ['vt']);
  },
  events: ['land'],
  overlays: { v: true, f: false, trail: true, graph: true, formula: true },
  strobe: (p) => p.dt,
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  graphs: () => [{ kind: 'line', title: '速度分量 v–t', ylab: 'v/(m·s⁻¹)', unit: 'm/s', series: [
    { label: 'v_x', color: 'blue', f: (r, fr) => fb(r, fr, 'A').vx },
    { label: 'v_y', color: 'red', f: (r, fr) => fb(r, fr, 'A').vy },
  ] }],
  readouts: (r, t, p) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const G = geoPj(p), air = t <= G.tf + 0.002;
    return [
      { sym: 't', val: fmt(Math.min(t, G.tf)), unit: 's' },
      { sym: 'x', val: fmt(air ? s.x - s0.x : G.X), unit: 'm' },
      { sym: 'y', val: fmt(Math.min(p.h, s.y - s0.y)), unit: 'm' },
      { sym: 'v_x', val: fmt(air ? s.vx : p.v0), unit: 'm/s', color: 'blue' },
      { sym: 'v_y', val: fmt(air ? s.vy : g_(p) * G.tf), unit: 'm/s', color: 'red' },
      { sym: 'v', val: fmt(air ? Math.hypot(s.vx, s.vy) : Math.hypot(p.v0, g_(p) * G.tf)), unit: 'm/s', color: 'ai' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), G = geoPj(p), vy = g * G.tf;
    return [
      { tex: `h=\\tfrac12gt^2\\Rightarrow t=\\sqrt{\\dfrac{2h}{g}}=${kn(G.tf)}${U('s')}` },
      { tex: `x=v_0t=${kn(G.X)}${U('m')}` },
      { tex: `v_y=gt=${kn(vy)}${U('m/s')},\\ v=\\sqrt{v_0^2+v_y^2}=${kn(Math.hypot(p.v0, vy))}${U('m/s')}` },
      { tex: `\\tan\\alpha=\\dfrac{v_y}{v_0}=${kn(vy / p.v0)}` },
    ];
  },
  decorate: (d, r, t, p, x) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return;
    const G = geoPj(p), k = r.ppm;
    // 频闪投影
    if (x.ov.trail) {
      const col = alpha(d.color('ink'), 0.4);
      const ex = G.tx0 + G.tw;
      for (let tt = 0; tt <= Math.min(t, G.tf) + 1e-9; tt += p.dt) {
        const q = st(r, 'A', tt)!;
        const px = q.x * k, py = q.y * k;
        line(d.ctx, [px, py, px, G.gy], col, LW.thin * 0.8, [0.002, 0.004]);
        line(d.ctx, [px, py, ex, py], col, LW.thin * 0.8, [0.002, 0.004]);
        dot(d.ctx, px, G.gy, 0.003, d.color('blue'));
        dot(d.ctx, ex, py, 0.003, d.color('red'));
      }
    }
    // 速度分解
    if (x.ov.v && t < G.tf) {
      const cx = s.x * k, cy = s.y * k;
      arrow(d.ctx, cx, cy, cx + s.vx * x.vs, cy, alpha(d.color('blue'), 0.8), LW.line, 0.011);
      arrow(d.ctx, cx, cy, cx, cy + s.vy * x.vs, alpha(d.color('red'), 0.8), LW.line, 0.011);
      line(d.ctx, [cx + s.vx * x.vs, cy, cx + s.vx * x.vs, cy + s.vy * x.vs, cx, cy + s.vy * x.vs], alpha(d.color('ink'), 0.35), LW.thin, [0.003, 0.003]);
      drawSym(d.ctx, 'v_x', cx + s.vx * x.vs + 0.018, cy - 0.004, 0.016, d.color('blue'), 'center', d.paper);
      if (s.vy * x.vs > 0.02) drawSym(d.ctx, 'v_y', cx - 0.02, cy + s.vy * x.vs, 0.016, d.color('red'), 'center', d.paper);
    }
    // h 与 x 的尺寸
    const ink = alpha(d.color('ink'), 0.7);
    dim(d, G.tx0 - 0.03, G.ty, G.tx0 - 0.03, G.gy, `h=${fmt(p.h, 0)} m`, ink, 0.018);
    if (t >= G.tf) dim(d, s0.x * k, G.gy + 0.028, s0.x * k + G.X * k, G.gy + 0.028, `x=${fmt(G.X)} m`, ink, 0.018);
  },
};

// ═════════════ 9. 竖直平面圆周运动 ═════════════
const planCv = memo((p: P) => {
  const g = g_(p), R = p.R, mode = p.mode;
  const vTop2 = p.v0 * p.v0 - 4 * g * R;
  const crit = mode === 2 ? 2 * Math.sqrt(g * R) : Math.sqrt(5 * g * R);
  const ok = mode === 2 ? vTop2 > 0 : vTop2 >= g * R - 1e-9;
  // 一圈时间（数值积分 dφ·R/v）
  let Trev = NaN;
  if (ok) {
    let s = 0; const N = 2000;
    for (let i = 0; i < N; i++) { const ph = ((i + 0.5) / N) * 2 * Math.PI; s += ((2 * Math.PI) / N) * R / Math.sqrt(p.v0 * p.v0 - 2 * g * R * (1 - Math.cos(ph))); }
    Trev = s;
  }
  return { vTop: Math.sqrt(Math.max(0, vTop2)), crit, ok, Trev, vMin: Math.sqrt(g * R) };
});
const RC = 0.16;
const geoCv = (p: P) => ({ ppm: RC / p.R, cx: 0.44, cy: 0.27, rb: 0.018 });
export const circleVertical: Preset = {
  id: 'circle-vertical', title: '竖直平面圆周运动', group: '力学',
  summary: '小球在竖直平面内做圆周运动：绳模型/内轨道模型在最高点的临界速度 √(gR)，最低点至少需要 √(5gR)；杆模型最高点速度可为零。',
  params: [
    { key: 'mode', label: '模型', min: 0, max: 2, step: 1, def: 0, options: [{ v: 0, label: '绳' }, { v: 1, label: '内轨道' }, { v: 2, label: '轻杆' }] },
    { key: 'R', label: '半径 R', unit: 'm', min: 0.2, max: 1.5, step: 0.05, def: 0.4 },
    { key: 'v0', label: '最低点速度 v₀', unit: 'm/s', min: 1, max: 9, step: 0.05, def: 4.5 },
    { key: 'm', label: '小球质量 m', unit: 'kg', min: 0.1, max: 2, step: 0.1, def: 0.5 },
  ],
  build: (p) => {
    const G = geoCv(p), plan = planCv(p);
    const dur = plan.ok ? Math.min(12, plan.Trev * 2 + 0.15) : 3.2;
    const by = G.cy + RC;
    const objs = [ob('A', 'ball', G.cx, by, G.rb * 2, G.rb * 2, 0, { m: p.m, vx: p.v0, mu: 0, e: 0 })];
    if (p.mode === 1) objs.push(ob('track', 'track-circle', G.cx, G.cy, 2 * (RC + G.rb), 2 * (RC + G.rb), 0, { mu: 0, e: 0 }));
    else {
      objs.push(ob('O', 'hinge', G.cx, G.cy, 0.012, 0.012));
      objs.push(ob('rope', p.mode === 2 ? 'rod' : 'rope', G.cx, G.cy + RC / 2, RC, 0.004, Math.PI / 2, { a: 'O', b: 'A', L: p.R }));
    }
    const sc = mkScene('circle-vertical', '竖直平面圆周运动', p, G.ppm, dur, objs, ['vt', 'energy']);
    sc.params = { ...sc.params, substeps: 32 };      // 1/7680 s：绳 / 轨道约束的速度投影每步耗散 ∝ Δθ²，细分后最高点速度误差 ≈ 0.5%
    return sc;
  },
  events: ['apex', 'slack', 'leave'],
  overlays: { v: true, f: true, trail: true, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'br' },
  graphs: () => [
    { kind: 'line', title: '速率 v–t', ylab: 'v/(m·s⁻¹)', unit: 'm/s', series: [{ label: 'v', color: 'blue', f: (r, fr) => Math.hypot(fb(r, fr, 'A').vx, fb(r, fr, 'A').vy) }] },
    { kind: 'bars', title: '能量 E/J', unit: 'J', series: [
      { label: 'E_k', color: 'blue', f: (_r, fr) => fr.ek },
      { label: 'E_p', color: 'green', f: (_r, fr) => fr.ep },
      { label: 'E', color: 'ink', f: (_r, fr) => fr.ek + fr.ep },
    ] },
  ],
  readouts: (r, t, p) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const plan = planCv(p);
    const T = p.mode === 1 ? force(s, 'N').m : r.conns[0] ? r.conn(0, t).force : 0;
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v', val: fmt(Math.hypot(s.vx, s.vy)), unit: 'm/s', color: 'blue' },
      { sym: 'h', val: fmt(s0.y - s.y), unit: 'm' },
      { sym: p.mode === 1 ? 'F_N' : p.mode === 2 ? 'F_杆' : 'T', val: fmt(T), unit: 'N', color: p.mode === 1 ? 'blue' : 'violet' },
      { sym: 'v_顶', val: plan.ok ? fmt(plan.vTop) : '到不了', unit: plan.ok ? 'm/s' : '' },
      { sym: '√(gR)', val: fmt(plan.vMin), unit: 'm/s', color: 'orange' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), plan = planCv(p);
    if (p.mode === 2) return [
      { tex: `\\text{杆能提供支持力：最高点 }v\\ge 0\\text{ 即可}` },
      { tex: `\\tfrac12mv_0^2=\\tfrac12mv^2+mg\\cdot2R\\Rightarrow v_{顶}=\\sqrt{v_0^2-4gR}=${plan.ok ? kn(plan.vTop) : '\\text{无解}'}${U('m/s')}` },
      { tex: `v_0\\ge2\\sqrt{gR}=${kn(plan.crit)}${U('m/s')}`, note: plan.ok ? '能过最高点' : '到不了最高点' },
    ];
    return [
      { tex: `\\text{最高点临界：}mg=m\\dfrac{v^2}{R}\\Rightarrow v_{min}=\\sqrt{gR}=${kn(plan.vMin)}${U('m/s')}` },
      { tex: `\\tfrac12mv_0^2=\\tfrac12mv_{顶}^2+mg\\cdot2R\\Rightarrow v_{顶}=${plan.ok ? kn(plan.vTop) + U('m/s') : '<\\sqrt{gR}'}` },
      { tex: `v_0\\ge\\sqrt{5gR}=${kn(plan.crit)}${U('m/s')}`, note: plan.ok ? `v₀ = ${fmt(p.v0)} m/s ≥ ${fmt(plan.crit)}，能通过最高点` : `v₀ = ${fmt(p.v0)} m/s < ${fmt(plan.crit)}，${p.mode === 0 ? '绳子会松弛' : '会脱离轨道'}` },
      ...(plan.ok ? [{ tex: `${p.mode === 0 ? 'T' : 'F_N'}_{顶}=m\\dfrac{v_{顶}^2}{R}-mg=${kn(p.m * (plan.vTop ** 2 / p.R - g))}${U('N')}` }] : []),
    ];
  },
  decorate: (d, _r, _t, p) => {
    const G = geoCv(p), ink = alpha(d.color('ink'), 0.55);
    if (p.mode !== 1) {
      d.ctx.save(); d.ctx.strokeStyle = ink; d.ctx.lineWidth = LW.thin; d.ctx.setLineDash(DASH);
      d.ctx.beginPath(); d.ctx.arc(G.cx, G.cy, RC, 0, Math.PI * 2); d.ctx.stroke(); d.ctx.restore();
    }
    dot(d.ctx, G.cx, G.cy, 0.004, d.color('ink'));
    drawSym(d.ctx, 'O', G.cx - 0.016, G.cy - 0.012, 0.016, d.color('ink'), 'center', d.paper);
    dim(d, G.cx, G.cy, G.cx + RC, G.cy, `R=${fmt(p.R)} m`, ink, 0.018, -0.012);
  },
};

// ═════════════ 10. 弹簧振子 ═════════════
const geoSp = (p: P) => {
  const ppm = 1.2, gy = 0.47, bw = 0.08, bh = 0.06, xe = 0.5, wallX = 0.1, wallW = 0.02;
  const face = wallX + wallW / 2;
  return { ppm, gy, bw, bh, xe, wallX, wallW, face, L0: (xe - bw / 2 - face) / ppm };
};
export const springOsc: Preset = {
  id: 'spring', title: '弹簧振子', group: '力学',
  summary: '光滑水平面上的弹簧振子：回复力 F = −kx，周期 T = 2π√(m/k) 与振幅无关；动能与弹性势能相互转化，总机械能不变。',
  params: [
    { key: 'm', label: '振子质量 m', unit: 'kg', min: 0.2, max: 5, step: 0.1, def: 1 },
    { key: 'k', label: '劲度系数 k', unit: 'N/m', min: 10, max: 500, step: 10, def: 100 },
    { key: 'A', label: '振幅 A', unit: 'm', min: 0.02, max: 0.2, step: 0.01, def: 0.1 },
  ],
  build: (p) => {
    const G = geoSp(p), T = 2 * Math.PI * Math.sqrt(p.m / p.k);
    const bx = G.xe + p.A * G.ppm, by = G.gy - G.bh / 2 - 0.0002;
    return withSub(8, mkScene('spring', '弹簧振子', p, G.ppm, Math.max(3, Math.min(12, 3 * T + 0.02)), [
      ob('ground', 'ground', 0.5, G.gy + 0.002, 0.9, 0.004, 0, { mu: 0 }),
      ob('wall', 'wall', G.wallX, G.gy - 0.075, G.wallW, 0.15, 0),
      ob('A', 'block', bx, by, G.bw, G.bh, 0, { m: p.m, mu: 0 }, 'm'),
      ob('S', 'spring', (G.face + bx - G.bw / 2) / 2, by, bx - G.bw / 2 - G.face, 0.03, 0, { k: p.k, L0: G.L0, a: 'wall', b: 'A' }),
    ], ['xt', 'energy']));
  },
  events: [],
  overlays: { v: true, f: true, trail: false, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tc' },
  graphs: (p) => {
    const xe = geoSp(p).xe / 1.2;
    return [
      { kind: 'line', title: 'x–t 图像', ylab: 'x/m', unit: 'm', series: [{ label: 'x', color: 'blue', f: (r, fr) => fb(r, fr, 'A').x - xe }] },
      { kind: 'bars', title: '能量 E/J', unit: 'J', series: [
        { label: 'E_k', color: 'blue', f: (_r, fr) => fr.ek },
        { label: 'E_p弹', color: 'orange', f: (_r, fr) => fr.es },
        { label: 'E', color: 'ink', f: (_r, fr) => fr.ek + fr.es },
      ] },
    ];
  },
  readouts: (r, t, p) => {
    const s = st(r, 'A', t);
    if (!s) return [];
    const G = geoSp(p), x = s.x - G.xe / G.ppm;
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'x', val: fmt(x, 3), unit: 'm' },
      { sym: 'v', val: fmt(s.vx), unit: 'm/s', color: 'ai' },
      { sym: 'F_弹', val: fmt(-p.k * x), unit: 'N', color: 'orange' },
      { sym: 'a', val: fmt((-p.k * x) / p.m), unit: 'm/s²' },
      { sym: 'T', val: fmt(2 * Math.PI * Math.sqrt(p.m / p.k), 3), unit: 's' },
    ];
  },
  formulas: (p) => {
    const T = 2 * Math.PI * Math.sqrt(p.m / p.k), w = Math.sqrt(p.k / p.m);
    return [
      { tex: `F=-kx,\\quad a=-\\dfrac{k}{m}x` },
      { tex: `T=2\\pi\\sqrt{\\dfrac{m}{k}}=${kn(T, 3)}${U('s')}`, note: '与振幅无关' },
      { tex: `v_{max}=A\\omega=A\\sqrt{\\dfrac{k}{m}}=${kn(p.A * w)}${U('m/s')}` },
      { tex: `E=\\tfrac12kA^2=${kn(0.5 * p.k * p.A * p.A, 3)}${U('J')}` },
    ];
  },
  decorate: (d, _r, _t, p) => {
    const G = geoSp(p), ink = alpha(d.color('ink'), 0.6), y0 = G.gy - G.bh - 0.04, y1 = G.gy + 0.02;
    line(d.ctx, [G.xe, y0, G.xe, y1], ink, LW.thin, DASH);
    drawSym(d.ctx, 'O', G.xe, y1 + 0.016, 0.016, d.color('ink'), 'center', d.paper);
    for (const s of [-1, 1]) {
      const x = G.xe + s * p.A * G.ppm;
      line(d.ctx, [x, G.gy, x, G.gy + 0.012], ink, LW.thin);
      drawSym(d.ctx, s > 0 ? 'A' : '−A', x, G.gy + 0.028, 0.015, d.color('ink'), 'center', d.paper);
    }
  },
};

// ═════════════ 11. 单摆 ═════════════
const geoPd = (p: P) => ({ ppm: 0.34 / p.L, px: 0.5, py: 0.08, rb: 0.018 });
export const pendulum: Preset = {
  id: 'pendulum', title: '单摆', group: '力学',
  summary: '摆角很小时单摆做简谐运动，周期 T = 2π√(L/g) 与摆球质量、振幅无关；摆角大时周期略变长。',
  params: [
    { key: 'L', label: '摆长 L', unit: 'm', min: 0.3, max: 2.5, step: 0.1, def: 1 },
    { key: 'th', label: '摆角 θ₀', unit: '°', min: 2, max: 60, step: 1, def: 10 },
    { key: 'm', label: '摆球质量 m', unit: 'kg', min: 0.05, max: 1, step: 0.05, def: 0.2 },
  ],
  build: (p) => {
    const G = geoPd(p), th = (p.th * Math.PI) / 180, T = 2 * Math.PI * Math.sqrt(p.L / g_(p));
    const bx = G.px - Math.sin(th) * p.L * G.ppm, by = G.py + Math.cos(th) * p.L * G.ppm;
    return mkScene('pendulum', '单摆', p, G.ppm, Math.min(12, 3 * T + 0.02), [
      ob('ceil', 'ceiling', G.px, G.py - 0.002, 0.16, 0.004),
      ob('O', 'hinge', G.px, G.py, 0.01, 0.01),
      ob('A', 'ball', bx, by, G.rb * 2, G.rb * 2, 0, { m: p.m }),
      ob('rope', 'rope', (G.px + bx) / 2, (G.py + by) / 2, p.L * G.ppm, 0.004, Math.atan2(by - G.py, bx - G.px), { a: 'O', b: 'A', L: p.L }),
    ], ['xt', 'energy']);
  },
  events: [],
  overlays: { v: true, f: true, trail: true, graph: true, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'bl' },
  graphs: (p) => {
    const px = geoPd(p).px / geoPd(p).ppm;
    return [
      { kind: 'line', title: '水平位移 x–t', ylab: 'x/m', unit: 'm', series: [{ label: 'x', color: 'blue', f: (r, fr) => fb(r, fr, 'A').x - px }] },
      { kind: 'bars', title: '能量 E/J', unit: 'J', series: [
        { label: 'E_k', color: 'blue', f: (_r, fr) => fr.ek },
        { label: 'E_p', color: 'green', f: (r, fr) => fr.ep + epLow(r, p) },
        { label: 'E', color: 'ink', f: (r, fr) => fr.ek + fr.ep + epLow(r, p) },
      ] },
    ];
  },
  readouts: (r, t, p) => {
    const s = st(r, 'A', t);
    if (!s) return [];
    const G = geoPd(p), ang = Math.atan2(s.x - G.px / G.ppm, s.y - G.py / G.ppm);
    const T = 2 * Math.PI * Math.sqrt(p.L / g_(p));
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'θ', val: fmt((ang * 180) / Math.PI, 1), unit: '°' },
      { sym: 'v', val: fmt(Math.hypot(s.vx, s.vy)), unit: 'm/s', color: 'ai' },
      { sym: 'T_绳', val: fmt(r.conns[0] ? r.conn(0, t).force : 0), unit: 'N', color: 'violet' },
      { sym: 'T', val: fmt(T, 3), unit: 's' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), T = 2 * Math.PI * Math.sqrt(p.L / g), th = (p.th * Math.PI) / 180;
    const vb = Math.sqrt(2 * g * p.L * (1 - Math.cos(th)));
    return [
      { tex: `T=2\\pi\\sqrt{\\dfrac{L}{g}}=${kn(T, 3)}${U('s')}`, note: p.th <= 5 ? '小角度：简谐运动' : `θ₀ = ${p.th}°：实际周期略大于公式值` },
      { tex: `v_{最低}=\\sqrt{2gL(1-\\cos\\theta_0)}=${kn(vb)}${U('m/s')}` },
      { tex: `T_{绳}=mg+m\\dfrac{v^2}{L}=${kn(p.m * g + (p.m * vb * vb) / p.L, 3)}${U('N')}\\ (\\text{最低点})` },
    ];
  },
  decorate: (d, r, t, p) => {
    const G = geoPd(p), s = st(r, 'A', t), ink = alpha(d.color('ink'), 0.55);
    const Lp = p.L * G.ppm;
    line(d.ctx, [G.px, G.py, G.px, G.py + Lp * 1.08], ink, LW.thin, DASH);
    const th = (p.th * Math.PI) / 180;
    d.ctx.save(); d.ctx.strokeStyle = alpha(d.color('ink'), 0.3); d.ctx.lineWidth = LW.thin; d.ctx.setLineDash([0.003, 0.004]);
    d.ctx.beginPath(); d.ctx.arc(G.px, G.py, Lp, Math.PI / 2 - th, Math.PI / 2 + th); d.ctx.stroke(); d.ctx.restore();
    if (s) {
      const a = Math.atan2(s.y * r.ppm - G.py, s.x * r.ppm - G.px);
      if (Math.abs(a - Math.PI / 2) > 0.02) angleArc(d, G.px, G.py, Math.min(0.08, Lp * 0.35), Math.PI / 2, a, 'θ', d.color('ink'), 0.016);
    }
  },
};
/** 以最低点为零势能面：E_p = ep + mg(y_低 − y₀) */
function epLow(r: { y0: number[]; bodyIndex: (id: string) => number }, p: P) {
  const G = geoPd(p), yLow = G.py / G.ppm + p.L, i = r.bodyIndex('A');
  return p.m * g_(p) * (yLow - (r.y0[i] ?? yLow));
}

// ═════════════ 12. 滑轮连接体 ═════════════
const planPu = memo((p: P) => {
  const g = g_(p);
  if (p.mode === 1) {
    const a = (Math.abs(p.mA - p.mB) * g) / (p.mA + p.mB), T = (2 * p.mA * p.mB * g) / (p.mA + p.mB);
    return { a, T, moves: p.mA !== p.mB, t: a > 0 ? Math.sqrt((2 * p.h) / a) : NaN };
  }
  const drive = p.mB * g - p.mu * p.mA * g;
  const a = drive > 0 ? drive / (p.mA + p.mB) : 0;
  return { a, T: a > 0 ? p.mB * (g - a) : p.mB * g, moves: a > 0, t: a > 0 ? Math.sqrt((2 * p.h) / a) : NaN };
});
const geoPu = (p: P) => {
  const ppm = (p.mode === 1 ? 0.15 : 0.17) / p.h, yf = 0.535;
  if (p.mode === 1) {
    const r = 0.03, cx = 0.5, cy = 0.095, bw = 0.06, bh = 0.07;
    // 重的落地后，轻的还要竖直上抛 v²/(2g) = h·a/g：起始位置给它留够空间，别撞到滑轮
    const pl = planPu(p), up = pl.moves ? p.h * (1 + pl.a / g_(p)) : 0;
    const room = yf - (cy + r) - bh - 0.025;
    const ppm1 = Math.min(ppm, room / (p.h + up));
    const y0 = yf - p.h * ppm1 - bh / 2 - 0.0005;
    return { ppm: ppm1, yf, r, cx, cy, bwA: bw, bhA: bh, bwB: bw, bhB: bh, xA: cx - r, yA: y0, xB: cx + r, yB: y0, tableTop: 0, edge: 0 };
  }
  const tableTop = 0.22, edge = 0.6, bwA = 0.08, bhA = 0.052, bwB = 0.05, bhB = 0.065, r = 0.017;
  // 桌面要放得下：B 下落 h 期间 A 滑 h，B 落地后 A 还要靠摩擦再滑 a·h/(μg)（μ=0 时匀速再走 1 s）
  const pl = planPu(p), vL = pl.moves ? pl.a * pl.t : 0;
  const run = !pl.moves ? 0 : p.mu > 0 ? (vL * vL) / (2 * p.mu * g_(p)) : vL * 1;
  const ppm0 = Math.min(ppm, 0.45 / (p.h + run + 0.12));
  const yA = tableTop - bhA / 2 - 0.0003;
  const cx = edge + r + 0.006, cy = yA + r;
  const xA = edge - 0.05 - (p.h + run) * ppm0 - bwA / 2;
  const yB = yf - p.h * ppm0 - bhB / 2 - 0.0005;
  return { ppm: ppm0, yf, r, cx, cy, bwA, bhA, bwB, bhB, xA, yA, xB: cx + r, yB, tableTop, edge };
};
export const pulley: Preset = {
  id: 'pulley', title: '滑轮连接体', group: '力学',
  summary: '轻绳跨过定滑轮连接两物体：整体法求加速度，隔离法求绳中张力。可切换「桌面+悬挂」与「两边悬挂（阿特伍德机）」。',
  params: [
    { key: 'mode', label: '装置', min: 0, max: 1, step: 1, def: 0, options: [{ v: 0, label: '桌面 + 悬挂' }, { v: 1, label: '两边悬挂' }] },
    { key: 'mA', label: 'A 的质量 m_A', unit: 'kg', min: 0.5, max: 10, step: 0.5, def: 3 },
    { key: 'mB', label: 'B 的质量 m_B', unit: 'kg', min: 0.5, max: 10, step: 0.5, def: 2 },
    { key: 'mu', label: 'A 与桌面 μ', min: 0, max: 0.8, step: 0.05, def: 0.2 },
    { key: 'h', label: '下落高度 h', unit: 'm', min: 0.3, max: 2, step: 0.1, def: 1 },
  ],
  build: (p) => {
    const G = geoPu(p), plan = planPu(p);
    const vLand = plan.a * plan.t;
    // 落地后：桌面上的 A 靠摩擦减速到停（μ=0 时匀速再看 1 s）；悬挂的另一物体竖直上抛再落回，绳重新张紧
    const after = p.mode === 1 ? Math.min(2, (2 * vLand) / g_(p)) + 0.3 : p.mu > 0 ? vLand / (p.mu * g_(p)) + 0.4 : 1;
    const dur = plan.moves ? Math.min(15, plan.t + after) : 3;
    const objs = [
      ob('floor', 'ground', p.mode === 1 ? 0.5 : 0.79, G.yf + 0.002, p.mode === 1 ? 0.5 : 0.38, 0.004, 0, { mu: 0.5, e: 0 }),
      ob('P', 'pulley', G.cx, G.cy, G.r * 2, G.r * 2),
      ob('A', 'block', G.xA, G.yA, G.bwA, G.bhA, 0, { m: p.mA, mu: p.mu }, 'A'),
      ob('B', 'block', G.xB, G.yB, G.bwB, G.bhB, 0, { m: p.mB }, 'B'),
      ob('rope', 'rope', (G.xA + G.xB) / 2, (G.yA + G.yB) / 2, 0.1, 0.004, 0, { a: 'A', b: 'B', via: 'P' }),
    ];
    if (p.mode === 1) objs.unshift(ob('ceil', 'ceiling', 0.5, 0.03, 0.22, 0.004));
    else objs.unshift(ob('table', 'ground', (0.05 + G.edge) / 2, G.tableTop + 0.002, G.edge - 0.05, 0.004, 0, { mu: p.mu }));
    return mkScene('pulley', '滑轮连接体', p, G.ppm, dur, objs, ['vt']);
  },
  events: ['land', 'slack', 'cospeed'],
  overlays: { v: true, f: true, trail: false, graph: true, formula: true },
  layout: { read: 'bl', graph: 'tr', formula: 'br' },
  focus: ['A', 'B'],
  graphs: () => [{ kind: 'line', title: 'v–t 图像', ylab: 'v/(m·s⁻¹)', unit: 'm/s', series: [
    { label: 'v', color: 'blue', f: (r, fr) => Math.hypot(fb(r, fr, 'A').vx, fb(r, fr, 'A').vy) },
  ] }],
  readouts: (r, t, p) => {
    const a = st(r, 'A', t), a0 = st0(r, 'A');
    if (!a || !a0) return [];
    const plan = planPu(p);
    const v = Math.hypot(a.vx, a.vy);
    // 落地瞬间的碰撞加速度没有意义，前后 0.02 s 内显示「—」；落地后 A 减速是真实的负加速度
    const ac = p.mode === 1 ? -acc(r, 'A', t, 0, 1) * Math.sign(p.mB - p.mA || 1) : acc(r, 'A', t, 1, 0);
    const nearLand = plan.moves && Math.abs(t - plan.t) < 0.02;
    return [
      { sym: 't', val: fmt(t), unit: 's' },
      { sym: 'v', val: fmt(v), unit: 'm/s', color: 'blue' },
      { sym: 'a', val: nearLand ? '—' : fmt(ac), unit: 'm/s²' },
      { sym: 'T', val: fmt(r.conns[0] ? r.conn(0, t).force : 0), unit: 'N', color: 'violet' },
      { sym: 's', val: fmt(Math.hypot(a.x - a0.x, a.y - a0.y)), unit: 'm' },
    ];
  },
  formulas: (p) => {
    const g = g_(p), plan = planPu(p);
    if (p.mode === 1) return [
      { tex: `(m_A-m_B)g=(m_A+m_B)a`, note: '整体法' },
      { tex: `a=\\dfrac{|m_A-m_B|}{m_A+m_B}g=${kn(plan.a)}${U('m/s^2')}` },
      { tex: `T=\\dfrac{2m_Am_Bg}{m_A+m_B}=${kn(plan.T)}${U('N')}`, note: '隔离法' },
    ];
    if (!plan.moves) return [{ tex: `m_Bg\\le\\mu m_Ag\\Rightarrow\\text{静止},\\ T=m_Bg=${kn(p.mB * g)}${U('N')}` }];
    return [
      { tex: `m_Bg-\\mu m_Ag=(m_A+m_B)a`, note: '整体法' },
      { tex: `a=${kn(plan.a)}${U('m/s^2')}` },
      { tex: `m_Bg-T=m_Ba\\Rightarrow T=${kn(plan.T)}${U('N')}`, note: '隔离 B' },
      { tex: `h=\\tfrac12at^2\\Rightarrow t=${kn(plan.t)}${U('s')},\\ v=${kn(plan.a * plan.t)}${U('m/s')}` },
    ];
  },
  decorate: (d, _r, _t, p) => {
    const G = geoPu(p), ink = d.color('ink');
    if (p.mode === 1) line(d.ctx, [G.cx, 0.032, G.cx, G.cy], ink, LW.line);
    else line(d.ctx, [G.edge, G.tableTop, G.cx, G.cy], ink, LW.line);
  },
};

export const MECH: Preset[] = [chase, beltHorizontal, beltIncline, incline, plank, collision, recoil, personBoat, projectile, circleVertical, springOsc, pendulum, pulley];
void force;
