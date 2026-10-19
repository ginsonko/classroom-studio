// ── 电磁预设：带电粒子在匀强磁场中的圆周运动、在电场中的偏转 ─────────────
// 微观粒子的时间尺度是 10⁻⁸ s 量级：用 params.timeScale 慢放（显示 1 s = ts 秒），数值全部是真实 SI 值。
import { arrow, dim, dot, line, LW, DASH, alpha } from './prim';
import { drawSym, drawText, fmt as fmt0 } from './text';
const fmt = (v: number, d = 2) => fmt0(v, d, 0);
import { kn, memo, mkScene, ob, st, st0, U, type P, type Preset } from './presetKit';

export const MP = 1.67e-27, QE = 1.6e-19, ME = 9.1e-31;

// ═════════════ 磁场中的匀速圆周运动 ═════════════
const planMg = memo((p: P) => {
  const m = p.mU * MP, q = p.qe * QE, v = p.v * 1e6;
  const R = (m * v) / (q * p.B), T = (2 * Math.PI * m) / (q * p.B);
  const R0 = (MP * 1e6) / (QE * 0.5);
  let ppm = 0.15 / R0;
  if (R * ppm < 0.05 || R * ppm > 0.2) ppm = 0.15 / R;
  const fx0 = 0.38, sx = 0.1, sy = 0.47;
  const ts = T / 2 / 3;                                   // 半圈显示 3 s
  const tIn = ((fx0 - sx) / ppm / v) / ts;
  return { m, q, v, R, T, ppm, ts, fx0, sx, sy, tIn, dur: tIn + 3 + 1.3 };
});
export const magnetic: Preset = {
  id: 'magnetic', title: '带电粒子在匀强磁场中的圆周运动', group: '电磁',
  summary: '粒子垂直射入匀强磁场：洛伦兹力提供向心力，R = mv/(qB)，T = 2πm/(qB) 与速度无关；从边界射入、转半圈后射出，射出点距入射点 2R。',
  params: [
    { key: 'mU', label: '质量 m（质子质量的倍数）', unit: '×1.67×10⁻²⁷ kg', min: 1, max: 4, step: 1, def: 1, options: [{ v: 1, label: '质子 1' }, { v: 2, label: '氘核 2' }, { v: 4, label: 'α 粒子 4' }] },
    { key: 'qe', label: '电荷量 q', unit: '×1.6×10⁻¹⁹ C', min: 1, max: 3, step: 1, def: 1 },
    { key: 'v', label: '速度 v', unit: '×10⁶ m/s', min: 0.2, max: 3, step: 0.1, def: 1 },
    { key: 'B', label: '磁感应强度 B', unit: 'T', min: 0.1, max: 2, step: 0.05, def: 0.5 },
  ],
  build: (p) => {
    const M = planMg(p);
    return {
      ...mkScene('magnetic', '带电粒子在匀强磁场中的圆周运动', p, M.ppm, M.dur, [
        ob('field', 'field-b-in', M.fx0 + 0.15, 0.285, 0.3, 0.51, 0, { B: p.B }),          // 粒子最多深入 R（≤0.2 页宽），右侧留给读数卡
        ob('A', 'charge-pos', M.sx, M.sy, 0.024, 0.024, 0, { m: M.m, q: M.q, vx: M.v }),
      ], []),
      params: { ...p, timeScale: M.ts },
    };
  },
  events: ['field'],
  overlays: { v: true, f: true, trail: true, graph: false, formula: true },
  layout: { read: 'tr', graph: 'tr', formula: 'br' },
  readouts: (r, t, p) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const M = planMg(p);
    const left = r.events.find((e) => e.kind === 'field' && e.label.startsWith('离开') && e.t <= t);
    return [
      { sym: 't', val: fmt(t * r.ts), unit: 's' },
      { sym: 'v', val: fmt(Math.hypot(s.vx, s.vy)), unit: 'm/s', color: 'ai' },
      { sym: 'R_{理论}', val: fmt(M.R, 3), unit: 'm', color: 'violet' },
      { sym: 'R_{实测}', val: left ? fmt(Math.abs(s0.y - left.y) / 2, 3) : '—', unit: left ? 'm' : '' },
      { sym: 'T', val: fmt(M.T), unit: 's' },
      { sym: 'F_洛', val: fmt(M.q * M.v * p.B), unit: 'N', color: 'orange' },
      { sym: '慢放', val: `1 s ≙ ${fmt(r.ts)} s` },
    ];
  },
  formulas: (p) => {
    const M = planMg(p);
    return [
      { tex: `qvB=m\\dfrac{v^2}{R}`, note: '洛伦兹力提供向心力' },
      { tex: `R=\\dfrac{mv}{qB}=${kn(M.R)}${U('m')}` },
      { tex: `T=\\dfrac{2\\pi m}{qB}=${kn(M.T)}${U('s')}`, note: '周期与速度无关' },
      { tex: `\\text{射出点到入射点 }2R=${kn(2 * M.R)}${U('m')},\\ t=\\tfrac{T}{2}` },
    ];
  },
  decorate: (d, r, t, p) => {
    const M = planMg(p), s = st(r, 'A', t);
    if (!s) return;
    const k = r.ppm, Rp = M.R * k, ox = M.fx0, oy = M.sy - Rp;
    const px = s.x * k, py = s.y * k;
    const inF = px >= M.fx0 - 1e-4 && t > M.tIn;
    const ink = alpha(d.color('violet'), 0.85);
    const gone = r.events.find((e) => e.kind === 'field' && e.label.startsWith('离开') && e.t <= t);
    if (inF || gone) {
      dot(d.ctx, ox, oy, 0.004, d.color('violet'));
      drawSym(d.ctx, 'O', ox - 0.016, oy, 0.016, d.color('violet'), 'center', d.paper);
    }
    if (inF && !gone) {
      line(d.ctx, [ox, oy, px, py], ink, LW.thin * 1.2, DASH);
      drawSym(d.ctx, 'R', (ox + px) / 2 + 0.01, (oy + py) / 2 - 0.012, 0.017, d.color('violet'), 'center', d.paper);
    }
    if (gone) dim(d, M.fx0 - 0.035, M.sy, M.fx0 - 0.035, gone.y * k, `2R`, d.color('violet'), 0.018);
    // 入射方向
    arrow(d.ctx, M.sx - 0.06, M.sy + 0.03, M.sx - 0.01, M.sy + 0.03, alpha(d.color('ink'), 0.5), LW.line, 0.01);
    drawText(d.ctx, 'v₀', M.sx - 0.035, M.sy + 0.048, 0.014, alpha(d.color('ink'), 0.7), { align: 'center' });
  },
};

