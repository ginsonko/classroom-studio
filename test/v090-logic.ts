// 0.9.0 纯逻辑验收：资料整理（规则 / AI 归类 / 检索）和 AI 自动处理（课后、备课）。
// 用法：npx tsx test/v090-logic.ts
import assert from 'node:assert/strict';
import { aiClassifyPrompt, classifyByRules, dateOfName, junkFile, ownerOf, parseAiClassify, searchCatalog, topicOf, words, type CatEntry, type CatFile, type CatStudent } from '../src/lib/catalogLogic';
import { DEFAULT_AUTO, cleanSettings, dueLessons, jobsToday, notesText, parsePrep, prepByRules, prepMarkdown, prepPrompt, upcoming, type PrepInput } from '../src/lib/autopilotLogic';
import { emptyStudy, homeworkMarkdown, type Question, type StudyData } from '../src/lib/studyLogic';
import { dateKey } from '../src/doc/scheduleModel';
import type { LessonSlot, Student } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };
const F = (path: string, kind: CatFile['kind'] = 'pdf'): CatFile => { const parts = path.split('/'); return { path, title: parts.at(-1)!.replace(/\.[^.]+$/, ''), kind, folder: parts.slice(0, -1).join('/') }; };
const students: CatStudent[] = [{ id: 's1', name: '张小明', grade: '高二', subject: 'physics' }, { id: 's2', name: '李雨', grade: '初二', subject: 'j-math' }];
const NOW = '2026-10-12T08:00:00.000Z';

