// 学生页「学生资料」：归到名下的文件（板书、教案、资料）、备课、课后总结、备注。
// 班组页把成员的也列出来，成员页也带上所在班组的。
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus2, RotateCcw, X } from 'lucide-react';
import type { Student } from '../lib/types';
import { groupsOf, isGroup, membersOf } from '../lib/groups';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { reloadStudy, useStudy } from '../lib/studyStore';
import { linkFiles, unlinkFile } from '../lib/studentFiles';
import type { StudentFile } from '../lib/studyLogic';
import { toast } from '../lib/toast';
import { FileChip } from '../ui/FileChip';
import { MdText } from './TexText';
import { openStudy } from './StudyPage';

type Tab = 'files' | 'preps' | 'lessons' | 'notes';
const TABS: [Tab, string][] = [['files', '文件'], ['preps', '备课'], ['lessons', '课后总结'], ['notes', '备注']];
const KIND: Record<StudentFile['kind'], string> = { board: '板书', prep: '教案', doc: '资料' };
const VIA: Record<StudentFile['via'], string> = { class: '课堂自动存', assistant: '小羽', teacher: '老师' };
const NOTE: Record<string, string> = { parent: '家长聊天', requirement: '家长要求', teacher: '老师备注' };
const when = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };

export function StudentRecords({ student }: { student: Student }) {
  const students = useStore((s) => s.students), data = useStudy((s) => s.data);
  const [tab, setTab] = useState<Tab>('files'), [open, setOpen] = useState(''), [busy, setBusy] = useState(false);
  const ids = useMemo(() => new Set([student.id, ...(isGroup(student) ? membersOf(student, students) : groupsOf(student.id, students)).map((x) => x.id)]), [student, students]);
  const owner = (id: string) => (id === student.id ? '' : students.find((x) => x.id === id)?.name ?? '');
  const mine = <T extends { studentId: string; at: string }>(xs: T[] = []) => xs.filter((x) => ids.has(x.studentId)).sort((a, b) => b.at.localeCompare(a.at));
  const lists = { files: mine(data.files), preps: mine(data.preps), lessons: mine(data.lessons), notes: mine(data.notes) };

  const refresh = async () => {
    setBusy(true);
    try { await reloadStudy(); toast('学生资料已刷新'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const add = async () => {
    try {
      const paths = await host.pickFiles();
      if (!paths.length) return;
      const n = linkFiles(student.id, paths, { via: 'teacher' }).length;
      toast(n ? `已把 ${n} 个文件归到 ${student.name} 名下` : '这些文件已经在名下了');
      setTab('files');
    } catch (e) { toast((e as Error).message); }
  };
  const remove = (f: StudentFile) => {
    unlinkFile(f.id);
    toast(`已从 ${student.name} 名下移除「${f.title}」（文件本身没删）`, { ms: 10000, action: { label: '撤销', run: () => useStudy.getState().update((d) => ({ ...d, files: [...(d.files ?? []).filter((x) => x.id !== f.id), f] })) } });
  };
  const who = (id: string) => { const n = owner(id); return n ? <em className="sr-who">{n}</em> : null; };
  const fold = (id: string) => setOpen(open === id ? '' : id);
  const head = (id: string, title: string, sub: string, studentId: string) => <button className="sr-h" onClick={() => fold(id)}>{open === id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<b>{title}</b>{who(studentId)}<span className="flex" /><i>{sub}</i></button>;
  const chips = (paths: string[] = []) => paths.length > 0 && <div className="sr-files">{paths.map((p) => <FileChip key={p} path={p} />)}</div>;

  return <section className="card sr" data-qa="student-records">
    <div className="card-h"><b>学生资料</b><span className="sub">板书、教案、总结、备注都在这里</span><span className="flex" />
      {host.electron && <button className="sec-a" onClick={() => void add()} data-tip="把本机文件归到这位学生名下" aria-label="添加文件"><FilePlus2 size={13} /></button>}
      <button className="sec-a" disabled={busy} onClick={() => void refresh()} data-qa="records-refresh" data-tip="重新读取学情库（小羽或别的程序改过之后）" aria-label="刷新学生资料"><RotateCcw size={13} /></button>
    </div>
    <div className="sr-tabs" role="tablist">{TABS.map(([k, name]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-qa={'records-' + k}>{name}<em className="num">{lists[k].length}</em></button>)}</div>
    <div className="sr-list">
      {tab === 'files' && (lists.files.length ? lists.files.map((f) => <div key={f.id} className="sr-i sr-file">
        <FileChip path={f.path} label={f.title} extra={<button className="as-fchip-b" onClick={() => remove(f)} data-tip="从名下移除（不删文件）" aria-label="从名下移除"><X size={11} /></button>} />
        {who(f.studentId)}<span className="flex" /><i>{KIND[f.kind]} · {VIA[f.via]} · {when(f.at)}</i>
        {f.note && <p className="sr-note">{f.note}</p>}
      </div>) : <p className="sr-empty">还没有文件。换学生上课时板书会自动存到上一位学生名下；小羽做的教案、你点右上角添加的文件也会放在这里。</p>)}
      {tab === 'preps' && (lists.preps.length ? lists.preps.map((p) => <div key={p.id} className="sr-i">
        {head(p.id, p.topic || '备课', `${p.date}${p.via === 'ai' ? ' · AI' : ''}${p.auto ? ' · 自动' : ''}`, p.studentId)}
        {chips([...(p.files ?? []), ...(p.courseware ?? [])])}
        {open === p.id && <div className="sr-body">{p.points.length > 0 && <p className="sr-note">知识点：{p.points.join('、')}</p>}{p.plan ? <MdText text={p.plan} className="sr-md" /> : <p className="sr-note">没有教案正文</p>}</div>}
      </div>) : <p className="sr-empty">还没有备课记录。小羽或自动备课生成后会出现在这里。</p>)}
      {tab === 'lessons' && (lists.lessons.length ? lists.lessons.map((l) => <div key={l.id} className="sr-i">
        {head(l.id, l.topic || '课后总结', `${l.date}${l.minutes ? ` · ${l.minutes} 分钟` : ''}`, l.studentId)}
        {chips(l.files)}
        {open === l.id ? <div className="sr-body"><MdText text={l.summary} className="sr-md" />
          {l.problems.length > 0 && <p className="sr-note">问题：{l.problems.join('；')}</p>}
          {l.next.length > 0 && <p className="sr-note">下次：{l.next.join('；')}</p>}
          {l.homework && <p className="sr-note">作业：{l.homework}</p>}
        </div> : <p className="sr-sum">{l.summary.slice(0, 80)}{l.summary.length > 80 ? '…' : ''}</p>}
      </div>) : <p className="sr-empty">还没有课后总结。<button className="sr-link" onClick={() => openStudy('lesson')}>去写一份</button></p>)}
      {tab === 'notes' && (lists.notes.length ? lists.notes.map((n) => <div key={n.id} className="sr-i">
        <div className="sr-h static"><b>{NOTE[n.kind] ?? '备注'}</b>{who(n.studentId)}{n.todo && <em className={'sr-todo' + (n.done ? ' done' : '')}>{n.done ? '已处理' : '待处理'}</em>}<span className="flex" /><i>{when(n.at)}</i></div>
        <p className="sr-text">{n.text}</p>
      </div>) : <p className="sr-empty">还没有备注。家长发来的要求、你记下的提醒会出现在这里。</p>)}
    </div>
  </section>;
}
