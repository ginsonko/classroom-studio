// 隐藏的课件转换页：电脑上没有 Office / WPS 可用时（主要是 macOS），在这里把 PPTX 排成逐页幻灯片、
// 把 Word / RTF 排成分页文档；主进程再逐页截图或打印成 PDF。页面不连导播台总线，也没有任何桌面权限。
import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import { init as initPptx } from 'pptx-preview';
import { EMFJS, RTFJS, WMFJS } from 'rtf.js';
import { fixDocxXml, fixPresentationXml, fixSlideXml } from './ooxml';
import { wmfToPng } from './wmf';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { marked } from 'marked';
import { DROP_TAGS, KEEP_TAGS, keepAttr, protectMath, restoreMath } from './mdView';

type Line = { t: string; y: number };
const view = document.getElementById('v')!;
WMFJS.loggingEnabled(false); EMFJS.loggingEnabled(false); RTFJS.loggingEnabled(false);

async function bytes(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('读不到课件文件');
  return r.arrayBuffer();
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
async function settle() {
  await Promise.all([...view.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
  await document.fonts.ready;
  await nextFrame();
}

/** WMF / EMF（MathType 公式、旧剪贴画）→ PNG：浏览器不认这两种格式，不转就是一片空白 */
async function metaToPng(data: Uint8Array): Promise<Uint8Array | null> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 64) return null;
  if (dv.getUint32(0, true) === 0x9ac6cdd7) {
    try { const png = await wmfToPng(data); if (png) return png; } catch { /* 交给 WMFJS 再试 */ }
  }
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  let svg: SVGElement, w: number, h: number;
  if (dv.getUint32(0, true) === 0x9ac6cdd7) { // 可放置 WMF：头里有图框和每英寸单位数
    const l = dv.getInt16(6, true), t = dv.getInt16(8, true), r = dv.getInt16(10, true), b = dv.getInt16(12, true), inch = dv.getUint16(14, true) || 1440;
    w = Math.max(1, Math.abs(r - l) / inch * 96); h = Math.max(1, Math.abs(b - t) / inch * 96);
    // xExt / yExt 按 METAFILEPICT 的约定用 0.01mm（和 RTF 里 \picw \pich 一样）
    svg = new WMFJS.Renderer(buf).render({ width: w + 'px', height: h + 'px', xExt: Math.round(w / 96 * 2540), yExt: Math.round(h / 96 * 2540), mapMode: 8 });
  } else if (dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === 0x464d4520) { // EMF：图框单位 0.01mm
    const fl = dv.getInt32(24, true), ft = dv.getInt32(28, true), fr = dv.getInt32(32, true), fb = dv.getInt32(36, true);
    w = Math.max(1, (fr - fl) / 100 / 25.4 * 96); h = Math.max(1, (fb - ft) / 100 / 25.4 * 96);
    const bl = dv.getInt32(8, true), bt = dv.getInt32(12, true), br = dv.getInt32(16, true), bb = dv.getInt32(20, true);
    svg = new EMFJS.Renderer(buf).render({ width: w + 'px', height: h + 'px', wExt: br - bl, hExt: bb - bt, xExt: w, yExt: h, mapMode: 8 });
  } else return null;
  const scale = Math.max(1, Math.min(3, 4096 / Math.max(w, h)));
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try { await img.decode(); } finally { URL.revokeObjectURL(img.src); }
  const c = document.createElement('canvas'); c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** 压缩包里的 WMF / EMF 全部换成 PNG。rename=true 时改成 .png 文件名并同步改引用（PPTX 按扩展名定图片类型） */
async function fixMeta(zip: JSZip) {
  const converted = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!/\.(wmf|emf)$/i.test(name) || zip.files[name].dir) continue;
    try {
      const png = await metaToPng(await zip.file(name)!.async('uint8array'));
      if (png) { zip.file(name, png); converted.add(name); }
    } catch { /* 个别画不出来的图保持原样 */ }
  }
  return converted;
}

