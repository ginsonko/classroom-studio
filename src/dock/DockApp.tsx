// 教师浮层（dock 窗口的渲染端）：跟随学生窗口的窄玻璃栏。
// 窗口本体透明、防截屏、不抢焦点；这里负责把可见内容的矩形上报给主进程，
// 让窗口其余区域点击穿透到学生画面（手写笔可以直接在下方书写）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageThumb } from '../ui/PageThumb';
import {
  ArrowUpToLine, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, ImageDown, ScrollText, GripVertical, LayoutGrid, Lock, LockOpen,
  Minimize2, Pause, Play, Plus, Redo2, RotateCcw, Scissors, Trash2, Undo2, X,
} from 'lucide-react';
import { snipToBoard } from '../ink/pasteImage';
import { addBoardPage, defaultView, inkKey, stepView, useStore } from '../lib/store';
import { boardMaterial } from '../lib/library';
import { isLong, screenLabel } from '../lib/longBoard';
import { seekLastInk, seekLong } from '../stage/longNav';
import { StepToggle } from '../stage/StepToggle';
import { saveBoard, saveBoardPdf, type ExportMode } from '../ink/boardExport';
import { answerKey, isAnswer, toggleAnswerPage, toggleReveal } from '../doc/answers';
import { host } from '../lib/host';
import { ToolPalette } from '../ui/ToolPalette';
import { SubjectPicker } from '../ui/SubjectPicker';
import { FormulaHost } from '../ink/FormulaSheet';
import type { Material, Tool } from '../lib/types';
import type { SimSync } from '../physics/model';
import { initialSync, play, reset, seek, setParams, setRate, timeAt, withClockDefaults } from '../physics/sim/clock';
import { presetById } from '../physics/sim/presets';
import type { ParamDef } from '../physics/sim/presetKit';
import { demoById, pickPatch } from '../demos';
import { clampDemo } from '../demos/kit';
import { fmt } from '../physics/sim/text';
import { DockPlugins } from '../plugins/DockPlugins';
import { GuideSpot } from '../guide/Spot';
import { fitZoom } from '../ui/fit';
import '../styles/dock.css';

declare global { interface Window { csDock?: { rail(w: number, h: number): void; shape(rects: { x: number; y: number; width: number; height: number }[]): void; drag(phase: 'start' | 'move' | 'end', x: number, y: number): void; focus(on: boolean): void; log?(text: string): void } } }

const dock = () => (host.electron && host.role === 'dock' ? window.csDock : undefined);

/** 诊断：浮层页面实际收到的按下/点击写进本地日志，用来区分“点击没到浮层”和“到了但没生效” */
function useInputLog() {
  useEffect(() => {
    const bridge = dock();
    if (!bridge?.log) return;
    const name = (t: EventTarget | null) => {
      const el = (t as HTMLElement | null)?.closest?.('button, [data-tip], [aria-label], input') as HTMLElement | null;
      return (el?.getAttribute('aria-label') || el?.dataset.tip || el?.className || (t as HTMLElement | null)?.tagName || '?').toString().slice(0, 40);
    };
    const down = (e: PointerEvent) => bridge.log!(`按下 ${e.pointerType} ${Math.round(e.clientX)},${Math.round(e.clientY)} ${name(e.target)}`);
    const click = (e: MouseEvent) => bridge.log!(`点击 ${name(e.target)}`);
    addEventListener('pointerdown', down, true);
    addEventListener('click', click, true);
    const err = (e: ErrorEvent) => bridge.log!(`页面错误 ${e.message}`);
    addEventListener('error', err);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('click', click, true); removeEventListener('error', err); };
  }, []);
}

/** 元素及其溢出子元素的外接矩形：窗口形状以外的部分既看不见也点不到，按钮文字溢出一点就会点空 */
function bounds(el: HTMLElement) {
  let { left, top, right, bottom } = el.getBoundingClientRect();
  for (const c of el.querySelectorAll('*')) {
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  }
  return { x: left - 2, y: top - 2, width: right - left + 4, height: bottom - top + 4 };
}

