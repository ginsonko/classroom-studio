// 舞台：把片子规格变成可以按时间渲染的画面。
// 每个镜头一个 three.js 场景（需要时才渲染）+ 2D 叠加层；输出是一张 1920×1080 的 2D 画布，实时预览和导出 MP4 都画它。
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clamp, ease, hash, life, lerp3, smooth, span, type FilmSpec, type ShotSpec, type V3 } from './core';
import { H, make2, paintBackdrop, paintGrade, W, type Part2 } from './draw2d';
import { make3, type Part3 } from './three3d';

interface Shot { spec: ShotSpec; start: number; dur: number; scene: THREE.Scene | null; p3: Part3[]; p2: Part2[]; bloom: number }
const CUT_IN = 0.55;

export class Film {
  readonly canvas: HTMLCanvasElement;
  readonly duration: number;
  readonly shots: Shot[];
  private g: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private pass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private camera = new THREE.PerspectiveCamera(42, W / H, 0.05, 1000);
  private envTex: THREE.Texture | null = null;
  private buf: HTMLCanvasElement;
  private bg: HTMLCanvasElement;
  private bgTex: THREE.CanvasTexture | null = null;
  readonly fps = 30;
  /** 载入时发现的部件问题（参数错、公式排不出来）；有问题的部件不画，其余照常 */
  readonly problems: string[] = [];

  constructor(readonly spec: FilmSpec, o: { canvas?: HTMLCanvasElement } = {}) {
    this.canvas = o.canvas ?? document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.buf = Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.bg = Object.assign(document.createElement('canvas'), { width: W, height: H });
    let t = 0;
    this.shots = spec.shots.map((s) => {
      const dur = Math.max(0.5, s.dur);
      const shot: Shot = { spec: s, start: t, dur, scene: null, p3: [], p2: [], bloom: Math.max(0, Math.min(2, Number(s.bloom ?? (s.bg === 'paper' ? 0 : 1)) || 0)) };
      for (const it of s.items) {
        const at = Math.max(0, Number(it.at) || 0), d = Math.max(0.2, Math.min(dur - at, Number(it.dur) || dur - at));
        // 一个部件参数不对只丢掉这个部件，片子照常能放；问题记下来交给 AI 修
        try {
          const p3 = make3(it, at, d);
          if (p3) { shot.p3.push(p3); continue; }
          const p2 = make2(it, at, d);
          if (p2) shot.p2.push(p2);
          else this.problems.push(`「${s.name ?? '镜头'}」里没有叫 ${String(it.type)} 的部件`);
        } catch (e) { this.problems.push(`「${s.name ?? '镜头'}」的 ${String(it.type)} 部件出错：${(e as Error).message}`); }
      }
      shot.p2.sort((a, b) => a.z - b.z);
      t += dur;
      return shot;
    });
    this.duration = t;
  }