/** 改文件名并同步改所有 .rels 里的引用（只改同一目录下的文件名，按文件名匹配） */
async function renameParts(zip: JSZip, pairs: [string, string][]) {
  if (!pairs.length) return;
  for (const [a, b] of pairs) { const data = await zip.file(a)!.async('uint8array'); zip.remove(a); zip.file(b, data); }
  const base = (p: string) => p.split('/').pop()!;
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.rels')) continue;
    let xml = await zip.file(name)!.async('text');
    for (const [a, b] of pairs) xml = xml.split('/' + base(a) + '"').join('/' + base(b) + '"').split('"' + base(a) + '"').join('"' + base(b) + '"');
    zip.file(name, xml);
  }
}

/**
 * PPTX 的图片整理给渲染库用：它只读 ppt/media/image* 开头的文件、按扩展名定图片类型。
 * WMF / EMF 转成 PNG 后改成 .png 结尾；不叫 image* 的图片（别的软件生成的 PPT 常见）改名。
 */
async function fixSlideMedia(zip: JSZip) {
  const converted = await fixMeta(zip), pairs: [string, string][] = [];
  for (const name of Object.keys(zip.files)) {
    const m = /^ppt\/media\/([^/]+)$/.exec(name);
    if (!m || zip.files[name].dir) continue;
    let b = m[1];
    if (converted.has(name)) b += '.png';
    else if (!/\.(png|jpe?g|gif|bmp|webp|svg|tiff?|wmf|emf)$/i.test(b)) continue;
    if (!b.startsWith('image')) b = 'image-cs-' + b;
    if (b !== m[1]) pairs.push([name, 'ppt/media/' + b]);
  }
  await renameParts(zip, pairs);
}

let slides: HTMLElement[] = [];

async function openSlides(url: string, width = 1600) {
  const zip = await JSZip.loadAsync(await bytes(url), { createFolders: false });
  const pres = await zip.file('ppt/presentation.xml')?.async('text');
  if (!pres) throw new Error('这不是有效的 PPTX 文件');
  const size = /<p:sldSz\b[^>]*>/.exec(pres)?.[0] ?? '';
  const cx = Number(/\bcx="(\d+)"/.exec(size)?.[1]) || 12192000, cy = Number(/\bcy="(\d+)"/.exec(size)?.[1]) || 6858000;
  const height = Math.round(width * cy / cx);
  const fixedPres = fixPresentationXml(pres);
  if (fixedPres !== pres) zip.file('ppt/presentation.xml', fixedPres);
  await fixSlideMedia(zip);
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async('text'), fixed = fixSlideXml(xml);
    if (fixed !== xml) zip.file(name, fixed);
  }
  view.replaceChildren();
  // 渲染库内部有些异步步骤出错不会让 preview() 失败，只会变成未处理的 rejection，这里接住当作失败
  let failure: unknown = null;
  const catcher = (e: PromiseRejectionEvent) => { failure ??= e.reason; e.preventDefault(); };
  window.addEventListener('unhandledrejection', catcher);
  try {
    const previewer = initPptx(view, { width, height, mode: 'list' });
    await previewer.preview(await zip.generateAsync({ type: 'arraybuffer' }));
    await settle();
    await new Promise((r) => setTimeout(r, 50));
  } finally { window.removeEventListener('unhandledrejection', catcher); }
  if (failure) throw new Error('PPT 排版出错：' + String((failure as Error)?.message ?? failure).slice(0, 160));
  slides = [...view.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper')];
  return { count: slides.length, width, height };
}

function textLines(el: HTMLElement): Line[] {
  const box = el.getBoundingClientRect(), blocks = new Map<Element, { t: string; y: number; x: number }>();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.textContent ?? '';
    if (!s.trim() || !n.parentElement) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (!r.height) continue;
    const block = n.parentElement.closest('p,li,td,div') ?? n.parentElement, cur = blocks.get(block);
    if (cur) cur.t += s;
    else blocks.set(block, { t: s, y: (r.top - box.top) / (box.height || 1), x: r.left });
  }
  return [...blocks.values()].sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 80)
    .map((l) => ({ t: l.t.replace(/\s+/g, ' ').trim().slice(0, 200), y: Math.round(Math.max(0, Math.min(1, l.y)) * 1000) / 1000 }))
    .filter((l) => l.t);
}

