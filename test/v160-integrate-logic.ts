// 1.6.0 精析结果接进备课、课前提醒：间隔复习、「下节课再练」待办、最近一次课堂精析
import assert from 'node:assert/strict';
import { classBrief, lastFineNote, practiceTodos, reviewDue, reviewGap, reviewText, todoText } from '../src/lib/reviewLogic';
import { prepByRules, prepPrompt, type PrepInput } from '../src/lib/autopilotLogic';
import { pointsOf, type Mastery, type StudentNote } from '../src/lib/studyLogic';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const P = pointsOf('physics');
const NOW = Date.parse('2026-11-01T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 864e5).toISOString();
const m = (k: number, level: number, d: number): Mastery => ({ key: P[k].key, score: level / 10, n: 3, right: 1, wrong: 1, half: 1, last: daysAgo(d), level });

ok('reviewGap：四五成隔 1 天、六成 3 天、七成 7 天', () => {
  assert.deepEqual([4, 5, 6, 7].map(reviewGap), [1, 1, 3, 7]);
});

ok('reviewDue：只排四到七成、到了间隔、45 天内的；把握低的在前，同把握隔得久的在前；最多 max 个', () => {
  const ms = new Map<string, Mastery>();
  for (const x of [m(0, 3, 5), m(1, 4, 2), m(2, 6, 2), m(3, 6, 4), m(4, 7, 10), m(5, 8, 30), m(6, 5, 60), m(7, 5, 0), m(8, 4, 9)]) ms.set(x.key, x);
  const r = reviewDue(ms, NOW);
  assert.deepEqual(r.map((x) => [x.key, x.level, x.days]), [[P[8].key, 4, 9], [P[1].key, 4, 2], [P[3].key, 6, 4], [P[4].key, 7, 10]]);
  assert.equal(reviewDue(ms, NOW, 2).length, 2);
  const bad = new Map([[P[0].key, { ...m(0, 5, 3), last: 'x' }]]);
  assert.deepEqual(reviewDue(bad, NOW), [], '时间坏了的不排');
});

ok('reviewText：知识点名 + 几成把握 + 多久前练的', () => {
  const t = reviewText({ key: P[1].key, level: 4, days: 1 });
  assert.ok(t.startsWith(P[1].sec + '（'), t);
  assert.ok(t.includes('四成把握') && t.includes('昨天练的'), t);
  assert.ok(reviewText({ key: P[1].key, level: 6, days: 0 }).includes('今天练的'));
  assert.ok(reviewText({ key: P[1].key, level: 6, days: 9 }).includes('9 天前练的'));
});

const note = (o: Partial<StudentNote>): StudentNote => ({ id: Math.random().toString(36).slice(2), studentId: 's1', at: daysAgo(1), kind: 'teacher', text: '', ...o });
const notes: StudentNote[] = [
  note({ todo: 'practice', text: '下节课：再练一道追及问题（课上 32:10 说的）', at: daysAgo(2) }),
  note({ todo: 'practice', text: '下节课：先默写匀变速公式', at: daysAgo(1) }),
  note({ todo: 'practice', text: '下节课：做完的', done: daysAgo(0) }),
  note({ todo: 'reschedule', text: '家长说周三改到周四' }),
  note({ studentId: 's2', todo: 'practice', text: '下节课：别人的' }),
  note({ text: '课堂精析（10-30 追及）：速度相等时距离最小说得清楚', at: daysAgo(2) }),
  note({ text: '课堂精析（10-31 自由落体）：第 n 秒内位移还混', at: daysAgo(1) }),
  note({ studentId: 'g1', text: '课堂精析（10-31 班组课）：班组那次', at: daysAgo(0) }),
  note({ todo: 'practice', text: '课堂精析（伪装成待办的）', at: daysAgo(0) }),
  note({ kind: 'parent', text: '课堂精析（家长发的）', at: daysAgo(0) }),
];

ok('practiceTodos / todoText：只要这个学生（或一组 id）没做完的「下节课再练」，新的在前；去掉前缀和课上时间', () => {
  const t = practiceTodos(notes, 's1');
  assert.deepEqual(t.map(todoText), ['课堂精析（伪装成待办的）', '先默写匀变速公式', '再练一道追及问题']);
  assert.equal(practiceTodos(notes, ['s1', 's2']).length, 4);
  assert.equal(practiceTodos(notes, 's3').length, 0);
});

ok('lastFineNote：老师备注里、不是待办、以「课堂精析（」开头的最新一条；可以连班组一起找', () => {
  assert.ok(lastFineNote(notes, 's1')!.text.includes('自由落体'));
  assert.ok(lastFineNote(notes, ['s1', 'g1'])!.text.includes('班组那次'));
  assert.equal(lastFineNote(notes, 's9'), undefined);
});

ok('classBrief：该复习最多 3 个、待办最多 2 条，都没有就是空字符串', () => {
  const review = [4, 4, 6, 7].map((level, k) => ({ key: P[k].key, level, days: 3 }));
  const todos = practiceTodos(notes, 's1');
  const b = classBrief(review, todos);
  assert.ok(b.startsWith('该复习：') && b.includes('。上节课说要再练：'), b);
  assert.equal(b.split('、').length, 3, '复习只列 3 个');
  assert.ok(b.includes('先默写匀变速公式') && !b.includes('再练一道追及问题'), '待办只列 2 条');
  assert.equal(classBrief([], []), '');
  assert.ok(classBrief([], todos).startsWith('上节课说要再练：'));
});

const base: PrepInput = {
  student: { name: '小明', grade: '高一', textbook: '', tags: [] }, subject: 'physics', topic: '追及相遇', minutes: 60,
  points: [P[3].key], weak: [P[4].key], materials: [], files: [], questions: [], notes: [], lastLessons: [],
};
ok('prepPrompt：带上一次课堂精析、下节课要做的事、该复习的；没有就不出现', () => {
  const p = prepPrompt({ ...base, review: [{ key: P[1].key, level: 5, days: 2 }], todos: ['再练一道追及问题'], lastFine: '课堂精析（10-31）：' + '很长'.repeat(1000) });
  assert.ok(p.includes('上节课的课堂精析') && p.includes('上节课老师说下节课要做的事') && p.includes('- 再练一道追及问题') && p.includes('该复习的知识点'));
  assert.ok(p.length < 4000, '精析截到 1200 字');
  const q = prepPrompt(base);
  assert.ok(!q.includes('课堂精析') && !q.includes('下节课要做的事') && !q.includes('该复习'));
});

ok('prepByRules：待办和复习排在关注点最前，回顾环节改成先做这些；没有时和以前一样', () => {
  const r = prepByRules({ ...base, review: [{ key: P[1].key, level: 5, days: 2 }], todos: ['再练一道追及问题', '默写公式', '第三条'] });
  assert.deepEqual(r.focus.slice(0, 3).map((f) => f.split('：')[0]), ['上节课说要再练', '上节课说要再练', '复习']);
  assert.ok(r.focus[3].startsWith('薄弱点：'));
  assert.ok(r.flow[0].step.includes('上节课说要再练'));
  const old = prepByRules(base);
  assert.equal(old.flow[0].step, '回顾上节课和作业错题');
  assert.ok(old.focus[0].startsWith('薄弱点：'));
});

console.log(`v160-integrate-logic: ${n} PASS`);
