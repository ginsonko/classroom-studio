// 2D 部件：画在 1920×1080 的叠加层上（文字、公式、函数图像、电场线、几何证明、时间轴、古诗、英文动效、标注……）。
// 每个部件只看「当前时间」画一帧，不保存状态。
import { clamp, ease, FONT, hash, lerp, life, num, rgba, rng, smooth, span, str, SUBJECT_COLOR, type ItemSpec, type Life, type V3 } from './core';
import type { TexShape } from '../ink/tex';
import { compile } from '../scene3d/expr';

export const W = 1920, H = 1080;
export interface Env2 {
  g: CanvasRenderingContext2D;
  /** 镜头内时间、镜头长度 */
  st: number; sdur: number;
  tint: string;
  /** 3D 点 → 屏幕像素（没有 3D 时返回 null） */
  project: (p: V3) => [number, number] | null;
  frame: number;
}
export interface Part2 { at: number; dur: number; z: number; prepare?: () => Promise<void>; draw: (e: Env2, L: Life) => void }
type Make2 = (s: ItemSpec, at: number, dur: number) => Part2;

const fontOf = (k: unknown) => FONT[(str(k, 'sans') as keyof typeof FONT)] ?? FONT.sans;
function glowText(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, glow: number) {
  if (glow > 0) { g.shadowColor = color; g.shadowBlur = glow; g.fillText(text, x, y); g.shadowBlur = glow * 0.4; }
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}

// ═══ 背景 ═══
const noiseCanvas = (() => {
  let c: HTMLCanvasElement | null = null;
  return () => {
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!, img = g.createImageData(256, 256), r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  };
})();

export function paintBackdrop(g: CanvasRenderingContext2D, kind: string, tint: string, st: number) {
  g.save();
  if (kind === 'paper') {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#f3ead8'); gr.addColorStop(1, '#e6d8bd');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.07; g.globalCompositeOperation = 'multiply';
    const p = g.createPattern(noiseCanvas(), 'repeat')!; g.fillStyle = p; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, 'rgba(120,90,50,0)'); v.addColorStop(1, 'rgba(120,90,50,0.35)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  } else if (kind === 'blueprint') {
    g.fillStyle = '#06101f'; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, W * 0.6);
    glow.addColorStop(0, rgba(tint, 0.16)); glow.addColorStop(1, rgba(tint, 0));
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const off = (st * 12) % 60;
    g.lineWidth = 1;
    for (let x = -60 + off; x < W + 60; x += 60) { g.strokeStyle = rgba(tint, Math.round((x - off) / 60) % 5 === 0 ? 0.13 : 0.05); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = -60 + off; y < H + 60; y += 60) { g.strokeStyle = rgba(tint, Math.round((y - off) / 60) % 5 === 0 ? 0.13 : 0.05); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  } else if (kind === 'aurora') {
    g.fillStyle = '#04060e'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const cx = W * (0.2 + 0.2 * i) + Math.sin(st * 0.3 + i) * 120, cy = H * (0.35 + 0.1 * Math.cos(st * 0.25 + i * 2));
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 700);
      const c = ['#2b6cff', '#7a3cff', '#00c2a8', tint][i];
      gr.addColorStop(0, rgba(c, 0.22)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
  } else if (kind === 'deep') {
    const gr = g.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, W * 0.75);
    gr.addColorStop(0, '#101a33'); gr.addColorStop(0.6, '#070b18'); gr.addColorStop(1, '#020309');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const t2 = g.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, 800);
    t2.addColorStop(0, rgba(tint, 0.14)); t2.addColorStop(1, rgba(tint, 0));
    g.fillStyle = t2; g.fillRect(0, 0, W, H);
  } else {
    g.fillStyle = kind === 'space' ? '#02030a' : '#000'; g.fillRect(0, 0, W, H);
  }
  g.restore();
}

/** 收尾的统一调色：暗角 + 胶片颗粒 */
export function paintGrade(g: CanvasRenderingContext2D, frame: number, light: boolean) {
  g.save();
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, light ? 'rgba(40,25,10,0.28)' : 'rgba(0,0,0,0.55)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.globalAlpha = light ? 0.05 : 0.035; g.globalCompositeOperation = 'overlay';
  const p = g.createPattern(noiseCanvas(), 'repeat')!;
  p.setTransform(new DOMMatrix().translate((frame * 73) % 256, (frame * 151) % 256));
  g.fillStyle = p; g.fillRect(0, 0, W, H);
  g.restore();
}

