// ── 题目文本 → 带单位的物理量（规则，不用模型）─────────────────────────────
// 统一全角/上下标/科学计数法 → 找出「数 + 单位」与「符号 = 数」→ 换算成 SI，并记录前后语境，供 recognize.ts 分配到参数。

export type QK = 'v' | 'a' | 'm' | 'len' | 't' | 'deg' | 'F' | 'k' | 'B' | 'q' | 'E' | 'U' | 'num';
export interface Q {
  k: QK;
  v: number;          // SI 值
  raw: string;        // 原文片段，如「2 m/s」「μ=0.2」
  i: number;          // 在规范化文本中的位置
  sym?: string;       // 紧挨着的符号，如 v0、μ1、mA
  near: string;       // 局部语境：前一个量/标点之后 + 本量之后到下一个量/标点
  clause: string;     // 所在分句
}

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

export function normalize(src: string): string {
  let s = src
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＝]/g, '=').replace(/[．]/g, '.').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[／]/g, '/')
    .replace(/[−–]/g, '-').replace(/µ/g, 'μ').replace(/[Θ]/g, 'θ').replace(/ |　/g, ' ')
    .replace(/[₀-₉]/g, (c) => SUB[c]);
  // 科学计数法：×10⁶ / x10^6 / ×10^{-6} / *10-6 → ×10^n
  s = s.replace(/([×xX*])\s*10\s*([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, _x, e: string) => '×10^' + [...e].map((c) => SUP[c]).join(''));
  s = s.replace(/([×xX*])\s*10\s*\^\s*\{?\s*(-?\d+)\s*\}?/g, '×10^$2');
  s = s.replace(/(\d)\s*[eE]\s*(-?\d+)/g, '$1×10^$2');
  // 剩下的上标都在单位里：m/s² → m/s2，m·s⁻¹ → m·s-1
  s = s.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUP[c]);
  return s;
}

