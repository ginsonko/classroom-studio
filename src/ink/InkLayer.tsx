import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bus, WINDOW_ID } from '../lib/bus';
import { DARK_BOARDS, ROLE, resolveColor, useStore } from '../lib/store';
import type { Author, Stroke, Tool } from '../lib/types';
import { familyOf } from '../lib/subjects';
import { createObject, isObjKind, keepsAspect, updateObject } from '../physics/catalog';
import { SelectionEditor } from '../physics/edit/SelectionEditor';
import { useFormula } from './FormulaSheet';
import { draw, hit, recognize, type DrawCtx } from './draw';
import { texTick } from './texCache';
import { imgTick } from './imgCache';
import { canRotate, duplicateStroke, eraseSegment, freshId, insideLasso, moveStroke, rotateStroke, scaleStroke, selectionBounds, withObject, type Box, type Point } from './geometry';
import '../styles/objects.css';

interface Props {
  ikey: string; ratio: number; onPage: boolean; author: Author; tool: Tool; color: string; size: number; enabled: boolean; showPrivate?: boolean; inkLayer?: 'public' | 'private';
  /** 长黑板：画布只覆盖页面里的这一段 [上沿, 高度]（按页宽计），整页画布太大画不动 */
  band?: [number, number];
}
const boxes = new WeakMap<Stroke, Box>();
const boxOf = (s: Stroke) => { let b = boxes.get(s); if (!b) { b = selectionBounds([s]); boxes.set(s, b); } return b; };
const TWO_POINT: Tool[] = ['line', 'dashed', 'arrow', 'darrow', 'rect', 'ellipse', 'triangle', 'axes', 'force'];
const FREE: Tool[] = ['pen', 'marker', 'highlighter', 'curve'];
// 局部擦除能切断的笔迹；箭头、图形、文字、器材切开就没有意义了，仍然整个擦掉
const CUTTABLE: Tool[] = [...FREE, 'line', 'dashed'];
const ERASER_R = { s: .007, m: .014, l: .028 };
// 这些工具下双击文字就地修改；橡皮、激光笔、聚光灯、幕布不算
const DBL_TOOLS: Tool[] = ['select', 'lasso', ...FREE, ...TWO_POINT];
const isTap = (s: Stroke) => FREE.includes(s.tool) && Math.hypot(s.pts[s.pts.length - 3] - s.pts[0], s.pts[s.pts.length - 2] - s.pts[1]) < .004 && s.pts.length <= 15;
export const eraserRadius = () => ERASER_R[useStore.getState().inkOptions.eraserSize ?? 'm'] ?? ERASER_R.m;
const remoteDraft = new Map<string, { key: string; stroke: Stroke; at: number }>();
const laserTrails = new Map<string, { key: string; pts: number[]; at: number[] }>();
let remoteTick = 0, focusedCanvas: symbol | null = null;
// Windows Ink 在笔尖接触板面时会藏起系统光标，抬笔才显示，写字时十字一闪一闪；用笔时改为自己画十字
let penMode = false;
const offRemote = bus.on((m) => {
  if (m.t === 'live' && m.from !== WINDOW_ID) {
    const s = m.stroke as Stroke | null;
    if (!s || s.layer === 'private') remoteDraft.delete(m.from);
    else if (Array.isArray(s.pts) && s.pts.length <= 60000 && s.pts.every(Number.isFinite)) remoteDraft.set(m.from, { key: m.key, stroke: s, at: performance.now() });
    remoteTick++;
  }
  if (m.t === 'stroke') { for (const [id, draft] of remoteDraft) if (draft.key === m.key && draft.stroke.id === (m.stroke as Stroke)?.id) remoteDraft.delete(id); remoteTick++; }
  if (m.t === 'edit') { const change = m as unknown as { key: string; remove?: string[]; upsert?: Stroke[] }; const ids = new Set([...(change.remove ?? []), ...(change.upsert ?? []).map((s) => s.id)]); for (const [id, draft] of remoteDraft) if (draft.key === change.key && ids.has(draft.stroke.id)) remoteDraft.delete(id); remoteTick++; }
  if (m.t === 'laser' && m.from !== WINDOW_ID) {
    const now = performance.now(), prior = laserTrails.get(m.from), tr = prior?.key === m.key ? prior : { key: m.key, pts: [], at: [] };
    for (let i = 0; i + 1 < Math.min(m.pts.length, 320); i += 2) if (Number.isFinite(m.pts[i]) && Number.isFinite(m.pts[i + 1])) { tr.pts.push(m.pts[i], m.pts[i + 1]); tr.at.push(now); }
    if (tr.at.length > 160) { tr.pts.splice(0, (tr.at.length - 160) * 2); tr.at.splice(0, tr.at.length - 160); }
    laserTrails.set(m.from, tr); remoteTick++;
  }
});
if (import.meta.hot) import.meta.hot.dispose(offRemote);
type Gesture =
  | { type: 'draw'; start: Point; pointer: number }
  | { type: 'lasso'; start: Point; pointer: number }
  | { type: 'move' | 'scale' | 'rotate'; start: Point; center: Point; before: Stroke[]; pointer: number }
  | { type: 'erase'; original: Stroke[]; working: Stroke[]; last: Point; pointer: number }
  | { type: 'overlay'; pointer: number };

