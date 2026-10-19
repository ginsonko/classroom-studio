// 数学 / 化学演示验收（纯逻辑 + 服务端渲染）：npx rolldown test/demos-logic.ts -o .out/demos-logic.mjs -p node && node .out/demos-logic.mjs
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import { DEMOS, demosOf, guessDemo, makeDemo, isKitDemo } from '../src/demos';
import { clampDemo, defaults, themeOf } from '../src/demos/kit';
import { REACTIONS, balance, boxes, configOf, configText, formulaTex, molecules, parseEquation, parseFormula, placeOf, shortConfig, tally, titrationPH, valenceOf } from '../src/demos/chemCore';
import { binom, centers, projectSolid } from '../src/demos/mathDemos';
import { equilibriumAt } from '../src/demos/chemDemos';
import { parsePick, pickByRules, pickPrompt } from '../src/demos/pick';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

ok('目录：数学 12 个、化学 6 个，id 唯一，参数默认值在范围内', () => {
  assert.equal(demosOf('math').length, 12); assert.equal(demosOf('chem').length, 6); assert.equal(demosOf('physics').length, 0);
  assert.equal(new Set(DEMOS.map((d) => d.id)).size, DEMOS.length);
  for (const d of DEMOS) for (const p of d.params) {
    assert.ok(p.def >= p.min && p.def <= p.max, `${d.id}.${p.key}`);
    if (p.options) assert.ok(p.options.some((o) => o.v === p.def), `${d.id}.${p.key} default option`);
  }
});

ok('化学式解析：括号、结晶水、离子电荷', () => {
  assert.deepEqual(parseFormula('Ca(OH)2'), { Ca: 1, O: 2, H: 2 });
  assert.deepEqual(parseFormula('CuSO4·5H2O'), { Cu: 1, S: 1, O: 9, H: 10 });
  assert.deepEqual(parseFormula('Na[Al(OH)4]'), { Na: 1, Al: 1, O: 4, H: 4 });
  assert.deepEqual(parseFormula('Fe^3+'), { Fe: 1, '+': 3 });
  assert.deepEqual(parseFormula('MnO4^-'), { Mn: 1, O: 4, '+': -1 });
  assert.deepEqual(parseFormula('SO₄²⁻'), { S: 1, O: 4, '+': -2 });
  assert.deepEqual(parseFormula('e-'), { '+': -1 });
  assert.equal(parseFormula('Xx(('), null);
  assert.equal(formulaTex('Fe^3+'), '\\mathrm{Fe}^{3+}');
  assert.equal(formulaTex('CuSO4·5H2O'), '\\mathrm{CuSO_{4}\\cdot 5H_{2}O}');
});

ok('配平：目录里每个反应都能唯一配平，且原子、电荷守恒', () => {
  const expect: Record<string, number[]> = {
    'KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O': [2, 16, 2, 2, 5, 8],
    'Cu + HNO3 = Cu(NO3)2 + NO + H2O': [3, 8, 3, 2, 4],
    'FeS2 + O2 = Fe2O3 + SO2': [4, 11, 2, 8],
    'MnO4^- + Fe^2+ + H^+ = Mn^2+ + Fe^3+ + H2O': [1, 5, 8, 1, 5, 4],
    'Al + NaOH + H2O = Na[Al(OH)4] + H2': [2, 2, 6, 2, 3],
    'NH3 + O2 = NO + H2O': [4, 5, 4, 6],
  };
  for (const r of REACTIONS) {
    const eq = parseEquation(r.eq); assert.ok(eq, r.eq);
    const c = balance(eq!); assert.ok(c, 'balance ' + r.eq);
    assert.ok(tally(eq!, c!).every((x) => x.left === x.right), 'conserved ' + r.eq);
    if (expect[r.eq]) assert.deepEqual(c, expect[r.eq], r.eq);
  }
  assert.ok(tally(parseEquation('H2 + O2 = H2O')!, [1, 1, 1]).some((x) => x.left !== x.right));
  assert.equal(balance(parseEquation('H2 + O2 = H2O2 + H2O')!), null, '多组解不硬配');
  assert.deepEqual(balance(parseEquation('2H2 + O2 = 2H2O')!), [2, 1, 2], '带系数输入也能读');
});

