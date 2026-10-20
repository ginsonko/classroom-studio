// 自己组卷：左边题库（筛选、搜索），右边试卷（分大题、拖动排序、配分），导出学生版 + 答案版，或直接投到学生画面。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Download, FilePlus2, GripVertical, Loader2, MonitorUp, Plus, Search, Trash2, X } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { useStudy, sid, nowIso } from '../lib/studyStore';
import { DIFF_NAME, normStem, pointLabel, pointsOf, questionSubject, qtypesOf, type Question } from '../lib/studyLogic';
import { addToPaper, cleanPaper, emptyPaper, moveInPaper, paperCount, paperIds, paperMarkdown, paperTotal, removeFromPaper, scaleTo, sectionHeading, type Paper } from '../lib/paperLogic';
import { packOf } from '../lib/subjects';
import { useSubject } from '../lib/subjectState';
import { fileEntry } from '../lib/library';
import { openMaterial } from '../doc/actions';
import { TexText, clipTex } from './TexText';
import { Chips, Outputs, QImage, QuestionEditor } from './StudyParts';
import '../styles/paper.css';

const KEY = 'cs.paper.draft.v1';
const ORIGINS: [string, string][] = [['', '全部来源'], ['board', '上课收的'], ['import', '导入的'], ['ai', 'AI 原创'], ['paste', '粘贴的'], ['manual', '手动录入'], ['explain', '讲题时收的']];
type Out = { out: string[]; errors: string[] };

function loadDraft(subject: string): Paper {
  try { const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Paper>; const p = all[subject]; if (p?.sections) return p; } catch { /* 草稿坏了就重新开始 */ }
  return emptyPaper(subject as Paper['subject']);
}
function saveDraft(subject: string, p: Paper) {
  try { const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Paper>; all[subject] = p; localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 存不下就算了 */ }
}

