// 学情的课堂动作：从学生画面收题、记作答、后台 AI 识题。
import { create } from 'zustand';
import { ai, type AiConfig } from './ai';
import { host } from './host';
import { useStore } from './store';
import { addQuestion, nowIso, patchQuestion, recordAttempt, sid, useStudy } from './studyStore';
import { lessonByAi, online, readQuestion } from './studyAi';
import { guessDifficulty, guessPoints, guessType, homeworkMarkdown, lessonByRules, lessonMarkdown, pointLabel, questionSubject, type LessonNote, type Question, type Result } from './studyLogic';
import { nodeInfo, rootText, traceBack } from './knowledgeNet';
import { learningOf, subjectOfStudent } from './subjectState';

export type DocOut = { out: string[]; errors: string[] };
export const dayKey = (iso: string | number = Date.now()) => { const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

/** 某天的课后总结：当天作答 + 笔记 + 知识网络里的前置薄弱点 → AI（没配置就用规则模板） */
export async function buildLessonNote(o: { studentId: string; name: string; date: string; topic: string; minutes?: number; notes?: string; homework?: string; id?: string }): Promise<{ note: LessonNote; warning?: string }> {
  const data = useStudy.getState().data, qs = new Map(data.questions.map((q) => [q.id, q]));
  const todays = data.attempts.filter((a) => a.studentId === o.studentId && dayKey(a.at) === o.date && qs.has(a.questionId)).map((a) => ({ a, q: qs.get(a.questionId)! }));
  const bad = [...new Set(todays.filter((x) => x.a.result !== 'right').flatMap((x) => x.q.points))];
  const subject = subjectOfStudent(o.studentId);
  const roots = traceBack(bad, nodeInfo(o.studentId, data, learningOf(o.studentId, subject), subject)).filter((r) => !bad.includes(r.key)).slice(0, 3).map(rootText);
  const input = { student: o.name, topic: o.topic, minutes: o.minutes, attempts: todays, notes: o.notes ?? '', homework: o.homework ?? '', roots, subject };
  const base = { id: o.id ?? sid(), studentId: o.studentId, subject, date: o.date, at: nowIso(), topic: o.topic, minutes: o.minutes, homework: o.homework || undefined };
  try {
    const cfg = await aiConfig();
    const r = online(cfg) ? await lessonByAi(input) : lessonByRules(input);
    return { note: { ...base, ...r, via: online(cfg) ? 'ai' : 'rules' } };
  } catch (e) {
    return { note: { ...base, ...lessonByRules(input), via: 'rules' }, warning: (e as Error).message + '。已改用规则模板生成，可以直接编辑。' };
  }
}

/** 保存课后总结；第一次保存时学生课次 +1 */
export function saveLesson(n: LessonNote) {
  const isNew = !useStudy.getState().data.lessons.some((l) => l.id === n.id);
  useStudy.getState().update((d) => ({ ...d, lessons: isNew ? [...d.lessons, n] : d.lessons.map((l) => (l.id === n.id ? n : l)) }));
  if (isNew) { const st = useStore.getState(); st.set({ students: st.students.map((s) => (s.id === n.studentId ? { ...s, lessons: (Number(s.lessons) || 0) + 1, lastTopic: n.topic || s.lastTopic, lastAt: new Date().toISOString() } : s)) }); }
}

/** 课后总结导出（长图 png / Word / PDF），文件记到这条总结上 */
export async function lessonDocument(n: LessonNote, name: string, formats: string[]): Promise<DocOut> {
  saveLesson(n);
  const r = await host.call<DocOut>('study.document', { kind: 'lesson', title: `${name}-${n.date}-课后反馈`, markdown: lessonMarkdown(n, name), formats });
  useStudy.getState().update((d) => ({ ...d, lessons: d.lessons.map((l) => (l.id === n.id ? { ...l, files: [...(l.files ?? []), ...r.out] } : l)) }));
  return r;
}

export function homeworkTitle(name: string, points: string[]) {
  const d = new Date();
  return `${name}-${points.slice(0, 2).map((k) => pointLabel(k).split(' · ').pop()).join('、') || '综合练习'}-作业-${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 作业导出 Word + PDF（答案另起一页），记进作业历史 */
export async function exportHomework(o: { studentId: string; name: string; title: string; questions: Question[]; points: string[] }): Promise<DocOut> {
  const r = await host.call<DocOut>('study.document', { kind: 'homework', title: o.title, markdown: homeworkMarkdown(o.title, o.name, o.questions, '答案在最后一页，订正后再看。'), formats: ['docx', 'pdf'] });
  useStudy.getState().update((d) => ({ ...d, homework: [...d.homework, { id: sid(), studentId: o.studentId, title: o.title, at: nowIso(), questionIds: o.questions.map((q) => q.id), points: o.points, files: r.out }] }));
  return r;
}

export const useReading = create<{ ids: string[]; errors: Record<string, string> }>()(() => ({ ids: [], errors: {} }));
export async function aiConfig(): Promise<AiConfig | null> { try { return await ai.config(); } catch { return null; } }

const AUTO = 'cs.study.autoRead';
export const autoReadOn = () => localStorage.getItem(AUTO) !== '0';
export const setAutoRead = (on: boolean) => localStorage.setItem(AUTO, on ? '1' : '0');

/** 别的分页（知识网络）带着知识点跳到组作业 */
let hwPreset: { points: string[]; prereq: boolean } | null = null;
export function presetHomework(p: { points: string[]; prereq: boolean }) { hwPreset = p; }
export function takeHomeworkPreset() { const p = hwPreset; hwPreset = null; return p; }

/** 后台识题：有图就让看图模型转写，结果只填老师还没填的字段。同一道题正在识别时，等那一次结束 */
export async function readInBackground(id: string, cfg?: AiConfig | null): Promise<void> {
  if (useReading.getState().ids.includes(id)) {
    await new Promise<void>((done) => { const off = useReading.subscribe((s) => { if (!s.ids.includes(id)) { off(); done(); } }); });
    return;
  }
  const c = cfg === undefined ? await aiConfig() : cfg;
  const q = useStudy.getState().data.questions.find((x) => x.id === id);
  if (!q || useReading.getState().ids.includes(id)) return;
  const subject = questionSubject(q);
  if (!online(c)) {
    if (q.stem) patchQuestion(id, { points: q.points.length ? q.points : guessPoints(q.stem, subject), difficulty: q.difficulty || guessDifficulty(q.stem), qtype: q.qtype !== '其他' ? q.qtype : guessType(q.stem, subject) });
    return;
  }
  useReading.setState((s) => ({ ids: [...s.ids, id], errors: { ...s.errors, [id]: '' } }));
  try {
    const image = q.image ? await host.call<string>('study.imageData', q.image) : undefined;
    const r = await readQuestion(c, { text: q.stem, image, subject });
    const now = useStudy.getState().data.questions.find((x) => x.id === id);
    if (!now) return;
    patchQuestion(id, {
      stem: now.stem || r.stem, answer: now.answer || r.answer, analysis: now.analysis || r.analysis,
      points: now.points.length ? now.points : r.points, difficulty: r.difficulty, qtype: r.qtype,
    });
  } catch (e) {
    useReading.setState((s) => ({ errors: { ...s.errors, [id]: (e as Error).message } }));
  } finally {
    useReading.setState((s) => ({ ids: s.ids.filter((x) => x !== id) }));
  }
}

// 同一页 20 分钟内再记一次作答，算同一道题（先错后订正对，不会变成两道题）
const recent = new Map<string, { id: string; at: number }>();
const pageKey = () => { const st = useStore.getState(); return `${st.pgm.materialId}#${st.pgm.page}#${st.pgm.slide}`; };

export function currentQuestion(): Question | undefined {
  const r = recent.get(pageKey());
  if (!r || Date.now() - r.at > 20 * 60000) return undefined;
  return useStudy.getState().data.questions.find((q) => q.id === r.id);
}

/** 把学生画面上的题收进收件箱；result 给了就同时记一次作答 */
export async function captureFromScreen(o: { result?: Result; studentId?: string; fresh?: boolean } = {}): Promise<{ q: Question; reused: boolean }> {
  let q = o.fresh ? undefined : currentQuestion();
  const reused = !!q;
  if (!q) {
    const shot = await ai.screen();
    const image = await host.call<string>('study.image', shot);
    const st = useStore.getState();
    q = addQuestion({ stem: '', image, answer: '', analysis: '', points: [], subject: subjectOfStudent(o.studentId ?? st.studentId), difficulty: 3, qtype: '其他', source: `${st.pgmMat.title}${st.pgmMat.kind === 'board' ? '' : ` 第 ${st.pgm.page + 1} 页`}`, origin: 'board', status: 'inbox' });
    recent.set(pageKey(), { id: q.id, at: Date.now() });
    if (autoReadOn()) void readInBackground(q.id);
  } else recent.set(pageKey(), { id: q.id, at: Date.now() });
  if (o.result && o.studentId) recordAttempt(o.studentId, q.id, o.result);
  return { q, reused };
}