ok('电子排布：Fe、Cr、Cu 特例、周期表位置、轨道表示式', () => {
  assert.equal(configText(configOf(26)), '1s²2s²2p⁶3s²3p⁶3d⁶4s²');
  assert.equal(shortConfig(24), '[Ar]3d⁵4s¹');
  assert.equal(shortConfig(29), '[Ar]3d¹⁰4s¹');
  assert.equal(shortConfig(35), '[Ar]3d¹⁰4s²4p⁵');
  assert.deepEqual(placeOf(26), { period: 4, col: 8, group: 'Ⅷ 族', block: 'd' });
  assert.equal(placeOf(17).group, 'ⅦA 族'); assert.equal(placeOf(18).group, '0 族'); assert.equal(placeOf(30).block, 'ds'); assert.equal(placeOf(2).block, 's');
  assert.equal(placeOf(21).group, 'ⅢB 族'); assert.equal(placeOf(29).group, 'ⅠB 族');
  assert.deepEqual(valenceOf(26).map((s) => s.n + 'spd'[s.l] + s.e), ['3d6', '4s2']);
  assert.deepEqual(valenceOf(16).map((s) => s.n + 'spd'[s.l] + s.e), ['3s2', '3p4']);
  assert.deepEqual(boxes({ n: 2, l: 1, e: 4 }), [2, 1, 1]);
  assert.deepEqual(boxes({ n: 3, l: 2, e: 6 }), [2, 1, 1, 1, 1]);
  for (let Z = 1; Z <= 36; Z++) assert.equal(configOf(Z).reduce((s, x) => s + x.e, 0), Z);
});

ok('滴定 pH：起点、恰好中和、过量', () => {
  const near = (a: number, b: number, e = 0.05) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
  near(titrationPH(20, 0.1, 0, 0.1, 1e8), 1);
  near(titrationPH(20, 0.1, 20, 0.1, 1e8), 7);
  near(titrationPH(20, 0.1, 19.98, 0.1, 1e8), 4.3, 0.1);
  near(titrationPH(20, 0.1, 20.02, 0.1, 1e8), 9.7, 0.1);
  near(titrationPH(20, 0.1, 0, 0.1, 1.75e-5), 2.88, 0.05);
  near(titrationPH(20, 0.1, 10, 0.1, 1.75e-5), 4.76, 0.05);
  near(titrationPH(20, 0.1, 20, 0.1, 1.75e-5), 8.73, 0.08);
});

ok('平衡移动：K 不随浓度变，升温逆向，催化剂不移动', () => {
  const p = { kf: 0.4, kb: 0.2, cond: 1 };
  const s0 = equilibriumAt(p, 9.99); assert.ok(Math.abs(s0.B / s0.A - 2) < 0.02);
  const s1 = equilibriumAt(p, 30); assert.ok(Math.abs(s1.B / s1.A - 2) < 0.01); assert.ok(s1.B > s0.B);
  const hot = equilibriumAt({ ...p, cond: 3 }, 30); assert.ok(hot.B / hot.A < 1.01 && hot.B / hot.A > 0.99, 'K 从 2 变成 1');
  const cat = equilibriumAt({ ...p, cond: 4 }, 30); assert.ok(Math.abs(cat.A - s0.A) < 0.01);
});

ok('三角形四心：坐标、欧拉线、钝角时外心在外', () => {
  const k = centers([0, 0], [4, 0], [0, 3]);
  assert.deepEqual(k.G.map((v) => +v.toFixed(6)), [1.333333, 1]);
  assert.deepEqual(k.O.map((v) => +v.toFixed(6)), [2, 1.5]);
  assert.deepEqual(k.I.map((v) => +v.toFixed(6)), [1, 1]);
  assert.deepEqual(k.H.map((v) => +v.toFixed(6)), [0, 0]);
  assert.ok(Math.abs(k.R - 2.5) < 1e-9 && Math.abs(k.r - 1) < 1e-9 && Math.abs(k.area - 6) < 1e-9);
  const o = centers([-5, 0], [5, 0], [4, 1]);
  assert.ok(o.O[1] < 0, '钝角三角形外心在三角形外');
});

ok('立体几何：正方体正面看到 9 条实线、3 条虚线', () => {
  const { edges } = projectSolid(1, 0.6, 0.35);
  assert.equal(edges.length, 12);
  assert.equal(edges.filter((e) => e.visible).length, 9);
  const t = projectSolid(2, 0.5, 0.3); assert.equal(t.edges.length, 6);
});

ok('二项分布概率和为 1', () => { assert.ok(Math.abs(binom(10, 0.3).reduce((a, b) => a + b, 0) - 1) < 1e-12); });

