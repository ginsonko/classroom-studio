// 内置资料：常见分子的球棍坐标、晶胞、元素配色、简化的大陆轮廓（地球贴图用）。
// 坐标单位为埃（Å），渲染时整体缩放。

export type V3 = [number, number, number];
export interface Mol { atoms: [string, number, number, number][]; bonds: [number, number, number][]; title: string; angle?: { at: number; a: number; b: number; text: string } }

export const ELEMENT: Record<string, { color: string; r: number; name: string }> = {
  H: { color: '#f4f6fa', r: 0.31, name: '氢' }, C: { color: '#3a3f4a', r: 0.76, name: '碳' }, N: { color: '#3d6bff', r: 0.71, name: '氮' },
  O: { color: '#ff3b3b', r: 0.66, name: '氧' }, F: { color: '#8fe36b', r: 0.57, name: '氟' }, Cl: { color: '#2fd36b', r: 1.02, name: '氯' },
  Br: { color: '#a52a2a', r: 1.2, name: '溴' }, I: { color: '#8b3fd9', r: 1.39, name: '碘' }, S: { color: '#f5d33c', r: 1.05, name: '硫' },
  P: { color: '#ff9a2e', r: 1.07, name: '磷' }, Na: { color: '#a77bff', r: 1.0, name: '钠' }, K: { color: '#8f40d4', r: 1.2, name: '钾' },
  Mg: { color: '#7bd36b', r: 1.0, name: '镁' }, Ca: { color: '#4fd18f', r: 1.1, name: '钙' }, Fe: { color: '#e0773a', r: 1.1, name: '铁' },
  Cu: { color: '#d9894a', r: 1.1, name: '铜' }, Cs: { color: '#5bc0eb', r: 1.4, name: '铯' }, Si: { color: '#d8b48a', r: 1.11, name: '硅' },
  Al: { color: '#c8ccd6', r: 1.15, name: '铝' }, Zn: { color: '#8f96b8', r: 1.1, name: '锌' }, M: { color: '#c0c6d4', r: 1.1, name: '金属' },
};
export const elementOf = (s: string) => ELEMENT[s] ?? ELEMENT[s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()] ?? { color: '#e879f9', r: 0.8, name: s };

const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** 已知一个键的方向 d，补齐其余三个四面体方向（109.5°），roll 控制绕 d 的转角 */
function tetra(d: V3, roll = 0): V3[] {
  const u = norm(d), ref: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const p = norm(cross(u, ref)), q = cross(u, p), c = Math.cos((109.47 * Math.PI) / 180), s = Math.sin((109.47 * Math.PI) / 180);
  return [0, 1, 2].map((k) => { const a = roll + (k * 2 * Math.PI) / 3; return norm(add(add([u[0] * c, u[1] * c, u[2] * c], p, s * Math.cos(a)), q, s * Math.sin(a))); });
}

function build(title: string, heavy: [string, V3][], bonds: [number, number, number][], hs: [number, V3][], angle?: Mol['angle']): Mol {
  const atoms: Mol['atoms'] = heavy.map(([e, p]) => [e, ...p]);
  const b = [...bonds];
  for (const [at, dir] of hs) {
    const c = heavy[at][1], len = heavy[at][0] === 'O' ? 0.96 : heavy[at][0] === 'N' ? 1.01 : 1.09;
    atoms.push(['H', ...add(c, norm(dir), len)]);
    b.push([at, atoms.length - 1, 1]);
  }
  return { title, atoms, bonds: b, angle };
}

