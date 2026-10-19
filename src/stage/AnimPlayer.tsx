import { useMemo } from 'react';
import katex from 'katex';
import type { Material } from '../lib/types';
import { useClockNow, useSimClock } from '../physics/sim/useSimClock';
import { timeAt, type SimScope } from '../physics/sim/clock';

/**
 * 固定追及例题的无声讲解模板，不读取当前题目，不宣称已经导出视频。
 */
interface Step { at: number; title: string; caption: string; tex?: string[] }
const SCRIPT: Step[] = [
  { at: 0, title: '读题', caption: '汽车从静止以 3 m/s² 加速，自行车以 6 m/s 匀速驶过。' },
  { at: 7, title: '抓关键', caption: '自行车先快，距离变大；汽车加速后变快，距离变小。转折点在速度相等的那一刻。' },
  { at: 15, title: '列式', caption: '速度相等时相距最远。', tex: ['at=v', 't=\\dfrac{v}{a}=2\\,\\mathrm{s}'] },
  { at: 23, title: '看图', caption: 'v–t 图里两条线之间的面积，就是两车的距离差。', tex: ['\\Delta x=\\tfrac12\\times2\\times6=6\\,\\mathrm{m}'] },
  { at: 32, title: '结论', caption: '经过 2 s 两者相距最远，最远距离 6 m。', tex: ['t=2\\,\\mathrm{s},\\quad \\Delta x_{\\max}=6\\,\\mathrm{m}'] },
];
const DUR = 40;

const tex = (s: string) => ({ __html: katex.renderToString(s, { throwOnError: false }) });
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

