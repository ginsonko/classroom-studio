import { X } from 'lucide-react';
import { useStore, type BoardSkin, type Pattern, type Skin } from '../lib/store';

const SKINS: { id: Skin; name: string; note: string; sw: string[] }[] = [
  { id: 'graphite', name: '石墨导播台', note: '默认 · 深色演播室', sw: ['#0c0e12', '#1a1e26', '#ff3b30', '#3dd9eb'] },
  { id: 'midnight', name: '午夜蓝', note: '更柔和的深色', sw: ['#0a1020', '#15203d', '#ff5a4e', '#e8c46a'] },
  { id: 'paper', name: '纸感工作室', note: '浅色 · 白天明亮房间', sw: ['#e9e6df', '#fffefb', '#d6352b', '#1a7f86'] },
  { id: 'contrast', name: '高对比', note: '远距离看屏 · 视疲劳', sw: ['#000', '#121212', '#ff2d2d', '#00f0ff'] },
];

const BOARDS: { id: BoardSkin; name: string; note?: string }[] = [
  { id: 'white', name: '纯白' },
  { id: 'ivory', name: '象牙纸' },
  { id: 'wheat', name: '护眼米黄', note: '护眼' },
  { id: 'bean', name: '豆沙绿', note: '护眼' },
  { id: 'sepia', name: '旧书页' },
  { id: 'chalk', name: '墨绿黑板', note: '粉笔' },
  { id: 'slate', name: '石板灰' },
  { id: 'space', name: '深空蓝' },
  { id: 'night', name: '夜间', note: '低亮度' },
];

const PATTERNS: { id: Pattern; name: string }[] = [
  { id: 'none', name: '无' }, { id: 'grid', name: '方格' }, { id: 'dots', name: '点阵' }, { id: 'lines', name: '横线' },
  { id: 'coord', name: '坐标纸' }, { id: 'four', name: '四线三格' }, { id: 'tian', name: '田字格' },
];

export function SkinPicker({ onClose }: { onClose: () => void }) {
  const skin = useStore((s) => s.skin);
  const boardSkin = useStore((s) => s.boardSkin);
  const pattern = useStore((s) => s.pattern);
  const eye = useStore((s) => s.eyeCare);
  const motion = useStore((s) => s.motion);
  const set = useStore((s) => s.set);

  return (
    <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-h"><b>外观</b><span>教师端只有你能看到；黑板皮肤会同步给学生</span><button onClick={onClose} aria-label="关闭"><X size={15} /></button></div>

        <h4>教师端</h4>
        <div className="skins">
          {SKINS.map((s) => (
            <button key={s.id} className={'skin' + (skin === s.id ? ' on' : '')} onClick={() => set({ skin: s.id })}>
              <span className="skin-prev" style={{ background: s.sw[0] }}>
                <i style={{ background: s.sw[1] }} />
                <i style={{ background: s.sw[1] }} className="big" />
                <i style={{ background: s.sw[1] }} />
                <em style={{ background: s.sw[2] }} />
                <em style={{ background: s.sw[3] }} className="c" />
              </span>
              <b>{s.name}</b><span>{s.note}</span>
            </button>
          ))}
        </div>

        <h4>学生画面 · 黑板</h4>
        <div className="boards">
          {BOARDS.map((b) => (
            <button key={b.id} className={'bsk' + (boardSkin === b.id ? ' on' : '')} onClick={() => set({ boardSkin: b.id })}>
              <span className="bsk-prev" data-board={b.id} data-pattern={pattern}>
                <svg viewBox="0 0 120 68"><path d="M14 46c10-22 20-22 28-6s18 16 30-10" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" /><path d="M80 18l24 0M98 12l6 6-6 6" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><text x="16" y="62" fill="var(--ink)" fontSize="10" fontStyle="italic" fontFamily="Times New Roman">v = v₀ + at</text></svg>
              </span>
              <b>{b.name}</b>{b.note && <i>{b.note}</i>}
            </button>
          ))}
        </div>

        <div className="sheet-row">
          <div>
            <h4>底纹</h4>
            <div className="seg wrap">
              {PATTERNS.map((p) => <button key={p.id} className={pattern === p.id ? 'on' : ''} onClick={() => set({ pattern: p.id })}>{p.name}</button>)}
            </div>
          </div>
          <div>
            <h4>护眼滤镜 <span className="num">{Math.round(eye * 100)}%</span></h4>
            <input className="range" type="range" min={0} max={1} step={0.05} value={eye} onChange={(e) => set({ eyeCare: +e.target.value })} />
            <p className="sheet-note">学生画面整体偏暖、降低亮度。</p>
          </div>
          <div>
            <h4>动效</h4>
            <div className="seg">
              <button className={motion ? 'on' : ''} onClick={() => set({ motion: true })}>开</button>
              <button className={!motion ? 'on' : ''} onClick={() => set({ motion: false })}>关</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
