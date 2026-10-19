// 知识网络：各学科知识点之间的前置关系（数据在 subjects/ 各学科包里）。
// key 与学习地图一致（物理"章.节"，数学/化学带 m/c 前缀）。只写直接前置，间接的靠追溯。
import { mastery, pointLabel, pointsOf, type StudyData } from './studyLogic';
import { SUBJECTS, type SubjectId } from './subjects';
import type { ChapterState } from './types';

export const PREREQ = new Map<string, string[]>();
export const NEXT = new Map<string, string[]>();
for (const pack of SUBJECTS) for (const item of pack.edges.trim().split(/\s+/)) {
  const [to, from] = item.split(':');
  const list = from.split(',').map((k) => pack.prefix + k);
  PREREQ.set(pack.prefix + to, list);
  for (const f of list) (NEXT.get(f) ?? NEXT.set(f, []).get(f)!).push(pack.prefix + to);
}
export const EDGES: [string, string][] = [...PREREQ].flatMap(([to, from]) => from.map((f) => [f, to] as [string, string]));

/** 所有前置（含间接），值是距离：1 = 直接前置 */
export function ancestors(key: string, maxDepth = 99): Map<string, number> {
  const out = new Map<string, number>();
  let wave = [key];
  for (let d = 1; wave.length && d <= maxDepth; d++) {
    const next: string[] = [];
    for (const k of wave) for (const p of PREREQ.get(k) ?? []) if (!out.has(p) && p !== key) { out.set(p, d); next.push(p); }
    wave = next;
  }
  return out;
}
export function descendants(key: string, maxDepth = 99): Map<string, number> {
  const out = new Map<string, number>();
  let wave = [key];
  for (let d = 1; wave.length && d <= maxDepth; d++) {
    const next: string[] = [];
    for (const k of wave) for (const p of NEXT.get(k) ?? []) if (!out.has(p) && p !== key) { out.set(p, d); next.push(p); }
    wave = next;
  }
  return out;
}

// ── 掌握情况 ───────────────────────────────────────────
export type Level = 'weak' | 'shaky' | 'ok' | 'unknown';
export const LEVEL_NAME: Record<Level, string> = { weak: '薄弱', shaky: '不稳', ok: '掌握', unknown: '没有记录' };
export interface NodeInfo { level: Level; score?: number; n?: number; state: ChapterState }
/**
 * 每个知识点的掌握情况：老师在学习地图上标了"薄弱"就算薄弱；
 * 否则有作答记录看加权正确率（<50% 薄弱，<80% 不稳）；再否则看地图（已掌握 / 在学）。
 */
export function nodeInfo(studentId: string, d: Pick<StudyData, 'attempts' | 'questions'>, map?: ChapterState[][], subject: SubjectId = 'physics'): Map<string, NodeInfo> {
  const ms = mastery(studentId, d), out = new Map<string, NodeInfo>();
  for (const p of pointsOf(subject)) {
    const state = map?.[p.ci]?.[p.si] ?? 'none', m = ms.get(p.key);
    let level: Level = 'unknown';
    if (state === 'weak') level = 'weak';
    else if (m?.n) level = m.score < 0.5 ? 'weak' : m.score < 0.8 ? 'shaky' : 'ok';
    else if (state === 'done') level = 'ok';
    else if (state === 'learning') level = 'shaky';
    out.set(p.key, { level, state, ...(m ? { score: m.score, n: m.n } : {}) });
  }
  return out;
}

export interface Root { key: string; dist: number; level: Level; for: string }
/**
 * 往前追溯：从这些知识点出发沿前置关系往回找掌握不好（薄弱 / 不稳）的知识点。
 * 遇到已掌握的前置就不再往回找——它的前置大概率没问题。
 * 结果按薄弱优先、离得近优先排序。起点之间也可能互为前置（例如力的分解薄弱导致牛顿第二定律薄弱），这种也会列出。
 */
export function traceBack(keys: string[], info: Map<string, NodeInfo>, maxDepth = 3): Root[] {
  const found = new Map<string, Root>();
  for (const k of keys) {
    let wave = [k];
    const seen = new Set([k]);
    for (let d = 1; wave.length && d <= maxDepth; d++) {
      const next: string[] = [];
      for (const w of wave) for (const p of PREREQ.get(w) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        const level = info.get(p)?.level ?? 'unknown';
        if (level === 'ok') continue;
        if (level === 'weak' || level === 'shaky') {
          const old = found.get(p);
          if (!old || d < old.dist) found.set(p, { key: p, dist: d, level, for: k });
        }
        next.push(p);
      }
      wave = next;
    }
  }
  const rank = (l: Level) => (l === 'weak' ? 0 : 1);
  return [...found.values()].sort((a, b) => rank(a.level) - rank(b.level) || a.dist - b.dist || (info.get(a.key)?.score ?? 1) - (info.get(b.key)?.score ?? 1));
}
export const rootText = (r: Root) => `${pointLabel(r.key)}（${LEVEL_NAME[r.level]}，是「${pointLabel(r.for).split(' · ').pop()}」的${r.dist === 1 ? '直接' : '间接'}前置）`;

/** 学生当前的薄弱点（作答或地图）及其薄弱前置，给 AI 提示用 */
export function weakRoots(studentId: string, d: Pick<StudyData, 'attempts' | 'questions'>, map?: ChapterState[][], limit = 4, subject: SubjectId = 'physics'): Root[] {
  const info = nodeInfo(studentId, d, map, subject);
  const weak = [...info].filter(([, v]) => v.level === 'weak').map(([k]) => k);
  return traceBack(weak, info).slice(0, limit);
}
