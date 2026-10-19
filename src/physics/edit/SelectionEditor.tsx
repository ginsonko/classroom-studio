import { useEffect, useRef, useState } from 'react';
import { Copy, RotateCcw, Sigma, Trash2, X } from 'lucide-react';
import { PEN_COLORS, useStore } from '../../lib/store';
import type { Author, Stroke } from '../../lib/types';
import { duplicateStroke, withObject } from '../../ink/geometry';
import { OBJECT_CATALOG, updateObject, type PropSpec } from '../catalog';
import type { PhysObj } from '../model';
import { hasInk, useFormula } from '../../ink/FormulaSheet';
import '../../styles/objects.css';

function Numeric({ value, field, onCommit }: { value: number; field: PropSpec; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setText(String(Number(value.toPrecision(8)))), [value]);
  const commit = () => { if (cancelled.current) { cancelled.current = false; setText(String(value)); return; } const n = Number(text); if (text.trim() && Number.isFinite(n)) { const v = Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, n)); if (v !== value) onCommit(v); setText(String(v)); } else setText(String(value)); };
  return <label className="obj-field"><span>{field.label}</span><div><input type="number" value={text} min={field.min} max={field.max} step={field.step ?? .1} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; setText(String(value)); e.currentTarget.blur(); } }} /><small>{field.unit}</small></div></label>;
}

export function SelectionEditor({ ikey, strokes, actor = 'teacher', onClose, onSelection }: { ikey: string; strokes: Stroke[]; actor?: Author; onClose: () => void; onSelection?: (ids: string[]) => void }) {
  const single = strokes.length === 1 ? strokes[0] : null, object = single?.obj;
  const edit = useStore((s) => s.editInk);
  const [label, setLabel] = useState(object?.label ?? single?.text ?? '');
  useEffect(() => setLabel(object?.label ?? single?.text ?? ''), [single?.id, object?.label, single?.text]);
  const update = (patch: Partial<PhysObj>) => { if (single && object) edit(ikey, { upsert: [withObject(single, updateObject(object, patch))] }, actor); };
  const setLabelValue = () => { if (object) { if (label !== (object.label ?? '')) update({ label }); } else if (single && ['text', 'force', 'axes'].includes(single.tool) && label !== single.text) edit(ikey, { upsert: [{ ...single, text: label }] }, actor); };
  if (!strokes.length) return null;
  return <section className="obj-inspector" aria-label="选中内容属性" onKeyDown={(e) => e.stopPropagation()}>
    <header><b>{object ? OBJECT_CATALOG[object.kind].name : `已选 ${strokes.length} 项`}</b><span>可撤销编辑</span><button onClick={onClose} aria-label="关闭属性"><X size={15} /></button></header>
    <div className="obj-editor-scroll">
      {(object || (single && !single.tex && ['text', 'force', 'axes'].includes(single.tool))) && <label className="obj-field obj-label"><span>{object ? '符号 / 名称' : single?.tool === 'axes' ? '坐标标签 x,y' : '文字 / 符号'}</span><input value={label} maxLength={200} placeholder="如 m₁、A、F_N" onChange={(e) => setLabel(e.target.value)} onBlur={setLabelValue} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>}
      {object && <><div className="obj-section">画面尺寸与方向</div>
        <Numeric value={object.w * 100} field={{ key: 'w', label: '宽度', unit: '%页宽', min: .8, max: 400, step: 1 }} onCommit={(v) => update({ w: v / 100 })} />
        <Numeric value={object.h * 100} field={{ key: 'h', label: '高度', unit: '%页宽', min: .8, max: 400, step: 1 }} onCommit={(v) => update({ h: v / 100 })} />
        <Numeric value={object.rot * 180 / Math.PI} field={{ key: 'rot', label: '旋转', unit: '°', step: 15 }} onCommit={(v) => update({ rot: v * Math.PI / 180 })} />
        {OBJECT_CATALOG[object.kind].fields.length > 0 && <div className="obj-section">物理参数 · SI 单位</div>}
        {OBJECT_CATALOG[object.kind].fields.map((f) => f.type === 'boolean' ? <label key={f.key} className="obj-check"><input type="checkbox" checked={object.props[f.key] === true} onChange={(e) => update({ props: { ...object.props, [f.key]: e.target.checked } })} />{f.label}</label> : <Numeric key={f.key} value={Number(object.props[f.key] ?? OBJECT_CATALOG[object.kind].props[f.key] ?? 0)} field={f} onCommit={(v) => update({ props: { ...object.props, [f.key]: v } })} />)}
      </>}
      <div className="obj-section">线条颜色</div><div className="obj-colors">{PEN_COLORS.map((c) => <button key={c.id} aria-label={'改为' + c.name + '色'} title={c.name} style={{ background: c.dark }} className={strokes.every((s) => s.color === c.id) ? 'on' : ''} onClick={() => edit(ikey, { upsert: strokes.map((s) => ({ ...s, color: c.id })) }, actor)} />)}</div>
      {!object && <Numeric value={single?.size ?? 3} field={{ key: 'size', label: '粗细', min: .4, max: 80, step: .1 }} onCommit={(v) => edit(ikey, { upsert: strokes.map((s) => ({ ...s, size: v })) }, actor)} />}
    </div>
    <div className="obj-actions"><button onClick={() => { const copies = strokes.map((s) => ({ ...duplicateStroke(s), author: actor })); edit(ikey, { upsert: copies }, actor); onSelection?.(copies.map((s) => s.id)); }}><Copy size={14} />复制</button>{object && <button onClick={() => update({ rot: 0 })}><RotateCcw size={14} />转正</button>}{actor === 'teacher' && (single?.tex || hasInk(strokes)) && <button className="obj-fx" onClick={() => { useFormula.getState().open({ ikey, ids: strokes.map((s) => s.id), actor }); onClose(); }}><Sigma size={14} />{single?.tex ? '修改公式' : '识别公式'}</button>}<button className="danger" onClick={() => { edit(ikey, { remove: strokes.map((s) => s.id) }, actor); onSelection?.([]); onClose(); }}><Trash2 size={14} />删除</button></div>
    {object && <footer>参数保存为器材数据。静态板书不运行物理仿真。</footer>}
  </section>;
}
