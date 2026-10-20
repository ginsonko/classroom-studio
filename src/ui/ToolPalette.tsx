import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Circle, Eraser, Highlighter, Lasso, Minus, MousePointer2, MoveUpRight, Pencil, Square, Type, BoxSelect, Shapes, SlidersHorizontal, Sigma, Triangle,
} from 'lucide-react';
import { DARK_BOARDS, PEN_COLORS, ROLE, STUDENT_COLOR, inkKey, useStore } from '../lib/store';
import { familyOf } from '../lib/subjects';
import type { Stroke, Tool } from '../lib/types';
import { IAxes, ICurtain, ICurveArrow, IDArrow, IDashed, IForce, IIncline, ILaser, IMarker, ISpot } from './icons';
import { ObjectLibrary } from '../physics/edit/ObjectLibrary';
import { SelectionEditor } from '../physics/edit/SelectionEditor';
import { hasInk, useFormula } from '../ink/FormulaSheet';

const formulaTip = (sel: Stroke[]) => sel.length === 1 && sel[0].tex ? '修改选中的公式' : hasInk(sel) ? '把选中的手写笔迹识别成排版公式（用 AI 看图）' : '公式 · 先用套索圈住手写公式再点这里识别；不选就直接输入 LaTeX';

type Ico = ComponentType<{ size?: number; strokeWidth?: number }>;
export const TOOL_META: Record<string, { icon: Ico; name: string; key?: string }> = {
  pointer: { icon: MousePointer2, name: '操作课件', key: 'V' },
  select: { icon: BoxSelect, name: '选择编辑 · 移动、缩放、旋转', key: 'S' },
  lasso: { icon: Lasso, name: '套索选择 · 多选、变换、复制', key: 'G' },
  obj: { icon: Shapes, name: '物理器材 · 力学、电磁场、电路', key: 'O' },
  pen: { icon: Pencil, name: '钢笔 · 压感，停顿半秒自动规整图形', key: 'P' },
  marker: { icon: IMarker, name: '马克笔 · 粗细均匀' },
  highlighter: { icon: Highlighter, name: '荧光笔 · 不遮盖文字', key: 'H' },
  eraser: { icon: Eraser, name: '橡皮 · 再点一次选局部 / 整笔擦除和大小，笔尾也能擦', key: 'E' },
  line: { icon: Minus, name: '直线 · Shift 锁 15°', key: 'L' },
  arrow: { icon: MoveUpRight, name: '箭头', key: 'A' },
  darrow: { icon: IDArrow, name: '双向箭头' },
  curve: { icon: ICurveArrow, name: '曲线箭头' },
  dashed: { icon: IDashed, name: '虚线 · 辅助线' },
  rect: { icon: Square, name: '矩形 · 物块' },
  ellipse: { icon: Circle, name: '圆 / 椭圆' },
  triangle: { icon: IIncline, name: '斜面 · 带地面阴影线' },
  force: { icon: IForce, name: '力 · 自动标 G、F_N、F', key: 'F' },
  axes: { icon: IAxes, name: '坐标系 · v–t / x–t' },
  text: { icon: Type, name: '文字', key: 'T' },
  laser: { icon: ILaser, name: '激光笔 · 学生能看到拖尾', key: 'Q' },
  spotlight: { icon: ISpot, name: '聚光灯 · 只照亮一块' },
  curtain: { icon: ICurtain, name: '幕布 · 遮住下方，拖动揭开' },
};

/** 非物理学科的形状菜单：不再叫「物块 / 斜面」，三角形不带地面阴影线，坐标系默认 x–y */
const GENERAL_META: Record<string, { icon?: Ico; name: string }> = {
  obj: { name: '绘图库 · 数学图形、化学仪器、物理器材' },
  rect: { name: '矩形' },
  triangle: { icon: Triangle, name: '三角形' },
  axes: { name: '坐标系 · x–y' },
};
const metaOf = (t: string, physics: boolean) => physics ? TOOL_META[t] : { ...TOOL_META[t], ...GENERAL_META[t] };