export function PaperComposer() {
  const questions = useStudy((s) => s.data.questions);
  const subject = useSubject();
  const student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const studentId = useStore((s) => s.studentId);
  const pack = packOf(subject), qtypes = qtypesOf(subject);
  const [paper, setPaperRaw] = useState<Paper>(() => loadDraft(subject));
  const setPaper = (f: (p: Paper) => Paper) => setPaperRaw((p) => { const n = { ...f(p), updatedAt: nowIso() }; saveDraft(subject, n); return n; });
  useEffect(() => { setPaperRaw(loadDraft(subject)); }, [subject]);
  const bank = useMemo(() => questions.filter((q) => q.status === 'bank' && questionSubject(q) === subject), [questions, subject]);
  // 题库里删掉的题自动从卷子里去掉
  useEffect(() => { const c = cleanPaper(paper, questions); if (paperCount(c) !== paperCount(paper)) setPaper(() => c); }, [questions]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const inPaper = useMemo(() => new Set(paperIds(paper)), [paper]);

  const [find, setFind] = useState(''), [ch, setCh] = useState(-1), [qt, setQt] = useState(''), [d, setD] = useState(0), [origin, setOrigin] = useState('');
  const chapters = useMemo(() => [...new Map(pointsOf(subject).map((p) => [p.ci, p])).values()], [subject]);
  const list = useMemo(() => bank.filter((x) => (!normStem(find) || normStem(x.stem + (x.source ?? '') + x.points.map(pointLabel).join('')).includes(normStem(find)))
    && (ch < 0 || x.points.some((k) => k.startsWith(`${pack.prefix}${ch}.`))) && (!qt || x.qtype === qt) && (!d || x.difficulty === d) && (!origin || x.origin === origin))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [bank, find, ch, qt, d, origin, pack.prefix]);

  const [open, setOpen] = useState<Question | null>(null), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [out, setOut] = useState<Out | null>(null), [target, setTarget] = useState(100);
  const drag = useRef<{ id: string } | null>(null), [over, setOver] = useState<string>('');
  const add = (q: Question) => setPaper((p) => addToPaper(p, q, qtypes));
  const total = paperTotal(paper), count = paperCount(paper);
  const title = paper.title.trim() || `${student ? student.name + ' · ' : ''}${pack.name}练习卷`;

  const dropAt = (sectionId: string, index: number) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver('');
    const id = drag.current?.id ?? e.dataTransfer.getData('text/cs-q'); drag.current = null;
    if (!id) return;
    setPaper((p) => {
      if (paperIds(p).includes(id)) return moveInPaper(p, id, sectionId, index);
      const q = qs.get(id); if (!q) return p;
      return moveInPaper(addToPaper(p, q, qtypes), id, sectionId, index);
    });
  };
  const allow = (key: string) => (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key); };

  const docs = async (formats: string[], kinds: ('student' | 'answer')[]) => {
    const p = { ...paper, title };
    const all: Out = { out: [], errors: [] };
    for (const k of kinds) {
      const r = await host.call<Out>('study.document', { kind: 'paper', title: k === 'student' ? title : `${title}-答案`, markdown: paperMarkdown(p, questions, k), formats });
      all.out.push(...r.out); all.errors.push(...r.errors);
    }
    return all;
  };
  const record = (files: string[]) => useStudy.getState().update((dd) => ({ ...dd, homework: [...dd.homework, { id: sid(), studentId: student ? studentId : '', title, at: nowIso(), questionIds: paperIds(paper), points: [...new Set(paperIds(paper).flatMap((id) => qs.get(id)?.points ?? []))], files }] }));
  const exportIt = async () => {
    setBusy('export'); setErr(''); setOut(null);
    try { const r = await docs(['docx', 'pdf'], ['student', 'answer']); setOut(r); if (r.out.length) record(r.out); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const project = async () => {
    setBusy('show'); setErr('');
    try {
      const r = await docs(['pdf'], ['student']);
      const pdf = r.out.find((f) => f.endsWith('.pdf'));
      if (!pdf) throw new Error(r.errors[0] || '没有生成 PDF');
      await openMaterial(fileEntry(pdf), 'student');
      setOut(r);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };

  return <div className="sd-pane pc">
    <section className="pc-bank">
      <div className="pc-filters">
        <div className="lib-search sd-search"><Search size={14} /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="搜题干、出处、知识点" /></div>
        <select className="sd-select" value={ch} onChange={(e) => setCh(Number(e.target.value))}><option value={-1}>全部章节</option>{chapters.map((p) => <option key={p.ci} value={p.ci}>{p.book} · {p.ch}</option>)}</select>
        <select className="sd-select" value={qt} onChange={(e) => setQt(e.target.value)}><option value="">全部题型</option>{qtypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select className="sd-select" value={d} onChange={(e) => setD(Number(e.target.value))}><option value={0}>全部难度</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {DIFF_NAME[n]}</option>)}</select>
        <select className="sd-select" value={origin} onChange={(e) => setOrigin(e.target.value)}>{ORIGINS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="sd-note">{list.length} 题</span>
      </div>
      {!list.length && <div className="lib-empty">{bank.length ? '没有符合条件的题。' : `${pack.name}题库还是空的。可以在收件箱导入 Word / PDF / 图片，整理后入库。`}</div>}
      <div className="pc-list">{list.map((q) => {
        const has = inPaper.has(q.id);
        return <article key={q.id} className={'pc-q' + (has ? ' in' : '')} draggable={!has} onDragStart={(e) => { drag.current = { id: q.id }; e.dataTransfer.setData('text/cs-q', q.id); e.dataTransfer.effectAllowed = 'copyMove'; }} onDragEnd={() => { drag.current = null; setOver(''); }}>
          <QImage path={q.image} />
          <button className="pc-q-main" onClick={() => setOpen(q)}>
            {q.stem ? <TexText as="p" text={clipTex(q.stem, 160)} /> : <p className="empty">（看图题）</p>}
            <div className="sd-q-meta"><Chips keys={q.points.slice(0, 2)} /><span className="sd-tag">{q.qtype}</span><span className="sd-tag">{q.difficulty} {DIFF_NAME[q.difficulty]}</span>{!q.answer && <span className="sd-tag warn">缺答案</span>}</div>
          </button>
          <button className={has ? 'pc-add on' : 'pc-add'} onClick={() => setPaper((p) => (has ? removeFromPaper(p, q.id) : addToPaper(p, q, qtypes)))} aria-label={has ? '从试卷移出' : '加入试卷'} data-tip={has ? '已在试卷里，点一下移出' : '加入试卷（也可以拖到右边）'}>{has ? <Check size={14} /> : <Plus size={14} />}</button>
        </article>;
      })}</div>
    </section>

    <section className="pc-paper" onDragOver={(e) => { if (!paper.sections.length) allow('empty')(e); }} onDrop={(e) => { if (paper.sections.length) return; e.preventDefault(); const id = drag.current?.id ?? e.dataTransfer.getData('text/cs-q'); const q = id ? qs.get(id) : undefined; if (q) add(q); setOver(''); }}>
      <div className="pc-head">
        <input className="sd-title" value={paper.title} placeholder={title} onChange={(e) => { const v = e.target.value; setPaper((p) => ({ ...p, title: v })); }} aria-label="试卷标题" />
        <label className="pc-num">时间<input type="number" min={0} max={300} value={paper.minutes} onChange={(e) => { const v = Math.max(0, Math.min(300, Number(e.target.value) || 0)); setPaper((p) => ({ ...p, minutes: v })); }} />分钟</label>
      </div>
      <div className="pc-sum">
        <span>共 <b className="num">{count}</b> 题</span><span>满分 <b className="num">{total}</b> 分</span>
        <span className="flex" />
        <label className="pc-num">总分凑成<input type="number" min={1} max={1000} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 100))} /></label>
        <button className="sd-btn" disabled={!count || total === target} onClick={() => setPaper((p) => scaleTo(p, target))}>按比例调整分值</button>
        <button className="sd-btn" onClick={() => setPaper((p) => ({ ...p, sections: [...p.sections, { id: sid(), title: '新大题', items: [] }] }))}><FilePlus2 size={13} />加一个大题</button>
        <button className="sd-btn" disabled={!count && !paper.sections.length} onClick={() => setPaper((p) => ({ ...emptyPaper(subject), title: p.title, minutes: p.minutes }))}><Trash2 size={13} />清空</button>
      </div>
      {!paper.sections.length && <div className={'lib-empty pc-drop' + (over === 'empty' ? ' over' : '')}>点左边题目右侧的「+」，或把题拖到这里。<br />题目会按题型自动分到「选择题」「填空题」等大题里，分值可以逐题改。</div>}
      {paper.sections.map((s, si) => {
        let n = paper.sections.slice(0, si).reduce((a, x) => a + x.items.length, 0);
        return <div key={s.id} className="pc-sec">
          <div className="pc-sec-h">
            <span className="pc-cn">{sectionHeading(s, si).split('、')[0]}、</span>
            <input value={s.title} onChange={(e) => { const v = e.target.value; setPaper((p) => ({ ...p, sections: p.sections.map((x) => (x.id === s.id ? { ...x, title: v } : x)) })); }} aria-label="大题名称" />
            <i>{sectionHeading(s, si).replace(/^.*?（/, '（')}</i>
            <span className="flex" />
            <button disabled={si === 0} onClick={() => setPaper((p) => { const a = [...p.sections]; [a[si - 1], a[si]] = [a[si], a[si - 1]]; return { ...p, sections: a }; })} aria-label="大题上移"><ArrowUp size={13} /></button>
            <button disabled={si === paper.sections.length - 1} onClick={() => setPaper((p) => { const a = [...p.sections]; [a[si + 1], a[si]] = [a[si], a[si + 1]]; return { ...p, sections: a }; })} aria-label="大题下移"><ArrowDown size={13} /></button>
            <button onClick={() => setPaper((p) => ({ ...p, sections: p.sections.filter((x) => x.id !== s.id) }))} aria-label="删除大题" data-tip={s.items.length ? `删除这个大题和里面的 ${s.items.length} 道题` : '删除这个大题'}><X size={13} /></button>
          </div>
          <ol className="pc-items" onDragOver={allow(s.id + ':end')} onDrop={dropAt(s.id, s.items.length)}>
            {s.items.map((it, ii) => {
              const q = qs.get(it.id); n++;
              return <li key={it.id} className={over === s.id + ':' + ii ? 'over' : ''} draggable onDragStart={(e) => { drag.current = { id: it.id }; e.dataTransfer.setData('text/cs-q', it.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { drag.current = null; setOver(''); }} onDragOver={allow(s.id + ':' + ii)} onDrop={dropAt(s.id, ii)}>
                <GripVertical size={14} className="pc-grip" />
                <span className="n">{n}</span>
                <button className="pc-q-main" onClick={() => q && setOpen(q)}>{q?.stem ? <TexText as="p" text={clipTex(q.stem, 140)} /> : <p className="empty">（看图题）</p>}{q && !q.answer && <span className="sd-tag warn">缺答案</span>}</button>
                <label className="pc-score"><input type="number" min={0.5} max={100} step={0.5} value={it.score} onChange={(e) => { const v = Math.max(0.5, Math.min(100, Number(e.target.value) || 1)); setPaper((p) => ({ ...p, sections: p.sections.map((x) => ({ ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, score: v } : y)) })) })); }} aria-label={`第 ${n} 题分值`} />分</label>
                <span className="pc-act">
                  <button disabled={ii === 0} onClick={() => setPaper((p) => moveInPaper(p, it.id, s.id, ii - 1))} aria-label="上移"><ArrowUp size={12} /></button>
                  <button disabled={ii === s.items.length - 1} onClick={() => setPaper((p) => moveInPaper(p, it.id, s.id, ii + 1))} aria-label="下移"><ArrowDown size={12} /></button>
                  <button onClick={() => setPaper((p) => removeFromPaper(p, it.id))} aria-label="移出试卷"><Trash2 size={12} /></button>
                </span>
              </li>;
            })}
            {!s.items.length && <li className={'pc-empty' + (over === s.id + ':end' ? ' over' : '')}>把题拖到这里</li>}
          </ol>
        </div>;
      })}
      {err && <p className="sd-err">{err}</p>}
      <div className="ags-row pc-foot">
        <button className="ags-go" disabled={!count || !!busy} onClick={() => void exportIt()}>{busy === 'export' ? <Loader2 size={14} className="ags-spin" /> : <Download size={14} />}导出学生版 + 答案版（Word + PDF）</button>
        <button className="sd-btn" disabled={!count || !!busy || !host.electron} onClick={() => void project()}>{busy === 'show' ? <Loader2 size={13} className="ags-spin" /> : <MonitorUp size={13} />}投到学生画面</button>
        <span className="sd-note">草稿自动保存；导出后记进「最近的作业」。</span>
      </div>
      {out && <Outputs r={out} />}
    </section>
    {open && <QuestionEditor q={open} onClose={() => setOpen(null)} />}
  </div>;
}
