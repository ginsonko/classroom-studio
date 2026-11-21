// 1.8.0 全站独立原地轻预览层（QuickPreview）：
// 在任意页面（课后发家长抽屉、学生资料、学情、小羽对话）点击回放视频、家长长图、板书 PDF、作业 Word/PDF 时，
// 直接在当前画面弹出轻量预览窗核对内容，绝不强行切回「上课」导播台，也绝不覆盖老师已备好的右侧上课预监（pvw）。
// 预览确认无误后，可直接按住顶栏「拖进微信」手柄或点「复制文件」发给家长；真需拿去讲题时再点「放到上课预监」。
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, GripHorizontal,
  Loader2, Maximize2, Minimize2, MonitorPlay, BookOpen, X,
} from 'lucide-react';
import { host } from '../lib/host';
import { fileEntry, prepareMaterial } from '../lib/library';
import { defaultView, stepView, useStore } from '../lib/store';
import type { Material, View } from '../lib/types';
import { Stage } from '../stage/Stage';
import { cleanPath, baseName } from '../lib/pathText';
import { toast } from '../lib/toast';
import '../styles/quickpreview.css';

export interface PreviewTarget {
  path: string;
  title?: string;
  subtitle?: string;
  /** 拖进微信时使用的干净文件名（如「林晓-11月21日-课后作业.pdf」） */
  niceName?: string;
  lessonKey?: string;
}

interface PreviewState {
  target: PreviewTarget | null;
}

export const useQuickPreview = create<PreviewState>()(() => ({ target: null }));

export function openQuickPreview(target: PreviewTarget | string) {
  const item = typeof target === 'string' ? { path: cleanPath(target) } : { ...target, path: cleanPath(target.path) };
  useQuickPreview.setState({ target: item });
}

export function closeQuickPreview() {
  useQuickPreview.setState({ target: null });
}

const VIDEO_EXT = /^(mp4|webm|mov|m4v)$/i;
const AUDIO_EXT = /^(mp3|wav|m4a|ogg|aac|flac)$/i;
const IMAGE_EXT = /^(png|jpe?g|webp|gif|bmp|svg)$/i;
const TEXT_EXT = /^(txt|csv)$/i;
const STAGE_EXT = /^(pdf|zml|docx?|rtf|pptx?|md|markdown|html?)$/i;

interface LoadedPreview {
  mode: 'video' | 'audio' | 'image' | 'text' | 'stage' | 'unsupported';
  realPath: string;
  url?: string;
  text?: string;
  mat?: Material;
  view?: View;
  size?: number;
}