ok('规则归类：试卷进题库，带学科和年级', () => {
  const e = classifyByRules(F('D:/资料/高二物理/动量守恒定律 单元测试卷（含答案）.pdf'), students, Date.UTC(2026, 3, 5), NOW);
  assert.equal(e.shelf, 'questions');
  assert.equal(e.subject, 'physics');
  assert.equal(e.grade, '高二');
  assert.equal(e.answer, true);
  assert.equal(e.unsure, undefined);
  assert.equal(e.date, '2026-04-05');
  assert.ok(!/答案|（/.test(e.topic!), e.topic);
});
ok('规则归类：课件进课件库；初中数学认成 j-math', () => {
  const e = classifyByRules(F('D:/资料/初中数学/八上 一次函数 课件.pptx', 'slides'), students, undefined, NOW);
  assert.equal(e.shelf, 'courseware');
  assert.equal(e.subject, 'j-math');
  const p = classifyByRules(F('D:/小学/三年级 科学 植物的生长.pptx', 'slides'), students, undefined, NOW);
  assert.equal(p.subject, 'p-science');
});
ok('规则归类：路径里有学生名字的作业 / 错题进学生档案', () => {
  const e = classifyByRules(F('D:/学生/张小明/错题整理 10月.docx', 'word'), students, Date.UTC(2026, 9, 3), NOW);
  assert.equal(e.shelf, 'student');
  assert.equal(e.studentId, 's1');
  assert.equal(e.subject, 'physics', '没写学科时用学生的学科');
  const img = classifyByRules(F('D:/学生/李雨/IMG_2031.jpg', 'image'), students, undefined, NOW);
  assert.equal(img.shelf, 'student');
});
ok('规则归类：分不出来的标 unsure', () => {
  const e = classifyByRules(F('D:/下载/新建文件夹/abc123.pdf'), students, undefined, NOW);
  assert.equal(e.unsure, true);
  assert.equal(e.shelf, 'other');
  const v = classifyByRules(F('D:/素材/小球下落.mp4', 'video'), students, undefined, NOW);
  assert.equal(v.shelf, 'media');
});
ok('规则归类：学科看文件名，再从近到远看目录，一直到资料库根目录', () => {
  const deep = classifyByRules(F('D:/名师物理/高一/上学期/第3讲/练习/电势差与电场强度的关系_提高档_原卷版.pdf'), [], undefined, NOW);
  assert.deepEqual([deep.subject, deep.unsure], ['physics', undefined]);
  const root = classifyByRules(F('D:/名师物理/2023/春季/第5讲/相关题目/周测1129.pdf'), [], undefined, NOW);
  assert.equal(root.subject, 'physics', '只有最外层目录写了学科');
  assert.equal(classifyByRules(F('D:/资料/专题3.31 组合场（类平抛+圆周运动）计算题（提高篇）.pdf'), [], undefined, NOW).subject, 'physics');
  assert.equal(classifyByRules(F('D:/化学/高二/化学平衡 课件.pptx', 'slides'), [], undefined, NOW).subject, 'chem');
  const both = classifyByRules(F('D:/高中物理/专题/平抛运动的轨迹是抛物线.pdf'), [], undefined, NOW);
  assert.equal(both.subject, 'physics', '文件名里两个学科都沾边时看外层目录');
  assert.equal(topicOf('《1 实验：探究小车速度随时间变化的规律》精品说课课件ppt'), '《1 实验：探究小车速度随时间变化的规律》');
  assert.equal(junkFile('~$卷01-备战2023年高考物理模拟卷'), true);
  assert.equal(junkFile('卷01'), false);
});
ok('学生档案：错题库下的人名目录认成学生，日期优先取文件名里的', () => {
  const mt = new Date(2025, 8, 30).getTime();
  const a = classifyByRules(F('C:/Desktop/工作/错题库/俊宇同学/25.7.22-3.jpg', 'image'), [], mt, NOW);
  assert.deepEqual([a.shelf, a.owner, a.date, a.unsure], ['student', '俊宇', '2025-07-22', undefined]);
  const b = classifyByRules(F('C:/Desktop/工作/错题库/林小雨/9.17-1.jpg', 'image'), [], mt, NOW);
  assert.deepEqual([b.owner, b.date], ['林小雨', '2025-09-17']);
  assert.equal(dateOfName('10.5-1', new Date(2026, 2, 1).getTime()), '2025-10-05', '月.日比文件时间晚就是上一年');
  assert.equal(dateOfName('34.4.11-1', mt), '2025-09-30', '不合理的日期用文件时间');
  assert.equal(dateOfName('2023.10.23周测试卷', mt), '2023-10-23');
  const c = classifyByRules(F('C:/Desktop/工作/错题库/俊宇同学/2023.10.23周测试卷.pdf'), [{ id: 's9', name: '俊宇', subject: 'physics' }], mt, NOW);
  assert.deepEqual([c.shelf, c.studentId, c.owner, c.subject], ['student', 's9', undefined, 'physics'], '建了同名学生就直接关联');
  assert.equal(ownerOf(F('C:/工作/错题库/高一/1.jpg', 'image')), undefined, '年级目录不是人名');
  assert.equal(ownerOf(F('C:/工作/课件资料/波的描述/1.jpg', 'image')), undefined);
  assert.equal(classifyByRules(F('D:/名师物理/高一/4.1 牛顿第一定律.pdf'), [], mt, NOW).date, '2025-09-30', '课件的章节号不当日期');
});
ok('主题去掉年份、括号和答案尾巴', () => {
  assert.equal(topicOf('2024年 牛顿第二定律专题练习（解析版）'), '牛顿第二定律专题练习');
});
ok('AI 归类：提示词带学科和学生；解析结果覆盖规则、越界 / 重复的忽略', () => {
  const batch = [F('D:/x/abc.pdf'), F('D:/x/def.docx', 'word'), F('D:/x/ghi.pdf')];
  const prompt = aiClassifyPrompt(batch, students);
  assert.ok(prompt.includes('physics=') && prompt.includes('张小明') && prompt.includes('3. '));
  const prior = batch.map((f) => classifyByRules(f, students, undefined, NOW));
  const raw = '```json\n{"items":[{"i":1,"shelf":"questions","subject":"physics","grade":"高二","topic":"楞次定律"},{"i":2,"shelf":"courseware","subject":"x","student":"张小明"},{"i":2,"shelf":"other"},{"i":9,"shelf":"questions"},{"i":3,"shelf":"bad"}]}\n```';
  const out = parseAiClassify(raw, batch, students, prior, NOW);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].shelf, out[0].subject, out[0].grade, out[0].topic, out[0].by, out[0].unsure], ['questions', 'physics', '高二', '楞次定律', 'ai', undefined]);
  assert.equal(out[1].shelf, 'student', '属于某学生的归到学生档案');
  assert.equal(out[1].studentId, 's1');
  assert.equal(out[1].subject, undefined, '不认识的学科 id 丢掉');
  assert.deepEqual(parseAiClassify('不是 JSON', batch, students, prior, NOW), []);
});
ok('检索：按主题词、学科、书架、学生过滤并排序', () => {
  const cat: CatEntry[] = [
    classifyByRules(F('D:/资料/高二物理/动量守恒定律 课件.pptx', 'slides'), students, undefined, NOW),
    classifyByRules(F('D:/资料/高二物理/动量守恒定律 练习（答案）.pdf'), students, undefined, NOW),
    classifyByRules(F('D:/资料/高二物理/动量守恒定律 练习.pdf'), students, undefined, NOW),
    classifyByRules(F('D:/资料/高中化学/化学平衡 课件.pptx', 'slides'), students, undefined, NOW),
    classifyByRules(F('D:/学生/李雨/动量 错题.docx', 'word'), students, undefined, NOW),
  ];
  assert.ok(words('动量守恒 Newton').includes('动量') && words('动量守恒 Newton').includes('newton'));
  const cw = searchCatalog(cat, { text: '动量守恒', subject: 'physics', shelf: 'courseware' });
  assert.equal(cw.length, 1);
  assert.match(cw[0].e.title, /课件/);
  const qs = searchCatalog(cat, { text: '动量守恒', subject: 'physics', shelf: 'questions' });
  assert.equal(qs.length, 2);
  assert.ok(!qs[0].e.answer, '原卷排在答案前面');
  assert.equal(searchCatalog(cat, { text: '动量', shelf: 'student', studentId: 's1' }).length, 0, '别的学生的档案不出现');
  assert.equal(searchCatalog(cat, { text: '化学平衡', subject: 'physics' }).length, 0, '跨学科不出现');
  const loose: CatEntry = { path: 'D:/x/动态平衡专题.pdf', title: '动态平衡专题', kind: 'pdf', shelf: 'courseware', by: 'rules', at: NOW };
  assert.equal(searchCatalog([loose], { text: '化学平衡移动', subject: 'chem' }).length, 0, '学科不明的文件只碰上一个词不算');
  assert.equal(searchCatalog([loose], { text: '动态平衡', subject: 'physics' }).length, 1, '碰上多个词仍然能找到');
});

