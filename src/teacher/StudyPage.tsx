import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, BookX, Camera, ClipboardList, ClipboardPaste, Download, FileUp, GitBranch, Inbox, Library, Loader2, NotebookPen, Presentation, ScanText, Search, Trash2, Undo2, X, Zap } from 'lucide-react';
import { useStore } from '../lib/store';
import { host } from '../lib/host';
import { DIFF_NAME, RESULT_NAME, guessDifficulty, guessPoints, guessType, normStem, pointLabel, pointsOf, questionSubject, wrongBook, wrongbookMarkdown, type Question, type Result } from '../lib/studyLogic';
import { LEVEL_NAME, LEVELS, byLevel, packOf, type SubjectId } from '../lib/subjects';
import { useSubject } from '../lib/subjectState';
import { TexText, clipTex } from './TexText';
import { addQuestion, deleteWithUndo, ensureStudy, patchQuestion, recordAttempt, useStudy } from '../lib/studyStore';
import { aiConfig, autoReadOn, captureFromScreen, presetHomework, readInBackground, setAutoRead, useReading } from '../lib/studyActions';
import { importFiles, readPending, trimShot, type ImportResult } from '../lib/importQuestions';
import { online } from '../lib/studyAi';
import { IMPORT_EXT } from '../lib/importLogic';
import { Chips, Outputs, QImage, QuestionEditor } from './StudyParts';
import { CoursewareTab, HomeworkTab, LessonTab } from './StudyTools';
import { NetTab } from './KnowledgeNet';
import { SkillsTab } from './Skills';
import { activePlugins, loadPlugins, usePlugins } from '../plugins/pluginStore';
import { PluginFrame } from '../plugins/PluginFrame';
import { PluginIcon } from '../plugins/PluginUi';
import '../styles/agents.css';
import '../styles/study.css';

export type StudyTab = 'inbox' | 'bank' | 'wrong' | 'net' | 'homework' | 'lesson' | 'courseware' | 'skills';
const TABS: { k: StudyTab; label: string; icon: React.ReactNode }[] = [
  { k: 'inbox', label: '收件箱', icon: <Inbox size={14} /> },
  { k: 'bank', label: '题库', icon: <Library size={14} /> },
  { k: 'wrong', label: '错题本', icon: <BookX size={14} /> },
  { k: 'net', label: '知识网络', icon: <GitBranch size={14} /> },
  { k: 'homework', label: '组作业', icon: <ClipboardList size={14} /> },
  { k: 'lesson', label: '课后总结', icon: <NotebookPen size={14} /> },
  { k: 'courseware', label: 'AI 课件', icon: <Presentation size={14} /> },
  { k: 'skills', label: '技能包', icon: <Zap size={14} /> },
];

let wanted: StudyTab | null = null;
/** 其他页面跳到学情的某个分页（例如学生档案里点"错题本"） */
export function openStudy(tab: StudyTab) { wanted = tab; useStore.getState().set({ page: 'study' }); }

