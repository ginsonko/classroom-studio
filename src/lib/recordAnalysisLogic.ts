// 下课分析录像的纯逻辑：挑哪几帧给看图模型、提示词、解析回复。Node 里可以直接测。
import type { Chapter } from './timeline';
import { pointsOf, type Mastery, type Result } from './studyLogic';
import { localOf, packOf, pointKey, type SubjectId, type SubjectPack } from './subjects';
import { planMap, type Grid, type MapPlan } from './mapLogic';

/** 1.6 的截帧上限（pickFrames 用；1.7.0 起下课分析改用 planFrames，按书写和翻页全看） */
export const MAX_FRAMES = 12;
/** 1.7.0 一节课最多看多少张（板书原图 + 录像画面）；预算够时就这么多 */
export const MAX_PAGES = 120;
/** 有课堂原话时多截几张：学生开口答题的时刻也截 */
export const MAX_FRAMES_VOICE = 18;
export const BATCH = 6;
const GAP = 20;

const mmss = (t: number) => { const s = Math.max(0, Math.floor(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * 挑截帧的时间点：
 * - 记作答 / 收题的那一刻（题就在屏幕上）；
 * - 每段课件 / 每页 / 每块黑板结束前 2 秒（写满了的样子）；
 * - 学生开口答题的时刻（extra，来自课堂原话）；
 * - 还不够就按时长均匀补。
 * 彼此至少隔 20 秒，最多 max 张，按时间排好。
 */
export function pickFrames(chapters: Chapter[], duration: number, max = MAX_FRAMES, extra: number[] = []): number[] {
  if (!(duration > 1)) return [];
  const end = Math.max(0, duration - 1), list = [...chapters].filter((c) => c.t >= 0 && c.t <= duration).sort((a, b) => a.t - b.t);
  const marks = list.filter((c) => c.kind === 'attempt' || c.kind === 'question').map((c) => Math.max(0, c.t - 1));
  const views = list.filter((c) => c.kind === 'material' || c.kind === 'page' || c.kind === 'board');
  const ends = views.map((c, i) => { const next = views[i + 1]?.t ?? duration; return Math.min(end, Math.max(c.t + 3, next - 2)); }).filter((t) => t > 0);
  const out: number[] = [];
  const take = (t: number) => { if (out.length < max && out.every((x) => Math.abs(x - t) >= Math.min(GAP, duration / (max * 2)))) out.push(t); };
  for (const t of spread(marks, Math.ceil(max / 2))) take(t);
  for (const t of spread(extra.filter((t) => t >= 0 && t <= end), Math.ceil(max / 3))) take(t);
  for (const t of spread(ends, max)) take(t);
  for (let i = 1; out.length < max && i <= max; i++) take(Math.min(end, (duration * i) / (max + 1)));
  return out.sort((a, b) => a - b).map((t) => Math.round(t * 10) / 10);
}
/** 太多时均匀挑 n 个 */
function spread(xs: number[], n: number): number[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / Math.max(1, n - 1))]);
}

/** 下课时存下来的板书原图（按原始笔迹画的，比录像截帧清楚） */
export interface BoardShot { ref: string; title: string; t: number; strokes: number }
/** 要看的一张：板书原图（board 是 boards 里的序号）或录像在 t 秒的画面 */
export interface Look { t: number; board?: number; label: string; why: 'board' | 'ink' | 'view' | 'mark' | 'talk' | 'pad' }

/**
 * 1.7.0 挑这节课要看的画面：每一页有新增书写的都看到（取最后一笔之后），每一次换课件页都看到，数量不够再按时长补。
 * - 黑板页：有下课时存下的板书原图就看原图（同一页最后一次写的样子）；同一页更早写过又擦掉的，按录像截那一刻；
 * - 课件上写过的页：录像里最后一笔后 1.5 秒；
 * - 换页 / 换课件：那一页离开前 2 秒（这段里写过字的已经算过了就不重复）；
 * - 记作答 / 收题、学生开口答题的时刻；
 * - 两张之间隔太久（4 分钟以上）补一张。
 * 超过 max 时按上面的先后挑（书写最优先），再按时间排。返回要看的和一共有多少处（结果里写清看了几页）。
 */
