// 下课分析录像的纯逻辑：挑哪几帧给看图模型、提示词、解析回复。Node 里可以直接测。
import type { Chapter } from './timeline';
import { pointsOf, type Mastery, type Result } from './studyLogic';
import { localOf, packOf, pointKey, type SubjectId, type SubjectPack } from './subjects';
import { planMap, type Grid, type MapPlan } from './mapLogic';

export const MAX_FRAMES = 12;
export const BATCH = 6;
const GAP = 20;

const mmss = (t: number) => { const s = Math.max(0, Math.floor(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * 挑截帧的时间点：
 * - 记作答 / 收题的那一刻（题就在屏幕上）；
 * - 每段课件 / 每页 / 每块黑板结束前 2 秒（写满了的样子）；
 * - 还不够就按时长均匀补。
 * 彼此至少隔 20 秒，最多 max 张，按时间排好。
 */
export function pickFrames(chapters: Chapter[], duration: number, max = MAX_FRAMES): number[] {
  if (!(duration > 1)) return [];
  const end = Math.max(0, duration - 1), list = [...chapters].filter((c) => c.t >= 0 && c.t <= duration).sort((a, b) => a.t - b.t);
  const marks = list.filter((c) => c.kind === 'attempt' || c.kind === 'question').map((c) => Math.max(0, c.t - 1));
  const views = list.filter((c) => c.kind === 'material' || c.kind === 'page' || c.kind === 'board');
  const ends = views.map((c, i) => { const next = views[i + 1]?.t ?? duration; return Math.min(end, Math.max(c.t + 3, next - 2)); }).filter((t) => t > 0);
  const out: number[] = [];
  const take = (t: number) => { if (out.length < max && out.every((x) => Math.abs(x - t) >= Math.min(GAP, duration / (max * 2)))) out.push(t); };
  for (const t of spread(marks, Math.ceil(max / 2))) take(t);
  for (const t of spread(ends, max)) take(t);
  for (let i = 1; out.length < max && i <= max; i++) take(Math.min(end, (duration * i) / (max + 1)));
  return out.sort((a, b) => a - b).map((t) => Math.round(t * 10) / 10);
}
/** 太多时均匀挑 n 个 */
function spread(xs: number[], n: number): number[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / Math.max(1, n - 1))]);
}

export function timelineText(chapters: Chapter[]): string {
  const NAME: Record<Chapter['kind'], string> = { material: '打开课件', page: '翻页', board: '黑板', attempt: '记作答', question: '收题', note: '备注' };
  return chapters.slice(0, 200).map((c) => `${mmss(c.t)} ${NAME[c.kind]} ${c.title}`).join('\n');
}

export function analysisPrompt(o: { subject: SubjectId; student: string; title: string; chapters: Chapter[]; times: number[] }): string {
  const pts = pointsOf(o.subject).map((p) => `${p.key} ${p.ch}·${p.sec}`).join('\n');
  return `你在帮一位网课老师复盘刚上完的一节课（${packOf(o.subject).stage}，学生：${o.student}，课题：${o.title}）。
附上的是课堂录像里的 ${o.times.length} 张截图（学生看到的画面：课件、黑板、老师的批注），拍摄时间依次是：${o.times.map(mmss).join('、')}。
${o.chapters.length ? `软件记下的课堂时间线：\n${timelineText(o.chapters)}\n` : ''}
请逐张看图，只写你在画面上真的看到的东西，不要猜：
1. 这张画面在讲什么（一句话）。
2. 画面上完整出现的题目：题干文字照抄（公式用 LaTeX，$...$ 包起来），题目在图上的位置框 box=[x0,y0,x1,y1]（0~1000，左上角为原点），能看到的答案；
   如果老师在这道题上打了勾 / 叉 / 写了对错（通常是红色批注），result 填 right / wrong / half，看不出来填 none。
3. 这张画面涉及的知识点 key（只能从下面的清单里选，最多 3 个）。
最后：summary 用两三句话说这节课讲了哪些内容、学生哪里卡住了（看不出就不写）；weak 列出看上去学生没掌握的知识点 key（证据不足就留空）。

知识点清单（key 名称）：
${pts}

只输出 JSON：{"frames":[{"i":0,"what":"…","questions":[{"stem":"…","box":[0,0,1000,1000],"answer":"","result":"none","points":["…"]}],"points":["…"]}],"summary":"…","weak":["…"]}`;
}

export interface FrameQuestion { stem: string; box: [number, number, number, number] | null; answer: string; result: Result | null; points: string[] }
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
      const r = String(q.result ?? '');
      qs.push({ stem, box, answer: String(q.answer ?? '').trim().slice(0, 2000), result: r === 'right' || r === 'wrong' || r === 'half' ? r : null, points: strs(q.points, 3) });
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
