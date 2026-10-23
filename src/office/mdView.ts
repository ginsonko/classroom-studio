// Markdown 课件排版的纯逻辑：先把公式摘出来（不然 Markdown 会把 _ * \ 当成格式吃掉），排完再放回去；
// 外来的 HTML 只留排版用的标签和属性。
export interface MathPiece { tex: string; display: boolean }

const MARK = (i: number) => `\u27E6m${i}\u27E7`;
const MARK_RE = /\u27E6m(\d+)\u27E7/g;

/**
 * 摘公式：$$…$$、\[…\]（可跨行，独占一段）；$…$、\(…\)（行内）。
 * 代码块、行内代码里的不动；写成 \$ 的美元符号不算公式。
 */
export function protectMath(src: string): { text: string; maths: MathPiece[] } {
  const maths: MathPiece[] = [];
  const put = (tex: string, display: boolean) => { maths.push({ tex: tex.trim(), display }); return MARK(maths.length - 1); };
  const parts = src.replace(/\r\n?/g, '\n').split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/);
  const out = parts.map((p, i) => {
    if (i % 2) return p;
    return p
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => `\n\n${put(t, true)}\n\n`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => `\n\n${put(t, true)}\n\n`)
      .replace(/\\\((.+?)\\\)/g, (_, t) => put(t, false))
      .replace(/(^|[^\\$])\$(?!\s*\$)((?:\\\$|[^$\n])+?)\$/g, (m, pre, t) => (t.trim() ? pre + put(t, false) : m));
  });
  return { text: out.join(''), maths };
}

/** 排好的 HTML 里把公式占位换回渲染结果 */
export function restoreMath(html: string, maths: MathPiece[], render: (m: MathPiece) => string): string {
  return html.replace(MARK_RE, (_, i) => { const m = maths[Number(i)]; return m ? render(m) : ''; });
}

/** 外来 HTML 允许的标签（其余拆掉外壳、留文字；脚本、框架之类整个删） */
export const KEEP_TAGS = new Set([
  'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'SUP', 'SUB', 'MARK', 'SMALL', 'SPAN', 'DIV', 'CENTER',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'IMG', 'A', 'FIGURE', 'FIGCAPTION', 'INPUT', 'DL', 'DT', 'DD',
]);
export const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SOURCE', 'TEMPLATE', 'NOSCRIPT']);
const KEEP_ATTR: Record<string, string[]> = { '*': ['align', 'colspan', 'rowspan', 'width', 'height'], IMG: ['src', 'alt'], A: ['href'], INPUT: ['type', 'checked', 'disabled'], OL: ['start'] };

/** 属性能不能留：只留排版用的；图片只认 data: 和 http(s)，链接不留 javascript: */
export function keepAttr(tag: string, name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (!(KEEP_ATTR['*'].includes(n) || KEEP_ATTR[tag]?.includes(n))) return false;
  if (tag === 'IMG' && n === 'src') return /^(data:image\/|https?:)/i.test(value.trim());
  if (tag === 'A' && n === 'href') return /^(https?:|#)/i.test(value.trim());
  if (tag === 'INPUT' && n === 'type') return value.toLowerCase() === 'checkbox';
  return true;
}
