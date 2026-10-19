import type { Material } from '../lib/types';
import { intersect, type Rect } from './geometry';
import { pageImage } from './pdf';
import { host } from '../lib/host';

/** 跨页框选合成真实页像素；选区与页边求交，保留阅读器中的页间空白，不混入私有笔记。 */
export async function regionMaterial(mat: Material, selection: Rect, pages: { top: number; left: number; width: number; height: number }[]): Promise<Material> {
  const included = pages.flatMap((r, index) => {
    const clip = intersect(selection, [r.left, r.top, r.width, r.height]);
    return clip ? [{ index, r, clip }] : [];
  });
  if (!included.length) throw new Error('选区内没有课件内容，请在页面上重新框选。');
  const [x, y, w, h] = selection;
  if (w <= 0 || h <= 0) throw new Error('选区太小。');
  const scale = Math.min(2.5, 4096 / w, 4096 / h, Math.sqrt(8_000_000 / (w * h)));
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    for (const { index, r, clip } of included) {
      const image = await pageImage(mat.pages[index], r.width * scale);
      const [cx, cy, cw, ch] = clip;
      ctx.drawImage(image, (cx - r.left) / r.width * image.naturalWidth, (cy - r.top) / r.height * image.naturalHeight, cw / r.width * image.naturalWidth, ch / r.height * image.naturalHeight, (cx - x) * scale, (cy - y) * scale, cw * scale, ch * scale);
    }
    const data = canvas.toDataURL('image/png');
    const saved = host.electron ? await host.call<string>('saveImage', data) : null;
    const src = saved ? host.fileUrl(saved) : data;
    return { id: `region:${mat.id}:${crypto.randomUUID()}`, title: `${mat.title} · 选区（${included[0].index + 1}${included.length > 1 ? '–' + (included.at(-1)!.index + 1) : ''}页）`, kind: 'image', path: saved || mat.path, ...(saved ? { src: { path: saved, render: 'image' as const, status: 'ready' as const } } : {}), pages: [{ src, w: canvas.width, h: canvas.height }], total: 1 };
  } finally { canvas.width = 0; canvas.height = 0; }
}
