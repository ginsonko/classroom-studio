// 数学 / 化学课堂演示的公共部分：参数定义、配色、坐标系和常用图元。
// 画面统一是 1600×900 的 SVG（和黑板页同比例），老师端与学生端用同一份参数和时钟各自绘制。
import type { ReactNode } from 'react';
import type { ParamDef } from '../physics/sim/presetKit';
import type { Material } from '../lib/types';
import { DARK_BOARDS, PEN_COLORS, type BoardSkin } from '../lib/palette';
import { PAPER } from '../physics/sim/prim';

export type P = Record<string, number>;
export interface DemoParam extends ParamDef {
  hidden?: boolean;                 // 只能在画面上拖动，不出现在参数面板
  when?: (p: P) => boolean;         // 某些选项下才显示
}
export interface Theme {
  dark: boolean; bg: string; fg: string; sub: string; grid: string; axis: string; card: string;
  ink: string; red: string; blue: string; green: string; orange: string; violet: string;
}
export interface Handle { key: string; x: number; y: number; color?: string; move: (x: number, y: number, p: P) => P }
export interface DemoCtx { mat: Material; th: Theme }
export interface DemoDef {
  id: string;
  subject: 'math' | 'chem';
  group: string;
  title: string;
  summary: string;
  params: DemoParam[];
  duration: number;
  /** 播放按钮的含义，例如「点 P 沿椭圆运动」 */
  play: string;
  keywords: (string | RegExp)[];
  fix?: (p: P) => P;
  view: (p: P, t: number, c: DemoCtx) => ReactNode;
  formulas?: (p: P, t: number, c: DemoCtx) => { tex: string; note?: string }[];
  info?: (p: P, t: number, c: DemoCtx) => { k: string; v: string; color?: string }[];
  handles?: (p: P, t: number, c: DemoCtx) => Handle[];
  /** 公式卡位置；mr = 右侧中间偏下。左下角会被学生端的画笔条挡住，尽量别用 bl */
  corner?: 'tl' | 'tr' | 'bl' | 'br' | 'mr';
}

export const W = 1600, H = 900;

export function themeOf(skin: BoardSkin): Theme {
  const dark = DARK_BOARDS.includes(skin);
  const pen = (id: string) => { const c = PEN_COLORS.find((x) => x.id === id)!; return dark ? c.dark : c.light; };
  return {
    dark, bg: PAPER[skin] ?? '#fff',
    fg: dark ? '#eef0ea' : '#1b1d22', sub: dark ? '#a9b0ba' : '#5d6470',
    grid: dark ? 'rgba(255,255,255,.07)' : 'rgba(20,30,50,.07)', axis: dark ? '#c9cfd8' : '#3b4250',
    card: dark ? 'rgba(10,14,20,.55)' : 'rgba(255,255,255,.86)',
    ink: pen('ink'), red: pen('red'), blue: pen('blue'), green: pen('green'), orange: pen('orange'), violet: pen('violet'),
  };
}

export function defaults(d: DemoDef): P { return Object.fromEntries(d.params.map((x) => [x.key, x.def])); }
export function clampDemo(d: DemoDef, raw: Record<string, unknown> = {}): P {
  const out: P = {};
  for (const x of d.params) {
    let v = Number(raw[x.key]);
    if (!Number.isFinite(v)) v = x.def;
    if (x.options) v = x.options.some((o) => o.v === v) ? v : x.def;
    else v = Math.max(x.min, Math.min(x.max, v));
    out[x.key] = v;
  }
  return d.fix ? d.fix(out) : out;
}

// ── 数值格式 ──────────────────────────────────────────────
export const num = (v: number, d = 2) => {
  if (!Number.isFinite(v)) return '—';
  const s = (+v.toFixed(d)).toString();
  return s === '-0' ? '0' : s.replace('-', '−');
};
/** 带符号的项：用于拼 "x² + 2x − 3" */
export const term = (c: number, body: string, first = false, d = 2) => {
  if (Math.abs(c) < 1e-9) return '';
  const a = Math.abs(c), s = c < 0 ? (first ? '−' : ' − ') : first ? '' : ' + ';
  const k = body && Math.abs(a - 1) < 1e-9 ? '' : num(a, d);
  return s + k + body;
};
export const texNum = (v: number, d = 2) => num(v, d).replace('−', '-');
export const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// ── 坐标系 ───────────────────────────────────────────────
export interface Frame { x0: number; x1: number; y0: number; y1: number; L: number; T: number; Wd: number; Ht: number }
export const frame = (x0: number, x1: number, y0: number, y1: number, L = 90, T = 60, Wd = 1420, Ht = 780): Frame => ({ x0, x1, y0, y1, L, T, Wd, Ht });
export const X = (f: Frame, x: number) => f.L + (x - f.x0) / (f.x1 - f.x0) * f.Wd;
export const Y = (f: Frame, y: number) => f.T + (f.y1 - y) / (f.y1 - f.y0) * f.Ht;
export const unX = (f: Frame, sx: number) => f.x0 + (sx - f.L) / f.Wd * (f.x1 - f.x0);
export const unY = (f: Frame, sy: number) => f.y1 - (sy - f.T) / f.Ht * (f.y1 - f.y0);

