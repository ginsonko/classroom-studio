// 1.6.0 下课后流水线：每一步的状态、顶栏胶囊、课后总结等不等分析、录了像没排课的课也写总结
import assert from 'node:assert/strict';
import { analysisSettled, chipOf, chipRow, pipeline, recordedLessons, rowsOfLesson, shouldWait, SUMMARY_WAIT, type PipeCtx, type Step } from '../src/lib/afterClassLogic';
import type { RecordRow } from '../src/lib/recording';
import type { Student } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const NOW = new Date(2026, 10, 1, 21, 30).getTime();
const min = 60000;
const row = (o: Partial<RecordRow> = {}): RecordRow => ({ id: 'r1', createdAt: '', phase: 'complete', bytes: 0, folder: '', mp4: '', raw: '', title: '追及问题', studentId: 's1', startedAt: NOW - 70 * min, endedAt: NOW - 10 * min, ...o });
const ctx = (o: Partial<PipeCtx> = {}): PipeCtx => ({ settings: {}, summaryOn: true, boardOn: true, asr: { installed: true, current: null, queue: [] }, aiOnline: true, quiet: false, members: 1, lessons: 0, summaryBusy: false, ...o });
const st = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.key, s.state]));
const by = (steps: Step[], k: Step['key']) => steps.find((s) => s.key === k)!;

ok('全做完：七步都打勾，胶囊说处理好了；有待确认时胶囊变成「待确认 N」', () => {
  const r = row({ transcript: { phase: 'done', count: 320 }, analysis: { at: '', frames: 18, questions: 2, attempts: 6, map: 3, summary: '', weak: [], voice: 300, pending: 2 }, after: { board: { at: '', files: 2 } } });
  const s = pipeline(r, ctx({ lessons: 1 }));
  assert.deepEqual(s.map((x) => x.key), ['save', 'asr', 'vision', 'fine', 'write', 'summary', 'board']);
  assert.ok(s.every((x) => x.state === 'done'), JSON.stringify(st(s)));
  assert.equal(by(s, 'asr').text, '320 句');
  assert.equal(by(s, 'fine').text, '听了 300 句');
  assert.equal(by(s, 'write').text, '6 题 · 2 道进收件箱 · 待确认 2');
  assert.equal(by(s, 'board').text, '2 块');
  assert.deepEqual(chipOf(s, 0), { state: 'done', text: '下课后处理好了' });
  assert.deepEqual(chipOf(s, 2), { state: 'pending', text: '待确认 2' });
  assert.ok(analysisSettled(s));
});

ok('回放还在生成：保存那步带百分比，后面都在等；课后总结等分析完、不给「现在写」', () => {
  const s = pipeline(row({ phase: 'converting', progress: 0.42 }), ctx());
  assert.deepEqual(st(s), { save: 'run', asr: 'wait', vision: 'wait', fine: 'wait', write: 'wait', summary: 'wait', board: 'off' });
  assert.equal(by(s, 'save').pct, 42);
  assert.equal(by(s, 'summary').text, '等分析完');
  assert.equal(by(s, 'summary').retry, undefined);
  assert.equal(by(s, 'board').text, '这节没存');
  assert.deepEqual(chipOf(s, 0), { state: 'run', text: '保存回放', pct: 42 });
  assert.ok(!analysisSettled(s));
});

ok('回放没生成（可恢复）：保存标红，转写和分析不再等（不挡课后总结）', () => {
  const s = pipeline(row({ phase: 'recoverable', error: '磁盘满了' }), ctx());
  assert.deepEqual(st(s), { save: 'error', asr: 'skip', vision: 'skip', fine: 'skip', write: 'skip', summary: 'wait', board: 'off' });
  assert.equal(by(s, 'save').text, '磁盘满了');
  assert.ok(analysisSettled(s));
});

ok('正在转写 / 排队：转写带百分比，分析等语音转完、不能提前点', () => {
  const a = pipeline(row(), ctx({ asr: { installed: true, current: { id: 'r1', pct: 72.4 }, queue: [] } }));
  assert.equal(by(a, 'asr').state, 'run'); assert.equal(by(a, 'asr').pct, 72);
  assert.equal(by(a, 'vision').text, '等语音转完'); assert.equal(by(a, 'vision').retry, undefined);
  const q = pipeline(row(), ctx({ asr: { installed: true, current: { id: 'x', pct: 10 }, queue: ['r1'] } }));
  assert.equal(by(q, 'asr').state, 'wait'); assert.equal(by(q, 'asr').text, '排队中');
  assert.deepEqual(chipOf(q, 0), { state: 'wait', text: '等语音转写' });
});

