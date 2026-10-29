// 1.5.0 纯逻辑：学习地图自动更新、下课分析录像（挑帧、提示词、解析回复、地图计划）、黑板不被上限关掉。
// 用法：npx tsx test/v150-logic.ts
import assert from 'node:assert/strict';
import { applyMap, fullGrid, planMap, undoMap } from '../src/lib/mapLogic';
import { analysisPrompt, BATCH, lessonMapPlan, MAX_FRAMES, mergeReplies, parseAnalysis, pickFrames, timelineText } from '../src/lib/recordAnalysisLogic';
import { pointsOf, type Mastery } from '../src/lib/studyLogic';
import { packOf } from '../src/lib/subjects';
import { latestBoard, trimDesk } from '../src/lib/desk';
import type { Chapter } from '../src/lib/timeline';
import type { DeskWin, Material } from '../src/lib/types';

let n = 0;
const T = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const pack = packOf('physics'), keys = pointsOf('physics').map((p) => p.key);
const m = (key: string, score: number, cnt: number): Mastery => ({ key, score, n: cnt, right: 0, wrong: 0, half: 0, last: '' });
const at = (k: string) => { const [ci, si] = k.replace(/^[a-z]+/, '').split('.').map(Number); return { ci, si }; };

T('planMap：只自动往前推，标薄弱 / 改掉薄弱只给建议；keys 限定这节课练到的', () => {
  const [a, b, c, d] = keys;
  const grid = fullGrid(pack);
  grid[at(c).ci][at(c).si] = 'weak'; grid[at(d).ci][at(d).si] = 'done';
  const ms = new Map([[a, m(a, 0.9, 3)], [b, m(b, 0.3, 2)], [c, m(c, 0.95, 4)], [d, m(d, 0.6, 1)]]);
  const plan = planMap(pack, grid, ms);
  assert.deepEqual(plan.apply.map((x) => [x.key, x.from, x.to]), [[a, 'none', 'done']]);
  assert.deepEqual(plan.suggest.map((x) => [x.key, x.to]).sort(), [[b, 'weak'], [c, 'done']].sort());
  assert.ok(!plan.apply.some((x) => x.key === d), '已掌握不往回退成在学');
  assert.equal(planMap(pack, grid, ms, new Set([b])).apply.length, 0);
});

T('applyMap / undoMap：撤销时老师之后手动改过的格子不动', () => {
  const [a, b] = keys;
  const grid = fullGrid(pack), ch = [{ key: a, ...at(a), from: 'none' as const, to: 'learning' as const }, { key: b, ...at(b), from: 'none' as const, to: 'done' as const }];
  const next = applyMap(grid, ch);
  assert.equal(next[at(a).ci][at(a).si], 'learning'); assert.equal(grid[at(a).ci][at(a).si], 'none', '不改原表');
  next[at(b).ci][at(b).si] = 'weak';
  const u = undoMap(next, ch);
  assert.equal(u.restored, 1); assert.equal(u.grid[at(a).ci][at(a).si], 'none'); assert.equal(u.grid[at(b).ci][at(b).si], 'weak');
});

T('pickFrames：作答 / 收题那一刻、每段课件结束前，隔开 20 秒，不超过上限', () => {
  const ch: Chapter[] = [
    { t: 0, kind: 'material', title: '课件 A' }, { t: 100, kind: 'page', title: 'A 第 2 页' }, { t: 130, kind: 'attempt', title: '张三 错：…' },
    { t: 135, kind: 'attempt', title: '张三 对：…' }, { t: 400, kind: 'board', title: '黑板' }, { t: 900, kind: 'question', title: '收题：…' },
  ];
  const t = pickFrames(ch, 1800);
  assert.ok(t.length <= MAX_FRAMES && t.length >= 6, String(t));
  assert.deepEqual([...t].sort((x, y) => x - y), t, '按时间排');
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 20, '至少隔 20 秒：' + t);
  assert.ok(t.includes(129) && t.includes(899), '记作答、收题前 1 秒');
  assert.ok(t.includes(98), '翻页前 2 秒（这一页写满了）');
  assert.ok(t.every((x) => x >= 0 && x <= 1799));
  assert.deepEqual(pickFrames([], 0), []);
  const bare = pickFrames([], 600);
  assert.equal(bare.length, MAX_FRAMES, '没时间线就均匀截');
  assert.equal(pickFrames(ch, 1800, 4).length, 4);
  const short = pickFrames([], 150);
  assert.ok(short.length > 0 && short.every((x) => x < 150));
});

T('analysisPrompt / timelineText：带学生、课题、截图时间、时间线和知识点清单', () => {
  const ch: Chapter[] = [{ t: 65, kind: 'material', title: '电磁感应' }, { t: 130, kind: 'attempt', title: '张三 错' }];
  assert.equal(timelineText(ch), '1:05 打开课件 电磁感应\n2:10 记作答 张三 错');
  const p = analysisPrompt({ subject: 'physics', student: '张三', title: '电磁感应', chapters: ch, times: [65, 610] });
  assert.ok(p.includes('学生：张三') && p.includes('课题：电磁感应') && p.includes('1:05、10:10') && p.includes('2 张截图'));
  assert.ok(p.includes(keys[0]) && p.includes('"weak"'));
  assert.ok(!analysisPrompt({ subject: 'physics', student: 'x', title: 'y', chapters: [], times: [1] }).includes('课堂时间线'));
});

