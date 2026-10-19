// 数学 / 化学演示播放器（Stage 内渲染）。参数和时钟沿用物理仿真的同步通道：
// 老师在预览里调好参数再上屏；上屏后的播放、拖动、调参通过共享时钟同步给学生窗口。
import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { Check, Pause, Play, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { Material } from '../lib/types';
import { ROLE, useStore } from '../lib/store';
import { timeAt, type SimScope } from '../physics/sim/clock';
import { useClockNow, useSimClock } from '../physics/sim/useSimClock';
import { COEF, demoById, makeDemo, pickPatch } from './index';
import { clampDemo, num, themeOf, type DemoDef, type P } from './kit';
import { balance } from './chemCore';
import { equationOf } from './chemDemos';
import '../styles/sim.css';

const RATES = [0.5, 1, 2];
const tex = (s: string) => ({ __html: katex.renderToString(s, { throwOnError: false, strict: 'ignore' }) });

export function DemoHost({ mat, scope = 'preview' }: { mat: Material; scope?: SimScope }) {
  const def = demoById(mat.scene?.preset)!;
  const skin = useStore((s) => s.boardSkin);
  const th = useMemo(() => themeOf(skin), [skin]);
  const { clock, canControl, act } = useSimClock(mat, scope);
  const D = def.duration;
  const now = useClockNow(clock.playing);
  const t = timeAt(clock, now, D);
  const p = useMemo(() => clampDemo(def, { ...(mat.scene?.params ?? {}), ...clock.params }), [def, mat.scene?.params, clock.params]);
  const teacher = ROLE !== 'student' && canControl;
  const ended = clock.playing && t >= D - 1e-3;
  useEffect(() => { if (ended && teacher) act({ type: 'pause' }, D); }, [ended]);

  const ctx = { mat, th };
  const formulas = def.formulas?.(p, t, ctx) ?? [], info = def.info?.(p, t, ctx) ?? [];
  const handles = teacher ? def.handles?.(p, t, ctx) ?? [] : [];
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: string; pending?: P; raf?: number } | null>(null);
  const setParams = (next: P) => act({ type: 'params', params: next }, D);
  const toSvg = (e: React.PointerEvent) => { const m = svg.current?.getScreenCTM(); if (!m) return null; const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return pt; };
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1600);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  return (
    <div ref={host} className="demohost" data-scope={scope} style={{ background: th.bg, ['--demo-halo' as string]: th.bg }} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.simctl,.demo-handle')) e.stopPropagation(); }}>
      <svg ref={svg} className="demo-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet"
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          const h = handles.find((x) => x.key === d.key), pt = toSvg(e); if (!h || !pt) return;
          d.pending = h.move(pt.x, pt.y, p);
          if (!d.raf) d.raf = requestAnimationFrame(() => { const cur = drag.current; if (cur?.pending) setParams(cur.pending); if (cur) { cur.raf = 0; cur.pending = undefined; } });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <rect width={1600} height={900} fill={th.bg} />
        {def.view(p, t, ctx)}
        {handles.map((h) => <circle key={h.key} className="demo-handle" cx={h.x} cy={h.y} r={Math.max(22, 12 * 1600 / Math.max(200, w))} fill={h.color ?? th.fg} fillOpacity={0.18} stroke={h.color ?? th.fg} strokeWidth={3}
          onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); drag.current = { key: h.key }; }} />)}
      </svg>
      {(formulas.length > 0 || info.length > 0) && (
        <div className={'simf demo-card c-' + (def.corner ?? 'tl')}>
          {formulas.map((f, i) => <div key={i} className="simf-row"><span dangerouslySetInnerHTML={tex(f.tex)} />{f.note && <i>{f.note}</i>}</div>)}
          {info.length > 0 && <dl className="demo-info">{info.map((r) => <div key={r.k}><dt>{r.k}</dt><dd style={r.color ? { color: r.color } : undefined}>{r.v}</dd></div>)}</dl>}
        </div>
      )}
      {teacher && <DemoControls def={def} p={p} t={t} playing={clock.playing} rate={clock.rate} act={act} scope={scope} mat={mat} w={w} />}
    </div>
  );
}

