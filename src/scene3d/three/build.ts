// 器材 / 积木 → three.js 网格。每个构建器返回一个 Part：根节点 + 每帧更新 + 要显示的文字标签。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { autoBonds, crystalByName, elementOf, moleculeByName, type Mol } from '../data';
import { KIND_COLOR, type S3DObject } from '../spec';
import { add, cross, curvePoints, DEF, DIR_WORDS, dot, len, norm, scale, solidNames, sub, type V3, type World } from '../world';
import { atmosphere, beltTex, earthTex, glowTex, hatchTex, surfaceTex, type Mats } from './look';

export interface LabelItem {
  key: string;
  text: (t: number) => string;
  at: (t: number) => V3 | null;
  /** 文字往哪边偏（世界方向），不给就居中在锚点上 */
  dir?: (t: number) => V3 | null;
  color?: string;
  size?: 's' | 'm' | 'l';
  kind: 'body' | 'vec' | 'vertex' | 'tag' | 'note' | 'tick';
  visible: (t: number) => boolean;
  prio: number;
  /** 所属的坐标轴方向（世界系）：镜头几乎沿轴看时这些刻度会糊成一团，整体隐藏 */
  axis?: V3;
}
export interface Part { id: string; root: THREE.Object3D; update: (t: number, cam: THREE.Camera) => void; labels: LabelItem[] }
export interface Ctx { w: World; u: number; mats: Mats; floorY: number; up: THREE.Vector3 }

const D2R = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
export const V = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
export const fmt = (v: number, d = 2) => { if (!Number.isFinite(v)) return '—'; const r = +v.toFixed(d); return String(Object.is(r, -0) ? 0 : r); };

// ── 小工具 ───────────────────────────────────────────────
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
const unitCone = new THREE.ConeGeometry(1, 1, 24, 1);
const unitSphere = new THREE.SphereGeometry(1, 32, 20);
export const SHARED_GEOS = new Set<THREE.BufferGeometry>([unitCyl, unitCone, unitSphere]);

/** 把单位圆柱摆到 a→b 之间，半径 r */
export function setCyl(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = b.clone().sub(a), L = d.length();
  m.visible = L > 1e-6;
  if (!m.visible) return;
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y, d.divideScalar(L));
  m.scale.set(r, L, r);
}
function cylMesh(mat: THREE.Material, shadow = true) { const m = new THREE.Mesh(unitCyl, mat); m.castShadow = shadow; return m; }

/** 箭头（圆柱杆 + 圆锥头） */
export class Arrow3 {
  root = new THREE.Group();
  private shaft: THREE.Mesh; private head: THREE.Mesh; private dashes: THREE.InstancedMesh | null = null;
  constructor(mat: THREE.Material, private u: number, dashed = false) {
    this.shaft = cylMesh(mat); this.head = new THREE.Mesh(unitCone, mat); this.head.castShadow = true;
    this.root.add(this.shaft, this.head);
    if (dashed) { this.dashes = new THREE.InstancedMesh(unitCyl, mat, 24); this.root.add(this.dashes); this.shaft.visible = false; }
  }
  set(o: THREE.Vector3, vec: THREE.Vector3, k = 1) {
    const L = vec.length();
    this.root.visible = L > 0.04 * this.u;
    if (!this.root.visible) return;
    const dir = vec.clone().divideScalar(L);
    const hl = Math.min(0.34 * this.u * k, L * 0.45), hr = 0.12 * this.u * k, sr = 0.042 * this.u * k;
    const base = o.clone().addScaledVector(dir, L - hl);
    if (this.dashes) {
      const n = Math.max(2, Math.min(24, Math.round((L - hl) / (0.22 * this.u)))), seg = (L - hl) / n, mtx = new THREE.Matrix4(), q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
      for (let i = 0; i < n; i++) { const c = o.clone().addScaledVector(dir, seg * (i + 0.3)); mtx.compose(c, q, new THREE.Vector3(sr, seg * 0.6, sr)); this.dashes.setMatrixAt(i, mtx); }
      this.dashes.count = n; this.dashes.instanceMatrix.needsUpdate = true;
    } else setCyl(this.shaft, o, base, sr);
    this.head.position.copy(base).addScaledVector(dir, hl / 2);
    this.head.quaternion.setFromUnitVectors(Y, dir);
    this.head.scale.set(hr, hl, hr);
  }
}

/** 一串点 → 管子（每帧可重建，点不变时跳过） */
export class Tube {
  mesh: THREE.Mesh; private sig = '';
  constructor(mat: THREE.Material, private r: number, private closed = false) { this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); this.mesh.castShadow = true; }
  set(pts: THREE.Vector3[], smooth = false) {
    const sig = pts.length + '|' + pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    this.mesh.geometry.dispose();
    if (pts.length < 2) { this.mesh.geometry = new THREE.BufferGeometry(); return; }
    let curve: THREE.Curve<THREE.Vector3>;
    if (smooth) curve = new THREE.CatmullRomCurve3(pts, this.closed, 'centripetal');
    else { const cp = new THREE.CurvePath<THREE.Vector3>(); for (let i = 1; i < pts.length; i++) if (pts[i].distanceToSquared(pts[i - 1]) > 1e-10) cp.add(new THREE.LineCurve3(pts[i - 1], pts[i])); if (!cp.curves.length) { this.mesh.geometry = new THREE.BufferGeometry(); return; } curve = cp; }
    this.mesh.geometry = new THREE.TubeGeometry(curve, Math.min(600, Math.max(16, pts.length * (smooth ? 3 : 2))), this.r, 10, this.closed);
  }
}

/** 一段虚线（短圆柱） */
class Dashed {
  mesh: THREE.InstancedMesh;
  constructor(mat: THREE.Material, private r: number, private gap: number) { this.mesh = new THREE.InstancedMesh(unitCyl, mat, 80); this.mesh.count = 0; }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a), L = d.length();
    if (L < 1e-6) { this.mesh.count = 0; return; }
    const dir = d.divideScalar(L), n = Math.max(1, Math.min(80, Math.round(L / this.gap))), seg = L / n, q = new THREE.Quaternion().setFromUnitVectors(Y, dir), m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m.compose(a.clone().addScaledVector(dir, seg * (i + 0.5)), q, new THREE.Vector3(this.r, seg * 0.55, this.r)); this.mesh.setMatrixAt(i, m); }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 文字模板：「v = {A.v:1} m/s」 */
export function templ(w: World, text: string, t: number): string {
  if (!text.includes('{')) return text;
  return text.replace(/\{([^{}:]+)(?::(\d))?\}/g, (_m, e: string, d?: string) => {
    const f = w.compileExpr(e.trim());
    return f ? fmt(f(w.scope(t)), d ? Number(d) : 2) : '?';
  });
}

const colorOf = (o: S3DObject, def: string) => (typeof o.color === 'string' ? o.color : def);
const objLabel = (c: Ctx, o: S3DObject, at: (t: number) => V3 | null, dir?: (t: number) => V3 | null, kind: LabelItem['kind'] = 'body', prio = 5): LabelItem[] =>
  typeof o.label === 'string' && o.label ? [{ key: o.id, text: (t) => templ(c.w, o.label as string, t), at, dir, color: colorOf(o, '#e2e8f0'), kind, visible: (t) => c.w.visible(o, t), prio, size: kind === 'body' ? 'l' : 'm' }] : [];

/** 物体的世界转角（绕规格 z 轴）→ 四元数 */
function rotQ(c: Ctx, deg: number) { return new THREE.Quaternion().setFromAxisAngle(c.w.spec.up === 'z' ? Y : new THREE.Vector3(0, 0, 1), deg * D2R); }
/** 规格坐标里的尺寸 → 世界坐标里的尺寸（取绝对值） */
const wsize = (c: Ctx, s: V3): V3 => c.w.w(s).map(Math.abs) as V3;

function emissivePulse(m: THREE.Material, k: number, t: number) {
  const s = m as THREE.MeshPhysicalMaterial;
  if (!s.emissive) return;
  s.emissiveIntensity = k > 0 ? 0.18 + 0.22 * k * (0.5 + 0.5 * Math.sin(t * 6)) : (s.userData.baseEmissive ?? 0);
}
function bodyMat(c: Ctx, o: S3DObject, def: string) {
  const m = c.mats.own(c.mats.body(colorOf(o, def), String(o.material ?? 'plastic')).clone());
  m.emissive = new THREE.Color(colorOf(o, def)); m.emissiveIntensity = 0; m.userData.baseEmissive = 0;
  if (typeof o.opacity === 'number' && o.opacity < 1) { m.transparent = true; m.opacity = Math.max(0.05, o.opacity); }
  return m;
}

// ── 物体 ────────────────────────────────────────────────
function boxLike(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const isCart = o.type === 'cart';
  const s = wsize(c, w.vec(o, 'size', 0, isCart ? DEF.cart : DEF.box)!);
  const root = new THREE.Group();
  const mat = bodyMat(c, o, isCart ? '#ff9f43' : '#4f8cff');
  const r = Math.min(s[0], s[1], s[2]) * 0.12;
  const body = new THREE.Mesh(new RoundedBoxGeometry(s[0], s[1], s[2], 4, r), mat);
  body.castShadow = body.receiveShadow = true;
  root.add(body);
  const wheels: THREE.Mesh[] = [];
  const wr = isCart ? Math.min(0.2, s[1] * 0.5) : 0;
  if (isCart) {
    body.position.y = wr * 0.6;
    const tire = c.mats.matte('#1f2430', 0.85), hub = c.mats.metal('#cfd6e0');
    const tg = new THREE.CylinderGeometry(wr, wr, s[2] * 0.16, 28), hg = new THREE.CylinderGeometry(wr * 0.45, wr * 0.45, s[2] * 0.17, 16);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wg = new THREE.Group();
      const ti = new THREE.Mesh(tg, tire), hu = new THREE.Mesh(hg, hub);
      ti.rotation.x = hu.rotation.x = Math.PI / 2; ti.castShadow = true;
      wg.add(ti, hu);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(wr * 1.5, wr * 0.18, s[2] * 0.175), hub); wg.add(spoke);
      wg.position.set(sx * s[0] * 0.32, -s[1] / 2 + wr * 0.1, sz * s[2] * 0.42);
      root.add(wg); wheels.push(wg as unknown as THREE.Mesh);
    }
  }
  const front = (t: number): V3 | null => { const p = w.pos(o.id, t); return p ? add(p, [0, isCart ? wr * 0.6 : 0, s[2] / 2 + 0.02]) : null; };
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t);
      if (!root.visible) return;
      const p = w.pos(o.id, t); if (p) root.position.set(...p);
      root.quaternion.copy(rotQ(c, w.rot(o, t)));
      const sc = w.num(o, 'scale', t, 1); root.scale.setScalar(sc);
      if (isCart) { const sv = w.metric(o.id, typeof o.on === 'string' ? 's' : 'x', t); for (const wh of wheels) wh.rotation.z = -sv / Math.max(0.05, wr); }
      emissivePulse(mat, w.highlight(o, t), t);
    },
    labels: objLabel(c, o, front),
  };
}

function ball(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const isCharge = o.type === 'charge';
  const q = isCharge ? w.num(o, 'q', 0, 1) : 0;
  const r = w.num(o, 'r', 0, isCharge ? DEF.chargeR : DEF.ballR);
  const root = new THREE.Group();
  const col = colorOf(o, isCharge ? (q >= 0 ? '#ff5d5d' : '#4f8cff') : '#ff9f43');
  const mat = bodyMat(c, o, col);
  if (isCharge) { mat.emissiveIntensity = 0.35; mat.userData.baseEmissive = 0.35; }
  const sph = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat);
  sph.castShadow = sph.receiveShadow = true;
  root.add(sph);
  if (!isCharge) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.002, r * 0.07, 10, 48), c.mats.matte('#ffffff', 0.5));
    root.add(band);
    const band2 = band.clone(); band2.rotation.y = Math.PI / 2; root.add(band2);
  } else {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: c.mats.own(glowTex(q >= 0 ? 'rgba(255,120,120,1)' : 'rgba(120,170,255,1)', 'rgba(0,0,0,0)')), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    c.mats.own(halo.material); halo.scale.setScalar(r * 5); root.add(halo);
  }
  const labels = objLabel(c, o, (t) => w.pos(o.id, t), (t) => { const p = w.pos(o.id, t); return p ? [0, 1, 0] : null; });
  if (isCharge) labels.push({ key: o.id + ':sign', text: () => (q >= 0 ? '+' : '−'), at: (t) => w.pos(o.id, t), kind: 'tag', size: 'l', color: '#ffffff', visible: (t) => w.visible(o, t), prio: 9 });
  if (labels[0] && isCharge) labels[0].dir = () => [1, 1, 0];
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const p = w.pos(o.id, t); if (p) root.position.set(...p);
      root.quaternion.copy(rotQ(c, w.rot(o, t)));
      root.scale.setScalar(w.num(o, 'scale', t, 1));
      emissivePulse(mat, w.highlight(o, t), t);
    },
    labels: labels.map((l) => (l.kind === 'body' && !isCharge ? { ...l, dir: () => [0.7, 1, 0] as V3 } : l)),
  };
}

function cylinder(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const r = w.num(o, 'r', 0, 0.4), h = w.num(o, 'h', 0, 1);
  const mat = bodyMat(c, o, '#34d399');
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), mat); m.castShadow = m.receiveShadow = true;
  const root = new THREE.Group(); root.add(m);
  const ax = String(o.axis ?? 'y');
  if (ax === 'x') m.rotation.z = Math.PI / 2; else if (ax === 'z') m.rotation.x = Math.PI / 2;
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) root.position.set(...p); root.quaternion.copy(rotQ(c, w.rot(o, t))); emissivePulse(mat, w.highlight(o, t), t); }, labels: objLabel(c, o, (t) => w.pos(o.id, t)) };
}

