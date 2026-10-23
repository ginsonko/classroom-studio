import { useEffect, useRef, useState } from 'react';
import { host } from '../lib/host';
import { BookOpen, Check, ChevronDown, ChevronUp, Clapperboard, Clock, RotateCcw, SkipForward, X } from 'lucide-react';
import { openHelp } from '../lib/update';
import { useStore } from '../lib/store';
import { packOf } from '../lib/subjects';
import {
  ackStep, canDemoNow, currentStep, currentSteps, exitGuide, extrasOf, goStep, laterWelcome, maybeWelcome, neverWelcome, nextNow, restartGuide,
  resumeGuide, skipChapter, skipStep, startGuide, tick, useGuide,
} from './guide';
import { ROUTE_NAME, nextOpen, placeCard, summary, type Box, type Corner, type RouteId } from './steps';
import { GuideSpot, findSpot } from './Spot';

/** 导播台窗口里的彩排：邀请卡、引导卡、完成清单、按钮高亮 */
export function Guide() {
  const active = useGuide((s) => s.active), welcome = useGuide((s) => s.welcome);
  useEffect(() => { resumeGuide(); const t = setTimeout(maybeWelcome, 1800); return () => clearTimeout(t); }, []);
  useEffect(() => { if (!active) return; const t = setInterval(tick, 400); return () => clearInterval(t); }, [active]);
  return <>
    {welcome && !active && <Welcome />}
    {active && <Coach />}
    <GuideSpot win="teacher" />
  </>;
}

function Welcome() {
  const status = useGuide((s) => s.status);
  const started = Object.keys(status).length > 0;
  return <section className="guide-card guide-welcome" role="dialog" aria-label="上课彩排">
    <header><Clapperboard size={18} /><b>花几分钟彩排一节课？</b><span className="flex" /><button className="guide-x" onClick={laterWelcome} aria-label="关闭"><X size={15} /></button></header>
    <p>用练习学生「小明」和一块彩排黑板，亲手把上课走一遍：选学生、上屏、写板书、存 PDF、AI 讲题、AI 整理……每一步做到了才往下走。</p>
    <p className="guide-dim">彩排时写的东西、加的题和记录，退出时都会清掉，不会弄乱你的学生档案。</p>
    <div className="guide-routes">
      <button className="guide-route" onClick={() => startGuide('quick')}><b>{ROUTE_NAME.quick}</b><span><Clock size={12} />约 5 分钟 · 7 步</span><small>配 AI、选学生、上屏、写板书、存 PDF</small></button>
      <button className="guide-route" onClick={() => startGuide('full')}><b>{ROUTE_NAME.full}</b><span><Clock size={12} />约 30 分钟 · {currentStepsCount('full')} 步</span><small>再加上长黑板、AI 讲题、AI 整理、课后、插件、个性化</small></button>
    </div>
    {started && <p className="guide-dim">上次做到了一半，选路线后从没做完的那步接着来。</p>}
    <footer><button onClick={laterWelcome}>以后再说</button><button className="ghost" onClick={neverWelcome}>不再提示</button><span className="flex" /><small>随时可以在「帮助」里打开</small></footer>
  </section>;
}
const currentStepsCount = (r: RouteId) => summary(r, {}).total;

/** 引导卡自己挪到不挡事的角：要点的按钮、AI 抽屉、打开着的对话框 */
function useCorner(ref: React.RefObject<HTMLElement | null>, sel: string) {
  const [place, setPlace] = useState<{ corner: Corner; slim: boolean }>({ corner: 'br', slim: false });
  const wideH = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      const el = ref.current; if (!el) return;
      // 收窄时卡片变矮，按收窄前的高度判断能不能放宽，免得来回跳
      const slim = el.classList.contains('slim');
      if (!slim) wideH.current = el.offsetHeight;
      const cs = getComputedStyle(document.documentElement), px = (v: string, d: number) => parseFloat(cs.getPropertyValue(v)) || d;
      const box = (e: Element | null, weight = 1): Box | null => { const r = e?.getBoundingClientRect(); return r && r.width > 1 ? { x: r.left, y: r.top, w: r.width, h: r.height, weight } : null; };
      const avoid = [box(sel ? findSpot(sel) : null, 20), box(document.querySelector('.ai-dock')),
        ...[...document.querySelectorAll('[role=dialog]:not(.guide-card)')].map((d) => box(d))].filter((b): b is Box => !!b);
      const h = Math.max(el.offsetHeight, wideH.current);
      setPlace((p) => {
        const n = placeCard({ w: innerWidth, h: innerHeight }, h, avoid, { left: px('--rail', 64) + 12, top: px('--bar', 48) + 10, edge: 16 }, p.corner);
        return n.corner === p.corner && n.slim === p.slim ? p : n;
      });
    }, 500);
    return () => clearInterval(t);
  }, [ref, sel]);
  return place;
}

