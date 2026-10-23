import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FolderPlus, ImageDown, ListChecks, Loader2, Presentation, Send, Settings2, Sparkles, Trash2, Wand } from 'lucide-react';
import { isGroup, membersOf } from '../lib/groups';
import { PaperComposer } from './PaperComposer';
import { useStore } from '../lib/store';
import { host } from '../lib/host';
import { addRoot } from '../lib/useLib';
import { recordingMinutes, useRecordings } from '../doc/useRecordings';
import { TexText } from './TexText';
import {
  DIFF_NAME, RESULT_NAME, guessType, mastery, outlineByRules, outlineMarkdown, pickHomework, pointLabel,
  type LessonNote, type Picked, type SendRecord,
} from '../lib/studyLogic';
import { addQuestion, useStudy } from '../lib/studyStore';
import { draftQuestions, online, outlineByAi } from '../lib/studyAi';
import { aiConfig, buildLessonNote, exportHomework, homeworkTitle, lessonDocument, saveLesson, takeHomeworkPreset } from '../lib/studyActions';
import { LEVEL_NAME, nodeInfo, traceBack } from '../lib/knowledgeNet';
import { useLearning, useSubject } from '../lib/subjectState';
import { Chips, DiffPicker, Outputs, PointPicker, QImage } from './StudyParts';
import { ContactsSheet, SendLog, SendSheet, useNotify } from './ParentSend';

