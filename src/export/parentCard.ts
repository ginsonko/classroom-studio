// 1.7.0 家长版课后反馈的排版：每一块版式和配色都不一样，头图和背景是本地生成的插画式 SVG（不联网）。
// 长图（微信里直接看）和 A4 PDF 共用这一套结构，样式在 export.css 的 body.parent 下。
import { sectionKind } from '../lib/parentReport';
import type { Block } from './markdown';

export const isParent = (md: string) => /<!--\s*cs:parent\s*-->/.test(md.slice(0, 600));

const ICON: Record<string, string> = {
  what: '<path d="M6 7.5C6 6.1 7.1 5 8.5 5H20v18H8.5A2.5 2.5 0 0 0 6 25.5z" fill="currentColor" opacity=".2"/><path d="M6 25.5V7.5C6 6.1 7.1 5 8.5 5H20v18H8.5A2.5 2.5 0 0 0 6 25.5zm0 0A2.5 2.5 0 0 0 8.5 28H22V23" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 10h6M10 14h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  good: '<path d="M16 4l3.5 7.3 8 1.1-5.8 5.6 1.4 7.9L16 22.1l-7.1 3.8 1.4-7.9-5.8-5.6 8-1.1z" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  work: '<path d="M5 24l7-7 5 5 10-11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 11h6v6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<circle cx="16" cy="16" r="11" fill="currentColor" opacity=".18"/><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 10l7 6-7 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  hw: '<rect x="7" y="5" width="18" height="23" rx="3" fill="currentColor" opacity=".18"/><rect x="7" y="5" width="18" height="23" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 14l3 3 6-6M11 22h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  word: '<path d="M5 8a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-9l-6 5v-5H8a3 3 0 0 1-3-3z" fill="currentColor" opacity=".2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 12h10M11 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const icon = (k: string) => `<svg class="ps-ico" viewBox="0 0 32 32" aria-hidden="true">${ICON[k] ?? ICON.what}</svg>`;

/** 头图插画：书、尺子、星星、轨迹线（学科主题色由 CSS 变量给） */
const HERO = `<svg class="ph-art" viewBox="0 0 750 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="phg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--c1)"/><stop offset="1" style="stop-color:var(--c2)"/></linearGradient>
<radialGradient id="phs" cx=".85" cy=".15" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="750" height="300" fill="url(#phg)"/><rect width="750" height="300" fill="url(#phs)"/>
<path d="M-20 250 C 140 170, 260 290, 420 210 S 680 150, 780 200" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
<path d="M-20 280 C 160 220, 300 300, 470 250 S 700 210, 780 240 V 300 H -20 Z" fill="#fff" fill-opacity=".08"/>
<g transform="translate(548 66) rotate(-8)" opacity=".9"><rect x="0" y="0" width="150" height="104" rx="10" fill="#fff" fill-opacity=".16"/><path d="M75 6 V 98" stroke="#fff" stroke-opacity=".5" stroke-width="3"/><path d="M14 26h46M14 44h40M14 62h46M90 26h46M90 44h34M90 62h44" stroke="#fff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/></g>
<g fill="#fff"><path d="M500 60l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z" fill-opacity=".55"/><circle cx="700" cy="230" r="5" fill-opacity=".5"/><circle cx="470" cy="170" r="3" fill-opacity=".6"/><circle cx="720" cy="40" r="3" fill-opacity=".6"/><path d="M640 200l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill-opacity=".45"/></g>
<circle cx="-30" cy="-30" r="150" fill="#fff" fill-opacity=".06"/><circle cx="690" cy="300" r="110" fill="#fff" fill-opacity=".05"/>
</svg>`;
/** 底部装饰：一排小山和小旗（「继续加油」） */
const FOOT = `<svg class="pf-art" viewBox="0 0 750 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<path d="M0 120 L120 50 L200 95 L330 20 L460 100 L560 45 L750 120 Z" style="fill:var(--c2);fill-opacity:.14"/>
<path d="M0 120 L170 80 L260 110 L400 60 L520 112 L640 76 L750 120 Z" style="fill:var(--c2);fill-opacity:.22"/>
</svg>`;

/**
 * blocks → 家长版 HTML。render(b) 是排版页里把一个块排成 HTML 的函数（公式、加粗都由它处理）。
 * 结构：头图（标题 + 日期课题）→ 每个「## 标题」一块（不同 kind 不同版式）→ 结尾鼓励语和装饰
 */
export function parentHtml(blocks: Block[], render: (b: Block) => string, textOf: (b: Block) => string, mode: 'card' | 'doc'): string {
  let title = '', meta = '';
  const sections: { kind: string; title: string; body: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === 'h' && b.level === 1) { title = textOf(b); continue; }
    if (b.type === 'h' && b.level === 2) { const t = textOf(b); sections.push({ kind: sectionKind(t), title: t, body: [] }); continue; }
    if (b.type === 'hr' || b.type === 'break') continue;
    if (!sections.length) { if (b.type === 'p' && !meta) meta = textOf(b); continue; }
    sections.at(-1)!.body.push(b);
  }
  const chips = meta.split(/\u3000+/).filter((s) => s.trim()).map((s) => `<span>${s.trim().replace(/[&<>"]/g, '')}</span>`).join('');
  const sec = (s: (typeof sections)[number], n: number) => {
    const items = s.body.filter((b) => b.type === 'li'), rest = s.body.filter((b) => b.type !== 'li');
    const li = (b: Block, i: number) => {
      const inner = render(b).replace(/^<p class="li[^"]*">(?:<span class="bullet">[^<]*<\/span>|<span class="dot"><\/span>)<span>/, '').replace(/<\/span><\/p>$/, '');
      return `<div class="pi"><i class="pi-n">${s.kind === 'next' ? i + 1 : s.kind === 'hw' ? '' : ''}</i><div class="pi-t">${inner}</div></div>`;
    };
    return `<section class="ps ps-${s.kind}" data-n="${n}"><header class="ps-h">${icon(s.kind)}<h2>${s.title}</h2></header><div class="ps-b">${rest.map(render).join('')}${items.length ? `<div class="pl">${items.map(li).join('')}</div>` : ''}</div></section>`;
  };
  const date = new Date().toLocaleDateString('zh-CN');
  return `<article class="pr pr-${mode}"><header class="ph">${HERO}<div class="ph-in"><b class="ph-tag">课后反馈</b><h1>${title.replace(/[&<>"]/g, '')}</h1><div class="ph-meta">${chips}</div></div></header>`
    + `<div class="pr-body">${sections.map(sec).join('')}</div>`
    + `<footer class="pf">${FOOT}<p>每一步都算数，下节课继续加油！</p><small>最强网课教辅系统 · ${date}</small></footer></article>`;
}