// 弹层里有这些输入控件时浮层保持键盘焦点（公式输入框是 textarea：之前漏了，点一下焦点就被还给学生窗口）
const TYPING = '.obj-pop input, .obj-pop textarea, [data-ink-pop] input, [data-ink-pop] textarea, [data-ink-pop] [contenteditable="true"], [data-ink-pop] iframe';

/** 上报窗口形状：可见面板以外的区域点击穿透 */
function useWindowShape(rail: React.RefObject<HTMLElement | null>, mini: boolean) {
  useEffect(() => {
    const bridge = dock();
    if (!bridge) return;
    let queued = false, last = '', focused = false;
    const report = () => {
      queued = false;
      // 弹层（工具 flyout、器材库、参数编辑）打开时整窗可见可点：弹层是 position:fixed，
      // 且有阴影和动画，逐个测量会被裁掉；点弹层外的透明处会关闭弹层，和普通弹出菜单一致。
      const popOpen = [...document.querySelectorAll<HTMLElement>('.tp-fly, .obj-pop, [data-ink-pop]')].some((el) => el.getClientRects().length > 0);
      const rects = popOpen
        ? [{ x: 0, y: 0, width: innerWidth, height: innerHeight }]
        : [...document.querySelectorAll<HTMLElement>('.tdock, .tdock-mini, .tip')].map(bounds);
      if (rail.current && !mini && !rects.length) {
        const r = rail.current.getBoundingClientRect();
        rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
      // 浮层窗口平时不抢焦点（一击生效）；弹层里有输入框（器材搜索、参数）时临时允许键盘输入
      const typing = !!document.querySelector(TYPING);
      if (typing !== focused) { focused = typing; bridge.focus(typing); }
      const key = JSON.stringify(rects.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]));
      if (key !== last) { last = key; bridge.shape(rects); }
      const rl = rail.current;
      if (rl) { const r = rl.getBoundingClientRect(); bridge.rail(r.width, r.height); }
    };
    // 不用 requestAnimationFrame：被遮挡的窗口里 rAF 会暂停，形状就停在旧状态
    const ask = () => { if (!queued) { queued = true; setTimeout(report, 16); } };
    report();
    const ro = new ResizeObserver(ask);
    ro.observe(document.body);
    if (rail.current) ro.observe(rail.current);
    const mo = new MutationObserver(ask);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    const t = setInterval(ask, 900);
    // 浮层窗口可以获得焦点（保证每次点击都能收到）；点完把键盘焦点还给学生窗口，翻页键、撤销照常
    const release = () => setTimeout(() => {
      if (!document.querySelector(TYPING) && document.hasFocus()) bridge.focus(false);
    }, 60);
    addEventListener('pointerup', release, true);
    return () => { ro.disconnect(); mo.disconnect(); clearInterval(t); removeEventListener('pointerup', release, true); };
  }, [rail, mini]);
}

const ZOOMS = [1, 1.2, 1.4];
const ZOOM_KEY = 'cs.dock.zoom';