/** 只显示第 i 页并放在左上角，返回截图区域和这一页的文字（识别答案页用） */
async function showSlide(i: number) {
  slides.forEach((s, k) => { s.style.display = k === i ? '' : 'none'; });
  window.scrollTo(0, 0);
  await settle();
  const r = slides[i].getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), lines: textLines(slides[i]) };
}

/** 打印分页：页面大小和上下边距放到 @page，每页都留白；左右边距保留在节内 */
function paginate(sections: HTMLElement[], size: { w: string; h: string; top: string; bottom: string }) {
  const style = document.createElement('style');
  style.textContent = `@page { size: ${size.w} ${size.h}; margin: ${size.top} 0 ${size.bottom} 0; }
section.docx, section.rtf { box-shadow: none !important; margin: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; min-height: 0 !important; background: #fff; }
section.docx:not(:last-of-type), section.rtf:not(:last-of-type) { break-after: page; }
section.docx div[style*="inline-block"] { vertical-align: middle; }`;
  document.head.appendChild(style);
  return sections.length;
}

async function openDocx(url: string) {
  const zip = await JSZip.loadAsync(await bytes(url), { createFolders: false });
  if (!zip.file('word/document.xml')) throw new Error('这不是有效的 Word（.docx）文件');
  await fixMeta(zip);
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async('text'), fixed = fixDocxXml(xml);
    if (fixed !== xml) zip.file(name, fixed);
  }
  view.replaceChildren();
  await renderAsync(await zip.generateAsync({ type: 'arraybuffer' }), view, undefined, { inWrapper: false, ignoreLastRenderedPageBreak: false, renderHeaders: false, renderFooters: false, breakPages: true });
  await settle();
  const sections = [...view.querySelectorAll<HTMLElement>('section.docx')];
  if (!sections.length) throw new Error('Word 文档里没有可显示的内容');
  const s = sections[0].style;
  return { pages: paginate(sections, { w: s.width || '595.3pt', h: s.minHeight || '841.9pt', top: s.paddingTop || '72pt', bottom: s.paddingBottom || '72pt' }) };
}

async function openRtf(url: string) {
  // Word 存的 RTF 里常有空的 {\pict }（形状的占位结果），rtf.js 遇到会整份报错，先去掉。按单字节处理，不动其它内容
  const raw = new Uint8Array(await bytes(url));
  let text = '';
  for (let i = 0; i < raw.length; i += 32768) text += String.fromCharCode(...raw.subarray(i, i + 32768));
  text = text.replace(/\{\\pict\s*\}/g, '');
  const clean = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) clean[i] = text.charCodeAt(i);
  const doc = new RTFJS.Document(clean.buffer, {});
  const parts = await doc.render();
  view.replaceChildren();
  const section = document.createElement('section');
  section.className = 'rtf';
  section.style.cssText = 'width:595.3pt;padding:0 72pt;box-sizing:border-box;font-size:10.5pt;line-height:1.5';
  section.append(...parts);
  view.appendChild(section);
  await settle();
  return { pages: paginate([section], { w: '595.3pt', h: '841.9pt', top: '72pt', bottom: '72pt' }) };
}

/** 单个 WMF / EMF 转 PNG 的结果（data URL），排查公式显示问题用 */
async function metaPng(url: string) {
  const png = await metaToPng(new Uint8Array(await bytes(url)));
  if (!png) return null;
  let s = '';
  for (let i = 0; i < png.length; i += 32768) s += String.fromCharCode(...png.subarray(i, i + 32768));
  return 'data:image/png;base64,' + btoa(s);
}

