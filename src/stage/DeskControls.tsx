// 学生画面上的三样小控件：左边「打开的课件」切换栏、右边页面缩略图、右下角翻页和放大。
// 都可以收起成一枚小标签，展开状态只记在本机。
import { useEffect, useRef, useState } from 'react';
import { AppWindow, ChevronLeft, ChevronRight, Columns2, GalleryVertical, Layers, Plus, Presentation, Scan, X, ZoomIn, ZoomOut, Atom, Globe, Image as ImageIcon, FileText, PanelTop } from 'lucide-react';
import { ROLE, defaultView, stepView, useStore } from '../lib/store';
import { BASE, deskOrder, pageLabel, panRegion, zoomRegion } from '../lib/desk';
import type { DeskWin, Material } from '../lib/types';
import { PageThumb, usePageImage } from '../ui/PageThumb';
import { hiddenFromStudent } from '../doc/answers';
import { curStageAspect } from './Desk';

function useOpen(key: string, init: boolean) {
  const [open, setOpen] = useState(() => { const v = localStorage.getItem(key); return v === null ? init : v === '1'; });
  useEffect(() => { localStorage.setItem(key, open ? '1' : '0'); }, [key, open]);
  return [open, setOpen] as const;
}

const KIND_ICON: Partial<Record<Material['kind'], typeof FileText>> = { board: Presentation, sim: Atom, html: Globe, image: ImageIcon, slides: PanelTop };

/** 一项课件的小预览：有图的页用缩略图，黑板 / 演示 / 网页用图标 */
function DeskThumb({ w }: { w: DeskWin }) {
  const ref = useRef<HTMLSpanElement>(null);
  const page = w.mat.pages[Math.min(w.view.page, w.mat.pages.length - 1)];
  const hide = ROLE === 'student' && hiddenFromStudent(w.mat, w.view.page, useStore.getState().revealed, useStore.getState().answerGuard !== false);
  const url = usePageImage(ref, page, 72, hide);
  const I = KIND_ICON[w.mat.kind] ?? FileText;
  return (
    <span ref={ref} className={'drail-th k-' + w.mat.kind}>
      {url ? <img src={url} alt="" draggable={false} /> : <I size={18} strokeWidth={1.7} />}
    </span>
  );
}

export function DeskRail({ canArrange }: { canArrange: boolean }) {
  const desk = useStore((s) => s.desk);
  const pgm = useStore((s) => s.pgm);
  const pgmMat = useStore((s) => s.pgmMat);
  const [open, setOpen] = useOpen('cs.desk.rail', false);
  const list = deskOrder(desk.map((w) => (w.id === pgmMat.id ? { ...w, mat: pgmMat, view: pgm } : w)));
  const docs = desk.filter((w) => w.id !== BASE).length;
  const st = () => useStore.getState();
  if (!open) {
    return (
      <button className="drail-tab" onClick={() => setOpen(true)} data-tip="打开的课件 · 点开快速切换（各自记住页码）" aria-label="展开打开的课件">
        <Layers size={16} />
        <b className="num">{list.length}</b>
        <ChevronRight size={12} />
      </button>
    );
  }
  return (
    <aside className="drail" aria-label="打开的课件">
      <header>
        <Layers size={14} /><span>打开的课件</span><b className="num">{list.length}</b>
        <button onClick={() => setOpen(false)} data-tip="收起" aria-label="收起切换栏"><ChevronLeft size={15} /></button>
      </header>
      <div className="drail-list">
        {list.map((w) => {
          const cur = w.id === pgmMat.id;
          const state = cur ? '正在看' : w.id === BASE ? '垫底' : w.mode === 'min' ? '已收起' : w.mode === 'normal' ? '窗口' : '';
          return (
            <div key={w.id} className={'drail-it' + (cur ? ' cur' : '') + (w.mode === 'min' ? ' min' : '')}>
              <button className="drail-go" disabled={!canArrange && !cur} onClick={() => st().focusWin(w.id)} data-tip={cur ? '这一项正在显示' : '切到这一项（回到上次那页）'}>
                <DeskThumb w={w} />
                <span className="drail-txt">
                  <b title={w.mat.title}>{w.mat.title}</b>
                  <small><span className="num">{pageLabel(w.mat, w.view)}</span>{state && <i>{state}</i>}</small>
                </span>
              </button>
              {canArrange && w.id !== BASE && <button className="drail-x" onClick={() => st().closeWin(w.id)} data-tip="关闭" aria-label={'关闭 ' + w.mat.title}><X size={13} /></button>}
            </div>
          );
        })}
      </div>
      {canArrange && (
        <footer>
          {ROLE !== 'student' && <button onClick={() => st().newBoard()} data-tip="再开一块空白黑板"><Plus size={13} />新黑板</button>}
          <button disabled={docs < 2} onClick={() => st().tileWins()} data-tip={docs < 2 ? '打开两个以上课件后可以并排' : '当前课件和最近用过的课件并排摆开（最多 4 个）'}><Columns2 size={13} />并排</button>
          {pgmMat.id !== BASE && <button onClick={() => st().setWin(pgmMat.id, { mode: (desk.find((w) => w.id === pgmMat.id)?.mode === 'normal' ? 'max' : 'normal') })} data-tip="当前课件在「占满画面」和「浮动窗口」之间切换"><AppWindow size={13} />{desk.find((w) => w.id === pgmMat.id)?.mode === 'normal' ? '占满' : '窗口'}</button>}
        </footer>
      )}
    </aside>
  );
}

