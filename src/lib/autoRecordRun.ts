// 录像自动开关：每秒按课表、录像状态、最近的声音和操作跑一次 autoRecord 的逻辑，把结果变成卡片、提示和真正的开始 / 下课。
// 只在教师窗口里跑。1.7.0 起默认到点只提醒；1.8.0 起新增三段式显隐感知（未开课醒目防忘录 → 课中靠边隐身 → 到下课点醒目提醒）、
// 动笔未录即时轻提醒（在排课前后黑板动笔却未开录时提醒老师），以及向浮层同步一键清空/恢复课面状态。
import { create } from 'zustand';
import { host } from './host';
import { useStore } from './store';
import { toast } from './toast';
import { isLive, nextLesson, startRecording, stopRecording, useRecording } from './recording';
import { quietRecords } from './recordAnalysis';
import {
  DEFAULT_AUTO_RECORD, SOUND_LEVEL, cleanAutoRecord, dismissAdhoc, extendStop, initialAutoRecord,
  lessonOf, lessonsAround, skipLesson, snoozeCard, stepAutoRecord,
  type AutoAction, type AutoCard, type AutoRecordSettings, type AutoRecordState, type Lesson,
} from './autoRecord';
import { classHasContent, clearClass, restoreClass, studentName, useClassReset } from './classReset';
import { bus } from './bus';
import type { ClassBar } from './store';

/** 桌面测试里换成假时钟 */
let clock = () => Date.now();
export function setClock(fn: () => number) { clock = fn; }

export const useAutoRecord = create<{ settings: AutoRecordSettings; card: AutoCard | null; state: AutoRecordState; now: number }>()(() => ({
  settings: DEFAULT_AUTO_RECORD,
  card: null,
  state: initialAutoRecord(),
  now: clock(),
}));

let lastSound = 0, lastActivity = 0, activeSince = 0, timer: ReturnType<typeof setInterval> | null = null;
/** 1.8.0 未开课期间的动笔/翻页计数与静默控制（防止老师投入讲题忘点开始录像） */
let unrecordedInkOps = 0, unrecordedPageOps = 0, lastInkOpAt = 0, inkMutedUntil = 0;
const inkMutedLessons = new Set<string>();

/** 学生画面上有操作（写字、换课件、翻页）；中间停了 1 分钟以上算新的一阵 */
export function noteActivity(now = clock(), kind: 'ink' | 'page' = 'page') {
  if (now - lastActivity > 60000) {
    activeSince = now;
    // 间隔超过 3 分钟重新起算未录操作计数
    if (now - lastInkOpAt > 180_000) { unrecordedInkOps = 0; unrecordedPageOps = 0; }
  }
  lastActivity = now;
  if (!isLive(useRecording.getState().status.phase)) {
    lastInkOpAt = now;
    if (kind === 'ink') unrecordedInkOps++;
    else unrecordedPageOps++;
  }
}

/** 有人在说话（录像电平超过阈值）；桌面测试里也直接调 */
export function noteSound(now = clock()) { lastSound = now; }

/** 静默本节课的「动笔未录」轻提醒（老师明确点了这节不录时不再反复打扰） */
export function muteInkUnrecorded(now = clock()) {
  inkMutedUntil = now + 35 * 60_000;
  unrecordedInkOps = 0;
  unrecordedPageOps = 0;
  const st = useStore.getState();
  const near = findUpcomingLesson(now, lessonsAround(now, st.slots, st.students), useAutoRecord.getState().state.skipped);
  if (near) inkMutedLessons.add(near.key);
  publishClassBar(now);
}

/** 设置面板改了以后同步过来 */
export function setAutoRecordSettings(v: unknown) { useAutoRecord.setState({ settings: cleanAutoRecord(v) }); tick(); }

function beep() {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4); setTimeout(() => void ctx.close(), 800);
  } catch { /* 没有声卡也不影响 */ }
}