T('parseAnalysis：题干太短、框不对、result 乱写都收拾好；序号换成全局的', () => {
  const r = parseAnalysis({
    frames: [
      { i: 1, what: '讲楞次定律', points: [keys[0], 7], questions: [
        { stem: '如图所示，闭合线圈从磁铁上方落下，判断感应电流方向', box: [100, 200, 900, 1200], answer: '逆时针', result: 'wrong', points: [keys[1]] },
        { stem: '短', box: [0, 0, 10, 10] },
        { stem: '一个物体从静止开始做匀加速直线运动，求第 3 秒内的位移', box: [500, 500, 100, 900], result: 'maybe' },
      ] },
      { i: 9, what: '黑板', questions: 'oops' },
      'bad',
    ],
    summary: ' 讲了电磁感应 ', weak: [keys[1], '', null],
  }, 2, 6);
  assert.equal(r.frames.length, 2, '只取这一批的张数');
  assert.equal(r.frames[0].i, 7); assert.equal(r.frames[1].i, 7, 'i 越界按位置算');
  const [q1, q2] = r.frames[0].questions;
  assert.equal(r.frames[0].questions.length, 2, '太短的题干丢掉');
  assert.deepEqual(q1.box, [100, 200, 900, 1000]); assert.equal(q1.result, 'wrong'); assert.equal(q1.answer, '逆时针');
  assert.equal(q2.box, null, 'x1 < x0 的框不要'); assert.equal(q2.result, null);
  assert.deepEqual(r.frames[0].points, [keys[0], '7']);
  assert.deepEqual(r.frames[1].questions, []);
  assert.equal(r.summary, '讲了电磁感应'); assert.deepEqual(r.weak, [keys[1]]);
  assert.deepEqual(parseAnalysis(null, 3), { frames: [], summary: '', weak: [] });
});

T('mergeReplies：几批合起来，只留这个学科的知识点', () => {
  const valid = new Set(keys);
  const a = parseAnalysis({ frames: [{ i: 0, points: [keys[0], 'zz'], questions: [{ stem: '这是一道足够长的题目题干文字', points: ['bad', keys[2]] }] }], summary: '前半节', weak: [keys[1], 'x'] }, BATCH, 0);
  const b = parseAnalysis({ frames: [{ i: 0, points: [keys[3]] }], summary: '', weak: [keys[1]] }, BATCH, BATCH);
  const r = mergeReplies([a, b], valid);
  assert.deepEqual(r.frames.map((f) => f.i), [0, BATCH]);
  assert.deepEqual(r.frames[0].points, [keys[0]]); assert.deepEqual(r.frames[0].questions[0].points, [keys[2]]);
  assert.equal(r.summary, '前半节'); assert.deepEqual(r.weak, [keys[1]]);
});

T('lessonMapPlan：做过题的按掌握度推，只讲到的「未学」→「在学」，别的不动', () => {
  const [a, b, c, d] = keys;
  const grid = fullGrid(pack);
  grid[at(c).ci][at(c).si] = 'done'; grid[at(d).ci][at(d).si] = 'weak';
  const plan = lessonMapPlan(pack, grid, new Map([[a, m(a, 1, 2)]]), new Set([a]), new Set([a, b, c, d, 'nonsense', 'm0.0']));
  assert.deepEqual(plan.apply.map((x) => [x.key, x.from, x.to]), [[a, 'none', 'done'], [b, 'none', 'learning']]);
  assert.deepEqual(plan.suggest, []);
});

T('trimDesk / latestBoard：超上限只关课件不关黑板；长 / 普通黑板各找最近那块', () => {
  const mat = (id: string, kind: Material['kind'], long = false) => ({ id, kind, title: id, pages: [], ...(long ? { long: true } : {}) }) as Material;
  const win = (id: string, kind: Material['kind'], t: number, long = false) => ({ id, mat: mat(id, kind, long), view: {} as DeskWin['view'], rect: [0, 0, 1, 1], mode: 'max', z: t, at: t }) as DeskWin;
  const desk = [win('board', 'board', 1), win('long1', 'board', 2, true), win('long2', 'board', 9, true), win('p1', 'pdf', 3), win('p2', 'pdf', 4), win('p3', 'pdf', 5)];
  assert.deepEqual(trimDesk(desk, 'p1', 2).map((w) => w.id), ['board', 'long1', 'long2', 'p1', 'p3'], '最久没用、又不是当前的 p2 关掉');
  assert.equal(trimDesk(desk, 'p1', 0), desk, '0 不限');
  assert.equal(trimDesk(desk, 'p1', 3), desk);
  assert.equal(latestBoard(desk, true)?.id, 'long2'); assert.equal(latestBoard(desk, false)?.id, 'board');
  assert.equal(latestBoard(desk.filter((w) => !w.mat.long), true), undefined);
});

console.log(`PASS v150-logic ${n}/${n}`);
