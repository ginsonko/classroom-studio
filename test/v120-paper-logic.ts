// 1.2.0 组卷修复：页脚 / 水印 / 带卷名的答案区、截图里的答案部分、导出时印文字还是印图、同分题不逐题标分
import assert from 'node:assert/strict';
import { answerTail, splitQuestions, textLines, type SrcLine } from '../src/lib/importLogic';
import { addToPaper, emptyPaper, paperMarkdown } from '../src/lib/paperLogic';
import { questionView, type Question } from '../src/lib/studyLogic';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const Q = (id: string, qtype: string, p: Partial<Question> = {}): Question => ({ id, stem: '题' + id, points: [], difficulty: 2, qtype, origin: 'manual', status: 'bank', createdAt: '2026-10-20T00:00:00Z', subject: 'math', answer: '答' + id, ...p });
const IMG = 'D:/x/study/img/0123abcd-0123-4567-89ab-0123456789ab.png';

ok('页脚「试卷第1页（共1页）」、水印、「《卷名》参考答案」：答案区不并进最后一题', () => {
  // 第 0 页：两道题 + 水印 + 页脚；第 1 页：答案页（带卷名的标题、题号答案表、逐题答案）
  const L = (t: string, page: number, y: number): SrcLine => ({ t, page, y, b: y + 0.02 });
  const r = splitQuestions([
    L('徐梓涵10.18作业-向量和圆', 0, 0.05),
    L('1．已知向量 a=(4,2)，b=(x,1)，且 a∥b，则 a·b=（ ）', 0, 0.12), L('A．10 B．8 C．6 D．4', 0, 0.16),
    L('www.zxxk.com', 0, 0.3),
    L('2．已知平面向量 a，b，c，对任意实数 x，y 都有 |a−xb|≥|a−b|，则 b·(c−a) 的最大值是____．', 0, 0.4),
    L('学科网（北京）股份有限公司', 0, 0.9), L('试卷第1页（共1页）', 0, 0.95),
    L('《徐梓涵10.18作业-向量和圆》参考答案', 1, 0.05), L('题号 1 2', 1, 0.1), L('答案 A', 1, 0.14),
    L('1．A', 1, 0.2), L('2．2+√3', 1, 0.25), L('答案第1页（共1页）', 1, 0.95),
  ]);
  assert.equal(r.pieces.length, 2, JSON.stringify(r.pieces.map((p) => p.stem)));
  assert.equal(r.title, '徐梓涵10.18作业-向量和圆');
  const last = r.pieces[1];
  assert.ok(!/参考答案|试卷第|zxxk|学科网/.test(r.pieces.map((p) => p.stem).join('')), '页脚、水印、答案标题不进题干');
  assert.deepEqual(last.segs.map((s) => s.page), [0], '最后一题只截第 0 页：' + JSON.stringify(last.segs));
  assert.ok(last.segs[0].y1 > 0.8 && last.segs[0].y1 < 0.95, '题目下面的配图留着、页脚不要：' + last.segs[0].y1);
  assert.equal(r.pieces[0].segs[0].top, 0.07, '往上留白不越过卷名那行');
  assert.deepEqual(r.pieces.map((p) => p.answer), ['A', '2+√3']);
});

ok('「填写答案」这类题干不会被当成答案区', () => {
  const r = splitQuestions(textLines(['1. 计算 2+3，在横线上填写答案', '2. 计算 4+5', '参考答案', '1. 5', '2. 9'].join('\n')));
  assert.equal(r.pieces.length, 2);
  assert.deepEqual(r.pieces.map((p) => p.answer), ['5', '9']);
  const r2 = splitQuestions(textLines(['1. 计算 2+3', '高一数学周测 答案与解析', '1. 5'].join('\n')));
  assert.equal(r2.pieces[0].answer, '5');
});

