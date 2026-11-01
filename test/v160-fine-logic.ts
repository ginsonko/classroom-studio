// 1.6.0 课后学情精析：原话整理、提示词、解析、写入规则、几成把握进掌握度和错题本、老数据兼容
import assert from 'node:assert/strict';
import { decide, fineNote, finePrompt, frameDigest, manualDigest, matchMember, parseFine, talkMarks, transcriptText, unsureExtra, SURE, type FineItem } from '../src/lib/fineLogic';
import { pickFrames } from '../src/lib/recordAnalysisLogic';
import { isMiss, levelText, mastery, pointsOf, profile, scoreOf, wrongBook, emptyStudy, type Attempt, type Question, type StudyData } from '../src/lib/studyLogic';
import type { TranscriptSeg } from '../src/lib/transcript';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const P = pointsOf('physics'), K1 = P[3].key, K2 = P[4].key;
const valid = new Set(P.map((p) => p.key));

const segs: TranscriptSeg[] = [];
for (let i = 0; i < 40; i++) segs.push({ t0: i * 30, t1: i * 30 + 25, who: 'teacher', text: '我们来看这个过程，'.repeat(8) + i });
segs.push({ t0: 605, t1: 609, who: 'student', text: '速度相等的时候距离最小。' });
segs.push({ t0: 609.5, t1: 611, who: 'student', text: '对吧？' });
segs.push({ t0: 900, t1: 902, who: 'student', text: '嗯' });
segs.sort((a, b) => a.t0 - b.t0);

ok('transcriptText：同一人连着说的并成一行；超长时先截老师、再只留学生前后的老师原话、学生的话一句不丢', () => {
  const full = transcriptText(segs, 1e6);
  assert.equal(full.cut, false);
  assert.ok(full.text.includes('[10:05] 学生：速度相等的时候距离最小。对吧？'), '连着两句并成一行');
  const mid = transcriptText(segs, 2500);
  assert.equal(mid.cut, true);
  assert.ok(mid.text.length <= 2500 + 20);
  assert.ok(mid.text.includes('速度相等的时候距离最小。对吧？'));
  assert.ok(mid.text.includes('老师讲解约'), '远离学生发言的老师讲解折叠');
  const tiny = transcriptText(segs, 200);
  assert.ok(tiny.text.length <= 220 && tiny.text.endsWith('（后面太长，略）'));
});

ok('talkMarks / pickFrames：学生隔了 20 秒以上又开口、说得不太短才截一帧；extra 混进截帧时间', () => {
  const m = talkMarks(segs);
  assert.deepEqual(m, [607]);
  const t = pickFrames([], 1200, 18, m);
  assert.ok(t.includes(607) && t.length <= 18);
  assert.deepEqual(pickFrames([], 1200, 12), pickFrames([], 1200, 12, []), '不给 extra 时和 1.5 一样');
});

const frames = [
  { i: 0, what: '追及问题', questions: [{ stem: '甲车以 10 m/s 匀速行驶，乙车从静止开始以 2 m/s² 加速追赶', box: null, answer: '', result: null, points: [K1] }], points: [K1] },
  { i: 1, what: '练习', questions: [{ stem: '一物体做自由落体运动，求第 3 秒内的位移是多少', box: null, answer: '', result: 'wrong' as const, points: [K2] }], points: [] },
];
ok('frameDigest / manualDigest / finePrompt：题目编号 Q1、Q2，老师手点的是 A1，带画面批改、原话说明、评分细则', () => {
  const fd = frameDigest(frames, [100, 600]);
  assert.deepEqual(fd.refs.map((r) => r.ref), ['Q1', 'Q2']);
  assert.ok(fd.text.includes('第 2 张（10:00）') && fd.text.includes('Q2 题干：一物体') && fd.text.includes('老师批改：错'));
  const md = manualDigest([{ attemptId: 'a1', questionId: 'q9', studentId: 's1', name: '小明', t: 1500, stem: '求加速度', result: 'right' }]);
  assert.equal(md.refs[0].ref, 'A1');
  assert.ok(md.text.includes('A1（25:00，小明）求加速度 → 老师记：对'));
  const p = finePrompt({ subject: 'physics', student: '小明', members: ['小明'], group: false, title: '追及', minutes: 60, chapters: [], transcript: '[0:00] 老师：好', split: 'channel', frames: fd.text, manual: md.text, mastery: '', points: 'x' });
  for (const k of ['老师的麦克风', '评分标准', 'teacher_demo', '以老师为准', 'evidence', '写 null']) assert.ok(p.includes(k), k);
  const g = finePrompt({ subject: 'physics', student: '物理班', members: ['李明', '王芳'], group: true, title: '追及', minutes: 60, chapters: [], transcript: '', split: 'mixed', frames: '', manual: '', mastery: '', points: '' });
  assert.ok(g.includes('班组课，学生：李明、王芳') && g.includes('李明你来说') && g.includes('没能分开老师和学生'));
});

