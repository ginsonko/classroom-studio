// 学习地图的纯逻辑：按作答自动更新哪些格子、哪些只给建议。
import { localOf, pointKey, type SubjectPack } from './subjects';
import { suggestState, type Mastery } from './studyLogic';
import type { ChapterState } from './types';

export type Grid = ChapterState[][];
export interface MapChange { key: string; ci: number; si: number; from: ChapterState; to: ChapterState }
/** apply：自动改的；suggest：只提醒老师（标薄弱、从薄弱恢复） */
export interface MapPlan { apply: MapChange[]; suggest: MapChange[] }

export const STATE_NAME: Record<ChapterState, string> = { none: '未学', learning: '在学', done: '已掌握', weak: '薄弱' };
const RANK: Record<ChapterState, number> = { none: 0, learning: 1, done: 2, weak: -1 };

/** 补齐成和课本一样大的表格（没标过的是「未学」） */
export const fullGrid = (pack: SubjectPack, g?: Grid): Grid => pack.chapters.map((c, ci) => c.sec.map((_, si) => g?.[ci]?.[si] ?? 'none'));

/**
 * 自动更新只往前走：未学 → 在学 → 已掌握。往回退（标薄弱）、把老师标的薄弱改掉，都只当建议。
 * keys 给了就只看这些知识点（这节课练到的）。
 */
export function planMap(pack: SubjectPack, grid: Grid, ms: Map<string, Mastery>, keys?: Set<string>): MapPlan {
  const apply: MapChange[] = [], suggest: MapChange[] = [];
  for (const m of ms.values()) {
    if (keys && !keys.has(m.key)) continue;
    const at = localOf(m.key);
    if (!at || pointKey(pack, at.ci, at.si) !== m.key) continue;
    const from = grid[at.ci]?.[at.si];
    const to = suggestState(m);
    if (from === undefined || !to || to === from) continue;
    const c = { key: m.key, ci: at.ci, si: at.si, from, to };
    if (to === 'weak' || from === 'weak') suggest.push(c);
    else if (RANK[to] > RANK[from]) apply.push(c);
  }
  return { apply, suggest };
}

export function applyMap(grid: Grid, changes: MapChange[]): Grid {
  const next = grid.map((row) => [...row]);
  for (const c of changes) if (next[c.ci]?.[c.si] !== undefined) next[c.ci][c.si] = c.to;
  return next;
}
/** 撤销：还是自动改成的样子才放回去，老师之后手动改过的不动 */
export function undoMap(grid: Grid, changes: MapChange[]): { grid: Grid; restored: number } {
  const next = grid.map((row) => [...row]);
  let restored = 0;
  for (const c of changes) if (next[c.ci]?.[c.si] === c.to) { next[c.ci][c.si] = c.from; restored++; }
  return { grid: next, restored };
}
