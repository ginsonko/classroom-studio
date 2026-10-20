// 3D 部件（three.js）：星空、星云、光速穿梭、太阳、行星轨道（开普勒第二定律）、分子、化学反应、DNA、曲面、地球、原子、粒子文字、发光网格。
// 每个部件给出一个 Object3D 和 update(时间)，画面只由时间决定。
import * as THREE from 'three';
import { clamp, ease, hash, lerp, lerp3, num, rng, smooth, span, str, vec, type ItemSpec, type Life, type V3 } from './core';
import { CONTINENTS, elementOf, moleculeByName } from '../scene3d/data';
import { compile } from '../scene3d/expr';

export interface Env3 { st: number; sdur: number; camera: THREE.PerspectiveCamera; frame: number }
export interface Part3 { at: number; dur: number; obj: THREE.Object3D; update: (L: Life, e: Env3) => void }
type Make3 = (s: ItemSpec, at: number, dur: number) => Part3;

// ── 公共材质和贴图 ──
let dotTex: THREE.Texture | null = null;
export function dot(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  dotTex = new THREE.CanvasTexture(c); dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}
const additive = (color: THREE.ColorRepresentation, opacity = 1) => new THREE.SpriteMaterial({ map: dot(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 1) { const s = new THREE.Sprite(additive(color, opacity)); s.scale.setScalar(size); return s; }
const pointsMat = (size: number, opacity = 1) => new THREE.PointsMaterial({ size, map: dot(), vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
function setOpacity(o: THREE.Object3D, a: number) {
  o.traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      const base = (mm.userData.base ??= mm.opacity), was = (mm.userData.transparent ??= mm.transparent);
      // 完全不透明时保持原来的设置：都当透明物体画会打乱前后遮挡顺序
      const tr = was || a < 0.999;
      if (mm.transparent !== tr) { mm.transparent = tr; mm.needsUpdate = true; }
      mm.opacity = base * a; mm.visible = a > 0.002;
    }
  });
}
const pbr = (color: string, o: { emissive?: number; rough?: number; metal?: number; clear?: boolean } = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: o.rough ?? 0.28, metalness: o.metal ?? 0.05, clearcoat: o.clear === false ? 0 : 1, clearcoatRoughness: 0.15, emissive: color, emissiveIntensity: o.emissive ?? 0.12 });

function arrow(color: string) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 12), mat); shaft.position.y = 0.5; shaft.name = 'shaft';
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 16), mat); head.name = 'head';
  g.add(shaft, head);
  return g;
}
function pointArrow(g: THREE.Object3D, from: THREE.Vector3, dir: THREE.Vector3, len: number) {
  g.position.copy(from);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const shaft = g.getObjectByName('shaft')!, head = g.getObjectByName('head')!;
  const L = Math.max(0.01, len - 0.4);
  shaft.scale.y = L; shaft.position.y = L / 2; head.position.y = L + 0.2;
}

// ═══ 背景类 ═══
const stars: Make3 = (s, at, dur) => {
  const n = num(s.count, 5000), r = rng(num(s.seed, 3)), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const palette = [new THREE.Color('#ffffff'), new THREE.Color('#9fc2ff'), new THREE.Color('#ffd9a8'), new THREE.Color('#c9b8ff')];
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 60 + r() * 180, sq = Math.sqrt(1 - u * u);
    pos.set([rad * sq * Math.cos(th), rad * u, rad * sq * Math.sin(th)], i * 3);
    const c = palette[Math.floor(r() * palette.length)].clone().multiplyScalar(0.35 + r() * 0.9);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, pointsMat(num(s.size, 1.1)));
  return { at, dur, obj: pts, update: (L, e) => { pts.rotation.y = e.st * 0.012; setOpacity(pts, L.a); } };
};

const nebula: Make3 = (s, at, dur) => {
  const g = new THREE.Group(), colors = (Array.isArray(s.colors) ? s.colors : ['#3b5bff', '#9b3cff', '#00b3a4', '#ff3d8b']) as string[], r = rng(num(s.seed, 11));
  for (let i = 0; i < 9; i++) {
    const sp = glowSprite(colors[i % colors.length], 60 + r() * 90, 0.09 + r() * 0.08);
    sp.position.set((r() - 0.5) * 180, (r() - 0.5) * 80, -60 - r() * 90);
    g.add(sp);
  }
  return { at, dur, obj: g, update: (L, e) => { g.rotation.z = e.st * 0.01; setOpacity(g, L.a); } };
};

