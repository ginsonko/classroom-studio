import { useMemo, useState } from 'react';
import {
  ChevronRight, Clock, Eye, FileArchive, FileAudio, FileImage, FileText, FileVideo, Folder, Globe, Pin, PinOff, Play,
  Presentation, Search, Star, X, Zap, FolderPlus, FilePlus2, RefreshCw,
} from 'lucide-react';
import { bytes, fileEntry, highlight, KIND_LABEL, prepareMaterial, search, type FileEntry, type FolderNode } from '../lib/library';
import { useCatalog } from '../lib/catalog';
import { useStore } from '../lib/store';
import type { Kind } from '../lib/types';
import { addFiles, addRoot, addWeb, readDroppedFiles, refreshLibrary, removeLoose, removeRoot, useLib } from '../lib/useLib';
import { host } from '../lib/host';
import { reportMaterialError } from '../doc/actions';
import { CatalogPanel } from './CatalogPanel';
import '../styles/doc.css';

const KIND_ICON: Record<Kind, typeof FileText> = {
  board: FileText, pdf: FileText, word: FileText, slides: Presentation, image: FileImage, video: FileVideo,
  audio: FileAudio, html: Globe, flash: Zap, archive: FileArchive, sim: Zap,
};

type Tab = 'browse' | 'shelf' | 'recent' | 'fav' | 'student';

