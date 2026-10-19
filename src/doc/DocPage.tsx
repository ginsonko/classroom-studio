import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw, VolumeX } from 'lucide-react';
import type { Material, PageInfo } from '../lib/types';
import { assetUrl, pdfRaster } from './pdf';
import { acquire, attach, release, setMuted, type WebFrame } from './webKeep';
import '../styles/doc.css';

export function DocPage({ mat, page, index, audible = false, interactive = true }: { mat: Material; page: PageInfo; index: number; audible?: boolean; interactive?: boolean }) {
  if (page.doc) return <PdfPage path={page.doc.pdf} index={page.doc.index} title={mat.title} />;
  if (page.src) return <ImagePage src={page.src} title={`${mat.title} 第 ${index + 1} 页`} />;
  if (mat.src?.render === 'html') return <HtmlPage path={mat.src.path} title={mat.title} interactive={interactive} audible={audible} />;
  if (mat.src?.render === 'video') return <MediaPage path={mat.src.path} title={mat.title} audio={mat.kind === 'audio'} audible={audible} />;
  return <Failure message={mat.src?.error || '这份课件没有准备好，请从资料库重新打开。'} />;
}

function Failure({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="doc-failure" role="alert"><AlertCircle size={24} /><b>课件暂时无法显示</b><span>{message}</span>{retry && <button onClick={retry}><RefreshCw size={13} />重新读取</button>}</div>;
}

function ImagePage({ src, title }: { src: string; title: string }) {
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => setError(false), [src]);
  if (error) return <Failure message="图片读取失败，请确认文件仍然存在。" retry={() => { setError(false); setAttempt((n) => n + 1); }} />;
  return <img key={`${src}-${attempt}`} className="page-img doc-image" src={src} alt={title} draggable={false} loading="lazy" onError={() => setError(true)} />;
}

function PdfPage({ path, index, title }: { path: string; index: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0), [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setWidth(Math.ceil(el.clientWidth * Math.min(2.5, devicePixelRatio || 1))));
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '360px' });
    ro.observe(el); io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);
  const bucket = Math.ceil(width / 128) * 128;
  useEffect(() => {
    let alive = true, url: string | null = null;
    setError('');
    if (!visible || bucket <= 0) { setImage(null); return; }
    void pdfRaster(path, index, bucket).then((blob) => {
      if (!alive) return;
      url = URL.createObjectURL(blob); setImage(url);
    }, (e) => { if (alive) { setImage(null); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path, index, bucket, visible, attempt]);
  return <div ref={box} className="doc-page">
    {image && <img className="page-img doc-image" src={image} alt={`${title} 第 ${index + 1} 页`} draggable={false} />}
    {error ? <Failure message={error} retry={() => setAttempt((n) => n + 1)} /> : !image && visible && <div className="doc-loading"><span className="spin" /><span>正在读取第 {index + 1} 页</span></div>}
  </div>;
}

// 本地网页课件运行在自己的 lesson://<目录令牌> 源上（与导播台页面不同源，碰不到导播台），
// 因此 webKeep 给它放开 allow-same-origin：很多课件要用 localStorage / sessionStorage 记路由和进度。
// iframe 由 webKeep 管理：切走时停到画面外（不重载），切回来原样挪回。
function HtmlPage({ path, title, interactive, audible }: { path: string; title: string; interactive: boolean; audible: boolean }) {
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'slow' | 'ready'>('loading');
  const slot = useRef<HTMLDivElement>(null), frame = useRef<WebFrame | null>(null);
  useLayoutEffect(() => {
    const f = acquire(path, title, attempt > 0);
    frame.current = f;
    setMuted(f, !audible);
    f.el.style.pointerEvents = interactive ? 'auto' : 'none';
    attach(f, slot.current!);
    setError(f.failed); setPhase(f.loaded ? 'ready' : 'loading');
    const on = () => { setPhase('ready'); setError(f.failed); };
    f.subs.add(on);
    const t = setTimeout(() => setPhase((p) => (p === 'loading' ? 'slow' : p)), 6000);
    return () => { clearTimeout(t); f.subs.delete(on); frame.current = null; release(f); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, attempt]);
  useEffect(() => { if (frame.current) frame.current.el.style.pointerEvents = interactive ? 'auto' : 'none'; }, [interactive]);
  useEffect(() => { if (frame.current) setMuted(frame.current, !audible); }, [audible]);
  return <div className="doc-web">
    <div ref={slot} className="doc-web-slot" />
    {phase !== 'ready' && !error && <div className={'doc-web-wait' + (phase === 'slow' ? ' slow' : '')}>
      <span className="spin" />
      <span>{phase === 'slow' ? '网页还在加载，可能在等网络或大文件…' : '正在打开网页课件'}</span>
      {phase === 'slow' && <button onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={12} />重新加载</button>}
    </div>}
    {!audible && <span className="doc-muted"><VolumeX size={12} />教师预览静音</span>}
    {error && <Failure message="网页未能加载，请确认文件或网络可用。" retry={() => { setError(false); setAttempt((n) => n + 1); }} />}
  </div>;
}

function MediaPage({ path, title, audio, audible }: { path: string; title: string; audio: boolean; audible: boolean }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [path]);
  if (error) return <Failure message="媒体读取失败或编码不兼容。可先转换为 H.264 MP4、WebM 或 MP3。" />;
  const media = { src: assetUrl(path), controls: true, muted: !audible, preload: 'metadata' as const, onError: () => setError(true) };
  return <div className={'doc-media' + (audio ? ' audio' : '')}>
    {audio ? <><b>{title}</b><audio {...media} /></> : <video {...media} playsInline />}
    {!audible && <span className="doc-muted"><VolumeX size={12} />教师预览静音</span>}
  </div>;
}
