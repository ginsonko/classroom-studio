// 课堂动画引擎：一部「片子」= 若干镜头（shot），每个镜头里放若干部件（item）。
// 画面完全由时间 t 决定（没有累积状态），所以实时播放、拖进度、逐帧导出 MP4 的画面一模一样。
// 规格是普通 JSON，结构故意做得很浅：AI 只需要挑部件、填参数，不用写代码。

export type V3 = [number, number, number];

export interface FilmSpec {
  title: string;
  /** 每个镜头按顺序接着播 */
  shots: ShotSpec[];
  /** 是否配合成的背景音乐（导出 MP4 时混进去） */
  music?: boolean;
}

export type Cut = 'none' | 'fade' | 'flash' | 'zoom' | 'glitch' | 'wipe';
export type Backdrop = 'space' | 'deep' | 'blueprint' | 'paper' | 'aurora' | 'dark';

export interface ShotSpec {
  /** 镜头名（预览列表里显示） */
  name?: string;
  dur: number;
  /** 背景：space 星空、deep 深色渐变、blueprint 蓝图网格、paper 宣纸、aurora 极光、dark 纯黑 */
  bg?: Backdrop;
  /** 主色调，影响背景光、徽标颜色 */
  tint?: string;
  /** 进入这个镜头的转场 */
  cut?: Cut;
  /** 3D 镜头：from → to 推拉，look 盯着的点，orbit 绕 look 转多少度 */
  camera?: CamSpec;
  /** 配乐的强度：calm 只有铺底和琶音，drive 加鼓和贝斯，epic 再加厚 */
  mood?: 'calm' | 'drive' | 'epic';
  /** 泛光强度倍数（默认 1，宣纸背景默认 0） */
  bloom?: number;
  /** 3D 打光：studio 正面柔光（默认）；sun 只从侧面打一束太阳光，能看出昼夜分界 */
  light?: 'studio' | 'sun';
  items: ItemSpec[];
}

export interface CamSpec { from: V3; to?: V3; look?: V3; lookTo?: V3; fov?: number; orbit?: number; ease?: EaseName }

/** 部件：type 选部件，at / dur 是在镜头里的出现时间和持续时间（秒），其余是部件自己的参数 */
export interface ItemSpec { type: string; at?: number; dur?: number; [k: string]: unknown }

// ── 缓动 ──
export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'outBack' | 'outExpo' | 'inExpo' | 'inOutExpo' | 'outElastic';
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export const smooth = (k: number) => { k = clamp(k); return k * k * (3 - 2 * k); };
export const EASE: Record<EaseName, (k: number) => number> = {
  linear: (k) => clamp(k),
  in: (k) => clamp(k) ** 3,
  out: (k) => 1 - (1 - clamp(k)) ** 3,
  inOut: (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; },
  outBack: (k) => { k = clamp(k); const c = 1.70158; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
  outExpo: (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * clamp(k))),
  inExpo: (k) => (k <= 0 ? 0 : 2 ** (10 * clamp(k) - 10)),
  inOutExpo: (k) => { k = clamp(k); if (k === 0 || k === 1) return k; return k < 0.5 ? 2 ** (20 * k - 10) / 2 : (2 - 2 ** (-20 * k + 10)) / 2; },
  outElastic: (k) => { k = clamp(k); if (k === 0 || k === 1) return k; return 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
};
export const ease = (name: EaseName | undefined, k: number) => (EASE[name ?? 'inOut'] ?? EASE.inOut)(k);
/** 在 [a, b] 区间里的进度 0~1 */
export const span = (t: number, a: number, b: number) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));

// ── 可复现的随机数（导出和预览要一模一样） ──
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ── 颜色 ──
export function rgba(hex: string, a = 1): string {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${v[0]},${v[1]},${v[2]},${clamp(a)})`;
}
export const SUBJECT_COLOR: Record<string, string> = {
  物理: '#4cc9ff', 化学: '#ff8a3d', 生物: '#3ddc97', 数学: '#b28dff', 地理: '#34d1bf', 历史: '#e8b04a', 语文: '#ff5d5d', 英语: '#ff7ab6', 引擎: '#7aa2ff',
};

export const FONT = {
  sans: '"Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif',
  kai: '"KaiTi","STKaiti","Kaiti SC","楷体",serif',
  serif: '"Noto Serif SC","SimSun","Songti SC",serif',
  latin: '"Inter Variable","Segoe UI",sans-serif',
  mono: '"JetBrains Mono","Cascadia Mono",Consolas,monospace',
};

/** 部件在自己时间段里的状态：k 进场进度、o 退场进度、a 不透明度 */
export interface Life { t: number; dur: number; k: number; o: number; a: number }
export function life(t: number, at: number, dur: number, inDur = 0.6, outDur = 0.45): Life {
  const lt = t - at;
  const k = span(lt, 0, inDur), o = span(lt, dur - outDur, dur);
  return { t: lt, dur, k, o, a: smooth(k) * (1 - smooth(o)) };
}

export const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
export const vec = (v: unknown, d: V3): V3 => (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number') ? [v[0], v[1], v[2]] : d);
