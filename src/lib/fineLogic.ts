// 课后学情精析的纯逻辑：课堂原话整理成给模型看的文字、提示词、解析回复，
// 再按写入规则决定哪些直接记作答、哪些放进「待确认」、哪些只算老师讲过。Node 里可以直接测。
import type { Chapter } from './timeline';
import type { TranscriptSeg } from './transcript';
import { levelOfResult, levelText, pointLabel, resultOfLevel, type Attempt, type Evidence, type Result, type UnsureItem } from './studyLogic';
import { packOf, type SubjectId } from './subjects';
import { timelineText, type FrameRead } from './recordAnalysisLogic';

/** AI 的把握不低于这个才直接记作答，否则等老师确认 */
export const SURE = 0.75;
/** 班组课要听出点了谁的名，而且把握更高才记到这个人名下 */
export const GROUP_SURE = 0.85;
/** 原话少于这么多句不做精析（多半没开麦、或者只录到老师） */
export const MIN_LINES = 12;

const mmss = (t: number) => { const s = Math.max(0, Math.floor(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const WHO: Record<string, string> = { teacher: '老师', student: '学生', unknown: '？' };
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

interface Line { t: number; t1: number; who: string; text: string }
/** 同一个人连着说的几句并成一行（中间停顿不到 2.5 秒、合起来不太长） */
function mergeLines(segs: TranscriptSeg[]): Line[] {
  const out: Line[] = [];
  for (const s of segs) {
    const text = String(s.text ?? '').trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.who === s.who && s.t0 - last.t1 <= 2.5 && last.text.length + text.length <= 160) { last.text += text; last.t1 = s.t1; }
    else out.push({ t: s.t0, t1: s.t1, who: s.who, text });
  }
  return out;
}
const render = (ls: Line[]) => ls.map((l) => `[${mmss(l.t)}] ${WHO[l.who] ?? '？'}：${l.text}`).join('\n');

/**
 * 课堂原话 → 给模型看的文字，控制在 budget 个字以内。超了就依次：
 * 老师的长段讲解截短 → 只留学生说话前后 40 秒的老师原话（其余写成「老师讲解 n 分钟」）→ 硬截断。
 * 学生说的话尽量一句不丢，判断掌握情况主要靠它。
 */
export function transcriptText(segs: TranscriptSeg[], budget = 16000): { text: string; lines: number; cut: boolean } {
  const all = mergeLines(segs);
  let text = render(all);
  if (text.length <= budget) return { text, lines: all.length, cut: false };
  const short = all.map((l) => (l.who === 'student' ? l : { ...l, text: clip(l.text, 50) }));
  text = render(short);
  if (text.length <= budget) return { text, lines: all.length, cut: true };
  const talk = short.filter((l) => l.who === 'student').map((l) => [l.t - 40, l.t1 + 40] as const);
  const near = (l: Line) => l.who === 'student' || talk.some(([a, b]) => l.t1 >= a && l.t <= b);
  const kept: string[] = [];
  let gap: Line[] = [];
  const flush = () => { if (gap.length) { const m = Math.max(1, Math.round((gap[gap.length - 1].t1 - gap[0].t) / 60)); kept.push(`[${mmss(gap[0].t)}] （老师讲解约 ${m} 分钟，略）`); gap = []; } };
  for (const l of short) { if (near(l)) { flush(); kept.push(render([l])); } else gap.push(l); }
  flush();
  text = kept.join('\n');
  if (text.length > budget) text = text.slice(0, budget) + '\n（后面太长，略）';
  return { text, lines: all.length, cut: true };
}

/** 学生开口的时刻（之前 20 秒以上没说话、这次说得不算太短）：多半在答题，截一帧看看屏幕上是哪道题 */
export function talkMarks(segs: TranscriptSeg[], max = 8): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (const s of segs) {
    if (s.who !== 'student') continue;
    if (s.t0 - last >= 20 && String(s.text ?? '').replace(/\s/g, '').length >= 6) out.push(Math.round((s.t0 + 2) * 10) / 10);
    last = s.t1;
  }
  if (out.length <= max) return out;
  return Array.from({ length: max }, (_, i) => out[Math.round((i * (out.length - 1)) / Math.max(1, max - 1))]);
}

/** 画面上认出的题：编号 Q1、Q2…，精析时模型用编号对上 */
export interface FrameRef { ref: string; frame: number; q: number }
export function frameDigest(frames: FrameRead[], times: number[]): { text: string; refs: FrameRef[] } {
  const refs: FrameRef[] = [], lines: string[] = [];
  const MARK: Record<string, string> = { right: '对', wrong: '错', half: '半对' };
  for (const f of frames) {
    lines.push(`第 ${f.i + 1} 张（${mmss(times[f.i] ?? 0)}）：${clip(f.what, 80) || '（没看出在讲什么）'}`);
    f.questions.forEach((q, k) => {
      const ref = `Q${refs.length + 1}`;
      refs.push({ ref, frame: f.i, q: k });
      lines.push(`  ${ref} 题干：${clip(q.stem, 160)}${q.result ? `（画面上老师批改：${MARK[q.result]}）` : ''}`);
    });
  }
  return { text: lines.join('\n'), refs };
}

/** 老师课上自己点的作答：编号 A1、A2…，以老师为准 */
export interface ManualRef { ref: string; attemptId: string; questionId: string; studentId: string }
export function manualDigest(list: { attemptId: string; questionId: string; studentId: string; name: string; t: number; stem: string; result: Result }[]): { text: string; refs: ManualRef[] } {
  const R: Record<Result, string> = { right: '对', wrong: '错', half: '半对' };
  const refs = list.map((x, i) => ({ ref: `A${i + 1}`, attemptId: x.attemptId, questionId: x.questionId, studentId: x.studentId }));
  return { text: list.map((x, i) => `A${i + 1}（${mmss(x.t)}，${x.name}）${clip(x.stem, 100) || '看图题'} → 老师记：${R[x.result]}`).join('\n'), refs };
}

export interface FineInput {
  subject: SubjectId; student: string; members: string[]; group: boolean; title: string; minutes: number;
  chapters: Chapter[]; transcript: string; split: 'channel' | 'mixed'; frames: string; manual: string;
  mastery: string; prep?: string; points: string;
}
export function finePrompt(o: FineInput): string {
  return `你在帮一位网课老师复盘刚上完的一节课（${packOf(o.subject).stage}，${o.group ? `班组课，学生：${o.members.join('、')}` : `学生：${o.student}`}，课题：${o.title}，约 ${o.minutes} 分钟）。
目标：替老师判断这节课里每道题学生是自己做出来的、在提示下做出来的，还是只听老师讲了，掌握了几成。老师课后只扫一眼确认，所以宁可少记，不要乱记。

【课堂原话】（本地语音识别，可能有错字、同音字，按上下文理解；${o.split === 'channel' ? '「老师」是老师的麦克风，「学生」是会议里传来的声音（学生说话）' : '没能分开老师和学生的声音，「？」要按说话内容判断是谁'}）
${o.transcript}

${o.chapters.length ? `【软件记下的课堂时间线】\n${timelineText(o.chapters)}\n\n` : ''}【录像画面】（看图模型已经看过，题干以画面为准）
${o.frames || '（没截到题目）'}

${o.manual ? `【老师课上自己记的作答】（以老师为准，不要改对错）\n${o.manual}\n\n` : ''}${o.prep ? `【这节课的备课】\n${o.prep}\n\n` : ''}【学生课前的掌握情况】
${o.mastery || '（还没有记录）'}

请完成三件事：
1. segments：把整节课切成几段，kind 只能是 lecture（讲解）/ example（例题讲解）/ practice（学生做题）/ explain（学生讲思路）/ qa（答疑）/ chat（闲聊、调试设备），每段有起止秒数 t0、t1、一句话 title 和涉及的知识点 points。
2. questions：每道出现过的题（屏幕上的题，或者老师口头出的题）一项：
   - ref：对应上面的 Q 编号或 A 编号，都对不上填 null；对不上时 stem 写题目内容（尽量完整，公式用 LaTeX，$...$ 包起来）。
   - t0、t1：这道题从出现到讲完的秒数。
   - mode：student_solo = 学生自己做（老师没给关键提示）；guided = 老师提示、追问下学生做出来；teacher_demo = 老师讲 / 演示，学生只是听、或跟着答一两个字。
   - result：right / wrong / half / none（看不出来就 none）。
   - level：这道题学生掌握了几成（0–10 的整数），评分标准：0 完全不会、听不懂；2 讲完还是不会；4 老师一步步带着才做出来；5 提示一两次后能做出；6 提示一次后基本独立；7 独立做出但慢或有小错；8 独立做对，小错自己改过来；9 独立、快速做对；10 独立快速做对，还能把思路讲清楚。teacher_demo 不用填 level。
   - conf：你对这个判断有几成把握（0–1）。只凭一两个字、或者听不清是谁说的，conf 不要超过 0.5。
   - hints：老师给了几次提示；selfFixed：学生有没有自己改正错误。
   - misconception：学生的错误想法（一句话，没有就空着）。
   - evidence：1–3 句原话作为证据，t 是秒数，who 是 teacher / student，text 照抄原话。没有原话证据就别下结论（result 填 none，conf 填 0）。
   - who：${o.group ? `原话里点名了是哪位同学（比如“${o.members[0] ?? '小李'}你来说”）就写名字，否则写 null，不要猜` : '写 null'}。
   - points：知识点 key（只能从下面的清单里选，最多 3 个）。
3. 汇总：points 给出这节课涉及的每个知识点 key、学生这节课的 level（0–10）、和课前比的 trend（up / down / same），why 一句话理由；summary 用两三句话说这节课讲了什么、学生表现怎样；stuck 列出学生卡住的地方（每条一句话）；todo 列出老师课上口头布置、要下次做的事（比如“这个下节课再练一次”），每条有 text 和 t；quotes 摘两三句最能体现学生掌握情况的学生原话（t、text）。

知识点清单（key 名称）：
${o.points}

只输出 JSON：{"segments":[{"t0":0,"t1":300,"kind":"lecture","title":"…","points":["…"]}],"questions":[{"ref":"Q1","stem":"","t0":0,"t1":0,"mode":"guided","who":null,"result":"right","level":6,"conf":0.8,"hints":1,"selfFixed":false,"misconception":"","evidence":[{"t":0,"who":"student","text":"…"}],"points":["…"]}],"points":[{"key":"…","level":6,"trend":"up","why":"…"}],"summary":"…","stuck":["…"],"todo":[{"text":"…","t":0}],"quotes":[{"t":0,"text":"…"}]}`;
}

export type Mode = 'student_solo' | 'guided' | 'teacher_demo';
export type SegKind = 'lecture' | 'example' | 'practice' | 'explain' | 'qa' | 'chat';
export const SEG_NAME: Record<SegKind, string> = { lecture: '讲解', example: '例题讲解', practice: '学生做题', explain: '学生讲思路', qa: '答疑', chat: '闲聊' };
export const MODE_NAME: Record<Mode, string> = { student_solo: '自己做的', guided: '提示下做的', teacher_demo: '老师讲的' };
export interface FineSeg { t0: number; t1: number; kind: SegKind; title: string; points: string[] }
export interface FineItem {
  ref: string | null; stem: string; t0: number; t1: number; mode: Mode; who: string | null;
  result: Result | null; level: number | null; conf: number; hints: number | null; selfFixed: boolean;
  misconception: string; evidence: Evidence[]; points: string[];
}
export interface FinePoint { key: string; level: number; trend: 'up' | 'down' | 'same'; why: string }
export interface FineReply { segments: FineSeg[]; items: FineItem[]; points: FinePoint[]; summary: string; stuck: string[]; todo: { text: string; t: number }[]; quotes: { t: number; text: string }[] }

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const num = (v: unknown) => { const x = typeof v === 'string' ? Number(v) : v; return typeof x === 'number' && Number.isFinite(x) ? x : null; };

/** 模型回复 → 结构。时间夹到录像长度里，知识点 key 只留清单里有的，编号只留真有的 */
export function parseFine(v: unknown, o: { duration: number; valid: Set<string>; refs: Set<string> }): FineReply {
  const r = obj(v), D = Math.max(0, o.duration);
  const T = (x: unknown) => Math.max(0, Math.min(D, num(x) ?? 0));
  const keys = (x: unknown, n = 3) => [...new Set(arr(x).map((k) => /^\s*([a-z]{0,2}\d{1,2}\.\d{1,2})(?!\d)/.exec(String(k))?.[1] ?? '').filter((k) => o.valid.has(k)))].slice(0, n);
  const lvl = (x: unknown) => { const n = num(x); return n === null ? null : Math.max(0, Math.min(10, Math.round(n))); };
  const KINDS: SegKind[] = ['lecture', 'example', 'practice', 'explain', 'qa', 'chat'];
  const segments = arr(r.segments).slice(0, 40).map((x0) => {
    const x = obj(x0), t0 = T(x.t0), t1 = Math.max(t0, T(x.t1));
    return { t0, t1, kind: (KINDS.includes(x.kind as SegKind) ? x.kind : 'lecture') as SegKind, title: str(x.title, 80), points: keys(x.points) };
  }).filter((s) => s.title || s.t1 > s.t0).sort((a, b) => a.t0 - b.t0);
  const items: FineItem[] = [];
  for (const x0 of arr(r.questions).slice(0, 40)) {
    const x = obj(x0), ref0 = str(x.ref, 8).toUpperCase(), ref = o.refs.has(ref0) ? ref0 : null;
    const stem = str(x.stem, 2000);
    if (!ref && stem.replace(/\s+/g, '').length < 6) continue;
    const t0 = T(x.t0), t1 = Math.max(t0, T(x.t1));
    const mode: Mode = x.mode === 'student_solo' || x.mode === 'guided' ? x.mode : 'teacher_demo';
    const res = String(x.result ?? '');
    const evidence = arr(x.evidence).slice(0, 3).map((e0) => { const e = obj(e0); return { t: T(e.t), who: e.who === 'teacher' || e.who === 'student' ? String(e.who) : 'unknown', text: str(e.text, 120) }; }).filter((e) => e.text);
    const conf = Math.max(0, Math.min(1, num(x.conf) ?? 0)), hints = num(x.hints);
    items.push({
      ref, stem, t0, t1, mode, who: typeof x.who === 'string' && x.who.trim() && !/^(null|无|没有)$/i.test(x.who.trim()) ? str(x.who, 20) : null,
      result: res === 'right' || res === 'wrong' || res === 'half' ? res : null, level: mode === 'teacher_demo' ? null : lvl(x.level),
      conf: evidence.length ? conf : Math.min(conf, 0.4), hints: hints === null ? null : Math.max(0, Math.min(20, Math.round(hints))), selfFixed: x.selfFixed === true,
      misconception: str(x.misconception, 120), evidence, points: keys(x.points),
    });
  }
  const TR = ['up', 'down', 'same'];
  const points = arr(r.points).slice(0, 20).map((x0) => { const x = obj(x0); return { key: keys([x.key], 1)[0] ?? '', level: lvl(x.level) ?? -1, trend: (TR.includes(String(x.trend)) ? x.trend : 'same') as FinePoint['trend'], why: str(x.why, 120) }; }).filter((p) => p.key && p.level >= 0);
  return {
    segments, items, points, summary: str(r.summary, 1200),
    stuck: arr(r.stuck).map((x) => str(x, 120)).filter(Boolean).slice(0, 6),
    todo: arr(r.todo).slice(0, 5).map((x0) => { const x = obj(x0); return { text: str(x.text, 120), t: T(x.t) }; }).filter((x) => x.text),
    quotes: arr(r.quotes).slice(0, 4).map((x0) => { const x = obj(x0); return { t: T(x.t), text: str(x.text, 120) }; }).filter((x) => x.text),
  };
}

export type Decision =
  | { kind: 'attempt'; studentId: string; result: Result; level: number }
  | { kind: 'unsure'; studentId: string; result: Result; level: number; why: string }
  | { kind: 'taught' }
  | { kind: 'enrich'; attemptId: string }
  | { kind: 'skip'; why: string };

/** 名字对得上：一样，或者一个包含另一个（“小李”和“李同学”对不上，“李明”和“明明”也不算） */
export function matchMember(who: string | null, members: { id: string; name: string }[]): string | null {
  if (!who) return null;
  const w = who.replace(/\s|同学|你/g, '');
  if (!w) return null;
  const hit = members.filter((m) => m.name === w || (w.length >= 2 && m.name.includes(w)) || (m.name.length >= 2 && w.includes(m.name)));
  return hit.length === 1 ? hit[0].id : null;
}

/**
 * 写入规则：
 * - 老师讲的例题只算讲过；
 * - 对上了老师课上手点的作答：不改对错，只补证据；
 * - 看不出做得怎样：不记；
 * - 班组课听出点了谁的名、把握 ≥ 0.85 才记到这个人，听不出是谁记到班组整体，但都要老师确认；
 * - 把握 ≥ 0.75 且有原话证据直接记，其余进「待确认」。
 */
export function decide(x: FineItem, c: { members: { id: string; name: string }[]; group: string | null; manual: Map<string, string> }): Decision {
  if (x.ref && c.manual.has(x.ref)) return x.evidence.length ? { kind: 'enrich', attemptId: c.manual.get(x.ref)! } : { kind: 'skip', why: '老师课上已经记过' };
  if (x.mode === 'teacher_demo') return { kind: 'taught' };
  if (x.result === null && x.level === null) return { kind: 'skip', why: '看不出学生做得怎样' };
  const level = x.level ?? levelOfResult(x.result!), result = x.result ?? resultOfLevel(level);
  const pct = `AI 只有 ${Math.round(x.conf * 10)} 成把握`;
  if (c.group) {
    const who = matchMember(x.who, c.members);
    if (!who) return { kind: 'unsure', studentId: c.group, result, level, why: x.who ? `听到点名「${x.who}」，对不上班组里的同学` : '班组课没听出是哪位同学做的' };
    if (!x.evidence.length) return { kind: 'unsure', studentId: who, result, level, why: '没找到原话证据' };
    return x.conf >= GROUP_SURE ? { kind: 'attempt', studentId: who, result, level } : { kind: 'unsure', studentId: who, result, level, why: pct };
  }
  const sid = c.members[0]?.id;
  if (!sid) return { kind: 'skip', why: '没有学生' };
  if (!x.evidence.length) return { kind: 'unsure', studentId: sid, result, level, why: '没找到原话证据' };
  return x.conf >= SURE ? { kind: 'attempt', studentId: sid, result, level } : { kind: 'unsure', studentId: sid, result, level, why: pct };
}

/** 估 token 数（只求量级，用来卡单节课花费上限） */
export const fineTokens = (promptChars: number) => ({ input: Math.round(promptChars * 1.1) + 800, output: 6000 });
export const visionTokens = (frames: number, batch: number) => ({ input: frames * 1300 + Math.ceil(frames / batch) * 2500, output: Math.ceil(frames / batch) * 3000 });

/** 待确认的一道：老师点了对错以后带上 AI 的证据；几成把握只在和老师选的对错一致时保留 */
export function unsureExtra(u: UnsureItem, result: Result): Partial<Attempt> {
  const keep = typeof u.level === 'number' && resultOfLevel(u.level) === result;
  return {
    via: 'teacher', ...(u.recordId ? { recordId: u.recordId } : {}), ...(typeof u.t === 'number' ? { t: u.t } : {}),
    ...(u.at ? { at: u.at } : {}),
    ...(keep ? { level: u.level } : {}), ...(u.mode ? { mode: u.mode } : {}), ...(u.hints !== undefined ? { hints: u.hints } : {}),
    ...(u.misconception ? { misconception: u.misconception } : {}), ...(u.evidence?.length ? { evidence: u.evidence } : {}),
  };
}

const weakText = (keys: string[]) => keys.map((k) => pointLabel(k).split(' · ').pop()).filter(Boolean).join('、');
const ARROW = { up: '↑', down: '↓', same: '' } as const;
/** 档案里的课堂精析：小结、分段、卡点、知识点几成把握、学生原话 */
export function fineNote(f: FineReply): string {
  const segs = f.segments.filter((s) => s.kind !== 'chat').slice(0, 12).map((s) => `${mmss(s.t0)}–${mmss(s.t1)} ${SEG_NAME[s.kind]}${s.title ? '：' + s.title : ''}`);
  const pts = f.points.map((p) => `${pointLabel(p.key).split(' · ').pop()} ${levelText(p.level)}${ARROW[p.trend]}${p.why ? '（' + p.why + '）' : ''}`);
  const weak = weakText(f.points.filter((p) => p.level <= 4).map((p) => p.key));
  return [
    f.summary,
    segs.length ? '这节课的安排：\n' + segs.join('\n') : '',
    f.stuck.length ? '卡住的地方：' + f.stuck.join('；') : '',
    pts.length ? '知识点：' + pts.join('；') : '',
    weak ? `可能还没掌握（只是建议，学习地图没改）：${weak}` : '',
    f.quotes.length ? '学生原话：' + f.quotes.map((q) => `“${q.text}”（${mmss(q.t)}）`).join(' ') : '',
  ].filter(Boolean).join('\n');
}

