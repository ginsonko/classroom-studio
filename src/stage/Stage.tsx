import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InkLayer } from '../ink/InkLayer';
import { ChaseSim } from './ChaseSim';
import { AnimPlayer } from './AnimPlayer';
import { DocPage } from '../doc/DocPage';
import { SimHost } from '../physics/SimHost';
import { DemoHost } from '../demos/DemoHost';
import { isKitDemo } from '../demos';
import { S3DHost } from '../scene3d/S3DHost';
import { KIND_LABEL } from '../lib/library';
import { inkKey, useStore, ROLE } from '../lib/store';
import type { Author, Material, PageInfo, Tool, View } from '../lib/types';
import { SCREEN, isLong } from '../lib/longBoard';
import { builtOf, clicksOf } from '../lib/slideSteps';
import { StepPage } from './StepPage';

import { host } from '../lib/host';
import { Eye, EyeOff, GripHorizontal } from 'lucide-react';
import { coverSegs, hiddenFromStudent, isAnswer, moveSegTop, skipWholeFile, toggleAnswerPage, toggleReveal } from '../doc/answers';
export interface StageProps {
  scope?:'program'|'preview';
  inkLayer?:'public'|'private';
  mat: Material;
  view: View;
  author: Author;
  tool: Tool;
  color: string;
  size: number;
  inkEnabled: boolean;
  showPrivate?: boolean;
  boardFill?: boolean;     // 黑板背景铺满容器
  pad?: number;
  overlays?: boolean;      // 聚光灯、幕布
  children?: ReactNode;
  onWheel?: (e: React.WheelEvent) => void;
  /** 长黑板：拖右侧滑条跳到某个位置（y 是画面上沿，按页宽计）；不给就只显示位置 */
  onSeek?: (y: number) => void;
}

/** 计算页面在容器内的像素矩形 */
export function layout(view: View, page: PageInfo, W: number, H: number, pad: number, long = false) {
  const r = page.h / page.w;
  const aw = Math.max(1, W - pad * 2), ah = Math.max(1, H - pad * 2);
  if (long) {
    // 长黑板：取景框固定 16:9，整条页面在框里上下移动
    const pw = Math.min(aw, ah / SCREEN);
    return { pw, ph: pw * r, left: (W - pw) / 2, top: (H - pw * SCREEN) / 2 - (view.y ?? 0) * pw, scroll: false };
  }
  let box: number[] | undefined;
  if (view.fit === 'slides') box = page.slides?.[view.slide] ?? page.slides?.[0];
  if (view.fit === 'region') box = view.region;
  if (box && box.length === 4) {
    const [bx, by, bw, bh] = box;
    const pw = Math.min(aw / bw, ah / (bh * r)) * view.zoom;
    return { pw, ph: pw * r, left: (W - bw * pw) / 2 - bx * pw, top: (H - bh * r * pw) / 2 - by * r * pw, scroll: false };
  }
  if (view.fit === 'width') {
    const pw = aw * view.zoom;
    return { pw, ph: pw * r, left: (W - pw) / 2, top: pad, scroll: true };
  }
  const pw = Math.min(aw, ah / r) * view.zoom;
  return { pw, ph: pw * r, left: (W - pw) / 2, top: (H - pw * r) / 2, scroll: false };
}

