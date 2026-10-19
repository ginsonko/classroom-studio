// 物理预设对照解析解的验收（课本公式 vs 引擎）。
// npx rolldown test/physics-analytic.ts -o .out/physics-analytic.mjs -p node && node .out/physics-analytic.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SimRun, type BState } from '../src/physics/sim/engine';
import { buildPreset, presetFor } from '../src/physics/sim/presets';

type Row = { name: string; got: number; want: number; tol: number; pass: boolean; note?: string };
const rows: Row[] = [];
const errors: string[] = [];

function run(id: string, p: Record<string, number>) {
  const sc = buildPreset(id, p);
  if (!sc) throw new Error('no preset ' + id);
  const r = new SimRun(sc, { events: presetFor(id)?.events });
  r.ensure(r.duration);
  return r;
}
const S = (r: SimRun, id: string, t: number): BState => { const i = r.bodyIndex(id); if (i < 0) throw new Error('no body ' + id); return r.state(i, t); };
const speed = (b: BState) => Math.hypot(b.vx, b.vy);
const disp = (r: SimRun, id: string, t: number) => { const a = S(r, id, 0), b = S(r, id, t); return Math.hypot(b.x - a.x, b.y - a.y); };
/** rel: relative tolerance; abs floor for values near zero */
function check(name: string, got: number, want: number, rel = 0.02, note?: string, abs = 1e-3) {
  const tol = Math.max(Math.abs(want) * rel, abs);
  rows.push({ name, got: +got.toPrecision(6), want: +want.toPrecision(6), tol: +tol.toPrecision(3), pass: Math.abs(got - want) <= tol, note });
}
function guard(name: string, fn: () => void) { try { fn(); } catch (e) { errors.push(name + ': ' + (e instanceof Error ? e.message : String(e))); } }
const g = 10;

