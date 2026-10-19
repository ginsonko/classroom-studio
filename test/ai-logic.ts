// AI 输出解析 / 规则识别的离线验收：npx rolldown test/ai-logic.ts -o .out/ai-logic.mjs -p node && node .out/ai-logic.mjs
import assert from 'node:assert/strict';
import { recognize } from '../src/physics/sim/recognize';
import { parseDraw, parseExplain, validateSceneJSON } from '../src/physics/sim/aiSchema';
import { SimRun } from '../src/physics/sim/engine';
import { presetFor } from '../src/physics/sim/presets';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

const PROBLEMS: [string, string, Record<string, number>][] = [
  ['水平传送带以 v=2 m/s 的速度匀速运行，将质量 m=1 kg 的物块轻放在传送带左端，动摩擦因数 μ=0.2，传送带两端相距 L=4 m，g 取 10 m/s²。', 'belt-h', { v: 2, m: 1, mu: 0.2, L: 4, v0: 0 }],
  ['倾角为 37° 的斜面上，质量 2 kg 的物块从静止开始下滑，物块与斜面间的动摩擦因数为 0.25，斜面长 4 m。', 'incline', { th: 37, m: 2, mu: 0.25, L: 4 }],
  ['小球从 20 m 高的平台以 10 m/s 的速度水平抛出，不计空气阻力。', 'projectile', { h: 20, v0: 10 }],
  ['质子以 2×10⁶ m/s 的速度垂直射入 B=0.5 T 的匀强磁场。', 'magnetic', { v: 2, B: 0.5, mU: 1 }],
  ['质量 m1=2 kg 的小车 A 以 3 m/s 的速度与静止的质量 m2=1 kg 的小车 B 发生弹性碰撞。', 'collision', { m1: 2, v1: 3, m2: 1, e: 1 }],
  ['单摆摆长 L=1.2 m，摆球质量 0.2 kg，把摆球拉开 θ=8° 后由静止释放。', 'pendulum', { L: 1.2, th: 8, m: 0.2 }],
];
for (const [text, preset, want] of PROBLEMS) ok('recognize ' + preset, () => {
  const r = recognize(text);
  assert.ok(r, 'not recognized: ' + text);
  assert.equal(r!.preset, preset);
  for (const [k, v] of Object.entries(want)) assert.ok(Math.abs(r!.params[k] - v) < 1e-9, `${preset}.${k}=${r!.params[k]} want ${v}`);
});

