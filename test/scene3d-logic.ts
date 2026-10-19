// 立体演示纯逻辑验收：npx rolldown test/scene3d-logic.ts -o .out/scene3d-logic.mjs -p node --inlineDynamicImports; node .out/scene3d-logic.mjs
import assert from 'node:assert/strict';
import { evaluate, compile, identifiers } from '../src/scene3d/expr';
import { checkSpec, looseJSON, paramDefaults } from '../src/scene3d/validate';
import { World, solidNames, splitNames } from '../src/scene3d/world';
import { EXAMPLES, examplesFor, S3D_SYSTEM, s3dFirst } from '../src/scene3d/skill';
import { moleculeByName, crystalByName } from '../src/scene3d/data';
import { summarize } from '../src/scene3d/summary';
import { s3dAgent } from '../src/scene3d/agent';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

ok('公式：运算、函数、角度、隐式乘法、Unicode', () => {
  near(evaluate('1+2*3^2'), 19);
  near(evaluate('-2^2'), -4);
  near(evaluate('sind(30)'), 0.5);
  near(evaluate('2pi'), 2 * Math.PI);
  near(evaluate('2(3+1)'), 8);
  near(evaluate('√4 + 3²'), 11);
  near(evaluate('if(t<2, 3*t, 6)', { t: 1 }), 3);
  near(evaluate('t<2 ? 3*t : 6', { t: 5 }), 6);
  near(evaluate('clamp(x,0,1)', { x: 3 }), 1);
  near(evaluate('min(1,2,-3)'), -3);
  near(evaluate('m*g', { m: 2, g: 9.8 }), 19.6);
  near(evaluate('1/0'), 0);
  assert.deepEqual(identifiers('A.v*2+m'), { ids: ['m'], members: ['A'] });
});

ok('公式：拒绝未知名字与危险写法', () => {
  assert.throws(() => compile('foo+1', { names: new Set(['t']) }));
  assert.throws(() => compile('constructor', { names: new Set(['t']) }));
  assert.throws(() => compile('alert(1)', { names: new Set(['t']) }));
  assert.throws(() => compile('1+', { names: new Set(['t']) }));
});

ok('宽松 JSON：代码块、尾逗号、前后说明', () => {
  const j = looseJSON('好的：\n```json\n{"a":1,"b":[1,2,],}\n```\n以上');
  assert.deepEqual(j, { a: 1, b: [1, 2] });
  assert.equal(looseJSON('没有 JSON'), null);
});

ok('全部示例都能通过校验，没有问题提示', () => {
  for (const [k, e] of Object.entries(EXAMPLES)) {
    const r = checkSpec(e.spec);
    assert.ok(r.ok, `${k}: ${r.errors.join('；')}`);
    assert.deepEqual(r.issues, [], `${k} issues: ${r.issues.join('；')}`);
    const w = new World(r.spec!, paramDefaults(r.spec!));
    assert.deepEqual(w.problems, [], `${k} world problems`);
    const b = w.bounds();
    for (let i = 0; i < 3; i++) assert.ok(Number.isFinite(b.min[i]) && b.max[i] >= b.min[i], `${k} bounds`);
  }
});

ok('示例的模式推断：静态题是 static，运动题是 motion', () => {
  const mode = (k: string) => checkSpec(EXAMPLES[k].spec).spec!.mode;
  assert.equal(mode('inclineForces'), 'static');
  assert.equal(mode('cubeSection'), 'static');
  assert.equal(mode('projectile'), 'motion');
  assert.equal(mode('earth'), 'motion');
  assert.equal(checkSpec(EXAMPLES.cubeSection.spec).spec!.up, 'z');
});

ok('斜面受力：物块贴在斜面上，静止；法向 / 沿面方向正确', () => {
  const s = checkSpec(EXAMPLES.inclineForces.spec).spec!;
  const w = new World(s, paramDefaults(s));
  const p0 = w.posSpec('A', 0)!, p1 = w.posSpec('A', 5)!;
  assert.deepEqual(p0, p1);
  const f = w.frame('slope', 0)!;
  near(f.angle, 37, 1e-9);
  // 中心到斜面的距离 = 半高
  const rel = [p0[0] - f.o[0], p0[1] - f.o[1]];
  near(rel[0] * f.n[0] + rel[1] * f.n[1], 0.35, 1e-9, 'half thickness');
  near(rel[0] * f.u[0] + rel[1] * f.u[1], 3.6, 1e-9, 's along');
  near(w.scope(0).v.G, 20, 1e-9);
});

ok('平抛：水平匀速、竖直自由落体，落地后停住', () => {
  const s = checkSpec(EXAMPLES.projectile.spec).spec!;
  const w = new World(s, paramDefaults(s));
  const p = w.posSpec('A', 0.5)!;
  near(p[0], 1.5, 1e-9); near(p[1], 5.2 - 1.25, 1e-9);
  near(w.metric('A', 'vx', 0.5), 3, 1e-3);
  near(w.metric('A', 'vy', 0.5), -5, 1e-2);
  const land = w.posSpec('A', 1.9)!;
  near(land[1], 0.2, 1e-9, 'rests on ground (radius 0.2)');
  const w2 = new World(s, { v0: 5 });
  near(w2.posSpec('A', 0.5)![0], 2.5, 1e-9);
  const w3 = new World(s, { v0: 99 });
  near(w3.params.v0, 6, 0, 'clamped');
});

