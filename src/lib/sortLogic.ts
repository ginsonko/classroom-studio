// AI 整理的纯逻辑：认学生、认学科、解析模型回复、没有 AI 时的规则、整理单上的条目、花费估算。
// 不碰窗口和主进程，Node 里可以直接测试。
import { IMPORT_EXT, photoRegions, questionNo, splitQuestions, textLines, type Seg } from './importLogic';
import type { Result } from './studyLogic';
import { SUBJECTS, packOf, type SubjectId } from './subjects';

export type InputKind = 'image' | 'doc' | 'text';
/** 老师丢进来的一样东西：图片 / 文档（路径）或一段文字 */
export interface SortInput { id: string; kind: InputKind; name: string; path?: string; text?: string }

export type SortKind = 'exam' | 'graded' | 'chat' | 'score' | 'questions' | 'note' | 'doc' | 'photo';
export type Mark = Result | 'unsure' | 'none';
export interface ParentInfo { summary: string; reschedule: string; requirement: string }
export interface Region { n: number; segs: Seg[]; mark: Mark }
/** 一样东西的整理结果（整理单上的一张卡片） */
export interface Analysis {
  itemId: string; kind: SortKind; via: 'ai' | 'rules';
  /** 图上 / 文字里写的名字（可能不在学生名单里） */
  name: string; studentId: string; subject: SubjectId; title: string;
  regions?: Region[]; questions?: { n: number; stem: string }[];
  /** 照片拍歪了：顺时针转多少度才正，框是按转正后的图算的 */
  turn?: 90 | 180 | 270;
  text?: string; parent?: ParentInfo; note?: string;
  /** 每项要不要写入（老师在整理单上勾选） */
  take: Partial<Record<Action, boolean>>;
}
export type Action = 'questions' | 'attempts' | 'parent' | 'requirement' | 'reschedule' | 'score';

export const KIND_NAME: Record<SortKind, string> = {
  exam: '试卷 / 作业', graded: '批改过的卷子', chat: '家长消息', score: '成绩单', questions: '题目', note: '备注', doc: '文档', photo: '照片（待识别）',
};

export interface StudentLite { id: string; name: string; grade?: string; subject?: string; archived?: boolean }

export const inputKindOf = (path: string): InputKind | null => /\.(png|jpe?g|bmp|webp)$/i.test(path) ? 'image' : IMPORT_EXT.test(path) ? 'doc' : null;

/** 在文字里找名单上的学生（文件名「王荣浩月考.pdf」、聊天里「荣浩妈妈」）；名字越长越优先 */
export function findStudentIn(text: string, students: StudentLite[]): string | null {
  const t = String(text || '');
  const live = students.filter((s) => !s.archived && s.name.trim().length >= 2);
  const full = live.filter((s) => t.includes(s.name.trim())).sort((a, b) => b.name.length - a.name.length)[0];
  if (full) return full.id;
  // 只写了名（不带姓）：三个字的名字取后两个字，且要唯一
  const given = live.filter((s) => s.name.trim().length >= 3 && t.includes(s.name.trim().slice(1)));
  return given.length === 1 ? given[0].id : null;
}

/** 模型说的名字 → 学生；对不上就用老师选的学生，并说明一句 */
export function matchStudent(name: string, students: StudentLite[], fallback: string): { id: string; note?: string } {
  const n = String(name || '').replace(/\s+/g, '');
  if (!n) return { id: fallback };
  const hit = findStudentIn(n, students) ?? students.find((s) => !s.archived && s.name.length >= 2 && n.length >= 2 && s.name.includes(n))?.id;
  if (hit) return { id: hit };
  const fb = students.find((s) => s.id === fallback);
  return { id: fallback, note: `上面写的是「${n.slice(0, 12)}」，学生名单里没有，先记在${fb ? `「${fb.name}」` : '当前学生'}名下` };
}

/** 学科名（物理 / 英语）→ 和当前学科同一学段的学科；认不出来就用当前学科 */
export function subjectByName(name: string, current: SubjectId): SubjectId {
  const n = String(name || '').trim();
  if (!n) return current;
  const level = packOf(current).level;
  const same = SUBJECTS.filter((s) => n.includes(s.name) || (n.length >= 2 && s.name.includes(n)));
  return (same.find((s) => s.level === level) ?? same[0])?.id ?? current;
}

const RESCHEDULE = /(调课|改课|换课|请假|停课|暂停|推迟|延后|提前|改到|调到|换到|挪到|改成|改时间|换时间|来不了|上不了|不上了|顺延)/;
const REQUIRE = /(希望|麻烦|多讲|多练|重点|抓一下|帮忙|能不能|可不可以|要求|别太|不要太|侧重|加强)/;
const sentences = (t: string) => t.split(/[\n。！？!?；;]+/).map((s) => s.replace(/^[^：:]{1,12}[：:]\s*/, '').trim()).filter(Boolean);

