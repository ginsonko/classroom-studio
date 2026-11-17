// 1.7.0 资料库「最近」按学生看：这位学生名下的文件（学生资料里的、备课用到的、课后总结导出的），
// 最近打开过的排最前，其余按更新时间倒序。纯函数，Node 里可以直接测试。
import type { LessonNote, Prep, StudentFile } from './studyLogic';

export interface RecentItem { path: string; title: string; at: string; opened: boolean; why: string }
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const nameOf = (p: string) => p.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? p;

/**
 * recents：资料库最近打开的（文件 id，就是路径，最新的在前）；pathOf 把 id 换成路径（资料库里查不到就当路径）。
 * catalog：资料整理时归到这位学生的文件（学生档案书架）。
 */
export function studentRecent(o: {
  studentId: string; recents: string[]; pathOf?: (id: string) => string;
  files?: StudentFile[]; preps?: Prep[]; lessons?: LessonNote[]; catalog?: { path: string; title: string; studentId?: string; date?: string; at?: string }[]; max?: number;
}): RecentItem[] {
  const mine = new Map<string, RecentItem>();
  const put = (path: string, title: string, at: string, why: string) => {
    if (!path) return;
    const k = norm(path), was = mine.get(k);
    if (!was || was.at < at) mine.set(k, { path, title: title || nameOf(path), at, opened: false, why });
  };
  for (const f of o.files ?? []) if (f.studentId === o.studentId) put(f.path, f.title, f.at, f.kind === 'board' ? '板书' : f.kind === 'prep' ? '备课' : '资料');
  for (const p of o.preps ?? []) if (p.studentId === o.studentId) for (const f of [...p.files, ...(p.courseware ?? []), ...p.materials]) put(f, '', p.at, `备课 · ${p.date}`);
  for (const l of o.lessons ?? []) if (l.studentId === o.studentId) for (const f of l.files ?? []) put(f, '', l.at, `课后总结 · ${l.date}`);
  for (const c of o.catalog ?? []) if (c.studentId === o.studentId) put(c.path, c.title, c.at ?? c.date ?? '', '学生档案');
  const opened: RecentItem[] = [];
  for (const id of o.recents) {
    const p = o.pathOf ? o.pathOf(id) : id, hit = mine.get(norm(p));
    if (hit && !hit.opened) { hit.opened = true; opened.push(hit); }
  }
  const rest = [...mine.values()].filter((x) => !x.opened).sort((a, b) => b.at.localeCompare(a.at));
  return [...opened, ...rest].slice(0, o.max ?? 60);
}