/** 光速穿梭：一束束光线迎面飞来 */
const warp: Make3 = (s, at, dur) => {
  const n = num(s.count, 900), r = rng(5), pos = new Float32Array(n * 6), col = new Float32Array(n * 6), seeds: { x: number; y: number; z: number; l: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rad = 1.5 + r() * 16;
    seeds.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, z: -r() * 200, l: 2 + r() * 8 });
    const c = new THREE.Color().setHSL(0.58 + r() * 0.12, 0.8, 0.55 + r() * 0.3);
    col.set([c.r, c.g, c.b, 0, 0, 0], i * 6);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const speed = num(s.speed, 90);
  return {
    at, dur, obj: lines, update: (L) => {
      const sp = speed * (0.25 + 0.75 * ease('in', span(L.t, 0, L.dur * 0.7)));
      const travel = L.t * speed * 0.6 + sp * L.t * 0.4;
      seeds.forEach((q, i) => {
        const z = ((q.z + travel) % 200) - 190, len = q.l * (0.3 + sp / speed * 3);
        pos.set([q.x, q.y, z, q.x, q.y, z - len], i * 6);
      });
      geo.attributes.position.needsUpdate = true;
      setOpacity(lines, L.a);
    },
  };
};

const grid: Make3 = (s, at, dur) => {
  const size = num(s.size, 120), step = num(s.step, 2), y = num(s.y, -3), color = new THREE.Color(str(s.color, '#3a6bff'));
  const n = Math.round(size / step), pos: number[] = [], col: number[] = [];
  for (let i = -n / 2; i <= n / 2; i++) {
    const v = i * step;
    for (const [a, b] of [[[v, y, -size / 2], [v, y, size / 2]], [[-size / 2, y, v], [size / 2, y, v]]] as V3[][]) {
      pos.push(...a, ...b);
      const fa = 1 - clamp(Math.hypot(a[0], a[2]) / (size / 2)), fb = 1 - clamp(Math.hypot(b[0], b[2]) / (size / 2));
      col.push(color.r * fa, color.g * fa, color.b * fa, color.r * fb, color.g * fb, color.b * fb);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  const flow = num(s.flow, 0);
  return { at, dur, obj: lines, update: (L, e) => { lines.position.z = (e.st * flow) % step; setOpacity(lines, L.a); } };
};

// ═══ 天体 ═══
const sun: Make3 = (s, at, dur) => {
  const g = new THREE.Group(), r = num(s.radius, 1.6), color = str(s.color, '#ffb347');
  const core = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }));
  const c1 = glowSprite(color, r * 5, 0.85), c2 = glowSprite('#ff6a2a', r * 11, 0.35), light = new THREE.PointLight('#ffe2b8', 600, 0, 1.6);
  g.add(core, c1, c2, light); g.position.set(...vec(s.pos, [0, 0, 0]));
  return {
    at, dur, obj: g, update: (L, e) => {
      const k = ease('outBack', L.k); g.scale.setScalar(Math.max(0.001, k));
      c1.scale.setScalar(r * 5 * (1 + Math.sin(e.st * 2.3) * 0.04)); c2.scale.setScalar(r * 11 * (1 + Math.sin(e.st * 1.3 + 1) * 0.06));
      setOpacity(g, L.a); light.intensity = 600 * L.a;
    },
  };
};

/** 行星沿椭圆轨道运动（开普勒方程），拖尾、速度箭头、等时扫过面积 */
const orbit: Make3 = (s, at, dur) => {
  const a = num(s.a, 7), e = num(s.e, 0.6), b = a * Math.sqrt(1 - e * e), period = num(s.period, 8), M0 = num(s.phase, Math.PI * 0.8);
  const color = str(s.color, '#4cc9ff'), g = new THREE.Group();
  const posAt = (M: number) => { let E = M; for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return new THREE.Vector3(a * (Math.cos(E) - e), 0, -b * Math.sin(E)); };
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => posAt((i / 256) * Math.PI * 2))), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(num(s.planet, 0.45), 48, 24), pbr(color, { emissive: 0.5 }));
  const halo = glowSprite(color, 2.2, 0.8); planet.add(halo);
  const TRAIL = 120, tpos = new Float32Array(TRAIL * 3), tcol = new Float32Array(TRAIL * 3), tc = new THREE.Color(color);
  for (let i = 0; i < TRAIL; i++) { const f = (1 - i / TRAIL) ** 1.6; tcol.set([tc.r * f, tc.g * f, tc.b * f], i * 3); }
  const tgeo = new THREE.BufferGeometry(); tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3)); tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
  const trail = new THREE.Points(tgeo, pointsMat(0.5));
  // 两块等时扇形：近日点附近、远日点附近
  const dt = num(s.sweep, 0.12) * Math.PI * 2, sweeps: { mesh: THREE.Mesh; from: number }[] = [];
  for (const [mid, c] of [[0, '#ffd166'], [Math.PI, '#ff7ab6']] as const) {
    const steps = 40, verts: number[] = [];
    for (let i = 0; i < steps; i++) { const p = posAt(mid - dt / 2 + (dt * i) / steps), q = posAt(mid - dt / 2 + (dt * (i + 1)) / steps); verts.push(0, 0, 0, p.x, 0, p.z, q.x, 0, q.z); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.y = -0.01; sweeps.push({ mesh, from: mid - dt / 2 }); g.add(mesh);
  }
  const vel = arrow('#3ddc97');
  g.add(ring, planet, trail, vel); g.position.set(...vec(s.pos, [0, 0, 0])); g.rotation.x = num(s.tilt, 0) * Math.PI / 180;
  return {
    at, dur, obj: g, update: (L, env) => {
      const M = M0 + (2 * Math.PI * Math.max(0, env.st - at)) / period;
      planet.position.copy(posAt(M));
      for (let i = 0; i < TRAIL; i++) { const p = posAt(M - i * 0.012); tpos.set([p.x, p.y, p.z], i * 3); }
      tgeo.attributes.position.needsUpdate = true;
      for (const sw of sweeps) {
        // 行星经过这一段时扇形跟着展开，之后保持
        const rel = ((M - sw.from) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), passed = M - sw.from >= dt;
        const k = passed ? 1 : rel <= dt && M >= sw.from ? rel / dt : 0;
        sw.mesh.geometry.setDrawRange(0, Math.floor(k * 40) * 3);
      }
      const p1 = posAt(M + 0.01), v = p1.clone().sub(planet.position);
      const speed = v.length() / 0.01 / (2 * Math.PI / period);
      pointArrow(vel, planet.position.clone().add(new THREE.Vector3(0, 0.02, 0)), v, 0.6 + speed * 0.55);
      vel.visible = !!s.velocity && L.t > 0.8;
      ring.scale.setScalar(ease('outExpo', L.k));
      setOpacity(g, L.a);
    },
  };
};

