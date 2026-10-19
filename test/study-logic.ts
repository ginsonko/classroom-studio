// 学情闭环纯逻辑验收：npx rolldown test/study-logic.ts -o .out/study-logic.mjs -p node && node .out/study-logic.mjs
import assert from 'node:assert/strict';
import {
  answersMatch, emptyStudy, findDuplicate, guessDifficulty, guessPoints, guessType, homeworkMarkdown, imgRef, lessonByRules, lessonMarkdown,
  looseJSON, mastery, normStem, outlineByRules, plainTex, outlineMarkdown, parseOutline, pickHomework, parentMessage, pointLabel, POINTS, profile, similarity, suggestState, validPoints, wrongBook,
  type Attempt, type Question, type StudyData,
} from '../src/lib/studyLogic';
import { parseMarkdown, splitSlides } from '../src/export/markdown';
import { EDGES, NEXT, PREREQ, ancestors, descendants, nodeInfo, rootText, traceBack, weakRoots } from '../src/lib/knowledgeNet';
import { CHAPTERS } from '../src/lib/mock';
import { lessonIn, pointsOf, pointList, portraitKey, questionSubject, qtypesOf } from '../src/lib/studyLogic';
import { SUBJECTS, familyOf, hasDemo, kitOf, levelOfGrade, localOf, mapKey, packOf, pointKey, subjectOfKey, studentSubject } from '../src/lib/subjects';
import { validatePack } from '../src/lib/subjects/validate';
import type { ChapterState } from '../src/lib/types';
const CHAPTERS_STATE = (): ChapterState[][] => CHAPTERS.map((c) => c.sec.map(() => 'none' as ChapterState));

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10)).toISOString();
let seq = 0;
const Q = (p: Partial<Question>): Question => ({ id: 'q' + ++seq, stem: '', points: [], difficulty: 3, qtype: '计算', origin: 'manual', status: 'bank', createdAt: day(1), ...p });
const A = (questionId: string, result: Attempt['result'], d: number, studentId = 's1'): Attempt => ({ id: 'a' + ++seq, studentId, questionId, result, at: day(d) });

ok('规则打标签：题眼命中对应知识点', () => {
  assert.ok(guessPoints('水平传送带以 v=2 m/s 匀速运行，物块轻放在左端，动摩擦因数 0.2').includes('3.3'));
  assert.ok(guessPoints('质子以速度 v 垂直进入磁感应强度为 B 的匀强磁场，求轨迹半径').some((k) => k.startsWith('16.')));
  assert.ok(guessPoints('从 20 m 高处水平抛出一个小球').includes('4.2'));
  assert.ok(guessPoints('两车追及相遇问题').includes('1.3'));
  assert.deepEqual(guessPoints(''), []);
  assert.equal(pointLabel('16.1'), '安培力与洛伦兹力 · 洛伦兹力');
  assert.deepEqual(validPoints(['16.1', 'x', '99.9', '16.1']), ['16.1']);
});

ok('难度和题型粗估', () => {
  assert.ok(guessDifficulty('下列说法正确的是') <= 2);
  assert.ok(guessDifficulty('（1）求加速度；（2）求时间；（3）若恰好不滑出，求木板最小长度。' + '已知'.repeat(70)) >= 4);
  assert.equal(guessType('下列说法正确的是 A. 速度 B. 加速度'), '选择');
  assert.equal(guessType('用游标卡尺测量小球直径'), '实验');
  assert.equal(guessType('求物块运动到右端的时间'), '计算');
});

ok('查重：同题换标点算重复，改了数据的变式题不算', () => {
  const base = '如图所示，质量为 2 kg 的物块放在倾角为 37° 的斜面上，物块与斜面间的动摩擦因数为 0.5，求物块下滑的加速度。';
  const same = '如图所示,质量为2kg的物块放在倾角为37°的斜面上,物块与斜面间的动摩擦因数为0.5,求物块下滑的加速度';
  const variant = '质量为 5 kg 的木箱在水平地面上受 30 N 拉力，拉力与水平方向成 37°，木箱与地面间的动摩擦因数为 0.3，求木箱的加速度。';
  assert.ok(similarity(base, same) > 0.95);
  assert.ok(similarity(base, variant) < 0.86);
  const pool = [Q({ stem: base })];
  assert.ok(findDuplicate(same, pool));
  assert.equal(findDuplicate(variant, pool), null);
  assert.equal(findDuplicate(same, pool, pool[0].id), null, '跳过自己');
  assert.equal(findDuplicate('短', pool), null);
});