// ── 自动处理 ─────────────────────────────────────────────
const stu = (id: string, name: string, extra: Partial<Student> = {}): Student => ({ id, name, grade: '高二', hue: 200, textbook: '人教版', subject: 'physics', tags: [], lessons: 3, lastTopic: '动量守恒', lastAt: NOW, ...extra } as Student);
const S = [stu('s1', '张小明'), stu('s2', '李雨', { archived: true }), stu('s3', '王五')];
const now = new Date(2026, 9, 12, 18, 0);   // 周一 18:00
const today = dateKey(now);
const slot = (id: string, studentId: string, start: number, extra: Partial<LessonSlot> = {}): LessonSlot => ({ id, studentId, day: 0, start, len: 1.5, topic: '一对一课程', repeat: true, ...extra });

ok('设置清洗：默认关闭，越界数字收回范围', () => {
  assert.equal(DEFAULT_AUTO.on, false);
  const c = cleanSettings({ on: 'yes', prepHours: 999, hwCount: 1, agent: true, dailyJobs: 'x' });
  assert.equal(c.on, false);
  assert.equal(c.prepHours, 72);
  assert.equal(c.hwCount, 3);
  assert.equal(c.agent, true);
  assert.equal(c.dailyJobs, DEFAULT_AUTO.dailyJobs);
  assert.deepEqual(cleanSettings(null), DEFAULT_AUTO);
});
ok('课后：下课 15 分钟后才处理；已写总结 / 已处理 / 归档学生跳过；临时课按作答记录', () => {
  const slots = [slot('a', 's1', 16), slot('b', 's2', 14), slot('c', 's3', 17)];   // s1 17:30 下课；s3 18:30 下课
  const data: StudyData = emptyStudy();
  let due = dueLessons(now, slots, S, data, new Set());
  assert.deepEqual(due.map((d) => d.studentId), ['s1']);
  assert.equal(due[0].topic, '动量守恒', '课表主题是默认值时用学生最近的主题');
  assert.equal(due[0].minutes, 90);
  assert.equal(dueLessons(now, slots, S, data, new Set([`lesson:s1:${today}`])).length, 0);
  data.lessons.push({ studentId: 's1', date: today } as StudyData['lessons'][number]);
  assert.equal(dueLessons(now, slots, S, data, new Set()).length, 0);
  const d2 = emptyStudy();
  d2.attempts.push({ id: 'x', studentId: 's3', questionId: 'q', result: 'right', at: new Date(2026, 9, 12, 17, 0).toISOString() });
  due = dueLessons(now, [], S, d2, new Set());
  assert.deepEqual(due.map((d) => d.studentId), ['s3'], '没排课但今天做过题，40 分钟没动静算下课');
  d2.attempts.push({ id: 'y', studentId: 's3', questionId: 'q', result: 'right', at: new Date(2026, 9, 12, 17, 40).toISOString() });
  assert.equal(dueLessons(now, [], S, d2, new Set()).length, 0);
});
ok('备课：只挑接下来 N 小时内、没备过的课，按时间排序', () => {
  const slots = [slot('a', 's1', 8, { day: 1 }), slot('b', 's3', 20), slot('c', 's2', 19), slot('d', 's3', 10, { day: 3 })];
  const up = upcoming(now, slots, S, 20, [], new Set());
  assert.deepEqual(up.map((u) => u.slotId), ['b', 'a']);
  assert.ok(up[0].inHours > 1.9 && up[0].inHours < 2.1);
  assert.deepEqual(upcoming(now, slots, S, 20, [{ slotId: 'b', date: today } as never], new Set([`prep:a:${dateKey(new Date(2026, 9, 13))}`])), []);
});

