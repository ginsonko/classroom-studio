// AI 工具（cs_tools）在界面这边的状态：设置开关、待老师确认的卡片、各任务的 AI 浏览器、键鼠控制状态。
// 主进程（electron/toolHost.cjs 等）通过 'aitools' 事件推过来。
import { create } from 'zustand';
import { host } from './host';
import { isLive, useRecording } from './recording';
import { toast } from './toast';

export interface AiToolSettings { search: boolean; browser: boolean; desk: boolean }
export interface AiConfirm { id: string; key: string; who: string; kind: string; title: string; detail: string; site?: string; choices: ('once' | 'always' | 'deny')[]; at: number; expires: number }
export interface BrowserState {
  key: string; title: string; who: string; exists: boolean; url: string; pageTitle: string; loading: boolean; canBack: boolean; canForward: boolean;
  driving: boolean; paused: boolean; handoff: string; notice: string; tabs: { i: number; title: string; active: boolean }[];
}
export interface DeskState { key: string; who: string; paused: boolean; why: string }

interface S {
  settings: AiToolSettings; confirms: AiConfirm[]; browsers: Record<string, BrowserState>; pane: string | null; min: boolean; desk: DeskState | null; ready: boolean;
}
export const useAiTools = create<S>(() => ({ settings: { search: true, browser: true, desk: false }, confirms: [], browsers: {}, pane: null, min: false, desk: null, ready: false }));

let started = false;
export function startAiTools() {
  if (started || !host.electron) return;
  started = true;
  void host.call<{ settings: AiToolSettings; confirms: AiConfirm[]; browsers: BrowserState[]; desk: DeskState | null }>('aitools.status').then((r) => {
    useAiTools.setState({ settings: r.settings, confirms: r.confirms, desk: r.desk, ready: true, browsers: Object.fromEntries(r.browsers.filter((b) => b.exists).map((b) => [b.key, b])) });
  }).catch(() => {});
  host.onEvent((e) => {
    if (e?.type !== 'aitools') return;
    const m = e.aitools;
    if (m.ev === 'settings') useAiTools.setState({ settings: m.settings });
    else if (m.ev === 'confirms') {
      const was = new Set(useAiTools.getState().confirms.map((c) => c.id));
      useAiTools.setState({ confirms: m.items });
      if ((m.items as AiConfirm[]).some((c) => !was.has(c.id))) window.focus?.();
    } else if (m.ev === 'desk') {
      useAiTools.setState({ desk: m.state });
      if (m.ended) toast('键鼠控制已结束：' + m.ended);
    } else if (m.ev === 'browser') {
      const st: BrowserState = m.state;
      useAiTools.setState((s) => {
        const browsers = { ...s.browsers };
        if (st.exists) browsers[st.key] = st; else delete browsers[st.key];
        let pane = s.pane;
        if (pane === st.key && !st.exists) pane = null;
        // AI 刚开始用浏览器、或要老师帮忙时把面板打开；上课录像中不弹，只提醒一句
        if ((m.open || m.attention) && st.exists && pane !== st.key) {
          if (isLive(useRecording.getState().status.phase)) { if (m.attention) toast(`${st.who}在 AI 浏览器里等你：${st.handoff || '请看一下'}`); }
          else if (!pane || m.attention) pane = st.key;
        }
        return { browsers, pane, min: pane !== s.pane ? false : s.min };
      });
    }
  });
}

export const setAiToolSettings = (patch: Partial<AiToolSettings>) => host.call<AiToolSettings>('aitools.settings', patch).then((s) => { useAiTools.setState({ settings: s }); return s; });
export const answerConfirm = (id: string, choice: 'once' | 'always' | 'deny') => host.call('aitools.confirm', { id, choice });
export const browserAction = (key: string, action: string, arg?: unknown) => host.call<BrowserState>('aitools.browserAction', { key, action, arg });
export const openBrowser = (key: string) => useAiTools.setState({ pane: key, min: false });
export const closeBrowserPane = () => useAiTools.setState({ pane: null });
export const deskResume = () => host.call('aitools.deskResume');
export const deskStop = () => host.call('aitools.deskStop');