/** 翻到某一页：放大取景时回到这份课件默认的显示方式 */
export function goPage(i: number) {
  const st = useStore.getState(), m = st.pgmMat, v = st.pgm;
  const page = Math.max(0, Math.min(m.pages.length - 1, i));
  const fit = v.fit === 'region' ? defaultView(m).fit : v.fit;
  st.setShared({ pgm: { ...v, page, slide: 0, fit, region: undefined }, selectedInk: null });
}

export function PagePanel({ canPage }: { canPage: boolean }) {
  const pgm = useStore((s) => s.pgm);
  const mat = useStore((s) => s.pgmMat);
  const revealed = useStore((s) => s.revealed);
  const guard = useStore((s) => s.answerGuard !== false);
  const [open, setOpen] = useOpen('cs.desk.pages', false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) list.current?.querySelector('.pthumb.on')?.scrollIntoView({ block: 'nearest' }); }, [open, pgm.page]);
  if (mat.pages.length < 2) return null;
  if (!open) {
    return (
      <button className="dpages-tab" onClick={() => setOpen(true)} data-tip="页面缩略图 · 点开选页" aria-label="展开页面缩略图">
        <ChevronLeft size={12} />
        <GalleryVertical size={15} />
        <b className="num">{pgm.page + 1}</b>
      </button>
    );
  }
  return (
    <aside className="dpages" aria-label="页面缩略图">
      <header>
        <GalleryVertical size={14} /><span className="num">{pgm.page + 1} / {mat.pages.length}</span>
        <button onClick={() => setOpen(false)} data-tip="收起" aria-label="收起页面缩略图"><ChevronRight size={15} /></button>
      </header>
      <div className="dpages-list" ref={list}>
        {mat.pages.map((p, i) => {
          const hide = ROLE === 'student' && hiddenFromStudent(mat, i, revealed, guard);
          return <PageThumb key={mat.id + i} page={p} n={i + 1} width={112} active={i === pgm.page} hide={hide} mark={hide ? '答案' : undefined} onPick={() => canPage && goPage(i)} />;
        })}
      </div>
    </aside>
  );
}

/** 放大 / 缩小当前项：factor > 1 放大；cx, cy 是页面坐标（不给就以画面中心为准） */
export function zoomBy(factor: number, cx = -1, cy = -1) {
  const st = useStore.getState(), m = st.pgmMat, v = st.pgm;
  if (m.kind === 'html' || m.kind === 'sim' || m.kind === 'video' || m.kind === 'audio') return;
  const page = m.pages[Math.min(v.page, m.pages.length - 1)];
  if (!page) return;
  const r = zoomRegion(v, page, factor, curStageAspect(), cx, cy);
  st.setShared({ pgm: r ? { ...v, fit: 'region', region: r } : { ...v, fit: defaultView(m).fit, region: undefined } });
}

export function resetZoom() {
  const st = useStore.getState();
  if (st.pgm.fit === 'region') st.setShared({ pgm: { ...st.pgm, fit: defaultView(st.pgmMat).fit, region: undefined } });
}

