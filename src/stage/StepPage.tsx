import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DocPage } from '../doc/DocPage';
import { framePage, framesAt } from '../lib/slideSteps';
import type { Material, PageInfo } from '../lib/types';

type Layer = { id: number; key: string; page: PageInfo; fade: boolean };

/**
 * PPT 分步的一页：显示按了 clicks 下之后的画面。刚往前按了一下时新画面淡入，
 * 同一下里有「之后自动出现」的几帧就按间隔接着放；往回退、跳页直接显示。
 */
export function StepPage({ mat, page, index, clicks, audible }: { mat: Material; page: PageInfo; index: number; clicks: number; audible: boolean }) {
  const frames = framesAt(page, clicks);
  const last = useRef<{ index: number; clicks: number } | null>(null);
  const forward = !!last.current && last.current.index === index && clicks === last.current.clicks + 1;
  const [sub, setSub] = useState(frames.length - 1);
  const [layers, setLayers] = useState<Layer[]>([]);
  const seq = useRef(0);

  // 这一页的分步画面先读进内存，按下去马上能显示
  useEffect(() => {
    for (const f of page.steps ?? []) if (f.src) { const img = new Image(); img.decoding = 'async'; img.src = f.src; }
  }, [page]);

  useLayoutEffect(() => {
    last.current = { index, clicks };
    if (!forward || frames.length < 2) { setSub(frames.length - 1); return; }
    setSub(0);
    let i = 0, timer = 0;
    const next = () => { i++; if (i < frames.length) timer = window.setTimeout(() => { setSub(i); next(); }, frames[i].wait); };
    next();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, clicks]);

  const shown = sub < frames.length ? sub : frames.length - 1;
  const target = framePage(page, frames[shown]);
  const key = target.src ?? (target.doc ? target.doc.pdf + '#' + target.doc.index : 'page:' + index);
  const fade = forward || shown > 0;
  useLayoutEffect(() => {
    setLayers((cur) => (cur[cur.length - 1]?.key === key ? cur : [...cur.slice(-1), { id: ++seq.current, key, page: target, fade: cur.length > 0 && fade }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // 淡入结束后只留最上面一层
  useEffect(() => {
    if (layers.length < 2) return;
    const t = window.setTimeout(() => setLayers((cur) => cur.slice(-1)), 360);
    return () => clearTimeout(t);
  }, [layers]);

  return <>
    {layers.map((l) => (
      <div key={l.id} className={'step-layer' + (l.fade ? ' in' : '')}>
        <DocPage mat={mat} page={l.page} index={index} audible={audible} />
      </div>
    ))}
  </>;
}
