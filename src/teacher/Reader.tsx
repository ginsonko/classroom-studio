import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns2, EyeOff, Link2, Minus, MonitorUp, Plus, ScanLine, SquareDashed, X, SlidersHorizontal } from 'lucide-react';
import { prepareMaterial, rememberMaterial } from '../lib/library';
import { defaultView, stepView, useStore } from '../lib/store';
import type { FitMode, Material, View } from '../lib/types';
import { useLib } from '../lib/useLib';
import { host } from '../lib/host';
import { MockPage, Stage } from '../stage/Stage';
import { DocPage } from '../doc/DocPage';
import { analyseSlides } from '../doc/pdf';
import { clampRegion, intersect, type Rect } from '../doc/geometry';
import { regionMaterial } from '../doc/region';
import { cancelMaterialLoad, claimMaterialTarget, reportMaterialError, useMaterialLoad } from '../doc/actions';
import '../styles/doc.css';

const FITS: { id: FitMode; name: string; tip: string }[] = [
  { id: 'width', name: '适宽', tip: '按宽度铺满，连续滚动跨页' },
  { id: 'page', name: '整页', tip: '一页完整显示' },
  { id: 'slides', name: '幻灯片', tip: '按需识别当前文档中的幻灯片分隔；可手工调整' },
];

