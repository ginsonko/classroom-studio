// AI 自动处理的纯逻辑：哪些课该写课后总结、哪些课该备课、备课提示词和备课文档。
// 不碰窗口和主进程，Node 里可以直接测试。
import { dateKey, localDate, onDate } from '../doc/scheduleModel';
import type { LessonSlot, Student } from './types';
import { DIFF_NAME, looseJSON, pointLabel, themeLine, type Prep, type Question, type StudentNote, type StudyData } from './studyLogic';
import { packOf, type SubjectId } from './subjects';
import type { CatEntry } from './catalogLogic';

export interface AutoSettings {
  on: boolean;
  lesson: boolean;       // 课后：总结 + 家长反馈草稿 + 长图
  homework: boolean;     // 课后：从题库组作业
  original: boolean;     // 题库不够时 AI 原创补齐（每道自检）
  prep: boolean;         // 课前：自动备课
  prepHours: number;     // 提前多少小时备课
  courseware: boolean;   // 本地没有合适课件时 AI 写一份课件
  agent: boolean;        // 本地没有课件时交给后台 Agent 联网整理（更贵）
  agentCap: number;      // 后台 Agent 单次上限（元）
  catalog: boolean;      // 自动整理资料库
  hwCount: number;
  dailyJobs: number;     // 每天最多自动跑多少个用 AI 的任务
}
export const DEFAULT_AUTO: AutoSettings = { on: false, lesson: true, homework: true, original: true, prep: true, prepHours: 20, courseware: true, agent: false, agentCap: 3, catalog: true, hwCount: 6, dailyJobs: 12 };
export function cleanSettings(v: unknown): AutoSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<AutoSettings>, d = DEFAULT_AUTO;
  const b = (k: keyof AutoSettings) => (typeof o[k] === 'boolean' ? o[k] as boolean : d[k] as boolean);
  const n = (k: keyof AutoSettings, lo: number, hi: number) => { const x = Number(o[k]); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d[k] as number; };
  return { on: b('on'), lesson: b('lesson'), homework: b('homework'), original: b('original'), prep: b('prep'), prepHours: n('prepHours', 2, 72), courseware: b('courseware'), agent: b('agent'), agentCap: n('agentCap', 1, 20), catalog: b('catalog'), hwCount: n('hwCount', 3, 20), dailyJobs: n('dailyJobs', 1, 60) };
}

export interface DueLesson { studentId: string; date: string; topic: string; minutes?: number; slotId?: string; key: string }
/**
 * 该写课后总结的课：今天排了课、下课超过 15 分钟；或者今天有作答记录、最后一次作答已过 40 分钟（没排课的临时课）。
 * 已经有当天总结、或已处理过（done 里有）的跳过。
 */
export function dueLessons(now: Date, slots: LessonSlot[], students: Student[], data: StudyData, done: Set<string>): DueLesson[] {
  const today = dateKey(now), hour = now.getHours() + now.getMinutes() / 60, out: DueLesson[] = [];
  const has = (sid: string) => data.lessons.some((l) => l.studentId === sid && l.date === today);
  const live = students.filter((s) => !s.archived);
  for (const s of slots) {
    const st = live.find((x) => x.id === s.studentId);
    if (!st || !onDate(s, now) || s.start + s.len + 0.25 > hour) continue;
    const key = `lesson:${s.studentId}:${today}`;
    if (done.has(key) || has(s.studentId) || out.some((x) => x.key === key)) continue;
    out.push({ studentId: s.studentId, date: today, topic: s.topic && s.topic !== '一对一课程' ? s.topic : st.lastTopic, minutes: Math.round(s.len * 60), slotId: s.id, key });
  }
  for (const st of live) {
    const key = `lesson:${st.id}:${today}`;
    if (done.has(key) || has(st.id) || out.some((x) => x.key === key)) continue;
    const mine = data.attempts.filter((a) => a.studentId === st.id && dateKey(new Date(a.at)) === today);
    if (!mine.length) continue;
    const last = Math.max(...mine.map((a) => Date.parse(a.at)));
    if (now.getTime() - last < 40 * 60000) continue;
    out.push({ studentId: st.id, date: today, topic: st.lastTopic, key });
  }
  return out;
}

export interface Upcoming { studentId: string; slotId: string; date: string; start: number; len: number; topic: string; key: string; inHours: number }
/** 接下来 hours 小时内要上的课（还没备过课的） */
export function upcoming(now: Date, slots: LessonSlot[], students: Student[], hours: number, preps: Prep[], done: Set<string>): Upcoming[] {
  const out: Upcoming[] = [];
  const live = new Set(students.filter((s) => !s.archived).map((s) => s.id));
  for (let k = 0; k <= Math.ceil(hours / 24) + 1; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k), date = dateKey(day);
    for (const s of slots) {
      if (!live.has(s.studentId) || !onDate(s, day)) continue;
      const at = localDate(date); at.setHours(Math.floor(s.start), Math.round((s.start % 1) * 60), 0, 0);
      const inHours = (at.getTime() - now.getTime()) / 3600000;
      if (inHours < 0 || inHours > hours) continue;
      const key = `prep:${s.id}:${date}`;
      if (done.has(key) || preps.some((p) => p.slotId === s.id && p.date === date)) continue;
      out.push({ studentId: s.studentId, slotId: s.id, date, start: s.start, len: s.len, topic: s.topic, key, inHours });
    }
  }
  return out.sort((a, b) => a.inHours - b.inHours);
}