// ═══ 文字 ═══
const title: Make2 = (s, at, dur) => {
  const text = str(s.text), sub = str(s.sub), size = num(s.size, 128), color = str(s.color, '#ffffff'), accent = str(s.accent, '#7aa2ff');
  const y = num(s.y, H * 0.46), x = num(s.x, W / 2);
  return {
    at, dur, z: 5, draw: ({ g, st }, L) => {
      g.save(); g.globalAlpha = 1 - smooth(L.o);
      g.font = `900 ${size}px ${FONT.sans}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      (g as unknown as { letterSpacing: string }).letterSpacing = `${size * 0.06}px`;
      const chars = [...text], widths = chars.map((c) => g.measureText(c).width + size * 0.06), total = widths.reduce((a, b) => a + b, 0);
      let cx = x - total / 2;
      chars.forEach((c, i) => {
        const k = span(L.t, 0.15 + i * 0.07, 0.75 + i * 0.07), e = ease('outExpo', k);
        g.globalAlpha = (1 - smooth(L.o)) * smooth(k);
        g.fillStyle = color;
        g.save(); g.translate(cx + widths[i] / 2, y + (1 - e) * size * 0.45); g.scale(1, 0.6 + 0.4 * e);
        g.filter = k < 1 ? `blur(${(1 - e) * 14}px)` : 'none';
        glowText(g, c, -widths[i] / 2, 0, accent, 40 * e);
        g.restore();
        cx += widths[i];
      });
      // 一道光扫过文字
      const sweep = span(L.t, 1.1 + chars.length * 0.07, 2.2 + chars.length * 0.07);
      if (sweep > 0 && sweep < 1) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const sx = x - total / 2 - 200 + (total + 400) * ease('inOut', sweep);
        const gr = g.createLinearGradient(sx - 120, 0, sx + 120, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        // 用渐变再写一遍字，光只落在笔画上（画矩形会在字外留下一块灰条）
        g.globalAlpha = 1 - smooth(L.o); g.fillStyle = gr; g.filter = 'none';
        let px = x - total / 2;
        chars.forEach((c, i) => { g.fillText(c, px, y); px += widths[i]; });
        g.restore();
      }
      // 下划线从中间展开
      const u = ease('outExpo', span(L.t, 0.6, 1.6));
      g.globalAlpha = 1 - smooth(L.o);
      const lg = g.createLinearGradient(x - total / 2, 0, x + total / 2, 0);
      lg.addColorStop(0, rgba(accent, 0)); lg.addColorStop(0.5, rgba(accent, 1)); lg.addColorStop(1, rgba(accent, 0));
      g.fillStyle = lg; g.shadowColor = accent; g.shadowBlur = 20;
      g.fillRect(x - total / 2 * u, y + size * 0.62, total * u, 3);
      g.shadowBlur = 0;
      if (sub) {
        const k2 = span(L.t, 1.0, 2.0);
        g.globalAlpha = smooth(k2) * (1 - smooth(L.o));
        g.font = `500 ${size * 0.26}px ${FONT.sans}`; g.textAlign = 'center';
        (g as unknown as { letterSpacing: string }).letterSpacing = `${lerp(size * 0.3, size * 0.12, ease('outExpo', k2))}px`;
        g.fillStyle = rgba('#dfe7ff', 0.85);
        g.fillText(sub, x, y + size * 0.95);
      }
      void st;
      g.restore();
    },
  };
};

const text: Make2 = (s, at, dur) => {
  const lines = str(s.text).split('\n'), size = num(s.size, 48), color = str(s.color, '#ffffff'), weight = num(s.weight, 600);
  const x = num(s.x, W / 2), y = num(s.y, H / 2), align = str(s.align, 'center') as CanvasTextAlign, anim = str(s.anim, 'rise');
  const font = fontOf(s.font), glow = num(s.glow, 0), lh = num(s.lineHeight, 1.35), track = num(s.tracking, 0);
  return {
    at, dur, z: num(s.z, 6), draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save();
      g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = color;
      (g as unknown as { letterSpacing: string }).letterSpacing = `${track}px`;
      const out = 1 - smooth(L.o);
      lines.forEach((line, i) => {
        const k = span(L.t, i * 0.18, i * 0.18 + 0.7), e = ease('outExpo', k), ly = y + (i - (lines.length - 1) / 2) * size * lh;
        g.globalAlpha = smooth(k) * out;
        if (anim === 'type') {
          const n = Math.floor(clamp((L.t - i * 0.5) / Math.max(0.3, line.length * 0.06)) * [...line].length);
          glowText(g, [...line].slice(0, n).join(''), x, ly, color, glow); g.globalAlpha = out;
          return;
        }
        if (anim === 'blur') g.filter = `blur(${(1 - e) * 16}px)`;
        const dy = anim === 'rise' ? (1 - e) * size * 0.6 : 0, sc = anim === 'pop' ? 0.6 + 0.4 * ease('outBack', k) : 1;
        g.save(); g.translate(x, ly + dy); g.scale(sc, sc);
        glowText(g, line, 0, 0, color, glow);
        g.restore(); g.filter = 'none';
      });
      g.restore();
    },
  };
};

/** 左上角学科徽标：● 物理 | 开普勒第二定律        03 / 09 */
const badge: Make2 = (s, at, dur) => {
  const subj = str(s.subject), name = str(s.title), idx = str(s.index), color = str(s.color, SUBJECT_COLOR[subj] ?? '#7aa2ff');
  const ink = s.dark ? '#2a1d10' : '#ffffff', ink2 = s.dark ? 'rgba(42,29,16,0.8)' : 'rgba(232,238,255,0.9)';
  return {
    at, dur, z: 9, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      const e = ease('outExpo', L.k), out = 1 - smooth(L.o);
      g.save(); g.globalAlpha = out;
      const x = 96 - (1 - e) * 60, y = 92;
      g.fillStyle = rgba(color, 0.9 * e); g.shadowColor = color; g.shadowBlur = 18;
      g.beginPath(); g.arc(x + 8, y, 8, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      g.font = `800 34px ${FONT.sans}`; g.textBaseline = 'middle'; g.fillStyle = ink; g.globalAlpha = out * smooth(L.k);
      g.fillText(subj, x + 30, y);
      const w = g.measureText(subj).width;
      g.fillStyle = rgba(ink, 0.35); g.fillRect(x + 48 + w, y - 16, 2, 32);
      g.font = `500 30px ${FONT.sans}`; g.fillStyle = ink2;
      const k2 = span(L.t, 0.25, 0.9);
      g.globalAlpha = out * smooth(k2);
      g.fillText(name, x + 66 + w + (1 - ease('outExpo', k2)) * 30, y);
      if (idx) {
        g.textAlign = 'right'; g.font = `500 26px ${FONT.mono}`; g.fillStyle = rgba(ink, 0.55); g.globalAlpha = out * smooth(L.k);
        g.fillText(idx, W - 96, y);
      }
      // 细线
      g.globalAlpha = out * 0.5;
      const lg = g.createLinearGradient(x, 0, x + 520, 0); lg.addColorStop(0, rgba(color, 0.9)); lg.addColorStop(1, rgba(color, 0));
      g.fillStyle = lg; g.fillRect(x, y + 34, 520 * e, 1.5);
      g.restore();
    },
  };
};

/** 底部字幕 */
const caption: Make2 = (s, at, dur) => {
  const t = str(s.text), size = num(s.size, 38), light = !!s.light;
  return {
    at, dur, z: 10, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = L.a;
      g.font = `500 ${size}px ${FONT.sans}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(t).width, y = H - 112 + (1 - ease('outExpo', L.k)) * 20;
      g.fillStyle = light ? 'rgba(255,250,240,0.55)' : 'rgba(0,0,0,0.42)';
      g.beginPath(); g.roundRect(W / 2 - w / 2 - 34, y - size * 0.85, w + 68, size * 1.7, size * 0.85); g.fill();
      g.fillStyle = light ? '#2a1d10' : '#ffffff';
      g.fillText(t, W / 2, y + 1);
      g.restore();
    },
  };
};

// ═══ 公式：MathJax 轮廓，先描边「写出来」再填充 ═══
let texMod: Promise<typeof import('../ink/tex')> | null = null;
function pathLength(d: string) {
  try { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); return p.getTotalLength() || 600; } catch { return 600; }
}
const formula: Make2 = (s, at, dur) => {
  const tex = str(s.tex), size = num(s.size, 84), color = str(s.color, '#ffffff'), x = num(s.x, W / 2), y = num(s.y, H / 2), glow = num(s.glow, 18);
  const writeDur = num(s.write, 1.6), align = str(s.align, 'center');
  let shape: TexShape | null = null; let paths: { p: Path2D; len: number; m: DOMMatrix; rect?: boolean }[] = [];
  return {
    at, dur, z: 7,
    prepare: async () => {
      texMod ??= import('../ink/tex');
      shape = (await texMod).compileTex(tex);
      paths = shape.ops.map((op) => {
        const m = new DOMMatrix(op.m as unknown as number[]);
        if (op.k === 'p') return { p: new Path2D(op.d), len: pathLength(op.d), m };
        if (op.k === 'r') { const p = new Path2D(); p.rect(op.x, op.y, op.w, op.h); return { p, len: 2 * (op.w + op.h), m, rect: true }; }
        return { p: new Path2D(), len: 0, m };
      });
    },
    draw: ({ g }, L) => {
      if (!shape || L.a <= 0) return;
      const k = 1000 / size, sc = 1 / k, w = shape.w * sc, h = shape.h * sc;
      const ox = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
      g.save(); g.globalAlpha = 1 - smooth(L.o);
      g.translate(ox, y - h / 2); g.scale(sc, sc);
      const n = paths.length;
      paths.forEach((pp, i) => {
        const a = (i / Math.max(1, n)) * writeDur * 0.6, wk = span(L.t, a, a + writeDur * 0.45), fk = span(L.t, a + writeDur * 0.3, a + writeDur * 0.55);
        if (wk <= 0) return;
        g.save(); g.transform(pp.m.a, pp.m.b, pp.m.c, pp.m.d, pp.m.e, pp.m.f);
        const scale = Math.hypot(pp.m.a, pp.m.b) || 1;
        if (fk < 1) {
          g.strokeStyle = color; g.lineWidth = 22 / scale; g.lineJoin = 'round'; g.lineCap = 'round';
          g.setLineDash([pp.len, pp.len]); g.lineDashOffset = pp.len * (1 - ease('inOut', wk));
          g.globalAlpha = (1 - smooth(L.o)) * (1 - fk * 0.6);
          g.shadowColor = color; g.shadowBlur = glow * 1.5;
          g.stroke(pp.p);
        }
        if (fk > 0) { g.setLineDash([]); g.globalAlpha = (1 - smooth(L.o)) * smooth(fk); g.fillStyle = color; g.shadowColor = color; g.shadowBlur = glow; g.fill(pp.p); g.shadowBlur = 0; g.fill(pp.p); }
        g.restore();
      });
      g.restore();
    },
  };
};

