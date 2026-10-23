import { useEffect, useState } from 'react';
import { CalendarClock, Check, ClipboardPaste, FileText, FolderOpen, Image as ImageIcon, MessageSquareText, Undo2, Wand2, X } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { useStudy } from '../lib/studyStore';
import { KIND_NAME, actionsOf, markCount, type Analysis } from '../lib/sortLogic';
import {
  addImageData, addPaths, addText, analyze, openSort, archive, closeSort, describe, finishTodo, openTodos, patchAnalysis, removeItem, resetSort, settleUnsure, undoSort, useSort,
} from '../lib/sort';
import { LEVELS, byLevel } from '../lib/subjects';
import type { SortRecord } from '../lib/studyLogic';
import '../styles/sort.css';

const LEVEL_NAME = { senior: '高中', junior: '初中', primary: '小学' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 顶栏的「AI 整理」按钮：有没处理的调课提醒时带个数字 */
export function SortButton() {
  const todos = useStudy((s) => openTodos(s.data.notes).length);
  return <button className="tb-sort" onClick={() => openSort({ tab: todos ? 'records' : 'new' })} data-tip="AI 整理：卷子照片、Word / PDF、家长消息丢进来，AI 认出是谁的、是什么，你确认后再归档">
    <Wand2 size={14} /><span>AI 整理</span>{todos > 0 && <b className="num">{todos}</b>}
  </button>;
}

export function SortDialog() {
  const open = useSort((s) => s.open), tab = useSort((s) => s.tab), busy = useSort((s) => s.phase === 'analyzing' || s.phase === 'saving');
  const sorts = useStudy((s) => s.data.sorts ?? []), todos = useStudy((s) => openTodos(s.data.notes).length);
  // 打开时粘贴：截图、文件、微信里复制的文字都收下（不贴到黑板上）
  useEffect(() => {
    if (!open) return;
    const paste = (e: ClipboardEvent) => {
      const s = useSort.getState();
      if (s.tab !== 'new' || s.phase !== 'collect') return;
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const files = [...(e.clipboardData?.files ?? [])];
      const paths = files.map((f) => host.pathForFile(f)).filter((p): p is string => !!p);
      if (paths.length) { addPaths(paths); return; }
      const img = files.find((f) => /^image\//.test(f.type));
      if (img) { const r = new FileReader(); r.onload = () => void addImageData(String(r.result)); r.readAsDataURL(img); return; }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim()) { addText(text); return; }
      if (host.electron) void host.call<string | null>('clipboardImage').then((d) => { if (d) void addImageData(d); });
    };
    window.addEventListener('paste', paste, true);
    return () => window.removeEventListener('paste', paste, true);
  }, [open]);
  if (!open) return null;
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && !busy && closeSort()}>
    <div className="sort" role="dialog" aria-label="AI 整理"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => { const ps = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter((p): p is string => !!p); if (!ps.length) return; e.preventDefault(); e.stopPropagation(); if (useSort.getState().phase === 'collect') addPaths(ps); }}>
      <header className="sort-h">
        <Wand2 size={18} /><b>AI 整理</b>
        <div className="seg">
          <button className={tab === 'new' ? 'on' : ''} onClick={() => useSort.setState({ tab: 'new' })}>整理新资料</button>
          <button className={tab === 'records' ? 'on' : ''} onClick={() => useSort.setState({ tab: 'records' })}>整理记录{sorts.length ? ` · ${sorts.length}` : ''}{todos ? <i className="sort-dot">{todos}</i> : null}</button>
        </div>
        <span className="flex" />
        <button className="sort-x" disabled={busy} onClick={closeSort} aria-label="关闭"><X size={16} /></button>
      </header>
      {tab === 'new' ? <NewSort /> : <Records records={sorts} />}
    </div>
  </div>;
}

