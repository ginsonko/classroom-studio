// 立体演示的「世界」：把规格里的数字 / 公式 / 运动配方算成任意时刻的位置、角度、可见性。
// 纯计算，不依赖 three.js，Node 里可以直接测试。坐标：规格坐标（up=y 或 up=z）→ 世界坐标（y 朝上）。
import { compile, type Fn, type Scope } from './expr';
import { BODY_TYPES, type S3DObject, type S3DSpec } from './spec';

export type V3 = [number, number, number];
const D2R = Math.PI / 180;
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const norm = (a: V3): V3 => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 各类型的默认尺寸（规格单位） */
export const DEF = {
  box: [1, 0.7, 0.8] as V3, cart: [1.4, 0.45, 0.8] as V3, ballR: 0.35, groundLen: 12, groundDepth: 3, inclineLen: 5, inclineDepth: 2,
  conveyorLen: 6, pulleyR: 0.35, arrowLen: 1.4, earthR: 1.2, sunR: 1.2, chargeR: 0.22, pointR: 0.06,
};

export interface Frame { o: V3; u: V3; n: V3; angle: number; length: number }
export interface Recipe { kind: string; fn: (t: number) => V3 | number; rot?: (t: number) => number }

/** 公认的方向关键字（arrow.dir / field.dir） */
export const DIR_WORDS: Record<string, V3> = {
  up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], in: [0, 0, -1], out: [0, 0, 1],
  '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
  上: [0, 1, 0], 下: [0, -1, 0], 左: [-1, 0, 0], 右: [1, 0, 0], 向里: [0, 0, -1], 向外: [0, 0, 1],
};
export const DIR_REL = new Set(['normal', '-normal', 'along', '-along']);

export class World {
  readonly spec: S3DSpec;
  readonly params: Record<string, number>;
  readonly byId = new Map<string, S3DObject>();
  readonly D: number;
  private fns = new Map<string, Fn | Fn[] | null>();
  private varFns: [string, Fn][] = [];
  private scopeCache = new Map<number, Scope>();
  private posCache = new Map<string, V3>();
  private depth = 0;
  private recipes = new Map<string, Recipe | null>();
  /** 立体图形顶点名 → [solid id, 下标] */
  readonly vertexOwner = new Map<string, [string, number]>();
  readonly problems: string[] = [];
  readonly known: Set<string>;

  constructor(spec: S3DSpec, params: Record<string, number> = {}) {
    this.spec = spec;
    this.D = spec.duration;
    const p: Record<string, number> = {};
    for (const d of spec.params) { const v = Number(params[d.key]); p[d.key] = Number.isFinite(v) ? Math.max(d.min, Math.min(d.max, v)) : d.value; }
    this.params = p;
    for (const o of spec.objects) this.byId.set(o.id, o);
    this.known = new Set(['t', ...Object.keys(p), ...Object.keys(spec.vars)]);
    const objects = new Set(this.byId.keys());
    for (const [name, src] of Object.entries(spec.vars)) {
      try { this.varFns.push([name, compile(src, { names: this.known, objects }).fn]); }
      catch (e) { this.problems.push(`中间量 ${name}：${(e as Error).message}`); this.varFns.push([name, () => 0]); }
    }
    for (const o of spec.objects) if (o.type === 'solid') solidNames(o).forEach((n, i) => { if (!this.vertexOwner.has(n)) this.vertexOwner.set(n, [o.id, i]); });
  }

  // ── 表达式 ────────────────────────────────────────────
  scope(t: number): Scope {
    const hit = this.scopeCache.get(t);
    if (hit) return hit;
    const v: Record<string, number> = { t, ...this.params };
    const s: Scope = { v, m: (obj, prop) => this.metric(obj, prop, t) };
    this.depth++;
    try { for (const [name, fn] of this.varFns) v[name] = this.depth > 6 ? 0 : fn(s); }
    finally { this.depth--; }
    if (this.scopeCache.size > 64) this.scopeCache.clear();
    this.scopeCache.set(t, s);
    return s;
  }
  compileExpr(src: unknown, extra?: string[]): Fn | null {
    if (typeof src === 'number') return Number.isFinite(src) ? () => src : null;
    if (typeof src !== 'string') return null;
    const names = extra ? new Set([...this.known, ...extra]) : this.known;
    try { return compile(src, { names, objects: new Set(this.byId.keys()) }).fn; }
    catch (e) { this.problems.push(`「${src}」：${(e as Error).message}`); return null; }
  }
  private getter(o: S3DObject, field: string): Fn | null {
    const key = o.id + '\u0001' + field;
    if (!this.fns.has(key)) this.fns.set(key, this.compileExpr(o[field]));
    return this.fns.get(key) as Fn | null;
  }
  num(o: S3DObject, field: string, t: number, def: number): number {
    const f = this.getter(o, field);
    return f ? f(this.scope(t)) : def;
  }
  has(o: S3DObject, field: string) { return o[field] !== undefined && o[field] !== null; }
  /** 规格坐标里的向量字段；缺的分量补 def 对应分量 */
  vec(o: S3DObject, field: string, t: number, def: V3 | null = null): V3 | null {
    const raw = o[field];
    if (!Array.isArray(raw)) return def;
    const key = o.id + '\u0001' + field;
    let fs = this.fns.get(key) as Fn[] | undefined;
    if (!fs) { fs = raw.slice(0, 3).map((x) => this.compileExpr(x) ?? (() => 0)); this.fns.set(key, fs); }
    const s = this.scope(t), d = def ?? [0, 0, 0];
    return [fs[0] ? fs[0](s) : d[0], fs[1] ? fs[1](s) : d[1], fs[2] ? fs[2](s) : d[2]];
  }
  /** 规格坐标 → 世界坐标（y 朝上） */
  w(v: V3): V3 { return this.spec.up === 'z' ? [v[0], v[2], -v[1]] : [v[0], v[1], v[2]]; }
  /** 世界坐标 → 规格坐标 */
  unw(v: V3): V3 { return this.spec.up === 'z' ? [v[0], -v[2], v[1]] : [v[0], v[1], v[2]]; }