// ── 支撑面 ──────────────────────────────────────────────
function slab(c: Ctx, size: V3, rough: boolean, hatchFace: 'front' | 'bottom' | 'side', base = '#46536a') {
  const top = c.mats.own(new THREE.MeshStandardMaterial({ map: c.mats.own(surfaceTex(rough, base)), roughness: rough ? 0.85 : 0.3, metalness: 0.05 }));
  (top.map as THREE.Texture).repeat.set(Math.max(1, size[0] / 2), Math.max(1, size[2] / 2));
  const hatch = c.mats.own(new THREE.MeshStandardMaterial({ map: c.mats.own(hatchTex()), roughness: 0.8 }));
  (hatch.map as THREE.Texture).repeat.set(Math.max(1, size[0] / 0.6), Math.max(1, size[1] / 0.6));
  const side = c.mats.matte('#3a4558', 0.8);
  // BoxGeometry 面顺序：+x -x +y -y +z -z
  const mats = [side, side, top, side, side, side];
  if (hatchFace === 'front') mats[4] = hatch; else if (hatchFace === 'bottom') { mats[3] = hatch; mats[4] = hatch; } else { mats[0] = hatch; mats[1] = hatch; mats[4] = hatch; }
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mats);
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

function ground(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const p = w.vec(o, 'pos', 0, [0, 0, 0])!, sz = w.vec(o, 'size', 0, [DEF.groundLen, DEF.groundDepth, 0])!;
  const L = sz[0], D = sz[1] || DEF.groundDepth, T = Math.max(0.15, c.u * 0.28);
  const m = slab(c, [L, T, D], !!o.rough, 'front');
  const root = new THREE.Group(); root.add(m);
  m.position.set(0, -T / 2, 0);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(L, T * 0.06, 0.02), c.mats.flat('#9cc7ff', 0.55)); edge.position.set(0, -0.005, D / 2 + 0.005); root.add(edge);
  root.position.set(...w.w(p));
  if (w.spec.up === 'z') root.rotation.y = 0;
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); }, labels: objLabel(c, o, () => w.w(add(p, [L / 2 - 0.6, -T / 2, 0])), () => [0, -1, 0], 'tag', 2) };
}

function wallLike(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const p = w.vec(o, 'pos', 0, [0, 0, 0])!, T = Math.max(0.15, c.u * 0.28);
  const root = new THREE.Group();
  if (o.type === 'wall') {
    const H = w.num(o, 'height', 0, 4), D = w.num(o, 'depth', 0, 3), side = o.side === 'right' ? 1 : -1;
    const m = slab(c, [T, H, D], false, 'side'); m.position.set(side * T / 2, H / 2, 0); root.add(m);
  } else {
    const sz = w.vec(o, 'size', 0, [6, 3, 0])!;
    const m = slab(c, [sz[0], T, sz[1] || 3], false, 'bottom'); m.position.set(0, T / 2, 0); root.add(m);
  }
  root.position.set(...w.w(p));
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); }, labels: objLabel(c, o, () => w.w(p), undefined, 'tag', 2) };
}

/** 角度弧（扇形 + 弧线 + 文字） */
function arcMesh(c: Ctx, color: string, r: number, sweep: number) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48, 0, sweep), c.mats.flat(color, 0.22)); fill.renderOrder = 2;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) { const a = (sweep * i) / 40; pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0)); }
  const line = new Tube(c.mats.glow(color, 0.6), Math.max(0.008, c.u * 0.018)); line.set(pts, true);
  g.add(fill, line.mesh);
  return g;
}

function incline(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const g = w.incline(o, 0);
  const sh = new THREE.Shape();
  const sx = g.dir === 'right' ? 1 : -1;
  sh.moveTo(0, 0); sh.lineTo(sx * g.base, 0); sh.lineTo(sx * g.base, g.height); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: g.depth, bevelEnabled: true, bevelSize: Math.min(0.04, g.height * 0.02), bevelThickness: 0.03, bevelSegments: 2 });
  geo.translate(0, 0, -g.depth / 2);
  const rough = !!o.rough;
  const mat = c.mats.own(new THREE.MeshPhysicalMaterial({ color: colorOf(o, rough ? '#5f6d86' : '#6d84a6'), roughness: rough ? 0.85 : 0.3, clearcoat: rough ? 0 : 0.5, map: c.mats.own(surfaceTex(rough, '#ffffff')) }));
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true;
  const root = new THREE.Group(); root.add(m);
  root.position.set(...w.w(g.low));
  const labels: LabelItem[] = [];
  if (o.showAngle !== false) {
    const r = Math.min(g.length * 0.22, Math.max(0.5, c.u * 0.9));
    const arc = arcMesh(c, '#fbbf24', r, g.angle * D2R);
    arc.position.z = g.depth / 2 + 0.01;
    if (sx < 0) { arc.position.x = 0; arc.scale.x = -1; }
    root.add(arc);
    const mid = (g.angle / 2) * D2R;
    labels.push({ key: o.id + ':ang', text: () => (typeof o.label === 'string' && o.label ? o.label : fmt(g.angle, 1) + '°'), at: () => w.w(add(g.low, [sx * (r + c.u * 0.35) * Math.cos(mid), (r + c.u * 0.35) * Math.sin(mid), g.depth / 2])), color: '#fbbf24', kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 6 });
  }
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); }, labels };
}

function conveyor(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const f = w.frame(o.id, 0)!;
  const L = f.length, D = w.num(o, 'depth', 0, 1.6), r = w.num(o, 'r', 0, 0.28);
  const root = new THREE.Group();
  const tex = c.mats.own(beltTex()); tex.repeat.set(L / 1.2, 1);
  const beltMat = c.mats.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  const top = new THREE.Mesh(new THREE.BoxGeometry(L, 0.04, D), [c.mats.matte('#20252e'), c.mats.matte('#20252e'), beltMat, c.mats.matte('#20252e'), c.mats.matte('#2a303b'), c.mats.matte('#2a303b')]);
  top.position.set(L / 2, -0.02, 0); top.receiveShadow = true;
  const bot = new THREE.Mesh(new THREE.BoxGeometry(L, 0.04, D), c.mats.matte('#20252e')); bot.position.set(L / 2, -2 * r + 0.02, 0);
  root.add(top, bot);
  const rollers: THREE.Object3D[] = [];
  const rg = new THREE.CylinderGeometry(r - 0.02, r - 0.02, D * 1.04, 32);
  for (const x of [0, L]) {
    const rl = new THREE.Group();
    const m = new THREE.Mesh(rg, c.mats.metal('#b9c3d1')); m.rotation.x = Math.PI / 2; m.castShadow = true;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 0.18, D * 1.05), c.mats.matte('#ff9f43', 0.5));
    rl.add(m, mark); rl.position.set(x, -r, 0); root.add(rl); rollers.push(rl);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, D, 32, 1, true, x ? -Math.PI / 2 : Math.PI / 2, Math.PI), c.mats.matte('#20252e'));
    shell.rotation.x = Math.PI / 2; shell.position.set(x, -r, 0); root.add(shell);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(L, 2 * r * 0.7, 0.06), c.mats.metal('#566278', 0.5)); frame.position.set(L / 2, -r, D / 2 + 0.06); root.add(frame);
  root.position.set(...w.w(f.o));
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t);
      const shift = w.conveyorShift(o, t);
      tex.offset.x = -shift / 1.2;
      for (const rl of rollers) rl.rotation.z = -shift / r;
    },
    labels: objLabel(c, o, () => w.w(add(f.o, [L / 2, -2 * r, D / 2])), () => [0, -1, 0], 'tag', 3),
  };
}

function pulley(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const r = w.num(o, 'r', 0, DEF.pulleyR), th = r * 0.42;
  const root = new THREE.Group(), wheel = new THREE.Group();
  const profile: THREE.Vector2[] = [];
  const pts: [number, number][] = [[0.18, -0.5], [1, -0.5], [1, -0.32], [0.84, -0.12], [0.84, 0.12], [1, 0.32], [1, 0.5], [0.18, 0.5]];
  for (const [a, b] of pts) profile.push(new THREE.Vector2(a * r, b * th));
  const disc = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), c.mats.metal(colorOf(o, '#c9d2de'), 0.3));
  disc.rotation.x = Math.PI / 2; disc.castShadow = true;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, th * 0.7, 48), c.mats.metal('#8b97a8', 0.45)); face.rotation.x = Math.PI / 2;
  wheel.add(disc, face);
  for (let k = 0; k < 4; k++) { const hole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.13, th * 0.75, 20), c.mats.matte('#2a313d')); hole.rotation.x = Math.PI / 2; hole.position.set(r * 0.52 * Math.cos(k * Math.PI / 2), r * 0.52 * Math.sin(k * Math.PI / 2), 0); wheel.add(hole); }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, th * 1.9, 20), c.mats.metal('#eef2f7', 0.2)); axle.rotation.x = Math.PI / 2;
  root.add(wheel, axle);
  const p = w.pos(o.id, 0)!;
  const support = String(o.support ?? 'post');
  const sm = c.mats.metal('#6b778a', 0.4);
  if (support === 'post' || support === 'ceiling' || support === 'wall') {
    const down = support === 'post';
    const yEnd = down ? c.floorY : p[1] + Math.max(1, r * 4);
    const yLen = Math.abs(p[1] - yEnd);
    for (const z of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.6, 0.04), sm); plate.position.set(0, down ? -r * 0.4 : r * 0.4, z * th * 0.95); root.add(plate);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, 0.06, th * 2), sm); bar.position.set(0, down ? -r * 1.2 : r * 1.2, 0); root.add(bar);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.13, Math.max(0.01, yLen - r * 1.2), 16), sm);
    post.position.set(0, down ? -(r * 1.2 + (yLen - r * 1.2) / 2) : r * 1.2 + (yLen - r * 1.2) / 2, 0); post.castShadow = true; root.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.7, 0.08, 32), sm); base.position.set(0, down ? -yLen + 0.04 : yLen - 0.04, 0); base.castShadow = base.receiveShadow = true; root.add(base);
  }
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); const q = w.pos(o.id, t); if (q) root.position.set(...q); wheel.rotation.z = (w.has(o, 'spin') ? w.num(o, 'spin', t, 0) : 0) * D2R; },
    labels: objLabel(c, o, (t) => w.pos(o.id, t), () => [0, 1, 0], 'tag', 3),
  };
}

// ── 连接件 ──────────────────────────────────────────────
/** 端点是物体时，连接点放在物体表面（朝向另一端） */
function attach(c: Ctx, ref: unknown, toward: V3, t: number): V3 | null {
  const { w } = c;
  const p = w.point(ref, t);
  if (!p || typeof ref !== 'string') return p;
  const o = w.byId.get(ref);
  if (!o) return p;
  const d = sub(toward, p);
  if (len(d) < 1e-6) return p;
  if (o.type === 'box' || o.type === 'cart') {
    const s = wsize(c, w.vec(o, 'size', t, o.type === 'box' ? DEF.box : DEF.cart)!);
    const q = rotQ(c, w.rot(o, t)), inv = q.clone().invert();
    const dl = V(d).applyQuaternion(inv);
    let k = Infinity;
    for (let i = 0; i < 3; i++) { const comp = [dl.x, dl.y, dl.z][i]; if (Math.abs(comp) > 1e-9) k = Math.min(k, (s[i] / 2) / Math.abs(comp)); }
    if (!Number.isFinite(k) || k >= 1) return p;
    return add(p, d, k);
  }
  if (o.type === 'ball' || o.type === 'charge') { const r = w.num(o, 'r', t, DEF.ballR); return add(p, norm(d), Math.min(r, len(d))); }
  if (o.type === 'pendulum') return p;
  return p;
}

