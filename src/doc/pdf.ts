import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageInfo } from '../lib/types';
import { host } from '../lib/host';
import { detectSlideBoxes } from './geometry';

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_DOCUMENTS = 4, MAX_PIXELS = 6_000_000, MAX_RASTERS = 28, MAX_CACHE_BYTES = 64 * 1024 * 1024;
interface DocSlot { promise: Promise<PDFDocumentProxy>; refs: number; used: number; destroy: () => Promise<void> }
const documents = new Map<string, DocSlot>();
const rasterCache = new Map<string, { blob: Blob; cost: number }>();
const rasterPending = new Map<string, Promise<Blob>>();
let rasterBytes = 0, active = 0;
const waiters: (() => void)[] = [];

export function assetUrl(path: string) { return /^(blob:|data:|https?:|cs-file:|classroom-file:|lesson:)/i.test(path) ? path : host.fileUrl(path); }

async function withDocument<T>(path: string, fn: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  let slot = documents.get(path);
  if (!slot) {
    const task = getDocument({
      url: assetUrl(path), stopAtErrors: true,
      cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href,
      cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href,
      wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href,
    });
    task.onPassword = () => { void task.destroy(); };
    slot = { promise: task.promise, refs: 0, used: Date.now(), destroy: () => task.destroy() };
    documents.set(path, slot);
  }
  slot.refs++; slot.used = Date.now();
  try { return await fn(await slot.promise); }
  catch (e) { documents.delete(path); throw friendlyPdfError(e); }
  finally {
    slot.refs--;
    const spare = [...documents.entries()].filter(([, v]) => v.refs === 0).sort((a, b) => a[1].used - b[1].used);
    while (documents.size > MAX_DOCUMENTS && spare.length) {
      const [key, item] = spare.shift()!; documents.delete(key);
      void item.promise.then(() => item.destroy(), () => {});
    }
  }
}

function friendlyPdfError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/password|destroyed/i.test(msg)) return new Error('这份 PDF 可能受密码保护；请先用阅读器另存为无需密码的副本。');
  if (/invalid|format|structure/i.test(msg)) return new Error('文件内容不是有效的 PDF，或文件已经损坏。');
  return new Error('PDF 读取失败：' + msg);
}

export async function pdfPages(path: string): Promise<PageInfo[]> {
  return withDocument(path, async (doc) => {
    const pages: PageInfo[] = [];
    for (let start = 1; start <= doc.numPages; start += 6) {
      const batch = await Promise.all(Array.from({ length: Math.min(6, doc.numPages - start + 1) }, async (_, k) => {
        const i = start + k, page = await doc.getPage(i), vp = page.getViewport({ scale: 1 });
        return { w: vp.width, h: vp.height, doc: { pdf: path, index: i - 1 } };
      }));
      pages.push(...batch);
    }
    if (!pages.length) throw new Error('PDF 没有可以显示的页面。');
    return pages;
  });
}

/** 每页开头的文字（只取前 300 字，用于识别答案页等） */
/** 每页按行的文字及行顶位置（占页高比例），用于找出「答案：」从哪里开始 */
export async function pdfPageLines(path: string, max = 80): Promise<{ lines: { t: string; y?: number }[] }[]> {
  return withDocument(path, async (doc) => {
    const out: { lines: { t: string; y?: number }[] }[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
      const page = await doc.getPage(i), tc = await page.getTextContent(), vp = page.getViewport({ scale: 1 });
      const lines: { t: string; y?: number }[] = [];
      let cur: { t: string; y?: number } | null = null, chars = 0;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        if (!cur) {
          const [, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
          const h = Math.abs(it.height || it.transform[3] || 0);
          cur = { t: '', y: Math.min(1, Math.max(0, (vy - h) / vp.height)) };
        }
        cur.t += it.str; chars += it.str.length;
        if (it.hasEOL) { if (cur.t.trim()) lines.push(cur); cur = null; }
        if (chars > 1500) break;
      }
      if (cur?.t.trim()) lines.push(cur);
      out.push({ lines });
      page.cleanup();
    }
    return out;
  });
}

