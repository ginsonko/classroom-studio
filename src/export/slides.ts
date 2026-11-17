// 1.7.0 讲课 PPT：6 种版式（封面、情境图、对比、图解、例题分步、总结卡）+ 默认版式，主题色，插图位，单击分步。
// 每页先排成 1600×900 的 HTML，再拆成「背景图 + 一个个可编辑的文字框 / 公式图 / 插图」交给主进程拼 PPTX。
import type { Block, Run } from './markdown';

export type Layout = 'cover' | 'scene' | 'compare' | 'diagram' | 'example' | 'summary' | 'content';
interface Helpers { block: (b: Block) => string; runs: (rs: Run[]) => string; plain: (rs: Run[]) => string; esc: (s: string) => string }

const NAMES: [RegExp, Layout][] = [
  [/^(封面|cover)/i, 'cover'], [/^(情境|情景|scene)/i, 'scene'], [/^(对比|比较|compare)/i, 'compare'],
  [/^(图解|受力|示意|diagram)/i, 'diagram'], [/^(例题|example)/i, 'example'], [/^(总结|小结|summary)/i, 'summary'], [/^(默认|普通|content)/i, 'content'],
];
const metas = (s: Block[]) => s.filter((b): b is Extract<Block, { type: 'meta' }> => b.type === 'meta').map((b) => b.text);
const isImg = (b: Block) => b.type === 'img';

