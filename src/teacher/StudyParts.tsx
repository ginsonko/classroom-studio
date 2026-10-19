import { useMemo, useState } from 'react';
import { Check, FolderOpen, Loader2, ScanText, Search, Trash2, X } from 'lucide-react';
import { host } from '../lib/host';
import { DIFF_NAME, POINTS, findDuplicate, pointLabel, pointsOf, questionSubject, qtypesOf, type Question } from '../lib/studyLogic';
import type { SubjectId } from '../lib/subjects';
import { TexText, clipTex } from './TexText';
import { patchQuestion, removeQuestion, useStudy } from '../lib/studyStore';
import { readInBackground, useReading } from '../lib/studyActions';

/** 导出结果：每个文件一个打开按钮 + 打开文件夹 */
export function Outputs({ r }: { r: { out: string[]; errors: string[] } }) {
  const [err, setErr] = useState('');
  return <div className="sd-out">
    {r.out.map((f) => <button key={f} className="sd-file" onClick={() => void host.call('study.open', f).catch((e) => setErr(e.message))}><span className="ext">{f.split('.').pop()?.toUpperCase()}</span><span>{f.split('/').pop()}</span></button>)}
    {r.out[0] && <button className="sd-btn" onClick={() => void host.call('study.reveal', r.out[0]).catch((e) => setErr(e.message))}><FolderOpen size={13} />打开所在文件夹</button>}
    {[...r.errors, err].filter(Boolean).map((e) => <p key={e} className="sd-err">{e}</p>)}
  </div>;
}

export function QImage({ path, big }: { path?: string; big?: boolean }) {
  const [zoom, setZoom] = useState(false);
  const url = useMemo(() => { try { return path ? host.fileUrl(path) : ''; } catch { return ''; } }, [path]);
  if (!path) return null;
  if (!url) return <div className="sd-img missing">题图已移动或删除</div>;
  return <>
    <button type="button" className={'sd-img' + (big ? ' big' : '')} onClick={() => setZoom(true)} aria-label="放大题图"><img src={url} alt="题图" /></button>
    {zoom && <div className="sheet-bg" onPointerDown={() => setZoom(false)}><img className="sd-zoom" src={url} alt="题图" /></div>}
  </>;
}

export function Chips({ keys, onRemove }: { keys: string[]; onRemove?: (k: string) => void }) {
  if (!keys.length) return <span className="sd-chip none">未标知识点</span>;
  return <>{keys.map((k) => <span key={k} className="sd-chip">{pointLabel(k)}{onRemove && <button type="button" onClick={() => onRemove(k)} aria-label={'去掉 ' + pointLabel(k)}><X size={10} /></button>}</span>)}</>;
}

export function PointPicker({ value, onChange, max = 6, subject }: { value: string[]; onChange: (v: string[]) => void; max?: number; subject?: SubjectId }) {
  const [q, setQ] = useState('');
  const pool = subject ? pointsOf(subject) : POINTS;
  const hits = q.trim() ? pool.filter((p) => (p.ch + p.sec + p.book).includes(q.trim()) && !value.includes(p.key)).slice(0, 8) : [];
  return <div className="sd-pp">
    <div className="sd-pp-sel"><Chips keys={value} onRemove={(k) => onChange(value.filter((x) => x !== k))} /></div>
    {value.length < max && <div className="sd-pp-find"><Search size={12} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索知识点，例如 平抛、动量、楞次" /></div>}
    {!!hits.length && <div className="sd-pp-hits">{hits.map((p) => <button type="button" key={p.key} onClick={() => { onChange([...value, p.key]); setQ(''); }}><b>{p.sec}</b><i>{p.book} · {p.ch}</i></button>)}</div>}
  </div>;
}

export function DiffPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div className="sd-seg">{[1, 2, 3, 4, 5].map((d) => <button type="button" key={d} className={value === d ? 'on' : ''} onClick={() => onChange(d)}>{d} {DIFF_NAME[d]}</button>)}</div>;
}