export function StudyPage() {
  useEffect(ensureStudy, []);
  useEffect(() => { void loadPlugins(); }, []);
  const [tab, setTab] = useState<StudyTab | `plugin:${string}`>(() => { const t = wanted ?? 'inbox'; wanted = null; return t; });
  const pluginList = usePlugins((s) => s.list);
  const pluginPages = activePlugins(pluginList).flatMap((p) => p.contributes.pages.map((pg) => ({ key: `plugin:${p.id}/${pg.id}` as const, p, pg })));
  const pluginPage = pluginPages.find((x) => x.key === tab);
  const loaded = useStudy((s) => s.loaded), error = useStudy((s) => s.error), data = useStudy((s) => s.data);
  const studentId = useStore((s) => s.studentId), students = useStore((s) => s.students);
  const student = students.find((x) => x.id === studentId);
  const subject = useSubject();
  const inbox = data.questions.filter((q) => q.status === 'inbox' && questionSubject(q) === subject).length;
  return <div className="ags sd">
    <header className="ags-head">
      <div className="ags-title"><BookOpenCheck size={20} /><h2>学情</h2><span>{student ? `当前学生：${student.name}（${packOf(subject).name}）` : '没有选择学生（在顶栏切换）'}</span></div>
      <nav className="ags-tabs">{TABS.map((t) => <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>{t.icon}{t.label}{t.k === 'inbox' && inbox > 0 && <em className="sd-count">{inbox}</em>}</button>)}
        {pluginPages.map((x) => <button key={x.key} className={tab === x.key ? 'on' : ''} onClick={() => setTab(x.key)} data-tip={`来自插件「${x.p.name}」`}><PluginIcon p={x.p} size={14} />{x.pg.title}</button>)}</nav>
      <div className="sd-stats"><span>题库 <b className="num">{data.questions.filter((q) => q.status === 'bank').length}</b></span><span>作答 <b className="num">{data.attempts.length}</b></span></div>
    </header>
    {error && <div className="ags-error">{error}<button onClick={() => useStudy.setState({ error: null })}><X size={13} /></button></div>}
    {!loaded ? <div className="ags-loading"><Loader2 className="ags-spin" /></div> : <div className="sd-body">
      {tab === 'inbox' && <InboxTab />}
      {tab === 'bank' && <BankTab />}
      {tab === 'wrong' && <WrongTab />}
      {tab === 'net' && <NetTab onHomework={(points, prereq) => { presetHomework({ points, prereq }); setTab('homework'); }} />}
      {tab === 'homework' && <HomeworkTab />}
      {tab === 'lesson' && <LessonTab />}
      {tab === 'courseware' && <CoursewareTab />}
      {tab === 'skills' && <SkillsTab />}
      {pluginPage && <PluginFrame key={pluginPage.key} id={pluginPage.p.id} entry={pluginPage.pg.entry} where="page" title={pluginPage.pg.title} className="sd-plugin" />}
      {tab.startsWith('plugin:') && !pluginPage && <p className="sd-empty">这个插件页面已经停用或删除了。</p>}
    </div>}
  </div>;
}

function QRow({ q, onOpen, extra, pick }: { q: Question; onOpen: () => void; extra?: React.ReactNode; pick?: { on: boolean; toggle: (shift: boolean) => void } }) {
  const reading = useReading((s) => s.ids.includes(q.id)), err = useReading((s) => s.errors[q.id]);
  return <article className={'sd-q' + (pick?.on ? ' picked' : '')}>
    {pick && <label className="sd-pick" onClick={(e) => { e.preventDefault(); pick.toggle(e.shiftKey); }} aria-label="选中这道题"><input type="checkbox" checked={pick.on} readOnly /></label>}
    <QImage path={q.image} />
    <button className="sd-q-main" onClick={onOpen}>
      {reading || !q.stem ? <p className={q.stem ? '' : 'empty'}>{reading ? '正在识题…' : q.needsAi ? '（拍照的卷子，配置 AI 后自动拆成一道道题）' : '（只有截图，点开整理或让 AI 识题）'}</p> : <TexText as="p" text={clipTex(q.stem, 220)} />}
      <div className="sd-q-meta"><Chips keys={q.points} /><span className="sd-tag">{q.qtype}</span><span className="sd-tag">{q.difficulty} {DIFF_NAME[q.difficulty]}</span>{q.check === 'mismatch' && <span className="sd-tag warn" data-tip={q.checkNote}>AI 自检未通过</span>}{q.check === 'ok' && <span className="sd-tag ok">AI 自检通过</span>}{q.source && <i>{q.source}</i>}</div>
      {err && <span className="sd-err">{err}</span>}
    </button>
    {extra && <div className="sd-q-act">{extra}</div>}
  </article>;
}

const DelBtn = ({ q }: { q: Question }) => <button className="sd-del" onClick={() => deleteWithUndo([q.id], '这道题')} data-tip="删除这道题（10 秒内可以撤销）" aria-label="删除这道题"><Trash2 size={13} /></button>;