// ═══ 化学 ═══
function moleculeGroup(atoms: [string, number, number, number][], bonds: [number, number, number][], scale: number) {
  const g = new THREE.Group(), meshes: THREE.Mesh[] = [], sticks: THREE.Mesh[] = [];
  const c = atoms.reduce((acc, a) => [acc[0] + a[1] / atoms.length, acc[1] + a[2] / atoms.length, acc[2] + a[3] / atoms.length], [0, 0, 0]);
  for (const [el, x, y, z] of atoms) {
    const info = elementOf(el), m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.26, info.r * 0.42) * scale, 48, 24), pbr(el === 'C' ? '#4a5263' : info.color, { emissive: el === 'C' ? 0.05 : 0.18 }));
    m.position.set((x - c[0]) * scale, (y - c[1]) * scale, (z - c[2]) * scale); meshes.push(m); g.add(m);
  }
  const bmat = pbr('#c9d3e6', { emissive: 0.08 });
  for (const [i, j, order] of bonds) {
    const pa = meshes[i].position, pb = meshes[j].position, d = pb.clone().sub(pa), len = d.length();
    const offs = order >= 2 ? (order === 3 ? [-1, 0, 1] : [-0.5, 0.5]) : [0];
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0.3)).normalize().multiplyScalar(0.13 * scale);
    for (const o of offs) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * scale, 0.075 * scale, len, 16), bmat);
      st.position.copy(pa.clone().add(pb).multiplyScalar(0.5).add(side.clone().multiplyScalar(o)));
      st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      st.userData.len = len; sticks.push(st); g.add(st);
    }
  }
  return { g, meshes, sticks };
}

const molecule: Make3 = (s, at, dur) => {
  const mol = moleculeByName(str(s.name, 'C6H6'));
  const atoms = (Array.isArray(s.atoms) ? s.atoms : mol?.atoms ?? []) as [string, number, number, number][];
  const bonds = (Array.isArray(s.bonds) ? s.bonds : mol?.bonds ?? []) as [number, number, number][];
  const { g, meshes, sticks } = moleculeGroup(atoms, bonds, num(s.scale, 1.4));
  const holder = new THREE.Group(); holder.add(g); holder.position.set(...vec(s.pos, [0, 0, 0]));
  const spin = num(s.spin, 0.5), tilt = num(s.tilt, 0.35);
  return {
    at, dur, obj: holder, update: (L) => {
      meshes.forEach((m, i) => m.scale.setScalar(Math.max(0.001, ease('outBack', span(L.t, 0.1 + i * 0.05, 0.6 + i * 0.05)))));
      const bk = ease('out', span(L.t, 0.3 + meshes.length * 0.05, 0.9 + meshes.length * 0.05));
      sticks.forEach((st) => { st.scale.set(1, Math.max(0.001, bk), 1); });
      g.rotation.y = L.t * spin; g.rotation.x = tilt + Math.sin(L.t * 0.4) * 0.1;
      setOpacity(holder, L.a);
    },
  };
};