/** 没有 AI 时从家长消息里找「调课」「要求」的句子 */
export function parentByRules(text: string): ParentInfo {
  const s = sentences(text);
  const re = s.filter((x) => RESCHEDULE.test(x)).slice(0, 2).join('；');
  const rq = s.filter((x) => REQUIRE.test(x) && !RESCHEDULE.test(x)).slice(0, 2).join('；');
  const first = s[0] ?? '';
  return { summary: (re || rq || first).slice(0, 120), reschedule: re.slice(0, 200), requirement: rq.slice(0, 200) };
}

/** 没有 AI 时的文字：带题号拆得出两道以上就是题目，否则当家长消息 */
export function textByRules(text: string): Pick<Analysis, 'kind' | 'questions' | 'parent' | 'text' | 'title'> {
  const pieces = splitQuestions(textLines(text)).pieces.filter((p) => p.stem.trim());
  if (pieces.length >= 2) return { kind: 'questions', questions: pieces.map((p) => ({ n: p.n, stem: p.stem })), title: `粘贴的 ${pieces.length} 道题` };
  if (/(成绩|分数|得分|总分|排名|名次)/.test(text) && /\d/.test(text)) return { kind: 'score', text: text.trim().slice(0, 4000), title: '成绩' };
  return { kind: 'chat', text: text.trim().slice(0, 20000), parent: parentByRules(text), title: '家长消息' };
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const parentOf = (v: unknown): ParentInfo | undefined => {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return undefined;
  const p = { summary: str(o.summary, 200), reschedule: str(o.reschedule, 200), requirement: str(o.requirement, 200) };
  // 模型常把「没有」写成文字
  for (const k of ['reschedule', 'requirement', 'summary'] as const) if (/^(无|没有|空|none|null|n\/a|-)$/i.test(p[k])) p[k] = '';
  return p.summary || p.reschedule || p.requirement ? p : undefined;
};
const MARKS: Mark[] = ['right', 'wrong', 'half', 'unsure', 'none'];
/** 一道大题几个小问的批改合成一个：有没认准的就算没认准；有对有错算半对 */
export function joinMarks(ms: Mark[]): Mark {
  const seen = ms.filter((m) => m !== 'none');
  if (!seen.length) return 'none';
  if (seen.includes('unsure')) return 'unsure';
  return seen.every((m) => m === seen[0]) ? seen[0] : 'half';
}

/** 看图回复 → 类型、题目框 + 批改、文字、家长消息 */
export function parseImageReply(v: unknown, w = 0, h = 0): Pick<Analysis, 'kind' | 'name' | 'title' | 'regions' | 'text' | 'parent'> & { subjectName: string } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = (['exam', 'graded', 'chat', 'score'] as const).find((k) => k === o.kind) ?? 'note';
  const base = { name: str(o.student, 40), subjectName: str(o.subject, 20), title: str(o.title, 60) };
  if (kind === 'exam' || kind === 'graded') {
    const list = Array.isArray(o.questions) ? o.questions as Record<string, unknown>[] : [];
    const regions = photoRegions({ questions: list }, w, h);
    // photoRegions 按题号排序、去重、把小问并成一道了；批改结果按题号对回去，小问的对错合起来
    const marks = new Map<number, Map<string, Mark>>();
    list.forEach((q, i) => {
      const no = questionNo(q?.n) ?? { n: i + 1, label: String(i + 1) }, m = MARKS.find((x) => x === q?.mark) ?? 'none';
      const g = marks.get(no.n) ?? new Map<string, Mark>(); marks.set(no.n, g);
      if (!g.has(no.label)) g.set(no.label, m);
    });
    const rs: Region[] = regions.map((r) => ({ ...r, mark: kind === 'graded' ? joinMarks([...(marks.get(r.n)?.values() ?? [])]) : 'none' }));
    const graded = kind === 'graded' && rs.some((r) => r.mark !== 'none');
    return { ...base, kind: graded ? 'graded' : 'exam', regions: rs };
  }
  return { ...base, kind, text: str(o.text, 20000), parent: kind === 'chat' ? parentOf(o.parent) ?? parentByRules(str(o.text, 20000)) : undefined };
}

