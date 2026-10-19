// AI 演示的「试播」工具：把场景真的算一遍，给模型一份文字运动摘要 + 4 帧截图，
// 让它对照题目检查（谁在动、往哪动、关键事件是否发生），不对就自己改。
import type { Scene } from '../model';
import { DYN_KINDS, SimRun } from './engine';
import { motionCheck, type Motion } from './motion';
import { clampParams, presetFor } from './presets';
import { PAPER, type SD } from './prim';
import { drawSim } from './render';
import { resolveColor } from '../../lib/palette';

export interface Trial { text: string; image: string; motion: Motion; ok: boolean }

const f = (v: number, d = 3) => {
  if (!Number.isFinite(v)) return '∞';
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential(2) : String(+v.toFixed(d));
};

function runOf(scene: Scene): SimRun {
  const pre = presetFor(scene.preset);
  return new SimRun(scene, { full: true, events: pre?.events });
}

/** 运动摘要：以米、秒为单位（微观场景同时给出真实时间） */
export function describeRun(run: SimRun, motion: Motion): string {
  const ts = run.ts, T = run.computed, ppm = run.ppm, H = 900 / 1600;
  const real = (t: number) => (ts !== 1 ? `${f(t)} s（真实 ${f(t * ts)} s）` : `${f(t)} s`);
  const lines = [`播放时长 ${real(T)}；比例尺 1 m = ${f(ppm)} 页宽；画面范围约 ${f(1 / ppm)} m × ${f(H / ppm)} m。`];
  run.bodies.slice(0, 8).forEach((b, i) => {
    const a = run.state(i, 0), z = run.state(i, T);
    let vmax = 0, path = 0, px = a.x, py = a.y, out = -1, minY = a.y, maxY = a.y, minX = a.x, maxX = a.x;
    const n = 120;
    for (let k = 1; k <= n; k++) {
      const t = (T * k) / n, s = run.state(i, t);
      vmax = Math.max(vmax, Math.hypot(s.vx, s.vy));
      path += Math.hypot(s.x - px, s.y - py); px = s.x; py = s.y;
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
      const X = s.x * ppm, Y = s.y * ppm;
      if (out < 0 && (X < -0.02 || X > 1.02 || Y < -0.02 || Y > H + 0.02)) out = t;
    }
    const name = `${b.obj.label || b.id}（${b.obj.kind}${b.kind === 'particle' ? '，带电粒子' : ''}）`;
    const v0 = Math.hypot(a.vx, a.vy), v1 = Math.hypot(z.vx, z.vy);
    lines.push(`- ${name}：起点 (${f(a.x)}, ${f(-a.y)}) m，终点 (${f(z.x)}, ${f(-z.y)}) m（y 向上为正）；初速度 ${f(v0)} m/s → 末速度 ${f(v1)} m/s，最大 ${f(vmax)} m/s；`
      + `路程 ${f(path)} m；水平范围 ${f(minX)}~${f(maxX)} m，竖直范围 ${f(-maxY)}~${f(-minY)} m${out >= 0 ? `；在 ${real(out)} 跑出画面` : ''}${z.alive === false ? '；中途消失（离开场区或被吸收）' : ''}。`);
  });
  if (run.bodies.length > 8) lines.push(`- 另有 ${run.bodies.length - 8} 个运动物体未列出。`);
  const ev = run.events.slice(0, 12).map((e) => `${real(e.t)} ${e.label}`);
  lines.push(ev.length ? '关键事件：' + ev.join('；') : '没有检测到碰撞、离开、落地、共速等事件。');
  if (!motion.moving) lines.push('⚠ 静止检查不通过：' + motion.reason);
  return lines.join('\n');
}

/** 2×2 四帧截图（0、⅓、⅔、结束），带轨迹和速度矢量 */
export function contactSheet(run: SimRun, scene: Scene): string {
  const W = 1280, H = 720, w = W / 2, h = H / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#d9dee6'; ctx.fillRect(0, 0, W, H);
  const pre = presetFor(scene.preset), params = pre ? clampParams(pre, scene.params ?? {}) : (scene.params ?? {});
  const T = run.computed, times = [0, T / 3, (2 * T) / 3, T];
  times.forEach((t, k) => {
    const ox = (k % 2) * w, oy = Math.floor(k / 2) * h;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox + 2, oy + 2, w - 4, h - 4); ctx.clip();
    ctx.fillStyle = PAPER.white; ctx.fillRect(ox, oy, w, h);
    ctx.setTransform(w, 0, 0, w, ox, oy);
    const d: SD = { ctx, scale: w, dark: false, paper: PAPER.white, color: (x) => resolveColor(x, 'white', false) };
    try { drawSim(d, run, t, { preset: pre, params, ov: { v: true, f: false, trail: true, graph: false, formula: false }, ratio: 900 / 1600 }); } catch { /* 单帧画失败不影响其他帧 */ }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(20,24,32,.78)'; ctx.fillRect(ox + 8, oy + 8, 128, 26);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.fillText(`${'①②③④'[k]} t = ${f(t, 2)} s`, ox + 16, oy + 27);
    ctx.restore();
  });
  return c.toDataURL('image/jpeg', 0.82);
}

/** 试播一个已经通过校验的场景 */
export function trial(scene: Scene): Trial {
  const motion = motionCheck(scene);
  let run: SimRun;
  try { run = runOf(scene); }
  catch (e) { return { text: '场景无法计算：' + (e instanceof Error ? e.message : String(e)), image: '', motion, ok: false }; }
  const movers = run.bodies.filter((b) => b.kind === 'particle' || DYN_KINDS.has(b.obj.kind)).length;
  const text = describeRun(run, motion) + (movers ? '' : '\n⚠ 场景里没有会运动的物体。');
  let image = '';
  try { image = contactSheet(run, scene); } catch { /* 没有画布时只给文字 */ }
  return { text, image, motion, ok: motion.moving };
}