export function DockApp() {
  const st = useStore();
  const rail = useRef<HTMLDivElement>(null);
  const [mini, setMini] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const [zoom, setZoom] = useState(() => { const z = Number(localStorage.getItem(ZOOM_KEY)); return ZOOMS.includes(z) ? z : 1; });
  const [room, setRoom] = useState(0);
  const [applied, setApplied] = useState(zoom);
  const pickZoom = (z: number) => { setZoom(z); localStorage.setItem(ZOOM_KEY, String(z)); };
  useEffect(() => { document.title = '教师浮层'; }, []);
  const [guard, setGuard] = useState(false);
  useEffect(() => {
    if (host.electron) host.call<{ side?: 'left' | 'right'; guard?: boolean; room?: number; mini?: boolean }>('dockState').then((s) => { if (s?.side) setSide(s.side); setGuard(!!s?.guard); if (s?.room) setRoom(s.room); }).catch(() => {});
    return host.onEvent((e) => {
      if (e?.type !== 'dock') return;
      if (e.side === 'left' || e.side === 'right') setSide(e.side);
      if (typeof e.guard === 'boolean') setGuard(e.guard);
      if (typeof e.room === 'number') setRoom(e.room);
      if (e.reset) { localStorage.removeItem(ZOOM_KEY); setZoom(1); setMini(false); }
    });
  }, []);
  // 缩放按钮在工具条下半截：工具条比屏幕高时按钮跑到屏幕外，就再也缩不回来了。所以永远缩到放得下
  useLayoutEffect(() => {
    const el = rail.current;
    if (!el) return;
    const check = () => {
      const h = el.getBoundingClientRect().height;
      const next = fitZoom(zoom, applied, h, room);
      if (Math.abs(next - applied) >= 0.01) setApplied(next);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, applied, room, mini]);
  useWindowShape(rail, mini);
  useInputLog();

  const grab = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dock()?.drag('start', e.screenX, e.screenY);
  };
  const move = (e: React.PointerEvent) => { if (e.buttons) dock()?.drag('move', e.screenX, e.screenY); };
  const drop = (e: React.PointerEvent) => dock()?.drag('end', e.screenX, e.screenY);

  if (mini)
    return (
      <button className={'tdock-mini side-' + side} onClick={() => setMini(false)} data-tip="展开教师浮层">
        <GripVertical size={15} />
      </button>
    );

  return (
    <div ref={rail} className={'tdock active side-' + side} style={applied !== 1 ? { zoom: applied } : undefined}>
      <div
        className="tdock-grip"
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={drop}
        onPointerCancel={drop}
        data-tip="按住这里拖动浮层"
      >
        {guard
          ? <span className="tdock-badge" data-tip="已开启防截屏：任何共享方式都看不到这个浮层。如果学生那边在这里看到黑块，请在设置里关闭防截屏">防截屏</span>
          : <span className="tdock-badge" data-tip="腾讯会议请选「共享窗口 → 课堂展示」，学生就看不到这个浮层；不要共享整个屏幕">教师浮层</span>}
        <button onClick={() => setMini(true)} data-tip="收成小圆点"><Minimize2 size={13} /></button>
      </div>
      {st.drawAuthor === 'student' && (
        <button className="tdock-reclaim" onClick={() => st.setShared({ drawAuthor: 'teacher' })} data-tip="学生正在用学生工具条书写。点这里，或点下面任意工具，笔就回到你手里">
          <span><i />学生在写</span><b>点我收回</b>
        </button>
      )}
      <ToolPalette vertical tool={st.drawAuthor === 'student' ? ('none' as Tool) : st.tool} color={st.color} size={st.size}
        onTool={(t) => st.set({ tool: t, drawAuthor: 'teacher' })} onColor={(c) => st.set({ color: c, drawAuthor: 'teacher' })} onSize={(s) => st.set({ size: s, drawAuthor: 'teacher' })} />
      <InkRows zoom={zoom} applied={applied} onZoom={pickZoom} />
      {st.pgmMat.kind === 'sim' && <SimSection mat={st.pgmMat} />}
      <FormulaHost />
      {/* 浮层可能整体缩放（zoom），高亮框放到 body 上才对得准 */}
      {createPortal(<GuideSpot win="dock" />, document.body)}
    </div>
  );
}

