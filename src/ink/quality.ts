// 画布画质分级：按这台电脑实际画得动多少自动降级，老师也可以手动选「流畅优先」。
// 级别越高越省：0 = 原样；1 = 内部分辨率上限 1.5 倍、关粉笔光晕；2 = 分辨率上限 1 倍（按 CSS 像素画）、关光晕。
// 分辨率按面积算：4K 屏 150% 缩放时 2.5 倍上限的画布是 1 倍的 2.25 倍像素，每次整板重画、合成、被会议软件抓屏都按像素付费。
export type InkLevel = 0 | 1 | 2;
const DPR_CAP = [2.5, 1.5, 1] as const;

let auto: InkLevel = 0, forced = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => { try { f(); } catch { /* 订阅者自己的问题不影响别人 */ } });

export const inkLevel = (): InkLevel => (forced ? 2 : auto);
export const dprCap = () => DPR_CAP[inkLevel()];
/** 深色黑板上钢笔的光晕（shadowBlur）在软件渲染和集显上很贵，降级后不画 */
export const glowAllowed = () => inkLevel() === 0;
export const onInkLevel = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setFluent(on: boolean) { if (on === forced) return; forced = on; emit(); }

/** 显卡被拉黑、驱动太旧或远程桌面里，Chromium 退回软件渲染（SwiftShader / 微软基本显示驱动），画布全靠 CPU */
export function softwareRendered(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|basic render|llvmpipe|software/i.test(name);
  } catch { return false; }
}
let probed = false;
export function probeOnce() {
  if (probed || typeof document === 'undefined') return;
  probed = true;
  if (softwareRendered()) { auto = 2; emit(); }
}

// 运行时自适应：只统计「正在写」的帧。一帧里画布要做的工作（JS 里画笔迹 + 等 GPU 交回像素之前的提交）
// 超过预算就降一级。只往省的方向走，同一次运行里不回升，避免画质来回跳。
const WINDOW = 90, BUDGET_MS = 10, SLOW_SHARE = 0.25;
let samples: number[] = [];
export function reportPaint(ms: number) {
  if (forced || auto >= 2) return;
  samples.push(ms);
  if (samples.length < WINDOW) return;
  const slow = samples.filter((x) => x > BUDGET_MS).length / samples.length;
  samples = [];
  if (slow >= SLOW_SHARE) { auto = (auto + 1) as InkLevel; emit(); }
}
/** 测试用：回到初始状态 */
export function resetInkLevel(level: InkLevel = 0) { auto = level; forced = false; samples = []; emit(); }
