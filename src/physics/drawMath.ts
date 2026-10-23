import type { DrawCtx } from '../ink/draw';
import type { PhysObj } from './model';
import { compileExpression } from '../ink/expression';
import { fillTextPx } from '../ink/pxText';

// 数学图形：先在数学坐标（y 向上）里生成图元，再按外框映射到页面。
// 「等比」图形（角、正多边形、圆锥曲线、立体）保持比例居中；其余（线段、坐标系、函数图像）跟着外框拉伸。

type P = [number, number];
type V3 = [number, number, number];
type Box = [number, number, number, number];
type Prim =
  | { t: 'path'; pts: P[]; close?: boolean; dash?: boolean; fill?: boolean; accent?: boolean; thin?: boolean; clip?: boolean; arrow?: boolean }
  | { t: 'dot'; p: P; accent?: boolean }
  | { t: 'text'; p: P; s: string; away?: P; dx?: number; dy?: number; italic?: boolean; accent?: boolean; size?: number; align?: CanvasTextAlign }
  | { t: 'right'; at: P; u: P; v: P }
  | { t: 'tick'; p: P; axis: 'x' | 'y' };
interface Scene { box: Box; uniform: boolean; clip?: Box; prims: Prim[] }

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const num = (o: PhysObj, k: string, fb: number) => { const v = o.props[k]; return typeof v === 'number' && Number.isFinite(v) ? v : fb; };
const flag = (o: PhysObj, k: string, fb = false) => { const v = o.props[k]; return v === undefined ? fb : v === true || v === 'true'; };
const names = (o: PhysObj, k: string, fb: string) => (typeof o.props[k] === 'string' ? String(o.props[k]) : fb).split(/[\s,，、;；]+/).filter(Boolean);
const fmt = (v: number) => String(Number(v.toFixed(2))).replace('-', '−');
const sq = (name: string, v: number) => Math.abs(v - 1) < 1e-9 ? `${name}²` : `${name}²/${fmt(v)}`;
const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n = 72): P[] => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P; });
const letters = (n: number) => Array.from({ length: n }, (_, i) => 'ABCDEFGHIJKLMN'[i] ?? '');

function extent(pts: P[], pad: number): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!Number.isFinite(x0)) return [-1, -1, 1, 1];
  const m = Math.max(x1 - x0, y1 - y0, 1e-6) * pad;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}
const pathPts = (prims: Prim[]) => prims.flatMap((p) => p.t === 'path' ? p.pts : p.t === 'dot' ? [p.p] : []);
function niceStep(span: number) {
  const raw = span / 8, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

// ── 立体：斜二测或正投影，背面的棱画虚线 ─────────────────────────
interface View { P: (v: V3) => P; depth: (n: V3) => number }
function viewOf(o: PhysObj): View {
  if (flag(o, 'oblique', true)) {
    const k = .5 * Math.SQRT1_2;
    return { P: ([x, y, z]) => [x + z * k, y + z * k], depth: ([x, y, z]) => x * k + y * k - z };
  }
  const a = num(o, 'yaw', 30) * D2R, p = num(o, 'pitch', 20) * D2R;
  const rot = ([x, y, z]: V3): V3 => { const x1 = x * Math.cos(a) + z * Math.sin(a), z1 = -x * Math.sin(a) + z * Math.cos(a); return [x1, y * Math.cos(p) + z1 * Math.sin(p), -y * Math.sin(p) + z1 * Math.cos(p)]; };
  return { P: (v) => { const r = rot(v); return [r[0], r[1]]; }, depth: (n) => -rot(n)[2] };
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const avg = (vs: V3[]): V3 => vs.reduce<V3>((s, v) => [s[0] + v[0] / vs.length, s[1] + v[1] / vs.length, s[2] + v[2] / vs.length], [0, 0, 0]);

function polyhedron(view: View, V: V3[], F: number[][], labels: string[] | null): Prim[] {
  const c = avg(V), prims: Prim[] = [];
  const vis = F.map((f) => {
    let n = cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]]));
    if (dot3(n, sub(avg(f.map((i) => V[i])), c)) < 0) n = [-n[0], -n[1], -n[2]];
    return view.depth(n) > 1e-9;
  });
  const edges = new Map<string, { a: number; b: number; v: boolean }>();
  F.forEach((f, fi) => f.forEach((a, k) => { const b = f[(k + 1) % f.length], key = a < b ? `${a}-${b}` : `${b}-${a}`; const e = edges.get(key) ?? { a, b, v: false }; e.v ||= vis[fi]; edges.set(key, e); }));
  const sorted = [...edges.values()].sort((x, y) => Number(x.v) - Number(y.v));
  for (const e of sorted) prims.push({ t: 'path', pts: [view.P(V[e.a]), view.P(V[e.b])], dash: !e.v });
  if (labels) { const pc = view.P(c); V.forEach((v, i) => labels[i] && prims.push({ t: 'text', p: view.P(v), s: labels[i], away: pc })); }
  return prims;
}

