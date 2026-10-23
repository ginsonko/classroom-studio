// 1.4.0 AI 助教纯逻辑：找学生、读时间、排课参数、撞课、展开课表、整轮撤销、提醒触发。
// 用法：npx tsx test/v140-assistant-logic.ts
import assert from 'node:assert/strict';
import type { LessonSlot, Student } from '../src/lib/types';
import { changeSummary, checkClash, hours, lessonFrom, lessonText, occurrences, pickStudent, putIn, signature, squash, undoChanges, type Box, type Change, type Kind } from '../src/assistant/toolsLogic';
import { afterFire, cleanTrigger, dueEvent, dueTimed, timesText, whenText, type Trigger } from '../src/assistant/triggersLogic';
import { baseInstructions, developerInstructions, hello, PERSONAS } from '../src/assistant/prompt';

let n = 0;
const T = (name: string, fn: () => void) => { fn(); n++; console.log('PASS ' + name); };
const stu = (id: string, name: string, more: Partial<Student> = {}) => ({ id, name, grade: '初二', hue: 200, lessons: 0, ...more }) as Student;
const students = [stu('a', '李俊宇'), stu('b', '王小明'), stu('c', '王小红'), stu('d', '张三', { archived: true })];

T('pickStudent: id, exact, partial, ambiguous, archived, missing', () => {
  assert.equal(pickStudent(students, 'b').name, '王小明');
  assert.equal(pickStudent(students, '俊宇').id, 'a');
  assert.equal(pickStudent(students, '王小明').id, 'b');
  assert.throws(() => pickStudent(students, '王'), /多位学生[\s\S]*id=b[\s\S]*id=c/);
  assert.throws(() => pickStudent(students, '张三'), /已经归档/);
  assert.throws(() => pickStudent(students, '赵六'), /没有叫「赵六」[\s\S]*李俊宇/);
  assert.throws(() => pickStudent(students, ''), /哪位学生/);
});

T('hours: HH:MM, full-width colon, decimals', () => {
  assert.equal(hours('19:30'), 19.5);
  assert.equal(hours('7：15'), 7.25);
  assert.equal(hours('19.5'), 19.5);
  assert.equal(hours(8), 8);
  assert.ok(Number.isNaN(hours('晚上七点')));
});

T('lessonFrom: new lesson, end across midnight, edit keeps fields, validation', () => {
  const s = lessonFrom({ student: '俊宇', date: '2026-10-28', start: '19:00', minutes: 90, topic: '浮力', repeat_weekly: true }, students, undefined, () => 'x1');
  assert.deepEqual(s, { id: 'x1', studentId: 'a', date: '2026-10-28', day: 2, start: 19, len: 1.5, topic: '浮力', repeat: true });
  const late = lessonFrom({ student: 'a', date: '2026-10-28', start: '23:00', end: '00:30' }, students, undefined, () => 'x2');
  assert.equal(late.len, 1.5, 'end after midnight');
  const moved = lessonFrom({ start: '20:00' }, students, s);
  assert.deepEqual([moved.id, moved.studentId, moved.date, moved.len, moved.topic, moved.repeat, moved.start], ['x1', 'a', '2026-10-28', 1.5, '浮力', true, 20]);
  assert.equal(lessonFrom({ student: 'a', date: '2026-10-28', start: 8 }, students, undefined, () => 'x').topic, '一对一课程');
  assert.throws(() => lessonFrom({ student: 'a', date: '2026/10/28', start: '19:00' }, students), /YYYY-MM-DD/);
  assert.throws(() => lessonFrom({ student: 'a', date: '2026-02-30', start: '19:00' }, students), /YYYY-MM-DD/);
  assert.throws(() => lessonFrom({ student: 'a', date: '2026-10-28', start: '25:00' }, students), /HH:MM/);
  assert.throws(() => lessonFrom({ student: 'a', date: '2026-10-28', start: '19:00', minutes: 10 }, students), /30 分钟/);
  assert.throws(() => lessonFrom({ date: '2026-10-28', start: '19:00' }, students), /哪位学生/);
});

