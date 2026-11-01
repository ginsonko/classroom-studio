// 1.6.0 录像自动开 / 自动关：假时钟把所有边界跑一遍
import assert from 'node:assert/strict';
import { COUNTDOWN, DEFAULT_AUTO_RECORD, EXTEND, STOP_WARN, cleanAutoRecord, dismissAdhoc, extendStop, initialAutoRecord, lessonOf, lessonsAround, skipLesson, stepAutoRecord, type AutoRecordInput, type AutoRecordSettings, type AutoRecordState } from '../src/lib/autoRecord';
import type { LessonSlot, Student } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const MIN = 60000;
const S = (id: string, name: string, extra: Partial<Student> = {}): Student => ({ id, name, grade: '高二', hue: 190, textbook: '', subject: 'physics', tags: [], lessons: 0, lastTopic: '', lastAt: '', ...extra });
const students = [S('a', '小王'), S('b', '小李'), S('old', '毕业了', { archived: true })];
// 2026-10-21 是周三（day 2）
const slot = (p: Partial<LessonSlot>): LessonSlot => ({ id: 'x', studentId: 'a', day: 2, start: 19, len: 1.5, topic: '追及相遇', repeat: true, ...p });
const at = (h: number, m = 0, s = 0, d = 21) => new Date(2026, 9, d, h, m, s).getTime();

/** 一台假机器：按秒推进时间，模拟录像状态跟着动作变 */
function machine(slots: LessonSlot[], settings: Partial<AutoRecordSettings> = {}, opts: { hasAudio?: boolean } = {}) {
  const set = { ...DEFAULT_AUTO_RECORD, lead: 2, ...settings };
  const m = {
    now: 0, state: initialAutoRecord() as AutoRecordState, live: false, busy: false, recStudentId: null as string | null, recStartedAt: null as number | null,
    lastSound: 0, lastActivity: 0, activeSince: 0, log: [] as string[], card: null as ReturnType<typeof stepAutoRecord>['card'],
    tick() {
      const input: AutoRecordInput = { now: m.now, settings: set, lessons: lessonsAround(m.now, slots, students), live: m.live, busy: m.busy, recStudentId: m.recStudentId, recStartedAt: m.recStartedAt, hasAudio: opts.hasAudio ?? true, lastSound: m.lastSound, lastActivity: m.lastActivity, activeSince: m.activeSince };
      const r = stepAutoRecord(m.state, input);
      m.state = r.state; m.card = r.card;
      for (const a of r.actions) {
        if (a.type === 'notice') m.log.push(`notice${a.os ? '!' : ''}:${a.text}`);
        if (a.type === 'start') { m.log.push('start:' + a.lesson.name); m.live = true; m.recStudentId = a.lesson.studentId; m.recStartedAt = m.now + 1000; }
        if (a.type === 'next') { m.log.push('next:' + a.lesson.name); m.recStudentId = a.lesson.studentId; m.recStartedAt = m.now + 1000; }
        if (a.type === 'stop') { m.log.push('stop:' + a.reason); m.live = false; m.recStudentId = null; m.recStartedAt = null; }
      }
      return r;
    },
    /** 从现在跑到 t，每秒一次 */
    run(t: number, every = 1000) { while (m.now < t) { m.now = Math.min(t, m.now + every); m.tick(); } },
    manualStart(studentId: string) { m.live = true; m.recStudentId = studentId; m.recStartedAt = m.now; },
    manualStop() { m.live = false; m.recStudentId = null; m.recStartedAt = null; },
    acts: () => m.log.filter((x) => !x.startsWith('notice')),
  };
  return m;
}

ok('设置：缺的、不合法的用默认；自定义自动下课 5–240 分钟', () => {
  assert.deepEqual(cleanAutoRecord(null), DEFAULT_AUTO_RECORD);
  assert.deepEqual(DEFAULT_AUTO_RECORD, { start: true, lead: 5, stopAfter: 15, idle: true, idleMinutes: 20, adhoc: false, sound: false });
  const c = cleanAutoRecord({ start: false, lead: 7, stopAfter: 90, idle: 'yes', idleMinutes: 30, adhoc: true, sound: true });
  assert.deepEqual(c, { start: false, lead: 5, stopAfter: 90, idle: true, idleMinutes: 30, adhoc: true, sound: true });
  assert.equal(cleanAutoRecord({ stopAfter: 0 }).stopAfter, 0);
  assert.equal(cleanAutoRecord({ stopAfter: 3 }).stopAfter, 15);
  assert.equal(cleanAutoRecord({ stopAfter: 241 }).stopAfter, 15);
  assert.equal(cleanAutoRecord({ stopAfter: 12.5 }).stopAfter, 15);
});

