import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clapperboard, FolderOpen, HardDrive, Loader2, Play, RotateCcw, Sparkles, Trash2, FolderInput, Undo2, Scissors, MessageSquareText, Search, X } from 'lucide-react';
import { fmtT } from '../lib/timeline';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { fmtBytes, isLive, useRecording, type RecordRow, type RecordsInfo } from '../lib/recording';
import { analyzeRecording, useRecordAnalysis } from '../lib/recordAnalysis';
import { undoSort } from '../lib/sort';
import { useStudy } from '../lib/studyStore';
import { toast } from '../lib/toast';
import { asrApi, useAsr, WHO_NAME, type TranscriptHit } from '../lib/asr';
import { TranscriptView } from './TranscriptView';
import { PendingChecks } from './PendingChecks';
import '../styles/replay.css';

/** 这节课的 AI 分析：进度、结果、待确认、整批撤销 */
function Analysis({ r, busy, reload, onSeek }: { r: RecordRow; busy?: string; reload: () => void; onSeek?: (t: number) => void }) {
  const a = r.analysis, sortId = a?.sortId;
  const undone = useStudy((s) => (sortId ? s.data.sorts?.find((x) => x.id === sortId)?.undone ?? (s.data.sorts?.some((x) => x.id === sortId) ? '' : 'gone') : ''));
  // 老师确认了待确认的题以后作答数会变，按整理记录现算
  const live = useStudy((s) => (sortId ? s.data.sorts?.find((x) => x.id === sortId)?.attempts.length : undefined));
  if (busy !== undefined) return <p className="rp-an busy" data-qa="rp-analysis"><Loader2 size={12} className="ags-spin" />{busy || 'AI 正在分析录像'}</p>;
  if (!a) return null;
  if (a.error) return <p className="rp-an err" data-qa="rp-analysis">AI 分析没做完：{a.error}</p>;
  const bits = [a.questions ? `${a.questions} 道题进收件箱` : '', (live ?? a.attempts) ? `${live ?? a.attempts} 条作答` : '', a.taught ? `老师讲的例题 ${a.taught} 道` : '', a.map ? `学习地图 ${a.map} 处` : ''].filter(Boolean);
  return <div className={'rp-an' + (undone ? ' off' : '')} data-qa="rp-analysis">
    <span><Sparkles size={12} />{a.voice ? `AI 听了 ${a.voice} 句原话、看了 ${a.frames} 张画面` : `AI 看了 ${a.frames} 张画面`}{bits.length ? '：' + bits.join('、') : ''}{undone ? '（已撤销）' : ''}</span>
    {!undone && sortId && <button className="rp-an-undo" data-qa="rp-analysis-undo" onClick={() => { undoSort(sortId); reload(); }}><Undo2 size={12} />撤销</button>}
    {a.summary && <small>{a.summary}</small>}
    {a.fineSkip && a.fineSkip !== '没开课后语音转写' && !undone && <small className="rp-an-skip" data-qa="rp-fine-skip">没听课堂原话：{a.fineSkip}{/还没有|没转|还没转完/.test(a.fineSkip) ? '。转好文字后点「重新分析」，AI 能听着原话逐题判断' : ''}</small>}
    {!undone && sortId && <PendingChecks recordId={sortId} onSeek={onSeek} />}
  </div>;
}

/** 微信分段：切好了几段、正在切、没切成 */
function Parts({ r }: { r: RecordRow }) {
  const parts = r.parts ?? [];
  if (r.splitting) return <p className="rp-parts busy" data-qa="rp-parts"><Loader2 size={12} className="ags-spin" />正在切成微信分段…</p>;
  if (parts.length) return <p className="rp-parts" data-qa="rp-parts"><Scissors size={12} />微信分段 {parts.length} 段，每段约 {Math.round(parts.reduce((a, p) => a + p.seconds, 0) / parts.length / 60)} 分钟<button className="link-btn" onClick={() => host.revealInFolder(parts[0].path)}>打开文件夹</button></p>;
  if (r.splitError) return <p className="rp-parts err" data-qa="rp-parts">微信分段没切成：{r.splitError}</p>;
  return null;
}

