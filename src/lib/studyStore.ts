// 学情库在教师端的状态：启动时从主进程读 study.json，改动后 0.5 秒合并保存。
import { create } from 'zustand';
import { host } from './host';
import { emptyStudy, type Attempt, type Question, type Result, type StudyData } from './studyLogic';
import { toast } from './toast';

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

let timer: number | undefined, queue = Promise.resolve(), dirty = false;
function schedule() { dirty = true; clearTimeout(timer); timer = window.setTimeout(() => void flushStudy(), 500); }
export function flushStudy() {
  clearTimeout(timer); dirty = false;
  const s = useStudy.getState();
  if (!host.electron || !s.loaded) return Promise.resolve();
  useStudy.setState({ saving: true });
  queue = queue.catch(() => {}).then(() => host.call('study.save', s.data)).then(() => useStudy.setState({ saving: false, error: null }))
    .catch((e) => useStudy.setState({ saving: false, error: '学情库保存失败：' + (e as Error).message }));
  return queue;
}
window.addEventListener('pagehide', () => { void flushStudy(); });

/** 重新读一遍 study.json（先把手上没存的改动存掉） */
export async function reloadStudy() {
  if (!useStudy.getState().loaded) { ensureStudy(); return; }
  await flushStudy(); await queue;
  await useStudy.getState().load();
}
// 学情库被软件以外的程序改了（助教在完全访问模式下直接改文件、另一台电脑同步过来）：
// 手上没有没存的改动就直接重新读；有的话先问老师，免得互相覆盖
host.onEvent((e) => {
  if (e.type !== 'studyChanged' || !useStudy.getState().loaded) return;
  if (!dirty) { void useStudy.getState().load().then(() => toast('学情库在软件外被改过，已重新载入')); return; }
  toast('学情库在软件外被改过，但你这边还有没保存的改动', { ms: 15000, action: { label: '用外面的版本', run: () => { clearTimeout(timer); dirty = false; void useStudy.getState().load(); } } });
});

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
export interface Removed { questions: Question[]; attempts: Attempt[] }
/** 一次删几道题（连同作答记录）；返回删掉的内容，撤销时原样放回（题图文件不删，撤销后还在） */
export function removeQuestions(ids: string[]): Removed {
  const set = new Set(ids), d = useStudy.getState().data;
  const out: Removed = { questions: d.questions.filter((q) => set.has(q.id)), attempts: d.attempts.filter((a) => set.has(a.questionId)) };
  if (out.questions.length) useStudy.getState().update((x) => ({ ...x, questions: x.questions.filter((q) => !set.has(q.id)), attempts: x.attempts.filter((a) => !set.has(a.questionId)) }));
  return out;
}
export function restoreQuestions(r: Removed) {
  useStudy.getState().update((d) => {
    const qs = new Set(d.questions.map((q) => q.id)), as = new Set(d.attempts.map((a) => a.id));
    return { ...d, questions: [...d.questions, ...r.questions.filter((q) => !qs.has(q.id))], attempts: [...d.attempts, ...r.attempts.filter((a) => !as.has(a.id))] };
  });
}
/** 删除并弹出「撤销」提示（10 秒内可以撤销） */
export function deleteWithUndo(ids: string[], what = '') {
  const r = removeQuestions(ids);
  if (!r.questions.length) return r;
  toast(`已删除${what || ` ${r.questions.length} 道题`}${r.attempts.length ? `（含 ${r.attempts.length} 条作答记录）` : ''}`, { ms: 10000, action: { label: '撤销', run: () => restoreQuestions(r) } });
  return r;
}
export function recordAttempt(studentId: string, questionId: string, result: Result, note?: string): Attempt {
  const a: Attempt = { id: sid(), studentId, questionId, result, at: nowIso(), ...(note ? { note } : {}) };
  useStudy.getState().update((d) => ({ ...d, attempts: [...d.attempts, a] }));
  return a;
}
export function removeAttempt(id: string) { useStudy.getState().update((d) => ({ ...d, attempts: d.attempts.filter((a) => a.id !== id) })); }
