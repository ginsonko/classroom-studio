// 教师浮层里的插件：按钮 + 贴在浮层旁边的弹层（先选插件，再显示它的面板）。
// 弹层带 data-ink-pop：打开时浮层整窗可点，插件里的输入框也能拿到键盘。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Puzzle, X } from 'lucide-react';
import { activePlugins, loadPlugins, usePlugins, type PanelDef, type PluginItem } from './pluginStore';
import { PluginFrame } from './PluginFrame';
import { PluginIcon } from './PluginUi';
import '../styles/plugins.css';

const MAX_W = 360;

export function DockPlugins() {
  const list = usePlugins((s) => s.list);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState<{ p: PluginItem; panel: PanelDef } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { void loadPlugins(); }, []);
  const panels = activePlugins(list).flatMap((p) => p.contributes.panels.filter((x) => x.where.includes('dock')).map((panel) => ({ p, panel })));
  useEffect(() => { if (cur && !panels.some((x) => x.p.id === cur.p.id && x.panel.id === cur.panel.id)) setCur(null); }, [panels, cur]);
  if (!panels.length) return null;
  return <>
    <button ref={btn} className={'tp-b' + (open ? ' on' : '')} onClick={() => setOpen(!open)} data-tip="插件：计时器、随机点名等"><Puzzle size={17} /></button>
    {open && <Pop anchor={btn.current} w={cur ? Math.min(MAX_W, cur.panel.width) : 260} onClose={() => setOpen(false)}>
      <header>
        {cur && <button onClick={() => setCur(null)} aria-label="返回插件列表"><ChevronLeft size={15} /></button>}
        <b>{cur ? cur.panel.title : '插件'}</b>
        <button onClick={() => setOpen(false)} aria-label="关闭"><X size={14} /></button>
      </header>
      {cur
        ? <div style={{ height: Math.min(cur.panel.height, innerHeight - 80) }}><PluginFrame key={cur.p.id + cur.panel.id} id={cur.p.id} entry={cur.panel.entry} where="dock" title={cur.panel.title} onClose={() => setOpen(false)} /></div>
        : <div className="pl-list-dock">{panels.map(({ p, panel }) => <button key={p.id + panel.id} onClick={() => setCur({ p, panel })}><PluginIcon p={p} />{panel.title}</button>)}</div>}
    </Pop>}
  </>;
}

function Pop({ anchor, w, onClose, children }: { anchor: HTMLElement | null; w: number; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const rail = anchor?.closest('.tdock') as HTMLElement | null;
    if (!anchor || !rail) return;
    const r = rail.getBoundingClientRect(), a = anchor.getBoundingClientRect(), h = box.current?.offsetHeight ?? 300;
    const left = r.right + 10 + w <= innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - w);
    setPos({ left, top: Math.max(8, Math.min(a.top - 40, innerHeight - h - 8)) });
  }, [anchor, w, children]);
  useEffect(() => {
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  return createPortal(<div ref={box} data-ink-pop className="tdock-plugins" style={{ width: w, left: pos?.left ?? -9999, top: pos?.top ?? 8 }}>{children}</div>, document.body);
}
