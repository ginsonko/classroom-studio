// AI 自动处理：老师开启后（默认关闭），课后自动写总结和家长反馈、组作业，课前自动备课，空闲时整理资料库。
// 在教师窗口里每 5 分钟看一次；每天用 AI 的任务数有上限，后台 Agent 另有单任务花费上限。
// 设置和记录存在 DATA/study/autopilot.json。家长反馈只写草稿，发送仍由老师确认。
import { create } from 'zustand';
import { host } from './host';
import { useStore } from './store';
import { useLib } from './useLib';
import { useStudy, ensureStudy, addQuestion, sid, nowIso } from './studyStore';
import { aiConfig, buildLessonNote, dayKey, exportHomework, homeworkTitle, lessonDocument, saveLesson } from './studyActions';
import { draftQuestions, online, outlineByAi } from './studyAi';
import { guessPoints, guessType, mastery, outlineMarkdown, pickHomework, type Prep, type StudentNote } from './studyLogic';
import { packOf, studentSubject } from './subjects';
import { ai } from './ai';
import { ensureCatalog, findLocal, organizeByAi, organizeByRules, putEntries } from './catalog';
import { cleanSettings, dueLessons, jobsToday, parsePrep, prepByRules, prepMarkdown, prepPrompt, upcoming, type AutoSettings, type PrepInput } from './autopilotLogic';
import type { Student } from './types';
import { isDefaultTopic } from './groups';

export interface LogItem { id: string; at: string; kind: 'lesson' | 'homework' | 'prep' | 'catalog' | 'note' | 'error'; text: string; studentId?: string; files?: string[]; ai?: boolean }
interface AutoState { settings: AutoSettings; log: LogItem[]; done: string[]; loaded: boolean; running: string; lastRun: number }
export const useAuto = create<AutoState>()(() => ({ settings: cleanSettings({}), log: [], done: [], loaded: false, running: '', lastRun: 0 }));

let loading: Promise<void> | null = null;
export function ensureAuto() {
  if (!loading) loading = (async () => {
    if (!host.electron) { useAuto.setState({ loaded: true }); return; }
    try {
      const v = await host.call<{ settings?: unknown; log?: LogItem[]; done?: string[] } | null>('study.store', 'autopilot');
      useAuto.setState({ settings: cleanSettings(v?.settings), log: Array.isArray(v?.log) ? v!.log.slice(-300) : [], done: Array.isArray(v?.done) ? v!.done.slice(-3000) : [], loaded: true });
    } catch { useAuto.setState({ loaded: true }); }
  })();
  return loading;
}
function persist() {
  if (!host.electron) return;
  const s = useAuto.getState();
  void host.call('study.saveStore', { name: 'autopilot', value: { version: 1, settings: s.settings, log: s.log.slice(-300), done: s.done.slice(-3000) } }).catch(() => {});
}
export function setAuto(p: Partial<AutoSettings>) { useAuto.setState((s) => ({ settings: cleanSettings({ ...s.settings, ...p }) })); persist(); }
function log(item: Omit<LogItem, 'id' | 'at'>) { useAuto.setState((s) => ({ log: [...s.log, { ...item, id: sid(), at: nowIso() }].slice(-300) })); persist(); }
function markDone(key: string) { useAuto.setState((s) => ({ done: [...s.done.filter((k) => k !== key), key].slice(-3000) })); persist(); }
export function clearLog() { useAuto.setState({ log: [] }); persist(); }

/** 开启前检查：必须先配好 AI */
export async function canEnable(): Promise<string> {
  const cfg = await aiConfig();
  return online(cfg) ? '' : '还没有配置 AI（接口地址、Key、模型）。请先在右侧 AI 助手的设置里配置，再开启自动处理。';
}

const studentOf = (id: string) => useStore.getState().students.find((s) => s.id === id);
const budgetLeft = () => { const s = useAuto.getState(); return s.settings.dailyJobs - jobsToday(s.log); };

// ── 学生资料（家长聊天记录、要求） ───────────────────────────
export function addNote(n: Omit<StudentNote, 'id' | 'at'>) {
  const note: StudentNote = { ...n, text: n.text.trim().slice(0, 20000), id: sid(), at: nowIso() };
  if (!note.text) return;
  useStudy.getState().update((d) => ({ ...d, notes: [...(d.notes ?? []), note] }));
}
export function removeNote(id: string) { useStudy.getState().update((d) => ({ ...d, notes: (d.notes ?? []).filter((n) => n.id !== id) })); }

