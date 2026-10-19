// ── 物理引擎：Scene → planck 世界，确定性固定步长，整段时间轴预计算 ─────────────
//
// 坐标：世界坐标 = 页面坐标 / ppm（米），y 向下（与页面一致），重力 = (0, +g)。
//       planck 的角度在 y 向下坐标系里顺时针为正，正好等于 PhysObj.rot。
// 时间：固定步长 DT = 1/240 s，从 t=0 一路算到 duration，每一步都记录。
//       老师端与学生窗口各自用同一个 Scene 构建，得到逐位相同的时间轴；
//       拖动进度条只是查表，不做状态恢复，所以两端永远不会因为「回退」而分叉。
// 带电粒子：不进 planck，用 Boris 推进器精确积分 q(E + v×B)（半径误差 ~1e-5），没有速度上限。
import { Box, Chain, Circle, DistanceJoint, Polygon, PrismaticJoint, PulleyJoint, RopeJoint, Settings, Vec2, World } from 'planck';
import type { Body, Contact, Fixture, Joint } from 'planck';
import type { PhysObj, Scene } from '../model';

// 恢复系数只对相对法向速度 > 0.05 m/s 的接触生效（planck 默认 1 m/s 会吞掉慢速碰撞）
Settings.velocityThreshold = 0.05;

export const DT = 1 / 240;
const VEL_IT = 12, POS_IT = 6;
const MAX_STEPS = 240 * 40;

export type FKind = 'G' | 'N' | 'f' | 'spring' | 'T' | 'rod' | 'E' | 'B' | 'F';
/** 力（N），世界坐标 y 向下 */
export interface Force { k: FKind; x: number; y: number; label: string }
/** 一个物体在某一步的状态（米、米/秒，y 向下） */
export interface BState { x: number; y: number; a: number; vx: number; vy: number; ax: number; ay: number; f: Force[]; alive: boolean }
export interface CState { ax: number; ay: number; bx: number; by: number; len: number; force: number; active: boolean }
export interface Frame { t: number; b: BState[]; c: CState[]; ek: number; ep: number; es: number; q: number }

export type EvKind = 'cospeed' | 'collide' | 'apex' | 'leave' | 'land' | 'field' | 'hit' | 'release' | 'slack';
export interface SimEvent { t: number; kind: EvKind; label: string; id: string; x: number; y: number; v?: number }

export interface SimBody {
  id: string; idx: number; obj: PhysObj;
  kind: 'dyn' | 'particle';
  m: number; q: number; grav: boolean;
  body?: Body;
  // 粒子状态
  px: number; py: number; pvx: number; pvy: number; alive: boolean;
}
export interface SimStatic { id: string; obj: PhysObj; body?: Body; speed: number; r: number }
export interface SimConn {
  id: string; obj: PhysObj; kind: 'spring' | 'rope' | 'rod' | 'pulley' | 'track';
  a: Body; b: Body; la: Vec2; lb: Vec2; aIdx: number; bIdx: number;
  k: number; L0: number; attached: boolean; released: boolean;
  joint?: Joint;
  via?: { cx: number; cy: number; r: number; gax: number; gay: number; gbx: number; gby: number; L: number };
  slack?: boolean;
}
/** x0..y1 是外接矩形；cx/cy/hw/hh/c/s 描述可能旋转过的真实区域（c、s 为器材 rot 的余弦、正弦） */
export interface FieldRegion { id: string; obj: PhysObj; kind: 'B' | 'E'; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; hw: number; hh: number; c: number; s: number; Bz: number; Ex: number; Ey: number; plates: boolean }

interface Info { dyn: boolean; idx: number; sid: number; mu?: number; e?: number; kind: string; obj: PhysObj; up?: [number, number]; u?: [number, number]; speed: number }

export const DYN_KINDS = new Set(['block', 'cart', 'ball', 'plank', 'weight', 'person', 'car', 'boat', 'rocket']);
export const PARTICLE_KINDS = new Set(['charge-pos', 'charge-neg']);
export const STATIC_KINDS = new Set(['incline', 'ground', 'wall', 'ceiling', 'conveyor', 'track-circle', 'track-arc', 'hinge', 'pulley']);
export const CONN_KINDS = new Set(['spring', 'rope', 'rod']);
export const FIELD_KINDS = new Set(['field-b-in', 'field-b-out', 'field-e']);

export function num(o: PhysObj, k: string, def: number): number {
  const v = o.props?.[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) return +v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return def;
}
export function has(o: PhysObj, k: string) { const v = o.props?.[k]; return v !== undefined && v !== '' && v !== null; }
export function flag(o: PhysObj, k: string) { const v = o.props?.[k]; return v === true || v === 1 || v === 'true' || v === '1'; }
const optNum = (o: PhysObj, k: string) => (has(o, k) ? num(o, k, NaN) : undefined);
const ROUND = (x: number) => Math.round(x * 100) / 100;

/** 课本约定：37° 取 sin=0.6、cos=0.8；53° 反之（实际角 atan(3/4)），这样读数与课本答案一致 */
export function texRad(deg: number): number {
  if (Math.abs(deg - 37) < 1e-9) return Math.atan2(3, 4);
  if (Math.abs(deg - 53) < 1e-9) return Math.atan2(4, 3);
  return (deg * Math.PI) / 180;
}

/** 斜面：若给了 props.angle，就按角度修正高度（底边不动）。返回实际几何。 */
export function inclineGeom(o: PhysObj): PhysObj {
  if (!has(o, 'angle') || Math.abs(o.rot) > 1e-6) return o;
  const deg = Math.max(1, Math.min(80, num(o, 'angle', 30)));
  const h = o.w * Math.tan(texRad(deg));
  if (Math.abs(h - o.h) < 1e-4) return o;
  const bottom = o.y + o.h / 2;
  return { ...o, h, y: bottom - h / 2 };
}

/** 斜面三角形顶点（局部坐标，页面单位，y 向下）。默认直角在右下：从左下向右上升；flip 镜像。 */
export function inclineVerts(o: PhysObj): [number, number][] {
  const w = o.w / 2, h = o.h / 2;
  return flag(o, 'flip') ? [[-w, h], [w, h], [-w, -h]] : [[-w, h], [w, h], [w, -h]];
}

export class SimRun {
  readonly scene: Scene;
  readonly ppm: number;
  readonly g: number;
  readonly dt = DT;
  readonly duration: number;
  /** 带电粒子的时间缩放：显示 1 s = ts 秒物理时间（微观粒子慢放） */
  readonly ts: number;
  /** 每个记录步内的子步数（绳 / 轨道上的高速圆周运动需要更细的步长，否则约束投影会耗散能量） */
  readonly sub: number;
  private h = DT;
  readonly world: World;
  bodies: SimBody[] = [];
  statics: SimStatic[] = [];
  conns: SimConn[] = [];
  fields: FieldRegion[] = [];
  decor: PhysObj[] = [];
  frames: Frame[] = [];
  events: SimEvent[] = [];
  readonly y0: number[] = [];

  private evOn: Set<EvKind>;
  private evCount = new Map<string, number>();
  private ground!: Body;
  private t = 0;
  private stepForces: Force[][] = [];
  private heat = 0;
  private pairs = new Map<string, { mu: number; vt: number; vtp: number; vtpp: number; sliding: boolean; n: number; since: number; last: number; touched: boolean; done: boolean }>();
  private touching: number[] = [];
  private airSince: number[] = [];
  private inField: boolean[][] = [];
  private tenseMax: number[] = [];
  private rising: boolean[] = [];

