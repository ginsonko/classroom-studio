// 1.7.0 / 1.8.0 学生窗口（会议里共享的那个）角落的「开始上课 / 下课」胶囊与课堂计时：
// 1.8.0 三段式智能显隐 + 自由拖动记忆位置 + 自动避让占满课件右上角控制按钮：
// 1) 未开始上课时：醒目的暖珀点睛胶囊（排课前后直接标出学生姓名），一眼防忘录；
// 2) 开始上课后（未到下课点）：退居边角变成低调半透明微缩条，不抢课件视线，鼠标移近展开，双击可缩成微点；
// 3) 到达排课下课点后：自动恢复醒目金珀高亮提醒「到下课点 · 下课」，准时收尾不漏存；
// 4) 按住任意处拖动即可挪位并记住相对位置，未挪位时遇到占满课件自动左移避开右上角最小化/关闭按钮。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Circle, Clock3, GripVertical, Minimize2, Square } from 'lucide-react';
import { useStore } from '../lib/store';
import { BASE, visibleLayers } from '../lib/desk';
import { bus } from '../lib/bus';
import { host } from '../lib/host';
import '../styles/classcorner.css';

export const clockText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
};
const send = (act: 'start' | 'stop' | 'later' | 'skip') => bus.post({ t: 'class', act });

const POS_KEY = 'cs.classCorner.pos.v1';
interface SavedPos {
  /** 距离窗口左边缘比例 0..1（当 sideX==='left' 时用）或右边缘比例（sideX==='right' 时用） */
  sideX: 'left' | 'right';
  offsetX: number;
  sideY: 'top' | 'bottom';
  offsetY: number;
}

function readSavedPos(): SavedPos | null {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (raw && (raw.sideX === 'left' || raw.sideX === 'right') && (raw.sideY === 'top' || raw.sideY === 'bottom')
      && Number.isFinite(raw.offsetX) && Number.isFinite(raw.offsetY)) {
      return {
        sideX: raw.sideX,
        offsetX: Math.max(6, Math.min(window.innerWidth - 60, Number(raw.offsetX))),
        sideY: raw.sideY,
        offsetY: Math.max(6, Math.min(window.innerHeight - 36, Number(raw.offsetY))),
      };
    }
  } catch { /* 忽略损坏记录 */ }
  return null;
}

/** 每秒走一次的课堂计时（since=0 时不走） */
export function useClassClock(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!since) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [since]);
  return since ? clockText(now - since) : '';
}