ok('课表展开：前后一天、归档学生不算、跨午夜的课从昨天延续过来', () => {
  const ls = lessonsAround(at(0, 30, 0, 22), [slot({ id: 'n', start: 23.5, len: 2 }), slot({ id: 'o', studentId: 'old' }), slot({ id: 'z', studentId: 'nobody' })], students);
  const night = ls.find((l) => l.key === 'n@2026-10-21')!;
  assert.ok(night, '周三 23:30 那节');
  assert.equal(night.end - night.start, 120 * MIN);
  assert.equal(night.end, at(1, 30, 0, 22));
  assert.ok(!ls.some((l) => l.slotId === 'o' || l.slotId === 'z'));
  assert.equal(lessonsAround(at(12), [slot({ topic: '一对一课程' })], students)[0].topic, '', '默认课名不显示');
});

ok('到点自动开：提前 2 分钟出 10 秒倒计时卡片，倒计时完开始录；之前什么都不显示', () => {
  const m = machine([slot({})]); m.lastSound = Infinity;
  m.now = at(18, 50); m.run(at(18, 57, 59));
  assert.equal(m.card, null); assert.deepEqual(m.log, []);
  m.run(at(18, 58));
  assert.equal(m.card?.kind, 'start');
  assert.ok(m.card?.kind === 'start' && m.card.lesson.name === '小王' && m.card.deadline === at(18, 58) + COUNTDOWN && !m.card.late);
  assert.deepEqual(m.log, ['notice!:10 秒后开始为「小王」录像']);
  m.run(at(18, 58, 9));
  assert.equal(m.live, false);
  m.run(at(18, 58, 10));
  assert.deepEqual(m.acts(), ['start:小王']);
  m.run(at(19, 30));
  assert.equal(m.card, null);
  assert.deepEqual(m.acts(), ['start:小王'], '只开一次');
});

ok('提前 0 分钟：准点出倒计时；关掉自动开始就不开', () => {
  const m = machine([slot({})], { lead: 0 });
  m.now = at(18, 59); m.run(at(18, 59, 59)); assert.equal(m.card, null);
  m.run(at(19, 0, 10)); assert.deepEqual(m.acts(), ['start:小王']);
  const off = machine([slot({})], { start: false });
  off.now = at(18, 50); off.run(at(20, 0)); assert.deepEqual(off.log, []);
});

ok('这节不录：倒计时取消，这节不再提示；下一节照常', () => {
  const m = machine([slot({}), slot({ id: 'y', studentId: 'b', start: 21, len: 1 })]);
  m.now = at(18, 57); m.run(at(18, 58, 3));
  assert.equal(m.card?.kind, 'start');
  m.state = skipLesson(m.state, 'x@2026-10-21');
  m.run(at(20, 30));
  assert.deepEqual(m.acts(), []);
  m.run(at(20, 58, 10));
  assert.deepEqual(m.acts(), ['start:小李']);
});

ok('软件上课中途才打开：还在这节课时间里就照常倒计时（标成迟到）；离下课不到 5 分钟不开', () => {
  const m = machine([slot({})]);
  m.now = at(19, 20); m.tick();
  assert.ok(m.card?.kind === 'start' && m.card.late);
  const late = machine([slot({})]);
  late.now = at(20, 25, 1); late.run(at(20, 30)); assert.deepEqual(late.log, []);
});

ok('提前在学生画面上写字、上屏课件：上课前 15 分钟内就开始倒计时；更早的操作不算', () => {
  const m = machine([slot({})]);
  m.now = at(18, 40); m.lastActivity = at(18, 40); m.run(at(18, 44));
  assert.equal(m.card, null, '18:40 离上课 20 分钟，不算');
  m.lastActivity = at(18, 46); m.now = at(18, 46); m.tick();
  assert.equal(m.card?.kind, 'start');
  m.run(at(18, 46, 10)); assert.deepEqual(m.acts(), ['start:小王']);
  // 操作停了一分钟以上、还没到提前开始的时间：不再倒计时
  const q = machine([slot({})]);
  q.now = at(18, 47); q.lastActivity = at(18, 45, 30); q.tick(); assert.equal(q.card, null);
});

