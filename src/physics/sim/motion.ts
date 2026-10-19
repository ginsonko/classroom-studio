// 演示"会不会动"的自检：把场景完整算一遍，看物体在画面上实际移动了多少。
// AI 给出的自由场景常见问题是物体被放在平衡位置、没有初速度，播放时画面完全静止。
import type { Scene } from '../model';
import { SimRun } from './engine';

export interface Motion { moving: boolean; maxMove: number; maxTurn: number; bodies: number; reason: string }

/** 画面上至少移动 1.5% 页宽，或转动超过约 6° 才算"在动" */
export function motionCheck(scene: Scene, budgetSec = 12): Motion {
  let run: SimRun;
  try { run = new SimRun({ ...scene, duration: Math.min(scene.duration ?? 8, budgetSec) }, { full: true, events: [] }); }
  catch (e) { return { moving: false, maxMove: 0, maxTurn: 0, bodies: 0, reason: '场景无法计算：' + (e instanceof Error ? e.message : String(e)) }; }
  const n = run.bodies.length;
  if (!n) return { moving: false, maxMove: 0, maxTurn: 0, bodies: 0, reason: '场景里没有会运动的物体（只有斜面、地面等固定器材）' };
  let maxMove = 0, maxTurn = 0;
  const T = run.computed, samples = 48;
  for (let bi = 0; bi < n; bi++) {
    const a = run.objAt(bi, 0);
    for (let k = 1; k <= samples; k++) {
      const b = run.objAt(bi, (T * k) / samples);
      if (![b.x, b.y, b.rot].every(Number.isFinite)) return { moving: false, maxMove, maxTurn, bodies: n, reason: '计算结果出现无效数值（参数可能不合理）' };
      maxMove = Math.max(maxMove, Math.hypot(b.x - a.x, b.y - a.y));
      maxTurn = Math.max(maxTurn, Math.abs(b.rot - a.rot));
    }
  }
  const moving = maxMove > 0.015 || maxTurn > 0.1;
  return { moving, maxMove, maxTurn, bodies: n, reason: moving ? '' : `播放 ${T.toFixed(1)} 秒，物体最多只移动了画面宽度的 ${(maxMove * 100).toFixed(1)}%（几乎静止）` };
}