/** 外来 HTML 清理：只留排版用的标签和属性（Markdown 里可以夹 HTML，表格常这样写） */
function clean(node: ParentNode) {
  for (const el of [...node.children]) {
    if (DROP_TAGS.has(el.tagName)) { el.remove(); continue; }
    clean(el);
    if (!KEEP_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    for (const a of [...el.attributes]) if (!keepAttr(el.tagName, a.name, a.value)) el.removeAttribute(a.name);
    if (el.tagName === 'INPUT') (el as HTMLInputElement).disabled = true;
    if (el.tagName === 'IMG' && !el.getAttribute('src')) {
      const note = document.createElement('strong');
      note.textContent = `[图片无法显示${el.getAttribute('alt') ? '：' + el.getAttribute('alt') : ''}]`;
      el.replaceWith(note);
    }
  }
}

/** 图片最多等这么久（网上的图片可能一直不回） */
const imagesReady = () => Promise.all([...view.querySelectorAll('img')].map((i) => Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 8000))])));

/** Markdown → A4 分页文档（主进程随后打印成 PDF）。本地图片主进程已换成 data URL */
async function openMarkdown(text: string, title: string) {
  const { text: body, maths } = protectMath(text);
  const html = await marked.parse(body, { gfm: true, breaks: true, async: true });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  clean(tpl.content);
  const box = document.createElement('div');
  box.append(tpl.content);
  // 公式只在文字里换回来（不碰属性），KaTeX 的结构不再经过清理
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\u27E6m\d+\u27E7/.test(n.nodeValue ?? '')) texts.push(n as Text);
  for (const t of texts) {
    const holder = document.createElement('template');
    holder.innerHTML = restoreMath(t.nodeValue!.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!), maths, (m) => katex.renderToString(m.tex, { throwOnError: false, displayMode: m.display, strict: 'ignore', output: 'html' }));
    t.replaceWith(holder.content);
  }
  const style = document.createElement('style');
  style.textContent = MD_CSS;
  document.head.appendChild(style);
  document.title = title;
  view.replaceChildren();
  const article = document.createElement('article');
  article.className = 'md';
  article.append(...box.childNodes);
  if (!article.textContent?.trim() && !article.querySelector('img')) throw new Error('Markdown 里没有可显示的内容');
  view.appendChild(article);
  await imagesReady();
  await settle();
  return { ok: true };
}
const MD_CSS = `@page { size: A4; margin: 16mm 16mm 18mm; }
html, body { overflow: visible !important; }
#v { width: auto !important; }
article.md { font-size: 11pt; line-height: 1.75; color: #111; word-break: break-word; }
article.md h1 { font-size: 17pt; text-align: center; margin: 0 0 10pt; }
article.md h2 { font-size: 14pt; margin: 14pt 0 6pt; }
article.md h3, article.md h4 { font-size: 12pt; margin: 10pt 0 4pt; }
article.md h1, article.md h2, article.md h3, article.md h4 { break-after: avoid; }
article.md p { margin: 0 0 6pt; }
article.md img { max-width: 100%; max-height: 240mm; vertical-align: middle; break-inside: avoid; }
article.md p > img:only-child { display: block; margin: 4pt 0; }
article.md table { border-collapse: collapse; margin: 6pt 0; max-width: 100%; }
article.md th, article.md td { border: 0.75pt solid #666; padding: 3pt 6pt; vertical-align: top; }
article.md th { background: #f2f2f2; }
article.md tr { break-inside: avoid; }
article.md blockquote { margin: 6pt 0; padding: 2pt 10pt; border-left: 3pt solid #ccc; color: #444; }
article.md pre { white-space: pre-wrap; background: #f6f6f6; padding: 6pt; font-size: 9.5pt; }
article.md code { font-family: Consolas, Menlo, monospace; font-size: 0.92em; }
article.md hr { border: 0; border-top: 0.75pt solid #999; margin: 10pt 0; }
article.md ul, article.md ol { margin: 0 0 6pt; padding-left: 22pt; }
article.md .katex-display { margin: 6pt 0; overflow: hidden; }
article.md .katex { font-size: 1.08em; }`;

Object.assign(window, { csOffice: { slides: openSlides, show: showSlide, docx: openDocx, rtf: openRtf, md: openMarkdown, metaPng } });