export function ClassCorner({ where = 'stage' }: { where?: 'stage' | 'dock' }) {
  const bar = useStore((s) => s.classBar);
  // 检测学生画面当前是否有占满全屏的非黑板课件（右上角会有 .desk-fullbar 的最小化/窗口/关闭按钮）
  const hasFullCourseware = useStore((s) => {
    const full = visibleLayers(s.desk, s.pgmMat, s.pgm).full;
    return !!full && full.id !== BASE;
  });

  const live = bar?.phase === 'recording';
  const busy = bar?.phase === 'starting' || bar?.phase === 'stopping';
  const overtime = !!(live && bar?.overtime);
  const clock = useClassClock(live ? bar!.since : 0);

  const [sure, setSure] = useState(false);
  const [folded, setFolded] = useState(false);
  const [pos, setPos] = useState<SavedPos | null>(() => (where === 'stage' ? readSavedPos() : null));
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);

  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  // 未开课或刚到下课点需要提醒老师时，自动从折叠小圆点展开，避免错过重要提醒
  useEffect(() => { if (!live || overtime) setFolded(false); }, [live, overtime]);

  // 响应「恢复默认布局」事件，把拖动过的位置归位到右上角
  useEffect(() => {
    if (where !== 'stage' || !host.electron) return;
    return host.onEvent((e) => {
      if (e?.type === 'layout' && e.reset) {
        try { localStorage.removeItem(POS_KEY); } catch { /* 忽略 */ }
        setPos(null);
        setFolded(false);
      }
    });
  }, [where]);

  // 窗口尺寸变化时确保自定义位置仍留在可视范围内
  useEffect(() => {
    if (where !== 'stage') return;
    const onResize = () => setPos((cur) => {
      if (!cur) return null;
      return {
        ...cur,
        offsetX: Math.max(6, Math.min(Math.max(6, window.innerWidth - 90), cur.offsetX)),
        offsetY: Math.max(6, Math.min(Math.max(6, window.innerHeight - 40), cur.offsetY)),
      };
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [where]);

  if (!bar) return null;
  // 浮层只显示计时（浮层本身只有老师看得到）
  if (where === 'dock') return live ? <span className={'cc-dock num' + (overtime ? ' overtime' : '')} data-qa="dock-class-clock" data-tip={overtime ? '已到下课时间点' : '课堂计时'}><i />{clock}</span> : null;
  if (!bar.show && !bar.ask) return null;

  // 按住随手拖动：移动小于 5px 视为普通点击，大于等于 5px 进入拖拽并吞掉随后的 click
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !wrapRef.current) return;
    const el = wrapRef.current;
    const rect0 = el.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    movedRef.current = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!movedRef.current && Math.hypot(dx, dy) < 5) return;
      if (!movedRef.current) {
        movedRef.current = true;
        setDragging(true);
      }
      const w = window.innerWidth, h = window.innerHeight;
      const nextLeft = Math.max(6, Math.min(w - rect0.width - 6, rect0.left + dx));
      const nextTop = Math.max(6, Math.min(h - rect0.height - 6, rect0.top + dy));
      // 自动吸附最近的左右边和上下边，保证胶囊缩放窗口时也贴边工整
      const sideX: 'left' | 'right' = nextLeft + rect0.width / 2 < w / 2 ? 'left' : 'right';
      const sideY: 'top' | 'bottom' = nextTop + rect0.height / 2 < h / 2 ? 'top' : 'bottom';
      const next: SavedPos = {
        sideX,
        offsetX: Math.round(sideX === 'left' ? nextLeft : Math.max(6, w - (nextLeft + rect0.width))),
        sideY,
        offsetY: Math.round(sideY === 'top' ? nextTop : Math.max(6, h - (nextTop + rect0.height))),
      };
      setPos(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (movedRef.current) {
        setDragging(false);
        setPos((latest) => {
          if (latest) {
            try { localStorage.setItem(POS_KEY, JSON.stringify(latest)); } catch { /* 忽略 */ }
          }
          return latest;
        });
        // 阻止拖拽松手触发内部按钮的 click
        setTimeout(() => { movedRef.current = false; }, 60);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const guardClick = (fn: () => void) => (e: React.MouseEvent) => {
    if (movedRef.current) { e.preventDefault(); e.stopPropagation(); return; }
    fn();
  };

  // 计算最终定位：若停留在右上角热区且学生画面打开了占满课件，自动往左让开 .desk-fullbar（约 116px 宽）
  const inTopRightZone = !pos || (pos.sideX === 'right' && pos.offsetX < 126 && pos.sideY === 'top' && pos.offsetY < 46);
  const effectiveRight = (pos ? pos.offsetX : 10) + (hasFullCourseware && inTopRightZone ? (pos ? Math.max(0, 124 - pos.offsetX) : 114) : 0);
  const style: CSSProperties = pos
    ? {
        top: pos.sideY === 'top' ? pos.offsetY : 'auto',
        bottom: pos.sideY === 'bottom' ? pos.offsetY : 'auto',
        left: pos.sideX === 'left' ? pos.offsetX : 'auto',
        right: pos.sideX === 'right' ? effectiveRight : 'auto',
        alignItems: pos.sideX === 'left' ? 'flex-start' : 'flex-end',
      }
    : {
        top: 10,
        right: effectiveRight,
        left: 'auto',
        bottom: 'auto',
        alignItems: 'flex-end',
      };

  const upcoming = bar.upcoming;
  const startLabel = upcoming
    ? (upcoming.late ? `还没开录 · 开始「${upcoming.name}」` : `开始上课 · ${upcoming.name}`)
    : '开始上课';

  const pillState = busy ? 'busy' : !live ? (upcoming?.late ? 'idle-late' : 'idle-prominent') : overtime ? 'live overtime' : 'live quiet';

  return (
    <div
      ref={wrapRef}
      style={style}
      className={'cc' + (dragging ? ' dragging' : '') + (hasFullCourseware && inTopRightZone ? ' dodged' : '')}
      data-qa="class-corner"
      data-live={live ? '1' : '0'}
      data-state={!live ? 'idle' : overtime ? 'overtime' : 'quiet'}
      onPointerDown={onPointerDown}
    >
      {bar.show && (
        folded && live && !overtime ? (
          <button
            className="cc-mini"
            data-qa="class-mini"
            onClick={guardClick(() => setFolded(false))}
            data-tip={`正在录课 ${clock} · 点击展开（按住可拖动）`}
            aria-label="展开课堂计时"
          >
            <i /><span className="num">{clock}</span>
          </button>
        ) : (
          <div
            className={'cc-pill ' + pillState}
            onDoubleClick={() => { if (live && !overtime) setFolded(true); }}
          >
            <span className="cc-grip" data-tip="按住随手拖动位置（遇占满课件自动让开右上角按钮）"><GripVertical size={11} /></span>
            {live && <span className="cc-clock num" data-qa="class-clock"><i />{clock}</span>}
            {busy ? (
              <span className="cc-busy">{bar.phase === 'starting' ? '准备中…' : '保存中…'}</span>
            ) : live ? (
              <>
                <button
                  className={'cc-b' + (sure ? ' sure' : '') + (overtime ? ' due' : '')}
                  data-qa="class-stop"
                  onClick={guardClick(() => { if (sure) { setSure(false); send('stop'); } else setSure(true); })}
                  aria-label="下课"
                >
                  {sure ? '再点一次下课' : overtime ? <><Clock3 size={10} />到点 · 下课</> : <><Square size={8} fill="currentColor" />下课</>}
                </button>
                {!overtime && !sure && (
                  <button
                    className="cc-fold"
                    onClick={guardClick(() => setFolded(true))}
                    data-tip="收成贴边微标（到下课点会自动亮起提醒）"
                    aria-label="收起为微标"
                  >
                    <Minimize2 size={10} />
                  </button>
                )}
              </>
            ) : (
              <button
                className={'cc-b start' + (upcoming?.late ? ' late' : '')}
                data-qa="class-start"
                onClick={guardClick(() => send('start'))}
                aria-label="开始上课"
              >
                <Circle size={9} fill="currentColor" />{startLabel}
              </button>
            )}
          </div>
        )
      )}
      {bar.ask && !live && <div className="cc-ask" role="alertdialog" data-qa="class-ask">
        <Clock3 size={13} /><span>{bar.ask.next ? `换到「${bar.ask.name}」这节课？` : `「${bar.ask.name}」${bar.ask.late ? '已经' : ''}到上课时间了，开始上课？`}</span>
        <button className="go" data-qa="class-ask-start" onClick={guardClick(() => send('start'))}>开始</button>
        <button data-qa="class-ask-later" onClick={guardClick(() => send('later'))}>5 分钟后</button>
      </div>}
      {bar.ask && live && bar.ask.next && <div className="cc-ask" role="alertdialog" data-qa="class-ask">
        <Clock3 size={13} /><span>换到「{bar.ask.name}」这节课？</span>
        <button className="go" data-qa="class-ask-start" onClick={guardClick(() => send('start'))}>换</button>
        <button data-qa="class-ask-later" onClick={guardClick(() => send('later'))}>5 分钟后</button>
      </div>}
    </div>
  );
}