guard('chase', () => {
  const r = run('chase', { a: 3, v: 6 });
  check('追及 t=2s 汽车速度 = 自行车速度 6 m/s', S(r, 'car', 2).vx, 6);
  check('追及 最大距离 6 m', S(r, 'bike', 2).x - S(r, 'car', 2).x - (S(r, 'bike', 0).x - S(r, 'car', 0).x), 6);
  check('追及 t=4s 相遇（位移差 0，24 m 行程容差 0.2%）', S(r, 'bike', 4).x - S(r, 'car', 4).x, 0, 0, '半隐式欧拉偏差 ≈ a·Δt·t/2', 0.05);
  const r2 = run('chase', { a: 2, v: 6, d0: 16 });
  check('追及 领先 16 m：最大距离 16+v²/2a = 25 m（t=3s）', S(r2, 'bike', 3).x - S(r2, 'car', 3).x, 25);
  check('追及 领先 16 m：t=8s 相遇（64 m 行程容差 0.2%）', S(r2, 'bike', 8).x - S(r2, 'car', 8).x, 0, 0, '半隐式欧拉偏差 ≈ a·Δt·t/2', 0.13);
});
guard('belt-h', () => {
  const r = run('belt-h', { v: 2, mu: 0.2, L: 4, v0: 0, m: 1 });
  check('水平传送带 a=μg：t=0.5s 速度 1 m/s', speed(S(r, 'A', 0.5)), 1);
  check('水平传送带 共速前位移 1 m（t=1s）', disp(r, 'A', 1), 1);
  check('水平传送带 共速后匀速 2 m/s（t=1.8s）', speed(S(r, 'A', 1.8)), 2);
});
guard('incline', () => {
  let r = run('incline', { th: 30, mu: 0, m: 2, L: 8, v0: 0 });
  check('光滑斜面 a=g·sinθ：t=0.8s 速度 4 m/s', speed(S(r, 'A', 0.8)), 4);
  r = run('incline', { th: 37, mu: 0.25, m: 2, L: 8, v0: 0 });
  const a = g * (Math.sin(37 * Math.PI / 180) - 0.25 * Math.cos(37 * Math.PI / 180));
  check('粗糙斜面 a=g(sinθ−μcosθ)：t=1s 速度', speed(S(r, 'A', 1)), a);
  r = run('incline', { th: 20, mu: 0.5, m: 2, L: 8, v0: 0 });
  check('μ>tanθ 物块静止：t=1s 速度 0', speed(S(r, 'A', 1)), 0);
});
guard('collision', () => {
  let r = run('collision', { m1: 2, m2: 1, v1: 3, v2: -1, e: 1 });
  const T = r.duration;
  check('弹性碰撞 A 末速度 1/3 m/s', S(r, 'A', T).vx, 1 / 3);
  check('弹性碰撞 B 末速度 13/3 m/s', S(r, 'B', T).vx, 13 / 3);
  r = run('collision', { m1: 2, m2: 1, v1: 3, v2: -1, e: 0 });
  check('完全非弹性 共同速度 5/3 m/s', S(r, 'A', r.duration).vx, 5 / 3);
  check('完全非弹性 B 同速', S(r, 'B', r.duration).vx, 5 / 3);
});
guard('recoil', () => {
  const r = run('recoil', { m1: 1, m2: 2, k: 400, dx: 0.15 });
  const v2 = Math.sqrt(0.5 * 400 * 0.15 ** 2 / 3), T = r.duration;
  check('反冲 A 速度大小 2·v_B', Math.abs(S(r, 'A', T).vx), 2 * v2);
  check('反冲 B 速度大小 √(kΔx²/(3m₁))', Math.abs(S(r, 'B', T).vx), v2);
  check('反冲 总动量 0', S(r, 'A', T).vx * 1 + S(r, 'B', T).vx * 2, 0);
});
guard('person-boat', () => {
  const r = run('person-boat', { m: 50, M: 100, L: 3, u: 1 });
  const T = r.duration;
  check('人船 人对地位移 ML/(m+M)=2 m', Math.abs(S(r, 'A', T).x - S(r, 'A', 0).x), 2, 0.03);
  check('人船 船对地位移 mL/(m+M)=1 m', Math.abs(S(r, 'B', T).x - S(r, 'B', 0).x), 1, 0.03);
});
guard('projectile', () => {
  const r = run('projectile', { h: 20, v0: 10, dt: 0.2 });
  const b = S(r, 'A', 1);
  check('平抛 t=1s 水平速度 10', Math.abs(b.vx), 10);
  check('平抛 t=1s 竖直速度 gt=10', Math.abs(b.vy), 10);
  check('平抛 t=1s 下落 5 m', S(r, 'A', 1).y - S(r, 'A', 0).y, 5);
  const land = r.events.find((e) => e.kind === 'land' && e.id === 'A');
  if (land) check('平抛 落地时间 √(2h/g)=2 s', land.t, 2, 0.02); else errors.push('projectile: 没有落地事件');
});
guard('circle-vertical', () => {
  const r = run('circle-vertical', { mode: 0, R: 0.4, v0: 4.5, m: 0.5 });
  const i = r.bodyIndex('A');
  const vmin = Math.min(...r.frames.map((f) => Math.hypot(f.b[i].vx, f.b[i].vy)));
  check('竖直圆周 最高点速度 √(v₀²−4gR)', vmin, Math.sqrt(4.5 ** 2 - 4 * g * 0.4), 0.03);
});
guard('spring', () => {
  const r = run('spring', { m: 1, k: 100, A: 0.1 });
  const T = 2 * Math.PI / 10, i = r.bodyIndex('A');
  check('弹簧振子 一个周期后回到原位', Math.abs(S(r, 'A', T).x - S(r, 'A', 0).x), 0, 0, '周期 2π√(m/k)');
  const vmax = Math.max(...r.frames.filter((f) => f.t <= T).map((f) => Math.abs(f.b[i].vx)));
  check('弹簧振子 最大速度 Aω = 1 m/s', vmax, 1);
});
guard('pendulum', () => {
  const r = run('pendulum', { L: 1, th: 5, m: 0.2 });
  const T = 2 * Math.PI * Math.sqrt(1 / g) * (1 + (5 * Math.PI / 180) ** 2 / 16);
  const a = S(r, 'A', 0), b = S(r, 'A', T);
  check('单摆 一个周期后回到原位（mm，容差 0.5）', Math.hypot(b.x - a.x, b.y - a.y) * 1000, 0, 0, '周期 2π√(L/g)', 0.5);
  const i = r.bodyIndex('A');
  const vmax = Math.max(...r.frames.filter((f) => f.t <= T).map((f) => Math.hypot(f.b[i].vx, f.b[i].vy)));
  check('单摆 最低点速度 √(2gL(1−cosθ))', vmax, Math.sqrt(2 * g * 1 * (1 - Math.cos(5 * Math.PI / 180))));
});
guard('pulley', () => {
  const r = run('pulley', { mode: 0, mA: 3, mB: 2, mu: 0.2, h: 1 });
  check('滑轮连接体 a=(m_B−μm_A)g/(m_A+m_B)：t=0.5s 速度', speed(S(r, 'B', 0.5)), (2 - 0.2 * 3) * g / 5 * 0.5);
  check('滑轮连接体 A、B 速率相同', speed(S(r, 'A', 0.5)), speed(S(r, 'B', 0.5)));
  const r2 = run('pulley', { mode: 1, mA: 3, mB: 2, mu: 0, h: 1 });
  check('阿特伍德机 a=(m_A−m_B)g/(m_A+m_B)：t=0.5s 速度', speed(S(r2, 'A', 0.5)), (3 - 2) * g / 5 * 0.5);
});
guard('plank', () => {
  const r = run('plank', { v0: 6, mu1: 0.2, mu2: 0, m: 1, M: 2, L: 8 });
  check('板块 共速 2 m/s（块）', speed(S(r, 'A', 3)), 2);
  check('板块 共速 2 m/s（板）', speed(S(r, 'B', 3)), 2);
  check('板块 t=1s 块速度 6−μ₁g·t = 4', speed(S(r, 'A', 1)), 4);
});
guard('magnetic', () => {
  const r = run('magnetic', { mU: 1, qe: 1, v: 1, B: 0.5 });
  const i = r.bodyIndex('A');
  const left = r.events.find((e) => e.kind === 'field' && e.label.startsWith('离开'));
  if (!left) { errors.push('magnetic: 粒子没有离开磁场'); return; }
  check('磁场 射出点距入射点 2R = 2mv/(qB)（mm）', Math.abs(r.frames[0].b[i].y - left.y) * 1000, 2 * 1.67e-27 * 1e6 / (1.6e-19 * 0.5) * 1000, 0.01);
  const mid = r.frame(left.t * 0.8).b[i];
  check('磁场 洛伦兹力不做功：速率不变', speed(mid), speed(r.frames[0].b[i]), 0.005);
});
guard('efield', () => {
  const r = run('efield', { U: 100, d: 2, L: 8, v0: 3 });
  const i = r.bodyIndex('A'), y0 = r.frames[0].b[i].y;
  const Lm = 0.08, a = 1.6e-19 * 100 / (9.1e-31 * 0.02), v0 = 3e7;
  const want = 0.5 * a * (Lm / v0) ** 2;
  const plates = r.scene.objs.find((o) => o.id === 'plates')!;
  const xOut = (plates.x + plates.w / 2) / r.ppm;
  // 粒子先匀速飞到极板左缘；取水平位置到达极板右缘时的竖直偏移
  const fr = r.frames.find((f) => f.b[i].x >= xOut);
  if (!fr) { errors.push('efield: 粒子没有穿出极板'); return; }
  check('电场偏转 y = qUL²/(2mdv₀²)（mm）', Math.abs(fr.b[i].y - y0) * 1000, want * 1000, 0.03);
});

const failed = rows.filter((r) => !r.pass);
console.table(rows.map((r) => ({ 检查: r.name, 引擎: r.got, 理论: r.want, 容差: r.tol, 结果: r.pass ? '通过' : '不通过' })));
if (errors.length) console.log('错误：\n' + errors.join('\n'));
const report = { at: new Date().toISOString(), passed: !failed.length && !errors.length, total: rows.length, failed: failed.length, rows, errors };
fs.mkdirSync(path.resolve('..', 'reports'), { recursive: true });
fs.writeFileSync(path.resolve('..', 'reports', 'physics-analytic.json'), JSON.stringify(report, null, 2));
console.log(`${rows.length - failed.length}/${rows.length} 通过，${errors.length} 个错误`);
process.exit(report.passed ? 0 : 1);