ok('掌握度：最近的作答权重最大，两次以上且 ≥80% 才算掌握', () => {
  const q1 = Q({ points: ['3.1'] }), q2 = Q({ points: ['3.1', '3.3'] }), q3 = Q({ points: ['16.1'] });
  const d: StudyData = { ...emptyStudy(), questions: [q1, q2, q3], attempts: [A(q1.id, 'wrong', 1), A(q1.id, 'right', 2), A(q2.id, 'right', 3), A(q3.id, 'wrong', 3), A(q3.id, 'right', 1, 'other')] };
  const m = mastery('s1', d);
  const a = m.get('3.1')!;
  assert.equal(a.n, 3);
  // 权重 1, .75, .5625 → (1 + .75 + 0)/(2.3125)
  assert.ok(Math.abs(a.score - 1.75 / 2.3125) < 1e-9);
  assert.equal(suggestState(a), 'learning');
  assert.equal(suggestState(m.get('16.1')), 'weak');
  assert.equal(suggestState(m.get('3.3')), 'learning', '只做过一次不算掌握');
  assert.equal(suggestState(undefined), null);
  const two = mastery('s1', { ...d, attempts: [...d.attempts, A(q2.id, 'right', 4)] });
  assert.equal(suggestState(two.get('3.3')), 'done');
  assert.equal(mastery('other', d).get('16.1')!.score, 1, '按学生分开算');
});

ok('错题本：最近一次做对算已订正，从没错过的不进错题本', () => {
  const q1 = Q({ stem: '题一' }), q2 = Q({ stem: '题二' }), q3 = Q({ stem: '题三' });
  const d: StudyData = { ...emptyStudy(), questions: [q1, q2, q3], attempts: [A(q1.id, 'wrong', 1), A(q1.id, 'right', 5), A(q2.id, 'half', 2), A(q3.id, 'right', 2)] };
  const wb = wrongBook('s1', d);
  assert.deepEqual(wb.map((w) => [w.q.id, w.status]), [[q2.id, 'open'], [q1.id, 'fixed']]);
  assert.equal(wb[1].wrongCount, 1);
  assert.equal(wb[1].history.length, 2);
});

ok('学生画像：正确率、待订正数、强弱点、近 6 周', () => {
  const now = Date.parse(day(20));
  const q1 = Q({ points: ['7.2'] }), q2 = Q({ points: ['12.2'] });
  const d: StudyData = { ...emptyStudy(), questions: [q1, q2], attempts: [A(q1.id, 'right', 18), A(q1.id, 'right', 19), A(q2.id, 'wrong', 19)] };
  const p = profile('s1', d, now);
  assert.equal(p.attempts, 3);
  assert.ok(Math.abs(p.accuracy! - 2 / 3) < 1e-9);
  assert.equal(p.open, 1);
  assert.deepEqual(p.weak.map((m) => m.key), ['12.2']);
  assert.deepEqual(p.strong.map((m) => m.key), ['7.2']);
  assert.equal(p.weeks.length, 6);
  assert.equal(p.weeks[5].n, 3);
  assert.equal(profile('nobody', d, now).accuracy, null);
});

