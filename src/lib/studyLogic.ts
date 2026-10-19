// 学情闭环的纯逻辑：题库、作答、掌握度、错题本、画像、组作业、文档拼装。
// 这里不碰窗口和主进程，Node 里可以直接测试。
import { familyOf, packOf, pointKey, SUBJECTS, subjectOfKey, type SubjectId } from './subjects';
import type { ChapterState } from './types';

export type Result = 'right' | 'wrong' | 'half';
export type Origin = 'board' | 'paste' | 'ai' | 'explain' | 'manual' | 'homework';

export interface Question {
  id: string;
  stem: string;              // 题干文字（看图题可以为空，只有 image）
  image?: string;            // 题图绝对路径（学情库 study/img 下）
  answer?: string;
  analysis?: string;
  points: string[];          // 知识点 key："章序号.节序号"（数学、化学带 m / c 前缀），与学习地图同一套
  subject?: SubjectId;       // 缺省按知识点推断，再缺省物理
  difficulty: number;        // 1 基础 … 5 压轴
  qtype: string;             // 题型，各学科不同（物理：选择 / 填空 / 计算 / 实验 / 其他）
  source?: string;           // 来自哪份课件、哪一页
  origin: Origin;
  status: 'inbox' | 'bank';
  check?: 'ok' | 'mismatch' | 'unchecked';   // AI 原创题的自检结果
  checkNote?: string;                        // 自检没通过的原因（答案对不上 / 题目条件有问题）
  createdAt: string;
  updatedAt?: string;
}
export interface Attempt { id: string; studentId: string; questionId: string; result: Result; at: string; note?: string }
export interface LessonNote {
  id: string; studentId: string; date: string; at: string; topic: string; minutes?: number;
  /** 上这节课时学生的学科；0.8 之前的记录没有这个字段，算在每个学科里 */
  subject?: SubjectId;
  summary: string; strengths: string[]; problems: string[]; next: string[]; parent: string; homework?: string;
  via: 'ai' | 'rules'; files?: string[]; sends?: SendRecord[];
}
export interface SendRecord { channel: 'wecom' | 'email'; ok: boolean; at: string; to: string; error?: string }
export interface Homework { id: string; studentId: string; title: string; at: string; questionIds: string[]; points: string[]; files: string[] }
export interface Portrait { text: string; at: string; via: 'ai' | 'rules' }
/** 老师交给 AI 的学生资料：家长聊天记录、家长要求、老师自己的备注 */
export interface StudentNote { id: string; studentId: string; at: string; kind: 'parent' | 'requirement' | 'teacher'; text: string; source?: string }
/** 一次备课：给哪节课、用哪些本地课件和题、AI 写的备课建议和导出的文件 */
export interface Prep {
  id: string; studentId: string; subject?: SubjectId; date: string; start?: number; slotId?: string; at: string; topic: string;
  points: string[]; materials: string[]; questionIds: string[]; plan: string; files: string[]; courseware?: string[];
  via: 'ai' | 'rules'; auto?: boolean;
}
export interface StudyData { questions: Question[]; attempts: Attempt[]; lessons: LessonNote[]; homework: Homework[]; notes: StudentNote[]; preps: Prep[]; portraits: Record<string, Portrait> }
export const emptyStudy = (): StudyData => ({ questions: [], attempts: [], lessons: [], homework: [], notes: [], preps: [], portraits: {} });

export const RESULT_NAME: Record<Result, string> = { right: '对', wrong: '错', half: '半对' };
export const DIFF_NAME = ['', '基础', '巩固', '中档', '提高', '压轴'];
/** 物理的题型（0.7 之前只有物理）；各学科用 qtypesOf */
export const QTYPES = packOf('physics').qtypes;
export const qtypesOf = (subject?: SubjectId) => packOf(subject).qtypes;

