// ── 预设模板的公共类型与小工具 ─────────────────────────────────
import type { ObjKind, PhysObj, Scene } from '../model';
import type { EvKind, Frame, SimRun } from './engine';
import type { SD } from './prim';

export type P = Record<string, number>;
export type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'tc';
export interface Ov { v?: boolean; f?: boolean; trail?: boolean; graph?: boolean; formula?: boolean }

export interface ParamDef {
  key: string; label: string; unit?: string;
  min: number; max: number; step: number; def: number;
  options?: { v: number; label: string }[];   // 有 options 时显示为分段按钮
}
export interface Row { sym: string; val: string; unit?: string; color?: string }
export interface Series { label: string; color: string; f: (r: SimRun, fr: Frame) => number; dash?: boolean }
export interface Graph { kind: 'line' | 'bars'; title: string; ylab?: string; unit: string; series: Series[]; signed?: boolean }
export interface Formula { tex: string; note?: string }
/** 预设专属标注时可用的比例尺：fs 页面单位 / N，vs 页面单位 /(m/s) */
export interface Deco { ov: Ov; fs: number; vs: number }

export interface Preset {
  id: string; title: string; group: '力学' | '电磁'; summary: string;
  params: ParamDef[];
  build: (p: P) => Scene;
  events?: EvKind[];
  overlays?: Ov;
  strobe?: (p: P) => number;
  layout?: { read?: Corner; graph?: Corner; formula?: Corner };
  graphs?: (p: P) => Graph[];
  readouts?: (r: SimRun, t: number, p: P) => Row[];
  formulas?: (p: P) => Formula[];
  decorate?: (d: SD, r: SimRun, t: number, p: P, x: Deco) => void;
  focus?: string[];
  trails?: string[];
}

export const ob = (id: string, kind: ObjKind, x: number, y: number, w: number, h: number, rot = 0, props: PhysObj['props'] = {}, label?: string): PhysObj =>
  ({ id, kind, x, y, w, h, rot, props, ...(label ? { label } : {}) });

export function mkScene(id: string, title: string, p: P, ppm: number, duration: number, objs: PhysObj[], graphs: Scene['graphs'] = ['vt']): Scene {
  return { title, preset: id, objs, world: { g: p.g ?? 10, ppm }, params: { ...p }, duration: Math.round(duration * 1000) / 1000, graphs };
}

/** 以参数为键的小缓存（预设的解析计算每帧都会用到） */
export function memo<R>(fn: (p: P) => R): (p: P) => R {
  const m = new Map<string, R>();
  return (p) => {
    const k = JSON.stringify(p);
    let v = m.get(k);
    if (v === undefined) { v = fn(p); if (m.size > 64) m.clear(); m.set(k, v); }
    return v;
  };
}

// ── KaTeX 数字 ──
const trim = (x: number, d: number) => String(+x.toFixed(d));
export function kn(x: number, d = 2): string {
  if (!Number.isFinite(x)) return '\\infty';
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) {
    let e = Math.floor(Math.log10(a)), m = +(x / 10 ** e).toFixed(2);
    if (Math.abs(m) >= 10) { m /= 10; e += 1; }
    return `${trim(m, 2)}\\times10^{${e}}`;
  }
  // 小于 1 的量保留 3 位有效数字（0.003 不能显示成 0）
  return trim(x, a > 0 && a < 1 ? Math.max(d, 2 - Math.floor(Math.log10(a))) : d);
}
export const U = (u: string) => `\\ \\mathrm{${u}}`;

// ── 读状态 ──
export function st(r: SimRun, id: string, t: number) { const i = r.bodyIndex(id); return i < 0 ? null : r.state(i, t); }
export function st0(r: SimRun, id: string) { const i = r.bodyIndex(id); return i < 0 ? null : r.frames[0].b[i]; }
export function fb(r: SimRun, fr: Frame, id: string) { const i = r.bodyIndex(id); return fr.b[i < 0 ? 0 : i]; }
/** 沿 (ux,uy) 的速度 */
export const along = (s: { vx: number; vy: number }, ux: number, uy: number) => s.vx * ux + s.vy * uy;
/** 用 ±h 的中心差分求加速度（避开接触求解器的逐步抖动） */
export function acc(r: SimRun, id: string, t: number, ux: number, uy: number, h = 0.03) {
  const t0 = Math.max(0, t - h), t1 = Math.min(r.computed, t + h);
  if (t1 - t0 < 1e-6) return 0;
  const a = st(r, id, t0), b = st(r, id, t1);
  if (!a || !b) return 0;
  return (along(b, ux, uy) - along(a, ux, uy)) / (t1 - t0);
}
/** 某种力（合并同类）沿方向的分量与大小 */
export function force(s: { f: { k: string; x: number; y: number }[] } | null, k: string) {
  let x = 0, y = 0;
  for (const f of s?.f ?? []) if (f.k === k) { x += f.x; y += f.y; }
  return { x, y, m: Math.hypot(x, y) };
}

// ── 一维传送带解析（数值积分，dt=1e-4，交点插值）──
// 沿「带运动方向」为正：gs 为重力沿该方向的分量，gn 为垂直带的分量
export interface BeltPlan { a1: number; a2: number; tCo: number; sCo: number; tEnd: number; vEnd: number; end: 'far' | 'back' | 'none' }
export function belt1D(o: { L: number; vb: number; v0: number; gs: number; gn: number; mu: number; tMax?: number }): BeltPlan {
  const { L, vb, gs, gn, mu } = o;
  const fmax = mu * gn, dt = 1e-4;
  let s = 0, v = o.v0, t = 0, stuck = Math.abs(v - vb) < 1e-12;
  const res: BeltPlan = { a1: NaN, a2: NaN, tCo: NaN, sCo: NaN, tEnd: NaN, vEnd: NaN, end: 'none' };
  const accel = () => {
    if (stuck) { if (fmax >= Math.abs(gs) - 1e-12) return 0; stuck = false; return gs - Math.sign(gs) * fmax; }
    return gs - Math.sign(v - vb) * fmax;
  };
  res.a1 = stuck ? (fmax >= Math.abs(gs) ? 0 : gs - Math.sign(gs) * fmax) : gs - Math.sign(v - vb) * fmax;
  const tMax = o.tMax ?? 60;
  while (t < tMax) {
    const a = accel();
    const vn = v + a * dt;
    const sg = Math.sign(v - vb);
    if (!stuck && sg !== 0 && Math.sign(vn - vb) !== sg) {
      const k = (vb - v) / (vn - v);
      s += ((v + vb) / 2) * k * dt; t += k * dt; v = vb;
      if (Number.isNaN(res.tCo)) { res.tCo = t; res.sCo = s; }
      stuck = true;
      if (Number.isNaN(res.a2)) res.a2 = fmax >= Math.abs(gs) - 1e-12 ? 0 : gs - Math.sign(gs) * fmax;
      if (s >= L) { res.tEnd = t; res.vEnd = v; res.end = 'far'; return res; }
      continue;
    }
    s += ((v + vn) / 2) * dt; v = vn; t += dt;
    if (s >= L) { res.tEnd = t - (s - L) / Math.max(1e-9, v); res.vEnd = v; res.end = 'far'; return res; }
    if (s < 0 && v < 0) { res.tEnd = t; res.vEnd = v; res.end = 'back'; return res; }
  }
  return res;
}

export const clampN = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
