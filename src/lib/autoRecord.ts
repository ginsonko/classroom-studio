// 录像自动开、自动关的纯逻辑：给定课表、当前时间、录像状态、最近的声音和操作，算出该显示哪张卡片、该做什么。
// 不碰窗口和主进程，时间全靠传进来的 now，Node 里用假时钟就能测完所有边界。
import { dateKey, onDate } from '../doc/scheduleModel';
import { isDefaultTopic } from './groups';
import type { LessonSlot, Student } from './types';

export interface AutoRecordSettings {
  start: boolean;       // 到上课时间自动开始录像
  lead: number;         // 提前几分钟开始（0 / 2 / 5 / 10）
  stopAfter: number;    // 下课后多少分钟还在录就自动下课；0 = 不自动下课
  idle: boolean;        // 长时间没声音也没操作时提醒下课
  idleMinutes: number;
  adhoc: boolean;       // 没排课时，老师在学生画面上连续操作也提示录像
  sound: boolean;       // 提醒时响一声
}
// 默认提前 5 分钟：课表按刻钟对齐，实际上课常比课表早几分钟
export const DEFAULT_AUTO_RECORD: AutoRecordSettings = { start: true, lead: 5, stopAfter: 15, idle: true, idleMinutes: 20, adhoc: false, sound: false };
export const LEADS = [0, 2, 5, 10], STOP_AFTER = [0, 15, 30, 45, 60], IDLE_MINUTES = [10, 20, 30, 45];
export function cleanAutoRecord(v: unknown): AutoRecordSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<AutoRecordSettings>, d = DEFAULT_AUTO_RECORD;
  const b = (k: 'start' | 'idle' | 'adhoc' | 'sound') => (typeof o[k] === 'boolean' ? o[k] as boolean : d[k]);
  const pick = (k: 'lead' | 'stopAfter' | 'idleMinutes', list: number[]) => (list.includes(Number(o[k])) ? Number(o[k]) : d[k]);
  // 下课后多久自动关也可以自定义：5–240 分钟
  const stop = Number(o.stopAfter), stopAfter = Number.isInteger(stop) && (stop === 0 || (stop >= 5 && stop <= 240)) ? stop : d.stopAfter;
  return { start: b('start'), lead: pick('lead', LEADS), stopAfter, idle: b('idle'), idleMinutes: pick('idleMinutes', IDLE_MINUTES), adhoc: b('adhoc'), sound: b('sound') };
}

/** 课表上具体的一次课（某一天的那一节），时间是毫秒时间戳 */
export interface Lesson { key: string; slotId: string; studentId: string; name: string; topic: string; start: number; end: number }

const MIN = 60000;
/** 倒计时多久后自动开始 / 换下一节 */
export const COUNTDOWN = 10000;
/** 自动下课前多久提醒 */
export const STOP_WARN = 2 * MIN;
/** 「再录 15 分钟」 */
export const EXTEND = 15 * MIN;
/** 离下课不到这么久就不再自动开始（开了也录不了几分钟） */
const TOO_LATE = 5 * MIN;
/** 提前在学生画面上写字、上屏课件时，最早提前多久算开始上这节课 */
const EARLY_ACTIVITY = 15 * MIN;
/** 声音电平（0–1，均方根 / 40）超过这个算有人在说话 */
export const SOUND_LEVEL = 0.06;
/** 没排课时连续操作多久提示录像；提示过多久内不再提示 */
const ADHOC_AFTER = MIN, ADHOC_QUIET = 30 * MIN, ADHOC_SHOW = 3 * MIN;