T('lessonText / checkClash', () => {
  const a: LessonSlot = { id: 's1', studentId: 'a', date: '2026-10-28', day: 2, start: 19, len: 1.5, topic: '浮力', repeat: true };
  assert.match(lessonText(a, students), /^李俊宇 每周三（从 2026-10-28 起） 19:00/);
  assert.match(lessonText({ ...a, date: undefined }, students), /^李俊宇 每周三 19:00/);
  assert.doesNotMatch(lessonText({ ...a, date: undefined, repeat: false }, students), /undefined/);
  const b: LessonSlot = { id: 's2', studentId: 'b', date: '2026-11-04', day: 2, start: 20, len: 1, topic: '', repeat: false };
  assert.throws(() => checkClash(b, [a], students), /时间重叠（id=s1）/);
  assert.doesNotThrow(() => checkClash({ ...b, start: 20.5 }, [a], students));
  assert.doesNotThrow(() => checkClash({ ...b, date: '2026-10-21', day: 2 }, [a], students), 'before the weekly lesson starts');
});

T('occurrences: weekly lessons expand, archived students hidden, sorted', () => {
  const slots: LessonSlot[] = [
    { id: 'w', studentId: 'a', date: '2026-10-21', day: 2, start: 19, len: 1, topic: '', repeat: true },
    { id: 'o', studentId: 'b', date: '2026-10-26', day: 0, start: 8, len: 2, topic: '函数', repeat: false },
    { id: 'z', studentId: 'd', date: '2026-10-26', day: 0, start: 9, len: 1, topic: '', repeat: false },
  ];
  const list = occurrences(slots, students, new Date(2026, 9, 26), 14);
  assert.deepEqual(list.map((o) => o.id + '@' + o.date), ['o@2026-10-26', 'w@2026-10-28', 'w@2026-11-04']);
  assert.equal(list[0].minutes, 120);
  assert.deepEqual(occurrences(slots, students, new Date(2026, 9, 26), 14, 'b').map((o) => o.id), ['o']);
});

T('undo: squash, restore, keep the teacher’s later edits, deletions and creations', () => {
  const store = new Map<string, unknown>([['student:a', { id: 'a', name: '李俊宇2' }], ['slot:s9', { id: 's9', start: 9 }]]);
  const box: Box = { get: (k: Kind, id: string) => store.get(k + ':' + id) ?? null, put: (k: Kind, id: string, v: unknown) => { if (v === null) store.delete(k + ':' + id); else store.set(k + ':' + id, v); } };
  const changes: Change[] = [
    { kind: 'student', id: 'a', before: { id: 'a', name: '李俊宇' }, after: { id: 'a', name: '李俊宇1' } },
    { kind: 'student', id: 'a', before: { id: 'a', name: '李俊宇1' }, after: { id: 'a', name: '李俊宇2' } },
    { kind: 'slot', id: 's9', before: null, after: { id: 's9', start: 8 } },
    { kind: 'slot', id: 's1', before: { id: 's1', start: 19 }, after: null },
    { kind: 'trigger', id: 't', before: null, after: null },
  ];
  assert.equal(squash(changes).length, 3, 'two edits of one record merge; no-op dropped');
  assert.equal(changeSummary(changes), '1 位学生、2 节课');
  const r = undoChanges(changes, box);
  assert.equal(r.restored, 2);
  assert.deepEqual(r.skipped.map((c) => c.id), ['s9'], 'teacher moved s9 to 9:00 afterwards: keep it');
  assert.deepEqual(store.get('student:a'), { id: 'a', name: '李俊宇' });
  assert.deepEqual(store.get('slot:s1'), { id: 's1', start: 19 }, 'deleted lesson comes back');
  assert.deepEqual(store.get('slot:s9'), { id: 's9', start: 9 });
  assert.deepEqual(putIn([{ id: 'x' }, { id: 'y' }], 'x', null), [{ id: 'y' }]);
  assert.deepEqual(putIn([{ id: 'x', v: 1 }], 'x', { id: 'x', v: 2 }), [{ id: 'x', v: 2 }]);
  assert.deepEqual(putIn<{ id: string }>([], 'x', { id: 'x' }), [{ id: 'x' }]);
});

