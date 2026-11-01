// 下课后流水线在窗口里的部分：下课那一下存板书、给顶栏胶囊算每一步的状态、把结果记进录像信息。
import { create } from 'zustand';
import { host } from './host';
import { useStore } from './store';
import { useStudy } from './studyStore';
import { isLive, useRecording, type RecordRow, type RecordStatus } from './recording';
import { useAsr } from './asr';
import { quietRecords, useRecordAnalysis } from './recordAnalysis';
import { boardsAfterClass } from './classReset';
import { isGroup, membersOf } from './groups';
import { dateKey } from '../doc/scheduleModel';
import { pipeline, type AfterMeta, type Step } from './afterClassLogic';
import { toast } from './toast';

export interface AfterSettings { transcribe?: boolean; autoAnalyze?: boolean; afterSummary?: boolean; afterBoard?: boolean; afterBoardLong?: boolean }
interface AfterState {
  /** 老师收起了的胶囊（按录像 id） */
  dismissed: string[];
  /** 正在写课后总结的录像 */
  summaryBusy: Record<string, boolean>;
  /** 下课存的板书结果：先放这里，回放生成好以后再写一遍录像信息（转码期间写的可能被盖掉） */
  board: Record<string, NonNullable<AfterMeta['board']>>;
  rev: number;
  /** 顶栏胶囊正跟着的录像（这时不再单独显示「回放生成中」） */
  chip: string;
}
export const useAfter = create<AfterState>()(() => ({ dismissed: [], summaryBusy: {}, board: {}, rev: 0, chip: '' }));
const bump = () => useAfter.setState((s) => ({ rev: s.rev + 1 }));
export const dismissAfter = (id: string) => useAfter.setState((s) => ({ dismissed: [...s.dismissed.filter((x) => x !== id), id].slice(-50) }));
export const setSummaryBusy = (id: string, on: boolean) => useAfter.setState((s) => { const m = { ...s.summaryBusy }; if (on) m[id] = true; else delete m[id]; return { summaryBusy: m }; });

/** 往录像信息的 after 里合进一项（先读最新的，免得把另一项盖掉） */
export async function patchAfter(id: string, p: AfterMeta): Promise<void> {
  if (!host.electron) return;
  const row = (await host.call<RecordRow[]>('recordings').catch(() => [] as RecordRow[])).find((r) => r.id === id);
  if (!row) return;
  await host.call('recordPatch', { id, patch: { after: { ...(row.after ?? {}), ...p } } }).catch(() => {});
  useRecording.setState((s) => ({ rev: s.rev + 1 })); bump();
}

/** 这节课该写课后总结的学生（班组课是每位成员）、这一天已经写了几位 */
export function lessonCount(row: Pick<RecordRow, 'studentId' | 'startedAt'>) {
  const st = useStore.getState(), who = st.students.find((x) => x.id === row.studentId);
  const members = who ? (isGroup(who) ? membersOf(who, st.students) : [who]) : [];
  const date = row.startedAt ? dateKey(new Date(row.startedAt)) : '', lessons = useStudy.getState().data.lessons;
  return { members: members.length, lessons: members.filter((m) => lessons.some((l) => l.studentId === m.id && l.date === date)).length };
}

/** 一段录像下课后每一步的状态 */
export function stepsFor(row: RecordRow, o: { settings: AfterSettings; summaryOn: boolean; aiOnline: boolean }): Step[] {
  const asr = useAsr.getState().state, jobs = useRecording.getState().status.jobs ?? [];
  const job = jobs.find((j) => j.id === row.id);
  const board = row.after?.board ?? useAfter.getState().board[row.id];
  return pipeline({ ...row, ...(job ? { progress: job.progress } : {}), after: { ...(row.after ?? {}), ...(board ? { board } : {}) } }, {
    settings: o.settings, summaryOn: o.summaryOn, boardOn: !!o.settings.afterBoard,
    asr: asr ? { installed: asr.setup.installed, current: asr.current, queue: asr.queue } : null,
    busy: useRecordAnalysis.getState().busy[row.id], aiOnline: o.aiOnline, quiet: quietRecords.has(row.id),
    ...lessonCount(row), summaryBusy: !!useAfter.getState().summaryBusy[row.id],
  });
}

/** 下课那一下（学生画面还没换）：设置里开着就把写过的黑板存到这位学生名下 */
async function boardOnStop(was: RecordStatus) {
  const id = was.id;
  if (!id) return;
  const s = await host.call<AfterSettings>('settings').catch(() => null);
  if (!s?.afterBoard) return;
  const r = await boardsAfterClass(was.studentId ?? '', !!s.afterBoardLong);
  useAfter.setState((x) => ({ board: { ...x.board, [id]: r } })); bump();
  if (r.error) toast('下课存板书没成功：' + r.error, { ms: 10000 });
  await patchAfter(id, { board: r });
}

let started = false;
export function startAfterClass() {
  if (started || !host.electron || host.role !== 'teacher') return;
  started = true;
  const seen = new Set<string>();
  useRecording.subscribe((s, prev) => {
    const a = prev.status, b = s.status;
    // 录着的这一节停了（下课，或者连堂换下一节）
    if (a.phase !== 'recording' || !a.id || (isLive(b.phase) && b.phase !== 'stopping' && b.id === a.id) || seen.has(a.id)) return;
    seen.add(a.id);
    void boardOnStop(a);
  });
  host.onEvent((e) => {
    if (e?.type !== 'recordSaved' || !e.record?.id) return;
    const id = String(e.record.id), b = useAfter.getState().board[id];
    if (b) void patchAfter(id, { board: b });
  });
}
