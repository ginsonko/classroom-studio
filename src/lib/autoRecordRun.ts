// 录像自动开关：每秒按课表、录像状态、最近的声音和操作跑一次 autoRecord 的逻辑，把结果变成卡片、提示和真正的开始 / 下课。
// 只在教师窗口里跑；卡片也只在教师窗口显示，学生画面和会议里看不到。
import { create } from 'zustand';
import { host } from './host';
import { useStore } from './store';
import { toast } from './toast';
import { isLive, nextLesson, startRecording, stopRecording, useRecording } from './recording';
import { quietRecords } from './recordAnalysis';
import { DEFAULT_AUTO_RECORD, SOUND_LEVEL, cleanAutoRecord, dismissAdhoc, extendStop, initialAutoRecord, lessonsAround, skipLesson, stepAutoRecord, type AutoAction, type AutoCard, type AutoRecordSettings, type AutoRecordState, type Lesson } from './autoRecord';

/** 桌面测试里换成假时钟 */
let clock = () => Date.now();
export function setClock(fn: () => number) { clock = fn; }

export const useAutoRecord = create<{ settings: AutoRecordSettings; card: AutoCard | null; state: AutoRecordState; now: number }>()(() => ({ settings: DEFAULT_AUTO_RECORD, card: null, state: initialAutoRecord(), now: clock() }));

let lastSound = 0, lastActivity = 0, activeSince = 0, timer: ReturnType<typeof setInterval> | null = null;
/** 学生画面上有操作（写字、换课件、翻页）；中间停了 1 分钟以上算新的一阵 */
export function noteActivity(now = clock()) { if (now - lastActivity > 60000) activeSince = now; lastActivity = now; }

/** 有人在说话（录像电平超过阈值）；桌面测试里也直接调 */
export function noteSound(now = clock()) { lastSound = now; }

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
  if (os && (document.hidden || !document.hasFocus())) void host.call('osNotify', { title: '自动录课', body: text }).catch(() => {});
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

export function tick(now = clock()) {
  const { settings, state } = useAutoRecord.getState(), st = useStore.getState(), status = useRecording.getState().status;
  const r = stepAutoRecord(state, {
    now, settings, lessons: lessonsAround(now, st.slots, st.students),
    live: isLive(status.phase), busy: status.phase === 'starting' || status.phase === 'stopping',
    recStudentId: status.studentId, recStartedAt: status.startedAt ?? null,
    hasAudio: status.audio ? status.audio.microphone || status.audio.system : true,
    lastSound, lastActivity, activeSince,
  });
  const prev = useAutoRecord.getState().card;
  useAutoRecord.setState({ state: r.state, now, ...(JSON.stringify(prev) === JSON.stringify(r.card) ? {} : { card: r.card }) });
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
export function cardAdhoc(start: boolean) {
  useAutoRecord.setState((s) => ({ card: null, state: dismissAdhoc(s.state, clock()) }));
  if (start) void startRecording();
}

/** 教师窗口启动时调一次 */
export function startAutoRecord() {
  if (timer || !host.electron || host.role !== 'teacher') return;
  host.call<{ autoRec?: unknown }>('settings').then((s) => setAutoRecordSettings(s.autoRec)).catch(() => {});
  useStore.subscribe((s, p) => { if (s.ink !== p.ink || s.pgmMat !== p.pgmMat || s.pgm !== p.pgm) noteActivity(); });
  useRecording.subscribe((s) => { if (Math.max(s.status.micLevel ?? 0, s.status.systemLevel ?? 0) >= SOUND_LEVEL) noteSound(); });
  timer = setInterval(() => tick(), 1000);
}