export function planFrames(chapters: Chapter[], duration: number, boards: BoardShot[], o: { max?: number; extra?: number[] } = {}): { looks: Look[]; total: number } {
  const max = Math.max(1, o.max ?? MAX_PAGES);
  if (!(duration > 1)) return { looks: boards.slice(0, max).map((b, i) => ({ t: b.t, board: i, label: `板书原图：${b.title}`, why: 'board' as const })), total: boards.length };
  const end = Math.max(0, duration - 1), list = [...chapters].filter((c) => c.t >= 0 && c.t <= duration + 5).sort((a, b) => a.t - b.t);
  const at = (t: number) => Math.round(Math.min(end, Math.max(0, t)) * 10) / 10;
  const cands: Look[] = [];
  const lastInk = new Map<string, number>();
  list.forEach((c, i) => { if (c.kind === 'ink' && c.ref) lastInk.set(c.ref, i); });
  const boardOf = new Map<string, number[]>();
  boards.forEach((b, i) => boardOf.set(b.ref, [...(boardOf.get(b.ref) ?? []), i]));
  // 板书原图：每一页最后写的样子
  for (const [ref, ix] of boardOf) for (const i of ix) cands.push({ t: boards[i].t, board: i, label: `板书原图：${boards[i].title}（按原始笔迹画的）`, why: 'board' });
  // 书写：最后一笔之后的画面（这一页的最后一次写、又有原图的，原图已经看了）
  list.forEach((c, i) => {
    if (c.kind !== 'ink') return;
    if (c.ref && boardOf.has(c.ref) && lastInk.get(c.ref) === i) return;
    cands.push({ t: at(c.t + 1.5), label: `${mmss(c.t + 1.5)} 录像画面（${c.title.replace(/^书写：/, '')} 写完这一段）`, why: 'ink' });
  });
  // 换页 / 换课件：离开前的样子（这段里写过的已经有了）
  const views = list.filter((c) => c.kind === 'material' || c.kind === 'page' || c.kind === 'board');
  views.forEach((c, i) => {
    const next = views[i + 1]?.t ?? duration;
    if (list.some((x) => x.kind === 'ink' && x.t >= c.t && x.t <= next)) return;
    const t = Math.max(c.t + 3, next - 2);
    if (t > 0) cands.push({ t: at(t), label: `${mmss(t)} 录像画面（${c.title}）`, why: 'view' });
  });
  for (const c of list) if (c.kind === 'attempt' || c.kind === 'question') cands.push({ t: at(c.t - 1), label: `${mmss(c.t - 1)} 录像画面（${c.kind === 'attempt' ? '记作答' : '收题'}：${c.title}）`, why: 'mark' });
  for (const t of o.extra ?? []) if (t >= 0 && t <= end) cands.push({ t: at(t), label: `${mmss(t)} 录像画面（学生在答题）`, why: 'talk' });
  // 同一时刻附近（8 秒内）只留一张录像画面：优先级高的留下
  const rank: Record<Look['why'], number> = { board: 0, ink: 1, view: 2, mark: 3, talk: 4, pad: 5 };
  cands.sort((a, b) => rank[a.why] - rank[b.why] || a.t - b.t);
  const kept: Look[] = [];
  for (const c of cands) if (c.board !== undefined || !kept.some((k) => k.board === undefined && Math.abs(k.t - c.t) < 8)) kept.push(c);
  // 两张之间隔太久补一张
  const gap = 240, times = () => kept.map((k) => k.t).concat([0, duration]).sort((a, b) => a - b);
  for (let guard = 0; guard < 200; guard++) {
    const ts = times(); let added = false;
    for (let i = 0; i + 1 < ts.length; i++) if (ts[i + 1] - ts[i] > gap) { const t = (ts[i] + ts[i + 1]) / 2; kept.push({ t: at(t), label: `${mmss(t)} 录像画面`, why: 'pad' }); added = true; break; }
    if (!added) break;
  }
  const total = kept.length;
  // 超过上限：书写和原图最优先，其余按类别轮流挑（每类均匀取），保证从头到尾都看到
  let pick = kept;
  if (kept.length > max) {
    pick = [];
    for (const w of ['board', 'ink', 'view', 'mark', 'talk', 'pad'] as Look['why'][]) {
      const xs = kept.filter((k) => k.why === w).sort((a, b) => a.t - b.t), room = max - pick.length;
      if (room <= 0) break;
      pick.push(...(xs.length <= room ? xs : Array.from({ length: room }, (_, i) => xs[Math.round((i * (xs.length - 1)) / Math.max(1, room - 1))])));
    }
  }
  return { looks: [...new Set(pick)].sort((a, b) => a.t - b.t), total };
}

