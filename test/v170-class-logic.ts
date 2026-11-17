// 1.7.0 第 2 项：到点只提醒「要开始上课吗？」（不点不开始、准时、可稍后 5 分钟）、下课也只提醒；课表任意分钟
import assert from 'node:assert/strict';
import { DEFAULT_AUTO_RECORD, SNOOZE, cleanAutoRecord, extendStop, initialAutoRecord, lessonsAround, skipLesson, snoozeCard, stepAutoRecord, type AutoRecordInput, type AutoRecordSettings, type AutoRecordState } from '../src/lib/autoRecord';
import { clockInput, parseClock, spanText } from '../src/doc/scheduleModel';
import { lessonFrom } from '../src/assistant/toolsLogic';
import type { LessonSlot, Student } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const MIN = 60000;
const S = (id: string, name: string): Student => ({ id, name, grade: '高二', hue: 190, textbook: '', subject: 'physics', tags: [], lessons: 0, lastTopic: '', lastAt: '' });
const students = [S('a', '小王'), S('b', '小李')];
const slot = (p: Partial<LessonSlot>): LessonSlot => ({ id: 'x', studentId: 'a', day: 2, start: 19 + 40 / 60, len: 1.5, topic: '追及相遇', repeat: true, ...p });
const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 21, h, m, s).getTime();

function machine(slots: LessonSlot[], settings: Partial<AutoRecordSettings> = {}) {
  const set = { ...DEFAULT_AUTO_RECORD, ...settings };
  const m = {
    now: 0, state: initialAutoRecord() as AutoRecordState, live: false, recStudentId: null as string | null, recStartedAt: null as number | null,
    lastSound: 0, lastActivity: 0, log: [] as string[], card: null as ReturnType<typeof stepAutoRecord>['card'],
    tick() {
      const i: AutoRecordInput = { now: m.now, settings: set, lessons: lessonsAround(m.now, slots, students), live: m.live, busy: false, recStudentId: m.recStudentId, recStartedAt: m.recStartedAt, hasAudio: true, lastSound: m.lastSound, lastActivity: m.lastActivity, activeSince: m.lastActivity };
      const r = stepAutoRecord(m.state, i); m.state = r.state; m.card = r.card;
      for (const a of r.actions) m.log.push(a.type === 'notice' ? 'notice:' + a.text : a.type);
    },
    run(t: number) { while (m.now < t) { m.now = Math.min(t, m.now + 1000); if (m.live) m.lastSound = m.now; m.tick(); } },
    start(id: string) { m.live = true; m.recStudentId = id; m.recStartedAt = m.now; },
    acts: () => m.log.filter((x) => !x.startsWith('notice')),
  };
  return m;
}

