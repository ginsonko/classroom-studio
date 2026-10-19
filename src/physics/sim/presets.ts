// ── 预设注册表与候选工程兼容入口 ───────────────────────────────
import type { Material } from '../../lib/types';
import type { Scene } from '../model';
import { EM } from './presetsEM';
import { MECH } from './presetsMech';
import type { P, Preset } from './presetKit';

export type { P, Preset, ParamDef } from './presetKit';
export const PRESETS: Preset[] = [...MECH, ...EM];
const BY_ID = new Map(PRESETS.map((pre) => [pre.id, pre]));

export function presetFor(id?: string): Preset | undefined { return id ? BY_ID.get(id) : undefined; }
export const presetById = presetFor;

export function defaultParams(pre: Preset): P {
  return Object.fromEntries(pre.params.map((d) => [d.key, d.def]));
}

/** 把旧入口的参数、同步参数和 AI 草稿参数夹到 rich preset 的定义范围内。 */
export function clampParams(pre: Preset, raw: Record<string, unknown> = {}): P {
  const out: P = {};
  for (const d of pre.params) {
    let v = Number(raw[d.key]);
    if (!Number.isFinite(v)) v = d.def;
    if (d.options?.length && !d.options.some((x) => x.v === v)) {
      v = d.options.reduce((a, x) => Math.abs(x.v - v) < Math.abs(a - v) ? x.v : a, d.options[0].v);
    }
    out[d.key] = Math.max(d.min, Math.min(d.max, v));
  }
  const g = Number(raw.g);
  if (Number.isFinite(g) && g > 0 && g < 30) out.g = g;
  return out;
}

/** 兼容旧的参数控制条形状。options 预设在旧控件里退化为范围控件。 */
export function objectParam(id: string, key: string) { return `object:${encodeURIComponent(id)}:${key}`; }
export interface Param { key: string; label: string; unit: string; min: number; max: number; step: number; value: number }
export function legacyParams(pre: Preset, values: Record<string, number>): Param[] {
  return pre.params.map((d) => ({ key: d.key, label: d.label, unit: d.unit ?? '', min: d.min, max: d.max, step: d.step, value: values[d.key] ?? d.def }));
}

export function buildPreset(id: string, raw: Record<string, unknown> = {}): Scene | null {
  const pre = presetFor(id);
  return pre ? { ...pre.build(clampParams(pre, raw)), preset: id, title: pre.title } : null;
}

export function makePreset(id: string, values: Record<string, number> = {}, unique = true): Material {
  const pre = presetFor(id) ?? PRESETS[0];
  const params = clampParams(pre, values);
  const built = pre.build(params);
  const scene = { ...built, title: pre.title, preset: pre.id, params: { ...(built.params ?? {}), ...params } };
  return { id: `sim:${pre.id}${unique ? ':' + crypto.randomUUID() : ''}`, kind: 'sim', title: pre.title, pages: [{ w: 1600, h: 900 }], total: 1, scene };
}

export function resolveScene(mat: Material, params: Record<string, number>): Scene {
  const pre = presetFor(mat.scene?.preset ?? (mat.id === 'sim:chase' ? 'chase' : undefined));
  if (pre) {
    const p = clampParams(pre, params);
    const built = pre.build(p);
    return { ...built, title: pre.title, preset: pre.id, params: { ...(built.params ?? {}), ...p } };
  }
  if (!mat.scene) throw new Error('这个演示没有物理场景，请重新选择模板或从当前器材创建。');
  const base = mat.scene;
  const objParams = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('object:')));
  return {
    ...base,
    world: { ...base.world, g: Number.isFinite(params.g) ? params.g : base.world.g },
    params: { ...(base.params ?? {}), ...params },
    objs: base.objs.map((o) => ({
      ...o,
      props: {
        ...o.props,
        ...Object.fromEntries(Object.entries(objParams).filter(([k]) => k.startsWith(`object:${encodeURIComponent(o.id)}:`)).map(([k, v]) => [decodeURIComponent(k.slice(`object:${encodeURIComponent(o.id)}:`.length)), v])),
      },
    })),
  };
}

export function initialParams(mat: Material) {
  const pre = presetFor(mat.scene?.preset ?? (mat.id === 'sim:chase' ? 'chase' : undefined));
  return pre ? clampParams(pre, mat.scene?.params ?? defaultParams(pre)) : { g: mat.scene?.world.g ?? 10, ...(mat.scene?.params ?? {}) };
}
export function materialWithParams(mat: Material, params: Record<string, number>): Material {
  return { ...mat, kind: 'sim', scene: resolveScene(mat, params) };
}