// ── 课后 ─────────────────────────────────────────────
async function afterLesson(l: { studentId: string; date: string; topic: string; minutes?: number; key: string; groupId?: string }, s: AutoSettings, cfgOnline: boolean) {
  const st = studentOf(l.studentId);
  if (!st) { markDone(l.key); return; }
  const subject = studentSubject(st), data = useStudy.getState().data, files: string[] = [];
  let homework = '';
  if (s.homework) {
    const todays = data.attempts.filter((a) => a.studentId === st.id && dayKey(a.at) === l.date);
    const qs = new Map(data.questions.map((q) => [q.id, q]));
    const bad = [...new Set(todays.filter((a) => a.result !== 'right').flatMap((a) => qs.get(a.questionId)?.points ?? []))];
    const points = bad.length ? bad.slice(0, 4) : guessPoints(l.topic || '', subject).slice(0, 3);
    const r = pickHomework({ studentId: st.id, points, count: s.hwCount, minD: 1, maxD: 4, redo: 2, avoidDays: 14, subject }, data);
    let picked = r.picked;
    if (r.short > 0 && s.original && cfgOnline && (points.length || r.points.length)) {
      try {
        const pts = points.length ? points : r.points;
        const avoid = data.questions.filter((q) => q.points.some((k) => pts.includes(k))).map((q) => q.stem).filter(Boolean);
        const { drafts } = await draftQuestions(pts, r.short, 1, 4, avoid);
        for (const d of drafts) {
          const q = addQuestion({ stem: d.stem, answer: d.answer, analysis: d.analysis, points: d.points, difficulty: d.difficulty, qtype: guessType(d.stem, subject), origin: 'ai', status: d.check === 'ok' ? 'bank' : 'inbox', check: d.check, checkNote: d.checkNote, source: 'AI 原创（自动作业）', subject });
          if (d.check === 'ok') picked = [...picked, { q, why: 'AI 原创 · 已自检' }];
        }
      } catch (e) { log({ kind: 'error', text: `${st.name} 的作业 AI 补题失败：${(e as Error).message}`, studentId: st.id }); }
    }
    if (picked.length) {
      homework = homeworkTitle(st.name, points.length ? points : r.points);
      const out = await exportHomework({ studentId: st.id, name: st.name, title: homework, questions: picked.map((p) => p.q), points: points.length ? points : r.points });
      files.push(...out.out);
      log({ kind: 'homework', text: `${st.name}：组好作业「${homework}」${picked.length} 题${out.errors.length ? '（' + out.errors.join('；') + '）' : ''}`, studentId: st.id, files: out.out, ai: cfgOnline && s.original });
    }
  }
  if (s.lesson) {
    const { note, warning } = await buildLessonNote({ studentId: st.id, name: st.name, date: l.date, topic: l.topic, minutes: l.minutes, homework, groupId: l.groupId });
    saveLesson(note);
    const out = await lessonDocument(note, st.name, ['png', 'pdf']);
    files.push(...out.out);
    log({ kind: 'lesson', text: `${st.name}：写好 ${l.date} 的课后总结和家长反馈草稿（${note.via === 'ai' ? 'AI' : '模板'}）。到「学情 → 课后总结」确认后再发给家长。${warning ? ' ' + warning : ''}`, studentId: st.id, files: out.out, ai: note.via === 'ai' });
  }
  markDone(l.key);
}