// ── 备课 ─────────────────────────────────────────────
export interface PrepInput {
  student: Pick<Student, 'name' | 'grade' | 'textbook' | 'tags'>; subject: SubjectId; topic: string; minutes: number;
  points: string[]; weak: string[]; materials: CatEntry[]; files: CatEntry[]; questions: { q: Question; why: string }[];
  notes: StudentNote[]; lastLessons: { date: string; topic: string; summary: string; next: string[] }[];
}
export interface PrepPlan { goals: string[]; flow: { min: number; step: string }[]; focus: string[]; materials: number[]; questions: number[]; parent: string; gaps: string }

const NOTE_NAME: Record<StudentNote['kind'], string> = { parent: '家长聊天记录', requirement: '家长要求', teacher: '老师备注' };
export function notesText(notes: StudentNote[], max = 2400) {
  let left = max; const out: string[] = [];
  for (const n of [...notes].sort((a, b) => b.at.localeCompare(a.at))) {
    if (left <= 0) break;
    const t = n.text.trim().slice(0, left); left -= t.length;
    out.push(`【${NOTE_NAME[n.kind]} ${n.at.slice(0, 10)}】${t}`);
  }
  return out.join('\n');
}

export function prepPrompt(i: PrepInput): string {
  const pack = packOf(i.subject);
  return [
    `为一对一${pack.stage}课备课。学生：${i.student.name}，${i.student.grade || '年级未填'}，教材 ${i.student.textbook || pack.textbook}${i.student.tags.length ? '，标签：' + i.student.tags.join('、') : ''}。本节课主题：${i.topic || '未填写（按学情定）'}，${i.minutes} 分钟。`,
    i.points.length ? '相关知识点：' + i.points.map(pointLabel).join('、') : '',
    i.weak.length ? '学情里的薄弱点（正确率低于 60%）：' + i.weak.map(pointLabel).join('、') : '',
    i.lastLessons.length ? '最近的课后总结：\n' + i.lastLessons.map((l) => `${l.date} ${l.topic}：${l.summary.slice(0, 200)}${l.next.length ? '；下一步：' + l.next.join('；') : ''}`).join('\n') : '',
    i.notes.length ? '家长沟通 / 要求（只作参考，不要照抄隐私内容）：\n' + notesText(i.notes) : '',
    i.materials.length ? '本地课件库里找到的课件（优先用这些）：\n' + i.materials.map((m, k) => `${k + 1}. ${m.title}${m.topic && m.topic !== m.title ? `（${m.topic}）` : ''}`).join('\n') : '本地课件库里没有找到对应课件。',
    i.files.length ? '本地题库文件：\n' + i.files.map((m) => '- ' + m.title).join('\n') : '',
    i.questions.length ? '题库里可用的题（序号从 1 开始）：\n' + i.questions.map(({ q, why }, k) => `${k + 1}. [${DIFF_NAME[q.difficulty]}] ${(q.stem || '看图题').slice(0, 120)}（${why}）`).join('\n') : '',
    '请写备课建议：教学目标 2~4 条；课堂流程按分钟分配（合计接近课时）；本节课要特别关注的点（结合薄弱点和家长要求）；从上面的课件里选要用的（写序号）；从题库题里选课上讲练的（写序号，3~6 道，由易到难）；如果家长有要求，写一句怎么回应；缺什么资料写在 gaps。只基于上面的信息，不编造学生情况。',
    '输出 JSON：{"goals":[""],"flow":[{"min":10,"step":"环节和做法"}],"focus":[""],"materials":[1],"questions":[1,2],"parent":"","gaps":""}',
  ].filter(Boolean).join('\n\n');
}
const strs = (v: unknown, n: number, max = 200) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim().slice(0, max) : '')).filter(Boolean).slice(0, n) : []);
const idx = (v: unknown, len: number) => (Array.isArray(v) ? [...new Set(v.map((x) => Math.round(Number(x)) - 1).filter((k) => k >= 0 && k < len))] : []);
export function parsePrep(raw: string, i: PrepInput): PrepPlan | null {
  const j = looseJSON(raw) as Record<string, unknown> | null;
  if (!j) return null;
  const goals = strs(j.goals, 5);
  const flow = (Array.isArray(j.flow) ? j.flow : []).map((f) => { const o = f as Record<string, unknown>; return { min: Math.max(1, Math.min(120, Math.round(Number(o?.min)) || 5)), step: typeof o?.step === 'string' ? o.step.trim().slice(0, 200) : '' }; }).filter((f) => f.step).slice(0, 10);
  if (!goals.length || !flow.length) return null;
  return { goals, flow, focus: strs(j.focus, 6), materials: idx(j.materials, i.materials.length), questions: idx(j.questions, i.questions.length).slice(0, 8), parent: typeof j.parent === 'string' ? j.parent.trim().slice(0, 300) : '', gaps: typeof j.gaps === 'string' ? j.gaps.trim().slice(0, 300) : '' };
}
/** 没配 AI：按学情和找到的资料搭一个备课框架 */
export function prepByRules(i: PrepInput): PrepPlan {
  const ask = [...i.notes].filter((n) => n.kind !== 'teacher').sort((a, b) => (a.kind === b.kind ? b.at.localeCompare(a.at) : a.kind === 'requirement' ? -1 : 1))[0];
  const m = i.minutes, focus = [...i.weak.slice(0, 2).map((k) => '薄弱点：' + pointLabel(k)), ...(ask ? [`家长${ask.kind === 'requirement' ? '要求' : '聊天'}（${ask.at.slice(0, 10)}）：${ask.text.replace(/\s+/g, ' ').slice(0, 80)}${ask.text.length > 80 ? '…' : ''}`] : [])];
  return {
    goals: i.points.length ? i.points.slice(0, 3).map((k) => '理解并会用：' + pointLabel(k)) : [`完成「${i.topic || '本节课'}」的学习`],
    flow: [{ min: Math.round(m * 0.1), step: '回顾上节课和作业错题' }, { min: Math.round(m * 0.4), step: '讲新知识 / 专题方法' }, { min: Math.round(m * 0.35), step: '例题讲练，学生先做再讲' }, { min: Math.round(m * 0.15), step: '小结，布置作业' }],
    focus, materials: i.materials.slice(0, 2).map((_, k) => k), questions: i.questions.slice(0, 5).map((_, k) => k), parent: '', gaps: i.materials.length ? '' : '本地课件库里没有找到对应课件',
  };
}

