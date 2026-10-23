// AI 助教的提醒和定时任务：什么时候触发、触发几次、做什么。纯逻辑，Node 里可以直接测试。
// 老师可以自己建，也可以让助教建（「每次上课前 10 分钟提醒我看错题」「每周五晚上给家长写周报」）。
import type { LessonSlot, Student } from '../lib/types';
import type { Page } from '../lib/store';
import { dateKey, localDate } from '../doc/scheduleModel';
import { occurrences } from './toolsLogic';
import { groupsOf } from '../lib/groups';

export type When =
  | { type: 'before_lesson'; minutes: number; student?: string }
  | { type: 'after_lesson'; minutes: number; student?: string }
  | { type: 'daily'; time: string; weekdays?: number[] }
  | { type: 'at'; datetime: string }
  | { type: 'app_start' }
  | { type: 'open_page'; page: Page }
  | { type: 'view_student'; student?: string }
  | { type: 'import_questions' };
export type Action = { type: 'remind'; text: string } | { type: 'assistant'; prompt: string };
export interface Trigger {
  id: string; name: string; when: When; action: Action;
  /** once 只一次；every 每次；数字 = 一共触发几次 */
  times: 'once' | 'every' | number;
  fired: number; enabled: boolean; created: string; by: 'teacher' | 'ai';
  lastAt?: string; keys?: string[];
}
export interface Fire { t: Trigger; key: string; note: string; studentId?: string }

export const PAGES: Record<Page, string> = { console: '上课', schedule: '课表', students: '学生', study: '学情', agents: '备课', auto: '自动', replay: '回放', plugins: '插件' };
const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

/** 老师 / AI 给的触发器 → 校验过的；不合法抛错（错误写清楚怎么改） */
export function cleanTrigger(raw: Record<string, unknown>, o: { id?: string; by?: 'teacher' | 'ai'; now?: Date; base?: Trigger } = {}): Trigger {
  const base = o.base, w = (raw.when ?? base?.when ?? {}) as Record<string, unknown>;
  let when: When;
  switch (w.type) {
    case 'before_lesson': case 'after_lesson': when = { type: w.type, minutes: num(w.minutes, 0, 24 * 60, w.type === 'before_lesson' ? 10 : 0), ...(w.student ? { student: String(w.student) } : {}) }; break;
    case 'daily': {
      const t = String(w.time ?? '').trim();
      if (!/^([01]?\d|2[0-3])[:：][0-5]\d$/.test(t)) throw Error('每天 / 每周的提醒要给时间 time，写成 HH:MM');
      const wd = Array.isArray(w.weekdays) ? [...new Set(w.weekdays.map(Number).filter((x) => x >= 1 && x <= 7))].sort() : [];
      when = { type: 'daily', time: t.replace('：', ':').padStart(5, '0'), ...(wd.length && wd.length < 7 ? { weekdays: wd } : {}) };
      break;
    }
    case 'at': {
      const s = String(w.datetime ?? '').trim().replace(' ', 'T');
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s);
      if (!m || !Number.isFinite(localDate(m[1]).getTime())) throw Error('某个时刻提醒要给 datetime，写成 YYYY-MM-DDTHH:MM');
      when = { type: 'at', datetime: s };
      break;
    }
    case 'app_start': case 'import_questions': when = { type: w.type }; break;
    case 'open_page': if (!(String(w.page) in PAGES)) throw Error('page 只能是：' + Object.keys(PAGES).join(' / ')); when = { type: 'open_page', page: w.page as Page }; break;
    case 'view_student': when = { type: 'view_student', ...(w.student ? { student: String(w.student) } : {}) }; break;
    default: throw Error('when.type 只能是 before_lesson / after_lesson / daily / at / app_start / open_page / view_student / import_questions');
  }
  const a = (raw.action ?? base?.action ?? {}) as Record<string, unknown>;
  let action: Action;
  if (a.type === 'remind') { const text = String(a.text ?? '').trim().slice(0, 300); if (!text) throw Error('提醒要写提醒的话 action.text'); action = { type: 'remind', text }; }
  else if (a.type === 'assistant') { const prompt = String(a.prompt ?? '').trim().slice(0, 2000); if (!prompt) throw Error('交给助教做的事要写 action.prompt'); action = { type: 'assistant', prompt }; }
  else throw Error('action.type 只能是 remind（弹提醒）或 assistant（交给助教去做）');
  const tv = raw.times ?? base?.times ?? (when.type === 'at' ? 'once' : 'every');
  const times: Trigger['times'] = tv === 'once' || tv === 1 || tv === '1' ? 'once' : tv === 'every' || tv === 0 || tv === '0' || tv === undefined ? 'every' : num(tv, 2, 999, 2);
  const name = String(raw.name ?? base?.name ?? '').trim().slice(0, 40) || autoName(when, action);
  return {
    id: base?.id ?? o.id ?? 'tr-' + Math.random().toString(36).slice(2, 10), name, when, action, times,
    fired: base?.fired ?? 0, enabled: raw.enabled === undefined ? base?.enabled ?? true : raw.enabled !== false && raw.enabled !== 'false',
    created: base?.created ?? (o.now ?? new Date()).toISOString(), by: base?.by ?? o.by ?? 'teacher', ...(base?.lastAt ? { lastAt: base.lastAt } : {}), ...(base?.keys ? { keys: base.keys } : {}),
  };
}

