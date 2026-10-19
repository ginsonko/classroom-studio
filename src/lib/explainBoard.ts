// 讲题步骤 → 板书笔迹。中文说明是文字笔迹；步骤公式和文字里的 $…$ 是 TeX 公式笔迹（tool:'text' + tex，
// pts 是外接矩形两角），按 MathJax 实际排版尺寸布局：不重叠、不出界，长公式在 = 处折行或整体缩小，
// 步骤多时分两栏，放不下自动续页。公式编译失败时退回纯文本读法。纯函数：公式尺寸由调用方测量（测试里直接用 MathJax）。
import type { Stroke } from './types';
import type { Explain } from '../physics/sim/aiSchema';
import { charW, PAGE_H, wrap } from './boardLayout';
import { sanitizeTex, texPlain, unicodeScripts } from './formulaText';

/** 公式排版后的尺寸（MathJax 单位，1 em = 1000）；写错了返回 null */
export type Measure = (tex: string) => { w: number; h: number } | null;
type Make = (o: { x: number; y: number; w?: number; h?: number; text: string; tex?: string; color: string; size: number }) => Stroke;

const LINE = 1.35;
export const fontOf = (size: number) => Math.max(0.016, size * 0.008);
// MathJax 的 1 em 换成板书长度时乘的系数：\text{} 里的中文按 0.884 em 画，乘 1.13 后和旁边文字笔迹的字一样大
const EM = 1.13;
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
/** 单个公式最高占页高的四成（很高的方程组、矩阵整体缩小） */
const MAX_H = PAGE_H * 0.4;

interface Row { h: number; w: number; emit: (x: number, y: number) => Stroke }
interface Block { rows: (width: number, cont: boolean) => Row[]; gap?: number; keep?: boolean; indent?: number }

/** 文字里的公式：$…$、$$…$$、\(…\)、\[…\] */
export function splitInline(s: string): { tex: boolean; s: string }[] {
  const out: { tex: boolean; s: string }[] = [];
  let last = 0;
  for (const m of s.matchAll(/\$\$([^$]+)\$\$|\$([^$]+)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]/g)) {
    if (m.index! > last) out.push({ tex: false, s: s.slice(last, m.index) });
    const t = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    if (t) out.push({ tex: true, s: t });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ tex: false, s: s.slice(last) });
  return out;
}
/** 整句的纯文本读法 */
export const flatText = (s: string) => splitInline(s).map((r) => (r.tex ? texPlain(r.s) : unicodeScripts(r.s))).join('');

/** \text{} 里会被 TeX 当成命令的字符换成全角 */
const textArg = (s: string) => `\\text{${s.replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/\$/g, '＄').replace(/%/g, '％').replace(/[#&~^_]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))}}`;