  /** 总步数；frames.length - 1 === 已计算的步数 */
  readonly steps: number;
  get done() { return this.frames.length > this.steps; }
  /** 已计算到的时间 */
  get computed() { return (this.frames.length - 1) * DT; }

  constructor(scene: Scene, opts: { events?: EvKind[]; full?: boolean } = {}) {
    this.scene = scene;
    this.ppm = scene.world?.ppm > 0 ? scene.world.ppm : 0.1;
    this.g = Number.isFinite(scene.world?.g) ? scene.world.g : 10;
    const ts = Number(scene.params?.timeScale);
    this.ts = Number.isFinite(ts) && ts > 0 ? ts : 1;
    const sb = Math.round(Number(scene.params?.substeps));
    this.sub = Number.isFinite(sb) && sb > 1 ? Math.min(32, sb) : 1;
    this.h = DT / this.sub;
    this.duration = Math.max(0.5, Math.min(MAX_STEPS * DT, scene.duration ?? 8));
    this.evOn = new Set(opts.events ?? ['cospeed', 'collide', 'leave', 'land', 'field', 'hit', 'release', 'slack', 'apex']);
    this.world = new World({ gravity: Vec2(0, this.g) });
    this.ground = this.world.createBody();
    this.build();
    this.hook();
    this.record();
    this.steps = Math.ceil(this.duration / DT - 1e-9);
    if (opts.full) this.ensure(this.duration);
  }

  /** 保证 t 之前的帧都已算好（同步）。 */
  ensure(t: number) {
    const need = Math.min(this.steps, Math.ceil(Math.min(t, this.duration) / DT - 1e-9) + 1);
    while (this.frames.length <= need && !this.done) this.advance();
  }
  /** 在时间预算内往后算一段（rAF 里调用，避免一次性卡顿）。返回是否全部算完。 */
  pump(ms = 6) {
    const end = performance.now() + ms;
    while (!this.done) {
      for (let i = 0; i < 24 && !this.done; i++) this.advance();
      if (performance.now() > end) break;
    }
    return this.done;
  }

  // ── 构建 ────────────────────────────────────────────────
  private W(p: number) { return p / this.ppm; }

  private build() {
    const objs = this.scene.objs ?? [];
    for (const o0 of objs) {
      const o = o0.kind === 'incline' ? inclineGeom(o0) : o0;
      if (FIELD_KINDS.has(o.kind)) this.addField(o);
      else if (PARTICLE_KINDS.has(o.kind) && !flag(o, 'rigid')) this.addParticle(o);
      else if (DYN_KINDS.has(o.kind) && !flag(o, 'fixed')) this.addDyn(o);
      else if (STATIC_KINDS.has(o.kind) || DYN_KINDS.has(o.kind)) this.addStatic(o);
      else if (!CONN_KINDS.has(o.kind)) this.decor.push(o);
    }
    for (const o of objs) if (CONN_KINDS.has(o.kind)) this.addConn(o);
    for (const b of this.bodies) {
      const walkOn = b.obj.props?.walkOn;
      if (walkOn && b.body) {
        const boat = this.bodies.find((x) => x.id === String(walkOn));
        if (boat?.body) {
          const L = num(b.obj, 'walkL', 2);
          this.world.createJoint(new PrismaticJoint({
            bodyA: boat.body, bodyB: b.body,
            localAnchorA: boat.body.getLocalPoint(b.body.getPosition()), localAnchorB: Vec2(0, 0), localAxisA: Vec2(1, 0),
            enableLimit: true, lowerTranslation: Math.min(0, L), upperTranslation: Math.max(0, L),
            enableMotor: true, motorSpeed: num(b.obj, 'walk', 1) * Math.sign(L || 1), maxMotorForce: 1e6,
          }));
        }
      }
    }
    // 内侧圆轨道：轨道只能把球往圆心推 ⇔ 一根「最大长度」约束（与绳完全等价），比折线链条精确得多
    for (const st of this.statics) {
      if (st.obj.kind !== 'track-circle' || !st.body) continue;
      const c = st.body.getPosition();
      const inside = this.bodies.filter((b) => b.body && Math.hypot(b.body.getPosition().x - c.x, b.body.getPosition().y - c.y) < st.r * 0.98);
      if (!inside.length || inside.some((b) => b.obj.kind !== 'ball')) continue;
      for (let f = st.body.getFixtureList(); f; ) { const nx = f.getNext(); st.body.destroyFixture(f); f = nx; }
      for (const b of inside) {
        const br = this.W(Math.min(b.obj.w, b.obj.h)) / 2;
        const joint = this.world.createJoint(new RopeJoint({ bodyA: st.body, bodyB: b.body!, localAnchorA: Vec2(0, 0), localAnchorB: Vec2(0, 0), maxLength: st.r - br })) ?? undefined;
        this.conns.push({ id: st.id + '>' + b.id, obj: st.obj, kind: 'track', a: st.body, b: b.body!, la: Vec2(0, 0), lb: Vec2(0, 0), aIdx: -1, bIdx: b.idx, k: 0, L0: st.r - br, attached: true, released: false, joint });
      }
    }
    for (const b of this.bodies) { this.y0.push(b.kind === 'particle' ? b.py : b.body!.getPosition().y); }
    this.touching = this.bodies.map(() => 0);
    this.airSince = this.bodies.map(() => 0);
    this.inField = this.bodies.map((b) => this.fields.map((f) => this.inside(f, b.kind === 'particle' ? b.px : b.body!.getPosition().x, b.kind === 'particle' ? b.py : b.body!.getPosition().y)));
    this.tenseMax = this.conns.map(() => 0);
    this.rising = this.bodies.map(() => false);
  }

  private addField(o: PhysObj) {
    const B = num(o, 'B', 1), E = num(o, 'E', 1);
    const ang = (num(o, 'angle', 0) * Math.PI) / 180;      // 电场方向：数学角（逆时针、y 向上），默认水平向右（与器材库「匀强电场 →」一致）
    // 器材整体旋转时，区域和场强方向跟着画面一起转（与 look.ts 先 rotate 再画箭头一致）
    const rot = Number.isFinite(o.rot) ? o.rot : 0, c = Math.cos(rot), s = Math.sin(rot);
    const hw = this.W(o.w / 2), hh = this.W(o.h / 2), ex = Math.abs(c) * hw + Math.abs(s) * hh, ey = Math.abs(s) * hw + Math.abs(c) * hh;
    const cx = this.W(o.x), cy = this.W(o.y), lx = Math.cos(ang), ly = -Math.sin(ang);
    this.fields.push({
      id: o.id, obj: o, kind: o.kind === 'field-e' ? 'E' : 'B',
      x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey, cx, cy, hw, hh, c, s,
      Bz: o.kind === 'field-b-out' ? B : o.kind === 'field-b-in' ? -B : 0,
      Ex: o.kind === 'field-e' ? E * (c * lx - s * ly) : 0,
      Ey: o.kind === 'field-e' ? E * (s * lx + c * ly) : 0,
      plates: flag(o, 'plates'),
    });
  }

  private addParticle(o: PhysObj) {
    const qAbs = Math.abs(num(o, 'q', 1));
    this.bodies.push({
      id: o.id, idx: this.bodies.length, obj: o, kind: 'particle',
      m: Math.max(1e-40, num(o, 'm', 1)), q: o.kind === 'charge-neg' ? -qAbs : num(o, 'q', 1),
      grav: flag(o, 'gravity'),
      px: this.W(o.x), py: this.W(o.y), pvx: num(o, 'vx', 0), pvy: -num(o, 'vy', 0), alive: true,
    });
  }

