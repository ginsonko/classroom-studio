// 讲题 → 板书排版的离线验收：公式是真正的 TeX 公式笔迹（按 MathJax 实际尺寸），中文是文字笔迹，互不重叠、不出界。
// 用法：npx tsx test/explain-board.ts
import assert from 'node:assert/strict';
import { compileTex } from '../src/ink/tex';
import { boardStroke, explainPages, splitInline, splitRelations, flatText, type Measure } from '../src/lib/explainBoard';
import { charW, PAGE_H } from '../src/lib/boardLayout';
import { sanitizeTex } from '../src/lib/formulaText';
import type { Explain } from '../src/physics/sim/aiSchema';
import type { Stroke } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };
let compiled = 0;
const measure: Measure = (t) => { compiled++; try { const s = compileTex(t); return s.w > 0 && s.h > 0 ? { w: s.w, h: s.h } : null; } catch { return null; } };
let id = 0;
const make = boardStroke(() => 's' + ++id);

const box = (s: Stroke) => {
  if (s.tex) return { x0: s.pts[0], y0: s.pts[1], x1: s.pts[3], y1: s.pts[4] };
  const fs = Math.max(0.016, s.size * 0.008), lines = (s.text ?? '').split('\n');
  return { x0: s.pts[0], y0: s.pts[1], x1: s.pts[0] + Math.max(...lines.map((l) => [...l].reduce((a, c) => a + charW(c), 0))) * fs, y1: s.pts[1] + lines.length * fs * 1.35 };
};
function checkPage(strokes: Stroke[], what: string) {
  const bs = strokes.map((s) => ({ s, b: box(s) }));
  for (const { s, b } of bs) {
    assert.ok(b.x0 >= 0.05 && b.x1 <= 0.95 + 1e-6, `${what}: 横向出界 ${s.text} ${JSON.stringify(b)}`);
    assert.ok(b.y0 >= 0.03 && b.y1 <= PAGE_H - 0.03 + 1e-6, `${what}: 纵向出界 ${s.text} ${JSON.stringify(b)}`);
    if (s.tex) assert.ok(b.x1 > b.x0 && b.y1 > b.y0, 'tex box has size');
  }
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i].b, c = bs[j].b;
    const ov = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > 1e-4 && Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0) > 1e-4;
    assert.ok(!ov, `${what}: 重叠「${bs[i].s.text}」和「${bs[j].s.text}」 ${JSON.stringify(a)} ${JSON.stringify(c)}`);
  }
}

const FRICTION: Explain = {
  title: '摩擦平衡问题', problem: '', idea: '两物体均恰好处于平衡，水平方向拉力等于最大静摩擦力；绳子拉力相同，分别列两物体的水平、竖直方向关系并消去拉力。',
  steps: [
    { t: '对 A 受力，列水平方向平衡及最大静摩擦力关系', tex: 'T\\cos 53^\\circ=\\mu\\left(m_A g-T\\sin 53^\\circ\\right)', plain: 'T cos53°=μ(m_Ag−T sin53°)' },
    { t: '代入三角函数值，整理 A 的质量关系', tex: '\\mu m_A g=T(0.6+0.8\\mu)', plain: 'μm_Ag=T(0.6+0.8μ)' },
    { t: '对 B 受力，列水平方向平衡及最大静摩擦力关系', tex: 'T\\cos 37^\\circ=\\mu\\left(m_B g-T\\sin 37^\\circ\\right)', plain: '' },
    { t: '代入三角函数值并求质量比', tex: '\\frac{m_A}{m_B}=\\frac{0.6+0.8\\mu}{0.8+0.6\\mu}=\\frac{4\\mu+3}{3\\mu+4}', plain: '' },
  ],
  answer: '$\\frac{m_A}{m_B}=\\frac{4\\mu+3}{3\\mu+4}$，选 A。', pitfalls: ['拉力斜向上时支持力 $N=mg-T\\sin\\theta$，不是 $mg$', '最大静摩擦力用 $\\mu N$'],
};

ok('splitInline / flatText / splitRelations', () => {
  assert.deepEqual(splitInline('答 $x=1$，或 \\(y\\)'), [{ tex: false, s: '答 ' }, { tex: true, s: 'x=1' }, { tex: false, s: '，或 ' }, { tex: true, s: 'y' }]);
  assert.equal(flatText('速度 $v_0=2$ m/s，a_1'), '速度 v₀=2 m/s，a₁');
  assert.deepEqual(splitRelations('\\frac{a}{b}=\\frac{c=d}{e}=f\\left(x=1\\right)\\le 3'), ['\\frac{a}{b}', '=\\frac{c=d}{e}', '=f\\left(x=1\\right)\\le 3']);
  assert.deepEqual(splitRelations('a\\\\b=c'), ['a\\\\b=c']);
});