ok('老师自己点了开始：不再倒计时；手动下课以后这节不会又被自动开起来', () => {
  const m = machine([slot({})]);
  m.now = at(18, 55); m.manualStart('a'); m.run(at(18, 59));
  assert.equal(m.card, null);
  assert.equal(m.state.current, 'x@2026-10-21', '对上了课表');
  m.run(at(19, 10)); m.manualStop(); m.run(at(19, 40));
  assert.deepEqual(m.acts(), []);
  assert.equal(m.card, null);
});

ok('倒计时中老师手动点开始：卡片收起，不重复开', () => {
  const m = machine([slot({})]);
  m.now = at(18, 58); m.tick(); assert.equal(m.card?.kind, 'start');
  m.now += 3000; m.manualStart('a'); m.run(at(18, 59));
  assert.equal(m.card, null); assert.deepEqual(m.acts(), []);
});

ok('自动下课：下课时提示一次；下课后 13 分钟出 2 分钟倒计时卡片；15 分钟自动下课并保存', () => {
  const m = machine([slot({})]);
  m.now = at(18, 59); m.manualStart('a');
  m.lastSound = Infinity; // 一直有人说话，不触发冷场
  m.run(at(20, 30));
  assert.deepEqual(m.log, ['notice:已到「小王」的下课时间，录像还在继续']);
  assert.equal(m.card, null);
  m.run(at(20, 43));
  assert.ok(m.card?.kind === 'stop' && m.card.reason === 'schedule' && m.card.deadline === at(20, 45));
  assert.equal(m.log.at(-1), 'notice!:2 分钟后自动下课并保存录像');
  m.run(at(20, 44, 59)); assert.equal(m.live, true);
  m.run(at(20, 45)); assert.deepEqual(m.acts(), ['stop:schedule']);
  m.run(at(21, 30)); assert.deepEqual(m.acts(), ['stop:schedule'], '下课以后不再自动开这节');
});

ok('再录 15 分钟：自动下课往后推 15 分钟，到时再提醒；可以一直往后推', () => {
  const m = machine([slot({})]);
  m.now = at(18, 59); m.manualStart('a'); m.lastSound = Infinity;
  m.run(at(20, 43, 30));
  assert.equal(m.card?.kind, 'stop');
  m.state = extendStop(m.state, m.now, m.card as { reason: 'schedule'; deadline: number });
  m.run(at(20, 57, 59)); assert.equal(m.card, null);
  m.run(at(20, 58)); assert.ok(m.card?.kind === 'stop' && m.card.deadline === at(21, 0));
  m.state = extendStop(m.state, m.now, m.card as { reason: 'schedule'; deadline: number });
  m.run(at(21, 14, 59)); assert.equal(m.live, true);
  m.run(at(21, 15)); assert.deepEqual(m.acts(), ['stop:schedule']);
  assert.equal(EXTEND, 15 * MIN); assert.equal(STOP_WARN, 2 * MIN);
});

ok('不自动下课（0）：一直录，只提示到下课时间', () => {
  const m = machine([slot({})], { stopAfter: 0, idle: false });
  m.now = at(18, 59); m.manualStart('a'); m.run(at(23, 0), 5000);
  assert.deepEqual(m.acts(), []); assert.equal(m.log.length, 1);
});

ok('冷场兜底：连续 20 分钟没声音也没操作，18 分钟时提醒，20 分钟自动下课；有声音、有操作就重新计时', () => {
  const m = machine([]);
  m.now = at(14, 0); m.manualStart('a'); m.tick();
  m.run(at(14, 17, 59)); assert.equal(m.card, null);
  m.lastSound = at(14, 10); // 14:10 有人说话
  m.run(at(14, 27, 59)); assert.equal(m.card, null);
  m.run(at(14, 28)); assert.ok(m.card?.kind === 'stop' && m.card.reason === 'idle' && m.card.deadline === at(14, 30));
  assert.equal(m.log.at(-1), 'notice!:已经 18 分钟没有声音和操作，2 分钟后自动下课并保存录像');
  m.lastActivity = at(14, 29); m.run(at(14, 29, 1)); assert.equal(m.card, null, '写了一笔，卡片收起');
  m.run(at(14, 49)); assert.deepEqual(m.acts(), ['stop:idle']);
});