function autoName(w: When, a: Action) { return (whenText(w) + '：' + (a.type === 'remind' ? a.text : a.prompt)).slice(0, 40); }

export function whenText(w: When, students: Student[] = []): string {
  const who = (s?: string) => (s ? (students.find((x) => x.id === s)?.name ?? s) + '的' : '');
  switch (w.type) {
    case 'before_lesson': return `${who(w.student)}每节课前 ${w.minutes} 分钟`;
    case 'after_lesson': return w.minutes ? `${who(w.student)}每节课下课后 ${w.minutes} 分钟` : `${who(w.student)}每节课下课时`;
    case 'daily': return (w.weekdays?.length ? '每周' + w.weekdays.map((d) => WD[d - 1].slice(1)).join('、') : '每天') + ' ' + w.time;
    case 'at': return w.datetime.replace('T', ' ');
    case 'app_start': return '每次打开软件时';
    case 'open_page': return `打开「${PAGES[w.page]}」页时`;
    case 'view_student': return w.student ? `查看${who(w.student).slice(0, -1)}时` : '切换学生时';
    case 'import_questions': return '导入题目时';
  }
}
export const timesText = (t: Trigger) => (t.times === 'once' ? '只一次' : t.times === 'every' ? '每次' : `共 ${t.times} 次`) + (t.fired ? `（已触发 ${t.fired} 次）` : '');
export const limitOf = (t: Trigger) => (t.times === 'once' ? 1 : t.times === 'every' ? Infinity : t.times);

/** 触发过一次之后：计数 +1，记住这次的 key（同一节课不重复触发），次数用完就停用 */
export function afterFire(t: Trigger, key: string, now: Date): Trigger {
  const fired = t.fired + 1;
  return { ...t, fired, lastAt: now.toISOString(), keys: [...(t.keys ?? []).filter((k) => k !== key), key].slice(-200), enabled: t.enabled && fired < limitOf(t) };
}

const BEFORE_WINDOW = 10, AFTER_WINDOW = 30, DAILY_LATE = 120, AT_LATE = 24 * 60;
const at = (date: string, h: number) => { const d = localDate(date); d.setMinutes(Math.round(h * 60)); return d; };

