// 1.3.0 纯逻辑：照片拆题的框、照片判定、贴图旋转 / 翻转
import assert from 'node:assert/strict';
import { flattenPaper, isPhoto, photoRegions, photoTurn } from '../src/lib/importLogic';
import { canRotate, flipImage, imageCorners, rotateStroke, strokeBounds, turnImage } from '../src/ink/geometry';
import { placeImage } from '../src/ink/placeImage';
import { sliceLong } from '../src/ink/sliceLong';
import { createRequire } from 'node:module';
import { applyPreset, parsePrefs, shownTool, toggleTool, visibleGroups, type ToolbarPrefs } from '../src/ui/toolbarPrefs';
import type { Tool } from '../src/lib/types';
import type { Stroke } from '../src/lib/types';
import {
  actionText, actionsOf, defaultTake, estimateTokens, findStudentIn, inputKindOf, joinMarks, markCount, matchStudent, parentByRules, parseImageReply, parseTextReply,
  subjectByName, textByRules, type Analysis,
} from '../src/lib/sortLogic';
import { MANUAL } from '../src/help/manual';
import { looseJSON } from '../src/lib/studyLogic';
import { keepAttr, protectMath, restoreMath } from '../src/office/mdView';
import { GUIDE_STUDENT, STEPS, nextChapter, nextOpen, normAngle, pickCorner, placeCard, stepsOf, summary, type GuideBase, type GuideCtx } from '../src/guide/steps';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

ok('照片判定：大 JPEG 是照片，PNG 截图、小图不是', () => {
  assert.equal(isPhoto('jpg', 4032, 3024), true);
  assert.equal(isPhoto('JPEG', 1600, 1200), true);
  assert.equal(isPhoto('png', 4032, 3024), false);
  assert.equal(isPhoto('jpg', 900, 700), false);
});

ok('AI 框题：0~1000 坐标、放宽四周、按题号排序去重', () => {
  const r = photoRegions({ questions: [
    { n: 2, boxes: [[50, 400, 950, 700]] },
    { n: 1, boxes: [[50, 100, 950, 380]] },
    { n: 1, boxes: [[0, 0, 1000, 50]] },
  ] });
  assert.deepEqual(r.map((x) => x.n), [1, 2]);
  near(r[0].segs[0].y0, 0.1 - 0.015); near(r[0].segs[0].y1, 0.38 + 0.018);
  near(r[0].segs[0].x0!, 0.05 - 0.012); near(r[0].segs[0].x1!, 0.95 + 0.012);
});

ok('AI 框题：0~1 比例、像素坐标、跨栏两个框、整页宽不带 x', () => {
  const ratio = photoRegions({ questions: [{ n: 3, box: [0, 0.2, 1, 0.5] }] });
  assert.equal(ratio.length, 1);
  assert.equal(ratio[0].segs[0].x0, undefined, '整页宽不截栏');
  near(ratio[0].segs[0].y0, 0.185);
  const px = photoRegions({ questions: [{ n: 1, box: [80, 200, 760, 1400] }] }, 1600, 2000);
  near(px[0].segs[0].x0!, 0.05 - 0.012); near(px[0].segs[0].y1, 0.7 + 0.018);
  const two = photoRegions({ questions: [{ n: 5, boxes: [[20, 700, 480, 980], [520, 30, 980, 300]] }] });
  assert.equal(two[0].segs.length, 2);
  assert.ok(two[0].segs[1].x0! > 0.5);
});

ok('AI 框题：乱写的框丢掉，没有题号按顺序编号，空结果', () => {
  const r = photoRegions({ questions: [
    { box: [100, 100, 900, 300] }, { box: [100, 300, 102, 600] }, { box: 'x' }, { boxes: [[1, 2, 3]] }, { box: [100, 400, 900, 400.5] },
    { box: [100, 500, 900, 800] },
  ] });
  assert.deepEqual(r.map((x) => x.n), [1, 6]);
  assert.deepEqual(photoRegions(null), []);
  assert.deepEqual(photoRegions({ questions: [] }), []);
  assert.deepEqual(photoRegions([{ n: 1, box: [0, 0, 500, 500] }]).length, 1, '直接给数组也认');
});

