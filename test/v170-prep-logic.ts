// 1.7.0 第 5、6、7 项：小羽归档 / 记一次备课都进「备课」；旧的 kind=prep 文件启动时补成备课（幂等）；学生的最近文件；课前一句话
import assert from 'node:assert/strict';
import { lessonBrief, migratePreps, prepLine, topicOf, upsertPrep } from '../src/lib/prepRecord';
import { studentRecent } from '../src/lib/recentLogic';
import { needsConvert, prepPaths } from '../src/lib/prepRecord';
import { oneLineOf } from '../src/lib/parentReport';
import type { LessonNote, Prep, StudentFile } from '../src/lib/studyLogic';

let n = 0, seq = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const id = () => 'p' + ++seq;
const F = (studentId: string, path: string, at: string, kind: StudentFile['kind'] = 'prep', note?: string): StudentFile => ({ id: 'f' + ++seq, studentId, at, kind, title: path.split('/').pop()!, path, via: 'assistant', ...(note ? { note } : {}) });

ok('截图 2：小羽归档了很多教案，备课页还是 0 → 启动时补成备课记录，按学生 + 那天归到一起；跑第二次不再加', () => {
  const files = [
    F('hd', 'C:/w/海淀高三上物理_超纲竞赛化原创题_练习.pdf', '2026-11-16T11:07:00Z', 'prep', '海淀高三上物理原创超纲竞赛化题与答案'),
    F('hd', 'C:/w/海淀高三上物理_超纲竞赛化原创题_答案.md', '2026-11-16T11:07:30Z'),
    F('hd', 'C:/w/电磁学全知识点练习.pdf', '2026-11-15T11:05:00Z'),
    F('hd', 'C:/w/板书.png', '2026-11-16T12:00:00Z', 'board'),
    F('xm', 'C:/w/小明-教案.docx', '2026-11-16T03:00:00Z'),
  ];
  const r = migratePreps({ preps: [], files }, { id });
  assert.equal(r.added, 3); assert.equal(r.preps.filter((p) => p.studentId === 'hd').length, 2);
  const d16 = r.preps.find((p) => p.studentId === 'hd' && p.date === '2026-11-16')!;
  assert.equal(d16.files.length, 2, '板书不算备课'); assert.equal(d16.from, 'migrate');
  assert.equal(d16.summary, '海淀高三上物理原创超纲竞赛化题与答案');
  const again = migratePreps({ preps: r.preps, files }, { id });
  assert.equal(again.added, 0); assert.equal(again.preps.length, r.preps.length);
  assert.deepEqual(again.preps, r.preps, '幂等：不丢不重');
});
ok('已经在备课记录里的文件（prepare_lesson、自动备课）不重复补', () => {
  const prep: Prep = { id: 'x', studentId: 'hd', date: '2026-11-10', at: '2026-11-10T00:00:00Z', topic: '动量', points: [], materials: [], questionIds: [], plan: '', files: ['C:/s/备课/海淀-动量.pdf'], via: 'ai' };
  const r = migratePreps({ preps: [prep], files: [F('hd', 'C:\\s\\备课\\海淀-动量.pdf', '2026-11-10T01:00:00Z')] }, { id });
  assert.equal(r.added, 0);
});
ok('记一次备课：同一天同主题合进一条（文件去重、摘要补上）；不同主题另起一条', () => {
  let ps: Prep[] = [];
  const base = { studentId: 's', date: '2026-11-18', from: 'assistant' as const, at: '2026-11-17T10:00:00Z', id };
  let r = upsertPrep(ps, { ...base, topic: '电磁感应综合', files: ['a.pdf'] }); ps = r.preps; assert.ok(r.fresh);
  r = upsertPrep(ps, { ...base, topic: '电磁感应综合', files: ['a.pdf', 'b.pptx'], summary: '6 道综合题，先讲动生电动势' }); ps = r.preps;
  assert.ok(!r.fresh); assert.equal(ps.length, 1); assert.deepEqual(ps[0].files, ['a.pdf', 'b.pptx']); assert.equal(ps[0].summary, '6 道综合题，先讲动生电动势');
  r = upsertPrep(ps, { ...base, topic: '天体运动', files: ['c.pdf'] }); assert.ok(r.fresh); assert.equal(r.preps.length, 2);
  assert.equal(prepLine(ps[0]), '6 道综合题，先讲动生电动势');
  assert.equal(prepLine({ summary: '', plan: '# 标题\n- 目标：会用楞次定律判断方向。', topic: 'x', points: [] }), '目标：会用楞次定律判断方向');
  assert.equal(topicOf(['C:/w/海淀-2026-11-18-电磁感应综合-讲义.pdf', 'C:/w/x.md'], '海淀'), '电磁感应综合');
});
ok('备课一记下就排上后台转码：只转 PPT / Word', () => {
  assert.ok(needsConvert('a.pptx') && needsConvert('b.DOCX') && !needsConvert('c.pdf') && !needsConvert('https://x/a.pptx'));
  assert.deepEqual(prepPaths({ files: ['a.pdf', 'b.pptx'], materials: ['c.docx', 'b.pptx'], courseware: ['d.ppt'] }), ['b.pptx', 'd.ppt', 'c.docx']);
});
ok('学生的「最近」：这位学生名下最近打开过的排前面，其余按更新时间；别的学生的不出现', () => {
  const files = [F('a', 'D:/a/错题.pdf', '2026-11-10T00:00:00Z', 'doc'), F('a', 'D:/a/板书.png', '2026-11-16T00:00:00Z', 'board'), F('b', 'D:/b/别人的.pdf', '2026-11-17T00:00:00Z', 'doc')];
  const preps: Prep[] = [{ id: 'p', studentId: 'a', date: '2026-11-18', at: '2026-11-17T00:00:00Z', topic: 't', points: [], materials: ['D:/课件/电磁感应.pptx'], questionIds: [], plan: '', files: [], via: 'ai' }];
  const lessons = [{ id: 'l', studentId: 'a', date: '2026-11-15', at: '2026-11-15T12:00:00Z', files: ['D:/s/课后反馈.png'] }] as unknown as LessonNote[];
  const r = studentRecent({ studentId: 'a', recents: ['D:/b/别人的.pdf', 'D:/a/错题.pdf', 'D:/其他/无关.pdf'], files, preps, lessons });
  assert.deepEqual(r.map((x) => x.path), ['D:/a/错题.pdf', 'D:/课件/电磁感应.pptx', 'D:/a/板书.png', 'D:/s/课后反馈.png']);
  assert.ok(r[0].opened); assert.match(r[1].why, /备课/);
});
ok('课前一句话：上节讲了什么 + 这节备课', () => {
  const lessons = [
    { id: 'l1', studentId: 'a', date: '2026-11-10', at: '1', topic: '动量', summary: '本节课讲了动量定理的 4 道题。', oneLine: '' },
    { id: 'l2', studentId: 'a', date: '2026-11-14', at: '2', topic: '动量守恒', summary: 'x', oneLine: '讲了 6 道碰撞题，会列守恒式了' },
  ] as unknown as LessonNote[];
  const preps: Prep[] = [{ id: 'p', studentId: 'a', date: '2026-11-17', at: '3', topic: '能量', points: [], materials: [], questionIds: [], plan: '', files: [], via: 'ai', summary: '讲功能关系，5 道传送带题' }];
  const b = lessonBrief('a', { lessons, preps }, '2026-11-17', oneLineOf);
  assert.equal(b.last?.line, '讲了 6 道碰撞题，会列守恒式了'); assert.equal(b.prep?.line, '讲功能关系，5 道传送带题');
  const b2 = lessonBrief('a', { lessons, preps: [] }, '2026-11-12', oneLineOf);
  assert.equal(b2.last?.line, '讲了动量定理的 4 道题。'); assert.equal(b2.prep, null);
  assert.deepEqual(lessonBrief('z', { lessons, preps }, '2026-11-17', oneLineOf), { last: null, prep: null });
});
console.log(`PASS ${n}/${n} v170-prep-logic`);