ok('默认：准时提醒、不自动开、不自动下课、学生窗口有按钮；1.6.0 的旧设置迁成新默认', () => {
  assert.equal(DEFAULT_AUTO_RECORD.lead, 0); assert.equal(DEFAULT_AUTO_RECORD.autoStart, false); assert.equal(DEFAULT_AUTO_RECORD.autoStop, false); assert.equal(DEFAULT_AUTO_RECORD.stageButton, true);
  const old = cleanAutoRecord({ start: true, lead: 5, stopAfter: 30, idle: false, idleMinutes: 30, adhoc: true, sound: true });
  assert.deepEqual(old, { ...DEFAULT_AUTO_RECORD, stopAfter: 30, idle: false, idleMinutes: 30, adhoc: true, sound: true });
  assert.equal(cleanAutoRecord({ v: 2, lead: 7 }).lead, 7, '0–10 任意分钟');
  assert.equal(cleanAutoRecord({ v: 2, lead: 11 }).lead, 0);
  assert.equal(cleanAutoRecord({ v: 2, autoStart: true, stageButton: false }).autoStart, true);
  assert.equal(cleanAutoRecord({ v: 2, stageButton: false }).stageButton, false);
});
ok('19:40 的课：19:39:59 不提醒，19:40 准时问「要开始上课吗？」；不点就一直不开始', () => {
  const m = machine([slot({})]);
  m.now = at(19, 20); m.lastActivity = at(19, 30); m.run(at(19, 39, 59));
  assert.equal(m.card, null, '课前在学生画面上写字也不提前弹');
  m.run(at(19, 40));
  assert.equal(m.card?.kind, 'start'); assert.equal(m.card && 'deadline' in m.card ? m.card.deadline : undefined, undefined);
  assert.ok(m.log.some((x) => /小王」到上课时间了，要开始上课吗/.test(x)));
  m.run(at(20, 10));
  assert.deepEqual(m.acts(), [], '半小时都没点：不会自动开始');
  assert.equal(m.card?.kind, 'start'); assert.equal(m.log.filter((x) => x.startsWith('notice')).length, 1, '只通知一次');
});
ok('提前 3 分钟提醒', () => {
  const m = machine([slot({})], { lead: 3 });
  m.now = at(19, 30); m.run(at(19, 36, 59)); assert.equal(m.card, null);
  m.run(at(19, 37)); assert.equal(m.card?.kind, 'start');
});
ok('「5 分钟后再提醒」：5 分钟内不弹，到了再弹并再通知一次；「这节不上」以后不再弹', () => {
  const m = machine([slot({})]);
  m.now = at(19, 39); m.run(at(19, 40));
  m.state = snoozeCard(m.state, m.now, m.card!); m.tick();
  assert.equal(m.card, null);
  m.run(at(19, 40) + SNOOZE - 1000); assert.equal(m.card, null);
  m.run(at(19, 40) + SNOOZE); assert.equal(m.card?.kind, 'start');
  assert.equal(m.log.filter((x) => x.startsWith('notice')).length, 2);
  m.state = skipLesson(m.state, (m.card as { lesson: { key: string } }).lesson.key); m.run(at(20, 0)); assert.equal(m.card, null);
});
ok('老师点了开始：提醒收起；下课时间到了只问「要下课吗？」，不自动下课；「再上 15 分钟」往后推', () => {
  const m = machine([slot({})]);
  m.now = at(19, 39); m.run(at(19, 40)); m.start('a'); m.run(at(19, 41));
  assert.equal(m.card, null);
  m.run(at(21, 9, 59)); assert.equal(m.card, null);
  m.run(at(21, 10)); assert.equal(m.card?.kind, 'stop'); assert.equal((m.card as { deadline?: number }).deadline, undefined);
  m.run(at(22, 30)); assert.deepEqual(m.acts(), [], '不点就一直录');
  m.state = extendStop(m.state, m.now, m.card as { reason: 'schedule' }); m.tick(); assert.equal(m.card, null);
  m.run(at(22, 44, 59)); assert.equal(m.card, null); m.run(at(22, 45)); assert.equal(m.card?.kind, 'stop');
  m.state = snoozeCard(m.state, m.now, m.card!); m.tick(); assert.equal(m.card, null);
  m.run(at(22, 50)); assert.equal(m.card?.kind, 'stop', '稍后提醒到点再问');
});
ok('连堂：下一位学生到点只问要不要换，不自动换', () => {
  const m = machine([slot({}), slot({ id: 'y', studentId: 'b', start: 21 + 10 / 60, len: 1 })]);
  m.now = at(19, 39); m.run(at(19, 40)); m.start('a');
  m.run(at(21, 10));
  assert.equal(m.card?.kind, 'next'); assert.equal((m.card as { deadline?: number }).deadline, undefined);
  m.run(at(21, 20)); assert.deepEqual(m.acts(), []);
});
ok('打开「直接开始」「自动下课」后还是 1.6.0 的倒计时', () => {
  const m = machine([slot({})], { autoStart: true, autoStop: true });
  m.now = at(19, 39); m.run(at(19, 40)); assert.ok(typeof (m.card as { deadline?: number })?.deadline === 'number');
  m.run(at(19, 40, 10)); assert.deepEqual(m.acts(), ['start']);
});
ok('课表任意分钟：输入框认 19:40 / 1940 / 19.40 / 19：40 / 7:40pm / 19点40', () => {
  for (const s of ['19:40', '1940', '19.40', '19：40', '7:40pm', '下午7:40', '19点40', '19点40分']) assert.equal(parseClock(s), 19 + 40 / 60, s);
  assert.equal(parseClock('8'), 8); assert.equal(parseClock('19点半'), 19.5); assert.equal(parseClock('0:05'), 5 / 60);
  for (const s of ['', '25:00', '19:60', 'abc', '12345']) assert.equal(parseClock(s), null, s);
  assert.equal(clockInput(19 + 40 / 60), '19:40'); assert.equal(spanText(19 + 37 / 60, 1.5), '19:37–21:07');
});
ok('小羽排课也保留分钟（不再按刻钟取整）；课表展开后上课时刻准确', () => {
  const l = lessonFrom({ student: 'a', date: '2026-10-21', start: '19:40', minutes: 95 }, students, undefined, () => 'id');
  assert.equal(clockInput(l.start), '19:40'); assert.equal(Math.round(l.len * 60), 95);
  const ls = lessonsAround(at(19, 0), [l], students);
  assert.equal(new Date(ls.find((x) => x.slotId === 'id')!.start).getMinutes(), 40);
});
console.log(`PASS ${n}/${n} v170-class-logic`);
