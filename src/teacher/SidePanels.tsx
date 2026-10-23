import { useEffect, useMemo, useState } from 'react';
import { Check, CirclePlay, EyeOff, History, ListChecks, Loader2, Plus, UsersRound, X } from 'lucide-react';
import { checkFlow, checkSummary, FLOW_KEY, pathEntry, preloadWeb, useCheck } from '../lib/warmup';
import { SkillBar } from './Skills';
import { boardMaterial, fileEntry, simMaterial } from '../lib/library';
import { FLOW_DEFAULT } from '../lib/mock';
import { useStore } from '../lib/store';
import type { Material, View } from '../lib/types';
import { readDroppedFiles, useLib } from '../lib/useLib';
import { cancelMaterialLoad, openMaterial, reportMaterialError } from '../doc/actions';
import { host } from '../lib/host';
import { recordingMinutes, useRecordings } from '../doc/useRecordings';
import { recordAttempt, removeAttempt, useStudy } from '../lib/studyStore';
import { isGroup, kindName, memberText, peopleOf } from '../lib/groups';
import { captureFromScreen } from '../lib/studyActions';
import { RESULT_NAME, type Result } from '../lib/studyLogic';
import '../styles/study.css';

/** 课堂作答：老师看学生做完一题，点一下记对错；题目自动截图进学情收件箱 */
function ClassAnswers({ studentId }: { studentId: string }) {
  const attempts = useStudy((s) => s.data.attempts), students = useStore((s) => s.students);
  const people = useMemo(() => peopleOf(studentId, students), [studentId, students]);
  const group = isGroup(students.find((x) => x.id === studentId));
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => setSel(people.map((p) => p.id)), [studentId, people.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ text: string; undo?: string } | null>(null);
  // 班组课最近一题：每位成员记的是哪条作答，点名字可以单独改
  const [last, setLast] = useState<{ qid: string; marks: Record<string, string> } | null>(null);
  const today = new Date().toDateString(), ids = new Set(people.map((p) => p.id));
  const mine = attempts.filter((a) => ids.has(a.studentId) && new Date(a.at).toDateString() === today);
  const mark = async (result?: Result) => {
    setBusy(true);
    try {
      if (!group) {
        const { q, reused } = await captureFromScreen({ result, studentId });
        const prev = useStudy.getState().data.attempts.at(-1);
        setMsg({ text: result ? `已记「${RESULT_NAME[result]}」${reused ? '（同一题，记为再次作答）' : '，题目已收进学情收件箱'}` : '已收进学情收件箱', undo: result && prev?.questionId === q.id ? prev.id : undefined });
        return;
      }
      const { q, reused } = await captureFromScreen({});
      const marks: Record<string, string> = {};
      if (result) for (const id of sel) marks[id] = recordAttempt(id, q.id, result).id;
      setLast({ qid: q.id, marks });
      setMsg({ text: result ? `已给 ${sel.length} 人记「${RESULT_NAME[result]}」${reused ? '（同一题）' : ''}，点下面的名字可以单独改` : '已收进学情收件箱，点名字给每个人记对错' });
    } catch (e) { setMsg({ text: (e as Error).message }); } finally { setBusy(false); }
  };
  const ORDER: (Result | '')[] = ['right', 'half', 'wrong', ''];
  const resultOf = (id: string) => (last?.marks[id] ? attempts.find((a) => a.id === last.marks[id])?.result ?? '' : '');
  const cycle = (id: string) => {
    if (!last) return;
    const next = ORDER[(ORDER.indexOf(resultOf(id)) + 1) % ORDER.length], marks = { ...last.marks };
    if (marks[id]) removeAttempt(marks[id]);
    delete marks[id];
    if (next) marks[id] = recordAttempt(id, last.qid, next).id;
    setLast({ ...last, marks });
  };
  return <div className="scard-ans">
    <div className="scard-ans-h"><span>课堂作答</span>{mine.length > 0 && <i>今天 {group ? new Set(mine.map((a) => a.questionId)).size : mine.length} 题 · 对 {mine.filter((a) => a.result === 'right').length}{group ? ' 人次' : ''}</i>}</div>
    {group && <div className="scard-who"><span>记给</span>{people.map((p) => <button key={p.id} className={sel.includes(p.id) ? 'on' : ''} style={{ ['--h' as string]: p.hue }} onClick={() => setSel(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>{p.name}</button>)}
      {people.length > 2 && <button className="all" onClick={() => setSel(sel.length === people.length ? [] : people.map((p) => p.id))}>{sel.length === people.length ? '全不选' : '全选'}</button>}
      {!people.length && <i>班组还没有成员，到「学生」页编辑</i>}</div>}
    <div className="scard-ans-b">
      {(['right', 'half', 'wrong'] as Result[]).map((r) => <button key={r} className={'r-' + r} disabled={busy || !host.electron || (group && !sel.length)} onClick={() => void mark(r)} data-tip={group ? `截取学生画面上的题，给选中的同学记「${RESULT_NAME[r]}」` : `截取学生画面上的题，记一次「${RESULT_NAME[r]}」`}>{RESULT_NAME[r]}</button>)}
      <button disabled={busy || !host.electron} onClick={() => void mark()} data-tip="只收题，不记对错">收题</button>
    </div>
    {msg && <div className="scard-ans-m">{msg.text}{msg.undo && <button onClick={() => { removeAttempt(msg.undo!); setMsg({ text: '已撤销这次记录' }); }}>撤销</button>}</div>}
    {group && last && <div className="scard-each">{people.map((p) => { const r = resultOf(p.id); return <button key={p.id} className={r ? 'r-' + r : ''} onClick={() => cycle(p.id)} data-tip="点一下换：对 → 半对 → 错 → 没记">{p.name}<b>{r ? RESULT_NAME[r] : '—'}</b></button>; })}</div>}
  </div>;
}
const Q_ID = '高一物理/第1章 匀变速直线运动/追及相遇问题（示例）无答案.pdf';

/** 本课流程（备课单）：按顺序 预监 → 切给学生 */
export function FlowPanel() {
  const lib = useLib((s) => s.lib);
  const pgmTitle = useStore((s) => s.pgmMat.title);
  type Item = { id: string; ref: string; title: string; page: number; slide?: number; done: boolean; mat?: Material; view?: View };
  const [flow, setFlow] = useState<Item[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(FLOW_KEY) || 'null'); if (Array.isArray(saved)) return saved; } catch {}
    return host.electron ? [] : FLOW_DEFAULT;
  });
  const [cur, setCur] = useState(0), [over, setOver] = useState(false);
  useEffect(() => { try { localStorage.setItem(FLOW_KEY, JSON.stringify(flow)); } catch (e) { reportMaterialError(e, '备课单保存'); } }, [flow]);
  const checks = useCheck((s) => s.items), checking = useCheck((s) => s.running), checkedAt = useCheck((s) => s.at);
  const summary = checkSummary(checks, flow.filter((x) => !x.done).map((x) => x.id));
  useEffect(() => { if (checkedAt) preloadWeb(flow); }, [flow, checkedAt]);

  const addCurrent = () => {
    const { mat, view } = useStore.getState().reader;
    setFlow((old) => [...old, { id: crypto.randomUUID(), ref: mat.id, title: `${mat.title}${mat.total > 1 ? ' · 第 ' + (view.page + 1) + ' 页' : ''}`, page: view.page, slide: view.slide, done: false, mat, view }]);
  };
  const publish = async (i: number, target: 'cue' | 'student') => {
    const it = flow[i]; if (!it) return;
    const f = lib?.files.get(it.ref) ?? (!host.electron && !['board', 'sim'].includes(it.ref) ? lib?.files.get(Q_ID) : undefined);
    const m = it.mat ?? (it.ref === 'board' ? boardMaterial() : it.ref === 'sim' ? simMaterial() : null);
    const view = it.view ?? { page: it.page, slide: it.slide ?? 0 };
    let success = false;
    if (f) success = !!await openMaterial(f, target, view);
    else if (m?.src?.path) success = !!await openMaterial(fileEntry(m.src.path), target, view);
    else if (!m && pathEntry(it.ref)) success = !!await openMaterial(pathEntry(it.ref)!, target, view);
    else if (m) { cancelMaterialLoad(target); if (target === 'student') useStore.getState().showNow(m, view); else useStore.getState().cue(m, view); success = true; }
    else { reportMaterialError(new Error('找不到备课单对应的原文件，请重新加入。'), it.title, target); return; }
    if (!success) return;
    if (target === 'student') setFlow((old) => old.map((x) => x.id === it.id ? { ...x, done: true } : x));
    setCur(target === 'student' ? Math.min(flow.length - 1, i + 1) : i);
  };

  return (
    <div className={'flow' + (over ? ' drop' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => {
      e.preventDefault(); e.stopPropagation(); setOver(false);
      const id = e.dataTransfer.getData('text/x-cs-file'), known = lib?.files.get(id);
      const append = (files: { id: string; title: string }[]) => setFlow((old) => [...old, ...files.map((f) => ({ id: crypto.randomUUID(), ref: f.id, title: f.title, page: 0, done: false }))]);
      if (known) append([known]); else void readDroppedFiles(Array.from(e.dataTransfer.files)).then(append).catch((e) => reportMaterialError(e, '加入备课单'));
    }}>
      <div className="sec-h">
        <span>本课流程</span>
        <i className="num">{flow.filter((f) => f.done).length}/{flow.length}</i>
        <span className="flex" />
        {host.electron && flow.some((x) => !x.done) && <button className="sec-a flow-check" disabled={checking} onClick={() => void checkFlow({ flow })} data-tip="提前转换 PPT / Word、试开网页和视频，有问题的标红；网页课件会在学生窗口后台加载好">{checking ? <Loader2 size={13} className="ags-spin" /> : <ListChecks size={13} />}<span>课前检查</span></button>}
        <button className="sec-a" onClick={addCurrent} data-tip="把阅读器当前页加入备课单，也可以拖入课件"><Plus size={13} /></button>
      </div>
      {summary && <div className={'flow-sum' + (/有问题/.test(summary) ? ' bad' : /留意/.test(summary) ? ' warn' : checking ? '' : ' ok')}>{summary}{!checking && checkedAt > 0 && <i>{new Date(checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 检查</i>}</div>}
      <ol>
        {flow.map((it, i) => {
          const c = it.done ? undefined : checks[it.id];
          return (
          <li key={it.id} className={(it.done ? 'done ' : '') + (i === cur ? 'cur ' : '') + (pgmTitle && it.done && i === flow.findLastIndex((x) => x.done) ? 'live ' : '') + (c ? 'ck-' + c.state : '')}>
            <button className="flow-n" onClick={() => setFlow(flow.map((x, k) => (k === i ? { ...x, done: !x.done } : x)))} aria-label="标记完成">
              {it.done ? <Check size={11} strokeWidth={3} /> : <span className="num">{i + 1}</span>}
            </button>
            <span className="flow-t" onClick={() => void publish(i, 'cue')} data-tip={c && c.state === 'ok' ? c.text : undefined}>
              {c && <i className={'flow-dot ' + c.state} />}{it.title}
              {c && c.state !== 'ok' && <em className="flow-why">{c.text}</em>}
            </span>
            <button className="flow-remove" onClick={() => setFlow((old) => old.filter((x) => x.id !== it.id))} aria-label="移除备课项"><X size={12} /></button>
            <button className="flow-go" onClick={() => void publish(i, 'student')} data-tip="直接切给学生"><CirclePlay size={15} /></button>
          </li>);
        })}
      </ol>
      {!flow.length && <div className="flow-empty">把课件拖到这里，或点右上角 + 加入阅读器当前页。备课单保存在本机。</div>}
      <div className="flow-hint">点标题预监　<kbd>Enter</kbd> 切给学生</div>
    </div>
  );
}

export function NotesPanel() {
  const readerId = useStore((s) => s.reader.mat.id);
  const title = useStore((s) => s.reader.mat.title);
  const notes = useStore((s) => s.notes);
  const set = useStore((s) => s.set);
  return (
    <div className="notes">
      <div className="sec-h"><EyeOff size={12} /><span>私有备注</span><span className="flex" /><i title={title}>{title.slice(0, 14)}</i></div>
      <textarea
        value={notes[readerId] ?? ''}
        onChange={(e) => set({ notes: { ...notes, [readerId]: e.target.value } })}
        placeholder="答案、讲解要点、要追问的地方…只保存在本机，学生看不到。"
      />
    </div>
  );
}

/** 当前学生：上节课学了什么 + 一键回放 */
export function StudentCard({ onOpen }: { onOpen: () => void }) {
  const studentId = useStore((s) => s.studentId);
  const students = useStore((s) => s.students);
  const s = students.find((x) => x.id === studentId);
  const { recordings } = useRecordings();
  const last = useMemo(() => recordings.find((r) => r.studentId === studentId && r.phase === 'complete'), [recordings, studentId]);
  if (!s) return <div className="scard"><div className="sec-h">自由课堂</div><div className="flow-empty">可以直接使用课件与黑板，也可以先建立学生档案，让录像按学生归档。</div><button className="scard-more" onClick={onOpen}>添加学生</button></div>;
  return (
    <div className="scard" style={{ ['--h' as string]: s.hue }}>
      <div className="scard-top">
        <span className="ava">{isGroup(s) ? <UsersRound size={15} /> : s.name.slice(-1)}</span>
        <div className="scard-n"><b>{s.name}</b><span>{isGroup(s) ? `${kindName(s.kind)} · ${memberText(s, students)}` : `${s.grade} · ${s.textbook}`}</span></div>
        <button className="scard-more" onClick={onOpen}>档案</button>
      </div>
      <div className="scard-last">
        <History size={12} />
        <span>上次讲到</span>
        <b>{s.lastTopic || '尚未记录'}</b>
      </div>
      {last && (
        <button className="scard-replay" onClick={() => void host.call('openRecording', last.id).catch((e) => reportMaterialError(e, '课堂回放'))}>
          <span className="play"><CirclePlay size={16} /></span>
          <span><b>上节课回放</b><i>{new Date(last.createdAt).toLocaleDateString('zh-CN')} · {recordingMinutes(last) === null ? '已保存' : `${recordingMinutes(last)} 分钟`}</i></span>
        </button>
      )}
      <ClassAnswers studentId={s.id} />
      <SkillBar />
    </div>
  );
}