  // ── 可见性 / 分步 ─────────────────────────────────────
  stepIndex(t: number): number {
    const n = this.spec.steps.length;
    if (!n) return -1;
    const ats = this.stepTimes();
    let k = 0;
    for (let i = 0; i < n; i++) if (t >= ats[i] - 1e-6) k = i;
    return k;
  }
  stepTimes(): number[] {
    const n = this.spec.steps.length, D = this.D;
    return this.spec.steps.map((s, i) => (typeof s.at === 'number' ? Math.max(0, Math.min(D, s.at)) : (i * D) / n));
  }
  visible(o: S3DObject, t: number): boolean {
    const st = Number(o.step);
    if (st >= 1 && this.spec.steps.length && this.stepIndex(t) < st - 1) return false;
    if (this.has(o, 'show') && this.num(o, 'show', t, 1) <= 0.5) return false;
    return true;
  }
  /** 被引用（at / of / focus）的对象这一刻是否在发光：highlight 字段，或当前步骤刚出现 */
  highlight(o: S3DObject, t: number): number {
    if (this.has(o, 'highlight')) return Math.max(0, Math.min(1, this.num(o, 'highlight', t, 0)));
    const st = Number(o.step);
    if (st >= 1 && this.spec.steps.length && this.stepIndex(t) === st - 1) return 1;
    return 0;
  }

  // ── 表面（斜面、地面、传送带） ─────────────────────────
  frame(id: string, t: number): Frame | null {
    const o = this.byId.get(id);
    if (!o) return null;
    if (o.type === 'incline') {
      const g = this.incline(o, t);
      return { o: g.low, u: g.u, n: g.n, angle: g.dir === 'right' ? g.angle : 180 - g.angle, length: g.length };
    }
    if (o.type === 'ground' || o.type === 'conveyor') {
      const p = this.vec(o, 'pos', t, [0, 0, 0])!;
      const L = o.type === 'ground' ? (this.vec(o, 'size', t, [DEF.groundLen, DEF.groundDepth, 0])![0]) : this.num(o, 'length', t, DEF.conveyorLen);
      return { o: [p[0] - L / 2, p[1], p[2]], u: [1, 0, 0], n: [0, 1, 0], angle: 0, length: L };
    }
    return null;
  }
  incline(o: S3DObject, t: number) {
    const angle = Math.max(1, Math.min(89, this.num(o, 'angle', t, 30)));
    const a = angle * D2R;
    let length = this.num(o, 'length', t, 0);
    if (!(length > 0)) { const h = this.num(o, 'height', t, 0); length = h > 0 ? h / Math.sin(a) : DEF.inclineLen; }
    const dir = o.dir === 'left' ? 'left' : 'right';
    const low = this.vec(o, 'pos', t, [0, 0, 0])!;
    const c = Math.cos(a), s = Math.sin(a);
    const u: V3 = dir === 'right' ? [c, s, 0] : [-c, s, 0];
    const n: V3 = dir === 'right' ? [-s, c, 0] : [s, c, 0];
    return { low, u, n, angle, length, height: length * s, base: length * c, depth: this.num(o, 'depth', t, DEF.inclineDepth), dir };
  }

  /** 物体在表面法向上的半厚度（放在表面上时用） */
  halfThick(o: S3DObject, t: number): number {
    if (o.type === 'box') return this.vec(o, 'size', t, DEF.box)![1] / 2;
    if (o.type === 'cart') return this.vec(o, 'size', t, DEF.cart)![1] / 2 + 0.18;
    if (o.type === 'ball') return this.num(o, 'r', t, DEF.ballR);
    if (o.type === 'charge') return this.num(o, 'r', t, DEF.chargeR);
    if (o.type === 'cylinder') return o.axis === 'y' ? this.num(o, 'h', t, 1) / 2 : this.num(o, 'r', t, 0.4);
    return 0;
  }