export function ZoomBar({ canPage }: { canPage: boolean }) {
  const pgm = useStore((s) => s.pgm);
  const mat = useStore((s) => s.pgmMat);
  const zoomable = !(mat.kind === 'html' || mat.kind === 'sim' || mat.kind === 'video' || mat.kind === 'audio');
  const zoomed = pgm.fit === 'region' && !!pgm.region;
  const pct = zoomed ? Math.round(100 / pgm.region![2]) : 100;
  const label = pageLabel(mat, pgm);
  const st = () => useStore.getState();
  const map = useRef<HTMLDivElement>(null);
  const pan = (e: React.PointerEvent) => {
    const el = map.current, r = st().pgm.region; if (!el || !r) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    const B = el.getBoundingClientRect();
    const to = (ev: { clientX: number; clientY: number }) => {
      const cur = st().pgm.region; if (!cur) return;
      const cx = (ev.clientX - B.left) / B.width, cy = (ev.clientY - B.top) / B.height;
      st().setShared({ pgm: { ...st().pgm, region: panRegion(cur, cx - cur[0] - cur[2] / 2, cy - cur[1] - cur[3] / 2) } });
    };
    to(e);
    const target = e.currentTarget as HTMLElement;
    let t = 0;
    const move = (ev: PointerEvent) => { const now = performance.now(); if (now - t < 40) return; t = now; to(ev); };
    const up = (ev: PointerEvent) => { to(ev); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up);
  };
  if (!canPage && !label) return null;
  const page = mat.pages[Math.min(pgm.page, mat.pages.length - 1)];
  const ratio = page ? page.h / page.w : 9 / 16;
  return (
    <div className="dzoom">
      {zoomed && canPage && (
        <div className="dzoom-map" ref={map} style={{ height: Math.min(110, 120 * ratio) }} onPointerDown={pan} data-tip="拖动小框查看放大后的其它地方">
          <i style={{ left: pgm.region![0] * 100 + '%', top: pgm.region![1] * 100 + '%', width: pgm.region![2] * 100 + '%', height: Math.min(1, pgm.region![3]) * 100 + '%' }} />
        </div>
      )}
      <div className="dzoom-row">
        {label && <>
          {canPage && <button onClick={() => st().setShared({ pgm: stepView(st().pgmMat, st().pgm, -1), selectedInk: null })} data-tip="上一页　← / PageUp" aria-label="上一页"><ChevronLeft size={16} /></button>}
          <b className="num">{label}</b>
          {canPage && <button onClick={() => st().setShared({ pgm: stepView(st().pgmMat, st().pgm, 1), selectedInk: null })} data-tip="下一页　→ / PageDown" aria-label="下一页"><ChevronRight size={16} /></button>}
        </>}
        {canPage && zoomable && <>
          {label && <span className="dzoom-sep" />}
          <button onClick={() => zoomBy(1 / 1.4)} disabled={!zoomed} data-tip="缩小　Ctrl + 滚轮" aria-label="缩小"><ZoomOut size={15} /></button>
          <button className="dzoom-pct num" onClick={resetZoom} disabled={!zoomed} data-tip={zoomed ? '回到整页' : '当前是整页'}>{zoomed ? pct + '%' : <Scan size={14} />}</button>
          <button onClick={() => zoomBy(1.4)} data-tip="放大　Ctrl + 滚轮；放大后滚轮可以平移" aria-label="放大"><ZoomIn size={15} /></button>
        </>}
      </div>
    </div>
  );
}

/** 滚轮：Ctrl + 滚轮以鼠标处为中心放大缩小；已放大时普通滚轮平移 */
export function deskWheel(e: React.WheelEvent) {
  const st = useStore.getState(), v = st.pgm, m = st.pgmMat;
  const stage = (e.currentTarget as HTMLElement).querySelector('.page') as HTMLElement | null;
  if (e.ctrlKey) {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width, cy = (e.clientY - r.top) / r.height;
    zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, Math.min(1, Math.max(0, cx)), Math.min(1, Math.max(0, cy)));
    return;
  }
  if (v.fit === 'region' && v.region && m.kind !== 'html') {
    const k = 0.0009 * v.region[2];
    st.setShared({ pgm: { ...v, region: panRegion(v.region, (e.shiftKey ? e.deltaY : e.deltaX) * k, (e.shiftKey ? 0 : e.deltaY) * k) } });
  }
}

