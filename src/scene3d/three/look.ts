// 质感：PBR 材质库、程序生成的贴图（地面纹理、阴影线、网格、地球、光晕、背景渐变）。
import * as THREE from 'three';
import { CONTINENTS } from '../data';

export class Mats {
  private cache = new Map<string, THREE.Material>();
  private owned: (THREE.Material | THREE.Texture)[] = [];
  get<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) { m = make(); this.cache.set(key, m); this.owned.push(m); }
    return m;
  }
  /** 光滑的塑料 / 漆面（物块、小球的默认质感） */
  body(color: string, kind = 'plastic', emissive = 0): THREE.MeshPhysicalMaterial {
    return this.get(`body|${color}|${kind}|${emissive}`, () => {
      const c = new THREE.Color(color);
      const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.22, envMapIntensity: 1 });
      if (kind === 'metal') { m.metalness = 0.85; m.roughness = 0.26; m.clearcoat = 0.2; }
      if (kind === 'wood') { m.roughness = 0.62; m.clearcoat = 0.15; m.map = woodTex(color); this.owned.push(m.map); m.color = new THREE.Color('#ffffff'); }
      if (kind === 'glass') { m.transmission = 0.85; m.thickness = 0.6; m.roughness = 0.08; m.ior = 1.45; m.transparent = true; m.opacity = 0.95; }
      if (kind === 'rubber') { m.roughness = 0.9; m.clearcoat = 0; }
      if (emissive) { m.emissive = c.clone(); m.emissiveIntensity = emissive; }
      return m;
    });
  }
  metal(color = '#c9d2de', rough = 0.28) { return this.get(`metal|${color}|${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: rough })); }
  matte(color: string, rough = 0.75) { return this.get(`matte|${color}|${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 })); }
  /** 箭头 / 线条：自发光一点，在暗背景上醒目 */
  glow(color: string, k = 0.45) { return this.get(`glow|${color}|${k}`, () => new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: k, roughness: 0.4, metalness: 0.1 })); }
  /** 不被遮挡的发光材质（力、速度箭头） */
  overlay(color: string, k = 0.55) {
    return this.get(`overlay|${color}|${k}`, () => new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: k, roughness: 0.4, metalness: 0.1, depthTest: false, depthWrite: false, transparent: true }));
  }
  flat(color: string, opacity = 1) { return this.get(`flat|${color}|${opacity}`, () => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false })); }
  glass(color: string, opacity = 0.18) {
    return this.get(`glass|${color}|${opacity}`, () => new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.15, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }));
  }
  own<T extends THREE.Material | THREE.Texture>(x: T): T { this.owned.push(x); return x; }
  dispose() { for (const m of this.owned) m.dispose(); this.owned = []; this.cache.clear(); }
}

const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** 木纹 */
export function woodTex(color: string) {
  return canvasTex(256, 256, (g) => {
    const c = new THREE.Color(color);
    g.fillStyle = '#' + c.getHexString(); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 46; i++) {
      const y = Math.random() * 256, a = 0.05 + Math.random() * 0.1;
      g.strokeStyle = `rgba(60,30,10,${a})`; g.lineWidth = 1 + Math.random() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i) * 3);
      g.stroke();
    }
  });
}