  // ── 运动配方 ─────────────────────────────────────────
  recipe(o: S3DObject): Recipe | null {
    if (this.recipes.has(o.id)) return this.recipes.get(o.id)!;
    const r = this.buildRecipe(o);
    this.recipes.set(o.id, r);
    return r;
  }
  private buildRecipe(o: S3DObject): Recipe | null {
    const m = o.motion as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object') return null;
    const scalar = typeof o.on === 'string' && this.frame(o.on, 0) !== null;
    const N = (k: string, def: number) => { const f = this.compileExpr(m[k] as unknown); return f ? f(this.scope(0)) : def; };
    const V = (k: string, def: V3): V3 => {
      const raw = m[k];
      if (typeof raw === 'number' || typeof raw === 'string') { const v = N(k, 0); return [v, 0, 0]; }
      if (!Array.isArray(raw)) return def;
      return [0, 1, 2].map((i) => { const f = this.compileExpr(raw[i]); return f ? f(this.scope(0)) : def[i]; }) as V3;
    };
    const start = (): V3 => (scalar ? [N('s0', this.num(o, 's', 0, 0)), 0, 0] : (this.vec(o, 'pos', 0, [0, 0, 0]) as V3));
    const S = (v: V3) => (scalar ? v[0] : v);
    const type = String(m.type ?? '');
    const until = Number(m.until);
    const clampT = (t: number) => (Number.isFinite(until) && until > 0 ? Math.min(t, until) : t);
    switch (type) {
      case 'accel': case 'linear': case 'uniform': {
        const p0 = start(), v0 = V('v0', [0, 0, 0]), a = type === 'accel' ? V('a', [0, 0, 0]) : [0, 0, 0] as V3;
        return { kind: type, fn: (t0) => { const t = clampT(t0); return S(add(add(p0, v0, t), a, 0.5 * t * t)); } };
      }
      case 'projectile': {
        const p0 = start(), v = N('v0', 5), ang = N('angle', 0) * D2R, g = N('g', this.scope(0).v.g ?? 10);
        const vx = v * Math.cos(ang), vy = v * Math.sin(ang);
        const floor = Number.isFinite(Number(m.floor)) ? Number(m.floor) : this.groundTopUnder(o);
        let tLand = Infinity;
        if (floor !== null && g > 0) {
          const c = p0[1] - floor - this.halfThick(o, 0);
          const disc = vy * vy + 2 * g * c;
          if (disc >= 0) tLand = (vy + Math.sqrt(disc)) / g;
        }
        return { kind: type, fn: (t0) => { const t = Math.min(clampT(t0), tLand); return [p0[0] + vx * t, p0[1] + vy * t - 0.5 * g * t * t, p0[2]]; } };
      }
      case 'circle': {
        const c = this.pointSpec(m.center, 0) ?? (this.vec(o, 'pos', 0, [0, 0, 0]) as V3);
        const r = N('r', 1), ccw = m.dir !== 'cw';
        const w = Number.isFinite(N('omega', NaN)) ? N('omega', 1) : (2 * Math.PI) / Math.max(0.05, N('period', 4));
        const a0 = N('start', 0) * D2R, plane = String(m.plane ?? (this.spec.up === 'z' ? 'xy' : 'xy'));
        return {
          kind: type,
          fn: (t0) => {
            const a = a0 + (ccw ? 1 : -1) * w * clampT(t0), ca = r * Math.cos(a), sa = r * Math.sin(a);
            return plane === 'xz' ? [c[0] + ca, c[1], c[2] - sa] : plane === 'yz' ? [c[0], c[1] + ca, c[2] - sa] : [c[0] + ca, c[1] + sa, c[2]];
          },
        };
      }
      case 'shm': {
        const p0 = start(), A = N('amp', 1), T = Math.max(0.05, N('period', 2)), ph = N('phase', 0) * D2R;
        const ax = scalar ? 0 : ['x', 'y', 'z'].indexOf(String(m.axis ?? 'x'));
        const fromCenter = m.start === 'center';
        return {
          kind: type,
          fn: (t) => {
            const d = A * (fromCenter ? Math.sin((2 * Math.PI * t) / T + ph) : Math.cos((2 * Math.PI * t) / T + ph));
            if (scalar) return p0[0] + d;
            const p: V3 = [...p0]; p[Math.max(0, ax)] += d; return p;
          },
        };
      }
      case 'phases': {
        const p0 = start(), v0 = V('v0', [0, 0, 0]);
        const list = (Array.isArray(m.phases) ? m.phases : []).slice(0, 8) as Record<string, unknown>[];
        const segs: { t0: number; dur: number; p: V3; v: V3; a: V3 }[] = [];
        let tt = 0, p = p0, v = v0;
        for (const ph of list) {
          const dur = Math.max(0, Number(ph.dur) || 0);
          const ar = ph.a;
          const a: V3 = Array.isArray(ar) ? [0, 1, 2].map((i) => Number(ar[i]) || 0) as V3 : [Number(ar) || 0, 0, 0];
          segs.push({ t0: tt, dur, p, v, a });
          p = add(add(p, v, dur), a, 0.5 * dur * dur); v = add(v, a, dur); tt += dur;
        }
        const endStop = m.stop === true;
        return {
          kind: type,
          fn: (t) => {
            let seg = segs[segs.length - 1];
            for (const s of segs) if (t < s.t0 + s.dur) { seg = s; break; }
            if (!seg) return S(p0);
            let dt = Math.max(0, t - seg.t0);
            if (endStop && t > tt) dt = seg.dur;
            return S(add(add(seg.p, seg.v, dt), seg.a, 0.5 * dt * dt));
          },
        };
      }
      case 'keys': {
        const keys = (Array.isArray(m.keys) ? m.keys : []).map((k) => {
          const kk = k as Record<string, unknown>;
          const at = Number(kk.t);
          const raw = kk.pos ?? kk.s ?? kk.v;
          const pos: V3 = Array.isArray(raw) ? [0, 1, 2].map((i) => Number(raw[i]) || 0) as V3 : [Number(raw) || 0, 0, 0];
          return { t: Number.isFinite(at) ? at : 0, pos };
        }).sort((a, b) => a.t - b.t);
        if (!keys.length) return null;
        const smooth = m.ease !== 'linear';
        return {
          kind: type,
          fn: (t) => {
            if (t <= keys[0].t) return S(keys[0].pos);
            for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) {
              const a = keys[i - 1], b = keys[i], k0 = (t - a.t) / Math.max(1e-6, b.t - a.t), k = smooth ? k0 * k0 * (3 - 2 * k0) : k0;
              return S(add(a.pos, sub(b.pos, a.pos), k));
            }
            return S(keys[keys.length - 1].pos);
          },
        };
      }
      case 'spin': {
        const T = N('period', 4), base = this.vec(o, 'pos', 0, [0, 0, 0]) as V3;
        return { kind: type, fn: () => (scalar ? this.num(o, 's', 0, 0) : base), rot: (t) => (360 * t) / Math.max(0.05, T) * (m.dir === 'cw' ? -1 : 1) };
      }
    }
    return null;
  }
  /** 物体正下方的地面顶面高度（抛体落地用） */
  private groundTopUnder(o: S3DObject): number | null {
    let best: number | null = null;
    const p = this.vec(o, 'pos', 0, [0, 0, 0])!;
    for (const g of this.spec.objects) if (g.type === 'ground') {
      const gp = this.vec(g, 'pos', 0, [0, 0, 0])!;
      if (gp[1] <= p[1] + 1e-6 && (best === null || gp[1] > best)) best = gp[1];
    }
    return best;
  }

  // ── 位置 ─────────────────────────────────────────────
  /** 对象中心的规格坐标 */
  posSpec(id: string, t: number): V3 | null {
    const key = id + '@' + t;
    const hit = this.posCache.get(key);
    if (hit) return hit;
    const o = this.byId.get(id);
    if (!o || this.depth > 8) return null;
    this.depth++;
    let p: V3 | null = null;
    try { p = this.computePos(o, t); }
    finally { this.depth--; }
    if (p) { if (this.posCache.size > 4000) this.posCache.clear(); this.posCache.set(key, p); }
    return p;
  }
  private computePos(o: S3DObject, t: number): V3 | null {
    const r = this.recipe(o);
    if (typeof o.on === 'string') {
      const f = this.frame(o.on, t);
      if (f) {
        const s = r ? (r.fn(t) as number) : this.num(o, 's', t, f.length / 2);
        const sc = typeof s === 'number' ? s : (s as V3)[0];
        const z = this.vec(o, 'pos', t, [0, 0, 0])![2];
        return add(add(add(f.o, f.u, sc), f.n, this.halfThick(o, t)), [0, 0, z]);
      }
    }
    if (r) { const v = r.fn(t); if (Array.isArray(v)) return v; }
    switch (o.type) {
      case 'pendulum': { const g = this.pendulum(o, t); return g.bob; }
      case 'earth': return this.earth(o, t).pos;
      case 'moon': {
        const c = typeof o.around === 'string' ? this.posSpec(o.around, t) : null;
        if (!c) break;
        const T = this.num(o, 'period', t, 4), d = this.num(o, 'dist', t, 2.2), a = (2 * Math.PI * t) / Math.max(0.1, T);
        return this.spec.up === 'z' ? [c[0] + d * Math.sin(a), c[1] - d * Math.cos(a), c[2]] : [c[0] + d * Math.sin(a), c[1], c[2] + d * Math.cos(a)];
      }
      case 'solid': return this.solid(o, t).center;
      case 'point': case 'label': {
        const pr = o.pos;
        if (typeof pr === 'string') return this.pointSpec(pr, t);
        break;
      }
    }
    if (o.type === 'incline') return this.incline(o, t).low;
    return this.vec(o, 'pos', t, [0, 0, 0]);
  }
  /** 物体的转角（度，绕规格 z 轴）：放在斜面上随斜面，滚动的小球按路程转 */
  rot(o: S3DObject, t: number): number {
    const r = this.recipe(o);
    let base = this.num(o, 'rot', t, 0);
    if (typeof o.on === 'string') {
      const f = this.frame(o.on, t);
      if (f) {
        if (o.type === 'ball') { const s = this.metric(o.id, 's', t); base += (-s / Math.max(0.05, this.num(o, 'r', t, DEF.ballR))) / D2R; }
        else base += f.angle;
      }
    }
    if (r?.rot) base += r.rot(t);
    return base;
  }
  pos(id: string, t: number): V3 | null { const p = this.posSpec(id, t); return p ? this.w(p) : null; }

  /** 点引用 → 规格坐标 */
  pointSpec(ref: unknown, t: number): V3 | null {
    if (Array.isArray(ref)) {
      const s = this.scope(t);
      return [0, 1, 2].map((i) => {
        const x = ref[i];
        if (typeof x === 'number') return x;
        if (typeof x === 'string') { const f = this.compileCached(x); return f ? f(s) : 0; }
        return 0;
      }) as V3;
    }
    if (typeof ref !== 'string') return null;
    const name = ref.trim();
    const mid = /^mid\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i.exec(name);
    if (mid) { const a = this.pointSpec(mid[1], t), b = this.pointSpec(mid[2], t); return a && b ? scale(add(a, b), 0.5) : null; }
    const lerp = /^lerp\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i.exec(name);
    if (lerp) { const a = this.pointSpec(lerp[1], t), b = this.pointSpec(lerp[2], t), k = Number(lerp[3]); return a && b && Number.isFinite(k) ? add(a, sub(b, a), k) : null; }
    const v = this.vertexOwner.get(name);
    if (v) { const s = this.byId.get(v[0])!; return this.solidVerts(s, t)[v[1]] ?? null; }
    if (this.byId.has(name)) return this.posSpec(name, t);
    for (const o of this.spec.objects) if (o.type === 'point' && o.label === name) return this.posSpec(o.id, t);
    return null;
  }
  point(ref: unknown, t: number): V3 | null { const p = this.pointSpec(ref, t); return p ? this.w(p) : null; }
  private exprCache = new Map<string, Fn | null>();
  private compileCached(src: string): Fn | null {
    if (!this.exprCache.has(src)) this.exprCache.set(src, this.compileExpr(src));
    return this.exprCache.get(src)!;
  }

  // ── 专门器材 ─────────────────────────────────────────
  pendulum(o: S3DObject, t: number) {
    const pivot = this.vec(o, 'pivot', t, null) ?? this.vec(o, 'pos', t, [0, 3, 0])!;
    const L = Math.max(0.1, this.num(o, 'length', t, 2));
    let ang: number;
    if (this.has(o, 'angle')) ang = this.num(o, 'angle', t, 0);
    else {
      const a0 = this.num(o, 'angle0', t, 15), g = this.num(o, 'g', t, this.scope(t).v.g ?? 10);
      ang = a0 * Math.cos(Math.sqrt(g / L) * t);
    }
    const a = ang * D2R;
    const bob: V3 = [pivot[0] + L * Math.sin(a), pivot[1] - L * Math.cos(a), pivot[2]];
    return { pivot, bob, angle: ang, L };
  }
  earth(o: S3DObject, t: number) {
    const tilt = this.num(o, 'tilt', t, 23.44);
    const orb = o.orbit as Record<string, unknown> | undefined;
    let pos = this.vec(o, 'pos', t, [0, 0, 0])!, phi = NaN, center: V3 | null = null, R = 0;
    if (orb && typeof orb === 'object') {
      center = this.pointSpec(orb.center ?? [0, 0, 0], t) ?? [0, 0, 0];
      R = Number(orb.r) > 0 ? Number(orb.r) : 6;
      const T = Number(orb.period) > 0 ? Number(orb.period) : this.D;
      phi = (Number(orb.start) || 0) + (360 * t) / T;
      const a = phi * D2R;
      pos = this.spec.up === 'z' ? [center[0] + R * Math.sin(a), center[1] - R * Math.cos(a), center[2]] : [center[0] + R * Math.sin(a), center[1], center[2] + R * Math.cos(a)];
    }
    // 地轴：在世界坐标里向 -x 倾斜（夏至时北极朝向太阳）
    const e = tilt * D2R;
    const axisW: V3 = [-Math.sin(e), Math.cos(e), 0];
    // 太阳方向（世界坐标，从地球指向太阳）
    let sunW: V3;
    const sun = this.spec.objects.find((x) => x.type === 'sun');
    const posW = this.w(pos);
    if (center) sunW = norm(sub(this.w(center), posW));
    else if (sun) sunW = norm(sub(this.pos(sun.id, t) ?? [0, 0, 0], posW));
    else { const lf = this.vec(o, 'lightFrom', t, [1, 0, 0])!; sunW = norm(this.w(lf)); }
    const lat = Math.asin(Math.max(-1, Math.min(1, dot(axisW, sunW)))) / D2R;
    const doy = Number.isFinite(phi) ? ((79 + (((phi % 360) + 360) % 360) / 360 * 365.25) % 365.25) : NaN;
    const spinT = this.num(o, 'spin', t, orb ? 0 : 4);
    const spin = spinT > 0 ? (360 * t) / spinT : 0;
    return { pos, posW, axisW, sunW, lat, phi, doy, spin, tilt, R, center };
  }
  conveyorShift(o: S3DObject, t: number) { return this.num(o, 'speed', t, 1) * t; }

  /** 立体图形的顶点（规格坐标） */
  solidVerts(o: S3DObject, t: number): V3[] { return this.solid(o, t).verts; }
  solid(o: S3DObject, t: number) { return solidGeometry(o, this.vec(o, 'pos', t, [0, 0, 0])!, this.rot(o, t), this.spec.up); }

  // ── 指标（A.x、A.v、E.lat…） ────────────────────────────
  metric(id: string, prop: string, t: number): number {
    const o = this.byId.get(id);
    if (!o || this.depth > 6) return 0;
    if (o.type === 'earth' && (prop === 'lat' || prop === 'day' || prop === 'month' || prop === 'angle')) {
      const e = this.earth(o, t);
      return prop === 'lat' ? e.lat : prop === 'angle' ? e.phi : prop === 'day' ? e.doy : Math.floor(e.doy / 30.44) + 1;
    }
    if (o.type === 'pendulum' && (prop === 'angle' || prop === 'rot')) return this.pendulum(o, t).angle;
    if (prop === 'angle' || prop === 'rot') return this.rot(o, t);
    if (prop === 's') {
      const r = this.recipe(o);
      if (typeof o.on === 'string' && this.frame(o.on, t)) { if (r) { const v = r.fn(t); return typeof v === 'number' ? v : v[0]; } return this.num(o, 's', t, 0); }
      const p0 = this.posSpec(id, 0), p = this.posSpec(id, t);
      return p0 && p ? len(sub(p, p0)) : 0;
    }
    const h = 1e-3;
    const p = this.posSpec(id, t);
    if (!p) return 0;
    if (prop === 'x' || prop === 'y' || prop === 'z') return p['xyz'.indexOf(prop)];
    const a = this.posSpec(id, Math.max(0, t - h)), b = this.posSpec(id, t + h);
    if (!a || !b) return 0;
    const dt = t + h - Math.max(0, t - h);
    const v = scale(sub(b, a), 1 / dt);
    if (prop === 'vx' || prop === 'vy' || prop === 'vz') return v['xyz'.indexOf(prop[1])];
    if (prop === 'v' || prop === 'speed') return len(v);
    if (prop === 'ax' || prop === 'ay' || prop === 'a') {
      const H = 0.01, pa = this.posSpec(id, Math.max(0, t - H)), pb = this.posSpec(id, t + H), pm = this.posSpec(id, Math.max(H, t));
      if (!pa || !pb || !pm) return 0;
      const acc = scale(add(sub(pb, pm), sub(pa, pm)), 1 / (H * H));
      return prop === 'ax' ? acc[0] : prop === 'ay' ? acc[1] : len(acc);
    }
    return 0;
  }

  /** 世界坐标下的包围盒（采样整个时间轴），给机位自动取景用 */
  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    const grow = (p: V3 | null, r = 0) => { if (!p || !p.every(Number.isFinite)) return; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i] - r); max[i] = Math.max(max[i], p[i] + r); } };
    const ts = [0, 0.25, 0.5, 0.75, 1].map((k) => k * this.D);
    for (const o of this.spec.objects) {
      for (const t of ts) for (const p of this.extentPoints(o, t)) grow(p[0], p[1]);
    }
    if (!Number.isFinite(min[0])) return { min: [-3, -2, -2], max: [3, 2, 2] };
    return { min, max };
  }
  /** 一个对象在 t 时刻占据的代表点（世界坐标）和半径 */
  extentPoints(o: S3DObject, t: number): [V3 | null, number][] {
    const P = (v: V3 | null): V3 | null => (v ? this.w(v) : null);
    switch (o.type) {
      case 'ground': { const p = this.vec(o, 'pos', t, [0, 0, 0])!, s = this.vec(o, 'size', t, [DEF.groundLen, DEF.groundDepth, 0])!; return [[P([p[0] - s[0] / 2, p[1], p[2]]), 0.2], [P([p[0] + s[0] / 2, p[1], p[2]]), 0.2]]; }
      case 'incline': { const g = this.incline(o, t); return [[P(g.low), 0.3], [P(add(g.low, g.u, g.length)), 0.5], [P(add(g.low, [g.dir === 'right' ? g.base : -g.base, 0, 0])), 0.3]]; }
      case 'conveyor': { const f = this.frame(o.id, t)!; return [[P(f.o), 0.5], [P(add(f.o, f.u, f.length)), 0.5]]; }
      case 'rope': case 'spring': case 'rod': case 'segment': case 'measure': return [[this.point(o.from, t), 0.1], [this.point(o.to, t), 0.1]];
      case 'arrow': return [];
      case 'angle': case 'trail': case 'label': return [];
      case 'pendulum': { const g = this.pendulum(o, t); return [[P(g.pivot), 0.3], [P(g.bob), this.num(o, 'r', t, 0.3)]]; }
      case 'axes': {
        const p = this.vec(o, 'pos', t, [0, 0, 0])!, X = this.vec(o, 'x', t, [-3, 3, 0])!, Y = this.vec(o, 'y', t, [-3, 3, 0])!, Z = this.vec(o, 'z', t, [0, 0, 0])!;
        return [[P(add(p, [X[0], Y[0], Z[0]])), 0.2], [P(add(p, [X[1], Y[1], Z[1]])), 0.4]];
      }
      case 'surface': {
        const X = this.vec(o, 'x', t, [-2, 2, 0])!, Y = this.vec(o, 'y', t, [-2, 2, 0])!;
        return [[P([X[0], Y[0], 0]), 0.5], [P([X[1], Y[1], 0]), 0.5]];
      }
      case 'solid': return this.solidVerts(o, t).map((v) => [P(v), 0.15] as [V3 | null, number]);
      case 'polygon': case 'plane': return ((o.points as unknown[]) ?? []).map((p) => [this.point(p, t), 0.1] as [V3 | null, number]);
      case 'sphere': return [[this.point(o.center, t), this.num(o, 'r', t, 1)]];
      case 'field': { const p = this.vec(o, 'pos', t, [0, 1.5, 0])!, s = this.vec(o, 'size', t, [6, 3, 1])!; return [[P(sub(p, scale(s, 0.5))), 0], [P(add(p, scale(s, 0.5))), 0]]; }
      case 'wave': { const p = this.vec(o, 'pos', t, [-4, 1, 0])!, L = this.num(o, 'length', t, 8), A = this.num(o, 'amp', t, 0.5); return [[P(add(p, [0, -A, 0])), 0.2], [P(add(p, [L, A, 0])), 0.2]]; }
      case 'earth': { const e = this.earth(o, t), r = this.num(o, 'r', t, DEF.earthR); const out: [V3 | null, number][] = [[e.posW, r * 1.3]]; if (e.center) out.push([this.w(e.center), e.R + r]); return out; }
      case 'orbit': { const c = this.point(o.center ?? [0, 0, 0], t); return [[c, this.num(o, 'r', t, 6)]]; }
      case 'molecule': case 'crystal': case 'cell': case 'atom': return [[this.pos(o.id, t), 2.2 * this.num(o, 'scale', t, 1)]];
      case 'dna': { const p = this.pos(o.id, t) ?? [0, 0, 0], L = this.num(o, 'length', t, 6); return [[add(p, [0, -L / 2, 0]), 1.2], [add(p, [0, L / 2, 0]), 1.2]]; }
      case 'timeline': { const p = this.vec(o, 'pos', t, [0, 0, 0])!, L = this.num(o, 'length', t, 12); return [[P(add(p, [-L / 2, -1, 0])), 0.5], [P(add(p, [L / 2, 1.5, 0])), 0.5]]; }
      case 'curve': return curvePoints(this, o, t, 12).map((p) => [p, 0.1] as [V3 | null, number]);
      case 'box': case 'cart': { const s = this.vec(o, 'size', t, o.type === 'box' ? DEF.box : DEF.cart)!; return [[this.pos(o.id, t), Math.hypot(s[0], s[1]) / 2]]; }
      case 'sun': return [[this.pos(o.id, t), this.num(o, 'r', t, DEF.sunR) * 1.4]];
      default: return BODY_TYPES.has(o.type) ? [[this.pos(o.id, t), this.num(o, 'r', t, 0.4)]] : [];
    }
  }
}