ok('parseFine：时间夹进录像长度、乱写的 mode / level / conf 收拾好、没证据 conf ≤ 0.4、编号和知识点只留真有的', () => {
  const r = parseFine({
    segments: [{ t0: 900, t1: 100, kind: 'weird', title: '例题', points: [K1 + ' 追及'] }, { t0: 0, t1: 300, kind: 'lecture', title: '讲解' }],
    questions: [
      { ref: 'q1', t0: 90, t1: 5000, mode: 'guided', result: 'right', level: '7.6', conf: 1.4, hints: 2, evidence: [{ t: 607, who: 'student', text: '速度相等的时候距离最小' }], points: [K1, 'zz'] },
      { ref: 'Q9', stem: '短', mode: 'student_solo', result: 'wrong', level: 3, conf: 0.9 },
      { ref: null, stem: '老师口头出的一道题：汽车刹车 3 秒后停下，求刹车距离', mode: 'student_solo', result: 'bogus', level: 4, conf: 0.9, evidence: [] },
      { ref: 'A1', mode: 'teacher_demo', level: 9, conf: 0.9 },
    ],
    points: [{ key: K1, level: 12, trend: 'up', why: '讲清楚了' }, { key: 'zz', level: 3 }],
    summary: '讲了追及', stuck: ['临界条件', ''], todo: [{ text: '下节课再练一次', t: 3000 }], quotes: [{ t: 607, text: '速度相等的时候距离最小' }],
  }, { duration: 1200, valid, refs: new Set(['Q1', 'Q2', 'A1']) });
  assert.equal(r.segments.length, 2);
  assert.deepEqual([r.segments[0].t0, r.segments[1].kind, r.segments[1].t1 >= r.segments[1].t0], [0, 'lecture', true]);
  assert.equal(r.segments[1].points[0], K1);
  assert.equal(r.items.length, 3, '编号不对、题干又太短的丢掉');
  const [a, b, c] = r.items;
  assert.deepEqual([a.ref, a.t1, a.level, a.conf, a.hints, a.points], ['Q1', 1200, 8, 1, 2, [K1]]);
  assert.deepEqual([b.ref, b.result, b.conf, b.level], [null, null, 0.4, 4], '没证据的把握压到 0.4');
  assert.deepEqual([c.ref, c.mode, c.level], ['A1', 'teacher_demo', null], '老师讲的不给 level');
  assert.deepEqual(r.points, [{ key: K1, level: 10, trend: 'up', why: '讲清楚了' }]);
  assert.deepEqual(r.stuck, ['临界条件']);
  assert.equal(r.todo[0].t, 1200);
  assert.deepEqual(parseFine(null, { duration: 10, valid, refs: new Set() }), { segments: [], items: [], points: [], summary: '', stuck: [], todo: [], quotes: [] });
});

