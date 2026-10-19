import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { createObject, OBJECT_GROUPS, OBJECTS, type ObjGroup } from '../catalog';
import { drawObj } from '../drawObj';
import type { ObjKind } from '../model';
import { useStore } from '../../lib/store';
import '../../styles/objects.css';

export function ObjectPreview({ kind }: { kind: ObjKind }) {
  const ref = useRef<HTMLCanvasElement>(null), skin = useStore((s) => s.skin);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d'); if (!ctx) return;
    const o = createObject(kind, 0, 0), width = 84, height = 48, dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = width * dpr; c.height = height * dpr;
    const scale = Math.min((width - 16) / (o.w + .025), (height - 12) / (o.h + .025));
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, width * dpr / 2, height * dpr / 2);
    const style = getComputedStyle(document.documentElement), fg = style.getPropertyValue('--fg-1').trim() || '#b7bfcc', cue = style.getPropertyValue('--cue').trim() || '#3dd9eb';
    drawObj({ ctx, scale, dark: skin !== 'paper', color: (name) => name === 'blue' ? cue : name === 'red' ? '#ff7a6e' : name === 'orange' ? '#ffbf66' : fg }, o);
  }, [kind, skin]);
  return <canvas ref={ref} width={84} height={48} aria-hidden="true" />;
}

export function ObjectLibrary({ current, onSelect, onClose }: { current: string; onSelect: (kind: ObjKind) => void; onClose: () => void }) {
  const [group, setGroup] = useState<ObjGroup>('mechanics'), [query, setQuery] = useState('');
  const list = OBJECTS.filter((o) => query.trim() ? `${o.name} ${o.kind}`.toLowerCase().includes(query.trim().toLowerCase()) : o.group === group);
  return <div className="obj-library" role="dialog" aria-label="物理器材库">
    <header><b>物理器材</b><span>{OBJECTS.length} 种矢量器材</span><button onClick={onClose} aria-label="关闭器材库"><X size={15} /></button></header>
    <label className="obj-search"><Search size={14} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索小车、磁场、电阻…" /></label>
    <div className="obj-tabs">{OBJECT_GROUPS.map((g) => <button key={g.id} className={g.id === group && !query ? 'on' : ''} onClick={() => { setGroup(g.id); setQuery(''); }}>{g.name}</button>)}</div>
    <div className="obj-grid">{list.map((o) => <button key={o.kind} className={'obj-tile' + (current === o.kind ? ' on' : '')} onClick={() => onSelect(o.kind)} title={o.name} aria-label={'放置' + o.name}><ObjectPreview kind={o.kind} /><span>{o.name}</span></button>)}{!list.length && <p className="obj-empty">没有匹配的器材，试试别的名称。</p>}</div>
    <footer>单击画布放置 · 拖动设定大小<br />选择工具可移动、缩放与旋转</footer>
  </div>;
}
