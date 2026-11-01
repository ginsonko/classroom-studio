import { useEffect, useState } from 'react';
import { Check, Clock3, ListChecks, Loader2, Minus, Settings2, TriangleAlert, Video, X } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { useStudy } from '../lib/studyStore';
import { isLive, useRecording, type RecordRow } from '../lib/recording';
import { asrApi, useAsr } from '../lib/asr';
import { analyzeRecording, useRecordAnalysis } from '../lib/recordAnalysis';
import { dismissAfter, stepsFor, useAfter, type AfterSettings } from '../lib/afterClass';
import { chipOf, chipRow, chipWorth, type Step } from '../lib/afterClassLogic';
import { summarizeRecord, summaryOn, useAuto } from '../lib/autopilot';
import { aiConfig } from '../lib/studyActions';
import { online } from '../lib/studyAi';
import { toast } from '../lib/toast';
import '../styles/after.css';

const ICON: Record<Step['state'], React.ReactNode> = {
  done: <Check size={12} />, run: <Loader2 size={12} className="spin" />, wait: <Clock3 size={12} />, skip: <Minus size={12} />, off: <Minus size={12} />, error: <TriangleAlert size={12} />,
};
const retryLabel = (s: Step) => s.retry === 'asr' ? (s.state === 'error' ? '重新转写' : '现在转写')
  : s.retry === 'analyze' ? (s.state === 'error' ? '重新分析' : s.key === 'fine' ? '听着原话再分析' : '现在分析')
  : s.state === 'error' ? '重新写' : '现在写';

/**
 * 顶栏的「下课后」胶囊：最近一节课下课后，回放、转写、分析、课后总结、板书走到哪一步。
 * 点开是整条流水线，每一步能单独重跑；任何一步出错不影响已经做完的。
 */
export function AfterClassChip() {
  const rev = useRecording((s) => s.rev), phase = useRecording((s) => s.status.phase);
  useRecording((s) => s.status.jobs);
  useAsr((s) => s.state);
  const busy = useRecordAnalysis((s) => s.busy), busyIds = Object.keys(busy).join(',');
  const after = useAfter(), auto = useAuto((s) => s.settings);
  useStudy((s) => s.data.lessons);
  const students = useStore((s) => s.students), set = useStore((s) => s.set);
  const [rows, setRows] = useState<RecordRow[]>([]), [main, setMain] = useState<AfterSettings | null>(null), [ai, setAi] = useState(false);
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now()), [doing, setDoing] = useState('');
  const asrKey = useAsr((s) => (s.state ? `${s.state.current?.id ?? ''}|${s.state.queue.join(',')}` : ''));
  useEffect(() => {
    if (!host.electron) return;
    let dead = false;
    void Promise.all([host.call<RecordRow[]>('recordings'), host.call<AfterSettings>('settings'), aiConfig()]).then(([r, s, c]) => { if (!dead) { setRows(r); setMain(s); setAi(online(c)); } }).catch(() => {});
    return () => { dead = true; };
  }, [rev, busyIds, asrKey, after.rev, phase, open]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const row = chipRow(rows, now, new Set(after.dismissed));
  const sortId = row?.analysis?.sortId;
  const pending = useStudy((s) => (sortId ? (s.data.sorts ?? []).find((x) => x.id === sortId && !x.undone)?.unsure.length ?? 0 : 0));
  const steps = row && main ? stepsFor(row, { settings: main, summaryOn: summaryOn(auto, main), aiOnline: ai }) : [];
  const chip = chipOf(steps, pending);
  const live = isLive(phase);
  // 上着下一节课时，上一节已经处理完的不占顶栏；还在跑、出错、有待确认的照常显示
  const show = !!row && chipWorth(steps) && (chip.state !== 'done' || (!live && now - (row.endedAt ?? 0) < 90 * 60000));
  const chipId = show ? row!.id : '';
  useEffect(() => { if (useAfter.getState().chip !== chipId) useAfter.setState({ chip: chipId }); }, [chipId]);
  useEffect(() => () => useAfter.setState({ chip: '' }), []);
  if (!show || !row) return null;

  const who = students.find((s) => s.id === row.studentId)?.name ?? '自由课堂';
  const retry = async (s: Step) => {
    setDoing(s.key);
    try {
      if (s.retry === 'asr') { await asrApi.transcribe(row.id); await useAsr.getState().load(); }
      else if (s.retry === 'analyze') { setOpen(false); await analyzeRecording(row.id); }
      else if (s.retry === 'summary') { await summarizeRecord(row.id); toast(`「${who}」的课后总结写好了，到「学情 → 课后总结」确认后再发给家长`, { ms: 10000 }); }
    } catch (e) { toast(`${s.name}没做成：${(e as Error).message}`, { ms: 10000 }); }
    finally { setDoing(''); useAfter.setState((x) => ({ rev: x.rev + 1 })); }
  };
  const tip = chip.state === 'pending' ? `AI 有 ${pending} 道题拿不准，点开去确认` : '下课后：回放、语音转写、AI 学情分析、课后总结、板书走到哪了，点开看每一步';
  return <div className="ac-wrap">
    <button className={'tb-after ' + chip.state} data-qa="after-chip" data-tip={open ? undefined : tip} onClick={() => setOpen(!open)}>
      {chip.state === 'run' ? <Loader2 size={13} className="spin" /> : chip.state === 'error' ? <TriangleAlert size={13} /> : chip.state === 'done' ? <Check size={13} /> : <ListChecks size={13} />}
      <span>{chip.text}</span>
      {chip.pct !== undefined && <b className="num">{chip.pct}%</b>}
    </button>
    {open && <>
      <div className="pop-bg" onPointerDown={() => setOpen(false)} />
      <div className="pop ac-pop" data-qa="after-pop">
        <header><b>下课后 · {row.title || '课堂回放'}</b><small>{who}{row.endedAt ? ' · ' + new Date(row.endedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 下课' : ''}</small></header>
        <ol className="ac-steps">{steps.map((s) => <li key={s.key} className={'ac-s ' + s.state} data-qa={'after-step-' + s.key} data-state={s.state}>
          <i>{ICON[s.state]}</i><b>{s.name}</b>
          <span title={s.text}>{s.text}{s.pct !== undefined ? ` ${s.pct}%` : ''}</span>
          {s.retry && <button disabled={!!doing} data-qa={'after-retry-' + s.key} onClick={() => void retry(s)}>{doing === s.key ? <Loader2 size={11} className="spin" /> : null}{retryLabel(s)}</button>}
        </li>)}</ol>
        <footer>
          <button onClick={() => { set({ page: 'replay' }); setOpen(false); }}><Video size={13} />{pending ? `去确认 ${pending} 道` : '去回放'}</button>
          <button onClick={() => { useRecording.setState({ panel: true }); setOpen(false); }} data-tip="每一步开不开，在「设置 → 下课后」里改"><Settings2 size={13} />设置</button>
          <span className="flex" />
          <button className="ghost" data-qa="after-dismiss" onClick={() => { dismissAfter(row.id); setOpen(false); }}><X size={13} />收起</button>
        </footer>
      </div>
    </>}
  </div>;
}