// ═══ 函数图像 ═══
const plot: Make2 = (s, at, dur) => {
  const x0 = num(s.x, W / 2), y0 = num(s.y, H / 2), w = num(s.w, 900), h = num(s.h, 520);
  const xr = (Array.isArray(s.xr) ? s.xr : [-5, 5]) as number[], yr = (Array.isArray(s.yr) ? s.yr : [-3, 3]) as number[];
  const fns = (Array.isArray(s.fns) ? s.fns : []).map((f: { expr?: string; color?: string; label?: string; to?: string }) => ({
    fn: compile(str(f.expr, 'sin(x)'), { names: new Set(['x', 't']) }).fn, to: f.to ? compile(f.to, { names: new Set(['x', 't']) }).fn : null,
    color: str(f.color, '#4cc9ff'), label: str(f.label),
  }));
  const morphAt = num(s.morphAt, 99), dot = !!s.dot;
  const sx = (x: number) => x0 - w / 2 + ((x - xr[0]) / (xr[1] - xr[0])) * w, sy = (y: number) => y0 + h / 2 - ((y - yr[0]) / (yr[1] - yr[0])) * h;
  return {
    at, dur, z: 6, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = L.a;
      // 坐标轴
      const ak = ease('outExpo', span(L.t, 0, 0.8));
      g.strokeStyle = 'rgba(220,230,255,0.75)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(sx(xr[0]), sy(0)); g.lineTo(lerp(sx(xr[0]), sx(xr[1]), ak), sy(0)); g.stroke();
      g.beginPath(); g.moveTo(sx(0), sy(yr[0])); g.lineTo(sx(0), lerp(sy(yr[0]), sy(yr[1]), ak)); g.stroke();
      g.fillStyle = 'rgba(220,230,255,0.75)';
      for (const [px, py, r] of [[sx(xr[1]), sy(0), 0], [sx(0), sy(yr[1]), -Math.PI / 2]] as const) { g.save(); g.globalAlpha *= ak; g.translate(px, py); g.rotate(r); g.beginPath(); g.moveTo(8, 0); g.lineTo(-10, -7); g.lineTo(-10, 7); g.fill(); g.restore(); }
      g.font = `500 22px ${FONT.mono}`; g.fillStyle = 'rgba(220,230,255,0.45)'; g.textAlign = 'center';
      for (let i = Math.ceil(xr[0]); i <= Math.floor(xr[1]); i++) if (i) { g.globalAlpha = L.a * smooth(span(L.t, 0.3 + Math.abs(i) * 0.05, 0.8 + Math.abs(i) * 0.05)); g.fillRect(sx(i) - 1, sy(0) - 6, 2, 12); g.fillText(String(i), sx(i), sy(0) + 30); }
      g.globalAlpha = L.a;
      const mk = ease('inOut', span(L.t, morphAt, morphAt + 1.6));
      fns.forEach((f, fi) => {
        const dk = ease('inOut', span(L.t, 0.6 + fi * 0.5, 2.2 + fi * 0.5));
        if (dk <= 0) return;
        const val = (x: number) => { const a = f.fn({ v: { x, t: L.t } }); return f.to ? lerp(a, f.to({ v: { x, t: L.t } }), mk) : a; };
        const xe = lerp(xr[0], xr[1], dk);
        g.beginPath();
        let first = true;
        for (let i = 0; i <= 400; i++) {
          const x = lerp(xr[0], xe, i / 400), y = val(x);
          if (!Number.isFinite(y) || y < yr[0] - 2 || y > yr[1] + 2) { first = true; continue; }
          if (first) g.moveTo(sx(x), sy(y)); else g.lineTo(sx(x), sy(y));
          first = false;
        }
        g.strokeStyle = f.color; g.lineWidth = 5; g.lineJoin = 'round'; g.shadowColor = f.color; g.shadowBlur = 24; g.stroke(); g.shadowBlur = 0; g.lineWidth = 2.5; g.strokeStyle = '#ffffff'; g.globalAlpha = L.a * 0.6; g.stroke(); g.globalAlpha = L.a;
        if (f.label && dk > 0.9) { g.font = `700 32px ${FONT.latin}`; g.fillStyle = f.color; g.textAlign = 'left'; g.globalAlpha = L.a * span(dk, 0.9, 1); g.fillText(f.label, sx(xe) + 14, sy(val(xe)) - 18); g.globalAlpha = L.a; }
        if (dot && fi === 0 && dk >= 1) {
          const dx = lerp(xr[0] + 0.3, xr[1] - 0.3, (Math.sin((L.t - 2.2) * 0.9 - Math.PI / 2) + 1) / 2), dy = val(dx), d2 = (val(dx + 1e-3) - val(dx - 1e-3)) / 2e-3;
          const ux = 1 / Math.hypot(1, d2), uy = d2 / Math.hypot(1, d2), len = 2.2;
          g.strokeStyle = '#ffd166'; g.lineWidth = 3; g.globalAlpha = L.a * 0.9;
          g.beginPath(); g.moveTo(sx(dx - ux * len), sy(dy - uy * len)); g.lineTo(sx(dx + ux * len), sy(dy + uy * len)); g.stroke();
          g.fillStyle = '#fff'; g.shadowColor = '#ffd166'; g.shadowBlur = 30; g.beginPath(); g.arc(sx(dx), sy(dy), 10, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        }
      });
      g.restore();
    },
  };
};