/** 课堂原话：正在转、排队、转好了（点开看字幕）、没转成 */
function Voice({ r, open, toggle }: { r: RecordRow; open: boolean; toggle: () => void }) {
  const st = useAsr((s) => s.state), cur = st?.current?.id === r.id ? st.current : null, queued = !!st?.queue.includes(r.id), tm = r.transcript;
  if (cur) return <p className="rp-voice busy" data-qa="rp-voice"><Loader2 size={12} className="ags-spin" />正在把课堂原话转成文字 {Math.round(cur.pct * 100)}%</p>;
  if (queued) return <p className="rp-voice busy" data-qa="rp-voice"><MessageSquareText size={12} />{st?.paused ? '正在上课，下课后再转写课堂原话' : '排队转写课堂原话'}</p>;
  if (tm?.phase === 'done') return <button className="rp-tl-t" data-qa="rp-voice" onClick={toggle}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}课堂原话 · {tm.count ?? 0} 句{tm.counts?.student ? `（学生 ${tm.counts.student} 句）` : ''}</button>;
  if (tm?.phase === 'error') return <p className="rp-voice err" data-qa="rp-voice">课堂原话没转成文字：{tm.error}</p>;
  return null;
}

/** 手动转写：组件没装时提示去下载 */
async function transcribe(id: string) {
  const setup = useAsr.getState().state?.setup;
  if (setup && !setup.installed) {
    if (!setup.supported) { toast('这台电脑的系统暂时不支持本地语音转写'); return; }
    toast(`要先下载语音组件（约 ${setup.mb} MB，只需一次），下好后这节课会自动转写`, { ms: 15000, action: { label: '下载', run: () => { void asrApi.install().then(() => useAsr.getState().load()); } } });
    return;
  }
  await asrApi.transcribe(id);
  await useAsr.getState().load();
}

const minutes = (r: RecordRow) => r.startedAt && r.endedAt ? Math.max(1, Math.round((r.endedAt - r.startedAt) / 60000)) : null;

