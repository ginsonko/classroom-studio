// 页面缩略图：进入可视区才渲染，PDF 页走 pdf.ts 的栅格缓存。
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PageInfo } from '../lib/types';
import { assetUrl, pdfRaster } from '../doc/pdf';

/** 一页的缩略图地址（PDF 栅格 / 图片）；元素进入可视区后才开始渲染。没有图的页（黑板、网页）返回空串。 */
export function usePageImage(ref: RefObject<HTMLElement | null>, page: PageInfo | undefined, width: number, skip = false) {
  const [url, setUrl] = useState('');
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    setUrl('');
    if (!seen || skip || !page) return;
    let alive = true, made = '';
    if (page.doc) {
      pdfRaster(page.doc.pdf, page.doc.index, width * 2).then((b) => { if (!alive) return; made = URL.createObjectURL(b); setUrl(made); }).catch(() => {});
    } else if (page.src) {
      // 相对地址（内置样稿）和页面本身一样直接用；本机绝对路径走文件协议
      try { setUrl(/^([a-z]:[\\/]|\/)/i.test(page.src) ? assetUrl(page.src) : page.src); } catch { /* 文件不可读，留空白 */ }
    }
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [seen, skip, page?.doc?.pdf, page?.doc?.index, page?.src, width]);
  return url;
}

export function PageThumb({ page, n, width = 96, active, mark, hide, onPick }: { page: PageInfo; n: number; width?: number; active?: boolean; mark?: string; hide?: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const url = usePageImage(ref, page, width, hide);
  const ratio = page.w > 0 && page.h > 0 ? page.h / page.w : 9 / 16;
  return (
    <button ref={ref} className={'pthumb' + (active ? ' on' : '')} onClick={onPick} title={`第 ${n} 页`}>
      <span className={'pthumb-img' + (page.doc || page.src ? '' : ' blank') + (hide ? ' hide' : '')} style={{ width, height: Math.round(Math.min(width * 1.5, width * ratio)) }}>
        {url ? <img src={url} alt="" draggable={false} /> : null}
      </span>
      <span className="pthumb-n num">{n}{mark ? <em>{mark}</em> : null}</span>
    </button>
  );
}