ok('截图里的【答案】【详解】：裁切位置 + 答案解析单独取出', () => {
  const t = answerTail([
    { t: '1．已知向量 a=(4,2)，b=(x,1)，且 a∥b，则 a·b=（ ）', page: 0, y: 0.05, b: 0.15 },
    { t: 'A．10 B．8 C．6 D．4', page: 0, y: 0.2, b: 0.3 },
    { t: '【答案】A', page: 0, y: 0.42, b: 0.5 },
    { t: '【详解】向量 a=(4,2)，b=(x,1)，且 a∥b，则 4×1−2x=0，得 x=2，', page: 0, y: 0.6, b: 0.7 },
    { t: '所以 a·b=4×2+2×1=10．', page: 0, y: 0.75, b: 0.85 },
  ]);
  assert.equal(t.cut, 0.42);
  assert.equal(t.answer, 'A');
  assert.ok(t.analysis.startsWith('向量') && t.analysis.includes('=10'), t.analysis);
  assert.equal(answerTail([{ t: '1. 计算 1+1', page: 0, y: 0, b: 0.5 }]).cut, undefined, '没有答案就不裁');
  // Windows OCR 把【答案】认成（答案〗
  const o = answerTail([{ t: '1．计算 1+1', page: 0, y: 0, b: 0.2 }, { t: '（答案〗2', page: 0, y: 0.5, b: 0.6 }, { t: '（详解〗直接相加', page: 0, y: 0.7, b: 0.8 }]);
  assert.deepEqual([o.cut, o.answer, o.analysis], [0.5, '2', '直接相加']);
});

ok('导出时印文字还是印图：截图题不重复印，涉及图表才印截图', () => {
  assert.equal(questionView(Q('a', '选择', { origin: 'import', image: IMG })), 'image');
  assert.equal(questionView(Q('b', '选择', { origin: 'paste', image: IMG, stem: '已知向量 $a=(4,2)$，求 $a\\cdot b$' })), 'text');
  assert.equal(questionView(Q('c', '选择', { origin: 'paste', image: IMG, stem: '如图，在三角形 ABC 中' })), 'image');
  assert.equal(questionView(Q('d', '选择', { origin: 'board', image: IMG, stem: '' })), 'image');
  assert.equal(questionView(Q('e', '选择', { origin: 'manual', image: IMG, stem: '看图回答' })), 'both');
  assert.equal(questionView(Q('f', '选择', { origin: 'paste', stem: '没有图' })), 'text');
});

ok('学生版：粘贴截图题只印文字；同分大题不逐题标分；不同分照旧标分', () => {
  const qs = [
    Q('p', '选择', { origin: 'paste', image: IMG, stem: '已知向量 $a=(4,2)$，$b=(x,1)$，且 $a\\parallel b$，则 $a\\cdot b=$（　）\nA. 10\nB. 8' }),
    Q('i', '选择', { origin: 'import', image: IMG, imagePt: 420, stem: '乱码题干' }),
    Q('f', '填空', { origin: 'import', image: IMG, imagePt: 400 }),
  ];
  let p = emptyPaper('math');
  for (const q of qs) p = addToPaper(p, q, ['选择', '填空', '解答']);
  const md = paperMarkdown(p, qs, 'student');
  assert.ok(md.includes('## 一、选择题（共 2 题，每题 4 分，共 8 分）'), md);
  assert.ok(md.includes('**1.** 已知向量 $a=(4,2)$') && !md.includes('**1.** （4 分）'), md);
  assert.equal((md.match(/!\[题图/g) || []).length, 2, '粘贴题不再附截图：' + md);
  assert.ok(md.includes('**2.**\n\n![题图 w=420]'), md);
  assert.ok(md.includes('**3.** （5 分）\n\n![题图 w=400]'), '只有一题的大题照旧标分：' + md);
  assert.ok(!md.includes('乱码题干'));
});

console.log(`v120-paper-logic: ${n}/${n} PASS`);