function revolve(view: View, r1: number, r2: number, H: number, axis: boolean, apexName: string): Prim[] {
  const N = 144, prims: Prim[] = [], side = (a: number): V3 => [H * Math.cos(a), r1 - r2, H * Math.sin(a)];
  const ring = (r: number, y: number, cap: boolean) => {
    let run: P[] = [], vis: boolean | null = null;
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, mid = (i + .5) / N * Math.PI * 2, p = view.P([r * Math.cos(a), y, r * Math.sin(a)]);
      const v = cap || view.depth(side(mid)) > 0;
      run.push(p);
      if (vis === null) vis = v;
      if (v !== vis || i === N) { prims.push({ t: 'path', pts: run, dash: !vis }); run = [p]; vis = v; }
    }
  };
  ring(r1, 0, view.depth([0, -1, 0]) > 1e-9);
  if (r2 > 1e-6) ring(r2, H, view.depth([0, 1, 0]) > 1e-9);
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, b = (i + 1) / N * Math.PI * 2, da = view.depth(side(a)), db = view.depth(side(b));
    if ((da > 0) === (db > 0)) continue;
    const t = da / (da - db), s = a + (b - a) * t;
    prims.push({ t: 'path', pts: [view.P([r1 * Math.cos(s), 0, r1 * Math.sin(s)]), view.P([r2 * Math.cos(s), H, r2 * Math.sin(s)])] });
  }
  if (axis) {
    prims.push({ t: 'path', pts: [view.P([0, 0, 0]), view.P([0, H, 0])], dash: true }, { t: 'dot', p: view.P([0, 0, 0]) });
    prims.push({ t: 'text', p: view.P([0, 0, 0]), s: 'O', dx: .75, dy: .45 });
    if (r2 > 1e-6) prims.push({ t: 'dot', p: view.P([0, H, 0]) }, { t: 'text', p: view.P([0, H, 0]), s: 'O₁', dx: .9, dy: -.45 });
    else prims.push({ t: 'text', p: view.P([0, H, 0]), s: apexName, dy: -.85 });
  }
  return prims;
}

/**
 * 空间直角坐标系（课本画法）：z 轴向上、y 轴向右、x 轴斜向前下方（斜二测时 x 轴上的长度画一半）。
 * 内部坐标 [右, 上, 里]，所以课本的 (x, y, z) 对应 [y, z, -x]。可以画点 P 和它到三个坐标面、坐标轴的虚线。
 */
function axes3(o: PhysObj, view: View): Prim[] {
  const n = clamp(Math.round(num(o, 'n', 3)), 1, 10), L = n + .9, neg = flag(o, 'neg'), prims: Prim[] = [];
  const at = (x: number, y: number, z: number) => view.P([y, z, -x]);
  const axes: [V3, string][] = [[[1, 0, 0], 'x'], [[0, 1, 0], 'y'], [[0, 0, 1], 'z']];
  const O = at(0, 0, 0);
  for (const [[a, b, c], s] of axes) {
    const end = at(a * L, b * L, c * L), from = neg ? at(-a * (n + .5), -b * (n + .5), -c * (n + .5)) : O;
    prims.push({ t: 'path', pts: [from, end], arrow: true }, { t: 'text', p: end, s, away: O });
    for (let i = neg ? -n : 1; i <= n; i++) if (i) {
      const p = at(a * i, b * i, c * i);
      prims.push({ t: 'tick', p, axis: s === 'z' ? 'y' : 'x' });
      // x 轴斜着、刻度间距只有一半：数字放刻度右下；画了负半轴时会和 z 轴负半轴的数字挤在一起，x 轴就不标数字
      if (flag(o, 'nums') && !(s === 'x' && neg)) prims.push({ t: 'text', p, s: fmt(i), italic: false, size: .7, ...(s === 'z' ? { dx: -.8 } : s === 'y' ? { dy: .95 } : { dx: .75, dy: .55 }) });
    }
  }
  prims.push({ t: 'text', p: O, s: 'O', dx: -.75, dy: -.35 });
  if (flag(o, 'point')) {
    const px = num(o, 'px', 1), py = num(o, 'py', 2), pz = num(o, 'pz', 2), xs = [0, px], ys = [0, py], zs = [0, pz];
    // 以 O、P 为对角的长方体：不在坐标轴上的棱画虚线
    for (const [i, j, k] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) for (const d of [0, 1, 2]) {
      const q = [i, j, k]; if (q[d] === 1) continue;
      const r = [...q]; r[d] = 1;
      if ([0, 1, 2].every((e) => e === d || q[e] === 0)) continue;
      prims.push({ t: 'path', pts: [at(xs[q[0]], ys[q[1]], zs[q[2]]), at(xs[r[0]], ys[r[1]], zs[r[2]])], dash: true, thin: true });
    }
    const P0 = at(px, py, pz);
    prims.push({ t: 'dot', p: P0, accent: true }, { t: 'text', p: P0, s: `P(${fmt(px)}, ${fmt(py)}, ${fmt(pz)})`, dx: 2.6, dy: -.6, accent: true, size: .8 });
  }
  return prims;
}

