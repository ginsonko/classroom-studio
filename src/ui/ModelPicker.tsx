// 模型选择器：自动读取当前 Key 能用的模型，按对话 / 绘图 / 视频 / 音频分类，可搜索、收藏，列表里没有也能直接输入。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, RefreshCw, Search, Star, X } from 'lucide-react';
import { host } from '../lib/host';
import { CAT_LABELS, groupByVendor, loadFavorites, modelCat, saveFavorites, type ModelCat } from '../lib/models';
import '../styles/models.css';

export interface ModelList { ok: boolean; models: string[]; count?: number; cachedAt?: number; message?: string }
type Tab = 'all' | ModelCat;
const TABS: Tab[] = ['all', 'chat', 'image', 'video', 'audio', 'other'];
const POP_W = 380, POP_H = 440;

let shared: Promise<ModelList> | null = null;
/** 所有选择器共用一份列表；refresh 时重新向中转站读取（GET /models 不扣费） */
export function loadModels(refresh = false): Promise<ModelList> {
  if (!host.electron) return Promise.resolve({ ok: false, models: [], message: '浏览器预览版读不到模型列表，可以直接输入模型名' });
  if (!shared || refresh) shared = host.call<ModelList>('ai.modelList', { refresh }).catch((e) => ({ ok: false, models: [], message: (e as Error).message }));
  return shared;
}

function useFavorites() {
  const [favs, setFavs] = useState(loadFavorites);
  useEffect(() => { const on = () => setFavs(loadFavorites()); addEventListener('cs-favorites', on); return () => removeEventListener('cs-favorites', on); }, []);
  const toggle = (id: string) => saveFavorites(favs.includes(id) ? favs.filter((x) => x !== id) : [id, ...favs]);
  return { favs, toggle };
}