export function timelineText(chapters: Chapter[]): string {
  const NAME: Record<Chapter['kind'], string> = { material: '打开课件', page: '翻页', board: '黑板', attempt: '记作答', question: '收题', note: '备注', ink: '书写' };
  return chapters.slice(0, 200).map((c) => `${mmss(c.t)} ${NAME[c.kind]} ${c.title}`).join('\n');
}

export function analysisPrompt(o: { subject: SubjectId; student: string; title: string; chapters: Chapter[]; times: number[]; labels?: string[]; part?: { from: number; all: number } }): string {
  const pts = pointsOf(o.subject).map((p) => `${p.key} ${p.ch}·${p.sec}`).join('\n');
  const which = o.labels?.length === o.times.length ? `依次是：\n${o.labels.map((l, i) => `第 ${i} 张：${l}`).join('\n')}` : `拍摄时间依次是：${o.times.map(mmss).join('、')}`;
  return `你在帮一位网课老师复盘刚上完的一节课（${packOf(o.subject).stage}，学生：${o.student}，课题：${o.title}）。
附上的是这节课的 ${o.times.length} 张截图${o.part ? `（整节课一共 ${o.part.all} 张，这是第 ${o.part.from + 1}–${o.part.from + o.times.length} 张；每一张都要看）` : ''}：学生看到的课件、黑板和老师的批注，「板书原图」是按老师的原始笔迹画出来的整页黑板，${which}。
${o.chapters.length ? `软件记下的课堂时间线：\n${timelineText(o.chapters)}\n` : ''}
请逐张看图，只写你在画面上真的看到的东西，不要猜：
1. 这张画面在讲什么（一句话）。
2. 画面上完整出现的题目：题干文字照抄（公式用 LaTeX，$...$ 包起来），题目在图上的位置框 box=[x0,y0,x1,y1]（0~1000，左上角为原点），能看到的答案；
   如果老师在这道题上打了勾 / 叉 / 写了对错（通常是红色批注），result 填 right / wrong / half，看不出来填 none；
   每道题再给一个 tag：6~16 个字说这道题练什么（比如「电梯超重失重判断」「连接体受力分析」），说考点和做法，不要抄题干。
3. 这张画面涉及的知识点 key（只能从下面的清单里选，最多 3 个）。
每一道出现过的题都要列出来（同一道题在几张图里都出现时，每张都写，后面会合并），不要只挑一两道。
最后：summary 用两三句话具体地说这几张画面里讲了哪些题和内容、学生做到了什么（积极、具体；不要写「不能证明」「无法判断」这类话，拿不准的就不写）；weak 列出看上去学生还要再练的知识点 key（拿不准就留空）。

知识点清单（key 名称）：
${pts}

只输出 JSON：{"frames":[{"i":0,"what":"…","questions":[{"stem":"…","tag":"…","box":[0,0,1000,1000],"answer":"","result":"none","points":["…"]}],"points":["…"]}],"summary":"…","weak":["…"]}`;
}

/** 分批看完以后合成整节课小结的提示词：只给各张画面的一句话和认出的题，不再看图 */
export function wholePrompt(o: { subject: SubjectId; who: string; title: string; res: AnalysisReply }): string {
  const lines = o.res.frames.map((f) => `- ${f.what}${f.questions.length ? '；题：' + f.questions.map((q) => q.stem.replace(/\s+/g, ' ').slice(0, 60)).join(' / ') : ''}`).slice(0, 160).join('\n');
  return `下面是一节一对一网课（${packOf(o.subject).stage}，学生：${o.who}，课题：${o.title}）按时间顺序每一页画面的内容和上面的题。\n${lines}\n\n分批看时写的小结：\n${o.res.summary}\n\n请合成整节课的小结：summary 3~5 句，按顺序说讲了哪些内容、哪几类题（同一道题只算一次，写清一共讲了几道）、学生做到了什么；语气积极、具体，不写「不能证明」「无法判断」这类话。weak 列出看上去还要再练的知识点 key（只能从分批里出现过的选，拿不准就留空）。只输出 JSON：{"summary":"…","weak":["…"]}`;
}

