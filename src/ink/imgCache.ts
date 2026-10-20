// 板面图片缓存。draw() 是同步的：图片没加载好先画占位框，加载完 imgTick() 变化，画布据此重画。
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
  img.onload = () => { tick++; };
  img.onerror = () => { cache.set(src, null); tick++; };
  img.src = src;
  if (cache.size > 200) { const first = cache.keys().next().value; if (first !== undefined && first !== src) cache.delete(first); }
  return undefined;
}