export function Stage(p: StageProps) {
  const { mat, view, pad = 0 } = p;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ W: 0, H: 0 });
  const boardSkin = useStore((s) => s.boardSkin);
  const pattern = useStore((s) => s.pattern);
  const spotlight = useStore((s) => s.spotlight);
  const curtain = useStore((s) => s.curtain);

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const page = mat.pages[Math.min(view.page, mat.pages.length - 1)] ?? { w: 1600, h: 900 };
  const long = isLong(mat);
  const L = useMemo(() => layout(view, page, size.W, size.H, pad, long), [view, page, size, pad, long]);
  const isBoard = mat.kind === 'board';
  const ratio = page.h / page.w;
  // 切分 / 框选：裁掉相邻幻灯片；跨页框选不裁（下一页接在下方）
  const crop = view.fit === 'slides' ? page.slides?.[view.slide] : view.fit === 'region' ? view.region : undefined;
  const clip = crop && crop[1] + crop[3] <= 1.001
    ? `inset(${crop[1] * 100}% ${Math.max(0, 1 - crop[0] - crop[2]) * 100}% ${Math.max(0, 1 - crop[1] - crop[3]) * 100}% ${crop[0] * 100}% round 6px)`
    : undefined;
  const fill = isBoard && p.boardFill;
  // 答案页：学生端遮住，教师端的学生画面监视器标出来
  const revealed = useStore((s) => s.revealed);
  // 学生画面里同时开着的浮动窗口也算「在播」：答案页一样要遮住
  const onAir = useStore((s) => s.pgmMat.id === mat.id || (p.scope === 'program' && s.desk.some((w) => w.id === mat.id)));
  const guard = useStore((s) => s.answerGuard !== false);
  const hidden = onAir && hiddenFromStudent(mat, view.page, revealed, guard);
  const segs = coverSegs(mat, view.page);
  const coverStudent = ROLE === 'student' && hidden && !segs.length;
  const coverPart = ROLE === 'student' && hidden && segs.length > 0;
  const showBadge = ROLE !== 'student' && onAir && guard && p.scope === 'program' && isAnswer(mat, view.page);
  const steps = useStore((s) => clicksOf(mat, view.page, s.slideSteps !== false) > 0);

  return (
    <div
      ref={box}
      className={'stage' + (L.scroll ? ' scroll' : '') + (isBoard && p.boardFill ? ' board-fill' : '') + (long ? ' long' : '')}
      data-board={boardSkin}
      data-pattern={fill && !long ? pattern : 'none'}
      style={fill ? { ['--ox' as string]: L.left + 'px', ['--oy' as string]: L.top + 'px', ['--cell' as string]: L.pw / 32 + 'px' } : undefined}
      onWheel={p.onWheel}
    >
      {size.W > 0 && (
        <div
          className={'page' + (isBoard ? ' board' : '') + (view.fit === 'slides' || view.fit === 'region' ? ' cropped' : '')}
          data-pattern={isBoard && !fill && !long ? pattern : 'none'}
          style={{ width: L.pw, height: L.ph, left: L.left, top: L.top, clipPath: clip, ['--cell' as string]: L.pw / 32 + 'px' }}
        >
          {/* 长黑板的底纹画在页面上，跟着页面一起滚动 */}
          {long && <div className="long-pattern" data-pattern={pattern} />}
          {coverStudent ? <AnswerCover /> : steps ? <StepPage mat={mat} page={page} index={view.page} clicks={builtOf(mat, view)} audible={ROLE === 'student'} /> : <PageContent mat={mat} page={page} index={view.page} scope={p.scope??'preview'} interactive={p.tool==='pointer'}/>}
          {showBadge && <AnswerBadge mat={mat} page={view.page} open={!hidden} segs={segs} />}
          {view.fit === 'region' && view.region && view.region[1] + view.region[3] > 1 && mat.pages[view.page + 1] && !(ROLE === 'student' && hiddenFromStudent(mat, view.page + 1, revealed, guard)) && (
            <div className="page-next" style={{ top: '100%', height: L.pw * (mat.pages[view.page + 1].h / mat.pages[view.page + 1].w) }}>
              <PageContent mat={mat} page={mat.pages[view.page + 1]} index={view.page + 1} />
            </div>
          )}
          {!coverStudent && <InkLayer
            ikey={inkKey(mat.id, view.page)}
            ratio={ratio}
            onPage={!isBoard}
            author={p.author}
            tool={p.tool}
            color={p.color}
            size={p.size}
            enabled={p.inkEnabled && p.tool !== 'pointer'}
            showPrivate={p.showPrivate}
            inkLayer={p.inkLayer}
            band={long ? longBand(view.y ?? 0) : undefined}
          />}
          {coverPart && segs.map(([a, b], i) => <AnswerCover key={i} from={a} to={b} />)}
          {p.overlays !== false && curtain !== null && (
            <div className="curtain" style={{ top: curtain * 100 + '%' }}>
              <div className="curtain-grip"><span />拖动揭开<span /></div>
            </div>
          )}
          {p.overlays !== false && spotlight && (
            <div
              className="spotlight"
              style={{
                background: `radial-gradient(circle at ${spotlight.x * 100}% ${spotlight.y * 100}%, transparent ${spotlight.r * L.pw * 0.92}px, rgba(4,6,10,.78) ${spotlight.r * L.pw}px)`,
              }}
            />
          )}
        </div>
      )}
      {long && size.W > 0 && (
        <div className={'long-rail' + (p.onSeek ? ' seek' : '')} aria-hidden onPointerDown={p.onSeek ? railDrag(ratio, p.onSeek) : undefined} data-tip={p.onSeek ? '拖动跳到长黑板的其它位置' : undefined}>
          <i style={{ top: Math.min(1, (view.y ?? 0) / ratio) * 100 + '%', height: Math.min(1, SCREEN / ratio) * 100 + '%' }} />
        </div>
      )}
      {p.children}
    </div>
  );
}

