import { useEffect, useRef, useState } from 'react';
import { Puzzle, Search, X } from 'lucide-react';
import { createObject, libOfFamily, libOfKind, OBJECT_CATALOG, OBJECT_GROUPS, OBJECT_LIBS, OBJECTS, type ObjGroup, type ObjLib } from '../catalog';
import { familyOf } from '../../lib/subjects';
import { drawObj } from '../drawObj';
import type { ObjKind } from '../model';
import { useStore } from '../../lib/store';
import { activePlugins, loadPlugins, pluginUrl, usePlugins, type PluginItem, type ShapeGroup } from '../../plugins/pluginStore';
import { imageToBoard } from '../../plugins/bridge';
import '../../styles/objects.css';
import '../../styles/plugins.css';

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

const HINT: Record<ObjLib, string> = { physics: '搜索小车、磁场、电阻…', math: '搜索圆锥、双曲线、坐标系…', chem: '搜索烧杯、酒精灯、冷凝管…' };
let lastLib: { subject: string; lib: ObjLib } | null = null;

/** 插件加的图形分组：学科对得上的放进对应的库，其它学科（生物、地理…）的每个库里都能看到 */
function pluginGroups(items: PluginItem[], lib: ObjLib) {
  const libs = OBJECT_LIBS.map((x) => x.id as string);
  return items.flatMap((p) => p.contributes.shapes.map((g, i) => ({ key: `pl:${p.id}:${i}`, p, g })))
    .filter(({ g }) => g.subject === lib || !libs.includes(g.subject));
}

export function ObjectLibrary({ current, onSelect, onClose }: { current: string; onSelect: (kind: ObjKind) => void; onClose: () => void }) {
  const subject = useStore((s) => s.subject);
  const [lib, setLibState] = useState<ObjLib>(() => lastLib?.subject === subject ? lastLib.lib : libOfFamily(familyOf(subject)));
  const groups = OBJECT_GROUPS.filter((g) => g.lib === lib);
  const [group, setGroup] = useState<ObjGroup>(() => OBJECT_CATALOG[current as ObjKind] && libOfKind(current) === lib ? OBJECT_CATALOG[current as ObjKind].group : groups[0].id), [query, setQuery] = useState('');
  const [wantGroup, setPgroup] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { void loadPlugins(); }, []);
  const plist = usePlugins((s) => s.list);
  const want = usePlugins((s) => s.shapes);
  useEffect(() => {
    if (!want) return;
    const own = OBJECT_LIBS.find((x) => x.id === want.subject)?.id;
    if (own) { lastLib = { subject, lib: own }; setLibState(own); setGroup((g) => OBJECT_GROUPS.find((x) => x.id === g)?.lib === own ? g : OBJECT_GROUPS.find((x) => x.lib === own)!.id); }
    setPgroup(want.key); setQuery('');
    usePlugins.setState({ shapes: null });
  }, [want, subject]);
  const pgroups = pluginGroups(activePlugins(plist), lib);
  // 插件被停用 / 卸载（或还没加载完）时找不到这组，先显示自带的分组，免得一片空白
  const pgroup = pgroups.some((x) => x.key === wantGroup) ? wantGroup : '';
  const setLib = (id: ObjLib) => { lastLib = { subject, lib: id }; setLibState(id); setGroup(OBJECT_GROUPS.find((g) => g.lib === id)!.id); setPgroup(''); setQuery(''); };
  const q = query.trim().toLowerCase();
  const list = OBJECTS.filter((o) => q ? `${o.name} ${o.kind}`.toLowerCase().includes(q) : !pgroup && o.group === group);
  const shapes = pgroups.flatMap(({ key, p, g }) => g.items.filter(() => q || key === pgroup).filter((it) => !q || it.name.toLowerCase().includes(q)).map((it) => ({ key: key + it.file, p, g, it })));
  const place = (p: PluginItem, g: ShapeGroup, file: string) => {
    setErr('');
    void imageToBoard(pluginUrl(p.id, file), `已放到黑板（${g.group}）：可以拖动、缩放、旋转，上面也能写字`, true).then(onClose, (e) => setErr((e as Error).message));
  };
  const meta = OBJECT_LIBS.find((x) => x.id === lib)!;
  return <div className="obj-library" role="dialog" aria-label="绘图库">
    <header><b>绘图库</b><span>{OBJECTS.filter((o) => libOfKind(o.kind) === lib).length + pgroups.reduce((a, x) => a + x.g.items.length, 0)} {meta.unit}</span><button onClick={onClose} aria-label="关闭绘图库"><X size={15} /></button></header>
    <div className="obj-libs" role="tablist" aria-label="学科">{OBJECT_LIBS.map((x) => <button key={x.id} role="tab" aria-selected={x.id === lib} className={x.id === lib ? 'on' : ''} onClick={() => setLib(x.id)}>{x.title}</button>)}</div>
    <label className="obj-search"><Search size={14} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={HINT[lib]} /></label>
    <div className="obj-tabs">
      {groups.map((g) => <button key={g.id} className={g.id === group && !query && !pgroup ? 'on' : ''} onClick={() => { setGroup(g.id); setPgroup(''); setQuery(''); }}>{g.name}</button>)}
      {pgroups.map((x) => <button key={x.key} className={'obj-tab-plugin' + (x.key === pgroup && !query ? ' on' : '')} onClick={() => { setPgroup(x.key); setQuery(''); }} data-tip={`来自插件「${x.p.name}」`}><Puzzle size={11} />{x.g.group}</button>)}
    </div>
    <div className="obj-grid">
      {list.map((o) => <button key={o.kind} className={'obj-tile' + (current === o.kind ? ' on' : '')} onClick={() => onSelect(o.kind)} title={o.name} aria-label={'放置' + o.name}><ObjectPreview kind={o.kind} /><span>{o.name}</span></button>)}
      {shapes.map(({ key, p, g, it }) => <button key={key} className="obj-tile obj-tile-plugin" onClick={() => place(p, g, it.file)} title={`${it.name}（插件「${p.name}」）`} aria-label={'放置' + it.name}><img src={pluginUrl(p.id, it.file)} alt="" draggable={false} className={/\.svg$/i.test(it.file) ? 'svg' : ''} /><span>{it.name}</span></button>)}
      {!list.length && !shapes.length && <p className="obj-empty">没有匹配的器材，试试别的名称。</p>}
    </div>
    {err && <p className="obj-err">{err}</p>}
    <footer>{pgroup && !query ? <>点一下放到黑板<br />放好后用选择工具移动、缩放、旋转</> : <>单击画布放置 · 拖动设定大小<br />选择工具可移动、缩放与旋转</>}</footer>
  </div>;
}