ok('AI 框题（真实回复）：小问拆开的并成一道、补上题干；另一栏同号的丢掉；题号写法', () => {
  // 实拍照片：15(1)(2)(3) 拆成三道，题干没框进去，(3) 还单框了配图
  const sub = photoRegions({ questions: [
    { n: '15(1)', boxes: [[70, 321, 610, 418]] }, { n: '15(2)', boxes: [[65, 414, 625, 570]] },
    { n: '15(3)', boxes: [[60, 570, 970, 841], [620, 370, 895, 700]] },
  ] });
  assert.equal(sub.length, 1); assert.equal(sub[0].n, 15);
  assert.equal(sub[0].segs.length, 1, '同一栏的框并成一个');
  near(sub[0].segs[0].y0, 0, 1e-9); near(sub[0].segs[0].y1, 0.841 + 0.018);
  // 上面有别的题：只补到那道题的下沿
  const after = photoRegions({ questions: [{ n: 23, boxes: [[50, 0, 950, 300]] }, { n: '24（1）', boxes: [[50, 400, 950, 600]] }, { n: '24（2）', boxes: [[50, 600, 950, 800]] }] });
  assert.deepEqual(after.map((x) => x.n), [23, 24]);
  near(after[1].segs[0].y0, 0.3 + 0.018);
  // 实拍练习册：右栏是另一组题，模型也叫 6、7、8：留左栏的
  const dup = photoRegions({ questions: [{ n: 6, boxes: [[0, 320, 800, 575]] }, { n: 6, boxes: [[800, 0, 1000, 315]] }] });
  assert.equal(dup.length, 1); near(dup[0].segs[0].y0, 0.305);
  assert.deepEqual(photoRegions({ questions: [{ n: '第3题', box: [0, 0, 500, 500] }, { n: '12.', box: [0, 500, 500, 900] }] }).map((x) => x.n), [3, 12]);
  // 跨栏的两个框不并
  assert.equal(photoRegions({ questions: [{ n: '5(1)', boxes: [[20, 700, 480, 980]] }, { n: '5(2)', boxes: [[520, 30, 980, 300]] }] })[0].segs.length, 2);
});

ok('AI 整理：小问的批改合起来；照片转正的度数', () => {
  assert.equal(joinMarks(['right', 'right']), 'right');
  assert.equal(joinMarks(['right', 'wrong']), 'half');
  assert.equal(joinMarks(['wrong', 'none']), 'wrong');
  assert.equal(joinMarks(['right', 'unsure']), 'unsure');
  assert.equal(joinMarks(['none', 'none']), 'none');
  const p = parseImageReply({ kind: 'graded', questions: [{ n: '24(1)', boxes: [[0, 100, 1000, 300]], mark: 'right' }, { n: '24(2)', boxes: [[0, 300, 1000, 600]], mark: 'wrong' }, { n: 25, boxes: [[0, 620, 1000, 900]], mark: 'right' }, { n: 25, boxes: [[0, 0, 1000, 90]], mark: 'wrong' }] });
  assert.deepEqual(p.regions!.map((r) => r.n + r.mark), ['24half', '25right'], '另一栏同号的批改不算进来');
  // 真实回复：中转模型在正文前多吐一个对象 / 先给半份草稿
  const two = looseJSON('{"recipients":[{"channel":"commentary","message":"我会按 {双栏} 识别"}]}{"kind":"graded","up":"up","title":"第161页","questions":[]}') as { kind?: string };
  assert.equal(two?.kind, 'graded');
  const draft = looseJSON('{"questions":[{"n":24}],"text":""}{"kind":"exam","up":"left","title":"t","questions":[],"text":"","parent":{}}') as { up?: string };
  assert.equal(draft?.up, 'left');
  assert.equal(looseJSON('没有 JSON'), null);
  // 字头朝左 → 顺时针转 90；朝右 → 转 270
  assert.equal(photoTurn({ up: 'left' }), 90); assert.equal(photoTurn({ up: ' Right ' }), 270); assert.equal(photoTurn({ up: 'down' }), 180);
  assert.equal(photoTurn({ up: 'up' }), 0); assert.equal(photoTurn({ up: '斜' }), 0); assert.equal(photoTurn({}), 0); assert.equal(photoTurn(null), 0);
});

ok('照片纸张找平：一头亮一头暗的纸变成均匀白色，字仍是深色', () => {
  const w = 400, h = 300, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, paper = 235 - (x + y) * 0.2, ink = (y % 40 < 4 && x % 50 < 30) || (x > 300 && x < 304);
    const v = ink ? paper * 0.25 : paper;
    d[i] = v; d[i + 1] = v * 0.97; d[i + 2] = v * 0.9; d[i + 3] = 255;
  }
  flattenPaper(d, w, h);
  let paperMin = 255, inkMax = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, ink = (y % 40 < 4 && x % 50 < 30) || (x > 300 && x < 304), lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (ink) inkMax = Math.max(inkMax, lum); else paperMin = Math.min(paperMin, lum);
  }
  assert.ok(paperMin > 215, 'paper ' + paperMin);
  assert.ok(inkMax < 110, 'ink ' + inkMax);
});

