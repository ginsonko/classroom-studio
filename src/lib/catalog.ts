// 资料整理索引（课件库 / 题库 / 学生档案）：存在 DATA/study/catalog.json。
// 不整理也不影响上课：资料库照常浏览；整理后备课、组卷、AI 自动处理才能按类别和知识点找资料。
import { create } from 'zustand';
import { ai } from './ai';
import { host } from './host';
import type { FileEntry, Library } from './library';
import { useStore } from './store';
import { aiClassifyPrompt, classifyByRules, junkFile, parseAiClassify, searchCatalog, type CatEntry, type CatFile, type CatQuery, type CatStudent } from './catalogLogic';

interface CatState { items: Record<string, CatEntry>; loaded: boolean; busy: '' | 'rules' | 'ai'; progress: string; error: string }
export const useCatalog = create<CatState>()(() => ({ items: {}, loaded: false, busy: '', progress: '', error: '' }));

let loading: Promise<void> | null = null;
export function ensureCatalog() {
  if (!loading) loading = (async () => {
    if (!host.electron) { useCatalog.setState({ loaded: true }); return; }
    try {
      const v = await host.call<{ items?: Record<string, CatEntry> } | null>('study.store', 'catalog');
      const items = v?.items && typeof v.items === 'object' ? { ...v.items } : {};
      for (const [k, e] of Object.entries(items)) if (!e || typeof e.title !== 'string' || junkFile(e.title)) delete items[k];
      useCatalog.setState({ items, loaded: true });
    } catch (e) { useCatalog.setState({ loaded: true, error: '资料索引读取失败：' + (e as Error).message }); }
  })();
  return loading;
}

let timer: number | undefined;
function persist() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (!host.electron) return;
    void host.call('study.saveStore', { name: 'catalog', value: { version: 1, items: useCatalog.getState().items } }).catch((e) => useCatalog.setState({ error: '资料索引保存失败：' + (e as Error).message }));
  }, 600);
}
export function putEntries(list: CatEntry[]) {
  if (!list.length) return;
  useCatalog.setState((s) => { const items = { ...s.items }; for (const e of list) items[e.path] = e; return { items }; });
  persist();
}
/** 老师手动改类别 / 学科 / 学生：以后规则和 AI 都不再覆盖 */
export function editEntry(path: string, patch: Partial<CatEntry>) {
  const cur = useCatalog.getState().items[path];
  if (!cur) return;
  putEntries([{ ...cur, ...patch, unsure: undefined, by: 'teacher', at: new Date().toISOString() }]);
}

const keyOf = (f: FileEntry) => f.path ?? f.id;
const fileOf = (f: FileEntry): CatFile => ({ path: keyOf(f), title: f.title, kind: f.kind, folder: (f.path ?? f.id).replace(/\/[^/]*$/, '') });
const studentsNow = (): CatStudent[] => useStore.getState().students.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name, grade: s.grade, subject: s.subject }));

/** 资料库里还没进索引的文件 */
export function unindexed(lib: Library | null): FileEntry[] {
  const items = useCatalog.getState().items;
  return lib ? lib.list.filter((f) => f.kind !== 'board' && f.kind !== 'sim' && !items[keyOf(f)] && !junkFile(f.title)) : [];
}
/** 规则没把握、等 AI 判断的 */
export function unsureEntries(): CatEntry[] { return Object.values(useCatalog.getState().items).filter((e) => e.unsure && e.by === 'rules'); }

/** 目录里认出了名字、后来老师建了同名学生：把这些文件挂到学生名下 */
export function linkOwners(): number {
  const students = studentsNow(), items = useCatalog.getState().items, out: CatEntry[] = [];
  for (const e of Object.values(items)) {
    if (!e.owner || e.studentId) continue;
    const s = students.find((x) => x.name === e.owner);
    if (s) out.push({ ...e, studentId: s.id, owner: undefined, subject: e.subject ?? (s.subject as CatEntry['subject']) });
  }
  putEntries(out);
  return out.length;
}

/** 规则整理：新文件按名字归类，并记下文件时间（学生档案按时间排） */
export async function organizeByRules(lib: Library | null, max = 5000): Promise<number> {
  linkOwners();
  const todo = unindexed(lib).slice(0, max);
  if (!todo.length) return 0;
  useCatalog.setState({ busy: 'rules', progress: `规则整理 ${todo.length} 个文件…`, error: '' });
  try {
    const students = studentsNow(), out: CatEntry[] = [];
    for (let i = 0; i < todo.length; i += 400) {
      const part = todo.slice(i, i + 400);
      const stats = host.electron ? await host.call<{ path: string; mtime: number }[]>('study.stat', part.map(keyOf)).catch(() => []) : [];
      const mt = new Map(stats.map((s) => [s.path, s.mtime]));
      for (const f of part) out.push(classifyByRules(fileOf(f), students, mt.get(keyOf(f))));
      useCatalog.setState({ progress: `规则整理 ${Math.min(i + 400, todo.length)}/${todo.length}…` });
    }
    putEntries(out);
    return out.length;
  } finally { useCatalog.setState({ busy: '', progress: '' }); }
}

/** AI 整理：规则没把握的文件按名字和目录交给模型判断，每批 30 个 */
export async function organizeByAi(max = 120, onStep?: (t: string) => void): Promise<number> {
  const todo = unsureEntries().slice(0, max);
  if (!todo.length) return 0;
  useCatalog.setState({ busy: 'ai', error: '' });
  const students = studentsNow();
  let done = 0;
  try {
    for (let i = 0; i < todo.length; i += 30) {
      const prior = todo.slice(i, i + 30), batch: CatFile[] = prior.map((e) => ({ path: e.path, title: e.title, kind: e.kind, folder: e.path.replace(/\/[^/]*$/, '') }));
      const t = `AI 整理 ${i + 1}~${i + batch.length} / ${todo.length}…`;
      useCatalog.setState({ progress: t }); onStep?.(t);
      const r = await ai.chat([{ role: 'system', content: '你是细心的教学资料管理员，只输出 JSON。' }, { role: 'user', content: aiClassifyPrompt(batch, students) }], { json: true, maxTokens: 3000, temperature: 0.1, feature: '资料整理' });
      const got = parseAiClassify(r.content, batch, students, prior);
      // 模型漏掉的保留规则结果，但不再标"没把握"，免得每次都重复花钱
      const missed = prior.filter((p) => !got.some((g) => g.path === p.path)).map((p) => ({ ...p, unsure: undefined, by: 'ai' as const }));
      putEntries([...got, ...missed]); done += got.length;
    }
    return done;
  } catch (e) { useCatalog.setState({ error: 'AI 整理中断：' + (e as Error).message }); return done; }
  finally { useCatalog.setState({ busy: '', progress: '' }); }
}

export function findLocal(q: CatQuery, limit = 8) { return searchCatalog(Object.values(useCatalog.getState().items), q, limit); }
