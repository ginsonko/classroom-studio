// 学情库在教师端的状态：启动时从主进程读 study.json，改动后 0.5 秒合并保存。
import { create } from 'zustand';
import { host } from './host';
import { emptyStudy, type Attempt, type Question, type Result, type StudyData } from './studyLogic';

interface StudyState {
  data: StudyData; loaded: boolean; error: string | null; saving: boolean;
  load: () => Promise<void>;
  update: (fn: (d: StudyData) => StudyData) => void;
}
export const useStudy = create<StudyState>()((set, get) => ({
  data: emptyStudy(), loaded: false, error: null, saving: false,
  load: async () => {
    if (!host.electron) { set({ loaded: true }); return; }
    try { set({ data: { ...emptyStudy(), ...(await host.call<StudyData>('study.load')) }, loaded: true, error: null }); }
    catch (e) { set({ loaded: true, error: '学情库读取失败：' + (e as Error).message }); }
  },
  update: (fn) => { set({ data: fn(get().data) }); schedule(); },
}));

let timer: number | undefined, queue = Promise.resolve();
function schedule() { clearTimeout(timer); timer = window.setTimeout(() => void flushStudy(), 500); }
export function flushStudy() {
  clearTimeout(timer);
  const s = useStudy.getState();
  if (!host.electron || !s.loaded) return Promise.resolve();
  useStudy.setState({ saving: true });
  queue = queue.catch(() => {}).then(() => host.call('study.save', s.data)).then(() => useStudy.setState({ saving: false, error: null }))
    .catch((e) => useStudy.setState({ saving: false, error: '学情库保存失败：' + (e as Error).message }));
  return queue;
}
window.addEventListener('pagehide', () => { void flushStudy(); });

let started = false;
export function ensureStudy() { if (!started) { started = true; void useStudy.getState().load(); } }

export const sid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function addQuestion(q: Omit<Question, 'id' | 'createdAt'> & Partial<Pick<Question, 'id' | 'createdAt'>>): Question {
  const full: Question = { ...q, id: q.id ?? sid(), createdAt: q.createdAt ?? nowIso() };
  useStudy.getState().update((d) => ({ ...d, questions: [...d.questions, full] }));
  return full;
}
export function patchQuestion(id: string, p: Partial<Question>) {
  useStudy.getState().update((d) => ({ ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, ...p, updatedAt: nowIso() } : q)) }));
}
/** 删除题目时它的作答记录一起删，否则错题本里会出现空题 */
export function removeQuestion(id: string) {
  useStudy.getState().update((d) => ({ ...d, questions: d.questions.filter((q) => q.id !== id), attempts: d.attempts.filter((a) => a.questionId !== id) }));
}
export function recordAttempt(studentId: string, questionId: string, result: Result, note?: string): Attempt {
  const a: Attempt = { id: sid(), studentId, questionId, result, at: nowIso(), ...(note ? { note } : {}) };
  useStudy.getState().update((d) => ({ ...d, attempts: [...d.attempts, a] }));
  return a;
}
export function removeAttempt(id: string) { useStudy.getState().update((d) => ({ ...d, attempts: d.attempts.filter((a) => a.id !== id) })); }
