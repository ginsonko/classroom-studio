// 公式轮廓缓存。draw() 是同步的：第一次遇到某个公式时先返回 null（画纯文本兜底），
// 后台加载 MathJax 编译好后 texTick() 变化，画布据此重画。
import type { TexShape } from './tex';
import { wakeInk } from './wake';

type Tex = typeof import('./tex');
const cache = new Map<string, TexShape | null>();
const pending = new Set<string>();
let mod: Promise<Tex> | null = null, tick = 0;
export const texTick = () => tick;
export const loadTex = (): Promise<Tex> => (mod ??= import('./tex'));

/** undefined = 还在加载；null = 公式写错了，调用方画纯文本 */
export function texShape(tex: string): TexShape | null | undefined {
  if (cache.has(tex)) return cache.get(tex)!;
  if (!pending.has(tex)) {
    pending.add(tex);
    void loadTex().then((m) => { try { cache.set(tex, m.compileTex(tex)); } catch { cache.set(tex, null); } }, () => cache.set(tex, null)).finally(() => { pending.delete(tex); tick++; wakeInk(); });
  }
  return undefined;
}

/** 编译并返回宽高比（宽 / 高）；语法错误时抛出 MathJax 的错误消息 */
export async function texAspect(tex: string): Promise<number> {
  const m = await loadTex(), s = m.compileTex(tex);
  cache.set(tex, s); tick++; wakeInk();
  return s.h > 0 ? s.w / s.h : 1;
}

/** 排版用：加载 MathJax 后返回同步的测量函数；结果进缓存，之后画的时候不用再编译。写错的公式返回 null */
export async function texMeasurer(): Promise<(tex: string) => TexShape | null> {
  const m = await loadTex();
  return (tex) => {
    if (cache.has(tex)) return cache.get(tex)!;
    let s: TexShape | null = null;
    try { s = m.compileTex(tex); if (!(s.w > 0 && s.h > 0)) s = null; } catch { s = null; }
    cache.set(tex, s); tick++; wakeInk();
    return s;
  };
}

const paths = new WeakMap<object, Path2D>();
export function drawTexShape(ctx: CanvasRenderingContext2D, s: TexShape, x0: number, y0: number, x1: number, y1: number) {
  if (!(s.h > 0) || !(s.w > 0)) return;
  const k = Math.min((y1 - y0) / s.h, (x1 - x0) / s.w);
  ctx.save(); ctx.translate(x0, y0 + ((y1 - y0) - s.h * k) / 2); ctx.scale(k, k);
  for (const op of s.ops) {
    ctx.save(); ctx.transform(...op.m);
    if (op.k === 'p') { let p = paths.get(op); if (!p) paths.set(op, (p = new Path2D(op.d))); ctx.fill(p); }
    else if (op.k === 'r') ctx.fillRect(op.x, op.y, op.w, op.h);
    else { ctx.font = `${op.size}px "Noto Sans SC", "Microsoft YaHei UI", serif`; ctx.textBaseline = 'alphabetic'; ctx.fillText(op.s, 0, 0); }
    ctx.restore();
  }
  ctx.restore();
}
