import { useEffect, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import { create } from 'zustand';
import { AlertTriangle, Atom, Bot, Box, Camera, Check, ChevronDown, Clapperboard, Eye, History, Inbox, KeyRound, ListOrdered, Loader2, MessageCircle, MonitorUp, PenTool, RotateCcw, Settings2, Shapes, Square, Trash2, Undo2, X } from 'lucide-react';
import { archive } from '../lib/archive';
import { AiHistory } from './AiHistory';
import { ai, DemoError, demoByRules, demoEngine, explainToBoard, makePreset, materialFromObjects, runAction, SAMPLE_PROBLEM, setDemoEngine, type Action, type AiConfig, type AiOut, type DemoEngine, type DemoGuess, type RunMeta } from '../lib/ai';
import { host } from '../lib/host';
import { defaultView, inkKey, useStore } from '../lib/store';
import type { Material, Stroke } from '../lib/types';
import { PRESETS } from '../physics/sim/presets';
import type { Explain } from '../physics/sim/aiSchema';
import { addQuestion } from '../lib/studyStore';
import { guessDifficulty, guessPoints, guessType } from '../lib/studyLogic';
import { byLevel, hasDemo, kitOf, LEVEL_NAME, LEVELS, packOf, studentSubject, type Level, type SubjectId } from '../lib/subjects';
import { demosOf, makeDemo } from '../demos';
import { makeManim, manimApi, useManim, type ManimQuality } from '../lib/manim';
import { MdText, TexText } from './TexText';
import { loadModels, ModelPicker } from '../ui/ModelPicker';
import { importLink, showImport, type ImportSummary } from './ImportDialog';
import { ManimBlock, ManimSteps, ManimView, manimQuality, QualityPick } from './ManimBlock';
import '../styles/sim.css';
import '../styles/ai.css';

interface Card { id: string; action: Action; ask: string; pending?: boolean; error?: string; out?: AiOut; meta?: RunMeta; at: number; overlay?: { key: string; ids: string[] }; steps?: string[]; guess?: DemoGuess; subject?: SubjectId }

const ACTIONS: { id: Action; label: string; sub: string; icon: typeof Bot }[] = [
  { id: 'demo', label: '做成演示', sub: '物理引擎 · 可调参数', icon: Atom },
  { id: 'explain', label: '讲这道题', sub: '分步解析 · 只给你看', icon: ListOrdered },
  { id: 'draw', label: '画到黑板', sub: '矢量板书 · 可再编辑', icon: PenTool },
  { id: 'ask', label: '问一问', sub: '自由提问', icon: MessageCircle },
  { id: 'anim', label: '讲解动画', sub: 'manim 视频 · 讲题 → 写脚本 → 渲染 → 审片', icon: Clapperboard },
];
const LABEL: Record<Action, string> = { demo: '物理演示', explain: '讲题', draw: '板书', ask: '回答', anim: '讲解动画' };
const WAIT: Record<Action, string> = { demo: '正在读题、选模型、校验物理参数…', explain: '正在读题并分步推导…', draw: '正在设计板书布局…', ask: '正在思考…', anim: '正在读题…' };

/** 演示库展开状态：侧栏「演示」按钮直接打开 AI 面板里的演示库 */
export const useAiLib = create<{ open: boolean; focus: number }>(() => ({ open: localStorage.getItem('cs.ai.lib') === '1', focus: 0 }));
useAiLib.subscribe((s) => localStorage.setItem('cs.ai.lib', s.open ? '1' : '0'));

const uid = () => Math.random().toString(36).slice(2, 9);
const tex = (s: string, display = false) => ({ __html: katex.renderToString(s, { throwOnError: false, displayMode: display }) });

const RichText = ({ text }: { text: string }) => <TexText text={text} className="ai-text" />;

function Send3({ mat }: { mat: Material }) {
  return <div className="ai-out-b">
    <button onClick={() => useStore.getState().open(mat)}><Eye size={13} />我先看</button>
    <button onClick={() => useStore.getState().cue(mat, defaultView(mat))}>放预监</button>
    <button className="live" onClick={() => useStore.getState().showNow(mat)}><MonitorUp size={13} />上屏</button>
  </div>;
}

function putStrokes(mat: Material, strokes: Stroke[], page = 0) {
  useStore.getState().editInk(inkKey(mat.id, page), { upsert: strokes }, 'ai');
}

export function AiPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [cfgErr, setCfgErr] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const [cfgGen, setCfgGen] = useState(0);
  const [showHist, setShowHist] = useState(false);
  const [text, setText] = useState('');
  const [useScreen, setUseScreen] = useState(() => localStorage.getItem('cs.ai.screen') !== '0');
  // 「做成演示」的引擎：立体（three.js，全学科，默认）或经典（物理引擎 / 学科演示库）
  const [engine, setEngine] = useState<DemoEngine>(demoEngine);
  const [cards, setCards] = useState<Card[]>([]);
  // 讲解动画要几分钟，渲染时其它 AI 功能照常可用；同一时间只做一个动画
  const busy = cards.some((c) => c.pending && c.action !== 'anim');
  const animBusy = cards.some((c) => c.pending && c.action === 'anim');
  const signals = useRef(new Map<string, { cancelled: boolean; job: string }>());
  const online = !!cfg?.hasKey && !!cfg.model;
  // 学科默认跟着当前学生，老师可以临时切换（物理课上用数学工具）；换学生时回到学生的学科
  const studentSubj = useStore((s) => studentSubject(s.students.find((x) => x.id === s.studentId)));
  const [subject, setSubject] = useState<SubjectId>(studentSubj);
  const [libSubject, setLibSubject] = useState<SubjectId>(studentSubj);
  useEffect(() => { setSubject(studentSubj); setLibSubject(studentSubj); }, [studentSubj]);
  // 物理：物理引擎 + 物理模板库；数学 / 化学：从演示库里挑（kit）
  const demos = packOf(subject).demos, canDemo = hasDemo(subject);
  const [animQ, setAnimQ] = useState<ManimQuality>(manimQuality);
  const manimSt = useManim((s) => s.status), manimChecking = useManim((s) => s.checking);
  useEffect(() => { if (host.electron) void useManim.getState().check(); }, []);

  useEffect(() => {
    if (!host.electron) { setCfgErr('浏览器预览版不能调用模型，只能用规则识别'); return; }
    ai.config().then((c) => { setCfg(c); if (!c.hasKey) setShowCfg(true); }).catch((e) => setCfgErr(String(e?.message ?? e)));
    // 一键导入写入了新配置：重新读，设置表单也重新挂载以显示新地址和模型
    const reload = () => { void ai.config().then((c) => { setCfg(c); setCfgGen((g) => g + 1); }); };
    addEventListener('cs-ai-config', reload);
    return () => removeEventListener('cs-ai-config', reload);
  }, []);
  useEffect(() => { localStorage.setItem('cs.ai.screen', useScreen ? '1' : '0'); }, [useScreen]);

  const patch = (id: string, p: Partial<Card>) => setCards((all) => all.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const run = async (action: Action, ask = text, opts: { screen?: boolean; engine?: DemoEngine } = {}) => {
    const id = uid();
    const screen = (opts.screen ?? useScreen) && online && host.electron;
    setCards((all) => [{ id, action, ask: ask.trim(), pending: true, at: Date.now(), subject }, ...all].slice(0, 30));
    try {
      const image = screen ? await ai.screen() : undefined;
      const history = cards.filter((c) => c.action === 'ask' && c.out?.kind === 'ask').slice(0, 4).reverse()
        .flatMap((c) => [{ role: 'user' as const, content: c.ask || '（看学生画面）' }, { role: 'assistant' as const, content: (c.out as { text: string }).text }]);
      if (image) patch(id, { meta: { image } });
      const steps: string[] = [];
      const onStep = (t: string) => { steps.push(t); patch(id, { steps: [...steps] }); };
      if (action === 'anim') {
        if (cards.some((c) => c.pending && c.action === 'anim')) throw new Error('上一个动画还在做，做完再点。');
        if (!online) throw new Error('讲解动画需要先在「设置」里填写 API Key 和模型。');
        const sig = { cancelled: false, job: crypto.randomUUID() }; signals.current.set(id, sig);
        onStep('AI 正在读题，先把题讲清楚…');
        const ex = await runAction('explain', ask, { cfg, image, subject });
        if (ex.out.kind !== 'explain') throw new Error('讲题没有成功');
        const e = ex.out.data;
        if (sig.cancelled) throw new Error('已取消');
        patch(id, { meta: ex.meta });
        onStep(`讲解好了：${e.title}（${e.steps.length} 步）`);
        const video = await makeManim(e, subject, { quality: animQ, job: sig.job, onStep, signal: sig, review: true });
        const out: AiOut = { kind: 'anim', data: e, video };
        patch(id, { pending: false, out, meta: ex.meta });
        archive.save({ id: id + uid(), action, ask: ask.trim(), at: Date.now(), out, meta: { ...ex.meta, image }, subject });
        return;
      }
      const { out, meta } = await runAction(action, ask, { cfg: online ? cfg : null, image, history, onStep, subject, engine: opts.engine ?? engine });
      if (out.kind === 'draw') putStrokes(out.mat, out.strokes);
      patch(id, { pending: false, out, meta });
      archive.save({ id: id + uid(), action, ask: ask.trim(), at: Date.now(), out, meta, subject });
    } catch (e) {
      patch(id, { pending: false, error: e instanceof Error ? e.message : String(e), ...(e instanceof DemoError ? { guess: e.guess, steps: e.steps } : {}) });
    } finally { signals.current.delete(id); }
  };
  const cancelAnim = (id: string) => {
    const s = signals.current.get(id);
    if (s) { s.cancelled = true; void manimApi.cancel(s.job).catch(() => {}); }
    patch(id, { pending: false, error: '已取消' });
  };

  const overlay = (c: Card, strokes: Stroke[]) => {
    const st = useStore.getState(), key = inkKey(st.pgmMat.id, st.pgm.page);
    const copy = strokes.map((s) => ({ ...s, id: uid() + uid() }));
    st.editInk(key, { upsert: copy }, 'ai');
    patch(c.id, { overlay: { key, ids: copy.map((s) => s.id) } });
  };
  const unOverlay = (c: Card) => {
    if (!c.overlay) return;
    useStore.getState().editInk(c.overlay.key, { remove: c.overlay.ids }, 'ai');
    patch(c.id, { overlay: undefined });
  };

  return (
    <div className="ai">
      <div className="ai-h">
        <span className="ai-orb"><Bot size={14} /></span>
        <b>AI 助手</b>
        <button className={'ai-model' + (online ? ' on' : '')} onClick={() => setShowCfg(!showCfg)} data-tip={online ? '已连接模型 · 点击修改设置' : '还没配置模型：只有「做成演示」可以用规则识别'}>
          {online ? cfg!.model : '规则识别 · 未连接模型'}
        </button>
        {host.electron && <button className={'ai-ico' + (showHist ? ' on' : '')} onClick={() => setShowHist(!showHist)} aria-label="历史记录" data-tip="历史记录：以前的讲题、演示、板书、回答都在这里"><History size={15} /></button>}
        <button className="ai-ico" onClick={() => setShowCfg(!showCfg)} aria-label="AI 设置" data-tip="AI 设置"><Settings2 size={15} /></button>
        <button className="ai-ico" onClick={onClose} aria-label="关闭"><X size={15} /></button>
      </div>

      <div className="ai-scroll">
        {showHist ? <AiHistory onBack={() => setShowHist(false)} onRestore={(c) => { setCards((all) => [{ id: uid(), action: c.action, ask: c.ask, at: c.at, out: c.out, meta: c.meta, subject: c.subject }, ...all.filter((x) => !(x.at === c.at && x.ask === c.ask))].slice(0, 30)); setShowHist(false); }} /> : <>
        {showCfg && <Settings key={cfgGen} cfg={cfg} err={cfgErr} onSaved={(c) => { setCfg(c); if (c.hasKey && c.model) setShowCfg(false); }} />}

        <div className="ai-compose">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy && (online || canDemo)) { e.preventDefault(); void run(online ? 'ask' : 'demo'); } }}
            placeholder={online ? '粘贴题目，或说说你要什么。留空就让 AI 直接看学生画面。' : demos ? '粘贴题目原文（带数据和单位），点「做成演示」用规则识别生成。' : canDemo ? '粘贴题目，点「做成演示」按关键词挑一个' + packOf(subject).name + '演示；配置模型后 AI 能读题、讲题、填参数。' : '在「设置」里配置模型后，AI 能读题、讲题、画板书、回答问题。'}
            rows={3}
          />
          <div className="ai-compose-bar">
            <button className={'ai-chip' + (useScreen && online ? ' on' : '')} disabled={!online} onClick={() => setUseScreen(!useScreen)} data-tip={online ? '把学生窗口当前画面作为图片发给模型（学生看不到这个操作）' : '需要先配置模型'}>
              <Camera size={12} />读学生画面
            </button>
            {!online && demos && <button className="ai-chip" onClick={() => setText(SAMPLE_PROBLEM)}>填入示例题</button>}
            <button className={'ai-chip' + (engine === 's3d' ? ' on' : '')} onClick={() => { const e: DemoEngine = engine === 's3d' ? 'classic' : 's3d'; setDemoEngine(e); setEngine(e); }} data-tip="「做成演示」用的引擎。立体：three.js 三维动画，全学科通用，默认；经典：物理引擎（物理课）/ 学科演示库（数学、化学）。没配模型时都用规则识别。">
              <Box size={12} />{engine === 's3d' ? '立体演示' : '经典演示'}
            </button>
            <span className="flex" />
            {text && <button className="ai-chip" onClick={() => setText('')}>清空</button>}
          </div>
          <SubjectPick value={subject} student={studentSubj} onChange={(id) => { setSubject(id); setLibSubject(id); }} />
          <div className="ai-acts">
            {ACTIONS.filter((a) => (a.id !== 'anim' || host.electron) && (a.id !== 'demo' || canDemo)).map((a) => (a.id === 'demo' && !demos ? { ...a, sub: packOf(subject).name + '演示 · 可调参数' } : a)).map((a) => {
              if (a.id === 'anim') {
                const noManim = !manimSt || manimChecking || !manimSt.ok;
                const tip = !online ? '需要先在设置里配置模型' : manimChecking || !manimSt ? '正在检测 manim…' : !manimSt.ok ? '本机没检测到 manim（可选组件）：' + (manimSt.error ?? '') : animBusy ? '上一个动画还在做，做完再点' : 'AI 先讲题，再写 manim 脚本、渲染成视频并看截帧审一遍，一般 3～8 分钟。做动画时其它功能照常用';
                return <div key={a.id} className="ai-act-wrap">
                  <button className="ai-act a-anim" disabled={!online || animBusy || noManim} onClick={() => void run('anim')} data-tip={tip}>
                    <a.icon size={16} /><b>{a.label}</b><span>{!online || !manimSt?.ok ? a.sub : `manim ${manimSt.version} · 讲题 → 写脚本 → 渲染 → 审片`}</span>
                  </button>
                  <QualityPick value={animQ} onChange={setAnimQ} />
                </div>;
              }
              const dis = busy || (!online && a.id !== 'demo');
              const tip = !online && a.id !== 'demo' ? '需要先在设置里配置模型' : undefined;
              return (
                <button key={a.id} className={'ai-act a-' + a.id} disabled={dis} onClick={() => void run(a.id)} data-tip={tip}>
                  <a.icon size={16} /><b>{a.label}</b><span>{a.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        <DemoLibrary subject={libSubject} setSubject={setLibSubject} onError={(msg) => setCards((all) => [{ id: uid(), action: 'demo', ask: '用学生当前页的器材做演示', error: msg, at: Date.now() }, ...all])} />

        <div className="ai-feed">
          {cards.length === 0 && (
            <div className="ai-empty">
              <p><b>生成的内容先只给你看</b>，确认后再点「上屏」，学生才看得到。</p>
              <p>{online ? '打开「读学生画面」后，可以什么都不输入，直接让 AI 读当前题目。' : '配置模型后，AI 可以直接读学生画面里的题目、分步讲解、画受力图。'}</p>
              {host.electron && <p>每次的结果都会自动存档，右上角 <History size={11} /> 可以找回以前的内容。</p>}
            </div>
          )}
          {cards.map((c) => <ResultCard key={c.id} c={c} onCancel={() => cancelAnim(c.id)} onRetry={() => void run(c.action, c.ask)} onClassic={() => void run('demo', c.ask, { engine: 'classic', screen: !!c.meta?.image })} onDemo={(p) => void run('demo', p, { screen: false })} onOverlay={overlay} onUnOverlay={unOverlay} onRemove={() => setCards((all) => all.filter((x) => x.id !== c.id))} onAlt={(preset) => {
            const src = c.out?.kind === 'demo' ? c.out.src : c.guess?.src;
            const r = src ? demoByRules(src, preset) : null;
            if (r) setCards((all) => [{ id: uid(), action: 'demo', ask: c.ask, out: r, at: Date.now() }, ...all]);
          }} />)}
        </div>
        </>}
      </div>
    </div>
  );
}

/**
 * 学科选择：先选学段再选学科（全学段 20 多个学科，一排放不下）。
 * 学段标签只切换下面显示哪些学科，不改当前学科；当前学科所在学段带一个点。
 */
function SubjectPick({ value, student, onChange }: { value: SubjectId; student: SubjectId; onChange: (id: SubjectId) => void }) {
  const cur = packOf(value);
  const [level, setLevel] = useState<Level>(cur.level);
  useEffect(() => setLevel(packOf(value).level), [value]);
  return (
    <div className="ai-subj" role="radiogroup" aria-label="学科">
      <span className="ai-subj-lv">
        {LEVELS.map((l) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{LEVEL_NAME[l]}{cur.level === l && level !== l && <em />}</button>)}
      </span>
      {byLevel(level).map((p) => <button key={p.id} role="radio" aria-checked={value === p.id} className={'f-' + p.family + (value === p.id ? ' on' : '')} onClick={() => onChange(p.id)} data-tip={`讲题、板书、演示、讲解动画都按${p.stage}来做`}>{p.name}</button>)}
      {value !== student && <i>临时切换 · 学生是{packOf(student).stage}</i>}
    </div>
  );
}

const LIB: { id: SubjectId; name: string }[] = [{ id: 'physics', name: '物理' }, { id: 'math', name: '数学' }, { id: 'chem', name: '化学' }];
/** 演示库：物理引擎 + 数学 / 化学演示目录，用标签切换（物理课上也能直接拿数学工具；初中、小学数学共用数学目录） */
function DemoLibrary({ subject: s0, setSubject, onError }: { subject: SubjectId; setSubject: (s: SubjectId) => void; onError: (msg: string) => void }) {
  const open = useAiLib((s) => s.open), focus = useAiLib((s) => s.focus), setOpen = (v: boolean) => useAiLib.setState({ open: v });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [focus]);
  const subject: SubjectId = packOf(s0).demos ? 'physics' : kitOf(s0) ?? 'math';
  const count = (id: SubjectId) => (packOf(id).demos ? PRESETS.length : demosOf(id).length);
  const tip = '在中间的教师预览里打开，调好参数再上屏';
  return <div ref={ref} className={'ai-lib' + (open ? ' open' : '')}>
    <button className="ai-lib-h" onClick={() => setOpen(!open)}><Shapes size={13} /><b>演示库</b><i>{LIB.map((p) => `${p.name} ${count(p.id)}`).join(' · ')} · 不用模型</i><ChevronDown size={14} /></button>
    {open && <>
      <div className="ai-lib-tabs">{LIB.map((p) => <button key={p.id} className={'f-' + p.id + (subject === p.id ? ' on' : '')} onClick={() => setSubject(p.id)}>{p.name}<em>{count(p.id)}</em></button>)}</div>
      {packOf(subject).demos ? <>
        <div className="ai-lib-grid">{PRESETS.map((p) => <button key={p.id} onClick={() => useStore.getState().open(makePreset(p.id))} data-tip={tip}><strong>{p.title}</strong><span>{p.summary}</span></button>)}</div>
        <button className="ai-lib-obj" onClick={() => {
          const st = useStore.getState();
          try { st.open(materialFromObjects(st.ink[inkKey(st.pgmMat.id, st.pgm.page)] ?? [])); }
          catch (e) { onError(e instanceof Error ? e.message : String(e)); }
        }}><Shapes size={13} />用学生当前页摆好的器材做演示</button>
      </> : <div className="ai-lib-grid">{demosOf(subject).map((d) => <button key={d.id} onClick={() => useStore.getState().open(makeDemo(d.id))} data-tip={tip}><strong>{d.title}</strong><span>{d.summary}</span></button>)}</div>}
    </>}
  </div>;
}

/** 讲过的题存进学情收件箱（题干、答案、解析一起带过去，截图有的话也存） */
function SaveToBank({ e, image }: { e: Explain; image?: string }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'done'>('idle'), [err, setErr] = useState('');
  const subject = useStore((s) => studentSubject(s.students.find((x) => x.id === s.studentId)));
  const save = async () => {
    setSt('busy'); setErr('');
    try {
      const img = image ? await host.call<string>('study.image', image) : undefined, stem = e.problem || '';
      addQuestion({ stem, image: img, answer: e.answer, analysis: [e.idea, ...e.steps.map((x) => x.t + '：' + (x.plain || x.tex))].filter(Boolean).join('\n'), points: guessPoints(stem + e.title, subject), difficulty: guessDifficulty(stem), qtype: guessType(stem, subject), origin: 'explain', status: 'inbox', source: 'AI 讲题', subject });
      setSt('done');
    } catch (x) { setErr((x as Error).message); setSt('idle'); }
  };
  return <button disabled={st !== 'idle' || !host.electron} onClick={() => void save()} data-tip={err || '收进学情收件箱，整理后入库'}><Inbox size={13} />{st === 'done' ? '已存入收件箱' : st === 'busy' ? '正在保存…' : '存入题库'}</button>;
}

function StepLog({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  return <div className={'ai-log' + (open ? ' open' : '')}>
    <button onClick={() => setOpen(!open)}><ChevronDown size={12} />AI 的过程（{steps.length} 步）</button>
    {open && <ol>{steps.map((t, i) => <li key={i}>{t}</li>)}</ol>}
  </div>;
}

function ResultCard({ c, onRetry, onClassic, onDemo, onOverlay, onUnOverlay, onRemove, onAlt, onCancel }: {
  c: Card; onRetry: () => void; onClassic: () => void; onDemo: (problem: string) => void; onOverlay: (c: Card, s: Stroke[]) => void; onUnOverlay: (c: Card) => void; onRemove: () => void; onAlt: (preset: string) => void; onCancel: () => void;
}) {
  const A = ACTIONS.find((a) => a.id === c.action)!;
  const [board, setBoard] = useState<Material | null>(null);
  const [zoom, setZoom] = useState(false);
  const [bigSheet, setBigSheet] = useState(false);
  const [showLog, setShowLog] = useState(false), [showEx, setShowEx] = useState(false);
  const [, tick] = useState(0);
  const animLive = c.action === 'anim' && !!c.pending;
  useEffect(() => { if (!animLive) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [animLive]);
  let body: ReactNode = null;
  const steps = c.steps ?? (c.out?.kind === 'demo' ? c.out.steps : undefined) ?? [];
  if (animLive) body = <div className="ai-manim busy">
    <ManimSteps steps={steps} live />
    <div className="ai-manim-row"><span className="ai-manim-note num">已用 {Math.round((Date.now() - c.at) / 1000)} 秒 · 其它 AI 功能可以照常用</span><span className="flex" /><button onClick={onCancel}><Square size={11} />取消</button></div>
  </div>;
  else if (c.action === 'anim' && c.error) body = <div className="ai-manim error">
    {steps.length > 0 && <ManimSteps steps={steps} />}
    <div className="ai-err"><AlertTriangle size={14} /><div><p>动画没做成：{c.error.split('\n')[0]}</p>{c.error.includes('\n') && <pre>{c.error.split('\n').slice(1).join('\n').trim()}</pre>}<div className="ai-err-b"><button onClick={onRetry}>重试</button></div></div></div>
  </div>;
  else if (c.out?.kind === 'anim') {
    const { data: e, video } = c.out;
    body = <>
      <div className="ai-out-t">{e.title}</div>
      {e.answer && <div className="ai-answer"><b>答案</b><RichText text={e.answer} /></div>}
      <ManimView r={video} title={e.title || '讲解动画'} send={(m) => <Send3 mat={m} />} />
      <div className="ai-manim-row">
        <button className="ai-manim-log" onClick={() => setShowLog(!showLog)}><ChevronDown size={12} />制作过程（{steps.length} 步）</button>
        <button className="ai-manim-log" onClick={() => setShowEx(!showEx)}><ChevronDown size={12} />讲题步骤（{e.steps.length} 步）</button>
        <span className="flex" />
        <button onClick={onRetry} data-tip="重新讲题、写脚本、渲染"><RotateCcw size={12} />让 AI 重新做一版</button>
      </div>
      {showLog && <ManimSteps steps={steps} />}
      {showEx && <ol className="ai-steps">{e.steps.map((s, i) => <li key={i}><span>{s.t}</span><b dangerouslySetInnerHTML={tex(s.tex || s.plain)} /></li>)}</ol>}
    </>;
  } else if (c.pending) body = steps.length
    ? <div className="ai-prog">{steps.slice(-5).map((t, i, a) => <div key={steps.length - a.length + i} className={i === a.length - 1 ? 'now' : 'done'}>{i === a.length - 1 ? <Loader2 size={11} className="spin" /> : <Check size={11} />}<span>{t}</span></div>)}</div>
    : <div className="ai-think"><i /><i /><i /><span>{c.action === 'demo' && c.subject && !packOf(c.subject).demos ? '正在读题、挑选演示、填写参数…' : WAIT[c.action]}</span></div>;
  else if (c.error) body = <>
    <div className="ai-err"><AlertTriangle size={14} /><div><p>{c.error}</p><div className="ai-err-b"><button onClick={onRetry}>重试</button>
      {c.guess && <button onClick={() => onAlt(c.guess!.preset)} data-tip="规则识别只看关键词，请核对是不是这道题">用规则模板「{c.guess.title}」试试</button>}</div></div></div>
    {steps.length > 0 && <StepLog steps={steps} />}
  </>;
  else if (c.out?.kind === 'demo') {
    const o = c.out;
    body = <>
      <div className="ai-out-t">{o.mat.title.replace(/^AI 演示 · /, '')}{o.mat.s3d && <span className="ai-ok">立体</span>}{o.via === 'model' && (o.checked ? <span className="ai-ok">已试播核对</span> : <span className="ai-unk">请预览核对</span>)}</div>
      {o.preview && <img className={'ai-sheet' + (bigSheet ? ' big' : '')} src={o.preview} alt="试播的四个时刻" onClick={() => setBigSheet(!bigSheet)} data-tip="AI 试播时的四个时刻，点击放大" />}
      <TexText text={o.note} className="ai-note" />
      {o.issues.length > 0 && <div className="ai-warn">{o.issues.slice(0, 4).map((x, i) => <div key={i}>{x}</div>)}</div>}
      {steps.length > 0 && <StepLog steps={steps} />}
      <div className="ai-foot-note">{o.mat.s3d ? 'AI 写好三维规格后，导播台真的渲染了一遍，并让 AI 对照题目检查过。' : o.kit ? (o.via === 'rules' ? '按关键词挑的演示。' : 'AI 选的演示和参数，请在预览里看一眼。') : o.via === 'rules' ? '规则识别（关键词 + 单位换算），请核对参数。' : 'AI 搭好后导播台真的运行了一遍，并让 AI 对照题目检查过。'}所有参数都能在预览里继续调。</div>
      <Send3 mat={o.mat} />
      {o.mat.s3d && <div className="ai-out-b"><button onClick={onClassic} data-tip="同一道题改用经典引擎（物理引擎 / 学科演示库）重新做"><RotateCcw size={13} />换经典演示</button></div>}
      {o.rec && o.rec.alternatives.length > 0 && <div className="ai-alt"><span>不是这个题型？</span>{o.rec.alternatives.map((a) => <button key={a.preset} onClick={() => onAlt(a.preset)}>换成「{a.title}」</button>)}</div>}
    </>;
  } else if (c.out?.kind === 'explain') {
    const e = c.out.data;
    body = <>
      <div className="ai-out-t">{e.title}</div>
      {e.idea && <div className="ai-idea"><b>突破口</b>{e.idea}</div>}
      <ol className="ai-steps">{e.steps.map((s, i) => <li key={i}><span>{s.t}</span><b dangerouslySetInnerHTML={tex(s.tex || s.plain)} /></li>)}</ol>
      {e.answer && <div className="ai-answer"><b>答案</b><RichText text={e.answer} /></div>}
      {e.pitfalls.length > 0 && <div className="ai-pit"><b>易错</b>{e.pitfalls.map((p, i) => <TexText key={i} text={'· ' + p} />)}</div>}
      <div className="ai-out-b">
        <button onClick={() => void explainToBoard(e).then((b) => { b.pages.forEach((p, i) => putStrokes(b.mat, p, i)); setBoard(b.mat); useStore.getState().open(b.mat); })}><PenTool size={13} />写成板书</button>
        {e.problem && <button onClick={() => onDemo(e.problem)}><Atom size={13} />做成演示</button>}
        <SaveToBank e={e} image={c.meta?.image} />
      </div>
      {board && <div className="ai-sub"><span>板书已生成{board.total > 1 ? `（共 ${board.total} 页）` : ''}，可以先看再上屏：</span><Send3 mat={board} /></div>}
      {host.electron && <ManimBlock e={e} subject={c.subject ?? 'physics'} send={(m) => <Send3 mat={m} />} />}
    </>;
  } else if (c.out?.kind === 'draw') {
    const o = c.out;
    body = <>
      <div className="ai-out-t">{o.mat.title.replace(/^AI 板书 · /, '')}</div>
      <div className="ai-note">{o.strokes.length} 个可编辑图元：箭头、文字、函数图像都能用选择工具拖动和修改。</div>
      {o.issues.length > 0 && <div className="ai-warn">{o.issues.slice(0, 3).map((x, i) => <div key={i}>{x}</div>)}</div>}
      <Send3 mat={o.mat} />
      <div className="ai-out-b">
        {!c.overlay ? <button onClick={() => onOverlay(c, o.strokes)} data-tip="直接画在学生正在看的这一页上（学生立即可见）"><PenTool size={13} />叠加到学生当前页</button>
          : <button onClick={() => onUnOverlay(c)}><Undo2 size={13} />撤掉叠加的笔迹</button>}
      </div>
    </>;
  } else if (c.out?.kind === 'ask') body = <MdText text={c.out.text} className="ai-text" />;

  return (
    <div className={'ai-card k-' + c.action + (c.pending ? ' pending' : '') + (c.error ? ' failed' : '')}>
      <div className="ai-card-h">
        <span className="ai-card-k"><A.icon size={12} />{c.action === 'demo' && c.out?.kind === 'demo' && c.out.mat.s3d ? '立体演示' : c.action === 'demo' && c.subject && !packOf(c.subject).demos ? packOf(c.subject).name + '演示' : LABEL[c.action]}</span>
        {c.meta?.model && <span className="ai-card-m">{c.meta.model} · {((c.meta.ms ?? 0) / 1000).toFixed(1)} s</span>}
        {c.pending && <Loader2 size={12} className="spin" />}
        <span className="flex" />
        {!c.pending && <button className="ai-x" onClick={onRemove} aria-label="移除"><Trash2 size={12} /></button>}
      </div>
      {(c.ask || c.meta?.image) && <div className="ai-q">
        {c.meta?.image && <img src={c.meta.image} alt="AI 看到的学生画面" onClick={() => setZoom(!zoom)} className={zoom ? 'big' : ''} />}
        {c.ask ? <span>{c.ask.length > 120 ? c.ask.slice(0, 120) + '…' : c.ask}</span> : <span className="dim">读取学生画面</span>}
      </div>}
      {body}
    </div>
  );
}

/** 一键导入入口：银子 API 的密钥窗口点「一键导入到软件」会自动弹出确认框；浏览器拦了链接时，把链接粘贴到这里也一样 */
function QuickImport() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<ImportSummary | null>, clear = false) => {
    setMsg('');
    try { showImport(await fn()); if (clear) setText(''); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const go = () => run(() => importLink.parse(text), true);
  return (
    <div className="ai-imp">
      <b>一键导入</b>
      <span>在 <a onClick={() => void host.call('ai.openSite')}>银子 API</a> 新建或查看密钥时点「一键导入到软件」，选「最强网课教辅系统」，这里会自动弹出确认。没反应时，在网站上复制导入码或下载导入文件：</span>
      <div className="ai-imp-row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) void go(); }} placeholder="粘贴导入码 YZIMPORT1:… 或 sk-…" spellCheck={false} autoComplete="off" />
        <button disabled={!text.trim()} onClick={() => void go()}>导入</button>
      </div>
      <div className="ai-imp-alt">
        <button onClick={() => void run(importLink.clipboard)}>从剪贴板导入</button>
        <button onClick={() => void run(importLink.file)}>打开导入文件</button>
      </div>
      {msg && <div className="ai-cfg-msg bad">{msg}</div>}
    </div>
  );
}

function Settings({ cfg, err, onSaved }: { cfg: AiConfig | null; err: string; onSaved: (c: AiConfig) => void }) {
  const [base, setBase] = useState(cfg?.baseUrl ?? '');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(cfg?.model ?? '');
  const [vision, setVision] = useState(cfg?.visionModel ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(err ? { ok: false, t: err } : null);
  const [busy, setBusy] = useState('');
  const [listKey, setListKey] = useState(0);
  const first = useRef(true);
  useEffect(() => { if (cfg && first.current) { first.current = false; setBase(cfg.baseUrl); setModel(cfg.model); setVision(cfg.visionModel ?? ''); } }, [cfg]);

  const save = async (patch: Partial<{ model: string; visionModel: string }> = {}) => {
    const c = await ai.save({ baseUrl: base, model, visionModel: vision, ...patch, ...(key ? { key } : {}) });
    if (key) { setKey(''); setListKey((k) => k + 1); void loadModels(true); }
    onSaved(c); return c;
  };
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }); } finally { setBusy(''); }
  };
  if (!host.electron) return <div className="ai-cfg"><div className="ai-cfg-msg bad">{err || '浏览器预览版不能调用模型'}</div></div>;
  return (
    <div className="ai-cfg">
      <div className="ai-cfg-h"><KeyRound size={13} /><b>连接模型</b><span>兼容 OpenAI 接口的服务都可以</span></div>
      <QuickImport />
      
      <label>接口地址<input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.yinziapi.top/v1" spellCheck={false} /></label>
      <label>API Key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg?.hasKey ? `已保存（尾号 ${cfg.keyHint}），留空不修改` : 'sk-…'} autoComplete="off" spellCheck={false} /></label>
      <label>模型<div className="ai-cfg-row" key={listKey}>
        <ModelPicker value={model} placeholder="选一个模型（需要支持看图）" title="自动读取这个 Key 能用的模型；可以搜索、收藏，也能直接输入模型名"
          onChange={(m) => { setModel(m); void act('save', async () => { await save({ model: m }); setMsg({ ok: true, t: m ? `已切换到 ${m}` : '已清空模型' }); }); }} />
      </div></label>
      <label>看图模型 <i className="ai-cfg-opt">可选：读学生画面时改用它，留空用上面的模型</i><div className="ai-cfg-row">
        <ModelPicker value={vision} placeholder="同上" onChange={(m) => { setVision(m); void act('save', async () => { await save({ visionModel: m }); }); }} />
      </div></label>
      <div className="ai-cfg-b">
        <button disabled={!!busy} onClick={() => void act('save', async () => { const c = await save(); setMsg({ ok: true, t: c.hasKey ? '已保存' : '已保存，但还没有 API Key' }); })}>保存</button>
        <button className="pri" disabled={!!busy} onClick={() => void act('test', async () => { await save(); const r = await ai.test(); setMsg({ ok: true, t: `连接正常：${r.model}，${(r.ms / 1000).toFixed(1)} 秒，回复「${r.reply}」` }); })}>{busy === 'test' ? <Loader2 size={12} className="spin" /> : '保存并测试'}</button>
      </div>
      {msg && <div className={'ai-cfg-msg ' + (msg.ok ? 'ok' : 'bad')}>{msg.t}</div>}
      <div className="ai-cfg-foot">{cfg?.encrypted || !cfg?.hasKey ? 'Key 用 Windows 系统加密保存在本机数据目录，不会进入课件、录像或学生窗口。' : '注意：这台电脑不支持系统加密，Key 以编码形式保存在本机数据目录。'}</div>
    </div>
  );
}