const img = (rot?: number): Stroke => ({ id: 'a', tool: 'image', color: '#000', size: 1, pts: [0.2, 0.2, 0.5, 0.6, 0.4, 0.5], src: 'x', ...(rot ? { rot } : {}) } as Stroke);

ok('贴图可以旋转：中心不动、角度累加、外框按转后的四角算', () => {
  assert.equal(canRotate(img()), true);
  const r = turnImage(img(), 1);
  near(r.rot!, Math.PI / 2);
  const b0 = strokeBounds(img()), b = strokeBounds(r);
  near((b.x0 + b.x1) / 2, (b0.x0 + b0.x1) / 2); near((b.y0 + b.y1) / 2, (b0.y0 + b0.y1) / 2);
  near(b.x1 - b.x0, 0.2); near(b.y1 - b.y0, 0.4, 1e-6);
  const back = turnImage(r, -1);
  assert.equal(back.rot, 0);
  assert.deepEqual(back.pts.map((v) => +v.toFixed(9)), img().pts);
  const full = turnImage(turnImage(r, 1), 1);
  near(full.rot!, -Math.PI / 2, 1e-9);
});

ok('贴图绕别的点转：中心跟着转，本身尺寸不变', () => {
  const r = rotateStroke(img(), { x: 0, y: 0 }, Math.PI);
  near(r.rot!, Math.PI);
  near((r.pts[0] + r.pts[3]) / 2, -0.4); near((r.pts[1] + r.pts[4]) / 2, -0.3);
  near(r.pts[3] - r.pts[0], 0.4); near(r.pts[4] - r.pts[1], 0.2);
  assert.equal(imageCorners(r).length, 12);
});

ok('左右翻转：翻两次还原，带角度时角度取反', () => {
  const f = flipImage(img(0.3));
  assert.equal(f.flip, true); near(f.rot!, -0.3);
  const ff = flipImage(f);
  assert.equal(ff.flip, false); near(ff.rot!, 0.3);
  const line = { ...img(), tool: 'line' } as Stroke;
  assert.equal(flipImage(line), line, '不是贴图不动');
});

const boxOf = (p: number[]) => ({ x0: p[0], y0: p[1], x1: p[2], y1: p[3] });
const hit = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const asStroke = (p: number[], id: string): Stroke => ({ id, tool: 'image', color: 'ink', size: 1, pts: [p[0], p[1], .5, p[2], p[3], .5], img: 'x' } as Stroke);
const page = { fit: 'page' as const };

ok('连着贴两张图（题干图 + 题目图）：不叠在一起，都在黑板可见范围里', () => {
  const ratio = 9 / 16;
  const a = placeImage(1200 / 260, ratio, page, []);
  const b = placeImage(1200 / 500, ratio, page, [asStroke(a, 'a')]);
  assert.ok(!hit(boxOf(a), boxOf(b)), JSON.stringify({ a, b }));
  for (const p of [a, b]) assert.ok(p[0] >= 0 && p[2] <= 1 + 1e-9 && p[1] >= 0 && p[3] <= ratio + 1e-9, JSON.stringify(p));
  const c = placeImage(1, ratio, page, [asStroke(a, 'a'), asStroke(b, 'b')]);
  assert.ok(!hit(boxOf(c), boxOf(a)) && !hit(boxOf(c), boxOf(b)), '第三张也不叠: ' + JSON.stringify(c));
  assert.ok(c[2] - c[0] > 0.1, '缩小也不能小到看不清');
});

ok('第一张图位置不变；空白黑板上和以前一样居中', () => {
  const p = placeImage(2, 9 / 16, page, []);
  near((p[0] + p[2]) / 2, 0.5);
  const other = placeImage(2, 9 / 16, page, [{ ...asStroke([0, 0, .1, .1], 'x'), tool: 'pen' } as Stroke]);
  assert.deepEqual(other, p, '笔迹不影响放图');
});

ok('放大了某个区域（region）时，第二张图也放在这个区域里', () => {
  const view = { fit: 'region' as const, region: [0.5, 0.2, 0.5, 0.5] as [number, number, number, number] };
  const a = placeImage(1.6, 9 / 16, view, []);
  const b = placeImage(1.6, 9 / 16, view, [asStroke(a, 'a')]);
  assert.ok(!hit(boxOf(a), boxOf(b)));
  for (const p of [a, b]) assert.ok(p[0] >= 0.5 - 1e-9 && p[2] <= 1 + 1e-9 && p[1] >= 0.2 * 9 / 16 - 1e-9 && p[3] <= 0.7 * 9 / 16 + 1e-9, JSON.stringify(p));
});