export function ModelPicker({ value, onChange, placeholder, prefer = 'chat', className = '', title, disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; prefer?: ModelCat; className?: string; title?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const place = () => {
    const r = anchor.current?.getBoundingClientRect(); if (!r) return;
    const left = Math.max(8, Math.min(r.left, innerWidth - POP_W - 8)), below = innerHeight - r.bottom - 12, above = r.top - 12;
    if (below >= Math.min(POP_H, 300) || below >= above) setPos({ left, top: r.bottom + 6, maxH: Math.min(POP_H, below) });
    else setPos({ left, bottom: innerHeight - r.top + 6, maxH: Math.min(POP_H, above) });
  };
  useLayoutEffect(() => { if (!open) return; place(); addEventListener('resize', place); return () => removeEventListener('resize', place); }, [open]);
  return (
    <>
      <button ref={anchor} type="button" disabled={disabled} className={`mp-trigger${value ? '' : ' empty'}${open ? ' open' : ''} ${className}`} onClick={() => setOpen(!open)} data-tip={title || '选择模型'}>
        <span>{value || placeholder || '默认模型'}</span><ChevronDown size={13} />
      </button>
      {open && pos && createPortal(
        <>
          <div className="mp-back" onPointerDown={() => setOpen(false)} />
          <ModelMenu style={{ left: pos.left, top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', maxHeight: pos.maxH, width: POP_W }} value={value} placeholder={placeholder} prefer={prefer}
            onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />
        </>, document.body)}
    </>
  );
}

function ModelMenu({ style, value, placeholder, prefer, onPick, onClose }: { style: React.CSSProperties; value: string; placeholder?: string; prefer: ModelCat; onPick: (v: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>(prefer);
  const [list, setList] = useState<ModelList | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const { favs, toggle } = useFavorites();
  const listRef = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const load = async (refresh = false) => { setLoading(true); try { setList(await loadModels(refresh)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);

  const all = useMemo(() => list?.models || [], [list]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (id: string) => terms.every((t) => id.toLowerCase().includes(t));
  const searched = all.filter(matches);
  const counts = useMemo(() => { const c: Record<string, number> = { all: searched.length }; for (const id of searched) c[modelCat(id)] = (c[modelCat(id)] || 0) + 1; return c; }, [searched]);
  // 搜索时首选分类里没有结果，就看全部
  const effTab: Tab = (terms.length || !list?.ok) && tab !== 'all' && !counts[tab] ? 'all' : tab;
  const inTab = (id: string) => effTab === 'all' || modelCat(id) === effTab;
  const known = new Set(all);
  const favRows = favs.filter((id) => (!list?.ok || known.has(id)) && matches(id) && inTab(id));
  const favSet = new Set(favRows);
  const groups = groupByVendor(searched.filter((id) => inTab(id) && !favSet.has(id)));
  const typed = query.trim(), custom = typed && !known.has(typed) ? typed : '';
  const sections: { title: string; ids: string[]; custom?: boolean }[] = [];
  if (favRows.length) sections.push({ title: '收藏', ids: favRows });
  for (const g of groups) sections.push({ title: g.vendor, ids: g.ids });
  if (custom) sections[sections.length ? 'push' : 'unshift']({ title: '列表里没有？直接使用', ids: [custom], custom: true });
  const flat = sections.flatMap((s) => s.ids);
  useEffect(() => setCursor(0), [query, effTab]);
  useEffect(() => { listRef.current?.querySelector('.mp-row.cur')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (flat[cursor]) onPick(flat[cursor]); }
  };
  let i = -1;
  return (
    <div className="mp-menu" style={style} onKeyDown={onKey} role="dialog" aria-label="选择模型">
      <div className="mp-search"><Search size={14} />
        <input ref={searchRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索模型，或直接输入模型名" spellCheck={false} />
        {query && <button onClick={() => setQuery('')} aria-label="清空搜索"><X size={12} /></button>}
      </div>
      <div className="mp-tabs">
        {TABS.map((t) => <button key={t} className={effTab === t ? 'on' : ''} disabled={t !== 'all' && !counts[t]} onClick={() => { setTab(t); searchRef.current?.focus(); }}>
          {t === 'all' ? '全部' : CAT_LABELS[t]}{counts[t] ? <span>{counts[t]}</span> : null}</button>)}
      </div>
      <div className="mp-list" ref={listRef}>
        {loading && !list && <div className="mp-note"><Loader2 size={14} className="spin" /> 正在读取这个 Key 能用的模型…</div>}
        {list && !list.ok && <div className="mp-note warn">{list.message || '读不到模型列表'}，可以直接输入模型名</div>}
        {list?.ok && !flat.length && <div className="mp-note">没有找到匹配的模型，可以换个关键词。</div>}
        {sections.map((s) => (
          <div key={s.title} className="mp-sec">
            <div className="mp-group">{s.title}</div>
            {s.ids.map((id) => {
              i += 1; const idx = i, fav = favs.includes(id);
              return (
                <div key={s.title + ':' + id} className={`mp-row${idx === cursor ? ' cur' : ''}${id === value ? ' on' : ''}`} onMouseEnter={() => setCursor(idx)} onClick={() => onPick(id)}>
                  <span className="mp-name">{s.custom ? `使用「${id}」` : id}</span>
                  {!s.custom && effTab === 'all' && <span className="mp-cat">{CAT_LABELS[modelCat(id)]}</span>}
                  {id === value && <Check size={13} className="mp-check" />}
                  {!s.custom && <button className={'mp-star' + (fav ? ' on' : '')} aria-label={fav ? '取消收藏' : '收藏'} data-tip={fav ? '取消收藏' : '收藏，以后排在最前面'} onClick={(e) => { e.stopPropagation(); toggle(id); }}><Star size={13} /></button>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mp-foot">
        <span>{list?.ok ? `共 ${list.count ?? all.length} 个模型` : ''}</span>
        <span className="flex" />
        {value && <button onClick={() => onPick('')} data-tip={placeholder ? `改回 ${placeholder}` : '改回默认'}>用默认</button>}
        <button onClick={() => void load(true)} disabled={loading}><RefreshCw size={12} className={loading ? 'spin' : ''} />刷新</button>
      </div>
    </div>
  );
}