/** 地面 / 斜面的表面：粗糙时带细颗粒，光滑时只有微弱的渐变 */
export function surfaceTex(rough: boolean, base = '#5b6b82') {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    if (rough) {
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.04 + Math.random() * 0.06})` : `rgba(0,0,0,${0.06 + Math.random() * 0.08})`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
    } else {
      const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, 'rgba(255,255,255,.06)'); gr.addColorStop(1, 'rgba(0,0,0,.06)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 物理课本里的「阴影线」（地面、墙、天花板的截面） */
export function hatchTex(base = '#3d4a5f', line = 'rgba(190,210,235,.55)') {
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line; g.lineWidth = 5;
    for (let k = -128; k < 256; k += 26) { g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 传送带表面：带方向箭头的条纹，偏移量随时间移动 */
export function beltTex() {
  const t = canvasTex(256, 64, (g) => {
    g.fillStyle = '#20252e'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let x = 0; x < 256; x += 8) g.fillRect(x, 0, 3, 64);
    g.strokeStyle = 'rgba(255,190,90,.55)'; g.lineWidth = 6; g.lineCap = 'round';
    for (const x of [64, 192]) { g.beginPath(); g.moveTo(x - 14, 14); g.lineTo(x + 8, 32); g.lineTo(x - 14, 50); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 摄影棚地板：细网格 + 径向淡出 */
export function floorTex() {
  const t = canvasTex(1024, 1024, (g) => {
    const W = 1024;
    g.clearRect(0, 0, W, W);
    const cell = W / 40;
    for (let i = 0; i <= 40; i++) {
      const major = i % 5 === 0;
      g.strokeStyle = major ? 'rgba(150,175,215,.20)' : 'rgba(150,175,215,.08)';
      g.lineWidth = major ? 2 : 1;
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, W); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(W, i * cell); g.stroke();
    }
    g.globalCompositeOperation = 'destination-in';
    const rg = g.createRadialGradient(W / 2, W / 2, W * 0.08, W / 2, W / 2, W / 2);
    rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, W);
  });
  return t;
}

/** 背景：自上而下的深色渐变，中间略亮（投屏时不刺眼） */
export function backdropTex(kind: 'floor' | 'space' | 'plain') {
  return canvasTex(64, 512, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    if (kind === 'space') { gr.addColorStop(0, '#05070e'); gr.addColorStop(0.55, '#0a1020'); gr.addColorStop(1, '#04060b'); }
    else if (kind === 'plain') { gr.addColorStop(0, '#1c2436'); gr.addColorStop(0.6, '#121827'); gr.addColorStop(1, '#0a0e17'); }
    else { gr.addColorStop(0, '#1e2638'); gr.addColorStop(0.55, '#141b2a'); gr.addColorStop(1, '#0b0f18'); }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 512);
  });
}

/** 柔和的光晕（太阳、发光点） */
export function glowTex(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,170,60,0)') {
  return canvasTex(256, 256, (g) => {
    const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, inner); rg.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '.55)')); rg.addColorStop(1, outer);
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  });
}

/** 示意性的地球贴图：海洋渐变 + 简化大陆 + 冰盖（等距圆柱投影） */
export function earthTex() {
  return canvasTex(2048, 1024, (g) => {
    const W = 2048, H = 1024;
    const sea = g.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#173f74'); sea.addColorStop(0.5, '#1f63b8'); sea.addColorStop(1, '#173f74');
    g.fillStyle = sea; g.fillRect(0, 0, W, H);
    const X = (lon: number) => ((lon + 180) / 360) * W, Y = (lat: number) => ((90 - lat) / 180) * H;
    for (const poly of CONTINENTS) {
      g.beginPath();
      for (let i = 0; i < poly.length; i += 2) { const x = X(poly[i]), y = Y(poly[i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath();
      const land = g.createLinearGradient(0, 0, 0, H);
      land.addColorStop(0, '#e8eef5'); land.addColorStop(0.12, '#7a9a6a'); land.addColorStop(0.3, '#4f8f4a'); land.addColorStop(0.42, '#b9a26a');
      land.addColorStop(0.5, '#3f8a45'); land.addColorStop(0.58, '#b9a26a'); land.addColorStop(0.72, '#5d9a52'); land.addColorStop(0.9, '#e8eef5');
      g.fillStyle = land; g.fill();
      g.strokeStyle = 'rgba(20,40,30,.35)'; g.lineWidth = 2; g.stroke();
    }
    g.fillStyle = 'rgba(240,246,252,.85)'; g.fillRect(0, 0, W, H * 0.035); g.fillRect(0, H * 0.965, W, H * 0.035);
  });
}

/** 星空 */
export function stars(n = 1600, R = 400) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([R * s * Math.cos(a), R * u, R * s * Math.sin(a)], i * 3);
    const b = 0.5 + Math.random() * 0.5, warm = Math.random();
    col.set([b * (warm > 0.8 ? 1 : 0.85), b * 0.9, b * (warm < 0.2 ? 0.8 : 1)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
}

/** 大气层的菲涅耳光晕 */
export function atmosphere(r: number, color = '#6fb6ff') {
  const mat = new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.6); gl_FragColor = vec4(c, f*0.9); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 48, 32), mat);
}
