// 浮动工具条放进屏幕的纯计算（浮层、学生工具条共用，测试直接调用）

/**
 * 浮层屏幕放不下时自动缩小：工具条高度和缩放成正比，按「现在的高度 ÷ 现在的缩放」算出 100% 时的高度，
 * 再取「老师选的大小」和「放得下的最大值」里小的那个。0.05 一档，避免来回抖；最小 50%。
 */
export function fitZoom(chosen: number, applied: number, height: number, room: number): number {
  if (!(room > 0) || !(height > 0) || !(applied > 0)) return chosen;
  const natural = height / applied;
  const fit = Math.floor((room / natural) * 20) / 20;
  return Math.max(0.5, Math.min(chosen, fit));
}

/** 学生工具条展开后最多能有多宽：圆钮朝哪边展开，就只能用那一边剩下的宽度 */
export function barRoom(viewport: number, center: number, half: number, toLeft: boolean, margin = 8): number {
  const room = toLeft ? center - half - margin : viewport - center - half - margin;
  return Math.max(120, Math.floor(room - 8));
}
