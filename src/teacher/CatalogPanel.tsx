import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Sparkles, Wand } from 'lucide-react';
import { useLib } from '../lib/useLib';
import { useStore } from '../lib/store';
import { fileEntry, type FileEntry } from '../lib/library';
import { openMaterial } from '../doc/actions';
import { editEntry, ensureCatalog, organizeByAi, organizeByRules, unindexed, unsureEntries, useCatalog } from '../lib/catalog';
import { SHELVES, SHELF_NAME, searchCatalog, type CatEntry, type Shelf } from '../lib/catalogLogic';
import { LEVEL_NAME, LEVELS, byLevel, subjectLabel } from '../lib/subjects';
import { aiConfig } from '../lib/studyActions';
import { online } from '../lib/studyAi';

/**
 * 资料整理：把资料库的文件归到课件库 / 题库 / 学生档案，可以按类别、学科、学生浏览和搜索。
 * compact 用在左侧资料栏（窄）；完整版在「AI 自动 → 资料整理」。
 */
export function CatalogPanel({ compact, onOpen }: { compact?: boolean; onOpen?: (f: FileEntry) => void }) {
  useEffect(() => { void ensureCatalog(); }, []);
  const lib = useLib((s) => s.lib);
  const items = useCatalog((s) => s.items), busy = useCatalog((s) => s.busy), progress = useCatalog((s) => s.progress), error = useCatalog((s) => s.error);
  const students = useStore((s) => s.students);
  const [shelf, setShelf] = useState<Shelf>('courseware'), [subject, setSubject] = useState(''), [q, setQ] = useState(''), [limit, setLimit] = useState(120), [ai, setAi] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => { void aiConfig().then((c) => setAi(online(c))); }, []);
  const all = useMemo(() => Object.values(items), [items]);
  const fresh = useMemo(() => unindexed(lib).length, [lib, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsure = useMemo(() => unsureEntries().length, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const base = all.filter((e) => (shelf === 'other' ? e.shelf === 'other' || e.unsure : e.shelf === shelf) && (!subject || e.subject === subject));
    if (q.trim()) return searchCatalog(base, { text: q }, 300).map((x) => x.e);
    return base.sort((a, b) => (shelf === 'student' ? (b.date ?? '').localeCompare(a.date ?? '') : a.title.localeCompare(b.title, 'zh')));
  }, [all, shelf, subject, q]);
  const open = (e: CatEntry) => { const f = lib?.files.get(e.path) ?? fileEntry(e.path); if (onOpen) onOpen(f); else { void openMaterial(f, 'teacher'); useStore.getState().set({ page: 'console' }); } };
  const rules = async () => { setMsg(''); const n = await organizeByRules(lib, 50000); setMsg(n ? `已按名字整理 ${n} 个文件。` : '没有新文件。'); };
  const byAi = async () => { setMsg(''); const n = await organizeByAi(compact ? 60 : 300); setMsg(n ? `AI 整理了 ${n} 个文件。` : '没有需要 AI 判断的文件。'); };
  const name = (id?: string) => students.find((s) => s.id === id)?.name;
  // 学生档案：按学生、再按月份分组（文件时间）
  const groups = shelf === 'student' && !q.trim() ? [...list.reduce((m, e) => { const k = `${name(e.studentId) ?? (e.owner ? e.owner + '（未建学生）' : '未关联学生')} · ${(e.date ?? '').slice(0, 7) || '时间未知'}`; m.set(k, [...(m.get(k) ?? []), e]); return m; }, new Map<string, CatEntry[]>())] : null;
  const row = (e: CatEntry) => <div key={e.path} className="cat-row" title={e.path}>
    <button className="cat-main" onClick={() => open(e)}>
      <b>{e.title}</b>
      <span>{[e.subject && subjectLabel(e.subject), e.grade, e.topic && e.topic !== e.title ? e.topic : '', e.answer ? '含答案' : '', e.date, e.by === 'ai' ? 'AI' : e.by === 'teacher' ? '手动' : ''].filter(Boolean).join(' · ')}</span>
    </button>
    {!compact && <select value={e.shelf} onChange={(ev) => editEntry(e.path, { shelf: ev.target.value as Shelf })} aria-label="改类别">{SHELVES.map((k) => <option key={k} value={k}>{SHELF_NAME[k]}</option>)}</select>}
    {!compact && e.shelf === 'student' && <select value={e.studentId ?? ''} onChange={(ev) => editEntry(e.path, { studentId: ev.target.value || undefined })} aria-label="归到学生"><option value="">未关联</option>{students.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
  </div>;
  return <div className={'cat' + (compact ? ' compact' : '')}>
    <div className="cat-tools">
      <button className="sd-btn" disabled={!!busy || !fresh} onClick={() => void rules()} data-tip="按文件名和目录名归类，免费、几秒完成">{busy === 'rules' ? <Loader2 size={13} className="ags-spin" /> : <Wand size={13} />}整理新文件{fresh ? ` ${fresh}` : ''}</button>
      <button className="sd-btn" disabled={!!busy || !unsure || !ai} onClick={() => void byAi()} data-tip={ai ? '名字看不出类别的文件交给 AI 判断（只发送文件名）' : '配置 AI 后可用'}>{busy === 'ai' ? <Loader2 size={13} className="ags-spin" /> : <Sparkles size={13} />}AI 整理{unsure ? ` ${unsure}` : ''}</button>
      {!compact && <span className="sd-note">{progress || msg || `已整理 ${all.length} 个文件。原文件只读，不移动、不改名。`}</span>}
    </div>
    {compact && (progress || msg) && <p className="sd-note">{progress || msg}</p>}
    {error && <p className="sd-err">{error}</p>}
    <div className="cat-shelves">{SHELVES.map((k) => <button key={k} className={shelf === k ? 'on' : ''} onClick={() => { setShelf(k); setLimit(120); }}>{SHELF_NAME[k]}<em className="num">{all.filter((e) => (k === 'other' ? e.shelf === 'other' || e.unsure : e.shelf === k)).length}</em></button>)}</div>
    <div className="cat-filter">
      <div className="lib-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按主题、知识点搜" /></div>
      <select className="sd-select" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">全部学科</option>{LEVELS.map((l) => <optgroup key={l} label={LEVEL_NAME[l]}>{byLevel(l).map((p) => <option key={p.id} value={p.id}>{p.stage}</option>)}</optgroup>)}</select>
    </div>
    <div className="cat-list">
      {!list.length && <div className="lib-empty">{all.length ? '这一类还没有文件。' : '资料库还没整理。点「整理新文件」，按文件名把课件、试卷、学生资料分好类。'}</div>}
      {groups ? groups.map(([k, es]) => <div key={k} className="cat-group"><h5>{k} <i>{es.length}</i></h5>{es.slice(0, 60).map(row)}</div>) : list.slice(0, limit).map(row)}
      {!groups && list.length > limit && <button className="lib-more" onClick={() => setLimit(limit + 300)}>再显示 {Math.min(300, list.length - limit)} 个 · 共 {list.length}</button>}
    </div>
  </div>;
}