  private addDyn(o: PhysObj) {
    const idx = this.bodies.length;
    const m = Math.max(1e-3, num(o, 'm', 1));
    const body = this.world.createBody({
      type: 'dynamic', position: Vec2(this.W(o.x), this.W(o.y)), angle: o.rot,
      fixedRotation: !flag(o, 'rotate'), allowSleep: false,
      gravityScale: o.props?.gravity === false || o.props?.gravity === 'false' || o.props?.gravity === 0 ? 0 : 1,
    });
    const w = Math.max(0.02, this.W(o.w)), h = Math.max(0.02, this.W(o.h));
    // pt：质点接触（窄碰撞盒）——物块中心越过传送带 / 木板端点才离开，和课本「质点」模型一致
    if (o.kind === 'ball') body.createFixture(Circle(Math.min(w, h) / 2), { density: 1, friction: 0 });
    else body.createFixture(Box(flag(o, 'pt') ? Math.min(w / 2, 0.005) : w / 2, h / 2), { density: 1, friction: 0 });
    const I = o.kind === 'ball' ? 0.1 * m * Math.min(w, h) ** 2 : (m * (w * w + h * h)) / 12;
    body.setMassData({ mass: m, center: Vec2(0, 0), I });
    body.setLinearVelocity(Vec2(num(o, 'vx', 0), -num(o, 'vy', 0)));
    const info: Info = { dyn: true, idx, sid: -1, mu: optNum(o, 'mu'), e: optNum(o, 'e'), kind: o.kind, obj: o, speed: 0 };
    body.setUserData(info);
    this.bodies.push({ id: o.id, idx, obj: o, kind: 'dyn', m, q: 0, grav: body.getGravityScale() !== 0, body, px: 0, py: 0, pvx: 0, pvy: 0, alive: true });
  }

  private addStatic(o: PhysObj) {
    const sid = this.statics.length;
    const body = this.world.createBody({ type: 'static', position: Vec2(this.W(o.x), this.W(o.y)), angle: o.rot });
    const w = this.W(o.w), h = this.W(o.h);
    let r = 0;
    const fx = { density: 0, friction: 0 };
    switch (o.kind) {
      case 'incline': body.createFixture(Polygon(inclineVerts(o).map(([x, y]) => Vec2(this.W(x), this.W(y)))), fx); break;
      case 'ground': { const H = Math.max(h, 0.6); body.createFixture(Box(w / 2, H / 2, Vec2(0, -h / 2 + H / 2), 0), fx); break; }
      case 'ceiling': { const H = Math.max(h, 0.6); body.createFixture(Box(w / 2, H / 2, Vec2(0, h / 2 - H / 2), 0), fx); break; }
      case 'wall': body.createFixture(Box(Math.max(w, 0.1) / 2, h / 2), fx); break;
      case 'conveyor': body.createFixture(Box(w / 2, h / 2), fx); break;
      case 'track-circle': {
        r = w / 2;
        const N = 144;
        body.createFixture(Chain(Array.from({ length: N }, (_, i) => Vec2(r * Math.cos((i / N) * 2 * Math.PI), r * Math.sin((i / N) * 2 * Math.PI))), true), fx);
        break;
      }
      case 'track-arc': {
        r = w / 2;
        const a0 = (num(o, 'a0', 0) * Math.PI) / 180, a1 = (num(o, 'a1', 180) * Math.PI) / 180;
        const N = Math.max(8, Math.ceil((Math.abs(a1 - a0) / (2 * Math.PI)) * 144));
        body.createFixture(Chain(Array.from({ length: N + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / N; return Vec2(r * Math.cos(a), r * Math.sin(a)); }), false), fx);
        break;
      }
      case 'pulley': case 'hinge': r = Math.min(w, h) / 2; break;
      default: body.createFixture(Box(Math.max(w, 0.02) / 2, Math.max(h, 0.02) / 2), fx);
    }
    const speed = o.kind === 'conveyor' ? num(o, 'speed', 0) : 0;
    const info: Info = {
      dyn: false, idx: -1, sid, mu: optNum(o, 'mu'), e: optNum(o, 'e'), kind: o.kind, obj: o, speed,
      u: [Math.cos(o.rot), Math.sin(o.rot)], up: [Math.sin(o.rot), -Math.cos(o.rot)],
    };
    body.setUserData(info);
    this.statics.push({ id: o.id, obj: o, body, speed, r });
  }

  private findBody(id: unknown): { body: Body; idx: number; obj?: PhysObj } | null {
    if (id === undefined || id === null || id === '') return null;
    const s = String(id);
    const b = this.bodies.find((x) => x.id === s && x.body);
    if (b) return { body: b.body!, idx: b.idx, obj: b.obj };
    const st = this.statics.find((x) => x.id === s);
    if (st?.body) return { body: st.body, idx: -1, obj: st.obj };
    return null;
  }

  /** 端点附近的物体（用于没写 a/b 的连接件） */
  private nearest(px: number, py: number, not?: Body): { body: Body; idx: number; obj?: PhysObj } | null {
    let best: { body: Body; idx: number; obj?: PhysObj } | null = null, bd = 0.05;
    const test = (body: Body, idx: number, o: PhysObj) => {
      if (body === not) return;
      const dx = px - o.x, dy = py - o.y;
      const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      const d = Math.max(0, Math.abs(lx) - o.w / 2, Math.abs(ly) - o.h / 2) + (Math.hypot(dx, dy) * 1e-3);
      if (d < bd) { bd = d; best = { body, idx, obj: o }; }
    };
    for (const b of this.bodies) if (b.body) test(b.body, b.idx, b.obj);
    for (const s of this.statics) if (s.body) test(s.body, -1, s.obj);
    return best;
  }