/** 反应：原子从反应物的位置移到生成物的位置，旧键断开、新键生成，中间一下闪光 */
const reaction: Make3 = (s, at, dur) => {
  const from = (s.from ?? []) as [string, number, number, number][], to = (s.to ?? []) as [string, number, number, number][];
  const bf = (s.bondsFrom ?? []) as [number, number][], bt = (s.bondsTo ?? []) as [number, number][], sc = num(s.scale, 1.2);
  const t0 = num(s.t0, 1.6), t1 = num(s.t1, 3.6), g = new THREE.Group();
  const atoms = from.map(([el]) => { const info = elementOf(el); const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.3, info.r * 0.45) * sc, 48, 24), pbr(info.color, { emissive: 0.2 })); g.add(m); return m; });
  const stick = () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * sc, 0.08 * sc, 1, 16), pbr('#d6def0', { emissive: 0.1 })); g.add(m); return m; };
  const oldB = bf.map(stick), newB = bt.map(stick);
  const flash = glowSprite('#ffffff', 1, 0); g.add(flash);
  const burst = new THREE.Points(new THREE.BufferGeometry(), pointsMat(0.25)); const r = rng(17), BN = 260, bpos = new Float32Array(BN * 3), bcol = new Float32Array(BN * 3), bdir: V3[] = [];
  for (let i = 0; i < BN; i++) { const u = r() * 2 - 1, th = r() * Math.PI * 2, q = Math.sqrt(1 - u * u); bdir.push([q * Math.cos(th), u, q * Math.sin(th)]); const c = new THREE.Color().setHSL(0.08 + r() * 0.1, 1, 0.6); bcol.set([c.r, c.g, c.b], i * 3); }
  burst.geometry.setAttribute('position', new THREE.BufferAttribute(bpos, 3)); burst.geometry.setAttribute('color', new THREE.BufferAttribute(bcol, 3)); g.add(burst);
  g.position.set(...vec(s.pos, [0, 0, 0]));
  const place = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, k: number) => {
    const d = b.clone().sub(a), len = d.length(); m.position.copy(a.clone().add(b).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.scale.set(1, Math.max(0.001, len * k), 1); m.visible = k > 0.01;
  };
  return {
    at, dur, obj: g, update: (L) => {
      const k = ease('inOutExpo', span(L.t, t0, t1));
      atoms.forEach((m, i) => {
        const p = lerp3([from[i][1], from[i][2], from[i][3]], [to[i][1], to[i][2], to[i][3]], k);
        // 中途稍微散开一点，像被「打散」再重组
        const lift = Math.sin(k * Math.PI) * 0.6;
        m.position.set(p[0] * sc * (1 + lift * 0.25), p[1] * sc * (1 + lift * 0.25), p[2] * sc * (1 + lift * 0.25));
        m.scale.setScalar(Math.max(0.001, ease('outBack', span(L.t, 0.1 + i * 0.06, 0.6 + i * 0.06))));
      });
      const ok = 1 - smooth(span(L.t, t0, t0 + (t1 - t0) * 0.35)), nk = smooth(span(L.t, t1 - (t1 - t0) * 0.3, t1 + 0.2));
      oldB.forEach((m, i) => place(m, atoms[bf[i][0]].position, atoms[bf[i][1]].position, ok * smooth(span(L.t, 0.5, 1.0))));
      newB.forEach((m, i) => place(m, atoms[bt[i][0]].position, atoms[bt[i][1]].position, nk));
      g.rotation.y = L.t * num(s.spin, 0.25);
      setOpacity(g, L.a);
      const mid = (t0 + t1) / 2, fk = Math.exp(-(((L.t - mid) / 0.25) ** 2));
      flash.scale.setScalar(2 + fk * 9); (flash.material as THREE.SpriteMaterial).opacity = fk * 0.9 * L.a; flash.material.visible = fk > 0.01;
      const bk = span(L.t, mid - 0.1, mid + 1.4);
      for (let i = 0; i < BN; i++) { const d = ease('outExpo', bk) * (3 + hash(i) * 5); bpos.set([bdir[i][0] * d, bdir[i][1] * d, bdir[i][2] * d], i * 3); }
      burst.geometry.attributes.position.needsUpdate = true;
      (burst.material as THREE.PointsMaterial).opacity = bk > 0 && bk < 1 ? (1 - bk) * L.a : 0; burst.material.visible = bk > 0 && bk < 1;
    },
  };
};