export function Library({ onTeacher, onStudent, onCue }: { onTeacher: (f: FileEntry) => void; onStudent: (f: FileEntry) => void; onCue: (f: FileEntry) => void }) {
  const lib = useLib((s) => s.lib);
  const error = useLib((s) => s.error);
  const loading = useLib((s) => s.loading);
  const warnings = useLib((s) => s.warnings);
  const roots = useStore((s) => s.roots);
  const pinned = useStore((s) => s.pinned);
  const recents = useStore((s) => s.recents);
  const favorites = useStore((s) => s.favorites);
  const studentId = useStore((s) => s.studentId);
  const students = useStore((s) => s.students);
  const set = useStore((s) => s.set);
  const [folder, setFolder] = useState(() => localStorage.getItem('cs.library.folder') || '');
  const [q, setQ] = useState('');
  const [scoped, setScoped] = useState(false);
  const [tab, setTab] = useState<Tab>('browse');
  const [sel, setSel] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const [webOpen, setWebOpen] = useState(false), [webUrl, setWebUrl] = useState('');

  const student = students.find((s) => s.id === studentId);
  const node = lib?.folders.get(folder) ?? lib?.root;
  const results = useMemo(() => (lib && q.trim() ? search(lib, q, scoped ? folder : '') : null), [lib, q, scoped, folder]);

  if (!lib || !node) return <div className="lib-empty">{error || <><span className="spin" />正在读取资料目录…</>}<button className="lib-more" onClick={() => void refreshLibrary(true)}>重新读取</button></div>;

  const crumbs = [...lib.folders.values()].filter((n) => n.id && (folder === n.id || folder.startsWith(n.id + '/'))).sort((a, b) => a.id.length - b.id.length);
  const isPinned = pinned.includes(folder);
  const togglePin = (id: string) => set({ pinned: pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id] });
  const toggleFav = (id: string) => set({ favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id] });
  const go = (id: string) => { setFolder(id); localStorage.setItem('cs.library.folder', id); setTab('browse'); setQ(''); setLimit(200); };

  const row = (f: FileEntry, showPath = false, loose = false) => {
    const I = KIND_ICON[f.kind];
    const pair = f.pairId ? lib.files.get(f.pairId) : null;
    return (
      <div
        key={f.id}
        className={'lib-f' + (sel === f.id ? ' sel' : '')}
        onClick={() => { setSel(f.id); onTeacher(f); }}
        onDoubleClick={() => onCue(f)}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData('text/x-cs-file', f.id); e.dataTransfer.effectAllowed = 'copy'; }}
        title={f.id}
      >
        <span className={'lib-ico k-' + f.kind}><I size={15} strokeWidth={1.8} /></span>
        <span className="lib-name">
          <span className="lib-t">{q ? highlight(f.title, q).map(([s, h], i) => (h ? <mark key={i}>{s}</mark> : s)) : f.title}</span>
          <span className="lib-m">
            {KIND_LABEL[f.kind]} · {bytes(f.size)}
            {pair && <em className={'pair ' + f.pairRole}>{f.pairRole === 'question' ? '有解析' : '解析版'}</em>}
            {showPath && <span className="lib-path"> · {f.folder.split('/').slice(-2).join(' / ')}</span>}
          </span>
        </span>
        <span className="lib-acts">
          <button className={'fav' + (favorites.includes(f.id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggleFav(f.id); }} data-tip="收藏"><Star size={13} /></button>
          <button className="to-t" onClick={(e) => { e.stopPropagation(); onTeacher(f); }} data-tip="给老师看 · 学生看不到"><Eye size={14} /></button>
          <button className="to-s" onClick={(e) => { e.stopPropagation(); onStudent(f); }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onCue(f); }} data-tip="直接给学生 · 右键放到预监"><Play size={13} fill="currentColor" /></button>
          {loose && <button className="rm" onClick={(e) => { e.stopPropagation(); removeLoose([f.id]); }} data-tip="从临时列表移除 · 不删除文件" aria-label={'从临时列表移除 ' + f.title}><X size={13} /></button>}
        </span>
      </div>
    );
  };

  const folderRow = (n: FolderNode) => (
    <div key={n.id} className="lib-d" onClick={() => go(n.id)} title={n.id}>
      <Folder size={15} strokeWidth={1.8} />
      <span className="lib-t">{n.name}</span>
      <span className="lib-c num">{n.count}</span>
      <button className={'pin' + (pinned.includes(n.id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); togglePin(n.id); }} data-tip={pinned.includes(n.id) ? '取消固定' : '固定到快速访问'}>
        <Pin size={12} />
      </button>
      <ChevronRight size={14} className="chev" />
    </div>
  );

  const listFiles = (ids: string[]) => ids.map((id) => lib.files.get(id)).filter(Boolean).map((f) => row(f!, true));

  return (
    <div className="lib" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); void readDroppedFiles(Array.from(e.dataTransfer.files)).catch((e) => reportMaterialError(e, '拖入课件')); }}>
      <div className="lib-tools">
        <button onClick={() => void addRoot().catch((e) => reportMaterialError(e, '添加目录'))} disabled={!host.electron} title="添加任意资料目录，原文件保持只读"><FolderPlus size={13} />目录</button>
        <button onClick={() => void addFiles().then((fs) => { if (fs[0]) onTeacher(fs[0]); }).catch((e) => reportMaterialError(e, '打开文件'))} disabled={!host.electron}><FilePlus2 size={13} />文件</button>
        <button onClick={() => setWebOpen(!webOpen)} title="添加以前部署在服务器上的 HTML 课程"><Globe size={13} />网址</button>
        <button className="lib-refresh" onClick={() => void refreshLibrary(true)} disabled={loading} aria-label="刷新资料目录"><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
      </div>
      {webOpen && <form className="lib-web-form" onSubmit={(e) => { e.preventDefault(); try { const f = addWeb(webUrl); onTeacher(f); setWebOpen(false); setWebUrl(''); } catch (err) { reportMaterialError(err, '课程网址'); } }}><input autoFocus type="url" required placeholder="https://你的课程网址" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} /><button type="submit">打开</button></form>}
      {!host.electron && <div className="lib-mode">浏览器设计演示 · 资料索引与示例页来自样稿。桌面版读取真实文件。</div>}
      {host.electron && <div className="lib-roots">{roots.map((root) => <div className="lib-root" key={root}><Folder size={11} /><button onClick={() => go(root)} title={root}>{root}</button><button aria-label={'移除资料根目录 ' + root} title="只移除快捷入口，不删除文件" onClick={() => { go(''); void removeRoot(root); }}><X size={12} /></button></div>)}</div>}
      {(error || warnings.length > 0) && <div className="lib-warning" role="status">{error}{warnings.map((w) => <div key={w}>{w}</div>)}</div>}
      <div className="lib-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索课件 · 支持拼音首字母 zjxy" spellCheck={false} />
        {q && <button onClick={() => setQ('')} aria-label="清除"><X size={13} /></button>}
        <button className={'scope' + (scoped ? ' on' : '')} onClick={() => setScoped(!scoped)} data-tip="只在当前文件夹里搜">此处</button>
      </div>

      <div className="lib-pins">
        {pinned.map((id) => {
          const n = lib.folders.get(id);
          if (!n) return null;
          return (
            <button key={id} className={'lib-pin' + (folder === id && tab === 'browse' && !q ? ' on' : '')} onClick={() => go(id)} title={id}>
              <Pin size={11} />
              <span>{n.name}</span>
              <i className="num">{n.count}</i>
            </button>
          );
        })}
      </div>

      <div className="lib-tabs">
        {([['browse', '目录'], ['shelf', '分类'], ['recent', '最近'], ['fav', '收藏'], ['student', student?.name ?? '学生']] as [Tab, string][]).map(([k, n]) => (
          <button key={k} className={(tab === k && !q ? 'on' : '') + (k === 'student' ? ' stu' : '')} onClick={() => { setTab(k); setQ(''); }} title={k === 'student' ? n + ' 的资料' : undefined}>
            {k === 'recent' && <Clock size={12} />}
            {k === 'fav' && <Star size={12} />}
            {k === 'student' && <i className="dot" style={{ background: `hsl(${student?.hue ?? 0} 70% 60%)` }} />}
            <span>{n}</span>
          </button>
        ))}
      </div>

      {results ? (
        <div className="lib-list">
          <div className="lib-head">{results.length >= 300 ? '300+' : results.length} 个结果{scoped ? ' · 当前文件夹内' : ''}</div>
          {results.map((f) => row(f, true))}
          {!results.length && <div className="lib-empty">没有找到「{q}」。试试拼音首字母，或者关掉「此处」在全部资料里搜。</div>}
        </div>
      ) : tab === 'browse' ? (
        <>
          <div className="lib-crumbs">
            <button onClick={() => go('')}>{lib.root.name}</button>
            {crumbs.map((c, i) => (
              <span key={i}>
                <ChevronRight size={12} />
                <button onClick={() => go(c.id)} className={i === crumbs.length - 1 ? 'cur' : ''}>{c.name}</button>
              </span>
            ))}
            {folder === 'loose:' && node.files.length > 0 && (
              <button className="lib-clear" onClick={() => { if (confirm(`从临时列表移除全部 ${node.files.length} 个课件？\n只是不再列出，电脑上的文件不会删除。`)) removeLoose(); }} title="只是不再列出，电脑上的文件不会删除">清空</button>
            )}
            {folder && folder !== 'loose:' && (
              <button className={'lib-pinhere' + (isPinned ? ' on' : '')} onClick={() => togglePin(folder)} data-tip={isPinned ? '取消固定' : '固定当前文件夹'}>
                {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
            )}
          </div>
          <div className="lib-list">
            {node.folders.map(folderRow)}
            {folder === 'loose:' && node.files.length > 0 && <div className="lib-head">拖进来或单独打开的课件。点 × 只是从这里移除，不删除电脑上的文件</div>}
            {node.files.slice(0, limit).map((f) => row(f, false, folder === 'loose:'))}
            {node.files.length > limit && <button className="lib-more" onClick={() => setLimit(limit + 400)}>再显示 {Math.min(400, node.files.length - limit)} 个 · 共 {node.files.length}</button>}
            {!node.folders.length && !node.files.length && <div className="lib-empty">这个文件夹是空的</div>}
          </div>
        </>
      ) : tab === 'shelf' ? (
        <CatalogPanel compact onOpen={onTeacher} />
      ) : tab === 'recent' ? (
        <div className="lib-list">{recents.length ? listFiles(recents) : <div className="lib-empty">打开或展示过的课件会出现在这里</div>}</div>
      ) : tab === 'fav' ? (
        <div className="lib-list">{favorites.length ? listFiles(favorites) : <div className="lib-empty">点课件右侧的星标收藏</div>}</div>
      ) : (
        <div className="lib-list">
          {student?.folder && lib.folders.get(student.folder) ? (
            <>
              <div className="lib-head">{student.name}的专属资料 · {student.folder}</div>
              {lib.folders.get(student.folder)!.folders.map(folderRow)}
              {lib.folders.get(student.folder)!.files.map((f) => row(f))}
            </>
          ) : (
            <div className="lib-empty">还没有给{student?.name}关联资料文件夹。先在「目录」中打开相应课件。</div>
          )}
          <StudentFiles studentId={studentId} onOpen={onTeacher} />
        </div>
      )}
      <div className="lib-foot">
        <span><b className="num">{lib.list.length.toLocaleString()}</b> 份课件 · 原文件只读</span>
        <span className="lib-hint">拖动文件到右侧可预监 / 上屏</span>
      </div>
    </div>
  );
}

/** 资料整理里归到这个学生的文件（错题、试卷、作业），按文件时间倒序 */
function StudentFiles({ studentId, onOpen }: { studentId: string; onOpen: (f: FileEntry) => void }) {
  const items = useCatalog((s) => s.items), lib = useLib((s) => s.lib);
  const name = useStore((s) => s.students.find((x) => x.id === studentId)?.name);
  const mine = Object.values(items).filter((e) => e.studentId === studentId || (!e.studentId && !!e.owner && e.owner === name)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 200);
  if (!mine.length) return null;
  return <>
    <div className="lib-head">学生档案（按文件时间） · {mine.length}</div>
    {mine.map((e) => <div key={e.path} className="lib-f" onClick={() => onOpen(lib?.files.get(e.path) ?? fileEntry(e.path))} title={e.path}><span className="lib-name"><span className="lib-t">{e.title}</span><span className="lib-m">{e.date ?? '时间未知'}{e.topic && e.topic !== e.title ? ' · ' + e.topic : ''}</span></span></div>)}
  </>;
}

export function fileToMaterial(f: FileEntry) {
  return prepareMaterial(f);
}