function notice(text: string, os?: boolean) {
  toast(text, { ms: 8000 });
  // 教师窗口被会议挡住或最小化时，再弹一条系统通知
  if (os && (document.hidden || !document.hasFocus())) void host.call('osNotify', { title: '课堂录课提醒', body: text }).catch(() => {});
  if (os && useAutoRecord.getState().settings.sound) beep();
}

async function selectStudent(l: Lesson) {
  const st = useStore.getState();
  if (st.studentId !== l.studentId) st.set({ studentId: l.studentId });
}

async function run(a: AutoAction) {
  if (a.type === 'notice') return notice(a.text, a.os);
  if (a.type === 'start' || a.type === 'next') {
    await selectStudent(a.lesson);
    if (a.type === 'start') await startRecording(a.lesson.topic || undefined); else await nextLesson(a.lesson.topic || undefined);
    const err = useRecording.getState().error;
    if (err) {
      // 没开起来：这节不再自动试，免得每半分钟弹一次；老师可以手动点「开始上课」
      useAutoRecord.setState((s) => ({ state: skipLesson(s.state, a.lesson.key) }));
      toast(`没能自动开始录像：${err}`, { ms: 12000 });
    } else toast(a.type === 'start' ? `已开始为「${a.lesson.name}」录像` : `上一节已保存，开始录「${a.lesson.name}」`);
    return;
  }
  if (a.type === 'stop') {
    const was = useRecording.getState().status, empty = a.reason === 'idle' && !!was.id && !!was.startedAt && lastSound < was.startedAt && lastActivity < was.startedAt;
    if (empty) quietRecords.add(was.id!);
    await stopRecording();
    const err = useRecording.getState().error;
    if (err) { toast('没能自动下课：' + err, { ms: 12000 }); return; }
    toast(empty ? '这段录像从头到尾都没有声音和操作，已自动下课保存；AI 不会自动分析它，需要时在「回放」页点「AI 分析」' : a.reason === 'idle' ? '很久没有声音和操作，已自动下课并保存录像' : '已到自动下课时间，录像已保存', { ms: 12000 });
  }
}

/** 查找未开课时当前临近（课前 20 分钟内）或正在排课时段内的课次 */
function findUpcomingLesson(now: number, lessons: Lesson[], skipped: string[]): Lesson | undefined {
  return lessons.find((l) => !skipped.includes(l.key) && now >= l.start - 20 * 60_000 && now < l.end - 5 * 60_000);
}

export function tick(now = clock()) {
  const { settings, state } = useAutoRecord.getState(), st = useStore.getState(), status = useRecording.getState().status;
  const live = isLive(status.phase);
  if (live) {
    unrecordedInkOps = 0;
    unrecordedPageOps = 0;
  }
  const r = stepAutoRecord(state, {
    now, settings, lessons: lessonsAround(now, st.slots, st.students),
    live, busy: status.phase === 'starting' || status.phase === 'stopping',
    recStudentId: status.studentId, recStartedAt: status.startedAt ?? null,
    hasAudio: status.audio ? status.audio.microphone || status.audio.system : true,
    lastSound, lastActivity, activeSince,
  });
  const prev = useAutoRecord.getState().card;
  useAutoRecord.setState({ state: r.state, now, ...(JSON.stringify(prev) === JSON.stringify(r.card) ? {} : { card: r.card }) });
  publishClassBar(now);
  for (const a of r.actions) void run(a).catch((e) => toast('自动录课出错：' + (e as Error).message));
}

