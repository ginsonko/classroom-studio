// 画布空闲时停掉逐帧循环；别的窗口的笔迹、公式 / 图片加载完这类不经过本画布的变化靠这里叫醒
const fns = new Set<() => void>();
export const onInkWake = (fn: () => void) => { fns.add(fn); return () => { fns.delete(fn); }; };
export const wakeInk = () => { for (const fn of fns) fn(); };
