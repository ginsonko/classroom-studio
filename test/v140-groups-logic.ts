// 1.4.0 班组（一对二 / 小组课 / 班课）纯逻辑：成员、学情汇总、课后总结展开、课表导入、助教工具找人、提醒。
// 用法：npx tsx test/v140-groups-logic.ts
import assert from 'node:assert/strict';
import type { LessonSlot, Student } from '../src/lib/types';
import { defaultTopic, findGroupFor, groupsOf, isDefaultTopic, kindFor, makeGroup, memberText, membersOf, peopleOf, splitNames, whoText } from '../src/lib/groups';
import { emptyStudy, indexGroups, mastery, profile, wrongBook, type Attempt, type LessonNote, type Question, type StudyData } from '../src/lib/studyLogic';
import { dueLessons } from '../src/lib/autopilotLogic';
import { createdText, lessonsByRules, matchStudent, nameIn, NEW, planImport, rowsOf, schedulePrompt, type ImportLesson } from '../src/doc/scheduleImport';
import { lessonFrom, lessonText, occurrences, pickPeople, pickStudent } from '../src/assistant/toolsLogic';
import { cleanTrigger, dueTimed } from '../src/assistant/triggersLogic';

let n = 0;
const T = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const stu = (id: string, name: string, more: Partial<Student> = {}) => ({ id, name, grade: '初二', subject: 'physics-junior', textbook: '', tags: [], hue: 200, lessons: 0, lastTopic: '', lastAt: '', ...more }) as Student;
const people = [stu('a', '张俊宇'), stu('b', '李欣怡'), stu('c', '王小明'), stu('d', '赵六')];
const pair = stu('g1', '俊宇欣怡一对二', { kind: 'pair', members: ['a', 'b'] });
const klass = stu('g2', '初二(3)班', { kind: 'class', members: ['a', 'b', 'c', 'gone'] });
const all = [...people, pair, klass];