// ── 知识点 ─────────────────────────────────────────────
export interface Point { key: string; subject: SubjectId; ci: number; si: number; book: string; ch: string; sec: string }
export const POINTS: Point[] = SUBJECTS.flatMap((p) => p.chapters.flatMap((c, ci) => c.sec.map((sec, si) => ({ key: pointKey(p, ci, si), subject: p.id, ci, si, book: c.book, ch: c.ch, sec }))));
const BY_KEY = new Map(POINTS.map((p) => [p.key, p]));
const BY_SUBJECT = new Map(SUBJECTS.map((s) => [s.id, POINTS.filter((p) => p.subject === s.id)]));
export const pointsOf = (subject: SubjectId = 'physics') => BY_SUBJECT.get(subject) ?? [];
export const pointOf = (key: string) => BY_KEY.get(key);
export const pointLabel = (key: string) => { const p = BY_KEY.get(key); return p ? `${p.ch} · ${p.sec}` : key; };
/** 只留这个学科的知识点 */
export const ofSubject = (keys: string[], subject: SubjectId) => keys.filter((k) => BY_KEY.get(k)?.subject === subject);
/** 模型常写成 "16.2 匀强磁场中的运动"、"m3.1：…"，只取开头的 key；给了学科时只留这个学科的 */
export const validPoints = (keys: unknown, subject?: SubjectId): string[] => (Array.isArray(keys) ? [...new Set(keys.map((k) => /^\s*([a-z]{0,2}\d{1,2}\.\d{1,2})(?!\d)/.exec(String(k))?.[1] ?? '').filter((k) => BY_KEY.has(k) && (!subject || BY_KEY.get(k)!.subject === subject)))] : []);
/** 题目属于哪个学科：明确写了的 → 按知识点 → 物理 */
export const questionSubject = (q: Pick<Question, 'subject' | 'points'>): SubjectId => q.subject ?? (q.points.map(subjectOfKey).find(Boolean) as SubjectId | undefined) ?? 'physics';
/** 给模型的知识点清单（key 名称） */
export const pointList = (subject: SubjectId = 'physics') => pointsOf(subject).map((p) => `${p.key} ${p.ch}·${p.sec}`).join('\n');