ok('分子模型：键长合理（H 与相连原子 0.9–1.2 Å）', () => {
  for (const m of molecules()) if (!m.crystal) for (const [a, b] of m.bonds) {
    const A = m.atoms[a], B = m.atoms[b];
    if (A.el === 'H' || B.el === 'H') { const d = Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1], A.p[2] - B.p[2]); assert.ok(d > 0.9 && d < 1.2, `${m.name} ${A.el}-${B.el} ${d}`); }
    for (let i = 0; i < m.atoms.length; i++) for (let j = i + 1; j < m.atoms.length; j++) { const P = m.atoms[i].p, Q = m.atoms[j].p; assert.ok(Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]) > 0.75, `${m.name} 原子 ${i},${j} 太近`); }
  }
  const nacl = molecules().find((m) => m.formula === 'NaCl')!; assert.equal(nacl.atoms.length, 27); assert.equal(nacl.bonds.length, 54);
  const dia = molecules().find((m) => m.name === '金刚石晶胞')!; assert.equal(dia.bonds.filter((b) => b[2] === 0).length, 16);
});

ok('每个演示在各种参数和时刻都能渲染，没有 NaN，公式都能排版', () => {
  for (const skin of ['white', 'slate'] as const) for (const d of DEMOS) {
    const th = themeOf(skin);
    const variants = [defaults(d), clampDemo(d, Object.fromEntries(d.params.map((p) => [p.key, p.min]))), clampDemo(d, Object.fromEntries(d.params.map((p) => [p.key, p.max])))];
    for (const p of d.params) if (p.options) for (const o of p.options) variants.push(clampDemo(d, { ...defaults(d), [p.key]: o.v }));
    for (const p of variants) for (const t of [0, d.duration * 0.37, d.duration]) {
      const mat = makeDemo(d.id, p);
      const ctx = { mat, th };
      const html = renderToStaticMarkup(createElement('svg', null, d.view(p, t, ctx)));
      assert.ok(!/NaN|Infinity/.test(html), `${d.id} ${JSON.stringify(p)} t=${t}: ${(/.{60}(NaN|Infinity).{20}/.exec(html) ?? [''])[0]}`);
      for (const f of d.formulas?.(p, t, ctx) ?? []) katex.renderToString(f.tex, { throwOnError: true, strict: 'error' });
      for (const r of d.info?.(p, t, ctx) ?? []) assert.ok(!/NaN/.test(r.v), d.id + ' info ' + r.k);
    }
  }
});

ok('自定义方程式：makeDemo 带 text，配平演示按 text 渲染', () => {
  const m = makeDemo('c.balance', { rx: 0 }, { text: 'Fe + HNO3 = Fe(NO3)3 + NO + H2O' });
  assert.ok(isKitDemo(m)); assert.equal(m.scene?.text, 'Fe + HNO3 = Fe(NO3)3 + NO + H2O');
  assert.deepEqual(balance(parseEquation(m.scene!.text!)!), [1, 4, 1, 1, 2]);
});

ok('挑演示：关键词规则 + 模型 JSON 校验', () => {
  assert.equal(guessDemo('已知椭圆 x²/25+y²/9=1 的两个焦点为 F1、F2', 'math')?.id, 'm.conic');
  assert.equal(guessDemo('函数 y=2sin(2x+π/3) 的周期和振幅', 'math')?.id, 'm.trig');
  assert.equal(guessDemo('用 0.1 mol/L NaOH 滴定 20 mL 醋酸，选择指示剂', 'chem')?.id, 'c.titration');
  assert.equal(guessDemo('判断 NH3 分子的空间构型和杂化方式', 'chem')?.id, 'c.molecule');
  assert.equal(pickByRules('配平：KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O', 'chem')?.mat.scene?.text, 'KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O');
  assert.ok(pickPrompt('x', 'math', false).includes('m.conic'));
  const pk = parsePick('好的：{"id":"m.conic","params":{"type":1,"a":5,"b":3,"zz":9},"title":"椭圆的定义","note":"题目给出 a=5,b=3"}', 'math')!;
  assert.equal(pk.mat.scene?.preset, 'm.conic'); assert.equal(pk.mat.scene?.params?.a, 5); assert.equal(pk.mat.scene?.params?.zz, undefined);
  assert.equal(parsePick('{"id":"c.molecule"}', 'math'), null, '不能跨学科');
  const bal = parsePick('{"id":"c.balance","equation":"Fe + HNO3 = Fe(NO3)3 + NO + H2O","title":"配平"}', 'chem')!;
  assert.equal(bal.mat.scene?.params?.rx, 0); assert.ok(bal.mat.scene?.text?.includes('HNO3'));
  const lib = parsePick('{"id":"c.balance","equation":"Cu + HNO3 = Cu(NO3)2 + NO + H2O"}', 'chem')!;
  assert.equal(lib.mat.scene?.params?.rx, 13);
  const over = parsePick('{"id":"m.quad","params":{"a":99}}', 'math')!; assert.equal(over.mat.scene?.params?.a, 3); assert.ok(over.issues.length);
});

console.log(`\n${n} 组通过`);