  private addConn(o: PhysObj) {
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const e1: [number, number] = [o.x - (o.w / 2) * c, o.y - (o.w / 2) * s];
    const e2: [number, number] = [o.x + (o.w / 2) * c, o.y + (o.w / 2) * s];
    let A = this.findBody(o.props?.a), B = this.findBody(o.props?.b);
    let ea = e1, eb = e2;
    if (A && B && A.obj && B.obj) {
      const d1 = Math.hypot(e1[0] - A.obj.x, e1[1] - A.obj.y) + Math.hypot(e2[0] - B.obj.x, e2[1] - B.obj.y);
      const d2 = Math.hypot(e2[0] - A.obj.x, e2[1] - A.obj.y) + Math.hypot(e1[0] - B.obj.x, e1[1] - B.obj.y);
      if (d2 < d1) { ea = e2; eb = e1; }
    } else if (A && A.obj) {
      if (Math.hypot(e2[0] - A.obj.x, e2[1] - A.obj.y) < Math.hypot(e1[0] - A.obj.x, e1[1] - A.obj.y)) { ea = e2; eb = e1; }
      B = this.nearest(eb[0], eb[1], A.body);
    } else if (B && B.obj) {
      if (Math.hypot(e1[0] - B.obj.x, e1[1] - B.obj.y) < Math.hypot(e2[0] - B.obj.x, e2[1] - B.obj.y)) { ea = e2; eb = e1; }
      A = this.nearest(ea[0], ea[1], B.body);
    } else {
      A = this.nearest(e1[0], e1[1]); B = this.nearest(e2[0], e2[1], A?.body);
    }
    const ga = A ?? { body: this.ground, idx: -1 }, gb = B ?? { body: this.ground, idx: -1 };
    if (ga.body.isStatic() && gb.body.isStatic()) return;
    // 端点落在球内就挂在球心（摆球、圆周运动）
    const snap = (e: [number, number], t: { body: Body; obj?: PhysObj }) => {
      if (t.obj && t.obj.kind === 'ball' && Math.hypot(e[0] - t.obj.x, e[1] - t.obj.y) <= Math.min(t.obj.w, t.obj.h) * 0.75) return Vec2(this.W(t.obj.x), this.W(t.obj.y));
      if (t.obj && (t.obj.kind === 'hinge' || t.obj.kind === 'pulley')) return Vec2(this.W(t.obj.x), this.W(t.obj.y));
      return Vec2(this.W(e[0]), this.W(e[1]));
    };
    const pa = snap(ea, ga), pb = snap(eb, gb);
    const la = ga.body.getLocalPoint(pa), lb = gb.body.getLocalPoint(pb);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const conn: SimConn = {
      id: o.id, obj: o, kind: o.kind as 'spring' | 'rope' | 'rod', a: ga.body, b: gb.body, la, lb, aIdx: ga.idx, bIdx: gb.idx,
      k: num(o, 'k', 50), L0: num(o, 'L0', len), attached: o.kind !== 'spring' || o.props?.attached !== false && o.props?.attached !== 'false',
      released: false,
    };
    const L = num(o, 'L', len);
    if (o.kind === 'rope' && has(o, 'via')) {
      const pul = this.statics.find((x) => x.id === String(o.props.via));
      if (pul && !ga.body.isStatic() && !gb.body.isStatic()) {
        const cx = this.W(pul.obj.x), cy = this.W(pul.obj.y), r = pul.r;
        const P = ga.body.getPosition(), Q = gb.body.getPosition();
        const leftA = P.x <= Q.x;
        const tA = tangent(cx, cy, r, P.x, P.y, leftA ? -1 : 1), tB = tangent(cx, cy, r, Q.x, Q.y, leftA ? 1 : -1);
        conn.kind = 'pulley';
        conn.la = Vec2(0, 0); conn.lb = Vec2(0, 0);
        const lA = Math.hypot(P.x - tA[0], P.y - tA[1]), lB = Math.hypot(Q.x - tB[0], Q.y - tB[1]);
        conn.via = { cx, cy, r, gax: tA[0], gay: tA[1], gbx: tB[0], gby: tB[1], L: lA + lB };
        this.pulleyJoint(conn, lA, lB);
      }
    } else if (o.kind === 'rope') {
      conn.joint = this.world.createJoint(new RopeJoint({ bodyA: ga.body, bodyB: gb.body, localAnchorA: la, localAnchorB: lb, maxLength: Math.max(0.01, L) })) ?? undefined;
    } else if (o.kind === 'rod') {
      conn.joint = this.world.createJoint(new DistanceJoint({ bodyA: ga.body, bodyB: gb.body, localAnchorA: la, localAnchorB: lb, length: Math.max(0.01, L), frequencyHz: 0, dampingRatio: 0 })) ?? undefined;
    }
    this.conns.push(conn);
  }

  /** 定滑轮上的绳：planck 的 PulleyJoint 是双向刚性约束（绳子能「推」）。
   *  这里给实例换上单向求解：累计冲量夹到 ≥0（只能拉），位置修正只在绳被拉长时做 → 真正的「绳」。 */
  private pulleyJoint(c: SimConn, lA: number, lB: number) {
    const v = c.via!;
    const j = this.world.createJoint(new PulleyJoint({
      bodyA: c.a, bodyB: c.b, groundAnchorA: Vec2(v.gax, v.gay), groundAnchorB: Vec2(v.gbx, v.gby),
      localAnchorA: Vec2(0, 0), localAnchorB: Vec2(0, 0), lengthA: lA, lengthB: lB, ratio: 1,
    }));
    if (j) oneSided(j as unknown as PJ);
    c.joint = j ?? undefined;
    c.slack = false;
  }
  private ropeSides(c: SimConn) {
    const v = c.via!, P = c.a.getPosition(), Q = c.b.getPosition();
    return [Math.hypot(P.x - v.gax, P.y - v.gay), Math.hypot(Q.x - v.gbx, Q.y - v.gby)];
  }
  /** 每个子步后更新松弛状态（约束本身已是单向的），绷紧 → 松弛时记事件 */
  private pulleySlack() {
    for (const c of this.conns) {
      if (c.kind !== 'pulley' || !c.via || !c.joint) continue;
      const [lA, lB] = this.ropeSides(c);
      const imp = (c.joint as unknown as PJ).m_impulse;
      const slack = imp <= 1e-9 && lA + lB < c.via.L - 1e-4;
      if (slack && !c.slack) {
        const p = c.b.getPosition();
        this.emit('slack', '绳子松弛', c.id, this.t, p.x, p.y);
      }
      c.slack = slack;
    }
  }

