// 一个立体演示实例：搭舞台（灯光、地板、背景）、按规格建对象、算机位、每帧更新并画到 2D 画布。
import * as THREE from 'three';
import type { CameraName, S3DSpec } from '../spec';
import { CAMERA_LABEL } from '../spec';
import { World, type V3 } from '../world';
import { buildPart, SHARED_GEOS, type Ctx, type Part } from './build';
import { envMap, glRenderer, renderTo } from './gl';
import { chartRects, captionRect, drawCaption, drawChart, drawLabels, drawMessage, drawTag, drawTitle, type ChartData, type Rect, type ScreenLabel } from './hud';
import { backdropTex, floorTex, Mats, stars } from './look';

const D2R = Math.PI / 180;
const smooth = (k: number) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };

/** 用户在画面上拖动 / 缩放留下的视角偏移 */
export interface ViewOffset { az: number; el: number; zoom: number }
export const NO_OFFSET: ViewOffset = { az: 0, el: 0, zoom: 1 };

export interface DrawOpts {
  /** 老师点选的机位；null 时跟随规格（默认机位 + 步骤机位） */
  camera?: CameraName | null;
  view?: ViewOffset;
  /** 显示步骤字幕 / 图表 / 标题 */
  hud?: { caption?: boolean; charts?: boolean; title?: boolean };
  tag?: string;
  /** 画面底部被控制条挡住的高度（像素），字幕往上让 */
  reserveBottom?: number;
}

/** 各机位的观察方向（世界坐标，从目标指向相机） */
function camDir(name: CameraName, spec: S3DSpec): THREE.Vector3 {
  const math = spec.up === 'z';
  switch (name) {
    case 'front': return new THREE.Vector3(0, 0.08, 1);
    case 'side': return new THREE.Vector3(1, 0.12, 0.02);
    case 'top': return new THREE.Vector3(0, 1, 0.035);
    case 'back': return new THREE.Vector3(-0.42, 0.38, -1);
    case 'low': return new THREE.Vector3(0.35, -0.28, 1);
    default:
      if (spec.stage === 'space') return new THREE.Vector3(0.28, 0.62, 1);
      if (math) return new THREE.Vector3(0.62, 0.58, 1);
      return new THREE.Vector3(0.42, 0.36, 1);
  }
}