function solid(o: PhysObj): Prim[] {
  const view = viewOf(o), lab = flag(o, 'letters', true);
  const n = clamp(Math.round(num(o, 'n', 4)), 3, 8), base = (r: number, y: number) => Array.from({ length: n }, (_, k) => { const a = -Math.PI / 2 - Math.PI / n + k * 2 * Math.PI / n; return [r * Math.cos(a), y, r * Math.sin(a)] as V3; });
  switch (o.kind) {
    case 'm-cube': case 'm-cuboid': {
      const a = o.kind === 'm-cube' ? 1 : Math.max(.05, num(o, 'a', 1.6)), b = o.kind === 'm-cube' ? 1 : Math.max(.05, num(o, 'b', 1)), c = o.kind === 'm-cube' ? 1 : Math.max(.05, num(o, 'c', 1));
      const V: V3[] = [[0, 0, 0], [a, 0, 0], [a, 0, b], [0, 0, b], [0, c, 0], [a, c, 0], [a, c, b], [0, c, b]];
      return polyhedron(view, V, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], lab ? ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'] : null);
    }
    case 'm-prism': {
      const H = Math.max(.05, num(o, 'H', 1.6)), V = [...base(1, 0), ...base(1, H)], L = letters(n);
      return polyhedron(view, V, [L.map((_, i) => i), L.map((_, i) => n + i), ...L.map((_, k) => [k, (k + 1) % n, n + (k + 1) % n, n + k])], lab ? [...L, ...L.map((x) => x + '₁')] : null);
    }
    case 'm-pyramid': {
      const H = Math.max(.05, num(o, 'H', 1.6)), V: V3[] = [...base(1, 0), [0, H, 0]], L = letters(n);
      return polyhedron(view, V, [L.map((_, i) => i), ...L.map((_, k) => [k, (k + 1) % n, n])], lab ? [...L, 'P'] : null);
    }
    case 'm-frustum-p': {
      const H = Math.max(.05, num(o, 'H', 1.2)), k = clamp(num(o, 'k', .5), .05, .95), V = [...base(1, 0), ...base(k, H)], L = letters(n);
      return polyhedron(view, V, [L.map((_, i) => i), L.map((_, i) => n + i), ...L.map((_, j) => [j, (j + 1) % n, n + (j + 1) % n, n + j])], lab ? [...L, ...L.map((x) => x + '₁')] : null);
    }
    case 'm-axes3': return axes3(o, view);
    case 'm-cylinder': return revolve(view, 1, 1, Math.max(.05, num(o, 'H', 2)), flag(o, 'axis'), '');
    case 'm-cone': return revolve(view, 1, 0, Math.max(.05, num(o, 'H', 2)), flag(o, 'axis'), 'P');
    case 'm-frustum': return revolve(view, Math.max(.05, num(o, 'r1', 1)), clamp(num(o, 'r2', .55), .02, 50), Math.max(.05, num(o, 'H', 1.3)), flag(o, 'axis'), '');
    case 'm-sphere': {
      const tilt = flag(o, 'oblique', true) ? .3 : Math.sin(num(o, 'pitch', 20) * D2R), up = tilt >= 0;
      const prims: Prim[] = [{ t: 'path', pts: arcPts(0, 0, 1, 0, Math.PI * 2, 120) }];
      prims.push({ t: 'path', pts: arcPts(0, 0, 1, Math.PI, Math.PI * 2, 60).map(([x, y]) => [x, y * Math.abs(tilt)]), dash: !up });
      prims.push({ t: 'path', pts: arcPts(0, 0, 1, 0, Math.PI, 60).map(([x, y]) => [x, y * Math.abs(tilt)]), dash: up });
      if (flag(o, 'center', true)) prims.push({ t: 'dot', p: [0, 0] }, { t: 'text', p: [0, 0], s: 'O', dx: .6, dy: -.55 });
      return prims;
    }
  }
  return [];
}

