// 试播文字摘要：把规格在本机跑一遍，给模型一段可以核对的文字（不依赖渲染，Node 里也能算）。
import type { S3DSpec } from './spec';
import { World, type V3 } from './world';

const f = (v: number) => String(Math.round(v * 100) / 100);
const pv = (p: V3 | null) => (p ? `(${p.map(f).join(',')})` : '?');

/** 给模型自检用的运行摘要 */
export function summarize(spec: S3DSpec): string {
  const w = new World(spec);
  const D = spec.duration;
  const lines: string[] = [`模式 ${spec.mode === 'motion' ? '运动' : '静态'} · 时长 ${D}s · ${spec.objects.length} 个对象 · 默认机位 ${spec.camera}`];
  if (spec.params.length) lines.push('参数：' + spec.params.map((p) => `${p.label}=${f(w.params[p.key] ?? p.value)}${p.unit ?? ''}（${p.min}~${p.max}）`).join('，'));
  const movers: string[] = [];
  const stills: string[] = [];
  for (const o of spec.objects) {
    if (o.type === 'arrow' || o.type === 'label' || o.type === 'angle' || o.type === 'measure') continue;
    let p0: V3 | null = null, maxD = 0, pEnd: V3 | null = null;
    try {
      p0 = w.pos(o.id, 0);
      pEnd = w.pos(o.id, D);
      for (const k of [0.2, 0.4, 0.6, 0.8, 1]) {
        const p = w.pos(o.id, k * D);
        if (p && p0) maxD = Math.max(maxD, Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]));
      }
    } catch { /* 有些类型没有位置概念 */ }
    const name = o.id + (typeof o.label === 'string' && o.label ? `（${o.label.slice(0, 12)}）` : '');
    if (maxD > 0.02) movers.push(`${name}: ${pv(p0)} → ${pv(pEnd)}`);
    else if (p0) stills.push(name);
  }
  if (movers.length) lines.push('在动：' + movers.slice(0, 6).join('；'));
  if (stills.length) lines.push('静止：' + stills.slice(0, 10).join('、') + (stills.length > 10 ? ` 等 ${stills.length} 个` : ''));
  if (spec.mode === 'motion' && !movers.length) lines.push('⚠ 这是运动题但没有任何物体在动，请检查 motion 配方或含 t 的公式');
  if (spec.steps.length) lines.push('步骤：' + spec.steps.map((s, i) => `第${i + 1}步「${s.say.slice(0, 24)}」`).join(' '));
  if (spec.charts.length) lines.push('图表：' + spec.charts.map((c) => `「${c.title}」`).join(' '));
  try {
    const b = w.bounds();
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    lines.push(`画面范围约 ${size.map(f).join('×')}（世界坐标单位）`);
    if (Math.max(...size) > 60) lines.push('⚠ 场景太大了，主体请控制在 2~20 个单位，按比例缩小并写进 notes');
  } catch { /* bounds 失败不挡路 */ }
  return lines.join('\n');
}
