// 1.2.2 PPT 分步（界面部分）：这一页要按几下、按到第几下、前进后退、翻页进出、帧和画面、晚到的分步结果
import assert from 'node:assert/strict';
import { builtOf, clicksOf, enterPage, framePage, framesAt, settleView, stepBuild, withSteps, type StepsResult } from '../src/lib/slideSteps';
import type { Material, View } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };
const v = (page: number, build?: [number, number], fit: View['fit'] = 'page'): View => ({ materialId: 'm', page, slide: 0, fit, zoom: 1, ...(build ? { build } : {}) });
const result: StepsResult = { pages: [
  { page: 1, clicks: 2, frames: [{ click: 0, wait: 0, path: 'C:/c/s1.png' }, { click: 1, wait: 0, path: 'C:/c/s2.png' }, { click: 2, wait: 0 }] },
  { page: 2, clicks: 1, frames: [{ click: 0, wait: 0, pdf: 'C:/c/steps.pdf', index: 3 }, { click: 1, wait: 0, pdf: 'C:/c/steps.pdf', index: 4 }, { click: 1, wait: 600, pdf: 'C:/c/steps.pdf', index: 5 }] },
  { page: 9, clicks: 3, frames: [{ click: 0, wait: 0, path: 'x' }] },
  { page: 0, clicks: 0, frames: [] },
] };
const base: Material = { id: 'm', kind: 'slides', title: 't', pages: [0, 1, 2, 3].map((i) => ({ w: 1600, h: 900, src: 'orig' + i })), total: 4 };
const url = (p: string) => 'lesson://' + p;
const mat = withSteps(base, result, url);

ok('分步结果合进课件：图片换成地址、PDF 按页、超出范围和没有动画的页不管', () => {
  assert.equal(mat.pages[1].clicks, 2);
  assert.deepEqual(mat.pages[1].steps, [{ click: 0, wait: 0, src: 'lesson://C:/c/s1.png' }, { click: 1, wait: 0, src: 'lesson://C:/c/s2.png' }, { click: 2, wait: 0 }]);
  assert.deepEqual(mat.pages[2].steps![2], { click: 1, wait: 600, doc: { pdf: 'C:/c/steps.pdf', index: 5 } });
  assert.equal(mat.pages[0].clicks, undefined); assert.equal(mat.pages[3].steps, undefined);
  assert.equal(mat.pages[1].src, 'orig1', '整页原图保留');
  assert.equal(withSteps(base, { pages: [] }, url), base); assert.equal(withSteps(base, null, url), base);
  assert.notEqual(mat, base); assert.equal(base.pages[1].clicks, undefined, '不改原对象');
});

ok('这一页要按几下：只有 PPT、开着分步、有画面', () => {
  assert.deepEqual([0, 1, 2, 3].map((p) => clicksOf(mat, p)), [0, 2, 1, 0]);
  assert.equal(clicksOf(mat, 1, false), 0, '整页显示');
  assert.equal(clicksOf({ ...mat, kind: 'pdf' }, 1), 0);
  assert.equal(clicksOf(mat, 7), 0);
});

ok('已按几下：页对不上从头算，超出范围夹住', () => {
  assert.equal(builtOf(mat, v(1)), 0);
  assert.equal(builtOf(mat, v(1, [1, 1])), 1);
  assert.equal(builtOf(mat, v(1, [2, 1])), 0, '记的是别的页');
  assert.equal(builtOf(mat, v(1, [1, 9])), 2); assert.equal(builtOf(mat, v(1, [1, -3])), 0);
  assert.equal(builtOf(mat, v(1, [1, 1]), false), 0);
});