// ── 课前备课 ───────────────────────────────────────────
export async function makePrep(o: { studentId: string; topic: string; date: string; start?: number; minutes: number; slotId?: string; auto?: boolean; settings?: AutoSettings }, onStep?: (t: string) => void): Promise<Prep> {
  ensureStudy(); await ensureCatalog();
  const st = studentOf(o.studentId);
  if (!st) throw new Error('找不到这位学生');
  const s = o.settings ?? useAuto.getState().settings, subject = studentSubject(st), data = useStudy.getState().data;
  const cfg = await aiConfig(), on = online(cfg);
  const topicPoints = guessPoints(o.topic || '', subject).slice(0, 3);
  const weak = [...mastery(st.id, data, subject).values()].filter((m) => m.score < 0.6).sort((a, b) => a.score - b.score).map((m) => m.key).slice(0, 3);
  const points = topicPoints.length ? topicPoints : weak;
  onStep?.('在本地课件库和题库里找资料…');
  const materials = findLocal({ text: o.topic, subject, points, shelf: 'courseware' }, 6).map((x) => x.e);
  const files = findLocal({ text: o.topic, subject, points, shelf: 'questions' }, 4).map((x) => x.e);
  const questions = pickHomework({ studentId: st.id, points, count: 6, minD: 1, maxD: 5, redo: 2, avoidDays: 7, subject }, data).picked;
  const notes = (data.notes ?? []).filter((n) => n.studentId === st.id);
  const lastLessons = data.lessons.filter((l) => l.studentId === st.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2).map((l) => ({ date: l.date, topic: l.topic, summary: l.summary, next: l.next }));
  const input: PrepInput = { student: st, subject, topic: o.topic, minutes: o.minutes, points, weak, materials, files, questions, notes, lastLessons };
  let plan = prepByRules(input), via: Prep['via'] = 'rules';
  if (on) {
    onStep?.('AI 写备课建议…');
    try {
      const r = await ai.chat([{ role: 'system', content: '你是经验丰富的一对一辅导老师，备课具体、可执行。只输出 JSON。' }, { role: 'user', content: prepPrompt(input) }], { json: true, maxTokens: 2500, temperature: 0.4, feature: 'AI 备课' });
      const p = parsePrep(r.content, input);
      if (p) { plan = p; via = 'ai'; }
    } catch (e) { onStep?.('AI 备课失败，改用模板：' + (e as Error).message); }
  }
  const courseware: string[] = [];
  let agentTask = '';
  // 找到的课件 AI 一份都没选（主题对不上）也算没有本地课件
  const noLocal = !plan.materials.length;
  if (noLocal && on && s.courseware) {
    onStep?.('本地没有合适课件，AI 写一份课件…');
    try {
      const examples = questions.map((p) => p.q).filter((q) => q.stem).slice(0, 4);
      const { outline } = await outlineByAi(o.topic, points, `${st.name}（${st.grade}）`, o.minutes, examples, subject);
      const r = await host.call<{ out: string[]; errors: string[] }>('study.document', { kind: 'courseware', title: `${st.name}-${o.topic || '课件'}`, markdown: outlineMarkdown(outline, subject), formats: ['pptx', 'pdf'] });
      courseware.push(...r.out);
      const ppt = r.out.find((f) => f.endsWith('.pptx'));
      if (ppt) putEntries([{ path: ppt, title: ppt.split('/').pop()!.replace(/\.pptx$/, ''), kind: 'slides', shelf: 'courseware', subject, topic: o.topic, points, by: 'ai', at: nowIso() }]);
    } catch (e) { onStep?.('AI 课件失败：' + (e as Error).message); }
  }
  if (noLocal && s.agent && o.auto !== false) {
    try {
      const d = await host.call<Record<string, { found: boolean }>>('agents.detect');
      const engine = ['codex', 'claude'].find((k) => d?.[k]?.found);
      if (engine) {
        const t = await host.call<{ id: string; title: string }>('agents.start', {
          engine, title: `备课资料：${st.name} ${o.topic}`, cap: s.agentCap, useStudioKey: true, formats: ['pptx', 'pdf'], permission: 'full',
          prompt: `为一对一${packOf(subject).stage}课备课：学生 ${st.name}（${st.grade}，教材 ${st.textbook || '未填'}），主题「${o.topic}」，${o.minutes} 分钟。请联网检索公开、可免费使用的教学资料（课标、教材同步讲解、典型例题），整理成一份讲课课件大纲和 6~10 道由易到难的练习题（含答案），写成 Markdown 文件。注明资料来源网址；不要下载付费或有版权限制的文件。`,
        });
        agentTask = t.title;
      }
    } catch (e) { onStep?.('后台 Agent 没启动：' + (e as Error).message); }
  }
  onStep?.('导出备课文档…');
  const md = prepMarkdown({ topic: o.topic, date: o.date, start: o.start, minutes: o.minutes, subject }, st.name, plan, input, { courseware, agentTask });
  const doc = await host.call<{ out: string[]; errors: string[] }>('study.document', { kind: 'prep', title: `${st.name}-${o.date}-备课-${o.topic || '本节课'}`, markdown: md, formats: ['docx', 'pdf'] });
  const prep: Prep = {
    id: sid(), studentId: st.id, subject, date: o.date, start: o.start, slotId: o.slotId, at: nowIso(), topic: o.topic, points,
    materials: plan.materials.map((k) => materials[k]?.path).filter(Boolean) as string[], questionIds: plan.questions.map((k) => questions[k]?.q.id).filter(Boolean) as string[],
    plan: md, files: doc.out, courseware: courseware.length ? courseware : undefined, via, auto: o.auto,
  };
  useStudy.getState().update((d) => ({ ...d, preps: [...(d.preps ?? []), prep].slice(-500) }));
  return prep;
}