function axesPrims(win: Box, ox: number, oy: number, xl = 'x', yl = 'y'): Prim[] {
  const [x0, y0, x1, y1] = win;
  return [
    { t: 'path', pts: [[x0, oy], [x1, oy]], arrow: true }, { t: 'path', pts: [[ox, y0], [ox, y1]], arrow: true },
    { t: 'text', p: [x1, oy], s: xl, dx: -.35, dy: .95 }, { t: 'text', p: [ox, y1], s: yl, dx: -.8, dy: .35 },
    { t: 'text', p: [ox, oy], s: 'O', dx: -.7, dy: .75 },
  ];
}

function curve(f: (x: number) => number, x0: number, x1: number, span: number, n = 480): Prim[] {
  const out: Prim[] = []; let run: P[] = [], prev = NaN;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = f(x), bad = !Number.isFinite(y) || Math.abs(y) > 1e6 || Number.isFinite(prev) && Math.abs(y - prev) > span * 3;
    if (bad) { if (run.length > 1) out.push({ t: 'path', pts: run, accent: true, clip: true }); run = []; }
    if (Number.isFinite(y) && Math.abs(y) <= 1e6) run.push([x, y]);
    prev = y;
  }
  if (run.length > 1) out.push({ t: 'path', pts: run, accent: true, clip: true });
  return out;
}

/** 方程写在图形上方的一条带里，不和坐标轴、刻度挤在一起 */
function eqBand(win: Box, prims: Prim[], s: string): Box {
  const band = (win[3] - win[1]) * .16;
  prims.push({ t: 'text', p: [win[2], win[3] + band * .55], s, italic: false, accent: true, size: .85, align: 'right' });
  return [win[0], win[1], win[2], win[3] + band];
}
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
const pretty = (src: string) => src.replace(/\^\(?(-?\d+)\)?/g, (_, d: string) => [...d].map((c) => SUP[c] ?? c).join('')).replace(/\*\*?/g, '·').replace(/sqrt/g, '√').replace(/\bpi\b/g, 'π').replace(/-/g, '−');

const exprCache = new Map<string, (x: number) => number>();
function compiled(src: string) {
  let f = exprCache.get(src);
  if (!f) { f = compileExpression(src); if (exprCache.size > 200) exprCache.clear(); exprCache.set(src, f); }
  return f;
}

