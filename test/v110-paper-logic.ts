// 1.1.0 自己组卷：按题型分大题、配分、排序、总分缩放、学生版 / 答案版
import assert from 'node:assert/strict';
import { addToPaper, cleanPaper, emptyPaper, moveInPaper, paperIds, paperMarkdown, paperTotal, removeFromPaper, scaleTo, sectionHeading } from '../src/lib/paperLogic';
import { parseMarkdown } from '../src/export/markdown';
import type { Question } from '../src/lib/studyLogic';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const Q = (id: string, qtype: string, p: Partial<Question> = {}): Question => ({ id, stem: '题' + id, points: [], difficulty: 2, qtype, origin: 'manual', status: 'bank', createdAt: '2026-10-20T00:00:00Z', subject: 'physics', answer: '答' + id, ...p });
const order = ['选择', '填空', '计算', '实验', '其他'];

ok('加题按题型进大题，大题按学科题型顺序', () => {
  let p = emptyPaper('physics');
  for (const q of [Q('c1', '计算'), Q('s1', '选择'), Q('s2', '选择'), Q('f1', '填空'), Q('s1', '选择')]) p = addToPaper(p, q, order);
  assert.deepEqual(p.sections.map((s) => s.title), ['选择题', '填空题', '计算题']);
  assert.deepEqual(paperIds(p), ['s1', 's2', 'f1', 'c1'], '重复加不进去');
  assert.equal(paperTotal(p), 4 + 4 + 5 + 12);
  assert.equal(sectionHeading(p.sections[0], 0), '一、选择题（共 2 题，每题 4 分，共 8 分）');
  assert.equal(sectionHeading(p.sections[2], 2), '三、计算题（共 1 题，共 12 分）');
});

ok('拖动排序、跨大题移动、删除', () => {
  let p = emptyPaper();
  for (const q of [Q('a', '选择'), Q('b', '选择'), Q('c', '计算')]) p = addToPaper(p, q, order);
  p = moveInPaper(p, 'b', p.sections[0].id, 0);
  assert.deepEqual(paperIds(p), ['b', 'a', 'c']);
  p = moveInPaper(p, 'a', p.sections[1].id, 1);
  assert.deepEqual(p.sections.map((s) => s.items.map((i) => i.id)), [['b'], ['c', 'a']]);
  p = removeFromPaper(p, 'b');
  assert.deepEqual(paperIds(p), ['c', 'a']);
});

ok('总分凑到 100：整数、比例大致不变', () => {
  let p = emptyPaper();
  for (let i = 0; i < 8; i++) p = addToPaper(p, Q('s' + i, '选择'), order);
  for (let i = 0; i < 3; i++) p = addToPaper(p, Q('c' + i, '计算'), order);
  assert.equal(paperTotal(p), 68);
  const s = scaleTo(p, 100);
  assert.equal(paperTotal(s), 100);
  assert.ok(s.sections.flatMap((x) => x.items).every((i) => Number.isInteger(i.score) && i.score >= 1));
  assert.ok(s.sections[1].items[0].score > s.sections[0].items[0].score * 2.5);
});

ok('学生版：卷头、大题、配分、选项、作答空白；答案版：答案样式、题号一致', () => {
  let p = { ...emptyPaper('math'), title: '函数小测', minutes: 30 };
  const qs = [Q('s', '选择', { stem: '下列正确的是\nA. 甲\nB. 乙', answer: 'B', subject: 'math' }), Q('c', '解答', { stem: '求 $f(2)$。', answer: '4', analysis: '代入即可。', subject: 'math', check: 'mismatch' })];
  for (const q of qs) p = addToPaper(p, q, ['选择', '填空', '解答']);
  const md = paperMarkdown(p, qs, 'student');
  assert.match(md, /^<!-- cs:theme=math -->/);
  assert.ok(md.includes('[[表头 时间：30 分钟|满分：16 分|班级|姓名|得分]]'), md);
  assert.ok(md.includes('## 一、选择题（共 1 题，共 4 分）') && md.includes('**1.** （4 分）下列正确的是') && md.includes('A. 甲\u3000\u3000B. 乙'));
  assert.ok(md.includes('**2.** （12 分）求 $f(2)$。\n\n[[留空]]\n\n[[留空]]'), md);
  assert.ok(!md.includes('代入即可'), '学生版没有答案');
  const ans = paperMarkdown(p, qs, 'answer');
  assert.ok(ans.includes('# 函数小测 · 参考答案') && ans.includes('**1.** B　（4 分）') && ans.includes('> 代入即可。') && ans.includes('没有通过 AI 自检'));
  const parsed = parseMarkdown(md);
  assert.ok(parsed.blocks.some((b) => b.type === 'fields'));
  assert.equal(parsed.blocks.filter((b) => b.type === 'gap').length, 2);
});

ok('导入的原卷截图题：只放图、按原卷宽度，不重复印识别文字', () => {
  const img = 'D:/x/study/img/0123abcd-0123-4567-89ab-0123456789ab.png';
  const qs = [Q('i', '选择', { stem: '识别出来的题干\nA. 1\nB. 2', origin: 'import', image: img, imagePt: 402 }), Q('m', '选择', { stem: '手写题', image: img })];
  let p = emptyPaper();
  for (const q of qs) p = addToPaper(p, q, order);
  const md = paperMarkdown(p, qs, 'student');
  assert.ok(md.includes('**1.** （4 分）\n\n![题图 w=402](img:0123abcd-0123-4567-89ab-0123456789ab.png)'), md);
  assert.ok(!md.includes('识别出来的题干'));
  assert.ok(md.includes('**2.** （4 分）手写题\n\n![题图](img:'), '自己录的题照旧：文字 + 图');
});

ok('题库删掉的题自动从卷子里去掉', () => {
  let p = emptyPaper();
  for (const q of [Q('a', '选择'), Q('b', '计算')]) p = addToPaper(p, q, order);
  p.sections[0].items[0].score = NaN;
  const c = cleanPaper(p, [Q('a', '选择')]);
  assert.deepEqual(paperIds(c), ['a']);
  assert.equal(c.sections[0].items[0].score, 4);
});

console.log(`v110-paper-logic: ${n}/${n} PASS`);