ok('冷场时点「继续上课」：从现在重新计时，不会提前触发课表上的自动下课', () => {
  const m = machine([slot({})]);
  m.now = at(18, 59); m.manualStart('a');
  m.run(at(19, 17)); assert.ok(m.card?.kind === 'stop' && m.card.reason === 'idle');
  m.state = extendStop(m.state, m.now, m.card as { reason: 'idle'; deadline: number });
  m.lastSound = Infinity;
  m.run(at(20, 40)); assert.deepEqual(m.acts(), [], '课表上 20:45 才自动下课');
  m.run(at(20, 45)); assert.deepEqual(m.acts(), ['stop:schedule']);
});

ok('冷场兜底：关掉、或者这段录像没录声音时不按冷场下课', () => {
  const off = machine([], { idle: false });
  off.now = at(14, 0); off.manualStart('a'); off.run(at(16, 0), 5000); assert.deepEqual(off.acts(), []);
  const mute = machine([], {}, { hasAudio: false });
  mute.now = at(14, 0); mute.manualStart('a'); mute.run(at(16, 0), 5000); assert.deepEqual(mute.acts(), []);
});

ok('电脑睡眠醒来：已经过了自动下课时间就直接保存，不再等 2 分钟', () => {
  const m = machine([slot({})]);
  m.now = at(18, 59); m.manualStart('a'); m.lastSound = Infinity; m.run(at(19, 30));
  m.now = at(22, 0); m.tick();
  assert.deepEqual(m.acts(), ['stop:schedule']);
  m.run(at(22, 5)); assert.deepEqual(m.acts(), ['stop:schedule'], '醒来后不会把已经过去的课再开起来');
});

ok('连堂：下一位学生到点出倒计时，先存这一节再开下一节；点「这节不录」就接着录这一节', () => {
  const slots = [slot({}), slot({ id: 'y', studentId: 'b', start: 20.5, len: 1 })];
  const m = machine(slots); m.lastSound = Infinity;
  m.now = at(18, 58); m.run(at(20, 29, 59));
  assert.deepEqual(m.acts(), ['start:小王']);
  m.run(at(20, 30));
  assert.ok(m.card?.kind === 'next' && m.card.lesson.name === '小李' && m.card.from?.name === '小王');
  assert.equal(m.log.at(-1), 'notice!:连堂：10 秒后保存这一节，开始录「小李」');
  m.run(at(20, 30, 10));
  assert.deepEqual(m.acts(), ['start:小王', 'next:小李']);
  assert.equal(m.state.pending?.key, 'y@2026-10-21', '等录像状态跟上');
  m.run(at(20, 31)); assert.equal(m.state.current, 'y@2026-10-21', '录像换到小李这节');
  m.run(at(21, 45)); assert.deepEqual(m.acts(), ['start:小王', 'next:小李', 'stop:schedule']);
  const k = machine(slots); k.lastSound = Infinity;
  k.now = at(18, 58); k.run(at(20, 30, 2));
  assert.equal(k.card?.kind, 'next');
  k.state = skipLesson(k.state, 'y@2026-10-21');
  k.run(at(20, 45)); assert.deepEqual(k.acts(), ['start:小王', 'stop:schedule'], '小王这节按原来的时间自动下课');
});

ok('连堂换下一节中间闪一下「已保存」：不会又倒计时开一次', () => {
  const m = machine([slot({}), slot({ id: 'y', studentId: 'b', start: 20.5, len: 1 })]); m.lastSound = Infinity;
  m.now = at(18, 58); m.run(at(20, 30, 10));
  assert.deepEqual(m.acts(), ['start:小王', 'next:小李']);
  // 主进程先收尾上一节（不在录、不忙），过两秒才开始录下一节
  m.live = false; m.recStudentId = null; m.recStartedAt = null; m.run(at(20, 30, 12));
  m.live = true; m.recStudentId = 'b'; m.recStartedAt = m.now; m.run(at(20, 31));
  assert.equal(m.card, null); assert.deepEqual(m.acts(), ['start:小王', 'next:小李']);
});

ok('下一节离得远（中间隔了比自动下课还久）：先自动下课，到点再自动开下一节', () => {
  const m = machine([slot({}), slot({ id: 'y', studentId: 'b', start: 21, len: 1 })]); m.lastSound = Infinity;
  m.now = at(18, 58); m.run(at(21, 0, 10));
  assert.deepEqual(m.acts(), ['start:小王', 'stop:schedule', 'start:小李']);
});