const GROUPS: { id: string; tools: Tool[] }[] = [
  { id: 'select', tools: ['pointer', 'select', 'lasso'] },
  { id: 'write', tools: ['pen', 'marker', 'highlighter'] },
  { id: 'erase', tools: ['eraser'] },
  { id: 'lines', tools: ['arrow', 'line', 'darrow', 'curve', 'dashed'] },
  { id: 'shapes', tools: ['rect', 'ellipse', 'triangle'] },
  { id: 'physics', tools: ['force', 'axes'] },
  { id: 'text', tools: ['text'] },
  { id: 'teach', tools: ['laser', 'spotlight', 'curtain'] },
];
export const STUDENT_TOOLS: Tool[] = ['pointer', 'pen', 'highlighter', 'arrow', 'ellipse', 'eraser'];
const SIZES = [{ v: 1, n: '超细' }, { v: 2, n: '细' }, { v: 3.5, n: '中' }, { v: 6, n: '粗' }];
export const SIZE_MIN = 0.4, SIZE_MAX = 12;

interface Props {
  tool: Tool;
  color: string;
  size: number;
  onTool: (t: Tool) => void;
  onColor?: (c: string) => void;
  onSize: (s: number) => void;
  vertical?: boolean;
  student?: boolean;
  disabled?: boolean;
}

