// 每个窗口只用一个 WebGL 上下文：所有立体演示实例（预览、节目监视器、试播截图）轮流用它渲染，
// 再把画面拷到各自的 2D 画布上。这样教师端同时开几个演示也不会耗尽 WebGL 上下文。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer: THREE.WebGLRenderer | null = null;
let envTex: THREE.Texture | null = null;
let lost = false;
const lostListeners = new Set<() => void>();

export function glRenderer(): THREE.WebGLRenderer | null {
  if (renderer && !lost) return renderer;
  if (renderer && lost) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(1);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; envTex = null; lostListeners.forEach((f) => f()); });
    renderer = r;
    return r;
  } catch { return null; }
}
export const onContextRestored = (f: () => void) => { lostListeners.add(f); return () => lostListeners.delete(f); };

/** 摄影棚式的环境光照（PBR 反射用），整个窗口共用一份 */
export function envMap(): THREE.Texture | null {
  const r = glRenderer();
  if (!r) return null;
  if (!envTex) {
    const pm = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    envTex = pm.fromScene(room, 0.04).texture;
    pm.dispose();
  }
  return envTex;
}

/** 把共享渲染器的尺寸扩到至少 w×h（只增不减，避免每帧重新分配） */
export function ensureSize(r: THREE.WebGLRenderer, w: number, h: number) {
  const c = r.domElement;
  if (c.width < w || c.height < h) r.setSize(Math.max(c.width, w), Math.max(c.height, h), false);
}

/** 渲染到共享画布左下角的 w×h 区域，然后拷到目标 2D 画布 */
export function renderTo(scene: THREE.Scene, camera: THREE.Camera, target: CanvasRenderingContext2D, w: number, h: number): boolean {
  const r = glRenderer();
  if (!r) return false;
  ensureSize(r, w, h);
  r.setViewport(0, 0, w, h);
  r.setScissor(0, 0, w, h);
  r.setScissorTest(true);
  r.render(scene, camera);
  r.setScissorTest(false);
  const src = r.domElement;
  target.drawImage(src, 0, src.height - h, w, h, 0, 0, w, h);
  return true;
}