// ═══ 点电荷的电场线（加载时积分好，播放时只是描线 + 流动） ═══
const field: Make2 = (s, at, dur) => {
  const cx = num(s.x, W / 2), cy = num(s.y, H / 2), per = num(s.lines, 18), bw = num(s.w, 1500), bh = num(s.h, 860);
  const charges = (Array.isArray(s.charges) ? s.charges : [{ x: -260, y: 0, q: 1 }, { x: 260, y: 0, q: -1 }]) as { x: number; y: number; q: number }[];
  const lines: { pts: [number, number][]; len: number }[] = [];
  const E = (x: number, y: number) => { let ex = 0, ey = 0; for (const c of charges) { const dx = x - c.x, dy = y - c.y, r2 = dx * dx + dy * dy + 1e-6, r3 = r2 * Math.sqrt(r2); ex += (c.q * dx) / r3; ey += (c.q * dy) / r3; } return [ex, ey]; };
  const src = charges.some((c) => c.q > 0) ? charges.filter((c) => c.q > 0) : charges;
  for (const c of src) {
    const dir = c.q > 0 ? 1 : -1;
    for (let i = 0; i < per; i++) {
      const a = (i / per) * Math.PI * 2 + 0.001;
      let x = c.x + Math.cos(a) * 26, y = c.y + Math.sin(a) * 26;
      const pts: [number, number][] = [[x, y]]; let len = 0;
      for (let n = 0; n < 900; n++) {
        const [ex, ey] = E(x, y), m = Math.hypot(ex, ey) || 1;
        const nx = x + (dir * ex / m) * 5, ny = y + (dir * ey / m) * 5;
        len += 5; x = nx; y = ny; pts.push([x, y]);
        if (Math.abs(x) > bw / 2 || Math.abs(y) > bh / 2) break;
        if (charges.some((o) => o !== c && Math.hypot(x - o.x, y - o.y) < 22)) break;
      }
      lines.push({ pts, len });
    }
  }
  return {
    at, dur, z: 4, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = L.a; g.translate(cx, cy);
      const dk = ease('inOut', span(L.t, 0.4, 2.4));
      lines.forEach((ln, i) => {
        const path = new Path2D(); ln.pts.forEach(([x, y], j) => (j ? path.lineTo(x, y) : path.moveTo(x, y)));
        g.lineWidth = 2.2; g.strokeStyle = 'rgba(120,200,255,0.55)'; g.lineCap = 'round';
        g.setLineDash([ln.len, ln.len]); g.lineDashOffset = ln.len * (1 - clamp(dk * 1.15 - (i % per) * 0.008));
        g.stroke(path);
        if (dk >= 1) {
          g.setLineDash([10, 34]); g.lineDashOffset = -L.t * 90 - i * 7;
          g.strokeStyle = 'rgba(200,240,255,0.95)'; g.lineWidth = 3.2; g.shadowColor = '#4cc9ff'; g.shadowBlur = 14;
          g.stroke(path); g.shadowBlur = 0;
        }
      });
      g.setLineDash([]);
      for (const c of charges) {
        const pulse = 1 + Math.sin(L.t * 3) * 0.05, col = c.q > 0 ? '#ff5d5d' : '#4c8dff';
        const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, 120 * pulse); gr.addColorStop(0, rgba(col, 0.55)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, 120 * pulse, 0, Math.PI * 2); g.fill();
        g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 30; g.beginPath(); g.arc(c.x, c.y, 30 * ease('outBack', span(L.t, 0, 0.6)), 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        g.fillStyle = '#fff'; g.font = `800 40px ${FONT.latin}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(c.q > 0 ? '+' : '−', c.x, c.y + 2);
      }
      // 一个试探电荷顺着电场线走
      if (s.probe !== false && lines.length) {
        const ln = lines[Math.floor(per * 0.08)] ?? lines[0], pk = span(L.t, 2.4, dur - 0.5);
        if (pk > 0) {
          const idx = Math.min(ln.pts.length - 2, Math.floor(ease('inOut', pk) * (ln.pts.length - 2)));
          const [px, py] = ln.pts[idx], [qx, qy] = ln.pts[idx + 1], ang = Math.atan2(qy - py, qx - px);
          g.fillStyle = '#ffd166'; g.shadowColor = '#ffd166'; g.shadowBlur = 26; g.beginPath(); g.arc(px, py, 11, 0, Math.PI * 2); g.fill();
          g.save(); g.translate(px, py); g.rotate(ang); g.strokeStyle = '#ffd166'; g.lineWidth = 4; g.beginPath(); g.moveTo(16, 0); g.lineTo(78, 0); g.stroke();
          g.beginPath(); g.moveTo(92, 0); g.lineTo(74, -10); g.lineTo(74, 10); g.fill(); g.restore(); g.shadowBlur = 0;
          g.font = `italic 700 34px ${FONT.latin}`; g.fillStyle = '#ffd166'; g.fillText('F', px + Math.cos(ang) * 70 - Math.sin(ang) * 26, py + Math.sin(ang) * 70 + Math.cos(ang) * 26);
        }
      }
      g.restore();
    },
  };
};

// ═══ 勾股定理拼图证明：(a+b)² 的大正方形里，四个直角三角形从「围出 c²」挪到「留出 a² 和 b²」 ═══
const pythagoras: Make2 = (s, at, dur) => {
  const a = num(s.a, 3), b = num(s.b, 4), S = num(s.size, 560), cx = num(s.x, W / 2), cy = num(s.y, H / 2);
  const u = S / (a + b), sA = a + b;
  // 每个三角形：直角顶点 R、a 边方向角 θ（b 边在 θ+90°）
  const A = [{ R: [0, 0], th: 0 }, { R: [sA, 0], th: 90 }, { R: [sA, sA], th: 180 }, { R: [0, sA], th: -90 }];
  const B = [{ R: [a, a], th: -90 }, { R: [sA, 0], th: 90 }, { R: [a, sA], th: 180 }, { R: [0, a], th: 0 }];
  const col = ['#4cc9ff', '#4cc9ff', '#4cc9ff', '#4cc9ff'];
  return {
    at, dur, z: 6, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = L.a; g.translate(cx - S / 2, cy - S / 2);
      const ok = ease('outExpo', span(L.t, 0, 0.9));
      g.strokeStyle = 'rgba(230,236,255,0.8)'; g.lineWidth = 3; g.setLineDash([S * 4 * ok, S * 4]); g.strokeRect(0, 0, S, S); g.setLineDash([]);
      const tri = (R: number[], th: number, k: number, i: number) => {
        const r = (th * Math.PI) / 180;
        g.save(); g.translate(R[0] * u, R[1] * u); g.rotate(r); g.scale(k, k);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(a * u, 0); g.lineTo(0, b * u); g.closePath();
        g.fillStyle = rgba(col[i], 0.28); g.fill(); g.strokeStyle = col[i]; g.lineWidth = 3; g.shadowColor = col[i]; g.shadowBlur = 16; g.stroke(); g.shadowBlur = 0;
        g.restore();
      };
      const move = (i: number) => ease('inOut', span(L.t, 4.6 + i * 0.35, 6.0 + i * 0.35));
      // 中间区域上色：c²（阶段一）→ a²、b²（阶段二）
      const c2 = smooth(span(L.t, 2.2, 2.9)) * (1 - smooth(span(L.t, 4.4, 4.8)));
      if (c2 > 0) {
        g.beginPath(); g.moveTo(a * u, 0); g.lineTo(sA * u, a * u); g.lineTo(b * u, sA * u); g.lineTo(0, b * u); g.closePath();
        g.fillStyle = rgba('#b28dff', 0.35 * c2); g.fill(); g.strokeStyle = rgba('#d4bdff', c2); g.lineWidth = 3; g.stroke();
        g.font = `italic 800 ${S * 0.12}px ${FONT.latin}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = rgba('#ffffff', c2);
        g.shadowColor = '#b28dff'; g.shadowBlur = 24; g.fillText('c²', S / 2, S / 2); g.shadowBlur = 0;
      }
      const ab = smooth(span(L.t, 7.0, 7.7));
      if (ab > 0) {
        g.fillStyle = rgba('#ff8a3d', 0.35 * ab); g.fillRect(0, 0, a * u, a * u); g.strokeStyle = rgba('#ffb27a', ab); g.lineWidth = 3; g.strokeRect(0, 0, a * u, a * u);
        g.fillStyle = rgba('#3ddc97', 0.35 * ab); g.fillRect(a * u, a * u, b * u, b * u); g.strokeStyle = rgba('#7ef0bd', ab); g.strokeRect(a * u, a * u, b * u, b * u);
        g.font = `italic 800 ${S * 0.1}px ${FONT.latin}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = rgba('#ffffff', ab);
        g.shadowColor = '#ff8a3d'; g.shadowBlur = 20; g.fillText('a²', (a * u) / 2, (a * u) / 2);
        g.shadowColor = '#3ddc97'; g.fillText('b²', a * u + (b * u) / 2, a * u + (b * u) / 2); g.shadowBlur = 0;
      }
      for (let i = 0; i < 4; i++) {
        const k = ease('outBack', span(L.t, 0.9 + i * 0.25, 1.6 + i * 0.25));
        if (k <= 0) continue;
        const m = move(i);
        let dth = B[i].th - A[i].th; if (dth > 180) dth -= 360; if (dth < -180) dth += 360;
        tri([lerp(A[i].R[0], B[i].R[0], m), lerp(A[i].R[1], B[i].R[1], m)], A[i].th + dth * m, k, i);
      }
      // 边长标注
      const lk = smooth(span(L.t, 1.8, 2.4)) * (1 - smooth(span(L.t, 4.4, 4.7)));
      if (lk > 0) {
        g.font = `italic 700 ${S * 0.06}px ${FONT.latin}`; g.fillStyle = rgba('#cfe9ff', lk); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('a', (a * u) / 2, -26); g.fillText('b', a * u + (b * u) / 2, -26); g.fillText('c', (a * u) / 2 + 10, (b * u) / 2 - 10);
      }
      g.restore();
    },
  };
};

// ═══ 历史时间轴：镜头沿着轴平移，经过的节点亮起、年份滚动 ═══
const timeline: Make2 = (s, at, dur) => {
  const items = (Array.isArray(s.items) ? s.items : []) as { year: number; name: string; note?: string }[];
  const gap = num(s.gap, 520), y = num(s.y, H * 0.56), color = str(s.color, '#e8b04a');
  const fmtYear = (v: number) => (v < 0 ? `公元前 ${Math.round(-v)}` : `${Math.round(v)}`) + ' 年';
  return {
    at, dur, z: 6, draw: ({ g }, L) => {
      if (L.a <= 0 || !items.length) return;
      g.save(); g.globalAlpha = L.a;
      const travel = ease('inOut', span(L.t, 0.6, dur - 1.0)) * (items.length - 1);
      const offset = W / 2 - travel * gap;
      // 主轴
      const lg = g.createLinearGradient(0, 0, W, 0); lg.addColorStop(0, rgba(color, 0)); lg.addColorStop(0.15, rgba(color, 0.7)); lg.addColorStop(0.85, rgba(color, 0.7)); lg.addColorStop(1, rgba(color, 0));
      g.fillStyle = lg; g.fillRect(0, y - 1.5, W, 3);
      // 光点粒子沿轴流动
      for (let i = 0; i < 60; i++) {
        const px = ((hash(i) * W + L.t * (60 + hash(i + 9) * 120)) % (W + 100)) - 50, py = y + (hash(i + 3) - 0.5) * 30;
        g.fillStyle = rgba(color, 0.25 + hash(i + 5) * 0.4); g.beginPath(); g.arc(px, py, 1.2 + hash(i + 7) * 2, 0, Math.PI * 2); g.fill();
      }
      items.forEach((it, i) => {
        const x = offset + i * gap;
        if (x < -300 || x > W + 300) return;
        const near = 1 - clamp(Math.abs(travel - i) / 0.8), passed = travel >= i - 0.15 ? 1 : 0.35, up = i % 2 === 0;
        const r = 10 + near * 8;
        g.fillStyle = rgba(color, passed); g.shadowColor = color; g.shadowBlur = 20 + near * 40;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        g.strokeStyle = rgba(color, 0.5 * near); g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 14 + Math.sin(L.t * 4) * 3, 0, Math.PI * 2); g.stroke();
        const ty = up ? y - 120 : y + 130;
        g.strokeStyle = rgba(color, 0.35 + 0.4 * near); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y + (up ? -r : r)); g.lineTo(x, up ? y - 70 : y + 70); g.stroke();
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `900 ${84 + near * 26}px ${FONT.kai}`; g.fillStyle = rgba('#fff4dc', 0.45 + 0.55 * near);
        g.shadowColor = color; g.shadowBlur = 30 * near; g.fillText(it.name, x, ty); g.shadowBlur = 0;
        const shown = near > 0 ? lerp(items[Math.max(0, i - 1)].year, it.year, smooth(clamp(1 - Math.abs(travel - i) / 0.8 + 0.2))) : it.year;
        g.font = `600 30px ${FONT.mono}`; g.fillStyle = rgba(color, 0.6 + 0.4 * near);
        g.fillText(fmtYear(i > 0 && travel < i ? shown : it.year), x, up ? ty - 78 : ty + 72);
        if (it.note) { g.font = `500 28px ${FONT.sans}`; g.fillStyle = rgba('#e9dcc4', 0.75 * near); g.fillText(it.note, x, up ? ty + 76 : ty - 76); }
      });
      g.restore();
    },
  };
};

// ═══ 古诗：竖排、从右往左，墨迹晕开后显字，最后盖印 ═══
const poem: Make2 = (s, at, dur) => {
  const lines = (Array.isArray(s.lines) ? s.lines : []) as string[], size = num(s.size, 96), x0 = num(s.x, W * 0.62), y0 = num(s.y, H * 0.2);
  const ttl = str(s.title), author = str(s.author), seal = str(s.seal, '教辅'), per = num(s.per, 0.22);
  const colGap = size * 1.45;
  return {
    at, dur, z: 6, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = L.a; g.textAlign = 'center'; g.textBaseline = 'middle';
      let idx = 0;
      if (ttl) {
        const k = span(L.t, 0.1, 0.9);
        g.font = `700 ${size * 0.6}px ${FONT.kai}`; g.fillStyle = rgba('#2a1d10', smooth(k));
        [...ttl].forEach((c, i) => g.fillText(c, x0 + colGap * 1.05, y0 + i * size * 0.7));
        g.font = `500 ${size * 0.36}px ${FONT.kai}`; g.fillStyle = rgba('#6b5132', smooth(span(L.t, 0.5, 1.3)));
        [...author].forEach((c, i) => g.fillText(c, x0 + colGap * 1.05, y0 + ttl.length * size * 0.7 + size * 0.4 + i * size * 0.45));
      }
      lines.forEach((line, li) => {
        const x = x0 - li * colGap;
        [...line].forEach((c, ci) => {
          const t0 = 0.8 + idx++ * per, k = span(L.t, t0, t0 + 0.7), y = y0 + ci * size * 1.12;
          if (k <= 0) return;
          // 墨晕
          const blot = span(L.t, t0, t0 + 0.45);
          if (blot < 1) {
            const r = size * (0.2 + 0.7 * ease('out', blot));
            const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(20,14,8,${0.5 * (1 - blot)})`); gr.addColorStop(1, 'rgba(20,14,8,0)');
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          }
          g.font = `400 ${size}px ${FONT.kai}`;
          g.filter = k < 1 ? `blur(${(1 - ease('out', k)) * 10}px)` : 'none';
          g.fillStyle = `rgba(24,16,8,${smooth(k)})`;
          g.fillText(c, x, y);
          g.filter = 'none';
        });
      });
      // 印章
      const sk = span(L.t, 0.8 + idx * per + 0.4, 0.8 + idx * per + 0.75);
      if (sk > 0) {
        const sc = lerp(1.8, 1, ease('outBack', sk)), sx = x0 - (lines.length - 1) * colGap - colGap * 0.95, sy = y0 + (lines[lines.length - 1]?.length ?? 5) * size * 1.12 - size * 0.2;
        g.save(); g.translate(sx, sy); g.scale(sc, sc); g.rotate(-0.04); g.globalAlpha = L.a * smooth(sk) * 0.92;
        g.fillStyle = '#b3261e'; g.beginPath(); g.roundRect(-size * 0.48, -size * 0.48, size * 0.96, size * 0.96, 8); g.fill();
        g.fillStyle = '#f6e7cf'; g.font = `700 ${size * 0.36}px ${FONT.kai}`;
        const sc2 = [...seal];
        if (sc2.length === 2) { g.fillText(sc2[0], 0, -size * 0.18); g.fillText(sc2[1], 0, size * 0.2); } else g.fillText(seal, 0, 0);
        g.restore();
      }
      g.restore();
    },
  };
};

