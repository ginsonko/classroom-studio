// 间隔复习：只有四到七成把握的知识点要排复习（太低的是薄弱点，另算；八成以上算掌握）。
// 把握越低隔得越短：四五成隔 1 天、六成隔 3 天、七成隔 7 天；再练过一次就按新的把握重新排。
import { levelText, pointLabel, type Mastery, type StudentNote } from './studyLogic';

export interface ReviewItem { key: string; level: number; days: number }
export const reviewGap = (level: number) => (level <= 5 ? 1 : level === 6 ? 3 : 7);
/** 上次练过太久（超过 45 天）的不排：多半已经换了内容，交给老师自己判断 */
const STALE = 45;

export function reviewDue(ms: Map<string, Mastery>, now = Date.now(), max = 5): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const m of ms.values()) {
    if (m.level < 4 || m.level > 7) continue;
    const days = Math.floor((now - Date.parse(m.last)) / 864e5);
    if (!Number.isFinite(days) || days < reviewGap(m.level) || days > STALE) continue;
    out.push({ key: m.key, level: m.level, days });
  }
  return out.sort((a, b) => a.level - b.level || b.days - a.days).slice(0, max);
}

const ago = (d: number) => (d <= 0 ? '今天' : d === 1 ? '昨天' : `${d} 天前`);
export const reviewText = (r: ReviewItem) => `${pointLabel(r.key).split(' · ').pop()}（${levelText(r.level)}，${ago(r.days)}练的）`;

/** 「下节课再练」：课后精析从老师课上的话里记下的待办 */
export const practiceTodos = (notes: StudentNote[], ids: string | string[]) => { const set = new Set(Array.isArray(ids) ? ids : [ids]); return notes.filter((n) => set.has(n.studentId) && n.todo === 'practice' && !n.done).sort((a, b) => b.at.localeCompare(a.at)); };
export const todoText = (n: StudentNote) => n.text.replace(/^下节课：/, '').replace(/（课上 [\d:]+ 说的）$/, '');

/** 课前横幅上的一句话：该复习的、上节课说要再练的 */
export function classBrief(review: ReviewItem[], todos: StudentNote[]): string {
  return [
    review.length ? '该复习：' + review.slice(0, 3).map(reviewText).join('、') : '',
    todos.length ? '上节课说要再练：' + todos.slice(0, 2).map(todoText).join('；') : '',
  ].filter(Boolean).join('。');
}

/** 最近一次课堂精析（档案里的那条）：备课时给 AI 看 */
export const lastFineNote = (notes: StudentNote[], ids: string | string[]) =>
  notes.filter((n) => (Array.isArray(ids) ? ids : [ids]).includes(n.studentId) && n.kind === 'teacher' && !n.todo && /^课堂精析（/.test(n.text)).sort((a, b) => b.at.localeCompare(a.at))[0];