ok('长黑板存 PDF：按纸高切，切口落在两行字之间的空白中间，页页相接', () => {
  const line = (y: number, id: string) => ({ id, tool: 'pen', color: 'ink', size: 3, pts: [0.1, y, .5, 0.9, y + 0.03, .5], author: 'teacher', layer: 'public' } as Stroke);
  const strokes = Array.from({ length: 30 }, (_, i) => line(0.05 + i * 0.15, 'l' + i));
  const total = 4.6, per = 1.4;
  const pages = sliceLong(strokes, total, per);
  assert.ok(pages.length >= 4, JSON.stringify(pages));
  let at = 0;
  pages.forEach(([top, h], i) => { near(top, at); assert.ok(h <= per + 1e-9 && (i === pages.length - 1 || h > per * .7), JSON.stringify(pages)); at = top + h; });
  near(at, total);
  for (const [top, h] of pages.slice(0, -1)) {
    const cut = top + h;
    const gaps = strokes.map((s) => [s.pts[1], s.pts[4]]);
    assert.ok(!gaps.some(([a, b]) => a - 0.01 < cut && b + 0.01 > cut), '切口不穿过字: ' + cut);
    const prev = Math.max(...gaps.filter(([, b]) => b < cut).map(([, b]) => b)), next = Math.min(...gaps.filter(([a]) => a > cut).map(([a]) => a));
    assert.ok(cut - prev > 0.02 && next - cut > 0.02, '上下都留了空: ' + JSON.stringify({ prev, cut, next }));
  }
  near(sliceLong([], 1, 1.4)[0][1], 1);
});

ok('PDF：几张 JPEG 拼成 A4，页数、尺寸、中文标题都对', () => {
  const req = createRequire(import.meta.url);
  const { jpegsToPdf, jpegInfo } = req('../electron/jpegPdf.cjs');
  const jpg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegInfo(jpg(1654, 2339)), { w: 1654, h: 2339, comps: 3 });
  assert.throws(() => jpegInfo(Buffer.from('not a jpeg')));
  const pdf: Buffer = jpegsToPdf([jpg(1654, 2339), jpg(1654, 2339), jpg(1654, 2339)], '课堂板书');
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && /\/Count 3 /.test(s) && (s.match(/\/Subtype \/Image/g) || []).length === 3);
  assert.ok(s.includes('/Title <FEFF8BFE5802677F4E66>'), '中文标题 UTF-16');
  // 交叉引用表里每个对象的偏移都指向「n 0 obj」
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  const rows = s.slice(xref).split('\n').slice(3).filter((r) => / 00000 n $/.test(r));
  rows.forEach((r, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, Number(r.slice(0, 10))), 'xref ' + (i + 1)));
});

ok('工具栏：预设、单个显示 / 隐藏、必留工具、记住每组上次用的', () => {
  const base = parsePrefs(null);
  assert.equal(base.preset, 'full');
  const names = (p: ToolbarPrefs, tool: Tool = 'pen', physics = true) => visibleGroups(p, { physics, tool }).map((g) => shownTool(g, p, tool));
  assert.deepEqual(names(base), ['pointer', 'pen', 'eraser', 'line', 'rect', 'force', 'text', 'laser'], '线条组默认是直线');
  const simple = applyPreset(base, 'simple');
  const gs = visibleGroups(simple, { physics: true, tool: 'pen' });
  assert.ok(!gs.some((g) => g.id === 'physics'), '讲题常用：受力 / 坐标整组藏起来');
  assert.deepEqual(gs.find((g) => g.id === 'lines')!.tools, ['line', 'arrow']);
  // 快捷键选到藏起来的工具：照常显示出来
  assert.ok(visibleGroups(simple, { physics: true, tool: 'force' }).find((g) => g.id === 'physics')!.tools.includes('force'));
  const custom = toggleTool(simple, 'curtain');
  assert.equal(custom.preset, 'custom');
  assert.equal(toggleTool(custom, 'curtain').preset, 'simple', '改回去又认得是预设');
  assert.equal(toggleTool(base, 'pen'), base, '笔不能藏');
  const draw = applyPreset({ ...base, last: { lines: 'arrow', write: 'highlighter' } }, 'draw');
  assert.equal(draw.last.lines, 'line'); assert.equal(draw.last.write, 'highlighter');
  // 存档坏了 / 被改过：不认识的工具丢掉，必留的工具不能藏
  const p = parsePrefs(JSON.stringify({ preset: 'x', hidden: ['pen', 'lasso', 'nope'], last: { lines: 'dashed', write: 'line' } }));
  assert.deepEqual(p, { preset: 'custom', hidden: ['lasso'], last: { lines: 'dashed' } });
  assert.deepEqual(parsePrefs('{bad json'), base);
  assert.equal(names(p)[3], 'dashed', '上次用的虚线显示在线条组上');
  assert.ok(!names(base, 'pen', false).includes('force'), '非理科不显示「力」');
});