/** 立体图形的默认顶点名 */
export function solidNames(o: S3DObject): string[] {
  const shape = String(o.shape ?? 'cube');
  const n = Array.isArray(o.names) ? (o.names as unknown[]).map(String) : typeof o.names === 'string' ? splitNames(o.names) : null;
  const def: Record<string, string[]> = {
    cube: ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1'], cuboid: ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1'],
    tetra: ['A', 'B', 'C', 'P'], pyramid: ['A', 'B', 'C', 'D', 'P'], prism: ['A', 'B', 'C', 'A1', 'B1', 'C1'],
    cylinder: [], cone: ['P'], sphere: ['O'],
  };
  const base = def[shape] ?? def.cube;
  return base.map((d, i) => (n && n[i] ? n[i] : d));
}
/** "ABCD-A1B1C1D1" / "P-ABC" → 顶点名列表（P-ABC 的顶点 P 放在最后） */
export function splitNames(s: string): string[] {
  const t = s.replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)).replace(/\s/g, '');
  const parts = t.split(/[-—–]/);
  const tok = (x: string) => x.match(/[A-Z][0-9′'’]*/g) ?? [];
  if (parts.length === 2 && tok(parts[0]).length === 1) return [...tok(parts[1]), ...tok(parts[0])];
  return parts.flatMap(tok);
}

/** 立体图形的几何：顶点、棱、面（凸多面体）。坐标为规格坐标，A 在 pos（底面一角），向 +x、+y 展开，高度沿 up 轴。 */
export function solidGeometry(o: S3DObject, pos: V3, rotDeg = 0, up: 'y' | 'z' = 'z'): { verts: V3[]; edges: [number, number][]; faces: number[][]; round?: 'cylinder' | 'cone' | 'sphere'; r?: number; h?: number; center: V3 } {
  const shape = String(o.shape ?? 'cube');
  const sz = o.size;
  const arr = Array.isArray(sz) ? (sz as unknown[]).map(Number) : typeof sz === 'number' ? [sz] : [];
  const a = arr[0] > 0 ? arr[0] : 2, b = arr[1] > 0 ? arr[1] : shape === 'cuboid' ? a * 1.4 : a, c = arr[2] > 0 ? arr[2] : shape === 'cuboid' ? a * 0.8 : shape === 'pyramid' || shape === 'tetra' ? a * 0.9 : a;
  // 局部坐标 (x, 深度 y, 高 h)，高度沿 up 轴
  const mk = (x: number, y: number, h: number): V3 => [x, y, h];
  const rc = Math.cos(rotDeg * D2R), rs = Math.sin(rotDeg * D2R);
  const place = (v: V3): V3 => { const X = v[0] * rc - v[1] * rs, Y = v[0] * rs + v[1] * rc; return up === 'y' ? [pos[0] + X, pos[1] + v[2], pos[2] - Y] : [pos[0] + X, pos[1] + Y, pos[2] + v[2]]; };
  let verts: V3[] = [], edges: [number, number][] = [], faces: number[][] = [];
  let round: 'cylinder' | 'cone' | 'sphere' | undefined, r: number | undefined, h: number | undefined;
  if (shape === 'cube' || shape === 'cuboid') {
    verts = [mk(0, 0, 0), mk(a, 0, 0), mk(a, b, 0), mk(0, b, 0), mk(0, 0, c), mk(a, 0, c), mk(a, b, c), mk(0, b, c)];
    edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  } else if (shape === 'tetra') {
    // 正三棱锥 P-ABC：底面正三角形，P 在底面中心正上方
    const s3 = Math.sqrt(3);
    verts = [mk(0, 0, 0), mk(a, 0, 0), mk(a / 2, (a * s3) / 2, 0), mk(a / 2, (a * s3) / 6, c)];
    edges = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]];
    faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
  } else if (shape === 'pyramid') {
    verts = [mk(0, 0, 0), mk(a, 0, 0), mk(a, b, 0), mk(0, b, 0), mk(a / 2, b / 2, c)];
    edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]];
    faces = [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
  } else if (shape === 'prism') {
    const s3 = Math.sqrt(3);
    verts = [mk(0, 0, 0), mk(a, 0, 0), mk(a / 2, (a * s3) / 2, 0), mk(0, 0, c), mk(a, 0, c), mk(a / 2, (a * s3) / 2, c)];
    edges = [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [0, 3], [1, 4], [2, 5]];
    faces = [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]];
  } else {
    round = shape === 'cone' ? 'cone' : shape === 'sphere' ? 'sphere' : 'cylinder';
    r = a / 2; h = shape === 'sphere' ? a : c;
    verts = shape === 'cone' ? [mk(0, 0, h)] : shape === 'sphere' ? [mk(0, 0, 0)] : [];
  }
  const placed = verts.map(place);
  const center = placed.length ? scale(placed.reduce((s, v) => add(s, v), [0, 0, 0] as V3), 1 / placed.length) : pos;
  return { verts: placed, edges, faces, round, r, h, center };
}