T('signature changes with the tool list', () => {
  const a = signature([{ name: 'x' }]), b = signature([{ name: 'x' }]), c = signature([{ name: 'y' }]);
  assert.equal(a, b); assert.notEqual(a, c); assert.match(a, /-1$/);
});

const NOW = new Date(2026, 9, 28, 18, 52); // 周三 18:52
const mk = (raw: Record<string, unknown>, id = 't') => cleanTrigger(raw, { id, now: NOW });

T('cleanTrigger: validation, defaults, auto name, keep base fields', () => {
  const t = mk({ when: { type: 'before_lesson', minutes: 10 }, action: { type: 'remind', text: '看错题' } });
  assert.deepEqual([t.times, t.enabled, t.fired, t.by], ['every', true, 0, 'teacher']);
  assert.equal(t.name, '每节课前 10 分钟：看错题');
  assert.equal(mk({ when: { type: 'at', datetime: '2026-10-29 08:00' }, action: { type: 'remind', text: 'x' } }).times, 'once', 'one moment = once');
  assert.equal(mk({ when: { type: 'daily', time: '7：05', weekdays: [5, 5, 9, 1] }, action: { type: 'remind', text: 'x' } }).when.type, 'daily');
  const d = mk({ when: { type: 'daily', time: '7：05', weekdays: [5, 5, 9, 1] }, action: { type: 'remind', text: 'x' } }).when;
  assert.deepEqual(d, { type: 'daily', time: '07:05', weekdays: [1, 5] });
  assert.equal(mk({ when: { type: 'app_start' }, action: { type: 'assistant', prompt: 'y' }, times: 3 }).times, 3);
  assert.equal(mk({ when: { type: 'app_start' }, action: { type: 'assistant', prompt: 'y' }, times: 1 }).times, 'once');
  for (const [raw, re] of [
    [{ when: { type: 'daily', time: '25:00' }, action: { type: 'remind', text: 'x' } }, /HH:MM/],
    [{ when: { type: 'at', datetime: '明天' }, action: { type: 'remind', text: 'x' } }, /YYYY-MM-DDTHH:MM/],
    [{ when: { type: 'open_page', page: 'nope' }, action: { type: 'remind', text: 'x' } }, /page 只能是/],
    [{ when: { type: 'weekly' }, action: { type: 'remind', text: 'x' } }, /when.type 只能是/],
    [{ when: { type: 'app_start' }, action: { type: 'remind', text: ' ' } }, /action.text/],
    [{ when: { type: 'app_start' }, action: { type: 'run' } }, /action.type/],
  ] as const) assert.throws(() => mk(raw as Record<string, unknown>), re);
  const base = { ...t, fired: 2, keys: ['k'], by: 'ai' as const };
  const ed = cleanTrigger({ when: { type: 'after_lesson', minutes: 0 } }, { base });
  assert.deepEqual([ed.id, ed.fired, ed.keys, ed.by, ed.action], ['t', 2, ['k'], 'ai', t.action]);
  assert.equal(whenText(ed.when), '每节课下课时');
  assert.equal(timesText(ed), '每次（已触发 2 次）');
});

const slots: LessonSlot[] = [
  { id: 'w', studentId: 'a', date: '2026-10-21', day: 2, start: 19, len: 1.5, topic: '浮力', repeat: true },
  { id: 'o', studentId: 'b', date: '2026-10-28', day: 2, start: 21, len: 1, topic: '', repeat: false },
];

T('dueTimed: before lesson fires inside the window, once per lesson', () => {
  const t = mk({ when: { type: 'before_lesson', minutes: 10 }, action: { type: 'remind', text: '看错题' } });
  assert.deepEqual(dueTimed([t], new Date(2026, 9, 28, 18, 49), slots, students), [], 'too early');
  const f = dueTimed([t], NOW, slots, students);
  assert.equal(f.length, 1); assert.equal(f[0].key, 'w@2026-10-28'); assert.equal(f[0].studentId, 'a'); assert.match(f[0].note, /李俊宇 19:00 的课（浮力）/);
  const after = afterFire(t, f[0].key, NOW);
  assert.deepEqual(dueTimed([after], new Date(2026, 9, 28, 18, 55), slots, students), [], 'not twice for the same lesson');
  assert.deepEqual(dueTimed([t], new Date(2026, 9, 28, 19, 1), slots, students), [], 'window passed');
  const onlyB = mk({ when: { type: 'before_lesson', minutes: 10, student: 'b' }, action: { type: 'remind', text: 'x' } });
  assert.deepEqual(dueTimed([onlyB], NOW, slots, students), []);
  assert.equal(dueTimed([onlyB], new Date(2026, 9, 28, 20, 51), slots, students).length, 1);
});