  // ── 接触：摩擦、恢复系数、传送带、受力记录、事件 ─────────────────
  private hook() {
    const w = this.world;
    w.on('pre-solve', (c: Contact) => {
      const A = c.getFixtureA().getBody().getUserData() as Info, B = c.getFixtureB().getBody().getUserData() as Info;
      if (!A || !B) return;
      const wm = c.getWorldManifold(null);
      if (!wm) return;
      const n = wm.normal;
      const mu = pairMu(A, B, n.x, n.y);
      c.setFriction(mu);
      this.pair(pairKey(A, B)).mu = mu;
      c.setRestitution(pairE(A, B));
      const ts = this.beltSpeed(A, B, n.x, n.y);
      c.setTangentSpeed(ts);
    });
    w.on('post-solve', (c: Contact, imp) => {
      const fa = c.getFixtureA(), fb = c.getFixtureB();
      const A = fa.getBody().getUserData() as Info, B = fb.getBody().getUserData() as Info;
      if (!A || !B) return;
      const wm = c.getWorldManifold(null);
      const cnt = c.getManifold().pointCount;
      if (!wm || cnt === 0) return;
      let N = 0, T = 0;
      const ni = imp.normalImpulses, ti = imp.tangentImpulses;
      for (let i = 0; i < cnt; i++) { N += ni[i] ?? 0; T += ti[i] ?? 0; }
      const nx = wm.normal.x, ny = wm.normal.y, tx = ny, ty = -nx;
      const Fn = N / DT, Ft = T / DT;
      const vA = fa.getBody().getLinearVelocity(), vB = fb.getBody().getLinearVelocity();
      const vt = (vB.x - vA.x) * tx + (vB.y - vA.y) * ty - this.beltSpeed(A, B, nx, ny);
      this.heat += Math.abs(T) * Math.abs(vt);
      // B 受力 = n·Fn + t·Ft，A 相反
      if (B.dyn) this.addContactForce(B.idx, A, nx * Fn, ny * Fn, tx * Ft, ty * Ft, -ny);
      if (A.dyn) this.addContactForce(A.idx, B, -nx * Fn, -ny * Fn, -tx * Ft, -ty * Ft, ny);
      // 共速：相对切向速度
      if (A.dyn || B.dyn) {
        if (A.dyn && B.dyn && Math.abs(ny) < 0.9) return;   // 侧面 / 棱角接触不算共速
        const sup = !A.dyn ? A : !B.dyn ? B : null;
        if (sup?.up && (sup.kind === 'conveyor' || sup.kind === 'ground') && Math.abs(nx * sup.up[0] + ny * sup.up[1]) < 0.9) return;
        const key = pairKey(A, B);
        const p = this.pair(key);
        p.vtpp = p.vtp; p.vtp = p.vt; p.vt = vt; p.n++;
      }
    });
    w.on('begin-contact', (c: Contact) => {
      const A = c.getFixtureA().getBody().getUserData() as Info, B = c.getFixtureB().getBody().getUserData() as Info;
      if (!A || !B) return;
      const p = this.pair(pairKey(A, B));
      if (p.n === 0 && !p.touched) p.since = this.t;
      p.touched = true;
      for (const X of [A, B]) if (X.dyn) this.touching[X.idx]++;
      const vA = c.getFixtureA().getBody().getLinearVelocity(), vB = c.getFixtureB().getBody().getLinearVelocity();
      const wm = c.getWorldManifold(null);
      const vn = wm ? Math.abs((vB.x - vA.x) * wm.normal.x + (vB.y - vA.y) * wm.normal.y) : 0;
      if (A.dyn && B.dyn && vn > 0.05 && Math.abs(wm?.normal.y ?? 0) < 0.7) {
        const pa = c.getFixtureA().getBody().getPosition(), pb = c.getFixtureB().getBody().getPosition();
        this.emit('collide', '碰撞', this.bodies[A.idx].id + '|' + this.bodies[B.idx].id, this.t, (pa.x + pb.x) / 2, Math.min(pa.y, pb.y));
      }
      const dyn = A.dyn ? A : B.dyn ? B : null, st = A.dyn ? B : A;
      if (dyn && !st.dyn && st.kind === 'ground' && vn > 0.3 && this.t - this.airSince[dyn.idx] > 0.08 && this.touching[dyn.idx] === 1) {
        const p0 = this.bodies[dyn.idx].body!.getPosition();
        this.emit('land', `落地 t=${this.t.toFixed(2)} s`, this.bodies[dyn.idx].id, this.t, p0.x, p0.y);
      }
    });
    w.on('end-contact', (c: Contact) => {
      const A = c.getFixtureA().getBody().getUserData() as Info, B = c.getFixtureB().getBody().getUserData() as Info;
      if (!A || !B) return;
      for (const X of [A, B]) if (X.dyn) { this.touching[X.idx] = Math.max(0, this.touching[X.idx] - 1); if (this.touching[X.idx] === 0) this.airSince[X.idx] = this.t; }
      const p = this.pair(pairKey(A, B));
      p.last = this.t;
    });
  }

  private beltSpeed(A: Info, B: Info, nx: number, ny: number) {
    // 传送带表面速度 vb：B 相对 A 的切向速度目标 = vb·t（A 是带）或 -vb·t（B 是带）
    const tx = ny, ty = -nx;
    const surf = (belt: Info, nbx: number, nby: number) => {
      if (!belt.speed || !belt.u || !belt.up) return [0, 0];
      const d = nbx * belt.up[0] + nby * belt.up[1];
      const s = d > 0.5 ? belt.speed : d < -0.5 ? -belt.speed : 0;
      return [belt.u[0] * s, belt.u[1] * s];
    };
    if (A.kind === 'conveyor' && !A.dyn) { const v = surf(A, nx, ny); return v[0] * tx + v[1] * ty; }
    if (B.kind === 'conveyor' && !B.dyn) { const v = surf(B, -nx, -ny); return -(v[0] * tx + v[1] * ty); }
    return 0;
  }

  private addContactForce(idx: number, other: Info, nx: number, ny: number, fx: number, fy: number, upness: number) {
    const list = this.stepForces[idx] ?? (this.stepForces[idx] = []);
    // 物体在下方、对方是叠放在上面的动态物体：用 ′ 标反作用力
    const prime = other.dyn && upness < -0.3 ? '′' : '';
    const tag = other.dyn ? other.idx : 's' + other.sid;
    const nl = 'F_N' + prime, fl = 'f' + prime;
    const add = (k: FKind, label: string, x: number, y: number) => {
      if (Math.hypot(x, y) < 1e-9) return;
      const ex = list.find((f) => f.k === k && (f as Force & { tag?: unknown }).tag === tag);
      if (ex) { ex.x += x; ex.y += y; } else list.push(Object.assign({ k, label, x, y }, { tag }));
    };
    add('N', nl, nx, ny);
    add('f', fl, fx, fy);
  }

  private pair(key: string) {
    let p = this.pairs.get(key);
    if (!p) { p = { mu: 0, vt: 0, vtp: 0, vtpp: 0, sliding: false, n: 0, since: this.t, last: -1, touched: false, done: false }; this.pairs.set(key, p); }
    return p;
  }

  private emit(kind: EvKind, label: string, id: string, t: number, x: number, y: number, v?: number) {
    if (!this.evOn.has(kind)) return;
    const key = kind + ':' + id;
    const n = this.evCount.get(key) ?? 0;
    const cap = kind === 'apex' || kind === 'collide' || kind === 'cospeed' ? 3 : kind === 'field' ? 4 : 1;
    if (n >= cap) return;
    this.evCount.set(key, n + 1);
    this.events.push({ t, kind, label, id, x, y, v });
  }

  /** 离开支撑面的精确时刻：物体中心沿支撑面方向越过端点（质点模型）。找不到就用接触结束时刻。 */
  private leaveAt(bi: number, sup: { obj?: PhysObj; dyn?: number }, tLast: number): [number, number, number] {
    const iLast = Math.min(this.frames.length - 1, Math.round(tLast / DT));
    const geo = (i: number) => {
      const f = this.frames[i];
      if (sup.obj) return { cx: this.W(sup.obj.x), cy: this.W(sup.obj.y), a: sup.obj.rot, hw: this.W(sup.obj.w) / 2 };
      if (sup.dyn !== undefined) { const s = f.b[sup.dyn]; return { cx: s.x, cy: s.y, a: s.a, hw: this.W(this.bodies[sup.dyn].obj.w) / 2 }; }
      return null;
    };
    const proj = (i: number) => { const g = geo(i)!; const s = this.frames[i].b[bi]; return Math.abs((s.x - g.cx) * Math.cos(g.a) + (s.y - g.cy) * Math.sin(g.a)) - g.hw; };
    if (geo(iLast)) {
      for (let i = iLast; i > 0 && i > iLast - 120; i--) {
        const q1 = proj(i), q0 = proj(i - 1);
        if (q0 <= 0 && q1 > 0) {
          const k = -q0 / (q1 - q0), A = this.frames[i - 1].b[bi], B = this.frames[i].b[bi];
          return [this.frames[i - 1].t + k * DT, A.x + (B.x - A.x) * k, A.y + (B.y - A.y) * k];
        }
      }
    }
    const s = this.frames[iLast].b[bi];
    return [tLast, s.x, s.y];
  }

  private inside(f: FieldRegion, x: number, y: number) {
    const dx = x - f.cx, dy = y - f.cy;
    return Math.abs(f.c * dx + f.s * dy) <= f.hw && Math.abs(-f.s * dx + f.c * dy) <= f.hh;
  }

