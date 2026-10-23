// 把截图 / 图片贴到黑板上：作为一张可以拖动、缩放的贴图，下面和周围整块黑板照样能写字。
import { host } from '../lib/host';
import { inkKey, useStore } from '../lib/store';
import { BASE } from '../lib/desk';
import type { Stroke, View } from '../lib/types';
import { freshId } from './geometry';
import { placeImage } from './placeImage';
export { placeImage };
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
async function storeImage(img: HTMLImageElement, trim = false): Promise<{ url: string; w: number; h: number; lineArt?: boolean }> {
  let lineArt = false;
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  let w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  let canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  try {
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    if (trim) {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, w, h), box = opaqueBox(pixels);
      lineArt = isLineArt(pixels);
      if (box && (box.w < w || box.h < h)) {
        const cut = document.createElement('canvas'); cut.width = box.w; cut.height = box.h;
        cut.getContext('2d')!.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        canvas.width = 0; canvas.height = 0; canvas = cut; w = box.w; h = box.h;
      }
    }
    const data = canvas.toDataURL('image/png');
    if (!host.electron) return { url: data, w, h, lineArt };
    const saved = await host.call<string>('saveImage', data);
    return { url: host.fileUrl(saved), w, h, lineArt };
  } finally { canvas.width = 0; canvas.height = 0; }
}

/** 透明底上的深色单色线稿（插件画的几何图形）：不透明像素几乎都是深灰 / 黑、不带颜色 */
export function isLineArt(d: { data: Uint8ClampedArray }): boolean {
  const p = d.data;
  let solid = 0, odd = 0, clear = 0;
  for (let i = 0; i < p.length; i += 16) {
    if (p[i + 3] <= 8) { clear++; continue; }
    solid++;
    const mx = Math.max(p[i], p[i + 1], p[i + 2]), mn = Math.min(p[i], p[i + 1], p[i + 2]);
    if (mx - mn > 40 || mx > 140) odd++;
  }
  return solid > 0 && clear > solid && odd / solid < .04;
}

/** 不透明像素的外接框（四周留 2% 边，免得线条贴边被裁掉）；全透明返回 null */
export function opaqueBox(d: { data: Uint8ClampedArray; width: number; height: number }): { x: number; y: number; w: number; h: number } | null {
  const { data, width: W, height: H } = d;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * .02) + 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}


function assertCanPaste() {
  const st = useStore.getState();
  if (host.role === 'student' && st.drawAuthor === 'student' && st.studentTools !== 'open') throw new Error('老师锁定了学生工具，现在不能贴图');
}

/** 贴到当前黑板（学生画面不是黑板时先切回黑板）。src 可以是 Blob、data: 地址或 lesson:// 地址 */
export async function pasteToBoard(src: Blob | string, o: { note?: string; trim?: boolean; tint?: boolean } = {}): Promise<string> {
  // 学生窗口：谁拿着笔，贴图就算谁的（学生书写时贴的图学生自己能挪、能删）
  const author = host.role === 'student' ? useStore.getState().drawAuthor : 'teacher';
  assertCanPaste();
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  let stored: Awaited<ReturnType<typeof storeImage>>;
  try { stored = await storeImage(await loadImage(url), o.trim); } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
  const st = useStore.getState();
  if (st.pgmMat.kind !== 'board') st.focusWin(BASE);
  const { pgmMat, pgm } = useStore.getState();
  const page = pgmMat.pages[pgm.page] ?? pgmMat.pages[0], ratio = page.h / page.w, key = inkKey(pgmMat.id, pgm.page);
  const [x0, y0, x1, y1] = placeImage(stored.w / stored.h, ratio, pgm, useStore.getState().ink[key] ?? []);
  const stroke: Stroke = { id: freshId(), tool: 'image', color: 'ink', size: 1, pts: [x0, y0, .5, x1, y1, .5], img: stored.url, author, layer: 'public', ...(o.tint && stored.lineArt ? { tint: true } : {}) };
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

const NO_IMAGE = '剪贴板里没有图片。微信 / QQ 里请先点开图片，右键「复制」后再按 Ctrl+V；也可以直接把图片拖进来';

/** 窗口级 Ctrl+V：输入框里照常粘贴文字；其余地方有图片就贴到黑板 */
export function installPaste(enabled: () => boolean, onError: (msg: string) => void) {
  const handler = (e: ClipboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (e.defaultPrevented || el?.closest?.('input,textarea,[contenteditable],select')) return;
    if (!enabled()) return;
    const blob = clipboardImage(e) ?? [...(e.clipboardData?.files ?? [])].find((f) => /^image\//.test(f.type) || IMAGE_NAME.test(f.name)) ?? null;
    // 只复制了文字：不当成贴图
    const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (!blob && text && !IMAGE_NAME.test(text)) return;
    e.preventDefault();
    const run = async () => {
      assertCanPaste();
      if (blob) return pasteToBoard(blob);
      // 微信 / QQ 复制的图片常常是「文件」，网页事件里拿不到：让主进程从系统剪贴板读
      if (!host.electron) throw new Error(NO_IMAGE);
      const data = await host.call<string | null>('clipboardImage');
      if (!data) throw new Error(NO_IMAGE);
      return pasteToBoard(data);
    };
    void run().catch((err) => onError((err as Error).message));
  };
  window.addEventListener('paste', handler);
  return () => window.removeEventListener('paste', handler);
}

const IMAGE_NAME = /\.(png|jpe?g|bmp|gif|webp)$/i;
/** 拖进来的图片文件（从微信、QQ、资源管理器、浏览器拖） */
export function droppedImages(dt: DataTransfer | null): File[] {
  return [...(dt?.files ?? [])].filter((f) => /^image\//.test(f.type) || IMAGE_NAME.test(f.name)).slice(0, 6);
}
/** 把拖进来的图片依次贴到黑板 */
export async function dropToBoard(files: File[]): Promise<void> {
  for (const f of files) {
    if (f.size > 30 * 1024 * 1024) throw new Error(`「${f.name}」太大了（超过 30 MB）`);
    await pasteToBoard(f);
  }
}
