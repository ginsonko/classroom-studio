// 1.6.0 课堂原话：字幕定位、搜索、学生发言段
import assert from 'node:assert/strict';
import { lineAt, matchLine, talkBands, type TranscriptSeg } from '../src/lib/transcript';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const segs: TranscriptSeg[] = [
  { t0: 0.2, t1: 3.9, who: 'teacher', text: '同学们好，今天我们讲追及相遇问题。' },
  { t0: 4.7, t1: 9.6, who: 'teacher', text: '先看第一题，甲车以10米每秒的速度匀速行驶。' },
  { t0: 12.1, t1: 16.5, who: 'student', text: '老师，我觉得两车速度相等的时候距离最大。' },
  { t0: 20, t1: 22, who: 'student', text: 'Yes, relative velocity.' },
  { t0: 60, t1: 61, who: 'student', text: '懂了' },
];

ok('字幕定位：落在句子里显示这句，说完多留 1.5 秒，两句中间空着，开头之前没有', () => {
  assert.equal(lineAt(segs, 0), -1);
  assert.equal(lineAt(segs, 0.2), 0);
  assert.equal(lineAt(segs, 4.5), 0, '说完 0.6 秒还留着');
  assert.equal(lineAt(segs, 5), 1);
  assert.equal(lineAt(segs, 11.5), -1, '两句中间超过 1.5 秒');
  assert.equal(lineAt(segs, 16.6), 2);
  assert.equal(lineAt(segs, 1000), -1);
  assert.equal(lineAt([], 3), -1);
});

ok('搜索：几个词都出现才算，不分大小写，空的全显示', () => {
  assert.ok(matchLine(segs[2].text, '速度相等'));
  assert.ok(matchLine(segs[2].text, '两车  距离'));
  assert.ok(!matchLine(segs[2].text, '速度相等 甲车'));
  assert.ok(matchLine(segs[3].text, 'RELATIVE'));
  assert.ok(matchLine(segs[0].text, '   '));
});

ok('学生发言段：隔得近的合并成一块，按课长换成比例；老师的话不算', () => {
  const b = talkBands(segs, 100);
  assert.deepEqual(b, [{ from: 0.121, to: 0.22 }, { from: 0.6, to: 0.61 }]);
  assert.deepEqual(talkBands(segs, 0), []);
  assert.equal(talkBands(segs, 100, 'teacher').length, 1);
  assert.deepEqual(talkBands([{ t0: 95, t1: 120, who: 'student', text: 'x' }], 100), [{ from: 0.95, to: 1 }]);
});

console.log(`v160-transcript-logic: ${n} passed`);