T('groups：成员、所在班组、实际落到的人、名单、默认课名', () => {
  assert.deepEqual(membersOf(klass, all).map((s) => s.id), ['a', 'b', 'c'], '删掉的成员跳过');
  assert.deepEqual(groupsOf('a', all).map((g) => g.id), ['g1', 'g2']);
  assert.deepEqual(peopleOf('g1', all).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(peopleOf('c', all).map((s) => s.id), ['c']);
  assert.deepEqual(peopleOf('nobody', all), []);
  assert.equal(whoText(klass, all), '初二(3)班（班课 · 3 人）');
  assert.equal(memberText(klass, all, 2), '张俊宇、李欣怡 等 3 人');
  assert.deepEqual([kindFor(2), kindFor(5), kindFor(30)], ['pair', 'small', 'class']);
  assert.deepEqual([defaultTopic(people[0]), defaultTopic(pair), defaultTopic(klass)], ['一对一课程', '一对二课程', '班课']);
  assert.ok(isDefaultTopic('小组课') && isDefaultTopic('') && !isDefaultTopic('电磁感应'));
});

T('groups：找正好这几个人的班组、新建班组、拆名字', () => {
  assert.equal(findGroupFor(['b', 'a'], all)?.id, 'g1', '顺序无关');
  assert.equal(findGroupFor(['a', 'c'], all), undefined);
  const g = makeGroup({ members: ['c', 'd', 'g1'] }, all);
  assert.equal(g.kind, 'pair', '班组不能当成员');
  assert.deepEqual(g.members, ['c', 'd']);
  assert.equal(g.name, '王小明、赵六一对二');
  assert.equal(g.subject, 'physics-junior');
  assert.equal(makeGroup({ members: ['a', 'b', 'c'] }, all).kind, 'small');
  assert.deepEqual(splitNames('俊宇、欣怡/小明+赵六'), ['俊宇', '欣怡', '小明', '赵六']);
  assert.deepEqual(splitNames('王和平'), ['王和平'], '名字里的「和」不拆');
  assert.deepEqual(splitNames('俊宇 和 欣怡'), ['俊宇', '欣怡']);
});

const day = (d: number, h = 10) => new Date(2026, 9, d, h).toISOString();
let seq = 0;
const Q = (points: string[]): Question => ({ id: 'q' + ++seq, stem: '题' + seq, points, difficulty: 3, qtype: '计算', origin: 'manual', status: 'bank', createdAt: day(1), subject: 'physics' } as Question);
const A = (questionId: string, result: Attempt['result'], d: number, studentId: string): Attempt => ({ id: 'a' + ++seq, studentId, questionId, result, at: day(d) });

T('学情：班组汇总成员的作答；所有成员最近一次都对了才算订正', () => {
  indexGroups(all);
  const q1 = Q(['3.1']), q2 = Q(['3.3']);
  const d: StudyData = { ...emptyStudy(), questions: [q1, q2], attempts: [A(q1.id, 'wrong', 1, 'a'), A(q1.id, 'right', 2, 'b'), A(q1.id, 'right', 3, 'a'), A(q2.id, 'wrong', 2, 'a'), A(q2.id, 'right', 3, 'b'), A(q2.id, 'wrong', 4, 'c')] };
  assert.equal(mastery('g1', d).get('3.1')?.n, 3);
  assert.equal(mastery('g1', d).get('3.3')?.n, 2, '王小明不在一对二里');
  assert.equal(mastery('a', d).get('3.1')?.n, 2, '个人只算自己');
  const wb = new Map(wrongBook('g1', d).map((w) => [w.q.id, w.status]));
  assert.equal(wb.get(q1.id), 'fixed');
  assert.equal(wb.get(q2.id), 'open', '张俊宇最近一次还是错');
  assert.equal(new Map(wrongBook('g2', d).map((w) => [w.q.id, w.status])).get(q2.id), 'open');
  const lessons: LessonNote[] = [
    { id: 'l1', studentId: 'a', groupId: 'g1', date: '2026-10-02', at: day(2, 20), topic: '浮力', summary: '', strengths: [], problems: [], next: [], parent: '' } as LessonNote,
    { id: 'l2', studentId: 'b', groupId: 'g1', date: '2026-10-02', at: day(2, 21), topic: '浮力', summary: '', strengths: [], problems: [], next: [], parent: '' } as LessonNote,
    { id: 'l3', studentId: 'a', date: '2026-10-03', at: day(3, 20), topic: '压强', summary: '', strengths: [], problems: [], next: [], parent: '' } as LessonNote,
  ];
  const d2 = { ...d, lessons };
  assert.equal(profile('g1', d2).lessons, 1, '同一天两份成员总结算一节');
  assert.equal(profile('a', d2).lessons, 2);
  assert.equal(profile('g1', d2).attempts, 5);
});

T('课后总结：班组课下课后给每位成员各列一份，带上班组；已有的跳过', () => {
  const slots: LessonSlot[] = [{ id: 's1', studentId: 'g1', date: '2026-10-21', day: 2, start: 14, len: 1, topic: '一对二课程', repeat: false }];
  const now = new Date(2026, 9, 21, 15, 30);
  const due = dueLessons(now, slots, all.map((s) => (s.id === 'g1' ? { ...s, lastTopic: '电路' } : s)), emptyStudy(), new Set());
  assert.deepEqual(due.map((x) => [x.studentId, x.groupId, x.topic, x.key]), [['a', 'g1', '电路', 'lesson:a:2026-10-21'], ['b', 'g1', '电路', 'lesson:b:2026-10-21']]);
  const done: LessonNote = { id: 'x', studentId: 'a', groupId: 'g1', date: '2026-10-21', at: now.toISOString(), topic: '', summary: '', strengths: [], problems: [], next: [], parent: '' } as LessonNote;
  assert.deepEqual(dueLessons(now, slots, all, { ...emptyStudy(), lessons: [done] }, new Set()).map((x) => x.studentId), ['b']);
  assert.deepEqual(dueLessons(now, slots, all, emptyStudy(), new Set(['lesson:b:2026-10-21'])).map((x) => x.studentId), ['a']);
});

const L = (student: string, more: Partial<ImportLesson> = {}): ImportLesson => ({ student, grade: '', subject: '', day: 2, date: '', start: 19, len: 1.5, topic: '', repeat: true, ...more });

T('课表导入：几个名字对到已有班组；单个名字不会误对到班组；班级名对班组', () => {
  assert.equal(matchStudent('俊宇、欣怡', all)?.id, 'g1');
  assert.equal(matchStudent('欣怡/俊宇', all)?.id, 'g1');
  assert.equal(matchStudent('俊宇、小明', all), undefined, '没有这两个人的班组');
  assert.equal(matchStudent('欣怡', all)?.id, 'b', '「欣怡」不该对上「俊宇欣怡一对二」');
  assert.equal(matchStudent('初二(3)班', all)?.id, 'g2');
  assert.equal(matchStudent('俊宇欣怡一对二', all)?.id, 'g1');
  const rows = rowsOf([L('俊宇、欣怡'), L('俊宇、小明')], all);
  assert.deepEqual(rows.map((r) => r.studentId), ['g1', NEW]);
});

T('课表导入：新的一对二建成员和班组、只建一次；班课建空班组；默认课名', () => {
  const lessons = [L('俊宇、小明', { day: 0 }), L('俊宇、小明', { day: 2 }), L('周杰、吴磊', { day: 3, grade: '高一', subject: '数学' }), L('初三(1)班', { day: 4 }), L('孙七', { day: 5 })];
  let k = 0;
  const p = planImport({ rows: rowsOf(lessons, all), students: all, slots: [], mode: 'merge', onConflict: 'keep', from: new Date(2026, 9, 19), today: new Date(2026, 9, 19), newId: () => 'n' + ++k });
  assert.equal(p.added, 5);
  const byName = new Map(p.students.map((s) => [s.name, s]));
  const g1 = byName.get('张俊宇、王小明一对二')!;
  assert.ok(g1, '用已有的张俊宇、王小明建一对二：' + p.created.map((s) => s.name).join('|'));
  assert.deepEqual(g1.members, ['a', 'c']);
  assert.equal(p.slots.filter((s) => s.studentId === g1.id).length, 2, '两节都用同一个班组');
  const g2 = byName.get('周杰、吴磊一对二')!;
  assert.ok(byName.get('周杰') && byName.get('吴磊') && !byName.get('周杰')!.kind, '成员也建好');
  assert.equal(g2.grade, '高一');
  assert.match(String(g2.subject), /math/);
  const cls = byName.get('初三(1)班')!;
  assert.deepEqual([cls.kind, cls.members], ['class', []]);
  assert.deepEqual(p.slots.map((s) => s.topic), ['一对二课程', '一对二课程', '一对二课程', '班课', '一对一课程']);
  assert.equal(createdText(p.created), '新建学生 周杰、吴磊、孙七，新建班组 张俊宇、王小明一对二、周杰、吴磊一对二、初三(1)班');
});

T('课表导入：规则版认出「俊宇、欣怡」一起上；逗号后面的课程内容不当名字；提示词说明写法', () => {
  const names = all.map((s) => s.name);
  assert.equal(nameIn('19:00-20:30 俊宇、欣怡 电磁感应', names), '俊宇、欣怡');
  assert.equal(matchStudent(nameIn('19:00-20:30 俊宇、欣怡 电磁感应', names), all)?.id, 'g1');
  assert.equal(nameIn('周杰+吴磊 物理', names), '周杰、吴磊');
  assert.equal(nameIn('周三 19:00-20:30 张俊宇, 电磁感应', names), '张俊宇');
  assert.equal(nameIn('俊宇欣怡一对二 周三', names), '俊宇欣怡一对二');
  const got = lessonsByRules('周三 19:00-20:30 张俊宇、李欣怡 浮力\n周四 18:00-19:00 王小明', names, new Date(2026, 9, 19));
  assert.deepEqual(got.map((l) => [l.student, l.topic]), [['张俊宇、李欣怡', '浮力'], ['王小明', '']]);
  assert.match(schedulePrompt(new Date(2026, 9, 19), names, 'x'), /一对二[\s\S]*顿号[\s\S]*班课写班级名/);
});

T('助教找人：「名、名」对班组；单名偏向个人；还没有班组时给出成员', () => {
  assert.equal(pickPeople(all, '俊宇、欣怡')?.group?.id, 'g1');
  assert.equal(pickPeople(all, ['李欣怡', 'a'])?.group?.id, 'g1');
  const fresh = pickPeople(all, '俊宇、小明');
  assert.deepEqual([fresh?.group, fresh?.members.map((m) => m.id)], [undefined, ['a', 'c']]);
  assert.equal(pickPeople(all, '俊宇'), null);
  assert.equal(pickPeople(all, '初二(3)班'), null, '一个名字交给 pickStudent');
  assert.throws(() => pickPeople(all, '俊宇、钱八'), /没有叫「钱八」/);
  assert.equal(pickStudent(all, '俊宇').id, 'a', '「俊宇」也在班组名里，但说的是人');
  assert.equal(pickStudent(all, '(3)班').id, 'g2');
});

T('助教课表：只看某位学生时也列出他班组的课；班组课的默认课名和说明', () => {
  const slots: LessonSlot[] = [
    { id: 's1', studentId: 'g1', date: '2026-10-21', day: 2, start: 14, len: 1, topic: '一对二课程', repeat: false },
    { id: 's2', studentId: 'c', date: '2026-10-21', day: 2, start: 16, len: 1, topic: '一对一课程', repeat: false },
  ];
  const mine = occurrences(slots, all, new Date(2026, 9, 21), 1, 'a');
  assert.deepEqual(mine.map((o) => [o.id, o.group, o.members]), [['s1', '一对二', ['张俊宇', '李欣怡']]]);
  assert.equal(occurrences(slots, all, new Date(2026, 9, 21), 1, 'c').length, 1);
  assert.equal(lessonFrom({ student: 'g2', date: '2026-10-22', start: '19:00' }, all, undefined, () => 'x').topic, '班课');
  assert.match(lessonText(slots[0], all), /^俊宇欣怡一对二（一对二）/);
});

T('提醒：指定了学生的课前提醒，他班组的课也提醒', () => {
  const slots: LessonSlot[] = [{ id: 's1', studentId: 'g1', date: '2026-10-21', day: 2, start: 14, len: 1, topic: '浮力', repeat: false }];
  const t = cleanTrigger({ name: '课前', when: { type: 'before_lesson', minutes: 10, student: 'a' }, action: { type: 'remind', text: '看错题' } }, { by: 'teacher' });
  const fire = dueTimed([t], new Date(2026, 9, 21, 13, 52), slots, all);
  assert.equal(fire.length, 1);
  assert.equal(fire[0].studentId, 'g1');
  const other = cleanTrigger({ name: '课前', when: { type: 'before_lesson', minutes: 10, student: 'c' }, action: { type: 'remind', text: 'x' } }, { by: 'teacher' });
  assert.equal(dueTimed([other], new Date(2026, 9, 21, 13, 52), slots, all).length, 0);
});

console.log(`${n}/${n} 通过`);
