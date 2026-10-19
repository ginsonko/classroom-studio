// ── 画布上的物理符号：斜体字母 + 下标 + 撇号，例如 F_N、v_{块}、m₁、F_弹、qE、F′ ─────────
// 所有尺寸单位与调用方的 ctx 坐标一致（仿真里 1 = 页宽）。

import { atPx, pxScale } from '../../ink/pxText';

const SERIF = '"Times New Roman", "STIX Two Text", Georgia, serif';
export const SANS = '"Inter Variable", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", Consolas, monospace';

interface Run { s: string; sub: boolean; italic: boolean }

const isLatin = (c: string) => /[A-Za-zα-ωΑ-Ω]/.test(c) && !/[πΔΣΩ]/.test(c);
const SUBS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

/** 把 "F_N"、"v_{块}"、"m₁"、"E_k" 解析成若干段 */
export function parseSym(src: string): Run[] {
  const out: Run[] = [];
  const push = (s: string, sub: boolean) => {
    for (const ch of s) {
      const italic = !sub ? isLatin(ch) : /[a-z]/.test(ch) && !/[A-Z]/.test(ch) && false;
      const last = out[out.length - 1];
      if (last && last.sub === sub && last.italic === italic) last.s += ch;
      else out.push({ s: ch, sub, italic });
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '_') {
      if (src[i + 1] === '{') {
        const j = src.indexOf('}', i + 2);
        push(src.slice(i + 2, j < 0 ? undefined : j), true);
        i = j < 0 ? src.length : j + 1;
      } else { push(src[i + 1] ?? '', true); i += 2; }
      continue;
    }
    if (SUBS[c]) { push(SUBS[c], true); i++; continue; }
    push(c, false); i++;
  }
  return out;
}

function font(r: Run, size: number) {
  const s = r.sub ? size * 0.68 : size;
  if (/[一-鿿]/.test(r.s)) return `600 ${s}px ${SANS}`;
  return `${r.italic ? 'italic ' : ''}${r.sub ? '500' : '600'} ${s}px ${r.italic ? SERIF : SANS}`;
}

// 字在设备像素尺度里量、画（见 ink/pxText），返回值再换回调用方单位。
function symW(ctx: CanvasRenderingContext2D, runs: Run[], px: number) {
  let w = 0;
  for (const r of runs) { ctx.font = font(r, px); w += ctx.measureText(r.s).width + (r.italic && !r.sub ? px * 0.04 : 0); }
  return w;
}

export function measureSym(ctx: CanvasRenderingContext2D, src: string, size: number) {
  const k = pxScale(ctx);
  ctx.save();
  const w = symW(ctx, parseSym(src), size * k);
  ctx.restore();
  return w / k;
}

/** 画符号。align：x 指的是左 / 中 / 右；y 是基线中点（middle）。返回宽度 */
export function drawSym(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', halo?: string) {
  const runs = parseSym(src);
  return atPx(ctx, x, y, (k) => {
    const S = size * k, w = symW(ctx, runs, S);
    let cx = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const base = S * 0.34;
    for (const r of runs) {
      ctx.font = font(r, S);
      const yy = r.sub ? base + S * 0.2 : base;
      if (halo) { ctx.lineWidth = S * 0.22; ctx.strokeStyle = halo; ctx.lineJoin = 'round'; ctx.strokeText(r.s, cx, yy); }
      ctx.fillStyle = color;
      ctx.fillText(r.s, cx, yy);
      cx += ctx.measureText(r.s).width + (r.italic && !r.sub ? S * 0.04 : 0);
    }
    return w / k;
  });
}

/** 普通文字（中文、数字） */
export function drawText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; mono?: boolean; halo?: string; base?: CanvasTextBaseline } = {}) {
  return atPx(ctx, x, y, (k) => {
    const S = size * k;
    ctx.font = `${opts.weight ?? 500} ${S}px ${opts.mono ? MONO : SANS}`;
    ctx.textAlign = opts.align ?? 'left';
    // 'middle' 基线在不同字体（等宽 / 中文）上不一致：统一用字母基线 + 固定偏移，保证同一行对齐
    ctx.textBaseline = opts.base ?? 'alphabetic';
    const yy = opts.base ? 0 : S * 0.34;
    if (opts.halo) { ctx.lineWidth = S * 0.24; ctx.strokeStyle = opts.halo; ctx.lineJoin = 'round'; ctx.strokeText(s, 0, yy); }
    ctx.fillStyle = color;
    ctx.fillText(s, 0, yy);
    return ctx.measureText(s).width / k;
  });
}

export function textW(ctx: CanvasRenderingContext2D, s: string, size: number, opts: { weight?: number; mono?: boolean } = {}) {
  const k = pxScale(ctx);
  ctx.save();
  ctx.font = `${opts.weight ?? 500} ${size * k}px ${opts.mono ? MONO : SANS}`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w / k;
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
/** 数值格式：极大 / 极小用科学计数法 a×10ⁿ */
export function fmt(v: number, digits = 2, tiny = 1e-9): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < tiny) v = 0;              // 宏观量：浮点噪声（1e-16）显示为 0；微观量调用时传 tiny=0
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) {
    let e = Math.floor(Math.log10(a));
    let m = +(v / 10 ** e).toFixed(digits);
    if (Math.abs(m) >= 10) { m /= 10; e += 1; }      // 9.9999×10⁵ → 1.00×10⁶，不出现 10.00×10⁵
    return `${m.toFixed(digits)}×10${String(e).split('').map((c) => SUP[c] ?? c).join('')}`;
  }
  const s = v.toFixed(digits);
  return s === '-0.00' || s === '-0.0' || s === '-0' ? s.slice(1) : s;
}