export async function pdfPageTexts(path: string, max = 80): Promise<string[]> {
  return withDocument(path, async (doc) => {
    const out: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
      const page = await doc.getPage(i), tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) { if ('str' in it) { s += it.str + (it.hasEOL ? '\n' : ''); if (s.length > 300) break; } }
      out.push(s);
      page.cleanup();
    }
    return out;
  });
}

async function queued<T>(fn: () => Promise<T>) {
  if (active >= 2) await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
  try { return await fn(); }
  finally { active--; waiters.shift()?.(); }
}

function remember(key: string, blob: Blob, cost: number) {
  rasterCache.set(key, { blob, cost }); rasterBytes += cost;
  while (rasterCache.size > MAX_RASTERS || rasterBytes > MAX_CACHE_BYTES) {
    const k = rasterCache.keys().next().value;
    if (!k) break;
    rasterBytes -= rasterCache.get(k)!.cost; rasterCache.delete(k);
  }
}

/** 不保留画布；缓存压缩图且按解码像素计费，避免缩略图与大图无限增长。 */
export async function pdfRaster(path: string, index: number, width: number): Promise<Blob> {
  const bucket = Math.max(128, Math.min(4096, Math.ceil(width / 128) * 128));
  const key = `${path}\u0000${index}\u0000${bucket}`;
  const cached = rasterCache.get(key);
  if (cached) { rasterCache.delete(key); rasterCache.set(key, cached); return cached.blob; }
  const pending = rasterPending.get(key); if (pending) return pending;
  const promise = queued(() => withDocument(path, async (doc) => {
    if (index < 0 || index >= doc.numPages) throw new Error('页码超出文档范围。');
    const page = await doc.getPage(index + 1), base = page.getViewport({ scale: 1 });
    const target = Math.min(bucket, Math.sqrt(MAX_PIXELS * base.width / base.height));
    const vp = page.getViewport({ scale: target / base.width });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const cost = canvas.width * canvas.height * 4;
    try {
      await page.render({ canvas, viewport: vp, background: 'rgb(255,255,255)' }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('页面图像导出失败。')), 'image/png'));
      remember(key, blob, cost); return blob;
    } finally { canvas.width = 0; canvas.height = 0; }
  }));
  rasterPending.set(key, promise);
  try { return await promise; } finally { rasterPending.delete(key); }
}

export async function imageSize(url: string): Promise<{ w: number; h: number }> {
  const im = await loadImage(url);
  return { w: im.naturalWidth, h: im.naturalHeight };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => img.naturalWidth ? resolve(img) : reject(new Error('图片为空。'));
    img.onerror = () => reject(new Error('图片无法读取；文件可能已移动、损坏或格式不支持。'));
    img.src = url;
  });
}

export async function pageImage(page: PageInfo, width: number): Promise<HTMLImageElement> {
  if (page.doc) {
    const blob = await pdfRaster(page.doc.pdf, page.doc.index, width), url = URL.createObjectURL(blob);
    try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
  }
  if (page.src) return loadImage(page.src);
  throw new Error('这页没有可读取的原始内容。');
}

export async function analyseSlides(pages: PageInfo[], onProgress?: (n: number, total: number) => void, shouldContinue: () => boolean = () => true): Promise<PageInfo[]> {
  const out: PageInfo[] = [];
  for (const [i, p] of pages.entries()) {
    if (!shouldContinue()) throw new Error('已取消幻灯片分析。');
    if (p.w >= p.h || (!p.doc && !p.src)) { out.push({ ...p, slides: [[0, 0, 1, 1]] }); continue; }
    const image = await pageImage(p, 300), canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = Math.round(300 * p.h / p.w);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    try {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const slides = detectSlideBoxes(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, p.w, p.h);
      out.push({ ...p, slides }); onProgress?.(i + 1, pages.length);
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  return out;
}

export const pdfCacheStats = () => ({ documents: documents.size, rasters: rasterCache.size, decodedBudgetBytes: rasterBytes, pending: rasterPending.size });
