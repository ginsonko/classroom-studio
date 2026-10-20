// 导播台里的插件入口：顶栏「插件」按钮（面板、学生画面页面）+ 浮动的插件面板
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Eye, MonitorUp, Puzzle, Settings2, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { openMaterial } from '../doc/actions';
import type { FileEntry } from '../lib/library';
import { activePlugins, closePanel, loadPlugins, openPanel, pluginUrl, usePlugins, type PluginItem } from './pluginStore';
import { PluginFrame } from './PluginFrame';
import '../styles/plugins.css';

export function PluginIcon({ p, size = 18 }: { p: Pick<PluginItem, 'id' | 'icon' | 'name'>; size?: number }) {
  const [bad, setBad] = useState(false);
  if (!p.icon || bad) return <span className="pl-ico fallback" style={{ width: size, height: size, fontSize: size * 0.55 }}>{p.name.slice(0, 1)}</span>;
  return <img className="pl-ico" src={pluginUrl(p.id, p.icon)} width={size} height={size} alt="" onError={() => setBad(true)} draggable={false} />;
}

export function lessonEntry(p: PluginItem, entry: string, title: string): FileEntry {
  const url = pluginUrl(p.id, entry);
  return { id: url, path: url, name: title, title, kind: 'html', size: 0, folder: 'loose:', ext: '.html' };
}

/** 顶栏按钮：列出启用中插件的面板和学生画面页面 */
export function PluginButton() {
  const list = usePlugins((s) => s.list);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { void loadPlugins(); }, []);
  const items = activePlugins(list);
  const panels = items.flatMap((p) => p.contributes.panels.filter((x) => x.where.includes('console')).map((x) => ({ p, x })));
  const lessons = items.flatMap((p) => p.contributes.lessons.map((x) => ({ p, x })));
  const set = useStore((s) => s.set);
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} className={'tb-ico' + (open ? ' on' : '')} onClick={() => setOpen(!open)} data-tip="插件：计时器、随机点名等小工具"><Puzzle size={16} /></button>
      {open && createPortal(
        <>
          <div className="pop-bg" onPointerDown={() => setOpen(false)} />
          <div className="pop pl-menu" style={{ top: (r?.bottom ?? 40) + 6, right: Math.max(8, innerWidth - (r?.right ?? innerWidth - 8)) }}>
            {list?.safeMode && <p className="pl-warn">上次软件没有正常运行，这次没有加载插件。可以在插件页恢复。</p>}
            {list?.paused && <p className="pl-warn">插件已全部暂停。</p>}
            {!!panels.length && <header>插件面板</header>}
            {panels.map(({ p, x }) => (
              <button key={p.id + x.id} className="pl-row" onClick={() => { openPanel(p.id, x.id); setOpen(false); }}>
                <PluginIcon p={p} /><b>{x.title}</b><i>{p.name !== x.title ? p.name : ''}</i>
              </button>
            ))}
            {!!lessons.length && <header>学生画面页面</header>}
            {lessons.map(({ p, x }) => (
              <div key={p.id + x.id} className="pl-row">
                <PluginIcon p={p} /><b>{x.title}</b>
                <span className="pl-acts">
                  <button onClick={() => { void openMaterial(lessonEntry(p, x.entry, x.title), 'teacher'); setOpen(false); }} data-tip="只在老师这边打开看看"><Eye size={13} /></button>
                  <button onClick={() => { void openMaterial(lessonEntry(p, x.entry, x.title), 'student'); setOpen(false); }} data-tip="直接放到学生画面"><MonitorUp size={13} /></button>
                </span>
              </div>
            ))}
            {!panels.length && !lessons.length && <p className="pl-empty">{items.length ? '启用中的插件没有可以在这里打开的面板。' : '还没有插件。插件页里有现成的示例，一键就能装。'}</p>}
            <footer><button onClick={() => { set({ page: 'plugins' }); setOpen(false); }}><Settings2 size={13} />管理插件</button></footer>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/** 浮在导播台上的插件面板（切换左侧页面时也保留） */
export function PluginSheets() {
  const open = usePlugins((s) => s.open);
  const list = usePlugins((s) => s.list);
  return <>{open.map((o, i) => {
    const p = list?.items.find((x) => x.id === o.id && x.active), panel = p?.contributes.panels.find((x) => x.id === o.panel);
    return p && panel ? <Sheet key={o.key} p={p} panelId={panel.id} title={panel.title} entry={panel.entry} w0={panel.width} h0={panel.height} n={i} /> : null;
  })}</>;
}

function Sheet({ p, panelId, title, entry, w0, h0, n }: { p: PluginItem; panelId: string; title: string; entry: string; w0: number; h0: number; n: number }) {
  const [size, setSize] = useState({ w: w0, h: h0 });
  const [pos, setPos] = useState(() => ({ x: Math.max(8, innerWidth - w0 - 24 - n * 28), y: 70 + n * 28 }));
  const [note, setNote] = useState('');
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 3500); return () => clearTimeout(t); }, [note]);
  const down = (e: RPointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; setMoving(true);
  };
  const move = (e: RPointerEvent) => { if (drag.current) setPos({ x: Math.max(-size.w + 80, Math.min(innerWidth - 80, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.current.dy)) }); };
  const up = () => { drag.current = null; setMoving(false); };
  const close = () => closePanel(p.id, panelId);
  return (
    <div className={'pl-sheet' + (moving ? ' moving' : '')} style={{ left: pos.x, top: pos.y, width: size.w }} role="dialog" aria-label={title}>
      <header onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <PluginIcon p={p} size={16} /><b>{title}</b><span className="flex" />
        <button onClick={close} aria-label="关闭插件面板"><X size={14} /></button>
      </header>
      <div className="pl-sheet-body" style={{ height: size.h }}>
        <PluginFrame id={p.id} entry={entry} where="console" title={title} onClose={close}
          onResize={(w, h) => setSize({ w: w ? Math.max(240, Math.min(900, w)) : size.w, h: h ? Math.max(160, Math.min(innerHeight - 120, h)) : size.h })}
          onToast={setNote} />
        {moving && <div className="pl-cover" />}
      </div>
      {note && <div className="pl-note">{note}</div>}
    </div>
  );
}
