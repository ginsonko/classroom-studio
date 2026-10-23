// 上课彩排的跨窗口小信号：浮层 / 导播台里发生了什么（存了板书、AI 回答了），以及现在该点亮哪个按钮。
// 只走教师窗口和浮层之间的 cmd 通道，学生窗口收不到。
import { create } from 'zustand';
import { bus } from '../lib/bus';
import { host } from '../lib/host';

export interface Spot { win: 'teacher' | 'dock'; sel: string }
export const useGuideSignals = create<{ hits: { name: string; at: number }[]; spot: Spot | null }>(() => ({ hits: [], spot: null }));

const addHit = (name: string, at: number) => useGuideSignals.setState((s) => ({ hits: [...s.hits.filter((h) => Date.now() - h.at < 3600_000), { name, at }].slice(-50) }));

/** 记一件老师做了的事（存了板书、AI 回答完了），彩排靠它判断这一步做到了没有 */
export function guideHit(name: string) {
  const at = Date.now();
  addHit(name, at);
  if (host.role !== 'student') bus.post({ t: 'cmd', name: 'guide.hit', arg: { name, at } });
}

/** 教师窗口设置要点亮的按钮；浮层里的按钮也由这里转过去 */
export function setGuideSpot(spot: Spot | null) {
  useGuideSignals.setState({ spot });
  bus.post({ t: 'cmd', name: 'guide.spot', arg: spot });
}

bus.on((m) => {
  if (m.t !== 'cmd' || host.role === 'student') return;
  const a = m.arg as Record<string, unknown> | null;
  if (m.name === 'guide.hit' && a && typeof a.name === 'string') addHit(a.name, Number(a.at) || Date.now());
  if (m.name === 'guide.spot') useGuideSignals.setState({ spot: a && typeof a.sel === 'string' && (a.win === 'teacher' || a.win === 'dock') ? { win: a.win, sel: a.sel } : null });
});
