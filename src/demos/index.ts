// 数学 / 化学演示目录：按学科列出、按 id 查找、生成可上屏的课件。
import type { Material } from '../lib/types';
import { kitOf, type SubjectId } from '../lib/subjects';
import { MATH_DEMOS } from './mathDemos';
import { CHEM_DEMOS } from './chemDemos';
import { clampDemo, type DemoDef } from './kit';

export const DEMOS: DemoDef[] = [...MATH_DEMOS, ...CHEM_DEMOS];
const BY_ID = new Map(DEMOS.map((d) => [d.id, d]));
export const demoById = (id?: string) => (id ? BY_ID.get(id) : undefined);
/** 按学科大类取演示目录：初中 / 小学数学和高中数学共用数学演示，化学同理 */
export const demosOf = (subject: SubjectId) => { const k = kitOf(subject); return k ? DEMOS.filter((d) => d.subject === k) : []; };
/** 课件是不是数学 / 化学演示（物理仿真走 SimHost） */
export const isKitDemo = (mat: Material) => mat.kind === 'sim' && !!demoById(mat.scene?.preset);

export function makeDemo(id: string, values: Record<string, unknown> = {}, o: { title?: string; text?: string } = {}): Material {
  const d = demoById(id) ?? DEMOS[0];
  const params = clampDemo(d, values);
  return {
    id: `sim:${d.id}:${crypto.randomUUID()}`, kind: 'sim', title: o.title || d.title, pages: [{ w: 1600, h: 900 }], total: 1,
    scene: { title: o.title || d.title, preset: d.id, objs: [], world: { g: 0, ppm: 1 }, params, duration: d.duration, ...(o.text ? { text: o.text } : {}) },
  };
}

export const COEF = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
/** 改选项时一起要改的参数：换了反应就把系数清回 1，免得沿用上一个反应的系数 */
export const pickPatch = (key: string, v: number): Record<string, number> =>
  key === 'rx' ? { rx: v, show: 0, ...Object.fromEntries(COEF.map((k) => [k, 1])) } : { [key]: v };

/** 规则挑演示：按题眼关键词打分，最高分的那个 */
export function guessDemo(text: string, subject: SubjectId): DemoDef | null {
  let best: DemoDef | null = null, score = 0;
  for (const d of demosOf(subject)) {
    const s = d.keywords.reduce((n, k) => n + (typeof k === 'string' ? (text.includes(k) ? k.length : 0) : k.test(text) ? 3 : 0), 0);
    if (s > score) { score = s; best = d; }
  }
  return best;
}

export type { DemoDef } from './kit';