/** now 前后一天内的课（昨天开始、过了午夜还没下课的也算），按开始时间排 */
export function lessonsAround(now: number, slots: LessonSlot[], students: Student[]): Lesson[] {
  const out: Lesson[] = [], today = new Date(now);
  for (const k of [-1, 0, 1]) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k), date = dateKey(day);
    for (const s of slots) {
      const st = students.find((x) => x.id === s.studentId);
      if (!st || st.archived || !Number.isFinite(s.start) || !(s.len > 0) || !onDate(s, day)) continue;
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(s.start), Math.round((s.start % 1) * 60)).getTime();
      out.push({ key: `${s.id}@${date}`, slotId: s.id, studentId: s.studentId, name: st.name, topic: isDefaultTopic(s.topic) ? '' : s.topic, start, end: start + Math.round(s.len * 60) * MIN });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
}

export interface AutoRecordState {
  /** 老师点了「这节不录」、或者这节已经录过下课了的课：不再自动开 */
  skipped: string[];
  /** 正在倒计时的那节课和倒计时开始的时刻 */
  armed?: { key: string; at: number; mode: 'start' | 'next' };
  /** 已经发出开始 / 换下一节的指令，等录像状态跟上（免得每秒发一次） */
  pending?: { key: string; at: number; mode: 'start' | 'stop' };
  /** 正在录的这段录像对应的课（没对上课表就是空） */
  current?: string;
  recStartedAt?: number;
  /** 「再录 15 分钟」以后的自动下课时刻 */
  extendTo?: number;
  /** 「再录」之后，没声音也没操作从这里重新算 */
  idleBase?: number;
  /** 已经提示过「到下课时间」的课 */
  ended?: string;
  /** 已经发过「快自动下课了」系统通知的那个时刻 */
  warned?: number;
  wasLive: boolean;
  /** 没排课的提示：什么时候弹出的、什么时候被关掉 / 自动收起的 */
  adhocAt?: number;
  adhocDone?: number;
}
export const initialAutoRecord = (): AutoRecordState => ({ skipped: [], wasLive: false });

export interface AutoRecordInput {
  now: number;
  settings: AutoRecordSettings;
  lessons: Lesson[];
  /** 正在录（含开始、收尾） */
  live: boolean;
  /** 正在开始或正在收尾：这时候什么都不做 */
  busy: boolean;
  recStudentId?: string | null;
  recStartedAt?: number | null;
  /** 这段录像录了麦克风或系统声音（都没录就没法按声音判断冷场） */
  hasAudio: boolean;
  lastSound: number;
  lastActivity: number;
  /** 这一阵连续操作是从什么时候开始的（中间停过 1 分钟以上就重新算） */
  activeSince: number;
}

export type AutoCard =
  | { kind: 'start'; lesson: Lesson; deadline: number; late: boolean }
  | { kind: 'next'; lesson: Lesson; from?: Lesson; deadline: number }
  | { kind: 'stop'; reason: 'schedule' | 'idle'; deadline: number; lesson?: Lesson }
  | { kind: 'adhoc' };
export type AutoAction =
  | { type: 'start'; lesson: Lesson }
  | { type: 'next'; lesson: Lesson }
  | { type: 'stop'; reason: 'schedule' | 'idle' }
  | { type: 'notice'; text: string; os?: boolean };

const keep = (skipped: string[], key: string) => (skipped.includes(key) ? skipped : [...skipped, key].slice(-60));
/** 这段录像是哪节课的：同一个学生，录像在这节课开始前一小时到下课之间开始 */
export function lessonOf(lessons: Lesson[], studentId: string | null | undefined, startedAt: number | null | undefined) {
  if (!studentId || !startedAt) return undefined;
  return lessons.find((l) => l.studentId === studentId && startedAt >= l.start - 60 * MIN && startedAt < l.end);
}

/**
 * 每秒跑一次：返回新的状态、要显示的卡片、要做的事。
 * 老师在卡片上点的按钮（这节不录、再录 15 分钟……）用下面的 skipLesson / extendStop 改状态。
 */