/** 这一页用哪种版式：写了 <!-- 版式：对比 --> 就按写的；没写按标题和内容猜 */
export function layoutOf(s: Block[], i: number, h: Helpers): Layout {
  for (const m of metas(s)) {
    const v = m.replace(/^(版式|layout)\s*[:：=]?\s*/i, '');
    if (/^(版式|layout)/i.test(m)) { const hit = NAMES.find(([re]) => re.test(v)); if (hit) return hit[1]; }
  }
  const head = s.find((b) => b.type === 'h') as Extract<Block, { type: 'h' }> | undefined, title = head ? h.plain(head.runs) : '';
  const body = s.filter((b) => b !== head && b.type !== 'meta');
  if (i === 0 && body.every((b) => b.type === 'p' || isImg(b)) && body.length <= 3) return 'cover';
  if (/例题|典例|例\s*\d/.test(title)) return 'example';
  if (/小结|总结|梳理|回顾|收获/.test(title)) return 'summary';
  if (/对比|区别|比较|辨析|vs/i.test(title) && body.filter((b) => b.type === 'h').length >= 2) return 'compare';
  if (body.some(isImg)) return /情境|情景|引入|导入|生活|现象|想一想/.test(title) || body.filter((b) => !isImg(b)).length <= 2 ? 'scene' : 'diagram';
  return 'content';
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫';
const stepAttr = (on: boolean, n: { k: number }) => (on ? ` data-step="${++n.k}"` : '');

/** 一页的 HTML（section.sl），steps：哪些元素单击出现 */
export function slideHtml(s: Block[], i: number, count: number, deckTitle: string, h: Helpers): { html: string; layout: Layout } {
  const layout = layoutOf(s, i, h);
  const m = metas(s), stepsOn = m.some((x) => /^(分步|steps)/i.test(x)) || layout === 'example';
  const head = s.find((b) => b.type === 'h') as Extract<Block, { type: 'h' }> | undefined;
  const body = s.filter((b) => b !== head && b.type !== 'meta');
  const n = { k: 0 };
  const title = head ? h.runs(head.runs) : '';
  const no = `<span class="no">${String(i).padStart(2, '0')}</span>`;
  const foot = `<footer><span>${h.esc(layout === 'cover' ? new Date().toLocaleDateString('zh-CN') : deckTitle)}</span><span class="pg">${i + 1} / ${count}</span></footer>`;
  const blk = (b: Block, step: boolean) => { const html = h.block(b); return step ? html.replace(/^<(\w+)/, `<$1${stepAttr(true, n)}`) : html; };
  const art = (b: Block | undefined) => (b ? h.block(b) : `<p class="ph"><b>插图位</b><br>在这里放一张情境图</p>`);
  const header = `<header>${no}<span class="tt">${title}</span></header><div class="rule"></div>`;
  let inner = '';
  switch (layout) {
    case 'cover': {
      const img = body.find(isImg), text = body.filter((b) => !isImg(b));
      inner = `<header class="cv"><span class="tt">${title}</span></header><div class="rule"></div><div class="body">${text.map((b) => h.block(b)).join('')}</div>${img ? `<div class="cover-art">${h.block(img)}</div>` : ''}`;
      break;
    }
    case 'scene': {
      const img = body.find(isImg), text = body.filter((b) => b !== img);
      inner = `<div class="scene-art">${art(img)}</div><div class="scene-panel"><header>${no}<span class="tt">${title}</span></header><div class="rule"></div><div class="body">${text.map((b) => blk(b, stepsOn)).join('')}</div></div>`;
      break;
    }
    case 'compare': {
      const cols: { head: string; blocks: Block[] }[] = [];
      for (const b of body) {
        if (b.type === 'h') cols.push({ head: h.runs(b.runs), blocks: [] });
        else { if (!cols.length) cols.push({ head: '', blocks: [] }); cols[cols.length - 1].blocks.push(b); }
      }
      if (cols.length === 1 && cols[0].blocks.length > 1) { const all = cols[0].blocks, half = Math.ceil(all.length / 2); cols.splice(0, 1, { head: '', blocks: all.slice(0, half) }, { head: '', blocks: all.slice(half) }); }
      const two = cols.slice(0, 2), rest = cols.slice(2).flatMap((c) => c.blocks);
      inner = `${header}<div class="body cmp">${two.map((c, k) => `<div class="col c${k + 1}">${c.head ? `<p class="ch">${c.head}</p>` : ''}${c.blocks.map((b) => blk(b, stepsOn)).join('')}</div>${k === 0 ? '<p class="vs">VS</p>' : ''}`).join('')}</div>${rest.length ? `<div class="cmp-foot">${rest.map((b) => blk(b, stepsOn)).join('')}</div>` : ''}`;
      break;
    }
    case 'diagram': {
      const img = body.find(isImg), text = body.filter((b) => b !== img);
      let k = 0;
      const pts = text.map((b) => { if (b.type === 'li') { const html = `<p class="pt"${stepAttr(stepsOn, n)}><span class="pn">${CIRCLED[k++] ?? '•'}</span> ${h.runs(b.runs)}</p>`; return html; } return blk(b, stepsOn); }).join('');
      inner = `${header}<div class="body dia"><div class="dia-art">${art(img)}</div><div class="dia-pts">${pts}</div></div>`;
      break;
    }
    case 'example': {
      const qi = body.findIndex((b) => b.type === 'p' && b.quote) >= 0 ? body.findIndex((b) => b.type === 'p' && b.quote) : body.findIndex((b) => b.type === 'p');
      const q = qi >= 0 ? body[qi] : undefined;
      const rest = body.filter((_, k) => k !== qi);
      let k = 0;
      const steps = rest.map((b) => {
        if (b.type === 'li' || (b.type === 'p' && !/^(答案|解析|分析|解)[:：]?$/.test(h.plain(b.runs)))) {
          const rs = b.type === 'li' || b.type === 'p' ? b.runs : [];
          return `<p class="stp"${stepAttr(true, n)}><span class="sn">${CIRCLED[k++] ?? '•'}</span> ${h.runs(rs)}</p>`;
        }
        if (b.type === 'h') return `<p class="sl-lab">${h.runs(b.runs)}</p>`;
        return blk(b, true);
      }).join('');
      const img = rest.find(isImg);
      inner = `${header}<div class="body ex">${q && q.type === 'p' ? `<p class="exq"><b>例题　</b>${h.runs(q.runs)}</p>` : ''}<div class="exs${img ? ' with-art' : ''}">${steps}</div></div>`;
      break;
    }
    case 'summary': {
      const cards: string[] = [], other: string[] = [];
      let sec: { t: string; parts: string[] } | null = null;
      const flushSec = () => { if (sec) cards.push(`<p class="card"${stepAttr(stepsOn, n)}><b>${sec.t}</b>${sec.parts.length ? '<br>' + sec.parts.join('<br>') : ''}</p>`); sec = null; };
      for (const b of body) {
        if (b.type === 'h') { flushSec(); sec = { t: h.runs(b.runs), parts: [] }; continue; }
        if (sec && (b.type === 'p' || b.type === 'li')) { sec.parts.push(h.runs(b.runs)); continue; }
        if (b.type === 'li') {
          const rs = b.runs, first = rs[0], txt = first?.t === 'text' ? first.text : '', cut = /[:：]/.exec(txt);
          if (cut && first?.t === 'text') cards.push(`<p class="card"${stepAttr(stepsOn, n)}><b>${h.esc(txt.slice(0, cut.index))}</b><br>${h.runs([{ ...first, text: txt.slice(cut.index + 1).trim() }, ...rs.slice(1)])}</p>`);
          else if (first?.t === 'text' && first.b) {
            // 「**超重**：加速度向上」：标题后面的冒号去掉
            const rest = rs.slice(1), r0 = rest[0];
            const tail = r0?.t === 'text' ? [{ ...r0, text: r0.text.replace(/^\s*[:：]\s*/, '') }, ...rest.slice(1)] : rest;
            cards.push(`<p class="card"${stepAttr(stepsOn, n)}><b>${h.esc(first.text.replace(/[:：]\s*$/, ''))}</b><br>${h.runs(tail)}</p>`);
          }
          else cards.push(`<p class="card"${stepAttr(stepsOn, n)}>${h.runs(rs)}</p>`);
          continue;
        }
        flushSec(); other.push(blk(b, stepsOn));
      }
      flushSec();
      const cols = cards.length <= 4 ? 2 : 3;
      inner = `${header}<div class="body sum">${other.join('')}<div class="sum-grid" style="grid-template-columns: repeat(${cols}, 1fr)">${cards.join('')}</div></div>`;
      break;
    }
    default:
      inner = `${header}<div class="body">${body.map((b) => blk(b, stepsOn)).join('')}</div>`;
  }
  return { layout, html: `<section class="sl lay-${layout}" data-layout="${layout}">${inner}${foot}</section>` };
}

// ── 拆层：背景图 + 可编辑元素 ──
const INLINE = new Set(['B', 'I', 'STRONG', 'EM', 'CODE', 'SPAN', 'SUB', 'SUP', 'BR', 'SMALL', 'U', 'MARK', 'A']);
function inlineOnly(el: Element): boolean { return [...el.children].every((c) => INLINE.has(c.tagName) && (c.classList.contains('katex') || c.classList.contains('m') || inlineOnly(c))); }
const hasBox = (el: Element) => { const cs = getComputedStyle(el); return !!hex(cs.backgroundColor) || (parseFloat(cs.borderLeftWidth) || 0) > 0 || (parseFloat(cs.borderTopWidth) || 0) > 0; };
/** 一个文字框：只含行内内容；但两端对齐的一行（页脚）、里面有自带底色的徽章（标题前的页码）要拆开，各自一个框 */
function isLeaf(el: Element) {
  if (!(el.textContent || '').trim() || !inlineOnly(el)) return false;
  const cs = getComputedStyle(el);
  if (/flex|grid/.test(cs.display)) {
    const kids = [...el.children].filter((c) => (c.textContent || '').trim());
    if (kids.length >= 2 && (/space-(between|around|evenly)/.test(cs.justifyContent) || kids.some(hasBox))) return false;
  }
  return true;
}

export interface TextRun { text: string; size: number; color: string; b: boolean; i: boolean; br?: boolean }
export interface Layer {
  kind: 'text' | 'pic';
  x: number; y: number; w: number; h: number;
  step: number;
  /** 文字框 */
  runs?: TextRun[]; align?: 'l' | 'ctr' | 'r'; anchor?: 't' | 'ctr'; lineHeight?: number; size?: number;
  fill?: string; line?: string; lineW?: number; dash?: boolean; radius?: number; pad?: [number, number, number, number];
  /** 图片：公式段落、插图（主进程从整页截图里裁）；alt 写进形状说明（公式段落写原来的 LaTeX，方便改） */
  alt?: string; math?: boolean;
}

/** 含公式的段落：说明文字里写成「文字 + $LaTeX$」（KaTeX 渲染结果里带着原始写法） */
function texAlt(el: Element): string {
  let s = '';
  const walk = (n: Node) => {
    if (n instanceof HTMLElement && n.classList.contains('katex')) { const t = n.querySelector('annotation[encoding="application/x-tex"]')?.textContent; s += t ? `$${t}$` : n.textContent; return; }
    if (n.nodeType === Node.TEXT_NODE) { s += n.textContent; return; }
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return s.replace(/\s+/g, ' ').trim().slice(0, 1000);
}

/** 计算后的颜色 → RRGGBB；color-mix 算出来的是 color(srgb r g b) 写法；几乎透明的返回空 */
const hex = (c: string) => {
  let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(c), k = 1;
  if (!m) { m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/.exec(c); k = 255; }
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.05)) return '';
  const a = m[4] !== undefined && Number(m[4]) < 0.98 ? Math.round(Number(m[4]) * 255).toString(16).padStart(2, '0') : '';
  // 半透明的带上透明度：RRGGBBAA
  return ([m[1], m[2], m[3]].map((v) => Math.round(Math.min(255, Number(v) * k)).toString(16).padStart(2, '0')).join('') + a).toUpperCase();
};
const firstColor = (bgImage: string) => { const m = /rgba?\([^)]*\)|color\(srgb[^)]*\)/.exec(bgImage); return m ? hex(m[0]) : ''; };

