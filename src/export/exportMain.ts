// 隐藏的排版页：主进程把 Markdown 交给这里，排成 A4 文档（打印成 PDF）、逐个公式截图（写进 Word）、
// 或排成 16:9 幻灯片逐页截图（做成 PPT）。页面不连导播台的总线，也没有任何桌面权限。
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './export.css';
import { parseMarkdown, splitSlides, type Block, type Run } from './markdown';

const root = document.getElementById('root')!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const tex = (s: string, display: boolean) => katex.renderToString(s, { throwOnError: false, displayMode: display, strict: 'ignore' });
const THEMES = ['physics', 'math', 'chem', 'bio', 'chinese', 'english', 'history', 'geo', 'politics', 'science'];

/** Markdown 开头的 <!-- cs:theme=chem --> 决定配色；没写就是蓝色 */
function applyMeta(md: string) {
  const m = /<!--\s*cs:theme=([a-z]+)\s*-->/.exec(md.slice(0, 400));
  document.body.dataset.theme = m && THEMES.includes(m[1]) ? m[1] : 'physics';
}

function runs(rs: Run[]) {
  return rs.map((r) => {
    if (r.t === 'math') return `<span class="m">${tex(r.tex, false)}</span>`;
    let h = esc(r.text);
    if (r.code) h = `<code>${h}</code>`;
    if (r.b) h = `<b>${h}</b>`;
    if (r.i) h = `<i>${h}</i>`;
    return h;
  }).join('');
}
const plain = (rs: Run[]) => rs.map((r) => (r.t === 'text' ? r.text : r.tex)).join('');
/** 去掉开头 n 个字符（只动第一段文字） */
function dropHead(rs: Run[], n: number): Run[] {
  const [first, ...rest] = rs;
  if (!first || first.t !== 'text') return rs;
  const t = first.text.slice(n).replace(/^\s+/, '');
  return t ? [{ ...first, text: t }, ...rest] : rest;
}

type Mode = 'doc' | 'slide' | 'card';
function paragraph(b: Extract<Block, { type: 'p' }>, mode: Mode): string {
  const first = b.runs[0], text = plain(b.runs);
  // 题号：**3.** 题干 → 圆形编号
  if (mode === 'doc' && !b.quote && first?.t === 'text' && first.b && /^\d{1,3}[.、．]$/.test(first.text.trim())) {
    return `<p class="q"><span class="qn">${esc(first.text.trim().replace(/[.、．]$/, ''))}</span><span class="qb">${runs(dropHead(b.runs.slice(1), 0))}</span></p>`;
  }
  if (b.quote) {
    if (/^注意[:：]/.test(text)) return `<p class="quote warn">${runs(b.runs)}</p>`;
    const ex = /^例题?\s*\d*\s*[:：]/.exec(text);
    if (ex && mode === 'slide') return `<p class="quote ex">${runs(dropHead(b.runs, ex[0].length))}</p>`;
    return `<p class="quote">${runs(b.runs)}</p>`;
  }
  if (/^(答案|参考答案|解答|解析)[:：]/.test(text)) return `<p class="ans">${runs(b.runs)}</p>`;
  if (mode === 'doc' && /^[（(]?A[)）]?\s*[.．、:：]/.test(text) && /\u3000\u3000[（(]?B/.test(text)) return `<p class="opts">${runs(b.runs)}</p>`;
  return `<p>${runs(b.runs)}</p>`;
}

function block(b: Block, mode: Mode): string {
  switch (b.type) {
    case 'h': return `<h${b.level}>${runs(b.runs)}</h${b.level}>`;
    case 'p': return paragraph(b, mode);
    case 'li': return `<p class="li d${b.depth}">${b.ordered ? `<span class="bullet">${b.n}.</span>` : '<span class="dot"></span>'}<span>${runs(b.runs)}</span></p>`;
    case 'table': return `<table>${b.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${runs(c)}</th>` : `<td>${runs(c)}</td>`)).join('')}</tr>`).join('')}</table>`;
    case 'math': return `<div class="dm">${tex(b.tex, true)}</div>`;
    case 'code': return `<pre>${esc(b.text)}</pre>`;
    case 'img': return /^data:image\/(png|jpeg);base64,/.test(b.src) ? `<figure><img src="${esc(b.src)}" alt="${esc(b.alt)}"></figure>` : `<p class="quote">[图片缺失：${esc(b.alt || '题图')}]</p>`;
    case 'hr': return '<hr>';
    case 'break': return '<div class="pb"></div>';
    case 'gap': return mode === 'doc' ? '<div class="gap"></div>' : '';
  }
}