ok('翻页笔：页内一下一下走，到头返回 null 交给翻页', () => {
  let cur = v(1);
  const seen: number[] = [];
  for (let s; (s = stepBuild(mat, cur, 1));) { cur = s; seen.push(builtOf(mat, cur)); }
  assert.deepEqual(seen, [1, 2]);
  assert.equal(stepBuild(mat, cur, 1), null);
  const back: number[] = [];
  for (let s; (s = stepBuild(mat, cur, -1));) { cur = s; back.push(builtOf(mat, cur)); }
  assert.deepEqual(back, [1, 0]);
  assert.equal(stepBuild(mat, v(0), 1), null, '没有动画的页直接翻');
  assert.equal(stepBuild(mat, v(1, undefined, 'slides'), 1), null, '幻灯片切分模式不分步');
  assert.equal(stepBuild(mat, v(1), 1, false), null, '整页显示');
});

ok('翻到新页：往后从开头，往前是放完的样子；没动画的页清掉记录', () => {
  assert.deepEqual(enterPage(mat, v(1), 1).build, [1, 0]);
  assert.deepEqual(enterPage(mat, v(2), -1).build, [2, 1]);
  assert.equal(enterPage(mat, v(3, [2, 1]), 1).build, undefined);
  const plain = v(0); assert.equal(enterPage(mat, plain, 1), plain, '没变就是原对象');
  assert.equal(enterPage(mat, v(1, [1, 1]), 1, false).build, undefined, '整页显示');
});

ok('完整走一遍：0 → 1(两下) → 2(一下) → 3，再倒回去', () => {
  // 和 store.stepView 同样的组合：先页内走，走不动再翻页并 enterPage
  const step = (cur: View, dir: 1 | -1) => stepBuild(mat, cur, dir) ?? (() => { const p = Math.max(0, Math.min(3, cur.page + dir)); return p === cur.page ? cur : enterPage(mat, { ...cur, page: p }, dir); })();
  const trace = (cur: View) => `${cur.page}:${builtOf(mat, cur)}`;
  let cur = v(0); const fwd = [trace(cur)];
  for (let i = 0; i < 7; i++) { cur = step(cur, 1); fwd.push(trace(cur)); }
  assert.deepEqual(fwd, ['0:0', '1:0', '1:1', '1:2', '2:0', '2:1', '3:0', '3:0']);
  const back = [];
  for (let i = 0; i < 7; i++) { cur = step(cur, -1); back.push(trace(cur)); }
  assert.deepEqual(back, ['2:1', '2:0', '1:2', '1:1', '1:0', '0:0', '0:0']);
});

ok('每一下的帧：同一下里的连续帧、放完没有单独帧就是原图', () => {
  const p1 = mat.pages[1], p2 = mat.pages[2];
  assert.deepEqual(framesAt(p1, 0).map((f) => f.src), ['lesson://C:/c/s1.png']);
  assert.deepEqual(framesAt(p1, 2), [{ click: 2, wait: 0 }]);
  assert.deepEqual(framesAt(p2, 1).map((f) => [f.wait, f.doc?.index]), [[0, 4], [600, 5]]);
  assert.deepEqual(framesAt(p2, 5), [{ click: 5, wait: 0 }]);
  assert.equal(framePage(p1, framesAt(p1, 2)[0]), p1);
  assert.deepEqual(framePage(p1, framesAt(p1, 0)[0]), { w: 1600, h: 900, src: 'lesson://C:/c/s1.png', doc: undefined });
  assert.deepEqual(framePage(p2, framesAt(p2, 1)[1]).doc, { pdf: 'C:/c/steps.pdf', index: 5 });
});

ok('分步结果晚到：正在看的那页按放完处理，已经在走的不动', () => {
  assert.deepEqual(settleView(mat, v(1)).build, [1, 2]);
  assert.deepEqual(settleView(mat, v(1, [1, 1])).build, [1, 1]);
  assert.deepEqual(settleView(mat, v(1, [0, 0])).build, [1, 2], '记录是别的页');
  const plain = v(0); assert.equal(settleView(mat, plain), plain);
});

console.log(`PASS ${n}/${n}`);