// ── 调度 ─────────────────────────────────────────────
let busy = false;
/** 跑一轮。force：老师点「现在运行一次」，即使总开关关着也只做免费的规则整理 */
export async function tick(force = false): Promise<void> {
  if (busy) return;
  await ensureAuto(); ensureStudy(); await ensureCatalog();
  const s = useAuto.getState().settings;
  if (!s.on && !force) return;
  if (!useStudy.getState().loaded) return;
  busy = true; useAuto.setState({ running: '检查中…' });
  try {
    const cfgOnline = online(await aiConfig());
    const st = useStore.getState(), now = new Date(), done = new Set(useAuto.getState().done);
    if (s.catalog || force) {
      const lib = useLib.getState().lib;
      const n = await organizeByRules(lib);
      if (n) log({ kind: 'catalog', text: `资料库新增 ${n} 个文件，已按名字归到课件库 / 题库 / 学生档案。` });
      if (s.on && cfgOnline && budgetLeft() > 0) {
        useAuto.setState({ running: 'AI 整理资料…' });
        const k = await organizeByAi(60);
        if (k) log({ kind: 'catalog', text: `AI 整理了 ${k} 个名字看不出类别的文件。`, ai: true });
      }
    }
    if (!s.on) return;
    if (s.lesson || s.homework) {
      for (const l of dueLessons(now, st.slots, st.students, useStudy.getState().data, done)) {
        if (budgetLeft() <= 0) { log({ kind: 'error', text: '今天的自动任务数到上限了，剩下的课明天再处理（可以在设置里调高）。' }); break; }
        useAuto.setState({ running: `${studentOf(l.studentId)?.name ?? ''} 课后处理…` });
        try { await afterLesson(l, s, cfgOnline); }
        catch (e) { log({ kind: 'error', text: `${studentOf(l.studentId)?.name ?? ''} 课后处理失败：${(e as Error).message}`, studentId: l.studentId }); markDone(l.key); }
      }
    }
    if (s.prep) {
      for (const u of upcoming(now, st.slots, st.students, s.prepHours, useStudy.getState().data.preps ?? [], done).slice(0, 4)) {
        if (budgetLeft() <= 0) break;
        const who = studentOf(u.studentId) as Student;
        useAuto.setState({ running: `${who.name} 备课…` });
        try {
          const p = await makePrep({ studentId: u.studentId, topic: isDefaultTopic(u.topic) ? who.lastTopic : u.topic, date: u.date, start: u.start, minutes: Math.round(u.len * 60), slotId: u.slotId, auto: true, settings: s });
          log({ kind: 'prep', text: `${who.name}：${u.date} 的课已备好（${p.via === 'ai' ? 'AI 建议' : '模板'}，本地课件 ${p.materials.length} 份，讲练题 ${p.questionIds.length} 道${p.courseware?.length ? '，AI 原创课件 1 份' : ''}）。`, studentId: u.studentId, files: [...p.files, ...(p.courseware ?? [])], ai: p.via === 'ai' });
        } catch (e) { log({ kind: 'error', text: `${who.name} 备课失败：${(e as Error).message}`, studentId: u.studentId }); }
        markDone(u.key);
      }
    }
  } finally { busy = false; useAuto.setState({ running: '', lastRun: Date.now() }); }
}

let started = false;
export function startAutopilot() {
  if (started || !host.electron) return;
  started = true;
  void ensureAuto();
  const first = window.setTimeout(() => void tick(), host.test ? 3_600_000 : 90_000);
  const every = window.setInterval(() => void tick(), 5 * 60_000);
  // 下课保存录像后 1 分钟看一次（课后总结要等录像时长）
  const off = host.onEvent((e) => { if (e?.type === 'recording' && e.status?.phase === 'complete') window.setTimeout(() => void tick(), 60_000); });
  window.addEventListener('pagehide', () => { clearTimeout(first); clearInterval(every); off(); });
}