function scene(o: PhysObj): Scene | null {
  const prims: Prim[] = [];
  switch (o.kind) {
    case 'm-segment': case 'm-ray': case 'm-line': {
      const [a, b] = names(o, 'names', o.kind === 'm-ray' ? 'O A' : 'A B');
      const ends: [number, number] = o.kind === 'm-segment' ? [0, 1] : o.kind === 'm-ray' ? [0, .55] : [.3, .7];
      prims.push({ t: 'path', pts: [[o.kind === 'm-line' ? 0 : ends[0], 0], [1, 0]] });
      ends.forEach((x, i) => { const s = [a, b][i]; if (s || o.kind === 'm-segment' || (o.kind === 'm-ray' && i === 0)) prims.push({ t: 'dot', p: [x, 0] }); if (s) prims.push({ t: 'text', p: [x, 0], s, dy: -.95 }); });
      return { box: [0, -1, 1, 1], uniform: false, prims };
    }
    case 'm-angle': {
      const th = clamp(num(o, 'angle', 60), 1, 359) * D2R, [a, v, b] = names(o, 'names', 'A O B'), P1: P = [1, 0], P2: P = [Math.cos(th), Math.sin(th)];
      prims.push({ t: 'path', pts: [P1, [0, 0], P2] });
      if (Math.abs(th - Math.PI / 2) < 1e-6) prims.push({ t: 'right', at: [0, 0], u: P1, v: P2 });
      else prims.push({ t: 'path', pts: arcPts(0, 0, .2, 0, th, 48), thin: true });
      if (flag(o, 'deg', true)) prims.push({ t: 'text', p: [.36 * Math.cos(th / 2), .36 * Math.sin(th / 2)], s: `${fmt(th / D2R)}°`, italic: false, size: .8 });
      if (a) prims.push({ t: 'text', p: P1, s: a, dy: .9 });
      if (b) prims.push({ t: 'text', p: P2, s: b, dx: Math.cos(th) * .8, dy: -Math.sin(th) * .8 });
      if (v) prims.push({ t: 'text', p: [0, 0], s: v, dx: -Math.cos(th / 2) * .85, dy: Math.sin(th / 2) * .85 });
      return { box: extent([[0, 0], P1, P2, ...arcPts(0, 0, .4, 0, th, 24)], .1), uniform: true, prims };
    }
    case 'm-triangle': {
      const ax = clamp(num(o, 'apex', .35), 0, 1), A: P = [ax, 1], B: P = [0, 0], C: P = [1, 0], G: P = [(ax + 1) / 3, 1 / 3];
      const [na, nb, nc, nd] = names(o, 'names', 'A B C D');
      prims.push({ t: 'path', pts: [A, B, C], close: true, fill: true });
      if (ax < .02) prims.push({ t: 'right', at: B, u: C, v: A }); else if (ax > .98) prims.push({ t: 'right', at: C, u: B, v: A });
      if (flag(o, 'alt') && ax > .02 && ax < .98) { prims.push({ t: 'path', pts: [A, [ax, 0]], dash: true }, { t: 'right', at: [ax, 0], u: C, v: A }); if (nd) prims.push({ t: 'text', p: [ax, 0], s: nd, dy: .95 }); }
      [[A, na], [B, nb], [C, nc]].forEach(([p, s]) => s && prims.push({ t: 'text', p: p as P, s: s as string, away: G }));
      return { box: [0, 0, 1, 1], uniform: false, prims };
    }
    case 'm-polygon': {
      const n = clamp(Math.round(num(o, 'n', 4)), 3, 12), V = Array.from({ length: n }, (_, k) => { const a = -Math.PI / 2 - Math.PI / n + k * 2 * Math.PI / n; return [Math.cos(a), Math.sin(a)] as P; });
      prims.push({ t: 'path', pts: V, close: true, fill: true });
      if (flag(o, 'letters', true)) letters(n).forEach((s, i) => prims.push({ t: 'text', p: V[i], s, away: [0, 0] }));
      return { box: extent(V, .12), uniform: true, prims };
    }
    case 'm-circle': {
      prims.push({ t: 'path', pts: arcPts(0, 0, 1, 0, Math.PI * 2, 120) });
      if (flag(o, 'center', true)) prims.push({ t: 'dot', p: [0, 0] }, { t: 'text', p: [0, 0], s: 'O', dx: -.6, dy: -.6 });
      if (flag(o, 'radius', true)) { const e: P = [Math.cos(-Math.PI / 6), Math.sin(-Math.PI / 6)]; prims.push({ t: 'path', pts: [[0, 0], e] }, { t: 'text', p: [e[0] / 2, e[1] / 2], s: 'r', dx: .35, dy: .75 }); }
      return { box: [-1.08, -1.08, 1.08, 1.08], uniform: true, prims };
    }
    case 'm-arc': case 'm-sector': {
      let a0 = num(o, 'a0', 0), a1 = num(o, 'a1', o.kind === 'm-arc' ? 120 : 90);
      if (a1 <= a0) a1 += 360 * Math.ceil((a0 - a1 + 1e-9) / 360);
      a1 = Math.min(a1, a0 + 360);
      const pts = arcPts(0, 0, 1, a0 * D2R, a1 * D2R, 96), [na, nb] = names(o, 'names', 'A B'), sector = o.kind === 'm-sector';
      prims.push(sector ? { t: 'path', pts: [[0, 0], ...pts], close: true, fill: true } : { t: 'path', pts });
      if (sector || flag(o, 'center')) prims.push({ t: 'dot', p: [0, 0] }, { t: 'text', p: [0, 0], s: 'O', away: pts[48] });
      if (na) prims.push({ t: 'text', p: pts[0], s: na, away: [0, 0] });
      if (nb) prims.push({ t: 'text', p: pts[96], s: nb, away: [0, 0] });
      return { box: extent(sector || flag(o, 'center') ? [[0, 0], ...pts] : pts, .1), uniform: true, prims };
    }
    case 'm-axes': {
      const n = clamp(Math.round(num(o, 'n', 4)), 1, 20), L = n + .8, win: Box = [-L, -L, L, L];
      if (flag(o, 'grid')) for (let i = -n; i <= n; i++) if (i) prims.push({ t: 'path', pts: [[i, -n], [i, n]], thin: true }, { t: 'path', pts: [[-n, i], [n, i]], thin: true });
      prims.push(...axesPrims(win, 0, 0));
      for (let i = -n; i <= n; i++) if (i) {
        prims.push({ t: 'tick', p: [i, 0], axis: 'x' }, { t: 'tick', p: [0, i], axis: 'y' });
        if (flag(o, 'nums', true)) prims.push({ t: 'text', p: [i, 0], s: fmt(i), dy: .95, italic: false, size: .72 }, { t: 'text', p: [0, i], s: fmt(i), dx: -.75, italic: false, size: .72 });
      }
      return { box: win, uniform: false, prims };
    }
    case 'm-numberline': {
      let lo = num(o, 'min', -3), hi = num(o, 'max', 3), step = Math.abs(num(o, 'step', 1)) || 1;
      if (hi <= lo) [lo, hi] = [Math.min(lo, hi), Math.max(lo, hi) + 1];
      if ((hi - lo) / step > 40) step = (hi - lo) / 40;
      const win: Box = [lo - step * .6, -1, hi + step * .9, 1];
      prims.push({ t: 'path', pts: [[win[0], 0], [win[2], 0]], arrow: true });
      for (let v = lo, i = 0; v <= hi + step * 1e-6 && i < 41; v = lo + step * ++i) prims.push({ t: 'tick', p: [v, 0], axis: 'x' }, { t: 'text', p: [v, 0], s: fmt(v), dy: 1.05, italic: false, size: .78 });
      return { box: win, uniform: false, prims };
    }
    case 'm-grid': {
      const cols = clamp(Math.round(num(o, 'cols', 8)), 1, 60), rows = clamp(Math.round(num(o, 'rows', 8)), 1, 60);
      for (let i = 0; i <= cols; i++) prims.push({ t: 'path', pts: [[i, 0], [i, rows]], thin: i > 0 && i < cols });
      for (let j = 0; j <= rows; j++) prims.push({ t: 'path', pts: [[0, j], [cols, j]], thin: j > 0 && j < rows });
      return { box: [0, 0, cols, rows], uniform: false, prims };
    }
    case 'm-func': {
      let x0 = num(o, 'xmin', -3), x1 = num(o, 'xmax', 5), y0 = num(o, 'ymin', -2), y1 = num(o, 'ymax', 6);
      if (x1 <= x0) x1 = x0 + 1; if (y1 <= y0) y1 = y0 + 1;
      const win: Box = [x0, y0, x1, y1], ox = x0 <= 0 && x1 >= 0 ? 0 : x0, oy = y0 <= 0 && y1 >= 0 ? 0 : y0, sx = niceStep(x1 - x0), sy = niceStep(y1 - y0);
      for (let v = Math.ceil(x0 / sx) * sx; v <= x1 - sx * .3; v += sx) if (Math.abs(v - ox) > sx * .01) {
        if (flag(o, 'grid')) prims.push({ t: 'path', pts: [[v, y0], [v, y1]], thin: true });
        prims.push({ t: 'tick', p: [v, oy], axis: 'x' }, { t: 'text', p: [v, oy], s: fmt(v), dy: .95, italic: false, size: .7 });
      }
      for (let v = Math.ceil(y0 / sy) * sy; v <= y1 - sy * .3; v += sy) if (Math.abs(v - oy) > sy * .01) {
        if (flag(o, 'grid')) prims.push({ t: 'path', pts: [[x0, v], [x1, v]], thin: true });
        prims.push({ t: 'tick', p: [ox, v], axis: 'y' }, { t: 'text', p: [ox, v], s: fmt(v), dx: -.8, italic: false, size: .7 });
      }
      prims.push(...axesPrims(win, ox, oy));
      const src = typeof o.props.expr === 'string' ? o.props.expr : 'x^2';
      prims.push(...curve(compiled(src), x0, x1, y1 - y0));
      return { box: flag(o, 'eq', true) ? eqBand(win, prims, 'y = ' + pretty(src.replace(/^\s*y\s*=\s*/i, ''))) : win, uniform: false, clip: win, prims };
    }
    case 'm-ellipse': {
      const a = Math.max(.05, num(o, 'a', 2)), b = Math.max(.05, num(o, 'b', 1.732)), m = Math.max(a, b) * .35, win: Box = [-a - m, -b - m, a + m, b + m];
      prims.push(...axesPrims(win, 0, 0), { t: 'path', pts: arcPts(0, 0, 1, 0, Math.PI * 2, 160).map(([x, y]) => [x * a, y * b]), accent: true });
      if (flag(o, 'foci', true) && Math.abs(a - b) > 1e-6) {
        const c = Math.sqrt(Math.abs(a * a - b * b)), F: P[] = a > b ? [[-c, 0], [c, 0]] : [[0, -c], [0, c]];
        F.forEach((p, i) => prims.push({ t: 'dot', p, accent: true }, { t: 'text', p, s: i ? 'F₂' : 'F₁', dx: a > b ? 0 : .8, dy: a > b ? .95 : 0 }));
      }
      return { box: flag(o, 'eq', true) ? eqBand(win, prims, `${sq('x', a * a)} + ${sq('y', b * b)} = 1`) : win, uniform: true, prims };
    }
    case 'm-hyperbola': {
      const a = Math.max(.05, num(o, 'a', 1)), b = Math.max(.05, num(o, 'b', 1.732)), c = Math.hypot(a, b), X = Math.max(c + a * .5, a * 2.4);
      const Y = Math.max(b * 1.5, Math.min(b * Math.sqrt(X * X / (a * a) - 1), X)), win: Box = [-X, -Y, X, Y];
      if (flag(o, 'asym', true)) prims.push({ t: 'path', pts: [[-X, -X * b / a], [X, X * b / a]], dash: true, thin: true, clip: true }, { t: 'path', pts: [[-X, X * b / a], [X, -X * b / a]], dash: true, thin: true, clip: true });
      prims.push(...axesPrims(win, 0, 0));
      const T = Math.acosh(Math.max(1, X / a)) * 1.02;
      for (const s of [1, -1]) prims.push({ t: 'path', pts: Array.from({ length: 121 }, (_, i) => { const t = -T + 2 * T * i / 120; return [s * a * Math.cosh(t), b * Math.sinh(t)] as P; }), accent: true, clip: true });
      if (flag(o, 'foci', true)) [[-c, 0], [c, 0]].forEach((p, i) => prims.push({ t: 'dot', p: p as P, accent: true }, { t: 'text', p: p as P, s: i ? 'F₂' : 'F₁', dy: -.9 }));
      return { box: flag(o, 'eq', true) ? eqBand(win, prims, `${sq('x', a * a)} − ${sq('y', b * b)} = 1`) : win, uniform: true, clip: win, prims };
    }
    case 'm-parabola': {
      const p = Math.max(.05, num(o, 'p', 1)), open = ((Math.round(num(o, 'open', 0)) % 4) + 4) % 4, V = 2.8 * p;
      const map = ([u, v]: P): P => open === 0 ? [u, v] : open === 1 ? [v, u] : open === 2 ? [-u, v] : [v, -u];
      const corners = [map([-1.1 * p, -V]), map([3.2 * p, V])], win: Box = [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])];
      prims.push(...axesPrims(win, 0, 0));
      prims.push({ t: 'path', pts: Array.from({ length: 121 }, (_, i) => { const v = -V + 2 * V * i / 120; return map([v * v / (2 * p), v]); }), accent: true, clip: true });
      if (flag(o, 'focus', true)) { const F = map([p / 2, 0]); prims.push({ t: 'dot', p: F, accent: true }, { t: 'text', p: F, s: 'F', dx: open % 2 ? .75 : 0, dy: open % 2 ? 0 : .95 }); }
      if (flag(o, 'directrix', true)) { const a = map([-p / 2, -V]), b = map([-p / 2, V]); prims.push({ t: 'path', pts: [a, b], dash: true, accent: true }, { t: 'text', p: b, s: 'l', dx: open % 2 ? -.4 : .55, dy: open % 2 ? -.6 : .5 }); }
      const k = 2 * p === 1 ? '' : fmt(2 * p), sign = open >= 2 ? '−' : '';
      return { box: flag(o, 'eq', true) ? eqBand(win, prims, open % 2 ? `x² = ${sign}${k}y` : `y² = ${sign}${k}x`) : win, uniform: true, clip: win, prims };
    }
    default: {
      const s = solid(o);
      if (!s.length) return null;
      return { box: extent(pathPts(s), flag(o, 'letters', true) ? .1 : .05), uniform: true, prims: s };
    }
  }
}