  // ── 一步 ────────────────────────────────────────────────
  private advance() {
    const t0 = this.t;
    this.stepForces = this.bodies.map(() => []);
    for (const p of this.pairs.values()) p.n = 0;
    const prevV = this.bodies.map((b) => (b.kind === 'particle' ? [b.pvx, b.pvy] : [b.body!.getLinearVelocity().x, b.body!.getLinearVelocity().y]));

    // 弹簧：精确胡克定律 F = k·ΔL，自己施力（每个子步重新计算）
    const springF: number[] = this.conns.map(() => 0);
    const h = this.h;
    for (let k = 0; k < this.sub; k++) {
      this.t = t0 + k * h;
      this.conns.forEach((c, i) => {
        if (c.kind !== 'spring' || c.released) return;
        const pa = c.a.getWorldPoint(c.la), pb = c.b.getWorldPoint(c.lb);
        const dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy) || 1e-9;
        if (!c.attached && L >= c.L0) { c.released = true; springF[i] = 0; this.emit('release', '分离', c.id, this.t, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2); return; }
        const F = c.k * (L - c.L0), ux = dx / L, uy = dy / L;
        c.a.applyForce(Vec2(F * ux, F * uy), pa, true);
        c.b.applyForce(Vec2(-F * ux, -F * uy), pb, true);
        if (k === 0) {
          springF[i] = F;
          if (c.aIdx >= 0) this.stepForces[c.aIdx].push({ k: 'spring', label: 'F_弹', x: F * ux, y: F * uy });
          if (c.bIdx >= 0) this.stepForces[c.bIdx].push({ k: 'spring', label: 'F_弹', x: -F * ux, y: -F * uy });
        }
      });
      // 恒定外力（牵引/推力）：props.ax / ay 是它产生的加速度（ay 向上为正），F = m·a
      for (const b of this.bodies) {
        if (b.kind !== 'dyn' || !b.body) continue;
        const ax = num(b.obj, 'ax', 0), ay = num(b.obj, 'ay', 0);
        if (!ax && !ay) continue;
        b.body.applyForceToCenter(Vec2(b.m * ax, -b.m * ay), true);
        if (k === 0) this.stepForces[b.idx].push({ k: 'F', label: 'F', x: b.m * ax, y: -b.m * ay });
      }
      this.world.step(h, VEL_IT, POS_IT);
      this.pulleySlack();
    }
    this.t = t0 + DT;

    // 带电粒子：Boris 推进
    for (const b of this.bodies) {
      if (b.kind !== 'particle' || !b.alive) continue;
      let Ex = 0, Ey = 0, Bz = 0;
      for (const f of this.fields) if (this.inside(f, b.px, b.py)) { Ex += f.Ex; Ey += f.Ey; Bz += f.Bz; }
      const qm = b.q / b.m;
      const gx = 0, gy = b.grav ? this.g : 0;
      // 用 y 向上坐标做旋转
      const h = DT * this.ts;
      let ux = b.pvx + (qm * Ex + gx) * h / 2, uy = -(b.pvy + (qm * Ey + gy) * h / 2);
      const phi = -qm * Bz * h;
      const c = Math.cos(phi), s = Math.sin(phi);
      const rx = ux * c - uy * s, ry = ux * s + uy * c;
      ux = rx; uy = ry;
      b.pvx = ux + (qm * Ex + gx) * h / 2;
      b.pvy = -uy + (qm * Ey + gy) * h / 2;
      const ox = b.px, oy = b.py;
      b.px += b.pvx * h; b.py += b.pvy * h;
      // 极板 / 静止物体：打到就停
      for (const f of this.fields) {
        if (!f.plates || b.px < f.x0 || ox > f.x1) continue;
        if (oy >= f.y0 && oy <= f.y1 && (b.py < f.y0 || b.py > f.y1)) {
          const yy = b.py < f.y0 ? f.y0 : f.y1;
          const k = (yy - oy) / (b.py - oy || 1e-12);
          b.px = ox + (b.px - ox) * k; b.py = yy; b.alive = false;
          this.emit('hit', '打到极板', b.id, t0 + DT * k, b.px, b.py);
        }
      }
      if (b.alive) {
        let hit: Info | null = null;
        this.world.queryAABB({ lowerBound: Vec2(b.px - 1e-4, b.py - 1e-4), upperBound: Vec2(b.px + 1e-4, b.py + 1e-4) }, (fx: Fixture) => {
          if (fx.getBody().isStatic() && fx.testPoint(Vec2(b.px, b.py))) { hit = (fx.getBody().getUserData() as Info) ?? null; return false; }
          return true;
        });
        if (hit) { b.alive = false; this.emit('hit', '打到' + ((hit as Info).obj.label || '障碍'), b.id, this.t, b.px, b.py); }
      }
      if (!b.alive) { b.pvx = 0; b.pvy = 0; }
      // 记录力（用推进后的速度）
      const list = this.stepForces[b.idx];
      if (b.alive) {
        if (Ex || Ey) list.push({ k: 'E', label: 'qE', x: b.q * Ex, y: b.q * Ey });
        if (Bz) { const vux = b.pvx, vuy = -b.pvy; list.push({ k: 'B', label: 'F_洛', x: b.q * vuy * Bz, y: -(-b.q * vux * Bz) }); }
        if (b.grav) list.push({ k: 'G', label: 'G', x: 0, y: b.m * this.g });
      }
    }

    // 绳、杆、滑轮的拉力
    const connF: number[] = this.conns.map(() => 0);
    this.conns.forEach((c, i) => {
      if (c.kind === 'spring') { connF[i] = springF[i]; return; }
      if (!c.joint) return;
      // 刚在本步重新张紧的滑轮绳还没经过一次求解（内部方向向量未初始化），本步张力记为 0
      if (c.kind === 'pulley' && !(c.joint as unknown as { m_uB?: unknown }).m_uB) return;
      const R = c.joint.getReactionForce(1 / this.h);
      const mag = Math.hypot(R.x, R.y);
      connF[i] = mag;
      if (mag < 1e-6) return;
      if (c.kind === 'pulley' && c.via) {
        const v = c.via;
        const push = (idx: number, body: Body, gx: number, gy: number) => {
          if (idx < 0) return;
          const p = body.getPosition(), dx = gx - p.x, dy = gy - p.y, d = Math.hypot(dx, dy) || 1;
          this.stepForces[idx].push({ k: 'T', label: 'T', x: (mag * dx) / d, y: (mag * dy) / d });
        };
        push(c.aIdx, c.a, v.gax, v.gay); push(c.bIdx, c.b, v.gbx, v.gby);
        return;
      }
      const k: FKind = c.kind === 'rod' ? 'rod' : c.kind === 'track' ? 'N' : 'T', label = c.kind === 'rod' ? 'F_杆' : c.kind === 'track' ? 'F_N' : 'T';
      if (c.bIdx >= 0) this.stepForces[c.bIdx].push({ k, label, x: R.x, y: R.y });
      if (c.aIdx >= 0) this.stepForces[c.aIdx].push({ k, label, x: -R.x, y: -R.y });
    });

    // 重力
    for (const b of this.bodies) if (b.kind === 'dyn' && b.grav) this.stepForces[b.idx].unshift({ k: 'G', label: 'G', x: 0, y: b.m * this.g });

