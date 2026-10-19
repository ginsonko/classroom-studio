// 把 AI 写的 Markdown（含 $...$ 公式）解析成简单的块结构，供导出 PDF / Word / PPT 使用。
// 只支持备课文档常用的部分：标题、段落、列表、引用、表格、分隔线、代码块、公式。

export type Run = { t: 'text'; text: string; b?: boolean; i?: boolean; code?: boolean } | { t: 'math'; tex: string; id: number };
export type Block =
  | { type: 'h'; level: number; runs: Run[] }
  | { type: 'p'; runs: Run[]; quote?: boolean }
  | { type: 'li'; ordered: boolean; n: number; depth: number; runs: Run[] }
  | { type: 'table'; rows: Run[][][] }
  | { type: 'math'; tex: string; id: number }
  | { type: 'code'; text: string }
  | { type: 'img'; src: string; alt: string }
  | { type: 'break' }
  | { type: 'gap' }
  | { type: 'hr' };

export interface Parsed { blocks: Block[]; maths: { id: number; tex: string; display: boolean }[]; title: string }

export function parseMarkdown(src: string): Parsed {
  const maths: Parsed['maths'] = [];
  const addMath = (tex: string, display: boolean) => { const id = maths.length; maths.push({ id, tex: tex.trim(), display }); return id; };
  const inline = (s: string): Run[] => {
    const out: Run[] = [];
    // 公式优先切出来，避免 * _ 被当成强调
    const re = /\$\$([^$]+)\$\$|\$((?:\\\$|[^$\n])+?)\$|\\\((.+?)\\\)|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(?<![\w\\])_([^_\s][^_]*?)_(?!\w)/g;
    let last = 0, m: RegExpExecArray | null;
    const text = (t: string, extra: Partial<{ b: boolean; i: boolean }> = {}) => { if (t) out.push({ t: 'text', text: t.replace(/\\([$*_`\\])/g, '$1'), ...extra }); };
    while ((m = re.exec(s))) {
      text(s.slice(last, m.index));
      if (m[1] !== undefined || m[2] !== undefined || m[3] !== undefined) out.push({ t: 'math', tex: (m[1] ?? m[2] ?? m[3]).trim(), id: addMath(m[1] ?? m[2] ?? m[3], false) });
      else if (m[4] !== undefined) out.push({ t: 'text', text: m[4], code: true });
      else if (m[5] !== undefined || m[6] !== undefined) {
        for (const r of inline(m[5] ?? m[6])) out.push(r.t === 'text' ? { ...r, b: true } : r);
      } else for (const r of inline(m[7] ?? m[8])) out.push(r.t === 'text' ? { ...r, i: true } : r);
      last = re.lastIndex;
    }
    text(s.slice(last));
    return out;
  };
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [], quote = false;
  const flush = () => { if (para.length) blocks.push({ type: 'p', runs: inline(para.join('\n').replace(/([^\x00-\xff])\n(?=[^\x00-\xff])/g, '$1').replace(/\n/g, ' ').trim()), ...(quote ? { quote: true } : {}) }); para = []; quote = false; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^```/.test(line)) {
      flush(); const body: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i]);
      blocks.push({ type: 'code', text: body.join('\n') }); continue;
    }
    const dm = /^(\$\$|\\\[)(.*)$/.exec(line);
    if (dm) {
      flush(); const close = dm[1] === '$$' ? '$$' : '\\]';
      let body = dm[2];
      if (body.endsWith(close) && body.length >= close.length) body = body.slice(0, -close.length);
      else { while (++i < lines.length) { const l = lines[i]; const k = l.indexOf(close); if (k >= 0) { body += '\n' + l.slice(0, k); break; } body += '\n' + l; } }
      if (body.trim()) blocks.push({ type: 'math', tex: body.trim(), id: addMath(body, true) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); blocks.push({ type: 'hr' }); continue; }
    if (line === '[[分页]]') { flush(); blocks.push({ type: 'break' }); continue; }
    if (line === '[[留空]]') { flush(); blocks.push({ type: 'gap' }); continue; }
    if (/^<!--.*-->$/.test(line)) { flush(); continue; }
    const im = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    if (im) { flush(); blocks.push({ type: 'img', alt: im[1], src: im[2] }); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); blocks.push({ type: 'h', level: h[1].length, runs: inline(h[2].replace(/\s+#+$/, '')) }); continue; }
    if (/^\|.*\|$/.test(line)) {
      flush(); const rows: Run[][][] = [];
      for (; i < lines.length && /^\|.*\|$/.test(lines[i].trim()); i++) {
        const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        rows.push(cells.map(inline));
      }
      i--; if (rows.length) blocks.push({ type: 'table', rows }); continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)、])\s+(.*)$/.exec(raw);
    if (li) {
      flush(); const ordered = /\d/.test(li[2]);
      blocks.push({ type: 'li', ordered, n: ordered ? parseInt(li[2], 10) : 0, depth: Math.min(3, Math.floor(li[1].replace(/\t/g, '  ').length / 2)), runs: inline(li[3]) });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { if (!quote) flush(); quote = true; para.push(q[1]); continue; }
    if (quote) flush();
    para.push(line);
  }
  flush();
  const first = blocks.find((b) => b.type === 'h') as Extract<Block, { type: 'h' }> | undefined;
  const title = first ? first.runs.map((r) => (r.t === 'text' ? r.text : r.tex)).join('') : '';
  return { blocks, maths, title };
}

/** PPT 按页切：有 --- 分隔线就按分隔线，否则按一级 / 二级标题 */
export function splitSlides(blocks: Block[]): Block[][] {
  const out: Block[][] = [];
  const byHr = blocks.some((b) => b.type === 'hr');
  let cur: Block[] = [];
  for (const b of blocks) {
    if (byHr ? b.type === 'hr' : b.type === 'h' && b.level <= 2 && cur.length) { if (cur.length) out.push(cur); cur = []; if (byHr) continue; }
    cur.push(b);
  }
  if (cur.length) out.push(cur);
  return out.map((s) => s.filter((b) => b.type !== 'break' && b.type !== 'gap')).filter((s) => s.some((b) => b.type !== 'hr'));
}
