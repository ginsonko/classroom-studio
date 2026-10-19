// 化学演示的纯计算：元素与电子排布、化学式解析与方程式配平、滴定 pH、分子模型数据。
// 不依赖 React，Node 里可以直接测试。

// ── 元素（1–36 号）────────────────────────────────────────
export const ELEMENTS: { sym: string; name: string }[] = [
  ['H', '氢'], ['He', '氦'], ['Li', '锂'], ['Be', '铍'], ['B', '硼'], ['C', '碳'], ['N', '氮'], ['O', '氧'], ['F', '氟'], ['Ne', '氖'],
  ['Na', '钠'], ['Mg', '镁'], ['Al', '铝'], ['Si', '硅'], ['P', '磷'], ['S', '硫'], ['Cl', '氯'], ['Ar', '氩'], ['K', '钾'], ['Ca', '钙'],
  ['Sc', '钪'], ['Ti', '钛'], ['V', '钒'], ['Cr', '铬'], ['Mn', '锰'], ['Fe', '铁'], ['Co', '钴'], ['Ni', '镍'], ['Cu', '铜'], ['Zn', '锌'],
  ['Ga', '镓'], ['Ge', '锗'], ['As', '砷'], ['Se', '硒'], ['Br', '溴'], ['Kr', '氪'],
].map(([sym, name]) => ({ sym, name }));

export interface Sub { n: number; l: 0 | 1 | 2; e: number }
const L = 'spd';
const FILL: [number, 0 | 1 | 2][] = [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [3, 2], [4, 1]];
const CAP = [2, 6, 10];
export const subName = (s: { n: number; l: number }) => `${s.n}${L[s.l]}`;

