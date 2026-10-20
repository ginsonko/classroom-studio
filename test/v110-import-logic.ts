// 1.1.0 题库导入：按题号拆题、认答案、大题题型、截图区域
import assert from 'node:assert/strict';
import { ocrLines, ocrScale, ocrText, sectionType, splitQuestions, textLines } from '../src/lib/importLogic';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };

ok('纯文本卷子：标题、大题、选项、小数不当题号、答案区一行多个', () => {
  const r = splitQuestions(textLines([
    '高一物理 第三章 单元测试', '时间：40 分钟', '一、选择题（每题 4 分）',
    '1．下列说法正确的是（　）', 'A．速度大加速度一定大　B．加速度是矢量', 'C．1.5 m/s 的速度很小　D．都不对',
    '2、物体做匀加速直线运动，初速度为 2 m/s，', '加速度为 1.5 m/s²，求 3 s 末速度。', '二、计算题',
    '3. 一物体从静止开始下落，求 2 s 内的位移。', '（g 取 10 m/s²）', '第 1 页 共 2 页',
    '参考答案', '1.B 2.C', '3．20 m　解析：h = gt²/2 = 20 m',
  ].join('\n')));
  assert.equal(r.title, '高一物理 第三章 单元测试');
  assert.equal(r.pieces.length, 3);
  assert.deepEqual(r.pieces.map((p) => p.n), [1, 2, 3]);
  assert.ok(r.pieces[0].stem.includes('\nA．速度大') && r.pieces[0].stem.includes('C．1.5 m/s'), r.pieces[0].stem);
  assert.equal(r.pieces[0].section, '一、选择题（每题 4 分）');
  assert.equal(r.pieces[1].stem, '物体做匀加速直线运动，初速度为 2 m/s，加速度为 1.5 m/s²，求 3 s 末速度。');
  assert.equal(r.pieces[2].section, '二、计算题');
  assert.ok(!r.pieces[2].stem.includes('第 1 页'), '页脚去掉');
  assert.deepEqual(r.pieces.map((p) => p.answer), ['B', 'C', '20 m']);
  assert.equal(r.pieces[2].analysis, 'h = gt²/2 = 20 m');
  assert.equal(r.answers, 3);
});

ok('题内【答案】【解析】：截图到答案前为止', () => {
  const ls = [
    { t: '1. 计算 1+1。', page: 0, y: 0.1, b: 0.13 }, { t: '【答案】2', page: 0, y: 0.15, b: 0.18 }, { t: '【解析】直接相加。', page: 0, y: 0.19, b: 0.22 },
    { t: '2. 如图，求角 A。', page: 0, y: 0.3, b: 0.33 }, { t: '（配图）', page: 0, y: 0.35, b: 0.6 },
    { t: '3. 已知函数 f(x)=x²，', page: 0, y: 0.8, b: 0.83 }, { t: '求 f(2)。', page: 1, y: 0.05, b: 0.08 }, { t: '答案：4', page: 1, y: 0.1, b: 0.13 },
  ];
  const r = splitQuestions(ls);
  assert.equal(r.pieces.length, 3);
  assert.equal(r.pieces[0].answer, '2'); assert.equal(r.pieces[0].analysis, '直接相加。');
  assert.equal(r.pieces[0].stem, '计算 1+1。');
  // 截到下一行上沿再往上 0.3 行（避开下一题题号框）
  const near = (s: { page: number; y0: number; y1: number }[], want: [number, number, number][]) => assert.ok(s.length === want.length && s.every((x, i) => x.page === want[i][0] && Math.abs(x.y0 - want[i][1]) < 1e-9 && Math.abs(x.y1 - want[i][2]) < 1e-9), JSON.stringify(s));
  near(r.pieces[0].segs, [[0, 0.1, 0.141]]);
  near(r.pieces[1].segs, [[0, 0.3, 0.791]]);
  near(r.pieces[2].segs, [[0, 0.8, 0.83], [1, 0.05, 0.091]]);
  assert.equal(r.pieces[2].stem, '已知函数 f(x)=x²，求 f(2)。');
  assert.equal(r.pieces[2].answer, '4');
});

ok('各大题从 1 重新编号；题号、答案表格', () => {
  const r = splitQuestions(textLines(['一、选择题', '1. 甲', '2. 乙', '二、填空题', '1. 丙 ____', '2. 丁 ____', '答案', '题号 1 2', '答案 A B'].join('\n')));
  assert.deepEqual(r.pieces.map((p) => `${p.n}${p.stem.slice(0, 1)}`), ['1甲', '2乙', '1丙', '2丁']);
  assert.ok(r.pieces.every((p) => !p.answer), '题号重复时不用答案区（对不上是哪道）');
  const t = splitQuestions(textLines(['1. 甲', '2. 乙', '参考答案', '题号 1 2', '答案 A B'].join('\n')));
  assert.deepEqual(t.pieces.map((p) => p.answer), ['A', 'B']);
});

ok('题干里的小问编号不拆开', () => {
  const r = splitQuestions(textLines(['5. 如图所示，回答：', '1. 小球的速度；', '2. 小球的加速度。', '6. 下一题'].join('\n')));
  assert.deepEqual(r.pieces.map((p) => p.n), [5, 6]);
  assert.ok(r.pieces[0].stem.includes('小球的加速度'));
});

ok('大题题型、OCR 行高', () => {
  const qt = ['选择', '填空', '计算', '实验', '其他'];
  assert.equal(sectionType('一、单项选择题（每题 3 分）', qt), '选择');
  assert.equal(sectionType('三、解答题', qt), '计算');
  assert.equal(sectionType('四、阅读理解', qt), '');
  const ls = ocrLines([{ lines: [{ t: '1. 计 算', y: 0.1 }, { t: '2. 求 解', y: 0.15 }, { t: '3. 末题', y: 0.2 }] }]);
  assert.equal(ls[0].t, '1.计算');
  assert.equal(ocrText('3 ， 小明有 1 2 个苹果 ， 每人几个 ？'), '3. 小明有12个苹果，每人几个？');
  assert.equal(ocrText('速度 v = 2 m/s'), '速度v = 2 m/s');
  assert.ok(ls[0].b <= 0.15 && ls[0].b > 0.1 && ls[2].b > 0.2);
});

ok('OCR 题号位置（截图涂掉原题号）、照片按行高折算原大小', () => {
  const ls = ocrLines([{ lines: [
    { t: '2 ， 一 个 正 方 形', y: 0.1, b: 0.14, ws: [['2', 0.05], ['，', 0.08], ['一', 0.12], ['个', 0.16]] },
    { t: '边 长 6 厘 米', y: 0.2, b: 0.24, ws: [['边', 0.05], ['长', 0.09]] },
    { t: '3. 末题', y: 0.3, b: 0.34, ws: [['3.末题', 0.05]] },
  ] }]);
  assert.equal(ls[0].nx, 0.12, '题号「2，」后面第一个字');
  assert.equal(ls[1].nx, undefined, '不是题号行');
  assert.equal(ls[2].nx, undefined, '题号和正文粘成一个词时不涂');
  assert.ok(Math.abs(ls[0].b - 0.146) < 1e-9, '用真实下沿（多留一点）');
  const { pieces } = splitQuestions(ls);
  assert.equal(pieces[0].segs[0].nx, 0.12);
  assert.ok(pieces[0].segs[0].nb! > ls[0].b);
  assert.ok(Math.abs(ocrScale(ls, 1000)! - 46 / 9.5) < 0.01, '文字框 46px ≈ 10.5pt 正文');
});

console.log(`v110-import-logic: ${n}/${n} PASS`);