let leaves: HTMLElement[] = [];

/** 收集一页里所有可编辑的元素（文档顺序 = 叠放顺序），并记下来供 hideLeaves 用 */
export function collectLayers(sec: HTMLElement): Layer[] {
  const R = sec.getBoundingClientRect(), out: Layer[] = [];
  leaves = [];
  const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height }; };
  const stepOf = (el: Element) => Number((el.closest('[data-step]') as HTMLElement | null)?.dataset.step || 0);
  const visit = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (el.tagName === 'IMG') { const r = rect(el); if (r.w > 2 && r.h > 2) { leaves.push(el as HTMLElement); out.push({ kind: 'pic', ...r, step: stepOf(el), alt: (el as HTMLImageElement).alt || '插图' }); } return; }
    if (isLeaf(el)) {
      leaves.push(el as HTMLElement);
      const r = rect(el), step = stepOf(el);
      if (el.querySelector('.katex')) { out.push({ kind: 'pic', math: true, ...r, step, alt: texAlt(el) }); return; }
      const runs: TextRun[] = [];
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = (node.textContent || '').replace(/\s+/g, ' ');
          if (!t) return;
          const p = getComputedStyle(node.parentElement!);
          runs.push({ text: t, size: parseFloat(p.fontSize), color: hex(p.color) || '1D2330', b: Number(p.fontWeight) >= 600, i: p.fontStyle === 'italic' });
          return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === 'BR') { runs.push({ text: '', size: parseFloat(getComputedStyle(el).fontSize), color: '', b: false, i: false, br: true }); return; }
        if (node.classList.contains('dot')) { const p = getComputedStyle(node); runs.push({ text: '◆ ', size: parseFloat(getComputedStyle(el).fontSize) * 0.6, color: hex(p.backgroundColor) || hex(p.color), b: false, i: false }); return; }
        if (node.classList.contains('blank')) { runs.push({ text: '______', size: parseFloat(getComputedStyle(el).fontSize), color: hex(getComputedStyle(el).color), b: false, i: false }); return; }
        if (getComputedStyle(node).display === 'none') return;
        node.childNodes.forEach(walk);
      };
      el.childNodes.forEach(walk);
      // 行首行尾的空格去掉
      if (runs.length && !runs[0].br) runs[0].text = runs[0].text.replace(/^\s+/, '');
      const last = runs[runs.length - 1]; if (last && !last.br) last.text = last.text.replace(/\s+$/, '');
      const fill = hex(cs.backgroundColor) || firstColor(cs.backgroundImage);
      // 边框按左边算（总结卡的上边是加粗色条，PowerPoint 的形状四边一样粗）
      const bw = parseFloat(cs.borderLeftWidth) || parseFloat(cs.borderTopWidth) || 0, line = bw > 0 && cs.borderLeftStyle !== 'none' ? hex(cs.borderLeftColor) || hex(cs.borderTopColor) : '';
      const centered = /flex|grid/.test(cs.display) && cs.alignItems === 'center';
      out.push({
        kind: 'text', ...r, step, runs, size: parseFloat(cs.fontSize),
        align: cs.textAlign === 'center' || (centered && cs.justifyContent === 'center') ? 'ctr' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'r' : 'l',
        anchor: centered ? 'ctr' : 't', lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5,
        fill, line, lineW: line ? bw : 0, dash: cs.borderTopStyle === 'dashed', radius: parseFloat(cs.borderTopLeftRadius) || 0,
        pad: [parseFloat(cs.paddingTop) + (line ? bw : 0), parseFloat(cs.paddingRight), parseFloat(cs.paddingBottom), parseFloat(cs.paddingLeft) + (parseFloat(cs.borderLeftWidth) || 0)],
      });
      return;
    }
    for (const c of el.children) visit(c);
  };
  visit(sec);
  return out;
}

/** 截背景图前把所有可编辑元素藏起来（只藏内容，版式底色、装饰保留在背景里） */
export function hideLeaves(on: boolean) { for (const el of leaves) el.style.visibility = on ? 'hidden' : ''; }