export function prepMarkdown(p: { topic: string; date: string; start?: number; minutes: number; subject: SubjectId }, studentName: string, plan: PrepPlan, i: PrepInput, extra: { courseware?: string[]; agentTask?: string } = {}): string {
  const hhmm = (h?: number) => (h === undefined ? '' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
  const mats = plan.materials.map((k) => i.materials[k]).filter(Boolean);
  const qs = plan.questions.map((k) => i.questions[k]).filter(Boolean);
  const out = [
    themeLine(p.subject), `# ${studentName} · 备课：${p.topic || '本节课'}`,
    `日期：${p.date}${p.start !== undefined ? ' ' + hhmm(p.start) : ''}　　时长：${p.minutes} 分钟　　学科：${packOf(p.subject).stage}`,
    '## 教学目标', plan.goals.map((g) => '- ' + g).join('\n'),
    '## 课堂流程', '| 时间 | 环节 |\n|---|---|\n' + plan.flow.map((f) => `| ${f.min} 分钟 | ${f.step.replace(/\|/g, '/')} |`).join('\n'),
  ];
  if (plan.focus.length) out.push('## 重点关注', plan.focus.map((g) => '- ' + g).join('\n'));
  if (plan.parent) out.push('## 回应家长', plan.parent);
  out.push('## 要用的课件', mats.length ? mats.map((m) => `- ${m.title}`).join('\n') + '\n\n> 课件路径：' + mats.map((m) => m.path).join('；') : '本地课件库里没有合适的课件。');
  if (extra.courseware?.length) out.push('> AI 已原创一份课件：' + extra.courseware.map((f) => f.split('/').pop()).join('、'));
  if (extra.agentTask) out.push('> 已交给后台 Agent 联网整理公开资料，进度在「备课」页查看：' + extra.agentTask);
  if (qs.length) {
    out.push('## 课上讲练');
    qs.forEach(({ q }, k) => out.push(`**${k + 1}.** ${(q.stem || '（看图题，见题库）').replace(/\n{2,}/g, '\n')}　（${q.qtype}，${DIFF_NAME[q.difficulty]}）` + (q.answer ? `\n\n> 答案：${q.answer.replace(/\n+/g, ' ')}` : '')));
  }
  if (plan.gaps) out.push('## 还缺的资料', plan.gaps);
  return out.join('\n\n') + '\n';
}

/** 今天已经跑了几个用 AI 的自动任务 */
export function jobsToday(log: { at: string; ai?: boolean }[], now = new Date()) { const d = dateKey(now); return log.filter((l) => l.ai && dateKey(new Date(l.at)) === d).length; }
export const prepFor = (preps: Prep[], studentId: string) => preps.filter((p) => p.studentId === studentId).sort((a, b) => b.at.localeCompare(a.at));