function molecules(): Record<string, Mol> {
  const r = (deg: number) => (deg * Math.PI) / 180;
  const ch4h = [[0, 1, 0] as V3, ...tetra([0, 1, 0])];
  const C2 = 1.54;
  // 乙醇：C1—C2—O
  // 锯齿形主链，键角按 sp3 取 109.5°
  const eC1: V3 = [-1.25, -0.25, 0], eC2: V3 = [0.2, 0.3, 0], eO: V3 = [1.124, -0.791, 0];
  const d12 = norm([eC2[0] - eC1[0], eC2[1] - eC1[1], 0]);
  // 有两个重原子邻居的 sp3 原子：两个 H 在两键角平分线的反方向两侧
  const sp3Pair = (c: V3, n1: V3, n2: V3): V3[] => {
    const a = norm([n1[0] - c[0], n1[1] - c[1], n1[2] - c[2]]), b = norm([n2[0] - c[0], n2[1] - c[1], n2[2] - c[2]]);
    const m = norm([-(a[0] + b[0]), -(a[1] + b[1]), -(a[2] + b[2])]), n = norm(cross(a, b)), k = (54.75 * Math.PI) / 180;
    return [add([m[0] * Math.cos(k), m[1] * Math.cos(k), m[2] * Math.cos(k)], n, Math.sin(k)), add([m[0] * Math.cos(k), m[1] * Math.cos(k), m[2] * Math.cos(k)], n, -Math.sin(k))];
  };
  const eth = build('乙醇 C₂H₅OH', [['C', eC1], ['C', eC2], ['O', eO]], [[0, 1, 1], [1, 2, 1]], [
    ...tetra([d12[0], d12[1], 0], 0.5).map((v) => [0, v] as [number, V3]),
    ...sp3Pair(eC2, eC1, eO).map((v) => [1, v] as [number, V3]),
    [2, [0.93, 0.37, 0]],
  ]);
  // 乙酸：C1—C2(=O)—O—H
  const aC1: V3 = [-1.3, 0, 0], aC2: V3 = [0.2, 0, 0];
  const acid = build('乙酸 CH₃COOH', [['C', aC1], ['C', aC2], ['O', [0.85, 1.05, 0]], ['O', [0.9, -1.15, 0]]], [[0, 1, 1], [1, 2, 2], [1, 3, 1]], [
    ...tetra([1, 0, 0], 0.3).map((v) => [0, v] as [number, V3]), [3, [0.9, -0.35, 0]],
  ]);
  const met = build('甲醇 CH₃OH', [['C', [-0.7, 0, 0]], ['O', [0.72, 0, 0]]], [[0, 1, 1]], [...tetra([1, 0, 0], 0.4).map((v) => [0, v] as [number, V3]), [1, [0.35, -0.94, 0]]]);
  const benz: Mol = { title: '苯 C₆H₆', atoms: [], bonds: [] };
  for (let k = 0; k < 6; k++) { const a = r(60 * k + 30); benz.atoms.push(['C', 1.39 * Math.cos(a), 1.39 * Math.sin(a), 0]); }
  for (let k = 0; k < 6; k++) { const a = r(60 * k + 30); benz.atoms.push(['H', 2.48 * Math.cos(a), 2.48 * Math.sin(a), 0]); benz.bonds.push([k, (k + 1) % 6, k % 2 ? 1 : 2], [k, k + 6, 1]); }
  const nh: V3[] = [0, 120, 240].map((a) => [0.94 * Math.cos(r(a)), -0.37, 0.94 * Math.sin(r(a))] as V3);
  const h2o: V3 = [0.759, -0.588, 0];
  return {
    H2: { title: '氢气 H₂', atoms: [['H', -0.37, 0, 0], ['H', 0.37, 0, 0]], bonds: [[0, 1, 1]] },
    O2: { title: '氧气 O₂', atoms: [['O', -0.6, 0, 0], ['O', 0.6, 0, 0]], bonds: [[0, 1, 2]] },
    N2: { title: '氮气 N₂', atoms: [['N', -0.55, 0, 0], ['N', 0.55, 0, 0]], bonds: [[0, 1, 3]] },
    Cl2: { title: '氯气 Cl₂', atoms: [['Cl', -1.0, 0, 0], ['Cl', 1.0, 0, 0]], bonds: [[0, 1, 1]] },
    HCl: { title: '氯化氢 HCl', atoms: [['H', -0.64, 0, 0], ['Cl', 0.64, 0, 0]], bonds: [[0, 1, 1]] },
    H2O: { title: '水 H₂O', atoms: [['O', 0, 0.25, 0], ['H', -h2o[0], 0.25 + h2o[1], 0], ['H', h2o[0], 0.25 + h2o[1], 0]], bonds: [[0, 1, 1], [0, 2, 1]], angle: { at: 0, a: 1, b: 2, text: '104.5°' } },
    CO2: { title: '二氧化碳 CO₂', atoms: [['C', 0, 0, 0], ['O', -1.16, 0, 0], ['O', 1.16, 0, 0]], bonds: [[0, 1, 2], [0, 2, 2]], angle: { at: 0, a: 1, b: 2, text: '180°' } },
    SO2: { title: '二氧化硫 SO₂', atoms: [['S', 0, 0.3, 0], ['O', -1.24, -0.42, 0], ['O', 1.24, -0.42, 0]], bonds: [[0, 1, 2], [0, 2, 2]], angle: { at: 0, a: 1, b: 2, text: '119°' } },
    NH3: { title: '氨 NH₃', atoms: [['N', 0, 0.2, 0], ...nh.map((p) => ['H', p[0], p[1] + 0.2, p[2]] as [string, number, number, number])], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]], angle: { at: 0, a: 1, b: 2, text: '107°' } },
    CH4: { title: '甲烷 CH₄', atoms: [['C', 0, 0, 0], ...ch4h.map((v) => ['H', v[0] * 1.09, v[1] * 1.09, v[2] * 1.09] as [string, number, number, number])], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]], angle: { at: 0, a: 1, b: 2, text: '109°28′' } },
    C2H4: { title: '乙烯 C₂H₄', atoms: [['C', -0.67, 0, 0], ['C', 0.67, 0, 0], ['H', -1.24, 0.93, 0], ['H', -1.24, -0.93, 0], ['H', 1.24, 0.93, 0], ['H', 1.24, -0.93, 0]], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]], angle: { at: 0, a: 2, b: 1, text: '约 120°' } },
    C2H2: { title: '乙炔 C₂H₂', atoms: [['C', -0.6, 0, 0], ['C', 0.6, 0, 0], ['H', -1.66, 0, 0], ['H', 1.66, 0, 0]], bonds: [[0, 1, 3], [0, 2, 1], [1, 3, 1]], angle: { at: 0, a: 2, b: 1, text: '180°' } },
    C2H6: (() => { const m = build('乙烷 C₂H₆', [['C', [-C2 / 2, 0, 0]], ['C', [C2 / 2, 0, 0]]], [[0, 1, 1]], [...tetra([1, 0, 0]).map((v) => [0, v] as [number, V3]), ...tetra([-1, 0, 0], Math.PI / 3).map((v) => [1, v] as [number, V3])]); return m; })(),
    C6H6: benz, C2H5OH: eth, CH3COOH: acid, CH3OH: met,
  };
}
let MOLS: Record<string, Mol> | null = null;
const MOL_ALIAS: Record<string, string> = {
  水: 'H2O', 甲烷: 'CH4', 氨: 'NH3', 氨气: 'NH3', 二氧化碳: 'CO2', 乙烯: 'C2H4', 乙炔: 'C2H2', 乙烷: 'C2H6', 苯: 'C6H6', benzene: 'C6H6',
  乙醇: 'C2H5OH', 酒精: 'C2H5OH', ethanol: 'C2H5OH', CH3CH2OH: 'C2H5OH', C2H6O: 'C2H5OH', 乙酸: 'CH3COOH', 醋酸: 'CH3COOH', C2H4O2: 'CH3COOH', 甲醇: 'CH3OH',
  氢气: 'H2', 氧气: 'O2', 氮气: 'N2', 氯气: 'Cl2', 氯化氢: 'HCl', 二氧化硫: 'SO2', water: 'H2O', methane: 'CH4', ammonia: 'NH3', ethylene: 'C2H4', acetylene: 'C2H2',
};
export function moleculeByName(name: string): Mol | null {
  MOLS ??= molecules();
  const raw = String(name || '').trim();
  const key = raw.replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)).replace(/\s/g, '');
  return MOLS[key] ?? MOLS[MOL_ALIAS[key] ?? MOL_ALIAS[raw] ?? ''] ?? MOLS[Object.keys(MOLS).find((k) => k.toLowerCase() === key.toLowerCase()) ?? ''] ?? null;
}
export const MOLECULE_NAMES = () => { MOLS ??= molecules(); return Object.keys(MOLS); };