/** 绳子绕过滑轮：外切线 + 圆弧（在滑轮所在的竖直平面里） */
export function ropePath(c: Ctx, o: S3DObject, t: number): THREE.Vector3[] | null {
  const { w } = c;
  const pulleys = (Array.isArray(o.via) ? o.via as string[] : []).map((id) => ({ C: w.pos(id, t), r: w.num(w.byId.get(id)!, 'r', t, DEF.pulleyR) })).filter((x) => x.C) as { C: V3; r: number }[];
  const rawA = w.point(o.from, t), rawB = w.point(o.to, t);
  if (!rawA || !rawB) return null;
  if (!pulleys.length) {
    const a = attach(c, o.from, rawB, t)!, b = attach(c, o.to, rawA, t)!;
    return [V(a), V(b)];
  }
  // 平面：滑轮所在 z（世界）；在 (x,y) 里做切线
  const z = pulleys[0].C[2];
  const tangentFrom = (X: [number, number], C: [number, number], r: number, wdir: number, entering: boolean): [number, number] => {
    const dx = X[0] - C[0], dy = X[1] - C[1], d = Math.hypot(dx, dy);
    if (d <= r * 1.0001) return [C[0] + (dx / (d || 1)) * r, C[1] + (dy / (d || 1)) * r];
    const base = Math.atan2(dy, dx), al = Math.acos(r / d);
    const cands: [number, number][] = [[C[0] + r * Math.cos(base + al), C[1] + r * Math.sin(base + al)], [C[0] + r * Math.cos(base - al), C[1] + r * Math.sin(base - al)]];
    for (const T of cands) {
      const tau = [-(T[1] - C[1]) * wdir, (T[0] - C[0]) * wdir];
      const tr = entering ? [T[0] - X[0], T[1] - X[1]] : [X[0] - T[0], X[1] - T[1]];
      if (tau[0] * tr[0] + tau[1] * tr[1] > 0) return T;
    }
    return cands[0];
  };
  const pts: THREE.Vector3[] = [];
  let A = attach(c, o.from, pulleys[0].C, t)!;
  // 用第一个切点再修正一次端点
  let cur: [number, number] = [A[0], A[1]];
  const end = attach(c, o.to, pulleys[pulleys.length - 1].C, t)!;
  for (let i = 0; i < pulleys.length; i++) {
    const { C, r } = pulleys[i];
    const N = i + 1 < pulleys.length ? pulleys[i + 1].C : end;
    const cr = (C[0] - cur[0]) * (N[1] - C[1]) - (C[1] - cur[1]) * (N[0] - C[0]);
    const wdir = cr > 0 ? 1 : -1;
    const T = tangentFrom(cur, [C[0], C[1]], r, wdir, true);
    if (i === 0) { A = attach(c, o.from, [T[0], T[1], z], t)!; cur = [A[0], A[1]]; pts.push(new THREE.Vector3(A[0], A[1], A[2])); }
    const T2 = tangentFrom(cur, [C[0], C[1]], r, wdir, true);
    const U = tangentFrom([N[0], N[1]], [C[0], C[1]], r, wdir, false);
    pts.push(new THREE.Vector3(T2[0], T2[1], z));
    const aT = Math.atan2(T2[1] - C[1], T2[0] - C[0]), aU = Math.atan2(U[1] - C[1], U[0] - C[0]);
    let sweep = aU - aT;
    if (wdir > 0) { while (sweep < 0) sweep += 2 * Math.PI; } else { while (sweep > 0) sweep -= 2 * Math.PI; }
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / 0.12));
    for (let k = 1; k < n; k++) { const a = aT + (sweep * k) / n; pts.push(new THREE.Vector3(C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), z)); }
    pts.push(new THREE.Vector3(U[0], U[1], z));
    cur = U;
  }
  const B = attach(c, o.to, [cur[0], cur[1], z], t)!;
  pts.push(new THREE.Vector3(B[0], B[1], B[2]));
  return pts;
}

function rope(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const tube = new Tube(c.mats.matte(colorOf(o, '#e3cf9f'), 0.7), Math.max(0.012, c.u * 0.03));
  const root = new THREE.Group(); root.add(tube.mesh);
  let last: THREE.Vector3[] = [];
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); if (!root.visible) return; const p = ropePath(c, o, t); if (p) { tube.set(p); last = p; } },
    labels: objLabel(c, o, () => { if (last.length < 2) return null; const a = last[0], b = last[1]; return [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]; }, () => { if (last.length < 2) return null; const d = last[1].clone().sub(last[0]); return [-d.y, d.x, 0]; }, 'vec', 4),
  };
}

function spring(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const coils = Math.max(3, Math.min(40, Math.round(w.num(o, 'coils', 0, 12)))), R = w.num(o, 'r', 0, Math.max(0.1, c.u * 0.16));
  const tube = new Tube(c.mats.metal(colorOf(o, '#d6dde8'), 0.25), R * 0.16);
  const root = new THREE.Group(); root.add(tube.mesh);
  let mid: V3 | null = null;
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const ra = w.point(o.from, t), rb = w.point(o.to, t); if (!ra || !rb) return;
      const a = attach(c, o.from, rb, t)!, b = attach(c, o.to, ra, t)!;
      const d = sub(b, a), L = len(d); if (L < 1e-4) return;
      const ax = norm(d), ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], p1 = norm(cross(ax, ref)), p2 = cross(ax, p1);
      const lead = Math.min(L * 0.12, R * 1.2), body = L - 2 * lead, n = coils * 18;
      const pts: THREE.Vector3[] = [V(a), V(add(a, ax, lead * 0.6))];
      for (let i = 0; i <= n; i++) {
        const k = i / n, ang = k * coils * 2 * Math.PI, rr = R * Math.min(1, Math.min(k, 1 - k) * 12);
        pts.push(V(add(add(add(a, ax, lead + body * k), p1, rr * Math.cos(ang)), p2, rr * Math.sin(ang))));
      }
      pts.push(V(add(a, ax, L - lead * 0.6)), V(b));
      tube.set(pts, true);
      mid = add(a, d, 0.5);
    },
    labels: objLabel(c, o, () => mid, () => [0, 1, 0], 'tag', 4),
  };
}

function rod(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const r = w.num(o, 'r', 0, Math.max(0.02, c.u * 0.06));
  const mat = c.mats.metal(colorOf(o, '#aab4c3'), 0.35);
  const m = cylMesh(mat), e1 = new THREE.Mesh(unitSphere, mat), e2 = new THREE.Mesh(unitSphere, mat);
  e1.scale.setScalar(r * 1.3); e2.scale.setScalar(r * 1.3);
  const root = new THREE.Group(); root.add(m, e1, e2);
  let mid: V3 | null = null;
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); const a = w.point(o.from, t), b = w.point(o.to, t); if (!a || !b) return; setCyl(m, V(a), V(b), r); e1.position.set(...a); e2.position.set(...b); mid = add(a, sub(b, a), 0.5); },
    labels: objLabel(c, o, () => mid, () => [0, 1, 0], 'tag', 4),
  };
}

function pendulum(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const br = w.num(o, 'r', 0, 0.28);
  const root = new THREE.Group();
  const bobMat = bodyMat(c, o, '#f5c542'); bobMat.metalness = 0.6; bobMat.roughness = 0.25;
  const bob = new THREE.Mesh(new THREE.SphereGeometry(br, 48, 32), bobMat); bob.castShadow = true;
  const str = cylMesh(c.mats.matte('#e5e7eb', 0.6));
  const g0 = w.pendulum(o, 0);
  const pv = V(w.w(g0.pivot));
  const mount = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.8, g0.L * 0.5), 0.08, 0.8), c.mats.metal('#6b778a', 0.4)); mount.position.copy(pv).add(new THREE.Vector3(0, 0.04, 0)); mount.castShadow = true;
  const hinge = new THREE.Mesh(unitSphere, c.mats.metal('#eef2f7')); hinge.scale.setScalar(0.06); hinge.position.copy(pv);
  const ref = new Dashed(c.mats.flat('#94a3b8', 0.7), Math.max(0.006, c.u * 0.012), c.u * 0.18);
  ref.set(pv, pv.clone().add(new THREE.Vector3(0, -g0.L * 1.05, 0)));
  const arcG = new THREE.Group();
  root.add(bob, str, mount, hinge, ref.mesh, arcG);
  let arcSig = '';
  const labels: LabelItem[] = objLabel(c, o, (t) => w.pos(o.id, t), () => [1, 0, 0]);
  labels.push({ key: o.id + ':ang', text: (t) => fmt(Math.abs(w.pendulum(o, t).angle), 1) + '°', at: (t) => { const g = w.pendulum(o, t), a = (g.angle / 2) * D2R, rr = Math.min(g.L * 0.35, 1.2); return w.w([g.pivot[0] + rr * Math.sin(a), g.pivot[1] - rr * Math.cos(a), g.pivot[2]]); }, kind: 'tag', color: '#fbbf24', size: 's', visible: (t) => w.visible(o, t) && Math.abs(w.pendulum(o, t).angle) > 3, prio: 3 });
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const g = w.pendulum(o, t), b = V(w.w(g.bob)), p = V(w.w(g.pivot));
      bob.position.copy(b); setCyl(str, p, b, Math.max(0.008, c.u * 0.014));
      emissivePulse(bobMat, w.highlight(o, t), t);
      const sig = g.angle.toFixed(1);
      if (sig !== arcSig) {
        arcSig = sig; arcG.clear();
        if (Math.abs(g.angle) > 1) {
          const rr = Math.min(g.L * 0.28, 1.0), arc = arcMesh(c, '#fbbf24', rr, Math.abs(g.angle) * D2R);
          arc.position.copy(p); arc.rotation.z = g.angle > 0 ? -Math.PI / 2 : -Math.PI / 2 - Math.abs(g.angle) * D2R;
          arcG.add(arc);
        }
      }
    },
    labels,
  };
}

// ── 矢量、角、轨迹、标注 ────────────────────────────────
function dirOf(c: Ctx, o: S3DObject, t: number): V3 | null {
  const { w } = c;
  const d = o.dir;
  if (typeof d === 'string' && d in DIR_WORDS) return DIR_WORDS[d];
  if (typeof d === 'string' && (d === 'normal' || d === '-normal' || d === 'along' || d === '-along')) {
    const host = typeof o.at === 'string' ? w.byId.get(o.at) : undefined;
    const f = host && typeof host.on === 'string' ? w.frame(host.on, t) : null;
    const v: V3 = f ? (d.endsWith('normal') ? f.n : f.u) : d.endsWith('normal') ? [0, 1, 0] : [1, 0, 0];
    return w.w(d.startsWith('-') ? scale(v, -1) : v);
  }
  if (Array.isArray(d)) return norm(w.w(w.vec(o, 'dir', t, [0, 1, 0])!));
  if (d !== undefined) { const a = w.num(o, 'dir', t, 90) * D2R; return norm(w.w([Math.cos(a), Math.sin(a), 0])); }
  return null;
}

function arrow(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const kind = String(o.kind ?? 'force');
  const color = colorOf(o, KIND_COLOR[kind] ?? KIND_COLOR.force);
  // 矢量永远画在最上层：力常常指进斜面 / 地面里，被挡住就看不见了
  const mat = c.mats.overlay(color);
  const ar = new Arrow3(mat, c.u, !!o.dashed);
  const root = ar.root;
  root.traverse((m) => { m.renderOrder = 20; });
  let tip: V3 | null = null, dirv: V3 | null = null;
  const geom = (t: number): [V3, V3] | null => {
    let O: V3 | null = typeof o.at === 'string' ? w.pos(o.at, t) : w.point(o.from, t);
    if (!O) return null;
    if (Array.isArray(o.offset)) O = add(O, w.w(w.vec(o, 'offset', t, [0, 0, 0])!));
    let vec: V3;
    if (o.to !== undefined && o.dir === undefined) {
      const T = w.point(o.to, t); if (!T) return null;
      vec = sub(T, O);
      if (w.has(o, 'len')) vec = scale(norm(vec), w.num(o, 'len', t, 1));
    } else {
      const d = dirOf(c, o, t) ?? [0, 1, 0];
      vec = scale(norm(d), w.num(o, 'len', t, 1.3 * c.u));
    }
    return [O, vec];
  };
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const g = geom(t); if (!g) { root.visible = false; return; }
      const k = 1 + 0.25 * w.highlight(o, t) * (0.5 + 0.5 * Math.sin(t * 6));
      ar.set(V(g[0]), V(g[1]), k);
      tip = add(g[0], g[1]); dirv = g[1];
    },
    labels: objLabel(c, o, (t) => { const g = geom(t); return g ? add(g[0], g[1]) : tip; }, (t) => { const g = geom(t); return g ? g[1] : dirv; }, 'vec', 8)
      .map((l) => ({ ...l, color, visible: (t: number) => { if (!l.visible(t)) return false; const g = geom(t); return !!g && Math.hypot(...g[1]) > 0.12 * c.u; } })),
  };
}

function angleObj(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#fbbf24');
  const root = new THREE.Group();
  const r0 = w.num(o, 'r', 0, 0.75 * c.u);
  let sig = '';
  let labelAt: V3 | null = null;
  const build = (t: number) => {
    let P: V3 | null, e1: V3, e2: V3, sweep: number;
    if (Array.isArray(o.between) && (o.between as unknown[]).length === 3) {
      const [A, B, C] = (o.between as unknown[]).map((p) => w.point(p, t));
      if (!A || !B || !C) return;
      P = B; const a = norm(sub(A, B)), b = norm(sub(C, B));
      e1 = a; const perp = sub(b, scale(a, dot(a, b))); e2 = norm(perp); sweep = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    } else {
      P = typeof o.at === 'string' && w.byId.has(o.at) ? w.pos(o.at, t) : w.point(o.at, t);
      if (!P) return;
      const f = w.num(o, 'from', t, 0), to = w.num(o, 'to', t, 30);
      const lo = Math.min(f, to) * D2R;
      e1 = norm(w.w([Math.cos(lo), Math.sin(lo), 0])); e2 = norm(w.w([-Math.sin(lo), Math.cos(lo), 0])); sweep = Math.abs(to - f) * D2R;
    }
    const s = `${P.map((x) => x.toFixed(3))}|${e1.map((x) => x.toFixed(3))}|${sweep.toFixed(3)}`;
    if (s === sig) return;
    sig = s; root.clear();
    const arc = arcMesh(c, color, r0, sweep);
    const basis = new THREE.Matrix4().makeBasis(V(e1), V(e2), V(cross(e1, e2)));
    arc.quaternion.setFromRotationMatrix(basis); arc.position.set(...P);
    root.add(arc);
    const mid = sweep / 2, rr = r0 + c.u * 0.38;
    labelAt = add(P, add(scale(e1, rr * Math.cos(mid)), scale(e2, rr * Math.sin(mid))));
  };
  const deg = (t: number) => {
    if (Array.isArray(o.between)) { const [A, B, C] = (o.between as unknown[]).map((p) => w.point(p, t)); return A && B && C ? Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(A, B)), norm(sub(C, B)))))) / D2R : 0; }
    return Math.abs(w.num(o, 'to', t, 30) - w.num(o, 'from', t, 0));
  };
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); if (root.visible) build(t); },
    labels: [{ key: o.id, text: (t) => (typeof o.label === 'string' && o.label ? templ(w, o.label, t) : fmt(deg(t), 1) + '°'), at: () => labelAt, color, kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 6 }],
  };
}