/** 水墨远山：几层山影 + 一轮红日，缓慢平移 */
const mountains: Make2 = (s, at, dur) => {
  const sun = s.sun !== false, base0 = num(s.base, 0.55), sx0 = num(s.sunX, W * 0.22), sy0 = num(s.sunY, H * 0.3);
  return {
    at, dur, z: 1, draw: ({ g }, L) => {
      g.save(); g.globalAlpha = smooth(span(L.t, 0, 1.2)) * (1 - smooth(L.o));
      if (sun) {
        const sx = sx0, sy = sy0 + (1 - ease('out', span(L.t, 0, 4))) * 60;
        const gr = g.createRadialGradient(sx, sy, 0, sx, sy, 170); gr.addColorStop(0, 'rgba(214,72,48,0.95)'); gr.addColorStop(0.55, 'rgba(214,72,48,0.85)'); gr.addColorStop(0.6, 'rgba(214,72,48,0.15)'); gr.addColorStop(1, 'rgba(214,72,48,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, 170, 0, Math.PI * 2); g.fill();
      }
      for (let layer = 0; layer < 4; layer++) {
        const base = H * (base0 + layer * (1 - base0) * 0.24), amp = 150 - layer * 22, shift = L.t * (6 + layer * 10);
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) {
          const X = x + shift + layer * 400;
          const y = base - amp * (0.55 * Math.sin(X * 0.0021 + layer) + 0.3 * Math.sin(X * 0.0057 + layer * 2.1) + 0.15 * Math.sin(X * 0.013 + layer * 4.3)) - (layer === 0 ? 40 : 0);
          g.lineTo(x, y);
        }
        g.lineTo(W, H); g.closePath();
        const shade = [0.18, 0.3, 0.45, 0.62][layer];
        const gr = g.createLinearGradient(0, base - amp, 0, H); gr.addColorStop(0, `rgba(30,26,22,${shade})`); gr.addColorStop(1, `rgba(30,26,22,${shade * 0.15})`);
        g.fillStyle = gr; g.fill();
      }
      g.restore();
    },
  };
};