function NewSort() {
  const s = useSort();
  const students = useStore((x) => x.students).filter((x) => !x.archived && !x.kind);
  const [typing, setTyping] = useState(false), [text, setText] = useState('');
  if (s.phase === 'review' || s.phase === 'saving' || s.phase === 'analyzing' && s.analyses.length) return <Review />;
  if (s.phase === 'done' && s.record) return <Done record={s.record} />;
  const pick = async () => { const ps = await host.call<string[] | null>('study.pickImport').catch(() => null); if (ps?.length) addPaths(ps); };
  return <div className="sort-body">
    <label className="sort-who">这些资料默认是谁的
      <select value={s.studentId} onChange={(e) => useSort.setState({ studentId: e.target.value })} disabled={s.phase !== 'collect'}>
        {!students.length && <option value="">还没有学生</option>}
        {students.map((x) => <option key={x.id} value={x.id}>{x.name}{x.grade ? ` · ${x.grade}` : ''}</option>)}
      </select>
      <small>AI 也会从内容里认名字（比如「王荣浩月考」），认出别的学生会自动换</small>
    </label>
    <div className={'sort-drop' + (s.items.length ? ' has' : '')}>
      {!s.items.length && <><b>把资料拖到这里</b><span>卷子照片、批改过的作业、Word / PDF、成绩单截图；微信里复制的家长消息直接按 Ctrl+V</span></>}
      {s.items.length > 0 && <ul className="sort-items">{s.items.map((it) => <li key={it.id}>
        {it.kind === 'image' ? <ImageIcon size={15} /> : it.kind === 'doc' ? <FileText size={15} /> : <MessageSquareText size={15} />}
        <span title={it.text ?? it.path}>{it.name}</span><small>{it.kind === 'image' ? '图片' : it.kind === 'doc' ? '文档' : `文字 ${it.text?.length ?? 0} 字`}</small>
        {s.phase === 'collect' && <button onClick={() => removeItem(it.id)} aria-label={'去掉' + it.name}><X size={13} /></button>}
      </li>)}</ul>}
      {s.phase === 'collect' && <div className="sort-add">
        <button onClick={() => void pick()}><FolderOpen size={14} />选择文件</button>
        <button onClick={() => setTyping(!typing)}><ClipboardPaste size={14} />粘贴文字</button>
      </div>}
      {typing && s.phase === 'collect' && <div className="sort-type">
        <textarea autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="把微信里家长的消息、成绩、题目粘贴到这里" />
        <button className="btn-cue" disabled={!text.trim()} onClick={() => { addText(text); setText(''); setTyping(false); }}>加进来</button>
      </div>}
    </div>
    {s.error && <p className="sort-err" role="alert">{s.error}</p>}
    {s.phase === 'analyzing' ? <p className="sort-step">{s.step}</p> : <footer className="sort-f">
      <p>{s.items.length === 0 ? '' : s.ai ? <>AI 会先看一遍、列出整理单，你确认后才写入。{s.est ? <>这一批大约 {s.est.calls} 次 AI 调用，估计 <b>¥{s.est.cny.toFixed(2)}</b>（按 AI 账本的价格表估算，以实际扣费为准）。</> : null}</>
        : <>还没配 AI，先按规则整理：Word / PDF 按题号拆题，文字存成家长消息，照片原样存下，配好 AI 再拆题。<button className="sd-link" onClick={() => useStore.getState().set({ aiOpen: true })}>去配置 AI</button></>}</p>
      <button className="btn-cue" disabled={!s.items.length || !s.studentId} onClick={() => void analyze()}><Wand2 size={14} />开始整理</button>
    </footer>}
  </div>;
}

