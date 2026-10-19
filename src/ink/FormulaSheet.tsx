// 公式面板：识别选中的手写笔迹 / 直接输入 LaTeX / 修改板书上的公式。
// 面板挂在工具条外面（全局一个），选中编辑弹窗点「识别公式」时它自己会关掉，不能把面板放在里面。
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { ArrowDownToLine, Copy, Loader2, Replace, RotateCcw, Sigma, X } from 'lucide-react';
import { ai, type AiConfig } from '../lib/ai';
import { cleanLatex, recognizeInk, texPlain } from '../lib/formulaAi';
import { DARK_BOARDS, resolveColor, useStore } from '../lib/store';
import { familyOf } from '../lib/subjects';
import type { Author, Stroke } from '../lib/types';
import { freshId, selectionBounds } from './geometry';
import { strokesToPng } from './snapshot';
import { drawTexShape, loadTex } from './texCache';
import type { TexShape } from './tex';
import '../styles/formula.css';

export type FormulaReq = { ikey: string; ids: string[]; actor: Author; at?: { x: number; y: number } };
export const useFormula = create<{ req: FormulaReq | null; open: (r: FormulaReq) => void; close: () => void }>()((set) => ({
  req: null, open: (req) => set({ req }), close: () => set({ req: null }),
}));
const FREE = ['pen', 'marker', 'highlighter', 'curve', 'line', 'arrow', 'dashed'];
/** 选中的内容里有没有可以识别的手写笔迹 */
export const hasInk = (strokes: Stroke[]) => strokes.some((s) => FREE.includes(s.tool) && !s.obj);
const EXAMPLES = ['\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', 'v=v_0+at', '\\ce{2H2 + O2 ->[点燃] 2H2O}', '\\sin^2\\alpha+\\cos^2\\alpha=1'];

export function FormulaHost() {
  const req = useFormula((s) => s.req);
  return req ? createPortal(<FormulaSheet key={req.ikey + req.ids.join()} req={req} onClose={() => useFormula.getState().close()} />, document.body) : null;
}