/** 按距离自动连键（自定义分子没给 bonds 时） */
export function autoBonds(atoms: Mol['atoms']): Mol['bonds'] {
  const out: Mol['bonds'] = [];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j], d = Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]);
    if (d > 0.3 && d < 1.25 * (elementOf(a[0]).r + elementOf(b[0]).r)) out.push([i, j, 1]);
  }
  return out;
}

export interface Crystal { title: string; atoms: [string, number, number, number][]; bonds: [number, number][]; edge: number; note: string }
/** 晶胞，坐标以晶胞边长为 1，中心在原点 */
export function crystalByName(name: string): Crystal {
  const atoms: Crystal['atoms'] = [], bonds: [number, number][] = [];
  const pos = (e: string, x: number, y: number, z: number) => atoms.push([e, x - 0.5, y - 0.5, z - 0.5]);
  const grid = [0, 0.5, 1];
  if (name === 'CsCl') {
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) pos('Cl', x, y, z);
    pos('Cs', 0.5, 0.5, 0.5);
    return { title: '氯化铯晶胞', atoms, bonds: [], edge: 1, note: 'Cs⁺ 配位数 8' };
  }
  if (name === 'bcc' || name === 'fcc') {
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) pos('M', x, y, z);
    if (name === 'bcc') pos('M', 0.5, 0.5, 0.5);
    else for (const [x, y, z] of [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]]) pos('M', x, y, z);
    return { title: name === 'bcc' ? '体心立方堆积' : '面心立方堆积', atoms, bonds: [], edge: 1, note: name === 'bcc' ? '每个晶胞 2 个原子，配位数 8' : '每个晶胞 4 个原子，配位数 12' };
  }
  if (name === 'diamond' || name === 'graphite') {
    if (name === 'graphite') {
      const a = 0.2, s3 = Math.sqrt(3);
      for (const layer of [-0.35, 0.35]) for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
        for (const oz of [0, a]) {
          const x = i * s3 * a + j * (s3 / 2) * a + (layer > 0 ? (s3 / 2) * a : 0), z = j * 1.5 * a + oz + (layer > 0 ? a / 2 : 0);
          if (Math.hypot(x, z) < 0.75) atoms.push(['C', x, layer, z]);
        }
      }
      for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) { const p = atoms[i], q = atoms[j]; if (Math.abs(p[2] - q[2]) < 1e-6 && Math.hypot(p[1] - q[1], p[3] - q[3]) < a * 1.05) bonds.push([i, j]); }
      return { title: '石墨的层状结构', atoms, bonds, edge: 0, note: '层内共价键，层间范德华力' };
    }
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) pos('C', x, y, z);
    for (const [x, y, z] of [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]]) pos('C', x, y, z);
    for (const [x, y, z] of [[0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]]) pos('C', x, y, z);
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) { const p = atoms[i], q = atoms[j]; if (Math.abs(Math.hypot(p[1] - q[1], p[2] - q[2], p[3] - q[3]) - Math.sqrt(3) / 4) < 0.02) bonds.push([i, j]); }
    return { title: '金刚石晶胞', atoms, bonds, edge: 1, note: '每个碳原子与 4 个碳原子形成正四面体' };
  }
  for (const x of grid) for (const y of grid) for (const z of grid) pos(((x + y + z) * 2) % 2 === 0 ? 'Cl' : 'Na', x, y, z);
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) { const p = atoms[i], q = atoms[j]; if (Math.abs(Math.hypot(p[1] - q[1], p[2] - q[2], p[3] - q[3]) - 0.5) < 0.01) bonds.push([i, j]); }
  return { title: '氯化钠晶胞', atoms, bonds, edge: 1, note: 'Na⁺ 与 Cl⁻ 配位数都是 6' };
}

