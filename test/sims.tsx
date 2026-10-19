// 物理预设视觉 QA 截图页（由 vite 在 5296 端口托管）。
//   ?p=incline&t=f0.5&skin=ivory&ctl=0     单格满窗：t 以 f 开头表示时长比例，否则为秒
//   ?p=belt-h,incline&t=f0,f0.5,f1&grid=1&cw=640   网格模式（人工浏览用）
//   &pp=mu:0.2,th:37  覆盖参数；&tag=0 隐藏角标
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import 'katex/dist/katex.min.css';
import '../src/styles/tokens.css';
import { createRoot } from 'react-dom/client';
import { useStore, type BoardSkin } from '../src/lib/store';
import { SimHost } from '../src/physics/SimHost';
import { initialSync, useLocalSims } from '../src/physics/sim/clock';
import { buildPreset, PRESETS } from '../src/physics/sim/presets';
import type { Material } from '../src/lib/types';

const q = new URLSearchParams(location.search);
const ids = (q.get('p') ?? PRESETS.map((p) => p.id).join(',')).split(',').filter(Boolean);
const times = (q.get('t') ?? 'f0.5').split(',');
const skin = (q.get('skin') ?? 'ivory') as BoardSkin;
const grid = q.get('grid') === '1';
const cw = +(q.get('cw') ?? 640);
const showTag = q.get('tag') !== '0';
const showCtl = q.get('ctl') === '1';
const pp = Object.fromEntries((q.get('pp') ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k, +v]; }));
useStore.setState({ boardSkin: skin });

const cells: { mat: Material; label: string }[] = [];
for (const id of ids) {
  const sc = buildPreset(id, pp);
  if (!sc) { console.warn('unknown preset', id); continue; }
  times.forEach((ts, i) => {
    const t = ts.startsWith('f') ? +ts.slice(1) * (sc.duration ?? 5) : +ts;
    const mat: Material = { id: `sim:qa-${id}-${i}-${JSON.stringify(pp)}`, kind: 'sim', title: sc.title ?? id, pages: [{ w: 1600, h: 900 }], total: 1, scene: sc };
    const s0 = initialSync(mat);
    useLocalSims.getState().put({ ...s0, playing: false, offset: Math.max(0, t) });
    cells.push({ mat, label: `${id} · t=${t.toFixed(2)}s` });
  });
}

function App() {
  return (
    <>
      {cells.map((c) => (
        <div key={c.mat.id} className="shot" data-board={skin}
          style={grid ? { width: cw, height: (cw * 9) / 16 } : undefined}>
          <SimHost mat={c.mat} controls={showCtl} />
          {showTag && <span className="tag">{c.label}</span>}
        </div>
      ))}
    </>
  );
}

if (grid) document.getElementById('root')!.className = 'grid';
Promise.all([
  document.fonts.load('600 20px "Inter Variable"'),
  document.fonts.load('400 20px "JetBrains Mono"'),
  document.fonts.load('600 20px "JetBrains Mono"'),
  document.fonts.load('italic 600 20px "Times New Roman"'),
]).finally(() => createRoot(document.getElementById('root')!).render(<App />));
