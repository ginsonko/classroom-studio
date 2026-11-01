// 下课后的流水线：保存回放 → 语音转写 → 看画面 → 学情精析 → 写入 → 课后总结 → 板书。
// 每一步的状态都从录像信息、转写队列、分析进度和设置里算出来，不另外存一份，免得和真实情况对不上。
import { dateKey } from '../doc/scheduleModel';
import type { DueLesson } from './autopilotLogic';
import type { StudyData } from './studyLogic';
import type { Student } from './types';
import type { RecordRow } from './recording';

export type StepKey = 'save' | 'asr' | 'vision' | 'fine' | 'write' | 'summary' | 'board';
export type StepState = 'done' | 'run' | 'wait' | 'skip' | 'off' | 'error';
/** retry：这一步能单独重跑 / 现在就跑 */
export interface Step { key: StepKey; name: string; state: StepState; text: string; pct?: number; retry?: 'asr' | 'analyze' | 'summary' }
export const STEP_NAME: Record<StepKey, string> = { save: '保存回放', asr: '语音转写', vision: '看画面', fine: '学情精析', write: '写入学情', summary: '课后总结', board: '保存板书' };

/** 录像信息里记的下课后结果（板书、课后总结） */
export interface AfterMeta {
  board?: { at: string; files: number; skip?: string; error?: string };
  summary?: { at: string; lessons: number; via?: 'ai' | 'rules'; error?: string };
}
export interface PipeCtx {
  settings: { transcribe?: boolean; autoAnalyze?: boolean };
  /** 课后总结、保存板书开没开（课后总结：设置里单独开了，或者 AI 自动处理开着且勾了课后总结） */
  summaryOn: boolean; boardOn: boolean;
  asr: { installed: boolean; current: { id: string; pct: number } | null; queue: string[] } | null;
  /** 正在分析时的进度文字 */
  busy?: string;
  aiOnline: boolean;
  /** 一直没声音、被自动下课的录像（多半课没上） */
  quiet: boolean;
  /** 这节课该写总结的学生有几位、已经写了几位 */
  members: number; lessons: number;
  summaryBusy: boolean;
}

const LIVE = ['starting', 'recording', 'stopping'];
export const MIN_ANALYZE = 120;
/** 短于这个的录像（试录、误点）不自动写课后总结 */
export const MIN_SUMMARY = 600;
export const durationOf = (r: Pick<RecordRow, 'startedAt' | 'endedAt'>) => (r.startedAt && r.endedAt ? (r.endedAt - r.startedAt) / 1000 : 0);
const mk = (key: StepKey, state: StepState, text = '', extra: Partial<Step> = {}): Step => ({ key, name: STEP_NAME[key], state, text, ...extra });
const active = (s: Step) => s.state === 'run' || s.state === 'wait';

