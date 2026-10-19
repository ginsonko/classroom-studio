import { SimRun } from '../src/physics/sim/engine';
import type { PhysObj, Scene } from '../src/physics/model';
const ppm = 0.1;
const o = (p: Partial<PhysObj> & { id: string; kind: PhysObj['kind'] }): PhysObj => ({ x: 0, y: 0, w: 0.04, h: 0.04, rot: 0, props: {}, ...p } as PhysObj);
// 1) 水平传送带 v=2, μ=0.2 → 共速 t=1s, x=1m
{
  const sc: Scene = { world: { g: 10, ppm }, duration: 2, objs: [
    o({ id: 'belt', kind: 'conveyor', x: 0.5, y: 0.5, w: 0.9, h: 0.02, props: { speed: 2 } }),
    o({ id: 'A', kind: 'block', x: 0.1, y: 0.47, props: { m: 1, mu: 0.2 } }),
  ] };
  const r = new SimRun(sc);
  const ev = r.events.filter((e) => e.kind === 'cospeed');
  const s1 = r.state(0, 1), s2 = r.state(0, 2);
  console.log('belt events', ev.map((e) => e.label + ' v=' + e.v?.toFixed(3)));
  console.log('belt v@0.5', r.state(0, 0.5).vx.toFixed(4), 'v@1', s1.vx.toFixed(4), 'v@2', s2.vx.toFixed(4), 'x(1)-x0', (s1.x - 1).toFixed(4));
}
// 2) 斜面 37°, μ=0.5 → a = 2 m/s²
{
  const th = 37 * Math.PI / 180, W = 0.6, H = W * Math.tan(th);
  const inc = o({ id: 'inc', kind: 'incline', x: 0.5, y: 0.5, w: W, h: H, props: { angle: 37 } });
  // 斜边中点
  const mx = 0.5, my = 0.5;
  const half = 0.02, nx = -Math.sin(th), ny = -Math.cos(th);
  const blk = o({ id: 'B', kind: 'block', x: mx + nx * (half + 0.0005) + Math.cos(th) * 0.15, y: my + ny * (half + 0.0005) - Math.sin(th) * 0.15, rot: -th, props: { m: 2, mu: 0.5 } });
  const r = new SimRun({ world: { g: 10, ppm }, duration: 1.5, objs: [inc, blk] });
  const a = r.state(0, 0.5), b = r.state(0, 1.0);
  const v = (s: typeof a) => Math.hypot(s.vx, s.vy);
  console.log('incline a≈', ((v(b) - v(a)) / 0.5).toFixed(4), 'expected', (10 * (Math.sin(th) - 0.5 * Math.cos(th))).toFixed(4));
  console.log('incline forces @1s', b.f.map((f) => f.label + '=' + Math.hypot(f.x, f.y).toFixed(2)).join(' '));
}