ok('组作业：错题重做优先、排除做对过/近期做过/待核对、相似题只留一道、按难度排', () => {
  const now = Date.parse(day(20));
  const wrong = Q({ stem: '错过的题：斜面上物块受力分析，求支持力大小', points: ['2.4'], difficulty: 4 });
  const solved = Q({ stem: '做对过的题：传送带上物块运动时间计算问题', points: ['3.3'], difficulty: 2 });
  const recent = Q({ stem: '最近练过：木板物块相对滑动的临界加速度', points: ['3.3'], difficulty: 3 });
  const a1 = Q({ stem: '水平传送带长 6 m 以 4 m/s 运行，物块轻放左端，μ=0.2，求到达右端的时间', points: ['3.3'], difficulty: 3 });
  const a1dup = Q({ stem: '水平传送带长6m以4m/s运行,物块轻放左端,μ=0.2,求到达右端的时间', points: ['3.3'], difficulty: 3 });
  const a2 = Q({ stem: '电梯以 2 m/s² 加速上升，质量 50 kg 的人对地板压力多大', points: ['3.4'], difficulty: 1 });
  const hard = Q({ stem: '压轴：多过程传送带与弹簧组合问题', points: ['3.3'], difficulty: 5 });
  const bad = Q({ stem: 'AI 原创但自检没通过的题目，数据可能矛盾', points: ['3.3'], difficulty: 2, check: 'mismatch' });
  const inbox = Q({ stem: '收件箱里还没整理的题目内容', points: ['3.3'], difficulty: 2, status: 'inbox' });
  const d: StudyData = { ...emptyStudy(), questions: [wrong, solved, recent, a1, a1dup, a2, hard, bad, inbox], attempts: [A(wrong.id, 'wrong', 10), A(solved.id, 'right', 1), A(recent.id, 'wrong', 18), A(recent.id, 'wrong', 19)] };
  const r = pickHomework({ studentId: 's1', points: ['3.3', '3.4'], count: 5, minD: 1, maxD: 4, redo: 1, avoidDays: 7, now }, d);
  const ids = r.picked.map((p) => p.q.id);
  assert.equal(ids[0], recent.id, '最近错的错题排第一（错题重做不受近期排除影响）');
  assert.ok(!ids.includes(wrong.id), '重做名额只有 1 个');
  assert.ok(!ids.includes(solved.id) && !ids.includes(bad.id) && !ids.includes(inbox.id) && !ids.includes(hard.id));
  assert.equal(ids.filter((id) => id === a1.id || id === a1dup.id).length, 1, '相似题只留一道');
  assert.ok(ids.includes(a2.id));
  const rest = r.picked.slice(1).map((p) => p.q.difficulty);
  assert.deepEqual(rest, [...rest].sort((x, y) => x - y));
  assert.equal(r.short, 5 - r.picked.length);
  // 没给知识点时用薄弱点
  const auto = pickHomework({ studentId: 's1', points: [], count: 3, minD: 1, maxD: 5, redo: 0, avoidDays: 0, now }, d);
  assert.ok(auto.points.includes('3.3') || auto.points.includes('2.4'));
});

ok('AI 自检答案比对：数值 2% 容差、选项字母、科学计数法', () => {
  assert.ok(answersMatch('t = 2.5 s', '2.5s'));
  assert.ok(answersMatch('约 3.0 m/s', '3 m/s'));
  assert.ok(answersMatch('1.6×10^-19 C', '1.6x10-19'));
  assert.ok(!answersMatch('2.5 s', '3.5 s'));
  assert.ok(answersMatch('B', '（B）'));
  assert.ok(answersMatch('答案：AC', 'CA'));
  assert.ok(!answersMatch('AB', 'A'));
  assert.ok(!answersMatch('', '1'));
  // 实测：\dfrac 和 \frac 写法不同、换行不同，答案相同
  assert.ok(answersMatch("(1) $f'(x)=-(x^2+1)e^{-x}$；\n(2) $f'(1)=-\\dfrac{2}{e}$。", "(1) $f'(x)=-(x^2+1)e^{-x}$；(2) $f'(1)=-\\frac{2}{e}$。"));
});

// 以下几项来自银子 API 实测（gpt-6.1-sol）暴露的问题
ok('实测回归：模型的 LaTeX 写法、四舍五入差别、两位有效数字', () => {
  assert.ok(answersMatch('$0.16\\,\\mathrm{m}$', '$0.157\\ \\mathrm{m}$'));
  assert.ok(answersMatch('$0.17\\,\\mathrm{T}$', '0.167 T'));
  assert.ok(answersMatch('（1）$r\\approx0.21\\ \\mathrm{m}$；（2）$T\\approx6.6\\times10^{-7}\\ \\mathrm{s}$', 'r=0.209 m，T=6.56×10^-7 s'));
  assert.ok(!answersMatch('2 s', '2.4 s'), '一位有效数字不放宽');
  assert.ok(!answersMatch('0.16 m', '0.18 m'));
  assert.ok(!answersMatch('$6.6\\times10^{-7}$ s', '6.6×10^-6 s'), '数量级不同');
});