// 单位表：长的写在前面（m/s2 要先于 m/s，m/s 要先于 m）
const UNITS: { re: string; k: QK; f: number }[] = [
  { re: 'km/h|千米每小时|千米/时', k: 'v', f: 1 / 3.6 },
  { re: 'm/s\\^?2|m·s-2|m\\s?s-2|米每二次方秒|m/s/s', k: 'a', f: 1 },
  { re: 'm/s|m·s-1|m\\s?s-1|米每秒|米/秒', k: 'v', f: 1 },
  { re: 'cm/s', k: 'v', f: 0.01 },
  { re: 'N/m|牛每米', k: 'k', f: 1 },
  { re: 'N/C|V/m', k: 'E', f: 1 },
  { re: 'kg|千克|公斤', k: 'm', f: 1 },
  { re: 'g(?![a-zA-Z/])|克', k: 'm', f: 1e-3 },
  { re: 'km|千米|公里', k: 'len', f: 1000 },
  { re: 'cm|厘米', k: 'len', f: 0.01 },
  { re: 'mm|毫米', k: 'len', f: 0.001 },
  { re: 'm(?![a-zA-Z/·])|米(?!每)', k: 'len', f: 1 },
  { re: 'ms|毫秒', k: 't', f: 0.001 },
  { re: 's(?![a-zA-Z])|秒', k: 't', f: 1 },
  { re: '°|度(?!数)', k: 'deg', f: 1 },
  { re: 'N(?![a-zA-Z/·])|牛(?!顿每)', k: 'F', f: 1 },
  { re: 'T(?![a-zA-Z])|特斯拉|特', k: 'B', f: 1 },
  { re: 'C(?![a-zA-Z])|库仑|库', k: 'q', f: 1 },
  { re: 'kV|千伏', k: 'U', f: 1000 },
  { re: 'V(?![a-zA-Z/])|伏特|伏', k: 'U', f: 1 },
];
const NUM = '(-?\\d+(?:\\.\\d+)?)(?:\\s*×10\\^(-?\\d+))?';
const QRE = new RegExp(`${NUM}\\s*(?:(${UNITS.map((u) => `(?:${u.re})`).join('|')}))?`, 'g');
const UNIT_RES = UNITS.map((u) => ({ ...u, rx: new RegExp(`^(?:${u.re})$`) }));
const DELIM = /[，,。；;：:？?！!\n]/;
// 符号：v0、μ1、mA、θ、Δx、L、h、B、E、U、R …（紧跟「=」）
const SYM_RE = /([A-Za-zμθαβΔ][A-Za-z0-9_']{0,3})\s*=\s*$/;

/** 「g 取 10 m/s²」「sin37°=0.6」这类不是题目条件的量先拿掉 */
function strip(s: string): { s: string; g?: number } {
  let g: number | undefined;
  s = s.replace(/(?:重力加速度\s*)?g\s*(?:取|=|为|是)\s*(\d+(?:\.\d+)?)\s*(?:m\/s\^?2|m·s-2)?/g, (m, v: string) => { g = +v; return ' '.repeat(m.length); });
  s = s.replace(/(?:sin|cos|tan)\s*\d+(?:\.\d+)?\s*°?\s*=\s*\d+(?:\.\d+)?/g, (m) => ' '.repeat(m.length));
  return { s, g };
}

export interface Extracted { norm: string; qs: Q[]; g?: number }

export function extract(text: string): Extracted {
  const norm0 = normalize(text);
  const { s: norm, g } = strip(norm0);
  const hits: { i: number; end: number; num: number; unit?: string; raw: string }[] = [];
  QRE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = QRE.exec(norm)); ) {
    if (!m[0].trim()) { QRE.lastIndex++; continue; }
    const prev = norm[m.index - 1] ?? '';
    if (/[A-Za-z]/.test(prev) && !/[=]/.test(prev) && !SYM_RE.test(norm.slice(0, m.index))) {
      // 「m1」「v0」「R2」里的数字是符号下标，不是数值
      if (!m[3]) continue;
    }
    const num = +m[1] * (m[2] ? 10 ** +m[2] : 1);
    if (!Number.isFinite(num)) continue;
    hits.push({ i: m.index, end: m.index + m[0].length, num, unit: m[3], raw: m[0].trim() });
  }
  const qs: Q[] = hits.map((h, n) => {
    const u = h.unit ? UNIT_RES.find((x) => x.rx.test(h.unit!)) : undefined;
    const before0 = norm.slice(Math.max(n > 0 ? hits[n - 1].end : 0, 0), h.i);
    const symM = before0.match(SYM_RE);
    const cut = (s: string, fromEnd: boolean) => {
      const parts = s.split(DELIM);
      return fromEnd ? parts[parts.length - 1] : parts[0];
    };
    const before = cut(before0, true);
    const after = cut(norm.slice(h.end, n + 1 < hits.length ? hits[n + 1].i : norm.length), false).split('以')[0];
    let a = h.i; while (a > 0 && !DELIM.test(norm[a - 1])) a--;
    let b = h.end; while (b < norm.length && !DELIM.test(norm[b])) b++;
    const sym = symM ? symM[1] : undefined;
    let k: QK = u ? u.k : 'num';
    // 无单位但写了符号：μ、e 是纯数；θ/α 视作角度
    if (!u && sym && /^[θα]/.test(sym)) k = 'deg';
    return { k, v: h.num * (u ? u.f : 1), raw: (sym ? sym + '=' : '') + h.raw, i: h.i, sym, near: before + '|' + after, clause: norm.slice(a, b) };
  });
  // 「动摩擦因数为 0.2」「μ 均为 0.5」：把纯数标成 μ
  for (const q of qs) if (q.k === 'num' && (/μ|摩擦因数|摩擦系数/.test(q.near) || (q.sym && /^μ/.test(q.sym)))) q.sym = q.sym ?? 'μ';
  return { norm, qs, g };
}

/** 依次分配：同一个量只用一次 */
export class Picker {
  used = new Set<Q>();
  constructor(public qs: Q[]) {}
  free(k: QK | QK[]) { const ks = Array.isArray(k) ? k : [k]; return this.qs.filter((q) => !this.used.has(q) && ks.includes(q.k)); }
  /** 优先级：符号匹配 > 局部语境 > 分句语境 > （fallback 时）第一个同类量 */
  take(k: QK | QK[], o: { sym?: RegExp; ctx?: RegExp; not?: RegExp; fallback?: boolean } = {}): Q | undefined {
    const c = this.free(k).filter((q) => !(o.not && (o.not.test(q.near) || (q.sym && o.not.test(q.sym)))));
    const q = (o.sym && c.find((x) => x.sym && o.sym!.test(x.sym)))
      || (o.ctx && c.find((x) => !x.sym && o.ctx!.test(x.near)))
      || (o.ctx && c.find((x) => !x.sym && o.ctx!.test(x.clause)))
      || (o.fallback !== false ? c.find((x) => !x.sym || !o.sym) : undefined);
    if (q) this.used.add(q);
    return q;
  }
}