/** 简化的大陆轮廓（经度, 纬度），只用于示意性的地球贴图 */
export const CONTINENTS: number[][] = [
  // 北美
  [-168, 66, -162, 70, -140, 70, -125, 72, -110, 75, -95, 73, -80, 73, -65, 67, -60, 60, -55, 52, -66, 45, -70, 42, -76, 35, -81, 30, -80, 25, -84, 30, -90, 29, -97, 27, -97, 21, -92, 18, -87, 21, -88, 15, -83, 10, -79, 8, -86, 12, -92, 15, -105, 20, -110, 24, -112, 30, -117, 32, -124, 40, -124, 48, -132, 55, -140, 60, -150, 61, -158, 57, -165, 60],
  // 格陵兰
  [-52, 60, -43, 60, -22, 70, -18, 77, -30, 83, -60, 82, -72, 78, -56, 70],
  // 南美
  [-80, 9, -72, 12, -62, 10, -50, 0, -35, -5, -39, -14, -48, -26, -58, -34, -63, -40, -68, -52, -74, -52, -73, -40, -71, -30, -70, -18, -76, -14, -81, -5, -80, 1, -77, 7],
  // 欧亚
  [-10, 36, -9, 43, -2, 44, -4, 48, 0, 50, 5, 53, 8, 57, 5, 62, 15, 69, 28, 71, 40, 67, 60, 70, 80, 73, 100, 77, 120, 73, 140, 72, 160, 70, 180, 68, 180, 64, 170, 60, 162, 56, 156, 51, 142, 50, 140, 43, 130, 42, 127, 38, 126, 35, 122, 40, 121, 32, 119, 25, 110, 21, 108, 16, 109, 12, 105, 9, 100, 13, 99, 8, 103, 1, 98, 8, 98, 16, 92, 22, 88, 21, 80, 15, 77, 8, 73, 17, 70, 22, 62, 25, 57, 26, 59, 22, 52, 16, 44, 12, 42, 15, 39, 22, 35, 28, 34, 31, 36, 36, 30, 36, 27, 37, 26, 41, 23, 40, 22, 37, 19, 40, 13, 45, 12, 44, 16, 40, 15, 38, 8, 44, 3, 43, 0, 39, -6, 36],
  // 非洲
  [-17, 21, -16, 15, -12, 8, -5, 5, 5, 5, 9, 4, 9, -1, 12, -6, 13, -12, 12, -18, 15, -27, 18, -34, 26, -34, 33, -28, 35, -22, 40, -15, 40, -6, 44, 0, 51, 11, 43, 12, 38, 18, 33, 28, 32, 31, 20, 32, 10, 37, 0, 36, -9, 32, -10, 28],
  // 澳大利亚
  [114, -22, 114, -34, 118, -35, 124, -33, 132, -31, 138, -35, 141, -38, 147, -38, 150, -37, 153, -30, 153, -25, 146, -19, 142, -11, 136, -12, 130, -12, 125, -15, 122, -18],
  // 英国、日本、马达加斯加、加里曼丹、苏门答腊、新几内亚
  [-5, 50, 1, 51, 0, 53, -2, 56, -5, 58, -6, 55, -3, 54],
  [130, 31, 135, 34, 140, 35, 142, 39, 141, 45, 145, 44, 141, 41, 138, 37, 133, 33],
  [44, -25, 47, -25, 50, -15, 49, -12, 44, -17],
  [109, 1, 117, 7, 119, 0, 116, -4, 110, -3],
  [95, 5, 104, -3, 106, -6, 101, -2],
  [131, -1, 141, -3, 150, -10, 141, -9, 134, -4],
  // 南极
  [-180, -70, -120, -73, -60, -64, 0, -70, 60, -67, 120, -66, 180, -70, 180, -90, -180, -90],
];