/** 英文动效：字母从四面飞入组成句子，下面跟一行释义 */
const kinetic: Make2 = (s, at, dur) => {
  const txt = str(s.text), size = num(s.size, 120), y = num(s.y, H * 0.45), color = str(s.color, '#ffffff'), accent = str(s.accent, '#ff7ab6');
  const sub = str(s.sub), hi = str(s.highlight);
  const r = rng(91);
  const seeds = [...txt].map(() => ({ dx: (r() - 0.5) * 1400, dy: (r() - 0.5) * 900, rot: (r() - 0.5) * 4, d: r() * 0.5 }));
  return {
    at, dur, z: 6, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = 1 - smooth(L.o);
      g.font = `800 ${size}px ${FONT.latin}`; g.textBaseline = 'middle';
      const chars = [...txt], ws = chars.map((c) => g.measureText(c).width), total = ws.reduce((a, b) => a + b, 0);
      const hiStart = hi ? txt.indexOf(hi) : -1;
      let x = W / 2 - total / 2;
      chars.forEach((c, i) => {
        const sd = seeds[i], k = ease('outExpo', span(L.t, sd.d + i * 0.03, sd.d + i * 0.03 + 1.1));
        const isHi = hiStart >= 0 && i >= hiStart && i < hiStart + hi.length, glowK = isHi ? smooth(span(L.t, 2.0, 2.6)) : 0;
        g.save(); g.translate(x + ws[i] / 2 + sd.dx * (1 - k), y + sd.dy * (1 - k)); g.rotate(sd.rot * (1 - k));
        g.globalAlpha = (1 - smooth(L.o)) * smooth(k);
        g.fillStyle = isHi ? `rgb(${Math.round(lerp(255, 255, glowK))},${Math.round(lerp(255, 122, glowK))},${Math.round(lerp(255, 182, glowK))})` : color;
        g.textAlign = 'center';
        glowText(g, c, 0, 0, isHi ? accent : '#9ab8ff', isHi ? 40 * glowK : 10);
        g.restore();
        x += ws[i];
      });
      if (sub) {
        const k = span(L.t, 2.4, 3.2);
        g.globalAlpha = smooth(k) * (1 - smooth(L.o)); g.textAlign = 'center';
        g.font = `500 ${size * 0.32}px ${FONT.sans}`; g.fillStyle = rgba('#f4d9ff', 0.9);
        (g as unknown as { letterSpacing: string }).letterSpacing = `${lerp(24, 6, ease('outExpo', k))}px`;
        g.fillText(sub, W / 2, y + size * 0.95);
      }
      g.restore();
    },
  };
};

/** 跟着 3D 物体走的标注：一条折线 + 文字 */
const label: Make2 = (s, at, dur) => {
  const t = str(s.text), anchor = (Array.isArray(s.anchor) ? s.anchor : null) as V3 | null, dx = num(s.dx, 140), dy = num(s.dy, -90), color = str(s.color, '#ffffff');
  const px = num(s.x, NaN), py = num(s.y, NaN), size = num(s.size, 34), sub = str(s.sub);
  return {
    at, dur, z: 8, draw: ({ g, project }, L) => {
      if (L.a <= 0) return;
      const p = anchor ? project(anchor) : Number.isFinite(px) ? ([px, py] as [number, number]) : null;
      if (!p) return;
      g.save(); g.globalAlpha = L.a;
      const k = ease('outExpo', L.k), ex = p[0] + dx * k, ey = p[1] + dy * k, right = dx >= 0;
      g.strokeStyle = rgba(color, 0.8); g.lineWidth = 2;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(ex, ey); g.lineTo(ex + (right ? 1 : -1) * 40 * k, ey); g.stroke();
      g.fillStyle = color; g.beginPath(); g.arc(p[0], p[1], 6, 0, Math.PI * 2); g.fill();
      g.font = `700 ${size}px ${FONT.sans}`; g.textAlign = right ? 'left' : 'right'; g.textBaseline = 'middle';
      glowText(g, t, ex + (right ? 52 : -52), ey, color, 14);
      if (sub) { g.font = `400 ${size * 0.62}px ${FONT.sans}`; g.fillStyle = rgba('#dfe7ff', 0.75); g.fillText(sub, ex + (right ? 52 : -52), ey + size * 0.95); }
      g.restore();
    },
  };
};

