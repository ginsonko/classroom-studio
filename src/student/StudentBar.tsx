// 学生工具条：一枚可拖动的小圆钮 + 可收起的工具条。
// 学生（远程控制时）点任意工具即「接过笔」；老师在浮层里点任意工具收回。
// 位置与收起状态只存在学生窗口本机（localStorage），不进共享状态。
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, PenLine, Trash2, Undo2 } from 'lucide-react';
import { inkKey, useStore } from '../lib/store';
import type { Tool } from '../lib/types';
import { ToolPalette } from '../ui/ToolPalette';
import { barRoom } from '../ui/fit';
import { host } from '../lib/host';

const POS_KEY = 'cs.sbar.pos', OPEN_KEY = 'cs.sbar.open';
const FAB = 44;

function readPos(): { fx: number; fy: number } {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? '');
    if (Number.isFinite(p.fx) && Number.isFinite(p.fy)) return { fx: Math.min(1, Math.max(0, p.fx)), fy: Math.min(1, Math.max(0, p.fy)) };
  } catch { /* 首次使用 */ }
  return { fx: 0.03, fy: 0.88 };
}

interface Props { locked: boolean; writing: boolean; tool: Tool; size: number; onTool: (t: Tool) => void; onSize: (s: number) => void }

export function StudentBar({ locked, writing, tool, size, onTool, onSize }: Props) {
  const [pos, setPos] = useState(readPos);
  // 工具和老师一样多以后整条很长，默认收起成小圆钮，免得挡住板书底部
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [vw, setVw] = useState({ w: innerWidth, h: innerHeight });
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const r = () => setVw({ w: innerWidth, h: innerHeight });
    addEventListener('resize', r);
    return () => removeEventListener('resize', r);
  }, []);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => host.onEvent((e) => {
    if (e?.type !== 'layout' || !e.reset) return;
    localStorage.removeItem(POS_KEY); localStorage.removeItem(OPEN_KEY);
    setPos(readPos()); setOpen(false);
  }), []);

  const claim = () => { if (!locked && useStore.getState().drawAuthor !== 'student') useStore.getState().setShared({ drawAuthor: 'student' }); };
  const pickTool = (t: Tool) => { onTool(t); claim(); };
  const pickSize = (s: number) => { onSize(s); claim(); };
  const key = () => { const st = useStore.getState(); return inkKey(st.pgm.materialId, st.pgm.page); };

  const half = FAB / 2;
  const cx = Math.min(vw.w - half - 6, Math.max(half + 6, pos.fx * vw.w));
  const cy = Math.min(vw.h - half - 6, Math.max(half + 6, pos.fy * vw.h));
  const toLeft = cx > vw.w / 2;

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成事件或指针已释放时没有可捕获的指针 */ }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.moved = true;
    setPos({ fx: e.clientX / innerWidth, fy: e.clientY / innerHeight });
  };
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) localStorage.setItem(POS_KEY, JSON.stringify({ fx: e.clientX / innerWidth, fy: e.clientY / innerHeight }));
    else setOpen((o) => !o);
  };

  const state = locked ? 'locked' : writing ? 'writing' : 'idle';
  const status = locked ? '老师已锁定' : writing ? '学生书写中' : '点工具开始写';
  return (
    <div className={'sbar s-' + state + (toLeft ? ' to-left' : '') + (open ? ' open' : '') + (cy < vw.h * 0.45 ? ' below' : '')} style={toLeft ? { right: vw.w - cx - half, top: cy - half } : { left: cx - half, top: cy - half }}>
      <button
        className="sbar-fab"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { drag.current = null; }}
        aria-label={open ? '收起学生工具' : '展开学生工具'}
        data-tip={(open ? '点一下收起' : '点一下展开学生工具') + ' · 按住可拖动'}
      >
        {locked ? <Lock size={18} /> : <PenLine size={19} />}
        <i className="sbar-caret">{(open !== toLeft) ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}</i>
      </button>
      {open && (
        <div className="sbar-panel" style={{ maxWidth: barRoom(vw.w, cx, half, toLeft) }}>
          <span className="sbar-who"><i />{status}</span>
          <ToolPalette student tool={writing ? tool : ('none' as Tool)} color="student" size={size} onTool={pickTool} onSize={pickSize} disabled={locked} />
          <span className="tp-sep" />
          <button className="tp-b" disabled={locked || !writing} onClick={() => useStore.getState().undo(key(), 'student')} data-tip="撤销我的上一笔"><Undo2 size={17} /></button>
          <button className="tp-b" disabled={locked || !writing} onClick={() => useStore.getState().clearInk(key(), 'student')} data-tip="清除我在这一页写的"><Trash2 size={16} /></button>
        </div>
      )}
    </div>
  );
}
