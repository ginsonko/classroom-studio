// LaTeX 文本处理（纯函数，测试可直接跑）
/** 去掉模型常加的 $…$、\[…\]、```latex 代码块 */
export function cleanLatex(v: unknown): string {
  let s = typeof v === 'string' ? v.trim() : '';
  s = s.replace(/^```(?:latex|tex)?\s*/i, '').replace(/```$/, '').trim();
  for (const [a, b] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) if (s.startsWith(a) && s.endsWith(b) && s.length > a.length + b.length) { s = s.slice(a.length, s.length - b.length).trim(); break; }
  return s.slice(0, 2000);
}

/** 模型写的「公式」字段：去掉 $ 包裹；散落在公式里的中文（含全角标点）包进 \text{}，否则 KaTeX 排版会乱 */
export function mathTex(v: unknown): string {
  const s = cleanLatex(v).replace(/\$/g, '');
  return s.split(/(\\(?:text|mathrm|textbf|mbox|operatorname|ce)\s*\{[^{}]*\})/).map((part, i) => (i % 2 ? part : part.replace(/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/g, (m) => `\\text{${m}}`))).join('');
}

/** LaTeX 的一行纯文本读法：公式画不出来时显示，也用于复制到微信等不认 LaTeX 的地方 */
export function texPlain(tex: string): string {
  // \{ \} 是真正的花括号（集合、数列 {aₙ}），先占位，免得和分组括号一起被删掉
  let s = tex.replace(/\\([%&#])/g, '$1').replace(/\\left\s*\\\{/g, '\u0001').replace(/\\right\s*\\\}/g, '\u0002').replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002');
  for (let i = 0; i < 4; i++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => `${/^(\d+(\.\d+)?|[A-Za-z])$/.test(a) ? a : `(${a})`}/${/^(\d+(\.\d+)?|[A-Za-z])$/.test(b) ? b : `(${b})`}`).replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)').replace(/\\(?:ce|text|mathrm|mathbf|operatorname|boldsymbol|vec)\s*\{([^{}]*)\}/g, '$1');
  const SYM: Record<string, string> = { cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', rightleftharpoons: '⇌', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', omega: 'ω', Omega: 'Ω', varphi: 'φ', phi: 'φ', degree: '°', circ: '°', angle: '∠', perp: '⊥', parallel: '∥', mid: '|', in: '∈', cup: '∪', cap: '∩', sum: 'Σ', int: '∫' };
  s = s.replace(/\\begin\{\w+\*?\}|\\end\{\w+\*?\}|\\left|\\right|&/g, '').replace(/\\\\/g, '; ').replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°').replace(/\\([a-zA-Z]+)/g, (_m, c: string) => SYM[c] ?? (['sin', 'cos', 'tan', 'log', 'ln', 'lim'].includes(c) ? c : ''));
  s = scripts(scripts(s)).replace(/->/g, '→').replace(/[{}]/g, '').replace(/\\[,;:! ]/g, ' ').replace(/\u0001/g, '{').replace(/\u0002/g, '}').replace(/\u0003/g, '^');
  return s.replace(/\s+/g, ' ').replace(/\s*;\s*$/, '').trim().slice(0, 400);
}

/** 模型有时把 Unicode 数学符号写进 $…$（实测见过 $(2- √3,0)$，√ 渲染成缺字框）：排成 TeX 前换回命令。\text{…} 里的中文标点不动。 */
export function sanitizeTex(tex: string): string {
  const fix = (s: string) => s
    .replace(/√\s*\(([^()]*)\)/g, '\\sqrt{$1}').replace(/√\s*\{([^{}]*)\}/g, '\\sqrt{$1}').replace(/√\s*([A-Za-z0-9])/g, '\\sqrt{$1}').replace(/√/g, '\\sqrt{}')
    .replace(/([0-9A-Za-z}\)])°/g, '$1^\\circ')
    .replace(/[−–—]/g, '-')
    .replace(/[≤⩽]/g, '\\le ').replace(/[≥⩾]/g, '\\ge ').replace(/≠/g, '\\ne ').replace(/×/g, '\\times ').replace(/÷/g, '\\div ')
    .replace(/±/g, '\\pm ').replace(/∓/g, '\\mp ').replace(/≈/g, '\\approx ').replace(/∞/g, '\\infty ')
    .replace(/⇌/g, '\\rightleftharpoons ').replace(/⇒/g, '\\Rightarrow ').replace(/→/g, '\\to ').replace(/←/g, '\\leftarrow ')
    .replace(/[α𝛼]/g, '\\alpha ').replace(/[β𝛽]/g, '\\beta ').replace(/[γ𝛾]/g, '\\gamma ').replace(/[δ𝛿]/g, '\\delta ').replace(/Δ/g, '\\Delta ')
    .replace(/[θ𝜃]/g, '\\theta ').replace(/λ/g, '\\lambda ').replace(/[μ𝜇]/g, '\\mu ').replace(/[π𝜋]/g, '\\pi ').replace(/[ρ𝜌]/g, '\\rho ')
    .replace(/[σ𝜎]/g, '\\sigma ').replace(/[φϕ𝜑]/g, '\\varphi ').replace(/ω/g, '\\omega ').replace(/Ω/g, '\\Omega ')
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋]/g, (c) => '_' + '0123456789+-'['₀₁₂₃₄₅₆₇₈₉₊₋'.indexOf(c)]).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, (c) => '^' + '0123456789+-'['⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻'.indexOf(c)]);
  return tex.split(/(\\(?:text|mathrm|textbf|mbox|operatorname|ce)\s*\{[^{}]*\})/).map((part, i) => (i % 2 ? part : fix(part))).join('');
}

/** 纯文本里的 F_N、v_0、x^2 换成 Unicode 上下标（其它字符原样，换行保留） */
export const unicodeScripts = (s: string) => scripts(scripts(s)).replace(/\u0003/g, '^');

const SUP = '0123456789+-−=()niax*', SUP_U = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿⁱᵃˣ*';
const SUB = '0123456789+-−=()aeoxhklmnpstijruv', SUB_U = '₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜᵢⱼᵣᵤᵥ';
/** x^2 → x²、a_{n+1} → aₙ₊₁；有字符没有对应的上下标字形时写成 ^(…) / 直接跟在后面 */
function scripts(s: string): string {
  const conv = (body: string, from: string, to: string) => [...body].every((c) => from.includes(c)) ? [...body].map((c) => to[from.indexOf(c)]).join('') : null;
  // 先换最里层（花括号里没有 ^ _ 的）；换不了的 ^ 暂记为 \u0003，第二遍不再碰它
  return s.replace(/([\^_])\s*(?:\{([^{}^_]*)\}|([^\s{}\\^_]))/g, (_m, op: string, g: string | undefined, c: string | undefined) => {
    const body = (g ?? c ?? '').replace(/\s+/g, '');
    const u = conv(body, op === '^' ? SUP : SUB, op === '^' ? SUP_U : SUB_U);
    if (u !== null) return u;
    return op === '^' ? (body.length > 1 ? `\u0003(${body})` : '\u0003' + body) : body;
  });
}