export function Reader() {
  const reader = useStore((s) => s.reader), pgm = useStore((s) => s.pgm), pgmMat = useStore((s) => s.pgmMat);
  const lib = useLib((s) => s.lib), active = useMaterialLoad((s) => s.active);
  const [split, setSplit] = useState(false), [follow, setFollow] = useState(true), [pairMat, setPairMat] = useState<Material | null>(null);
  const [busy, setBusy] = useState(''), [manual, setManual] = useState(false);
  const analysis = useRef(0);
  const { mat, view } = reader;
  const pairFile = mat.pairId ? lib?.files.get(mat.pairId) : null;
  const staticPages = mat.pages.some((p) => p.doc || p.src) || (!host.electron && ['pdf', 'word', 'slides', 'image'].includes(mat.kind));
  const setView = (p: Partial<View>) => {
    const now = useStore.getState();
    if (now.reader.mat.id !== mat.id) return;
    now.set({ reader: { ...now.reader, view: { ...now.reader.view, ...p, page: Math.max(0, Math.min(p.page ?? now.reader.view.page, mat.pages.length - 1)) } } });
  };
  useEffect(() => {
    let alive = true; setPairMat(null);
    if (pairFile) void prepareMaterial(pairFile).then((p) => { if (alive) setPairMat(p); }, (e) => { if (alive) reportMaterialError(e, '解析配对'); });
    return () => { alive = false; };
  }, [pairFile?.id]);
  useEffect(() => { analysis.current++; setBusy(''); setManual(false); setSplit(false); }, [mat.id]);
  const swap = () => {
    if (!pairMat) return;
    cancelMaterialLoad('teacher');
    useStore.getState().set({ reader: { mat: pairMat, view: defaultView(pairMat, { page: Math.min(view.page, pairMat.pages.length - 1), fit: view.fit, slide: view.slide }), split: null } });
  };
  const following = follow && pgmMat.pairId === mat.id;
  useEffect(() => {
    if (following) setView({ page: Math.min(pgm.page, mat.pages.length - 1), slide: Math.min(pgm.slide, (mat.pages[Math.min(pgm.page, mat.pages.length - 1)]?.slides?.length ?? 1) - 1) });
  }, [following, pgm.page, pgm.slide, mat.id]);

  const chooseFit = async (fit: FitMode) => {
    if (fit !== 'slides' || !staticPages || mat.pages.every((p) => p.slides)) { setView({ fit, zoom: 1, slide: 0 }); return; }
    const ticket = ++analysis.current; setBusy('正在分析本文件中的幻灯片分隔…');
    try {
      const pages = await analyseSlides(mat.pages, (n, total) => { if (ticket === analysis.current) setBusy(`正在分析幻灯片 ${n} / ${total}`); }, () => ticket === analysis.current);
      if (ticket !== analysis.current || useStore.getState().reader.mat.id !== mat.id) return;
      const next = rememberMaterial({ ...mat, pages }), now = useStore.getState();
      now.set({ reader: { ...now.reader, mat: next, view: { ...now.reader.view, fit: 'slides', slide: 0, zoom: 1 } } });
    } catch (e) { if (ticket === analysis.current) reportMaterialError(e, '幻灯片切分'); }
    finally { if (ticket === analysis.current) setBusy(''); }
  };
  const publish = (target: 'student' | 'cue') => {
    cancelMaterialLoad(target);
    if (target === 'student') useStore.getState().showNow(mat, { ...view }); else useStore.getState().cue(mat, { ...view });
  };

  return <div className="reader">
    {active && <div className={'material-status' + (active.error ? ' error' : '')} role="status"><span><b>{active.name}</b>{active.error || active.message}</span><button onClick={() => cancelMaterialLoad(active.target)}>{active.error ? '关闭' : '取消'}</button></div>}
    <div className="rd-bar">
      <span className="rd-private" data-tip="这里是你的私人阅读器，学生看不到"><EyeOff size={13} />老师</span>
      <span className="rd-title" title={mat.title}>{mat.title}</span>
      {pairMat && <div className="seg"><button className={mat.pairRole === 'question' ? 'on' : ''} onClick={() => mat.pairRole !== 'question' && swap()}>原卷</button><button className={mat.pairRole === 'answer' ? 'on' : ''} onClick={() => mat.pairRole !== 'answer' && swap()}>解析</button></div>}
      {pairMat && <button className={'rd-tog' + (split ? ' on' : '')} onClick={() => setSplit(!split)} data-tip="原卷和解析左右对照"><Columns2 size={15} /></button>}
      {pgmMat.pairId === mat.id && <button className={'rd-tog follow' + (follow ? ' on' : '')} onClick={() => setFollow(!follow)} data-tip="跟随学生当前页"><Link2 size={14} />{follow ? '跟随中' : '跟随'}</button>}
      <span className="rd-flex" />
      <div className="seg">{FITS.filter((f) => f.id !== 'slides' || staticPages).map((f) => <button key={f.id} disabled={!!busy} className={view.fit === f.id || (f.id === 'width' && view.fit === 'region') ? 'on' : ''} onClick={() => void chooseFit(f.id)} data-tip={f.tip}>{f.name}</button>)}</div>
      {view.fit === 'slides' && <button className={'rd-tog' + (manual ? ' on' : '')} onClick={() => setManual(!manual)} data-tip="手工调整当前幻灯片边界"><SlidersHorizontal size={14} /></button>}
      <div className="rd-zoom"><button onClick={() => setView({ zoom: Math.max(.4, +(view.zoom - .1).toFixed(2)) })} aria-label="缩小"><Minus size={13} /></button><span className="num">{Math.round(view.zoom * 100)}%</span><button onClick={() => setView({ zoom: Math.min(3, +(view.zoom + .1).toFixed(2)) })} aria-label="放大"><Plus size={13} /></button></div>
    </div>
    {busy && <div className="rd-busy">{busy}<button onClick={() => { analysis.current++; setBusy(''); }} style={{ marginLeft: 12 }}>取消分析</button></div>}
    {manual && <ManualSplit key={mat.id + ':' + view.page + ':' + view.slide} mat={mat} view={view} />}
    <div className={'rd-body' + (split && pairMat ? ' split' : '')}>
      <Pane mat={mat} view={view} setView={setView} following={following} />
      {split && pairMat && <Pane mat={pairMat} view={{ ...view, materialId: pairMat.id, page: Math.min(view.page, pairMat.pages.length - 1) }} setView={() => {}} following={following} secondary />}
    </div>
    <div className="rd-foot">
      <button onClick={() => setView(stepView(mat, view, -1))} aria-label="上一页"><ChevronLeft size={16} /></button>
      <PageNumber mat={mat} view={view} onPage={(page) => setView({ page, slide: 0 })} />
      <button onClick={() => setView(stepView(mat, view, 1))} aria-label="下一页"><ChevronRight size={16} /></button>
      <Filmstrip mat={mat} view={view} onPick={(page, slide) => setView({ page, slide })} />
      <button className="btn-cue" onClick={() => publish('cue')} data-tip="放到预监，按 Enter 切给学生">放预监</button>
      <button className="btn-live" onClick={() => publish('student')} data-tip="立刻展示给学生"><MonitorUp size={14} /><span>上屏这一页</span></button>
    </div>
  </div>;
}

