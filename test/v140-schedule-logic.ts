// 1.4.0 课表：取消 8–23 点限制、跨午夜的课（显示、冲突、下一节、课后总结）、上下午判断（前导 0、表格规律、标黄）、多文件合并
import assert from 'node:assert/strict';
import { clock, conflicts, nextSlot, spanText, spillsInto, tailOf } from '../src/doc/scheduleModel';
import { clockOf, combineSources, flipHalf, lessonsByRules, lessonsFromJson, parseRange, parseTime, planImport, rangeOf, rowsOf, schedulePrompt, settleRows, whenText, type ImportLesson } from '../src/doc/scheduleImport';
import { dueLessons } from '../src/lib/autopilotLogic';
import type { LessonSlot, Student } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const today = new Date(2026, 9, 21); // 周三
const S = (id: string, name: string): Student => ({ id, name, grade: '高二', hue: 190, textbook: '', subject: 'physics', tags: [], lessons: 0, lastTopic: '', lastAt: '' });
const slot = (p: Partial<LessonSlot>): LessonSlot => ({ id: 'x', studentId: 'a', date: '2026-10-19', day: 0, start: 19, len: 1.5, topic: '课', repeat: true, ...p });

ok('时刻显示：超过 24 点写成次日', () => {
  assert.equal(clock(7), '07:00'); assert.equal(clock(23.5), '23:30'); assert.equal(clock(25), '次日 01:00'); assert.equal(clock(24), '次日 00:00');
  assert.equal(spanText(23, 2), '23:00–次日 01:00'); assert.equal(spanText(0.5, 1), '00:30–01:30');
  assert.equal(tailOf({ start: 23, len: 2 }), 1); assert.equal(tailOf({ start: 19, len: 2 }), 0);
  assert.equal(whenText({ day: 4, date: '', start: 23, len: 2, repeat: true }), '每周五 23:00–次日 01:00');
});

ok('跨午夜的课：和第二天凌晨的课冲突，周日的尾巴落在周一；不重叠的不算', () => {
  const fri = slot({ id: 'f', day: 4, date: '2026-10-23', start: 23, len: 2 });
  assert.equal(conflicts(slot({ id: 'm', day: 5, date: '2026-10-24', start: 0.5, len: 1 }), [fri]).length, 1, '周五 23–01 撞周六 00:30');
  assert.equal(conflicts(slot({ id: 'm', day: 5, date: '2026-10-24', start: 1, len: 1 }), [fri]).length, 0, '01:00 开始刚好不撞');
  assert.equal(conflicts(fri, [slot({ id: 'm', day: 5, start: 0, len: 0.5 })]).length, 1, '反过来查也撞');
  const sun = slot({ id: 's', day: 6, date: '2026-10-25', start: 23.5, len: 1 });
  assert.equal(conflicts(slot({ id: 'mon', day: 0, start: 0, len: 1 }), [sun]).length, 1, '周日跨到周一');
  // 单次课只和那一天的第二天撞
  const once = slot({ id: 'o', day: 4, date: '2026-10-23', start: 23, len: 2, repeat: false });
  assert.equal(conflicts(slot({ id: 'a2', day: 5, date: '2026-10-24', start: 0, len: 1, repeat: false }), [once]).length, 1);
  assert.equal(conflicts(slot({ id: 'a3', day: 5, date: '2026-10-31', start: 0, len: 1, repeat: false }), [once]).length, 0, '下一周的周六不撞');
  assert.equal(conflicts(slot({ id: 'a4', day: 5, date: '2026-10-31', start: 0, len: 1, repeat: false }), [fri]).length, 1, '每周课每周都撞');
  // 原来的同一天重叠照旧
  assert.equal(conflicts(slot({ id: 'b', day: 0, start: 19.5 }), [slot({ id: 'c', day: 0 })]).length, 1);
  assert.equal(conflicts(slot({ id: 'b', day: 1, start: 19.5 }), [slot({ id: 'c', day: 0 })]).length, 0);
});