    this.record(connF, prevV);
    this.detect(t0, connF);
  }

  private detect(t0: number, connF: number[]) {
    const t1 = this.t;
    // 共速：相对滑动速度过零（插值求精确时刻）
    for (const [key, p] of this.pairs) {
      if (p.n === 0 || p.mu <= 0) continue;
      const crossed = p.sliding && (Math.abs(p.vt) < 0.004 || Math.sign(p.vt) !== Math.sign(p.vtp));
      if (Math.abs(p.vt) > 0.05) p.sliding = true;
      if (crossed) {
        p.sliding = false;
        const hh = this.h, tl = t1 - hh;   // vtp 对应 t1 − h，vt 对应 t1
        let te = t1;
        if (Math.sign(p.vt) !== Math.sign(p.vtp) && Math.abs(p.vt) > 0.004) te = tl + (hh * Math.abs(p.vtp)) / (Math.abs(p.vtp) + Math.abs(p.vt));
        else { const ap = (p.vtp - p.vtpp) / hh; if (Math.abs(ap) > 1e-6) te = Math.min(t1, Math.max(t0, tl - hh + Math.abs(p.vtpp) / Math.abs(ap))); }
        te = Math.max(0, te);
        const [ia] = key.split('~');
        const bi = ia.startsWith('d') ? +ia.slice(1) : +key.split('~')[1].slice(1);
        const b = this.bodies[bi];
        if (b?.body) {
          const pos = b.body.getPosition(), v = b.body.getLinearVelocity();
          const [ka, kb] = key.split('~');
          const sk = ka.startsWith('s') ? ka : kb.startsWith('s') ? kb : '';
          const still = sk && this.statics[+sk.slice(1)]?.obj.kind !== 'conveyor';
          this.emit('cospeed', `${still ? '停下' : '共速'} t=${te.toFixed(2)} s`, key, te, pos.x, pos.y, Math.hypot(v.x, v.y));
        }
      }
    }
    // 离开传送带 / 斜面 / 轨道 / 木板
    for (const [key, p] of this.pairs) {
      if (!p.touched || p.done || p.n > 0 || p.last < 0 || t1 - p.last < 0.05 || p.last - p.since < 0.1) continue;
      const [a, b] = key.split('~');
      const other = a.startsWith('s') ? a : b.startsWith('s') ? b : null;
      const dynKey = a.startsWith('d') ? a : b;
      const di = +dynKey.slice(1);
      let label = '';
      if (other) {
        const kind = this.statics[+other.slice(1)]?.obj.kind;
        label = kind === 'conveyor' ? '离开传送带' : kind === 'incline' ? '离开斜面' : kind === 'track-circle' || kind === 'track-arc' ? '脱离轨道' : '';
      } else {
        const ia = +a.slice(1), ib = +b.slice(1);
        const plank = this.bodies[ia]?.obj.kind === 'plank' ? ib : this.bodies[ib]?.obj.kind === 'plank' ? ia : -1;
        if (plank >= 0) { label = '滑离木板'; }
        if (plank >= 0 && this.bodies[plank]) { /* 动态的那块 */ }
        if (plank >= 0) {
          p.done = true;
          const sup = this.bodies[plank] === this.bodies[ia] ? ib : ia;
          const [tt, x, y] = this.leaveAt(plank, { dyn: sup }, p.last);
          this.emit('leave', label, this.bodies[plank].id, tt, x, y);
          continue;
        }
      }
      p.done = true;
      if (!label) continue;
      const bb = this.bodies[di]?.body;
      if (!bb) continue;
      const so = this.statics[+other!.slice(1)].obj;
      const [tt, x, y] = so.kind === 'conveyor' ? this.leaveAt(di, { obj: so }, p.last) : this.leaveAt(di, {}, p.last);
      this.emit('leave', label, this.bodies[di].id, tt, x, y);
    }
    // 最高点：竖直速度由向上变为向下
    const n = this.frames.length;
    if (n >= 2) {
      const A = this.frames[n - 2], B = this.frames[n - 1];
      this.bodies.forEach((b, i) => {
        const sa = A.b[i], sb = B.b[i];
        if (!sa.alive || !sb.alive) return;
        if (sb.vy < -0.1) this.rising[i] = true;
        if (this.rising[i] && sa.vy < 0 && sb.vy >= 0) {
          this.rising[i] = false;
          const k = sa.vy / (sa.vy - sb.vy);
          this.emit('apex', '最高点', b.id, A.t + k * DT, sa.x + (sb.x - sa.x) * k, sa.y + (sb.y - sa.y) * k, Math.hypot(sa.vx, sa.vy));
        }
        // 进出场区
        this.fields.forEach((f, j) => {
          const was = this.inField[i][j], now = this.inside(f, sb.x, sb.y);
          if (was === now) return;
          this.inField[i][j] = now;
          const name = f.kind === 'B' ? '磁场' : '电场';
          this.emit('field', (now ? '进入' : '离开') + name, b.id + '@' + f.id, B.t, sb.x, sb.y, Math.hypot(sb.vx, sb.vy));
        });
      });
    }
    // 绳子松弛
    this.conns.forEach((c, i) => {
      if (c.kind !== 'rope' && c.kind !== 'track') return;
      this.tenseMax[i] = Math.max(this.tenseMax[i], connF[i]);
      if (this.tenseMax[i] > 0.05 && connF[i] < 1e-6 && t1 > 0.05) {
        const p = c.b.getWorldPoint(c.lb);
        this.emit('slack', c.kind === 'track' ? '脱离轨道' : '绳子松弛', c.id, t1, p.x, p.y);
        this.tenseMax[i] = -Infinity;
      }
    });
  }

  private record(connF: number[] = [], prevV?: number[][]) {
    let ek = 0, ep = 0;
    const b: BState[] = this.bodies.map((s, i) => {
      let x: number, y: number, a: number, vx: number, vy: number;
      if (s.kind === 'particle') { x = s.px; y = s.py; a = 0; vx = s.pvx; vy = s.pvy; }
      else { const p = s.body!.getPosition(), v = s.body!.getLinearVelocity(); x = p.x; y = p.y; a = s.body!.getAngle(); vx = v.x; vy = v.y; }
      const ax = prevV ? (vx - prevV[i][0]) / DT : 0, ay = prevV ? (vy - prevV[i][1]) / DT : 0;
      ek += 0.5 * s.m * (vx * vx + vy * vy);
      if (s.grav) ep += s.m * this.g * (this.y0[i] - y);
      const f = (this.stepForces[i] ?? []).map((F) => ({ k: F.k, label: F.label, x: F.x, y: F.y }));
      return { x, y, a, vx, vy, ax, ay, f, alive: s.alive };
    });
    let es = 0;
    const c: CState[] = this.conns.map((cn, i) => {
      const pa = cn.a.getWorldPoint(cn.la), pb = cn.b.getWorldPoint(cn.lb);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const active = cn.kind !== 'spring' || !cn.released;
      if (cn.kind === 'spring' && active) es += 0.5 * cn.k * (len - cn.L0) ** 2;
      return { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, len, force: connF[i] ?? 0, active };
    });
    this.frames.push({ t: this.t, b, c, ek, ep, es, q: this.heat });
  }

  // ── 查询 ────────────────────────────────────────────────
  /** 第 t 秒对应的帧下标与插值系数 */
  index(t: number): [number, number] {
    const x = Math.max(0, Math.min(this.frames.length - 1, t / DT));
    const i = Math.min(this.frames.length - 2, Math.floor(x));
    if (i < 0) return [0, 0];
    return [i, x - i];
  }
  /** 最近的整帧 */
  frame(t: number): Frame { return this.frames[Math.round(Math.max(0, Math.min(this.frames.length - 1, t / DT)))]; }
  /** 插值后的物体状态（米，y 向下） */
  state(bi: number, t: number): BState {
    const [i, k] = this.index(t);
    const A = this.frames[i].b[bi], B = (this.frames[i + 1] ?? this.frames[i]).b[bi];
    const L = (a: number, b: number) => a + (b - a) * k;
    return { x: L(A.x, B.x), y: L(A.y, B.y), a: L(A.a, B.a), vx: L(A.vx, B.vx), vy: L(A.vy, B.vy), ax: k < 0.5 ? A.ax : B.ax, ay: k < 0.5 ? A.ay : B.ay, f: k < 0.5 ? A.f : B.f, alive: k < 0.5 ? A.alive : B.alive };
  }
  conn(ci: number, t: number): CState {
    const [i, k] = this.index(t);
    const A = this.frames[i].c[ci], B = (this.frames[i + 1] ?? this.frames[i]).c[ci];
    const L = (a: number, b: number) => a + (b - a) * k;
    return { ax: L(A.ax, B.ax), ay: L(A.ay, B.ay), bx: L(A.bx, B.bx), by: L(A.by, B.by), len: L(A.len, B.len), force: L(A.force, B.force), active: k < 0.5 ? A.active : B.active };
  }
  bodyIndex(id: string) { return this.bodies.findIndex((b) => b.id === id); }
  /** 物体在 t 时刻的页面几何（用 drawObj 画） */
  objAt(bi: number, t: number): PhysObj {
    const b = this.bodies[bi], s = this.state(bi, t);
    return { ...b.obj, x: s.x * this.ppm, y: s.y * this.ppm, rot: s.a };
  }
}