/** A4 文档：标题下第一段是信息栏（全角空格分隔）；「参考答案」这一节换成答案样式 */
function docHtml(blocks: Block[]) {
  const out: string[] = [];
  let inAns = false;
  blocks.forEach((b, i) => {
    if (b.type === 'h' && b.level <= 2) {
      if (inAns) { out.push('</div>'); inAns = false; }
      out.push(block(b, 'doc'));
      if (b.level === 2 && /答案|解析/.test(plain(b.runs))) { out.push('<div class="ans">'); inAns = true; }
      return;
    }
    const prev = blocks[i - 1];
    if (b.type === 'p' && !b.quote && prev?.type === 'h' && prev.level === 1 && /\u3000\u3000/.test(plain(b.runs))) {
      out.push(`<p class="meta">${plain(b.runs).split(/\u3000{2,}/).filter((s) => s.trim()).map((s) => `<span class="chip">${esc(s.trim())}</span>`).join('')}</p>`);
      return;
    }
    out.push(block(b, 'doc'));
  });
  if (inAns) out.push('</div>');
  return out.join('');
}

const KINDS: [RegExp, string, string][] = [
  [/例题|典例|例\s*\d/, 'ex', '例题'],
  [/练一练|课堂练习|变式|随堂|练习|检测/, 'ex', '练一练'],
  [/答案|解析|参考/, 'ans', '答案'],
  [/小结|总结|回顾|梳理|收获/, 'sum', '小结'],
  [/目标|导入|引入|情境/, 'goal', '导入'],
];

async function settle() { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }

let slides: Block[][] = [], deckTitle = '';

const api = {
  /** A4 文档：返回块结构和公式列表，主进程随后 printToPDF */
  async renderDoc(md: string) {
    applyMeta(md);
    const p = parseMarkdown(md);
    document.body.className = 'doc';
    root.innerHTML = `<article>${docHtml(p.blocks)}<div class="foot">最强网课教辅系统 · ${new Date().toLocaleDateString('zh-CN')}</div></article>`;
    await settle();
    return p;
  },
  /** 单个公式放大排版，返回截图区域和基线下方的深度（用于在 Word 里和文字对齐） */
  async showMath(t: string, display: boolean) {
    document.body.className = 'sheet';
    root.innerHTML = `<div class="cell"><span class="f">${tex(t, display)}</span><span class="bl"></span></div>`;
    await settle();
    const f = root.querySelector('.f')!.getBoundingClientRect(), bl = root.querySelector('.bl')!.getBoundingClientRect();
    const pad = 4;
    return { x: Math.floor(f.left - pad), y: Math.floor(f.top - pad), w: Math.ceil(f.width + pad * 2), h: Math.ceil(f.height + pad * 2), depth: Math.max(0, f.bottom + pad - bl.top), size: parseFloat(getComputedStyle(root.querySelector('.f')!).fontSize) };
  },
  /** 手机分享用的竖版长图：固定 750px 宽，返回整页高度，主进程按高度截图 */
  async renderCard(md: string) {
    applyMeta(md);
    const p = parseMarkdown(md);
    document.body.className = 'card';
    root.innerHTML = `<article>${p.blocks.map((b) => block(b, 'card')).join('')}<footer>最强网课教辅系统 · ${new Date().toLocaleDateString('zh-CN')}</footer></article>`;
    await settle();
    await Promise.all([...root.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
    return { height: Math.ceil(root.getBoundingClientRect().height) };
  },
  async renderSlides(md: string) {
    applyMeta(md);
    const p = parseMarkdown(md);
    slides = splitSlides(p.blocks); deckTitle = p.title;
    const notes = slides.map((s) => s.map((b) => (b.type === 'math' ? b.tex : 'runs' in b ? plain(b.runs) : '')).filter(Boolean).join('\n'));
    return { count: slides.length, title: p.title, notes };
  },
  /** 第 i 页排进 1600×900 的画面；内容放不下时逐步缩小字号 */
  async showSlide(i: number) {
    const s = slides[i];
    const cover = i === 0 && s.length <= 3 && s[0]?.type === 'h' && s.slice(1).every((b) => b.type === 'p');
    document.body.className = 'slide' + (cover ? ' cover' : '');
    const head = s[0]?.type === 'h' ? s[0] : null, body = head ? s.slice(1) : s;
    const title = head ? plain(head.runs) : '', kind = cover ? null : KINDS.find(([re]) => re.test(title));
    const no = cover ? '' : `<span class="no">${String(i).padStart(2, '0')}</span>`;
    const tag = kind && !title.startsWith(kind[2]) ? `<span class="tag">${kind[2]}</span>` : '';
    root.innerHTML = `<section class="sl${kind ? ' k-' + kind[1] : ''}"><header class="${head ? '' : 'empty'}">${no}<span class="tt">${head ? runs(head.runs) : ''}</span>${tag}</header><div class="rule"></div><div class="body">${body.map((b) => block(b, 'slide')).join('')}</div><footer><span>${esc(cover ? new Date().toLocaleDateString('zh-CN') : deckTitle)}</span><span class="pg">${i + 1} / ${slides.length}</span></footer></section>`;
    const el = root.querySelector('.body') as HTMLElement;
    for (let size = 34; size >= 16; size -= 2) {
      el.style.fontSize = size + 'px';
      await settle();
      if (el.scrollHeight <= el.clientHeight + 2) break;
    }
    return true;
  },
};
Object.assign(window, { csExport: api });
document.body.dataset.ready = '1';
