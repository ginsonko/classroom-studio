import { useEffect, useState } from 'react';
import { useGuideSignals } from './hits';
import '../styles/guide.css';

/** 找要点的按钮。「a || b」：a 还没出现（比如面板没打开）时先点亮 b */
export function findSpot(sel: string): Element | null {
  for (const one of sel.split('||')) {
    let el: Element | null = null;
    try { el = document.querySelector(one.trim()); } catch { el = null; }
    const r = el?.getBoundingClientRect();
    if (r && r.width >= 2 && r.height >= 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) return el;
  }
  return null;
}

/** 彩排时把要点的按钮圈出来（不挡鼠标）。按钮不在这个窗口里、或者还没出现时不画 */
export function GuideSpot({ win }: { win: 'teacher' | 'dock' }) {
  const spot = useGuideSignals((s) => s.spot);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const sel = spot?.win === win ? spot.sel : '';
  useEffect(() => {
    if (!sel) { setBox(null); return; }
    const find = () => {
      const r = findSpot(sel)?.getBoundingClientRect();
      setBox((old) => {
        if (!r) return null;
        const next = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        return old && old.x === next.x && old.y === next.y && old.w === next.w && old.h === next.h ? old : next;
      });
    };
    find();
    const t = setInterval(find, 300);
    return () => clearInterval(t);
  }, [sel]);
  if (!box) return null;
  // 浮层窗口紧贴着工具栏，框要收在窗口里面
  const pad = 4, left = Math.max(1, box.x - pad), top = Math.max(1, box.y - pad);
  const right = Math.min(innerWidth - 1, box.x + box.w + pad), bottom = Math.min(innerHeight - 1, box.y + box.h + pad);
  return <div className="guide-spot" aria-hidden style={{ left, top, width: right - left, height: bottom - top }} />;
}