/** 长黑板的画布段：上沿按半屏取整、高两屏，总能盖住画面里那一屏；滚动时每过半屏才挪一次、重画一次 */
export function longBand(y: number): [number, number] {
  const step = SCREEN / 2;
  return [Math.max(0, (Math.floor(y / step + 1e-6) - 1) * step), SCREEN * 2];
}

/** 按住滑条拖动：滑块中心跟着指针走，40ms 发一次 */
const railDrag = (ratio: number, seek: (y: number) => void) => (e: React.PointerEvent<HTMLDivElement>) => {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const el = e.currentTarget, B = el.getBoundingClientRect();
  try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
  const to = (ev: { clientY: number }) => seek((ev.clientY - B.top) / Math.max(1, B.height) * ratio - SCREEN / 2);
  let t = 0;
  const move = (ev: PointerEvent) => { const now = performance.now(); if (now - t < 40) return; t = now; to(ev); };
  const up = (ev: PointerEvent) => { to(ev); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  to(e); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
};

function AnswerCover({ from = 0, to = 1 }: { from?: number; to?: number }) {
  if (from > 0 || to < 1) {
    const small = to - from < 0.12;
    return <div className={'answer-cover partial' + (small ? ' slim' : '')} style={{ top: from * 100 + '%', height: (to - from) * 100 + '%', bottom: 'auto' }}><div><EyeOff size={small ? 18 : 28} /><b>答案</b>{!small && <span>先自己想一想，老师稍后揭晓</span>}</div></div>;
  }
  return <div className="answer-cover"><div><EyeOff size={34} /><b>答案页</b><span>先自己想一想，老师稍后揭晓</span></div></div>;
}

/** 老师端：标出学生看不到的区域；遮挡条上沿可以拖动微调，遮错了一键取消 */
function AnswerBadge({ mat, page, open, segs }: { mat: Material; page: number; open: boolean; segs: [number, number][] }) {
  const [menu, setMenu] = useState(false);
  // 微调和取消只改当前项（pgmMat）；浮动窗口里的课件先点一下切成当前项再改
  const editable = useStore((s) => s.pgmMat.id === mat.id) && !open;
  const drag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('.page') as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => moveSegTop(page, i, (ev.clientY - r.top) / r.height);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <>
      {segs.map(([a, b], i) => (
        <div key={i} className={'answer-zone' + (open ? ' open' : '')} style={{ top: a * 100 + '%', height: (b - a) * 100 + '%' }}>
          {editable && <button className="answer-grip" onPointerDown={drag(i)} data-tip="拖动调整遮挡的上沿" aria-label="拖动调整遮挡的上沿"><GripHorizontal size={12} /></button>}
        </div>
      ))}
      <div className={'answer-badge' + (open ? ' open' : '')}>
        {open ? <Eye size={13} /> : <EyeOff size={13} />}
        <span>{open ? '答案已揭晓 · 学生可见' : segs.length ? `${segs.length > 1 ? segs.length + ' 段' : '框内'}是答案 · 学生看不到` : '答案页 · 学生看不到'}</span>
        <button onClick={() => toggleReveal(mat.id, page)}>{open ? '收回' : '揭晓'}</button>
        {editable && <button className="ab-more" onClick={() => setMenu(!menu)} aria-label="遮错了">遮错了</button>}
        {menu && <div className="ab-menu" onPointerLeave={() => setMenu(false)}>
          <button onClick={() => { toggleAnswerPage(page); setMenu(false); }}>本页不遮</button>
          <button onClick={() => { skipWholeFile(); setMenu(false); }}>这份课件都不遮</button>
          <button onClick={() => { useStore.getState().setShared({ answerGuard: false }); if (host.electron) void host.call('setSettings', { answerOff: true }).catch(() => {}); setMenu(false); }}>以后都不遮（可在设置里重新打开）</button>
        </div>}
      </div>
    </>
  );
}

