// 板面图片缓存。draw() 是同步的：图片没加载好先画占位框，加载完 imgTick() 变化，画布据此重画。
import { wakeInk } from './wake';
const cache = new Map<string, HTMLImageElement | null>();
let tick = 0;
export const imgTick = () => tick;

/** undefined = 还在加载；null = 加载失败 */
export function boardImage(src: string): HTMLImageElement | null | undefined {
  const hit = cache.get(src);
  if (hit !== undefined) return hit && hit.complete && hit.naturalWidth ? hit : hit === null ? null : undefined;
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  img.decoding = 'async';
  // 画布还要导出板书、截给 AI 看：按 CORS 加载（lesson: 协议带 Access-Control-Allow-Origin），否则画布被「污染」读不出像素
  img.crossOrigin = 'anonymous';
  cache.set(src, img);
  img.onload = () => { tick++; wakeInk(); };
  img.onerror = () => { cache.set(src, null); tick++; wakeInk(); };
  img.src = src;
  if (cache.size > 200) { const first = cache.keys().next().value; if (first !== undefined && first !== src) cache.delete(first); }
  return undefined;
}

const tints = new Map<string, HTMLCanvasElement>();
/** 单色线稿换色：保留透明度，所有不透明的像素涂成 color（深色黑板上的黑线稿变粉笔色） */
export function tinted(img: HTMLImageElement, color: string): HTMLCanvasElement | HTMLImageElement {
  const key = img.src + '|' + color, hit = tints.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return img;
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
  tints.set(key, c);
  if (tints.size > 40) { const first = tints.keys().next().value; if (first !== undefined) tints.delete(first); }
  return c;
}