function Review() {
  const s = useSort();
  const students = useStore((x) => x.students).filter((x) => !x.archived && !x.kind);
  const n = s.analyses.reduce((k, a) => k + Object.values(a.take).filter(Boolean).length, 0);
  return <div className="sort-body">
    <p className="sort-lead">{s.phase === 'analyzing' ? s.step : s.phase === 'saving' ? s.step : `整理单：${s.analyses.length} 样资料。去掉不想要的勾，学生和学科不对可以改，然后点「全部归档」。`}</p>
    <div className="sort-cards">
      {s.analyses.map((a) => {
        const it = s.items.find((x) => x.id === a.itemId);
        return <section key={a.itemId} className="sort-card">
          <div className="sort-card-h">
            <span className={'sort-kind k-' + a.kind}>{KIND_NAME[a.kind]}</span>
            <b title={it?.name}>{a.title || it?.name}</b>
            <span className="flex" />
            <select value={a.studentId} disabled={s.phase !== 'review'} onChange={(e) => patchAnalysis(a.itemId, { studentId: e.target.value, note: undefined })} aria-label="学生">
              {students.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={a.subject} disabled={s.phase !== 'review'} onChange={(e) => patchAnalysis(a.itemId, { subject: e.target.value })} aria-label="学科">
              {LEVELS.map((l) => <optgroup key={l} label={LEVEL_NAME[l]}>{byLevel(l).map((p) => <option key={p.id} value={p.id}>{p.stage}</option>)}</optgroup>)}
            </select>
          </div>
          {a.note && <p className="sort-note">{a.note}</p>}
          {a.kind === 'graded' && <Marks a={a} />}
          <ul className="sort-acts">{actionsOf(a).map((k) => {
            const off = k === 'attempts' && !a.take.questions;
            return <li key={k}><label className={off ? 'off' : ''}>
              <input type="checkbox" disabled={s.phase !== 'review' || off} checked={!!a.take[k] && !off} onChange={(e) => patchAnalysis(a.itemId, { take: { [k]: e.target.checked } })} />
              {k === 'reschedule' && <CalendarClock size={13} />}{describe(a)(k)}
            </label></li>;
          })}</ul>
          {a.text && (a.kind === 'chat' || a.kind === 'score' || a.kind === 'note') && <details className="sort-text"><summary>原文</summary><pre>{a.text}</pre></details>}
        </section>;
      })}
    </div>
    {s.error && <p className="sort-err" role="alert">{s.error}</p>}
    <footer className="sort-f">
      <p>归档以后可以在「整理记录」里整批撤销。</p>
      <button disabled={s.phase !== 'review'} onClick={() => useSort.setState({ phase: 'collect', analyses: [] })}>返回修改</button>
      <button className="btn-cue" disabled={s.phase !== 'review' || !n} onClick={() => void archive()}><Check size={14} />全部归档{n ? `（${n} 项）` : ''}</button>
    </footer>
  </div>;
}

function Marks({ a }: { a: Analysis }) {
  const c = markCount(a.regions);
  return <div className="sort-marks">
    <span className="m-wrong">错 {c.wrong}</span><span className="m-half">半对 {c.half}</span><span className="m-right">对 {c.right}</span>
    {c.unsure > 0 && <span className="m-unsure">没认准 {c.unsure}</span>}
    {c.none > 0 && <span>没批改 {c.none}</span>}
  </div>;
}

function Done({ record }: { record: SortRecord }) {
  return <div className="sort-body">
    <div className="sort-done"><Check size={22} /><div><b>归档好了</b>{record.lines.map((l, i) => <p key={i}>{l}</p>)}</div></div>
    {record.unsure.length > 0 && <Unsure record={record} />}
    <footer className="sort-f">
      <p>AI 正在后台补题干、答案和知识点，收件箱里能看到进度。</p>
      <button onClick={() => undoSort(record.id)}><Undo2 size={14} />撤销这次整理</button>
      <button onClick={() => { useStore.getState().set({ page: 'study' }); useSort.setState({ open: false }); }}>去学情页看看</button>
      <button className="btn-cue" onClick={resetSort}>再整理一批</button>
    </footer>
  </div>;
}

function Unsure({ record }: { record: SortRecord }) {
  const live = useStudy((s) => (s.data.sorts ?? []).find((x) => x.id === record.id)) ?? record;
  const qs = useStudy((s) => s.data.questions);
  if (!live.unsure.length || live.undone) return null;
  return <div className="sort-unsure"><b>这几道批改没认准，点一下对错再记</b>
    {live.unsure.map((u) => {
      const q = qs.find((x) => x.id === u.questionId);
      if (!q) return null;
      return <div key={u.questionId} className="sort-uq">
        {q.image ? <img src={host.fileUrl(q.image)} alt="题图" /> : <span>{q.stem.slice(0, 60)}</span>}
        <div>
          <button onClick={() => settleUnsure(live.id, u.questionId, 'right')}>对</button>
          <button onClick={() => settleUnsure(live.id, u.questionId, 'half')}>半对</button>
          <button onClick={() => settleUnsure(live.id, u.questionId, 'wrong')}>错</button>
          <button className="ghost" onClick={() => settleUnsure(live.id, u.questionId, null)}>不记</button>
        </div>
      </div>;
    })}
  </div>;
}

function Records({ records }: { records: SortRecord[] }) {
  const notes = useStudy((s) => s.data.notes), students = useStore((x) => x.students);
  const todos = openTodos(notes);
  const name = (id: string) => students.find((x) => x.id === id)?.name ?? '学生';
  const list = [...records].reverse();
  return <div className="sort-body">
    {todos.length > 0 && <div className="sort-todos"><b><CalendarClock size={14} />家长要调课（课表不会自动改）</b>
      {todos.map((n) => <div key={n.id} className="sort-todo"><span><em>{name(n.studentId)}</em>{n.text.replace(/^调课：/, '')}<small>{when(n.at)}</small></span>
        <button onClick={() => { useStore.getState().set({ page: 'schedule' }); useSort.setState({ open: false }); }}>去课表</button>
        <button onClick={() => finishTodo(n.id)}>已处理</button></div>)}
    </div>}
    {!list.length && <p className="sort-empty">还没有整理过。整理过的资料会记在这里，可以整批撤销。</p>}
    {list.map((r) => <section key={r.id} className={'sort-rec' + (r.undone ? ' undone' : '')}>
      <div className="sort-card-h"><b>{r.title}</b><small>{when(r.at)}</small><span className="flex" />
        {r.undone ? <span className="sort-tag">已撤销</span> : <button onClick={() => undoSort(r.id)}><Undo2 size={13} />撤销这次整理</button>}</div>
      {r.lines.map((l, i) => <p key={i}>{l}</p>)}
      {!r.undone && <Unsure record={r} />}
    </section>)}
  </div>;
}