/** 基态电子排布（按能层顺序书写，含 Cr、Cu 的洪特规则特例） */
export function configOf(Z: number): Sub[] {
  const out: Sub[] = [];
  let left = Z;
  for (const [n, l] of FILL) { if (left <= 0) break; const e = Math.min(CAP[l], left); out.push({ n, l, e }); left -= e; }
  if (Z === 24 || Z === 29) {
    const s4 = out.find((s) => s.n === 4 && s.l === 0)!, d3 = out.find((s) => s.n === 3 && s.l === 2)!;
    s4.e -= 1; d3.e += 1;
  }
  return out.sort((a, b) => a.n - b.n || a.l - b.l);
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const sup = (n: number) => String(n).split('').map((c) => SUP[+c]).join('');
export const configText = (subs: Sub[]) => subs.map((s) => subName(s) + sup(s.e)).join('');
export const configTex = (subs: Sub[]) => subs.map((s) => `${subName(s)}^{${s.e}}`).join('\\,');

export function placeOf(Z: number) {
  const period = Z <= 2 ? 1 : Z <= 10 ? 2 : Z <= 18 ? 3 : 4;
  const start = [0, 1, 3, 11, 19][period];
  let col = Z - start + 1;            // 周期内序号
  if (period === 1) col = Z === 1 ? 1 : 18;
  else if (period <= 3) col = col <= 2 ? col : col + 10;
  const block = Z === 2 ? 's' : col <= 2 ? 's' : col >= 13 ? 'p' : col <= 10 ? 'd' : 'ds';
  const roman = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'];
  const group = col === 18 ? '0 族' : col <= 2 ? `${roman[col]}A 族` : col >= 13 ? `${roman[col - 10]}A 族` : col <= 7 ? `${roman[col]}B 族` : col <= 10 ? 'Ⅷ 族' : `${roman[col - 10]}B 族`;
  return { period, col, group, block };
}

/** 价层电子排布：主族 ns np，过渡元素 (n−1)d ns */
export function valenceOf(Z: number): Sub[] {
  const subs = configOf(Z), { period, block } = placeOf(Z);
  if (block === 'd' || block === 'ds') return subs.filter((s) => (s.n === period && s.l === 0) || (s.n === period - 1 && s.l === 2));
  return subs.filter((s) => s.n === period && s.l <= 1);
}
export function shortConfig(Z: number) {
  const core = Z > 18 ? 18 : Z > 10 ? 10 : Z > 2 ? 2 : 0;
  if (!core) return configText(configOf(Z));
  const all = configOf(Z), coreSubs = configOf(core);
  const rest = all.map((s) => { const c = coreSubs.find((x) => x.n === s.n && x.l === s.l); return { ...s, e: s.e - (c?.e ?? 0) }; }).filter((s) => s.e > 0);
  return `[${ELEMENTS[core - 1].sym}]` + configText(rest);
}
/** 轨道表示式：每个轨道 0/1/2 个电子，按洪特规则先单独占据、自旋平行 */
export function boxes(s: Sub): number[] {
  const k = 2 * s.l + 1, out = new Array(k).fill(0);
  for (let i = 0; i < s.e; i++) out[i % k]++;
  return out;
}
export const shellsOf = (Z: number) => { const out: number[] = []; for (const s of configOf(Z)) out[s.n - 1] = (out[s.n - 1] ?? 0) + s.e; return out; };

// ── 化学式与配平 ───────────────────────────────────────────
export type Count = Record<string, number>;
/** 解析化学式：支持括号、方括号、结晶水（· 或 *）、离子电荷（写成 ^2+ / ^- ，或末尾的 + -） */
export function parseFormula(raw: string): Count | null {
  let s = raw.trim().replace(/\s+/g, '').replace(/[₀-₉]/g, (c) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(c)))
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]*)([⁺⁻])$/, (_, d: string, sg: string) => '^' + [...d].map((c) => SUP.indexOf(c)).join('') + (sg === '⁺' ? '+' : '-'));
  if (!s) return null;
  if (/^e\^?-$/.test(s)) return { '+': -1 };
  let charge = 0;
  // 多位电荷要写 ^：Fe^3+、MnO4^-；不带 ^ 的末尾 +/- 只当作一价
  const m = /\^(\d*)([+-])$/.exec(s) ?? /()([+-])$/.exec(s);
  if (m) { charge = (m[2] === '+' ? 1 : -1) * (m[1] ? +m[1] : 1); s = s.slice(0, m.index); }
  if (!s) return null;
  const parts = s.split(/[·*•]/);
  const total: Count = {};
  for (const part of parts) {
    const lead = /^(\d+)/.exec(part), k = lead ? +lead[1] : 1, body = lead ? part.slice(lead[0].length) : part;
    const one = parseGroup(body);
    if (!one) return null;
    for (const [e, n] of Object.entries(one)) total[e] = (total[e] ?? 0) + n * k;
  }
  if (charge) total['+'] = charge;
  return total;
}
function parseGroup(s: string): Count | null {
  const stack: Count[] = [{}];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(' || c === '[') { stack.push({}); i++; continue; }
    if (c === ')' || c === ']') {
      if (stack.length < 2) return null;
      i++; const m = /^\d+/.exec(s.slice(i)); const k = m ? +m[0] : 1; if (m) i += m[0].length;
      const top = stack.pop()!, cur = stack[stack.length - 1];
      for (const [e, n] of Object.entries(top)) cur[e] = (cur[e] ?? 0) + n * k;
      continue;
    }
    const m = /^([A-Z][a-z]?)(\d*)/.exec(s.slice(i));
    if (!m) return null;
    const cur = stack[stack.length - 1];
    cur[m[1]] = (cur[m[1]] ?? 0) + (m[2] ? +m[2] : 1);
    i += m[0].length;
  }
  return stack.length === 1 ? stack[0] : null;
}
export interface Equation { left: string[]; right: string[]; arrow: string; cond?: string }
export function parseEquation(raw: string): Equation | null {
  const m = /(⇌|<=>|===|==|=|→|->|—>)/.exec(raw);
  if (!m) return null;
  const strip = (x: string) => x.replace(/^\s*\d+(?=[A-Z(\[])/, '').trim();
  const side = (x: string) => x.split(/\s+\+\s+|\s*\+\s*(?=[A-Z(\[\d])/).map(strip).filter(Boolean);
  const left = side(raw.slice(0, m.index)), right = side(raw.slice(m.index + m[0].length));
  if (!left.length || !right.length || [...left, ...right].some((f) => !parseFormula(f))) return null;
  return { left, right, arrow: m[0] === '⇌' || m[0] === '<=>' ? '⇌' : '=' };
}

const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
type Fr = [number, number];
const fr = (n: number, d = 1): Fr => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return [n / g, d / g]; };
const fsub = (a: Fr, b: Fr): Fr => fr(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const fmul = (a: Fr, b: Fr): Fr => fr(a[0] * b[0], a[1] * b[1]);
const fdiv = (a: Fr, b: Fr): Fr => fr(a[0] * b[1], a[1] * b[0]);

/** 最简整数系数；配不平（或有多组独立解）时返回 null */
export function balance(eq: Equation): number[] | null {
  const species = [...eq.left, ...eq.right].map((f) => parseFormula(f)!);
  const els = [...new Set(species.flatMap((c) => Object.keys(c)))];
  const n = species.length;
  const M: Fr[][] = els.map((e) => species.map((c, j) => fr((c[e] ?? 0) * (j < eq.left.length ? 1 : -1))));
  // 化成行最简形
  const piv: number[] = []; let r = 0;
  for (let c = 0; c < n && r < M.length; c++) {
    const p = M.findIndex((row, i) => i >= r && row[c][0] !== 0);
    if (p < 0) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const pv = M[r][c]; M[r] = M[r].map((x) => fdiv(x, pv));
    for (let i = 0; i < M.length; i++) if (i !== r && M[i][c][0] !== 0) { const k = M[i][c]; M[i] = M[i].map((x, j) => fsub(x, fmul(k, M[r][j]))); }
    piv.push(c); r++;
  }
  if (n - piv.length !== 1) return null;
  const free = [...Array(n).keys()].find((c) => !piv.includes(c))!;
  const x: Fr[] = new Array(n).fill(fr(0)); x[free] = fr(1);
  piv.forEach((c, i) => { x[c] = fr(-M[i][free][0], M[i][free][1]); });
  const lcm = x.reduce((l, v) => l / gcd(l, v[1]) * v[1], 1);
  let ints = x.map((v) => v[0] * (lcm / v[1]));
  const g = ints.reduce((a, v) => gcd(a, v), 0) || 1; ints = ints.map((v) => v / g);
  if (ints.every((v) => v < 0)) ints = ints.map((v) => -v);
  return ints.every((v) => v > 0 && Number.isInteger(v) && v < 1000) ? ints : null;
}
/** 各元素（和电荷）两边的原子数 */
export function tally(eq: Equation, coef: number[]) {
  const species = [...eq.left, ...eq.right].map((f) => parseFormula(f)!);
  const els = [...new Set(species.flatMap((c) => Object.keys(c)))];
  return els.map((e) => {
    let l = 0, r = 0;
    species.forEach((c, j) => { const v = (c[e] ?? 0) * (coef[j] ?? 0); if (j < eq.left.length) l += v; else r += v; });
    return { el: e === '+' ? '电荷' : e, left: l, right: r };
  });
}
/** 化学式 → TeX：数字下标、电荷上标 */
export function formulaTex(f: string) {
  let s = f.replace(/\s+/g, ''), charge = '';
  if (/^e\^?-$/.test(s)) return 'e^{-}';
  const m = /\^(\d*[+-])$/.exec(s) ?? /()([+-])$/.exec(s);
  if (m) { charge = m[1] + (m[2] ?? ''); s = s.slice(0, m.index); }
  const body = s.replace(/[·*•]/g, '\\cdot ').replace(/([A-Za-z)\]])(\d+)/g, '$1_{$2}').replace(/\[/g, '[').replace(/\]/g, ']');
  return `\\mathrm{${body}}${charge ? `^{${charge}}` : ''}`;
}

export const REACTIONS: { eq: string; cond?: string; note: string }[] = [
  { eq: 'H2 + O2 = H2O', cond: '点燃', note: '氢气燃烧' },
  { eq: 'CH4 + O2 = CO2 + H2O', cond: '点燃', note: '甲烷燃烧' },
  { eq: 'C2H5OH + O2 = CO2 + H2O', cond: '点燃', note: '乙醇燃烧' },
  { eq: 'Fe + O2 = Fe3O4', cond: '点燃', note: '铁丝在氧气中燃烧' },
  { eq: 'Na + H2O = NaOH + H2', note: '钠与水' },
  { eq: 'Na2O2 + CO2 = Na2CO3 + O2', note: '过氧化钠与二氧化碳' },
  { eq: 'NaHCO3 = Na2CO3 + CO2 + H2O', cond: '△', note: '碳酸氢钠受热分解' },
  { eq: 'Al + NaOH + H2O = Na[Al(OH)4] + H2', note: '铝与氢氧化钠溶液' },
  { eq: 'Cl2 + NaOH = NaCl + NaClO + H2O', note: '氯气与氢氧化钠（制漂白液）' },
  { eq: 'MnO2 + HCl = MnCl2 + Cl2 + H2O', cond: '△', note: '实验室制氯气（浓盐酸）' },
  { eq: 'KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O', note: '高锰酸钾与浓盐酸' },
  { eq: 'KClO3 = KCl + O2', cond: 'MnO₂，△', note: '氯酸钾分解制氧气' },
  { eq: 'Cu + HNO3 = Cu(NO3)2 + NO + H2O', note: '铜与稀硝酸' },
  { eq: 'Cu + HNO3 = Cu(NO3)2 + NO2 + H2O', note: '铜与浓硝酸' },
  { eq: 'C + H2SO4 = CO2 + SO2 + H2O', cond: '△', note: '碳与浓硫酸' },
  { eq: 'NO2 + H2O = HNO3 + NO', note: '二氧化氮与水' },
  { eq: 'NH3 + O2 = NO + H2O', cond: '催化剂，△', note: '氨的催化氧化' },
  { eq: 'Fe2O3 + CO = Fe + CO2', cond: '高温', note: '炼铁' },
  { eq: 'FeS2 + O2 = Fe2O3 + SO2', cond: '高温', note: '黄铁矿煅烧' },
  { eq: 'MnO4^- + Fe^2+ + H^+ = Mn^2+ + Fe^3+ + H2O', note: '酸性高锰酸钾氧化亚铁离子（离子方程式）' },
];

// ── 酸碱滴定 ───────────────────────────────────────────────
/** 用电荷守恒求 pH：[H⁺] + [Na⁺] = [OH⁻] + [A⁻]。强酸取 Ka 很大。体积单位 mL，浓度 mol/L */
export function titrationPH(Va: number, Ca: number, Vb: number, Cb: number, Ka: number) {
  const V = Va + Vb, Na = Cb * Vb / V, CA = Ca * Va / V, Kw = 1e-14;
  const f = (h: number) => h + Na - Kw / h - CA * Ka / (Ka + h);
  let lo = -15, hi = 1;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(10 ** mid) > 0) hi = mid; else lo = mid; }
  return -(lo + hi) / 2;
}

// ── 分子模型（球棍）────────────────────────────────────────
export type Vec = [number, number, number];
export interface Mol { name: string; formula: string; atoms: { el: string; p: Vec }[]; bonds: [number, number, number][]; shape: string; angle: string; hybrid: string; polar: string; lone?: { at: number; dir: Vec }[]; crystal?: boolean }
const nrm = (v: Vec): Vec => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** 已知一根键的方向 u，求四面体上另外三根键的方向 */
function tetraFrom(u: Vec, twist = 0): Vec[] {
  u = nrm(u);
  const a: Vec = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const p = nrm([u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]]);
  const q: Vec = [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]];
  const c = -1 / 3, s = Math.sqrt(8 / 9);
  return [0, 1, 2].map((i) => { const t = twist + i * 2 * Math.PI / 3; return nrm([u[0] * c + s * (p[0] * Math.cos(t) + q[0] * Math.sin(t)), u[1] * c + s * (p[1] * Math.cos(t) + q[1] * Math.sin(t)), u[2] * c + s * (p[2] * Math.cos(t) + q[2] * Math.sin(t))]); });
}
const TET: Vec[] = [nrm([1, 1, 1]), nrm([1, -1, -1]), nrm([-1, 1, -1]), nrm([-1, -1, 1])];
function bent(angleDeg: number, r: number): Vec[] { const h = angleDeg / 2 * Math.PI / 180; return [[Math.sin(h) * r, -Math.cos(h) * r, 0], [-Math.sin(h) * r, -Math.cos(h) * r, 0]]; }
function pyramid(angleDeg: number, r: number): Vec[] {
  const ca = Math.cos(angleDeg * Math.PI / 180), s2 = (1 - ca) / 1.5, st = Math.sqrt(s2), ct = Math.sqrt(1 - s2);
  return [0, 1, 2].map((i) => [st * Math.cos(i * 2 * Math.PI / 3 + Math.PI / 2) * r, -ct * r, st * Math.sin(i * 2 * Math.PI / 3 + Math.PI / 2) * r] as Vec);
}
function lattice(kind: 'nacl' | 'cscl' | 'diamond'): Mol {
  const atoms: { el: string; p: Vec }[] = [], bonds: [number, number, number][] = [], a = 2.6;
  if (kind === 'nacl') {
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) atoms.push({ el: (i + j + k) % 2 ? 'Na' : 'Cl', p: [(i - 1) * a / 2, (j - 1) * a / 2, (k - 1) * a / 2] });
    atoms.forEach((x, i) => atoms.forEach((y, j) => { if (j > i && Math.abs(Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1], x.p[2] - y.p[2]) - a / 2) < 1e-6) bonds.push([i, j, 0]); }));
    return { name: 'NaCl 晶胞', formula: 'NaCl', atoms, bonds, shape: '面心立方', angle: '每个 Na⁺ 周围 6 个 Cl⁻', hybrid: '离子键', polar: '一个晶胞含 4 个 Na⁺、4 个 Cl⁻', crystal: true };
  }
  if (kind === 'cscl') {
    for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) atoms.push({ el: 'Cl', p: [i * a / 2, j * a / 2, k * a / 2] });
    atoms.push({ el: 'Cs', p: [0, 0, 0] });
    for (let i = 0; i < 8; i++) bonds.push([8, i, 0]);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const d = atoms[i].p.reduce((s, v, k) => s + (v !== atoms[j].p[k] ? 1 : 0), 0); if (d === 1) bonds.push([i, j, -1]); }
    return { name: 'CsCl 晶胞', formula: 'CsCl', atoms, bonds, shape: '体心立方', angle: '每个 Cs⁺ 周围 8 个 Cl⁻', hybrid: '离子键', polar: '一个晶胞含 1 个 Cs⁺、1 个 Cl⁻', crystal: true };
  }
  const A = 3.2, pts: Vec[] = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) pts.push([i, j, k]);
  pts.push([0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]);
  pts.push([0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]);
  pts.forEach((p) => atoms.push({ el: 'C', p: [(p[0] - 0.5) * A, (p[1] - 0.5) * A, (p[2] - 0.5) * A] }));
  atoms.forEach((x, i) => atoms.forEach((y, j) => { if (j > i && Math.abs(Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1], x.p[2] - y.p[2]) - A * Math.sqrt(3) / 4) < 1e-6) bonds.push([i, j, 0]); }));
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const d = pts[i].reduce((s, v, k) => s + (v !== pts[j][k] ? 1 : 0), 0); if (d === 1) bonds.push([i, j, -1]); }
  return { name: '金刚石晶胞', formula: 'C', atoms, bonds, shape: '每个 C 与 4 个 C 形成正四面体', angle: '109°28′', hybrid: 'sp³', polar: '一个晶胞含 8 个 C 原子', crystal: true };
}
export function molecules(): Mol[] {
  const O: Vec = [0, 0, 0];
  const h2o = bent(104.5, 0.96), nh3 = pyramid(107, 1.01);
  const ethanol = (() => {
    const C1: Vec = [-0.77, -0.3, 0], C2: Vec = [0.77, -0.3, 0], hs1 = tetraFrom([1, 0, 0], Math.PI).map((d) => add(C1, d, 1.09));
    const d2 = tetraFrom([-1, 0, 0]).sort((a, b) => b[1] - a[1]);
    const OO = add(C2, d2[0], 1.43), hc2 = d2.slice(1).map((d) => add(C2, d, 1.09));
    const h2 = tetraFrom(nrm([C2[0] - OO[0], C2[1] - OO[1], C2[2] - OO[2]])).sort((a, b) => b[0] - a[0]).map((d) => add(OO, d, 0.96));
    return { atoms: [{ el: 'C', p: C1 }, { el: 'C', p: C2 }, { el: 'O', p: OO }, ...hs1.map((p) => ({ el: 'H', p })), ...hc2.map((p) => ({ el: 'H', p })), { el: 'H', p: h2[0] }], bonds: [[0, 1, 1], [1, 2, 1], [0, 3, 1], [0, 4, 1], [0, 5, 1], [1, 6, 1], [1, 7, 1], [2, 8, 1]] as [number, number, number][] };
  })();
  const acetic = (() => {
    const C1: Vec = [-0.76, -0.1, 0], C2: Vec = [0.76, -0.1, 0];
    const hs = tetraFrom([1, 0, 0], Math.PI).map((d) => add(C1, d, 1.09));
    const Od = add(C2, nrm([0.5, 0.866, 0]), 1.21), Os = add(C2, nrm([0.5, -0.866, 0]), 1.34), Ho = add(Os, nrm([0.97, -0.24, 0]), 0.97);
    return { atoms: [{ el: 'C', p: C1 }, { el: 'C', p: C2 }, { el: 'O', p: Od }, { el: 'O', p: Os }, ...hs.map((p) => ({ el: 'H', p })), { el: 'H', p: Ho }], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [0, 4, 1], [0, 5, 1], [0, 6, 1], [3, 7, 1]] as [number, number, number][] };
  })();
  const benzene = (() => {
    const atoms: { el: string; p: Vec }[] = [], bonds: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; atoms.push({ el: 'C', p: [1.39 * Math.cos(a), 1.39 * Math.sin(a), 0] }); }
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; atoms.push({ el: 'H', p: [2.47 * Math.cos(a), 2.47 * Math.sin(a), 0] }); bonds.push([i, (i + 1) % 6, i % 2 ? 1 : 2], [i, i + 6, 1]); }
    return { atoms, bonds };
  })();
  return [
    { name: '水', formula: 'H2O', atoms: [{ el: 'O', p: O }, ...h2o.map((p) => ({ el: 'H', p }))], bonds: [[0, 1, 1], [0, 2, 1]], shape: 'V 形', angle: '104.5°', hybrid: 'sp³（2 对孤电子对）', polar: '极性分子', lone: [{ at: 0, dir: nrm([0, 0.6, 0.8]) }, { at: 0, dir: nrm([0, 0.6, -0.8]) }] },
    { name: '氨', formula: 'NH3', atoms: [{ el: 'N', p: O }, ...nh3.map((p) => ({ el: 'H', p }))], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]], shape: '三角锥形', angle: '107°', hybrid: 'sp³（1 对孤电子对）', polar: '极性分子', lone: [{ at: 0, dir: [0, 1, 0] }] },
    { name: '甲烷', formula: 'CH4', atoms: [{ el: 'C', p: O }, ...TET.map((d) => ({ el: 'H', p: add(O, d, 1.09) }))], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]], shape: '正四面体', angle: '109°28′', hybrid: 'sp³', polar: '非极性分子' },
    { name: '二氧化碳', formula: 'CO2', atoms: [{ el: 'C', p: O }, { el: 'O', p: [1.16, 0, 0] }, { el: 'O', p: [-1.16, 0, 0] }], bonds: [[0, 1, 2], [0, 2, 2]], shape: '直线形', angle: '180°', hybrid: 'sp', polar: '非极性分子' },
    { name: '三氟化硼', formula: 'BF3', atoms: [{ el: 'B', p: O }, ...[0, 1, 2].map((i) => ({ el: 'F', p: [1.31 * Math.cos(Math.PI / 2 + i * 2 * Math.PI / 3), 1.31 * Math.sin(Math.PI / 2 + i * 2 * Math.PI / 3), 0] as Vec }))], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]], shape: '平面三角形', angle: '120°', hybrid: 'sp²', polar: '非极性分子' },
    { name: '二氧化硫', formula: 'SO2', atoms: [{ el: 'S', p: O }, ...bent(119, 1.43).map((p) => ({ el: 'O', p }))], bonds: [[0, 1, 2], [0, 2, 2]], shape: 'V 形', angle: '约 119°', hybrid: 'sp²（1 对孤电子对）', polar: '极性分子', lone: [{ at: 0, dir: [0, 1, 0] }] },
    { name: '甲醛', formula: 'HCHO', atoms: [{ el: 'C', p: O }, { el: 'O', p: [0, 1.21, 0] }, { el: 'H', p: [0.94, -0.54, 0] }, { el: 'H', p: [-0.94, -0.54, 0] }], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]], shape: '平面三角形', angle: '约 120°', hybrid: 'sp²', polar: '极性分子' },
    { name: '乙烯', formula: 'C2H4', atoms: [{ el: 'C', p: [-0.67, 0, 0] }, { el: 'C', p: [0.67, 0, 0] }, { el: 'H', p: [-1.23, 0.93, 0] }, { el: 'H', p: [-1.23, -0.93, 0] }, { el: 'H', p: [1.23, 0.93, 0] }, { el: 'H', p: [1.23, -0.93, 0] }], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]], shape: '平面形（6 个原子共面）', angle: '约 120°', hybrid: 'sp²', polar: '非极性分子' },
    { name: '乙炔', formula: 'C2H2', atoms: [{ el: 'C', p: [-0.6, 0, 0] }, { el: 'C', p: [0.6, 0, 0] }, { el: 'H', p: [-1.66, 0, 0] }, { el: 'H', p: [1.66, 0, 0] }], bonds: [[0, 1, 3], [0, 2, 1], [1, 3, 1]], shape: '直线形（4 个原子共线）', angle: '180°', hybrid: 'sp', polar: '非极性分子' },
    { name: '苯', formula: 'C6H6', ...benzene, shape: '平面正六边形（12 个原子共面）', angle: '120°', hybrid: 'sp²（大 π 键）', polar: '非极性分子' },
    { name: '乙醇', formula: 'C2H5OH', ...ethanol, shape: '—', angle: 'C 原子周围约 109.5°', hybrid: '碳、氧均为 sp³', polar: '极性分子' },
    { name: '乙酸', formula: 'CH3COOH', ...acetic, shape: '—', angle: '羧基碳周围约 120°', hybrid: '甲基碳 sp³，羧基碳 sp²', polar: '极性分子' },
    lattice('nacl'), lattice('cscl'), lattice('diamond'),
  ];
}
export const CPK: Record<string, { c: string; r: number }> = {
  H: { c: '#f4f4f4', r: 0.27 }, C: { c: '#4a4f57', r: 0.4 }, N: { c: '#3b6fe0', r: 0.4 }, O: { c: '#e5402f', r: 0.4 }, F: { c: '#7ad35a', r: 0.36 },
  B: { c: '#f2a98a', r: 0.4 }, S: { c: '#e9c733', r: 0.48 }, Cl: { c: '#3fc24a', r: 0.55 }, Na: { c: '#9b5cf0', r: 0.34 }, Cs: { c: '#2bb3a2', r: 0.5 },
};
