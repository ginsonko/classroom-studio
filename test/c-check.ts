import assert from 'node:assert/strict';
import { OBJ_KINDS } from '../src/physics/model';
import { OBJECTS, OBJECT_CATALOG, createObject, updateObject } from '../src/physics/catalog';
import { drawObj } from '../src/physics/drawObj';
import { draw, hit } from '../src/ink/draw';
import { compileExpression } from '../src/ink/expression';
import { bounds, objectCorners, withObject, moveStroke, scaleStroke, rotateStroke, hitObject, insideLasso, eraseSegment, duplicateStroke } from '../src/ink/geometry';
import type { Stroke } from '../src/lib/types';

let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log('PASS ' + name); }
function close(a: number, b: number, e = 1e-8) { assert.ok(Math.abs(a - b) < e, `${a} != ${b}`); }
const stroke = (extra: Partial<Stroke> = {}): Stroke => ({ id: 'stroke', tool: 'pen', color: 'ink', size: 3, author: 'teacher', layer: 'public', pts: [0, .2, .2, .2, .2, .4, .4, .2, .6, .6, .2, .8], ...extra });

check('catalog covers every model kind exactly once, defaults are independent', () => {
  assert.equal(OBJECTS.length, OBJ_KINDS.length); assert.equal(new Set(OBJECTS.map((o) => o.kind)).size, OBJ_KINDS.length);
  for (const kind of OBJ_KINDS) { assert.ok(OBJECT_CATALOG[kind]); const a = createObject(kind, .5, .3), b = createObject(kind, .5, .3); a.props.m = 9999; assert.notEqual(a.props, b.props); assert.notEqual(b.props.m, 9999); assert.ok(a.w > 0 && a.h > 0); }
});
check('rotated rectangle has exact AABB and inverse-coordinate hit testing', () => {
  const o = { ...createObject('block', .5, .3), w: .2, h: .1, rot: Math.PI / 2 }, b = bounds(objectCorners(o));
  close(b.x0, .45); close(b.x1, .55); close(b.y0, .2); close(b.y1, .4); assert.ok(hitObject(o, .5, .39, 0)); assert.ok(!hitObject(o, .59, .3, 0));
});
check('move/scale/rotate preserve original objects, pressure, identity and attached geometry', () => {
  const s = withObject(stroke({ tool: 'obj' }), createObject('cart', .4, .25, 'cart')), snapshot = JSON.stringify(s);
  const moved = moveStroke(s, .1, -.05); close(moved.obj!.x, .5); close(moved.obj!.y, .2); assert.equal(moved.id, s.id);
  const scaled = scaleStroke(moved, { x: .5, y: .2 }, 2); close(scaled.obj!.w, s.obj!.w * 2);
  const rotated = rotateStroke(scaled, { x: .5, y: .2 }, Math.PI / 2); close(rotated.obj!.rot, Math.PI / 2); assert.ok(hit(rotated, .5, .2, .001));
  assert.equal(JSON.stringify(s), snapshot); assert.equal(duplicateStroke(s).obj!.props.m, s.obj!.props.m);
  const p = stroke(), q = rotateStroke(p, { x: 0, y: 0 }, Math.PI / 2); close(q.pts[0], -.2); assert.deepEqual(q.pts.filter((_, i) => i % 3 === 2), [.2, .4, .6, .8]);
});
check('lasso selects physical objects by center and does not confuse diagonal corners', () => {
  const s = withObject(stroke({ tool: 'obj' }), createObject('block', .5, .3)); assert.ok(insideLasso(s, [.4, .2, .6, .2, .6, .4, .4, .4])); assert.ok(!insideLasso(s, [0, 0, .1, 0, .1, .1, 0, .1]));
});
check('partial erase splits a long segment at exact circle intersections and preserves pressure', () => {
  const s = stroke({ pts: [0, 0, .2, 1, 0, .8] }), snap = JSON.stringify(s), pieces = eraseSegment(s, .5, 0, .1);
  assert.equal(pieces.length, 2); close(pieces[0].pts.at(-3)!, .4); close(pieces[1].pts[0], .6); close(pieces[0].pts.at(-1)!, .44); close(pieces[1].pts[2], .56);
  assert.equal(pieces[0].id, s.id); assert.notEqual(pieces[1].id, s.id); assert.equal(JSON.stringify(s), snap);
  assert.equal(eraseSegment(s, .5, 10, .1)[0], s); assert.equal(eraseSegment(s, .5, 0, 2).length, 0);
  const line = stroke({ tool: 'line', pts: [0, 0, .5, 1, 0, .5] }), cut = eraseSegment(line, .5, 0, .1);
  assert.equal(cut.length, 2); assert.ok(cut.every((p) => p.tool === 'line' && p.pts.length === 6));
  const arrow = stroke({ tool: 'arrow', pts: [0, 0, .5, 1, 0, .5] }); assert.equal(eraseSegment(arrow, .5, 0, .1)[0], arrow);
});
check('physical property validation rejects nonfinite values and keeps angle geometry consistent', () => {
  const o = createObject('incline', .5, .3), changed = updateObject(o, { props: { angle: 45, mu: -5 } }); close(changed.h, changed.w); assert.equal(changed.props.mu, 0); assert.equal(o.props.angle, 30);
  close(Number(updateObject(o, { w: .2, h: .2 }).props.angle), 45); assert.ok(Number.isFinite(updateObject(o, { w: NaN, rot: Infinity }).w));
});
check('math expressions support x/t, implicit multiplication and standard exponent precedence', () => {
  close(compileExpression('2x^2-3')(4), 29); close(compileExpression('2t+3')(4), 11); close(compileExpression('sin(pi/2)+sqrt(9)')(0), 4);
  close(compileExpression('-2^2')(0), -4); close(compileExpression('2^3^2')(0), 512); close(compileExpression('2(x+1)')(2), 6); close(compileExpression('1e-3*x')(10), .01);
});
check('unknown identifiers, object-property access and pathological nesting do not execute', () => {
  for (const s of ['globalThis.process.exit()', 'constructor.constructor(1)', 'sin.constructor(1)', 'x;process.exit()', 'random()', '('.repeat(100) + '1' + ')'.repeat(100)]) assert.ok(Number.isNaN(compileExpression(s)(2)), s);
});
// Node 没有 Path2D（化学仪器用它画轮廓）：记录调用并检查参数都是有限数
(globalThis as { Path2D?: unknown }).Path2D ??= class {
  constructor() {
    return new Proxy(this, { get: (t, p) => p in t ? Reflect.get(t, p) : (...args: unknown[]) => { for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `Path2D.${String(p)} received ${a}`); } });
  }
};
function canvas() {
  const operations: { name: string; args: unknown[] }[] = [];
  const target = { globalAlpha: 1, measureText: (s: string) => ({ width: s.length * .01 }) };
  const ctx = new Proxy(target, { get(t, p) { if (p in t) return Reflect.get(t, p); return (...args: unknown[]) => { for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${String(p)} received ${a}`); operations.push({ name: String(p), args }); }; }, set(t, p, v) { Reflect.set(t, p, v); return true; } }) as unknown as CanvasRenderingContext2D;
  return { ctx, operations, d: { ctx, scale: 1000, color: () => '#123456', dark: false } };
}
check('all vector kinds draw finite commands at small, normal, rotated and tall sizes', () => {
  for (const kind of OBJ_KINDS) for (const scale of [.1, 1, 3]) { const c = canvas(), o = createObject(kind, .5, .3); o.w *= scale; o.h *= scale; o.rot = .7; drawObj(c.d, o); assert.ok(c.operations.some((x) => x.name === 'stroke' || x.name === 'fill'), kind); }
});
check('freehand outline retains curvature at normalized coordinates (FK=1000 regression)', () => {
  const c = canvas(), pts = Array.from({ length: 60 }, (_, i) => [.1 + i / 120, .2 + Math.sin(i / 7) * .08, .2 + i / 100]).flat(); draw(c.d, stroke({ pts }));
  const curves = c.operations.filter((x) => x.name === 'quadraticCurveTo'); assert.ok(curves.length > 12); const xs = curves.flatMap((q) => [Number(q.args[0]), Number(q.args[2])]); assert.ok(Math.max(...xs) - Math.min(...xs) > .4); assert.ok(Math.max(...xs) < 1);
});
check('curve arrow coordinates stay in page units instead of being magnified 1000 times', () => {
  const c = canvas(); draw(c.d, stroke({ tool: 'curve', pts: [.1, .2, .5, .2, .1, .5, .3, .15, .5, .4, .2, .5] })); const values = c.operations.filter((x) => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(x.name)).flatMap((x) => x.args as number[]); assert.ok(values.every((x) => Math.abs(x) < 1));
});
check('zero-range or equal shaded interval cannot lock the plotting loop', () => {
  for (const plot of [{ expr: '2x', x0: 0, x1: 0, y0: 0, y1: 10, xl: 'x', yl: 'y' }, { expr: '2x', x0: 0, x1: 5, y0: 0, y1: 10, xl: 'x', yl: 'y', shade: [2, 2] as [number, number] }]) { const c = canvas(); draw(c.d, stroke({ tool: 'axes', plot, pts: [.1, .1, .5, .5, .4, .5] })); }
});
console.log(JSON.stringify({ status: 'PASS', groups: checks, objectKinds: OBJECTS.length, evidence: 'Numerical and canvas-command checks; not a real meeting or device test.' }, null, 2));
