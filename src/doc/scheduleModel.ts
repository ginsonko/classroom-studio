import type { LessonSlot } from '../lib/types';

export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function localDate(value: string) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
export function monday(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
export function onDate(slot: LessonSlot, date: Date) {
  if (slot.repeat || !slot.date) return slot.day === (date.getDay() + 6) % 7 && (!slot.date || dateKey(date) >= slot.date);
  return slot.date === dateKey(date);
}
export function inWeek(slot: LessonSlot, week: Date) { return Array.from({ length: 7 }, (_, n) => { const d = new Date(week); d.setDate(d.getDate() + n); return onDate(slot, d); }).some(Boolean); }
export function nextSlot(slots: LessonSlot[], now: Date) {
  return slots.flatMap((s) => {
    const date = s.date && !s.repeat ? localDate(s.date) : new Date(now);
    if (s.repeat || !s.date) {
      date.setDate(date.getDate() + (s.day - (date.getDay() + 6) % 7 + 7) % 7);
      if (s.date && dateKey(date) < s.date) { const start = localDate(s.date); date.setFullYear(start.getFullYear(), start.getMonth(), start.getDate()); date.setDate(date.getDate() + (s.day - (date.getDay() + 6) % 7 + 7) % 7); }
    }
    date.setHours(Math.floor(s.start), Math.round((s.start % 1) * 60), 0, 0);
    let k = (date.getTime() - now.getTime()) / 3600000;
    if (k <= -s.len && (s.repeat || !s.date)) { date.setDate(date.getDate() + 7); k = (date.getTime() - now.getTime()) / 3600000; }
    return k > -s.len ? [{ s, k, date }] : [];
  }).sort((a, b) => a.k - b.k)[0];
}

export function conflicts(candidate: LessonSlot, others: LessonSlot[]) {
  return others.filter((s) => {
    if (s.id === candidate.id || s.day !== candidate.day || s.start >= candidate.start + candidate.len || candidate.start >= s.start + s.len) return false;
    if ((!s.repeat && s.date) && (!candidate.repeat && candidate.date)) return s.date === candidate.date;
    if (!candidate.repeat && candidate.date) return onDate(s, localDate(candidate.date));
    if (!s.repeat && s.date) return onDate(candidate, localDate(s.date));
    return true;
  });
}