function PageNumber({ mat, view, onPage }: { mat: Material; view: View; onPage: (n: number) => void }) {
  const [text, setText] = useState(String(view.page + 1));
  useEffect(() => setText(String(view.page + 1)), [view.page, mat.id]);
  const commit = () => { const n = Number(text); if (Number.isInteger(n) && n >= 1 && n <= mat.pages.length) onPage(n - 1); else setText(String(view.page + 1)); };
  return <span className="num rd-pg"><input aria-label="跳到页码" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); commit(); } }} />{view.fit === 'slides' ? `-${view.slide + 1}` : ''}<i> / {mat.total}</i></span>;
}

function ManualSplit({ mat, view }: { mat: Material; view: View }) {
  const page = mat.pages[view.page], box = page.slides?.[view.slide] ?? [0, 0, 1, 1];
  const [values, setValues] = useState(box.map((n) => String(Math.round(n * 1000) / 10)));
  const apply = (boxes: number[][], slide = 0) => {
    const pages = mat.pages.map((p, i) => i === view.page ? { ...p, slides: boxes } : p), next = rememberMaterial({ ...mat, pages }), st = useStore.getState();
    if (st.reader.mat.id === mat.id) st.set({ reader: { ...st.reader, mat: next, view: { ...st.reader.view, fit: 'slides', slide } } });
  };
  return <div className="rd-manual"><span>当前页切分</span>{['左', '上', '宽', '高'].map((label, i) => <label key={label}>{label} <input type="number" value={values[i]} min="0" max="100" step=".1" onChange={(e) => setValues(values.map((v, k) => k === i ? e.target.value : v))} />%</label>)}
    <button onClick={() => { const b = clampRegion(values.map((v) => Number(v) / 100)); if (b[2] < .02 || b[3] < .02) return; const boxes = [...(page.slides ?? [[0, 0, 1, 1]])]; boxes[view.slide] = b; apply(boxes, view.slide); }}>应用边界</button>
    <button onClick={() => apply([[0, 0, 1, .5], [0, .5, 1, .5]])}>上下等分</button><button onClick={() => apply([[0, 0, 1, 1]])}>恢复整页</button>
  </div>;
}

function Pane({ mat, view, setView, following, secondary }: { mat: Material; view: View; setView: (p: Partial<View>) => void; following: boolean; secondary?: boolean }) {
  const pages = ['pdf', 'word', 'slides', 'image'].includes(mat.kind);
  if (pages && (view.fit === 'width' || view.fit === 'region')) return <Continuous key={mat.id} mat={mat} view={view} setView={setView} following={following} secondary={secondary} />;
  return <div className="rd-pane"><Stage mat={mat} view={{ ...view, materialId: mat.id }} author="teacher" tool="pointer" color="ink" size={3} inkEnabled={false} pad={18} overlays={false} />{secondary && <span className="rd-tag">{mat.pairRole === 'question' ? '原卷' : '解析'}</span>}</div>;
}