type Out = { out: string[]; errors: string[] };
const today = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const localDay = (iso: string | number) => { const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function useOnline() { const [on, setOn] = useState<boolean | null>(null); useEffect(() => { void aiConfig().then((c) => setOn(online(c))); }, []); return on; }
function NeedStudent() { return <div className="sd-pane"><div className="lib-empty">先在顶栏选择一位学生。</div></div>; }

// ── 组作业：智能组卷（按条件从题库挑）/ 自己组卷（手动挑题、排序、配分） ──
const MODE = 'cs.homework.mode';
export function HomeworkTab() {
  const [mode, setMode] = useState<'smart' | 'manual'>(() => (localStorage.getItem(MODE) === 'manual' ? 'manual' : 'smart'));
  const pick = (m: 'smart' | 'manual') => { setMode(m); localStorage.setItem(MODE, m); };
  return <div className="hw-wrap">
    <div className="hw-mode ags-tabs"><button className={mode === 'smart' ? 'on' : ''} onClick={() => pick('smart')}><Wand size={13} />智能组卷</button><button className={mode === 'manual' ? 'on' : ''} onClick={() => pick('manual')}><ListChecks size={13} />自己组卷</button><span className="sd-note">{mode === 'smart' ? '按知识点、难度自动从题库挑题，题不够时 AI 出题补齐' : '自己从题库挑题、分大题、配分，导出学生版和答案版'}</span></div>
    {mode === 'smart' ? <SmartHomework /> : <PaperComposer />}
  </div>;
}

function SmartHomework() {
  const data = useStudy((s) => s.data);
  const studentId = useStore((s) => s.studentId), student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const ai = useOnline();
  const subject = useSubject();
  const weak = useMemo(() => [...mastery(studentId, data, subject).values()].filter((m) => m.score < 0.6).sort((a, b) => a.score - b.score).map((m) => m.key).slice(0, 4), [studentId, data, subject]);
  const [preset] = useState(takeHomeworkPreset);
  const [points, setPoints] = useState<string[]>(preset?.points ?? []), [touched, setTouched] = useState(!!preset), [prereq, setPrereq] = useState(preset?.prereq ?? false);
  const map = useLearning(studentId);
  const info = useMemo(() => nodeInfo(studentId, data, map, subject), [studentId, data, map, subject]);
  const roots = useMemo(() => { const base = points.length ? points : weak; return prereq ? traceBack(base, info).filter((r) => !base.includes(r.key)).slice(0, 3) : []; }, [prereq, points, weak, info]);
  const [count, setCount] = useState(8), [minD, setMinD] = useState(1), [maxD, setMaxD] = useState(4), [redo, setRedo] = useState(2), [avoid, setAvoid] = useState(14);
  const [picked, setPicked] = useState<Picked[] | null>(null), [short, setShort] = useState(0), [title, setTitle] = useState('');
  const [busy, setBusy] = useState(''), [steps, setSteps] = useState(''), [err, setErr] = useState(''), [out, setOut] = useState<Out | null>(null);
  useEffect(() => { if (!touched) setPoints(weak); }, [weak, touched]);
  if (!student) return <NeedStudent />;
  const compose = () => {
    const r = pickHomework({ studentId, points, count, minD, maxD, redo, avoidDays: avoid, prereqs: roots, subject }, data);
    setPicked(r.picked); setShort(r.short); setOut(null); setErr('');
    if (!points.length && r.points.length) { setPoints(r.points); setTouched(true); }
    setTitle(homeworkTitle(student.name, points.length ? points : r.points));
  };
  const fill = async () => {
    const pts = points.length ? points : weak;
    if (!pts.length) { setErr('请先选知识点，AI 才知道出什么题。'); return; }
    setBusy('ai'); setErr('');
    try {
      const avoidStems = [...(picked ?? []).map((p) => p.q.stem), ...data.questions.filter((q) => q.points.some((k) => pts.includes(k))).map((q) => q.stem)].filter(Boolean);
      const { drafts } = await draftQuestions(pts, short, minD, maxD, avoidStems, setSteps);
      const added: Picked[] = []; let bad = 0;
      for (const d of drafts) {
        const q = addQuestion({ stem: d.stem, answer: d.answer, analysis: d.analysis, points: d.points, difficulty: d.difficulty, qtype: guessType(d.stem, subject), origin: 'ai', status: d.check === 'ok' ? 'bank' : 'inbox', check: d.check, checkNote: d.checkNote, source: 'AI 原创', subject });
        if (d.check === 'ok') added.push({ q, why: 'AI 原创 · 已自检' }); else bad++;
      }
      setPicked([...(picked ?? []), ...added]); setShort(Math.max(0, short - added.length));
      setSteps(`AI 出了 ${drafts.length} 题，${added.length} 题自检通过已加入作业` + (bad ? `；${bad} 题没通过自检（答案对不上或题目条件有问题），放进收件箱待你核对` : '') + '。');
    } catch (e) { setErr((e as Error).message); setSteps(''); } finally { setBusy(''); }
  };
  const exportIt = async () => {
    if (!picked?.length) return;
    setBusy('export'); setErr('');
    try {
      setOut(await exportHomework({ studentId, name: student.name, title, questions: picked.map((p) => p.q), points }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const history = data.homework.filter((h) => h.studentId === studentId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  return <div className="sd-pane sd-two">
    <section className="sd-form">
      <h3>给 {student.name} 组一份作业</h3>
      <label>知识点 <i>{touched || !weak.length ? '' : '（默认是作答记录里的薄弱点）'}</i><PointPicker value={points} onChange={(v) => { setPoints(v); setTouched(true); }} subject={subject} /></label>
      <label className="sd-check"><input type="checkbox" checked={prereq} onChange={(e) => setPrereq(e.target.checked)} />先补前置：按知识网络往前找掌握不好的知识点，先练几道</label>
      {prereq && <p className="sd-note">{roots.length ? '会先补：' + roots.map((r) => `${pointLabel(r.key).split(' · ').pop()}（${LEVEL_NAME[r.level]}）`).join('、') : '所选知识点的前置都掌握了，或还没有作答记录。'}</p>}
      <div className="sd-grid">
        <label>题数<input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
        <label>其中错题重做<input type="number" min={0} max={count} value={redo} onChange={(e) => setRedo(Math.max(0, Number(e.target.value) || 0))} /></label>
        <label>排除最近几天做过的<input type="number" min={0} max={365} value={avoid} onChange={(e) => setAvoid(Math.max(0, Number(e.target.value) || 0))} /></label>
      </div>
      <label>最低难度<DiffPicker value={minD} onChange={(v) => { setMinD(v); if (v > maxD) setMaxD(v); }} /></label>
      <label>最高难度<DiffPicker value={maxD} onChange={(v) => { setMaxD(v); if (v < minD) setMinD(v); }} /></label>
      <div className="ags-row"><button className="ags-go" onClick={compose}><Wand size={14} />从题库组卷</button><span className="sd-note">已做对的题不会再选；相似题只留一道；按难度从易到难排。</span></div>
      {!!history.length && <><h4>最近的作业</h4><div className="sd-hw">{history.map((h) => <div key={h.id}><b>{h.title}</b><i>{new Date(h.at).toLocaleDateString('zh-CN')} · {h.questionIds.length} 题</i>{h.files[0] && <Outputs r={{ out: h.files, errors: [] }} />}</div>)}</div></>}
    </section>
    <section className="sd-preview">
      {!picked ? <div className="lib-empty">设置好条件后点「从题库组卷」。题不够时可以让 AI 出原创题补齐，每道都会独立再解一遍做自检。</div> : <>
        <div className="sd-bar"><input className="sd-title" value={title} onChange={(e) => setTitle(e.target.value)} /><span className="sd-note">{picked.length} 题</span></div>
        {short > 0 && <div className="sd-short">题库里符合条件的题还差 {short} 道。{ai ? <button className="sd-btn" disabled={!!busy} onClick={() => void fill()}>{busy === 'ai' ? <Loader2 size={13} className="ags-spin" /> : <Sparkles size={13} />}AI 出 {short} 道原创题补齐</button> : <span>（配置 AI 后可以自动出题补齐，或先往题库里多收一些题）</span>}</div>}
        {steps && <p className="sd-msg">{steps}</p>}
        <ol className="sd-picked">{picked.map((p, i) => <li key={p.q.id}><span className="n">{i + 1}</span><div><QImage path={p.q.image} />{p.q.stem ? <TexText as="p" text={p.q.stem} /> : <p>（看图题）</p>}<div className="sd-q-meta"><Chips keys={p.q.points} /><span className="sd-tag">{p.q.difficulty} {DIFF_NAME[p.q.difficulty]}</span><i>{p.why}</i>{!p.q.answer && <span className="sd-tag warn">缺答案</span>}</div></div><button onClick={() => setPicked(picked.filter((x) => x !== p))} aria-label="移出作业"><Trash2 size={13} /></button></li>)}</ol>
        {err && <p className="sd-err">{err}</p>}
        <div className="ags-row"><button className="ags-go" disabled={!picked.length || !!busy} onClick={() => void exportIt()}>{busy === 'export' ? <Loader2 size={14} className="ags-spin" /> : <Download size={14} />}导出作业（Word + PDF，答案另起一页）</button></div>
        {out && <Outputs r={out} />}
      </>}
    </section>
  </div>;
}

// ── 课后总结 + 家长反馈 + 分享长图 ───────────────────────
export function LessonTab() {
  const data = useStudy((s) => s.data), update = useStudy((s) => s.update);
  const bound = useStore((s) => s.students.find((x) => x.id === s.studentId)), students = useStore((s) => s.students);
  // 班组课：每位成员一份总结，上面切换成员
  const members = useMemo(() => (bound && isGroup(bound) ? membersOf(bound, students) : []), [bound, students]);
  const [memberId, setMemberId] = useState('');
  const student = members.length ? members.find((m) => m.id === memberId) ?? members[0] : bound;
  const studentId = student?.id ?? '', groupId = members.length ? bound!.id : undefined;
  const { recordings } = useRecordings();
  const ai = useOnline();
  const [date, setDate] = useState(today()), [topic, setTopic] = useState(''), [minutes, setMinutes] = useState(''), [notes, setNotes] = useState(''), [homework, setHomework] = useState('');
  const [note, setNote] = useState<LessonNote | null>(null), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [out, setOut] = useState<Out | null>(null), [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false), [contacts, setContacts] = useState(false);
  useEffect(() => { void useNotify.getState().refresh(); }, []);
  const qs = useMemo(() => new Map(data.questions.map((q) => [q.id, q])), [data.questions]);
  const todays = useMemo(() => data.attempts.filter((a) => a.studentId === studentId && localDay(a.at) === date && qs.has(a.questionId)).map((a) => ({ a, q: qs.get(a.questionId)! })), [data.attempts, studentId, date, qs]);
  useEffect(() => {
    if (!student) return;
    const saved = groupId ? data.lessons.find((l) => l.studentId === studentId && l.date === date && l.groupId === groupId) : undefined;
    setTopic(saved?.topic || (groupId ? bound?.lastTopic : '') || student.lastTopic || ''); setNote(saved ?? null); setOut(saved?.files?.length ? { out: saved.files, errors: [] } : null);
    const rec = recordings.find((r) => r.studentId === (groupId ?? studentId) && r.createdAt && localDay(r.createdAt) === date);
    const m = rec ? recordingMinutes(rec) : null; setMinutes(m ? String(Math.round(m)) : '');
    const hw = data.homework.find((h) => h.studentId === studentId && localDay(h.at) === date); setHomework(hw?.title ?? '');
  }, [studentId, date, recordings.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!student) return <NeedStudent />;
  const make = async () => {
    setBusy('gen'); setErr(''); setOut(null);
    try {
      const r = await buildLessonNote({ studentId, name: student.name, date, topic, minutes: Number(minutes) || undefined, notes, homework, id: note?.id, groupId });
      setNote(r.note); if (r.warning) setErr(r.warning);
    } finally { setBusy(''); }
  };
  /** 班组：每位成员都按各自的作答生成并保存（已有当天总结的不重写） */
  const makeAll = async () => {
    setBusy('all'); setErr('');
    const warn: string[] = [];
    try {
      for (const [i, m] of members.entries()) {
        setBusy(`all:${i + 1}/${members.length}`);
        const old = useStudy.getState().data.lessons.find((l) => l.studentId === m.id && l.date === date && l.groupId === groupId);
        if (old) continue;
        const r = await buildLessonNote({ studentId: m.id, name: m.name, date, topic, minutes: Number(minutes) || undefined, notes, homework, groupId });
        saveLesson(r.note);
        if (r.warning) warn.push(`${m.name}：${r.warning}`);
      }
      const mine = useStudy.getState().data.lessons.find((l) => l.studentId === studentId && l.date === date && l.groupId === groupId);
      if (mine) setNote(mine);
      if (warn.length) setErr(warn.join('\n'));
    } finally { setBusy(''); }
  };
  const save = saveLesson;
  const writeDoc = async (n: LessonNote, formats: string[]) => {
    const r = await lessonDocument(n, student.name, formats);
    setOut((o) => ({ out: [...(o?.out ?? []).filter((f) => !r.out.includes(f)), ...r.out], errors: r.errors }));
    return r;
  };
  const exportIt = async (formats: string[]) => {
    if (!note) return;
    setBusy(formats[0]); setErr('');
    try { await writeDoc(note, formats); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const stored = note ? data.lessons.find((l) => l.id === note.id) : undefined;
  const longImage = [...(stored?.files ?? [])].reverse().find((f) => f.endsWith('.png')) ?? '';
  const makeImage = async () => { const r = await writeDoc(note!, ['png']); const p = r.out.find((f) => f.endsWith('.png')); if (!p) throw new Error(r.errors[0] || '没有生成长图'); return p; };
  const onSent = (r: SendRecord[]) => update((d) => ({ ...d, lessons: d.lessons.map((l) => (l.id === note!.id ? { ...l, sends: [...(l.sends ?? []), ...r].slice(-30) } : l)) }));
  const lines = (v: string[]) => v.join('\n'), split = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const past = data.lessons.filter((l) => l.studentId === studentId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  return <div className="sd-pane sd-two">
    <section className="sd-form">
      {members.length > 0 && <div className="sd-members"><span>{bound!.name} · 每人一份</span>{members.map((m) => { const done = data.lessons.some((l) => l.studentId === m.id && l.date === date); return <button key={m.id} className={(m.id === studentId ? 'on' : '') + (done ? ' done' : '')} style={{ ['--h' as string]: m.hue }} onClick={() => setMemberId(m.id)}>{done && <Check size={11} />}{m.name}</button>; })}
        <button className="ags-go" disabled={!!busy} onClick={() => void makeAll()} data-tip="按每个人当天的作答分别写总结和家长反馈，写好的先保存，再逐个确认、发送">{busy.startsWith('all') ? <Loader2 size={13} className="ags-spin" /> : <Sparkles size={13} />}{busy.startsWith('all:') ? busy.slice(4) : '全组每人生成'}</button></div>}
      <h3>{student.name} · 课后总结</h3>
      <div className="sd-grid"><label>日期<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>时长（分钟）<input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} /></label></div>
      <label>本节课主题<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：带电粒子在磁场中的运动" /></label>
      <div className="sd-today"><b>当天作答 {todays.length} 题</b>{todays.length ? <span>{(['right', 'half', 'wrong'] as const).map((r) => `${RESULT_NAME[r]} ${todays.filter((x) => x.a.result === r).length}`).join(' · ')}</span> : <span>上课时在学生卡点「对 / 半对 / 错」会记到这里</span>}</div>
      <label>课堂笔记 / 补充说明<textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例如：受力分析画图习惯有进步；计算时单位容易漏" /></label>
      <label>课后作业<input value={homework} onChange={(e) => setHomework(e.target.value)} placeholder="可选" /></label>
      <div className="ags-row"><button className="ags-go" disabled={!!busy} onClick={() => void make()}>{busy === 'gen' ? <Loader2 size={14} className="ags-spin" /> : <Sparkles size={14} />}{ai ? 'AI 生成总结和家长反馈' : '按模板生成总结和家长反馈'}</button>{ai === false && <span className="sd-note">没配置 AI，用规则模板。</span>}</div>
      {!!past.length && <><h4>以前的课后总结</h4><div className="sd-hw">{past.map((l) => <button key={l.id} className="sd-past" onClick={() => { setNote(l); setOut(l.files?.length ? { out: l.files, errors: [] } : null); }}><b>{l.date} · {l.topic || '未填主题'}</b><i>{l.via === 'ai' ? 'AI 生成' : '模板'}</i></button>)}</div></>}
    </section>
    <section className="sd-preview">
      {!note ? <div className="lib-empty">填好左边后点「生成」。结果可以直接修改，然后复制家长反馈、导出分享长图或 Word / PDF。</div> : <div className="sd-note-edit">
        <label>本节课总结<textarea rows={4} value={note.summary} onChange={(e) => setNote({ ...note, summary: e.target.value })} /></label>
        <div className="sd-grid3"><label>做得好的（一行一条）<textarea rows={4} value={lines(note.strengths)} onChange={(e) => setNote({ ...note, strengths: split(e.target.value) })} /></label><label>需要加强<textarea rows={4} value={lines(note.problems)} onChange={(e) => setNote({ ...note, problems: split(e.target.value) })} /></label><label>下一步<textarea rows={4} value={lines(note.next)} onChange={(e) => setNote({ ...note, next: split(e.target.value) })} /></label></div>
        <label>给家长的话<textarea rows={5} value={note.parent} onChange={(e) => setNote({ ...note, parent: e.target.value })} /></label>
        {err && <p className="sd-err">{err}</p>}
        <div className="ags-row">
          <button className="sd-btn" onClick={() => { save(note); setErr(''); }}>保存</button>
          <button className="sd-btn" onClick={() => void navigator.clipboard.writeText(note.parent).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}><Copy size={13} />{copied ? '已复制' : '复制家长反馈'}</button>
          <button className="ags-go" disabled={!!busy} onClick={() => void exportIt(['png'])}>{busy === 'png' ? <Loader2 size={14} className="ags-spin" /> : <ImageDown size={14} />}导出分享长图</button>
          <button className="sd-btn" disabled={!!busy} onClick={() => void exportIt(['docx', 'pdf'])}>{busy === 'docx' ? <Loader2 size={13} className="ags-spin" /> : <Download size={13} />}Word + PDF</button>
          <button className="ags-go ps-open" disabled={!!busy || !note.parent.trim()} onClick={() => { save(note); setSending(true); }}><Send size={14} />发送给家长</button>
          <button className="sd-btn" onClick={() => setContacts(true)}><Settings2 size={13} />家长联系方式</button>
        </div>
        {out && <Outputs r={out} />}
        <SendLog sends={stored?.sends} />
        {sending && <SendSheet note={stored ?? note} student={student} image={longImage} makeImage={makeImage} onSent={onSent} onClose={() => setSending(false)} />}
        {contacts && <ContactsSheet student={student} onClose={() => setContacts(false)} />}
      </div>}
    </section>
  </div>;
}

// ── AI 课件 ────────────────────────────────────────────
export function CoursewareTab() {
  const data = useStudy((s) => s.data);
  const student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const ai = useOnline();
  const subject = useSubject();
  const [topic, setTopic] = useState(''), [points, setPoints] = useState<string[]>([]), [minutes, setMinutes] = useState(60);
  const [md, setMd] = useState(''), [busy, setBusy] = useState(''), [err, setErr] = useState(''), [out, setOut] = useState<Out | null>(null), [added, setAdded] = useState(false);
  const examples = useMemo(() => data.questions.filter((q) => q.status === 'bank' && q.stem && q.points.some((k) => points.includes(k))).sort((a, b) => a.difficulty - b.difficulty).slice(0, 4), [data.questions, points]);
  const gen = async () => {
    setBusy('gen'); setErr(''); setOut(null); setAdded(false);
    try {
      const cfg = await aiConfig();
      const o = online(cfg) ? (await outlineByAi(topic, points, student ? `${student.name}（${student.grade}，${student.tags.join('、') || '无标签'}）` : '一对一学生', minutes, examples)).outline : outlineByRules(topic, points, data.questions);
      setMd(outlineMarkdown(o, subject));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const exportIt = async () => {
    setBusy('export'); setErr('');
    try { setOut(await host.call<Out>('study.document', { kind: 'courseware', title: (topic || md.match(/^#\s+(.+)$/m)?.[1] || 'AI课件').trim(), markdown: md, formats: ['pptx', 'pdf'] })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const slides = md ? md.split(/\n-{3,}\n/).length : 0;
  return <div className="sd-pane sd-two">
    <section className="sd-form">
      <h3>AI 生成讲课课件</h3>
      <label>主题<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：带电粒子在有界磁场中的运动" /></label>
      <label>知识点<PointPicker value={points} onChange={setPoints} subject={subject} /></label>
      <label>课时（分钟）<input type="number" min={20} max={180} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 60)} /></label>
      {!!examples.length && <p className="sd-note">会参考题库里 {examples.length} 道相关例题。</p>}
      <div className="ags-row"><button className="ags-go" disabled={!!busy || (!topic.trim() && !points.length)} onClick={() => void gen()}>{busy === 'gen' ? <Loader2 size={14} className="ags-spin" /> : <Sparkles size={14} />}{ai ? 'AI 写课件大纲' : '按知识点生成课件框架'}</button></div>
      <p className="ags-sub">大纲生成后可以在右边直接改（每页用 --- 分开，## 是页标题）。导出 PPT 用导播台自己的排版，公式清晰，不需要装 Office。</p>
    </section>
    <section className="sd-preview">
      {!md ? <div className="lib-empty">先填主题或知识点，再点生成。</div> : <>
        <div className="sd-bar"><b>课件大纲</b><span className="sd-note">{slides} 页</span><span className="flex" /><button className="ags-go" disabled={!!busy} onClick={() => void exportIt()}>{busy === 'export' ? <Loader2 size={14} className="ags-spin" /> : <Presentation size={14} />}导出 PPT + PDF</button></div>
        <textarea className="sd-md" value={md} onChange={(e) => setMd(e.target.value)} spellCheck={false} />
        {err && <p className="sd-err">{err}</p>}
        {out && <><Outputs r={out} />{out.out[0] && <button className="sd-btn" disabled={added} onClick={() => void addRoot(out.out[0].replace(/\/[^/]+$/, '')).then(() => setAdded(true)).catch((e) => setErr(e.message))}><FolderPlus size={13} />{added ? '已加入资料库' : '加入资料库，上课直接打开'}</button>}</>}
      </>}
      {err && !md && <p className="sd-err">{err}</p>}
    </section>
  </div>;
}