export class S3DScene {
  readonly spec: S3DSpec;
  world: World;
  private scene = new THREE.Scene();
  private content = new THREE.Group();
  private parts: Part[] = [];
  private mats = new Mats();
  private stageMats = new Mats();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 2000);
  private key = new THREE.DirectionalLight('#fff3e2', 2.4);
  private fill = new THREE.DirectionalLight('#a9c8ff', 0.55);
  private hemi = new THREE.HemisphereLight('#dfe8ff', '#1a2130', 0.55);
  private center = new THREE.Vector3();
  private radius = 4;
  private fit: THREE.Vector3[] = [];
  private box = new THREE.Box3();
  private u = 1;
  private paramsSig = '';
  private chartCache: { sig: string; xs: number[]; ys: number[][] }[] = [];
  private stage = new THREE.Group();

  constructor(spec: S3DSpec, params: Record<string, number> = {}) {
    this.spec = spec;
    this.world = new World(spec, params);
    this.scene.add(this.stage, this.content, this.hemi, this.key, this.key.target, this.fill, this.fill.target);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.build(params);
  }

  // ── 搭建 ───────────────────────────────────────────────
  private build(params: Record<string, number>) {
    this.paramsSig = JSON.stringify(params);
    this.world = new World(this.spec, params);
    const b = this.world.bounds();
    this.box.set(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    this.box.getCenter(this.center);
    const size = this.box.getSize(new THREE.Vector3());
    this.radius = Math.max(1, size.length() / 2);
    this.u = Math.max(0.35, Math.min(4, Math.max(size.x, size.y, size.z) / 8));
    const floorY = b.min[1] - (this.spec.objects.some((o) => o.type === 'ground') ? Math.max(0.15, this.u * 0.28) + 0.01 : 0.02);
    const c: Ctx = { w: this.world, u: this.u, mats: this.mats, floorY, up: new THREE.Vector3(0, 1, 0) };
    for (const o of this.spec.objects) {
      const p = buildPart(o, c);
      if (!p) continue;
      p.root.traverse((m) => { if ((m as THREE.Mesh).isMesh && !(m as THREE.Mesh).userData.noShadow) { (m as THREE.Mesh).receiveShadow = true; } });
      this.parts.push(p);
      this.content.add(p.root);
    }
    this.fit = this.fitPoints();
    if (this.fit.length >= 2) {
      // 箭头长度要等搭好（依赖尺度 u）才知道，长长的重力箭头也要算进画面
      for (const p of this.fit) this.box.expandByPoint(p);
      this.box.getCenter(this.center);
      this.radius = Math.max(1, this.box.getSize(new THREE.Vector3()).length() / 2);
    }
    this.buildStage(floorY);
    this.chartCache = [];
  }
  /**
   * 取景用的点：真实搭出来的几何体顶点（抽样）+ 标签锚点，覆盖整个时间轴。
   * 比包围盒的 8 个角紧得多：平放的轨道圆、斜放的长杆不会被当成一个大立方体，画面不会缩得很小。
   */
  private fitPoints(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const m = new THREE.Matrix4();
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const t = k * this.world.D;
      for (const p of this.parts) {
        p.update(t, this.camera);
        p.root.updateMatrixWorld(true);
        p.root.traverseVisible((o) => {
          if ((o as THREE.Sprite).isSprite) return;
          const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          const pos = geo?.getAttribute?.('position');
          if (!geo || !pos) return;
          const inst = o as THREE.InstancedMesh;
          if (inst.isInstancedMesh) {
            for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m); pts.push(new THREE.Vector3().applyMatrix4(m).applyMatrix4(o.matrixWorld)); }
            return;
          }
          const a = geo.drawRange.start, b = Math.min(pos.count, a + geo.drawRange.count);
          const step = Math.max(1, Math.ceil((b - a) / 64));
          for (let i = a; i < b; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
        });
        for (const l of p.labels) { const at = l.at(t); if (at && at.every(Number.isFinite)) pts.push(new THREE.Vector3(at[0], at[1], at[2])); }
      }
    }
    const ok = pts.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
    if (ok.length <= 3000) return ok;
    const step = ok.length / 3000;
    return Array.from({ length: 3000 }, (_, i) => ok[Math.floor(i * step)]);
  }
  private buildStage(floorY: number) {
    const st = this.spec.stage, R = this.radius;
    this.disposeTree(this.stage);
    this.stage.clear();
    this.stageMats.dispose();
    const bg = this.stageMats.own(backdropTex(st));
    this.scene.background = bg;
    const env = envMap();
    this.scene.environment = env;
    this.scene.environmentIntensity = st === 'space' ? 0.25 : 0.62;
    const hasSun = this.spec.objects.some((o) => o.type === 'sun');
    if (st === 'space') {
      const sky = stars(1800, Math.max(200, R * 30));
      this.stageMats.own(sky.material as THREE.Material);
      this.stage.add(sky);
      this.hemi.intensity = 0.16;
      this.key.intensity = hasSun ? 0 : 2.6;
      this.fill.intensity = 0.12;
    } else {
      this.hemi.intensity = 0.5;
      this.key.intensity = 2.1;
      this.fill.intensity = 0.55;
      const size = R * 10;
      const catcher = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.stageMats.own(new THREE.ShadowMaterial({ opacity: st === 'floor' ? 0.42 : 0.28, transparent: true, depthWrite: false })));
      catcher.rotation.x = -Math.PI / 2; catcher.position.set(this.center.x, floorY, this.center.z); catcher.receiveShadow = true; catcher.renderOrder = -1;
      this.stage.add(catcher);
      if (st === 'floor') {
        const tex = this.stageMats.own(floorTex());
        const step = Math.max(0.5, Math.pow(10, Math.round(Math.log10(R / 4))));
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        const gsize = Math.max(R * 5, step * 40);
        const grid = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), this.stageMats.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
        grid.rotation.x = -Math.PI / 2; grid.position.set(this.center.x, floorY - 0.002, this.center.z); grid.renderOrder = -2;
        this.stage.add(grid);
      }
    }
    // 主光：左上前方，阴影框罩住整个场景
    const kd = new THREE.Vector3(-0.55, 1.25, 0.75).normalize();
    this.key.position.copy(this.center).addScaledVector(kd, R * 3);
    this.key.target.position.copy(this.center);
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -R * 1.3; sc.right = R * 1.3; sc.top = R * 1.3; sc.bottom = -R * 1.3; sc.near = R * 0.5; sc.far = R * 6;
    sc.updateProjectionMatrix();
    this.fill.position.copy(this.center).add(new THREE.Vector3(R * 2, R * 0.8, -R * 2));
    this.fill.target.position.copy(this.center);
  }
  setParams(params: Record<string, number>) {
    const sig = JSON.stringify(params);
    if (sig === this.paramsSig) return;
    this.clearParts();
    this.build(params);
  }
  private clearParts() {
    for (const p of this.parts) this.disposeTree(p.root);
    this.content.clear();
    this.parts = [];
    this.mats.dispose();
  }
  private disposeTree(root: THREE.Object3D) {
    root.traverse((m) => {
      const g = (m as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g && !SHARED_GEOS.has(g)) g.dispose();
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
  }
  dispose() {
    this.clearParts();
    this.disposeTree(this.stage);
    this.stageMats.dispose();
  }

  // ── 时间相关 ────────────────────────────────────────────
  get duration() { return this.world.D; }
  stepAt(t: number) { return this.world.stepIndex(t); }
  /** 规格里 t 时刻的机位：步骤可以切换机位，切换时平滑过渡 1.2 秒 */
  private specDir(t: number): THREE.Vector3 {
    const spec = this.spec, base = camDir(spec.camera, spec).normalize();
    if (!spec.steps.length) return base;
    const ats = this.world.stepTimes();
    let prev = base, cur = base, at = 0;
    for (let i = 0; i < spec.steps.length; i++) {
      if (t + 1e-6 < ats[i]) break;
      const c = spec.steps[i].camera as CameraName | undefined;
      if (c && c !== undefined) { prev = cur; cur = camDir(c, spec).normalize(); at = ats[i]; }
    }
    if (prev === cur) return cur;
    return prev.clone().lerp(cur, smooth((t - at) / 1.2)).normalize();
  }

  /** 摆相机：方向 + 自动取景（按包围盒在屏幕上的投影收紧） */
  private placeCamera(dir: THREE.Vector3, view: ViewOffset, aspect: number, t: number, drift: boolean) {
    const cam = this.camera;
    let d = dir.clone();
    // 静态题也给一点缓慢的环绕，立体感更强；跟时间轴绑定，暂停时画面静止
    const az = view.az + (drift ? 6 * Math.sin((2 * Math.PI * t) / Math.max(8, this.world.D)) : 0);
    if (az) d.applyAxisAngle(new THREE.Vector3(0, 1, 0), az * D2R);
    if (view.el) {
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const el = Math.asin(Math.max(-1, Math.min(1, d.y / d.length())));
      const target = Math.max(-80 * D2R, Math.min(88 * D2R, el + view.el * D2R));
      d = d.applyAxisAngle(right, -(target - el));
    }
    d.normalize();
    const up = Math.abs(d.y) > 0.985 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    cam.aspect = aspect;
    cam.up.copy(up);
    const vt = Math.tan((cam.fov / 2) * D2R), ht = vt * aspect;
    // 相机基
    const fwd = d.clone(), right = new THREE.Vector3().crossVectors(up, fwd).normalize(), upv = new THREE.Vector3().crossVectors(fwd, right);
    const pts: THREE.Vector3[] = [];
    const mn = this.box.min, mx = this.box.max;
    if (this.fit.length >= 2) for (const p of this.fit) pts.push(p.clone().sub(this.center));
    else for (const x of [mn.x, mx.x]) for (const y of [mn.y, mx.y]) for (const z of [mn.z, mx.z]) pts.push(new THREE.Vector3(x, y, z).sub(this.center));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const x = p.dot(right), y = p.dot(upv); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const target = this.center.clone().addScaledVector(right, (x0 + x1) / 2).addScaledVector(upv, (y0 + y1) / 2);
    let dist = 0;
    for (const p0 of pts) {
      const p = p0.clone().add(this.center).sub(target);
      const x = Math.abs(p.dot(right)), y = Math.abs(p.dot(upv)), z = p.dot(fwd);
      dist = Math.max(dist, z + x / ht, z + y / vt);
    }
    dist = Math.max(dist * 1.13, this.radius * 0.6) * view.zoom;
    cam.position.copy(target).addScaledVector(fwd, dist);
    cam.near = Math.max(0.01, dist / 200); cam.far = dist * 40 + this.radius * 40;
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }

  // ── 图表数据（按参数缓存整条曲线） ─────────────────────────
  private chartData(t: number): ChartData[] {
    const w = this.world, D = w.D;
    return this.spec.charts.slice(0, 2).map((chart, i) => {
      const sig = this.paramsSig + '|' + i;
      let cache = this.chartCache[i];
      if (chart.type === 'line' && (!cache || cache.sig !== sig)) {
        const N = 160, xs: number[] = [], ys: number[][] = chart.series.map(() => []);
        const fns = chart.series.map((s) => w.compileExpr(s.y));
        for (let k = 0; k <= N; k++) { const tt = (k / N) * D; xs.push(tt); const sc = w.scope(tt); fns.forEach((f, j) => ys[j].push(f ? f(sc) : NaN)); }
        cache = this.chartCache[i] = { sig, xs, ys };
      }
      const sc = w.scope(t);
      const now = chart.series.map((s) => { const f = w.compileExpr(s.y); return f ? f(sc) : NaN; });
      const bars = chart.bars.map((b) => { const f = w.compileExpr(b.value); return f ? f(sc) : NaN; });
      return { chart, xs: cache?.xs ?? [], ys: cache?.ys ?? [], now, bars, D };
    });
  }

  // ── 画一帧 ─────────────────────────────────────────────
  /** 画到 2D 画布（W×H 为画布像素）。返回 false 表示 WebGL 不可用。 */
  draw(g: CanvasRenderingContext2D, W: number, H: number, t: number, o: DrawOpts = {}): boolean {
    const r = glRenderer();
    if (!r) { drawMessage(g, W, H, '这台电脑的显卡暂时不能显示立体画面'); return false; }
    if (this.scene.environment === null) this.scene.environment = envMap();
    const s = Math.max(0.42, Math.min(W / 1600, H / 900));
    const hud = { caption: true, charts: true, title: true, ...(o.hud ?? {}) };
    const k = this.stepAt(t);
    const say = k >= 0 ? this.spec.steps[k].say : '';
    const charts = hud.charts ? this.chartData(t) : [];
    const chartR = chartRects(charts.length, W, H, s);
    const capR: Rect | null = hud.caption && say ? captionRect(say, g, W, H, s) : null;
    if (capR && o.reserveBottom) capR.y -= o.reserveBottom;
    // 画面中给 3D 内容留的区域（避开图表和字幕）
    const leftFrac = charts.length ? (chartR[0].x - 10 * s) / W : 1;
    const topPad = hud.title && this.spec.title ? 50 * s : 0;
    const bottomPad = capR ? H - capR.y + 6 * s : (o.reserveBottom ?? 0);
    const regW = W * leftFrac, regH = Math.max(H * 0.5, H - bottomPad - topPad);
    const dir = o.camera ? camDir(o.camera, this.spec).normalize() : this.specDir(t);
    this.placeCamera(dir, o.view ?? NO_OFFSET, regW / regH, t, !o.camera && this.spec.mode === 'static' && !(o.view && (o.view.az || o.view.el)));
    // 相机先摆好再更新对象：立体图形的虚实棱要按这一帧的视线判断
    for (const p of this.parts) p.update(t, this.camera);
    // 用 view offset 把投影中心挪到可用区域的中心
    const cxOff = W / 2 - regW / 2, cyOff = H / 2 - (topPad + regH / 2);
    this.camera.aspect = W / H;
    const vt = Math.tan((this.camera.fov / 2) * D2R);
    // 让可用区域的高度对应原先计算的视场
    const fovFull = 2 * Math.atan(vt * (H / regH)) / D2R;
    this.camera.fov = fovFull;
    this.camera.setViewOffset(W, H, cxOff, cyOff, W, H);
    this.camera.updateProjectionMatrix();
    const ok = renderTo(this.scene, this.camera, g, W, H);
    this.camera.fov = 32;
    this.camera.clearViewOffset();
    if (!ok) { drawMessage(g, W, H, '立体画面暂时不可用'); return false; }
    // 标签
    this.camera.fov = fovFull; this.camera.setViewOffset(W, H, cxOff, cyOff, W, H); this.camera.updateProjectionMatrix();
    const labels = this.screenLabels(t, W, H);
    this.camera.fov = 32; this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
    const blocked: Rect[] = [...chartR.slice(0, charts.length)];
    if (capR) blocked.push(capR);
    drawLabels(g, labels, W, H, s, blocked);
    charts.forEach((d, i) => drawChart(g, d, chartR[i], t, s));
    if (hud.title) drawTitle(g, this.spec.title, s);
    if (capR) {
      const at = this.world.stepTimes()[k] ?? 0;
      drawCaption(g, say, k, this.spec.steps.length, capR, s, 0.35 + 0.65 * smooth((t - at) / 0.4 + (t <= 1e-3 ? 1 : 0)));
    }
    if (o.tag) drawTag(g, o.tag, 14 * s, (hud.title && this.spec.title ? 52 : 14) * s, s);
    return true;
  }

  private screenLabels(t: number, W: number, H: number): ScreenLabel[] {
    const out: ScreenLabel[] = [];
    const cam = this.camera;
    cam.updateMatrixWorld();
    const v = new THREE.Vector3(), q = new THREE.Vector3();
    const toScreen = (p: V3): [number, number] | null => {
      v.set(p[0], p[1], p[2]).project(cam);
      if (v.z > 1 || v.z < -1) return null;
      return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
    };
    const viewDir = cam.getWorldDirection(new THREE.Vector3());
    for (const part of this.parts) for (const l of part.labels) {
      let ok = false;
      try { ok = l.visible(t); } catch { ok = false; }
      if (!ok) continue;
      if (l.axis && Math.abs(viewDir.x * l.axis[0] + viewDir.y * l.axis[1] + viewDir.z * l.axis[2]) / Math.hypot(...l.axis) > 0.92) continue;
      const at = l.at(t);
      if (!at || !at.every(Number.isFinite)) continue;
      const sp = toScreen(at);
      if (!sp) continue;
      let dx: number | null = null, dy: number | null = null;
      const d = l.dir?.(t);
      if (d && d.some((x) => x !== 0)) {
        const k = this.u * 0.6;
        q.set(at[0] + d[0] * k, at[1] + d[1] * k, at[2] + d[2] * k).project(cam);
        const ex = ((q.x + 1) / 2) * W - sp[0], ey = ((1 - q.y) / 2) * H - sp[1], L = Math.hypot(ex, ey);
        if (L > 1e-3) { dx = ex / L; dy = ey / L; } else { dx = 0; dy = -1; }
      }
      let text = '';
      try { text = l.text(t); } catch { text = ''; }
      if (!text) continue;
      out.push({ key: l.key, text, x: sp[0], y: sp[1], dx, dy, color: l.color ?? '#e2e8f0', size: l.size ?? 'm', kind: l.kind, prio: l.prio });
    }
    return out;
  }
}

/** 规格里各步骤 / 时刻的默认截图点（给模型自检用） */
export function defaultShots(spec: S3DSpec, world: World): { t: number; camera: CameraName | null; tag: string }[] {
  const D = spec.duration;
  const camName = (c: CameraName | null) => (c ? CAMERA_LABEL[c] : '默认机位');
  const shots: { t: number; camera: CameraName | null; tag: string }[] = [];
  if (spec.mode === 'static') {
    const ats = world.stepTimes();
    const n = spec.steps.length;
    const end = D * 0.98;
    if (n >= 2) {
      shots.push({ t: Math.min(D, ats[0] + 0.8), camera: null, tag: `第1步 · ${camName(null)}` });
      shots.push({ t: end, camera: null, tag: `最后一步 · ${camName(null)}` });
    } else shots.push({ t: end, camera: null, tag: `t=${end.toFixed(1)}s · ${camName(null)}` });
    const alt: CameraName[] = spec.up === 'z' ? ['front', 'top'] : ['front', 'iso'];
    for (const c of alt) if (shots.length < 4 && c !== spec.camera) shots.push({ t: end, camera: c, tag: `全貌 · ${camName(c)}` });
    if (shots.length < 4) shots.push({ t: end, camera: 'side', tag: `全貌 · ${camName('side')}` });
  } else {
    for (const k of [0, 0.33, 0.66, 0.98]) shots.push({ t: k * D, camera: null, tag: `t=${(k * D).toFixed(1)}s` });
  }
  return shots.slice(0, 4);
}

/** 离屏渲染一张 2×2 联系表（JPEG data URL），给模型核对画面 */
export function contactSheet(spec: S3DSpec, params: Record<string, number> = {}, o: { w?: number; h?: number; shots?: { t: number; camera: CameraName | null; tag: string }[] } = {}): string | null {
  if (!glRenderer()) return null;
  const cw = o.w ?? 800, ch = o.h ?? 450;
  const sc = new S3DScene(spec, params);
  try {
    const shots = (o.shots ?? defaultShots(spec, sc.world)).slice(0, 4);
    const cols = shots.length > 1 ? 2 : 1, rows = Math.ceil(shots.length / cols);
    const out = document.createElement('canvas');
    out.width = cw * cols; out.height = ch * rows;
    const g = out.getContext('2d')!;
    const cell = document.createElement('canvas'); cell.width = cw; cell.height = ch;
    const cg = cell.getContext('2d')!;
    shots.forEach((s, i) => {
      sc.draw(cg, cw, ch, s.t, { camera: s.camera, tag: s.tag });
      g.drawImage(cell, (i % cols) * cw, Math.floor(i / cols) * ch);
    });
    g.strokeStyle = '#facc15'; g.lineWidth = 2;
    for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, out.height); g.stroke(); }
    for (let i = 1; i < rows; i++) { g.beginPath(); g.moveTo(0, i * ch); g.lineTo(out.width, i * ch); g.stroke(); }
    return out.toDataURL('image/jpeg', 0.82);
  } finally { sc.dispose(); }
}
/** 单帧截图（data URL） */
export function still(spec: S3DSpec, t: number, o: { w?: number; h?: number; camera?: CameraName | null; params?: Record<string, number> } = {}): string | null {
  if (!glRenderer()) return null;
  const w = o.w ?? 1600, h = o.h ?? 900;
  const sc = new S3DScene(spec, o.params ?? {});
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    sc.draw(c.getContext('2d')!, w, h, t, { camera: o.camera ?? null });
    return c.toDataURL('image/png');
  } finally { sc.dispose(); }
}
