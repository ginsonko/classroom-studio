// 课后语音转写（主进程 electron/asr.cjs）：组件下载进度、正在转哪一节、转写结果和搜索。
import { create } from 'zustand';
import { host } from './host';
import { toast } from './toast';
import { useRecording } from './recording';
import { useStore } from './store';
import type { Speaker, Transcript } from './transcript';

export { lineAt, matchLine, talkBands, WHO_NAME, type Speaker, type Transcript, type TranscriptSeg } from './transcript';

export interface AsrSetupState { phase: 'idle' | 'running' | 'done' | 'error'; step: string; pct: number; lines: string[]; error?: string; installed: boolean; bundled?: boolean; supported: boolean; platform: string; mb: number }
export interface AsrState { setup: AsrSetupState; enabled: boolean; paused: boolean; current: { id: string; title?: string; pct: number } | null; queue: string[] }
/** recording.json 里记的转写状态 */
export interface TranscriptMeta { phase: 'running' | 'done' | 'error'; at?: string; error?: string; count?: number; counts?: Partial<Record<Speaker, number>>; split?: string }
export interface TranscriptHit { id: string; title?: string; studentId: string | null; createdAt: string; t0: number; t1: number; who: Speaker; text: string }

export const asrApi = {
  state: () => host.call<AsrState>('asr.state'),
  install: () => host.call<AsrSetupState>('asr.install'),
  cancelInstall: () => host.call<boolean>('asr.cancelInstall'),
  uninstall: () => host.call<AsrSetupState>('asr.uninstall'),
  transcribe: (id: string) => host.call<AsrState>('asr.transcribe', id),
  transcript: (id: string) => host.call<Transcript | null>('asr.transcript', id),
  search: (q: string, studentId?: string) => host.call<TranscriptHit[]>('asr.search', { q, studentId }),
};

export const useAsr = create<{ state: AsrState | null; load: () => Promise<void> }>()((set) => ({
  state: null,
  load: async () => { if (!host.electron) return; try { set({ state: await asrApi.state() }); } catch { /* 老版本主进程 */ } },
}));

if (host.electron && host.role === 'teacher') {
  host.onEvent((e) => {
    if (e?.type === 'asr' && e.state) useAsr.setState({ state: e.state });
    if (e?.type === 'asrSetup' && e.state) useAsr.setState((s) => ({ state: s.state ? { ...s.state, setup: e.state } : s.state }));
    if (e?.type === 'asrDone') {
      useRecording.setState((s) => ({ rev: s.rev + 1 }));
      const title = e.record?.title || '课堂回放';
      if (e.error) toast(`「${title}」的语音没转成文字：${e.error}`, { ms: 10000 });
      else toast(`「${title}」的课堂原话已转成文字（${e.count} 句），在回放里能看字幕、搜原话`, { ms: 8000, action: { label: '去看看', run: () => useStore.getState().set({ page: 'replay' }) } });
    }
    if (e?.type === 'asrNeeded') {
      toast(`下载语音组件（约 ${e.mb || 250} MB，只需一次）后，下课能自动把老师和学生说的话转成文字，AI 分析也会更准`, {
        ms: 20000,
        action: { label: '下载', run: () => { void asrApi.install().then(() => useAsr.getState().load()).catch((err) => toast('没能开始下载：' + (err as Error).message)); } },
      });
    }
  });
  void useAsr.getState().load();
}