export function pipeline(row: RecordRow, c: PipeCtx): Step[] {
  const out: Step[] = [];
  // 保存回放
  const saved = row.phase === 'complete', broken = row.phase === 'recoverable' || row.phase === 'error';
  out.push(saved ? mk('save', 'done') : broken ? mk('save', 'error', row.error || '回放没生成好，到回放页恢复') : LIVE.includes(row.phase) ? mk('save', 'wait', '还在录') : mk('save', 'run', '生成中', typeof row.progress === 'number' ? { pct: Math.round(row.progress * 100) } : {}));

  // 语音转写
  const t = row.transcript, asr = c.asr;
  let a: Step;
  if (t?.phase === 'done') a = mk('asr', 'done', `${t.count ?? 0} 句`);
  else if (asr?.current?.id === row.id) a = mk('asr', 'run', '转写中', { pct: Math.round(asr.current.pct) });
  else if (asr?.queue.includes(row.id)) a = mk('asr', 'wait', '排队中');
  else if (t?.phase === 'running') a = mk('asr', 'run', '转写中');
  else if (t?.phase === 'error') a = mk('asr', 'error', t.error || '没转成文字', { retry: 'asr' });
  else if (c.settings.transcribe === false) a = mk('asr', 'off', '没开');
  else if (!asr?.installed) a = mk('asr', 'skip', '没装语音组件');
  else if (broken) a = mk('asr', 'skip', '回放没生成');
  else if (!saved) a = mk('asr', 'wait', '等回放');
  else a = mk('asr', 'skip', '没转写', { retry: 'asr' });
  out.push(a);

  // 看画面 / 学情精析 / 写入
  const an = row.analysis, voiceOk = a.state === 'done';
  if (c.busy !== undefined) {
    const b = c.busy;
    const at = /写进/.test(b) ? 2 : /听课堂原话/.test(b) ? 1 : 0;
    out.push(at > 0 ? mk('vision', 'done') : mk('vision', 'run', b));
    out.push(at === 1 ? mk('fine', 'run', '逐题判断中') : at === 0 ? mk('fine', voiceOk ? 'wait' : 'skip', voiceOk ? '' : '没有课堂原话') : mk('fine', voiceOk ? 'done' : 'skip', voiceOk ? '' : '没有课堂原话'));
    out.push(at === 2 ? mk('write', 'run', '写进题库和学情') : mk('write', 'wait'));
  } else if (an?.error) {
    out.push(mk('vision', 'error', an.error, { retry: 'analyze' }), mk('fine', 'skip'), mk('write', 'skip'));
  } else if (an) {
    out.push(mk('vision', 'done', `${an.frames} 张`));
    // 当时还没转完、现在转好了：可以听着原话再分析一遍
    out.push(an.voice ? mk('fine', 'done', `听了 ${an.voice} 句`) : mk('fine', 'skip', an.fineSkip || '没有课堂原话', voiceOk && /还没|没转/.test(an.fineSkip ?? '') ? { retry: 'analyze' } : {}));
    out.push(mk('write', 'done', an.attempts || an.questions ? [an.attempts ? `${an.attempts} 题` : '', an.questions ? `${an.questions} 道进收件箱` : '', an.pending ? `待确认 ${an.pending}` : ''].filter(Boolean).join(' · ') : '没认出题目'));
  } else {
    const why = c.settings.autoAnalyze === false ? ['off', '没开'] : !c.aiOnline ? ['skip', '没配 AI'] : !row.studentId ? ['skip', '没绑定学生'] : saved && durationOf(row) < MIN_ANALYZE ? ['skip', '不到 2 分钟'] : c.quiet ? ['skip', '一直没声音，没自动分析'] : broken ? ['skip', '回放没生成'] : !saved ? ['wait', '等回放'] : active(a) ? ['wait', '等语音转完'] : ['wait', '马上开始'];
    const st = why[0] as StepState, canRun = saved && !!row.studentId && c.aiOnline && durationOf(row) >= MIN_ANALYZE && !active(a);
    out.push(mk('vision', st, why[1], canRun ? { retry: 'analyze' } : {}), mk('fine', st === 'wait' ? 'wait' : st), mk('write', st === 'wait' ? 'wait' : st));
  }

  // 课后总结
  const s = row.after?.summary, analyzing = out.slice(1).some(active);
  if (c.members > 0 && c.lessons >= c.members) out.push(mk('summary', 'done', c.members > 1 ? `${c.lessons} 份` : s?.via === 'rules' ? '模板' : ''));
  else if (!c.summaryOn && !s) out.push(mk('summary', 'off', '没开'));
  else if (c.summaryBusy) out.push(mk('summary', 'run', '写总结中'));
  else if (s?.error) out.push(mk('summary', 'error', s.error, { retry: 'summary' }));
  else if (!row.studentId) out.push(mk('summary', 'skip', '没绑定学生'));
  else if (!c.summaryOn) out.push(mk('summary', 'off', '没开'));
  else if (durationOf(row) < MIN_SUMMARY) out.push(mk('summary', 'skip', '录像不到 10 分钟'));
  else out.push(mk('summary', 'wait', analyzing ? '等分析完' : '几分钟内写好', analyzing ? {} : { retry: 'summary' }));

  // 板书（下课那一下存的）
  const b = row.after?.board;
  out.push(b?.error ? mk('board', 'error', b.error) : b && b.files > 0 ? mk('board', 'done', `${b.files} 块`) : b ? mk('board', 'skip', b.skip || '黑板上没写字') : mk('board', 'off', c.boardOn ? '这节没存' : '没开'));
  return out;
}