ok('分析进行中：按进度文字分到看画面 / 学情精析 / 写入', () => {
  const v = pipeline(row({ transcript: { phase: 'done', count: 50 } }), ctx({ busy: 'AI 正在看第 7–12 / 18 张画面' }));
  assert.deepEqual([by(v, 'vision').state, by(v, 'fine').state, by(v, 'write').state], ['run', 'wait', 'wait']);
  assert.equal(by(v, 'vision').text, 'AI 正在看第 7–12 / 18 张画面');
  const f = pipeline(row({ transcript: { phase: 'done', count: 50 } }), ctx({ busy: 'AI 正在听课堂原话、逐题判断' }));
  assert.deepEqual([by(f, 'vision').state, by(f, 'fine').state, by(f, 'write').state], ['done', 'run', 'wait']);
  const w = pipeline(row(), ctx({ busy: '正在写进题库和学情' }));
  assert.deepEqual([by(w, 'vision').state, by(w, 'fine').state, by(w, 'write').state], ['done', 'skip', 'run']);
  assert.deepEqual(chipOf(f, 0), { state: 'run', text: '学情精析' });
});

ok('出错：分析失败给「重新分析」、转写失败给「重新转写」，胶囊标红；后面的步骤照样能走', () => {
  const s = pipeline(row({ transcript: { phase: 'error', error: '声音太小' }, analysis: { at: '', frames: 0, questions: 0, attempts: 0, map: 0, summary: '', weak: [], error: '看图模型超时' } }), ctx());
  assert.equal(by(s, 'asr').state, 'error'); assert.equal(by(s, 'asr').retry, 'asr');
  assert.equal(by(s, 'vision').state, 'error'); assert.equal(by(s, 'vision').retry, 'analyze'); assert.equal(by(s, 'vision').text, '看图模型超时');
  assert.equal(by(s, 'summary').state, 'wait'); assert.equal(by(s, 'summary').retry, 'summary', '分析出错不挡课后总结');
  assert.equal(chipOf(s, 0).state, 'error');
  assert.ok(analysisSettled(s));
});

ok('当时原话还没转完、现在转好了：学情精析给「听着原话再分析」；本来就没原话的不给', () => {
  const an = { at: '', frames: 12, questions: 1, attempts: 0, map: 0, summary: '', weak: [], fineSkip: '课堂原话还没转完' };
  const s = pipeline(row({ transcript: { phase: 'done', count: 80 }, analysis: an }), ctx());
  assert.equal(by(s, 'fine').state, 'skip'); assert.equal(by(s, 'fine').retry, 'analyze');
  assert.equal(by(s, 'write').text, '1 道进收件箱');
  const t = pipeline(row({ analysis: { ...an, fineSkip: '没开课后语音转写' } }), ctx({ settings: { transcribe: false } }));
  assert.equal(by(t, 'fine').retry, undefined);
  assert.equal(by(t, 'asr').state, 'off');
});

ok('没开 / 跳过：没开分析、没配 AI、没绑学生、不到 2 分钟、一直没声音、没装语音组件', () => {
  const off = pipeline(row(), ctx({ settings: { autoAnalyze: false, transcribe: false } }));
  assert.deepEqual([by(off, 'asr').state, by(off, 'vision').state, by(off, 'fine').state, by(off, 'write').state], ['off', 'off', 'off', 'off']);
  assert.equal(by(off, 'vision').retry, 'analyze', '没开自动分析也能手动点');
  assert.equal(by(pipeline(row(), ctx({ aiOnline: false })), 'vision').text, '没配 AI');
  assert.equal(by(pipeline(row(), ctx({ aiOnline: false })), 'vision').retry, undefined);
  assert.equal(by(pipeline(row({ studentId: null }), ctx()), 'vision').text, '没绑定学生');
  assert.equal(by(pipeline(row({ studentId: null }), ctx()), 'summary').text, '没绑定学生');
  assert.equal(by(pipeline(row({ startedAt: NOW - 11 * min }), ctx()), 'vision').text, '不到 2 分钟');
  assert.equal(by(pipeline(row({ startedAt: NOW - 15 * min, analysis: { at: '', frames: 4, questions: 0, attempts: 0, map: 0, summary: '', weak: [] } }), ctx()), 'summary').text, '录像不到 10 分钟');
  const q = pipeline(row(), ctx({ quiet: true }));
  assert.equal(by(q, 'vision').state, 'skip'); assert.equal(by(q, 'vision').retry, 'analyze');
  assert.equal(by(pipeline(row(), ctx({ asr: { installed: false, current: null, queue: [] } })), 'asr').text, '没装语音组件');
  const later = pipeline(row(), ctx());
  assert.equal(by(later, 'asr').retry, 'asr', '装了组件但这节没转：可以现在转');
  assert.equal(by(later, 'vision').text, '马上开始');
});

ok('课后总结：没开、写好了（老师自己写的也算）、正在写、写失败、班组课只写了一部分', () => {
  const done = { transcript: { phase: 'done' as const, count: 50 }, analysis: { at: '', frames: 12, questions: 0, attempts: 3, map: 0, summary: '', weak: [], voice: 40 } };
  assert.equal(by(pipeline(row(done), ctx({ summaryOn: false })), 'summary').state, 'off');
  assert.equal(by(pipeline(row(done), ctx({ summaryOn: false, lessons: 1 })), 'summary').state, 'done');
  assert.equal(by(pipeline(row({ ...done, after: { summary: { at: '', lessons: 1, via: 'rules' } } }), ctx({ lessons: 1 })), 'summary').text, '模板');
  assert.equal(by(pipeline(row(done), ctx({ summaryBusy: true })), 'summary').state, 'run');
  const e = by(pipeline(row({ ...done, after: { summary: { at: '', lessons: 0, error: '网关 502' } } }), ctx()), 'summary');
  assert.deepEqual([e.state, e.text, e.retry], ['error', '网关 502', 'summary']);
  const g = by(pipeline(row(done), ctx({ members: 3, lessons: 1 })), 'summary');
  assert.deepEqual([g.state, g.retry], ['wait', 'summary']);
  assert.equal(by(pipeline(row(done), ctx({ members: 3, lessons: 3 })), 'summary').text, '3 份');
});