/** 文字回复 → 类型、题目、家长消息 */
export function parseTextReply(v: unknown, text: string): Pick<Analysis, 'kind' | 'name' | 'title' | 'questions' | 'text' | 'parent'> & { subjectName: string } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = (['chat', 'questions', 'score', 'note'] as const).find((k) => k === o.kind) ?? 'chat';
  const base = { name: str(o.student, 40), subjectName: str(o.subject, 20), title: str(o.title, 60) };
  if (kind === 'questions') {
    const qs = (Array.isArray(o.questions) ? o.questions as Record<string, unknown>[] : []).map((q, i) => ({ n: Number(q?.n) || i + 1, stem: str(q?.stem, 4000) })).filter((q) => q.stem).slice(0, 100);
    if (qs.length) return { ...base, kind, questions: qs };
    const r = textByRules(text);
    return { ...base, ...r, kind: r.kind === 'questions' ? 'questions' : 'note', text: text.trim() };
  }
  return { ...base, kind, text: text.trim().slice(0, 20000), parent: kind === 'chat' ? parentOf(o.parent) ?? parentByRules(text) : undefined };
}

/** 整理单上这一张卡片能做哪几件事（默认都勾上；批改没认准的题不记分） */
export function actionsOf(a: Pick<Analysis, 'kind' | 'regions' | 'questions' | 'parent'>): Action[] {
  const out: Action[] = [];
  if (a.kind === 'exam' || a.kind === 'graded' || a.kind === 'questions' || a.kind === 'doc' || a.kind === 'photo') out.push('questions');
  if (a.kind === 'graded' && a.regions?.some((r) => r.mark === 'right' || r.mark === 'wrong' || r.mark === 'half' || r.mark === 'unsure')) out.push('attempts');
  if (a.kind === 'chat' || a.kind === 'note') out.push('parent');
  if (a.parent?.requirement) out.push('requirement');
  if (a.parent?.reschedule) out.push('reschedule');
  if (a.kind === 'score') out.push('score');
  return out;
}
export const defaultTake = (a: Pick<Analysis, 'kind' | 'regions' | 'questions' | 'parent'>) => Object.fromEntries(actionsOf(a).map((k) => [k, true])) as Analysis['take'];

export function markCount(regions: Region[] = []) {
  const c = { right: 0, wrong: 0, half: 0, unsure: 0, none: 0 };
  for (const r of regions) c[r.mark]++;
  return c;
}

/** 整理单上每件事的说明 */
export function actionText(a: Analysis, k: Action, studentName: string): string {
  switch (k) {
    case 'questions':
      if (a.kind === 'photo') return '没配 AI：照片原样存进收件箱，配好 AI 后再拆成一道道题';
      if (a.kind === 'doc') return '按题号拆题，存进收件箱' + (a.via === 'ai' ? '（AI 随后补答案、知识点）' : '');
      if (a.regions) return a.regions.length ? `拆出 ${a.regions.length} 题，逐题截图存进收件箱（AI 随后补题干、答案、知识点）` : '照片上没找到题目，整张存进收件箱';
      return `${a.questions?.length ?? 0} 道题存进收件箱`;
    case 'attempts': {
      const c = markCount(a.regions);
      return `按红笔批改记进${studentName}的学情：错 ${c.wrong} · 半对 ${c.half} · 对 ${c.right}` + (c.unsure ? `；${c.unsure} 道没认准，先不记，归档后你来点对错` : '');
    }
    case 'parent': return a.kind === 'note' ? `存进${studentName}的档案（老师备注）` : `存进${studentName}的档案（家长消息）` + (a.parent?.summary ? `：${a.parent.summary}` : '');
    case 'requirement': return `记下家长要求：${a.parent?.requirement ?? ''}`;
    case 'reschedule': return `提醒你去调课表：${a.parent?.reschedule ?? ''}（课表不会自动改）`;
    case 'score': return `成绩记进${studentName}的档案`;
  }
}

/**
 * 花费估算（token 数）：看图找题 + 每道题识题、自检。只给老师一个量级。
 * 经验值来自真实错题照片实测（看图一张约 7~15k 输入；每题识题 + 自检两次各带一次截图，合计约 18k 输入、2k 输出）。
 * 学生拍的错题照片平均每张 3 题，文档默认 10 题。
 */
export function estimateTokens(items: SortInput[]): { vision: { input: number; output: number }; text: { input: number; output: number }; calls: number } {
  const v = { input: 0, output: 0 }, t = { input: 0, output: 0 };
  let calls = 0;
  const perQuestion = (n: number, vis: boolean) => { const x = vis ? v : t; x.input += n * 18000; x.output += n * 2000; calls += n * 2; };
  for (const it of items) {
    if (it.kind === 'image') { v.input += 10000; v.output += 1000; calls++; perQuestion(3, true); }
    else if (it.kind === 'doc') perQuestion(10, true);
    else { const n = (it.text ?? '').length; t.input += 700 + n; t.output += 500 + Math.min(n, 3000); calls++; }
  }
  return { vision: v, text: t, calls };
}