/** 多选：勾选、Shift 连选、全选，批量删除 / 入库 */
function usePick(items: Question[]) {
  const [ids, setIds] = useState<string[]>([]), [anchor, setAnchor] = useState('');
  const live = new Set(items.map((q) => q.id)), sel = ids.filter((id) => live.has(id));
  const toggle = (id: string, shift: boolean) => {
    if (shift && anchor && live.has(anchor)) {
      const a = items.findIndex((q) => q.id === anchor), b = items.findIndex((q) => q.id === id), [lo, hi] = a < b ? [a, b] : [b, a];
      setIds([...new Set([...sel, ...items.slice(lo, hi + 1).map((q) => q.id)])]);
    } else setIds(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    setAnchor(id);
  };
  const pickOf = (q: Question) => ({ on: sel.includes(q.id), toggle: (shift: boolean) => toggle(q.id, shift) });
  const bar = (more?: React.ReactNode) => sel.length > 0 && <div className="sd-pickbar">
    <b>已选 {sel.length} 题</b>
    <button className="sd-btn" onClick={() => setIds(sel.length === items.length ? [] : items.map((q) => q.id))}>{sel.length === items.length ? '全不选' : `全选（${items.length}）`}</button>
    {more}
    <button className="sd-btn danger" onClick={() => { deleteWithUndo(sel); setIds([]); }}><Trash2 size={13} />删除所选</button>
    <button className="sd-btn" onClick={() => setIds([])}>取消</button>
  </div>;
  return { sel, pickOf, bar, clear: () => setIds([]) };
}

function AttemptButtons({ q }: { q: Question }) {
  const studentId = useStore((s) => s.studentId), has = useStore((s) => s.students.some((x) => x.id === s.studentId));
  if (!has) return null;
  return <span className="sd-res">{(['right', 'half', 'wrong'] as Result[]).map((r) => <button key={r} className={'r-' + r} onClick={() => recordAttempt(studentId, q.id, r)} data-tip={'给当前学生记一次：' + RESULT_NAME[r]}>{RESULT_NAME[r]}</button>)}</span>;
}

/** 导入 Word / PDF / 图片：按钮 + 把文件拖进来；结果都进收件箱 */
function useImport(onAdded?: () => void) {
  const subject = useSubject();
  const [step, setStep] = useState(''), [report, setReport] = useState<ImportResult | null>(null), [over, setOver] = useState(false);
  const run = async (paths: string[]) => {
    const ok = paths.filter((p) => IMPORT_EXT.test(p));
    if (!ok.length) { setReport({ added: [], dup: 0, files: paths.map((p) => ({ name: p.split(/[\\/]/).pop() ?? p, added: 0, dup: 0, error: '不支持这种文件，可以导入 Word、PDF、图片、txt' })), ai: false, batch: '', photos: 0 }); return; }
    setReport(null); setStep('准备导入…');
    try { setReport(await importFiles(ok, subject, setStep)); onAdded?.(); }
    catch (e) { setReport({ added: [], dup: 0, files: [{ name: '导入', added: 0, dup: 0, error: (e as Error).message }], ai: false, batch: '', photos: 0 }); }
    finally { setStep(''); }
  };
  const pick = async () => { const ps = await host.call<string[]>('study.pickImport'); if (ps.length) await run(ps); };
  const drop = {
    onDragOver: (e: React.DragEvent) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); if (step) return; const ps = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter((p): p is string => !!p); if (ps.length) void run(ps); },
  };
  const button = <button className="sd-btn" disabled={!!step || !host.electron} onClick={() => void pick()} data-tip="Word、PDF、截图或拍照的卷子，按题号自动拆成一道道题；也可以直接把文件拖进来">{step ? <Loader2 size={13} className="ags-spin" /> : <FileUp size={13} />}导入 Word / PDF / 图片</button>;
  const view = <>
    {over && <div className="sd-drop">松开鼠标，把题目导入收件箱</div>}
    {step && <p className="sd-msg sd-import-step"><Loader2 size={13} className="ags-spin" />{step}</p>}
    {report && <div className="sd-import">
      <b>{report.added.length ? `导入 ${report.added.length} 道题，已放进收件箱` : '没有导入新题'}{report.dup ? `，跳过 ${report.dup} 道重复题` : ''}。</b>
      {report.ai && report.added.length > 0 && <span>AI 正在后台补答案、解析和知识点，并独立再解一遍自检。</span>}
      {!report.ai && report.added.length > 0 && <span>答案、知识点可以点开逐题补；配好 AI 并打开「收题后自动 AI 识题」会自动补全。</span>}
      {(report.photos ?? 0) > 0 && !report.ai && <span className="sd-warn-line">其中 {report.photos} 张是拍照的卷子：不用 AI 认不准照片上的字，先原样存下了。<button className="sd-link" onClick={() => useStore.getState().set({ aiOpen: true })}>去配置 AI</button>配好后点「AI 识别未整理的题」，会自动拆成一道道题。</span>}
      {report.files.filter((f) => f.error || f.note || report.files.length > 1).map((f) => <i key={f.name} className={f.error ? 'err' : ''}>{f.name}：{f.error ?? `${f.added} 题${f.dup ? `，重复 ${f.dup}` : ''}${f.note ? `（${f.note}）` : ''}`}</i>)}
      {report.added.length > 0 && <button className="sd-btn sd-undo-import" onClick={() => { const ids = new Set(useStudy.getState().data.questions.filter((q) => q.batch === report.batch).map((q) => q.id)); deleteWithUndo([...ids], `这次导入的 ${ids.size} 道题`); setReport(null); }}><Undo2 size={13} />撤回这次导入</button>}
      <button onClick={() => setReport(null)} aria-label="关闭"><X size={12} /></button>
    </div>}
  </>;
  return { button, view, drop, busy: !!step };
}