/** 全部课堂回放：播放、删除（进回收站）、看占用、换保存位置 */
export function ReplayPage() {
  const [rows, setRows] = useState<RecordRow[] | null>(null), [info, setInfo] = useState<RecordsInfo | null>(null);
  const [open, setOpen] = useState(''), [voiceOpen, setVoiceOpen] = useState(''), [seek, setSeek] = useState<{ id: string; t: number; n: number } | null>(null);
  const [q, setQ] = useState(''), [hits, setHits] = useState<TranscriptHit[] | null>(null);
  const asrState = useAsr((s) => s.state);
  const [who, setWho] = useState('all'), [pick, setPick] = useState<Set<string>>(new Set()), [err, setErr] = useState(''), [busy, setBusy] = useState('');
  const students = useStore((s) => s.students);
  const status = useRecording((s) => s.status), rev = useRecording((s) => s.rev);
  const live = isLive(status.phase), jobs = status.jobs ?? [];
  const analyzing = useRecordAnalysis((s) => s.busy), nBusy = Object.keys(analyzing).length;
  const load = () => Promise.all([host.call<RecordRow[]>('recordings'), host.call<RecordsInfo>('recordingsInfo')]).then(([r, i]) => { setRows(r); setInfo(i); }).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [rev, jobs.length, nBusy, asrState?.current?.id, asrState?.queue.length]);
  const search = () => { const text = q.trim(); if (!text) { setHits(null); return; } void asrApi.search(text, who !== 'all' && who !== 'free' ? who : undefined).then(setHits, (e) => setErr((e as Error).message)); };
  const jump = (h: TranscriptHit) => { setVoiceOpen(h.id); setSeek((s) => ({ id: h.id, t: h.t0, n: (s?.n ?? 0) + 1 })); setTimeout(() => document.querySelector(`[data-rid="${h.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); };
  const run = async (key: string, fn: () => Promise<unknown>) => { setErr(''); setBusy(key); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const shown = useMemo(() => (rows ?? []).filter((r) => who === 'all' || (who === 'free' ? !students.some((s) => s.id === r.studentId) : r.studentId === who || (!!r.studentId && !!students.find((g) => g.id === r.studentId)?.members?.includes(who)))), [rows, who, students]);
  const name = (id?: string | null) => students.find((s) => s.id === id)?.name;
  const del = (ids: string[]) => run('del', async () => {
    const list = (rows ?? []).filter((r) => ids.includes(r.id));
    if (!list.length) return;
    const size = list.reduce((a, r) => a + r.bytes, 0);
    if (!confirm(`删除 ${list.length} 段录像（${fmtBytes(size)}）？\n会放进回收站，需要时还能还原。`)) return;
    let ok = 0;
    for (const r of list) { try { await host.call('deleteRecording', r.id); ok++; } catch (e) { setErr((e as Error).message); } }
    setPick(new Set()); await load();
    if (ok) toast(`已把 ${ok} 段录像放进回收站，腾出 ${fmtBytes(size)}`);
  });
  const progress = (r: RecordRow) => jobs.find((j) => j.id === r.id)?.progress ?? r.progress;
  const usedPct = info?.total ? Math.min(1, 1 - (info.free ?? 0) / info.total) : null;

  return <div className="ags rp">
    <header className="ags-head">
      <div className="ags-title"><Clapperboard size={20} /><h2>课堂回放</h2>{rows && <span className="sd-note">{rows.length} 段 · 共 {fmtBytes(info?.used)}</span>}</div>
    </header>
    <div className="rp-body">
      {info && <section className={'rp-disk' + (info.systemDrive ? ' warn' : '')}>
        <HardDrive size={22} />
        <div className="rp-disk-main">
          <b>保存位置</b><code title={info.dir}>{info.dir}</code>
          {usedPct !== null && <div className="rp-bar"><i style={{ width: `${usedPct * 100}%` }} /></div>}
          <small>这个磁盘还剩 {fmtBytes(info.free)}{info.total ? ` / 共 ${fmtBytes(info.total)}` : ''}。{info.systemDrive ? '现在存在系统盘（C 盘），录多了容易把 C 盘占满，建议换到 D 盘等空间大的盘。' : ''}</small>
        </div>
        <div className="rp-disk-acts">
          <button className="sd-btn" disabled={live || jobs.length > 0 || !!busy} title={live || jobs.length ? '录像保存、回放生成完以后再换' : ''} onClick={() => void run('dir', async () => { await host.call('pickRecordings'); await load(); })}><FolderInput size={14} />换保存位置</button>
          <button className="sd-btn" onClick={() => void run('open', () => host.call('recordingsFolder'))}><FolderOpen size={14} />打开文件夹</button>
        </div>
      </section>}
      <div className="rp-tools">
        <select value={who} onChange={(e) => { setWho(e.target.value); setPick(new Set()); }}>
          <option value="all">全部学生</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="free">未绑定学生</option>
        </select>
        <label className="rp-search"><Search size={13} /><input data-qa="rp-search" placeholder="搜课堂原话（回车）" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setHits(null); }} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />{hits && <button className="ico" aria-label="清除搜索" onClick={() => { setQ(''); setHits(null); }}><X size={12} /></button>}</label>
        <span className="flex" />
        {pick.size > 0 && <><span className="sd-note">已选 {pick.size} 段</span><button className="sd-btn danger" disabled={!!busy} onClick={() => void del([...pick])}><Trash2 size={14} />删除所选</button><button className="sd-btn" onClick={() => setPick(new Set())}>取消选择</button></>}
      </div>
      {err && <p className="sd-err">{err}</p>}
      {hits && <section className="rp-hits" data-qa="rp-hits">
        <b>{hits.length ? `找到 ${hits.length}${hits.length >= 200 ? '+' : ''} 句` : '转写过的课里没有这句话'}</b>
        {hits.length > 0 && <ol>{hits.map((h, i) => { const d = new Date(h.createdAt); return <li key={i} className={'w-' + h.who} onClick={() => jump(h)}>
          <span className="num">{d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} {fmtT(h.t0)}</span><em>{name(h.studentId) || '未绑定学生'} · {h.title || '课堂回放'}</em>{WHO_NAME[h.who] && <b>{WHO_NAME[h.who]}</b>}<p>{h.text}</p>
        </li>; })}</ol>}
      </section>}
      {!rows ? <p className="sd-note"><Loader2 size={13} className="ags-spin" /> 正在读取…</p>
        : !shown.length ? <div className="rp-empty"><Clapperboard size={34} /><p>{rows.length ? '这个学生还没有录像。' : '还没有课堂录像。点顶部「开始上课」会自动录下学生画面，下课后在这里回看。'}</p></div>
        : <div className="rp-list">{shown.map((r) => {
          const d = new Date(r.createdAt), m = minutes(r), p = progress(r), stu = name(r.studentId), recording = isLive(r.phase), conv = r.phase === 'converting';
          return <article key={r.id} data-rid={r.id} className={'rp-row' + (pick.has(r.id) ? ' on' : '')}>
            <input type="checkbox" disabled={recording || conv} checked={pick.has(r.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPick(n); }} aria-label="选择这段录像" />
            <div className="rp-date"><b className="num">{d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</b><span className="num">{d.toTimeString().slice(0, 5)}</span></div>
            <div className="rp-main">
              <b>{r.title || '课堂回放'}</b>
              <small>{stu ? <em>{stu}</em> : <em className="free">未绑定学生</em>} · {m ? `${m} 分钟` : '时长待确认'} · {fmtBytes(r.bytes)} · {recording ? '正在录' : conv ? `回放生成中 ${Math.round((p ?? 0) * 100)}%` : r.phase === 'complete' ? 'MP4 已生成' : r.error ? '回放没生成成功，原录像已保留' : '原录像已保留，可生成回放'}</small>
              {conv && <div className="rp-bar sm"><i style={{ width: `${(p ?? 0) * 100}%` }} /></div>}
              {(r.chapters?.length ?? 0) > 0 && <button className="rp-tl-t" data-qa="rp-timeline" onClick={() => setOpen(open === r.id ? '' : r.id)}>{open === r.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}课堂时间线 · {r.chapters!.length} 条</button>}
              {open === r.id && <ol className="rp-tl">{r.chapters!.map((c, i) => <li key={i} className={'k-' + c.kind}><span className="num">{fmtT(c.t)}</span>{c.title}</li>)}</ol>}
              <Analysis r={r} busy={analyzing[r.id]} reload={load} onSeek={r.transcript?.phase === 'done' ? (t) => { setVoiceOpen(r.id); setSeek((s) => ({ id: r.id, t, n: (s?.n ?? 0) + 1 })); } : undefined} />
              <Parts r={r} />
              <Voice r={r} open={voiceOpen === r.id} toggle={() => setVoiceOpen(voiceOpen === r.id ? '' : r.id)} />
              {voiceOpen === r.id && r.transcript?.phase === 'done' && <TranscriptView r={r} seek={seek?.id === r.id ? seek : undefined} />}
            </div>
            <div className="rp-acts">
              {r.phase === 'complete' && <button className="sd-btn" onClick={() => void run(r.id, () => host.call('openRecording', r.id))}><Play size={14} />播放</button>}
              {r.phase === 'complete' && !!stu && analyzing[r.id] === undefined && <button className="sd-btn" data-qa="rp-analyze" title="让 AI 看一遍录像：题目进收件箱、批改记作答、学习地图往前推、课堂小结记进档案" disabled={!!busy} onClick={() => void run(r.id, async () => { await analyzeRecording(r.id); await load(); })}><Sparkles size={14} />{r.analysis && !r.analysis.error ? '重新分析' : 'AI 分析'}</button>}
              {r.phase === 'complete' && !r.splitting && !r.parts?.length && (m === null || m > 59) && <button className="sd-btn" data-qa="rp-split" title="微信发不了超过 1 小时的视频：切成长度相等、每段不到 1 小时的几段，原回放保留" disabled={!!busy} onClick={() => void run(r.id, async () => { const p = host.call('splitRecording', r.id); await new Promise((ok) => setTimeout(ok, 300)); await load(); await p; })}><Scissors size={14} />切成微信分段</button>}
              {r.phase === 'complete' && r.transcript?.phase !== 'done' && r.transcript?.phase !== 'running' && asrState?.current?.id !== r.id && !asrState?.queue.includes(r.id) && <button className="sd-btn" data-qa="rp-transcribe" title="在这台电脑上把这节课说的话转成文字（不联网、不花钱），回放时能看字幕、搜原话" disabled={!!busy} onClick={() => void run(r.id, () => transcribe(r.id))}><MessageSquareText size={14} />{r.transcript?.phase === 'error' ? '重新转写' : '转成文字'}</button>}
              {!recording && !conv && r.phase !== 'complete' && <button className="sd-btn" disabled={!!busy} onClick={() => void run(r.id, async () => { void host.call('recoverRecording', r.id).catch((e) => setErr(e.message)); await new Promise((ok) => setTimeout(ok, 300)); await load(); })}><RotateCcw size={14} />生成回放</button>}
              <button className="sd-btn" onClick={() => host.revealInFolder(r.folder)}><FolderOpen size={14} /></button>
              <button className="sd-btn danger" disabled={recording || conv || !!busy} onClick={() => void del([r.id])} aria-label="删除"><Trash2 size={14} /></button>
            </div>
          </article>;
        })}</div>}
    </div>
  </div>;
}