const item = (o: Partial<FineItem>): FineItem => ({ ref: null, stem: '题', t0: 0, t1: 10, mode: 'student_solo', who: null, result: 'right', level: 8, conf: 0.9, hints: 0, selfFixed: false, misconception: '', evidence: [{ t: 5, who: 'student', text: '我算出来是 25 米' }], points: [], ...o });
const one = { members: [{ id: 's1', name: '小明' }], group: null, manual: new Map([['A1', 'att1']]) };
const grp = { members: [{ id: 'm1', name: '李明' }, { id: 'm2', name: '王芳' }], group: 'g1', manual: new Map<string, string>() };
ok('decide：把握够、有证据直接记；不够或没证据待确认；老师讲的只算讲过；老师手点的只补证据；看不出不记', () => {
  assert.deepEqual(decide(item({}), one), { kind: 'attempt', studentId: 's1', result: 'right', level: 8 });
  assert.equal(decide(item({ conf: SURE - 0.01 }), one).kind, 'unsure');
  assert.equal((decide(item({ conf: 0.6 }), one) as { why: string }).why, 'AI 只有 6 成把握');
  assert.equal((decide(item({ evidence: [] }), one) as { why: string }).why, '没找到原话证据');
  assert.deepEqual(decide(item({ mode: 'teacher_demo' }), one), { kind: 'taught' });
  assert.deepEqual(decide(item({ ref: 'A1' }), one), { kind: 'enrich', attemptId: 'att1' });
  assert.equal(decide(item({ ref: 'A1', evidence: [] }), one).kind, 'skip');
  assert.equal(decide(item({ result: null, level: null }), one).kind, 'skip');
  assert.deepEqual(decide(item({ result: null, level: 6 }), one), { kind: 'attempt', studentId: 's1', result: 'half', level: 6 }, '只给 level 时按 level 定对错');
  assert.deepEqual(decide(item({ result: 'wrong', level: null }), one), { kind: 'attempt', studentId: 's1', result: 'wrong', level: 2 }, '只给对错时推一个 level');
});

ok('decide 班组课：点了名且把握 ≥ 0.85 才记到这个人；听不出是谁记到班组、等确认', () => {
  assert.deepEqual(decide(item({ who: '李明', conf: 0.9 }), grp), { kind: 'attempt', studentId: 'm1', result: 'right', level: 8 });
  assert.deepEqual(decide(item({ who: '王芳同学', conf: 0.8 }), grp), { kind: 'unsure', studentId: 'm2', result: 'right', level: 8, why: 'AI 只有 8 成把握' });
  const u = decide(item({ who: null, conf: 0.99 }), grp);
  assert.deepEqual([u.kind, (u as { studentId: string }).studentId], ['unsure', 'g1']);
  assert.equal(matchMember('小李', grp.members), null);
  assert.equal(matchMember('明', grp.members), null, '一个字不算');
  assert.equal(matchMember('芳芳', [{ id: 'a', name: '王芳' }]), null);
  assert.equal(matchMember('李明你', grp.members), 'm1');
});

const q = (id: string, key: string): Question => ({ id, stem: '题 ' + id, points: [key], difficulty: 2, qtype: '计算', origin: 'manual', status: 'bank', createdAt: '2026-01-01T00:00:00Z', subject: 'physics' });
const att = (id: string, qid: string, at: string, o: Partial<Attempt>): Attempt => ({ id, studentId: 's1', questionId: qid, result: 'right', at, ...o });
ok('掌握度：有几成把握的按 level / 10 算，老数据照旧按对 1 / 半对 0.5 / 错 0；Mastery.level 是 0–10', () => {
  assert.equal(scoreOf({ result: 'right' }), 1);
  assert.equal(scoreOf({ result: 'half' }), 0.5);
  assert.equal(scoreOf({ result: 'right', level: 7 }), 0.7);
  assert.equal(scoreOf({ result: 'right', level: 99 }), 1);
  const d: StudyData = { ...emptyStudy(), questions: [q('q1', K1), q('q2', K2)], attempts: [att('a', 'q1', '2026-01-02T00:00:00Z', {}), att('b', 'q2', '2026-01-02T00:00:00Z', { level: 6 })] };
  const m = mastery('s1', d);
  assert.deepEqual([m.get(K1)!.score, m.get(K1)!.level, m.get(K2)!.score, m.get(K2)!.level], [1, 10, 0.6, 6]);
  assert.equal(levelText(6), '六成把握');
  assert.equal(levelText(0), '还没把握');
  assert.equal(levelText(10), '十成把握');
  assert.equal(profile('s1', d).accuracy, 0.8);
});