function InboxTab() {
  const questions = useStudy((s) => s.data.questions);
  const subject = useSubject();
  const items = questions.filter((q) => q.status === 'inbox' && questionSubject(q) === subject).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [open, setOpen] = useState<Question | null>(null), [paste, setPaste] = useState(false), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [auto, setAuto] = useState(autoReadOn());
  const imp = useImport();
  const pick = usePick(items);
  const capture = async () => { setBusy(true); setMsg(''); try { await captureFromScreen({ fresh: true }); setMsg('已把学生画面收进收件箱。'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const readAll = async () => {
    const cfg = await aiConfig(), todo = items.filter((x) => !x.stem || !x.points.length);
    if (todo.some((x) => x.needsAi) && !online(cfg)) { setMsg('拍照的卷子要配好 AI 才能拆题。'); useStore.getState().set({ aiOpen: true }); }
    await readPending(todo.map((x) => x.id), cfg);
  };
  return <div className="sd-pane" {...imp.drop}>
    <div className="sd-bar">
      <button className="ags-go" disabled={busy || !host.electron} onClick={() => void capture()}>{busy ? <Loader2 size={14} className="ags-spin" /> : <Camera size={14} />}收学生画面上的题</button>
      <button className="sd-btn" onClick={() => setPaste(true)}><ClipboardPaste size={13} />粘贴题目</button>
      {imp.button}
      <button className="sd-btn" disabled={!items.length} onClick={() => void readAll()}><ScanText size={13} />AI 识别未整理的题</button>
      <label className="ags-check"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoRead(e.target.checked); }} />收题后自动 AI 识题</label>
      <span className="flex" />
      {items.length > 0 && <button className="sd-btn" data-tip="AI 自检没通过的题要逐题核对，拍照还没识别的卷子要等 AI 拆题，都不会一起入库" onClick={() => { for (const q of items) if ((q.stem.trim() || q.image) && q.check !== 'mismatch' && !q.needsAi) patchQuestion(q.id, { status: 'bank' }); }}>全部入库</button>}
    </div>
    {msg && <p className="sd-msg">{msg}</p>}
    {imp.view}
    <p className="ags-sub">上课时在右侧学生卡点「对 / 半对 / 错」，题目会自动截图收进这里，同时记下作答。整理好知识点和答案后入库，组作业和错题本才能用上。</p>
    {!items.length && <div className="lib-empty">收件箱是空的。可以收学生画面上的题、粘贴题目文字或截图，也可以把 Word / PDF / 图片拖到这里导入。</div>}
    {pick.bar(<button className="sd-btn" onClick={() => { for (const q of items) if (pick.sel.includes(q.id) && (q.stem.trim() || q.image) && q.check !== 'mismatch' && !q.needsAi) patchQuestion(q.id, { status: 'bank' }); pick.clear(); }}>入库所选</button>)}
    <div className="sd-list">{items.map((q) => <QRow key={q.id} q={q} pick={pick.pickOf(q)} onOpen={() => setOpen(q)} extra={<>{q.check === 'mismatch' ? <button className="sd-btn" onClick={() => setOpen(q)}>核对</button> : <button className="btn-cue" disabled={(!q.stem.trim() && !q.image) || q.needsAi} onClick={() => patchQuestion(q.id, { status: 'bank' })}>入库</button>}<DelBtn q={q} /></>} />)}</div>
    {open && <QuestionEditor q={open} onClose={() => setOpen(null)} />}
    {paste && <PasteDialog onClose={() => setPaste(false)} onDone={(q) => { setPaste(false); setOpen(q); }} />}
  </div>;
}

function PasteDialog({ onClose, onDone }: { onClose: () => void; onDone: (q: Question) => void }) {
  const [text, setText] = useState(''), [img, setImg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [tail, setTail] = useState<{ answer: string; analysis: string } | null>(null), [trimming, setTrimming] = useState(false);
  const subject = useSubject();
  const onPaste = (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => /^image\/(png|jpeg)$/.test(x.type));
    if (!f) return;
    e.preventDefault();
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      setImg(url); setTail(null); setTrimming(true);
      // 截图连着【答案】【详解】时裁掉答案部分（组卷时不会把答案印给学生），答案单独记下
      void trimShot(url).then((t) => { setImg((cur) => (cur === url ? t.png : cur)); if (t.answer || t.analysis) setTail({ answer: t.answer, analysis: t.analysis }); }, () => {}).finally(() => setTrimming(false));
    };
    r.readAsDataURL(f);
  };
  const ok = async () => {
    setBusy(true);
    try {
      const image = img ? await host.call<string>('study.image', img) : undefined;
      // 自动识题开着时先不填规则猜测，否则 AI 的结果会被当成"老师已填"而不覆盖
      const auto = autoReadOn() && !!(image || text.trim());
      const q = addQuestion({ stem: text.trim(), image, answer: tail?.answer ?? '', analysis: tail?.analysis ?? '', points: auto ? [] : guessPoints(text, subject), difficulty: guessDifficulty(text), qtype: auto ? '其他' : guessType(text, subject), origin: 'paste', status: 'inbox', subject });
      if (auto) void readInBackground(q.id);
      onDone(q);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="record-editor" onPaste={onPaste}>
      <div className="card-h"><b>粘贴题目</b><span className="flex" /><button onClick={onClose} aria-label="关闭"><X size={16} /></button></div>
      <p className="ags-sub">粘贴题目文字，或直接 Ctrl+V 粘贴截图（QQ / 微信截图都可以）。</p>
      <textarea autoFocus rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="在这里粘贴…" />
      {img && <div className="sd-paste-img"><img src={img} alt="粘贴的截图" /><button onClick={() => { setImg(''); setTail(null); }}><X size={12} />去掉图片</button></div>}
      {trimming && <p className="ags-sub">正在识别截图…</p>}
      {tail && <p className="ags-sub">截图里的答案部分已裁掉（组卷时不会印给学生），答案和解析已单独记下。</p>}
      {err && <p className="sd-err">{err}</p>}
      <div className="record-actions"><button onClick={onClose}>取消</button><button className="btn-cue" disabled={busy || (!text.trim() && !img)} onClick={() => void ok()}>收进收件箱</button></div>
    </div>
  </div>;
}

function BankTab() {
  const questions = useStudy((s) => s.data.questions);
  const current = useSubject();
  const [sub, setSub] = useState<SubjectId | 'all' | null>(null);
  const subject = sub ?? current;
  const [q, setQ] = useState(''), [ch, setCh] = useState(-1), [d, setD] = useState(0), [open, setOpen] = useState<Question | null>(null);
  const pack = subject === 'all' ? null : packOf(subject);
  const items = useMemo(() => questions.filter((x) => x.status === 'bank'
    && (subject === 'all' || questionSubject(x) === subject)
    && (!normStem(q) || normStem(x.stem + (x.source ?? '') + x.points.map(pointLabel).join('')).includes(normStem(q)))
    && (ch < 0 || !pack || x.points.some((k) => k.startsWith(`${pack.prefix}${ch}.`)))
    && (!d || x.difficulty === d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [questions, q, ch, d, subject, pack]);
  const chapters = useMemo(() => (pack ? [...new Map(pointsOf(pack.id).map((p) => [p.ci, p])).values()] : []), [pack]);
  const imp = useImport();
  const pick = usePick(items);
  return <div className="sd-pane" {...imp.drop}>
    <div className="sd-bar">
      {imp.button}
      <div className="lib-search sd-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜题干、出处、知识点" /></div>
      <select className="sd-select" value={subject} onChange={(e) => { const v = e.target.value; setSub(v === String(current) ? null : v as SubjectId | 'all'); setCh(-1); }}><option value={current}>{packOf(current).stage}（当前学生）</option>{LEVELS.map((l) => <optgroup key={l} label={LEVEL_NAME[l]}>{byLevel(l).filter((p) => p.id !== current).map((p) => <option key={p.id} value={p.id}>{p.stage}</option>)}</optgroup>)}<option value="all">全部学科</option></select>
      {pack && <select className="sd-select" value={ch} onChange={(e) => setCh(Number(e.target.value))}><option value={-1}>全部章节</option>{chapters.map((p) => <option key={p.ci} value={p.ci}>{p.book} · {p.ch}</option>)}</select>}
      <select className="sd-select" value={d} onChange={(e) => setD(Number(e.target.value))}><option value={0}>全部难度</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {DIFF_NAME[n]}</option>)}</select>
      <span className="flex" /><span className="sd-note">{items.length} 题</span>
    </div>
    {imp.view}
    {!items.length && <div className="lib-empty">{questions.some((x) => x.status === 'bank') ? '没有符合条件的题。' : '题库还是空的。先在收件箱收题、整理后入库；组作业时 AI 出的原创题也会进题库。'}</div>}
    {pick.bar(<button className="sd-btn" data-tip="放回收件箱重新整理" onClick={() => { for (const id of pick.sel) patchQuestion(id, { status: 'inbox' }); pick.clear(); }}>退回收件箱</button>)}
    <div className="sd-list">{items.map((x) => <QRow key={x.id} q={x} pick={pick.pickOf(x)} onOpen={() => setOpen(x)} extra={<><AttemptButtons q={x} /><DelBtn q={x} /></>} />)}</div>
    {open && <QuestionEditor q={open} onClose={() => setOpen(null)} />}
  </div>;
}

function WrongTab() {
  const data = useStudy((s) => s.data);
  const studentId = useStore((s) => s.studentId), student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const [show, setShow] = useState<'open' | 'fixed' | 'all'>('open'), [open, setOpen] = useState<Question | null>(null), [busy, setBusy] = useState(false), [out, setOut] = useState<{ out: string[]; errors: string[] } | null>(null), [err, setErr] = useState('');
  const subject = useSubject();
  const items = useMemo(() => wrongBook(studentId, data).filter((w) => questionSubject(w.q) === subject), [studentId, data, subject]);
  const list = items.filter((w) => show === 'all' || w.status === show);
  if (!student) return <div className="sd-pane"><div className="lib-empty">先在顶栏选择一位学生，错题本按学生整理。</div></div>;
  const exportBook = async () => {
    setBusy(true); setErr(''); setOut(null);
    try { setOut(await host.call('study.document', { kind: 'wrongbook', title: `${student.name}-错题本`, markdown: wrongbookMarkdown(student.name, list), formats: ['docx', 'pdf'] })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="sd-pane">
    <div className="sd-bar">
      <div className="ags-tabs">{([['open', '待订正'], ['fixed', '已订正'], ['all', '全部']] as const).map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l} <em className="num">{k === 'all' ? items.length : items.filter((w) => w.status === k).length}</em></button>)}</div>
      <span className="flex" />
      <button className="ags-go" disabled={busy || !list.length} onClick={() => void exportBook()}>{busy ? <Loader2 size={14} className="ags-spin" /> : <Download size={14} />}导出错题本（Word + PDF）</button>
    </div>
    {err && <p className="sd-err">{err}</p>}
    {out && <Outputs r={out} />}
    {!list.length && <div className="lib-empty">{items.length ? '这一栏没有题。' : `${student.name}还没有错题记录。上课时在右侧学生卡点「错」或「半对」，就会记到这里。`}</div>}
    <div className="sd-list">{list.map((w) => <QRow key={w.q.id} q={w.q} onOpen={() => setOpen(w.q)} extra={<>
      <span className="sd-hist">{w.history.map((a) => <i key={a.id} className={'r-' + a.result} title={new Date(a.at).toLocaleString('zh-CN')}>{RESULT_NAME[a.result]}</i>)}</span>
      <span className={'sd-tag ' + (w.status === 'open' ? 'warn' : 'ok')}>{w.status === 'open' ? '待订正' : '已订正'}</span>
      <AttemptButtons q={w.q} />
    </>} />)}</div>
    {open && <QuestionEditor q={open} onClose={() => setOpen(null)} />}
  </div>;
}