T('dueTimed: after lesson, daily (late catch-up), at, disabled', () => {
  const end = mk({ when: { type: 'after_lesson', minutes: 0 }, action: { type: 'assistant', prompt: '写课后总结' } });
  assert.equal(dueTimed([end], new Date(2026, 9, 28, 20, 31), slots, students)[0].note, '李俊宇 的课（19:00–20:30）已下课');
  assert.equal(dueTimed([end], new Date(2026, 9, 28, 22, 5), slots, students)[0].key, 'o@2026-10-28', 'the 21:00 lesson ended at 22:00');
  const daily = mk({ when: { type: 'daily', time: '18:00', weekdays: [3] }, action: { type: 'remind', text: 'x' } });
  const f = dueTimed([daily], NOW, slots, students);
  assert.equal(f[0].key, '2026-10-28'); assert.match(f[0].note, /晚了 52 分钟/);
  assert.deepEqual(dueTimed([daily], new Date(2026, 9, 29, 18, 1), slots, students), [], 'Thursday not selected');
  assert.deepEqual(dueTimed([daily], new Date(2026, 9, 28, 20, 1), slots, students), [], 'more than 2 hours late');
  const once = mk({ when: { type: 'at', datetime: '2026-10-28T18:50' }, action: { type: 'remind', text: 'x' } });
  assert.equal(dueTimed([once], NOW, slots, students).length, 1);
  const used = afterFire(once, '2026-10-28T18:50', NOW);
  assert.equal(used.enabled, false, 'once: disabled after firing');
  assert.deepEqual(dueTimed([used], NOW, slots, students), []);
});

T('afterFire: N times limit; dueEvent pages, students, import batches', () => {
  let t = mk({ when: { type: 'open_page', page: 'study' }, action: { type: 'remind', text: 'x' }, times: 2 });
  assert.deepEqual(dueEvent([t], { type: 'open_page', page: 'schedule' }, NOW), []);
  const f = dueEvent([t], { type: 'open_page', page: 'study' }, NOW);
  assert.equal(f.length, 1);
  t = afterFire(t, f[0].key, NOW); assert.equal(t.enabled, true);
  t = afterFire(t, 'k2', NOW); assert.equal(t.enabled, false, 'stops after 2');
  const v = mk({ when: { type: 'view_student', student: 'a' }, action: { type: 'remind', text: 'x' } });
  assert.deepEqual(dueEvent([v], { type: 'view_student', studentId: 'b' }, NOW), []);
  assert.equal(dueEvent([v], { type: 'view_student', studentId: 'a' }, NOW)[0].studentId, 'a');
  const imp = mk({ when: { type: 'import_questions' }, action: { type: 'assistant', prompt: '整理' } });
  const g = dueEvent([imp], { type: 'import_questions', count: 12, batch: 'b1' }, NOW);
  assert.equal(g[0].note, '刚导入了 12 道题');
  assert.deepEqual(dueEvent([afterFire(imp, g[0].key, NOW)], { type: 'import_questions', count: 3, batch: 'b1' }, NOW), [], 'same batch only once');
});

T('prompt: three personas, name and memory go in', () => {
  assert.deepEqual(PERSONAS.map((p) => p.id), ['sister', 'assistant', 'expert']);
  assert.match(baseInstructions('小羽'), /小羽/);
  const d = developerInstructions({ name: '小羽', persona: 'expert', custom: '称呼我王老师', memory: [{ text: '俊宇家长只看企业微信' }], subjectHint: '初中数学' });
  assert.match(d, /称呼我王老师/); assert.match(d, /俊宇家长只看企业微信/); assert.match(d, /初中数学/);
  assert.match(hello('sister', '小羽'), /小羽/);
});

console.log(`RESULT ${n}/${n} pass`);
