// 物理仿真播放器（Stage 内渲染，kind='sim'）。
// 仿真画面沿用 Claude 的深石墨导播台视觉：同一 SimRun 提供物体、轨迹、向量、事件、读数、图线和公式。
// 老师端可以在预览/预监中控制；学生端只消费 program scope 的共享时钟和已发布参数。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import type { Material } from '../lib/types';
import { DARK_BOARDS, resolveColor, ROLE, useStore, type BoardSkin } from '../lib/store';
import { SimRun } from './sim/engine';
import { PAPER, type SD } from './sim/prim';
import { clampParams, presetFor } from './sim/presets';
import { drawSim } from './sim/render';
import { currentSync, initialSync, onAir, simTime, useLocalSims, writeSync } from './sim/clock';
import { SimControls } from './sim/SimControls';
import type { Ov } from './sim/presetKit';
import '../styles/sim.css';

export function SimHost({ mat, scope = 'preview', controls = true }: { mat: Material; scope?: 'program' | 'preview'; controls?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [px, setPx] = useState({ w: 0, h: 0 });
  const boardSkin = useStore((s) => s.boardSkin);
  const shared = useStore((s) => s.sim);
  const pgmId = useStore((s) => s.pgmMat.id);
  const local = useLocalSims((s) => s.m[mat.id]);
  const sync = useMemo(() => currentSync(mat, scope), [mat, scope, shared, local, pgmId]);

  useEffect(() => {
    if (scope !== 'program' || ROLE !== 'teacher' || !onAir(mat.id)) return;
    const s = useStore.getState().sim;
    if (!s || s.matId !== mat.id) writeSync(mat, useLocalSims.getState().m[mat.id] ?? initialSync(mat), scope);
  }, [mat, pgmId, scope]);

  const pre = presetFor(mat.scene?.preset ?? (mat.id === 'sim:chase' ? 'chase' : undefined));
  const ratio = (mat.pages[0]?.h ?? 900) / (mat.pages[0]?.w ?? 1600);
  const pkey = JSON.stringify(sync.params ?? {});
  const scene = useMemo(() => {
    if (pre) return pre.build(clampParams(pre, sync.params ?? {}));
    return mat.scene ?? { objs: [], world: { g: 10, ppm: 0.1 } };
  }, [mat, pre, pkey, sync.rev]);
  const run = useMemo(() => {
    try { return new SimRun(scene, { events: pre?.events }); }
    catch { return null; }
  }, [scene, pre]);
  const params = pre ? clampParams(pre, sync.params ?? {}) : (scene.params ?? {});
  const ov: Ov = { v: true, f: true, trail: true, graph: true, formula: true, ...(pre?.overlays ?? {}), ...((sync.overlays ?? {}) as Ov) };
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setPx({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const t = run ? simTime(sync, run.duration) : 0;
  const [tShow, setTShow] = useState(0);
  const live = useRef({ sync, run, ov, params, px, boardSkin });
  live.current = { sync, run, ov, params, px, boardSkin };
  useEffect(() => {
    let raf = 0, lastKey = '', lastUi = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const L = live.current, c = cv.current;
      if (!c || !L.run || L.px.w < 2) return;
      const currentT = simTime(L.sync, L.run.duration);
      // rich engine 按需预计算：先确保当前时刻，再按每帧预算向后推进。
      L.run.ensure(currentT);
      L.run.pump(6);
      const key = `${currentT.toFixed(5)}|${L.px.w}x${L.px.h}|${L.boardSkin}|${JSON.stringify(L.ov)}|${L.run.scene.preset ?? ''}|${L.run.frames.length}`;
      if (key !== lastKey) { lastKey = key; paint(c, L.run, currentT, L, ratio, pre); }
      const now = performance.now();
      if (now - lastUi > 66) { lastUi = now; setTShow(currentT); }
      if (scope === 'program' && L.sync.playing && currentT >= L.run.duration - 1e-6 && ROLE !== 'student') writeSync(mat, { ...L.sync, playing: false, offset: L.run.duration, startedAt: Date.now() }, scope);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mat, ratio, pre, scope]);

  const formulas = ov.formula && pre?.formulas ? pre.formulas(params) : [];
  const fc = pre?.layout?.formula ?? 'bl';
  const showCtl = controls && ROLE !== 'student' && px.w >= 420 && !!run;
  return (
    <div className="simhost" ref={wrap} data-scope={scope} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.simctl')) e.stopPropagation(); }}>
      <canvas ref={cv} className="simhost-cv" />
      {!run && <div className="physics-error"><b>暂不能运行这个场景</b><p>当前器材可绘制，但该组合还没有受支持的二维求解。</p><span>请在教师端选择已支持的模板或调整器材参数。</span></div>}
      {formulas.length > 0 && <div className={'simf c-' + fc}>{formulas.map((f, i) => <div key={i} className="simf-row"><span dangerouslySetInnerHTML={{ __html: katex.renderToString(f.tex, { throwOnError: false }) }} />{f.note && <i>{f.note}</i>}</div>)}</div>}
      {showCtl && <SimControls mat={mat} run={run!} sync={sync} pre={pre} params={params} ov={ov} t={tShow} compact={px.w < 760} scope={scope} />}
    </div>
  );
}

function paint(c: HTMLCanvasElement, run: SimRun, t: number, L: { ov: Ov; params: Record<string, number>; px: { w: number; h: number }; boardSkin: string }, ratio: number, pre: ReturnType<typeof presetFor>) {
  const dpr = Math.min(3, window.devicePixelRatio || 1), W = Math.max(1, Math.round(L.px.w * dpr)), H = Math.max(1, Math.round(L.px.h * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d'); if (!ctx) return;
  const skin = L.boardSkin as BoardSkin, dark = DARK_BOARDS.includes(skin), paper = PAPER[skin] ?? '#fff';
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
  const s = W; ctx.setTransform(s, 0, 0, s, 0, 0);
  const d: SD = { ctx, scale: L.px.w, dark, paper, color: (k) => resolveColor(k, skin, false) };
  drawSim(d, run, t, { preset: pre, params: L.params, ov: L.ov, ratio });
}


