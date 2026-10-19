// 讲题步骤 → 黑板文字排版：自动换行、步骤多时分两栏、一页放不下就续页。
// 坐标单位与笔迹一致：x ∈ [0,1] 以页宽计，y 也以页宽计（16:9 页面高 0.5625）。
import type { Stroke } from './types';

export const PAGE_H = 900 / 1600;
const LINE = 1.35;
const fontOf = (size: number) => Math.max(0.016, size * 0.008);

/** 估算字宽（以字号为单位）：汉字和全角符号 1，ASCII 约 0.56 */
export function charW(c: string) {
  const code = c.codePointAt(0) ?? 0;
  if (c === ' ') return 0.3;
  if (code < 0x80) return /[A-Z0-9mw]/.test(c) ? 0.62 : 0.52;
  if (code >= 0x2e80) return 1;
  return 0.62; // 希腊字母、上下标、运算符
}

/** 按宽度换行；ASCII 单词和公式片段尽量不从中间断开 */
export function wrap(text: string, width: number, size: number): string[] {
  const fs = fontOf(size), max = width / fs, out: string[] = [];
  for (const para of String(text).split('\n')) {
    let line = '', w = 0;
    for (const c of para) {
      const cw = charW(c);
      // 行首不放句读标点：允许它略微超出行宽挂在行尾
      if (w + cw > max && line && !/[，。；：、！？,.;:!?）)」』”]/.test(c)) {
        let cut = line.length;
        if (/[\x21-\x7e]/.test(c)) {
          const sp = Math.max(line.lastIndexOf(' '), line.search(/[=＝，,；;]\S*$/) + 1);
          if (sp > line.length - 14 && sp > 0) cut = sp;
        }
        out.push(line.slice(0, cut).trimEnd());
        line = line.slice(cut).trimStart();
        w = [...line].reduce((a, x) => a + charW(x), 0);
      }
      line += c; w += cw;
    }
    out.push(line);
  }
  return out;
}

export interface Block { text: string; size: number; color: string; indent?: number; gap?: number; keep?: boolean }

const heightOf = (lines: number, size: number) => lines * fontOf(size) * LINE;

/**
 * 把块排进若干页。head 每页都放（续页标题），body 按栏流动。
 * cols=2 时两栏宽度各占一半，左栏满了进右栏，右栏满了换页。
 */
export function layout(head: Block[], body: Block[], foot: Block[], o: { cols: 1 | 2; margin?: number; top?: number }, make: (pts: number[], text: string, color: string, size: number) => Stroke): Stroke[][] {
  const M = o.margin ?? 0.06, top = o.top ?? 0.045, bottom = PAGE_H - 0.035, gutter = 0.04;
  const colW = o.cols === 2 ? (1 - 2 * M - gutter) / 2 : 1 - 2 * M;
  const pages: Stroke[][] = [];
  let page: Stroke[] = [], col = 0, y = 0, bodyTop = 0;
  const startPage = (cont: boolean) => {
    page = []; pages.push(page); col = 0; y = top;
    for (const b of head) {
      const text = cont && b === head[0] ? b.text + '（续）' : b.text;
      const size = cont ? Math.min(b.size, 2.6) : b.size;
      const lines = wrap(text, 1 - 2 * M - (b.indent ?? 0), size);
      page.push(make([M + (b.indent ?? 0), y, .5], lines.join('\n'), b.color, size));
      y += heightOf(lines.length, size) + (b.gap ?? 0.012);
      if (cont) break; // 续页只放一行小标题
    }
    bodyTop = y + 0.006; y = bodyTop;
  };
  const x0 = () => M + col * (colW + gutter);
  const place = (b: Block, width: number) => {
    const lines = wrap(b.text, width - (b.indent ?? 0), b.size), h = heightOf(lines.length, b.size);
    return { lines, h };
  };
  startPage(false);
  for (let i = 0; i < body.length; i++) {
    const b = body[i];
    // keep=true 的块和下一块（步骤说明 + 公式）不拆开
    const group = b.keep && body[i + 1] ? [b, body[i + 1]] : [b];
    const sizes = group.map((g) => place(g, colW));
    const need = sizes.reduce((a, s, k) => a + s.h + (k ? group[k].gap ?? 0 : 0), 0) + (b.gap ?? 0);
    if (y + need > bottom && y > bodyTop + 0.001) {
      if (o.cols === 2 && col === 0) { col = 1; y = bodyTop; }
      else startPage(true);
    }
    group.forEach((g, k) => {
      y += g.gap ?? 0;
      page.push(make([x0() + (g.indent ?? 0), y, .5], sizes[k].lines.join('\n'), g.color, g.size));
      y += sizes[k].h;
    });
    i += group.length - 1;
  }
  // 结尾块（答案、易错）横跨整页宽度，放在两栏中较低的一栏下面
  const colBottoms = page.filter((s) => s.pts[1] >= bodyTop - 1e-6).map((s) => s.pts[1] + heightOf((s.text ?? '').split('\n').length, s.size));
  y = Math.max(y, ...colBottoms, bodyTop);
  for (const b of foot) {
    const { lines, h } = place(b, 1 - 2 * M);
    if (y + (b.gap ?? 0) + h > bottom) startPage(true);
    y += b.gap ?? 0;
    page.push(make([M + (b.indent ?? 0), y, .5], lines.join('\n'), b.color, b.size));
    y += h;
  }
  return pages;
}