// ── 卡片上的按钮 ──
export function cardStartNow() {
  const c = useAutoRecord.getState().card;
  if (c?.kind !== 'start' && c?.kind !== 'next') return;
  useAutoRecord.setState((s) => ({ card: null, state: { ...s.state, armed: undefined, pending: { key: c.lesson.key, at: clock(), mode: 'start' } } }));
  void run({ type: c.kind, lesson: c.lesson });
}
export function cardSkip() {
  const c = useAutoRecord.getState().card;
  if (c?.kind !== 'start' && c?.kind !== 'next') return;
  inkMutedLessons.add(c.lesson.key);
  useAutoRecord.setState((s) => ({ card: null, state: skipLesson(s.state, c.lesson.key) }));
  toast(c.kind === 'next' ? `「${c.lesson.name}」这节不自动录，「${c.from?.name ?? '这一节'}」接着录` : `「${c.lesson.name}」这节不自动录了，需要时点顶部「开始上课」`);
}
/** 「改成当前学生」：给顶栏上选中的学生录，不按课表上的学生 */
export function cardForCurrent() {
  const c = useAutoRecord.getState().card, st = useStore.getState();
  if (c?.kind !== 'start') return;
  const who = st.students.find((s) => s.id === st.studentId);
  useAutoRecord.setState((s) => ({ card: null, state: { ...skipLesson(s.state, c.lesson.key), pending: { key: c.lesson.key, at: clock(), mode: 'start' } } }));
  void startRecording().then(() => { if (!useRecording.getState().error) toast(`已开始为「${who?.name ?? '自由课堂'}」录像`); });
}
export function cardExtend() {
  const c = useAutoRecord.getState().card;
  if (c?.kind !== 'stop') return;
  useAutoRecord.setState((s) => ({ card: null, state: extendStop(s.state, clock(), c) }));
  toast(c.reason === 'idle' ? '好的，接着录' : '好的，再录 15 分钟');
}
export function cardStopNow() {
  if (useAutoRecord.getState().card?.kind !== 'stop') return;
  useAutoRecord.setState({ card: null });
  void stopRecording();
}
/** 「稍后 5 分钟再提醒」 */
export function cardSnooze() {
  const c = useAutoRecord.getState().card;
  if (!c) return;
  useAutoRecord.setState((s) => ({ card: null, state: snoozeCard(s.state, clock(), c) }));
  toast('好的，5 分钟后再提醒你');
}

export type ClassAct = 'start' | 'stop' | 'later' | 'skip' | 'mute_ink' | 'clear' | 'restore';

/** 学生窗口角落与教师浮层的快捷按钮：统一由教师窗口按当前状态安全执行 */
export function classButton(act: ClassAct) {
  const c = useAutoRecord.getState().card, phase = useRecording.getState().status.phase;
  if (act === 'mute_ink') return muteInkUnrecorded();
  if (act === 'clear') {
    const st = useStore.getState();
    void clearClass({ archiveTo: st.classOf || st.studentId }).then(() => publishClassBar());
    return;
  }
  if (act === 'restore') {
    restoreClass();
    publishClassBar();
    return;
  }
  if (act === 'later') return cardSnooze();
  if (act === 'skip') return cardSkip();
  if (act === 'stop') { if (phase === 'recording') { if (c?.kind === 'stop') cardStopNow(); else void stopRecording(); } return; }
  if (c?.kind === 'start' || c?.kind === 'next') return cardStartNow();
  // 若当前没有弹窗但有临近排课，点开始上课自动切到排课学生并开始录课
  const now = clock(), st = useStore.getState();
  const near = findUpcomingLesson(now, lessonsAround(now, st.slots, st.students), useAutoRecord.getState().state.skipped);
  if (!isLive(phase)) {
    if (near && st.studentId === 'free') st.set({ studentId: near.studentId });
    void startRecording(near && (st.studentId === near.studentId || st.studentId === 'free') ? near.topic || undefined : undefined);
  }
}