function trail(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#7dd3fc');
  const tube = new Tube(c.mats.flat(color, 0.75), Math.max(0.008, c.u * 0.016));
  const dots = new THREE.InstancedMesh(unitSphere, c.mats.glow(color, 0.7), 40); dots.count = 0;
  const root = new THREE.Group(); root.add(tube.mesh, dots);
  const id = String(o.of);
  const N = 32, dr = Math.max(0.02, c.u * 0.05);
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const secs = w.has(o, 'seconds') ? w.num(o, 'seconds', t, w.D) : w.D;
      const t0 = Math.max(0, t - secs), n = Math.max(2, Math.min(160, Math.ceil(((t - t0) / w.D) * 160)));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) { const p = w.pos(id, t0 + ((t - t0) * i) / n); if (p) pts.push(V(p)); }
      tube.set(pts, true);
      if (o.dots !== false) {
        const m = new THREE.Matrix4(); let k = 0;
        for (let i = 0; i <= N && k < 40; i++) { const ti = (w.D * i) / N; if (ti > t + 1e-6) break; if (ti < t0) continue; const p = w.pos(id, ti); if (!p) continue; m.compose(V(p), new THREE.Quaternion(), new THREE.Vector3(dr, dr, dr)); dots.setMatrixAt(k++, m); }
        dots.count = k; dots.instanceMatrix.needsUpdate = true;
      }
    },
    labels: [],
  };
}

function measure(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#cbd5e1');
  const mat = c.mats.flat(color, 0.9);
  const r = Math.max(0.006, c.u * 0.012);
  const line = cylMesh(mat, false), t1 = cylMesh(mat, false), t2 = cylMesh(mat, false);
  const h1 = new THREE.Mesh(unitCone, mat), h2 = new THREE.Mesh(unitCone, mat);
  const root = new THREE.Group(); root.add(line, t1, t2, h1, h2);
  let mid: V3 | null = null, side: V3 = [0, 1, 0];
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const a0 = w.point(o.from, t), b0 = w.point(o.to, t); if (!a0 || !b0) return;
      const off = Array.isArray(o.offset) ? w.w(w.vec(o, 'offset', t, [0, -0.5, 0])!) : (() => { const d = norm(sub(b0, a0)); const n: V3 = norm(cross(d, [0, 0, 1])); return scale(len(n) > 0.1 ? n : [0, -1, 0], -0.5 * c.u); })();
      const a = add(a0, off), b = add(b0, off);
      setCyl(line, V(a), V(b), r); setCyl(t1, V(a0), V(add(a, off, 0.3)), r * 0.7); setCyl(t2, V(b0), V(add(b, off, 0.3)), r * 0.7);
      const d = norm(sub(b, a)), hl = c.u * 0.18;
      h1.position.set(...add(a, d, hl / 2)); h1.quaternion.setFromUnitVectors(Y, V(scale(d, -1))); h1.scale.set(r * 4, hl, r * 4);
      h2.position.set(...add(b, d, -hl / 2)); h2.quaternion.setFromUnitVectors(Y, V(d)); h2.scale.set(r * 4, hl, r * 4);
      mid = add(a, sub(b, a), 0.5); side = norm(off);
    },
    labels: objLabel(c, o, () => mid, () => side, 'tag', 5).map((l) => ({ ...l, color })),
  };
}

function field(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const kind = String(o.kind ?? 'B');
  const color = colorOf(o, kind === 'E' ? '#fbbf24' : kind === 'g' ? '#94a3b8' : '#60a5fa');
  const p = w.w(w.vec(o, 'pos', 0, [0, 1.5, 0])!), s = wsize(c, w.vec(o, 'size', 0, [6, 3, 1])!);
  const root = new THREE.Group();
  const region = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), c.mats.own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, depthWrite: false })));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(region.geometry), c.mats.own(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 })));
  region.position.set(...p); edges.position.set(...p);
  root.add(region, edges);
  const dir = norm(dirOf(c, o, 0) ?? (kind === 'B' ? [0, 0, -1] : [1, 0, 0]));
  const dens = Math.max(2, Math.min(9, Math.round(w.num(o, 'density', 0, 5))));
  const mat = c.mats.glow(color, 0.5);
  // 场线：垂直于方向的平面上排一组箭头
  const ref: V3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], a = norm(cross(dir, ref)), b = cross(dir, a);
  const ext = (v: V3) => Math.abs(v[0]) * s[0] + Math.abs(v[1]) * s[1] + Math.abs(v[2]) * s[2];
  const ea = ext(a), eb = ext(b), ed = ext(dir);
  const na = Math.max(2, Math.round(dens * Math.max(0.5, ea / Math.max(ea, eb)))), nb = Math.max(2, Math.round(dens * Math.max(0.5, eb / Math.max(ea, eb))));
  const arrows: Arrow3[] = [];
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const ar = new Arrow3(mat, c.u * 0.75);
    const o0 = add(add(add(p, a, ((i + 0.5) / na - 0.5) * ea), b, ((j + 0.5) / nb - 0.5) * eb), dir, -ed * 0.42);
    ar.set(V(o0), V(scale(dir, ed * 0.84)));
    root.add(ar.root); arrows.push(ar);
  }
  const corner = add(p, [-s[0] / 2, s[1] / 2, s[2] / 2]);
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); },
    labels: [{ key: o.id, text: () => (typeof o.label === 'string' && o.label ? o.label : kind) + (kind === 'B' && Math.abs(dir[2]) > 0.9 ? (dir[2] < 0 ? '（垂直纸面向里）' : '（垂直纸面向外）') : ''), at: () => corner, dir: () => [1, -1, 0], color, kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 4 }],
  };
}

function wave(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#22d3ee');
  const p0 = w.w(w.vec(o, 'pos', 0, [-4, 1, 0])!), L = w.num(o, 'length', 0, 8);
  const lon = o.kind === 'longitudinal';
  const n = Math.max(24, Math.min(160, Math.round(L * 10)));
  const beads = new THREE.InstancedMesh(unitSphere, bodyMat(c, o, color), n + 1);
  const tube = new Tube(c.mats.flat(color, 0.6), Math.max(0.008, c.u * 0.02));
  const root = new THREE.Group(); root.add(beads); if (!lon) root.add(tube.mesh);
  const br = Math.max(0.03, c.u * 0.06);
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const A = w.num(o, 'amp', t, 0.5), lam = Math.max(0.1, w.num(o, 'lambda', t, 2)), v = w.num(o, 'speed', t, 1);
      const k = (2 * Math.PI) / lam, om = k * v, m = new THREE.Matrix4(), pts: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const x = (L * i) / n, front = v > 0 ? v * t : Infinity;
        const ph = x <= front ? Math.sin(k * x - om * t) : 0;
        const pos = lon ? new THREE.Vector3(p0[0] + x + A * 0.6 * ph, p0[1], p0[2]) : new THREE.Vector3(p0[0] + x, p0[1] + A * -ph, p0[2]);
        pts.push(pos); m.compose(pos, new THREE.Quaternion(), new THREE.Vector3(br, br, br)); beads.setMatrixAt(i, m);
      }
      beads.instanceMatrix.needsUpdate = true;
      if (!lon) tube.set(pts, true);
    },
    labels: objLabel(c, o, () => add(p0, [L / 2, 0, 0]), () => [0, 1, 0], 'tag', 3),
  };
}

// ── 数学 ────────────────────────────────────────────────
function axes(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const p = w.vec(o, 'pos', 0, [0, 0, 0])!;
  const X = w.vec(o, 'x', 0, [-4, 4, 0])!, Yr = w.vec(o, 'y', 0, [-3, 3, 0])!, Z = Array.isArray(o.z) ? w.vec(o, 'z', 0, [-3, 3, 0])! : null;
  const labelsTxt = Array.isArray(o.labels) ? (o.labels as string[]) : ['x', 'y', 'z'];
  const root = new THREE.Group(), labels: LabelItem[] = [];
  const mat = c.mats.glow('#cbd5e1', 0.25);
  const axisList: [V3, number[], string][] = [[[1, 0, 0], X, labelsTxt[0] ?? 'x'], [[0, 1, 0], Yr, labelsTxt[1] ?? 'y']];
  if (Z) axisList.push([[0, 0, 1], Z, labelsTxt[2] ?? 'z']);
  for (const [e, r, name] of axisList) {
    const a = w.w(add(p, e, r[0])), b = w.w(add(p, e, r[1] + 0.4 * c.u));
    const ar = new Arrow3(mat, c.u * 0.7); ar.set(V(a), V(sub(b, a))); root.add(ar.root);
    labels.push({ key: o.id + name, text: () => name, at: () => b, dir: () => norm(w.w(e)), color: '#e2e8f0', kind: 'vec', size: 'm', visible: (t) => w.visible(o, t), prio: 7, axis: w.w(e) });
    if (o.ticks !== false && r[1] - r[0] <= 16) {
      const stepv = r[1] - r[0] > 8 ? 2 : 1;
      for (let v = Math.ceil(r[0]); v <= Math.floor(r[1]); v += stepv) {
        if (v === 0) continue;
        const q = w.w(add(p, e, v));
        const tk = new THREE.Mesh(unitSphere, c.mats.flat('#cbd5e1')); tk.scale.setScalar(Math.max(0.012, c.u * 0.03)); tk.position.set(...q); root.add(tk);
        const perp: V3 = e[0] ? [0, -1, 0] : e[1] ? [-1, 0, 0] : [-1, 0, 0];
        labels.push({ key: `${o.id}${name}${v}`, text: () => String(v), at: () => q, dir: () => norm(w.w(perp)), color: '#94a3b8', kind: 'tick', size: 's', visible: (t) => w.visible(o, t), prio: 1, axis: w.w(e) });
      }
    }
  }
  labels.push({ key: o.id + 'O', text: () => 'O', at: () => w.w(p), dir: () => norm(w.w([-1, -1, 0])), color: '#94a3b8', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 2 });
  if (o.grid) {
    const pts: number[] = [];
    for (let x = Math.ceil(X[0]); x <= Math.floor(X[1]); x++) pts.push(...w.w(add(p, [x, Yr[0], 0])), ...w.w(add(p, [x, Yr[1], 0])));
    for (let y = Math.ceil(Yr[0]); y <= Math.floor(Yr[1]); y++) pts.push(...w.w(add(p, [X[0], y, 0])), ...w.w(add(p, [X[1], y, 0])));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, c.mats.own(new THREE.LineBasicMaterial({ color: '#7f93b5', transparent: true, opacity: 0.22 }))));
  }
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); }, labels };
}