ok('板书：存了几块、黑板没写字、自由课堂、存失败', () => {
  assert.equal(by(pipeline(row({ after: { board: { at: '', files: 0, skip: '黑板上没写字' } } }), ctx()), 'board').text, '黑板上没写字');
  assert.equal(by(pipeline(row({ after: { board: { at: '', files: 0, error: '磁盘满了' } } }), ctx()), 'board').state, 'error');
  assert.equal(by(pipeline(row(), ctx({ boardOn: false })), 'board').text, '没开');
});

const S = (o: Partial<Student>): Student => ({ id: 's1', name: '小明', grade: '高一', textbook: '', tags: [], hue: 1, lessons: 0, lastTopic: '上次的课', ...o } as Student);
const students = [S({}), S({ id: 's2', name: '小红' }), S({ id: 's3', name: '小刚' }), S({ id: 'g1', name: '物理班', kind: 'class', members: ['s2', 's3'] } as Partial<Student>), S({ id: 's9', name: '已归档', archived: true })];
ok('recordedLessons：12 小时内下课、超过 10 分钟、绑了学生的录像写总结；班组课每位成员一份；写过的、处理过的、没声音的、还在录的跳过', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', studentId: 'g1', title: '' }),
    row({ id: 'c', studentId: 's1', startedAt: NOW - 20 * 3600000, endedAt: NOW - 13 * 3600000 }),
    row({ id: 'd', studentId: 's2', startedAt: NOW - 15 * min }),
    row({ id: 'e', studentId: 's9' }),
    row({ id: 'f', studentId: 's3', phase: 'recording' }),
    row({ id: 'g', studentId: null }),
  ];
  const date = '2026-11-01';
  const r = recordedLessons(rows, students, { lessons: [] }, new Set(), NOW);
  assert.deepEqual(r.map((x) => [x.studentId, x.date, x.topic, x.minutes, x.groupId ?? '']), [['s1', date, '追及问题', 60, ''], ['s2', date, '上次的课', 60, 'g1'], ['s3', date, '上次的课', 60, 'g1']]);
  assert.equal(r[0].key, `lesson:s1:${date}`);
  const lessons = [{ studentId: 's2', date } as never];
  assert.deepEqual(recordedLessons(rows, students, { lessons }, new Set([`lesson:s1:${date}`]), NOW).map((x) => x.studentId), ['s3']);
  assert.deepEqual(recordedLessons(rows, students, { lessons: [] }, new Set(), NOW, new Set(['a', 'b'])), []);
});

ok('rowsOfLesson / shouldWait：本人或所在班组当天的录像；还没分析完就等，最多等到下课后一个半小时', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b', studentId: 'g1' }), row({ id: 'c', startedAt: NOW - 30 * 3600000, endedAt: NOW - 29 * 3600000 })];
  assert.deepEqual(rowsOfLesson(rows, { studentId: 's1', date: '2026-11-01' }).map((r) => r.id), ['a']);
  assert.deepEqual(rowsOfLesson(rows, { studentId: 's2', date: '2026-11-01', groupId: 'g1' }).map((r) => r.id), ['b']);
  const busy = pipeline(row(), ctx({ busy: 'AI 正在看第 1–6 / 18 张画面' })), idle = pipeline(row({ analysis: { at: '', frames: 1, questions: 0, attempts: 0, map: 0, summary: '', weak: [] } }), ctx());
  assert.equal(shouldWait([{ row: row(), steps: busy }], NOW), true);
  assert.equal(shouldWait([{ row: row({ endedAt: NOW - SUMMARY_WAIT - 1 }), steps: busy }], NOW), false, '等太久了就先写');
  assert.equal(shouldWait([{ row: row(), steps: idle }], NOW), false);
  assert.equal(shouldWait([], NOW), false, '没录像不等');
});

ok('chipRow：3 小时内下课的最后一段；收起了的、还在录的不跟', () => {
  const rows = [row({ id: 'old', endedAt: NOW - 4 * 3600000 }), row({ id: 'a', endedAt: NOW - 50 * min }), row({ id: 'b', endedAt: NOW - 5 * min }), row({ id: 'live', phase: 'recording', endedAt: undefined })];
  assert.equal(chipRow(rows, NOW, new Set())?.id, 'b');
  assert.equal(chipRow(rows, NOW, new Set(['b'])), null, '收起最后一段后不回头去跟更早的');
  assert.equal(chipRow([rows[0]], NOW, new Set()), null);
});

console.log(`v160-after-logic: ${n} PASS`);
