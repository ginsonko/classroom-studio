import type { Stroke } from '../lib/types';
import { draw } from './draw';
import { selectionBounds } from './geometry';

/** 把选中的笔迹画成白底黑字的 PNG（给视觉模型看）。笔迹原本的颜色、黑板底色都不要，识别更稳 */
export function strokesToPng(strokes: Stroke[], maxSide = 1024): { url: string; w: number; h: number } {
  const b = selectionBounds(strokes), bw = Math.max(1e-4, b.x1 - b.x0), bh = Math.max(1e-4, b.y1 - b.y0);
  const pad = Math.max(bw, bh) * 0.06 + 0.004;
  const W = bw + pad * 2, H = bh + pad * 2;
  // 太小的笔迹也放大到至少 360 像素高，模型才看得清
  const s = Math.min(maxSide / W, maxSide / H, Math.max(360 / H, 1600));
  const cw = Math.max(16, Math.round(W * s)), ch = Math.max(16, Math.round(H * s));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(s, 0, 0, s, -(b.x0 - pad) * s, -(b.y0 - pad) * s);
  const d = { ctx, scale: s, dark: false, color: () => '#111' };
  for (const st of strokes) draw(d, { ...st, layer: 'public', tool: st.tool === 'highlighter' ? 'marker' : st.tool });
  return { url: c.toDataURL('image/png'), w: cw, h: ch };
}