const q = (id: string, stem: string, extra: Partial<Question> = {}): Question => ({ id, stem, points: ['6.1'], difficulty: 3, qtype: '计算', origin: 'manual', status: 'bank', createdAt: NOW, ...extra });
const input: PrepInput = {
  student: { name: '张小明', grade: '高二', textbook: '人教版', tags: ['基础弱'] }, subject: 'physics', topic: '动量守恒', minutes: 90,
  points: ['6.1'], weak: ['6.1'], materials: [{ path: 'D:/资料/动量守恒 课件.pptx', title: '动量守恒 课件', kind: 'slides', shelf: 'courseware', by: 'rules', at: NOW }], files: [],
  questions: [{ q: q('q1', '两球碰撞|求速度', { answer: '2 m/s' }), why: '薄弱点' }, { q: q('q2', '子弹打木块'), why: '同主题' }],
  notes: [{ id: 'n1', studentId: 's1', at: '2026-10-10T00:00:00Z', kind: 'requirement', text: '希望多练计算题' }, { id: 'n2', studentId: 's1', at: '2026-10-11T00:00:00Z', kind: 'parent', text: '孩子说上次没听懂' }],
  lastLessons: [{ date: '2026-10-05', topic: '动量定理', summary: '掌握一般', next: ['多练碰撞'] }],
};
ok('备课提示词带学情、家长要求、本地课件和题库题', () => {
  const p = prepPrompt(input);
  for (const s of ['张小明', '90 分钟', '基础弱', '希望多练计算题', '动量守恒 课件', '两球碰撞', '多练碰撞', '"flow"']) assert.ok(p.includes(s), s);
  assert.ok(notesText(input.notes).startsWith('【家长聊天记录 2026-10-11】'), '新的在前');
  assert.equal(notesText(input.notes, 5).length < 30, true);
});
ok('备课结果解析：序号转下标，越界去掉；缺目标 / 流程判为失败', () => {
  const plan = parsePrep('{"goals":["会用动量守恒"],"flow":[{"min":10,"step":"回顾"},{"min":"x","step":"讲"},{"step":""}],"focus":["计算"],"materials":[1,5],"questions":[2,1,2,0],"parent":"多练","gaps":""}', input)!;
  assert.deepEqual(plan.materials, [0]);
  assert.deepEqual(plan.questions, [1, 0]);
  assert.deepEqual(plan.flow, [{ min: 10, step: '回顾' }, { min: 5, step: '讲' }]);
  assert.equal(parsePrep('{"goals":[],"flow":[]}', input), null);
  assert.equal(parsePrep('随便', input), null);
});
ok('规则备课 + 备课文档：带主题色、流程表、课件路径、题和答案', () => {
  const plan = prepByRules(input);
  assert.equal(plan.flow.reduce((s, f) => s + f.min, 0), 90);
  assert.ok(plan.focus.some((f) => f.includes('家长')));
  const md = prepMarkdown({ topic: '动量守恒', date: '2026-10-13', start: 8.5, minutes: 90, subject: 'physics' }, '张小明', plan, input, { courseware: ['C:/x/AI 课件.pptx'] });
  assert.ok(md.startsWith('<!-- cs:theme=physics -->'), md.slice(0, 40));
  for (const s of ['# 张小明 · 备课：动量守恒', '08:30', '| 时间 | 环节 |', '课件路径：D:/资料/动量守恒 课件.pptx', 'AI 课件.pptx', '两球碰撞', '答案：2 m/s']) assert.ok(md.includes(s), s);
  const none = prepMarkdown({ topic: '', date: '2026-10-13', minutes: 60, subject: 'physics' }, '张小明', prepByRules({ ...input, materials: [], questions: [] }), { ...input, materials: [], questions: [] });
  assert.ok(none.includes('本地课件库里没有合适的课件') && none.includes('## 还缺的资料'));
});
ok('作业：选择题选项单独成一段，题型后缀留在题干上，选择题不留空', () => {
  const md = homeworkMarkdown('作业', '小林', [q('c1', '下列说法正确的是（　）\nA. 动量是标量\nB. 冲量的方向与力的方向相同\n(C) 都不对', { qtype: '选择' })]);
  assert.ok(md.includes('**1.** 下列说法正确的是（　）　（选择，'), md);
  assert.ok(md.includes('\n\nA. 动量是标量\u3000\u3000B. 冲量的方向与力的方向相同\u3000\u3000(C) 都不对\n\n'), md);
  assert.ok(!md.includes('[[留空]]'));
  const plain = homeworkMarkdown('作业', '小林', [q('c2', '一辆车\n以 A 点出发')]);
  assert.ok(plain.includes('**1.** 一辆车 以 A 点出发　（计算，') && plain.includes('[[留空]]'));
});
ok('今日 AI 任务计数只算今天、只算用了 AI 的', () => {
  const t = new Date(2026, 9, 12, 12);
  assert.equal(jobsToday([{ at: new Date(2026, 9, 12, 9).toISOString(), ai: true }, { at: new Date(2026, 9, 12, 10).toISOString() }, { at: new Date(2026, 9, 11, 10).toISOString(), ai: true }], t), 1);
});

console.log(`v090-logic: ${n}/${n} PASS`);