export function ToolPalette({ tool, color, size, onTool, onColor, onSize, vertical, student, disabled }: Props) {
  const boardSkin = useStore((s) => s.boardSkin);
  const pgmKind = useStore((s) => s.pgmMat.kind);
  const objKind = useStore((s) => s.objKind);
  const selected = useStore((s) => s.selectedInk);
  const ink = useStore((s) => s.ink);
  const inkOptions = useStore((s) => s.inkOptions);
  const pgm = useStore((s) => s.pgm);
  const dark = pgmKind === 'board' && DARK_BOARDS.includes(boardSkin);
  const [last, setLast] = useState<Record<string, Tool>>({});
  const [fly, setFly] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const objectButton = useRef<HTMLButtonElement>(null), editorButton = useRef<HTMLButtonElement>(null);
  const [objectsOpen, setObjectsOpen] = useState(false), [editorOpen, setEditorOpen] = useState(false);
  // 浮层窗口拿不到学生列表，用同步过来的当前学科决定形状菜单的叫法
  const physics = useStore((s) => ['physics', 'science'].includes(familyOf(s.subject)));
  const groups = physics ? GROUPS : GROUPS.map((g) => g.id === 'physics' ? { ...g, tools: g.tools.filter((t) => t !== 'force') } : g);
  const selection = selected ? (ink[selected.key] ?? []).filter((s) => selected.ids.includes(s.id) && s.layer !== 'private') : [];
  const changeOptions = (patch: Partial<typeof inkOptions>) => useStore.getState().setShared({ inkOptions: { ...useStore.getState().inkOptions, ...patch } });

  useEffect(() => {
    if (!fly) return;
    const off = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-ink-pop]')) setFly(null); };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [fly]);

  const btn = (t: Tool, extra?: { onClick?: () => void; caret?: boolean; active?: boolean }) => {
    const M = metaOf(t, physics);
    const I = M.icon;
    return (
      <button
        key={t}
        className={'tp-b' + ((extra?.active ?? tool === t) ? ' on' : '')}
        onClick={extra?.onClick ?? (() => onTool(t))}
        disabled={disabled}
        data-tip={M.name + (M.key ? `　${M.key}` : '')}
        aria-label={M.name}
      >
        <I size={18} strokeWidth={1.9} />
        {extra?.caret && <i className="tp-caret" />}
      </button>
    );
  };

  return (
    <div ref={root} className={'tp' + (vertical ? ' v' : '') + (student ? ' student' : '')}>
      {/* 0.9.1 起师生工具合一：学生拿到和老师一样的工具组，只是笔色固定为品红 */}
      {groups.map((g) => {
            const cur = g.tools.includes(tool) ? tool : last[g.id] ?? g.tools[0];
            const active = g.tools.includes(tool);
            return (
              <div key={g.id} className="tp-g">
                {btn(cur, {
                  active,
                  caret: g.tools.length > 1 || g.id === 'erase',
                  onClick: () => {
                    if (active && (g.tools.length > 1 || g.id === 'erase')) setFly(fly === g.id ? null : g.id);
                    else { onTool(cur); setFly(null); }
                  },
                })}
                {fly === g.id && (
                  <div className="tp-fly">
                    {g.id !== 'erase' && g.tools.map((t) => {
                      const M = metaOf(t, physics), I = M.icon;
                      return (
                        <button key={t} className={'tp-fi' + (t === tool ? ' on' : '')} onClick={() => { onTool(t); setLast({ ...last, [g.id]: t }); setFly(null); }}>
                          <I size={17} strokeWidth={1.9} />
                          <span>{M.name.split(' · ')[0]}</span>
                          <small>{M.name.split(' · ')[1] ?? ''}</small>
                        </button>
                      );
                    })}
                    {g.id === 'erase' && <div className="ink-options eraser-options">
                      <div className="eo-row" role="radiogroup" aria-label="擦除方式">
                        <button role="radio" aria-checked={inkOptions.eraserMode !== 'stroke'} className={inkOptions.eraserMode !== 'stroke' ? 'on' : ''} onClick={() => changeOptions({ eraserMode: 'segment' })}><b>局部擦除</b><small>像真橡皮，擦到哪断到哪</small></button>
                        <button role="radio" aria-checked={inkOptions.eraserMode === 'stroke'} className={inkOptions.eraserMode === 'stroke' ? 'on' : ''} onClick={() => changeOptions({ eraserMode: 'stroke' })}><b>整笔擦除</b><small>碰到哪笔删哪笔</small></button>
                      </div>
                      <div className="eo-row eo-size" role="radiogroup" aria-label="橡皮大小">
                        <span>大小</span>
                        {(['s', 'm', 'l'] as const).map((k) => <button key={k} role="radio" aria-checked={(inkOptions.eraserSize ?? 'm') === k} className={(inkOptions.eraserSize ?? 'm') === k ? 'on' : ''} onClick={() => changeOptions({ eraserSize: k })} aria-label={'橡皮' + { s: '小', m: '中', l: '大' }[k]}><i style={{ width: { s: 8, m: 14, l: 22 }[k], height: { s: 8, m: 14, l: 22 }[k] }} /></button>)}
                      </div>
                    </div>}
                    {g.id === 'write' && <div className="ink-options"><label><input type="checkbox" checked={inkOptions.shapeSnap} onChange={(e) => changeOptions({ shapeSnap: e.target.checked })} />停笔自动规整图形</label></div>}
                  </div>
                )}
              </div>
            );
          })}
      {!student && <button ref={objectButton} disabled={disabled} className={'tp-b' + (tool === 'obj' || objectsOpen ? ' on' : '')} onClick={() => { setObjectsOpen(!objectsOpen); setEditorOpen(false); setFly(null); }} aria-label="绘图库" data-tip="绘图库 · 物理器材、数学图形、化学仪器，选好后在画布上点一下或拖出大小"><Shapes size={18} /><i className="tp-caret" /></button>}
      <button ref={editorButton} className={'tp-b' + (editorOpen ? ' on' : '')} disabled={!selection.length || disabled} onClick={() => { setEditorOpen(!editorOpen); setObjectsOpen(false); setFly(null); }} aria-label="编辑选中内容" data-tip="编辑选中内容：颜色、粗细，图形的大小、方向和参数"><SlidersHorizontal size={18} />{selection.length > 1 && <small className="obj-tool-hint">{selection.length}</small>}</button>
      {ROLE !== 'student' && <button className="tp-b tp-fx" disabled={disabled} onClick={() => { setEditorOpen(false); setObjectsOpen(false); setFly(null); useFormula.getState().open({ ikey: selected?.key ?? inkKey(pgm.materialId, pgm.page), ids: selection.map((s) => s.id), actor: 'teacher', at: { x: .5, y: .12 } }); }} aria-label="公式" data-tip={formulaTip(selection)}><Sigma size={18} /></button>}
      <span className="tp-sep" />
      {student ? (
        <span className="tp-swatch on" style={{ background: dark ? STUDENT_COLOR.dark : STUDENT_COLOR.light }} data-tip="学生笔迹固定为品红色，便于区分" />
      ) : (
        PEN_COLORS.map((c) => (
          <button
            key={c.id}
            className={'tp-swatch' + (color === c.id ? ' on' : '')}
            style={{ background: dark ? c.dark : c.light }}
            onClick={() => onColor?.(c.id)}
            disabled={disabled}
            data-tip={c.name + (c.id === 'ink' ? ' · 黑板上自动变粉笔白' : '')}
            aria-label={c.name}
          />
        ))
      )}
      <span className="tp-sep" />
      <div className="tp-sizes">
        {SIZES.map((s) => (
          <button key={s.v} disabled={disabled} className={'tp-size' + (Math.abs(size - s.v) < 0.1 ? ' on' : '')} onClick={() => onSize(s.v)} data-tip={s.n} aria-label={'粗细 ' + s.n}>
            <i style={{ width: s.v * 2.2 + 2, height: s.v * 2.2 + 2 }} />
          </button>
        ))}
        <button disabled={disabled} className={'tp-size tp-size-more' + (fly === 'size' || !SIZES.some((s) => Math.abs(size - s.v) < 0.1) ? ' on' : '')} onClick={() => setFly(fly === 'size' ? null : 'size')} data-tip="自由调粗细" aria-label="自由调粗细">
          <SlidersHorizontal size={13} />
        </button>
        {fly === 'size' && (
          <div className="tp-fly tp-size-fly">
            <div className="tsf-h"><b>笔的粗细</b><span className="num">{size.toFixed(1)}</span></div>
            <svg className="tsf-prev" viewBox="0 0 200 36" aria-hidden><path d="M10 26 C 50 4, 90 4, 110 18 S 170 32, 190 10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={Math.max(0.6, size * 2.2)} /></svg>
            <input type="range" min={SIZE_MIN} max={SIZE_MAX} step={0.1} value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="粗细滑块" />
            <div className="tsf-marks">{SIZES.map((s) => <button key={s.v} className={Math.abs(size - s.v) < 0.1 ? 'on' : ''} onClick={() => onSize(s.v)}>{s.n}</button>)}</div>
          </div>
        )}
      </div>
      {objectsOpen && !student && <AnchoredPopup anchor={objectButton.current} vertical={vertical} onClose={() => setObjectsOpen(false)}><ObjectLibrary current={objKind} onClose={() => setObjectsOpen(false)} onSelect={(kind) => { useStore.getState().setShared({ objKind: kind }); onTool('obj'); setObjectsOpen(false); }} /></AnchoredPopup>}
      {editorOpen && selected && selection.length > 0 && <AnchoredPopup anchor={editorButton.current} vertical={vertical} onClose={() => setEditorOpen(false)}><SelectionEditor ikey={selected.key} strokes={selection} onClose={() => setEditorOpen(false)} onSelection={(ids) => useStore.getState().setShared({ selectedInk: ids.length ? { key: selected.key, ids } : null })} /></AnchoredPopup>}
    </div>
  );
}

export function AnchoredPopup({ anchor, children, vertical, onClose }: { anchor: HTMLElement | null; children: ReactNode; vertical?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !ref.current) return;
      // 用布局尺寸：弹出动画带 scale，getBoundingClientRect 会量到缩小后的尺寸
      const a = anchor.getBoundingClientRect(), p = { width: ref.current.offsetWidth, height: ref.current.offsetHeight };
      const right = a.right + 10, flip = vertical && right + p.width > innerWidth - 8 && a.left - 10 - p.width >= 8;
      const left = vertical ? (flip ? a.left - 10 - p.width : right) : a.left, top = vertical ? a.top : a.top - p.height - 8;
      setPos({ left: Math.max(8, Math.min(innerWidth - p.width - 8, left)), top: Math.max(8, Math.min(innerHeight - p.height - 8, top < 8 && a.bottom + p.height + 8 < innerHeight ? a.bottom + 8 : top)) });
    };
    place(); const observer = new ResizeObserver(place); if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', place); return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [anchor, vertical]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down); window.addEventListener('keydown', key); return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  return createPortal(<div ref={ref} className="obj-pop" data-ink-pop style={pos}>{children}</div>, document.body);
}

/** 键盘快捷键：P/H/E/L/A/F/T/Q/S/V */
export function useToolKeys(onTool: (t: Tool) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || el.closest('input,textarea,[contenteditable]')) return;
      const hit = Object.entries(TOOL_META).find(([, m]) => m.key === e.key.toUpperCase());
      if (hit) onTool(hit[0] as Tool);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onTool, enabled]);
}