// ═════════════ 电场中的偏转（类平抛）═════════════
const planEf = memo((p: P) => {
  const d = p.d / 100, L = p.L / 100, v0 = p.v0 * 1e7;
  const E = p.U / d, a = (QE * E) / ME, t = L / v0;
  const y = 0.5 * a * t * t, vy = a * t, hits = y > d / 2;
  const tHit = hits ? Math.sqrt(d / a) : NaN;
  const ppm = Math.min(0.38 / L, 0.13 / d);
  const x0 = 0.34, sx = 0.24, cy = 0.38;
  const ts = t / 2.6;
  const pre = (x0 - sx) / ppm / v0;
  const tailX = 0.97 - (x0 + L * ppm);
  // 出射后沿直线：tail 的水平距离/ v0
  const durPhys = hits ? pre + tHit + 0.15 * t : pre + t + tailX / ppm / v0;
  return { d, L, v0, E, a, t, y, vy, hits, tHit, ppm, x0, sx, cy, ts, dur: durPhys / ts };
});
export const efield: Preset = {
  id: 'efield', title: '带电粒子在电场中的偏转', group: '电磁',
  summary: '电子以 v₀ 垂直电场方向射入平行板间：沿板方向匀速、垂直板方向匀加速（类平抛）；射出时速度反向延长线交于板中点（L/2）。',
  params: [
    { key: 'U', label: '板间电压 U', unit: 'V', min: 10, max: 400, step: 10, def: 100 },
    { key: 'd', label: '板间距 d', unit: 'cm', min: 1, max: 4, step: 0.5, def: 2 },
    { key: 'L', label: '板长 L', unit: 'cm', min: 4, max: 12, step: 1, def: 8 },
    { key: 'v0', label: '入射速度 v₀', unit: '×10⁷ m/s', min: 1, max: 6, step: 0.5, def: 3 },
  ],
  build: (p) => {
    const F = planEf(p), Lp = F.L * F.ppm, dp = F.d * F.ppm;
    return {
      ...mkScene('efield', '带电粒子在电场中的偏转', p, F.ppm, F.dur, [
        ob('plates', 'field-e', F.x0 + Lp / 2, F.cy, Lp, dp, 0, { E: F.E, angle: -90, plates: true }),
        ob('A', 'charge-neg', F.sx, F.cy, 0.02, 0.02, 0, { m: ME, q: QE, vx: F.v0 }),
      ], []),
      params: { ...p, timeScale: F.ts },
    };
  },
  events: ['field', 'hit'],
  overlays: { v: true, f: true, trail: true, graph: false, formula: true },
  layout: { read: 'tl', graph: 'tr', formula: 'tr' },
  readouts: (r, t, p) => {
    const s = st(r, 'A', t), s0 = st0(r, 'A');
    if (!s || !s0) return [];
    const F = planEf(p);
    return [
      { sym: 't', val: fmt(t * r.ts), unit: 's' },
      { sym: 'v_x', val: fmt(s.vx), unit: 'm/s', color: 'blue' },
      { sym: 'v_y', val: fmt(-s.vy), unit: 'm/s', color: 'red' },
      { sym: 'y', val: fmt(s0.y - s.y, 3), unit: 'm' },
      { sym: 'y_{理论}', val: F.hits ? '打到极板' : fmt(F.y, 3), unit: F.hits ? '' : 'm', color: 'violet' },
      { sym: 'E', val: fmt(F.E), unit: 'N/C', color: 'orange' },
      { sym: '慢放', val: `1 s ≙ ${fmt(r.ts)} s` },
    ];
  },
  formulas: (p) => {
    const F = planEf(p);
    const out = [
      { tex: `a=\\dfrac{eU}{md}=${kn(F.a)}${U('m/s^2')},\\quad t=\\dfrac{L}{v_0}=${kn(F.t)}${U('s')}` },
      { tex: `y=\\tfrac12at^2=\\dfrac{eUL^2}{2mdv_0^2}=${kn(F.y)}${U('m')}`, note: F.hits ? `y > d/2 = ${fmt(F.d / 2, 3)} m，电子打到极板上` : `y < d/2，能从板间射出` },
      { tex: `\\tan\\theta=\\dfrac{v_y}{v_0}=\\dfrac{eUL}{mdv_0^2}=${kn(F.vy / F.v0, 3)}` },
    ];
    if (!F.hits) out.push({ tex: `\\text{出射速度反向延长线交于 }\\tfrac L2\\text{ 处}` });
    return out;
  },
  decorate: (d, r, t, p) => {
    const F = planEf(p), s = st(r, 'A', t);
    if (!s) return;
    const k = r.ppm, Lp = F.L * k, ink = alpha(d.color('ink'), 0.45);
    line(d.ctx, [F.sx, F.cy, 0.97, F.cy], ink, LW.thin, DASH);
    const xe = F.x0 + Lp;
    if (!F.hits && s.x * k > xe + 0.005) {
      const ye = F.cy - F.y * k;
      // 出射速度反向延长线 → 板中点
      line(d.ctx, [xe, ye, F.x0 + Lp / 2, F.cy], alpha(d.color('violet'), 0.8), LW.line, [0.004, 0.004]);
      dot(d.ctx, F.x0 + Lp / 2, F.cy, 0.0035, d.color('violet'));
      drawSym(d.ctx, 'L/2', F.x0 + Lp / 2, F.cy + 0.02, 0.015, d.color('violet'), 'center', d.paper);
      dim(d, xe + 0.02, F.cy, xe + 0.02, ye, 'y', d.color('violet'), 0.018);
    }
    dim(d, F.x0, F.cy + F.d * k / 2 + 0.045, xe, F.cy + F.d * k / 2 + 0.045, `L=${fmt(p.L, 0)} cm`, alpha(d.color('ink'), 0.7), 0.018);
    dim(d, F.x0 - 0.03, F.cy - F.d * k / 2, F.x0 - 0.03, F.cy + F.d * k / 2, `d`, alpha(d.color('ink'), 0.7), 0.018);
    drawText(d.ctx, `U = ${fmt(p.U, 0)} V`, xe + 0.015, F.cy - F.d * k / 2 - 0.012, 0.015, alpha(d.color('ink'), 0.75), { weight: 600 });
  },
};

export const EM: Preset[] = [magnetic, efield];