/** 规则打标签：题眼 + 章节名匹配，最多 3 个，命中多的排前面 */
export function guessPoints(text: string, subject: SubjectId = 'physics'): string[] {
  const t = plainTex(text).replace(/\s+/g, '');
  if (!t) return [];
  const pack = packOf(subject), tool = new Set(pack.toolChapters);
  const score = new Map<string, number>();
  const add = (k: string, v: number) => score.set(k, (score.get(k) ?? 0) + v);
  for (const [re, keys] of pack.cues) if (re.test(t)) keys.forEach((k, i) => add(pack.prefix + k, 3 - i * 0.5));
  // 两个字的节名（速度、电荷、动量…）太常见，只给很低的分；最后只留不低于最高分一半的
  for (const p of pointsOf(subject)) for (const w of p.sec.split(/[\s（）()、—，,]+/).filter((w) => w.length >= 2)) if (t.includes(w)) add(p.key, w.length >= 3 ? 1.5 : 0.5);
  // 工具性的章（物理：运动描述、匀变速、圆周运动）同时命中其他章节的题眼时，主题是那一章
  const ch = (k: string) => BY_KEY.get(k)?.ci ?? -1;
  const topic = [...score.entries()].some(([k, v]) => !tool.has(ch(k)) && v >= 2.5);
  if (topic) for (const [k, v] of score) if (tool.has(ch(k))) score.set(k, v * 0.5);
  const top = Math.max(0, ...score.values());
  return [...score.entries()].filter(([, v]) => v >= top / 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

/** 模型常把题干写成 LaTeX；查重、搜索、答案比对前先还原成普通文字 */
const GREEK: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', Phi: 'Φ', omega: 'ω', Omega: 'Ω', varepsilon: 'ε', epsilon: 'ε', eta: 'η' };
export function plainTex(s: string): string {
  if (!/[$\\]/.test(s)) return s;
  let t = s.replace(/\$\$?/g, '');
  for (let i = 0; i < 3; i++) t = t.replace(/\\(?:mathrm|text|mathbf|boldsymbol|operatorname|vec|overrightarrow)\s*\{([^{}]*)\}/g, '$1').replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  return t.replace(/\\(?:times)/g, '×').replace(/\\cdot/g, '·').replace(/\\circ/g, '°').replace(/\\approx/g, '≈').replace(/\\(?:le|leq)\b/g, '≤').replace(/\\(?:ge|geq)\b/g, '≥').replace(/\\(?:ne|neq)\b/g, '≠')
    .replace(/\\([A-Za-z]+)/g, (m, w) => GREEK[w] ?? (/^(?:left|right|displaystyle|quad|qquad)$/.test(w) ? ' ' : m))
    .replace(/\\[,;:! ]/g, ' ').replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** 粗估难度：小问数、篇幅、综合程度 */
export function guessDifficulty(text: string): number {
  const t = text.replace(/\s+/g, '');
  if (!t) return 3;
  const subs = (t.match(/[（(][1-9１-９][）)]|[①②③④]/g) ?? []).length;
  let d = 2 + (t.length > 120 ? 1 : 0) + (t.length > 260 ? 1 : 0) + (subs >= 3 ? 1 : 0);
  if (/综合|压轴|恰好|临界|至少|最多|范围|多次|往复/.test(t)) d += 1;
  if (/下列说法|判断|是否/.test(t) && t.length < 100) d -= 1;
  return Math.max(1, Math.min(5, d));
}
export const guessType = (text: string, subject: SubjectId = 'physics'): string => packOf(subject).guessType(text);

// ── 查重 ───────────────────────────────────────────────
const FW = (s: string) => s.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
export const normStem = (s: string) => FW(plainTex(s)).toLowerCase().replace(/[\s,.;:!?，。；：！？、“”"'‘’（）()【】[\]{}<>《》\-—_=+*/\\|$^]/g, '');
function grams(s: string) { const g = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1); } return g; }
/** 双字 Dice 相似度：0~1。数字不同的「变式题」相似度会明显下降，不会被误判成重复。 */
export function similarity(a: string, b: string): number {
  const x = normStem(a), y = normStem(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const ga = grams(x), gb = grams(y);
  let both = 0;
  for (const [k, n] of ga) both += Math.min(n, gb.get(k) ?? 0);
  return (2 * both) / (x.length - 1 + y.length - 1);
}
export const DUP = 0.86;
export function findDuplicate(stem: string, pool: Question[], skipId?: string): { q: Question; sim: number } | null {
  if (normStem(stem).length < 8) return null;
  let best: { q: Question; sim: number } | null = null;
  for (const q of pool) {
    if (q.id === skipId || !q.stem) continue;
    const s = similarity(stem, q.stem);
    if (s >= DUP && (!best || s > best.sim)) best = { q, sim: s };
  }
  return best;
}

// ── 掌握度 ─────────────────────────────────────────────
export interface Mastery { key: string; score: number; n: number; right: number; wrong: number; half: number; last: string }
const VALUE: Record<Result, number> = { right: 1, half: 0.5, wrong: 0 };
/** 每个知识点：最近的作答权重最大（每往前一次 ×0.75），同一道题只算最近一次之前的历史也保留，体现订正过程。 */
export function mastery(studentId: string, d: Pick<StudyData, 'attempts' | 'questions'>, subject?: SubjectId): Map<string, Mastery> {
  const qs = new Map(d.questions.map((q) => [q.id, q]));
  const per = new Map<string, Attempt[]>();
  for (const a of d.attempts) {
    if (a.studentId !== studentId) continue;
    const q = qs.get(a.questionId);
    if (!q || (subject && questionSubject(q) !== subject)) continue;
    for (const k of q.points) (per.get(k) ?? per.set(k, []).get(k)!).push(a);
  }
  const out = new Map<string, Mastery>();
  for (const [key, list] of per) {
    list.sort((a, b) => b.at.localeCompare(a.at));
    let w = 1, sum = 0, total = 0;
    for (const a of list) { sum += VALUE[a.result] * w; total += w; w *= 0.75; }
    out.set(key, { key, score: total ? sum / total : 0, n: list.length, right: list.filter((a) => a.result === 'right').length, wrong: list.filter((a) => a.result === 'wrong').length, half: list.filter((a) => a.result === 'half').length, last: list[0].at });
  }
  return out;
}
/** 作答 → 学习地图建议。做过两次以上且加权正确率 ≥ 80% 才算掌握。 */
export function suggestState(m: Mastery | undefined): ChapterState | null {
  if (!m || !m.n) return null;
  if (m.score < 0.5) return 'weak';
  if (m.n >= 2 && m.score >= 0.8) return 'done';
  return 'learning';
}

// ── 错题本 ─────────────────────────────────────────────
export interface WrongItem { q: Question; history: Attempt[]; status: 'open' | 'fixed'; wrongCount: number; lastWrong: string }
export function wrongBook(studentId: string, d: Pick<StudyData, 'attempts' | 'questions'>): WrongItem[] {
  const qs = new Map(d.questions.map((q) => [q.id, q]));
  const by = new Map<string, Attempt[]>();
  for (const a of d.attempts) if (a.studentId === studentId && qs.has(a.questionId)) (by.get(a.questionId) ?? by.set(a.questionId, []).get(a.questionId)!).push(a);
  const out: WrongItem[] = [];
  for (const [qid, list] of by) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const wrongs = list.filter((a) => a.result !== 'right');
    if (!wrongs.length) continue;
    const latest = list[list.length - 1];
    out.push({ q: qs.get(qid)!, history: list, status: latest.result === 'right' ? 'fixed' : 'open', wrongCount: wrongs.length, lastWrong: wrongs[wrongs.length - 1].at });
  }
  return out.sort((a, b) => (a.status === b.status ? b.lastWrong.localeCompare(a.lastWrong) : a.status === 'open' ? -1 : 1));
}

// ── 学生画像 ───────────────────────────────────────────
export interface Profile {
  attempts: number; accuracy: number | null; recentAccuracy: number | null; open: number; fixed: number;
  weak: Mastery[]; strong: Mastery[]; weeks: { label: string; acc: number | null; n: number }[]; lessons: number; lastLesson?: LessonNote;
}
export const lessonIn = (l: LessonNote, subject?: SubjectId) => !subject || !l.subject || l.subject === subject;
/** 画像按学科分开存；物理沿用旧键（学生 id），老数据不丢 */
export const portraitKey = (studentId: string, subject: SubjectId = 'physics') => (subject === 'physics' ? studentId : `${studentId}@${subject}`);
export function profile(studentId: string, d: StudyData, now = Date.now(), subject?: SubjectId): Profile {
  const qs = subject ? new Map(d.questions.map((q) => [q.id, q])) : null;
  const mine = d.attempts.filter((a) => { if (a.studentId !== studentId) return false; if (!qs) return true; const q = qs.get(a.questionId); return !!q && questionSubject(q) === subject; });
  const acc = (list: Attempt[]) => (list.length ? list.reduce((s, a) => s + VALUE[a.result], 0) / list.length : null);
  const month = now - 30 * 864e5;
  const m = [...mastery(studentId, d, subject).values()];
  const wb = wrongBook(studentId, d).filter((w) => !subject || questionSubject(w.q) === subject);
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const end = now - (5 - i) * 7 * 864e5, start = end - 7 * 864e5;
    const list = mine.filter((a) => { const t = Date.parse(a.at); return t > start && t <= end; });
    const day = new Date(start + 864e5);
    return { label: `${day.getMonth() + 1}/${day.getDate()}`, acc: acc(list), n: list.length };
  });
  const lessons = d.lessons.filter((l) => l.studentId === studentId && lessonIn(l, subject)).sort((a, b) => b.at.localeCompare(a.at));
  return {
    attempts: mine.length, accuracy: acc(mine), recentAccuracy: acc(mine.filter((a) => Date.parse(a.at) > month)),
    open: wb.filter((w) => w.status === 'open').length, fixed: wb.filter((w) => w.status === 'fixed').length,
    weak: m.filter((x) => x.score < 0.6).sort((a, b) => a.score - b.score || b.n - a.n).slice(0, 5),
    strong: m.filter((x) => x.n >= 2 && x.score >= 0.8).sort((a, b) => b.score - a.score || b.n - a.n).slice(0, 5),
    weeks, lessons: lessons.length, lastLesson: lessons[0],
  };
}
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');

// ── 组作业 ─────────────────────────────────────────────
/** prereqs：先补的前置知识点（来自知识网络追溯），排在所选知识点前面，每个最多 2 题 */
export interface PickOptions { studentId: string; points: string[]; count: number; minD: number; maxD: number; redo: number; avoidDays: number; now?: number; prereqs?: { key: string; for: string }[]; subject?: SubjectId }
export interface Picked { q: Question; why: string }
export function pickHomework(o: PickOptions, d: StudyData): { picked: Picked[]; short: number; points: string[] } {
  const now = o.now ?? Date.now();
  const m = mastery(o.studentId, d, o.subject);
  const points = o.points.length ? o.points : [...m.values()].filter((x) => x.score < 0.6).sort((a, b) => a.score - b.score).map((x) => x.key).slice(0, 4);
  const mine = d.attempts.filter((a) => a.studentId === o.studentId);
  const recent = new Set(mine.filter((a) => now - Date.parse(a.at) < o.avoidDays * 864e5).map((a) => a.questionId));
  const solved = new Set(mine.filter((a) => a.result === 'right').map((a) => a.questionId));
  const picked: Picked[] = [];
  const clash = (q: Question) => picked.some((p) => p.q.id === q.id || (q.stem && p.q.stem && similarity(q.stem, p.q.stem) >= DUP));
  // 1) 错题重做：还没订正的，最近错的优先
  for (const w of wrongBook(o.studentId, d).filter((w) => w.status === 'open' && (!o.subject || questionSubject(w.q) === o.subject))) {
    if (picked.length >= Math.min(o.redo, o.count)) break;
    if (!clash(w.q)) picked.push({ q: w.q, why: `错题重做（错 ${w.wrongCount} 次）` });
  }
  // 2) 按知识点轮流从题库挑：没做过、近期没练过、难度在范围内
  const pool = d.questions.filter((q) => q.status === 'bank' && q.check !== 'mismatch' && !solved.has(q.id) && !recent.has(q.id) && q.difficulty >= o.minD && q.difficulty <= o.maxD && (!o.subject || questionSubject(q) === o.subject));
  const pre = (o.prereqs ?? []).filter((p) => !points.includes(p.key));
  const lane = (k: string) => pool.filter((q) => q.points.includes(k)).sort((a, b) => a.difficulty - b.difficulty || a.createdAt.localeCompare(b.createdAt));
  // 前置题排在错题之后、新题之前：先把地基补上。每个前置最多 2 题，合计不超过总题数的 40%，主体仍是所选知识点
  const preCap = picked.length + Math.max(1, Math.floor(o.count * 0.4));
  for (const p of pre) {
    let n = 0;
    for (const q of lane(p.key)) {
      if (n >= 2 || picked.length >= Math.min(o.count, preCap)) break;
      if (!clash(q)) { picked.push({ q, why: `先补前置：${pointLabel(p.key).split(' · ').pop()}（${pointLabel(p.for).split(' · ').pop()} 的前置）` }); n++; }
    }
  }
  const lanes = points.map(lane);
  for (let round = 0, moved = true; picked.length < o.count && moved; round++) {
    moved = false;
    lanes.forEach((lane, i) => {
      if (picked.length >= o.count) return;
      while (lane.length) {
        const q = lane.shift()!;
        if (clash(q)) continue;
        const ms = m.get(points[i]);
        picked.push({ q, why: `${pointLabel(points[i])}${ms ? ' · 掌握 ' + pct(ms.score) : ''}` });
        moved = true; break;
      }
    });
  }
  const tag = (p: Picked) => (p.why.startsWith('错题') ? 0 : p.why.startsWith('先补前置') ? 1 : 2);
  const ordered = [...picked].sort((a, b) => tag(a) - tag(b) || (tag(a) === 2 ? a.q.difficulty - b.q.difficulty : 0));
  return { picked: ordered, short: Math.max(0, o.count - picked.length), points };
}

// ── AI 原创题自检：独立解一遍，答案对得上才放行 ─────────────────
const NUM = /[-+]?\d+(?:\.\d+)?(?:\s*[×x*]\s*10\s*\^?\s*[-+]?\d+)?/g;
interface Num { v: number; sf: number; unit: number }
function nums(s: string): Num[] {
  // 小问编号（1）②、单位里的指数 m/s^2 不是答案里的数
  const t0 = FW(s).replace(/\s+/g, '').replace(/−/g, '-').replace(/\([1-9]\)|[①-⑨]|第[1-9一二三四]问/g, ' ').replace(/(?<!10)\^[-+]?\d+/g, '');
  return (t0.match(NUM) ?? []).map((t) => {
    const m = /^([-+]?\d+(?:\.\d+)?)(?:[×x*]10\^?([-+]?\d+))?$/.exec(t);
    if (!m) return null;
    const mant = m[1].replace(/^[-+]/, ''), e = Number(m[2] ?? 0), dec = mant.split('.')[1]?.length ?? 0;
    const sf = mant.replace('.', '').replace(/^0+/, '').length;
    return { v: Number(m[1]) * 10 ** e, sf, unit: 10 ** (e - dec) };
  }).filter((n): n is Num => !!n && Number.isFinite(n.v));
}
/** 2% 以内算一致；两位以上有效数字时，四舍五入的差别（不超过较粗那个数末位的一半）也算一致：0.16 与 0.157 */
function sameNum(a: Num, b: Num) {
  if (Math.abs(a.v - b.v) <= Math.max(1e-12, 0.02 * Math.max(Math.abs(a.v), Math.abs(b.v)))) return true;
  const coarse = a.unit >= b.unit ? a : b;
  return coarse.sf >= 2 && Math.abs(a.v - b.v) <= coarse.unit / 2 + 1e-12 * Math.abs(coarse.v);
}
export function answersMatch(a: string, b: string): boolean {
  const x = FW(plainTex(a)).trim(), y = FW(plainTex(b)).trim();
  if (!x || !y) return false;
  const ca = /^[(（]?([A-D]{1,4})[)）]?$/i.exec(x.replace(/[选答案:：\s]/g, '')), cb = /^[(（]?([A-D]{1,4})[)）]?$/i.exec(y.replace(/[选答案:：\s]/g, ''));
  if (ca || cb) return !!ca && !!cb && [...ca[1].toUpperCase()].sort().join('') === [...cb[1].toUpperCase()].sort().join('');
  const na = nums(x), nb = nums(y);
  if (na.length && nb.length) return na.every((v) => nb.some((w) => sameNum(v, w)));
  return similarity(x, y) >= 0.7;
}

// ── 课后总结（没配模型时的规则版） ───────────────────────
/** roots：知识网络追溯出的、和本节课错题相关的薄弱前置（已写成一句话） */
export interface LessonInput { student: string; topic: string; minutes?: number; attempts: { q: Question; a: Attempt }[]; notes: string; homework?: string; roots?: string[]; subject?: SubjectId }
export function lessonByRules(i: LessonInput): Pick<LessonNote, 'summary' | 'strengths' | 'problems' | 'next' | 'parent'> {
  const right = i.attempts.filter((x) => x.a.result === 'right'), bad = i.attempts.filter((x) => x.a.result !== 'right');
  const pts = (list: typeof i.attempts) => [...new Set(list.flatMap((x) => x.q.points))].map(pointLabel);
  const strengths = right.length ? [`${pts(right).slice(0, 3).join('、') || '课堂练习'}：${right.length} 题做对`] : [];
  const problems = bad.length ? [`${pts(bad).slice(0, 3).join('、') || '课堂练习'}：${bad.length} 题需要订正`] : [];
  const next = [...(i.roots?.length ? ['先补前置：' + i.roots.map((r) => r.split('（')[0].split(' · ').pop()).join('、')] : []), ...(bad.length ? ['先订正本节课的错题，再做同类变式'] : []), ...(i.homework ? ['完成课后作业：' + i.homework] : [])];
  const total = i.attempts.length;
  const summary = `本节课学习「${i.topic || '课堂内容'}」${i.minutes ? `，共 ${i.minutes} 分钟` : ''}。` + (total ? `课堂练习 ${total} 题，做对 ${right.length} 题。` : '') + (i.notes.trim() ? '课堂记录：' + i.notes.trim().slice(0, 200) : '');
  const parent = `${i.student}家长您好，今天的课学习了「${i.topic || '课堂内容'}」。` + (total ? `课堂上完成 ${total} 道练习，做对 ${right.length} 道。` : '') + (problems.length ? `需要加强的是${pts(bad).slice(0, 2).join('、')}，已安排订正。` : '整体掌握不错。') + (i.homework ? `课后作业：${i.homework}。` : '') + '有问题随时联系我。';
  return { summary, strengths, problems, next, parent };
}

// ── 文档拼装（Markdown → 主进程导出 Word / PDF / PPT / 长图） ──────────
/** 学情库题图在 Markdown 里写成 img:<文件名>，主进程换成真实路径 */
export function imgRef(p?: string) { const m = p ? /([0-9a-f-]{36}\.(?:png|jpg))$/.exec(p) : null; return m ? 'img:' + m[1] : ''; }
const block = (s: string) => s.trim().split(/\n{2,}/).map((x) => x.replace(/\n/g, ' ')).join('\n\n');
/** 导出排版的配色跟学科大类走（export.css 里的 data-theme） */
export const themeLine = (subject?: SubjectId) => `<!-- cs:theme=${familyOf(subject)} -->`;
const SHORT = /选择|判断|填空|单选|多选/;
const OPTION = /^\s*[（(]?[A-H][)）]?\s*[.．、:：]/;
/** 选择题的选项单独成一段（全角空格隔开），不和题干挤在一行 */
function splitOptions(stem: string): [string, string] {
  const lines = stem.trim().split('\n'), k = lines.findIndex((l, i) => i > 0 && OPTION.test(l));
  if (k < 0) return [block(stem), ''];
  return [block(lines.slice(0, k).join('\n')), lines.slice(k).map((l) => l.trim()).filter(Boolean).join('\u3000\u3000')];
}
function questionMd(q: Question, n: number, space: boolean) {
  const [stem, options] = q.stem ? splitOptions(q.stem) : ['（见下图）', ''];
  const head = `**${n}.** ` + stem + `　（${q.qtype}，${DIFF_NAME[q.difficulty] ?? ''}）`;
  const img = imgRef(q.image);
  const gap = !space || SHORT.test(q.qtype) ? '' : /作文|写作|书面表达/.test(q.qtype + q.stem.slice(0, 40)) ? '[[留空]]\n\n[[留空]]\n\n[[留空]]' : '[[留空]]';
  return [head, options, img ? `![题图](${img})` : '', gap].filter(Boolean).join('\n\n');
}
export const PAGE_BREAK = '[[分页]]';
export function homeworkMarkdown(title: string, student: string, items: Question[], note = ''): string {
  const out = [themeLine(items[0] ? questionSubject(items[0]) : undefined), `# ${title}`, `学生：${student}　　日期：${new Date().toLocaleDateString('zh-CN')}　　共 ${items.length} 题`, note ? `> ${note}` : '', '## 练习'];
  items.forEach((q, i) => out.push(questionMd(q, i + 1, true)));
  out.push(PAGE_BREAK, '## 参考答案');
  items.forEach((q, i) => out.push(`**${i + 1}.** ${q.answer ? block(q.answer) : '（答案待补充）'}` + (q.analysis ? `\n\n> ${block(q.analysis)}` : '') + (q.check === 'unchecked' || q.check === 'mismatch' ? '\n\n> 注意：这道 AI 原创题的答案没有通过自检，请老师核对。' : '')));
  return out.filter(Boolean).join('\n\n') + '\n';
}
export function wrongbookMarkdown(student: string, items: WrongItem[]): string {
  const out = [themeLine(items[0] ? questionSubject(items[0].q) : undefined), `# ${student} · 错题本`, `整理日期：${new Date().toLocaleDateString('zh-CN')}　　待订正 ${items.filter((w) => w.status === 'open').length} 题，已订正 ${items.filter((w) => w.status === 'fixed').length} 题`];
  for (const st of ['open', 'fixed'] as const) {
    const list = items.filter((w) => w.status === st);
    if (!list.length) continue;
    out.push(`## ${st === 'open' ? '待订正' : '已订正'}`);
    list.forEach((w, i) => {
      out.push(questionMd(w.q, i + 1, false));
      out.push(`> 知识点：${w.q.points.map(pointLabel).join('、') || '未标注'}；作答记录：${w.history.map((a) => `${a.at.slice(5, 10)} ${RESULT_NAME[a.result]}`).join(' → ')}`);
      if (w.q.answer) out.push(`答案：${block(w.q.answer)}`);
      if (w.q.analysis) out.push(`解析：${block(w.q.analysis)}`);
    });
  }
  return out.join('\n\n') + '\n';
}
export function lessonMarkdown(l: LessonNote, student: string): string {
  const list = (xs: string[]) => xs.filter(Boolean).map((x) => `- ${x}`).join('\n');
  return [
    themeLine(l.subject),
    `# ${student} · 课后反馈`,
    `## 本节课`, `${l.date}　${l.topic}${l.minutes ? `　${l.minutes} 分钟` : ''}`, block(l.summary), '---',
    ...(l.strengths.length ? ['## 做得好的', list(l.strengths), '---'] : []),
    ...(l.problems.length ? ['## 需要加强', list(l.problems), '---'] : []),
    ...(l.next.length ? ['## 下一步', list(l.next), '---'] : []),
    ...(l.homework ? ['## 课后作业', block(l.homework), '---'] : []),
    '## 给家长', block(l.parent), '---',
  ].join('\n\n') + '\n';
}

/** 发给家长的消息：邮件标题 + 纯文字（邮件正文）+ 企业微信 markdown。详细内容在长图里，文字只放给家长的话和作业。 */
export function parentMessage(l: LessonNote, student: string, withImage: boolean): { subject: string; text: string; markdown: string } {
  const subject = `${student} · ${l.date} 课后反馈`;
  const head = [l.topic ? '本节课：' + l.topic : '', l.minutes ? `${l.minutes} 分钟` : ''].filter(Boolean).join('，');
  const parent = l.parent.trim(), hw = l.homework?.trim();
  const text = [head, parent, hw ? '课后作业：' + hw : '', withImage ? '完整的课后反馈见下方长图。' : ''].filter(Boolean).join('\n\n');
  // 企业微信 markdown 行首的 # > - 会被当成格式，家长的话里出现时前面加个全角空格
  const md = (s: string) => s.replace(/^([#>\-*])/gm, '\u3000$1');
  const markdown = [`**${subject}**`, head ? `> ${head}` : '', md(parent), hw ? `**课后作业**：${md(hw)}` : '', withImage ? '<font color="comment">完整反馈见下一条长图</font>' : ''].filter(Boolean).join('\n\n');
  return { subject, text, markdown };
}

// ── AI 课件：大纲 → 幻灯片 Markdown ─────────────────────
export interface Outline { title: string; subtitle?: string; slides: { title: string; bullets: string[]; formulas?: string[]; example?: { stem: string; answer?: string }; notes?: string }[] }
export function parseOutline(raw: unknown): Outline | null {
  const o = raw as Outline;
  if (!o || typeof o.title !== 'string' || !Array.isArray(o.slides)) return null;
  const slides = o.slides.filter((s) => s && typeof s.title === 'string').slice(0, 30).map((s) => ({
    title: s.title.trim().slice(0, 60),
    bullets: (Array.isArray(s.bullets) ? s.bullets : []).map(String).filter(Boolean).slice(0, 7),
    formulas: (Array.isArray(s.formulas) ? s.formulas : []).map(String).filter(Boolean).slice(0, 3),
    example: s.example && typeof s.example.stem === 'string' && s.example.stem.trim() ? { stem: s.example.stem, answer: typeof s.example.answer === 'string' ? s.example.answer : undefined } : undefined,
    notes: typeof s.notes === 'string' ? s.notes : undefined,
  }));
  return slides.length ? { title: o.title.trim().slice(0, 60), subtitle: typeof o.subtitle === 'string' ? o.subtitle : undefined, slides } : null;
}
export function outlineMarkdown(o: Outline, subject?: SubjectId): string {
  const tex = (f: string) => '$$' + f.replace(/^\$+|\$+$/g, '').trim() + '$$';
  const pages = [`${themeLine(subject)}\n\n# ${o.title}\n\n${o.subtitle ?? ''}`];
  for (const s of o.slides) {
    const body = [`## ${s.title}`, ...s.bullets.map((b) => `- ${b}`)];
    if (s.formulas?.length) body.push('', ...s.formulas.map(tex));
    if (s.example) body.push('', `> 例题：${s.example.stem.replace(/\n+/g, ' ')}`, ...(s.example.answer ? ['', `答案：${s.example.answer.replace(/\n+/g, ' ')}`] : []));
    pages.push(body.join('\n'));
  }
  return pages.join('\n\n---\n\n') + '\n';
}
/** 没配模型：按知识点 + 题库例题搭一份讲课框架，老师在 PPT 里补内容 */
export function outlineByRules(topic: string, points: string[], bank: Question[]): Outline {
  const labels = points.map(pointLabel);
  const examples = bank.filter((q) => q.status === 'bank' && q.stem && q.points.some((k) => points.includes(k))).sort((a, b) => a.difficulty - b.difficulty).slice(0, 3);
  return {
    title: topic || labels[0] || '新课',
    subtitle: labels.join('、'),
    slides: [
      { title: '学习目标', bullets: labels.length ? labels.map((l) => '理解并会用：' + l) : ['（在这里写本节课目标）'] },
      { title: '知识回顾', bullets: ['上节课要点', '本节课需要的旧知识'] },
      ...labels.map((l) => ({ title: l, bullets: ['概念与规律', '适用条件', '常见误区'] })),
      ...examples.map((q, i) => ({ title: `例题 ${i + 1}`, bullets: [], example: { stem: q.stem, answer: q.answer } })),
      { title: '课堂小结', bullets: ['本节课的方法', '易错点', '课后练习'] },
    ],
  };
}

/** 从模型回复里抠出第一个 JSON 对象（容忍 ```json 包裹和前后多余文字） */
export function looseJSON(s: string): unknown {
  const t = s.replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes('```') ? '' : m)).replace(/```[\s\S]*$/, '');
  for (const src of [s, t]) { try { return JSON.parse(src); } catch { /* 继续 */ } }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch { /* 无 */ } }
  return null;
}