function InkRows({ zoom, applied, onZoom }: { zoom: number; applied: number; onZoom: (z: number) => void }) {
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const [zoomMenu, setZoomMenu] = useState(false);
  const pgm = useStore((s) => s.pgm);
  const mat = useStore((s) => s.pgmMat);
  const studentTools = useStore((s) => s.studentTools);
  const st = useStore.getState;
  const key = inkKey(pgm.materialId, pgm.page);
  const counter = useRef<HTMLButtonElement>(null);
  const [grid, setGrid] = useState(false), [snip, setSnip] = useState(false);
  const guard = useStore((s) => s.answerGuard !== false);
  const spotlight = useStore((s) => s.spotlight);
  const curtain = useStore((s) => s.curtain);
  useEffect(() => setGrid(false), [mat.id]);
  const long = isLong(mat), screen = long ? screenLabel(mat, pgm).replace(' 屏', '').split(' / ') : [];
  const saveBtn = useRef<HTMLButtonElement>(null);
  const [saveMenu, setSaveMenu] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => setSaveMenu(false), [mat.id]);
  const save = (mode: SaveChoice) => {
    setSaving(true);
    void (mode === 'pdf' || mode === 'pdf-ink' ? saveBoardPdf({ saveInk: mode === 'pdf-ink' }) : saveBoard(mode)).then((files) => { if (files?.length) { setSaved(true); setTimeout(() => setSaved(false), 2500); } })
      .catch((e) => { host.call('notice', '保存板书失败：' + String((e as Error).message)).catch(() => {}); })
      .finally(() => setSaving(false));
  };
  return (
    <>
      <div className="tdock-row">
        <button className="tp-b" onClick={() => st().undo(key, 'teacher')} data-tip="撤销 Ctrl+Z"><Undo2 size={17} /></button>
        <button className="tp-b" onClick={() => st().redo(key, 'teacher')} data-tip="重做 Ctrl+Shift+Z"><Redo2 size={17} /></button>
        <button className="tp-b" onClick={() => st().clearInk(key, 'teacher')} data-tip="清除我在这一页的笔迹"><Trash2 size={17} /></button>
      </div>
      {long ? (
        <div className="tdock-row tdock-pager">
          <button className="tp-b" onClick={() => st().setShared({ pgm: stepView(mat, pgm, -1), selectedInk: null })} data-tip="往上半屏 ↑（学生画面上用滚轮也行）"><ChevronUp size={18} /></button>
          <button className="tdock-page num" onClick={seekLastInk} data-tip="第几屏 / 共几屏 · 点一下跳到最后写的地方">{screen[0]}<i>/{screen[1]}</i></button>
          <button className="tp-b" onClick={() => st().setShared({ pgm: stepView(mat, pgm, 1), selectedInk: null })} data-tip="往下半屏 ↓（写到底自动加长）"><ChevronDown size={18} /></button>
        </div>
      ) : (
        <div className="tdock-row tdock-pager">
          <button className="tp-b" onClick={() => st().setShared({ pgm: stepView(mat, pgm, -1) })} data-tip="上一页 ←"><ChevronLeft size={18} /></button>
          <button ref={counter} className={'tdock-page num' + (grid ? ' on' : '')} onClick={() => setGrid(!grid)} data-tip="点开所有页面，点缩略图直接跳转">{pgm.page + 1}<i>/{mat.total}</i></button>
          <button className="tp-b" onClick={() => st().setShared({ pgm: stepView(mat, pgm, 1) })} data-tip="下一页 →"><ChevronRight size={18} /></button>
        </div>
      )}
      {!long && mat.kind === 'slides' && mat.pages.some((p) => p.clicks) && <div className="tdock-row"><StepToggle className="tdock-steps" size={15} /></div>}
      {grid && <PageGrid anchor={counter.current} mat={mat} page={pgm.page} onClose={() => setGrid(false)}
        onPick={(i) => { st().setShared({ pgm: { ...pgm, page: i, slide: 0, region: undefined, fit: pgm.fit === 'region' ? 'page' : pgm.fit } }); setGrid(false); }} />}
      {guard && isAnswer(mat, pgm.page) && <AnswerRow mat={mat} page={pgm.page} />}
      {(spotlight || curtain !== null) && (
        <div className="tdock-row tdock-overlay">
          {spotlight && <button onClick={() => st().setShared({ spotlight: null })} data-tip="关掉聚光灯：学生重新看到整页（按 Esc 也行）"><X size={14} />聚光灯</button>}
          {curtain !== null && <button onClick={() => st().setShared({ curtain: null })} data-tip="收起幕布：学生重新看到整页（把幕布拖到最下面，或按 Esc 也行）"><X size={14} />幕布</button>}
        </div>
      )}
      <div className="tdock-row">
        {long ? (
          <button className="tp-b" onClick={() => seekLong(0)} data-tip="回到长黑板顶部"><ArrowUpToLine size={17} /></button>
        ) : mat.kind === 'board' ? (
          <button className="tp-b" onClick={addBoardPage} data-tip="黑板加一页"><Plus size={17} /></button>
        ) : (
          <button className="tp-b" onClick={() => st().focusWin('board')} data-tip="切到黑板（回到上次写的那页）"><LayoutGrid size={17} /></button>
        )}
        <button
          className={'tp-b' + (studentTools === 'locked' ? ' warn' : '')}
          onClick={() => st().setShared({ studentTools: studentTools === 'open' ? 'locked' : studentTools === 'locked' ? 'hidden' : 'open' })}
          data-tip={studentTools === 'open' ? '学生工具：开放 · 点击锁定' : studentTools === 'locked' ? '学生工具：锁定 · 点击隐藏' : '学生工具：隐藏 · 点击开放'}
        >
          {studentTools === 'open' ? <LockOpen size={17} /> : <Lock size={17} />}
        </button>
        <button className={'tp-b' + (snip ? ' on' : '')} disabled={snip} onClick={() => { setSnip(true); void snipToBoard().catch((e) => { host.call('notice', String((e as Error).message)).catch(() => {}); }).finally(() => setSnip(false)); }} data-tip="截屏：框选屏幕上任意区域，贴到黑板（微信 / QQ 截图后直接在学生画面按 Ctrl+V 也行）"><Scissors size={17} /></button>
      </div>
      <div className="tdock-row">
        <button className="tp-b" onClick={() => st().newLongBoard()} data-tip="新开一块长黑板：一整条往下写，滚轮 / 翻页往下滚，写到底自动加长"><ScrollText size={17} /></button>
        <button ref={saveBtn} className={'tp-b' + (saving || saveMenu ? ' on' : '')} disabled={saving}
          onClick={() => { if (mat.kind === 'board') setSaveMenu(!saveMenu); else save('stitch'); }}
          data-tip={mat.kind === 'board' ? '保存板书：存成图片，或存成 A4 的 PDF 方便打印' : '保存学生画面为图片'}>
          {saved ? <Check size={17} /> : <ImageDown size={17} />}
        </button>
      </div>
      {saveMenu && <SaveMenu anchor={saveBtn.current} pages={long ? 1 : mat.pages.length} long={long} page={pgm.page} onPick={(m) => { setSaveMenu(false); save(m); }} onClose={() => setSaveMenu(false)} />}
      <div className="tdock-row">
        <SubjectPicker className="tdock-subj" vertical compact />
        <DockPlugins />
        <button ref={zoomBtn} className={'tp-b tdock-zoom' + (zoomMenu ? ' on' : '') + (applied < zoom ? ' fit' : '')} onClick={() => setZoomMenu(!zoomMenu)}
          data-tip={applied < zoom ? `浮层大小：选的是 ${Math.round(zoom * 100)}%，屏幕放不下，已自动缩到 ${Math.round(applied * 100)}%` : '浮层大小 · 恢复默认位置'}>
          <span className="num">{Math.round(applied * 100)}</span>
        </button>
      </div>
      {zoomMenu && <ZoomMenu anchor={zoomBtn.current} zoom={zoom} applied={applied} onPick={(z) => { onZoom(z); setZoomMenu(false); }} onClose={() => setZoomMenu(false)} />}
    </>
  );
}