ok('同一个学生连着两节：一直录下去，按后一节的下课时间自动下课', () => {
  const m = machine([slot({ len: 1 }), slot({ id: 'y', start: 20, len: 1 })]); m.lastSound = Infinity;
  m.now = at(18, 58); m.run(at(21, 14));
  assert.deepEqual(m.acts(), ['start:小王']);
  m.run(at(21, 15)); assert.deepEqual(m.acts(), ['start:小王', 'stop:schedule']);
  m.run(at(21, 30)); assert.deepEqual(m.acts(), ['start:小王', 'stop:schedule']);
});

ok('跨午夜的课：过了午夜照常按开课那天算下课时间', () => {
  const m = machine([slot({ start: 23.5, len: 1 })]); m.lastSound = Infinity;
  m.now = at(23, 27); m.run(at(23, 28, 10));
  assert.deepEqual(m.acts(), ['start:小王']);
  m.run(at(0, 44, 59, 22)); assert.equal(m.live, true);
  m.run(at(0, 45, 0, 22)); assert.deepEqual(m.acts(), ['start:小王', 'stop:schedule']);
});

ok('手动给别的学生录的课：对不上课表，只按冷场兜底；录像对课表看学生和开始时间', () => {
  const ls = lessonsAround(at(19), [slot({})], students);
  assert.equal(lessonOf(ls, 'a', at(18, 1))?.key, 'x@2026-10-21');
  assert.equal(lessonOf(ls, 'a', at(17, 59)), undefined, '提前一小时以上开始的不算');
  assert.equal(lessonOf(ls, 'b', at(19)), undefined);
  assert.equal(lessonOf(ls, 'a', at(20, 30)), undefined, '下课以后开始的不算');
  const m = machine([slot({})]); m.lastSound = Infinity;
  m.now = at(18, 57); m.manualStart('b'); m.run(at(22, 0), 5000);
  assert.deepEqual(m.acts(), []);
});

ok('正在开始 / 正在收尾：不出卡片、不做事', () => {
  const m = machine([slot({})]);
  m.now = at(19, 0); m.busy = true; m.run(at(19, 1));
  assert.equal(m.card, null); assert.deepEqual(m.log, []);
});

ok('开始失败（比如录音设备坏了）：30 秒后才会再试，不会每秒都试', () => {
  const m = machine([slot({})]);
  m.now = at(18, 57, 59); m.run(at(18, 58, 10));
  assert.deepEqual(m.acts(), ['start:小王']);
  m.live = false; m.recStudentId = null; m.recStartedAt = null; // 没开起来
  m.run(at(18, 58, 39)); assert.deepEqual(m.acts(), ['start:小王']);
  m.run(at(18, 58, 41)); assert.equal(m.card?.kind, 'start', '重新倒计时，老师可以点「这节不录」');
});

ok('没排课的临时课（默认关）：连续操作 1 分钟提示一次；关掉或 3 分钟没理就收起，半小时内不再提示', () => {
  const off = machine([]);
  off.now = at(14, 0); off.activeSince = at(14, 0); off.lastActivity = at(14, 0);
  off.run(at(14, 5)); assert.equal(off.card, null);
  const m = machine([], { adhoc: true });
  m.now = at(14, 0); m.activeSince = at(14, 0); m.lastActivity = at(14, 0);
  m.run(at(14, 0, 59)); assert.equal(m.card, null);
  m.lastActivity = at(14, 1); m.run(at(14, 1)); assert.equal(m.card?.kind, 'adhoc');
  m.state = dismissAdhoc(m.state, m.now); m.run(at(14, 2)); assert.equal(m.card, null);
  m.lastActivity = at(14, 25); m.run(at(14, 25)); assert.equal(m.card, null, '半小时内不再提示');
  m.lastActivity = at(14, 32); m.run(at(14, 32)); assert.equal(m.card?.kind, 'adhoc');
  m.run(at(14, 35, 1)); assert.equal(m.card, null, '3 分钟没理自动收起');
  assert.deepEqual(m.acts(), [], '只提示，不自动开');
});

ok('课表上的课时间里不弹临时课提示（那是自动开始的事）', () => {
  const m = machine([slot({})], { adhoc: true, start: false });
  m.now = at(19, 0); m.activeSince = at(18, 0); m.lastActivity = at(19, 0); m.run(at(19, 2));
  assert.equal(m.card, null);
});

console.log(`PASS ${n}/${n}`);
