// 学习地图的自动更新（下课时按这节课的作答）、助教改地图，都记一笔，可以撤销。
import { create } from 'zustand';
import { host } from './host';
import { useStore } from './store';
import { useStudy } from './studyStore';
import { mastery, pointLabel } from './studyLogic';
import { localOf, mapKey, packOf, pointKey, studentSubject } from './subjects';
import { isGroup, membersOf } from './groups';
import { applyMap, fullGrid, planMap, STATE_NAME, undoMap, type MapChange } from './mapLogic';
import { toast } from './toast';
import type { ChapterState } from './types';

export interface MapRun { id: string; at: number; studentId: string; key: string; changes: MapChange[]; suggest: MapChange[]; why: string; undone?: boolean }
export const useMapLog = create<{ runs: MapRun[] }>()(() => ({ runs: [] }));
const log = (r: MapRun) => useMapLog.setState((s) => ({ runs: [...s.runs, r].slice(-50) }));

const gridOf = (studentId: string) => {
  const st = useStore.getState(), stu = st.students.find((s) => s.id === studentId), subject = studentSubject(stu), pack = packOf(subject), key = mapKey(studentId, subject);
  return { pack, key, subject, grid: fullGrid(pack, st.learning[key]) };
};
export const setGrid = (key: string, grid: ChapterState[][]) => { const st = useStore.getState(); st.set({ learning: { ...st.learning, [key]: grid } }); };

/** 一位学生（不是班组）：since 之后作答过的知识点按掌握度往前推 */
export function updateMapFor(studentId: string, since: number, why: string): MapRun | null {
  const d = useStudy.getState().data, { pack, key, subject, grid } = gridOf(studentId);
  const qs = new Map(d.questions.map((q) => [q.id, q]));
  const keys = new Set<string>();
  for (const a of d.attempts) if (a.studentId === studentId && Date.parse(a.at) >= since) for (const k of qs.get(a.questionId)?.points ?? []) keys.add(k);
  if (!keys.size) return null;
  const plan = planMap(pack, grid, mastery(studentId, d, subject), keys);
  if (!plan.apply.length && !plan.suggest.length) return null;
  if (plan.apply.length) setGrid(key, applyMap(grid, plan.apply));
  const run: MapRun = { id: crypto.randomUUID(), at: Date.now(), studentId, key, changes: plan.apply, suggest: plan.suggest, why };
  log(run);
  return run;
}

export function undoMapRun(id: string) {
  const r = useMapLog.getState().runs.find((x) => x.id === id);
  if (!r || r.undone) return 0;
  const { grid } = gridOf(r.studentId), u = undoMap(grid, r.changes);
  if (u.restored) setGrid(r.key, u.grid);
  useMapLog.setState((s) => ({ runs: s.runs.map((x) => (x.id === id ? { ...x, undone: true } : x)) }));
  return u.restored;
}

const name = (id: string) => useStore.getState().students.find((s) => s.id === id)?.name ?? '';
export const changeText = (c: MapChange) => `${pointLabel(c.key).split(' · ').pop()} ${STATE_NAME[c.from]}→${STATE_NAME[c.to]}`;

/** 下课：这节课的学生（班组按每位成员）按作答更新地图；设置里关了就不动 */
export async function afterClassMap(studentId: string, startedAt: number) {
  if (!studentId || studentId === 'free' || !startedAt) return [];
  const s = await host.call<{ autoMap?: boolean }>('settings').catch(() => null);
  if (s?.autoMap === false) return [];
  const st = useStore.getState(), who = st.students.find((x) => x.id === studentId);
  if (!who) return [];
  const ids = isGroup(who) ? membersOf(who, st.students).map((m) => m.id) : [who.id];
  const runs = ids.map((id) => updateMapFor(id, startedAt - 60000, '下课按作答更新')).filter((r): r is MapRun => !!r);
  const moved = runs.filter((r) => r.changes.length), tips = runs.reduce((n, r) => n + r.suggest.length, 0);
  if (moved.length) {
    const text = moved.map((r) => `${name(r.studentId)}：${r.changes.slice(0, 3).map(changeText).join('、')}${r.changes.length > 3 ? ` 等 ${r.changes.length} 处` : ''}`).join('；');
    toast(`学习地图已按这节课的作答更新（${text}）${tips ? `，另有 ${tips} 处建议在学生页查看` : ''}`, { ms: 15000, action: { label: '撤销', run: () => { for (const r of moved) undoMapRun(r.id); toast('学习地图已恢复'); } } });
  } else if (tips) toast(`这节课的作答提示有 ${tips} 个知识点可能需要标「薄弱」，在学生页的学习地图里查看`, { ms: 10000, action: { label: '去看看', run: () => useStore.getState().set({ studentId: ids[0], page: 'students' }) } });
  return runs;
}

/** 助教或老师一次改几个知识点（返回改了哪些，可撤销） */
export function setMapStates(studentId: string, keys: string[], to: ChapterState, why: string): MapRun | null {
  const { pack, key, grid } = gridOf(studentId);
  const changes: MapChange[] = [];
  for (const k of keys) {
    const at = localOf(k);
    if (!at || pointKey(pack, at.ci, at.si) !== k) continue;
    const from = grid[at.ci]?.[at.si];
    if (from === undefined || from === to) continue;
    changes.push({ key: k, ci: at.ci, si: at.si, from, to });
  }
  if (!changes.length) return null;
  setGrid(key, applyMap(grid, changes));
  const run: MapRun = { id: crypto.randomUUID(), at: Date.now(), studentId, key, changes, suggest: [], why };
  log(run);
  return run;
}
