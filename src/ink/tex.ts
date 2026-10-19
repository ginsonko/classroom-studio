// LaTeX → 矢量轮廓。MathJax 的 SVG 输出全是路径（不依赖字体文件），
// 拆成「路径 + 变换矩阵」后可以直接画在板书 canvas 上，学生窗口、缩放、录屏都一致。
// 这个模块比较大，只在第一次遇到公式时按需加载（见 draw.ts）。
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js';

export type Mat = [number, number, number, number, number, number];
export type TexOp = { k: 'p'; d: string; m: Mat } | { k: 'r'; x: number; y: number; w: number; h: number; m: Mat } | { k: 't'; s: string; size: number; m: Mat };
/** w、h 是 MathJax 单位（1 em = 1000），y 向下 */
export interface TexShape { w: number; h: number; ops: TexOp[] }

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'mhchem'], formatError: (_jax: unknown, err: Error) => { throw err; } }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

const mul = (a: Mat, b: Mat): Mat => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ID: Mat = [1, 0, 0, 1, 0, 0];
function parseTransform(t: string | null): Mat {
  let m = ID;
  for (const [, fn, args] of (t ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, v[0] || 0, v[1] || 0]);
    else if (fn === 'scale') m = mul(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (fn === 'matrix' && v.length === 6) m = mul(m, v as Mat);
    else if (fn === 'rotate') { const a = (v[0] || 0) * Math.PI / 180; m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); }
  }
  return m;
}

type Node = ReturnType<typeof adaptor.firstChild>;
const attr = (n: Node, k: string) => adaptor.getAttribute(n as never, k) as string | null;

/** 编译失败（语法错误）会抛异常，消息是 MathJax 的英文错误 */
export function compileTex(tex: string): TexShape {
  let container;
  try { container = doc.convert(tex, { display: true }); } catch (e) { throw new Error((e as { message?: string })?.message || String(e)); }
  const svg = adaptor.firstChild(container) as Node;
  const vb = (attr(svg, 'viewBox') ?? '0 0 0 0').split(/\s+/).map(Number);
  const ops: TexOp[] = [];
  const walk = (n: Node, m: Mat) => {
    const kind = adaptor.kind(n as never);
    if (kind === '#text' || kind === '#comment') return;
    const here = mul(m, parseTransform(attr(n, 'transform')));
    if (kind === 'path') { const d = attr(n, 'd'); if (d) ops.push({ k: 'p', d, m: here }); return; }
    if (kind === 'rect') { ops.push({ k: 'r', x: +(attr(n, 'x') ?? 0), y: +(attr(n, 'y') ?? 0), w: +(attr(n, 'width') ?? 0), h: +(attr(n, 'height') ?? 0), m: here }); return; }
    if (kind === 'text') { ops.push({ k: 't', s: adaptor.textContent(n as never), size: parseFloat(attr(n, 'font-size') ?? '1000') || 1000, m: here }); return; }
    for (const c of adaptor.childNodes(n as never)) walk(c as Node, here);
  };
  for (const c of adaptor.childNodes(svg as never)) walk(c as Node, [1, 0, 0, 1, -vb[0], -vb[1]]);
  return { w: vb[2], h: vb[3], ops };
}