// ═══ 生物：DNA 双螺旋 ═══
const dna: Make3 = (s, at, dur) => {
  const n = num(s.pairs, 30), rise = num(s.rise, 0.42), R = num(s.radius, 1.25), turn = (num(s.turn, 34) * Math.PI) / 180, groove = (num(s.groove, 150) * Math.PI) / 180;
  const g = new THREE.Group(), r = rng(num(s.seed, 23)), H = (n - 1) * rise;
  const BASE: Record<string, string> = { A: '#ff8a3d', T: '#4cc9ff', G: '#3ddc97', C: '#ff5d8f' };
  const strand = (off: number) => Array.from({ length: n }, (_, i) => new THREE.Vector3(R * Math.cos(i * turn + off), i * rise - H / 2, R * Math.sin(i * turn + off)));
  const sa = strand(0), sb = strand(groove);
  const tube = (pts: THREE.Vector3[], color: string) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 8, 0.11, 10, false), pbr(color, { emissive: 0.22 }));
  const ta = tube(sa, '#59b8ff'), tb = tube(sb, '#c084fc');
  g.add(ta, tb);
  const pairs: { grp: THREE.Group; mats: THREE.MeshPhysicalMaterial[] }[] = [];
  for (let i = 0; i < n; i++) {
    const pick = ['A', 'T', 'G', 'C'][Math.floor(r() * 4)], mate = { A: 'T', T: 'A', G: 'C', C: 'G' }[pick]!;
    const grp = new THREE.Group(), mats: THREE.MeshPhysicalMaterial[] = [];
    const mid = sa[i].clone().add(sb[i]).multiplyScalar(0.5);
    for (const [p, base] of [[sa[i], pick], [sb[i], mate]] as const) {
      const d = mid.clone().sub(p), len = d.length() - 0.04, mat = pbr(BASE[base], { emissive: 0.18 });
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, len, 12), mat);
      cyl.position.copy(p.clone().add(d.clone().normalize().multiplyScalar(len / 2))); cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12), pbr(base === pick ? '#9fd4ff' : '#dcb8ff', { emissive: 0.25 }));
      ball.position.copy(p);
      grp.add(cyl, ball); mats.push(mat);
    }
    pairs.push({ grp, mats }); g.add(grp);
  }
  const holder = new THREE.Group(); holder.add(g); holder.position.set(...vec(s.pos, [0, 0, 0])); holder.rotation.z = num(s.lean, 0.25);
  const spin = num(s.spin, 0.45), growDur = num(s.grow, 2.4);
  const clipA = (k: number) => Math.floor(clamp(k) * n * 8) * 10 * 6;
  return {
    at, dur, obj: holder, update: (L) => {
      const gk = span(L.t, 0, growDur);
      ta.geometry.setDrawRange(0, clipA(gk)); tb.geometry.setDrawRange(0, clipA(gk));
      const wave = ((L.t - growDur) * 9) % (n + 12) - 6;
      pairs.forEach((p, i) => {
        const k = ease('outBack', span(gk * n, i - 0.5, i + 1.5));
        p.grp.scale.setScalar(Math.max(0.001, k));
        const hot = L.t > growDur ? Math.exp(-(((i - wave) / 2) ** 2)) : 0;
        for (const m of p.mats) m.emissiveIntensity = 0.18 + hot * 1.6;
      });
      g.rotation.y = L.t * spin;
      setOpacity(holder, L.a);
    },
  };
};

