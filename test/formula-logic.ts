// 手写公式识别的纯逻辑：LaTeX 清洗、纯文本读法、MathJax 轮廓编译。用法：npx tsx test/formula-logic.ts
import assert from 'node:assert/strict';
import { cleanLatex, texPlain } from '../src/lib/formulaText';
import { compileTex } from '../src/ink/tex';
import { strokeBounds } from '../src/ink/geometry';
import type { Stroke } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };

ok('去掉模型常加的包裹', () => {
  assert.equal(cleanLatex('$x^2$'), 'x^2');
  assert.equal(cleanLatex('$$\\frac{1}{2}$$'), '\\frac{1}{2}');
  assert.equal(cleanLatex('\\[ a+b \\]'), 'a+b');
  assert.equal(cleanLatex('```latex\nE=mc^2\n```'), 'E=mc^2');
  assert.equal(cleanLatex('a$b'), 'a$b', '中间的 $ 不动');
  assert.equal(cleanLatex(42), '');
  assert.equal(cleanLatex('x'.repeat(3000)).length, 2000);
});

ok('纯文本读法', () => {
  assert.equal(texPlain('\\frac{a}{b}+\\sqrt{x}'), 'a/b+√(x)');
  assert.equal(texPlain('\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}'), '(-b±√(b²-4ac))/(2a)');
  assert.equal(texPlain('\\ce{2H2 + O2 -> 2H2O}'), '2H2 + O2 → 2H2O');
  assert.equal(texPlain('\\sin^2\\alpha+\\cos^2\\alpha=1'), 'sin²α+cos²α=1');
  assert.equal(texPlain('a_{n+1}=2^{n-1}'), 'aₙ₊₁=2ⁿ⁻¹');
  assert.equal(texPlain('\\{a_n+1\\}, n\\in\\mathbb{N}^*'), '{aₙ+1}, n∈N*');
  assert.equal(texPlain('e^{-x^2}+F_{弹}+37^\\circ'), 'e^(-x²)+F弹+37°');
  assert.equal(texPlain('2\\,\\mathrm{m/s^2}'), '2 m/s²');
  assert.equal(texPlain('\\begin{aligned} x&=1\\\\ y&=2 \\end{aligned}'), 'x=1; y=2');
  assert.equal(texPlain('v=\\text{速度}'), 'v=速度');
});

ok('MathJax 轮廓：分数、根号、化学方程式、汉字', () => {
  const f = compileTex('\\frac{a}{b}+\\sqrt{x^2}');
  assert.ok(f.w > 2000 && f.h > 1000, `size ${f.w}x${f.h}`);
  assert.ok(f.ops.filter((o) => o.k === 'p').length >= 5);
  assert.ok(f.ops.some((o) => o.k === 'r'), '分数线是矩形');
  // 变换后所有路径都落在 viewBox 内（y 向下，原点在左上）
  for (const o of f.ops) { const [, , , , e, g] = o.m; assert.ok(e > -50 && e < f.w + 50 && g > -50 && g < f.h + 50, `op at ${e},${g}`); }
  const c = compileTex('\\ce{2H2 + O2 ->[点燃] 2H2O}');
  assert.ok(c.w > c.h * 4, '方程式是横长的');
  assert.ok(c.ops.some((o) => o.k === 't' && o.s === '点'), '条件里的汉字');
  const multi = compileTex('\\begin{aligned} x&=1\\\\ y&=2 \\end{aligned}');
  assert.ok(multi.h > f.h * 0.9, '两行更高');
});

ok('写错的 LaTeX 会抛错', () => {
  assert.throws(() => compileTex('\\frac{1}{'), /brace/i);
  assert.throws(() => compileTex('\\notacommand{x}'), /Undefined control sequence/);
});

ok('公式笔迹按外接框算范围', () => {
  const s: Stroke = { id: 'f', tool: 'text', color: 'ink', size: 3.5, pts: [.1, .2, .5, .4, .26, .5], text: 'x^2', tex: 'x^2', author: 'teacher' };
  assert.deepEqual(strokeBounds(s), { x0: .1, y0: .2, x1: .4, y1: .26 });
  const plain: Stroke = { ...s, tex: undefined, pts: [.1, .2, .5] };
  assert.ok(strokeBounds(plain).x1 > .1, '普通文字仍按字数估宽');
});

console.log(`formula-logic: ${n}/${n} 通过`);