ok('model preset json (fenced, out of range)', () => {
  const v = validateSceneJSON('好的：\n```json\n{"preset":"incline","params":{"th":75,"mu":0.3,"m":"2","foo":1},"title":"斜面下滑","why":"物块沿斜面"}\n```');
  assert.ok(v.ok); assert.equal(v.preset, 'incline');
  assert.equal(v.params!.th, 60); assert.equal(v.params!.m, 2);
  assert.ok(v.issues.some((x) => x.includes('foo'))); assert.ok(v.issues.some((x) => x.includes('倾角')));
  const run = new SimRun(v.scene!, { events: presetFor('incline')!.events }); run.ensure(run.duration);
  assert.ok(run.frames.length > 10);
});
ok('model unknown preset rejected', () => { const v = validateSceneJSON('{"preset":"rocket-launch"}'); assert.equal(v.ok, false); });
ok('model garbage rejected', () => { assert.equal(validateSceneJSON('I cannot do that').ok, false); });
ok('model free scene', () => {
  const v = validateSceneJSON({ preset: 'none', title: '小球落地', world: { g: 10, ppm: 0.05 }, duration: 3, objs: [
    { id: 'g', kind: 'ground', x: 0.5, y: 0.52, w: 1, h: 0.02, props: { fixed: true } },
    { id: 'b', kind: 'ball', x: 0.3, y: 0.15, w: 0.04, h: 0.04, props: { m: 1, vx: 2 } },
    { id: 'z', kind: 'resistor', x: 0.1, y: 0.1, w: 0.04, h: 0.02, props: {} },
  ] });
  assert.ok(v.ok, v.issues.join(';'));
  assert.equal(v.scene!.objs.length, 2);
  const run = new SimRun(v.scene!); run.ensure(run.duration);
  assert.ok(run.frames.length > 10);
});
ok('explain parse', () => {
  const e = parseExplain('{"title":"传送带","problem":"…","idea":"先判断共速","steps":[{"t":"加速度","tex":"a=\\\\mu g=2\\\\,\\\\mathrm{m/s^2}","plain":"a = μg = 2 m/s²"}],"answer":"2.5 s","pitfalls":["忘记共速后匀速"]}');
  assert.ok(e); assert.equal(e!.steps.length, 1); assert.equal(e!.answer, '2.5 s');
});
ok('draw parse', () => {
  let i = 0;
  const d = parseDraw(JSON.stringify({ title: '斜面受力', items: [
    { t: 'poly', pts: [[20, 80], [120, 80], [120, 22]] },
    { t: 'force', from: [70, 50], to: [70, 75], label: 'G', color: 'red' },
    { t: 'text', at: [130, 10], text: 'N = mg cosθ', size: 1.2 },
    { t: 'plot', box: [10, 10, 60, 40], expr: '3t; 6', x: [0, 5], y: [0, 16], xl: 't/s', yl: 'v' },
    { t: 'laser', from: [0, 0] },
    { t: 'line', from: [500, -3], to: [10, 10], color: 'pink' },
  ] }), () => 's' + i++);
  assert.ok(d); assert.equal(d!.strokes.length, 5);
  const line = d!.strokes[4]; assert.equal(line.color, 'ink'); assert.equal(line.pts[0], 1); assert.equal(line.pts[1], 0);
  assert.ok(d!.strokes.every((s) => s.author === 'ai' && s.layer === 'public'));
  assert.equal(d!.strokes[3].plot!.expr, '3t; 6');
  assert.ok(d!.issues.some((x) => x.includes('laser')));
});
ok('draw: points in function coordinates, dot labels, $ in text', () => {
  let i = 0;
  const d = parseDraw(JSON.stringify({ items: [
    { t: 'dot', at: ['g', 1, -4], label: '顶点 $(1,-4)$', pos: 'dr', color: 'red' },
    { t: 'plot', id: 'g', box: [20, 10, 140, 80], expr: 'x^2-2x-3', x: [-3, 5], y: [-5, 12] },
    { t: 'dashed', from: ['g', 1, -5], to: ['g', 1, 12] },
    { t: 'text', at: [10, 5], text: '对称轴：$x=1$，$y=x^2$' },
    { t: 'dot', at: ['h', 0, 0] },
  ] }), () => 's' + i++);
  assert.ok(d);
  const [dot, label, , axis, text] = d!.strokes;
  const cx = (dot.pts[0] + dot.pts[3]) / 2, cy = (dot.pts[1] + dot.pts[4]) / 2;
  assert.ok(Math.abs(cx - 80 / 160) < 1e-9 && Math.abs(cy - (80 - 1 / 17 * 70) / 160) < 1e-9, `vertex at x=1 → 20+4/8·120=80, y=-4 → 80-1/17·70: ${cx * 160} ${cy * 160}`);
  assert.equal(label.text, '顶点 (1,-4)'); assert.ok(label.pts[0] > cx && label.pts[1] > cy, 'dr = below right');
  assert.equal(axis.tool, 'dashed'); assert.ok(Math.abs(axis.pts[0] - 80 / 160) < 1e-9 && axis.pts[1] > axis.pts[4]);
  assert.equal(text.text, '对称轴：x=1，y=x²');
  assert.equal(d!.strokes.length, 6, 'unknown plot id falls back to the only plot');
  const f = parseDraw(JSON.stringify({ items: [
    { t: 'force', from: [70, 50], to: [70, 30], label: 'F_N' },
    { t: 'text', at: [72, 28], text: 'F_N' },
    { t: 'text', at: [10, 10], text: 'f_s 与 v_0\n第二行 x^2' },
  ] }), () => 's' + i++);
  assert.equal(f!.strokes.length, 2, 'text repeating a force label is dropped');
  assert.equal(f!.strokes[1].text, 'fₛ 与 v₀\n第二行 x²');
});
console.log(`\n${n} checks passed`);