export function stepAutoRecord(prev: AutoRecordState, i: AutoRecordInput): { state: AutoRecordState; card: AutoCard | null; actions: AutoAction[] } {
  const { now, settings: set, lessons } = i, actions: AutoAction[] = [];
  let s: AutoRecordState = { ...prev };
  if (i.busy) return { state: s, card: null, actions };
  const find = (key?: string) => lessons.find((l) => l.key === key);

  // 下课了（手动点的、自动的都算）：这节课不再自动开
  if (s.wasLive && !i.live) {
    if (s.current) s.skipped = keep(s.skipped, s.current);
    // 连堂换下一节时中间会有一下「已保存」：开下一节的指令还在路上，留着它，免得又倒计时开一次
    s = { skipped: s.skipped, wasLive: false, adhocDone: s.adhocDone, pending: s.pending?.mode === 'start' ? s.pending : undefined };
  }
  s.wasLive = i.live;
  // 自动开始（含连堂换下一节）的录像本来就知道是哪节课，不必再按开始时间去对
  const startedFor = s.pending?.mode === 'start' && i.live && s.recStartedAt !== i.recStartedAt && find(s.pending.key)?.studentId === i.recStudentId ? s.pending.key : undefined;
  if (s.pending && (now - s.pending.at > 30000 || (i.live && s.recStartedAt !== i.recStartedAt))) s.pending = undefined;
  if (s.pending) return { state: s, card: null, actions };

  if (i.live) {
    s.armed = s.armed?.mode === 'next' ? s.armed : undefined;
    s.adhocAt = undefined;
    // 新开始的一段录像（含连堂换下一节）：重新对课表
    if (s.recStartedAt !== i.recStartedAt) {
      s = { ...s, recStartedAt: i.recStartedAt ?? undefined, current: startedFor ?? lessonOf(lessons, i.recStudentId, i.recStartedAt)?.key, extendTo: undefined, idleBase: undefined, ended: undefined, warned: undefined, armed: undefined };
    }
    let cur = find(s.current);
    // 同一个学生连着两节：录像接着录，算到后一节上
    if (cur) {
      const c = cur, after = lessons.find((l) => l.key !== c.key && l.studentId === c.studentId && l.start >= c.end - 5 * MIN && l.start <= c.end + 5 * MIN && now >= l.start - set.lead * MIN);
      if (after && !s.skipped.includes(after.key)) { s.skipped = keep(s.skipped, c.key); s.current = after.key; s.extendTo = undefined; s.ended = undefined; s.warned = undefined; cur = after; }
    }
    const stopAt = s.extendTo ?? (cur && set.stopAfter > 0 ? cur.end + set.stopAfter * MIN : Infinity);

    // 连堂：下一位学生的课到点了，先存这一节再开下一节
    if (cur && set.start) {
      const c = cur, next = lessons.find((l) => l.key !== c.key && l.studentId !== c.studentId && l.start >= c.end - 10 * MIN && l.start < stopAt && now >= l.start && now < l.end - TOO_LATE && !s.skipped.includes(l.key));
      if (next) {
        if (s.armed?.key !== next.key) { s.armed = { key: next.key, at: now, mode: 'next' }; actions.push({ type: 'notice', text: `连堂：${COUNTDOWN / 1000} 秒后保存这一节，开始录「${next.name}」`, os: true }); }
        const deadline = s.armed.at + COUNTDOWN;
        if (now >= deadline) { s.armed = undefined; s.pending = { key: next.key, at: now, mode: 'start' }; actions.push({ type: 'next', lesson: next }); return { state: s, card: null, actions }; }
        return { state: s, card: { kind: 'next', lesson: next, from: c, deadline }, actions };
      }
    }
    s.armed = undefined;

    if (cur && now >= cur.end && s.ended !== cur.key) { s.ended = cur.key; actions.push({ type: 'notice', text: `已到「${cur.name}」的下课时间，录像还在继续` }); }

    // 冷场：麦克风和系统声音都几乎没声音，学生画面上也没操作
    const idleAt = set.idle && i.hasAudio ? Math.max(i.recStartedAt ?? 0, i.lastSound, i.lastActivity, s.idleBase ?? 0) + set.idleMinutes * MIN : Infinity;
    const reason: 'schedule' | 'idle' = idleAt < stopAt ? 'idle' : 'schedule', at = Math.min(stopAt, idleAt);
    if (at === Infinity) return { state: s, card: null, actions };
    if (now >= at) {
      s.pending = { key: s.current ?? '', at: now, mode: 'stop' };
      actions.push({ type: 'stop', reason });
      return { state: s, card: null, actions };
    }
    if (now >= at - STOP_WARN) {
      if (s.warned !== at) { s.warned = at; actions.push({ type: 'notice', text: reason === 'idle' ? `已经 ${set.idleMinutes - STOP_WARN / MIN} 分钟没有声音和操作，2 分钟后自动下课并保存录像` : '2 分钟后自动下课并保存录像', os: true }); }
      return { state: s, card: { kind: 'stop', reason, deadline: at, lesson: cur }, actions };
    }
    return { state: s, card: null, actions };
  }

  // 没在录：到点了就倒计时开始
  s.current = undefined; s.recStartedAt = undefined;
  if (set.start) {
    const due = lessons.find((l) => !s.skipped.includes(l.key) && now < l.end - TOO_LATE
      && (now >= l.start - set.lead * MIN || (now >= l.start - EARLY_ACTIVITY && i.lastActivity >= l.start - EARLY_ACTIVITY && now - i.lastActivity < MIN)));
    if (due) {
      if (s.armed?.key !== due.key) { s.armed = { key: due.key, at: now, mode: 'start' }; actions.push({ type: 'notice', text: `${COUNTDOWN / 1000} 秒后开始为「${due.name}」录像`, os: true }); }
      const deadline = s.armed.at + COUNTDOWN;
      if (now >= deadline) { s.armed = undefined; s.pending = { key: due.key, at: now, mode: 'start' }; actions.push({ type: 'start', lesson: due }); return { state: s, card: null, actions }; }
      return { state: s, card: { kind: 'start', lesson: due, deadline, late: now > due.start + MIN }, actions };
    }
  }
  s.armed = undefined;

  // 没排课的临时课：连续操作 1 分钟以上，提示一下（不自动开）
  if (set.adhoc) {
    const inLesson = lessons.some((l) => now >= l.start - set.lead * MIN && now < l.end);
    if (s.adhocAt && now - s.adhocAt > ADHOC_SHOW) { s.adhocAt = undefined; s.adhocDone = now; }
    if (!s.adhocAt && !inLesson && now - i.lastActivity < MIN && now - i.activeSince >= ADHOC_AFTER && !(s.adhocDone && now - s.adhocDone < ADHOC_QUIET)) s.adhocAt = now;
    if (s.adhocAt) return { state: s, card: { kind: 'adhoc' }, actions };
  } else s.adhocAt = undefined;
  return { state: s, card: null, actions };
}

/** 「这节不录」：倒计时取消，这节课不再提示 */
export function skipLesson(s: AutoRecordState, key: string): AutoRecordState { return { ...s, skipped: keep(s.skipped, key), armed: undefined }; }
/** 「再录 15 分钟」：按课表的自动下课往后推；冷场的话从现在重新计时（不动课表的下课时间） */
export function extendStop(s: AutoRecordState, now: number, card: { reason: 'schedule' | 'idle'; deadline: number }): AutoRecordState {
  return { ...s, ...(card.reason === 'schedule' ? { extendTo: Math.max(card.deadline, now) + EXTEND } : {}), idleBase: now, warned: undefined };
}
/** 没排课的提示点了「不用」或「开始」 */
export function dismissAdhoc(s: AutoRecordState, now: number): AutoRecordState { return { ...s, adhocAt: undefined, adhocDone: now }; }