function Continuous({ mat, view, setView, following, secondary }: { mat: Material; view: View; setView: (p: Partial<View>) => void; following: boolean; secondary?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 }), [scrollY, setScrollY] = useState(0), [selMode, setSelMode] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null), [selection, setSelection] = useState<Rect | null>(null), [busy, setBusy] = useState(false);
  const programmatic = useRef(false), timer = useRef<number | undefined>(undefined), alive = useRef(true);
  const GAP = 12, PAD = 20;
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  useLayoutEffect(() => { const el = box.current!; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  const pw = Math.max(120, (size.w - PAD * 2 - 12) * view.zoom), left = Math.max(PAD, (size.w - pw) / 2);
  const geometry = useMemo(() => { let acc = PAD; return mat.pages.map((p) => { const r = { top: acc, left, width: pw, height: pw * p.h / p.w }; acc += r.height + GAP; return r; }); }, [mat.pages, pw, left]);
  const fullHeight = (geometry.at(-1)?.top ?? PAD) + (geometry.at(-1)?.height ?? 0) + PAD;
  useEffect(() => {
    const el = box.current, page = geometry[view.page]; if (!el || !page) return;
    const visible = geometry.findLastIndex((p) => p.top <= el.scrollTop + el.clientHeight * .3);
    if (visible !== view.page) {
      programmatic.current = true; el.scrollTo({ top: page.top - 8, behavior: following ? 'smooth' : 'auto' });
      clearTimeout(timer.current); timer.current = window.setTimeout(() => { programmatic.current = false; }, following ? 450 : 20);
    }
  }, [view.page, pw]);
  const onScroll = () => {
    const el = box.current!; setScrollY(el.scrollTop);
    if (programmatic.current || secondary) return;
    const i = Math.max(0, geometry.findLastIndex((p) => p.top <= el.scrollTop + el.clientHeight * .3));
    if (i !== view.page) setView({ page: i, slide: 0 });
  };
  const local = (e: React.PointerEvent) => {
    const el = box.current!, r = el.getBoundingClientRect();
    return { x: Math.max(left, Math.min(left + pw, e.clientX - r.left + el.scrollLeft)), y: Math.max(PAD, Math.min(fullHeight - PAD, e.clientY - r.top + el.scrollTop)) };
  };
  const finish = () => {
    if (!drag) return; setDrag(null);
    const region: Rect = [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)];
    if (region[2] >= 20 && region[3] >= 20) setSelection(region);
  };
  const publish = async (target: 'student' | 'cue') => {
    if (!selection || busy) return; setBusy(true);
    const isCurrent = claimMaterialTarget(target);
    try {
      const hits = geometry.flatMap((r, index) => intersect(selection, [r.left, r.top, r.width, r.height]) ? [index] : []);
      if (!hits.length) throw new Error('请在课件内容上框选。');
      const st = useStore.getState();
      if (hits.length === 1) {
        const page = hits[0], r = geometry[page], clip = intersect(selection, [r.left, r.top, r.width, r.height])!;
        const region: Rect = [(clip[0] - r.left) / r.width, (clip[1] - r.top) / r.height, clip[2] / r.width, clip[3] / r.height];
        const v = { page, slide: 0, fit: 'region' as const, region, zoom: 1 };
        if (target === 'student') st.showNow(mat, v); else st.cue(mat, v);
      } else {
        const crop = await regionMaterial(mat, selection, geometry);
        if (!alive.current || !isCurrent() || useStore.getState().reader.mat.id !== mat.id) return;
        if (target === 'student') useStore.getState().showNow(crop, { fit: 'page' }); else useStore.getState().cue(crop, { fit: 'page' });
      }
      if (alive.current) { setSelection(null); setSelMode(false); }
    } catch (e) { reportMaterialError(e, '框选上屏', target); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="rd-pane">
    <div ref={box} className={'rd-scroll' + (selMode ? ' selecting' : '')} onScroll={onScroll}
      onWheel={(e) => { if (e.ctrlKey && !secondary) { e.preventDefault(); setView({ zoom: Math.max(.4, Math.min(3, view.zoom * (e.deltaY > 0 ? .95 : 1.05))) }); } }}
      onPointerDown={(e) => { if (!selMode || secondary || (e.target as HTMLElement).closest('button')) return; e.currentTarget.setPointerCapture(e.pointerId); const p = local(e); setSelection(null); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
      onPointerMove={(e) => { if (drag) { const p = local(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
      <div style={{ height: fullHeight, position: 'relative', width: Math.max(size.w, pw + PAD * 2) }}>
        {geometry.map((r, i) => r.top + r.height >= scrollY - 900 && r.top <= scrollY + size.h + 900 ? <div key={i} className={'rd-page' + (i === view.page ? ' cur' : '')} style={r}>
          {mat.pages[i].src || mat.pages[i].doc ? <DocPage mat={mat} page={mat.pages[i]} index={i} /> : !host.electron ? <MockPage mat={mat} index={i} wide={mat.pages[i].w > mat.pages[i].h} /> : <DocPage mat={mat} page={mat.pages[i]} index={i} />}
          <span className="rd-num num">{i + 1}</span>
        </div> : null)}
        {drag && <div className="rd-sel" style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />}
        {selection && <><div className="rd-sel done" style={{ left: selection[0], top: selection[1], width: selection[2], height: selection[3] }} /><div className="rd-chip" style={{ left: Math.max(8, Math.min(selection[0] + selection[2] - 220, size.w - 250)), top: selection[1] + selection[3] + 8 }}>
          <button className="btn-live" disabled={busy} onClick={() => void publish('student')}><MonitorUp size={13} />{busy ? '准备选区…' : '上屏这块'}</button><button className="btn-cue" disabled={busy} onClick={() => void publish('cue')}>放预监</button><button disabled={busy} onClick={() => setSelection(null)} aria-label="取消"><X size={13} /></button>
        </div></>}
      </div>
    </div>
    {!secondary && <button className={'rd-region' + (selMode ? ' on' : '')} onClick={() => { setSelMode(!selMode); setSelection(null); }} data-tip="框选一道题，可以跨页；只发布课件原内容"><SquareDashed size={15} />{selMode ? <><ScanLine size={15} />拖动框选题目…</> : '框选上屏'}</button>}
    {secondary && <span className="rd-tag">{mat.pairRole === 'question' ? '原卷' : '解析'}</span>}
  </div>;
}

function Filmstrip({ mat, view, onPick }: { mat: Material; view: View; onPick: (page: number, slide: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = mat.pages.flatMap((p, i) => view.fit === 'slides' && (p.slides?.length ?? 0) > 1 ? p.slides!.map((box, slide) => ({ page: i, slide, box })) : [{ page: i, slide: 0, box: undefined as number[] | undefined }]);
  const cur = Math.max(0, items.findIndex((it) => it.page === view.page && (view.fit !== 'slides' || it.slide === view.slide))), start = Math.max(0, cur - 8), end = Math.min(items.length, start + 17);
  // scrollIntoView would also scroll overflow-hidden ancestors and shift the whole console.
  useEffect(() => {
    const box = ref.current, c = box?.querySelector<HTMLElement>('.cur');
    if (!box || !c) return;
    const b = box.getBoundingClientRect(), r = c.getBoundingClientRect();
    box.scrollTo({ left: box.scrollLeft + (r.left + r.width / 2) - (b.left + b.width / 2), behavior: 'smooth' });
  }, [view.page, view.slide]);
  return <div className="film" ref={ref}>
    {start > 0 && <button title="更前面的页" onClick={() => onPick(items[Math.max(0, start - 8)].page, 0)}>…</button>}
    {items.slice(start, end).map((it) => {
      const p = mat.pages[it.page], selected = it.page === view.page && (view.fit !== 'slides' || it.slide === view.slide), b = it.box;
      return <button key={it.page + '-' + it.slide} className={'film-i' + (selected ? ' cur' : '') + (b || p.w > p.h ? ' wide' : '')} onClick={() => onPick(it.page, it.slide)} title={`第 ${it.page + 1} 页${b ? '，第 ' + (it.slide + 1) + ' 张' : ''}`}>
        {p.src || p.doc ? b ? <span className="film-crop-live" style={{ left: -b[0] / b[2] * 100 + '%', top: -b[1] / b[3] * 100 + '%', width: 100 / b[2] + '%', height: 100 / b[3] + '%' }}><DocPage mat={mat} page={p} index={it.page} /></span> : <DocPage mat={mat} page={p} index={it.page} /> : <span className="film-mock" />}
        <i className="num">{it.page + 1}{b ? `-${it.slide + 1}` : ''}</i>
      </button>;
    })}
    {end < items.length && <button title="更后面的页" onClick={() => onPick(items[Math.min(items.length - 1, end + 7)].page, 0)}>…</button>}
  </div>;
}
