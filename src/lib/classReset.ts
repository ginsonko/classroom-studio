// 换学生上课时清空课堂：先把写过的黑板存成 PDF 放到上一位学生名下，再关课件、擦黑板。可以撤销。
import { host } from './host';
import { defaultView, useStore, type DeskSnap } from './store';
import { BASE, matOfKey, syncDesk } from './desk';
import { boardMaterial } from './library';
import { useStudy, ensureStudy } from './studyStore';
import type { StudentFile } from './studyLogic';
import { linkFiles } from './studentFiles';
import { toast } from './toast';
import { boardPdfSheets } from '../ink/boardExport';

const deskNow = () => { const st = useStore.getState(); return syncDesk(st.desk, st.pgmMat, st.pgm, st.sim, boardMaterial, defaultView); };
const written = (id: string) => Object.entries(useStore.getState().ink).some(([k, v]) => matOfKey(k) === id && v.some((s) => s.layer !== 'private'));

/** 学生画面上有没有东西要清：开着课件、另开了黑板，或者黑板上写过字 */
export function classHasContent(): boolean {
  const desk = deskNow();
  return desk.some((w) => w.id !== BASE) || desk.some((w) => w.mat.kind === 'board' && written(w.id));
}

export const studentName = (id: string) => id === 'free' || !id ? '自由课堂' : useStore.getState().students.find((x) => x.id === id)?.name ?? '已删除的学生';

async function studyReady() {
  ensureStudy();
  if (!useStudy.getState().loaded) await new Promise<void>((done) => { const off = useStudy.subscribe((s) => { if (s.loaded) { off(); done(); } }); });
  return !useStudy.getState().error;
}

/** 写过字的黑板逐块存成 A4 PDF，放进 study/板书/<学生>/，并记到这位学生的资料里 */
export async function archiveBoards(studentId: string): Promise<StudentFile[]> {
  if (!host.electron) return [];
  const name = studentName(studentId), date = new Date().toLocaleDateString('zh-CN');
  const boards = deskNow().filter((w) => w.mat.kind === 'board' && written(w.id));
  const made: { path: string; title: string }[] = [];
  for (const w of boards) {
    const pdf = await boardPdfSheets(w.mat, { title: `${name} · ${w.mat.title}` });
    made.push({ path: await host.call<string>('study.board', { student: name, title: w.mat.title, pdf }), title: `${w.mat.title} · ${date}` });
  }
  if (!made.length || studentId === 'free' || !(await studyReady())) return made.map((m) => ({ id: '', studentId, at: '', kind: 'board', title: m.title, path: m.path, via: 'class' }));
  return made.flatMap((m) => linkFiles(studentId, [m.path], { kind: 'board', title: m.title, via: 'class' }));
}

let last: DeskSnap | null = null;
export const canRestoreClass = () => !!last;

/**
 * 清空课堂。archiveTo：板书先存到这位学生名下（存失败就不清，免得板书丢了）。
 * 返回是否清了。
 */
export async function clearClass(o: { archiveTo?: string; why?: string } = {}): Promise<boolean> {
  if (!classHasContent()) { toast('学生画面已经是空的'); return false; }
  let files: StudentFile[] = [];
  if (o.archiveTo) {
    try { files = await archiveBoards(o.archiveTo); }
    catch (e) { toast('板书没能存档，课堂没有清空：' + (e as Error).message, { ms: 8000 }); return false; }
  }
  last = useStore.getState().clearDesk();
  const saved = files.length ? `，${files.length} 块板书已存到「${studentName(o.archiveTo!)}」名下` : '';
  toast(`${o.why ?? ''}课堂已清空${saved}`, { ms: 15000, action: { label: '撤销', run: restoreClass } });
  return true;
}

export function restoreClass() {
  if (!last) return;
  useStore.getState().restoreDesk(last); last = null;
  toast('已恢复清空前的课件和板书');
}

/**
 * 开始上课 / 下一节之前调用：学生画面上的内容是另一位学生的、换了学生之后没动过，
 * 而且设置里开着「换学生上课自动清空」，就先存板书再清空。自由课堂留下的内容（多半是课前准备）不清。
 */
export async function clearForLesson(): Promise<void> {
  const st = useStore.getState();
  if (!st.classOf || st.classOf === 'free' || st.classOf === st.studentId || !classHasContent()) return;
  const s = await host.call<{ autoClear?: boolean }>('settings').catch(() => null);
  if (s?.autoClear === false) return;
  await clearClass({ archiveTo: st.classOf, why: `换成了「${studentName(st.studentId)}」，` });
}