/** 浮层大小 + 恢复默认位置。放在 body 上：浮层整体缩放时菜单本身不跟着变大 */
function ZoomMenu({ anchor, zoom, applied, onPick, onClose }: { anchor: HTMLElement | null; zoom: number; applied: number; onPick: (z: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const W = 220;
  useLayoutEffect(() => {
    const railEl = anchor?.closest('.tdock') as HTMLElement | null;
    if (!anchor || !railEl) return;
    const r = railEl.getBoundingClientRect(), a = anchor.getBoundingClientRect(), h = box.current?.offsetHeight ?? 200;
    const left = r.right + 10 + W <= innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - W);
    setPos({ left, top: Math.max(8, Math.min(a.top - h / 2, innerHeight - h - 8)) });
  }, [anchor]);
  useEffect(() => {
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  const reset = () => {
    setBusy(true);
    // 缩放和收起由主进程发回的 reset 事件清掉（removeItem），这里不要再写回 1
    void host.call('dockReset').catch(() => {}).finally(() => { setBusy(false); onClose(); });
  };
  return createPortal(
    <div ref={box} data-ink-pop className="tdock-pages tdock-save tdock-zoommenu" style={{ width: W, left: pos?.left ?? -9999, top: pos?.top ?? 8 }}>
      <header><b>浮层大小</b>{applied < zoom && <span className="num">已自动缩到 {Math.round(applied * 100)}%</span>}</header>
      <div className="tdock-zooms">
        {ZOOMS.map((z) => <button key={z} className={z === zoom ? 'on' : ''} onClick={() => onPick(z)}><b className="num">{Math.round(z * 100)}%</b><span>{z === 1 ? '标准' : z < 1.3 ? '大一点' : '最大'}</span></button>)}
      </div>
      {applied < zoom && <p className="tdock-zoomnote">屏幕高度不够，浮层自动缩小，保证每个按钮都点得到。学生窗口拉高一些就会恢复。</p>}
      <button disabled={busy} onClick={reset}><b>恢复默认位置和大小</b><span>回到学生画面左上角、100%、展开</span></button>
    </div>,
    document.body,
  );
}

/** 多页黑板保存方式：拼长图 / 每页一张 / 只存这一页 */
type SaveChoice = ExportMode | 'pdf' | 'pdf-ink';
function SaveMenu({ anchor, pages, long, page, onPick, onClose }: { anchor: HTMLElement | null; pages: number; long: boolean; page: number; onPick: (m: SaveChoice) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const W = 232;
  useLayoutEffect(() => {
    const railEl = anchor?.closest('.tdock') as HTMLElement | null;
    if (!anchor || !railEl) return;
    const r = railEl.getBoundingClientRect(), a = anchor.getBoundingClientRect(), h = box.current?.offsetHeight ?? 160;
    const left = r.right + 10 + W <= innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - W);
    setPos({ left, top: Math.max(8, Math.min(a.top - 40, innerHeight - h - 8)) });
  }, [anchor]);
  useEffect(() => {
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={box} data-ink-pop className="tdock-pages tdock-save" style={{ width: W, left: pos?.left ?? -9999, top: pos?.top ?? 8 }}>
      <header><b>保存板书</b>{pages > 1 && <span className="num">共 {pages} 页</span>}</header>
      {pages > 1 ? <>
        <button onClick={() => onPick('stitch')}><b>拼成一张长图</b><span>{pages} 页从上到下接起来，方便发给家长</span></button>
        <button onClick={() => onPick('pages')}><b>每页一张</b><span>按「名字-01、-02…」编号保存</span></button>
        <button onClick={() => onPick('page')}><b>只存这一页</b><span>第 {page + 1} 页</span></button>
      </> : <button onClick={() => onPick('stitch')}><b>存成图片</b><span>{long ? '整块长黑板一张长图' : 'PNG 图片'}</span></button>}
      <button onClick={() => onPick('pdf')}><b>存成 PDF</b><span>A4 纸{long ? '，长黑板自动分页' : pages > 1 ? '，一张纸放两页' : ''}，和黑板上看到的一样</span></button>
      <button onClick={() => onPick('pdf-ink')}><b>存成 PDF · 打印省墨</b><span>白底深色字、不印格子，适合打印给学生</span></button>
    </div>,
    document.body,
  );
}

/** 页码弹层：所有页的缩略图，点一下直接跳页。放在 body 上，避开浮层的 zoom 和窗口形状裁切。 */
function PageGrid({ anchor, mat, page, onPick, onClose }: { anchor: HTMLElement | null; mat: Material; page: number; onPick: (i: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const W = 352;
  useLayoutEffect(() => {
    const railEl = anchor?.closest('.tdock') as HTMLElement | null;
    if (!anchor || !railEl) return;
    const r = railEl.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const h = Math.min(innerHeight - 16, box.current?.offsetHeight ?? 420);
    const left = r.right + 10 + W <= innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - W);
    setPos({ left, top: Math.max(8, Math.min(a.top - 60, innerHeight - h - 8)) });
  }, [anchor]);
  useEffect(() => {
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  useEffect(() => { box.current?.querySelector('.pthumb.on')?.scrollIntoView({ block: 'center' }); }, [pos]);
  const answers = new Set(mat.answerPages ?? []);
  const guard = useStore((s) => s.answerGuard !== false);
  const canMark = mat.kind !== 'board' && mat.kind !== 'sim' && mat.total > 1;
  const status = !guard ? '答案遮挡已关闭，学生能看到所有页'
    : mat.answerPages === undefined ? '正在识别答案页…'
    : mat.answerAuto ? `自动识别出 ${answers.size} 页答案，学生看不到`
    : answers.size ? `已标记 ${answers.size} 页答案，学生看不到` : '没有找到答案页，可手动标记';
  return createPortal(
    <div ref={box} data-ink-pop className="tdock-pages" style={{ width: W, left: pos?.left ?? -9999, top: pos?.top ?? 8 }}>
      <header><b>{mat.title}</b><span className="num">{page + 1} / {mat.total}</span></header>
      {canMark && (
        <div className="tdock-pages-mark">
          <button className={'tdock-guard' + (guard ? ' on' : '')} role="switch" aria-checked={guard}
            onClick={() => useStore.getState().setShared({ answerGuard: !guard })}
            data-tip={guard ? '答案页对学生遮住，点一下关闭' : '点一下打开：答案页对学生遮住'}>
            <i />答案遮挡
          </button>
          <span>{status}</span>
          {guard && (
            <button className={answers.has(page) ? 'on' : ''} onClick={() => toggleAnswerPage(page)}>
              {answers.has(page) ? '第 ' + (page + 1) + ' 页取消答案' : '把第 ' + (page + 1) + ' 页设为答案'}
            </button>
          )}
        </div>
      )}
      <div className="tdock-pages-grid">
        {mat.pages.map((p, i) => <PageThumb key={i} page={p} n={i + 1} active={i === page} mark={guard && answers.has(i) ? '答案' : undefined} onPick={() => onPick(i)} />)}
      </div>
      {mat.pages.length < mat.total && <footer>其余 {mat.total - mat.pages.length} 页还在准备，可以用翻页按钮继续</footer>}
    </div>,
    document.body,
  );
}

/** 当前页是答案页时：学生端被遮住，老师一键揭晓 / 收回 */
function AnswerRow({ mat, page }: { mat: Material; page: number }) {
  const open = useStore((s) => s.revealed.includes(answerKey(mat.id, page)));
  return (
    <div className="tdock-row tdock-ans">
      <button className={'tdock-ans-b' + (open ? ' open' : '')} onClick={() => toggleReveal(mat.id, page)}
        data-tip={open ? '学生现在能看到答案，点一下重新遮住' : '学生现在看到的是遮挡页，点一下揭晓答案'}>
        {open ? <Eye size={15} /> : <EyeOff size={15} />}<span>{open ? '收回' : '揭晓'}</span>
      </button>
      {!open && <button className="tdock-ans-x" onClick={() => toggleAnswerPage(page)} data-tip="遮错了：这一页不是答案，以后打开这份课件也不遮这页（点页码可重新标记）">不遮</button>}
    </div>
  );
}

/** 学生画面是物理演示时：播放控制 + 参数（直接操作广播时钟，学生端同步） */
function SimSection({ mat }: { mat: Material }) {
  const sim = useStore((s) => s.sim);
  const [now, setNow] = useState(Date.now());
  const [paramsOpen, setParamsOpen] = useState(false);
  const duration = Math.max(0.5, mat.scene?.duration ?? 8);
  const sync: SimSync = withClockDefaults(sim && sim.matId === mat.id ? sim : initialSync(mat));
  const kit = demoById(mat.scene?.preset);
  // 数学 / 化学演示：只列面板上能调的参数（拖动的顶点、配平系数不放进浮层）
  const pre = presetById(mat.scene?.preset) ?? (kit ? { title: kit.title, params: kit.params.filter((d) => !d.hidden && (!d.when || d.when(clampDemo(kit, sync.params)))) } : undefined)
    // 立体演示：参数来自规格
    ?? (mat.s3d ? { title: mat.s3d.title || '立体演示', params: mat.s3d.params.map((p): ParamDef => ({ key: p.key, label: p.label, min: p.min, max: p.max, def: p.value, step: +(((p.max - p.min) / 100) || 1).toPrecision(1), unit: p.unit })) } : undefined);
  useEffect(() => {
    if (!sync.playing) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [sync.playing]);
  const t = timeAt(sync, now, duration);
  return (
    <div className="tdock-sim">
      <div className="tdock-sim-bar">
        <button className={'tp-b sim-play' + (sync.playing ? ' on' : '')} onClick={() => play(mat, duration)} data-tip={sync.playing ? '暂停' : '播放（学生同步看到）'}>
          {sync.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="tp-b" onClick={() => reset(mat, duration)} data-tip="回到开始"><RotateCcw size={15} /></button>
      </div>
      <input
        className="tdock-scrub" type="range" min={0} max={duration} step={0.01} value={t}
        onChange={(e) => seek(mat, duration, +e.target.value)}
        data-tip="拖动到任意时刻"
      />
      <div className="tdock-sim-meta">
        <span className="num">{fmt(t)}<i>/{fmt(duration, 1)}s</i></span>
        <span className="tdock-rates">
          {[0.5, 1, 2].map((r) => <button key={r} className={sync.rate === r ? 'on' : ''} onClick={() => setRate(mat, duration, r)}>{r}×</button>)}
        </span>
      </div>
      {pre && pre.params.length > 0 && (
        <>
          <button className={'tdock-params-toggle' + (paramsOpen ? ' on' : '')} onClick={() => setParamsOpen(!paramsOpen)}>
            参数 · {pre.title}
          </button>
          {paramsOpen && (
            <div className="tdock-params">
              {pre.params.map((d) => (
                <label key={d.key}>
                  <span>{d.label}</span>
                  {d.options && d.options.length > 4 ? (
                    <select className="tdock-select" value={sync.params[d.key] ?? d.def} onChange={(e) => setParams(mat, duration, pickPatch(d.key, +e.target.value))}>{d.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
                  ) : d.options ? (
                    <span className="tdock-rates">
                      {d.options.map((o) => (
                        <button key={o.v} className={(sync.params[d.key] ?? d.def) === o.v ? 'on' : ''} onClick={() => setParams(mat, duration, kit ? pickPatch(d.key, o.v) : { [d.key]: o.v })}>{o.label}</button>
                      ))}
                    </span>
                  ) : (
                    <>
                      <input type="range" min={d.min} max={d.max} step={d.step} value={sync.params[d.key] ?? d.def}
                        onChange={(e) => setParams(mat, duration, { [d.key]: +e.target.value })} />
                      <b className="num">{fmt(sync.params[d.key] ?? d.def, d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0)}<i>{d.unit ? ' ' + d.unit : ''}</i></b>
                    </>
                  )}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
