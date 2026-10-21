// 学生画面的「桌面」：黑板垫底，课件可以占满画面，也可以变成浮在黑板上的窗口（拖动、四边缩放、并排）。
// 学生窗口和教师端的学生画面监视器都用它，两边看到的一模一样。
import { useRef, useState, type CSSProperties } from 'react';
import { Maximize2, Minus, PictureInPicture2, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { BASE, pageLabel, visibleLayers } from '../lib/desk';
import type { Author, DeskWin, Tool } from '../lib/types';
import { Stage } from './Stage';
import { seekLong } from './longNav';
import '../styles/desk.css';

type Rect = DeskWin['rect'];
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Edge = typeof EDGES[number] | 'move';

export interface DeskProps {
  author: Author; tool: Tool; color: string; size: number;
  /** 能不能挪窗口、切换、关闭（学生工具锁定时只能看） */
  canArrange: boolean;
  /** 教师端监视器里是缩小显示：标题栏更矮 */
  compact?: boolean;
  onWheel?: (e: React.WheelEvent) => void;
}

/** 窗口位置限制在画面里：至少露出标题栏，不能缩到太小 */
export function clampRect([x, y, w, h]: Rect): Rect {
  w = Math.min(1, Math.max(0.12, w)); h = Math.min(1, Math.max(0.12, h));
  return [Math.min(1 - 0.06, Math.max(-w + 0.08, x)), Math.min(1 - 0.05, Math.max(0, y)), w, h];
}

export function Desk({ author, tool, color, size, canArrange, compact, onWheel }: DeskProps) {
  const desk = useStore((s) => s.desk);
  const pgm = useStore((s) => s.pgm);
  const pgmMat = useStore((s) => s.pgmMat);
  const box = useRef<HTMLDivElement>(null);
  // 拖动 / 缩放过程中只改本地，松手再同步（不刷屏）
  const [live, setLive] = useState<{ id: string; rect: Rect } | null>(null);
  const L = visibleLayers(desk, pgmMat, pgm);
  const st = () => useStore.getState();

  const start = (w: DeskWin, edge: Edge) => (e: React.PointerEvent) => {
    if (!canArrange || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = box.current; if (!el) return;
    const B = el.getBoundingClientRect(), r0 = w.rect, x0 = e.clientX, y0 = e.clientY;
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    if (w.id !== pgmMat.id) st().focusWin(w.id);
    let last: Rect = r0, moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / B.width, dy = (ev.clientY - y0) / B.height;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      let [x, y, ww, hh] = r0;
      if (edge === 'move') { x += dx; y += dy; }
      else {
        if (edge.includes('e')) ww += dx;
        if (edge.includes('s')) hh += dy;
        if (edge.includes('w')) { const nw = Math.max(0.12, ww - dx); x += ww - nw; ww = nw; }
        if (edge.includes('n')) { const nh = Math.max(0.12, hh - dy); y += hh - nh; hh = nh; }
      }
      last = clampRect([x, y, ww, hh]);
      setLive({ id: w.id, rect: last });
    };
    const up = () => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
      if (moved) st().setWin(w.id, { rect: last });
      setLive(null);
    };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  };

  const stageFor = (w: DeskWin, cur: boolean) => (
    <Stage
      key={w.id}
      scope="program"
      mat={cur ? pgmMat : w.mat}
      view={cur ? pgm : w.view}
      author={author}
      tool={cur ? tool : 'pointer'}
      color={color}
      size={size}
      inkEnabled={cur}
      overlays={cur}
      boardFill
      onWheel={cur ? onWheel : undefined}
      onSeek={cur && canArrange ? seekLong : undefined}
    />
  );

  if (L.full) {
    return (
      <div className={'desk' + (compact ? ' compact' : '')} ref={box} data-desk-cur={L.full.id}>
        <div className="desk-full" data-cur-stage>{stageFor(L.full, true)}</div>
        {canArrange && L.full.id !== BASE && (
          <div className="desk-fullbar">
            <button onClick={() => st().setWin(L.full!.id, { mode: 'normal' })} data-tip="变成窗口 · 浮在黑板上，可拖动、拖边缩放、并排"><PictureInPicture2 size={compact ? 11 : 14} /></button>
            <button onClick={() => st().setWin(L.full!.id, { mode: 'min' })} data-tip="收起 · 回到黑板，在左侧切换栏里点它再打开"><Minus size={compact ? 11 : 14} /></button>
            <button onClick={() => st().closeWin(L.full!.id)} data-tip="关闭这个课件"><X size={compact ? 11 : 14} /></button>
          </div>
        )}
      </div>
    );
  }

  const base = L.base;
  const baseCur = base?.id === pgmMat.id;
  return (
    <div className={'desk' + (compact ? ' compact' : '')} ref={box} data-desk-cur={pgmMat.id}>
      {base && (
        <div className="desk-base" data-cur-stage={baseCur ? '' : undefined}>
          {stageFor(base, baseCur)}
          {!baseCur && canArrange && <div className="desk-catch" onPointerDown={() => st().focusWin(BASE)} data-tip="点一下回到黑板书写" />}
        </div>
      )}
      {/* DOM 顺序保持不变（按 id），叠放靠 z-index：拖动时节点不被挪动，指针捕获才不会丢 */}
      {[...L.floating].sort((a, b) => (a.id < b.id ? -1 : 1)).map((w) => {
        const i = L.floating.indexOf(w);
        const cur = w.id === pgmMat.id;
        const [x, y, ww, hh] = live?.id === w.id ? live.rect : w.rect;
        const style: CSSProperties = { left: x * 100 + '%', top: y * 100 + '%', width: ww * 100 + '%', height: hh * 100 + '%', zIndex: 10 + i };
        const mat = cur ? pgmMat : w.mat;
        return (
          <div key={w.id} className={'dwin' + (cur ? ' cur' : '')} style={style} data-win={w.id}>
            <div className="dwin-bar" onPointerDown={start(w, 'move')} onDoubleClick={() => { if (!canArrange) return; st().setWin(w.id, { mode: 'max' }); st().focusWin(w.id); }}>
              <span className="dwin-t" title={mat.title}>{mat.title}</span>
              <span className="dwin-p num">{pageLabel(mat, cur ? pgm : w.view)}</span>
              {canArrange && (
                <span className="dwin-btns" onPointerDown={(e) => e.stopPropagation()}>
                  <button onClick={() => st().setWin(w.id, { mode: 'min' })} data-tip="收起到侧边切换栏" aria-label="收起"><Minus size={compact ? 10 : 13} /></button>
                  <button onClick={() => { st().setWin(w.id, { mode: 'max' }); st().focusWin(w.id); }} data-tip="占满画面（双击标题栏也可以）" aria-label="占满"><Maximize2 size={compact ? 10 : 12} /></button>
                  <button className="x" onClick={() => st().closeWin(w.id)} data-tip="关闭" aria-label="关闭"><X size={compact ? 10 : 13} /></button>
                </span>
              )}
            </div>
            <div className="dwin-body" data-cur-stage={cur ? '' : undefined}>
              {stageFor(w, cur)}
              {!cur && <div className="desk-catch" onPointerDown={() => canArrange && st().focusWin(w.id)} />}
            </div>
            {canArrange && EDGES.map((e) => <i key={e} className={'dwin-rz rz-' + e} onPointerDown={start(w, e)} />)}
          </div>
        );
      })}
    </div>
  );
}

/** 当前操作项所在的画面框（放大时按它的宽高比取景） */
export function curStageAspect(root: ParentNode = document): number {
  const el = root.querySelector('[data-cur-stage]') as HTMLElement | null;
  if (!el || !el.clientHeight) return innerWidth / Math.max(1, innerHeight);
  return el.clientWidth / el.clientHeight;
}
