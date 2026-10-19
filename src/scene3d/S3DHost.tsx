// 立体演示播放器（Stage 内渲染）。时钟 / 参数走物理仿真的共享通道（SimSync），
// 视角（机位、拖动角度、缩放）也挂在共享时钟上，老师在节目监视器里转动画面，学生端同步看到。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SlidersHorizontal, Video } from 'lucide-react';
import type { Material } from '../lib/types';
import type { SimSync } from '../physics/model';
import { ROLE, useStore } from '../lib/store';
import { timeAt, withClockDefaults, type SimScope } from '../physics/sim/clock';
import { useClockNow, useSimClock } from '../physics/sim/useSimClock';
import { CAMERA_LABEL, CAMERAS, type CameraName, type S3DSpec } from './spec';
import { World } from './world';
import { s3dParams } from './material';
import '../styles/sim.css';
import '../styles/scene3d.css';

type SceneMod = typeof import('./three/scene');
export interface View3D { cam: CameraName | null; az: number; el: number; zoom: number }
type Sync3D = SimSync & { view3d?: View3D };
const HOME: View3D = { cam: null, az: 0, el: 0, zoom: 1 };
const RATES = [0.5, 1, 2];
const MAX_PIXELS = 2_600_000;

let modPromise: Promise<SceneMod> | null = null;
export const loadScene3D = () => (modPromise ??= import('./three/scene'));

export function S3DHost({ mat, scope = 'preview' }: { mat: Material; scope?: SimScope }) {
  const spec = mat.s3d as S3DSpec;
  const { clock, canControl, act } = useSimClock(mat, scope);
  const D = spec.duration;
  const params = useMemo(() => s3dParams(spec, mat.scene?.params, clock.params), [spec, mat.scene?.params, clock.params]);
  const teacher = ROLE !== 'student' && canControl;
  const now = useClockNow(teacher && clock.playing);
  const t = timeAt(clock, now, D);
  const ended = clock.playing && t >= D - 1e-3;
  useEffect(() => { if (ended && teacher) act({ type: 'pause' }, D); }, [ended]);

  // 视角：节目里跟共享时钟走，预览里只在本地
  const shared = useStore((s) => s.sim) as Sync3D | null;
  const [localView, setLocalView] = useState<View3D>(HOME);
  const view = scope === 'program' && shared?.matId === mat.id && shared.view3d ? shared.view3d : localView;
  const viewRef = useRef(view);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) viewRef.current = view; }, [view]);
  const pushTimer = useRef(0);
  const setView = (v: View3D, final = true) => {
    viewRef.current = v;
    if (scope === 'program') {
      const st = useStore.getState();
      if (st.pgmMat.id !== mat.id || !canControl) { setLocalView(v); return; }
      const send = () => {
        pushTimer.current = 0;
        const s = useStore.getState(), cur = (s.sim?.matId === mat.id ? withClockDefaults(s.sim) : clock) as Sync3D;
        s.setShared({ sim: { ...cur, view3d: viewRef.current } as SimSync });
      };
      if (final) { if (pushTimer.current) clearTimeout(pushTimer.current); send(); }
      else if (!pushTimer.current) pushTimer.current = window.setTimeout(send, 70);
    } else if (final) setLocalView(v);
  };

  const clockRef = useRef(clock);
  clockRef.current = clock;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mod, setMod] = useState<SceneMod | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => { let on = true; loadScene3D().then((m) => { if (on) setMod(m); }); return () => { on = false; }; }, []);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // 场景实例：规格变了重建，参数变了只重建对象
  const sceneRef = useRef<InstanceType<SceneMod['S3DScene']> | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const dirty = useRef(0);
  useEffect(() => {
    if (!mod) return;
    const sc = new mod.S3DScene(spec, paramsRef.current);
    sceneRef.current = sc; dirty.current++;
    return () => { sceneRef.current = null; sc.dispose(); };
  }, [mod, spec]);
  useEffect(() => { sceneRef.current?.setParams(params); dirty.current++; }, [params]);

  // 渲染循环：只有时间 / 尺寸 / 视角 / 参数变化时才重画
  const reserve = scope === 'preview' && teacher;
  useEffect(() => {
    let raf = 0, last = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const sc = sceneRef.current, cv = canvas.current, el = host.current;
      if (!sc || !cv || !el) return;
      const cw = el.clientWidth, ch = el.clientHeight;
      if (cw < 8 || ch < 8) return;
      let dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cw * ch * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (cw * ch));
      const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
      const tt = timeAt(clockRef.current, Date.now(), D);
      const v = viewRef.current;
      const key = `${tt.toFixed(4)}|${W}x${H}|${v.cam}|${v.az.toFixed(2)}|${v.el.toFixed(2)}|${v.zoom.toFixed(3)}|${dirty.current}`;
      if (key === last) return;
      last = key;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const g = cv.getContext('2d');
      if (!g) return;
      sc.draw(g, W, H, tt, { camera: v.cam, view: { az: v.az, el: v.el, zoom: v.zoom }, reserveBottom: reserve ? Math.round(64 * dpr) : 0 });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [D, reserve]);

  // 拖动旋转、滚轮缩放、双击复位
  const drag = useRef<{ x: number; y: number; v: View3D } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (!canControl || (e.target as HTMLElement).closest('.simctl')) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, v: viewRef.current };
    dragging.current = true;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    setView({ ...d.v, az: d.v.az - dx * 0.35, el: Math.max(-70, Math.min(80, d.v.el + dy * 0.3)) }, false);
  };
  const onUp = () => { if (!drag.current) return; drag.current = null; dragging.current = false; setView(viewRef.current, true); };
  const onWheel = (e: React.WheelEvent) => {
    if (!canControl) return;
    e.stopPropagation();
    const v = viewRef.current;
    setView({ ...v, zoom: Math.max(0.35, Math.min(2.6, v.zoom * Math.exp(e.deltaY * 0.0012))) }, false);
    window.clearTimeout(wheelEnd.current); wheelEnd.current = window.setTimeout(() => setView(viewRef.current, true), 250);
  };
  const wheelEnd = useRef(0);

  return (
    <div ref={host} className="s3dhost" data-scope={scope} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
      onDoubleClick={(e) => { if (canControl && !(e.target as HTMLElement).closest('.simctl')) setView({ ...HOME, cam: viewRef.current.cam }); }}>
      <canvas ref={canvas} className="s3d-canvas" />
      {!mod && <div className="s3d-loading">正在准备立体画面…</div>}
      {teacher && size.w > 0 && <S3DControls spec={spec} params={params} t={t} playing={clock.playing} rate={clock.rate} act={act} scope={scope} mat={mat} w={size.w} view={view} setView={setView} />}
    </div>
  );
}