ok('model writes Unicode symbols inside $…$: sanitized to TeX commands and still rendered', () => {
  assert.equal(sanitizeTex('(2- √3,0)'), '(2- \\sqrt{3},0)');
  assert.equal(sanitizeTex('v=2√(x+1) m/s，θ=53°'), 'v=2\\sqrt{x+1} m/s，\\theta =53^\\circ');
  assert.equal(sanitizeTex('\\text{角度 θ=53°}'), '\\text{角度 θ=53°}', 'inside \\text{} untouched');
  const e: Explain = { ...FRICTION, steps: [{ t: 'Unicode 公式', tex: 'x=2± √3，x>0°', plain: '' }], answer: '交点 $(2- √3,0)$ 和 $(2+ √3,0)$', pitfalls: [] };
  const p = explainPages(e, measure, make)[0];
  checkPage(p, 'unicode');
  const st = p.find((s) => s.color === 'ink' && s.tex);
  assert.ok(st?.tex?.includes('\\sqrt{3}') && st.tex.includes('\\pm'), st?.tex);
  const ans = p.find((s) => s.color === 'red')!;
  assert.ok(ans.tex && (ans.tex.match(/\\sqrt\{3\}/g) ?? []).length === 2 && !/[√±]/.test(ans.tex), ans.tex);
});

