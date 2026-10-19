// 老师端的仿真控制条：播放 / 重置 / 单步 / 倍速 / 进度条 / 叠加层开关 / 参数。学生窗口不渲染它。
import { useState } from 'react';
import { ChartLine, Pause, Play, RotateCcw, SlidersHorizontal, StepBack, StepForward } from 'lucide-react';
import type { Material } from '../../lib/types';
import type { SimSync } from '../model';
import type { SimRun } from './engine';
import type { Ov, P, Preset } from './presetKit';
import { onAir, play, reset, seek, setOverlay, setParams, setRate, type SimScope } from './clock';
import { fmt } from './text';

const RATES = [0.25, 0.5, 1, 2];
const OVS: { k: keyof Ov; label: string }[] = [
  { k: 'v', label: '速度' }, { k: 'f', label: '受力' }, { k: 'trail', label: '轨迹' }, { k: 'graph', label: '图像' }, { k: 'formula', label: '公式' },
];

export function SimControls(p: { mat: Material; run: SimRun; sync: SimSync; pre?: Preset; params: P; ov: Ov; t: number; compact: boolean; scope?: SimScope }) {
  const { mat, run, sync, pre, params, ov, t } = p;
  const scope = p.scope ?? 'program';
  const D = run.duration;
  const [open, setOpen] = useState(false);
  const step = 1 / 30;
  const evs = run.events.filter((e) => ['cospeed', 'collide', 'leave', 'apex', 'land', 'release', 'slack', 'hit'].includes(e.kind)).slice(0, 5);
  const live = scope === 'program' && onAir(mat.id);
  return (
    <div className={'simctl' + (p.compact ? ' compact' : '')} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {open && pre && (
        <div className="simctl-params">
          <div className="simctl-ph"><b>{pre.title}</b><span>{pre.summary}</span></div>
          {pre.params.map((d) => (
            <label key={d.key} className="simctl-p">
              <span>{d.label}</span>
              {d.options ? (
                <div className="simctl-seg">
                  {d.options.map((o) => (
                    <button key={o.v} className={params[d.key] === o.v ? 'on' : ''} onClick={() => setParams(mat, D, { [d.key]: o.v }, scope)}>{o.label}</button>
                  ))}
                </div>
              ) : (
                <>
                  <input type="range" min={d.min} max={d.max} step={d.step} value={params[d.key] ?? d.def}
                    onChange={(e) => setParams(mat, D, { [d.key]: +e.target.value }, scope)} />
                  <b className="num">{fmt(params[d.key] ?? d.def, d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0)}<i>{d.unit ? ' ' + d.unit : ''}</i></b>
                </>
              )}
            </label>
          ))}
        </div>
      )}
      {evs.length > 0 && !p.compact && !open && (
        <div className="simctl-chips">
          {evs.map((e, i) => <button key={i} onClick={() => seek(mat, D, e.t, scope)}>跳到 {e.label.replace(/ t=.*$/, '')} · {fmt(e.t * run.ts)} s</button>)}
        </div>
      )}
      <div className="simctl-bar">
        <button className="simctl-play" onClick={() => play(mat, D, scope)} title={sync.playing ? '暂停' : '播放'}>
          {sync.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => reset(mat, D, scope)} title="回到开始"><RotateCcw size={14} /></button>
        <button onClick={() => seek(mat, D, t - step, scope)} title="后退一帧"><StepBack size={14} /></button>
        <button onClick={() => seek(mat, D, t + step, scope)} title="前进一帧"><StepForward size={14} /></button>
        <div className="simctl-scrub">
          <div className="simctl-done" style={{ width: (Math.min(1, run.computed / D) * 100) + '%' }} />
          {evs.map((e, i) => <span key={i} className="simctl-ev" style={{ left: (e.t / D) * 100 + '%' }} title={e.label} onClick={() => seek(mat, D, e.t, scope)} />)}
          <input type="range" min={0} max={D} step={0.001} value={t} onChange={(e) => seek(mat, D, +e.target.value, scope)} />
        </div>
        <span className="simctl-t num">{fmt(t)}<i>/{fmt(D, 1)} s</i></span>
        <div className="simctl-seg">
          {RATES.map((r) => <button key={r} className={sync.rate === r ? 'on' : ''} onClick={() => setRate(mat, D, r, scope)}>{r}×</button>)}
        </div>
        {!p.compact && (
          <div className="simctl-seg">
            {OVS.map((o) => <button key={o.k} className={ov[o.k] !== false ? 'on' : ''} onClick={() => setOverlay(mat, D, { [o.k]: ov[o.k] === false }, scope)}>{o.label}</button>)}
          </div>
        )}
        {pre && <button className={'simctl-pbtn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} title="参数"><SlidersHorizontal size={14} />参数</button>}
        <span className={'simctl-live' + (live ? ' on' : '')} title={live ? '学生窗口同步播放' : '只有你能看到'}><ChartLine size={12} />{live ? '同步中' : '本地'}</span>
      </div>
    </div>
  );
}