ok('下一节：凌晨课、过了午夜还没下课的课', () => {
  const s = slot({ id: 'f', day: 4, date: '2026-10-02', start: 23, len: 2 });
  const sat0030 = new Date(2026, 9, 24, 0, 30); // 周六 00:30，周五那节还在上
  const r = nextSlot([s], sat0030)!;
  assert.ok(r && r.k < 0 && r.k > -2, JSON.stringify(r)); assert.equal(r.date.getDate(), 23);
  const early = slot({ id: 'e', day: 3, date: '2026-10-01', start: 5, len: 1 });
  const r2 = nextSlot([early], new Date(2026, 9, 21, 22))!; // 周三晚上，下一节是周四 05:00
  assert.equal(r2.date.getDate(), 22); assert.equal(r2.date.getHours(), 5);
  assert.equal(spillsInto(s, new Date(2026, 9, 24)), true); assert.equal(spillsInto(s, new Date(2026, 9, 23)), false);
});

ok('课后总结：过了午夜才下课的课，第二天下课 15 分钟后记在开课那天', () => {
  const s = slot({ id: 'f', studentId: 'a', day: 4, date: '2026-10-02', start: 23, len: 2 });
  const data = { lessons: [], attempts: [] } as unknown as Parameters<typeof dueLessons>[3];
  assert.deepEqual(dueLessons(new Date(2026, 9, 23, 23, 59), [s], [S('a', '俊宇')], data, new Set()), [], '还在上');
  assert.deepEqual(dueLessons(new Date(2026, 9, 24, 1, 5), [s], [S('a', '俊宇')], data, new Set()), [], '刚下课不到 15 分钟');
  const due = dueLessons(new Date(2026, 9, 24, 1, 20), [s], [S('a', '俊宇')], data, new Set());
  assert.deepEqual(due.map((d) => [d.date, d.key]), [['2026-10-23', 'lesson:a:2026-10-23']]);
});

ok('上下午：07:00 是 24 小时制早上；7:00 先按晚上并标记；0 点、凌晨、深夜', () => {
  assert.equal(parseTime('07:00'), 7);
  assert.deepEqual(clockOf('7:00'), { t: 19, guess: true });
  assert.deepEqual(clockOf('9:00'), { t: 9, guess: false });
  assert.deepEqual(clockOf('19:00'), { t: 19, guess: false });
  assert.equal(parseTime('0:30'), 0.5); assert.equal(parseTime('00:30'), 0.5);
  assert.equal(parseTime('凌晨1点'), 1); assert.equal(parseTime('深夜11点'), 23); assert.equal(parseTime('半夜12点'), 0);
  assert.equal(parseTime('早上6点半'), 6.5); assert.equal(parseTime('0630'), 6.5);
  assert.equal(clockOf('晚上7点')!.guess, false);
});

ok('时间段：跨午夜、凌晨、上下午标记', () => {
  assert.deepEqual(parseRange('23:00-01:00'), [23, 2]);
  assert.deepEqual(parseRange('22:30-00:30'), [22.5, 2]);
  assert.deepEqual(parseRange('晚上11点到凌晨1点'), [23, 2]);
  assert.deepEqual(parseRange('凌晨5点-6点半'), [5, 1.5]);
  assert.deepEqual(parseRange('06:00-07:30'), [6, 1.5]);
  assert.deepEqual(rangeOf('7:00-8:30'), { start: 19, len: 1.5, guess: true });
  assert.deepEqual(rangeOf('19:00-20:30'), { start: 19, len: 1.5, guess: false });
  assert.deepEqual(parseRange('11:00-1:00'), [11, 2], '老写法照旧');
  assert.equal(parseRange('19:00-19:00'), null, '首尾一样不算');
});