  /** 预先准备：公式排版、WebGL、每个镜头的场景 */
  async load() {
    await Promise.all(this.shots.flatMap((s) => s.p2.map((p) => p.prepare?.().catch((e: Error) => {
      this.problems.push(`「${s.spec.name ?? '镜头'}」的公式排版失败：${e.message}`);
      s.p2 = s.p2.filter((x) => x !== p);
    }))));
    if (!this.shots.some((s) => s.p3.length)) return;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.setSize(W, H, false);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    const pm = new THREE.PMREMGenerator(r); this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.pass = new RenderPass(new THREE.Scene(), this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.85, 0.55, 0.72);
    // 一个 NaN / 无穷大像素会被泛光的模糊链扩散成大片黑块，所以泛光之前先把它们清掉
    const clean = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = clamp(c, 0.0, 48.0); }',
    });
    this.composer.addPass(this.pass); this.composer.addPass(clean); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    this.bgTex = new THREE.CanvasTexture(this.bg); this.bgTex.colorSpace = THREE.SRGBColorSpace;
    for (const s of this.shots) {
      if (!s.p3.length) continue;
      const scene = new THREE.Scene();
      scene.environment = this.envTex;
      if (s.spec.light === 'sun') {
        scene.environmentIntensity = 0.08;
        scene.add(new THREE.HemisphereLight('#4060a0', '#000000', 0.12));
        const sun = new THREE.DirectionalLight('#fff3e0', 3.4); sun.position.set(12, 2.5, 3); scene.add(sun);
      } else {
        scene.environmentIntensity = 0.55;
        scene.add(new THREE.HemisphereLight('#bcd4ff', '#1a1020', 0.6));
        const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(6, 8, 10); scene.add(key);
        const rim = new THREE.DirectionalLight(s.spec.tint ?? '#7aa2ff', 1.6); rim.position.set(-8, 3, -6); scene.add(rim);
      }
      for (const p of s.p3) scene.add(p.obj);
      s.scene = scene;
    }
  }

  shotAt(t: number): Shot { let s = this.shots[0]; for (const x of this.shots) if (t >= x.start) s = x; return s; }

  private placeCamera(s: Shot, st: number) {
    const c = s.spec.camera ?? { from: [0, 0, 14] as V3 };
    const k = ease(c.ease ?? 'inOut', clamp(st / s.dur));
    const look = lerp3(c.look ?? [0, 0, 0], c.lookTo ?? c.look ?? [0, 0, 0], k);
    let p = lerp3(c.from, c.to ?? c.from, k);
    if (c.orbit) {
      const a = ((c.orbit * Math.PI) / 180) * k, dx = p[0] - look[0], dz = p[2] - look[2];
      p = [look[0] + dx * Math.cos(a) - dz * Math.sin(a), p[1], look[2] + dx * Math.sin(a) + dz * Math.cos(a)];
    }
    this.camera.fov = c.fov ?? 42; this.camera.updateProjectionMatrix();
    this.camera.position.set(...p); this.camera.lookAt(...look);
    this.camera.updateMatrixWorld();
  }

  private project = (p: V3): [number, number] | null => {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  };

  /** 画出 t 秒的画面 */
  render(t: number) {
    t = clamp(t, 0, this.duration - 1e-6);
    const s = this.shotAt(t), st = t - s.start, frame = Math.round(t * this.fps), tint = s.spec.tint ?? '#7aa2ff';
    const bgKind = s.spec.bg ?? (s.p3.length ? 'space' : 'deep');
    const b = this.buf.getContext('2d', { alpha: false })!;
    // 1. 背景（2D）→ 2. 3D（背景当作场景底图，再加泛光）→ 3. 2D 叠加层
    const bgc = this.bg.getContext('2d', { alpha: false })!;
    paintBackdrop(bgc, bgKind, tint, st);
    if (s.scene && this.renderer && this.composer && this.pass && this.bloom && this.bgTex) {
      this.placeCamera(s, st);
      for (const p of s.p3) { const L = life(st, p.at, p.dur, 0.9, 0.6); p.obj.visible = L.a > 0.001 || (st >= p.at && st <= p.at + p.dur); p.update(L, { st, sdur: s.dur, camera: this.camera, frame }); }
      this.bgTex.needsUpdate = true; s.scene.background = this.bgTex;
      this.pass.scene = s.scene; this.bloom.strength = 0.85 * s.bloom; this.bloom.enabled = s.bloom > 0;
      this.composer.render();
      b.drawImage(this.renderer.domElement, 0, 0, W, H);
    } else b.drawImage(this.bg, 0, 0);
    const env = { g: b, st, sdur: s.dur, tint, project: this.project, frame };
    for (const p of s.p2) {
      if (st < p.at - 0.01 || st > p.at + p.dur + 0.01) continue;
      b.save();
      try { p.draw(env, life(st, p.at, p.dur)); } catch (e) { const m = `「${s.spec.name ?? '镜头'}」有个部件画不出来：${(e as Error).message}`; if (!this.problems.includes(m)) this.problems.push(m); }
      b.restore();
    }
    paintGrade(b, frame, bgKind === 'paper');
    // 4. 转场：进入时的效果 + 下一个镜头是「淡入淡出」时先压暗
    const g = this.g;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none';
    const cut = s.spec.cut ?? 'fade', ck = st < CUT_IN && s !== this.shots[0] ? st / CUT_IN : 1;
    if (cut === 'zoom' && ck < 1) {
      const z = 1 + 0.18 * (1 - ease('outExpo', ck));
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.filter = `blur(${(1 - ck) * 10}px)`;
      g.drawImage(this.buf, W / 2 - (W * z) / 2, H / 2 - (H * z) / 2, W * z, H * z); g.filter = 'none';
    } else if (cut === 'glitch' && ck < 1) {
      g.drawImage(this.buf, 0, 0);
      const amt = (1 - ck) * 40;
      for (let i = 0; i < 14; i++) { const y = Math.floor(hash(frame * 31 + i) * H), h = 10 + hash(frame * 17 + i) * 70, dx = (hash(frame * 7 + i) - 0.5) * amt * 3; g.drawImage(this.buf, 0, y, W, h, dx, y, W, h); }
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 * (1 - ck);
      g.drawImage(this.buf, amt * 0.5, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    } else if (cut === 'wipe' && ck < 1) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const x = (W + 600) * ease('inOut', ck) - 300;
      g.save(); g.beginPath(); g.moveTo(0, 0); g.lineTo(x + 300, 0); g.lineTo(x - 300, H); g.lineTo(0, H); g.closePath(); g.clip(); g.drawImage(this.buf, 0, 0); g.restore();
      const gr = g.createLinearGradient(x - 120, 0, x + 120, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.8 * (1 - ck)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x + 180, 0); g.lineTo(x + 420, 0); g.lineTo(x - 180, H); g.lineTo(x - 420, H); g.fill();
    } else g.drawImage(this.buf, 0, 0);
    if (ck < 1 && cut === 'flash') { g.fillStyle = `rgba(255,255,255,${(1 - ck) ** 2})`; g.fillRect(0, 0, W, H); }
    if (ck < 1 && cut === 'fade') { g.fillStyle = `rgba(0,0,0,${1 - smooth(ck)})`; g.fillRect(0, 0, W, H); }
    const next = this.shots[this.shots.indexOf(s) + 1], left = s.dur - st;
    if (next && (next.spec.cut ?? 'fade') === 'fade' && left < 0.35) { g.fillStyle = `rgba(0,0,0,${smooth(1 - left / 0.35)})`; g.fillRect(0, 0, W, H); }
    if (!next && left < 0.8) { g.fillStyle = `rgba(0,0,0,${smooth(1 - left / 0.8)})`; g.fillRect(0, 0, W, H); }
    if (s === this.shots[0] && st < 0.6) { g.fillStyle = `rgba(0,0,0,${1 - smooth(st / 0.6)})`; g.fillRect(0, 0, W, H); }
    g.restore();
    void span;
  }

  /** 实时播放；返回停止函数 */
  play(from = 0, onTime?: (t: number) => void): () => void {
    let stop = false; const t0 = performance.now() - from * 1000;
    const tick = () => {
      if (stop) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= this.duration) { this.render(this.duration - 0.001); onTime?.(this.duration); return; }
      this.render(t); onTime?.(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { stop = true; };
  }

  dispose() {
    for (const s of this.shots) s.scene?.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      // 贴图（光点、地球）是各部件共用的缓存，不在这里释放
      for (const mm of mats) mm.dispose();
    });
    this.composer?.dispose(); this.envTex?.dispose(); this.bgTex?.dispose();
    this.renderer?.dispose(); this.renderer?.forceContextLoss();
  }
}
