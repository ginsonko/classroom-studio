// 画在 3D 画面上方的二维层：物体 / 矢量 / 顶点标签（自动避让）、右上角图表、底部步骤字幕。
// 全部画进同一张 2D 画布，所以课堂画面、预览、给模型看的试播截图完全一致。
import type { S3DChart } from '../spec';

const FONT = '"Inter Variable","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';
const SERIF = '"Cambria Math","Times New Roman","STIX Two Math",serif';

// ── 简单富文本：下标 / 上标 / 常见 TeX 记号 ─────────────────
interface Run { s: string; k: 0 | 1 | -1 }
const TEX: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'φ', varphi: 'φ', omega: 'ω', Delta: 'Δ', Omega: 'Ω', Sigma: 'Σ', Phi: 'Φ', Gamma: 'Γ', eta: 'η', nu: 'ν', xi: 'ξ', kappa: 'κ', psi: 'ψ', chi: 'χ', zeta: 'ζ',
  cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', Rightarrow: '⇒',
  leftarrow: '←', angle: '∠', perp: '⊥', parallel: '∥', triangle: '△', circ: '°', degree: '°', propto: '∝', sim: '∼', cdots: '⋯', ldots: '…', quad: '  ', because: '∵', therefore: '∴',
  in: '∈', subset: '⊂', cup: '∪', cap: '∩', odot: '⊙', otimes: '⊗', uparrow: '↑', downarrow: '↓', rightleftharpoons: '⇌', longrightarrow: '⟶',
};
export function cleanTex(src: string): string {
  let s = src.replace(/\$+/g, '');
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => `${a.length > 1 ? '(' + a + ')' : a}/${b.length > 1 ? '(' + b + ')' : b}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => '√' + (a.length > 1 ? '(' + a + ')' : a))
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|vec|overrightarrow|boldsymbol)\s*\{([^{}]*)\}/g, '$1');
  }
  return s.replace(/\^\s*\{?\\circ\}?/g, '°').replace(/\\left|\\right/g, '').replace(/\\[,;: !]/g, ' ').replace(/\\%/g, '%')
    .replace(/\\([A-Za-z]+)/g, (m, n: string) => TEX[n] ?? n);
}
function runs(text: string): Run[] {
  const s = cleanTex(text), out: Run[] = [];
  let cur = '';
  const push = (x: string, k: Run['k']) => { if (!x) return; const last = out[out.length - 1]; if (last && last.k === k) last.s += x; else out.push({ s: x, k }); };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '_' || c === '^') && i + 1 < s.length) {
      push(cur, 0); cur = '';
      const k: Run['k'] = c === '_' ? -1 : 1;
      if (s[i + 1] === '{') { const j = s.indexOf('}', i + 2); const body = j > 0 ? s.slice(i + 2, j) : s.slice(i + 2); push(body, k); i = j > 0 ? j : s.length; continue; }
      let j = i + 1;
      if (/[0-9]/.test(s[j])) while (j < s.length && /[0-9.]/.test(s[j])) j++;
      else if (/[+-]/.test(s[j])) { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      // 连写的大写字母整体作下标：F_NA → F_{NA}、F_AB → F_{AB}；m_Bg 仍是 m_B g
      else if (/[A-Z]/.test(s[j])) { j++; while (j < s.length && j - i <= 3 && /[A-Z]/.test(s[j])) j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      else { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      push(s.slice(i + 1, j), k); i = j - 1; continue;
    }
    cur += c;
  }
  push(cur, 0);
  return out;
}
function font(px: number, weight = 600, serif = false, italic = false) { return `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${serif ? SERIF : FONT}`; }
function measureRuns(g: CanvasRenderingContext2D, rs: Run[], px: number, weight: number, serif: boolean, italic: boolean) {
  let w = 0;
  for (const r of rs) { g.font = font(r.k ? px * 0.68 : px, weight, serif, italic); w += g.measureText(r.s).width; }
  return w;
}
/** 以 (x, y) 为左端、y 为竖直中线画一行富文本 */
function drawRuns(g: CanvasRenderingContext2D, rs: Run[], x: number, y: number, px: number, weight: number, serif: boolean, italic: boolean, stroke?: string) {
  g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const r of rs) {
    const fs = r.k ? px * 0.68 : px, dy = r.k === -1 ? px * 0.3 : r.k === 1 ? -px * 0.36 : 0;
    g.font = font(fs, weight, serif, italic);
    if (stroke) { g.save(); g.strokeStyle = stroke; g.lineWidth = Math.max(2, px * 0.22); g.lineJoin = 'round'; g.strokeText(r.s, x, y + dy); g.restore(); }
    g.fillText(r.s, x, y + dy);
    x += g.measureText(r.s).width;
  }
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ── 标签 ─────────────────────────────────────────────────
export interface ScreenLabel {
  key: string; text: string; x: number; y: number;
  /** 屏幕上的偏移方向（单位向量），null 时居中放在锚点 */
  dx: number | null; dy: number | null;
  color: string; size: 's' | 'm' | 'l'; kind: 'body' | 'vec' | 'vertex' | 'tag' | 'note' | 'tick'; prio: number;
}
export interface Rect { x: number; y: number; w: number; h: number }
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function drawLabels(g: CanvasRenderingContext2D, items: ScreenLabel[], W: number, H: number, s: number, blocked: Rect[]) {
  const placed: Rect[] = [...blocked];
  const sorted = [...items].sort((a, b) => b.prio - a.prio);
  for (const it of sorted) {
    const base = (it.kind === 'vertex' ? 26 : it.kind === 'vec' ? 25 : it.kind === 'note' ? 24 : it.kind === 'tick' ? 17 : it.kind === 'tag' ? 20 : 23) * s;
    const px = base * (it.size === 'l' ? 1.12 : it.size === 's' ? 0.82 : 1);
    const serif = it.kind === 'vertex' || it.kind === 'vec';
    const italic = it.kind === 'vertex' || it.kind === 'vec';
    const weight = it.kind === 'vertex' ? 500 : it.kind === 'vec' ? 600 : 600;
    // 顶点名 A1、B'1 之类按几何习惯写成下标
    const text = it.kind === 'vertex' ? it.text.replace(/^([A-Za-z]['′]?)(\d{1,2})$/, '$1_$2') : it.text;
    const lines = text.split('\n').map((l) => runs(l)).slice(0, 4);
    const pill = it.kind === 'body' || it.kind === 'tag' || it.kind === 'note';
    const padX = pill ? px * 0.55 : px * 0.15, padY = pill ? px * 0.32 : px * 0.1, lh = px * 1.3;
    const tw = Math.max(...lines.map((l, i) => measureRuns(g, l, i ? px * 0.82 : px, weight, serif, italic)));
    const bw = tw + padX * 2, bh = lines.length * lh - (lh - px * 1.05) + padY * 2;
    if (!(tw > 0)) continue;
    // 候选位置：首选方向，再顺时针 / 逆时针试，最后拉远一点
    const cands: [number, number][] = [];
    const gap = it.kind === 'vertex' ? px * 0.45 : px * 0.6;
    if (it.dx === null || it.dy === null) {
      cands.push([0, 0]);
      for (const r of [1, 1.8]) for (const [ax, ay] of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) cands.push([ax * (r * (bh / 2 + gap) + (ax ? bw / 2 * Math.abs(ax) : 0)), ay * (r * (bh / 2 + gap))]);
    } else {
      const a0 = Math.atan2(it.dy, it.dx);
      for (const r of [1, 1.7, 2.6]) for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
        const a = a0 + da, ux = Math.cos(a), uy = Math.sin(a);
        // 让方框的边离锚点 gap，而不是中心
        const ext = Math.abs(ux) * bw / 2 + Math.abs(uy) * bh / 2;
        cands.push([ux * (ext + gap * r + (r - 1) * px * 0.4), uy * (ext + gap * r + (r - 1) * px * 0.4)]);
      }
    }
    let chosen: Rect | null = null;
    for (const [ox, oy] of cands) {
      const rc = { x: it.x + ox - bw / 2, y: it.y + oy - bh / 2, w: bw, h: bh };
      if (rc.x < 4 || rc.y < 4 || rc.x + rc.w > W - 4 || rc.y + rc.h > H - 4) continue;
      if (placed.some((p) => hit(p, rc))) continue;
      chosen = rc; break;
    }
    if (!chosen) {
      if (it.prio < 7) continue;
      const [ox, oy] = cands[0];
      chosen = { x: Math.max(4, Math.min(W - 4 - bw, it.x + ox - bw / 2)), y: Math.max(4, Math.min(H - 4 - bh, it.y + oy - bh / 2)), w: bw, h: bh };
    }
    placed.push({ x: chosen.x - 2, y: chosen.y - 2, w: chosen.w + 4, h: chosen.h + 4 });
    const cx = chosen.x + bw / 2, cy = chosen.y + bh / 2;
    const far = Math.hypot(cx - it.x, cy - it.y) > Math.max(bw, bh) * 0.5 + px * 1.6;
    if (far && it.kind !== 'note' && it.kind !== 'tick') {
      // 指引线：从锚点到方框边缘
      const ex = Math.max(chosen.x, Math.min(chosen.x + bw, it.x)), ey = Math.max(chosen.y, Math.min(chosen.y + bh, it.y));
      g.save(); g.strokeStyle = it.color; g.globalAlpha = 0.55; g.lineWidth = Math.max(1, 1.4 * s); g.setLineDash([4 * s, 3 * s]);
      g.beginPath(); g.moveTo(it.x, it.y); g.lineTo(ex, ey); g.stroke(); g.restore();
      g.fillStyle = it.color; g.beginPath(); g.arc(it.x, it.y, 2.6 * s, 0, Math.PI * 2); g.fill();
    }
    if (pill) {
      g.save();
      roundRect(g, chosen.x, chosen.y, bw, bh, Math.min(bh / 2, px * 0.5));
      g.fillStyle = it.kind === 'note' ? 'rgba(17,24,39,.86)' : 'rgba(12,18,30,.78)';
      g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8 * s; g.fill(); g.shadowBlur = 0;
      g.lineWidth = Math.max(1, 1.5 * s); g.strokeStyle = it.kind === 'note' ? 'rgba(148,163,184,.45)' : hexA(it.color, 0.75); g.stroke();
      g.restore();
    }
    g.fillStyle = pill && it.kind !== 'tag' ? '#f1f5f9' : it.color;
    if (it.kind === 'note') g.fillStyle = it.color;
    lines.forEach((l, i) => {
      const fs = i ? px * 0.82 : px;
      const lw = measureRuns(g, l, fs, weight, serif, italic);
      const x = it.kind === 'note' ? chosen!.x + padX : cx - lw / 2;
      if (i) g.fillStyle = '#cbd5e1';
      drawRuns(g, l, x, chosen!.y + padY + px * 0.52 + i * lh, fs, weight, serif, italic, pill ? undefined : 'rgba(6,10,18,.88)');
    });
  }
}
function hexA(c: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── 图表 ─────────────────────────────────────────────────
export interface ChartData { chart: S3DChart; xs: number[]; ys: number[][]; now: number[]; bars: number[]; D: number }
const niceStep = (span: number, n: number) => { const raw = span / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
const fmtN = (v: number) => { const a = Math.abs(v); const r = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(2); return String(+r); };

export function chartRects(n: number, W: number, H: number, s: number): Rect[] {
  const pw = Math.min(W * 0.32, 560 * s * 1.1), ph = Math.min(pw * 0.62, (H - 40 * s) / Math.max(1, n) - 14 * s);
  return Array.from({ length: Math.min(2, n) }, (_, i) => ({ x: W - pw - 18 * s, y: 18 * s + i * (ph + 14 * s), w: pw, h: ph }));
}
export function drawChart(g: CanvasRenderingContext2D, d: ChartData, r: Rect, t: number, s: number) {
  g.save();
  roundRect(g, r.x, r.y, r.w, r.h, 14 * s);
  g.fillStyle = 'rgba(11,16,27,.86)'; g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 14 * s; g.fill(); g.shadowBlur = 0;
  g.strokeStyle = 'rgba(148,163,184,.25)'; g.lineWidth = Math.max(1, s); g.stroke();
  const fs = 17 * s, pad = 14 * s;
  g.fillStyle = '#e2e8f0'; drawRuns(g, runs(d.chart.title || '图像'), r.x + pad, r.y + pad + fs * 0.5, fs, 700, false, false);
  const top = fs * (d.chart.yLabel && d.chart.type !== 'bars' ? 2.3 : 1.6);
  const plot = { x: r.x + pad + 34 * s, y: r.y + pad + top, w: r.w - pad * 2 - 40 * s, h: r.h - pad * 2 - top - 22 * s };
  if (d.chart.type === 'bars') { drawBars(g, d, plot, s); g.restore(); return; }
  let lo = Infinity, hi = -Infinity;
  for (const ys of d.ys) for (const y of ys) if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (typeof d.chart.ymin === 'number') lo = d.chart.ymin;
  if (typeof d.chart.ymax === 'number') hi = d.chart.ymax;
  if (lo > 0 && lo < hi * 0.35) lo = 0;
  if (hi < 0 && hi > lo * 0.35) hi = 0;
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const span = hi - lo; lo -= span * 0.06; hi += span * 0.08;
  const X = (x: number) => plot.x + (x / Math.max(1e-9, d.D)) * plot.w, Yp = (y: number) => plot.y + plot.h - ((y - lo) / (hi - lo)) * plot.h;
  // 网格与刻度
  const st = niceStep(hi - lo, 4);
  g.font = font(12.5 * s, 500); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
    const y = Yp(v);
    g.strokeStyle = Math.abs(v) < st * 1e-6 ? 'rgba(203,213,225,.45)' : 'rgba(148,163,184,.13)'; g.lineWidth = Math.max(1, s);
    g.beginPath(); g.moveTo(plot.x, y); g.lineTo(plot.x + plot.w, y); g.stroke();
    g.fillStyle = '#94a3b8'; g.fillText(fmtN(v), plot.x - 6 * s, y);
  }
  const xst = niceStep(d.D, 5);
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let v = 0; v <= d.D + 1e-9; v += xst) { g.fillStyle = '#94a3b8'; g.fillText(fmtN(v), X(v), plot.y + plot.h + 5 * s); }
  g.textAlign = 'right'; g.fillText(d.chart.xLabel || 't/s', plot.x + plot.w, plot.y + plot.h + 5 * s + 13 * s);
  if (d.chart.yLabel) { g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = '#94a3b8'; drawRuns(g, runs(d.chart.yLabel), plot.x - 30 * s, plot.y - 8 * s, 12.5 * s, 500, false, false); }
  // 曲线：已走过的部分实线，未来部分淡色
  d.chart.series.forEach((se, k) => {
    const ys = d.ys[k];
    const path = (from: number, to: number) => { g.beginPath(); let on = false; for (let i = from; i <= to; i++) { const y = ys[i]; if (!Number.isFinite(y)) { on = false; continue; } const px = X(d.xs[i]), py = Math.max(plot.y - 4 * s, Math.min(plot.y + plot.h + 4 * s, Yp(y))); if (on) g.lineTo(px, py); else { g.moveTo(px, py); on = true; } } g.stroke(); };
    const iNow = Math.max(0, Math.min(d.xs.length - 1, Math.round((t / Math.max(1e-9, d.D)) * (d.xs.length - 1))));
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = hexA(se.color, 0.22); g.lineWidth = 2 * s; path(iNow, d.xs.length - 1);
    g.strokeStyle = se.color; g.lineWidth = 3 * s; path(0, iNow);
    const yn = d.now[k];
    if (Number.isFinite(yn)) {
      const px = X(Math.min(t, d.D)), py = Yp(yn);
      g.fillStyle = se.color; g.beginPath(); g.arc(px, Math.max(plot.y, Math.min(plot.y + plot.h, py)), 5 * s, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#0b101b'; g.lineWidth = 2 * s; g.stroke();
    }
  });
  // 图例 + 当前值
  let lx = r.x + r.w - pad;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let k = d.chart.series.length - 1; k >= 0; k--) {
    const se = d.chart.series[k], v = d.now[k];
    const rs = [...runs(se.name), { s: Number.isFinite(v) ? ' ' + fmtN(v) : '', k: 0 as const }];
    const tw = measureRuns(g, rs, 14 * s, 700, false, false);
    g.fillStyle = se.color; drawRuns(g, rs, lx - tw, r.y + pad + fs * 0.5, 14 * s, 700, false, false);
    g.beginPath(); g.arc(lx - tw - 8 * s, r.y + pad + fs * 0.5, 4 * s, 0, Math.PI * 2); g.fill();
    lx -= tw + 22 * s;
  }
  // 当前时刻竖线
  g.strokeStyle = 'rgba(226,232,240,.35)'; g.lineWidth = Math.max(1, s); g.setLineDash([4 * s, 4 * s]);
  g.beginPath(); g.moveTo(X(Math.min(t, d.D)), plot.y); g.lineTo(X(Math.min(t, d.D)), plot.y + plot.h); g.stroke(); g.setLineDash([]);
  g.restore();
}
function drawBars(g: CanvasRenderingContext2D, d: ChartData, plot: Rect, s: number) {
  const bars = d.chart.bars, n = bars.length;
  if (!n) return;
  let hi = Math.max(1e-9, ...d.bars.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0)));
  if (typeof d.chart.ymax === 'number') hi = d.chart.ymax;
  const hasNeg = d.bars.some((v) => v < 0);
  const zero = hasNeg ? plot.y + plot.h / 2 : plot.y + plot.h;
  const scaleH = hasNeg ? plot.h / 2 : plot.h;
  g.strokeStyle = 'rgba(203,213,225,.45)'; g.lineWidth = Math.max(1, s);
  g.beginPath(); g.moveTo(plot.x - 30 * s, zero); g.lineTo(plot.x + plot.w, zero); g.stroke();
  const slot = (plot.w + 30 * s) / n, bw = Math.min(slot * 0.6, 90 * s);
  bars.forEach((b, i) => {
    const v = d.bars[i], h = Number.isFinite(v) ? (Math.min(1.05, Math.abs(v) / hi)) * scaleH * 0.9 : 0;
    const x = plot.x - 30 * s + slot * i + (slot - bw) / 2;
    const y = v >= 0 ? zero - h : zero;
    const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, b.color); gr.addColorStop(1, hexA(b.color, 0.55));
    g.fillStyle = gr; roundRect(g, x, y, bw, Math.max(1, h), Math.min(6 * s, bw / 4)); g.fill();
    g.fillStyle = '#f1f5f9'; g.font = font(14 * s, 700); g.textAlign = 'center'; g.textBaseline = v >= 0 ? 'bottom' : 'top';
    g.fillText(Number.isFinite(v) ? fmtN(v) : '—', x + bw / 2, v >= 0 ? y - 4 * s : y + h + 4 * s);
    g.fillStyle = '#cbd5e1'; g.textBaseline = 'top';
    const nm = runs(b.name), nw = measureRuns(g, nm, 13.5 * s, 600, false, false);
    drawRuns(g, nm, x + bw / 2 - nw / 2, plot.y + plot.h + 12 * s, 13.5 * s, 600, false, false);
  });
}

// ── 字幕 / 标题 ──────────────────────────────────────────
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, px: number): string[] {
  const out: string[] = [];
  for (const para of cleanTex(text).split('\n')) {
    let line = '';
    // 不可拆的小块：英文单词 / 数字、单个汉字，连同紧跟的下标上标（C_1、x^{2}）
    const atoms = para.match(/(?:[A-Za-z0-9.°′']+|[^\sA-Za-z0-9_^])(?:[_^](?:\{[^}]*\}|[+-]?[0-9.]+|[A-Z]{1,3}[0-9]*|.))*|\s+|[_^]/gu) ?? [];
    for (const a of atoms) {
      const test = line + a;
      // 行首不放句读标点
      if (line && !/^[，。；：、！？,.;:!?）)」”]/.test(a) && measureRuns(g, runs(test), px, 600, false, false) > maxW) { out.push(line.trimEnd()); line = a.trimStart(); } else line = test;
    }
    if (line) out.push(line);
  }
  return out.slice(0, 3);
}
export function captionRect(text: string, g: CanvasRenderingContext2D, W: number, H: number, s: number): Rect {
  const px = 25 * s, maxW = Math.min(W * 0.74, 1180 * s);
  const lines = wrap(g, text, maxW - 90 * s, px);
  const tw = Math.max(...lines.map((l) => measureRuns(g, runs(l), px, 600, false, false)), 0);
  const w = Math.min(maxW, tw + 90 * s), h = lines.length * px * 1.42 + 26 * s;
  return { x: (W - w) / 2, y: H - h - 22 * s, w, h };
}
export function drawCaption(g: CanvasRenderingContext2D, text: string, idx: number, n: number, r: Rect, s: number, fade: number) {
  const px = 25 * s;
  const lines = wrap(g, text, r.w - 90 * s, px);
  g.save(); g.globalAlpha = Math.max(0, Math.min(1, fade));
  roundRect(g, r.x, r.y, r.w, r.h, 16 * s);
  g.fillStyle = 'rgba(10,15,26,.84)'; g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 18 * s; g.fill(); g.shadowBlur = 0;
  g.strokeStyle = 'rgba(96,165,250,.35)'; g.lineWidth = Math.max(1, 1.2 * s); g.stroke();
  // 步骤号
  const bx = r.x + 14 * s, by = r.y + r.h / 2, bh = 34 * s, bw = 46 * s;
  roundRect(g, bx, by - bh / 2, bw, bh, bh / 2); g.fillStyle = '#3b82f6'; g.fill();
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = font(19 * s, 800); const w1 = g.measureText(String(idx + 1)).width;
  g.font = font(12 * s, 700); const w2 = g.measureText(`/${n}`).width;
  const x0 = bx + (bw - w1 - w2) / 2, yb = by + 6.5 * s;
  g.fillStyle = '#fff'; g.font = font(19 * s, 800); g.fillText(String(idx + 1), x0, yb);
  g.fillStyle = 'rgba(219,234,254,.85)'; g.font = font(12 * s, 700); g.fillText(`/${n}`, x0 + w1, yb);
  g.fillStyle = '#f1f5f9';
  lines.forEach((l, i) => drawRuns(g, runs(l), r.x + 70 * s, r.y + 13 * s + px * 0.71 + i * px * 1.42, px, 600, false, false));
  g.restore();
}
export function drawTitle(g: CanvasRenderingContext2D, title: string, s: number) {
  if (!title) return;
  g.save();
  g.fillStyle = 'rgba(226,232,240,.78)';
  drawRuns(g, runs(title), 22 * s, 30 * s, 21 * s, 700, false, false, 'rgba(6,10,18,.6)');
  g.restore();
}
/** 截图左上角的小角标（试播联系表里标注时刻 / 视角） */
export function drawTag(g: CanvasRenderingContext2D, text: string, x: number, y: number, s: number) {
  g.save(); g.font = font(18 * s, 700);
  const w = g.measureText(text).width + 20 * s;
  roundRect(g, x, y, w, 30 * s, 8 * s); g.fillStyle = 'rgba(250,204,21,.92)'; g.fill();
  g.fillStyle = '#111827'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x + 10 * s, y + 15 * s);
  g.restore();
}
export function drawMessage(g: CanvasRenderingContext2D, W: number, H: number, text: string) {
  g.fillStyle = '#0f1522'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#94a3b8'; g.font = font(Math.max(14, H * 0.035), 600); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2);
}