function Coach() {
  const g = useGuide();
  const subject = useStore((s) => s.subject);
  const [confirm, setConfirm] = useState(false);
  const steps = currentSteps(), step = currentStep();
  const ref = useRef<HTMLElement>(null);
  const { corner, slim } = useCorner(ref, step?.spot?.win === 'teacher' ? step.spot.sel : '');
  if (g.phase === 'finish') return <Finish />;
  if (!step) return null;
  const sum = summary(g.route, g.status);
  if (g.min) return <button className={'guide-pill at-' + corner} onClick={() => useGuide.setState({ min: false })}><Clapperboard size={14} />彩排 {g.idx + 1} / {steps.length}：{step.title}<ChevronUp size={14} /></button>;
  const opts = { subject, family: packOf(subject).family, ai: g.ai, canDemo: canDemoNow() };
  const needDock = step.spot?.win === 'dock' && !g.dock;
  return <section ref={ref} className={'guide-card guide-coach at-' + corner + (slim ? ' slim' : '') + (g.phase === 'cheer' ? ' cheer' : '')} role="dialog" aria-label="上课彩排">
    <header>
      <Clapperboard size={16} /><b>上课彩排 · {ROUTE_NAME[g.route]}</b>
      <span className="flex" />
      <button className="guide-x" onClick={() => useGuide.setState({ min: true })} aria-label="收起" data-tip="收起（彩排继续）"><ChevronDown size={15} /></button>
      <button className="guide-x" onClick={() => setConfirm(true)} aria-label="退出彩排"><X size={15} /></button>
    </header>
    <div className="guide-bar"><i style={{ width: `${(g.idx / steps.length) * 100}%` }} /></div>
    <p className="guide-dim guide-where">第 {g.idx + 1} / {steps.length} 步 · {step.chapter} · 已做到 {sum.done} 步 · 练习数据退出时清掉</p>
    {confirm ? <div className="guide-confirm">
      <b>退出彩排？</b>
      <p>练习学生小明、彩排黑板、彩排时新加的题和记录都会清掉。做到了哪几步会记着，下次接着做。</p>
      <div><button className="guide-go" onClick={exitGuide}>退出并清掉</button><button onClick={() => setConfirm(false)}>继续彩排</button></div>
    </div> : g.phase === 'cheer' ? <div className="guide-cheer">
      <Check size={22} /><div><b>做到了：{step.title}</b><p>{step.tip}</p></div>
      <button onClick={nextNow}>下一步</button>
    </div> : <>
      <h3>{step.title}</h3>
      <p className="guide-scene">{step.scene}</p>
      <p className="guide-todo">{step.todo(opts)}</p>
      {needDock && <p className="guide-note">浮层工具栏贴在学生窗口上，学生窗口还没打开。<button onClick={() => host.openStudentWindow()}>打开学生窗口</button></p>}
      {(extrasOf(step.id).length > 0 || step.ack) && <div className="guide-acts">
        {extrasOf(step.id).map((x) => <button key={x.label} onClick={() => void x.run()}>{x.label}</button>)}
        {step.ack && <button className="guide-go" onClick={ackStep}><Check size={13} />{step.ack}</button>}
      </div>}
      {!step.ack && <p className="guide-wait"><i />做到了会自动打勾</p>}
      <footer>
        <button onClick={skipStep}><SkipForward size={13} />跳过这步</button>
        <button onClick={skipChapter}>跳过这一章</button>
        <span className="flex" />
        <button className="guide-link" onClick={() => openHelp('manual', step.help)}><BookOpen size={13} />手册</button>
      </footer>
    </>}
  </section>;
}

function Finish() {
  const g = useGuide();
  const sum = summary(g.route, g.status);
  const left = nextOpen(g.route, g.status);
  return <section className="guide-card guide-finish" role="dialog" aria-label="彩排完成">
    <header><Clapperboard size={16} /><b>彩排结束 · {ROUTE_NAME[g.route]}</b><span className="flex" /></header>
    <div className="guide-score"><b className="num">{sum.done}</b><span>/ {sum.total}</span><p>{sum.done === sum.total ? '全部做到了，可以上真课了。' : '没做到的步骤可以单独补做。'}</p></div>
    <div className="guide-list">{sum.chapters.map((c) => <div key={c.name} className="guide-ch"><small>{c.name}</small>
      {c.steps.map((s) => <div key={s.id} className={'guide-li ' + (s.status ?? 'todo')}>
        <i>{s.status === 'done' ? <Check size={12} /> : null}</i><span>{s.title}</span>
        {s.status !== 'done' && <button onClick={() => goStep(s.id)}>补做</button>}
      </div>)}
    </div>)}</div>
    <footer>
      {g.route === 'quick' && <button onClick={() => startGuide('full')}>接着走完整版</button>}
      {left >= 0 && <button onClick={() => goStep(currentSteps()[left].id)}>补做没做到的</button>}
      <button className="ghost" onClick={() => restartGuide(g.route)}><RotateCcw size={13} />从头再来</button>
      <span className="flex" />
      <button className="guide-go" onClick={exitGuide}>结束彩排（清掉练习数据）</button>
    </footer>
  </section>;
}