ok('立体几何：顶点名、中点、截面四点共面', () => {
  assert.deepEqual(splitNames('ABCD-A1B1C1D1'), ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1']);
  assert.deepEqual(splitNames('P-ABC'), ['A', 'B', 'C', 'P']);
  const s = checkSpec(EXAMPLES.cubeSection.spec).spec!;
  const w = new World(s);
  assert.deepEqual(solidNames(s.objects[0]), ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1']);
  assert.deepEqual(w.pointSpec('C1', 0), [4, 4, 4]);
  assert.deepEqual(w.pointSpec('M', 0), [2, 0, 4]);
  assert.deepEqual(w.pointSpec('mid(A,C1)', 0), [2, 2, 2]);
  // up=z：规格 z 映射到世界 y
  assert.deepEqual(w.point('A1', 0), [0, 4, -0]);
});

ok('地球公转：二分二至的直射点纬度', () => {
  const s = checkSpec(EXAMPLES.earth.spec).spec!;
  const w = new World(s);
  near(w.metric('E', 'lat', 0), 0, 0.5, '春分');
  near(w.metric('E', 'lat', 6), 23.44, 0.5, '夏至');
  near(w.metric('E', 'lat', 12), 0, 0.5, '秋分');
  near(w.metric('E', 'lat', 18), -23.44, 0.5, '冬至');
  near(w.metric('E', 'day', 6), 79 + 91.3, 1.5, '夏至日序');
});

ok('校验：别名、中文类型、字段改名、引用检查、自动补 g', () => {
  const r = checkSpec({
    title: 't', objects: [
      { type: '斜面', id: 'slope', angle: 30 },
      { type: '物块', id: 'B', surface: 'slope', s: 2 },
      { type: 'force', anchor: 'B', direction: 'down', length: 'm*g/10', name: 'G' },
      { type: 'ball', id: 'C', position: [1, 2, 0], radius: 0.3, on: 'B' },
      { type: 'unicorn', id: 'U' },
    ], params: { m: 2 },
  });
  assert.ok(r.ok);
  const [inc, box, arr, ball] = r.spec!.objects;
  assert.equal(inc.type, 'incline'); assert.equal(box.type, 'box'); assert.equal(box.on, 'slope');
  assert.equal(arr.type, 'arrow'); assert.equal(arr.at, 'B'); assert.equal(arr.dir, 'down'); assert.equal(arr.len, 'm*g/10'); assert.equal(arr.label, 'G');
  assert.deepEqual(ball.pos, [1, 2, 0]); assert.equal(ball.r, 0.3); assert.equal(ball.on, undefined);
  assert.equal(r.spec!.vars.g, '10');
  assert.ok(r.issues.some((x) => x.includes('unicorn')));
  assert.ok(r.issues.some((x) => x.includes('不是斜面')));
  assert.equal(r.spec!.params[0].key, 'm');
});

ok('校验：坏公式不崩溃，变成提示；空对象报错', () => {
  const r = checkSpec({ objects: [{ type: 'ball', id: 'A', pos: ['3*', 'q+1', 0] }] });
  assert.ok(r.ok);
  assert.ok(r.issues.length >= 2);
  assert.deepEqual(r.spec!.objects[0].pos, [0, 0, 0]);
  assert.equal(checkSpec({ objects: [] }).ok, false);
  assert.equal(checkSpec('乱七八糟').ok, false);
});

ok('校验：静态题写成 motion 会被纠正；时长夹到 1~60', () => {
  const r = checkSpec({ mode: 'motion', duration: 500, objects: [{ type: 'box', id: 'A' }] });
  assert.equal(r.spec!.mode, 'static');
  assert.equal(r.spec!.duration, 60);
  assert.equal(checkSpec({ duration: 0.2, objects: [{ type: 'ball', id: 'A', pos: [0, 1, 0], motion: { type: 'projectile', v0: 2, angle: 0 } }] }).spec!.duration, 1);
});

ok('校验：中间量循环引用被打断', () => {
  const r = checkSpec({ vars: { a: 'b+1', b: 'a+1' }, objects: [{ type: 'ball', id: 'A', pos: ['a', 0, 0] }] });
  assert.ok(r.ok);
  assert.ok(r.issues.some((x) => x.includes('循环')));
});

ok('内置分子与晶胞数据', () => {
  for (const n of ['H2O', 'CO2', 'CH4', 'NH3', 'C2H4', 'C2H2', 'C6H6', 'C2H5OH', 'CH3COOH', '乙醇', '甲烷']) assert.ok(moleculeByName(n), n);
  const ch4 = moleculeByName('CH4')!;
  const c = ch4.atoms[0], h1 = ch4.atoms[1], h2 = ch4.atoms[2];
  const v1 = [h1[1] - c[1], h1[2] - c[2], h1[3] - c[3]], v2 = [h2[1] - c[1], h2[2] - c[2], h2[3] - c[3]];
  const ang = Math.acos((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / Math.hypot(...v1) / Math.hypot(...v2)) * 180 / Math.PI;
  near(ang, 109.47, 0.2, 'CH4 bond angle');
  for (const n of ['NaCl', 'CsCl', 'diamond', 'bcc', 'fcc', 'graphite']) assert.ok(crystalByName(n).atoms.length > 4, n);
  // 每个分子：原子不重叠；四个单键的碳是 109.5°
  for (const name of ['H2O', 'CO2', 'CH4', 'NH3', 'C2H4', 'C2H2', 'C2H6', 'C6H6', 'C2H5OH', 'CH3COOH', 'CH3OH', 'SO2']) {
    const m = moleculeByName(name)!;
    for (let i = 0; i < m.atoms.length; i++) for (let j = i + 1; j < m.atoms.length; j++) {
      const d = Math.hypot(m.atoms[i][1] - m.atoms[j][1], m.atoms[i][2] - m.atoms[j][2], m.atoms[i][3] - m.atoms[j][3]);
      assert.ok(d > 0.7, `${name} atoms ${i},${j} too close ${d.toFixed(2)}`);
    }
    m.atoms.forEach((a, i) => {
      const nb = m.bonds.filter((b) => b[0] === i || b[1] === i);
      if (a[0] !== 'C' || nb.length !== 4) return;
      const vs = nb.map((b) => { const o = m.atoms[b[0] === i ? b[1] : b[0]]; return [o[1] - a[1], o[2] - a[2], o[3] - a[3]]; });
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
        const c = (vs[p][0] * vs[q][0] + vs[p][1] * vs[q][1] + vs[p][2] * vs[q][2]) / Math.hypot(...vs[p]) / Math.hypot(...vs[q]);
        near(Math.acos(c) * 180 / Math.PI, 109.5, 6, `${name} C${i} angle`);
      }
    });
  }
});

ok('提示词：包含规格说明、规则、按学科挑示例', () => {
  assert.ok(S3D_SYSTEM.includes('运动配方') && S3D_SYSTEM.includes('只输出一个 JSON'));
  assert.ok(examplesFor('math').includes('正方体的截面'));
  assert.ok(examplesFor('chemistry').includes('甲烷'));
  assert.ok(examplesFor('physics').includes('平抛'));
  const first = s3dFirst('求时间', 'physics', false);
  assert.ok(first.includes('题目：求时间') && first.includes('"spec"'));
  assert.ok(S3D_SYSTEM.length + first.length < 16000, 'prompt size ' + (S3D_SYSTEM.length + first.length));
});

ok('摘要：运动列出动的物体，静态没有，运动题不动会警告', () => {
  const specOf = (k: string) => checkSpec(EXAMPLES[k].spec).spec!;
  const inc = summarize(specOf('inclineForces'));
  assert.ok(inc.includes('静态') && inc.includes('静止') && !inc.includes('在动：'), inc);
  const pro = summarize(specOf('projectile'));
  assert.ok(pro.includes('运动') && pro.includes('在动：A'), pro);
  // 校验器会把不动的 motion 纠正成 static，所以这里绕开校验直接改 mode 来测警告
  const badSpec = checkSpec({ mode: 'motion', duration: 6, objects: [{ type: 'box', id: 'A', pos: [0, 0.5, 0] }] }).spec!;
  badSpec.mode = 'motion';
  const bad = summarize(badSpec);
  assert.ok(bad.includes('没有任何物体在动'), bad);
  assert.ok(summarize(specOf('earth')).includes('在动：E'), 'earth orbits');
});

// 智能体：假模型按脚本回复，验证整个「写规格 → 校验 → 联系表 → 检查」循环
await (async () => {
  const spec = { title: '测试平抛', mode: 'motion', duration: 2, objects: [{ id: 'A', type: 'ball', pos: [0, 5, 0], motion: { type: 'projectile', v0: 3, angle: 0 } }] };
  const script = [
    '这不是 JSON',
    JSON.stringify({ understand: '小球平抛', expect: '1 秒落地', spec }),
    '{"accept":true,"why":"和题目一致"}',
  ];
  let i = 0;
  const chat = async () => ({ content: script[Math.min(i++, script.length - 1)], model: 'fake', ms: 1 });
  const res = await s3dAgent('平抛运动', undefined, 'physics', chat);
  assert.equal(res.accepted, true);
  assert.equal(res.calls, 3);
  assert.ok(res.best && res.best.spec.title === '测试平抛');
  assert.ok(res.best!.summary.includes('在动：A'));
  assert.ok(res.steps.some((t) => t.includes('格式不对')) && res.steps.some((t) => t.includes('一致')));

  // 全程胡说：5 次调用后 best 为 null
  const bad = await s3dAgent('x', undefined, 'physics', async () => ({ content: '嗯', model: 'fake', ms: 1 }));
  assert.equal(bad.best, null);
  assert.equal(bad.calls, 5);
  n += 2; console.log('ok 智能体：格式纠正、校验、确认；全错时 5 次后放弃');
})();

console.log(`\n${n} 项通过`);