export function InkLayer(props: Props) {
  const { ikey, ratio, onPage, author, tool, color, size, enabled, showPrivate } = props;
  const layer = props.inkLayer ?? (showPrivate ? 'private' : 'public');
  const wrap = useRef<HTMLDivElement>(null), base = useRef<HTMLCanvasElement>(null), live = useRef<HTMLCanvasElement>(null);
  const strokes = useStore((s) => s.ink[ikey]), boardSkin = useStore((s) => s.boardSkin), sharedSelection = useStore((s) => s.selectedInk);
  // 文字输入框：id 是这段文字的笔迹 id；edit = 改已有的文字（原来那段先藏起来，输入框里接着改）
  const [px, setPx] = useState({ w: 0, h: 0, dpr: 1 }), [text, setTextState] = useState<{ x: number; y: number; value: string; id: string; edit?: Stroke } | null>(null);
  const textRef = useRef(text), editingId = useRef<string | null>(null), lastTap = useRef<{ t: number; x: number; y: number } | null>(null), pendingTap = useRef<{ stroke: Stroke; timer: number } | null>(null);
  const setText = (t: typeof text) => { textRef.current = t; editingId.current = t?.edit ? t.id : null; dirty.current = true; setTextState(t); };
  const [selectedIds, setSelectedIds] = useState<string[]>([]), [snap, setSnap] = useState<Point | null>(null);
  const token = useRef(Symbol('ink')), draft = useRef<Stroke | null>(null), gesture = useRef<Gesture | null>(null), preview = useRef<Stroke[]>([]);
  const selected = useRef<string[]>([]), lasso = useRef<number[] | null>(null), dirty = useRef(true), still = useRef(0), snapTimer = useRef(0), sendRaf = useRef(0);
  const myLaser = useRef<{ pts: number[]; at: number[] }>({ pts: [], at: [] }), lastTick = useRef(-1), textOpened = useRef(0), eraserAt = useRef<Point | null>(null);
  const penAt = useRef<Point | null>(null), overlayDirty = useRef(false), [pen, setPen] = useState(penMode);
  const bandTop = props.band?.[0] ?? 0, bandH = props.band?.[1] ?? 0, bandRef = useRef(bandTop), repaint = useRef<(() => void) | null>(null);
  const pointerKind = (e: { pointerType: string }) => {
    // 拿笔写字时部分驱动会夹杂 mouse 事件：只有没在写的时候的鼠标移动才算换回鼠标
    const next = e.pointerType === 'pen' ? true : e.pointerType === 'mouse' && !gesture.current ? false : penMode;
    if (next !== penMode) penMode = next;
    if (next !== pen) setPen(next);
  };
  const crossTool = !['eraser', 'text', 'select', 'lasso', 'laser', 'spotlight', 'curtain', 'pointer'].includes(tool);
  const dark = !onPage && DARK_BOARDS.includes(boardSkin);
  const visible = (s: Stroke) => s.layer !== 'private' || (showPrivate && ROLE !== 'student');
  const editable = (s: Stroke) => visible(s) && (s.layer ?? 'public') === layer && (author === 'teacher' || s.author === author);
  const all = () => useStore.getState().ink[ikey] ?? [];
  const chosen = () => all().filter((s) => selected.current.includes(s.id) && editable(s));
  const setSelection = (ids: string[], publish = true) => {
    selected.current = ids; setSelectedIds(ids); dirty.current = true;
    if (publish && layer === 'public') useStore.getState().setShared({ selectedInk: ids.length ? { key: ikey, ids } : null });
  };
  const clearLive = () => { cancelAnimationFrame(sendRaf.current); sendRaf.current = 0; if (layer === 'public') bus.post({ t: 'live', key: ikey, stroke: null, from: WINDOW_ID }); };
  const sendLive = (s: Stroke | null = draft.current) => {
    if (layer === 'private' || s?.layer === 'private') return;
    cancelAnimationFrame(sendRaf.current); sendRaf.current = requestAnimationFrame(() => { sendRaf.current = 0; bus.post({ t: 'live', key: ikey, stroke: s, from: WINDOW_ID }); });
  };
  const cancelGesture = () => { clearTimeout(still.current); gesture.current = null; draft.current = null; preview.current = []; lasso.current = null; clearLive(); dirty.current = true; };

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setPx({ w: r.width, h: r.height, dpr: Math.min(2.5, devicePixelRatio || 1) }); });
    ro.observe(wrap.current!); return () => ro.disconnect();
  }, []);
  useEffect(() => { dirty.current = true; }, [strokes, px, boardSkin, onPage, showPrivate, tool, selectedIds]);
  useEffect(() => {
    if (layer !== 'public') return;
    const ids = sharedSelection?.key === ikey ? sharedSelection.ids.filter((id) => (strokes ?? []).some((s) => s.id === id && editable(s))) : [];
    if (ids.join('|') !== selected.current.join('|')) { selected.current = ids; setSelectedIds(ids); dirty.current = true; }
  }, [sharedSelection, strokes, ikey, layer, author]);
  useEffect(() => {
    if (tool !== 'select' && tool !== 'lasso') { selected.current = []; setSelectedIds([]); }
    cancelGesture();
    // 写到一半换了工具 / 页面 / 书写权：已经写出来的部分照样保存（用的是这次渲染时的页面和作者）
    return () => { finish(); clearTimeout(snapTimer.current); };
  }, [ikey, tool, enabled, author, layer]);
  useEffect(() => () => { if (focusedCanvas === token.current) focusedCanvas = null; }, []);

  useEffect(() => {
    const b = base.current, c = live.current; if (!b || !c || !px.w) return;
    const cssH = bandH ? bandH * px.w : px.h;
    for (const canvas of [b, c]) { canvas.width = Math.round(px.w * px.dpr); canvas.height = Math.round(cssH * px.dpr); }
    const bc = b.getContext('2d')!, ctx = c.getContext('2d')!; let raf = 0;
    const setup = (context: CanvasRenderingContext2D) => { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, c.width, c.height); context.setTransform(px.w * px.dpr, 0, 0, px.w * px.dpr, 0, -bandRef.current * px.w * px.dpr); };
    const context = (canvas: CanvasRenderingContext2D): DrawCtx => ({ ctx: canvas, scale: px.w, dark, color: (id) => resolveColor(id, boardSkin, onPage) });
    // 长黑板只画落在画布这一段里的笔迹
    const inBand = (s: Stroke) => { if (!bandH) return true; const bx = boxOf(s), top = bandRef.current; return bx.y1 >= top - .05 && bx.y0 <= top + bandH + .05; };
    const loop = () => { raf = requestAnimationFrame(loop); paint(); };
    const paint = () => {
      const now = performance.now();
      for (const [id, r] of remoteDraft) if (now - r.at > 5000) { remoteDraft.delete(id); remoteTick++; }
      const lasers = [...laserTrails.values(), myLaser.current].filter((t) => (!('key' in t) || t.key === ikey) && t.at.length);
      const ticks = remoteTick + texTick() + imgTick();
      const full = dirty.current || lastTick.current !== ticks;
      if (!full && !overlayDirty.current && !lasers.length) return;
      dirty.current = false; overlayDirty.current = false; lastTick.current = ticks; setup(ctx); const ld = context(ctx);
      const remote = [...remoteDraft.values()].filter((r) => r.key === ikey && r.stroke.layer !== 'private');
      if (full) {
        setup(bc); const bd = context(bc);
        const hidden = new Set([...preview.current.map((s) => s.id), ...remote.map((r) => r.stroke.id), ...(editingId.current ? [editingId.current] : [])]);
        const list = gesture.current?.type === 'erase' ? gesture.current.working : all();
        // 贴图垫在最下面：先写的字、后贴的图，字也不会被图盖住
        for (const s of list) if (s.tool === 'image' && visible(s) && !hidden.has(s.id) && inBand(s)) draw(bd, s);
        for (const s of list) if (s.tool !== 'image' && visible(s) && !hidden.has(s.id) && inBand(s)) draw(bd, s);
      }
      for (const r of remote) draw(ld, r.stroke); for (const s of preview.current) draw(ld, s); if (draft.current) draw(ld, draft.current);
      for (const tr of lasers) drawLaser(ctx, tr, now);
      const ea = eraserAt.current;
      if (ea && (tool === 'eraser' || gesture.current?.type === 'erase')) {
        ctx.save(); ctx.beginPath(); ctx.arc(ea.x, ea.y, eraserRadius(), 0, Math.PI * 2);
        ctx.fillStyle = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.06)'; ctx.fill();
        ctx.lineWidth = 1.2 / px.w; ctx.strokeStyle = dark ? 'rgba(255,255,255,.7)' : 'rgba(40,40,40,.6)'; ctx.stroke(); ctx.restore();
      }
      if (lasso.current && lasso.current.length > 3) {
        ctx.save(); ctx.strokeStyle = '#3dd9eb'; ctx.fillStyle = 'rgba(61,217,235,.08)'; ctx.lineWidth = 1.3 / px.w; ctx.setLineDash([6 / px.w, 5 / px.w]); ctx.beginPath();
        lasso.current.forEach((v, i, a) => { if (!(i % 2)) { if (i) ctx.lineTo(v, a[i + 1]); else ctx.moveTo(v, a[i + 1]); } }); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      const selection = preview.current.length ? preview.current : chosen();
      if (selection.length && ['select', 'lasso'].includes(tool)) drawSelection(ctx, selectionBounds(selection), px.w, selection.every(canRotate));
      if (penAt.current && penMode && crossTool) drawCross(ctx, penAt.current, px.w, dark);
    };
    repaint.current = () => { dirty.current = true; paint(); };
    dirty.current = true; loop(); return () => { cancelAnimationFrame(raf); repaint.current = null; };
  }, [px, ikey, boardSkin, onPage, showPrivate, tool, author, layer, bandH]);
  // 画布挪到新位置的同一帧里重画，滚动时笔迹不会跳一下
  useLayoutEffect(() => { if (bandRef.current === bandTop) return; bandRef.current = bandTop; repaint.current?.(); }, [bandTop]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!enabled || focusedCanvas !== token.current || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
      const command = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), items = chosen(), consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (command && (k === 'z' || k === 'y')) { consume(); cancelGesture(); const st = useStore.getState(); if (k === 'y' || e.shiftKey) st.redo(ikey, author); else st.undo(ikey, author); return; }
      if (e.key === 'Escape') { consume(); cancelGesture(); setSelection([]); cancelText(); return; }
      if (!items.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { consume(); useStore.getState().editInk(ikey, { remove: items.map((s) => s.id) }, author); setSelection([]); }
      if (command && k === 'd') { consume(); const copies = items.map((s) => ({ ...duplicateStroke(s), author })); useStore.getState().editInk(ikey, { upsert: copies }, author); setSelection(copies.map((s) => s.id)); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { consume(); const step = (e.shiftKey ? 10 : 1) / Math.max(1, px.w), dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0; useStore.getState().editInk(ikey, { upsert: items.map((s) => moveStroke(s, dx, dy)) }, author); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [ikey, enabled, author, layer, px.w]);

  const point = (e: { clientX: number; clientY: number; pointerType: string; pressure: number }) => { const r = wrap.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.width), p: e.pointerType === 'mouse' ? .5 : Math.max(.05, e.pressure || .5) }; };
  const eraseAt = (p: Point) => {
    const g = gesture.current; if (g?.type !== 'erase') return;
    const radius = eraserRadius(), segment = useStore.getState().inkOptions.eraserMode !== 'stroke';
    const count = Math.max(1, Math.min(128, Math.ceil(Math.hypot(p.x - g.last.x, p.y - g.last.y) / (radius * .5))));
    for (let i = 1; i <= count; i++) { const x = g.last.x + (p.x - g.last.x) * i / count, y = g.last.y + (p.y - g.last.y) * i / count;
      // 橡皮只擦笔迹，不擦贴图（擦图上的字时不能把整张图擦没了）；贴图用选择工具删除
      g.working = g.working.flatMap((s) => !editable(s) || s.tool === 'image' || !hit(s, x, y, radius) ? [s] : segment && CUTTABLE.includes(s.tool) ? eraseSegment(s, x, y, radius + s.size / 1000) : []);
    }
    g.last = p; dirty.current = true;
  };
  const overlay = (p: Point) => { if (layer === 'private' || author !== 'teacher') return; const st = useStore.getState(); if (tool === 'spotlight') st.setShared({ spotlight: { x: p.x, y: p.y / ratio, r: st.spotlight?.r ?? .16 } }); if (tool === 'curtain') st.setShared({ curtain: Math.max(.02, Math.min(.98, p.y / ratio)) }); };
  const beginTransform = (type: 'move' | 'scale' | 'rotate', p: Point, items: Stroke[], pointer: number) => { const box = selectionBounds(items); gesture.current = { type, start: p, center: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, before: items, pointer }; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled || e.button > 0 && e.button !== 5) return;
    pointerKind(e); if (e.pointerType === 'pen') { penAt.current = point(e); overlayDirty.current = true; }
    if (gesture.current) {
      // 第二根手指不打断正在写的一笔；其它情况说明上一笔的抬笔信号丢了，先把它存好再开始新的一笔
      if (e.pointerType === 'touch' && gesture.current.pointer !== e.pointerId) return;
      finish();
    }
    if (tool === 'text') {
      // 不取消默认动作的话，按下之后浏览器会把焦点还给画布，刚弹出的输入框立刻失焦、空内容提交后消失
      e.preventDefault(); focusedCanvas = token.current;
      const p = point(e);
      if (textRef.current) commitText();
      // 文字工具点在已有的文字上：接着改这段文字
      const t = textAt(p);
      if (t) { openEdit(t, e); return; }
      textOpened.current = performance.now();
      setText({ x: p.x, y: p.y, value: '', id: freshId() });
      return;
    }
    const p = point(e), pointer = e.pointerId;
    // 双击文字（选择工具、各种笔都行）：像腾讯会议 / ClassIn 一样直接在原处改
    const now = performance.now(), lt = lastTap.current;
    lastTap.current = { t: now, x: p.x, y: p.y };
    if (lt && now - lt.t < 420 && Math.hypot(p.x - lt.x, p.y - lt.y) < 14 / Math.max(1, px.w) && DBL_TOOLS.includes(tool)) {
      const t = textAt(p);
      if (t) { e.preventDefault(); if (pendingTap.current) { clearTimeout(pendingTap.current.timer); pendingTap.current = null; } lastTap.current = null; openEdit(t, e); return; }
    }
    flushTap();
    if (textRef.current) commitText();
    focusedCanvas = token.current; wrap.current?.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'eraser' || e.button === 5 || (e.buttons & 32)) { gesture.current = { type: 'erase', original: all(), working: all(), last: p, pointer }; eraseAt(p); return; }
    if (tool === 'laser') return;
    if (tool === 'spotlight' || tool === 'curtain') { gesture.current = { type: 'overlay', pointer }; overlay(p); return; }
    if (tool === 'select' || tool === 'lasso') {
      const items = chosen(), box = items.length ? selectionBounds(items) : null, pad = 7 / px.w, touch = 11 / px.w;
      if (box) {
        const cx = (box.x0 + box.x1) / 2;
        if (items.every(canRotate) && Math.hypot(p.x - cx, p.y - (box.y0 - pad - 24 / px.w)) < touch) { beginTransform('rotate', p, items, pointer); return; }
        if ([[box.x0 - pad, box.y0 - pad], [box.x1 + pad, box.y0 - pad], [box.x0 - pad, box.y1 + pad], [box.x1 + pad, box.y1 + pad]].some(([x, y]) => Math.hypot(p.x - x, p.y - y) < touch)) { beginTransform('scale', p, items, pointer); return; }
        if (!e.shiftKey && p.x >= box.x0 - pad && p.x <= box.x1 + pad && p.y >= box.y0 - pad && p.y <= box.y1 + pad) { beginTransform('move', p, items, pointer); return; }
      }
      const hits = [...all()].reverse().filter((s) => editable(s) && hit(s, p.x, p.y, touch)), top = hits.find((s) => s.tool !== 'image') ?? hits[0];
      if (tool === 'select' && top) { const ids = e.shiftKey ? selected.current.includes(top.id) ? selected.current.filter((id) => id !== top.id) : [...selected.current, top.id] : [top.id]; setSelection(ids); if (ids.includes(top.id)) beginTransform('move', p, all().filter((s) => ids.includes(s.id) && editable(s)), pointer); return; }
      setSelection([]); lasso.current = [p.x, p.y]; gesture.current = { type: 'lasso', start: p, pointer }; dirty.current = true; return;
    }
    if (tool === 'pointer' || author === 'student' && tool === 'obj') return;
    const s: Stroke = { id: freshId(), tool, color, size, pts: [p.x, p.y, p.p], author, layer };
    const physics = familyOf(useStore.getState().subject) === 'physics';
    if (tool === 'triangle' && !physics) s.shape = 'plain';
    if (tool === 'axes' && !physics) s.text = 'x,y';
    if (tool === 'obj') { const kind = useStore.getState().objKind; if (!isObjKind(kind)) return; draft.current = withObject(s, createObject(kind, p.x, p.y, s.id)); }
    else { if (TWO_POINT.includes(tool)) s.pts.push(p.x, p.y, p.p); draft.current = s; }
    gesture.current = { type: 'draw', start: p, pointer }; dirty.current = true; sendLive();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled) return; const p = point(e);
    pointerKind(e);
    if (penMode) { penAt.current = p; overlayDirty.current = true; } else if (penAt.current) { penAt.current = null; overlayDirty.current = true; }
    if (tool === 'eraser' || gesture.current?.type === 'erase') { eraserAt.current = p; dirty.current = true; }
    if (tool === 'laser') { const tr = myLaser.current; tr.pts.push(p.x, p.y); tr.at.push(performance.now()); if (tr.at.length > 160) { tr.pts.splice(0, 2); tr.at.shift(); } if (layer === 'public') bus.post({ t: 'laser', key: ikey, pts: [p.x, p.y], from: WINDOW_ID }); dirty.current = true; return; }
    if (foreign(e)) return;
    const g = gesture.current!;
    // 按键已经松开却没收到 pointerup（抬笔信号丢了）：按抬笔处理
    if (e.buttons === 0 && !e.pressure && e.pointerType !== 'touch') { finish(); return; }
    if (g.type === 'erase') { eraseAt(p); return; } if (g.type === 'overlay') { overlay(p); return; }
    if (g.type === 'lasso') { if (tool === 'select') lasso.current = [g.start.x, g.start.y, p.x, g.start.y, p.x, p.y, g.start.x, p.y]; else lasso.current?.push(p.x, p.y); dirty.current = true; return; }
    if (g.type === 'move' || g.type === 'scale' || g.type === 'rotate') {
      if (g.type === 'move') { let dx = p.x - g.start.x, dy = p.y - g.start.y; if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } preview.current = g.before.map((s) => moveStroke(s, dx, dy)); }
      if (g.type === 'scale') { const k = Math.hypot(p.x - g.center.x, p.y - g.center.y) / Math.max(.001, Math.hypot(g.start.x - g.center.x, g.start.y - g.center.y)); preview.current = g.before.map((s) => scaleStroke(s, g.center, k)); }
      if (g.type === 'rotate') { let angle = Math.atan2(p.y - g.center.y, p.x - g.center.x) - Math.atan2(g.start.y - g.center.y, g.start.x - g.center.x); if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); preview.current = g.before.map((s) => rotateStroke(s, g.center, angle)); }
      if (preview.current.length === 1) sendLive(preview.current[0]); dirty.current = true; return;
    }
    const d = draft.current; if (!d) return;
    if (d.obj) { const dx = p.x - g.start.x, dy = p.y - g.start.y; if (Math.hypot(dx, dy) > .01) { const original = createObject(d.obj.kind, 0, 0, d.id), w = Math.max(.008, Math.abs(dx)), h = e.shiftKey || keepsAspect(d.obj) ? Math.max(.008, w * original.h / original.w) : Math.max(.008, Math.abs(dy)); draft.current = withObject(d, updateObject(d.obj, { x: g.start.x + Math.sign(dx || 1) * w / 2, y: g.start.y + Math.sign(dy || 1) * h / 2, w, h })); } }
    else if (TWO_POINT.includes(d.tool)) { let { x, y } = p; if (e.shiftKey) { const a = Math.atan2(y - d.pts[1], x - d.pts[0]), length = Math.hypot(x - d.pts[0], y - d.pts[1]), sa = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); x = d.pts[0] + Math.cos(sa) * length; y = d.pts[1] + Math.sin(sa) * length; } d.pts = [d.pts[0], d.pts[1], d.pts[2], x, y, p.p]; if (d.tool === 'force') d.text = forceName(d.pts); }
    else if (FREE.includes(d.tool)) {
      const samples = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
      for (const sample of samples.length ? samples : [e]) { const q = point(sample), n = d.pts.length; if (Math.hypot(q.x - d.pts[n - 3], q.y - d.pts[n - 2]) > .0004) d.pts.push(q.x, q.y, q.p); }
      clearTimeout(still.current);
      if (d.tool === 'pen' && useStore.getState().inkOptions.shapeSnap) still.current = window.setTimeout(() => { const recognized = draft.current && recognize(draft.current); if (!recognized) return; draft.current = recognized; dirty.current = true; sendLive(); const b = selectionBounds([recognized]); setSnap({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }); clearTimeout(snapTimer.current); snapTimer.current = window.setTimeout(() => setSnap(null), 650); }, 520);
    }
    dirty.current = true; sendLive();
  };
  // macOS 上部分数位板驱动（如高漫）落笔、行笔报成 pen，抬笔却报成 mouse（pointerId 不同），甚至只发 pointercancel /
  // lostpointercapture、不发 pointerup。以前这些情况都当成「取消」把整笔丢掉，看起来就是写完立刻消失。
  // 现在：只有另一根手指的触摸才算别的指针；抬笔信号不论从哪条路来，都把已经写出来的这一笔保存下来。
  const foreign = (e: { pointerId: number; pointerType: string }) => { const g = gesture.current; return !g || g.pointer !== e.pointerId && e.pointerType === 'touch'; };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (foreign(e)) return;
    const g = gesture.current!;
    finish();
    const el = e.currentTarget;
    for (const id of new Set([e.pointerId, g.pointer])) { try { if (el.hasPointerCapture(id)) el.releasePointerCapture(id); } catch { /* 指针已失效 */ } }
  };
  const finish = () => {
    const g = gesture.current; if (!g) return;
    clearTimeout(still.current); clearLive(); const st = useStore.getState();
    if (g.type === 'erase') { const ids = new Set(g.working.map((s) => s.id)), originals = new Map(g.original.map((s) => [s.id, s])); const remove = g.original.filter((s) => !ids.has(s.id) && editable(s)).map((s) => s.id), upsert = g.working.filter((s) => originals.get(s.id) !== s); if (remove.length || upsert.length) st.editInk(ikey, { remove, upsert }, author); }
    else if (g.type === 'lasso') { const poly = lasso.current; if (poly && poly.length >= 6) setSelection(all().filter((s) => editable(s) && insideLasso(s, poly)).map((s) => s.id)); }
    else if (g.type === 'move' || g.type === 'scale' || g.type === 'rotate') { if (preview.current.length) st.editInk(ikey, { upsert: preview.current }, author); }
    else if (g.type === 'draw' && draft.current && isTap(draft.current) && textAt(g.start)) {
      // 在文字上点了一下：可能是双击改字的第一下，先等一会儿再落这个点
      const d = draft.current; flushTap();
      pendingTap.current = { stroke: d, timer: window.setTimeout(flushTap, 430) };
    }
    else if (g.type === 'draw' && draft.current) { const d = draft.current, tiny = TWO_POINT.includes(d.tool) && Math.hypot(d.pts[3] - d.pts[0], d.pts[4] - d.pts[1]) < .003; if (!tiny) { st.addStroke(ikey, d); if (d.obj) { setSelection([d.id]); if (author === 'teacher') st.setShared({ tool: 'select' }); } } }
    gesture.current = null; draft.current = null; preview.current = []; lasso.current = null; dirty.current = true;
  };
  const textAt = (p: Point) => [...all()].reverse().find((s) => s.tool === 'text' && editable(s) && hit(s, p.x, p.y, 4 / Math.max(1, px.w)));
  const flushTap = () => { const t = pendingTap.current; if (!t) return; clearTimeout(t.timer); pendingTap.current = null; useStore.getState().addStroke(ikey, t.stroke); };
  const openEdit = (t: Stroke, e: { preventDefault(): void }) => {
    e.preventDefault(); cancelGesture(); focusedCanvas = token.current;
    if (t.tex) { if (author === 'teacher' && ROLE !== 'student') useFormula.getState().open({ ikey, ids: [t.id], actor: author }); return; }
    textOpened.current = performance.now();
    setText({ x: t.pts[0], y: t.pts[1], value: t.text ?? '', id: t.id, edit: t });
  };
  /** 输入框里正在打的字（新写或修改）实时给学生画面看 */
  const textStroke = (t: NonNullable<typeof text>): Stroke => t.edit ? { ...t.edit, text: t.value } : { id: t.id, tool: 'text', color, size, pts: [t.x, t.y, .5], text: t.value, author, layer };
  const commitText = () => {
    const t = textRef.current; if (!t) return;
    setText(null); clearLive();
    const st = useStore.getState();
    if (t.edit) {
      const orig = all().find((s) => s.id === t.id); if (!orig) return;
      if (!t.value.trim()) st.editInk(ikey, { remove: [orig.id] }, author);
      else if (t.value !== orig.text) st.editInk(ikey, { upsert: [{ ...orig, text: t.value }] }, author);
      return;
    }
    if (t.value.trim()) st.addStroke(ikey, textStroke(t));
  };
  const cancelText = () => { setText(null); clearLive(); };
  const textBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    // 刚弹出就失焦（窗口激活、焦点桥切换）不算输入完成：拉回焦点
    if (performance.now() - textOpened.current < 400 && (!text?.value || text.edit)) { const el = e.currentTarget; setTimeout(() => el.isConnected && el.focus({ preventScroll: true }), 0); return; }
    commitText();
  };
  const selectedList = (strokes ?? []).filter((s) => selectedIds.includes(s.id) && editable(s));
  const bandStyle = bandH ? { top: bandTop * px.w, height: bandH * px.w, bottom: 'auto' } : undefined;
  const cursor = !enabled ? 'default' : tool === 'eraser' ? 'none' : tool === 'text' ? 'text' : tool === 'select' || tool === 'lasso' ? 'default' : tool === 'laser' || tool === 'spotlight' ? 'none' : tool === 'curtain' ? 'ns-resize' : pen ? 'none' : 'crosshair';
  return <div ref={wrap} className="ink" tabIndex={enabled ? 0 : -1} aria-label={layer === 'private' ? '教师私有批注画布' : '课堂板书画布'} onFocus={() => { focusedCanvas = token.current; }} style={{ pointerEvents: enabled ? 'auto' : 'none', cursor }}>
    <canvas ref={base} className="ink-c" style={bandStyle} />
    <canvas ref={live} className="ink-c" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={(e) => { if (!foreign(e)) finish(); }} onLostPointerCapture={(e) => { if (!foreign(e)) finish(); }} onPointerLeave={() => { eraserAt.current = null; penAt.current = null; dirty.current = true; if (tool === 'laser') { myLaser.current = { pts: [], at: [] }; dirty.current = true; } }} style={{ ...bandStyle, touchAction: 'none' }} />
    {snap && <div className="snap-flash" style={{ left: snap.x * 100 + '%', top: snap.y / ratio * 100 + '%' }} />}
    {text && <textarea autoFocus className={'ink-text' + (text.edit ? ' editing' : '')} style={{ left: text.x * 100 + '%', top: text.y / ratio * 100 + '%', fontSize: Math.max(16, (text.edit?.size ?? size) * 8) * px.w / 1000, color: resolveColor(text.edit?.color ?? color, boardSkin, onPage) }} value={text.value} placeholder={text.edit ? '修改文字，点空白处完成；清空就删除' : '输入文字，Ctrl+Enter 完成'} rows={Math.max(1, text.value.split('\n').length)}
      ref={(el) => { if (el && document.activeElement !== el && performance.now() - textOpened.current < 400) requestAnimationFrame(() => { if (!el.isConnected) return; el.focus({ preventScroll: true }); if (text.edit) el.setSelectionRange(el.value.length, el.value.length); }); }}
      onPointerDown={(e) => e.stopPropagation()} onChange={(e) => { const next = { ...text, value: e.target.value }; setText(next); sendLive(textStroke(next)); }} onBlur={textBlur}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') cancelText(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText(); }} />}
    {layer === 'private' && ROLE !== 'student' && selectedList.length > 0 && createPortal(<div className="obj-private-editor"><SelectionEditor ikey={ikey} strokes={selectedList} actor={author} onClose={() => setSelection([])} onSelection={(ids) => setSelection(ids)} /></div>, document.body)}
  </div>;
}