ok('错题本：做对了但只有四成以下把握也进错题本；后来有把握地做对才算订正', () => {
  assert.equal(isMiss({ result: 'right', level: 4 }), true);
  assert.equal(isMiss({ result: 'right', level: 5 }), false);
  assert.equal(isMiss({ result: 'half' }), true);
  const d: StudyData = { ...emptyStudy(), questions: [q('q1', K1)], attempts: [att('a', 'q1', '2026-01-02T00:00:00Z', { level: 3 })] };
  let w = wrongBook('s1', d);
  assert.deepEqual([w.length, w[0].status, w[0].wrongCount], [1, 'open', 1]);
  d.attempts.push(att('b', 'q1', '2026-01-05T00:00:00Z', { level: 8 }));
  w = wrongBook('s1', d);
  assert.equal(w[0].status, 'fixed');
  const old: StudyData = { ...emptyStudy(), questions: [q('q1', K1)], attempts: [att('a', 'q1', '2026-01-02T00:00:00Z', {})] };
  assert.equal(wrongBook('s1', old).length, 0, '老数据做对的不进错题本');
});

ok('unsureExtra：老师选的对错和 AI 的 level 一致才保留 level，带上证据、录像那一刻的时间', () => {
  const u = { questionId: 'q', studentId: 's', result: 'half' as const, level: 6, conf: 0.6, t: 300, at: '2026-01-01T10:05:00.000Z', evidence: [{ t: 290, who: 'student', text: '不太会' }], recordId: 'r1', mode: 'guided' as const, hints: 2 };
  const a = unsureExtra(u, 'half');
  assert.deepEqual([a.level, a.at, a.via, a.recordId, a.mode, a.hints, a.evidence?.length], [6, '2026-01-01T10:05:00.000Z', 'teacher', 'r1', 'guided', 2, 1]);
  assert.equal(unsureExtra(u, 'right').level, undefined);
  assert.deepEqual(unsureExtra({ questionId: 'q', studentId: 's' }, 'right'), { via: 'teacher' }, 'AI 整理（批改照片）的待确认没有这些');
});

ok('fineNote：小结、分段（不含闲聊）、卡点、知识点几成把握和走向、四成以下的只写建议、学生原话', () => {
  const t = fineNote({
    segments: [{ t0: 0, t1: 300, kind: 'lecture', title: '讲追及', points: [] }, { t0: 300, t1: 360, kind: 'chat', title: '调麦克风', points: [] }],
    items: [], points: [{ key: K1, level: 7, trend: 'up', why: '自己讲出了临界条件' }, { key: K2, level: 3, trend: 'down', why: '' }],
    summary: '讲了追及问题。', stuck: ['临界条件'], todo: [], quotes: [{ t: 607, text: '速度相等的时候距离最小' }],
  });
  assert.ok(t.startsWith('讲了追及问题。'));
  assert.ok(t.includes('0:00–5:00 讲解：讲追及') && !t.includes('调麦克风'));
  assert.ok(t.includes('七成把握↑（自己讲出了临界条件）') && t.includes('三成把握↓'));
  assert.ok(t.includes('可能还没掌握（只是建议，学习地图没改）：' + P[4].sec));
  assert.ok(t.includes('“速度相等的时候距离最小”（10:07）'));
});

console.log(`v160-fine-logic: ${n} passed`);
