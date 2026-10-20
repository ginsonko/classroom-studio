// manim 讲解动画（可选组件）：讲解卡片下面的「做成讲解动画」，以及「讲解动画」卡片的结果区。没装 manim 时只显示一行说明，不打扰。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Clapperboard, Download, FolderOpen, Loader2, RotateCcw, Square } from 'lucide-react';
import type { Explain } from '../physics/sim/aiSchema';
import type { Material } from '../lib/types';
import type { SubjectId } from '../lib/subjects';
import { host } from '../lib/host';
import { fileEntry, prepareMaterial } from '../lib/library';
import { makeManim, manimApi, QUALITY_NAME, rerender, useManim, type ManimQuality, type ManimResult } from '../lib/manim';

const QUALITY: { id: ManimQuality; name: string; tip: string }[] = [
  { id: 'draft', name: '草稿', tip: '480p，最快，先看效果' },
  { id: 'normal', name: '标准', tip: '720p，上课够用' },
  { id: 'hd', name: '高清', tip: '1080p，渲染慢' },
];
export const manimQuality = (): ManimQuality => { const q = localStorage.getItem('cs.manim.q'); return q === 'draft' || q === 'hd' ? q : 'normal'; };

export async function manimMaterial(r: { video: string }, title: string): Promise<Material> {
  const mat = await prepareMaterial(fileEntry(r.video));
  return { ...mat, title: '讲解动画 · ' + title };
}

export function QualityPick({ value, onChange, disabled }: { value: ManimQuality; onChange: (q: ManimQuality) => void; disabled?: boolean }) {
  return <span className="ai-manim-q">{QUALITY.map((q) => <button key={q.id} disabled={disabled} className={value === q.id ? 'on' : ''} onClick={() => { onChange(q.id); localStorage.setItem('cs.manim.q', q.id); }} data-tip={q.tip}>{q.name}</button>)}</span>;
}