function DemoControls({ def, p, t, playing, rate, act, scope, mat, w }: { def: DemoDef; p: P; t: number; playing: boolean; rate: number; act: ReturnType<typeof useSimClock>['act']; scope: SimScope; mat: Material; w: number }) {
  const D = def.duration;
  // 预览区很小时参数面板会盖住整张图，默认收起，老师点「参数」再展开
  const [pinned, setOpen] = useState<boolean | null>(null);
  const open = pinned ?? (scope === 'preview' && w >= 760);
  const size = w < 520 ? ' compact tiny' : w < 760 ? ' compact' : '';
  const visible = def.params.filter((x) => !x.hidden && (!x.when || x.when(p)));
  const set = (patch: P) => act({ type: 'params', params: { ...p, ...patch } }, D);
  const pick = (key: string, v: number) => set(pickPatch(key, v));
  const live = scope === 'program' && useStore.getState().pgmMat.id === mat.id;
  return (
    <div className={'simctl demo-ctl' + size} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {open && (
        <div className="simctl-params">
          <div className="simctl-ph"><b>{def.title}</b><span>{def.summary}</span></div>
          {def.id === 'c.balance' && <BalancePanel p={p} set={set} mat={mat} />}
          {visible.map((d) => (
            <label key={d.key} className={'simctl-p' + (d.options && d.options.length > 4 ? ' wide' : '')}>
              <span>{d.label}</span>
              {d.options ? (
                d.options.length > 6
                  ? <select value={p[d.key]} onChange={(e) => pick(d.key, +e.target.value)}>{d.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
                  : <div className="simctl-seg">{d.options.map((o) => <button key={o.v} className={p[d.key] === o.v ? 'on' : ''} onClick={() => pick(d.key, o.v)}>{o.label}</button>)}</div>
              ) : (
                <>
                  <input type="range" min={d.min} max={d.max} step={d.step} value={p[d.key]} onChange={(e) => set({ [d.key]: +e.target.value })} />
                  <b className="num">{num(p[d.key], d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0)}<i>{d.unit ? ' ' + d.unit : ''}</i></b>
                </>
              )}
            </label>
          ))}
          {def.handles && <p className="demo-tip">直接拖动画面上的圆圈可以移动顶点</p>}
        </div>
      )}
      <div className="simctl-bar">
        <button className="simctl-play" onClick={() => act({ type: playing ? 'pause' : 'play' }, D)} title={def.play}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button onClick={() => act({ type: 'reset' }, D)} title="回到开始"><RotateCcw size={14} /></button>
        <div className="simctl-scrub"><input type="range" min={0} max={D} step={0.01} value={t} onChange={(e) => act({ type: 'seek', time: +e.target.value }, D)} /></div>
        <span className="simctl-t num">{num(t, 1)}<i>/{D} s</i></span>
        <div className="simctl-seg">{RATES.map((r) => <button key={r} className={rate === r ? 'on' : ''} onClick={() => act({ type: 'rate', rate: r }, D)}>{r}×</button>)}</div>
        <span className="demo-play-hint">{def.play}</span>
        {(def.params.some((x) => !x.hidden) || def.id === 'c.balance') && <button className={'simctl-pbtn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title="参数"><SlidersHorizontal size={14} />参数</button>}
        <span className={'simctl-live' + (live ? ' on' : '')} title={live ? '学生窗口同步' : '只有你能看到'}>{live ? '同步中' : '本地'}</span>
      </div>
    </div>
  );
}

function BalancePanel({ p, set, mat }: { p: P; set: (patch: P) => void; mat: Material }) {
  const { eq } = equationOf(p, mat.scene?.text);
  const [custom, setCustom] = useState(mat.scene?.text ?? '');
  if (!eq) return null;
  const all = [...eq.left, ...eq.right], ans = balance(eq);
  const openCustom = () => {
    const text = custom.trim(); if (!text) return;
    useStore.getState().open(makeDemo('c.balance', { rx: 0 }, { text, title: '配平 · ' + text }));
  };
  return <div className="demo-balance">
    <div className="demo-coefs">
      {all.map((f, i) => <span key={i} className="demo-coef">
        {i === eq.left.length && <em>=</em>}
        <button onClick={() => set({ [COEF[i]]: Math.max(1, (p[COEF[i]] ?? 1) - 1), show: 0 })}>−</button>
        <b className="num">{p.show === 1 && ans ? ans[i] : p[COEF[i]] ?? 1}</b>
        <button onClick={() => set({ [COEF[i]]: Math.min(30, (p[COEF[i]] ?? 1) + 1), show: 0 })}>+</button>
        <small>{f}</small>
      </span>)}
    </div>
    <div className="demo-coefs">
      <button className={p.show === 1 ? 'on' : ''} disabled={!ans} onClick={() => set(p.show === 1 ? { show: 0 } : { show: 1 })}><Sparkles size={13} />{p.show === 1 ? '收起答案' : '揭晓配平结果'}</button>
      <button onClick={() => set({ ...Object.fromEntries(COEF.map((k) => [k, 1])), show: 0 })}>系数全部改为 1</button>
    </div>
    <label className="demo-custom"><span>自定义</span><input value={custom} placeholder="例：Fe + HNO3 = Fe(NO3)3 + NO + H2O；离子写 Fe^3+" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') openCustom(); }} /><button onClick={openCustom}><Check size={13} />打开</button></label>
  </div>;
}