let lastBar = '';
/** 把上课状态、排课到点提醒、动笔未录与清台状态发布给学生窗口和浮层（只在变化时发） */
export function publishClassBar(now = clock()) {
  const { settings, card, state } = useAutoRecord.getState(), status = useRecording.getState().status;
  const st = useStore.getState();
  const live = isLive(status.phase);
  const lessons = lessonsAround(now, st.slots, st.students);

  const ask = card && (card.kind === 'start' || card.kind === 'next') && !card.deadline
    ? { name: card.lesson.name, late: card.kind === 'start' && card.late, next: card.kind === 'next' }
    : null;

  // 1. 未开课时：是否有临近或已到点的排课
  const near = !live ? findUpcomingLesson(now, lessons, state.skipped) : undefined;
  const upcoming = near ? { name: near.name, startAt: near.start, endAt: near.end, late: now >= near.start } : null;

  // 2. 上课中：是否已经到达或超过下课时间点（有排课看排课下课点，无排课录满 60 分钟温和变醒目；点过延长则按 extendTo）
  let overtime: ClassBar['overtime'] = null;
  if (live && status.phase === 'recording') {
    const cur = lessons.find((l) => l.key === state.current) ?? lessonOf(lessons, status.studentId, status.startedAt);
    const dueEnd = state.extendTo ?? (cur ? cur.end : (status.startedAt ? status.startedAt + 60 * 60_000 : Infinity));
    if (now >= dueEnd) {
      overtime = { name: cur?.name, endAt: dueEnd };
    }
  }

  // 3. 动笔未录轻提醒：未开课时，在排课前后（课前 12 分钟～课中）写了 >=2 笔或翻了 >=2 次课件，或平时连写 >=4 笔
  let inkUnrecorded: ClassBar['inkUnrecorded'] = null;
  if (!live && status.phase === 'idle' && now > inkMutedUntil && now - lastInkOpAt < 50_000) {
    const inNearWindow = !!near && now >= near.start - 12 * 60_000 && !inkMutedLessons.has(near.key);
    const hit = inNearWindow ? (unrecordedInkOps >= 2 || unrecordedPageOps >= 3) : (unrecordedInkOps >= 4);
    if (hit) {
      const stuName = near?.name || st.students.find((x) => x.id === st.studentId)?.name || '';
      inkUnrecorded = { name: stuName || undefined };
    }
  }

  // 4. 清空课堂与恢复状态同步给教师浮层
  const hasContent = classHasContent();
  const canRestore = useClassReset.getState().canRestore;
  const clearOwner = st.classOf && st.classOf !== st.studentId && hasContent ? studentName(st.classOf) : '';

  const bar: ClassBar = {
    show: settings.stageButton,
    phase: status.phase,
    since: live ? status.startedAt ?? 0 : 0,
    ask,
    upcoming,
    overtime,
    inkUnrecorded,
    canClear: hasContent,
    canRestore,
    clearOwner,
  };
  const json = JSON.stringify(bar);
  if (json === lastBar) return;
  lastBar = json;
  st.setShared({ classBar: bar });
}

export function cardAdhoc(start: boolean) {
  useAutoRecord.setState((s) => ({ card: null, state: dismissAdhoc(s.state, clock()) }));
  if (start) void startRecording();
}

/** 教师窗口启动时调一次 */
export function startAutoRecord() {
  if (timer || !host.electron || host.role !== 'teacher') return;
  host.call<{ autoRec?: unknown }>('settings').then((s) => setAutoRecordSettings(s.autoRec)).catch(() => {});
  useStore.subscribe((s, p) => {
    if (s.ink !== p.ink) noteActivity(clock(), 'ink');
    else if (s.pgmMat !== p.pgmMat || s.pgm !== p.pgm) noteActivity(clock(), 'page');
    if (s.desk !== p.desk || s.pgmMat !== p.pgmMat || s.studentId !== p.studentId || s.classOf !== p.classOf) {
      // 用微任务延后发布状态条，避免在外层 setShared 的 set() 同步通知栈中途重入打乱消息顺序
      queueMicrotask(() => publishClassBar());
    }
  });
  useClassReset.subscribe(() => publishClassBar());
  useRecording.subscribe((s) => {
    if (Math.max(s.status.micLevel ?? 0, s.status.systemLevel ?? 0) >= SOUND_LEVEL) noteSound();
    publishClassBar();
  });
  useAutoRecord.subscribe(() => publishClassBar());
  bus.on((m) => { if (m.t === 'class') classButton(m.act as ClassAct); });
  publishClassBar();
  timer = setInterval(() => tick(), 1000);
}
