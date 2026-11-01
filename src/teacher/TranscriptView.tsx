import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { host } from '../lib/host';
import { fmtT } from '../lib/timeline';
import { asrApi, lineAt, matchLine, talkBands, WHO_NAME, type Transcript } from '../lib/asr';
import type { RecordItem, RecordRow } from '../lib/recording';
import { useStudy } from '../lib/studyStore';
import { levelText, RESULT_NAME, resultOfLevel, type Result } from '../lib/studyLogic';
import { MODE_NAME, type Mode } from '../lib/fineLogic';
import { analysisAttempt, correctAttempt } from '../lib/recordAnalysis';

const STATE_NAME: Record<RecordItem['state'], string> = { written: '已记作答', pending: '等你确认（在上面）', taught: '老师讲的例题，只算讲过', teacher: '你课上记过，以你为准', skip: '没记' };

/** 进度条上点开的一道题：AI 的判断，记过的可以直接改对错、改几成把握 */
function ItemCard({ x, sortId, close }: { x: RecordItem; sortId: string; close: () => void }) {
  const a = useStudy(() => (x.questionId && x.state === 'written' ? analysisAttempt(sortId, x.questionId) : null));
  const set = (result: Result, level?: number) => { if (a) correctAttempt(a.id, result, level); };
  return <div className="tv-card" data-qa="rp-item-card">
    <div className="tv-card-h"><span className="num">{fmtT(x.t0)}–{fmtT(x.t1)}</span><b>{MODE_NAME[x.mode as Mode] ?? ''}</b><em>{STATE_NAME[x.state]}</em><span className="flex" /><button className="ghost" onClick={close}>收起</button></div>
    {x.stem && <p>{x.stem}</p>}
    {a ? <div className="tv-card-fix">
      <span>记的是：<b className={'r-' + a.result}>{RESULT_NAME[a.result]}</b>{typeof a.level === 'number' && <> · {levelText(a.level)}</>}{a.via === 'teacher' && <small>（你改过）</small>}</span>
      {(['right', 'half', 'wrong'] as const).map((r) => <button key={r} className={a.result === r ? 'on' : ''} onClick={() => set(r)}>{RESULT_NAME[r]}</button>)}
      <select aria-label="几成把握" data-qa="rp-item-level" value={typeof a.level === 'number' ? a.level : ''} onChange={(e) => { const v = Number(e.target.value); set(resultOfLevel(v), v); }}>
        {typeof a.level !== 'number' && <option value="">几成把握</option>}
        {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{levelText(i)}</option>)}
      </select>
    </div> : x.result && x.state !== 'taught' && <p className="sd-note">AI 觉得：{RESULT_NAME[x.result as Result]}{typeof x.level === 'number' ? ' · ' + levelText(x.level) : ''}（{Math.round(x.conf * 10)} 成把握）</p>}
  </div>;
}

