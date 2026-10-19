// ── 仿真时钟与控制兼容层 ───────────────────────────────────────
// program 使用 store.sim 广播给学生；preview 使用本地 Zustand 时钟。
// 同一套 SimSync 同时服务候选旧入口和 Claude rich SimControls。
import { create } from 'zustand';
import type { Material } from '../../lib/types';
import { ROLE, useStore } from '../../lib/store';
import type { SimSync } from '../model';
import type { Ov } from './presetKit';
import { clampParams, defaultParams, presetById } from './presets';

export type SimScope = 'program' | 'preview';
export const DEFAULT_OVERLAYS = { v: false, f: false, trail: true, graph: true, formula: true } as const;

export function withClockDefaults(clock: SimSync): SimSync {
  return { ...clock, overlays: { ...DEFAULT_OVERLAYS, ...(clock.overlays ?? {}) } };
}
export function initialClock(matId: string, params: Record<string, number>, rev = 0): SimSync {
  return { matId, playing: false, startedAt: 0, offset: 0, rate: 1, rev, params: { ...params }, overlays: { ...DEFAULT_OVERLAYS } };
}
export function initialSync(mat: Material): SimSync {
  const pre = presetById(mat.scene?.preset);
  const params = pre ? clampParams(pre, mat.scene?.params ?? defaultParams(pre)) : { ...(mat.scene?.params ?? {}) };
  const ov: Ov = { ...DEFAULT_OVERLAYS, ...(pre?.overlays ?? {}) };
  return { ...initialClock(mat.id, params), overlays: ov };
}
export function timeAt(clock: SimSync | null | undefined, now: number, duration: number): number {
  if (!clock) return 0;
  const t = clock.offset + (clock.playing ? Math.max(0, now - clock.startedAt) / 1000 * (clock.rate || 1) : 0);
  return Math.max(0, Math.min(duration, Number.isFinite(t) ? t : 0));
}
export const simTime = (clock: SimSync | null | undefined, duration: number, now = Date.now()) => timeAt(clock, now, duration);

interface LocalSims { m: Record<string, SimSync>; put: (s: SimSync) => void }
export const useLocalSims = create<LocalSims>()((set) => ({ m: {}, put: (s) => set((st) => ({ m: { ...st.m, [s.matId]: s } })) }));

export function onAir(matId: string) { return useStore.getState().pgmMat.id === matId; }
export function currentSync(mat: Material, scope: SimScope = 'program'): SimSync {
  const shared = useStore.getState().sim;
  if (scope === 'program' && shared && shared.matId === mat.id && (onAir(mat.id) || ROLE === 'student')) return withClockDefaults(shared);
  const local = useLocalSims.getState().m[mat.id];
  if (local) return local;
  return scope === 'program' && shared?.matId === mat.id ? withClockDefaults(shared) : initialSync(mat);
}
export function writeSync(mat: Material, next: SimSync, scope: SimScope = 'program') {
  const safe = withClockDefaults(next);
  useLocalSims.getState().put(safe);
  if (scope === 'program' && onAir(mat.id) && ROLE !== 'student') useStore.getState().setShared({ sim: safe });
}

export type ClockAction =
  | { type: 'play' | 'pause' | 'reset' }
  | { type: 'seek'; time: number }
  | { type: 'rate'; rate: number }
  | { type: 'params'; params: Record<string, number> }
  | { type: 'overlay'; key: keyof Ov; value: boolean };

export function changeClock(c: SimSync, action: ClockAction, now: number, duration: number): SimSync {
  c = withClockDefaults(c);
  const t = timeAt(c, now, duration);
  const next: SimSync = { ...c, offset: t, startedAt: now, rev: c.rev + 1 };
  switch (action.type) {
    case 'play': return { ...next, playing: true, offset: t >= duration - 1e-6 ? 0 : t };
    case 'pause': return { ...next, playing: false };
    case 'reset': return { ...next, playing: false, offset: 0 };
    case 'seek': return { ...next, playing: false, offset: Math.max(0, Math.min(duration, Number.isFinite(action.time) ? action.time : 0)) };
    case 'rate': return { ...next, rate: Math.max(.1, Math.min(4, action.rate)) };
    case 'params': return { ...next, playing: false, offset: 0, params: { ...c.params, ...action.params } };
    case 'overlay': return { ...next, overlays: { ...c.overlays, [action.key]: action.value } };
  }
}

function cmd(mat: Material, duration: number, action: ClockAction, scope: SimScope = 'program') {
  const current = currentSync(mat, scope), now = Date.now();
  const next = changeClock(current, action, now, duration);
  writeSync(mat, next, scope);
  return next;
}
export const play = (mat: Material, duration: number, scope: SimScope = 'program') => cmd(mat, duration, currentSync(mat, scope).playing ? { type: 'pause' } : { type: 'play' }, scope);
export const reset = (mat: Material, duration: number, scope: SimScope = 'program') => cmd(mat, duration, { type: 'reset' }, scope);
export const seek = (mat: Material, duration: number, t: number, scope: SimScope = 'program') => cmd(mat, duration, { type: 'seek', time: t }, scope);
export const setRate = (mat: Material, duration: number, rate: number, scope: SimScope = 'program') => cmd(mat, duration, { type: 'rate', rate }, scope);
export const setOverlay = (mat: Material, duration: number, ov: Ov, scope: SimScope = 'program') => {
  let next = currentSync(mat, scope);
  for (const [key, value] of Object.entries(ov)) if (value !== undefined) next = changeClock(next, { type: 'overlay', key: key as keyof Ov, value: !!value }, Date.now(), duration);
  writeSync(mat, next, scope); return next;
};
export const setParams = (mat: Material, duration: number, params: Record<string, number>, scope: SimScope = 'program') => cmd(mat, duration, { type: 'params', params }, scope);