ok('friction problem: formulas become TeX strokes, Chinese stays text, no overlap', () => {
  const pages = explainPages(FRICTION, measure, make);
  assert.equal(pages.length, 1);
  const p = pages[0];
  checkPage(p, 'friction');
  const tex = p.filter((s) => s.tex);
  // 4 个步骤公式 + 答案行 + 易错行（含行内公式）
  for (const st of FRICTION.steps) assert.ok(tex.some((s) => s.tex === st.tex || s.tex!.includes(st.tex.slice(0, 12))), 'step formula as tex: ' + st.tex);
  const ans = tex.find((s) => s.tex!.includes('\\text{答'));
  assert.ok(ans && ans.tex!.includes('\\frac{m_A}{m_B}') && ans.color === 'red', 'answer line is one TeX stroke with \\text{答}: ' + ans?.tex);
  assert.match(ans!.text!, /mA|m_A|\(mA\)/, 'plain reading kept for fallback');
  assert.ok(tex.some((s) => s.tex!.includes('N=mg-T\\sin\\theta') && s.color === 'orange'), 'pitfall inline formula');
  // 中文说明是普通文字笔迹
  const txt = p.filter((s) => !s.tex);
  assert.ok(txt.some((s) => s.text === '摩擦平衡问题' && s.color === 'blue'));
  assert.ok(txt.some((s) => /^1　对 A 受力/.test(s.text!)));
  assert.ok(!txt.some((s) => /\\frac|\$|_\{/.test(s.text!)), 'no raw LaTeX in text strokes');
  // 公式框的宽高比就是排版后的宽高比（画的时候不会被压扁）
  for (const s of tex) { const m = measure(s.tex!)!; const r = (s.pts[3] - s.pts[0]) / (s.pts[4] - s.pts[1]); assert.ok(Math.abs(r / (m.w / m.h) - 1) < 0.01, 'aspect ' + s.tex); }
  // 步骤公式比步骤说明大、和中文字号相称：一行公式高度在 0.02~0.08 页宽
  const f1 = tex.find((s) => s.tex === FRICTION.steps[1].tex)!;
  assert.ok(f1.pts[4] - f1.pts[1] > 0.015 && f1.pts[4] - f1.pts[1] < 0.06, 'formula height ' + (f1.pts[4] - f1.pts[1]));
});

ok('long formula is broken at = into aligned lines (or shrunk) and stays inside the column', () => {
  const long = '\\frac{m_A}{m_B}=\\frac{\\mu\\cos 37^\\circ+\\sin 37^\\circ\\cos 53^\\circ\\cdot\\mu+\\sin 53^\\circ}{\\mu\\cos 53^\\circ+\\sin 53^\\circ\\cos 37^\\circ\\cdot\\mu+\\sin 37^\\circ}=\\frac{0.6+0.8\\mu+0.48\\mu+0.8}{0.8+0.6\\mu+0.48\\mu+0.6}=\\frac{1.4+1.28\\mu}{1.4+1.08\\mu}=\\frac{35+32\\mu}{35+27\\mu}';
  const e: Explain = { ...FRICTION, steps: [{ t: '化简', tex: long, plain: '' }], pitfalls: [] };
  const p = explainPages(e, measure, make)[0];
  checkPage(p, 'long');
  const f = p.find((s) => s.tex && s.tex.includes('35+27'))!;
  assert.ok(f.tex!.startsWith('\\begin{aligned}') && (f.tex!.match(/\\\\/g) ?? []).length >= 1, 'aligned: ' + f.tex);
  assert.ok(f.pts[3] - f.pts[0] > 0.4, 'still readable width');
});

ok('bad TeX falls back to the plain reading as a text stroke', () => {
  const e: Explain = { ...FRICTION, steps: [{ t: '写错的公式', tex: '\\frac{a}{b', plain: 'a/b' }, { t: '行内错的', tex: '', plain: 'x=1' }], answer: '$\\undefinedmacro{x}$ 和 $y^2$', pitfalls: [] };
  const p = explainPages(e, measure, make)[0];
  checkPage(p, 'bad');
  assert.ok(p.some((s) => !s.tex && s.text === 'a/b'));
  assert.ok(p.some((s) => !s.tex && s.text === 'x=1'));
  const ans = p.find((s) => s.color === 'red')!;
  assert.ok(ans.tex && ans.tex.includes('y^2') && !ans.tex.includes('undefinedmacro'), 'bad inline part flattened, good part still TeX: ' + ans.tex);
});

ok('math (fraction, root) and chemistry (\\ce) render as TeX', () => {
  const math: Explain = { title: '求函数 $f(x)=\\sqrt{x^2+1}$ 的导数', problem: '', idea: '复合函数求导', steps: [
    { t: '设 $u=x^2+1$', tex: 'f(x)=\\sqrt{u},\\ u=x^2+1', plain: '' },
    { t: '链式法则', tex: "f'(x)=\\frac{1}{2\\sqrt{x^2+1}}\\cdot 2x=\\frac{x}{\\sqrt{x^2+1}}", plain: '' },
  ], answer: "$f'(x)=\\dfrac{x}{\\sqrt{x^2+1}}$", pitfalls: [] };
  const pm = explainPages(math, measure, make)[0];
  checkPage(pm, 'math');
  assert.ok(pm.some((s) => s.tex?.includes('\\text{求函数') && s.tex.includes('\\sqrt{x^2+1}') && s.color === 'blue'), 'title with inline formula');
  const chem: Explain = { title: '二氧化硫的催化氧化', problem: '', idea: '', steps: [
    { t: '写出化学方程式', tex: '\\ce{2SO2 + O2 <=>[\\text{催化剂}][\\Delta] 2SO3}', plain: '' },
    { t: '求 $v(\\ce{SO2})$', tex: 'v(\\ce{SO2})=\\frac{\\Delta c}{\\Delta t}=\\frac{0.4\\ \\text{mol/L}}{2\\ \\text{min}}=0.2\\ \\text{mol}\\cdot\\text{L}^{-1}\\cdot\\text{min}^{-1}', plain: '' },
  ], answer: '$v(\\ce{SO2})=0.2$ mol·L⁻¹·min⁻¹', pitfalls: [] };
  const pc = explainPages(chem, measure, make)[0];
  checkPage(pc, 'chem');
  assert.equal(pc.filter((s) => s.tex?.includes('\\ce{')).length, 4, 'equation, step title, step formula, answer');
});

ok('many steps: two columns or continued pages, never overlapping', () => {
  const steps = Array.from({ length: 10 }, (_, i) => ({ t: `第 ${i + 1} 步：列出关系并代入数据计算，注意单位换算`, tex: `x_{${i + 1}}=\\frac{v_0^2-v^2}{2a}+\\sqrt{${i + 2}}\\,\\text{m}`, plain: '' }));
  const pages = explainPages({ ...FRICTION, steps }, measure, make);
  assert.ok(pages.length >= 1);
  pages.forEach((p, i) => checkPage(p, 'many#' + i));
  const xs = new Set(pages[0].filter((s) => s.tex && s.color === 'ink').map((s) => Math.round(s.pts[0] * 100)));
  assert.ok(xs.size === 2 || pages.length > 1, 'two columns or more pages');
  if (pages.length > 1) assert.ok(pages[1].some((s) => /（续）/.test(s.text ?? '')), 'continued title');
});

console.log(`\n${n} explain-board checks passed (${compiled} TeX compiles)`);
