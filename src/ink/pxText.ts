// 画布坐标按页宽归一时，字号只有 0.01~0.03。Chromium 把字号量化到 0.01，小字会走样（下标变上标）甚至消失。
// 所以写字时在 (x, y) 处换到设备像素尺度：字号乘 k，局部坐标单位是像素。

export const pxScale = (ctx: CanvasRenderingContext2D) => { const m = ctx.getTransform?.(); return (m && Math.hypot(m.a, m.b)) || 1; };

export function atPx<T>(ctx: CanvasRenderingContext2D, x: number, y: number, fn: (k: number) => T): T {
  const k = pxScale(ctx);
  ctx.save(); ctx.translate(x, y); ctx.scale(1 / k, 1 / k);
  try { return fn(k); } finally { ctx.restore(); }
}

export function fillTextPx(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, font: (px: number) => string) {
  atPx(ctx, x, y, (k) => { ctx.font = font(size * k); ctx.fillText(s, 0, 0); });
}