/** 等比例坐标系：给定中心和 x 半宽，按区域宽高比算 y 范围 */
export function square(cx: number, cy: number, halfX: number, L = 90, T = 60, Wd = 1420, Ht = 780): Frame {
  const halfY = halfX * Ht / Wd;
  return frame(cx - halfX, cx + halfX, cy - halfY, cy + halfY, L, T, Wd, Ht);
}

function niceStep(span: number, target = 12) {
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
export function Axes({ f, th, xl = 'x', yl = 'y', step, ystep, piX, labels = true }: { f: Frame; th: Theme; xl?: string; yl?: string; step?: number; ystep?: number; piX?: boolean; labels?: boolean }) {
  const sx = piX ? Math.PI / 2 : step ?? niceStep(f.x1 - f.x0), sy = ystep ?? step ?? niceStep(f.y1 - f.y0, 9);
  const xs: number[] = [], ys: number[] = [];
  for (let v = Math.ceil(f.x0 / sx) * sx; v <= f.x1 + 1e-9; v += sx) xs.push(+v.toFixed(10));
  for (let v = Math.ceil(f.y0 / sy) * sy; v <= f.y1 + 1e-9; v += sy) ys.push(+v.toFixed(10));
  const ox = Math.max(f.L, Math.min(f.L + f.Wd, X(f, 0))), oy = Math.max(f.T, Math.min(f.T + f.Ht, Y(f, 0)));
  const fs = 20;
  const piLabel = (v: number) => { const k = Math.round(v / (Math.PI / 2)); if (k === 0) return ''; if (k % 2 === 0) { const n = k / 2; return n === 1 ? 'π' : n === -1 ? '−π' : `${n < 0 ? '−' : ''}${Math.abs(n)}π`; } return `${k < 0 ? '−' : ''}${Math.abs(k) === 1 ? '' : Math.abs(k)}π/2`; };
  return (
    <g>
      {xs.map((v) => <line key={'gx' + v} x1={X(f, v)} x2={X(f, v)} y1={f.T} y2={f.T + f.Ht} stroke={th.grid} strokeWidth={1.2} />)}
      {ys.map((v) => <line key={'gy' + v} y1={Y(f, v)} y2={Y(f, v)} x1={f.L} x2={f.L + f.Wd} stroke={th.grid} strokeWidth={1.2} />)}
      <line x1={f.L - 10} x2={f.L + f.Wd + 18} y1={oy} y2={oy} stroke={th.axis} strokeWidth={2} />
      <line y1={f.T + f.Ht + 10} y2={f.T - 18} x1={ox} x2={ox} stroke={th.axis} strokeWidth={2} />
      <path d={`M${f.L + f.Wd + 28} ${oy} l-16 -6 v12 z`} fill={th.axis} />
      <path d={`M${ox} ${f.T - 28} l-6 16 h12 z`} fill={th.axis} />
      {labels && xs.filter((v) => Math.abs(v) > 1e-9).map((v) => <text key={'tx' + v} x={X(f, v)} y={oy + fs + 6} fontSize={fs - 2} fill={th.sub} textAnchor="middle" fontFamily="'Times New Roman',serif">{piX ? piLabel(v) : num(v, 2)}</text>)}
      {labels && ys.filter((v) => Math.abs(v) > 1e-9).map((v) => <text key={'ty' + v} x={ox - 8} y={Y(f, v) + 6} fontSize={fs - 2} fill={th.sub} textAnchor="end" fontFamily="'Times New Roman',serif">{num(v, 2)}</text>)}
      <text x={f.L + f.Wd + 30} y={oy + 28} fontSize={26} fill={th.fg} fontStyle="italic" fontFamily="'Times New Roman',serif">{xl}</text>
      <text x={ox + 12} y={f.T - 22} fontSize={26} fill={th.fg} fontStyle="italic" fontFamily="'Times New Roman',serif">{yl}</text>
      <text x={ox - 10} y={oy + 24} fontSize={22} fill={th.sub} textAnchor="end" fontStyle="italic" fontFamily="'Times New Roman',serif">O</text>
    </g>
  );
}

/** 函数曲线：在断点（渐近线、定义域外）自动断开 */
/** 直线：只取两个端点（交给 Clip 裁剪）；fnPath 的断点检测会把陡的直线当成渐近线断开 */
export function linePath(f: Frame, fn: (x: number) => number, from = f.x0, to = f.x1) {
  return `M${X(f, from).toFixed(1)} ${Y(f, fn(from)).toFixed(1)}L${X(f, to).toFixed(1)} ${Y(f, fn(to)).toFixed(1)}`;
}
export function fnPath(f: Frame, fn: (x: number) => number, from = f.x0, to = f.x1, n = 700) {
  let d = '', pen = false, py = 0;
  const lim = (f.y1 - f.y0) * 3;
  for (let i = 0; i <= n; i++) {
    const x = from + (to - from) * i / n, y = fn(x);
    const ok = Number.isFinite(y) && y > f.y0 - lim && y < f.y1 + lim;
    if (!ok || (pen && Math.abs(y - py) > (f.y1 - f.y0) * 1.5)) { pen = false; if (!ok) continue; }
    const sx = X(f, x), sy = Y(f, Math.max(f.y0 - lim, Math.min(f.y1 + lim, y)));
    d += (pen ? 'L' : 'M') + sx.toFixed(1) + ' ' + sy.toFixed(1);
    pen = true; py = y;
  }
  return d;
}

export function Clip({ id, f, children }: { id: string; f: Frame; children: ReactNode }) {
  return <g><defs><clipPath id={id}><rect x={f.L} y={f.T} width={f.Wd} height={f.Ht} /></clipPath></defs><g clipPath={`url(#${id})`}>{children}</g></g>;
}

export function Dot({ x, y, color, r = 8, ring }: { x: number; y: number; color: string; r?: number; ring?: string }) {
  return <circle cx={x} cy={y} r={r} fill={color} stroke={ring ?? 'none'} strokeWidth={ring ? 3 : 0} />;
}
export function Label({ x, y, children, color, size = 26, anchor = 'start', italic = true, bold }: { x: number; y: number; children: ReactNode; color: string; size?: number; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; bold?: boolean }) {
  return <text x={x} y={y} fill={color} fontSize={size} textAnchor={anchor} fontStyle={italic ? 'italic' : undefined} fontWeight={bold ? 700 : 500}
    fontFamily={italic ? "'Times New Roman','Cambria Math',serif" : "'Noto Sans SC','Microsoft YaHei UI',sans-serif"} style={{ paintOrder: 'stroke', stroke: 'var(--demo-halo)', strokeWidth: 5, strokeLinejoin: 'round' }}>{children}</text>;
}
export function Arrow({ x1, y1, x2, y2, color, w = 3.5, dash, head = 16 }: { x1: number; y1: number; x2: number; y2: number; color: string; w?: number; dash?: string; head?: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return null;
  const h = Math.min(head, len * 0.45);
  const bx = x2 - Math.cos(a) * h * 0.8, by = y2 - Math.sin(a) * h * 0.8;
  return <g>
    <line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" />
    <path d={`M${x2} ${y2} L${x2 - Math.cos(a - 0.38) * h} ${y2 - Math.sin(a - 0.38) * h} L${x2 - Math.cos(a + 0.38) * h} ${y2 - Math.sin(a + 0.38) * h} Z`} fill={color} />
  </g>;
}
/** 角的弧线标记 */
export function AngleArc({ cx, cy, a0, a1, r, color, w = 2.5 }: { cx: number; cy: number; a0: number; a1: number; r: number; color: string; w?: number }) {
  let d = a1 - a0; while (d < 0) d += Math.PI * 2; if (d > Math.PI * 2) d -= Math.PI * 2;
  const large = d > Math.PI ? 1 : 0;
  const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a0 + d) * r, y1 = cy + Math.sin(a0 + d) * r;
  return <path d={`M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`} fill="none" stroke={color} strokeWidth={w} />;
}
/** 右侧信息卡里的标题 */
export function Title({ th, text, sub }: { th: Theme; text: string; sub?: string }) {
  return <g>
    <text x={40} y={52} fill={th.fg} fontSize={34} fontWeight={700} fontFamily="'Noto Sans SC','Microsoft YaHei UI',sans-serif">{text}</text>
    {sub && <text x={40} y={88} fill={th.sub} fontSize={22} fontFamily="'Noto Sans SC','Microsoft YaHei UI',sans-serif">{sub}</text>}
  </g>;
}