// ═══ 数学：z = f(x, y) 曲面，可在两个函数之间变形 ═══
const surface: Make3 = (s, at, dur) => {
  const res = num(s.res, 90), size = num(s.range, 3), hs = num(s.height, 1), sc = num(s.scale, 1.3);
  const f1 = compile(str(s.f, 'sin(x)*cos(y)'), { names: new Set(['x', 'y', 't']) }).fn, f2 = s.to ? compile(str(s.to), { names: new Set(['x', 'y', 't']) }).fn : null;
  const morphAt = num(s.morphAt, 99);
  const geo = new THREE.PlaneGeometry(size * 2 * sc, size * 2 * sc, res, res); geo.rotateX(-Math.PI / 2);
  const P = geo.attributes.position as THREE.BufferAttribute, colors = new Float32Array(P.count * 3); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.15, emissive: '#ffffff', emissiveIntensity: 0.0, transparent: true, opacity: 0.92 }));
  // 网格线：每隔几格一条
  const every = Math.max(1, Math.round(res / 18)), lidx: number[] = [];
  for (let i = 0; i <= res; i += every) for (let j = 0; j < res; j++) { lidx.push(i * (res + 1) + j, i * (res + 1) + j + 1, j * (res + 1) + i, (j + 1) * (res + 1) + i); }
  const lgeo = new THREE.BufferGeometry(); lgeo.setAttribute('position', P); lgeo.setIndex(lidx);
  const wire = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  wire.position.y = 0.01;
  const g = new THREE.Group(); g.add(mesh, wire); g.position.set(...vec(s.pos, [0, 0, 0]));
  const stops = [new THREE.Color('#2b5cff'), new THREE.Color('#7a3cff'), new THREE.Color('#ff3d8b'), new THREE.Color('#ffb347')], tmp = new THREE.Color();
  const xs = Float32Array.from({ length: P.count }, (_, i) => P.getX(i) / sc), zs = Float32Array.from({ length: P.count }, (_, i) => P.getZ(i) / sc);
  return {
    at, dur, obj: g, update: (L) => {
      const mk = ease('inOut', span(L.t, morphAt, morphAt + 2)), rise = L.k;
      for (let i = 0; i < P.count; i++) {
        const x = xs[i], y = -zs[i], rr = Math.hypot(x, y) / (size * 1.42);
        let z = f1({ v: { x, y, t: L.t } }); if (f2) z = lerp(z, f2({ v: { x, y, t: L.t } }), mk);
        if (!Number.isFinite(z)) z = 0;
        const grow = ease('outExpo', clamp(rise * 1.8 - rr));
        P.setY(i, z * hs * sc * grow);
        const h = clamp((z + 1.2) / 2.4) * (stops.length - 1), k = Math.floor(Math.min(stops.length - 2, h));
        tmp.copy(stops[k]).lerp(stops[k + 1], h - k);
        colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      P.needsUpdate = true; (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true; geo.computeVertexNormals();
      g.rotation.y = L.t * num(s.spin, 0.12);
      setOpacity(g, L.a);
    },
  };
};

// ═══ 地理：地球（大陆贴图 + 云 + 大气辉光 + 地轴） ═══
let earthTex: THREE.Texture | null = null;
function earthTexture() {
  if (earthTex) return earthTex;
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const oc = g.createLinearGradient(0, 0, 0, H); oc.addColorStop(0, '#06204a'); oc.addColorStop(0.5, '#0a3f7e'); oc.addColorStop(1, '#06204a');
  g.fillStyle = oc; g.fillRect(0, 0, W, H);
  const r = rng(29);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(40,120,200,${r() * 0.08})`; g.beginPath(); g.arc(r() * W, r() * H, 20 + r() * 80, 0, Math.PI * 2); g.fill(); }
  const land = new Path2D();
  for (const poly of CONTINENTS) { for (let i = 0; i < poly.length; i += 2) { const x = ((poly[i] + 180) / 360) * W, y = ((90 - poly[i + 1]) / 180) * H; if (i) land.lineTo(x, y); else land.moveTo(x, y); } land.closePath(); }
  g.save(); g.clip(land);
  const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, '#d9e4d0'); lg.addColorStop(0.18, '#2f6a2c'); lg.addColorStop(0.36, '#5f7f2a'); lg.addColorStop(0.46, '#c29a52'); lg.addColorStop(0.54, '#b8874a'); lg.addColorStop(0.64, '#3f7a2c'); lg.addColorStop(0.85, '#2e5f2a'); lg.addColorStop(1, '#e6eef2');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) { g.fillStyle = r() < 0.5 ? `rgba(30,60,20,${r() * 0.25})` : `rgba(190,160,100,${r() * 0.2})`; g.beginPath(); g.arc(r() * W, r() * H, 3 + r() * 16, 0, Math.PI * 2); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(200,240,255,0.5)'; g.lineWidth = 2; g.stroke(land);
  // 冰盖
  g.fillStyle = 'rgba(240,248,255,0.9)'; g.fillRect(0, 0, W, H * 0.045); g.fillRect(0, H * 0.94, W, H * 0.06);
  earthTex = new THREE.CanvasTexture(c); earthTex.colorSpace = THREE.SRGBColorSpace; earthTex.anisotropy = 8;
  return earthTex;
}
function cloudTexture() {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!, r = rng(41);
  g.filter = 'blur(6px)';
  for (let i = 0; i < 520; i++) { const y = H * (0.12 + r() * 0.76); g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.1})`; g.beginPath(); g.ellipse(r() * W, y, 10 + r() * 50, 4 + r() * 14, 0, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const earth: Make3 = (s, at, dur) => {
  const R = num(s.radius, 2.6), tilt = (num(s.tilt, 23.5) * Math.PI) / 180, g = new THREE.Group(), body = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.62, metalness: 0 }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.015, 64, 48), new THREE.MeshStandardMaterial({ map: cloudTexture(), transparent: true, opacity: 0.6, depthWrite: false, roughness: 1 }));
  clouds.renderOrder = 1;
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 64, 48), new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(str(s.glow, '#4aa8ff')) }, a: { value: 1 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 c; uniform float a; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.6); gl_FragColor = vec4(c * f * 1.6, f * a); }',
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  }));
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, R * 2.9, 8), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
  const eq = new THREE.Mesh(new THREE.TorusGeometry(R * 1.004, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.8 })); eq.rotation.x = Math.PI / 2;
  body.add(globe, clouds, axis, eq); body.rotation.z = tilt;
  g.add(body, atmo); g.position.set(...vec(s.pos, [0, 0, 0]));
  const spin = num(s.spin, 0.35), showAxis = s.axis !== false;
  return {
    at, dur, obj: g, update: (L) => {
      globe.rotation.y = L.t * spin + num(s.lon, 0); clouds.rotation.y = L.t * spin * 1.15 + num(s.lon, 0);
      const k = ease('outExpo', L.k); g.scale.setScalar(0.6 + 0.4 * k);
      axis.visible = eq.visible = showAxis && L.t > 1.0; axis.scale.y = ease('outExpo', span(L.t, 1.0, 2.0));
      setOpacity(g, L.a); (atmo.material as THREE.ShaderMaterial).uniforms.a.value = L.a;
    },
  };
};