function FormulaSheet({ req, onClose }: { req: FormulaReq; onClose: () => void }) {
  const { ikey, actor } = req;
  const subject = useStore((s) => s.subject), family = familyOf(subject), boardSkin = useStore((s) => s.boardSkin), onBoard = useStore((s) => s.pgmMat.kind === 'board');
  const strokes = useMemo(() => (useStore.getState().ink[ikey] ?? []).filter((s) => req.ids.includes(s.id)), [ikey, req.ids]);
  const editing = strokes.length === 1 && strokes[0].tex ? strokes[0] : null;
  const ink = useMemo(() => strokes.filter((s) => !s.tex && !s.obj), [strokes]);
  const mode = editing ? 'edit' : hasInk(ink) ? 'read' : 'insert';
  const shot = useMemo(() => (mode === 'read' ? strokesToPng(ink) : null), [mode, ink]);
  const [latex, setLatex] = useState(editing?.tex ?? '');
  // 模型给的纯文本读法只对它给的那版 LaTeX 有效；老师改过 LaTeX 就按新公式重新生成
  const [plain, setPlain] = useState({ tex: editing?.tex ?? '', text: editing?.text ?? '' });
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [err, setErr] = useState(''), [note, setNote] = useState('');
  const [shape, setShape] = useState<TexShape | null>(null), [texErr, setTexErr] = useState('');
  const [cfg, setCfg] = useState<AiConfig | null>(null), [copied, setCopied] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null), area = useRef<HTMLTextAreaElement>(null);
  const color = editing?.color ?? ink[0]?.color ?? useStore.getState().color;

  const read = async () => {
    if (!shot) return;
    setBusy(true); setErr(''); setNote(''); setStatus('正在识别手写内容…');
    try {
      const c = cfg ?? await ai.config().catch(() => null); setCfg(c);
      const r = await recognizeInk(c, shot.url, subject);
      setLatex(r.latex); setPlain({ tex: r.latex, text: r.text }); setNote(r.note); setStatus('识别完成 · ' + r.model + '。核对一下，可以直接改 LaTeX。');
    } catch (e) { setStatus(''); setErr((e as Error).message); requestAnimationFrame(() => area.current?.focus()); } finally { setBusy(false); }
  };
  useEffect(() => { if (mode === 'read') void read(); else requestAnimationFrame(() => area.current?.focus()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  // 预览用和板书完全相同的渲染（MathJax 轮廓），所见即所得
  useEffect(() => {
    const t = cleanLatex(latex); if (!t) { setShape(null); setTexErr(''); return; }
    let live = true;
    const timer = setTimeout(() => void loadTex().then((m) => { if (!live) return; try { setShape(m.compileTex(t)); setTexErr(''); } catch (e) { setShape(null); setTexErr((e as Error).message); } }), 180);
    return () => { live = false; clearTimeout(timer); };
  }, [latex]);
  const dark = onBoard && DARK_BOARDS.includes(boardSkin);
  useEffect(() => {
    const c = preview.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    if (!shape) return;
    ctx.fillStyle = resolveColor(color, boardSkin, !onBoard);
    const pad = 14, k = Math.min((r.width - pad * 2) / shape.w, (r.height - pad * 2) / shape.h, 0.06), w = shape.w * k, h = shape.h * k;
    drawTexShape(ctx, shape, (r.width - w) / 2, (r.height - h) / 2, (r.width + w) / 2, (r.height + h) / 2);
  }, [shape, color, boardSkin, onBoard]);

  /** 直接插入时放在已有板书下面的空白处，页面放不下就回到顶部 */
  const freeY = (h: number) => {
    const st = useStore.getState(), page = ikey.startsWith(st.pgmMat.id + '#') ? st.pgmMat.pages[Number(ikey.split('#').pop())] : undefined;
    const pageH = page?.w && page.h ? page.h / page.w : 0.5625, list = (st.ink[ikey] ?? []).filter((s) => s.layer !== 'private');
    const top = req.at?.y ?? 0.1, bottom = list.length ? selectionBounds(list).y1 + 0.025 : top;
    return bottom + h < pageH - 0.02 ? Math.max(top, bottom) : top;
  };
  const place = (where: 'replace' | 'below' | 'insert' | 'edit') => {
    const tex = cleanLatex(latex); if (!tex || !shape) return;
    const st = useStore.getState(), aspect = shape.w / shape.h;
    const b = editing ? selectionBounds([editing]) : ink.length ? selectionBounds(ink) : null;
    // 公式高度跟着手写的高度走；单行手写通常比排版后的字矮，给个下限，太宽就整体缩小
    let h = b ? Math.min(0.3, Math.max(0.035, b.y1 - b.y0)) : 0.05, w = h * aspect;
    if (w > 0.9) { h *= 0.9 / w; w = 0.9; }
    let x0 = b ? b.x0 : (req.at?.x ?? 0.5) - w / 2, y0 = b ? (b.y0 + b.y1) / 2 - h / 2 : freeY(h);
    if (where === 'below' && b) y0 = b.y1 + 0.012;
    if (editing) y0 = b!.y0;
    x0 = Math.max(0.005, Math.min(0.995 - w, x0));
    const s: Stroke = { id: editing?.id ?? freshId(), tool: 'text', color, size: editing?.size ?? 3.5, pts: [x0, y0, .5, x0 + w, y0 + h, .5], text: (plain.tex === tex && plain.text.trim()) || texPlain(tex), tex, author: editing?.author ?? actor, layer: editing?.layer ?? ink[0]?.layer ?? 'public' };
    st.editInk(ikey, { remove: where === 'replace' ? ink.map((x) => x.id) : [], upsert: [s] }, actor);
    if (s.layer !== 'private') { st.set({ tool: 'select', drawAuthor: 'teacher' }); st.setShared({ selectedInk: { key: ikey, ids: [s.id] } }); }
    onClose();
  };
  const copy = () => void navigator.clipboard.writeText(cleanLatex(latex)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }, () => setErr('复制失败：窗口没有拿到剪贴板权限'));
  const ok = !!shape && !texErr && !busy;
  const title = mode === 'read' ? '识别手写公式' : mode === 'edit' ? '修改公式' : '插入公式';

  return <div className="fx-bg" data-ink-pop onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="fx" role="dialog" aria-label={title} onKeyDown={(e) => e.stopPropagation()}>
      <header><Sigma size={16} /><b>{title}</b><span className="flex" /><button onClick={onClose} aria-label="关闭"><X size={16} /></button></header>
      {shot && <div className="fx-shot"><img src={shot.url} alt="选中的手写笔迹" /><span>选中的笔迹</span></div>}
      {(status || err) && <p className={'fx-status' + (err ? ' bad' : '')}>{busy && <Loader2 size={13} className="fx-spin" />}{err || status}</p>}
      <label className="fx-tex"><span>LaTeX <i>{family === 'chem' ? '化学式用 \\ce{…}，' : ''}多行用 \begin{'{aligned}'} … \\ 换行</i></span>
        <textarea ref={area} rows={3} value={latex} spellCheck={false} placeholder={busy ? '' : '例如 ' + EXAMPLES[family === 'chem' ? 2 : family === 'math' ? 0 : 1]} onChange={(e) => setLatex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) place(mode === 'read' ? 'replace' : mode); }} />
      </label>
      {!latex && !busy && <div className="fx-eg">{EXAMPLES.map((x) => <button key={x} onClick={() => setLatex(x)}>{x.length > 26 ? x.slice(0, 24) + '…' : x}</button>)}</div>}
      <div className={'fx-preview' + (dark ? ' dark' : '')}><canvas ref={preview} />{!shape && <span>{texErr ? '公式有误：' + texErr : busy ? '' : '预览'}</span>}</div>
      {note && <p className="fx-note">模型提示：{note}</p>}
      <footer>
        {mode === 'read' && <><button className="fx-go" disabled={!ok} onClick={() => place('replace')} data-tip="删掉手写笔迹，换成排版好的公式（可撤销）"><Replace size={14} />替换笔迹</button><button disabled={!ok} onClick={() => place('below')} data-tip="保留手写，在下方放一份排版公式"><ArrowDownToLine size={14} />放在下方</button></>}
        {mode === 'insert' && <button className="fx-go" disabled={!ok} onClick={() => place('insert')}><ArrowDownToLine size={14} />放到板书上</button>}
        {mode === 'edit' && <button className="fx-go" disabled={!ok} onClick={() => place('edit')}><Replace size={14} />更新公式</button>}
        <button disabled={!cleanLatex(latex)} onClick={copy}><Copy size={14} />{copied ? '已复制' : '复制 LaTeX'}</button>
        <span className="flex" />
        {mode === 'read' && <button disabled={busy} onClick={() => void read()}><RotateCcw size={14} />重新识别</button>}
      </footer>
    </section>
  </div>;
}