/** 回放里的课堂原话：播放器 + 跟着走的字幕 + 学生发言多的地方 + 搜索，点一句跳到那个时刻 */
export function TranscriptView({ r, seek }: { r: RecordRow; seek?: { t: number; n: number } }) {
  const [t, setT] = useState<Transcript | null>(null), [src, setSrc] = useState(''), [err, setErr] = useState('');
  const [now, setNow] = useState(0), [dur, setDur] = useState(0), [q, setQ] = useState(''), [pick, setPick] = useState<number | null>(null);
  const sortId = r.analysis?.sortId ?? '', undone = useStudy((s) => !sortId || !!s.data.sorts?.find((x) => x.id === sortId)?.undone || !s.data.sorts?.some((x) => x.id === sortId));
  const items = useMemo(() => (undone ? [] : (r.analysis?.items ?? []).filter((x) => x.state !== 'skip')), [r.analysis, undone]);
  const video = useRef<HTMLVideoElement>(null), list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    let live = true;
    asrApi.transcript(r.id).then((x) => { if (live) setT(x); }, (e) => live && setErr((e as Error).message));
    if (r.phase === 'complete') host.call<string>('recordMedia', r.id).then((u) => { if (live) setSrc(u); }, () => {});
    return () => { live = false; };
  }, [r.id, r.transcript?.at]);
  const segs = t?.segments ?? [];
  const cur = lineAt(segs, now);
  const go = (sec: number) => { const v = video.current; if (!v) return; v.currentTime = Math.max(0, sec - 0.3); void v.play().catch(() => {}); };
  useEffect(() => { if (seek && src) { const v = video.current; if (!v) return; if (v.readyState >= 1) go(seek.t); else v.addEventListener('loadedmetadata', () => go(seek.t), { once: true }); } }, [seek?.n, src, !!t]); // 播放器要等原话读到才出现
  useEffect(() => { if (q || cur < 0) return; list.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cur, q]);
  const duration = dur || t?.seconds || 0;
  const bands = useMemo(() => talkBands(segs, duration), [segs, duration]);
  const shown = useMemo(() => segs.map((s, i) => ({ s, i })).filter(({ s }) => matchLine(s.text, q)), [segs, q]);
  const counts = useMemo(() => ({ teacher: segs.filter((s) => s.who === 'teacher').length, student: segs.filter((s) => s.who === 'student').length }), [segs]);
  if (err) return <p className="sd-err">{err}</p>;
  if (!t) return <p className="sd-note"><Loader2 size={13} className="ags-spin" /> 正在读取课堂原话…</p>;
  const line = cur >= 0 ? segs[cur] : null;
  return <div className="tv" data-qa="rp-transcript">
    <div className="tv-player">
      {src ? <video ref={video} src={src} controls preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} /> : <div className="tv-novideo">回放 MP4 不在了，只能看文字</div>}
      <div className={'tv-sub' + (line ? ' w-' + line.who : '')} data-qa="rp-subtitle">{line ? <>{WHO_NAME[line.who] && <b>{WHO_NAME[line.who]}</b>}{line.text}</> : <span>　</span>}</div>
      {duration > 0 && t.split === 'channel' && <div className="tv-bands" title="橙色是学生说话比较多的地方，点一下跳过去" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); go((e.clientX - b.left) / b.width * duration); }}>
        {bands.map((b, i) => <i key={i} style={{ left: `${b.from * 100}%`, width: `${Math.max(0.4, (b.to - b.from) * 100)}%` }} />)}
        <em style={{ left: `${Math.min(100, now / duration * 100)}%` }} />
      </div>}
      {duration > 0 && items.length > 0 && <div className="tv-items" data-qa="rp-items" title="AI 判断过的题：绿色记了作答，黄色等你确认，灰色是老师讲的例题；点一下看判断、改对错">
        {items.map((x, i) => <button key={i} className={'tv-item s-' + x.state + (pick === i ? ' on' : '')} style={{ left: `${Math.min(99, x.t0 / duration * 100)}%`, width: `${Math.max(0.8, (x.t1 - x.t0) / duration * 100)}%` }} aria-label={`${fmtT(x.t0)} ${x.stem}`} onClick={() => { setPick(pick === i ? null : i); go(x.t0); }} />)}
      </div>}
      {pick !== null && items[pick] && <ItemCard x={items[pick]} sortId={sortId} close={() => setPick(null)} />}
      <small className="sd-note">{t.split === 'channel' ? `老师 ${counts.teacher} 句 · 学生 ${counts.student} 句` : `共 ${segs.length} 句（这段录像没有分开的声音，分不清谁说的）`}</small>
    </div>
    <div className="tv-side">
      <label className="tv-search"><Search size={13} /><input data-qa="rp-transcript-search" placeholder="搜这节课的原话，例如：相对速度" value={q} onChange={(e) => setQ(e.target.value)} />{q && <span className="sd-note">{shown.length} 句</span>}</label>
      <ol ref={list} className="tv-lines">
        {shown.map(({ s, i }) => <li key={i} data-i={i} className={'w-' + s.who + (i === cur ? ' on' : '')} onClick={() => go(s.t0)}>
          <span className="num">{fmtT(s.t0)}</span>{WHO_NAME[s.who] && <b>{WHO_NAME[s.who]}</b>}<p>{s.text}</p>
        </li>)}
        {!shown.length && <li className="tv-none">{q ? '这节课里没有说过这句话' : '这节课没有识别出说话声'}</li>}
      </ol>
    </div>
  </div>;
}
