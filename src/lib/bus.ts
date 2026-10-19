// 窗口间直连通道。浏览器样稿用 BroadcastChannel；
// Electron 版换成 MessageChannelMain 端口，接口不变。
import { host } from './host';
export type BusMsg =
  | { t: 'hello'; from: string }
  | { t: 'snapshot'; shared: unknown; to: string }
  | { t: 'shared'; patch: Record<string, unknown> }
  | { t: 'stroke'; key: string; stroke: unknown }
  | { t: 'erase'; key: string; ids: string[] }
  | { t: 'clear'; key: string; author?: string }
  | { t: 'edit'; key: string; remove?: string[]; upsert?: unknown[]; order?:string[]; actor?: string }
  | { t: 'history'; key: string; actor: string; redo: boolean }
  | { t: 'live'; key: string; stroke: unknown | null; from: string }
  | { t: 'laser'; key: string; pts: number[]; from: string };

type Fn = (m: BusMsg) => void;
const ch = !host.electron && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('classroom-studio-preview-v2') : null;
const subs = new Set<Fn>();
// 一个订阅者出错不能连累其他订阅者，也不能让这条同步消息整条丢失
const deliver = (m: BusMsg) => subs.forEach((f) => { try { f(m); } catch (e) { console.error('[bus] ' + m.t + ' 处理失败:', e); } });
ch?.addEventListener('message', (e) => deliver(e.data as BusMsg));
host.onBus((m) => deliver(m as BusMsg));

export const WINDOW_ID = Math.random().toString(36).slice(2, 9);

export const bus = {
  post(m: BusMsg) { if (host.electron) host.busPost(m); else ch?.postMessage(m); },
  on(f: Fn) { subs.add(f); return () => { subs.delete(f); }; },
  /** 本窗口内的实时事件（不出窗口），例如自己画的实时笔迹 */
  local: new EventTarget(),
};