// ═══ 原子（玻尔模型）：原子核 + 三条倾斜轨道上的电子 ═══
const atom: Make3 = (s, at, dur) => {
  const g = new THREE.Group(), r = rng(13), nuc = new THREE.Group();
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), pbr(i % 2 ? '#ff5d5d' : '#9aa7c0', { emissive: 0.3 })); const u = r() * 2 - 1, th = r() * Math.PI * 2, q = Math.sqrt(1 - u * u), d = 0.35 * Math.cbrt(r()); m.position.set(q * Math.cos(th) * d, u * d, q * Math.sin(th) * d); nuc.add(m); }
  nuc.add(glowSprite('#ff7a5c', 3, 0.5)); g.add(nuc);
  const orbits: { pivot: THREE.Group; e: THREE.Sprite; speed: number; R: number }[] = [];
  [[0, 0], [60, 40], [-60, -30]].forEach(([rx, rz], i) => {
    const pivot = new THREE.Group(); pivot.rotation.set((rx * Math.PI) / 180, 0, (rz * Math.PI) / 180);
    const R = 2.2 + i * 0.35;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.015, 8, 200), new THREE.MeshBasicMaterial({ color: '#7ad7ff', transparent: true, opacity: 0.55 })); ring.rotation.x = Math.PI / 2;
    const e = glowSprite('#bdf3ff', 0.8, 1);
    pivot.add(ring, e); g.add(pivot); orbits.push({ pivot, e, speed: 2.2 - i * 0.4, R });
  });
  g.position.set(...vec(s.pos, [0, 0, 0])); const sc = num(s.scale, 1);
  return {
    at, dur, obj: g, update: (L) => {
      g.scale.setScalar(Math.max(0.001, sc * ease('outBack', L.k)));
      orbits.forEach((o, i) => { const a = L.t * o.speed + i * 2; o.e.position.set(Math.cos(a) * o.R, 0, Math.sin(a) * o.R); });
      nuc.rotation.y = L.t * 0.6; g.rotation.y = L.t * 0.15;
      setOpacity(g, L.a);
    },
  };
};

// ═══ 粒子文字：上万个光点从四面八方汇聚成一行字 ═══
const particleText: Make3 = (s, at, dur) => {
  const text = str(s.text, '课堂动画引擎'), width = num(s.width, 14), font = str(s.font, '900 200px "Noto Sans SC","Microsoft YaHei",sans-serif');
  const c = document.createElement('canvas'), g2 = c.getContext('2d')!;
  g2.font = font; const tw = Math.ceil(g2.measureText(text).width) + 40; c.width = tw; c.height = 260;
  g2.font = font; g2.fillStyle = '#fff'; g2.textBaseline = 'middle'; g2.fillText(text, 20, 130);
  const data = g2.getImageData(0, 0, c.width, c.height).data, tgt: number[] = [], step = num(s.step, 3);
  for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) if (data[(y * c.width + x) * 4 + 3] > 128) tgt.push(x, y);
  const n = tgt.length / 2, k = width / c.width, r = rng(77);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), start = new Float32Array(n * 3), goal = new Float32Array(n * 3), delay = new Float32Array(n);
  const c1 = new THREE.Color(str(s.from, '#4cc9ff')), c2 = new THREE.Color(str(s.to, '#ff7ab6')), tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const gx = (tgt[i * 2] - c.width / 2) * k, gy = -(tgt[i * 2 + 1] - c.height / 2) * k;
    goal.set([gx, gy, 0], i * 3);
    const u = r() * 2 - 1, th = r() * Math.PI * 2, q = Math.sqrt(1 - u * u), d = 18 + r() * 30;
    start.set([q * Math.cos(th) * d, u * d, q * Math.sin(th) * d - 10], i * 3);
    delay[i] = (tgt[i * 2] / c.width) * 0.6 + r() * 0.5;
    tmp.copy(c1).lerp(c2, tgt[i * 2] / c.width); col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, pointsMat(num(s.size, 0.11)));
  const holder = new THREE.Group(); holder.add(pts); holder.position.set(...vec(s.pos, [0, 0, 0]));
  const t0 = num(s.t0, 0.2), t1 = num(s.t1, 2.6);
  return {
    at, dur, obj: holder, update: (L) => {
      for (let i = 0; i < n; i++) {
        const kk = ease('inOutExpo', span(L.t, t0 + delay[i], t1 + delay[i] * 0.5)), j = i * 3;
        const sh = Math.sin(L.t * 2 + i) * 0.015;
        pos[j] = lerp(start[j], goal[j], kk) + sh; pos[j + 1] = lerp(start[j + 1], goal[j + 1], kk) + sh; pos[j + 2] = lerp(start[j + 2], goal[j + 2], kk);
      }
      geo.attributes.position.needsUpdate = true;
      setOpacity(holder, L.a);
    },
  };
};