/** 公式在顶层的 = / ≈ / ⇒ 处切开（括号、\left…\right 里面的不切）；切不开返回一段 */
export function splitRelations(tex: string): string[] {
  if (/\\\\|\\begin\b/.test(tex)) return [tex];
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i], rest = tex.slice(i);
    if (c === '\\') {
      const cmd = /^\\([a-zA-Z]+)/.exec(rest)?.[1];
      if (cmd === 'left') depth++;
      else if (cmd === 'right') depth--;
      else if (depth === 0 && i > start && (cmd === 'approx' || cmd === 'Rightarrow' || cmd === 'Longrightarrow')) { parts.push(tex.slice(start, i)); start = i; }
      i += cmd ? cmd.length : 1;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === '=' && depth === 0 && i > start && !/[<>!:]$/.test(tex.slice(start, i).trimEnd())) { parts.push(tex.slice(start, i)); start = i; }
  }
  parts.push(tex.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** 板书笔迹：有 tex 时 pts 是公式外接矩形两角，否则是文字左上角 */
export const boardStroke = (id: () => string): Make => (o) => ({
  id: id(), tool: 'text', color: o.color, size: o.size, text: o.text, author: 'ai', layer: 'public',
  ...(o.tex ? { tex: o.tex, pts: [o.x, o.y, .5, o.x + (o.w ?? 0), o.y + (o.h ?? 0), .5] } : { pts: [o.x, o.y, .5] }),
});

export function explainPages(e: Explain, measure: Measure, make: Make): Stroke[][] {
  const len = (m: { w: number; h: number }, fs: number) => ({ w: (m.w / 1000) * EM * fs, h: (m.h / 1000) * EM * fs });

  /** 一行（可多行）纯文字 */
  const textRow = (lines: string[], size: number, color: string): Row => {
    const fs = fontOf(size), w = Math.max(...lines.map((l) => [...l].reduce((a, c) => a + charW(c), 0))) * fs;
    return { h: lines.length * fs * LINE, w, emit: (x, y) => make({ x, y, text: lines.join('\n'), color, size }) };
  };
  /** 一个公式框：上下留一点空，宽了就缩小 */
  const texRow = (tex: string, plain: string, m: { w: number; h: number }, size: number, color: string, width: number, pad = 0.3): Row => {
    const fs = fontOf(size);
    let { w, h } = len(m, fs);
    if (w > width) { h *= width / w; w = width; }
    if (h > MAX_H) { w *= MAX_H / h; h = MAX_H; }
    const rowH = Math.max(fs * LINE, h + pad * fs);
    return { h: rowH, w, emit: (x, y) => make({ x, y: y + (rowH - h) / 2, w, h, text: plain, tex, color, size }) };
  };

  /** 中文和行内公式混排的一段文字：自动换行，带公式的行整行排成一个 TeX 公式（中文放进 \text{}），没有公式的行是文字笔迹 */
  const richRows = (text: string, size: number, color: string, width: number): Row[] => {
    const fs = fontOf(size);
    const runs = splitInline(text).map((r) => {
      if (!r.tex) return r;
      const fixed = sanitizeTex(r.s);
      const m = measure(fixed);
      return m ? { tex: true, s: fixed, m } : { tex: false, s: texPlain(r.s) };
    });
    if (!runs.some((r) => r.tex)) return [textRow(wrap(runs.map((r) => unicodeScripts(r.s)).join(''), width, size), size, color)];
    // 切成不可再分的小块：中文一个字一块，英文单词、数字、整个公式各是一块
    type Unit = { s: string; w: number; tex?: string };
    const units: Unit[] = [];
    for (const r of runs as ({ tex: boolean; s: string; m?: { w: number; h: number } })[]) {
      if (r.tex && r.m) { units.push({ s: r.s, tex: r.s, w: len(r.m, fs).w }); continue; }
      // \text{} 里每个汉字占 1 em，英文按 TeX 字体的宽度
      for (const u of unicodeScripts(r.s).match(/[A-Za-z0-9.]+|\s+|[^\sA-Za-z0-9.]/gu) ?? []) units.push({ s: u, w: [...u].reduce((a, c) => a + (CJK.test(c) ? 1 : charW(c)), 0) * fs * EM });
    }
    const lines: Unit[][] = [];
    let cur: Unit[] = [], w = 0;
    for (const u of units) {
      if (u.s.includes('\n')) { lines.push(cur); cur = []; w = 0; continue; }
      // 行首不放标点和空格
      if (w + u.w > width && cur.length && !/^[，。；：、,.;:）)\s]$/.test(u.s)) { lines.push(cur); cur = []; w = 0; if (/^\s+$/.test(u.s)) continue; }
      cur.push(u); w += u.w;
    }
    if (cur.length) lines.push(cur);
    const rows: Row[] = [];
    let plainBuf: string[] = [];
    const flush = () => { if (plainBuf.length) rows.push(textRow(plainBuf, size, color)); plainBuf = []; };
    for (const line of lines) {
      const str = line.map((u) => u.s).join('').trim();
      if (!line.some((u) => u.tex)) { plainBuf.push(str); continue; }
      flush();
      const parts: string[] = [];
      let buf = '';
      for (const u of line) { if (u.tex) { if (buf) parts.push(textArg(buf)); buf = ''; parts.push(`{${u.tex}}`); } else buf += u.s; }
      if (buf.trimEnd()) parts.push(textArg(buf.trimEnd()));
      if (parts[0]?.startsWith('\\text{')) parts[0] = parts[0].replace(/^\\text\{\s+/, '\\text{');
      const tex = parts.join(''), plain = line.map((u) => (u.tex ? texPlain(u.tex) : u.s)).join('').trim();
      const m = measure(tex);
      if (m) rows.push(texRow(tex, plain, m, size, color, width, 0.2));
      else plainBuf.push(...wrap(plain, width, size));
    }
    flush();
    return rows;
  };

  /** 步骤公式：单独一块，太宽先在 = 处折成多行（aligned），还宽就整体缩小 */
  const formulaRows = (raw: string, plain: string, size: number, color: string, width: number): Row[] => {
    const tex = sanitizeTex(raw);
    const fs = fontOf(size), m = tex ? measure(tex) : null;
    if (!m) return [textRow(wrap(unicodeScripts(plain || texPlain(tex)), width, size), size, color)];
    let best = { tex, m };
    if (len(m, fs).w > width) {
      const parts = splitRelations(tex);
      if (parts.length > 1) {
        const ws = parts.map((p, i) => measure(i ? '{}' + p : p));
        if (ws.every(Boolean)) {
          const lines: string[][] = [[parts[0]]];
          let cw = len(ws[0]!, fs).w;
          for (let i = 1; i < parts.length; i++) {
            const pw = len(ws[i]!, fs).w;
            if (cw + pw > width && (lines.length > 1 || lines[0].length > 1)) { lines.push([parts[i]]); cw = len(ws[0]!, fs).w + pw; }
            else { lines[lines.length - 1].push(parts[i]); cw += pw; }
          }
          // 第一行：左边 & 第一个关系；后面各行 & 关系开头对齐
          const body = lines.map((l, k) => (k ? '&' + l.join(' ') : l[0] + (l.length > 1 ? '&' + l.slice(1).join(' ') : '&'))).join('\\\\');
          const at = `\\begin{aligned}${body}\\end{aligned}`, am = lines.length > 1 ? measure(at) : null;
          if (am && len(am, fs).w < len(m, fs).w) best = { tex: at, m: am };
        }
      }
    }
    return [texRow(best.tex, plain || texPlain(tex), best.m, size, color, width)];
  };

  /** 同一块在同样宽度下只排一次（试单栏 / 两栏 / 缩小字号时会反复问高度） */
  const memo = (fn: (w: number, cont: boolean) => Row[]) => { const m = new Map<string, Row[]>(); return (w: number, cont: boolean) => { const key = w.toFixed(5) + cont; if (!m.has(key)) m.set(key, fn(w, cont)); return m.get(key)!; }; };
  const build = (k: number) => {
    const rich = (text: string, size: number, color: string, gap: number, extra: Partial<Block> = {}): Block => ({ rows: memo((w, cont) => richRows(cont ? text + '（续）' : text, cont ? Math.min(size * k, 2.6) : size * k, color, w)), gap: gap * k, ...extra });
    const head: Block[] = [rich(e.title, 3.6, 'blue', 0.014)];
    if (e.idea) head.push(rich('思路　' + e.idea, 2.25, 'violet', 0.008));
    const body: Block[] = e.steps.flatMap((st, i) => [
      rich(`${i + 1}　${st.t}`, 2.1, 'blue', i ? 0.016 : 0, { keep: true }),
      { rows: memo((w) => formulaRows(st.tex, st.plain, 2.75 * k, 'ink', w)), indent: 0.03, gap: 0.002 },
    ]);
    const foot: Block[] = [];
    if (e.answer) foot.push(rich('答　' + e.answer, 3, 'red', 0.02));
    if (e.pitfalls.length) foot.push(rich('易错　' + e.pitfalls.map((p) => p.replace(/[。；;.\s]+$/, '')).join('；'), 2.1, 'orange', 0.012));
    return [head, body, foot] as const;
  };
  // 一页放得下最好：单栏 → 两栏（左右平衡）→ 字号略缩小再试；都放不下时按原字号、取页数少的排法续页
  const cols: (1 | 2)[] = e.steps.length >= 2 ? [1, 2] : [1];
  let best: Stroke[][] | null = null;
  for (const k of [1, 0.9, 0.82]) {
    const blocks = build(k);
    for (const c of cols) {
      const pages = flow(...blocks, c);
      if (pages.length === 1) return pages;
      if (k === 1 && (!best || pages.length < best.length)) best = pages;
    }
  }
  return best!;
}

/** 把块排进若干页：head 每页都放（续页只放一行小标题），body 按栏流动（两栏时左右高度大致平衡），foot 横跨整页、放在两栏中较低的一栏下面 */
function flow(head: readonly Block[], body: readonly Block[], foot: readonly Block[], cols: 1 | 2, M = 0.06, top = 0.045): Stroke[][] {
  const bottom = PAGE_H - 0.035, gutter = 0.04, full = 1 - 2 * M;
  const colW = cols === 2 ? (full - gutter) / 2 : full;
  const heightOf = (b: Block, width: number) => (b.gap ?? 0) + b.rows(width - (b.indent ?? 0), false).reduce((a, r) => a + r.h, 0);
  // keep=true 的块和下一块（步骤说明 + 公式）不拆开
  const groups: { blocks: Block[]; need: number }[] = [];
  for (let i = 0; i < body.length; i++) {
    const g = body[i].keep && body[i + 1] ? [body[i], body[++i]] : [body[i]];
    groups.push({ blocks: g, need: g.reduce((a, b) => a + heightOf(b, colW), 0) });
  }
  const pages: Stroke[][] = [];
  let page: Stroke[] = [], col = 0, y = 0, bodyTop = 0, low = 0, target = Infinity;
  const put = (b: Block, x: number, width: number, cont = false) => {
    // 栏顶不加段前空白，左右两栏顶端对齐
    if (!(col === 1 && Math.abs(y - bodyTop) < 1e-9)) y += b.gap ?? 0;
    for (const r of b.rows(width - (b.indent ?? 0), cont)) { page.push(r.emit(x + (b.indent ?? 0), y)); y += r.h; }
    low = Math.max(low, y);
  };
  const startPage = (cont: boolean, from: number) => {
    page = []; pages.push(page); col = 0; y = top; low = 0;
    for (const b of cont ? head.slice(0, 1) : head) put(b, M, full, cont);
    bodyTop = y + 0.006; y = bodyTop; low = y;
    // 两栏时左栏排到剩余内容的一半左右就换栏，免得左栏很长、右栏空着
    const rest = groups.slice(from).reduce((a, g) => a + g.need, 0);
    target = cols === 2 ? Math.min(bottom - bodyTop, rest / 2) : Infinity;
  };
  startPage(false, 0);
  groups.forEach((g, i) => {
    const used = y - bodyTop;
    if (y > bodyTop + 0.001 && (y + g.need > bottom || (cols === 2 && col === 0 && used + g.need / 2 > target))) {
      if (cols === 2 && col === 0) { col = 1; y = bodyTop; }
      else startPage(true, i);
    }
    for (const b of g.blocks) put(b, M + col * (colW + gutter), colW);
  });
  y = Math.max(low, bodyTop);
  for (const b of foot) {
    if (y + heightOf(b, full) > bottom) startPage(true, groups.length);
    put(b, M, full);
  }
  return pages;
}
