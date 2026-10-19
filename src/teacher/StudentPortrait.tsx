import { useMemo, useState } from 'react';
import { BookX, ClipboardList, GitBranch, Loader2, NotebookPen, Sparkles } from 'lucide-react';
import type { Student } from '../lib/types';
import { lessonIn, pct, pointLabel, portraitKey, profile } from '../lib/studyLogic';
import { nowIso, useStudy } from '../lib/studyStore';
import { online, portraitByAi, portraitByRules } from '../lib/studyAi';
import { aiConfig } from '../lib/studyActions';
import { openStudy } from './StudyPage';
import { studentSubject, subjectName } from '../lib/subjects';
import { useLearning } from '../lib/subjectState';
import { rootText, weakRoots } from '../lib/knowledgeNet';

/** 学生画像：作答统计、近 6 周正确率、强弱知识点，可让 AI 写一段文字画像 */
export function Portrait({ student }: { student: Student }) {
  const data = useStudy((s) => s.data), update = useStudy((s) => s.update);
  const subject = studentSubject(student);
  const p = useMemo(() => profile(student.id, data, undefined, subject), [student.id, data, subject]);
  const map = useLearning(student.id);
  const roots = useMemo(() => weakRoots(student.id, data, map, 3, subject), [student.id, data, map, subject]);
  const pkey = portraitKey(student.id, subject), saved = data.portraits[pkey];
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const gen = async () => {
    setBusy(true); setErr('');
    try {
      const cfg = await aiConfig();
      const recent = data.lessons.filter((l) => l.studentId === student.id && lessonIn(l, subject)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map((l) => `${l.date} ${l.topic}：${l.summary.slice(0, 150)}`);
      const why = roots.map(rootText);
      const r = online(cfg) ? { ...(await portraitByAi(student.name, student.grade, student.tags, p, recent, why, subject)), via: 'ai' as const } : { text: portraitByRules(student.name, p, why), via: 'rules' as const };
      update((d) => ({ ...d, portraits: { ...d.portraits, [pkey]: { text: r.text, at: nowIso(), via: r.via } } }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="card sd-portrait">
    <div className="card-h"><b>学生画像</b><span className="sub">{subjectName(subject)} · 来自课堂作答记录</span><span className="flex" /><button className="sd-btn" disabled={busy} onClick={() => void gen()}>{busy ? <Loader2 size={13} className="ags-spin" /> : <Sparkles size={13} />}{saved ? '更新画像' : '生成画像'}</button></div>
    <div className="sd-metrics">
      <div><b className="num">{p.attempts}</b><i>作答题数</i></div>
      <div><b className="num">{pct(p.accuracy)}</b><i>总体正确率</i></div>
      <div><b className="num">{pct(p.recentAccuracy)}</b><i>近 30 天</i></div>
      <div><b className="num">{p.open}</b><i>待订正错题</i></div>
    </div>
    <div className="sd-weeks" aria-label="近 6 周正确率">{p.weeks.map((w) => <span key={w.label} title={`${w.label} 起一周：${w.n} 题，正确率 ${pct(w.acc)}`}><i style={{ height: w.acc === null ? 2 : Math.max(4, w.acc * 46) }} className={w.acc === null ? 'none' : w.acc >= 0.8 ? 'hi' : w.acc >= 0.5 ? 'mid' : 'lo'} /><em>{w.label}</em></span>)}</div>
    {(p.weak.length > 0 || p.strong.length > 0) && <div className="sd-pts">
      {p.weak.length > 0 && <div><span>需要加强</span>{p.weak.map((m) => <em key={m.key} className="lo">{pointLabel(m.key).split(' · ').pop()} {pct(m.score)}</em>)}</div>}
      {roots.length > 0 && <div><span>可能的根源</span>{roots.map((r) => <em key={r.key} className="lo root" data-tip={rootText(r)}>{pointLabel(r.key).split(' · ').pop()}</em>)}</div>}
      {p.strong.length > 0 && <div><span>掌握较好</span>{p.strong.map((m) => <em key={m.key} className="hi">{pointLabel(m.key).split(' · ').pop()} {pct(m.score)}</em>)}</div>}
    </div>}
    {saved ? <p className="sd-ptext">{saved.text}<i>{saved.via === 'ai' ? 'AI 画像' : '统计摘要'} · {new Date(saved.at).toLocaleDateString('zh-CN')}</i></p> : !p.attempts && <p className="sd-note">还没有作答记录。上课时在导播台右侧的学生卡上点「对 / 半对 / 错」，这里会自动形成画像。</p>}
    {err && <p className="sd-err">{err}</p>}
    <div className="sd-links">
      <button onClick={() => openStudy('wrong')}><BookX size={13} />错题本{p.open ? ` · ${p.open}` : ''}</button>
      <button onClick={() => openStudy('net')}><GitBranch size={13} />知识网络</button>
      <button onClick={() => openStudy('homework')}><ClipboardList size={13} />组作业</button>
      <button onClick={() => openStudy('lesson')}><NotebookPen size={13} />课后总结{p.lessons ? ` · ${p.lessons}` : ''}</button>
    </div>
  </section>;
}