/** 现在该触发的定时类触发器（课前 / 下课 / 每天 / 某个时刻）。软件没开着错过的：每天的晚 2 小时内补，某时刻的晚 1 天内补 */
export function dueTimed(list: Trigger[], now: Date, slots: LessonSlot[], students: Student[]): Fire[] {
  const out: Fire[] = [];
  const lessons = occurrences(slots, students, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), 3);
  for (const t of list) {
    if (!t.enabled) continue;
    const w = t.when, done = new Set(t.keys ?? []);
    if (w.type === 'before_lesson' || w.type === 'after_lesson') {
      // 指定了学生的：他所在班组的课也算
      const mine = w.student ? new Set([w.student, ...groupsOf(w.student, students).map((g) => g.id)]) : null;
      for (const l of lessons) {
        if (mine && !mine.has(l.studentId)) continue;
        const slot = slots.find((s) => s.id === l.id); if (!slot) continue;
        const start = at(l.date, slot.start), fireAt = w.type === 'before_lesson' ? new Date(start.getTime() - w.minutes * 60000) : new Date(start.getTime() + (slot.len * 60 + w.minutes) * 60000);
        const late = (now.getTime() - fireAt.getTime()) / 60000, key = `${l.id}@${l.date}`;
        if (late < 0 || late >= (w.type === 'before_lesson' ? Math.min(BEFORE_WINDOW, w.minutes || BEFORE_WINDOW) : AFTER_WINDOW) || done.has(key)) continue;
        out.push({ t, key, studentId: l.studentId, note: w.type === 'before_lesson' ? `${l.student} ${l.time.split('–')[0]} 的课${l.topic ? '（' + l.topic + '）' : ''}` : `${l.student} 的课（${l.time}）已下课` });
        if (limitOf(t) - t.fired <= out.filter((x) => x.t === t).length) break;
      }
    } else if (w.type === 'daily') {
      const today = dateKey(now), wd = (now.getDay() + 6) % 7 + 1;
      if (w.weekdays?.length && !w.weekdays.includes(wd)) continue;
      const [h, m] = w.time.split(':').map(Number), late = (now.getTime() - at(today, h + m / 60).getTime()) / 60000;
      if (late >= 0 && late < DAILY_LATE && !done.has(today)) out.push({ t, key: today, note: late > 5 ? `（本该 ${w.time}，晚了 ${Math.round(late)} 分钟）` : '' });
    } else if (w.type === 'at') {
      const [d, time] = w.datetime.split('T'), [h, m] = time.split(':').map(Number), late = (now.getTime() - at(d, h + m / 60).getTime()) / 60000;
      if (late >= 0 && late < AT_LATE && !done.has(w.datetime)) out.push({ t, key: w.datetime, note: late > 5 ? `（本该 ${w.datetime.replace('T', ' ')}，晚了 ${Math.round(late)} 分钟）` : '' });
    }
  }
  return out;
}

export type AppEvent = { type: 'app_start' } | { type: 'open_page'; page: Page } | { type: 'view_student'; studentId: string } | { type: 'import_questions'; count: number; batch: string };
/** 软件里发生的事 → 该触发的触发器 */
export function dueEvent(list: Trigger[], e: AppEvent, now: Date): Fire[] {
  const out: Fire[] = [];
  for (const t of list) {
    if (!t.enabled || t.when.type !== e.type) continue;
    const w = t.when;
    if (w.type === 'open_page' && e.type === 'open_page' && w.page !== e.page) continue;
    if (w.type === 'view_student' && e.type === 'view_student' && w.student && w.student !== e.studentId) continue;
    const key = e.type === 'import_questions' ? 'batch:' + e.batch : e.type + '@' + now.toISOString();
    if (t.keys?.includes(key)) continue;
    out.push({ t, key, ...(e.type === 'view_student' ? { studentId: e.studentId } : {}), note: e.type === 'import_questions' ? `刚导入了 ${e.count} 道题` : '' });
  }
  return out;
}

/** 给 AI 看的触发器（紧凑） */
export function triggerJson(t: Trigger, students: Student[]) {
  return { id: t.id, name: t.name, when: t.when, when_text: whenText(t.when, students), action: t.action, times: t.times, fired: t.fired, enabled: t.enabled, last: t.lastAt ?? '', by: t.by };
}
export { hm };