ok('AI 整理：认学生（全名、只写名、名单外）、认学科（同学段）', () => {
  const list = [{ id: 'a', name: '王荣浩' }, { id: 'b', name: '李雪' }, { id: 'c', name: '张子涵' }, { id: 'd', name: '刘子涵' }, { id: 'x', name: '王荣', archived: true }];
  assert.equal(findStudentIn('王荣浩月考.pdf', list), 'a');
  assert.equal(findStudentIn('荣浩妈妈：老师好', list), 'a', '只写名');
  assert.equal(findStudentIn('子涵这周请假', list), null, '两个子涵：不猜');
  assert.equal(findStudentIn('李雪', list), 'b');
  assert.deepEqual(matchStudent('荣浩', list, 'b'), { id: 'a' });
  const miss = matchStudent('陈晨', list, 'b');
  assert.equal(miss.id, 'b'); assert.match(miss.note!, /陈晨.*李雪/);
  assert.deepEqual(matchStudent('', list, 'b'), { id: 'b' });
  assert.equal(subjectByName('物理', 'j-math'), 'j-physics', '初中学生的物理卷子 → 初中物理');
  assert.equal(subjectByName('英语', 'physics'), 'english');
  assert.equal(subjectByName('', 'physics'), 'physics');
  assert.equal(subjectByName('火星文', 'math'), 'math');
});

ok('AI 整理：没有 AI 时按规则分题目 / 成绩 / 家长消息，找出调课和要求', () => {
  const qs = textByRules('1. 求下落高度。\n2. 求加速度。\n3. 求位移。');
  assert.equal(qs.kind, 'questions'); assert.equal(qs.questions!.length, 3);
  assert.equal(textByRules('期中成绩：数学 112 分，班级排名 8').kind, 'score');
  const chat = textByRules('荣浩妈妈：老师好！这周六的课能不能改到周日下午？孩子几何比较弱，希望多讲讲几何。谢谢');
  assert.equal(chat.kind, 'chat');
  assert.match(chat.parent!.reschedule, /周日下午/); assert.match(chat.parent!.requirement, /多讲讲几何/);
  assert.ok(!/改到/.test(chat.parent!.requirement), '调课的句子不算要求');
  assert.deepEqual(parentByRules('收到，谢谢老师').reschedule, '');
});

ok('AI 整理：解析模型回复（批改、聊天、写「无」、乱回）', () => {
  const g = parseImageReply({ kind: 'graded', student: '王荣浩', subject: '物理', title: '月考', questions: [
    { n: 2, boxes: [[40, 350, 960, 610]], mark: 'right' }, { n: 1, boxes: [[40, 70, 960, 320]], mark: 'wrong' }, { n: 3, boxes: [[40, 640, 960, 900]], mark: '??' }] });
  assert.equal(g.kind, 'graded'); assert.deepEqual(g.regions!.map((r) => [r.n, r.mark]), [[1, 'wrong'], [2, 'right'], [3, 'none']]);
  assert.equal(g.name, '王荣浩'); assert.equal(g.subjectName, '物理');
  // 说是批改过的，但一道都没批：当空白卷子
  assert.equal(parseImageReply({ kind: 'graded', questions: [{ n: 1, boxes: [[0, 0, 1000, 500]], mark: 'none' }] }).kind, 'exam');
  const c = parseImageReply({ kind: 'chat', text: '妈妈：下周停课一次', parent: { summary: '停课', reschedule: '无', requirement: 'none' } });
  assert.equal(c.kind, 'chat'); assert.deepEqual(c.parent, { summary: '停课', reschedule: '', requirement: '' });
  const c2 = parseImageReply({ kind: 'chat', text: '妈妈：下周停课一次' });
  assert.match(c2.parent!.reschedule, /停课/, '模型没给 parent 时按规则补');
  assert.equal(parseImageReply('乱回的').kind, 'note');
  const t = parseTextReply({ kind: 'questions', questions: [] }, '1. 甲\n2. 乙');
  assert.equal(t.kind, 'questions'); assert.equal(t.questions!.length, 2, '模型没拆出来：按规则拆');
  assert.equal(parseTextReply(null, '随便').kind, 'chat');
});

