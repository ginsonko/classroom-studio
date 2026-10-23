import type { LessonSlot } from '../lib/types';

/** 课表能排课的时间范围（小时）：全天都能排，开始时间在 0–24 之间，过了午夜的课结束时间可以超过 24 */
export const DAY_START = 0, DAY_END = 24, MAX_LEN = 12;
export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function localDate(value: string) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
export function monday(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** 19.5 → 19:30；超过 24 的写成「次日 01:00」 */
export function clock(h: number) {
  const m = Math.round(h * 60), day = Math.floor(m / 1440), r = m - day * 1440;
  return (day > 0 ? '次日 ' : '') + `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}
export const spanText = (start: number, len: number) => `${clock(start)}–${clock(start + len)}`;
/** 过了午夜还在上的那一段（小时），没跨午夜是 0 */
export const tailOf = (s: Pick<LessonSlot, 'start' | 'len'>) => Math.max(0, s.start + s.len - 24);

/** 这节课是不是在这一天开始 */
export function onDate(slot: LessonSlot, date: Date) {
  if (slot.repeat || !slot.date) return slot.day === (date.getDay() + 6) % 7 && (!slot.date || dateKey(date) >= slot.date);
  return slot.date === dateKey(date);
}
/** 前一天开始、过了午夜延续到这一天的课 */
export const spillsInto = (slot: LessonSlot, date: Date) => tailOf(slot) > 0 && onDate(slot, shift(date, -1));
export function inWeek(slot: LessonSlot, week: Date) { return Array.from({ length: 7 }, (_, n) => onDate(slot, shift(week, n))).some(Boolean); }

export function nextSlot(slots: LessonSlot[], now: Date) {
  return slots.flatMap((s) => {
    const date = s.date && !s.repeat ? localDate(s.date) : new Date(now);
    if (s.repeat || !s.date) {
      date.setDate(date.getDate() + (s.day - (date.getDay() + 6) % 7 + 7) % 7);
      if (s.date && dateKey(date) < s.date) { const start = localDate(s.date); date.setFullYear(start.getFullYear(), start.getMonth(), start.getDate()); date.setDate(date.getDate() + (s.day - (date.getDay() + 6) % 7 + 7) % 7); }
    }
    date.setHours(Math.floor(s.start), Math.round((s.start % 1) * 60), 0, 0);
    let k = (date.getTime() - now.getTime()) / 3600000;
    if (s.repeat || !s.date) {
      // 上周这一天开始、跨过午夜现在还没下课的那一次
      const prev = new Date(date); prev.setDate(prev.getDate() - 7);
      const pk = (prev.getTime() - now.getTime()) / 3600000;
      if (pk > -s.len && (!s.date || dateKey(prev) >= s.date)) { date.setTime(prev.getTime()); k = pk; }
      else if (k <= -s.len) { date.setDate(date.getDate() + 7); k = (date.getTime() - now.getTime()) / 3600000; }
    }
    return k > -s.len ? [{ s, k, date }] : [];
  }).sort((a, b) => a.k - b.k)[0];
}

/**
 * 和 candidate 时间重叠的课。跨午夜的课会和第二天凌晨的课撞，所以除了同一天，还要比相邻的两天（周日的尾巴落在周一）。
 */
export function conflicts(candidate: LessonSlot, others: LessonSlot[]) {
  return others.filter((s) => {
    if (s.id === candidate.id) return false;
    for (const k of [-1, 0, 1]) {
      // s 在 candidate 开始那天之后第 k 天开始
      if (s.day !== (candidate.day + k + 7) % 7) continue;
      const a = s.start + 24 * k;
      if (a >= candidate.start + candidate.len || candidate.start >= a + s.len) continue;
      const cDate = !candidate.repeat && candidate.date ? candidate.date : '', sDate = !s.repeat && s.date ? s.date : '';
      if (cDate && sDate) { if (sDate === dateKey(shift(localDate(cDate), k))) return true; continue; }
      if (cDate) { if (onDate(s, shift(localDate(cDate), k))) return true; continue; }
      if (sDate) { if (onDate(candidate, shift(localDate(sDate), -k))) return true; continue; }
      return true;
    }
    return false;
  });
}
