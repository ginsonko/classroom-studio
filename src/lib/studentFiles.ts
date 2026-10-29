// 归到学生名下的文件：学生页「学生资料」里能看到，左侧资料库「学生档案」书架里也能找到。
import { putEntries, ensureCatalog, useCatalog } from './catalog';
import { kindForPath } from './library';
import { useStore } from './store';
import { studentSubject } from './subjects';
import { nowIso, sid, useStudy } from './studyStore';
import type { StudentFile } from './studyLogic';

const norm = (p: string) => p.replace(/\\/g, '/');
const nameOf = (p: string) => norm(p).split('/').pop() ?? p;
const today = () => { const d = new Date(), z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

/** 文件挂到学生名下（同一个文件不重复挂）。返回新挂上的 */
export function linkFiles(studentId: string, paths: string[], o: { kind?: StudentFile['kind']; title?: string; via: StudentFile['via']; note?: string }): StudentFile[] {
  const have = new Set((useStudy.getState().data.files ?? []).filter((f) => f.studentId === studentId).map((f) => norm(f.path).toLowerCase()));
  const out: StudentFile[] = [];
  for (const p0 of paths) {
    const p = norm(p0);
    if (!p || have.has(p.toLowerCase())) continue;
    have.add(p.toLowerCase());
    const title = o.title && paths.length === 1 ? o.title : nameOf(p).replace(/\.[^.]+$/, '');
    out.push({ id: sid(), studentId, at: nowIso(), kind: o.kind ?? 'doc', title, path: p, via: o.via, ...(o.note ? { note: o.note } : {}) });
  }
  if (out.length) useStudy.getState().update((d) => ({ ...d, files: [...(d.files ?? []), ...out].slice(-5000) }));
  void shelve(studentId, out.map((f) => f.path));
  return out;
}

/** 左侧资料库「学生档案」书架：能在导播台里打开的文件才放（PDF、Word、PPT、图片、Markdown…） */
async function shelve(studentId: string, paths: string[]) {
  const st = useStore.getState().students.find((s) => s.id === studentId);
  if (!st || !paths.length) return;
  await ensureCatalog();
  const items = useCatalog.getState().items, at = nowIso();
  putEntries(paths.flatMap((p) => {
    const kind = kindForPath(nameOf(p));
    if (!kind || items[p]?.by === 'teacher') return [];
    return [{ path: p, title: nameOf(p).replace(/\.[^.]+$/, ''), kind, shelf: 'student' as const, studentId, subject: studentSubject(st), date: today(), by: 'ai' as const, at }];
  }));
}

export function unlinkFile(id: string) {
  useStudy.getState().update((d) => ({ ...d, files: (d.files ?? []).filter((f) => f.id !== id) }));
}

export const filesOf = (studentId: string, files: StudentFile[] = []) => files.filter((f) => f.studentId === studentId).sort((a, b) => b.at.localeCompare(a.at));