const legacyMaterial: Material = { id: 'anim:chase', kind: 'html', title: '追及相遇 · 固定讲解模板', pages: [{ w: 1600, h: 900 }], total: 1, scene: { objs: [], world: { g: 0, ppm: 1 }, duration: DUR, preset: 'chase', params: { a: 3, v: 6 } } };
export function AnimPlayer({ mat = legacyMaterial, scope = 'preview' }: { mat?: Material; scope?: SimScope }) {
  const { clock, canControl, act } = useSimClock(mat, scope);
  const now = useClockNow(clock.playing), t = timeAt(clock, now, DUR), play = clock.playing && t < DUR;

  const idx = SCRIPT.findLastIndex((s) => s.at <= t);
  const step = SCRIPT[idx];
  const local = t - step.at;
  // 场景：道路上两车按真实运动学移动（读题与抓关键阶段），之后切换到 v–t 图
  const simT = Math.min(2, Math.max(0, (t - 1.5) / 6));
  const xCar = 0.5 * 3 * simT * simT, xBike = 6 * simT;
  const X = (m: number) => 80 + (m / 40) * 820;
  const graph = ease((t - 21) / 2);
  const shade = ease((t - 25) / 3);
  const cx = (s: number) => 560 + s * 70, cy = (v: number) => 420 - v * 18;
  const tsec = useMemo(() => Array.from({ length: 6 }, (_, i) => i), []);

  return (
    <div className="anim" onPointerDown={(e) => e.stopPropagation()}>
      <svg className="anim-svg" viewBox="0 0 1000 560">
        <defs>
          <linearGradient id="anim-bg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#141a26" /><stop offset="1" stopColor="#0c1018" /></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="1000" height="560" fill="url(#anim-bg)" />
        {/* 道路场景 */}
        <g opacity={1 - graph * 0.75} transform={`translate(0 ${-graph * 120}) scale(${1 - graph * 0.45}) `} style={{ transformOrigin: '0 0' }}>
          <rect x="40" y="190" width="920" height="120" rx="14" fill="#202736" />
          <line x1="60" x2="940" y1="250" y2="250" stroke="#f3e7b3" strokeDasharray="22 18" strokeWidth="2.5" opacity=".5" />
          <g transform={`translate(${X(xBike)} 215)`}>
            <circle cx="-13" cy="13" r="11" fill="none" stroke="#7fb2ff" strokeWidth="3.4" />
            <circle cx="13" cy="13" r="11" fill="none" stroke="#7fb2ff" strokeWidth="3.4" />
            <path d="M-13 13 L-2 -5 L11 -5 L13 13 M-2 -5 L2 13 L-13 13" stroke="#7fb2ff" strokeWidth="3.4" fill="none" />
          </g>
          <g transform={`translate(${X(xCar)} 282)`}>
            <path d="M-30 7 L-30 -7 L-16 -7 L-7 -19 L14 -19 L23 -7 L32 -5 L32 7 Z" fill="#ff6b5e" />
            <circle cx="-16" cy="8" r="7" fill="#111" stroke="#ddd" strokeWidth="2" />
            <circle cx="18" cy="8" r="7" fill="#111" stroke="#ddd" strokeWidth="2" />
          </g>
          {t > 7 && t < 21 && (
            <g opacity={ease((t - 7) / 1)}>
              <line x1={X(Math.min(xCar, xBike))} x2={X(Math.max(xCar, xBike))} y1="170" y2="170" stroke="#ffb547" strokeWidth="4" filter="url(#glow)" />
              <text x={(X(xCar) + X(xBike)) / 2} y="158" fill="#ffb547" fontSize="22" textAnchor="middle" fontFamily="JetBrains Mono" fontWeight="600">Δx = {(xBike - xCar).toFixed(1)} m</text>
            </g>
          )}
        </g>
        {/* v–t 图 */}
        <g opacity={graph}>
          <line x1="540" x2="960" y1="420" y2="420" stroke="#8a93a3" strokeWidth="2" />
          <line x1="560" x2="560" y1="440" y2="110" stroke="#8a93a3" strokeWidth="2" />
          <text x="965" y="440" fill="#c8ced8" fontSize="20" fontStyle="italic" fontFamily="Times New Roman">t/s</text>
          <text x="530" y="118" fill="#c8ced8" fontSize="20" fontStyle="italic" fontFamily="Times New Roman">v</text>
          {tsec.map((i) => <text key={i} x={cx(i)} y="444" fill="#8a93a3" fontSize="14" textAnchor="middle" fontFamily="JetBrains Mono">{i || ''}</text>)}
          <path d={`M${cx(0)} ${cy(6)} L${cx(2)} ${cy(6)} L${cx(0)} ${cy(0)} Z`} fill="#ffb547" opacity={0.32 * shade} />
          <line x1={cx(0)} y1={cy(6)} x2={cx(5)} y2={cy(6)} stroke="#7fb2ff" strokeWidth="4" strokeDasharray="400" strokeDashoffset={400 * (1 - ease((t - 22) / 1.5))} />
          <line x1={cx(0)} y1={cy(0)} x2={cx(5)} y2={cy(15)} stroke="#ff6b5e" strokeWidth="4" strokeDasharray="420" strokeDashoffset={420 * (1 - ease((t - 22.5) / 1.5))} />
          <circle cx={cx(2)} cy={cy(6)} r={7 * ease((t - 24) / 0.6)} fill="#fff" filter="url(#glow)" />
          <line x1={cx(2)} x2={cx(2)} y1={cy(6)} y2="420" stroke="#e6e9ef" strokeDasharray="5 5" opacity={ease((t - 24.2) / 0.8)} />
          <text x={cx(5) + 6} y={cy(15)} fill="#ff8f85" fontSize="18" fontFamily="Noto Sans SC">汽车</text>
          <text x={cx(5) + 6} y={cy(6) + 6} fill="#7fb2ff" fontSize="18" fontFamily="Noto Sans SC">自行车</text>
        </g>
      </svg>

      <div className="anim-step">
        <div className="anim-dots">
          {SCRIPT.map((s, i) => (
            <button key={i} disabled={!canControl} className={i === idx ? 'on' : i < idx ? 'past' : ''} onClick={() => act({ type: 'seek', time: s.at }, DUR)}>
              <i />{s.title}
            </button>
          ))}
        </div>
        <div className="anim-tex">
          {step.tex?.map((s, i) => (
            <span key={s} style={{ opacity: ease((local - 0.6 - i * 1.2) / 0.6), transform: `translateY(${(1 - ease((local - 0.6 - i * 1.2) / 0.6)) * 10}px)` }} dangerouslySetInnerHTML={tex(s)} />
          ))}
        </div>
      </div>
      <div className="anim-cap" key={idx}>{step.caption}</div>
      <div className="anim-ctl">
        <button disabled={!canControl} onClick={() => act({ type: play ? 'pause' : 'play' }, DUR)}>{play ? '暂停' : t >= DUR ? '重播' : '播放'}</button>
        <input aria-label="讲解模板进度" disabled={!canControl} type="range" min={0} max={DUR} step={0.05} value={t} onChange={(e) => act({ type: 'seek', time: +e.target.value }, DUR)} />
        <span className="num">{t.toFixed(0).padStart(2, '0')}s / {DUR}s</span>
      </div>
    </div>
  );
}