/** 转写和分析都不会再动了（课后总结可以写了） */
export const analysisSettled = (steps: Step[]) => !steps.some((s) => ['asr', 'vision', 'fine', 'write'].includes(s.key) && active(s));
/** 课后总结最多等分析多久（从下课算） */
export const SUMMARY_WAIT = 90 * 60000;

export interface Chip { state: 'run' | 'wait' | 'error' | 'pending' | 'done'; text: string; pct?: number }
/** 顶栏胶囊上的一句话 */
export function chipOf(steps: Step[], pending: number): Chip {
  const run = steps.find((s) => s.state === 'run');
  if (run) return { state: 'run', text: run.name, ...(run.pct !== undefined ? { pct: run.pct } : {}) };
  const err = steps.find((s) => s.state === 'error');
  if (err) return { state: 'error', text: err.name + '没做完' };
  const wait = steps.find((s) => s.state === 'wait');
  if (wait) return { state: 'wait', text: '等' + wait.name };
  if (pending > 0) return { state: 'pending', text: `待确认 ${pending}` };
  return { state: 'done', text: '下课后处理好了' };
}
/** 除了保存回放，至少有一步开着、做了或在做：全都没开 / 跳过的不占顶栏（回放进度照旧单独显示） */
export const chipWorth = (steps: Step[]) => steps.some((s) => s.key !== 'save' && (s.state === 'done' || s.state === 'run' || s.state === 'wait' || s.state === 'error'));

/**
 * 录了像、但课表上没排（或者排的课没被认出来）的课：今天录的、绑了学生、超过 10 分钟的，也写课后总结。
 * 只看最近 12 小时下课的，升级后不会把以前的录像都补写一遍。
 */
export function recordedLessons(rows: RecordRow[], students: Student[], data: Pick<StudyData, 'lessons'>, done: Set<string>, now: number, quiet: Set<string> = new Set()): DueLesson[] {
  const out: DueLesson[] = [], live = students.filter((s) => !s.archived);
  for (const r of rows) {
    if (!r.studentId || !r.startedAt || !r.endedAt || LIVE.includes(r.phase) || quiet.has(r.id)) continue;
    if (durationOf(r) < MIN_SUMMARY || now - r.endedAt > 12 * 3600000 || now - r.endedAt < 0) continue;
    const st = live.find((s) => s.id === r.studentId);
    if (!st) continue;
    const date = dateKey(new Date(r.startedAt)), minutes = Math.round(durationOf(r) / 60);
    const who = st.kind ? (st.members ?? []).map((id) => live.find((x) => x.id === id && !x.kind)).filter((x): x is Student => !!x) : [st];
    for (const m of who) {
      const key = `lesson:${m.id}:${date}`;
      if (done.has(key) || data.lessons.some((l) => l.studentId === m.id && l.date === date) || out.some((x) => x.key === key)) continue;
      out.push({ studentId: m.id, date, topic: r.title || st.lastTopic || '', minutes, key, ...(st.kind ? { groupId: st.id } : {}) });
    }
  }
  return out;
}

/** 这节课（这位学生 / 他所在的班组、这一天）的录像 */
export const rowsOfLesson = (rows: RecordRow[], l: Pick<DueLesson, 'studentId' | 'date' | 'groupId'>) =>
  rows.filter((r) => (r.studentId === l.studentId || (!!l.groupId && r.studentId === l.groupId)) && !!r.startedAt && dateKey(new Date(r.startedAt)) === l.date);

/** 这一步是不是还要等：有录像还没分析完，而且离下课还不到 SUMMARY_WAIT */
export const shouldWait = (pairs: { row: RecordRow; steps: Step[] }[], now: number) =>
  pairs.some(({ row, steps }) => !analysisSettled(steps) && now - (row.endedAt ?? now) < SUMMARY_WAIT);

/** 顶栏胶囊跟着哪一段录像：最近 3 小时内下课的最后一段 */
export function chipRow(rows: RecordRow[], now: number, dismissed: Set<string>): RecordRow | null {
  const r = rows.filter((x) => x.endedAt && !LIVE.includes(x.phase) && now - x.endedAt < 3 * 3600000 && now >= x.endedAt - 60000).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  return r && !dismissed.has(r.id) ? r : null;
}