/** 编辑一道题。收件箱里的题保存时可以直接入库；入库前查重。 */
export function QuestionEditor({ q, onClose }: { q: Question; onClose: () => void }) {
  const bank = useStudy((s) => s.data.questions);
  const reading = useReading((s) => s.ids.includes(q.id)), readErr = useReading((s) => s.errors[q.id]);
  const live = bank.find((x) => x.id === q.id) ?? q;
  const [f, setF] = useState({ stem: live.stem, answer: live.answer ?? '', analysis: live.analysis ?? '', points: live.points, difficulty: live.difficulty, qtype: live.qtype, source: live.source ?? '' });
  const [seen, setSeen] = useState(live.updatedAt), [sure, setSure] = useState(false);
  // 后台识题回来后把新内容同步进表单（老师已经改过的字段不覆盖）
  if (live.updatedAt !== seen) {
    setSeen(live.updatedAt);
    setF((o) => ({ ...o, stem: o.stem || live.stem, answer: o.answer || (live.answer ?? ''), analysis: o.analysis || (live.analysis ?? ''), points: o.points.length ? o.points : live.points, difficulty: live.difficulty, qtype: live.qtype }));
  }
  const dup = useMemo(() => findDuplicate(f.stem, bank.filter((x) => x.status === 'bank'), q.id), [f.stem, bank, q.id]);
  // 老师在这里看过并入库，就算核对过了：去掉自检未通过的标记，组作业才会选它
  const save = (status?: 'bank') => { patchQuestion(q.id, { ...f, ...(status ? { status, ...(live.check === 'mismatch' ? { check: 'ok' as const, checkNote: undefined } : {}) } : {}) }); onClose(); };
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className="record-editor sd-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="card-h"><b>{live.status === 'inbox' ? '整理收件箱里的题' : '编辑题目'}</b><span className="flex" />
        <button type="button" className="sd-btn" disabled={reading} onClick={() => { patchQuestion(q.id, { ...f }); void readInBackground(q.id); }}>{reading ? <Loader2 size={13} className="ags-spin" /> : <ScanText size={13} />}{reading ? '识题中…' : 'AI 识题'}</button>
        <button type="button" onClick={onClose} aria-label="关闭"><X size={16} /></button></div>
      {readErr && <p className="sd-err">{readErr}</p>}
      <QImage path={live.image} big />
      <label>题干<textarea rows={5} value={f.stem} onChange={(e) => setF({ ...f, stem: e.target.value })} placeholder={live.image ? '看图题可以不填；点「AI 识题」自动转写' : '题目文字，公式可用 $...$'} /></label>
      {/\$/.test(f.stem) && <TexText className="sd-texprev" text={f.stem} />}
      {dup && <p className="sd-warn">题库里已有相似的题（相似度 {Math.round(dup.sim * 100)}%）：{clipTex(dup.q.stem, 60)}</p>}
      {live.check === 'mismatch' && <p className="sd-warn">AI 自检没通过{live.checkNote ? '：' + live.checkNote : ''}。核对或改好后点「入库」，就会参与组作业。</p>}
      <div className="record-two"><label>答案<textarea rows={2} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} /></label><label>解析<textarea rows={2} value={f.analysis} onChange={(e) => setF({ ...f, analysis: e.target.value })} /></label></div>
      <label>知识点<PointPicker value={f.points} onChange={(points) => setF({ ...f, points })} subject={questionSubject(live)} /></label>
      <label>难度<DiffPicker value={f.difficulty} onChange={(difficulty) => setF({ ...f, difficulty })} /></label>
      <label>题型<div className="sd-seg">{qtypesOf(questionSubject(live)).map((t) => <button type="button" key={t} className={f.qtype === t ? 'on' : ''} onClick={() => setF({ ...f, qtype: t })}>{t}</button>)}</div></label>
      <label>出处<input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="课件名、页码或试卷名" /></label>
      <div className="record-actions">
        <button type="button" className="sd-danger" onClick={() => { if (sure) { removeQuestion(q.id); onClose(); } else setSure(true); }}><Trash2 size={13} />{sure ? '再点一次：删除题目和作答记录' : '删除'}</button>
        <span className="flex" />
        <button type="submit">保存</button>
        {live.status === 'inbox' && <button type="button" className="btn-cue" disabled={!f.stem.trim() && !live.image} onClick={() => save('bank')}><Check size={13} />入库</button>}
      </div>
    </form>
  </div>;
}
