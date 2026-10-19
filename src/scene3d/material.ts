// 立体演示 → 课件（Material）。沿用 kind='sim' 和占位 scene，这样上屏、共享时钟、导播台的时长 / 参数都不用改。
import type { Material } from '../lib/types';
import type { S3DSpec } from './spec';
import { paramDefaults } from './validate';

export const S3D_PRESET = 's3d';
export const isS3D = (mat: Material | null | undefined): mat is Material & { s3d: S3DSpec } => !!mat && mat.kind === 'sim' && !!mat.s3d;

export function makeS3DMaterial(spec: S3DSpec, o: { title?: string } = {}): Material {
  const title = o.title || spec.title || '立体演示';
  return {
    id: `sim:s3d:${crypto.randomUUID()}`, kind: 'sim', title, pages: [{ w: 1600, h: 900 }], total: 1,
    scene: { title, preset: S3D_PRESET, objs: [], world: { g: 10, ppm: 1 }, params: paramDefaults(spec), duration: spec.duration },
    s3d: spec,
  };
}
/** 当前参数：规格默认值 ← 课件里存的 ← 时钟里的（只认规格里声明过的键） */
export function s3dParams(spec: S3DSpec, ...layers: (Record<string, number> | undefined)[]): Record<string, number> {
  const out = paramDefaults(spec);
  for (const l of layers) if (l) for (const p of spec.params) { const v = Number(l[p.key]); if (Number.isFinite(v)) out[p.key] = Math.max(p.min, Math.min(p.max, v)); }
  return out;
}
