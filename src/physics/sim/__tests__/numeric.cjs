const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const app = path.resolve(__dirname, '../../../..');
const scratch = path.join(app, '.out/D-numeric');
fs.mkdirSync(scratch, { recursive: true });
// Bundle instead of copying single files: presets pull in many sibling modules.
const entry = path.join(scratch, 'entry.ts'), bundle = path.join(scratch, 'numeric-lib.cjs');
const src = (f) => JSON.stringify(path.relative(scratch, path.join(app, 'src', f)).replace(/\\/g, '/'));
fs.writeFileSync(entry, [
  `export { SimRun } from ${src('physics/sim/engine')};`,
  `export { sceneErrors, ELEMENTARY_CHARGE } from ${src('physics/sim/domain')};`,
  `export { PRESETS, makePreset } from ${src('physics/sim/presets')};`,
  `export { initialClock, timeAt, changeClock } from ${src('physics/sim/clock')};`,
].join('\n'));
// clock.ts reaches the store, which imports Vite `?url` assets; stub those for Node.
const builder = path.join(scratch, 'build.mjs');
fs.writeFileSync(builder, `import { rolldown } from 'rolldown';
const b = await rolldown({ input: ${JSON.stringify(entry)}, platform: 'node', cwd: ${JSON.stringify(app)},
  plugins: [{ name: 'vite-url', resolveId(id) { return /[?](url|raw|inline)$/.test(id) ? '\\0stub' : null; }, load(id) { return id === '\\0stub' ? 'export default ""' : null; } }] });
await b.write({ file: ${JSON.stringify(bundle)}, format: 'cjs' });`);
execFileSync(process.execPath, [builder], { cwd: app, stdio: 'pipe', env: { ...process.env, NODE_PATH: path.join(app, 'node_modules') } });
// Minimal browser globals for store/host modules pulled in by clock.ts.
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, documentElement: { dataset: {}, style: { setProperty() {} } }, querySelector: () => null };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location ??= { search: '', hash: '', href: 'http://localhost/' };
const { SimRun, sceneErrors, ELEMENTARY_CHARGE, PRESETS, makePreset, initialClock, timeAt, changeClock } = require(bundle);
// The rich engine computes frames on demand; precompute the whole run like the player does.
const R = (s) => { const r = new SimRun(s); r.ensure(r.duration); return r; };
const tests = [], checks = [];
const near = (actual, expected, tolerance, label) => { checks.push({ label, actual, expected, tolerance }); assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (±${tolerance})`); };
const test = (name, fn) => { const at = performance.now(); try { fn(); tests.push({ name, passed: true, ms: performance.now() - at }); } catch (e) { tests.push({ name, passed: false, error: e.stack, ms: performance.now() - at }); } };
const obj = (id, kind, x, y, props = {}, w = .05, h = .05, rot = 0) => ({ id, kind, x, y, w, h, rot, props });
const scene = (objs, g = 0, duration = 2, ppm = .1) => ({ objs, world: { g, ppm }, duration });
const field = (kind, props = {}, rot = 0) => obj('field', kind, 0, 0, props, 100, 100, rot);

test('constant acceleration and projectile analytical values', () => {
  let r = R(scene([obj('b', 'block', .2, .2, { vx: 2, ax: 1.5, gravity: false })]));
  near(r.state(0, 2).vx, 5, 1e-9, 'uniform vx'); near(r.state(0, 2).x, 9, .0064, 'uniform x, fixed-step error bound');
  r = R(scene([obj('b', 'ball', .2, .2, { vx: 4, vy: 3 })], 10, 1));
  const b = r.state(0, .8);
  near(b.vx, 4, 1e-9, 'projectile vx'); near(b.vy, 5, 1e-8, 'projectile vy'); near(b.x, 5.2, 1e-8, 'projectile x'); near(b.y, 2.8, .017, 'projectile y, fixed-step error bound');
});
test('chase maximum gap and meeting time', () => {
  const r = R(makePreset('chase', {}, false).scene);
  near(r.state(0, 2).vx, 6, 1e-8, 'chase equal speed');
  near(r.state(1, 2).x - r.state(0, 2).x, 6, .013, 'chase maximum gap');
  near(r.state(1, 4).x - r.state(0, 4).x, 0, .026, 'chase meeting displacement');
});
test('frictionless incline acceleration', () => {
  const r = R(makePreset('incline', { th: 30, mu: 0, v0: 0, g: 10 }, false).scene), b = r.state(0, .8);
  const along = -b.vx * Math.cos(Math.PI / 6) + b.vy * Math.sin(Math.PI / 6);
  near(along, 4, .04, 'incline v=g sin(theta)t');
  near(Math.abs(b.ax * Math.cos(Math.PI / 6) - b.ay * Math.sin(Math.PI / 6)), 5, .08, 'incline acceleration');
});
test('elastic unequal-mass collision momentum and energy', () => {
  const r = R(makePreset('collision', { m1: 2, m2: 1, v1: 3, v2: -1, e: 1 }, false).scene), f = r.frame(3);
  near(f.b[0].vx, 1 / 3, 1e-6, 'collision A velocity'); near(f.b[1].vx, 13 / 3, 1e-6, 'collision B velocity');
  near(2 * f.b[0].vx + f.b[1].vx, 5, 1e-6, 'collision momentum'); near(f.ek, 9.5, 1e-6, 'elastic kinetic energy');
});
test('inelastic collision loses energy but conserves momentum', () => {
  const r = R(makePreset('collision', { m1: 1, v1: 1, m2: 1, v2: 0, e: 0 }, false).scene), f = r.frame(3);
  near(f.b[0].vx, .5, .00001, 'inelastic A'); near(f.b[1].vx, .5, .00001, 'inelastic B'); near(f.ek, .25, .00001, 'inelastic energy');
});
test('spring period and bounded energy drift', () => {
  const r = R(makePreset('spring', { m: 1, k: 10 }, false).scene), T = 2 * Math.PI / Math.sqrt(10);
  near(r.state(0, T).x, r.state(0, 0).x, .0005, 'spring period displacement');
  const initial = r.frames[0].es, worst = Math.max(...r.frames.map(f => Math.abs((f.ek + f.es) / initial - 1)));
  near(worst, 0, .008, 'spring relative energy drift');
});
test('uniform magnetic radius, speed and period', () => {
  const r = R(scene([field('field-b-out', { B: 1 }), obj('q', 'charge-pos', 0, 0, { q: 1, m: 2, vx: 3 })], 0, 13));
  const worstR = Math.max(...r.frames.map(f => Math.abs(Math.hypot(f.b[0].x, f.b[0].y - 6) - 6)));
  near(worstR, 0, 1e-9, 'magnetic radius'); near(r.state(0, Math.PI * 4).x, 0, .00001, 'magnetic period x'); near(r.state(0, Math.PI * 4).y, 0, .00001, 'magnetic period y');
  near(r.frame(10).ek, 9, 1e-8, 'magnetic energy unchanged');
});
test('electric acceleration and elementary charge unit', () => {
  let r = R(scene([field('field-e', { E: 3, angle: 0 }), obj('q', 'charge-pos', 0, 0, { q: 2, m: 4 })]));
  near(r.state(0, 2).x, 3, 1e-8, 'electric displacement'); near(r.state(0, 2).vx, 3, 1e-8, 'electric velocity');
  r = R(scene([field('field-b-out', { B: 1 }), obj('q', 'charge-pos', 0, 0, { q: 1, qUnit: 'e', m: ELEMENTARY_CHARGE, vx: 1 })]));
  near(r.state(0, 1).vx, Math.cos(1), .000003, 'elementary charge conversion');
});
test('rotated field geometry and direction', () => {
  const f = obj('field', 'field-e', .5, .5, { E: 3, angle: 0 }, .4, .1, Math.PI / 2);
  const r = R(scene([f, obj('q', 'charge-pos', .5, .65, { q: 1, m: 1 })], 0, .5));
  near(r.state(0, .05).vy, .15, 1e-8, 'rotated E acts inside rotated region'); near(r.state(0, .05).vx, 0, 1e-8, 'rotated E horizontal component');
});
test('zero charge and zero field stay finite', () => {
  for (const [q, B] of [[0, 1], [1, 0]]) {
    const r = R(scene([field('field-b-out', { B }), obj('q', 'charge-pos', 0, 0, { q, m: 1, vx: 2 })]));
    near(r.state(0, 2).x, 4, 1e-8, 'zero force straight trajectory'); near(r.state(0, 2).vy, 0, 1e-8, 'zero force vertical');
  }
});
test('presets parameter extremes and deterministic replay', () => {
  for (const p of PRESETS) for (const side of ['min', 'max']) {
    const mat = makePreset(p.id, Object.fromEntries(p.params.map(x => [x.key, x[side]])), false), r = R(mat.scene);
    assert.ok(r.frames.every(f => [f.ek, f.ep, f.es, ...f.b.flatMap(b => [b.x, b.y, b.vx, b.vy])].every(Number.isFinite)), `${p.id} ${side} finite`);
  }
  const s = makePreset('collision', {}, false).scene;
  assert.deepEqual(R(s).frames, R(structuredClone(s)).frames);
  assert.equal(R(makePreset('chase', { a: 6, v: 1 }, false).scene).duration, .5);
});
test('thin wall is hit in both travel directions', () => {
  for (const sign of [-1, 1]) {
    const r = R(scene([obj('wall', 'wall', .5, .3, {}, .002, .6), obj('q', 'charge-pos', sign > 0 ? .1 : .9, .3, { vx: sign * 20, q: 0, m: 1 })], 0, .5));
    const b = r.frame(.5).b[0]; assert.equal(b.alive, false); assert.equal(b.vx, 0);
    near(b.x, sign > 0 ? 4.95 : 5.05, .0001, 'wall ray hit surface');
  }
});
test('unsupported and malformed scenes do not pretend to run', () => {
  assert.ok(sceneErrors(scene([obj('c', 'resistor', 0, 0)])).some(x => x.includes('未实现')));
  assert.throws(() => R(scene([obj('b', 'ball', NaN, 0)])));
  assert.throws(() => R(scene([obj('b', 'ball', 0, 0)], 0, Infinity)));
  assert.throws(() => R(scene([obj('spring', 'spring', 0, 0)])));
  assert.throws(() => R(scene([field('field-e', { E: 1 }), obj('q', 'charge-pos', 0, 0, { m: 1e-30, q: 1 })])));
  assert.throws(() => R(scene([obj('b', 'block', 0, 0, { vx: 'not-a-number' })])));
});
test('clock pause resume rate seek late join and private copy', () => {
  const initial = initialClock('lesson', { a: 3 });
  let c = changeClock(initial, { type: 'play' }, 1000, 10);
  near(timeAt(c, 3500, 10), 2.5, 1e-12, 'late join time');
  c = changeClock(c, { type: 'pause' }, 3600, 10); near(timeAt(c, 8000, 10), 2.6, 1e-12, 'pause stable');
  c = changeClock(c, { type: 'play' }, 9000, 10); near(timeAt(c, 10000, 10), 3.6, 1e-12, 'resume continuous');
  c = changeClock(c, { type: 'rate', rate: .5 }, 10000, 10); near(timeAt(c, 12000, 10), 4.6, 1e-12, 'rate continuous');
  const preview = changeClock(c, { type: 'params', params: { a: 6 } }, 12000, 10);
  assert.equal(c.params.a, 3); assert.equal(preview.params.a, 6); assert.equal(preview.offset, 0); assert.equal(preview.playing, false);
  assert.equal(initial.playing, false); c = changeClock(c, { type: 'seek', time: 50 }, 12000, 10); near(timeAt(c, 15000, 10), 10, 1e-12, 'seek clamp');
});

const report = { at: new Date().toISOString(), kind: 'offline-numerical-and-clock-tests', passed: tests.every(t => t.passed), tests, checks, excludes: ['real desktop window integration', 'live conference', 'audio capture', 'human teaching acceptance'] };
fs.writeFileSync(path.resolve(app, '../reports/D-numerical-acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, tests, checks: checks.length }, null, 2));
process.exit(report.passed ? 0 : 1);