/** 等比图形的外框高宽比（参数改了外框跟着变）；可以随意拉伸的图形返回 null */
export function mathAspect(o: PhysObj): number | null {
  const sc = scene(o);
  if (!sc || !sc.uniform) return null;
  const [x0, y0, x1, y1] = sc.box;
  return clamp((y1 - y0) / Math.max(1e-6, x1 - x0), .08, 12);
}

export function drawMath(d: DrawCtx, o: PhysObj, col: string) {
  const sc = scene(o); if (!sc) return;
  const { ctx } = d, w = o.w, h = o.h, accent = d.color('blue');
  const [bx0, by0, bx1, by1] = sc.box;
  let sx = w / Math.max(1e-9, bx1 - bx0), sy = h / Math.max(1e-9, by1 - by0);
  if (sc.uniform) sx = sy = Math.min(sx, sy);
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const T = ([x, y]: P): P => [(x - cx) * sx, -(y - cy) * sy];
  const fs = clamp(Math.min(w, h) * .085, .011, .02), lw = clamp(Math.min(w, h) * .012, .0012, .0021);
  const head = (a: P, b: P) => { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = lw * 5; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - Math.cos(ang - .4) * L, b[1] - Math.sin(ang - .4) * L); ctx.lineTo(b[0] - Math.cos(ang + .4) * L, b[1] - Math.sin(ang + .4) * L); ctx.closePath(); ctx.fill(); };
  ctx.save();
  ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of sc.prims) {
    ctx.save();
    if (p.t === 'path') {
      if (p.clip && sc.clip) { const [a, b] = [T([sc.clip[0], sc.clip[1]]), T([sc.clip[2], sc.clip[3]])]; ctx.beginPath(); ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); ctx.clip(); }
      const pts = p.pts.map(T);
      if (p.accent) { ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = lw * 1.25; }
      if (p.thin) { ctx.lineWidth = lw * .6; ctx.globalAlpha *= .45; }
      if (p.dash) ctx.setLineDash([lw * 3.2, lw * 2.6]);
      ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (p.close) ctx.closePath();
      if (p.fill) { ctx.save(); ctx.globalAlpha *= .08; ctx.fill(); ctx.restore(); }
      ctx.stroke();
      if (p.arrow && pts.length > 1) { ctx.setLineDash([]); head(pts[pts.length - 2], pts[pts.length - 1]); }
    } else if (p.t === 'dot') {
      const [x, y] = T(p.p); if (p.accent) ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(x, y, lw * 1.7, 0, Math.PI * 2); ctx.fill();
    } else if (p.t === 'tick') {
      const [x, y] = T(p.p), L = fs * .28;
      ctx.beginPath(); if (p.axis === 'x') { ctx.moveTo(x, y); ctx.lineTo(x, y - L); } else { ctx.moveTo(x, y); ctx.lineTo(x + L, y); } ctx.stroke();
    } else if (p.t === 'right') {
      const at = T(p.at), u = T(p.u), v = T(p.v), L = fs * .65;
      const nu = Math.hypot(u[0] - at[0], u[1] - at[1]) || 1, nv = Math.hypot(v[0] - at[0], v[1] - at[1]) || 1;
      const du: P = [(u[0] - at[0]) / nu * L, (u[1] - at[1]) / nu * L], dv: P = [(v[0] - at[0]) / nv * L, (v[1] - at[1]) / nv * L];
      ctx.lineWidth = lw * .8; ctx.beginPath(); ctx.moveTo(at[0] + du[0], at[1] + du[1]); ctx.lineTo(at[0] + du[0] + dv[0], at[1] + du[1] + dv[1]); ctx.lineTo(at[0] + dv[0], at[1] + dv[1]); ctx.stroke();
    } else if (p.t === 'text') {
      const size = fs * (p.size ?? 1); let [x, y] = T(p.p);
      if (p.away) { const [ax, ay] = T(p.away), dx = x - ax, dy = y - ay, n = Math.hypot(dx, dy); if (n > 1e-9) { x += dx / n * size * .85; y += dy / n * size * .85; } else y -= size * .85; }
      x += (p.dx ?? 0) * size; y += (p.dy ?? 0) * size;
      if (p.accent) ctx.fillStyle = accent;
      ctx.textAlign = p.align ?? 'center'; ctx.textBaseline = 'middle';
      const italic = p.italic !== false;
      fillTextPx(ctx, p.s, x, y, size, (px) => italic ? `italic 500 ${px}px "Times New Roman", "Cambria Math", serif` : `500 ${px}px "Inter Variable", "Microsoft YaHei UI", sans-serif`);
    }
    ctx.restore();
  }
  ctx.restore();
}