ok('AI 整理：整理单的条目、默认全勾、文案', () => {
  const g = parseImageReply({ kind: 'graded', questions: [{ n: 1, boxes: [[0, 0, 1000, 300]], mark: 'wrong' }, { n: 2, boxes: [[0, 300, 1000, 600]], mark: 'unsure' }] });
  const a = { itemId: 'i', via: 'ai', studentId: 'a', subject: 'physics', ...g, take: {} } as Analysis;
  assert.deepEqual(actionsOf(a), ['questions', 'attempts']);
  assert.deepEqual(defaultTake(a), { questions: true, attempts: true });
  assert.deepEqual(markCount(a.regions), { right: 0, wrong: 1, half: 0, unsure: 1, none: 0 });
  assert.match(actionText(a, 'attempts', '王荣浩'), /王荣浩的学情：错 1 · 半对 0 · 对 0；1 道没认准/);
  const exam = { ...a, kind: 'exam' as const, regions: a.regions!.map((r) => ({ ...r, mark: 'none' as const })) };
  assert.deepEqual(actionsOf(exam), ['questions'], '空白卷子不记作答');
  const chat = { itemId: 'j', via: 'ai', studentId: 'a', subject: 'physics', name: '', title: '', kind: 'chat', text: 'x', parent: { summary: 's', reschedule: '周三改周四', requirement: '多练' }, take: {} } as Analysis;
  assert.deepEqual(actionsOf(chat), ['parent', 'requirement', 'reschedule']);
  assert.match(actionText(chat, 'reschedule', '王荣浩'), /课表不会自动改/);
  assert.deepEqual(actionsOf({ kind: 'photo' }), ['questions']);
  assert.match(actionText({ ...a, kind: 'photo', regions: undefined }, 'questions', ''), /没配 AI/);
});

ok('AI 整理：认文件类型、花费估算', () => {
  assert.equal(inputKindOf('a/卷子.JPG'), 'image'); assert.equal(inputKindOf('b.pdf'), 'doc'); assert.equal(inputKindOf('c.docx'), 'doc'); assert.equal(inputKindOf('d.exe'), null);
  const e = estimateTokens([{ id: '1', kind: 'image', name: 'p' }, { id: '2', kind: 'text', name: 't', text: '你好'.repeat(100) }]);
  assert.equal(e.calls, 1 + 6 + 1);
  assert.ok(e.vision.input > 20000 && e.text.input === 900);
});

const base: GuideBase = { strokes: {}, texts: {}, pgmId: 'base', lessons: 0, homework: 0, preset: 'all', skin: 'night' };
const ctx = (o: Partial<GuideCtx> = {}): GuideCtx => ({
  since: 1000, studentId: 'free', skin: 'night', preset: 'all', pvw: false, pgmId: 'base', pgmKind: 'board', pgmLong: false,
  boards: {}, screen: 0.5625, photoId: '', hits: [], ai: false, dock: false, lessons: 0, homework: 0, sorts: [], plugins: [], base, ...o,
});
const st = (id: string, tool: Tool, pts: number[], x: Partial<Stroke> = {}) => ({ id, tool, color: '#fff', size: 3, pts, ...x }) as Stroke;
const step = (id: string) => STEPS.find((s) => s.id === id)!;

ok('上课彩排：两条路线、每步都有手册章节和判断方式', () => {
  assert.deepEqual(stepsOf('quick').map((s) => s.id), ['ai', 'student', 'open', 'take', 'share', 'pen', 'save']);
  assert.equal(stepsOf('full').length, STEPS.length);
  for (const s of STEPS) {
    assert.ok(s.help && s.scene && s.tip && s.todo({ subject: 'physics', family: 'physics', ai: false, canDemo: true }), s.id);
    assert.ok(!!s.done !== !!s.ack, s.id + '：要么自动判断，要么老师确认');
  }
  for (const s of STEPS) assert.ok(MANUAL.some((c) => c.id === s.help), s.id + ' → 手册章节 ' + s.help);
  assert.match(step('shape').todo({ subject: 'math-h', family: 'math', ai: true, canDemo: false }), /正棱台/);
  assert.match(step('ask').todo({ subject: 'x', family: 'x', ai: false, canDemo: false }), /先跳过/);
});

ok('上课彩排：课前几步看真实状态', () => {
  assert.equal(step('ai').done!(ctx({ ai: true }), {}), true);
  assert.equal(step('student').done!(ctx(), {}), false);
  assert.equal(step('student').done!(ctx({ studentId: GUIDE_STUDENT }), {}), true);
  assert.equal(step('open').done!(ctx({ pvw: true }), {}), true);
  assert.equal(step('open').done!(ctx({ pgmKind: 'pdf', pgmId: 'x' }), {}), true);
  assert.equal(step('take').done!(ctx({ pvw: true }), {}), false, '还在预监不算切给学生');
  assert.equal(step('take').done!(ctx({ pgmKind: 'pdf' }), {}), true);
});