export function ManimSteps({ steps, live }: { steps: string[]; live?: boolean }) {
  // 当前这一步已经做了多久：推理模型写脚本要几分钟，老师要看得出没卡死
  const since = useRef({ n: -1, at: 0 }), [, tick] = useState(0);
  if (since.current.n !== steps.length) since.current = { n: steps.length, at: Date.now() };
  useEffect(() => { if (!live) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [live]);
  const sec = Math.floor((Date.now() - since.current.at) / 1000);
  return <div className="ai-prog ai-manim-steps">{steps.map((t, i) => {
    const now = live && i === steps.length - 1, bad = /出错|没通过|有会导致|审片发现|没完成/.test(t);
    const label = now && sec >= 3 ? `${t}（已 ${sec} 秒${/^AI /.test(t) && sec >= 90 ? '，推理模型较慢，最多等 10 分钟' : ''}）` : t;
    return <div key={i} className={now ? 'now' : bad ? 'bad' : 'done'}>{now ? <Loader2 size={11} className="spin" /> : bad ? <span className="ai-x-dot">!</span> : <Check size={11} />}<span>{label}</span></div>;
  })}</div>;
}

/** 渲染好的动画：截帧预览、我先看 / 上屏、看脚本、换画质重渲染（不再花 AI 的钱） */
export function ManimView({ r, title, send }: { r: ManimResult; title: string; send: (m: Material) => ReactNode }) {
  const [cur, setCur] = useState(r), [mat, setMat] = useState<Material | null>(null), [err, setErr] = useState('');
  const [showCode, setShowCode] = useState(false), [big, setBig] = useState(false), [busy, setBusy] = useState<ManimQuality | null>(null);
  useEffect(() => { manimMaterial(cur, title).then(setMat, (e) => setErr((e as Error).message)); }, [cur, title]);
  const again = async (q: ManimQuality) => {
    setBusy(q); setErr('');
    try { const v = await rerender(cur.code, q, title, crypto.randomUUID()); setCur({ ...cur, ...v }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return <div className="ai-manim-res">
    {cur.sheet && <img className={'ai-sheet' + (big ? ' big' : '')} src={cur.sheet} alt="动画截帧" onClick={() => setBig(!big)} data-tip="按时间顺序截的 6 帧，点击放大" />}
    <div className="ai-sub"><span>讲解动画 {Math.round(cur.duration ?? 0)} 秒 · 渲染 {Math.round(cur.ms / 1000)} 秒 · {cur.bytes < 1048576 ? Math.max(1, Math.round(cur.bytes / 1024)) + ' KB' : (cur.bytes / 1048576).toFixed(1) + ' MB'}{cur.tries > 1 ? ` · 第 ${cur.tries} 版脚本` : ''}</span>{mat && send(mat)}</div>
    {cur.review.length > 0 && <div className="ai-warn"><div>审片提到的问题（修改版没渲染成功，这是修改前的版本）：</div>{cur.review.slice(0, 3).map((x, i) => <div key={i}>· {x}</div>)}</div>}
    {err && <div className="ai-warn"><div>{err}</div></div>}
    <div className="ai-manim-row">
      <button onClick={() => setShowCode(!showCode)}><ChevronDown size={12} />{showCode ? '收起脚本' : '查看脚本'}</button>
      <button onClick={() => host.revealInFolder(cur.video)}><FolderOpen size={12} />打开文件夹</button>
      <span className="flex" />
      <span className="ai-manim-note">换画质：</span>
      {(['draft', 'normal', 'hd'] as ManimQuality[]).map((q) => <button key={q} disabled={!!busy} onClick={() => void again(q)} data-tip={`用同一个脚本重新渲染成 ${QUALITY_NAME[q]}，不再调用 AI`}>{busy === q ? <Loader2 size={11} className="spin" /> : null}{q === 'draft' ? '草稿' : q === 'hd' ? '高清' : '标准'}</button>)}
    </div>
    {showCode && <pre className="ai-manim-code">{cur.code}</pre>}
  </div>;
}

/** 没装 manim 时的「一键安装」：进度、取消、失败重试。compact 用在按钮旁边，只显示一行。 */
export function ManimInstall({ compact }: { compact?: boolean }) {
  const status = useManim((s) => s.status), setup = useManim((s) => s.setup), checking = useManim((s) => s.checking);
  const [showLog, setShowLog] = useState(false);
  if (!status || status.ok || !status.installable) return null;
  const run = setup?.phase === 'running', bad = setup?.phase === 'error';
  const min = run && setup?.started ? Math.floor((Date.now() - setup.started) / 60000) : 0;
  if (run && compact) return <span className="ai-manim-inst-go"><Loader2 size={12} className="spin" />安装中 {Math.round(setup!.pct)}%</span>;
  if (run) return <div className="ai-manim-inst run">
    <div className="ai-manim-row"><Loader2 size={12} className="spin" /><span className="ai-manim-inst-step">正在安装 manim：{setup!.step}</span><span className="flex" /><span className="ai-manim-note num">{Math.round(setup!.pct)}%{min ? ` · 已 ${min} 分钟` : ''}</span><button onClick={() => void useManim.getState().cancelInstall()}><Square size={11} />取消</button></div>
    <div className="ai-manim-bar"><i style={{ width: Math.max(2, setup!.pct) + '%' }} /></div>
    <button className="ai-manim-log" onClick={() => setShowLog(!showLog)}><ChevronDown size={12} />安装记录</button>{showLog && <pre>{setup!.lines.join('\n')}</pre>}
  </div>;
  if (compact) return <button className="ai-manim-inst-go" disabled={checking} onClick={() => void useManim.getState().install()} data-tip={status.error}><Download size={12} />一键安装 manim</button>;
  return <div className={'ai-manim-inst' + (bad ? ' bad' : '')}>
    <div className="ai-manim-row">
      <Clapperboard size={12} /><span>{bad ? '安装没成功：' + (setup!.error || setup!.step) : '讲解动画要用 manim（可选组件，约 380 MB，从国内镜像下载，3~5 分钟）'}</span>
      <span className="flex" />
      <button className="ai-manim-inst-btn" disabled={checking} onClick={() => void useManim.getState().install()}><Download size={12} />{bad ? '重试安装' : '一键安装'}</button>
      <button onClick={() => void useManim.getState().check(true)} data-tip="已经自己装好 manim 了？点这里重新检测">重新检测</button>
    </div>
    {bad && setup!.lines.length > 0 && <><button className="ai-manim-log" onClick={() => setShowLog(!showLog)}><ChevronDown size={12} />安装记录</button>{showLog && <pre>{setup!.lines.join('\n')}</pre>}</>}
  </div>;
}

/** 讲解卡片下面的「做成讲解动画」 */
export function ManimBlock({ e, subject, send }: { e: Explain; subject: SubjectId; send: (m: Material) => ReactNode }) {
  const status = useManim((s) => s.status), checking = useManim((s) => s.checking);
  useEffect(() => { void useManim.getState().check(); }, []);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [steps, setSteps] = useState<string[]>([]), [err, setErr] = useState(''), [quality, setQuality] = useState<ManimQuality>(manimQuality);
  const [res, setRes] = useState<ManimResult | null>(null), [showLog, setShowLog] = useState(false);
  const job = useRef(''), signal = useRef({ cancelled: false }), t0 = useRef(0), [sec, setSec] = useState(0);
  useEffect(() => { if (phase !== 'busy') return; const t = setInterval(() => setSec(Math.round((Date.now() - t0.current) / 1000)), 1000); return () => clearInterval(t); }, [phase]);

  const start = async () => {
    job.current = crypto.randomUUID(); signal.current = { cancelled: false }; t0.current = Date.now(); setSec(0);
    setPhase('busy'); setSteps([]); setErr(''); setRes(null);
    try {
      const v = await makeManim(e, subject, { quality, job: job.current, onStep: (t) => setSteps((s) => [...s, t]), signal: signal.current, review: true });
      setRes(v); setPhase('done');
    } catch (x) { setErr((x as Error).message); setPhase(signal.current.cancelled ? 'idle' : 'error'); }
  };
  const cancel = () => { signal.current.cancelled = true; void manimApi.cancel(job.current).catch(() => {}); };

  if (!status || checking) return <div className="ai-manim dim"><Loader2 size={12} className="spin" />正在检测 manim（可选组件）…</div>;
  if (!status.ok && status.installable) return <div className="ai-manim"><ManimInstall /></div>;
  if (!status.ok) return <div className="ai-manim dim" data-tip={status.error}><Clapperboard size={12} /><span>讲解动画需要本机装 manim（可选组件）</span><button onClick={() => void useManim.getState().check(true)}>重新检测</button></div>;

  return <div className={'ai-manim ' + phase}>
    {phase === 'idle' && <div className="ai-manim-row">
      <button className="ai-manim-go" onClick={() => void start()} data-tip={`AI 写 manim 脚本，本机渲染成视频，再看截帧审一遍（manim ${status.version}${status.latex ? '' : '，没有 LaTeX，公式用普通文字'}）`}><Clapperboard size={13} />做成讲解动画</button>
      <QualityPick value={quality} onChange={setQuality} />
      {err && <span className="ai-manim-note">{err}</span>}
    </div>}
    {phase === 'busy' && <>
      <ManimSteps steps={steps} live />
      <div className="ai-manim-row"><span className="ai-manim-note num">已用 {sec} 秒</span><span className="flex" /><button onClick={cancel}><Square size={11} />取消</button></div>
    </>}
    {phase === 'error' && <>
      <ManimSteps steps={steps} />
      <div className="ai-err"><div><p>动画没做成：{err.split('\n')[0]}</p><div className="ai-err-b"><button onClick={() => void start()}>重试</button><button onClick={() => setPhase('idle')}>取消</button></div></div></div>
    </>}
    {phase === 'done' && res && <>
      <button className="ai-manim-log" onClick={() => setShowLog(!showLog)}><ChevronDown size={12} />制作过程（{steps.length} 步）</button>
      {showLog && <ManimSteps steps={steps} />}
      <ManimView r={res} title={e.title || '讲解动画'} send={send} />
      <div className="ai-manim-row"><span className="flex" /><button onClick={() => void start()}><RotateCcw size={12} />让 AI 重新做一版</button></div>
    </>}
  </div>;
}