/** 发光圆环（装饰） */
const rings: Make3 = (s, at, dur) => {
  const g = new THREE.Group(), color = str(s.color, '#7aa2ff');
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(3 + i * 1.2, 0.012 + i * 0.004, 8, 240), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 - i * 0.08 })); m.rotation.x = Math.PI / 2 + i * 0.2; g.add(m); }
  g.position.set(...vec(s.pos, [0, 0, 0]));
  return { at, dur, obj: g, update: (L) => { g.children.forEach((m, i) => { m.rotation.z = L.t * (0.2 + i * 0.1) * (i % 2 ? -1 : 1); m.scale.setScalar(ease('outExpo', span(L.t, i * 0.15, 1 + i * 0.15))); }); setOpacity(g, L.a); } };
};

/** 通用物体：球、方块、圆柱、圆锥、圆环。可以沿 to / path 移动、自转、留下轨迹 */
const body: Make3 = (s, at, dur) => {
  const kind = str(s.shape, 'sphere'), color = str(s.color, '#4cc9ff');
  const sz = Array.isArray(s.size) ? vec(s.size, [1, 1, 1]) : ([num(s.size, 1), num(s.size, 1), num(s.size, 1)] as V3);
  const geo = kind === 'box' ? new THREE.BoxGeometry(sz[0], sz[1], sz[2]) : kind === 'cylinder' ? new THREE.CylinderGeometry(sz[0] / 2, sz[0] / 2, sz[1], 48)
    : kind === 'cone' ? new THREE.ConeGeometry(sz[0] / 2, sz[1], 48) : kind === 'torus' ? new THREE.TorusGeometry(sz[0] / 2, sz[0] / 10, 24, 96) : new THREE.SphereGeometry(sz[0] / 2, 48, 32);
  const mesh = new THREE.Mesh(geo, pbr(color, { emissive: clamp(num(s.glow, 0.15), 0, 2), metal: s.metal ? 0.8 : 0.05, rough: s.metal ? 0.25 : 0.35 }));
  const g = new THREE.Group(); g.add(mesh);
  if (num(s.glow, 0) > 0.5) g.add(glowSprite(color, sz[0] * 2.6, 0.5));
  const pathIn = Array.isArray(s.path) ? (s.path as unknown[]).map((p) => vec(p, [0, 0, 0])) : [];
  const from = vec(s.pos, pathIn[0] ?? [0, 0, 0]);
  const path: V3[] = pathIn.length ? (s.pos ? [from, ...pathIn] : pathIn) : s.to ? [from, vec(s.to, from)] : [from];
  const cum = path.reduce<number[]>((a, p, i) => (a.push(i ? a[i - 1] + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]) : 0), a), []);
  const total = cum[cum.length - 1] || 1;
  const t0 = num(s.moveAt, 0.6), t1 = t0 + num(s.moveDur, Math.max(0.5, dur - t0 - 0.6)), ez = str(s.ease, 'inOut') as Parameters<typeof ease>[0];
  const posAt = (k: number): V3 => {
    if (path.length < 2) return from;
    const d = clamp(k) * total; let i = 1; while (i < path.length - 1 && cum[i] < d) i++;
    return lerp3(path[i - 1], path[i], (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1));
  };
  let trail: THREE.Line | null = null, tpos: Float32Array | null = null;
  const TN = 120;
  if (s.trail && path.length > 1) {
    tpos = new Float32Array(TN * 3); const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  }
  const holder = new THREE.Group(); holder.add(g); if (trail) holder.add(trail);
  const spin = num(s.spin, 0), rot = vec(s.rot, [0, 0, 0]).map((d) => (d * Math.PI) / 180) as V3; mesh.rotation.set(...rot);
  return {
    at, dur, obj: holder, update: (L) => {
      const k = ease(ez, span(L.t, t0, t1)), p = posAt(k);
      g.position.set(...p); g.scale.setScalar(Math.max(0.001, ease('outBack', L.k)));
      mesh.rotation.y = rot[1] + L.t * spin;
      if (trail && tpos) {
        for (let i = 0; i < TN; i++) { const q = posAt(k * (i / (TN - 1))); tpos.set(q, i * 3); }
        trail.geometry.attributes.position.needsUpdate = true; trail.geometry.setDrawRange(0, k > 0 ? TN : 0);
      }
      setOpacity(holder, L.a);
    },
  };
};

export const PARTS_3D: Record<string, Make3> = { stars, nebula, warp, grid, sun, orbit, molecule, reaction, dna, surface, earth, atom, particleText, rings, body };
export const make3 = (s: ItemSpec, at: number, dur: number): Part3 | null => PARTS_3D[s.type]?.(s, at, dur) ?? null;
