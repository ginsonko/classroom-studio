import { create } from 'zustand';
import { host } from './host';

export interface UpdateInfo { current: string; latest: string; date: string; notes: string[]; page: string; from: string; auto: boolean; reason: string; bytes: number; parts: string[] }
export interface UpdateState {
  phase: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error' | 'done' | 'failed';
  info?: UpdateInfo; error?: string; got?: number; total?: number; note?: string;
  result?: { ok: boolean; from: string; to: string; error?: string };
}

/** 帮助中心：说明书 / 关于与更新；update 跟主进程的更新状态同步 */
export const useHelp = create<{ open: false | 'manual' | 'about'; section: string; update: UpdateState; version: string; check: boolean; skip: string; toast: boolean }>(() => ({
  open: false, section: '', update: { phase: 'idle' }, version: '', check: true, skip: '', toast: false,
}));

export const openHelp = (open: 'manual' | 'about', section = '') => useHelp.setState({ open, section, toast: false });

host.onEvent((e) => {
  if (e.type !== 'update') return;
  const u = e.update as UpdateState, s = useHelp.getState();
  // 启动后的静默检查发现新版本：右下角提示一次；跳过的版本不提示
  const toast = (u.phase === 'available' && !!u.info && u.info.latest !== s.skip && s.update.phase !== 'available') || u.phase === 'done' || u.phase === 'failed';
  useHelp.setState({ update: u, toast: toast || (s.toast && u.phase !== 'latest') });
});

if (host.electron && host.role === 'teacher') {
  void host.call<UpdateState & { version: string; check: boolean; skip: string }>('update.state')
    .then(({ version, check, skip, ...update }) => useHelp.setState({ version, check, skip, update: { ...useHelp.getState().update, ...update } }))
    .catch(() => {});
}

const fail = (e: unknown) => useHelp.setState((s) => ({ update: { ...s.update, error: (e as Error).message } }));
export const checkUpdate = () => host.call<UpdateState>('update.check').then((u) => useHelp.setState({ update: u })).catch(fail);
export const downloadUpdate = () => host.call<UpdateState>('update.download').catch(fail);
export const installUpdate = () => host.call('update.install').catch(fail);
export const setUpdateCheck = (check: boolean) => host.call<{ check: boolean; skip: string }>('update.settings', { check }).then((r) => useHelp.setState(r)).catch(fail);
export const skipVersion = (skip: string) => { useHelp.setState({ skip, toast: false }); void host.call('update.settings', { skip }).catch(fail); };
export const openPage = (url?: string) => host.call('update.page', url).catch(fail);
export const mb = (b = 0) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 100 * 1048576 ? 0 : 1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