ok('实测回归：LaTeX 题干和普通文字题干能查重、能搜索', () => {
  const tex = '质量 $m=2\\ \\mathrm{kg}$ 的物块从倾角 $\\theta=37^\\circ$ 的固定斜面顶端由静止下滑，动摩擦因数 $\\mu=0.5$，取 $g=10\\ \\mathrm{m/s^2}$，求加速度。';
  const plain = '质量 m=2 kg 的物块从倾角 θ=37° 的固定斜面顶端由静止下滑，动摩擦因数 μ=0.5，取 g=10 m/s²，求加速度。';
  assert.ok(similarity(tex, plain) >= 0.86, 'sim=' + similarity(tex, plain));
  assert.equal(plainTex('$1.67\\times10^{-27}\\,\\mathrm{kg}$'), '1.67×10^-27 kg');
  assert.equal(plainTex('$\\frac{mv}{qB}$'), '(mv)/(qB)');
  assert.ok(normStem(tex).includes('2kg'));
});

ok('实测回归：带电粒子在磁场里做圆周运动，主题是磁场不是圆周运动', () => {
  const g = guessPoints('带电粒子在匀强磁场中做匀速圆周运动，求半径');
  assert.ok(g[0].startsWith('16.'), g.join(','));
  assert.ok(guessPoints('小物块放在水平转盘上随转盘做圆周运动，求最大角速度')[0].startsWith('5.'));
  assert.ok(guessPoints('质量 2 kg 的物块沿倾角 37° 的粗糙斜面下滑，动摩擦因数 0.5，求加速度')[0] !== '0.3');
  const proton = guessPoints('一个质子（质量 $m=1.67\\times10^{-27}\\ \\mathrm{kg}$）以 $v=2.0\\times10^6\\ \\mathrm{m/s}$ 垂直射入 $B=0.10\\ \\mathrm{T}$ 的匀强磁场。求轨道半径和周期。');
  assert.ok(proton[0].startsWith('16.') && !proton.some((k) => k.startsWith('6.')), proton.join(','));
  assert.ok(guessPoints('人造卫星绕地球做匀速圆周运动，轨道半径为 r')[0].startsWith('6.'));
  assert.deepEqual(validPoints(['16.2 匀强磁场中的运动', '17.0：楞次定律', '16.20', 162]), ['16.2', '17.0']);
});

ok('实测回归：课件大纲里空的例题不输出', () => {
  const o = parseOutline({ title: 't', slides: [{ title: '目标', bullets: ['a'], example: { stem: '', answer: '' } }, { title: '例题', bullets: [], example: { stem: '求半径', answer: '0.21 m' } }] })!;
  assert.equal(o.slides[0].example, undefined);
  const md = outlineMarkdown(o);
  assert.equal((md.match(/例题：/g) ?? []).length, 1);
});

ok('课后总结规则版：基于作答，不编造', () => {
  const q1 = Q({ points: ['16.1'] }), q2 = Q({ points: ['16.2'] });
  const r = lessonByRules({ student: '俊宇', topic: '洛伦兹力', minutes: 60, attempts: [{ q: q1, a: A(q1.id, 'right', 1) }, { q: q2, a: A(q2.id, 'wrong', 1) }], notes: '画轨迹有进步', homework: '练习册 P12' });
  assert.match(r.summary, /练习 2 题，做对 1 题/);
  assert.match(r.summary, /画轨迹有进步/);
  assert.match(r.parent, /俊宇家长您好/);
  assert.match(r.parent, /练习册 P12/);
  assert.equal(r.problems.length, 1);
  const empty = lessonByRules({ student: '欣怡', topic: '', attempts: [], notes: '' });
  assert.equal(empty.strengths.length + empty.problems.length, 0);
  const md = lessonMarkdown({ id: 'l', studentId: 's1', date: '2026-10-18', at: day(18), topic: '洛伦兹力', ...r, via: 'rules' }, '俊宇');
  const p = parseMarkdown(md);
  assert.equal(p.title, '俊宇 · 课后反馈');
  assert.ok(p.blocks.some((b) => b.type === 'h' && b.level === 2));
});

