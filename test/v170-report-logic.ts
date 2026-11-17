// 1.7.0 第 4 项：下课分析把每一页书写 / 每一次换页都看到；家长版积极、只留家长需要的部分
import assert from 'node:assert/strict';
import { MAX_PAGES, analysisPrompt, planFrames, wholePrompt, type BoardShot } from '../src/lib/recordAnalysisLogic';
import { DEFENSIVE, oneLineOf, parentMarkdown, positiveLesson, positiveText, sectionKind } from '../src/lib/parentReport';
import { coveredLabels, lessonByRules, pickCoveredTags, type LessonNote } from '../src/lib/studyLogic';
import type { Chapter } from '../src/lib/timeline';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const C = (t: number, kind: Chapter['kind'], title: string, ref?: string): Chapter => ({ t, kind, title, ...(ref ? { ref } : {}) });

// 一节 60 分钟的课：黑板写了 3 页，课件翻了 14 页、其中 4 页上写过，还记过 2 次作答
const chapters: Chapter[] = [C(0, 'board', '课堂黑板', 'b1')];
for (let p = 0; p < 3; p++) chapters.push(C(60 + p * 300, 'page', `课堂黑板 第 ${p + 1} 页`, `b1#${p}`), C(200 + p * 300, 'ink', `书写：课堂黑板 第 ${p + 1} 页`, `b1#${p}`));
chapters.push(C(1000, 'material', '期中卷', 'pdf1'));
for (let p = 0; p < 14; p++) { chapters.push(C(1000 + p * 170, 'page', `期中卷 第 ${p + 1} 页`, `pdf1#${p}`)); if (p % 3 === 0) chapters.push(C(1100 + p * 170, 'ink', `书写：期中卷 第 ${p + 1} 页`, `pdf1#${p}`)); }
chapters.push(C(2000, 'attempt', '小王 错：第 5 题', 'q5'), C(2600, 'attempt', '小王 对：第 9 题', 'q9'));
const boards: BoardShot[] = [0, 1, 2].map((p) => ({ ref: `b1#${p}`, title: `课堂黑板 第 ${p + 1} 页`, t: 200 + p * 300, strokes: 30 }));