/** 曲线采样（世界坐标） */
export function curvePoints(w: World, o: S3DObject, t: number, n = 200): V3[] {
  const out: V3[] = [];
  const s = w.scope(t);
  if (typeof o.fn === 'string') {
    const xr = Array.isArray(o.x) ? (o.x as unknown[]).map(Number) : [-5, 5];
    const f = w.compileExpr(o.fn, ['x']);
    if (!f) return out;
    const v = { ...s.v };
    const sc = { v, m: s.m };
    const pos = w.vec(o, 'pos', t, [0, 0, 0])!;
    for (let i = 0; i <= n; i++) {
      const x = xr[0] + ((xr[1] - xr[0]) * i) / n; v.x = x;
      const y = f(sc);
      out.push(w.w(w.spec.up === 'z' ? [pos[0] + x, pos[1], pos[2] + y] : [pos[0] + x, pos[1] + y, pos[2]]));
    }
    return out;
  }
  if (Array.isArray(o.points)) {
    for (const p of o.points as unknown[]) { const q = w.point(p, t); if (q) out.push(q); }
    return out;
  }
  const ur = Array.isArray(o.u) ? w.vec(o, 'u', t, [0, 1, 0])! : [0, 1, 0];
  const fx = w.compileExpr(o.x as unknown, ['u']), fy = w.compileExpr(o.y as unknown, ['u']), fz = w.compileExpr(o.z as unknown, ['u']);
  if (!fx && !fy && !fz) return out;
  const v = { ...s.v }, sc = { v, m: s.m };
  for (let i = 0; i <= n; i++) {
    v.u = ur[0] + ((ur[1] - ur[0]) * i) / n;
    out.push(w.w([fx ? fx(sc) : 0, fy ? fy(sc) : 0, fz ? fz(sc) : 0]));
  }
  return out;
}
