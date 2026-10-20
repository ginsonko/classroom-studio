// 把截图 / 图片贴到黑板上：作为一张可以拖动、缩放的贴图，下面和周围整块黑板照样能写字。
import { host } from '../lib/host';
import { inkKey, useStore } from '../lib/store';
import { BASE } from '../lib/desk';
import type { Stroke, View } from '../lib/types';
import { freshId } from './geometry';
import { toast } from '../lib/toast';

const MAX_SIDE = 2560;

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode().catch(() => { throw new Error('这张图片打不开，换一张试试'); });
  return img;
}

/** 太大的图缩到 2560 像素以内，统一存成 PNG 文件（学生窗口按地址加载，不在同步消息里传大数据） */
async function storeImage(img: HTMLImageElement): Promise<{ url: string; w: number; h: number }> {
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  try {
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const data = canvas.toDataURL('image/png');
    if (!host.electron) return { url: data, w, h };
    const saved = await host.call<string>('saveImage', data);
    return { url: host.fileUrl(saved), w, h };
  } finally { canvas.width = 0; canvas.height = 0; }
}

/**
 * 在可见区域里给一张宽高比为 aspect 的图找位置：最多占可见区的 62%，水平居中、略偏上；
 * 同一位置已经有图时依次错开。返回页面坐标（x 以页宽为 1，y 以页宽为单位）。
 */
export function placeImage(aspect: number, ratio: number, view: Pick<View, 'fit' | 'region'>, existing: Stroke[]): [number, number, number, number] {
  const [rx, ry, rw, rh] = view.fit === 'region' && view.region ? view.region : [0, 0, 1, 1];
  const vw = rw, vh = rh * ratio;
  let w = Math.min(vw * 0.62, vh * 0.62 * aspect), h = w / aspect;
  // 扁长截图（一行题目）不要太小：宽度至少占一半
  if (aspect > 2.2) { w = Math.min(vw * 0.8, Math.max(w, vw * 0.5)); h = w / aspect; }
  let x = rx + (vw - w) / 2, y = ry * ratio + Math.max(0.02 * vh, (vh - h) * 0.3);
  const near = (s: Stroke) => s.tool === 'image' && Math.abs(s.pts[0] - x) < 0.01 && Math.abs(s.pts[1] - y) < 0.01;
  for (let n = 0; n < 8 && existing.some(near); n++) { x += 0.025 * vw; y += 0.025 * vw; }
  return [x, y, x + w, y + h];
}

/** 贴到当前黑板（学生画面不是黑板时先切回黑板）。src 可以是 Blob、data: 地址或 lesson:// 地址 */
export async function pasteToBoard(src: Blob | string, o: { note?: string } = {}): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  let stored: { url: string; w: number; h: number };
  try { stored = await storeImage(await loadImage(url)); } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
  const st = useStore.getState();
  if (st.pgmMat.kind !== 'board') st.focusWin(BASE);
  const { pgmMat, pgm } = useStore.getState();
  const page = pgmMat.pages[pgm.page] ?? pgmMat.pages[0], ratio = page.h / page.w, key = inkKey(pgmMat.id, pgm.page);
  const [x0, y0, x1, y1] = placeImage(stored.w / stored.h, ratio, pgm, useStore.getState().ink[key] ?? []);
  const stroke: Stroke = { id: freshId(), tool: 'image', color: 'ink', size: 1, pts: [x0, y0, .5, x1, y1, .5], img: stored.url, author: 'teacher', layer: 'public' };
  useStore.getState().addStroke(key, stroke);
  if (host.role === 'teacher') toast(o.note ?? '截图已贴到黑板，周围和图上都能直接写字', { action: { label: '挪位置 / 调大小', run: () => useStore.getState().setShared({ tool: 'select', selectedInk: { key, ids: [stroke.id] } }) } });
  return stroke.id;
}

/** 框选屏幕上任意区域，贴到黑板。取消时返回 null */
export async function snipToBoard(): Promise<string | null> {
  if (!host.electron) throw new Error('截屏只能在桌面版里用');
  const file = await host.call<string | null>('screenSnip');
  return file ? pasteToBoard(host.fileUrl(file)) : null;
}

/** 从粘贴事件里拿图片（微信 / QQ 截图、浏览器里复制的图片） */
export function clipboardImage(e: ClipboardEvent): Blob | null {
  const items = [...(e.clipboardData?.items ?? [])];
  const it = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
  return it?.getAsFile() ?? null;
}

/** 窗口级 Ctrl+V：输入框里照常粘贴文字；其余地方有图片就贴到黑板 */
export function installPaste(enabled: () => boolean, onError: (msg: string) => void) {
  const handler = (e: ClipboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (e.defaultPrevented || el?.closest?.('input,textarea,[contenteditable],select')) return;
    if (!enabled()) return;
    const blob = clipboardImage(e);
    if (!blob) return;
    e.preventDefault();
    void pasteToBoard(blob).catch((err) => onError((err as Error).message));
  };
  window.addEventListener('paste', handler);
  return () => window.removeEventListener('paste', handler);
}