export interface FrameQuestion { stem: string; tag?: string; box: [number, number, number, number] | null; answer: string; result: Result | null; points: string[] }
export interface FrameRead { i: number; what: string; questions: FrameQuestion[]; points: string[] }
export interface AnalysisReply { frames: FrameRead[]; summary: string; weak: string[] }

const strs = (v: unknown, n = 10) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n) : []);
/** 模型回复 → 结构；frames 的 i 是这一批里的序号，换成全局序号（offset） */
export function parseAnalysis(v: unknown, count: number, offset = 0): AnalysisReply {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const frames: FrameRead[] = [];
  for (const [k, raw] of (Array.isArray(o.frames) ? o.frames : []).slice(0, count).entries()) {
    const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const i = Number.isInteger(f.i) && (f.i as number) >= 0 && (f.i as number) < count ? (f.i as number) : k;
    const qs: FrameQuestion[] = [];
    for (const q0 of (Array.isArray(f.questions) ? f.questions : []).slice(0, 6)) {
      const q = (q0 && typeof q0 === 'object' ? q0 : {}) as Record<string, unknown>;
      const stem = String(q.stem ?? '').trim().slice(0, 4000);
      if (stem.replace(/\s+/g, '').length < 8) continue;
      const b = Array.isArray(q.box) && q.box.length === 4 ? q.box.map(Number) : null;
      const box = b && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1] ? (b.map((x) => Math.max(0, Math.min(1000, x))) as [number, number, number, number]) : null;
      const r = String(q.result ?? ''), tag = String(q.tag ?? '').trim().slice(0, 24);
      qs.push({ stem, ...(tag ? { tag } : {}), box, answer: String(q.answer ?? '').trim().slice(0, 2000), result: r === 'right' || r === 'wrong' || r === 'half' ? r : null, points: strs(q.points, 3) });
    }
    frames.push({ i: i + offset, what: String(f.what ?? '').trim().slice(0, 200), questions: qs, points: strs(f.points, 3) });
  }
  return { frames, summary: String(o.summary ?? '').trim().slice(0, 1200), weak: strs(o.weak, 8) };
}

/** 几批回复合成一份；知识点 key 只留这个学科里有的 */
export function mergeReplies(list: AnalysisReply[], valid: Set<string>): AnalysisReply {
  const keep = (xs: string[]) => [...new Set(xs.filter((k) => valid.has(k)))];
  const frames = list.flatMap((r) => r.frames).map((f) => ({ ...f, points: keep(f.points), questions: f.questions.map((q) => ({ ...q, points: keep(q.points) })) }));
  return { frames, summary: list.map((r) => r.summary).filter(Boolean).join('\n'), weak: keep(list.flatMap((r) => r.weak)) };
}

/**
 * 录像分析后的学习地图：这节课做过题的知识点按掌握度往前推（同下课更新地图），
 * 只在画面上讲到、没做题的知识点从「未学」推到「在学」。往回退的只当建议。
 */
export function lessonMapPlan(pack: SubjectPack, grid: Grid, ms: Map<string, Mastery>, practiced: Set<string>, seen: Set<string>): MapPlan {
  const plan = planMap(pack, grid, ms, practiced), have = new Set(plan.apply.map((c) => c.key));
  for (const k of seen) {
    if (have.has(k)) continue;
    const at = localOf(k);
    if (!at || pointKey(pack, at.ci, at.si) !== k || grid[at.ci]?.[at.si] !== 'none') continue;
    plan.apply.push({ key: k, ci: at.ci, si: at.si, from: 'none', to: 'learning' });
  }
  return plan;
}