/** 科技感取景框：四角括号 + 扫描线 + 小字 */
const hud: Make2 = (s, at, dur) => {
  const color = str(s.color, '#7aa2ff'), tag = str(s.tag);
  return {
    at, dur, z: 9, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.globalAlpha = L.a * 0.8; g.strokeStyle = rgba(color, 0.7); g.lineWidth = 2;
      const m = 60 + (1 - ease('outExpo', L.k)) * 40, len = 56;
      for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [W - m, H - m, -1, -1], [m, H - m, 1, -1]] as const) {
        g.beginPath(); g.moveTo(x, y + sy * len); g.lineTo(x, y); g.lineTo(x + sx * len, y); g.stroke();
      }
      const sy = (L.t * 160) % (H + 200) - 100;
      const gr = g.createLinearGradient(0, sy - 60, 0, sy + 4); gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, rgba(color, 0.07));
      g.fillStyle = gr; g.fillRect(0, sy - 60, W, 64);
      if (tag) { g.font = `500 20px ${FONT.mono}`; g.fillStyle = rgba(color, 0.7); g.textAlign = 'left'; g.fillText(tag, m + 6, H - m - 18); }
      g.restore();
    },
  };
};

/** 片尾 */
const endcard: Make2 = (s, at, dur) => {
  const brand = str(s.brand, '最强网课教辅系统'), line = str(s.line), url = str(s.url);
  return {
    at, dur, z: 9, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
      const k1 = span(L.t, 0, 1.0), k2 = span(L.t, 0.7, 1.6), k3 = span(L.t, 1.3, 2.2);
      g.globalAlpha = smooth(k1) * (1 - smooth(L.o));
      g.font = `900 92px ${FONT.sans}`; (g as unknown as { letterSpacing: string }).letterSpacing = `${lerp(40, 10, ease('outExpo', k1))}px`;
      g.fillStyle = '#ffffff'; glowText(g, brand, W / 2, H * 0.74, '#7aa2ff', 36);
      g.globalAlpha = smooth(k2) * (1 - smooth(L.o)); (g as unknown as { letterSpacing: string }).letterSpacing = '6px';
      g.font = `500 36px ${FONT.sans}`; g.fillStyle = rgba('#dbe4ff', 0.9); g.fillText(line, W / 2, H * 0.74 + 86);
      g.globalAlpha = smooth(k3) * (1 - smooth(L.o)); (g as unknown as { letterSpacing: string }).letterSpacing = '2px';
      g.font = `500 26px ${FONT.mono}`; g.fillStyle = rgba('#9fb3ff', 0.8); g.fillText(url, W / 2, H * 0.74 + 146);
      g.restore();
    },
  };
};

// ═══ 通用图形：AI 用它画示意图（光路、受力、几何、流程），线条按顺序「画出来」 ═══
type Pt = [number, number];
const pts = (v: unknown): Pt[] => (Array.isArray(v) ? v.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]] as Pt) : []);
const polyLen = (p: Pt[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
/** 折线上按长度比例 f（0~1）取点 */
function along(p: Pt[], cum: number[], f: number): { x: number; y: number; i: number } {
  const total = cum[cum.length - 1] || 1, d = clamp(f) * total;
  let i = 1; while (i < p.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1, k = (d - cum[i - 1]) / seg;
  return { x: lerp(p[i - 1][0], p[i][0], k), y: lerp(p[i - 1][1], p[i][1], k), i };
}
const cumOf = (p: Pt[]) => p.reduce<number[]>((a, q, i) => (a.push(i ? a[i - 1] + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), a), []);
function arrowHead(g: CanvasRenderingContext2D, from: Pt, to: Pt, size: number) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  g.beginPath(); g.moveTo(to[0], to[1]);
  g.lineTo(to[0] - size * Math.cos(a - 0.4), to[1] - size * Math.sin(a - 0.4));
  g.lineTo(to[0] - size * Math.cos(a + 0.4), to[1] - size * Math.sin(a + 0.4));
  g.closePath(); g.fill();
}

const shape: Make2 = (s, at, dur) => {
  const p = pts(s.points), r = num(s.r, 60), x = num(s.x, W / 2), y = num(s.y, H / 2), w = num(s.w, 300), h = num(s.h, 200);
  const kind = str(s.kind, p.length >= 2 ? 'polyline' : 'circle');
  const color = str(s.color, '#7ad7ff'), lw = num(s.width, 4), fill = typeof s.fill === 'string' ? s.fill : '', dash = !!s.dash, glow = num(s.glow, 12);
  const drawDur = Math.max(0.05, num(s.draw, 1)), move = (Array.isArray(s.move) ? s.move : null) as number[] | null;
  const moveAt = num(s.moveAt, drawDur + 0.3), moveDur = num(s.moveDur, 1.2), spin = num(s.spin, 0), label = str(s.text), lsize = num(s.size, 34);
  const closed = kind === 'polygon' || kind === 'rect' || kind === 'circle';
  const path = new Path2D();
  let len = 0, end: Pt = [x, y], before: Pt = [x - 1, y], center: Pt = [x, y];
  if (kind === 'circle' || kind === 'dot') { path.arc(x, y, kind === 'dot' ? num(s.r, 10) : r, -Math.PI / 2, Math.PI * 1.5); len = 2 * Math.PI * r; end = [x + r, y]; }
  else if (kind === 'rect') { path.rect(x - w / 2, y - h / 2, w, h); len = 2 * (w + h); end = [x + w / 2, y - h / 2]; }
  else if (p.length >= 2) {
    p.forEach((q, i) => (i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1])));
    if (kind === 'polygon') path.closePath();
    len = polyLen(p) + (kind === 'polygon' ? Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) : 0);
    end = p[p.length - 1]; before = p[p.length - 2];
    center = [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  }
  return {
    at, dur, z: num(s.z, 5), draw: ({ g }, L) => {
      if (L.a <= 0) return;
      const dk = ease('inOut', span(L.t, 0, drawDur)), mk = move ? ease('inOut', span(L.t, moveAt, moveAt + moveDur)) : 0;
      g.save(); g.globalAlpha = 1 - smooth(L.o);
      if (move) g.translate(move[0] * mk, (move[1] ?? 0) * mk);
      if (spin) { g.translate(center[0], center[1]); g.rotate((spin * Math.PI / 180) * Math.max(0, L.t - drawDur)); g.translate(-center[0], -center[1]); }
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (fill && (closed || kind === 'dot')) { g.globalAlpha = (1 - smooth(L.o)) * smooth(span(L.t, drawDur * 0.6, drawDur + 0.4)) * (kind === 'dot' ? 1 : 0.85); g.fillStyle = fill; g.fill(path); g.globalAlpha = 1 - smooth(L.o); }
      if (kind === 'dot') { g.fillStyle = color; g.shadowColor = color; g.shadowBlur = glow * 2; g.globalAlpha *= smooth(span(L.t, 0, 0.4)); g.fill(path); g.restore(); return; }
      g.strokeStyle = color; g.lineWidth = lw; g.shadowColor = color; g.shadowBlur = glow;
      // 虚线没法用「虚线偏移」做描出来的效果，改成淡入
      if (dash) { g.setLineDash([lw * 3, lw * 2.5]); g.globalAlpha *= dk; }
      else { g.setLineDash([len + 1, len + 1]); g.lineDashOffset = (len + 1) * (1 - dk); }
      g.stroke(path);
      if (kind === 'arrow' && dk > 0.92) { g.setLineDash([]); g.fillStyle = color; g.globalAlpha = (1 - smooth(L.o)) * span(dk, 0.92, 1); arrowHead(g, before, end, 14 + lw * 3); }
      if (label) {
        g.setLineDash([]); g.shadowBlur = 0; g.globalAlpha = (1 - smooth(L.o)) * smooth(span(L.t, drawDur * 0.8, drawDur + 0.5));
        g.font = `700 ${lsize}px ${FONT.sans}`; g.fillStyle = str(s.textColor, color); g.textBaseline = 'middle';
        const lp = kind === 'arrow' || kind === 'line' || kind === 'polyline' ? end : center;
        g.textAlign = kind === 'arrow' || kind === 'line' || kind === 'polyline' ? 'left' : 'center';
        glowText(g, label, lp[0] + (g.textAlign === 'left' ? 16 : 0), lp[1] - (g.textAlign === 'left' ? lsize * 0.7 : 0), color, 10);
      }
      g.restore();
    },
  };
};