ok('每一页书写都看到：黑板页用板书原图，课件上写过的页取最后一笔后的画面，没写的页取离开前的画面', () => {
  const { looks, total } = planFrames(chapters, 3600, boards);
  assert.equal(looks.filter((l) => l.board !== undefined).length, 3, '3 页黑板全用原图');
  const ink = looks.filter((l) => l.why === 'ink');
  assert.equal(ink.length, 5, '课件上 5 段书写各一张');
  for (const l of ink) assert.ok(chapters.some((c) => c.kind === 'ink' && Math.abs(c.t + 1.5 - l.t) < 0.2), '最后一笔后 1.5 秒');
  assert.ok(looks.filter((l) => l.why === 'view').length >= 9, '没写过的课件页也都看了');
  assert.ok(looks.filter((l) => l.why === 'mark').length === 2);
  assert.equal(total, looks.length, '预算够时全看');
  assert.ok(looks.length > 18, `1.6 最多 18 张，现在 ${looks.length} 张`);
  for (let i = 1; i < looks.length; i++) assert.ok(looks[i].t >= looks[i - 1].t, '按时间排');
  const ts = [0, ...looks.map((l) => l.t), 3600].sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] <= 240 + 1e-6, '不会有 4 分钟看不到');
});
ok('预算只够看 12 张：书写优先，其余均匀挑；写清一共多少处', () => {
  const all = planFrames(chapters, 3600, boards), cut = planFrames(chapters, 3600, boards, { max: 12 });
  assert.equal(cut.looks.length, 12); assert.equal(cut.total, all.total);
  assert.equal(cut.looks.filter((l) => l.why === 'board' || l.why === 'ink').length, 8, '3 原图 + 5 段书写都在');
  assert.ok(MAX_PAGES >= 100);
});
ok('同一页黑板写了又擦、换页回来再写：更早那次按录像截，最后一次用原图', () => {
  const ch = [C(0, 'board', '黑板', 'b'), C(100, 'ink', '书写：黑板', 'b#0'), C(300, 'material', '课件', 'm'), C(500, 'board', '黑板', 'b'), C(700, 'ink', '书写：黑板', 'b#0')];
  const r = planFrames(ch, 900, [{ ref: 'b#0', title: '黑板', t: 700, strokes: 9 }]);
  assert.equal(r.looks.filter((l) => l.board !== undefined).length, 1);
  assert.ok(r.looks.some((l) => l.why === 'ink' && Math.abs(l.t - 101.5) < 0.2));
});
ok('提示词：每张画面写清是板书原图还是录像几分几秒；要求每道题都列出、不写防御性的话', () => {
  const p = analysisPrompt({ subject: 'physics', student: '小王', title: '期中卷讲评', chapters: [], times: [200, 1101.5], labels: ['板书原图：课堂黑板 第 1 页', '18:21 录像画面（期中卷 第 1 页 写完这一段）'], part: { from: 6, all: 30 } });
  assert.match(p, /第 0 张：板书原图/); assert.match(p, /一共 30 张，这是第 7–8 张/); assert.match(p, /每一道出现过的题都要列出来/); assert.match(p, /不要写「不能证明」/);
  const w = wholePrompt({ subject: 'physics', who: '小王', title: 'x', res: { frames: [{ i: 0, what: '讲第 5 题', questions: [{ stem: '一物体从静止开始做匀加速直线运动', box: null, answer: '', result: null, points: [] }], points: [] }], summary: '讲了第 5 题', weak: [] } });
  assert.match(w, /同一道题只算一次/); assert.match(w, /一物体从静止开始/);
});
ok('防御性说法整句拿掉（给老师的「待确认」），内部字段（把握成数、证据原话、知识点编号）去掉，消极说法换个说法', () => {
  const r = positiveText('今天讲了 6 道连接体题。不能证明小王已经掌握了整体法。第 3 题受力分析画得很规范（把握 7 成）。证据：“我觉得是向左”。暂不能判断计算是否熟练。动量定理还没掌握（0.2）。');
  assert.equal(r.text, '今天讲了 6 道连接体题。第 3 题受力分析画得很规范。动量定理还需要再巩固。');
  assert.equal(r.dropped.length, 2);
  for (const s of ['不能证明他会了', '暂时无法判断', '证据不足', '录像里看不出', '拿不准', '无法确定是否掌握', '有待确认']) assert.ok(DEFENSIVE.test(s), s);
  for (const s of ['讲了 5 道题', '受力分析更熟练了', '下节课重点练整体法']) assert.ok(!DEFENSIVE.test(s), s);
});
const note: LessonNote = {
  id: 'l1', studentId: 's', date: '2026-11-16', at: '2026-11-16T12:00:00Z', topic: '期中卷讲评', minutes: 90, subject: 'physics',
  summary: '本节课讲评了期中卷 12 道题，重点是第 13–18 题。暂不能判断第 16、17 题是否完全掌握。', strengths: ['斜面受力分析思路清晰', '证据不足，无法确认实验题'], problems: ['动量定理的方向判断还没掌握'], next: ['订正第 16 题'],
  parent: '小王家长您好，今天讲评了期中卷。不能证明小王第 17 题已经会了。整体听课很专注。', homework: '完成错题订正', via: 'ai',
};
ok('课后总结兜底：家长看的字段都干净积极，拿掉的进 pending', () => {
  const c = positiveLesson(note);
  assert.ok(!DEFENSIVE.test([c.summary, ...c.strengths, ...c.problems, ...c.next, c.parent].join('')));
  assert.equal(c.strengths.length, 1); assert.match(c.problems[0], /还需要再巩固/);
  assert.equal(c.pending!.length, 3);
  assert.equal(oneLineOf(note), '讲评了期中卷 12 道题，重点是第 13–18 题。');
  assert.equal(oneLineOf({ ...note, oneLine: '讲了 12 道期中题' }), '讲了 12 道期中题');
});
ok('家长版 Markdown：只有家长需要的六块，标题固定、每块对应不同版式；没有内部字段', () => {
  const md = parentMarkdown({ ...note, covered: ['斜面运动：一物体沿倾角 37° 的斜面…（把握 6 成）', '动量定理：质量为 m 的小球…'] }, '小王', 'physics');
  assert.match(md, /<!-- cs:parent -->/);
  const hs = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(hs, ['本节内容', '表现亮点', '需要加强', '课后建议', '课后作业', '老师的话']);
  assert.deepEqual(hs.map(sectionKind), ['what', 'good', 'work', 'next', 'hw', 'word']);
  assert.ok(!/把握|证据|暂不能|不能证明|pending|待确认|key/.test(md), md);
  assert.match(md, /- 斜面运动：一物体沿倾角 37° 的斜面…/);
});
ok('没配 AI 的模板版也积极：讲了几道题、学得认真；一句话也有', () => {
  const r = lessonByRules({ student: '小王', topic: '牛顿第二定律', minutes: 60, attempts: [], notes: '', covered: ['a', 'b', 'c'] });
  assert.match(r.parent, /讲了 3 道题/); assert.match(r.parent, /学得很认真/); assert.match(r.oneLine!, /讲了 3 道题/);
  assert.ok(!DEFENSIVE.test(r.parent + r.summary));
});
ok('「本节内容」每道题一句短标签：模型的 tag 优先，其次知识点名，都没有写「第 N 题」，重复标签补题号', () => {
  const labels = coveredLabels([
    { tag: '电梯超重失重判断', point: '超重和失重' },
    { tag: '', point: '超重和失重' },
    { tag: '连接体受力分析' },
    { point: '超重和失重' },
    {},
  ]);
  assert.deepEqual(labels, ['电梯超重失重判断', '超重和失重', '连接体受力分析', '超重和失重（第 4 题）', '第 5 题']);
});
ok('模型给的题目标签数量对不上就整条作废，不错位', () => {
  assert.deepEqual(pickCoveredTags(['电梯超重失重判断', '连接体受力分析'], 2), ['电梯超重失重判断', '连接体受力分析']);
  assert.equal(pickCoveredTags(['只有一道'], 2), undefined);
  assert.equal(pickCoveredTags(['a', 'b', 'c'], 2), undefined);
  assert.equal(pickCoveredTags('不是数组', 2), undefined);
  assert.equal(pickCoveredTags(['第 1 题', '第 2 题'], 2), undefined, '偷懒写「第 N 题」等于没写');
  assert.deepEqual(pickCoveredTags(['  电梯超重失重判断  ', '1. 连接体受力分析'], 2), ['电梯超重失重判断', '连接体受力分析'], '编号和多余空白去掉');
});
console.log(`PASS ${n}/${n} v170-report-logic`);
