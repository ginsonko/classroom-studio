// AI 助手历史：按时间倒序列出存档，可以搜索、按功能筛选、放回面板继续用（上屏、存题、做动画都照常）。
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FolderOpen, History, Loader2, Search, Trash2, Undo2 } from 'lucide-react';
import type { Action, AiOut, RunMeta } from '../lib/ai';
import { archive, mediaUrl, revive, type ArchiveItem } from '../lib/archive';
import { useStore } from '../lib/store';
import { packOf } from '../lib/subjects';

const KIND: { id: Action | ''; label: string }[] = [
  { id: '', label: '全部' }, { id: 'explain', label: '讲题' }, { id: 'ask', label: '问答' }, { id: 'demo', label: '演示' }, { id: 'draw', label: '板书' }, { id: 'motion', label: '课堂动画' }, { id: 'anim', label: '讲解动画' },
];
const LABEL: Record<Action, string> = { demo: '演示', explain: '讲题', draw: '板书', ask: '问答', anim: '讲解动画', motion: '课堂动画' };
const day = (t: number) => {
  const d = new Date(t), now = new Date(), diff = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  return diff === 0 ? '今天' : diff === 1 ? '昨天' : d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
};
const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export function AiHistory({ onBack, onRestore }: { onBack: () => void; onRestore: (c: { action: Action; ask: string; at: number; out?: AiOut; meta?: RunMeta; subject?: string }) => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Action | ''>('');
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [opening, setOpening] = useState('');
  const studentId = useStore((s) => s.studentId);
  const seq = useRef(0);

  const load = async (append = false) => {
    const n = ++seq.current;
    setBusy(true); setErr('');
    try {
      const before = append && items.length ? items[items.length - 1].at : undefined;
      const r = await archive.list({ q, action: kind, studentId: mine ? studentId : '', before, limit: 60 });
      if (n !== seq.current) return;
      setItems(append ? [...items, ...r.items] : r.items); setTotal(r.total); setMore(r.items.length === 60);
    } catch (e) { if (n === seq.current) setErr((e as Error).message); } finally { if (n === seq.current) setBusy(false); }
  };
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [q, kind, mine, studentId]);

  const open = async (it: ArchiveItem) => {
    setOpening(it.id);
    try { const e = await archive.get(it.id); onRestore({ action: e.action, ask: e.ask, at: e.at, subject: e.subject || undefined, ...revive(e) }); }
    catch (e) { setErr((e as Error).message); } finally { setOpening(''); }
  };
  const remove = async (it: ArchiveItem) => {
    if (!confirm('删除这条存档？连同它的截图、视频一起删除。')) return;
    try { await archive.remove(it.id); setItems((l) => l.filter((x) => x.id !== it.id)); setTotal((t) => t - 1); } catch (e) { setErr((e as Error).message); }
  };

  let lastDay = '';
  return (
    <div className="ai-hist">
      <div className="ai-hist-h">
        <button className="ai-ico" onClick={onBack} aria-label="返回" data-tip="回到 AI 助手"><ArrowLeft size={15} /></button>
        <b><History size={14} />历史记录</b>
        <span className="ai-hist-n">{total ? `共 ${total} 条` : ''}</span>
        <span className="flex" />
        <button className="ai-ico" onClick={() => void archive.folder().catch((e) => setErr(e.message))} aria-label="打开存档文件夹" data-tip="打开存档文件夹（截图、视频都在里面）"><FolderOpen size={15} /></button>
      </div>
      <label className="ai-hist-q"><Search size={13} /><input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="搜题目、讲解内容、学生名" /></label>
      <div className="ai-hist-f">
        {KIND.map((k) => <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>{k.label}</button>)}
        <span className="flex" />
        <label className="ai-hist-mine"><input type="checkbox" checked={mine} disabled={!studentId} onChange={(e) => setMine(e.target.checked)} />只看当前学生</label>
      </div>
      {err && <p className="ai-hist-err" role="alert">{err}</p>}
      <div className="ai-hist-list">
        {items.map((it) => {
          const d = day(it.at), head = d !== lastDay ? <h5 key={'d' + it.id}>{d}</h5> : null;
          lastDay = d;
          return [head, (
            <div key={it.id} className={'ai-hist-i k-' + it.action + (it.error ? ' err' : '')}>
              <button className="ai-hist-main" onClick={() => void open(it)} disabled={!!opening} data-tip="放回 AI 面板，可以继续上屏、存题">
                {it.thumb ? <img src={mediaUrl(it.thumb)} alt="" loading="lazy" /> : <span className="ai-hist-ph">{LABEL[it.action].slice(0, 1)}</span>}
                <span className="ai-hist-t">
                  <b>{it.title || it.ask || '（看学生画面）'}</b>
                  <i>{hm(it.at)} · {LABEL[it.action]}{it.subject ? ' · ' + packOf(it.subject).stage : ''}{it.studentName ? ' · ' + it.studentName : ''}{it.model ? ' · ' + it.model : ''}</i>
                  {it.title && it.ask && <em>{it.ask}</em>}
                </span>
                {opening === it.id ? <Loader2 size={14} className="spin" /> : <Undo2 size={14} className="ai-hist-go" />}
              </button>
              <button className="ai-hist-del" onClick={() => void remove(it)} aria-label="删除" data-tip="删除这条存档"><Trash2 size={13} /></button>
            </div>
          )];
        })}
        {busy && <div className="ai-hist-busy"><Loader2 size={15} className="spin" /></div>}
        {!busy && !items.length && <p className="ai-hist-empty">{q || kind || mine ? '没有找到符合条件的记录。' : '还没有存档。AI 助手每次讲题、演示、板书、回答、做动画，都会自动存到这里。'}</p>}
        {!busy && more && <button className="ai-hist-more" onClick={() => void load(true)}>加载更早的记录</button>}
      </div>
    </div>
  );
}