function PageContent({ mat, page, index,scope='preview',interactive=true }: { mat: Material; page: PageInfo; index: number;scope?:'program'|'preview';interactive?:boolean }) {
  if (mat.kind === 'board') return null;
  if (mat.id === 'sim:chase' && !mat.scene) return <ChaseSim scope={scope}/>;
  if (mat.s3d) return <S3DHost mat={mat} scope={scope}/>;
  if (isKitDemo(mat)) return <DemoHost mat={mat} scope={scope}/>;
  if (mat.kind === 'sim') return <SimHost mat={mat} scope={scope}/>;
  if (mat.id.startsWith('anim:')) return <AnimPlayer mat={mat} scope={scope}/>;
  if (page.src || page.doc || mat.src) return <DocPage mat={mat} page={page} index={index} audible={ROLE==='student'} interactive={interactive}/>;
  if(host.electron)return <div className="mock-media"><b>{mat.title}</b><p>课件内容还未准备好，请在资料库重新打开。</p></div>;
  return <MockPage mat={mat} index={index} wide={page.w > page.h} />;
}

/** 尚未渲染的课件：画一份\"文档骨架\"，明确标注样稿 */
export function MockPage({ mat, index, wide }: { mat: Material; index: number; wide: boolean }) {
  const seed = [...mat.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) + index * 97;
  const rnd = (i: number) => ((Math.sin(seed + i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  if (['video', 'html', 'flash', 'audio'].includes(mat.kind)) {
    return (
      <div className="mock-media">
        <div className="mock-media-k">{KIND_LABEL[mat.kind]}</div>
        <div className="mock-media-t">{mat.title}</div>
        <div className="mock-media-n">样稿：正式版在这里播放原文件</div>
      </div>
    );
  }
  return (
    <div className={'mock-page' + (wide ? ' wide' : '')}>
      <div className="mock-head">
        <b>{index === 0 ? mat.title : `第 ${index + 1} 页`}</b>
        <i>{KIND_LABEL[mat.kind]}</i>
      </div>
      {Array.from({ length: wide ? 5 : 14 }, (_, i) => (
        <div key={i} className={'mock-line' + (rnd(i) > 0.82 ? ' q' : '')} style={{ width: `${55 + rnd(i + 50) * 42}%` }} />
      ))}
      {!wide && <div className="mock-fig" style={{ width: `${30 + rnd(99) * 20}%` }} />}
      <div className="mock-foot">样稿占位 · 正式版渲染原文件</div>
    </div>
  );
}
