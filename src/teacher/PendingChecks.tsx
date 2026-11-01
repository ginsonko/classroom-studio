import { Check, PlayCircle } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { useStudy } from '../lib/studyStore';
import { settleUnsure } from '../lib/sort';
import { levelText, RESULT_NAME, type Result, type SortRecord } from '../lib/studyLogic';
import { MODE_NAME } from '../lib/fineLogic';
import { fmtT } from '../lib/timeline';
import '../styles/sort.css';

/**
 * 待确认：AI 整理里批改没认准的题、课后精析里拿不准的题。
 * 课后精析的那几道带着 AI 的判断和原话证据，点「按 AI 的记」或者自己点对错；onSeek 给了就能跳到录像里那一刻听原话。
 */
export function PendingChecks({ recordId, fallback, onSeek }: { recordId: string; fallback?: SortRecord; onSeek?: (t: number) => void }) {
  const live = useStudy((s) => (s.data.sorts ?? []).find((x) => x.id === recordId)) ?? fallback;
  const qs = useStudy((s) => s.data.questions), students = useStore((s) => s.students);
  if (!live || !live.unsure.length || live.undone) return null;
  const replay = !!live.recordId, many = live.studentIds.length > 1;
  const name = (id: string) => students.find((s) => s.id === id)?.name ?? '';
  const settle = (qid: string, sid: string, r: Result | null) => settleUnsure(live.id, qid, r, sid);
  return <div className="sort-unsure" data-qa="pending-checks">
    <b>{replay ? `这 ${live.unsure.length} 道 AI 拿不准，看一眼再记` : '这几道批改没认准，点一下对错再记'}</b>
    {live.unsure.map((u) => {
      const q = qs.find((x) => x.id === u.questionId);
      if (!q) return null;
      return <div key={u.questionId + u.studentId} className={'sort-uq' + (replay ? ' ai' : '')} data-qa="pending-item">
        <div className="sort-uq-main">
          {q.image ? <img src={host.fileUrl(q.image)} alt="题图" /> : <span className="sort-uq-stem">{q.stem.slice(0, 80)}</span>}
          {u.result && <p className="sort-uq-ai">
            {many && <em>{name(u.studentId)}</em>}
            AI 觉得：<b className={'r-' + u.result}>{RESULT_NAME[u.result]}</b>{typeof u.level === 'number' && <> · {levelText(u.level)}</>}{u.mode && <> · {MODE_NAME[u.mode]}</>}{typeof u.hints === 'number' && u.hints > 0 && <> · 提示了 {u.hints} 次</>}
            {u.why && <small>（{u.why}）</small>}
          </p>}
          {u.misconception && <p className="sort-uq-mis">误区：{u.misconception}</p>}
          {!!u.evidence?.length && <ul className="sort-uq-ev">{u.evidence.map((e, i) => <li key={i} className={'w-' + e.who}>
            {onSeek ? <button className="link-btn num" title="跳到这一刻" onClick={() => onSeek(e.t)}><PlayCircle size={11} />{fmtT(e.t)}</button> : <span className="num">{fmtT(e.t)}</span>}
            <b>{e.who === 'teacher' ? '老师' : e.who === 'student' ? '学生' : ''}</b>{e.text}
          </li>)}</ul>}
        </div>
        <div className="sort-uq-acts">
          {u.result && <button className="sort-uq-ok" data-qa="pending-accept" onClick={() => settle(u.questionId, u.studentId, u.result!)}><Check size={12} />按 AI 的记</button>}
          <button onClick={() => settle(u.questionId, u.studentId, 'right')}>对</button>
          <button onClick={() => settle(u.questionId, u.studentId, 'half')}>半对</button>
          <button onClick={() => settle(u.questionId, u.studentId, 'wrong')}>错</button>
          <button className="ghost" data-qa="pending-skip" onClick={() => settle(u.questionId, u.studentId, null)}>不记</button>
        </div>
      </div>;
    })}
  </div>;
}