/** 从外部点 P 到圆 (C, r) 的切点；side=-1 取左上方那个，+1 取右上方那个（绳子从滑轮顶上绕过） */
function tangent(cx: number, cy: number, r: number, px: number, py: number, side: number): [number, number] {
  const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy);
  if (d <= r + 1e-9) return [cx + side * r, cy];
  const base = Math.atan2(dy, dx), al = Math.acos(r / d);
  const c1: [number, number] = [cx + r * Math.cos(base + al), cy + r * Math.sin(base + al)];
  const c2: [number, number] = [cx + r * Math.cos(base - al), cy + r * Math.sin(base - al)];
  const score = (p: [number, number]) => side * (p[0] - cx) - (p[1] - cy);   // y 向下：越往上分越高
  return score(c1) >= score(c2) ? c1 : c2;
}

function pairKey(A: Info, B: Info) {
  const k = (X: Info) => (X.dyn ? 'd' + X.idx : 's' + X.sid);
  const a = k(A), b = k(B);
  return a < b ? a + '~' + b : b + '~' + a;
}

/** 摩擦因数：μ 写在「上面那个物体」上表示它与支持面之间；没写就用支持面的 μ */
function pairMu(A: Info, B: Info, _nx: number, ny: number): number {
  const def = (x?: number) => (x !== undefined && Number.isFinite(x) ? Math.max(0, x) : undefined);
  let upper: Info, lower: Info;
  if (ny < -0.3) { upper = B; lower = A; }
  else if (ny > 0.3) { upper = A; lower = B; }
  else {
    const st = !A.dyn ? A : !B.dyn ? B : null;
    if (st && def(st.mu) !== undefined) return def(st.mu)!;
    const dyn = A.dyn ? A : B;
    return st ? def(dyn.mu) ?? 0 : 0;
  }
  if (upper.dyn && def(upper.mu) !== undefined) return def(upper.mu)!;
  return def(lower.mu) ?? def(upper.mu) ?? 0;
}

function pairE(A: Info, B: Info): number {
  const c = (x?: number) => (x !== undefined && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : undefined);
  if (A.dyn && B.dyn) {
    const ea = c(A.e), eb = c(B.e);
    if (ea !== undefined && eb !== undefined) return Math.min(ea, eb);
    return ea ?? eb ?? 0;
  }
  const st = A.dyn ? B : A;
  return c(st.e) ?? 0;
}

export { ROUND };

// ── 单向绳（滑轮）：把 planck PulleyJoint 的求解改成只能拉不能推 ──
interface V2 { x: number; y: number }
interface PJ {
  m_impulse: number; m_mass: number; m_ratio: number; m_constant: number;
  m_uA: V2; m_uB: V2; m_rA: V2; m_rB: V2; m_invMassA: number; m_invMassB: number;
  m_groundAnchorA: V2; m_groundAnchorB: V2;
  m_bodyA: { c_velocity: { v: V2 }; c_position: { c: V2 } }; m_bodyB: { c_velocity: { v: V2 }; c_position: { c: V2 } };
  solveVelocityConstraints: (s: unknown) => void; solvePositionConstraints: (s: unknown) => boolean;
}
function oneSided(j: PJ) {
  // 只处理质心锚点（localAnchor=0）、不转动的情况：本引擎的滑轮绳都是这样连的
  j.solveVelocityConstraints = function (step: unknown) {
    const vA = this.m_bodyA.c_velocity.v, vB = this.m_bodyB.c_velocity.v;
    let Cdot = -(this.m_uA.x * vA.x + this.m_uA.y * vA.y) - this.m_ratio * (this.m_uB.x * vB.x + this.m_uB.y * vB.y);
    // 松着的绳：本步之内允许伸长到「刚好绷直」（和 Box2D RopeJoint 一样的预测项），否则松弛的绳会被当成绷紧
    const cA = this.m_bodyA.c_position.c, cB = this.m_bodyB.c_position.c;
    const la = Math.hypot(cA.x - this.m_groundAnchorA.x, cA.y - this.m_groundAnchorA.y);
    const lb = Math.hypot(cB.x - this.m_groundAnchorB.x, cB.y - this.m_groundAnchorB.y);
    const slack = this.m_constant - la - this.m_ratio * lb;
    if (slack > 0) Cdot += slack * (step as { inv_dt: number }).inv_dt;
    const old = this.m_impulse;
    this.m_impulse = Math.max(0, old - this.m_mass * Cdot);      // 张力冲量只能 ≥0
    const imp = this.m_impulse - old;
    vA.x -= this.m_invMassA * imp * this.m_uA.x; vA.y -= this.m_invMassA * imp * this.m_uA.y;
    vB.x -= this.m_invMassB * this.m_ratio * imp * this.m_uB.x; vB.y -= this.m_invMassB * this.m_ratio * imp * this.m_uB.y;
  };
  j.solvePositionConstraints = function () {
    const cA = this.m_bodyA.c_position.c, cB = this.m_bodyB.c_position.c;
    const ax = cA.x - this.m_groundAnchorA.x, ay = cA.y - this.m_groundAnchorA.y;
    const bx = cB.x - this.m_groundAnchorB.x, by = cB.y - this.m_groundAnchorB.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const C = this.m_constant - la - this.m_ratio * lb;
    if (C >= 0 || la < 1e-6 || lb < 1e-6) return true;           // 松着：不修正
    const ux = ax / la, uy = ay / la, wx = bx / lb, wy = by / lb;
    const mass = this.m_invMassA + this.m_ratio * this.m_ratio * this.m_invMassB;
    if (mass <= 0) return true;
    const imp = -C / mass;
    cA.x -= this.m_invMassA * imp * ux; cA.y -= this.m_invMassA * imp * uy;
    cB.x -= this.m_invMassB * this.m_ratio * imp * wx; cB.y -= this.m_invMassB * this.m_ratio * imp * wy;
    return -C < 0.005;
  };
}