function S3DControls({ spec, params, t, playing, rate, act, scope, mat, w, view, setView }: {
  spec: S3DSpec; params: Record<string, number>; t: number; playing: boolean; rate: number; act: ReturnType<typeof useSimClock>['act']; scope: SimScope; mat: Material; w: number; view: View3D; setView: (v: View3D) => void;
}) {
  const D = spec.duration;
  const [pinned, setOpen] = useState<boolean | null>(null);
  const open = pinned ?? false;
  const size = w < 520 ? ' compact tiny' : w < 860 ? ' compact' : '';
  const set = (patch: Record<string, number>) => act({ type: 'params', params: { ...params, ...patch } }, D);
  const live = scope === 'program' && useStore.getState().pgmMat.id === mat.id;
  const world = useMemo(() => new World(spec, params), [spec, params]);
  const ats = useMemo(() => world.stepTimes(), [world]);
  const k = spec.steps.length ? world.stepIndex(t) : -1;
  const goStep = (i: number) => { const j = Math.max(0, Math.min(spec.steps.length - 1, i)); act({ type: 'seek', time: Math.min(D, ats[j] + (j === spec.steps.length - 1 && spec.mode === 'static' ? Math.max(0.6, (D - ats[j]) * 0.9) : 0.6)) }, D); };
  const cams: CameraName[] = CAMERAS.filter((c) => c !== 'back' && c !== 'low');
  return (
    <div className={'simctl s3d-ctl' + size} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {open && (
        <div className="simctl-params">
          <div className="simctl-ph"><b>{spec.title}</b>{spec.notes.slice(0, 3).map((n, i) => <span key={i}>{n}</span>)}</div>
          {spec.params.map((d) => (
            <label key={d.key} className="simctl-p">
              <span>{d.label}</span>
              <input type="range" min={d.min} max={d.max} step={d.step} value={params[d.key]} onChange={(e) => set({ [d.key]: +e.target.value })} />
              <b className="num">{fmtP(params[d.key], d.step)}<i>{d.unit ? ' ' + d.unit : ''}</i></b>
            </label>
          ))}
          {!spec.params.length && <p className="demo-tip">这个演示没有可调的参数。</p>}
          <p className="demo-tip">在画面上拖动可以转动视角，滚轮缩放，双击复位。</p>
        </div>
      )}
      <div className="simctl-bar">
        <button className="simctl-play" onClick={() => act({ type: playing ? 'pause' : 'play' }, D)} title={playing ? '暂停' : '播放'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button onClick={() => act({ type: 'reset' }, D)} title="回到开始"><RotateCcw size={14} /></button>
        <div className="simctl-scrub">
          <input type="range" min={0} max={D} step={0.01} value={t} onChange={(e) => act({ type: 'seek', time: +e.target.value }, D)} />
          {ats.map((a, i) => <i key={i} className="s3d-tick" style={{ left: `${(a / D) * 100}%` }} title={spec.steps[i].say} onClick={() => goStep(i)} />)}
        </div>
        <span className="simctl-t num">{t.toFixed(1)}<i>/{D} s</i></span>
        {spec.steps.length > 0 && (
          <span className="s3d-steps">
            <button onClick={() => goStep(k - 1)} disabled={k <= 0} title="上一步"><ChevronLeft size={14} /></button>
            <b className="num">{k + 1}/{spec.steps.length}</b>
            <button onClick={() => goStep(k + 1)} disabled={k >= spec.steps.length - 1} title="下一步"><ChevronRight size={14} /></button>
          </span>
        )}
        <div className="simctl-seg s3d-rates">{RATES.map((r) => <button key={r} className={rate === r ? 'on' : ''} onClick={() => act({ type: 'rate', rate: r }, D)}>{r}×</button>)}</div>
        <div className="simctl-seg s3d-cams" title="机位">
          <Video size={13} className="s3d-camicon" />
          <button className={view.cam === null ? 'on' : ''} onClick={() => setView({ ...HOME, cam: null })}>自动</button>
          {cams.map((c) => <button key={c} className={view.cam === c ? 'on' : ''} onClick={() => setView({ ...HOME, cam: c })}>{CAMERA_LABEL[c]}</button>)}
        </div>
        <button className={'simctl-pbtn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title="参数与说明"><SlidersHorizontal size={14} />{spec.params.length ? '参数' : '说明'}</button>
        <span className={'simctl-live' + (live ? ' on' : '')} title={live ? '学生窗口同步' : '只有你能看到'}>{live ? '同步中' : '本地'}</span>
      </div>
    </div>
  );
}
const fmtP = (v: number, step: number) => { const d = step < 0.1 ? 2 : step < 1 ? 1 : 0; return Number.isFinite(v) ? v.toFixed(d) : '—'; };