/** 沿路径运动的光点（带拖尾）：光路、粒子轨迹、洋流、行军路线 */
const tracer: Make2 = (s, at, dur) => {
  const p = pts(s.points), cum = cumOf(p), color = str(s.color, '#ffd166'), size = num(s.size, 11);
  const t0 = num(s.t0, 0.4), t1 = num(s.t1, Math.max(t0 + 0.5, dur - 0.8)), trail = clamp(num(s.trail, 0.22), 0, 1), showPath = s.path !== false, loop = !!s.loop;
  return {
    at, dur, z: num(s.z, 6), draw: ({ g }, L) => {
      if (L.a <= 0 || p.length < 2) return;
      g.save(); g.globalAlpha = L.a; g.lineCap = 'round'; g.lineJoin = 'round';
      if (showPath) {
        g.setLineDash([6, 10]); g.strokeStyle = rgba(color, 0.35); g.lineWidth = 2;
        g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); g.setLineDash([]);
      }
      let f = (L.t - t0) / Math.max(0.1, t1 - t0);
      if (loop) f = ((f % 1) + 1) % 1; else f = clamp(f);
      if (L.t >= t0) {
        const N = 40;
        for (let i = 0; i < N; i++) {
          const fa = f - trail * (1 - i / N), fb = f - trail * (1 - (i + 1) / N);
          if (fb <= 0) continue;
          const a = along(p, cum, Math.max(0, fa)), b = along(p, cum, fb);
          g.strokeStyle = rgba(color, (i / N) ** 1.5 * 0.9); g.lineWidth = size * 0.9 * (0.3 + 0.7 * i / N);
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        const hd = along(p, cum, f);
        g.fillStyle = '#ffffff'; g.shadowColor = color; g.shadowBlur = 34;
        g.beginPath(); g.arc(hd.x, hd.y, size, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        g.fillStyle = rgba(color, 0.35); g.beginPath(); g.arc(hd.x, hd.y, size * 2.2, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    },
  };
};

/** 柱状图：柱子依次长高，数字跟着滚动 */
const bars: Make2 = (s, at, dur) => {
  const data = (Array.isArray(s.data) ? s.data : []).map((d: { label?: unknown; value?: unknown; color?: unknown }) => ({ label: str(d?.label), value: num(d?.value, 0), color: str(d?.color, '') }));
  const x0 = num(s.x, W / 2), y0 = num(s.y, H / 2 + 40), w = num(s.w, 1200), h = num(s.h, 560), unit = str(s.unit), color = str(s.color, '#4cc9ff');
  const max = num(s.max, Math.max(1e-9, ...data.map((d) => Math.abs(d.value))));
  const dec = max >= 100 ? 0 : max >= 10 ? 1 : 2, fmt = (v: number) => v.toFixed(dec).replace(/\.0+$/, '');
  return {
    at, dur, z: 6, draw: ({ g }, L) => {
      if (L.a <= 0 || !data.length) return;
      g.save(); g.globalAlpha = L.a;
      const base = y0 + h / 2, left = x0 - w / 2, slot = w / data.length, bw = Math.min(140, slot * 0.56);
      g.strokeStyle = 'rgba(220,230,255,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(left, base); g.lineTo(left + w * ease('outExpo', span(L.t, 0, 0.8)), base); g.stroke();
      data.forEach((d, i) => {
        const k = ease('outExpo', span(L.t, 0.4 + i * 0.18, 1.6 + i * 0.18)), bh = (Math.abs(d.value) / max) * h * k, cx = left + slot * (i + 0.5), c = d.color || color;
        const gr = g.createLinearGradient(0, base - bh, 0, base); gr.addColorStop(0, c); gr.addColorStop(1, rgba(c, 0.25));
        g.fillStyle = gr; g.shadowColor = c; g.shadowBlur = 24; g.beginPath(); g.roundRect(cx - bw / 2, base - bh, bw, bh, [8, 8, 0, 0]); g.fill(); g.shadowBlur = 0;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (k > 0.02) { g.font = `800 34px ${FONT.latin}`; g.fillStyle = '#ffffff'; g.fillText(fmt(d.value * k) + unit, cx, base - bh - 30); }
        g.font = `600 30px ${FONT.sans}`; g.fillStyle = rgba('#dfe7ff', 0.9 * smooth(span(L.t, 0.2 + i * 0.1, 0.8 + i * 0.1))); g.fillText(d.label, cx, base + 38);
      });
      g.restore();
    },
  };
};

/** 大数字滚动：from → to，带单位和说明 */
const counter: Make2 = (s, at, dur) => {
  const from = num(s.from, 0), to = num(s.to, 100), x = num(s.x, W / 2), y = num(s.y, H / 2), size = num(s.size, 140), color = str(s.color, '#ffffff');
  const unit = str(s.unit), label = str(s.label), t0 = num(s.t0, 0.2), t1 = num(s.t1, 2.0), accent = str(s.accent, '#7aa2ff');
  const decimals = num(s.decimals, Number.isInteger(to) && Number.isInteger(from) ? 0 : 2);
  const group = (v: number) => { const [a, b] = v.toFixed(decimals).split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); };
  return {
    at, dur, z: 7, draw: ({ g }, L) => {
      if (L.a <= 0) return;
      const k = ease('outExpo', span(L.t, t0, t1)), v = lerp(from, to, k);
      g.save(); g.globalAlpha = L.a; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.font = `900 ${size}px ${FONT.latin}`; g.fillStyle = color;
      const num_ = group(v), nw = g.measureText(num_).width;
      g.font = `700 ${size * 0.38}px ${FONT.sans}`; const uw = unit ? g.measureText(unit).width + size * 0.12 : 0;
      g.font = `900 ${size}px ${FONT.latin}`; g.textAlign = 'left';
      glowText(g, num_, x - (nw + uw) / 2, y, accent, 30 * (1 - k * 0.5));
      if (unit) { g.font = `700 ${size * 0.38}px ${FONT.sans}`; g.fillStyle = rgba(color, 0.85); g.fillText(unit, x - (nw + uw) / 2 + nw + size * 0.12, y + size * 0.18); }
      if (label) { g.textAlign = 'center'; g.font = `500 ${size * 0.26}px ${FONT.sans}`; g.fillStyle = rgba('#dfe7ff', 0.85 * smooth(span(L.t, t0 + 0.3, t0 + 1))); g.fillText(label, x, y + size * 0.85); }
      g.restore();
    },
  };
};

export const PARTS_2D: Record<string, Make2> = { title, text, badge, caption, formula, plot, field, pythagoras, timeline, poem, mountains, kinetic, label, hud, endcard, shape, tracer, bars, counter };
export const make2 = (s: ItemSpec, at: number, dur: number): Part2 | null => PARTS_2D[s.type]?.(s, at, dur) ?? null;
export { life };