ok('表格规律：时段从早到晚排，前后行定上下午；整列都没写才标黄', () => {
  const R = (start: number, guess = false) => ({ start, len: 1, guess });
  const morning = settleRows([R(18, true), R(8), R(10)]); // 6:00 在 8:00 前面 → 早上
  assert.deepEqual(morning[0], { start: 6, len: 1, guess: false });
  const afternoon = settleRows([R(10), R(14, true), R(19)]); // 10 点之后的 2:00 → 下午
  assert.deepEqual(afternoon[1], { start: 14, len: 1, guess: false });
  const none = settleRows([R(19, true), R(20, true)]);
  assert.equal(none[0]!.guess, true, '整列都没写，继续标黄');
  const text = ['时间\t周一\t周六', '6:00-8:00\t\t俊宇 晨读', '08:00-10:00\t\t欣怡', '19:00-20:30\t俊宇\t'].join('\n');
  const l = lessonsByRules(text, ['俊宇', '欣怡'], today);
  const dawn = l.find((x) => x.day === 5 && x.student === '俊宇')!;
  assert.deepEqual([dawn.start, dawn.len, !!dawn.guess], [6, 2, false], JSON.stringify(l));
  const line = lessonsByRules('周二 7:00-8:30 俊宇', ['俊宇'], today)[0];
  assert.deepEqual([line.start, line.guess], [19, true], '一行一节看不出规律，标黄');
  const late = lessonsByRules('周五 23:00-01:00 俊宇 冲刺', ['俊宇'], today)[0];
  assert.deepEqual([late.day, late.start, late.len, late.topic], [4, 23, 2, '冲刺']);
});

ok('模型结果：跨午夜的 end、unsure 标记；提示词说清楚', () => {
  const r = lessonsFromJson({ lessons: [
    { student: '俊宇', day: '周五', start: '23:00', end: '01:00' },
    { student: '欣怡', day: '周六', start: '07:00', end: '08:30' },
    { student: '子轩', day: '周日', start: '19:00', end: '20:00', unsure: true },
  ] }, today);
  assert.deepEqual(r.lessons.map((l) => [l.student, l.start, l.len, !!l.guess]), [['俊宇', 23, 2, false], ['欣怡', 7, 1.5, false], ['子轩', 19, 1, true]]);
  const p = schedulePrompt(today, [], 'x');
  assert.match(p, /07:00/); assert.match(p, /unsure/); assert.match(p, /过了午夜/);
  assert.equal(flipHalf(r.lessons[2]).start, 7); assert.equal(flipHalf(r.lessons[1]).start, 19);
});

ok('多文件：记上来源，几份里重复的同一节只留一次，相邻的合成一节', () => {
  const L = (p: Partial<ImportLesson>): ImportLesson => ({ student: '俊宇', grade: '', subject: '', day: 0, date: '', start: 19, len: 1, topic: '', repeat: true, ...p });
  const all = combineSources([
    { name: 'a.xlsx', lessons: [L({}), L({ student: '欣怡', day: 2 })] },
    { name: 'b.png', lessons: [L({}), L({ start: 20 }), L({ student: '子轩', day: 4, start: 23, len: 2 })] },
  ]);
  assert.equal(all.length, 3, JSON.stringify(all));
  const jy = all.find((l) => l.student === '俊宇')!;
  assert.deepEqual([jy.start, jy.len, jy.from], [19, 2, 'a.xlsx']);
  assert.equal(all.find((l) => l.student === '子轩')!.from, 'b.png');
  // 导入时跨午夜的课和已有的周六凌晨课撞上
  const rows = rowsOf(all, [S('a', '俊宇')]);
  const plan = planImport({ rows, students: [S('a', '俊宇')], slots: [slot({ id: 'old', studentId: 'a', day: 5, start: 0, len: 1 })], mode: 'merge', onConflict: 'keep', from: today, today });
  assert.equal(plan.states[rows.find((r) => r.lesson.student === '子轩')!.id].kind, 'conflict');
});

console.log(`${n}/9 通过`);