ok('作业文档：题图引用、答案另起一页、未自检提醒', () => {
  const q1 = Q({ stem: '求加速度', answer: '2 m/s²', image: 'G:/D/study/img/0b5f0a3e-6d1c-4a9e-9a43-1d5b0f0e7c11.png' });
  const q2 = Q({ stem: 'AI 题', answer: '5 N', check: 'mismatch' });
  assert.equal(imgRef(q1.image), 'img:0b5f0a3e-6d1c-4a9e-9a43-1d5b0f0e7c11.png');
  assert.equal(imgRef('C:/x/a.png'), '');
  const md = homeworkMarkdown('测试作业', '俊宇', [q1, q2]);
  const p = parseMarkdown(md);
  const types = p.blocks.map((b) => b.type);
  assert.ok(types.includes('img'));
  const br = types.indexOf('break'), ans = p.blocks.findIndex((b) => b.type === 'h' && b.runs.some((r) => r.t === 'text' && r.text === '参考答案'));
  assert.ok(br > 0 && ans === br + 1, '答案前分页');
  assert.match(md, /没有通过自检/);
  assert.match(md, /^<!-- cs:theme=physics -->/);
  assert.ok(types.includes('gap'), '解答题后留作答空白');
  assert.equal(p.title, '测试作业', '配色注释不进正文');
  assert.ok(!splitSlides(p.blocks).flat().some((b) => b.type === 'break'), '幻灯片里不出现分页块');
});

ok('课件大纲：校验模型输出、规则框架、按页切分', () => {
  assert.equal(parseOutline({ title: 'x', slides: [] }), null);
  assert.equal(parseOutline(null), null);
  const o = parseOutline({ title: '洛伦兹力', slides: [{ title: '公式', bullets: ['方向用左手定则', 7], formulas: ['$F=qvB$'] }, { nope: 1 }] })!;
  assert.equal(o.slides.length, 1);
  assert.deepEqual(o.slides[0].bullets, ['方向用左手定则', '7']);
  const md = outlineMarkdown(o);
  assert.match(md, /\$\$F=qvB\$\$/);
  assert.equal(splitSlides(parseMarkdown(md).blocks).length, 2);
  const rules = outlineByRules('', ['16.1'], [Q({ stem: '例题甲', points: ['16.1'], difficulty: 2 }), Q({ stem: '别的', points: ['3.1'] })]);
  assert.equal(rules.title, '安培力与洛伦兹力 · 洛伦兹力');
  assert.equal(rules.slides.filter((s) => s.example).length, 1);
});