ok('上课彩排：板书几步只认进入这一步之后的新笔迹', () => {
  const old = st('o', 'pen', [0, 0, 0.5]);
  const b = { ...base, strokes: { o: JSON.stringify(old.pts) } };
  assert.equal(step('pen').done!(ctx({ base: b, boards: { 'g#0': [old] } }), {}), false, '之前写的不算');
  assert.equal(step('pen').done!(ctx({ base: b, boards: { 'g#0': [old, st('n', 'pen', [0.1, 0.1, 0.5])] } }), {}), true);
  const lines = [st('l', 'line', [0, 0, 1, 1, 1, 1])];
  assert.equal(step('lines').done!(ctx({ boards: { 'g#0': lines } }), {}), false, '只画了直线');
  assert.equal(step('lines').done!(ctx({ boards: { 'g#0': [...lines, st('d', 'dashed', [0, 0, 1, 1, 1, 1])] } }), {}), true);
  // 双击改字：先记下原文，变了才算
  const mem: Record<string, string> = {};
  const t = (text: string) => ({ boards: { 'g#0': [st('t', 'text', [0.2, 0.2, 1], { text })] } });
  assert.equal(step('text').done!(ctx(t('牛顿第一定率')), mem), false);
  assert.equal(step('text').done!(ctx(t('牛顿第一定率')), mem), false);
  assert.equal(step('text').done!(ctx(t('牛顿第一定律')), mem), true);
  // 转正照片：转了 2π 也算正
  const photo = (rot: number) => ctx({ photoId: 'p', boards: { 'g#0': [st('p', 'image', [0, 0, 1, 0.5, 0.5, 1], { rot })] } });
  assert.equal(step('photo').done!(photo(Math.PI), {}), false);
  assert.equal(step('photo').done!(photo(Math.PI * 2), {}), true);
  assert.equal(step('shape').done!(ctx({ boards: { 'g#0': [st('s', 'obj', [0, 0, 1])] } }), {}), true);
  assert.equal(step('shape').done!(ctx({ boards: { 'g#0': [st('s', 'image', [0, 0, 1])] } }), {}), false, '普通图片不算绘图库');
  const moved = { ...base, strokes: { s: JSON.stringify([0, 0, 1]) } };
  assert.equal(step('move').done!(ctx({ base: moved, boards: { 'g#0': [st('s', 'obj', [0, 0, 1])] } }), {}), false);
  assert.equal(step('move').done!(ctx({ base: moved, boards: { 'g#0': [st('s', 'obj', [0.2, 0.1, 1])] } }), {}), true);
});

ok('上课彩排：长黑板、存 PDF、AI、整理、课后', () => {
  const long = (y: number) => ctx({ pgmLong: true, pgmId: 'L', boards: { 'L#0': [st('a', 'pen', [0.1, y, 0.5])] } });
  assert.equal(step('long').done!(long(0.3), {}), false, '第一屏里写的不算往下续写');
  assert.equal(step('long').done!(long(0.9), {}), true);
  assert.equal(step('save').done!(ctx({ hits: [{ name: 'board.save', at: 500 }] }), {}), false, '开始这一步之前存的不算');
  assert.equal(step('save').done!(ctx({ hits: [{ name: 'board.save', at: 1500 }] }), {}), true);
  assert.equal(step('ask').done!(ctx({ hits: [{ name: 'ai', at: 2000 }] }), {}), true);
  const iso = (t: number) => new Date(t).toISOString();
  assert.equal(step('sortIn').done!(ctx({ sorts: [{ id: 'r', at: iso(2000) }] }), {}), true);
  assert.equal(step('sortUndo').done!(ctx({ sorts: [{ id: 'r', at: iso(2000) }] }), {}), false);
  assert.equal(step('sortUndo').done!(ctx({ sorts: [{ id: 'r', at: iso(2000), undone: iso(3000) }] }), {}), true);
  assert.equal(step('lesson').done!(ctx({ lessons: 1 }), {}), true);
  assert.equal(step('paper').done!(ctx({ homework: 1 }), {}), true);
  assert.equal(step('plugin').done!(ctx({ plugins: [{ installedAt: 500, updatedAt: 0 }] }), {}), false);
  assert.equal(step('plugin').done!(ctx({ plugins: [{ installedAt: 500, updatedAt: 1200 }] }), {}), true);
  assert.equal(step('toolbar').done!(ctx({ preset: 'talk' }), {}), true);
  assert.equal(step('skin').done!(ctx({ skin: 'day' }), {}), true);
});