export function QuickPreview() {
  const target = useQuickPreview((s) => s.target);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState<LoadedPreview | null>(null);
  const [fitWidth, setFitWidth] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!target) {
      setData(null);
      setErr('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr('');
    setData(null);
    setCopied(false);

    (async () => {
      try {
        let realPath = target.path;
        let url = '';
        let ext = realPath.split('.').pop()?.toLowerCase() || '';
        let size = 0;

        if (host.electron) {
          const info = await host.call<{ path: string; url: string; ext: string; size: number }>('deliver.previewInfo', { path: realPath });
          realPath = info.path;
          url = info.url;
          ext = info.ext || ext;
          size = info.size;
        } else {
          url = realPath;
        }

        if (cancelled) return;

        if (VIDEO_EXT.test(ext)) {
          setData({ mode: 'video', realPath, url, size });
        } else if (AUDIO_EXT.test(ext)) {
          setData({ mode: 'audio', realPath, url, size });
        } else if (IMAGE_EXT.test(ext)) {
          setData({ mode: 'image', realPath, url, size });
        } else if (TEXT_EXT.test(ext) && host.electron) {
          const txt = await host.call<string>('study.readText', realPath);
          if (!cancelled) setData({ mode: 'text', realPath, text: txt.slice(0, 80_000), size });
        } else if (STAGE_EXT.test(ext)) {
          const entry = fileEntry(realPath, size);
          const mat = await prepareMaterial(entry);
          if (!cancelled) setData({ mode: 'stage', realPath, mat, view: defaultView(mat), size });
        } else {
          setData({ mode: 'unsupported', realPath, size });
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message || '文件暂时无法预览');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [target]);

  // Esc 关闭，左右方向键在多页文档预览时翻页（阻断冒泡，避免翻动底层课堂画面）
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeQuickPreview();
        return;
      }
      if (data?.mode === 'stage' && data.mat && data.view) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          e.preventDefault();
          e.stopPropagation();
          setData((cur) => cur?.mat && cur.view ? { ...cur, view: stepView(cur.mat, cur.view, 1) } : cur);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          e.stopPropagation();
          setData((cur) => cur?.mat && cur.view ? { ...cur, view: stepView(cur.mat, cur.view, -1) } : cur);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, data?.mode, data?.mat, data?.view]);

  if (!target) return null;

  const real = data?.realPath || target.path;
  const title = target.title || baseName(real);
  const dragItem = { path: real, niceName: target.niceName };

  const onDragStart = (e: React.DragEvent) => {
    if (!host.electron || !host.startDrag) return;
    e.preventDefault();
    host.startDrag({ items: [dragItem], lessonKey: target.lessonKey });
  };

  const copyFile = async () => {
    try {
      await host.call('deliver.copyFiles', { items: [dragItem], lessonKey: target.lessonKey });
      setCopied(true);
      toast('文件已复制，切到微信群按 Ctrl+V 即可发送');
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const sendToConsole = (where: 'reader' | 'cue') => {
    if (!data?.mat) return;
    const st = useStore.getState();
    if (where === 'reader') st.open(data.mat, data.view?.page ?? 0);
    else st.cue(data.mat, data.view);
    st.set({ page: 'console' });
    closeQuickPreview();
    toast(where === 'cue' ? `已把「${title}」放入上课预监` : `已在私人阅读器打开「${title}」`);
  };

  return (
    <div
      className="qp-bg"
      data-qa="quick-preview"
      onPointerDown={(e) => { if (e.target === e.currentTarget) closeQuickPreview(); }}
    >
      <section className="qp-modal" role="dialog" aria-label={`预览 ${title}`}>
        <header className="qp-head">
          <div className="qp-title">
            <b title={title}>{title}</b>
            {target.subtitle ? <span>{target.subtitle}</span> : <span title={real}>{baseName(real)}</span>}
          </div>
          <div className="qp-acts">
            {host.electron && (
              <>
                <button
                  type="button"
                  className="qp-drag-btn"
                  draggable
                  onDragStart={onDragStart}
                  data-qa="qp-drag-wechat"
                  data-tip="按住不松手，直接拖进电脑版微信聊天框即可发送这份文件"
                >
                  <GripHorizontal size={14} />按住拖进微信
                </button>
                <button type="button" className="qp-btn" data-qa="qp-copy-file" onClick={() => void copyFile()} data-tip="复制文件到系统剪贴板，切到微信按 Ctrl+V 粘贴发送">
                  {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制文件'}
                </button>
              </>
            )}
            {data?.mode === 'image' && (
              <button type="button" className="qp-btn" onClick={() => setFitWidth(!fitWidth)}>
                {fitWidth ? <Maximize2 size={13} /> : <Minimize2 size={13} />}{fitWidth ? '看原尺寸' : '适应窗口'}
              </button>
            )}
            {data?.mode === 'stage' && data.mat && (
              <>
                <button type="button" className="qp-btn" onClick={() => sendToConsole('reader')} data-tip="只在导播台私人阅读器打开，不动预监">
                  <BookOpen size={13} />去阅读器看
                </button>
                <button type="button" className="qp-btn" onClick={() => sendToConsole('cue')} data-tip="放入上课页右侧预监，准备讲题上屏">
                  <MonitorPlay size={13} />放到上课预监
                </button>
              </>
            )}
            {host.electron && (
              <>
                <button type="button" className="qp-btn" onClick={() => void host.call('assistant.open', { path: real }).catch((e) => toast((e as Error).message))} data-tip="用电脑默认软件打开">
                  <ExternalLink size={13} />默认程序打开
                </button>
                <button type="button" className="qp-btn" onClick={() => host.revealInFolder(real)} data-tip="在资源管理器中定位文件">
                  <FolderOpen size={13} />
                </button>
              </>
            )}
            <button type="button" className="qp-close" data-qa="qp-close" onClick={closeQuickPreview} aria-label="关闭预览">
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="qp-body">
          {loading && (
            <div className="qp-center">
              <Loader2 size={22} className="spin" />
              <span>正在准备原地预览…</span>
            </div>
          )}
          {!loading && err && (
            <div className="qp-center bad">
              <b>没能直接预览这份文件</b>
              <span>{err}</span>
              {host.electron && (
                <div className="qp-fallback">
                  <button type="button" className="qp-btn" onClick={() => void host.call('assistant.open', { path: real }).catch((e) => toast((e as Error).message))}>用默认程序打开</button>
                  <button type="button" className="qp-btn" onClick={() => host.revealInFolder(real)}>打开所在文件夹</button>
                </div>
              )}
            </div>
          )}
          {!loading && !err && data?.mode === 'video' && (
            <div className="qp-video-wrap">
              <video key={data.url} src={data.url} controls autoPlay playsInline className="qp-video" />
            </div>
          )}
          {!loading && !err && data?.mode === 'audio' && (
            <div className="qp-center">
              <audio key={data.url} src={data.url} controls autoPlay />
            </div>
          )}
          {!loading && !err && data?.mode === 'image' && (
            <div className={'qp-img-scroll' + (fitWidth ? ' fit' : ' raw')}>
              <img src={data.url} alt={title} />
            </div>
          )}
          {!loading && !err && data?.mode === 'text' && (
            <pre className="qp-text">{data.text}</pre>
          )}
          {!loading && !err && data?.mode === 'stage' && data.mat && data.view && (
            <div className="qp-stage-wrap">
              <div className="qp-stage-canvas">
                <Stage
                  mat={data.mat}
                  view={data.view}
                  author="teacher"
                  tool="pointer"
                  color="ink"
                  size={3}
                  inkEnabled={false}
                  boardFill
                  overlays={false}
                />
              </div>
              {data.mat.total > 1 && (
                <div className="qp-pager">
                  <button
                    type="button"
                    disabled={data.view.page <= 0 && data.view.slide <= 0}
                    onClick={() => setData((cur) => cur?.mat && cur.view ? { ...cur, view: stepView(cur.mat, cur.view, -1) } : cur)}
                  >
                    <ChevronLeft size={15} />上一页
                  </button>
                  <span className="num">第 {data.view.page + 1} / {data.mat.total} 页</span>
                  <button
                    type="button"
                    disabled={data.view.page >= data.mat.total - 1}
                    onClick={() => setData((cur) => cur?.mat && cur.view ? { ...cur, view: stepView(cur.mat, cur.view, 1) } : cur)}
                  >
                    下一页<ChevronRight size={15} />
                  </button>
                </div>
              )}
            </div>
          )}
          {!loading && !err && data?.mode === 'unsupported' && (
            <div className="qp-center">
              <b>此格式支持直接拖进微信或用默认程序查看</b>
              <span>{baseName(real)}</span>
              {host.electron && (
                <div className="qp-fallback">
                  <button type="button" className="qp-btn" onClick={() => void host.call('assistant.open', { path: real }).catch((e) => toast((e as Error).message))}>用默认程序打开</button>
                  <button type="button" className="qp-btn" onClick={() => host.revealInFolder(real)}>在文件夹中显示</button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
