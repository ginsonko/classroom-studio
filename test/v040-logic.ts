// 0.4 新增纯逻辑的离线验收：npx rolldown test/v040-logic.ts -o .out/v040-logic.mjs -p node && node .out/v040-logic.mjs
import assert from 'node:assert/strict';
import { layout, wrap, PAGE_H, type Block } from '../src/lib/boardLayout';
import { detectAnswerPages, detectAnswers } from '../src/doc/answerDetect';
import { motionCheck } from '../src/physics/sim/motion';
import { validateSceneJSON } from '../src/physics/sim/aiSchema';
import type { Stroke } from '../src/lib/types';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

const make = (pts: number[], text: string, color: string, size: number) => ({ id: 's', kind: 'text', pts, text, color, size, author: 'ai', layer: 'public' } as unknown as Stroke);
const fs = (size: number) => Math.max(0.016, size * 0.008);
const charW = (c: string) => { const k = c.codePointAt(0)!; return c === ' ' ? 0.3 : k < 0x80 ? (/[A-Z0-9mw]/.test(c) ? 0.62 : 0.52) : k >= 0x2e80 ? 1 : 0.62; };
const lineW = (s: string) => [...s].reduce((a, c) => a + charW(c), 0);

ok('wrap keeps every line inside width', () => {
  const text = '物块放上传送带后先做匀加速运动，加速度 a = μg = 0.2×10 m/s² = 2 m/s²，经过 t1 = v/a = 1 s 与传送带共速，之后随传送带一起匀速运动到右端。';
  const lines = wrap(text, 0.4, 2.4);
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok(lineW(l) * fs(2.4) <= 0.4 + 1e-9, `too wide: ${l}`);
  assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

ok('wrap does not cut ASCII formulas in the middle when avoidable', () => {
  const lines = wrap('因此 velocity_after = 12.5 m/s and distance = 40 m', 0.3, 2.4);
  for (const l of lines) assert.ok(!/[a-z]$/.test(l) || / /.test(l) || l.length < 6, l);
});

const steps = (k: number): Block[] => Array.from({ length: k }, (_, i) => [
  { text: `第 ${i + 1} 步：分析物块受力和运动过程，写出对应的方程`, size: 2.2, color: 'blue', keep: true, gap: 0.012 },
  { text: `F${i} = m a${i} = μ m g，代入数据得 a${i} = ${i + 1} m/s²`, size: 2.4, color: 'ink', indent: 0.03 },
]).flat();

ok('layout: short explanation fits one page, nothing below bottom', () => {
  const pages = layout([{ text: '传送带问题', size: 3.6, color: 'blue' }], steps(3), [{ text: '答：t = 2.5 s', size: 2.8, color: 'red', gap: 0.02 }], { cols: 1 }, make);
  assert.equal(pages.length, 1);
  for (const s of pages[0]) assert.ok(s.pts[1] < PAGE_H, 'off page');
});

ok('layout: long explanation continues on new pages with （续） title', () => {
  const pages = layout([{ text: '传送带问题', size: 3.6, color: 'blue' }], steps(14), [{ text: '答：t = 2.5 s', size: 2.8, color: 'red', gap: 0.02 }], { cols: 1 }, make);
  assert.ok(pages.length >= 2, 'expected multiple pages');
  assert.ok(pages[1][0].text!.endsWith('（续）'));
  for (const p of pages) for (const s of p) {
    const h = (s.text ?? '').split('\n').length * fs(s.size) * 1.35;
    assert.ok(s.pts[1] + h <= PAGE_H + 1e-6, `overflow: ${s.text}`);
  }
  // 步骤说明和公式不拆开
  const all = pages.flat().map((s) => s.text ?? '');
  for (let i = 0; i < 14; i++) {
    const p1 = pages.findIndex((p) => p.some((s) => s.text?.startsWith(`第 ${i + 1} 步`)));
    const p2 = pages.findIndex((p) => p.some((s) => s.text?.startsWith(`F${i} =`)));
    assert.equal(p1, p2, `step ${i + 1} split across pages`);
  }
  assert.ok(all.some((t) => t.startsWith('答：')));
});

ok('layout: two columns use fewer pages and stay inside their column', () => {
  const one = layout([{ text: '题目', size: 3.6, color: 'blue' }], steps(10), [], { cols: 1 }, make);
  const two = layout([{ text: '题目', size: 3.6, color: 'blue' }], steps(10), [], { cols: 2 }, make);
  assert.ok(two.length <= one.length);
  const colW = (1 - 0.12 - 0.04) / 2;
  for (const s of two.flat().slice(1)) {
    const right = s.pts[0] > 0.5;
    const x0 = right ? 0.06 + colW + 0.04 : 0.06;
    for (const l of (s.text ?? '').split('\n')) assert.ok(s.pts[0] - x0 + lineW(l) * fs(s.size) <= colW + 1e-6, `col overflow: ${l}`);
  }
});

ok('answer detect: trailing answer section', () => {
  const t = ['期末测试卷（含参考答案）', '一、选择题 1. …', '二、填空题', '三、解答题', '参考答案 一、1.B 2.C', '三、解答题 17. 解：…'];
  assert.deepEqual(detectAnswerPages(t), [4, 5]);
});
ok('answer detect: per-question answer pages in the middle', () => {
  const t = ['练习一', '题目 1', '【答案】 1. B', '题目 2', '题目 3', '题目 4', '题目 5', '题目 6', '题目 7', '题目 8'];
  assert.deepEqual(detectAnswerPages(t), [2]);
});
ok('answer detect: no false positives', () => {
  assert.deepEqual(detectAnswerPages(['答案在最后', '本题答案为 A 吗？请判断', '第三页']), []);
  assert.deepEqual(detectAnswerPages(['only']), []);
});
ok('answer detect: OCR slides with answer below the title (real 加速度 deck layout)', () => {
  const L = (...a: [string, number][]) => ({ lines: a.map(([t, y]) => ({ t, y })) });
  const pages = [
    L(['加 速 度', 0.44]),
    L(['例 题 1 江 苏 南 京 一 月 考 试 卷 难 度 ： 1 星', 0.029], ['选 丿 物 体 的 加 速 度 为 3m / s2 ，下 列 说 法 中 正 确 的 是', 0.126], ['A', 0.221]),
    L(['例 题 1', 0.029], ['江 苏 南 京 一 月 考 试 卷', 0.038], ['B 、', 0.16], ['答 案 ：', 0.158]),
    L(['例 题 2', 0.029], ['分 析 ： 加 速 度 的 方 向 始 终 与 速 度 方 向 相 同', 0.211], ['答 案 ： A 、 B 、 C 、', 0.158]),
    L(['1. 定 义 ： 速 度 的 变 化 量', 0.32], ['答 案 ： ________', 0.6]),
    L(['知 识 精 讲', 0.2]),
  ];
  const r = detectAnswers(pages);
  assert.deepEqual(r.pages, [2, 3]);
  assert.ok(Math.abs(r.from[2] - 0.138) < 1e-6 && Math.abs(r.from[3] - 0.138) < 1e-6, JSON.stringify(r.from));
});
ok('answer detect: answer at the very top covers the whole page', () => {
  const r = detectAnswers([{ lines: [{ t: '题目', y: 0.1 }] }, { lines: [{ t: '小结', y: 0.02 }, { t: '解析：因为…', y: 0.05 }] }]);
  assert.deepEqual(r.pages, [1]);
  assert.equal(r.from[1], undefined);
});

const scene = (objs: unknown[]) => {
  const v = validateSceneJSON({ preset: 'none', title: 't', world: { g: 10, ppm: 0.05 }, duration: 3, objs });
  assert.ok(v.ok, v.issues.join(';'));
  return v.scene!;
};
const ground = { id: 'g', kind: 'ground', x: 0.5, y: 0.52, w: 1, h: 0.02, props: { fixed: true } };

ok('motion check: falling ball moves', () => {
  const m = motionCheck(scene([ground, { id: 'b', kind: 'ball', x: 0.3, y: 0.15, w: 0.04, h: 0.04, props: { m: 1, vx: 2 } }]));
  assert.ok(m.moving, m.reason);
});
ok('motion check: only fixed parts is static', () => {
  const m = motionCheck(scene([ground]));
  assert.equal(m.moving, false);
  assert.ok(m.reason.length > 0);
});

console.log(`\n${n} checks passed`);