ok('上课彩排：完成清单、接着做、跳过这一章', () => {
  const s = summary('quick', { ai: 'skipped', student: 'done', open: 'done' });
  assert.equal(s.total, 7); assert.equal(s.done, 2);
  assert.deepEqual(s.chapters.map((c) => c.name), ['准备', '课前', '上屏', '板书', '长黑板']);
  assert.equal(nextOpen('quick', { ai: 'skipped', student: 'done' }), 0, '跳过的也要回头补');
  assert.equal(nextOpen('quick', { ai: 'done', student: 'done' }), 2);
  assert.equal(nextOpen('quick', Object.fromEntries(stepsOf('quick').map((x) => [x.id, 'done' as const]))), -1);
  const full = stepsOf('full'), pen = full.findIndex((x) => x.id === 'pen');
  assert.equal(full[nextChapter('full', pen)].id, 'long', '板书一章跳完到长黑板');
  assert.equal(nextChapter('full', full.length - 1), full.length);
  near(normAngle(-Math.PI / 2), -Math.PI / 2); near(normAngle(5 * Math.PI / 2), Math.PI / 2); near(normAngle(3 * Math.PI), Math.PI);
});

ok('上课彩排：引导卡换角，别挡住要点的按钮和 AI 抽屉', () => {
  const view = { w: 1440, h: 900 }, card = { w: 380, h: 300 }, m = { left: 76, top: 58, edge: 16 };
  assert.equal(pickCorner(view, card, [], m), 'br');
  const aiDock = { x: 1040, y: 48, w: 400, h: 852 };
  assert.equal(pickCorner(view, card, [aiDock], m), 'bl', 'AI 抽屉在右边就去左下');
  assert.equal(pickCorner(view, card, [aiDock], m, 'tl'), 'tl', '已经不挡了就不挪');
  // 居中的大对话框：四个角都挡一点，卡片收窄后放进右下角的空当
  const dialog = { x: 340, y: 100, w: 760, h: 700 }, btn = { x: 980, y: 760, w: 100, h: 30, weight: 20 };
  assert.deepEqual(placeCard(view, 300, [dialog, btn], m), { corner: 'br', slim: true });
  assert.deepEqual(placeCard(view, 300, [aiDock], m), { corner: 'bl', slim: false });
  // 要点的按钮权重大：宁可挡一点对话框，也不挡按钮
  assert.equal(pickCorner({ w: 1280, h: 800 }, { w: 300, h: 300 }, [{ x: 260, y: 60, w: 760, h: 700 }, { x: 900, y: 700, w: 110, h: 30, weight: 20 }], m), 'tr');
});

ok('Markdown 课件：公式先摘出来，代码里的 $ 和 \\$ 不算公式', () => {
  const src = ['价格 \\$5，行内 $a_1*b_2$ 和 \\(x^2\\)', '', '$$\\frac{a}{b}$$', '', '`$不是$`', '', '```', '$也不是$', '```'].join('\n');
  const { text, maths } = protectMath(src);
  assert.deepEqual(maths.map((m) => [m.tex, m.display]), [['\\frac{a}{b}', true], ['x^2', false], ['a_1*b_2', false]]);
  assert.ok(text.includes('\\$5') && text.includes('`$不是$`') && text.includes('$也不是$'));
  assert.ok(!text.includes('a_1'), '公式里的下划线不留给 Markdown');
  assert.ok(restoreMath(text, maths, (m) => `[${m.tex}]`).includes('[a_1*b_2]'));
  assert.equal(protectMath('只有一个 $ 符号').maths.length, 0);
});

ok('Markdown 课件：外来 HTML 只留排版属性', () => {
  assert.equal(keepAttr('IMG', 'src', 'data:image/png;base64,AA'), true);
  assert.equal(keepAttr('IMG', 'src', 'file:///C:/a.png'), false);
  assert.equal(keepAttr('IMG', 'onerror', 'alert(1)'), false);
  assert.equal(keepAttr('A', 'href', 'javascript:alert(1)'), false);
  assert.equal(keepAttr('A', 'href', 'https://example.com'), true);
  assert.equal(keepAttr('TD', 'colspan', '2'), true);
  assert.equal(keepAttr('DIV', 'style', 'position:fixed'), false);
  assert.equal(keepAttr('INPUT', 'type', 'text'), false);
});

console.log(`PASS ${n} v130-logic`);