function forceName(p: number[]) { const a = Math.atan2(p[4] - p[1], p[3] - p[0]) * 180 / Math.PI; return a > 60 && a < 120 ? 'G' : a < -60 && a > -120 ? 'F_N' : 'F'; }
function drawSelection(ctx: CanvasRenderingContext2D, b: Box, width: number, rotatable: boolean) {
  const u = 1 / width, pad = 7 * u, cx = (b.x0 + b.x1) / 2;
  ctx.save(); ctx.strokeStyle = '#3dd9eb'; ctx.fillStyle = '#14232a'; ctx.lineWidth = 1.3 * u; ctx.setLineDash([5 * u, 4 * u]); ctx.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad); ctx.setLineDash([]);
  for (const [x, y] of [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x0 - pad, b.y1 + pad], [b.x1 + pad, b.y1 + pad]]) { ctx.fillRect(x - 4 * u, y - 4 * u, 8 * u, 8 * u); ctx.strokeRect(x - 4 * u, y - 4 * u, 8 * u, 8 * u); }
  if (rotatable) { ctx.beginPath(); ctx.moveTo(cx, b.y0 - pad); ctx.lineTo(cx, b.y0 - pad - 24 * u); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, b.y0 - pad - 24 * u, 5 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } ctx.restore();
}
function drawCross(ctx: CanvasRenderingContext2D, p: Point, width: number, dark: boolean) {
  const u = 1 / width, arm = 9 * u, gap = 2.5 * u;
  ctx.save(); ctx.lineCap = 'round'; ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(p.x + dx * gap, p.y + dy * gap); ctx.lineTo(p.x + dx * arm, p.y + dy * arm); }
  // 双色描边：深色黑板、浅色黑板、白纸、课件图片上都看得清
  ctx.lineWidth = 3.2 * u; ctx.strokeStyle = dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.85)'; ctx.stroke();
  ctx.lineWidth = 1.3 * u; ctx.strokeStyle = dark ? 'rgba(255,255,255,.95)' : 'rgba(20,20,20,.9)'; ctx.stroke();
  ctx.restore();
}
function drawLaser(ctx: CanvasRenderingContext2D, trail: { pts: number[]; at: number[] }, now: number) {
  const life = 650; while (trail.at.length && now - trail.at[0] > life) { trail.at.shift(); trail.pts.splice(0, 2); } if (!trail.at.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 12;
  for (let i = 2; i < trail.pts.length; i += 2) { const k = 1 - (now - trail.at[i / 2]) / life; ctx.strokeStyle = `rgba(255,59,48,${k * .9})`; ctx.lineWidth = .0035 * (.3 + k); ctx.beginPath(); ctx.moveTo(trail.pts[i - 2], trail.pts[i - 1]); ctx.lineTo(trail.pts[i], trail.pts[i + 1]); ctx.stroke(); }
  ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(trail.pts.at(-2)!, trail.pts.at(-1)!, .003, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