ok('宽松 JSON 解析', () => {
  assert.deepEqual(looseJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(looseJSON('好的：\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(looseJSON('结果 {"a":3} 完'), { a: 3 });
  assert.equal(looseJSON('没有'), null);
});

ok('知识网络：前置关系无环、引用的知识点都存在、规模合理', () => {
  const keys = new Set(POINTS.map((p) => p.key));
  for (const [f, t] of EDGES) { assert.ok(keys.has(f), '前置不存在 ' + f); assert.ok(keys.has(t), '目标不存在 ' + t); assert.notEqual(f, t); }
  // 拓扑排序：能排完就无环
  const indeg = new Map([...keys].map((k) => [k, 0])); for (const [, t] of EDGES) indeg.set(t, indeg.get(t)! + 1);
  const queue = [...keys].filter((k) => indeg.get(k) === 0); let seen = 0;
  while (queue.length) { const k = queue.shift()!; seen++; for (const t of NEXT.get(k) ?? []) { indeg.set(t, indeg.get(t)! - 1); if (indeg.get(t) === 0) queue.push(t); } }
  assert.equal(seen, keys.size, '有环');
  assert.ok(EDGES.length >= 130, '边太少：' + EDGES.length);
  // 理科：每章第一节以外的节都应该有前置。文科（语文、英语、历史、道法）很多节是并列专题，允许没有前置
  const LOOSE = ['chinese', 'english', 'history', 'politics'];
  const roots = [...keys].filter((k) => !PREREQ.has(k) && !LOOSE.includes(familyOf(subjectOfKey(k))));
  assert.ok(roots.every((k) => k.endsWith('.0')), '没有前置的非首节：' + roots.filter((k) => !k.endsWith('.0')).join(','));
  assert.ok(ancestors('16.2').has('3.1'), '磁场中的圆周运动应间接依赖牛顿第二定律');
  assert.ok(ancestors('17.1').has('11.1'));
  assert.ok(descendants('2.3').has('3.1'));
});

ok('知识网络：往前追溯薄弱前置，遇到已掌握就停', () => {
  const qs = [Q({ points: ['16.2'] }), Q({ points: ['5.1'] }), Q({ points: ['3.1'] }), Q({ points: ['16.1'] })];
  const d: StudyData = { ...emptyStudy(), questions: qs, attempts: [A(qs[0].id, 'wrong', 5), A(qs[1].id, 'wrong', 5), A(qs[2].id, 'half', 5), A(qs[2].id, 'right', 4), A(qs[3].id, 'right', 5), A(qs[3].id, 'right', 6)] };
  const info = nodeInfo('s1', d);
  assert.equal(info.get('16.2')!.level, 'weak');
  assert.equal(info.get('16.1')!.level, 'ok');
  assert.equal(info.get('3.1')!.level, 'shaky');
  const r = traceBack(['16.2'], info);
  assert.equal(r[0].key, '5.1'); assert.equal(r[0].level, 'weak'); assert.equal(r[0].dist, 1);
  assert.ok(r.some((x) => x.key === '3.1' && x.dist === 2));
  assert.ok(!r.some((x) => x.key === '16.0'), '16.1 已掌握，不应再越过它往回找');
  // 学习地图手动标薄弱，没有作答也算
  const map = CHAPTERS_STATE(); map[2][3] = 'weak';
  assert.equal(nodeInfo('s1', d, map).get('2.3')!.level, 'weak');
  assert.ok(weakRoots('s1', d, map).some((x) => x.key === '5.1'));
  assert.match(rootText(r[0]), /向心力（薄弱，是「匀强磁场中的运动」的直接前置）/);
});

ok('组作业「先补前置」：前置题排在新题前、每个最多 2 道、总量不超过 40%', () => {
  const pre = [1, 2, 3].map((i) => Q({ points: ['5.1'], stem: `前置题 ${i} 圆盘转动角速度 ${i * 7} rad/s 时物块恰好不滑动，求向心力`, difficulty: 2 }));
  const main = [1, 2, 3, 4, 5, 6].map((i) => Q({ points: ['16.2'], stem: `主体题 ${i} 质子以 ${i * 3}×10^5 m/s 进入匀强磁场 B=${i}T，求半径`, difficulty: 3 }));
  const d: StudyData = { ...emptyStudy(), questions: [...pre, ...main] };
  const r = pickHomework({ studentId: 's1', points: ['16.2'], count: 6, minD: 1, maxD: 5, redo: 0, avoidDays: 0, prereqs: [{ key: '5.1', for: '16.2' }] }, d);
  const tags = r.picked.map((p) => p.why.startsWith('先补前置') ? 'P' : 'M').join('');
  assert.equal(tags, 'PPMMMM');
  assert.match(r.picked[0].why, /先补前置：向心力（匀强磁场中的运动 的前置）/);
  const r2 = pickHomework({ studentId: 's1', points: ['16.2'], count: 6, minD: 1, maxD: 5, redo: 0, avoidDays: 0 }, d);
  assert.ok(r2.picked.every((p) => !p.why.startsWith('先补前置')));
});

ok('家长消息：标题、正文、企业微信 markdown 格式安全', () => {
  const l = { id: 'l1', studentId: 's1', date: '2026-10-18', at: day(18), topic: '带电粒子在磁场中的运动', minutes: 90, summary: 's', strengths: [], problems: [], next: [], parent: '小明今天进步明显。\n# 需要注意画轨迹\n- 作业按时完成', homework: '练习册 P12', via: 'rules' as const };
  const m = parentMessage(l, '小明', true);
  assert.equal(m.subject, '小明 · 2026-10-18 课后反馈');
  assert.match(m.text, /本节课：带电粒子在磁场中的运动，90 分钟/);
  assert.match(m.text, /课后作业：练习册 P12/);
  assert.match(m.text, /见下方长图/);
  assert.ok(m.markdown.startsWith('**小明 · 2026-10-18 课后反馈**'));
  assert.ok(!/^#/m.test(m.markdown), '家长的话里的 # 不能变成标题');
  assert.ok(!/^- /m.test(m.markdown));
  assert.ok(!parentMessage(l, '小明', false).text.includes('长图'));
});
ok('学科包：全学段每个包都通过校验，前缀和 id 不重复', () => {
  assert.deepEqual(SUBJECTS.slice(0, 3).map((s) => s.id), ['physics', 'math', 'chem'], '高中物理 / 数学 / 化学的 id 不能变（旧数据）');
  assert.equal(new Set(SUBJECTS.map((s) => s.id)).size, SUBJECTS.length, 'id 重复');
  assert.equal(new Set(SUBJECTS.map((s) => s.prefix)).size, SUBJECTS.length, '前缀重复');
  for (const lv of ['primary', 'junior', 'senior'] as const) assert.ok(SUBJECTS.some((s) => s.level === lv), '缺少学段 ' + lv);
  for (const p of SUBJECTS) assert.deepEqual(validatePack(p), [], p.id);
  assert.equal(kitOf('j-math'), 'math'); assert.equal(kitOf('j-chem'), 'chem'); assert.ok(hasDemo('j-physics')); assert.equal(levelOfGrade('初二'), 'junior'); assert.equal(levelOfGrade('高三'), 'senior'); assert.equal(levelOfGrade('五年级'), 'primary');
});

ok('学科包：知识点 key 合法、前缀互不冲突、章节目录一致', () => {
  assert.equal(packOf('math').textbook, '人教A版 2019');
  assert.equal(packOf('bogus').id, 'physics', '未知学科按物理');
  for (const p of SUBJECTS) {
    const pts = pointsOf(p.id);
    assert.equal(pts.length, p.chapters.reduce((s, c) => s + c.sec.length, 0), p.id + ' 知识点数量');
    for (const pt of pts) {
      assert.ok(pt.key.startsWith(p.prefix), pt.key);
      assert.equal(subjectOfKey(pt.key), p.id, pt.key);
      assert.deepEqual(localOf(pt.key), { ci: pt.ci, si: pt.si });
      assert.equal(pt.key, pointKey(p, pt.ci, pt.si));
    }
    assert.ok(p.qtypes.includes('其他') && p.prompt.read && p.prompt.solve, p.id + ' 提示词齐全');
  }
  assert.equal(studentSubject({}), 'physics');
  assert.equal(studentSubject({ subject: 'math' }), 'math');
  assert.equal(mapKey('s1', 'physics'), 's1', '物理沿用旧的学习地图 key');
  assert.equal(mapKey('s1', 'math'), 's1@math');
});

ok('学科包：前置关系不跨学科、每个包各自无环', () => {
  for (const [f, t] of EDGES) assert.equal(subjectOfKey(f), subjectOfKey(t), `跨学科边 ${f}→${t}`);
  for (const p of SUBJECTS) {
    const keys = new Set(pointsOf(p.id).map((x) => x.key));
    const edges = EDGES.filter(([f]) => keys.has(f));
    const indeg = new Map([...keys].map((k) => [k, 0])); for (const [, t] of edges) indeg.set(t, indeg.get(t)! + 1);
    const queue = [...keys].filter((k) => indeg.get(k) === 0); let seen = 0;
    const next = new Map<string, string[]>(); for (const [f, t] of edges) (next.get(f) ?? next.set(f, []).get(f)!).push(t);
    while (queue.length) { const k = queue.shift()!; seen++; for (const t of next.get(k) ?? []) { indeg.set(t, indeg.get(t)! - 1); if (indeg.get(t) === 0) queue.push(t); } }
    assert.equal(seen, keys.size, p.id + ' 有环');
    // 只对人工逐条整理过的三套高中包要求"每节都有前置"；其余包的边按课程标准挑主线，允许独立节
    if (!['physics', 'math', 'chem'].includes(p.id)) continue;
    const roots = [...keys].filter((k) => !PREREQ.has(k));
    assert.ok(roots.every((k) => k.endsWith('.0')), p.id + ' 没有前置的非首节：' + roots.filter((k) => !k.endsWith('.0')).join(','));
  }
  assert.ok(ancestors('m12.3').has('m11.4'), '直线与圆锥曲线应依赖圆与圆的位置关系');
  assert.ok(ancestors('c9.1').has('c5.1'), '化学平衡应依赖反应的限度');
});

ok('规则打标签和题型按学科分开', () => {
  const mathPts = guessPoints('已知椭圆 C 的离心率为 1/2，焦点在 x 轴上，求椭圆方程', 'math');
  assert.ok(mathPts.includes('m12.0'), mathPts.join(','));
  assert.ok(guessPoints('求函数 f(x)=x³-3x 的单调区间和极值', 'math').some((k) => k === 'm14.2' || k === 'm14.3'));
  assert.ok(guessPoints('用盖斯定律计算该反应的焓变 ΔH', 'chem').includes('c8.1'));
  assert.ok(guessPoints('实验室用二氧化锰和浓盐酸制取氯气，并检验氯水的漂白性', 'chem').includes('c1.1'));
  assert.ok(guessPoints('原电池中负极发生氧化反应', 'chem').includes('c11.0'));
  assert.ok(!guessPoints('求函数 f(x)=x³-3x 的单调区间', 'physics').some((k) => k.startsWith('m')), '物理包打不出数学标签');
  assert.equal(guessType('求证：对任意 x∈R，f(x)>0 恒成立', 'math'), '证明');
  assert.equal(guessType('下列说法正确的是 A. ① B. ②', 'math'), '选择');
  assert.equal(guessType('某工厂以黄铜矿为原料，焙烧后浸出，工艺流程如下', 'chem'), '工艺流程');
  assert.equal(guessType('下列离子方程式书写正确的是 A. ① B. ②', 'chem'), '选择');
  assert.deepEqual(qtypesOf('math'), ['选择', '填空', '解答', '证明', '其他']);
  assert.ok(qtypesOf('chem').includes('有机推断'));
  assert.ok(pointList('math').includes('m14.2'), '给模型的知识点清单带前缀');
  assert.equal(questionSubject(Q({ points: ['m2.1'] })), 'math');
  assert.equal(questionSubject(Q({})), 'physics', '老数据默认物理');
  assert.equal(questionSubject(Q({ subject: 'chem', points: ['3.1'] })), 'chem', '明确写的学科优先');
  assert.deepEqual(validPoints(['m3.1', '3.1'], 'math'), ['m3.1'], '按学科过滤模型给的知识点');
  assert.deepEqual(validPoints(['m3.1：对数函数', 'c1.2 物质的量']), ['m3.1', 'c1.2']);
});

ok('掌握度、画像、组作业按学科过滤', () => {
  const pq = Q({ stem: '物理题：求物块加速度', points: ['3.1'], difficulty: 2 });
  const mq = Q({ stem: '数学题：求函数单调区间', points: ['m14.2'], difficulty: 2, subject: 'math' });
  const d: StudyData = { ...emptyStudy(), questions: [pq, mq], attempts: [A(pq.id, 'wrong', 1), A(mq.id, 'wrong', 1)] };
  const mm = mastery('s1', d, 'math');
  assert.ok(mm.has('m14.2') && !mm.has('3.1'));
  assert.equal(mastery('s1', d).size, 2, '不传学科时全部统计');
  const pm = profile('s1', d, Date.parse(day(20)), 'math');
  assert.equal(pm.attempts, 1);
  assert.deepEqual(pm.weak.map((m) => m.key), ['m14.2']);
  const r = pickHomework({ studentId: 's1', points: ['m14.2'], count: 3, minD: 1, maxD: 5, redo: 1, avoidDays: 0, now: Date.parse(day(20)), subject: 'math' }, d);
  assert.ok(r.picked.length >= 1 && r.picked.every((p) => questionSubject(p.q) === 'math'), '只能挑出数学题');
  const info = nodeInfo('s1', d, undefined, 'math');
  assert.equal(info.get('m14.2')!.level, 'weak');
  assert.equal(info.get('3.1'), undefined, '数学地图里不出现物理点');
});
ok('课后总结和画像按学科分开，旧数据不丢', () => {
  const L = (id: string, subject?: 'physics' | 'math') => ({ id, studentId: 's1', date: '2026-01-01', at: '2026-01-01T10:00:00Z', topic: id, summary: '', points: [], good: [], weak: [], advice: [], via: 'rules' as const, ...(subject ? { subject } : {}) });
  const d: StudyData = { ...emptyStudy(), lessons: [L('old'), L('p', 'physics'), L('m', 'math')] as StudyData['lessons'] };
  assert.equal(profile('s1', d, Date.parse(day(20)), 'math').lessons, 2, '数学：旧记录 + 数学课');
  assert.equal(profile('s1', d, Date.parse(day(20)), 'physics').lessons, 2);
  assert.equal(profile('s1', d, Date.parse(day(20))).lessons, 3);
  assert.equal(portraitKey('s1'), 's1', '物理沿用旧键');
  assert.equal(portraitKey('s1', 'physics'), 's1');
  assert.equal(portraitKey('s1', 'chem'), 's1@chem');
  assert.ok(lessonIn(L('x') as never, 'chem') && !lessonIn(L('y', 'math') as never, 'chem'));
});
console.log(`study-logic: ${n}/${n} 通过`);
