// 1.1.0 纯逻辑测试：npx tsx test/v110-logic.ts
import assert from 'node:assert/strict';
import { detectAnswers } from '../src/doc/answerDetect';

let fails = 0, n = 0;
export function ok(name: string, fn: () => void) {
  n++;
  try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n   ', (e as Error).message); }
}
process.on('beforeExit', () => { console.log(`\n${n - fails}/${n} passed`); if (fails) process.exitCode = 1; });

const L = (...a: [string, number, number][]) => ({ lines: a.map(([t, y, b]) => ({ t, y, b })) });
const first = L(['专题 13', 0.05, 0.08]);

ok('answer segments: only the answer block between two questions is covered (real 专题13 layout)', () => {
  const page = L(
    ['题型一：零点问题', 0.06, 0.09],
    ['例 1．函数 f(x)=sin(ωx−π/6)(ω>0) 在 (π/2, 3π/2) 上没有零点，则 ω 的取值范围是（ ）', 0.15, 0.2],
    ['A．(0, 1/9]          B．(0,1]', 0.22, 0.27],
    ['C．(0,1/9]∪[1,7/9]   D．(0,1/9]∪[1/3,7/9]', 0.29, 0.345],
    ['【答案】D', 0.36, 0.38],
    ['【解析】因为 x∈(π/2,3π/2)……', 0.39, 0.42],
    ['所以 ω 的取值范围是……', 0.43, 0.46],
    ['例 2．已知函数 f(x)=2sin(ωx+φ)……', 0.5, 0.53],
    ['A．1   B．2   C．3   D．4', 0.55, 0.58],
    ['【答案】B', 0.62, 0.64],
    ['【解析】……', 0.65, 0.68],
  );
  const r = detectAnswers([first, page]);
  assert.deepEqual(r.pages, [1]);
  const s = r.segs[1];
  assert.equal(s.length, 2, JSON.stringify(s));
  // 上沿不越过 C、D 选项那一行的底边
  assert.ok(s[0][0] >= 0.345 && s[0][0] <= 0.36, JSON.stringify(s));
  // 到例 2 题号之前为止
  assert.ok(s[0][1] <= 0.5 && s[0][1] >= 0.46, JSON.stringify(s));
  assert.ok(s[1][0] >= 0.58 && s[1][1] === 1, JSON.stringify(s));
  assert.equal(r.from[1], s[0][0]);
});

ok('answer segments: next numbered question 2. stops the cover', () => {
  const page = L(['1. 下列说法正确的是', 0.12, 0.15], ['答案：C', 0.3, 0.32], ['解析：……', 0.33, 0.36], ['2. 一物体做匀加速', 0.4, 0.43]);
  const r = detectAnswers([first, page]);
  assert.deepEqual(r.segs[1], [[0.294, 0.396]]);
});

ok('answer segments: answer heading at the top still covers the whole page', () => {
  const r = detectAnswers([first, L(['参考答案', 0.04, 0.07], ['1. A', 0.1, 0.12])]);
  assert.deepEqual(r.pages, [1]);
  assert.equal(r.segs[1], undefined);
});