function curve(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#fbbf24');
  const tube = new Tube(c.mats.glow(color, 0.55), Math.max(0.01, c.u * 0.035 * w.num(o, 'width', 0, 1)));
  const head = new THREE.Mesh(unitSphere, c.mats.glow(color, 0.9)); head.scale.setScalar(Math.max(0.02, c.u * 0.07));
  // 被曲面 / 立体挡住的部分仍淡淡地透出来（像课本里的虚线）
  const ghost = new THREE.Mesh(tube.mesh.geometry, c.mats.get(`ghost|${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, toneMapped: false })));
  ghost.renderOrder = 15;
  const root = new THREE.Group(); root.add(tube.mesh, ghost, head);
  let end: V3 | null = null;
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const all = curvePoints(w, o, t, 220);
      const k = w.has(o, 'draw') ? Math.max(0, Math.min(1, w.num(o, 'draw', t, 1))) : 1;
      const n = Math.max(2, Math.round(all.length * k));
      const pts = all.slice(0, n).map(V);
      tube.set(pts, false);
      ghost.geometry = tube.mesh.geometry;
      head.visible = k < 0.999 && pts.length > 1;
      if (pts.length) { head.position.copy(pts[pts.length - 1]); end = all[n - 1] ?? null; }
    },
    labels: objLabel(c, o, () => end, () => [0.6, 1, 0], 'vec', 6).map((l) => ({ ...l, color })),
  };
}

function heatColor(k: number) {
  const stops: [number, THREE.Color][] = [[0, new THREE.Color('#2b3bd6')], [0.3, new THREE.Color('#1fb5e8')], [0.55, new THREE.Color('#3fd18b')], [0.78, new THREE.Color('#f5d33c')], [1, new THREE.Color('#ff6a3d')]];
  for (let i = 1; i < stops.length; i++) if (k <= stops[i][0]) return stops[i - 1][1].clone().lerp(stops[i][1], (k - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1].clone();
}

function surface(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const X = w.vec(o, 'x', 0, [-2, 2, 0])!, Yr = w.vec(o, 'y', 0, [-2, 2, 0])!;
  const f = w.compileExpr(o.f, ['x', 'y'])!;
  const N = 72;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array((N + 1) * (N + 1) * 3), idx: number[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + 1, cc = a + N + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const solid = o.colorBy === 'solid';
  const mat = c.mats.own(new THREE.MeshPhysicalMaterial({ vertexColors: !solid, color: solid ? colorOf(o, '#4f8cff') : '#ffffff', roughness: 0.42, clearcoat: 0.4, side: THREE.DoubleSide, transparent: true, opacity: typeof o.opacity === 'number' ? o.opacity : 0.93, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  const wire = new THREE.LineSegments(new THREE.BufferGeometry(), c.mats.own(new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22 })));
  const root = new THREE.Group(); root.add(mesh); if (o.wire !== false) root.add(wire);
  let sig = '';
  const sc = { v: {} as Record<string, number>, m: undefined as undefined | ((a: string, b: string) => number) };
  const rebuild = (t: number) => {
    const s = w.scope(t); sc.v = { ...s.v }; sc.m = s.m;
    let lo = Infinity, hi = -Infinity;
    const zs = new Float32Array((N + 1) * (N + 1));
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = X[0] + ((X[1] - X[0]) * i) / N, y = Yr[0] + ((Yr[1] - Yr[0]) * j) / N;
      sc.v.x = x; sc.v.y = y;
      let z = f(sc); if (!Number.isFinite(z)) z = 0; z = Math.max(-50, Math.min(50, z));
      zs[i * (N + 1) + j] = z; lo = Math.min(lo, z); hi = Math.max(hi, z);
    }
    const sgn = `${lo.toFixed(4)}|${hi.toFixed(4)}|${zs[7].toFixed(4)}|${zs[(N + 1) * 30 + 11].toFixed(4)}`;
    if (sgn === sig) return; sig = sgn;
    const wp: number[] = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = X[0] + ((X[1] - X[0]) * i) / N, y = Yr[0] + ((Yr[1] - Yr[0]) * j) / N, z = zs[i * (N + 1) + j];
      const P = w.w(w.spec.up === 'z' ? [x, y, z] : [x, z, -y]);
      pos.set(P, (i * (N + 1) + j) * 3);
      const cl = heatColor(hi - lo > 1e-9 ? (z - lo) / (hi - lo) : 0.5); col.set([cl.r, cl.g, cl.b], (i * (N + 1) + j) * 3);
    }
    for (let i = 0; i <= N; i += 8) for (let j = 0; j < N; j++) { const a = (i * (N + 1) + j) * 3, b = (i * (N + 1) + j + 1) * 3; wp.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]); }
    for (let j = 0; j <= N; j += 8) for (let i = 0; i < N; i++) { const a = (i * (N + 1) + j) * 3, b = ((i + 1) * (N + 1) + j) * 3; wp.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]); }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    wire.geometry.dispose(); const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wire.geometry = wg;
  };
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); if (root.visible) rebuild(t); }, labels: objLabel(c, o, () => { const x = X[1], y = Yr[1]; sc.v = { ...w.scope(0).v, x, y }; const z = f(sc); return w.w(w.spec.up === 'z' ? [x, y, z] : [x, z, -y]); }, () => [0.5, 1, 0], 'vec', 6) };
}

/** 平面与凸多面体的截面多边形 */
export function sectionPolygon(verts: V3[], edges: [number, number][], plane: [V3, V3, V3]): V3[] {
  const [A, B, C] = plane, n = norm(cross(sub(B, A), sub(C, A)));
  if (len(n) < 1e-9) return [];
  const d = (p: V3) => dot(n, sub(p, A));
  const pts: V3[] = [];
  const pushU = (p: V3) => { if (!pts.some((q) => len(sub(p, q)) < 1e-6)) pts.push(p); };
  for (const v of verts) if (Math.abs(d(v)) < 1e-6) pushU(v);
  for (const [i, j] of edges) {
    const a = verts[i], b = verts[j], da = d(a), db = d(b);
    if ((da > 1e-6 && db < -1e-6) || (da < -1e-6 && db > 1e-6)) pushU(add(a, sub(b, a), da / (da - db)));
  }
  if (pts.length < 3) return pts;
  const cen = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / pts.length);
  const e1 = norm(sub(pts[0], cen)), e2 = cross(n, e1);
  return pts.sort((p, q) => Math.atan2(dot(sub(p, cen), e2), dot(sub(p, cen), e1)) - Math.atan2(dot(sub(q, cen), e2), dot(sub(q, cen), e1)));
}
/** 过一组点的外接球（最小二乘） */
export function circumsphere(ps: V3[]): { c: V3; r: number } | null {
  if (ps.length < 4) return null;
  const p0 = ps[0];
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rhs = [0, 0, 0];
  for (let i = 1; i < ps.length; i++) {
    const a = sub(ps[i], p0).map((x) => 2 * x), b = dot(ps[i], ps[i]) - dot(p0, p0);
    for (let r = 0; r < 3; r++) { for (let k = 0; k < 3; k++) M[r][k] += a[r] * a[k]; rhs[r] += a[r] * b; }
  }
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-12) return null;
  const c = [0, 1, 2].map((k) => det(M.map((row, r) => row.map((x, j) => (j === k ? rhs[r] : x))))) .map((x) => x / D) as V3;
  return { c, r: ps.reduce((s, p) => s + len(sub(p, c)), 0) / ps.length };
}

function solid(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#7dd3fc');
  const root = new THREE.Group(), labels: LabelItem[] = [];
  const geo0 = w.solid(o, 0);
  const W = (v: V3) => V(w.w(v));
  const edgeMat = c.mats.glow('#e2e8f0', 0.35), dashMat = c.mats.flat('#94a3b8', 0.85);
  const er = Math.max(0.006, c.u * 0.03);
  const names = solidNames(o);
  let update: (t: number, cam: THREE.Camera) => void = () => {};
  if (geo0.round) {
    const r = geo0.r!, h = geo0.h!;
    const g = geo0.round === 'sphere' ? new THREE.SphereGeometry(r, 64, 40) : geo0.round === 'cone' ? new THREE.ConeGeometry(r, h, 72, 1, true) : new THREE.CylinderGeometry(r, r, h, 72, 1, true);
    const m = new THREE.Mesh(g, c.mats.glass(color, 0.22)); root.add(m);
    const ringPts = (y: number, rr: number) => Array.from({ length: 73 }, (_, i) => new THREE.Vector3(rr * Math.cos((i / 72) * 2 * Math.PI), y, rr * Math.sin((i / 72) * 2 * Math.PI)));
    if (geo0.round !== 'sphere') {
      for (const y of geo0.round === 'cone' ? [-h / 2] : [-h / 2, h / 2]) { const tb = new Tube(edgeMat, er); tb.set(ringPts(y, r), true); root.add(tb.mesh); }
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r, 72), c.mats.glass(color, 0.12)); cap.rotation.x = -Math.PI / 2; cap.position.y = -h / 2; root.add(cap);
      const axisD = new Dashed(dashMat, er * 0.7, c.u * 0.15); axisD.set(new THREE.Vector3(0, -h / 2, 0), new THREE.Vector3(0, h / 2, 0)); root.add(axisD.mesh);
    } else {
      const eq = new Tube(edgeMat, er); eq.set(ringPts(0, r), true); root.add(eq.mesh);
      const mer = new Tube(dashMat, er * 0.7); mer.set(ringPts(0, r).map((p) => new THREE.Vector3(p.x, p.z, 0)), true); root.add(mer.mesh);
    }
    const base = w.vec(o, 'pos', 0, [0, 0, 0])!;
    const center = w.w(geo0.round === 'sphere' ? base : w.spec.up === 'z' ? add(base, [0, 0, h / 2]) : add(base, [0, h / 2, 0]));
    root.position.set(...center);
    update = (t) => { root.visible = w.visible(o, t); };
  } else {
    // 面
    const faceMat = c.mats.glass(color, typeof o.opacity === 'number' ? o.opacity : 0.16);
    const fg = new THREE.BufferGeometry();
    const tri: number[] = [];
    for (const f of geo0.faces) for (let k = 1; k + 1 < f.length; k++) tri.push(f[0], f[k], f[k + 1]);
    fg.setIndex(tri);
    const pos = new Float32Array(geo0.verts.length * 3); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const faces = new THREE.Mesh(fg, faceMat); faces.renderOrder = 1;
    if (o.faces !== false) root.add(faces);
    const solidEdges = geo0.edges.map(() => cylMesh(edgeMat, false));
    const dashed = geo0.edges.map(() => new Dashed(dashMat, er * 0.75, c.u * 0.16));
    solidEdges.forEach((m) => root.add(m)); dashed.forEach((d) => root.add(d.mesh));
    const dots = geo0.verts.map(() => { const m = new THREE.Mesh(unitSphere, c.mats.glow('#ffffff', 0.6)); m.scale.setScalar(er * 1.9); root.add(m); return m; });
    // 截面
    const secMat = c.mats.own(new THREE.MeshPhysicalMaterial({ color: '#fbbf24', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color('#f59e0b'), emissiveIntensity: 0.25 }));
    const sec = new THREE.Mesh(new THREE.BufferGeometry(), secMat); sec.renderOrder = 3; root.add(sec);
    const secLine = new Tube(c.mats.glow('#fbbf24', 0.8), er * 1.15); root.add(secLine.mesh);
    // 外接球
    const sphMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), c.mats.glass('#a78bfa', 0.14));
    const sphEq = new Tube(c.mats.flat('#c4b5fd', 0.8), er * 0.7); const sphMer = new Tube(c.mats.flat('#c4b5fd', 0.55), er * 0.6);
    const cdot = new THREE.Mesh(unitSphere, c.mats.glow('#c4b5fd', 0.8)); cdot.scale.setScalar(er * 2.2);
    const rad = new Dashed(c.mats.flat('#c4b5fd', 0.9), er * 0.7, c.u * 0.14);
    if (o.circumsphere) root.add(sphMesh, sphEq.mesh, sphMer.mesh, cdot, rad.mesh);
    let csph: { c: V3; r: number } | null = null;
    const cen = (t: number) => w.w(w.solid(o, t).center);
    names.forEach((nm, i) => {
      if (o.labels === false || !nm) return;
      labels.push({ key: o.id + ':' + nm, text: () => nm, at: (t) => { const g = w.solid(o, t); return g.verts[i] ? w.w(g.verts[i]) : null; }, dir: (t) => { const g = w.solid(o, t); return g.verts[i] ? norm(sub(w.w(g.verts[i]), cen(t))) : null; }, color: '#f1f5f9', kind: 'vertex', size: 'm', visible: (t) => w.visible(o, t), prio: 7 });
    });
    if (o.circumsphere) labels.push({ key: o.id + ':O', text: () => 'O', at: () => (csph ? w.w(csph.c) : null), dir: () => [-1, 1, 0], color: '#c4b5fd', kind: 'vertex', size: 'm', visible: (t) => w.visible(o, t), prio: 6 });
    update = (t, cam) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const g = w.solid(o, t);
      const wv = g.verts.map((v) => W(v));
      wv.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); dots[i].position.copy(p); });
      fg.attributes.position.needsUpdate = true; fg.computeVertexNormals(); fg.computeBoundingSphere();
      // 棱的虚实：两个相邻面都背对相机时是看不见的棱，画虚线
      const camPos = (cam as THREE.PerspectiveCamera).position;
      const center = wv.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(wv.length);
      const front = g.faces.map((f) => {
        const a = wv[f[0]], b = wv[f[1]], cc = wv[f[2]];
        let n = b.clone().sub(a).cross(cc.clone().sub(a));
        const fc = f.reduce((s, k) => s.add(wv[k]), new THREE.Vector3()).divideScalar(f.length);
        if (n.dot(fc.clone().sub(center)) < 0) n = n.negate();
        return n.dot(camPos.clone().sub(fc)) > 0;
      });
      g.edges.forEach(([i, j], k) => {
        const adj = g.faces.map((f, fi) => (f.includes(i) && f.includes(j) ? fi : -1)).filter((x) => x >= 0);
        const vis = adj.some((fi) => front[fi]);
        solidEdges[k].visible = vis; dashed[k].mesh.visible = !vis;
        if (vis) setCyl(solidEdges[k], wv[i], wv[j], er); else dashed[k].set(wv[i], wv[j]);
      });
      if (Array.isArray(o.section)) {
        const ps = (o.section as unknown[]).slice(0, 3).map((p) => w.pointSpec(p, t));
        if (ps.every(Boolean)) {
          const poly = sectionPolygon(g.verts, g.edges, ps as [V3, V3, V3]).map((v) => W(v));
          if (poly.length >= 3) {
            const sg = new THREE.BufferGeometry(); const arr: number[] = [];
            for (let k = 1; k + 1 < poly.length; k++) arr.push(...poly[0].toArray(), ...poly[k].toArray(), ...poly[k + 1].toArray());
            sg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); sg.computeVertexNormals();
            sec.geometry.dispose(); sec.geometry = sg;
            secLine.set([...poly, poly[0]]);
          }
        }
      }
      if (o.circumsphere) {
        csph = circumsphere(g.verts);
        if (csph) {
          const C = W(csph.c); sphMesh.position.copy(C); sphMesh.scale.setScalar(csph.r); cdot.position.copy(C);
          const ring = (fn: (a: number) => THREE.Vector3) => Array.from({ length: 97 }, (_, i) => fn((i / 96) * 2 * Math.PI));
          sphEq.set(ring((a) => new THREE.Vector3(C.x + csph!.r * Math.cos(a), C.y, C.z + csph!.r * Math.sin(a))), true);
          sphMer.set(ring((a) => new THREE.Vector3(C.x + csph!.r * Math.cos(a), C.y + csph!.r * Math.sin(a), C.z)), true);
          rad.set(C, wv[0]);
        }
      }
    };
  }
  return { id: o.id, root, update, labels: [...labels, ...objLabel(c, o, (t) => { const g = w.solid(o, t); const top = g.verts.reduce((a, v) => (w.w(v)[1] > w.w(a)[1] ? v : a), g.verts[0] ?? g.center); return w.w(top); }, () => [0, 1, 0], 'tag', 3)] };
}

function point(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#fbbf24');
  const r = w.num(o, 'r', 0, Math.max(0.03, c.u * 0.075));
  const m = new THREE.Mesh(unitSphere, c.mats.glow(color, 0.7)); m.scale.setScalar(r);
  const root = new THREE.Group(); root.add(m);
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) m.position.set(...p); m.scale.setScalar(r * (1 + 0.5 * w.highlight(o, t) * (0.5 + 0.5 * Math.sin(t * 6)))); }, labels: objLabel(c, o, (t) => w.pos(o.id, t), () => [0.8, 1, 0], 'vertex', 7) };
}

function segment(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#f472b6');
  const r = Math.max(0.005, c.u * 0.024 * w.num(o, 'width', 0, 1));
  const solidM = cylMesh(c.mats.glow(color, 0.45), false), dash = new Dashed(c.mats.glow(color, 0.45), r, c.u * 0.16);
  const root = new THREE.Group(); root.add(o.dashed ? dash.mesh : solidM);
  let mid: V3 | null = null, side: V3 = [0, 1, 0];
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const a = w.point(o.from, t), b = w.point(o.to, t); if (!a || !b) return;
      if (o.dashed) dash.set(V(a), V(b)); else setCyl(solidM, V(a), V(b), r * (1 + 0.6 * w.highlight(o, t)));
      mid = add(a, sub(b, a), 0.5); const d = norm(sub(b, a)); side = norm(cross(d, [0, 0, 1])); if (len(side) < 0.1) side = [0, 1, 0];
    },
    labels: objLabel(c, o, () => mid, () => side, 'vec', 5).map((l) => ({ ...l, color })),
  };
}

function polygon(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#fbbf24');
  const mat = c.mats.own(new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: typeof o.opacity === 'number' ? o.opacity : o.type === 'plane' ? 0.22 : 0.45, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color(color), emissiveIntensity: 0.2 }));
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.renderOrder = 3;
  const line = new Tube(c.mats.glow(color, 0.7), Math.max(0.005, c.u * 0.022));
  const root = new THREE.Group(); root.add(mesh); if (o.outline !== false) root.add(line.mesh);
  let cen: V3 | null = null, sig = '';
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      let pts = (o.points as unknown[]).map((p) => w.point(p, t)).filter(Boolean) as V3[];
      if (pts.length < 3) return;
      if (o.type === 'plane') {
        const [A, B, C] = pts, n = norm(cross(sub(B, A), sub(C, A))), ce = scale(add(add(A, B), C), 1 / 3), s = w.num(o, 'size', t, 3) / 2;
        const e1 = norm(sub(B, A)), e2 = cross(n, e1);
        pts = [add(add(ce, e1, -s), e2, -s), add(add(ce, e1, s), e2, -s), add(add(ce, e1, s), e2, s), add(add(ce, e1, -s), e2, s)];
      }
      const s = pts.map((p) => p.map((x) => x.toFixed(3)).join(',')).join(';');
      cen = scale(pts.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / pts.length);
      if (s === sig) return; sig = s;
      const arr: number[] = [];
      for (let k = 1; k + 1 < pts.length; k++) arr.push(...pts[0], ...pts[k], ...pts[k + 1]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals();
      mesh.geometry.dispose(); mesh.geometry = g;
      line.set([...pts, pts[0]].map(V));
    },
    labels: objLabel(c, o, () => cen, undefined, 'tag', 4).map((l) => ({ ...l, color })),
  };
}

function sphere(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#a78bfa');
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), c.mats.glass(color, typeof o.opacity === 'number' ? o.opacity : 0.18));
  const eq = new Tube(c.mats.flat(color, 0.8), Math.max(0.005, c.u * 0.018));
  const root = new THREE.Group(); root.add(m, eq.mesh);
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const C = w.point(o.center, t); if (!C) return; const r = w.num(o, 'r', t, 1);
      m.position.set(...C); m.scale.setScalar(r);
      eq.set(Array.from({ length: 97 }, (_, i) => new THREE.Vector3(C[0] + r * Math.cos((i / 96) * 2 * Math.PI), C[1], C[2] + r * Math.sin((i / 96) * 2 * Math.PI))), true);
    },
    labels: objLabel(c, o, (t) => { const C = w.point(o.center, t); return C ? add(C, [0, w.num(o, 'r', t, 1), 0]) : null; }, () => [0, 1, 0], 'tag', 4),
  };
}

// ── 化学 ────────────────────────────────────────────────
function ballStick(c: Ctx, root: THREE.Group, atoms: Mol['atoms'], bonds: [number, number, number][], k: number, style: string) {
  const P = atoms.map((a) => new THREE.Vector3(a[1] * k, a[2] * k, a[3] * k));
  // 分子平面的法向（双键平行线的偏移方向）
  let pn = new THREE.Vector3(0, 0, 1);
  for (let i = 2; i < P.length; i++) { const n = P[1].clone().sub(P[0]).cross(P[i].clone().sub(P[0])); if (n.length() > 1e-3) { pn = n.normalize(); break; } }
  const space = style === 'space';
  atoms.forEach((a, i) => {
    const e = elementOf(a[0]);
    const r = (space ? e.r * 1.15 : 0.2 + 0.2 * e.r) * k;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), c.mats.body(e.color));
    m.position.copy(P[i]); m.castShadow = true; root.add(m);
  });
  if (space) return P;
  const br = 0.085 * k;
  for (const [i, j, order] of bonds) {
    if (!P[i] || !P[j]) continue;
    const a = P[i], b = P[j], d = b.clone().sub(a);
    let off = d.clone().cross(pn); if (off.length() < 1e-4) off = d.clone().cross(new THREE.Vector3(0, 1, 0)); if (off.length() < 1e-4) off = new THREE.Vector3(1, 0, 0);
    off.normalize();
    const n = Math.max(1, Math.min(3, order)), rr = n === 1 ? br : br * 0.62, gap = br * 1.5;
    for (let q = 0; q < n; q++) {
      const s = (q - (n - 1) / 2) * gap;
      const A = a.clone().addScaledVector(off, s), B = b.clone().addScaledVector(off, s), M = A.clone().lerp(B, 0.5);
      const m1 = cylMesh(c.mats.body(elementOf(atoms[i][0]).color)), m2 = cylMesh(c.mats.body(elementOf(atoms[j][0]).color));
      setCyl(m1, A, M, rr); setCyl(m2, M, B, rr); root.add(m1, m2);
    }
  }
  return P;
}

function molecule(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const mol = Array.isArray(o.atoms) ? { title: String(o.name ?? '分子'), atoms: o.atoms as Mol['atoms'], bonds: (Array.isArray(o.bonds) ? o.bonds : autoBonds(o.atoms as Mol['atoms'])) as Mol['bonds'] } as Mol : moleculeByName(String(o.name))!;
  const k = 1.35 * w.num(o, 'scale', 0, 1);
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const P = ballStick(c, inner, mol.atoms, mol.bonds, k, String(o.style ?? 'ballstick'));
  const labels: LabelItem[] = [];
  const toWorld = (v: THREE.Vector3) => v.clone().applyMatrix4(inner.matrixWorld);
  if (o.labels !== false) mol.atoms.forEach((a, i) => labels.push({ key: `${o.id}:${i}`, text: () => a[0], at: () => toWorld(P[i]).toArray() as V3, color: a[0] === 'H' ? '#0f172a' : '#ffffff', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 2 }));
  if (o.angles !== false && mol.angle) {
    const g = mol.angle, A = P[g.at], e1 = P[g.a].clone().sub(A).normalize(), e2v = P[g.b].clone().sub(A).normalize();
    const sweep = Math.acos(Math.max(-1, Math.min(1, e1.dot(e2v))));
    let e2 = e2v.clone().sub(e1.clone().multiplyScalar(e1.dot(e2v)));
    if (e2.length() < 1e-4) e2 = new THREE.Vector3(0, 1, 0).sub(e1.clone().multiplyScalar(e1.y)); e2.normalize();
    const r = 0.55 * k, arc = arcMesh(c, '#fbbf24', r, sweep);
    arc.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, e1.clone().cross(e2))); arc.position.copy(A);
    inner.add(arc);
    const lab = A.clone().addScaledVector(e1, (r + 0.35 * k) * Math.cos(sweep / 2)).addScaledVector(e2, (r + 0.35 * k) * Math.sin(sweep / 2));
    labels.push({ key: o.id + ':angle', text: () => g.text, at: () => toWorld(lab).toArray() as V3, color: '#fbbf24', kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 8 });
  }
  labels.push(...objLabel(c, o, () => { root.updateMatrixWorld(); const b = new THREE.Box3().setFromObject(inner); return [b.getCenter(new THREE.Vector3()).x, b.max.y + 0.3 * k, b.getCenter(new THREE.Vector3()).z]; }, () => [0, 1, 0], 'tag', 6));
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t);
      const p = w.pos(o.id, t); if (p) root.position.set(...p);
      inner.rotation.y = o.spin === false ? 0 : (2 * Math.PI * t) / 14;
      root.updateMatrixWorld();
    },
    labels,
  };
}

function crystal(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const cr = crystalByName(String(o.name ?? 'NaCl'));
  const edge = 3 * w.num(o, 'scale', 0, 1);
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const Pts = cr.atoms.map((a) => new THREE.Vector3(a[1] * edge, a[2] * edge, a[3] * edge));
  const ionR = (e: string) => (e === 'Cl' ? 0.42 : e === 'Na' ? 0.26 : e === 'Cs' ? 0.36 : e === 'M' ? 0.38 : 0.2) * edge / 3 * (cr.edge ? 1 : 0.6);
  cr.atoms.forEach((a, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(ionR(a[0]), 36, 24), c.mats.body(elementOf(a[0]).color)); m.position.copy(Pts[i]); m.castShadow = true; inner.add(m); });
  const bm = c.mats.matte('#cbd5e1', 0.5);
  for (const [i, j] of cr.bonds) { const m = cylMesh(bm); setCyl(m, Pts[i], Pts[j], 0.035 * edge / 3); inner.add(m); }
  if (cr.edge) {
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(edge, edge, edge)), c.mats.own(new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.8 })));
    inner.add(box);
  }
  const labels: LabelItem[] = [];
  const firstOf = (e: string) => cr.atoms.findIndex((a) => a[0] === e);
  const ionName: Record<string, string> = { Na: 'Na⁺', Cl: 'Cl⁻', Cs: 'Cs⁺', C: 'C', M: '金属原子' };
  if (o.labels !== false) for (const e of [...new Set(cr.atoms.map((a) => a[0]))]) {
    const i = firstOf(e);
    let best = i; Pts.forEach((p, k) => { if (cr.atoms[k][0] === e && p.y + p.z * 0.5 + p.x * 0.2 > Pts[best].y + Pts[best].z * 0.5 + Pts[best].x * 0.2) best = k; });
    labels.push({ key: o.id + e, text: () => ionName[e] ?? e, at: () => Pts[best].clone().applyMatrix4(inner.matrixWorld).toArray() as V3, dir: () => [1, 1, 0.3], color: elementOf(e).color, kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 6 });
  }
  labels.push({ key: o.id + ':note', text: () => cr.note, at: () => root.position.clone().add(new THREE.Vector3(0, -edge * 0.62, 0)).toArray() as V3, color: '#cbd5e1', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 3 });
  labels.push(...objLabel(c, o, () => root.position.clone().add(new THREE.Vector3(0, edge * 0.68, 0)).toArray() as V3, undefined, 'tag', 5));
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) root.position.set(...p); inner.rotation.y = o.spin === false ? 0.5 : 0.5 + (2 * Math.PI * t) / 18; inner.rotation.x = 0.12; root.updateMatrixWorld(); },
    labels,
  };
}

function atom(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const shells = Array.isArray(o.shells) ? (o.shells as number[]) : [2, 8, 1];
  const k = w.num(o, 'scale', 0, 1);
  const root = new THREE.Group();
  const nuc = new THREE.Group(); root.add(nuc);
  const nN = Math.min(18, 4 + shells.reduce((a, b) => a + b, 0));
  for (let i = 0; i < nN; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13 * k, 20, 14), c.mats.body(i % 2 ? '#ff5d5d' : '#cbd5e1'));
    const phi = Math.acos(1 - (2 * (i + 0.5)) / nN), th = Math.PI * (1 + Math.sqrt(5)) * i;
    m.position.set(0.2 * k * Math.sin(phi) * Math.cos(th), 0.2 * k * Math.cos(phi), 0.2 * k * Math.sin(phi) * Math.sin(th)); nuc.add(m);
  }
  const eMat = c.mats.glow('#22d3ee', 1.2);
  const rings: { g: THREE.Group; n: number; R: number; speed: number }[] = [];
  shells.forEach((n, i) => {
    const R = (0.75 + i * 0.6) * k;
    const g = new THREE.Group(); g.rotation.x = 1.2 + i * 0.25; g.rotation.y = i * 0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.012 * k, 8, 96), c.mats.flat('#7dd3fc', 0.5)); g.add(ring);
    const es = new THREE.Group(); g.add(es);
    for (let j = 0; j < n; j++) { const e = new THREE.Mesh(unitSphere, eMat); e.scale.setScalar(0.07 * k); const a = (j / n) * 2 * Math.PI; e.position.set(R * Math.cos(a), R * Math.sin(a), 0); es.add(e); }
    root.add(g); rings.push({ g: es as THREE.Group, n, R, speed: 1.6 / (1 + i) });
  });
  const sym = String(o.symbol ?? '');
  return {
    id: o.id, root,
    update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) root.position.set(...p); rings.forEach((r) => { r.g.rotation.z = t * r.speed; }); },
    labels: [...(sym ? [{ key: o.id + 'sym', text: () => sym, at: (t: number) => w.pos(o.id, t), color: '#ffffff', kind: 'tag' as const, size: 'l' as const, visible: (t: number) => w.visible(o, t), prio: 8 }] : []), ...objLabel(c, o, (t) => { const p = w.pos(o.id, t); return p ? add(p, [0, (0.75 + shells.length * 0.6) * k + 0.3, 0]) : null; }, undefined, 'tag', 5)],
  };
}

// ── 地理 / 天文 ─────────────────────────────────────────
function earth(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const r = w.num(o, 'r', 0, DEF.earthR);
  const root = new THREE.Group();      // 平移到地球位置
  const tilt = new THREE.Group();      // 地轴倾斜（世界坐标，固定朝向）
  const spin = new THREE.Group();      // 自转
  root.add(tilt); tilt.add(spin);
  const tex = c.mats.own(earthTex());
  const globe = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 64), c.mats.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.02 })));
  globe.castShadow = true; globe.receiveShadow = true;
  spin.add(globe);
  const atm = atmosphere(r); c.mats.own(atm.material as THREE.Material); tilt.add(atm);
  // 纬线：赤道、回归线、极圈
  const latRing = (lat: number, color: string, dashed: boolean) => {
    const rr = r * Math.cos(lat * D2R) * 1.004, y = r * Math.sin(lat * D2R) * 1.004;
    const mat = c.mats.flat(color, dashed ? 0.75 : 0.95);
    if (!dashed) { const m = new THREE.Mesh(new THREE.TorusGeometry(rr, r * 0.008, 6, 128), mat); m.rotation.x = Math.PI / 2; m.position.y = y; return m; }
    const g = new THREE.Group();
    for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; const m = new THREE.Mesh(new THREE.TorusGeometry(rr, r * 0.007, 5, 6, (2 * Math.PI / 48) * 0.55), mat); m.rotation.x = Math.PI / 2; m.rotation.z = a; m.position.y = y; g.add(m); }
    return g;
  };
  const e0 = w.earth(o, 0);
  const tropic = e0.tilt, polar = 90 - e0.tilt;
  tilt.add(latRing(0, '#ff7a7a', false), latRing(tropic, '#fbbf24', true), latRing(-tropic, '#fbbf24', true), latRing(polar, '#7dd3fc', true), latRing(-polar, '#7dd3fc', true));
  if (o.grid) for (let lon = 0; lon < 180; lon += 30) { const m = new THREE.Mesh(new THREE.TorusGeometry(r * 1.003, r * 0.004, 4, 96), c.mats.flat('#cbd5e1', 0.35)); m.rotation.y = lon * D2R; spin.add(m); }
  const axis = cylMesh(c.mats.metal('#e2e8f0', 0.3), false); setCyl(axis, new THREE.Vector3(0, -r * 1.35, 0), new THREE.Vector3(0, r * 1.35, 0), r * 0.018); tilt.add(axis);
  // 晨昏圈、直射点
  const term = new THREE.Mesh(new THREE.TorusGeometry(r * 1.012, r * 0.012, 6, 128), c.mats.flat('#fde68a', 0.8)); root.add(term);
  const sub = new THREE.Mesh(unitSphere, c.mats.flat('#fff3b0')); sub.scale.setScalar(r * 0.05);
  const subGlow = new THREE.Sprite(c.mats.own(new THREE.SpriteMaterial({ map: c.mats.own(glowTex('rgba(255,236,150,1)', 'rgba(255,200,80,0)')), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
  subGlow.scale.setScalar(r * 0.45);
  const ray = cylMesh(c.mats.flat('#fde68a', 0.55), false);
  if (o.sunPoint !== false) root.add(sub, subGlow, ray);
  // 公转轨道与二分二至
  const orbitG = new THREE.Group();
  const labels: LabelItem[] = [];
  if (e0.center) {
    const C = V(w.w(e0.center)), R = e0.R;
    const ring = new Tube(c.mats.flat('#94a3b8', 0.6), Math.max(0.01, r * 0.025)); ring.set(Array.from({ length: 145 }, (_, i) => C.clone().add(new THREE.Vector3(R * Math.sin((i / 144) * 2 * Math.PI), 0, R * Math.cos((i / 144) * 2 * Math.PI)))), true);
    orbitG.add(ring.mesh);
    const names: [number, string][] = [[0, '春分 3月21日'], [90, '夏至 6月22日'], [180, '秋分 9月23日'], [270, '冬至 12月22日']];
    for (const [deg, name] of names) {
      const P = C.clone().add(new THREE.Vector3(R * Math.sin(deg * D2R), 0, R * Math.cos(deg * D2R)));
      const ghost = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 24, 16), c.mats.flat('#cbd5e1', 0.55)); ghost.position.copy(P); orbitG.add(ghost);
      labels.push({ key: o.id + name, text: () => name, at: () => P.toArray() as V3, dir: () => norm(sub3(P.toArray() as V3, C.toArray() as V3)), color: '#cbd5e1', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 2 });
    }
    // 公转方向箭头
    const dirA = new Arrow3(c.mats.glow('#94a3b8', 0.3), r * 0.9);
    const a1 = 45 * D2R, a2 = 60 * D2R; const P1 = C.clone().add(new THREE.Vector3(R * Math.sin(a1), 0, R * Math.cos(a1))), P2 = C.clone().add(new THREE.Vector3(R * Math.sin(a2), 0, R * Math.cos(a2)));
    dirA.set(P1, P2.clone().sub(P1)); orbitG.add(dirA.root);
  }
  const parent = new THREE.Group(); parent.add(orbitG, root);
  // 标记点（经纬度）
  const marks = Array.isArray(o.marks) ? (o.marks as { lat: number; lon: number; text: string }[]) : [];
  const markObjs = marks.map((m) => {
    const p = new THREE.Vector3(Math.cos(m.lat * D2R) * Math.cos(m.lon * D2R), Math.sin(m.lat * D2R), -Math.cos(m.lat * D2R) * Math.sin(m.lon * D2R)).multiplyScalar(r * 1.01);
    const pin = new THREE.Mesh(unitSphere, c.mats.glow('#ff5d5d', 0.8)); pin.scale.setScalar(r * 0.035); pin.position.copy(p); spin.add(pin);
    return { m, pin };
  });
  markObjs.forEach(({ m, pin }) => labels.push({ key: o.id + m.text, text: () => m.text, at: () => pin.getWorldPosition(new THREE.Vector3()).toArray() as V3, dir: () => [1, 0.6, 0], color: '#fecaca', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 5 }));
  let subW: V3 | null = null;
  labels.push({ key: o.id + ':sub', text: (t) => { const e = w.earth(o, t); return '直射点 ' + fmt(Math.abs(e.lat), 1) + '°' + (Math.abs(e.lat) < 0.05 ? '' : e.lat > 0 ? 'N' : 'S'); }, at: () => subW, dir: (t) => w.earth(o, t).sunW, color: '#fde68a', kind: 'tag', size: 's', visible: (t) => w.visible(o, t) && o.sunPoint !== false, prio: 7 });
  labels.push({ key: o.id + ':N', text: () => 'N', at: () => tilt.localToWorld(new THREE.Vector3(0, r * 1.42, 0)).toArray() as V3, color: '#e2e8f0', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 4 });
  if (e0.center) labels.push({ key: o.id + ':date', text: (t) => { const d = w.earth(o, t).doy; const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; let k = Math.floor(d), m = 0; while (m < 11 && k >= md[m]) { k -= md[m]; m++; } return `${typeof o.label === 'string' && o.label ? o.label : '地球'} · 约 ${m + 1}月${k + 1}日`; }, at: (t) => add(w.earth(o, t).posW, [0, -r * 1.5, 0]), color: '#e2e8f0', kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 6 });
  else labels.push(...objLabel(c, o, (t) => add(w.earth(o, t).posW, [0, -r * 1.45, 0]), undefined, 'tag', 5));
  return {
    id: o.id, root: parent,
    update: (t) => {
      parent.visible = w.visible(o, t); if (!parent.visible) return;
      const e = w.earth(o, t);
      root.position.set(...e.posW);
      tilt.quaternion.setFromUnitVectors(Y, V(e.axisW));
      spin.rotation.y = e.spin * D2R;
      const sw = V(e.sunW);
      term.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sw);
      const sp = sw.clone().multiplyScalar(r * 1.01); sub.position.copy(sp); subGlow.position.copy(sp);
      setCyl(ray, sw.clone().multiplyScalar(r * 2.4), sw.clone().multiplyScalar(r * 1.03), r * 0.012);
      subW = add(e.posW, scale(e.sunW, r * 1.02));
      root.updateMatrixWorld(true);
    },
    labels,
  };
}
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function sunObj(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const r = w.num(o, 'r', 0, DEF.sunR);
  const root = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 40), c.mats.own(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(1.6), toneMapped: true })));
  const glow = new THREE.Sprite(c.mats.own(new THREE.SpriteMaterial({ map: c.mats.own(glowTex('rgba(255,225,150,1)', 'rgba(255,140,40,0)')), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
  glow.scale.setScalar(r * 5);
  const light = new THREE.PointLight('#fff1d6', 3.2, 0, 0);
  root.add(core, glow, light);
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) root.position.set(...p); }, labels: objLabel(c, o, (t) => { const p = w.pos(o.id, t); return p ? add(p, [0, -r * 1.4, 0]) : null; }, undefined, 'tag', 6) };
}

function moon(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const r = w.num(o, 'r', 0, 0.32);
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), c.mats.matte('#cbd5e1', 0.95)); m.castShadow = true;
  const root = new THREE.Group(); root.add(m);
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) root.position.set(...p); }, labels: objLabel(c, o, (t) => w.pos(o.id, t), () => [0, 1, 0], 'body', 5) };
}

function orbit(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const color = colorOf(o, '#94a3b8');
  const tube = new Tube(c.mats.flat(color, 0.6), Math.max(0.01, c.u * 0.02));
  const root = new THREE.Group(); root.add(tube.mesh);
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t);
      const C = w.pointSpec(o.center ?? [0, 0, 0], t) ?? [0, 0, 0], R = w.num(o, 'r', t, 6), pl = String(o.plane ?? (w.spec.up === 'z' ? 'xy' : 'xz'));
      tube.set(Array.from({ length: 145 }, (_, i) => { const a = (i / 144) * 2 * Math.PI, ca = R * Math.cos(a), sa = R * Math.sin(a); return V(w.w(pl === 'xy' ? add(C, [ca, sa, 0]) : pl === 'yz' ? add(C, [0, ca, sa]) : add(C, [ca, 0, sa]))); }), true);
    },
    labels: objLabel(c, o, (t) => { const C = w.pointSpec(o.center ?? [0, 0, 0], t) ?? [0, 0, 0]; return w.w(add(C, [w.num(o, 'r', t, 6), 0, 0])); }, undefined, 'tag', 3),
  };
}

// ── 生物 ────────────────────────────────────────────────
function cell(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const R = w.num(o, 'r', 0, 2.6), plant = o.kind === 'plant';
  const root = new THREE.Group();
  const labels: LabelItem[] = [];
  const cut = o.cut !== false;
  const phiLen = cut ? Math.PI * 1.5 : Math.PI * 2;
  const leader = (name: string, local: THREE.Vector3, color: string, out: THREE.Vector3) => {
    const end = local.clone().add(out);
    const ln = cylMesh(c.mats.flat('#e2e8f0', 0.6), false); setCyl(ln, local, end, R * 0.006); root.add(ln);
    if (o.labels !== false) labels.push({ key: o.id + name, text: () => name, at: () => root.localToWorld(end.clone()).toArray() as V3, dir: () => norm(out.toArray() as V3), color, kind: 'tag', size: 'm', visible: (t) => w.visible(o, t), prio: 5 });
  };
  const shellGeo = (r: number) => (plant ? new RoundedBoxGeometry(r * 2.3, r * 1.6, r * 1.6, 6, r * 0.25) : new THREE.SphereGeometry(r, 72, 48, Math.PI * 0.25, phiLen));
  if (plant) {
    const wall = new THREE.Mesh(shellGeo(R * 1.04), c.mats.glass('#7ccf6a', 0.22)); root.add(wall);
    const mem = new THREE.Mesh(shellGeo(R * 0.98), c.mats.glass('#c9f2b8', 0.12)); root.add(mem);
    leader('细胞壁', new THREE.Vector3(-R * 1.2, R * 0.83, 0), '#bbf7d0', new THREE.Vector3(-R * 0.35, R * 0.4, 0));
    const vac = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 48, 32), c.mats.glass('#7dd3fc', 0.35)); vac.scale.set(1.5, 1, 1); vac.position.set(R * 0.25, 0, 0); root.add(vac);
    leader('液泡', new THREE.Vector3(R * 0.9, R * 0.35, R * 0.3), '#bae6fd', new THREE.Vector3(R * 0.6, R * 0.5, 0));
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(R * 0.12, 24, 16), c.mats.body('#22a34a')); body.scale.set(1.6, 0.8, 0.9); g.add(body);
      for (let k = -2; k <= 2; k++) { const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.02, 12), c.mats.body('#86efac')); disc.position.set(k * R * 0.05, 0, 0); g.add(disc); }
      const a = (i / 7) * 2 * Math.PI; g.position.set(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.55, (i % 2 ? 0.4 : -0.4) * R); g.rotation.z = a; root.add(g);
      if (i === 1) leader('叶绿体', g.position.clone(), '#86efac', new THREE.Vector3(R * 0.4, R * 0.55, 0));
    }
  } else {
    const mem = new THREE.Mesh(shellGeo(R), c.mats.glass('#f9a8d4', 0.28)); root.add(mem);
    const cyto = new THREE.Mesh(new THREE.SphereGeometry(R * 0.97, 64, 40, Math.PI * 0.25, phiLen), c.mats.glass('#fde7f3', 0.08)); root.add(cyto);
    if (cut) {
      for (const ang of [Math.PI * 0.25, Math.PI * 1.75]) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.97, 64, -Math.PI / 2, Math.PI), c.mats.glass('#fbcfe8', 0.16));
        disc.rotation.y = ang - Math.PI / 2; root.add(disc);
      }
    }
    leader('细胞膜', new THREE.Vector3(-R * 0.72, R * 0.7, 0), '#fbcfe8', new THREE.Vector3(-R * 0.45, R * 0.4, 0));
    leader('细胞质', new THREE.Vector3(-R * 0.4, -R * 0.55, R * 0.2), '#fce7f3', new THREE.Vector3(-R * 0.7, -R * 0.4, 0));
  }
  // 细胞核
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(R * 0.32, 48, 32), c.mats.body('#8b5cf6')); nucleus.position.set(plant ? -R * 0.6 : 0, 0, 0); root.add(nucleus);
  const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(R * 0.11, 24, 16), c.mats.body('#4c1d95')); nucleolus.position.copy(nucleus.position).add(new THREE.Vector3(R * 0.12, R * 0.08, R * 0.2)); root.add(nucleolus);
  leader('细胞核', nucleus.position.clone().add(new THREE.Vector3(0, R * 0.3, R * 0.1)), '#ddd6fe', new THREE.Vector3(R * 0.2, R * 0.85, 0));
  // 线粒体
  for (let i = 0; i < (plant ? 3 : 5); i++) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.06, R * 0.2, 6, 16), c.mats.body('#f97316'));
    const a = 0.7 + i * 1.15; m.position.set(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.5, Math.sin(i * 1.7) * R * 0.3); m.rotation.set(i, i * 0.7, a); root.add(m);
    if (i === 0) leader('线粒体', m.position.clone(), '#fdba74', new THREE.Vector3(R * 0.55, R * 0.25, 0));
  }
  // 内质网、高尔基体、核糖体
  const er = new Tube(c.mats.body('#38bdf8'), R * 0.018);
  const erPts = Array.from({ length: 80 }, (_, i) => { const a = (i / 80) * Math.PI * 1.4 + 0.3, rr = R * (0.42 + 0.05 * Math.sin(i * 0.9)); return nucleus.position.clone().add(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr * 0.8, Math.sin(i * 0.5) * R * 0.08)); });
  er.set(erPts, true); root.add(er.mesh);
  leader('内质网', erPts[20].clone(), '#bae6fd', new THREE.Vector3(-R * 0.2, R * 0.7, R * 0.1));
  const golgi = new THREE.Group();
  for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.TorusGeometry(R * (0.16 - k * 0.012), R * 0.016, 8, 32, Math.PI * 0.9), c.mats.body('#facc15')); m.position.y = k * R * 0.045; m.rotation.x = Math.PI / 2; golgi.add(m); }
  golgi.position.set(plant ? -R * 0.2 : R * 0.45, -R * 0.45, R * 0.25); root.add(golgi);
  leader('高尔基体', golgi.position.clone(), '#fde68a', new THREE.Vector3(R * 0.5, -R * 0.5, 0));
  const ribo = new THREE.InstancedMesh(unitSphere, c.mats.body('#e2e8f0'), 60);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) { const p = erPts[(i * 7) % 80].clone().add(new THREE.Vector3(Math.sin(i) * R * 0.04, Math.cos(i * 1.3) * R * 0.04, Math.sin(i * 2.1) * R * 0.04)); mtx.compose(p, new THREE.Quaternion(), new THREE.Vector3(R * 0.012, R * 0.012, R * 0.012)); ribo.setMatrixAt(i, mtx); }
  root.add(ribo);
  root.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; } });
  labels.push(...objLabel(c, o, () => root.localToWorld(new THREE.Vector3(0, -R * 1.25, 0)).toArray() as V3, undefined, 'tag', 6));
  return { id: o.id, root, update: (t) => { root.visible = w.visible(o, t); const p = w.pos(o.id, t); if (p) root.position.set(...p); root.rotation.y = -0.5 + 0.25 * Math.sin((t / w.D) * Math.PI * 2); root.updateMatrixWorld(); }, labels };
}

function dna(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const L = w.num(o, 'length', 0, 6), turns = w.num(o, 'turns', 0, 2.5), R = Math.max(0.5, L * 0.13);
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const nPairs = Math.round(turns * 10);
  const s1 = new Tube(c.mats.body('#f97316'), R * 0.09), s2 = new Tube(c.mats.body('#3b82f6'), R * 0.09);
  inner.add(s1.mesh, s2.mesh);
  const BASES: [string, string, string, string][] = [['A', 'T', '#ef4444', '#facc15'], ['G', 'C', '#22c55e', '#60a5fa'], ['T', 'A', '#facc15', '#ef4444'], ['C', 'G', '#60a5fa', '#22c55e']];
  const rungs = Array.from({ length: nPairs }, (_, i) => {
    const b = BASES[(i * 7 + (i >> 1)) % 4];
    const m1 = cylMesh(c.mats.body(b[2])), m2 = cylMesh(c.mats.body(b[3]));
    inner.add(m1, m2);
    return { m1, m2, b };
  });
  const labels: LabelItem[] = [];
  let rungMid: V3[] = [];
  // 各挑一对 A—T（双氢键）和 G≡C（三氢键）做标注
  if (o.labels !== false) {
    const pick = [rungs.findIndex((r) => r.b[0] === 'A' || r.b[0] === 'T'), rungs.findIndex((r) => r.b[0] === 'G' || r.b[0] === 'C')];
    pick.forEach((ri, k) => {
      if (ri < 0) return;
      labels.push({ key: o.id + 'bp' + k, text: () => (rungs[ri].b[0] === 'A' || rungs[ri].b[0] === 'T' ? `${rungs[ri].b[0]}—${rungs[ri].b[1]}（2 个氢键）` : `${rungs[ri].b[0]}≡${rungs[ri].b[1]}（3 个氢键）`), at: () => (rungMid[ri] ? root.localToWorld(V(rungMid[ri])).toArray() as V3 : null), dir: () => [1, 0.2, 0], color: '#e2e8f0', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 4 });
    });
  }
  if (o.labels !== false) labels.push({ key: o.id + 'bb', text: () => '脱氧核糖-磷酸骨架', at: () => root.localToWorld(new THREE.Vector3(-R, L * 0.38, 0)).toArray() as V3, dir: () => [-1, 0.3, 0], color: '#fdba74', kind: 'tag', size: 's', visible: (t) => w.visible(o, t), prio: 4 });
  labels.push(...objLabel(c, o, () => root.localToWorld(new THREE.Vector3(0, L / 2 + R * 0.8, 0)).toArray() as V3, undefined, 'tag', 6));
  let sig = '';
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t); if (!root.visible) return;
      const p = w.pos(o.id, t); if (p) root.position.set(...p);
      inner.rotation.y = o.spin === false ? 0 : (2 * Math.PI * t) / 10;
      const unzip = w.has(o, 'unzip') ? Math.max(0, Math.min(1, w.num(o, 'unzip', t, 0))) : 0;
      const s = unzip.toFixed(3);
      root.updateMatrixWorld();
      if (s === sig) return; sig = s;
      const pt = (k: number, strand: number): THREE.Vector3 => {
        const y = -L / 2 + L * k, a = k * turns * 2 * Math.PI + (strand ? Math.PI * 0.8 : 0);
        const open = Math.max(0, (k - (1 - unzip)) / Math.max(0.05, unzip)) * (unzip > 0 ? 1 : 0);
        const sep = open * R * 1.6 * (strand ? 1 : -1);
        return new THREE.Vector3(R * Math.cos(a) + sep, y, R * Math.sin(a));
      };
      const n = 160;
      s1.set(Array.from({ length: n + 1 }, (_, i) => pt(i / n, 0)), true);
      s2.set(Array.from({ length: n + 1 }, (_, i) => pt(i / n, 1)), true);
      rungMid = [];
      rungs.forEach((r, i) => {
        const k = (i + 0.5) / nPairs, a = pt(k, 0), b = pt(k, 1), m = a.clone().lerp(b, 0.5);
        const open = k > 1 - unzip;
        if (open) { const ga = a.clone().lerp(m, 0.42), gb = b.clone().lerp(m, 0.42); setCyl(r.m1, a, ga, R * 0.06); setCyl(r.m2, gb, b, R * 0.06); }
        else { setCyl(r.m1, a, m, R * 0.06); setCyl(r.m2, m, b, R * 0.06); }
        rungMid.push(m.toArray() as V3);
      });
    },
    labels,
  };
}

// ── 通用 ────────────────────────────────────────────────
function label(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const root = new THREE.Group();
  const size = o.size === 'big' ? 'l' : o.size === 'small' ? 's' : 'm';
  return { id: o.id, root, update: () => {}, labels: [{ key: o.id, text: (t) => templ(w, String(o.text), t), at: (t) => w.point(o.pos ?? [0, 0, 0], t), color: colorOf(o, '#f1f5f9'), kind: 'note', size, visible: (t) => w.visible(o, t), prio: 9 }] };
}

function timeline(o: S3DObject, c: Ctx): Part {
  const { w } = c;
  const events = (Array.isArray(o.events) ? o.events : []) as { at: number; text: string; sub: string }[];
  const p = w.w(w.vec(o, 'pos', 0, [0, 0, 0])!), L = w.num(o, 'length', 0, 12);
  const root = new THREE.Group();
  const bar = new THREE.Mesh(new RoundedBoxGeometry(L, 0.14, 0.3, 3, 0.05), c.mats.body('#334155')); bar.position.set(...p); bar.receiveShadow = true; root.add(bar);
  const fill = new THREE.Mesh(new RoundedBoxGeometry(1, 0.16, 0.32, 3, 0.05), c.mats.body('#4f8cff', 'plastic', 0.4)); root.add(fill);
  const lo = events[0]?.at ?? 0, hi = events[events.length - 1]?.at ?? 1;
  const xOf = (a: number) => p[0] - L / 2 + L * (hi > lo ? (a - lo) / (hi - lo) : 0.5) * 0.92 + L * 0.04;
  const nodes = events.map((e, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 20), c.mats.body('#fbbf24', 'plastic', 0)); m.position.set(xOf(e.at), p[1] + 0.02, p[2]); m.castShadow = true; root.add(m);
    const up = i % 2 ? -1 : 1, stem = cylMesh(c.mats.flat('#94a3b8', 0.7), false); setCyl(stem, m.position, m.position.clone().add(new THREE.Vector3(0, up * 1.1, 0)), 0.012); root.add(stem);
    return { m, up };
  });
  const cur = (t: number) => { const k = w.spec.steps.length ? w.stepIndex(t) : Math.floor((t / w.D) * events.length + 1e-6); return Math.max(0, Math.min(events.length - 1, k)); };
  const labels: LabelItem[] = events.map((e, i) => ({ key: o.id + i, text: (t: number) => `${e.at > 100 || e.at < -100 ? (e.at < 0 ? '前' + -e.at : e.at) + ' 年' : ''} ${e.text}${i === cur(t) && e.sub ? '\n' + e.sub : ''}`.trim(), at: () => nodes[i].m.position.clone().add(new THREE.Vector3(0, nodes[i].up * 1.15, 0)).toArray() as V3, dir: () => [0, nodes[i].up, 0] as V3, color: '#f1f5f9', kind: 'note' as const, size: 'm' as const, visible: (t: number) => w.visible(o, t), prio: 6 }));
  return {
    id: o.id, root,
    update: (t) => {
      root.visible = w.visible(o, t);
      const k = cur(t), x = events.length ? xOf(events[k].at) : p[0];
      const x0 = p[0] - L / 2, wdt = Math.max(0.01, x - x0);
      fill.scale.set(wdt, 1, 1); fill.position.set(x0 + wdt / 2, p[1], p[2]);
      nodes.forEach((n, i) => { const on = i === k; n.m.scale.setScalar(on ? 1.6 + 0.15 * Math.sin(t * 5) : i < k ? 1.1 : 0.9); emissivePulse(n.m.material as THREE.Material, on ? 1 : 0, t); });
    },
    labels,
  };
}

const BUILDERS: Record<string, (o: S3DObject, c: Ctx) => Part> = {
  box: boxLike, cart: boxLike, ball, charge: ball, cylinder, ground, wall: wallLike, ceiling: wallLike, incline, conveyor, pulley, rope, spring, rod, pendulum,
  arrow, angle: angleObj, trail, measure, field, wave, axes, curve, surface, solid, point, segment, polygon, plane: polygon, sphere,
  molecule, crystal, atom, earth, sun: sunObj, moon, orbit, cell, dna, label, timeline,
};

export function buildPart(o: S3DObject, c: Ctx): Part | null {
  const b = BUILDERS[o.type];
  if (!b) return null;
  try { return b(o, c); } catch (e) { console.warn('立体演示：构建对象失败', o.id, e); return null; }
}
