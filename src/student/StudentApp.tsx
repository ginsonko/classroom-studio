import { useCallback, useEffect, useState } from 'react';
import { inkKey, stepView, useStore } from '../lib/store';
import type { Tool } from '../lib/types';
import { Desk } from '../stage/Desk';
import { DeskRail, PagePanel, ZoomBar, deskWheel, resetZoom, zoomBy } from '../stage/DeskControls';
import { pageLabel } from '../lib/desk';
import { useToolKeys } from '../ui/ToolPalette';
import { StudentBar } from './StudentBar';
import { warm } from '../doc/webKeep';
import { installPaste } from '../ink/pasteImage';

/**
 * 学生窗口：腾讯会议只共享这个窗口。
 * 老师用手写笔直接在这里全屏书写；老师浮层在正式版是独立的防截屏窗口。
 * 画面是一张「桌面」：黑板垫底，课件可以占满或浮成窗口；左边切换栏、右边页面缩略图、右下角翻页和放大。
 */
export function StudentApp() {
  const pgm = useStore((s) => s.pgm);
  const mat = useStore((s) => s.pgmMat);
  const eye = useStore((s) => s.eyeCare);
  const takeAt = useStore((s) => s.takeAt);
  const studentTools = useStore((s) => s.studentTools);
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const size = useStore((s) => s.size);
  const set = useStore((s) => s.set);
  const who = useStore(s=>s.drawAuthor);
  const [sTool, setSTool] = useState<Tool>('pen');
  const [sSize, setSSize] = useState(3.5);
  const [flash, setFlash] = useState(false);

  useEffect(() => { document.title = '课堂展示 · 请共享这个窗口'; }, []);
  // 老师拿着笔时，在学生窗口里 Ctrl+V 也能把截图贴到黑板
  useEffect(() => installPaste(() => useStore.getState().drawAuthor === 'teacher', (m) => console.warn('贴图失败', m)), []);
  const warmList = useStore((s) => s.warm);
  useEffect(() => { warm(warmList ?? []); }, [warmList]);
  useEffect(() => {
    if (!takeAt) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [takeAt]);

  const teacherTool=useCallback((t:Tool)=>{if(useStore.getState().drawAuthor==='teacher')set({tool:t});},[set]);
  useToolKeys(teacherTool);

  // 老师在写，或者学生工具开放时，都可以翻页、放大、切换窗口（老师锁定后学生只能看）
  const canDrive = who === 'teacher' || studentTools === 'open';

  // 翻页笔 / 方向键；Ctrl + = / - / 0 放大、缩小、整页
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,[contenteditable]')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (canDrive && !mod && ['ArrowRight', 'PageDown', 'ArrowDown'].includes(e.key)) st.setShared({ pgm: stepView(st.pgmMat, st.pgm, 1), selectedInk: null });
      if (canDrive && !mod && ['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) st.setShared({ pgm: stepView(st.pgmMat, st.pgm, -1), selectedInk: null });
      if (canDrive && mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.4); }
      if (canDrive && mod && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.4); }
      if (canDrive && mod && e.key === '0') { e.preventDefault(); resetZoom(); }
      if (mod && e.key === 'z') st.undo(inkKey(st.pgm.materialId, st.pgm.page), who);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [who, canDrive]);

  const studentLocked = studentTools !== 'open' || who !== 'student';
  const activeTool = who === 'teacher' ? tool : studentLocked ? 'pointer' : sTool;

  return (
    <div className={'sw' + (flash ? ' take' : '')}>
      <div className="sw-stage" style={eye ? { filter: `sepia(${eye * 0.45}) saturate(${1 - eye * 0.25}) brightness(${1 - eye * 0.14})` } : undefined}>
        <Desk
          author={who}
          tool={activeTool}
          color={who === 'teacher' ? color : 'student'}
          size={who === 'teacher' ? size : sSize}
          canArrange={canDrive}
          onWheel={canDrive ? deskWheel : undefined}
        />
      </div>

      {studentTools !== 'hidden' && <DeskRail canArrange={canDrive} />}
      {studentTools !== 'hidden' && <PagePanel canPage={canDrive} />}

      {studentTools !== 'hidden' && (
        <StudentBar locked={studentTools !== 'open'} writing={who === 'student'} tool={sTool} size={sSize} onTool={setSTool} onSize={setSSize} />
      )}

      {/* 立体演示自带标题和底部字幕，底部的课件名会压在字幕上 */}
      {!mat.s3d && <div className={'sw-foot' + (studentTools !== 'hidden' ? ' center' : '')}>
        <span>{mat.title}</span>
        {studentTools === 'hidden' && <b className="num">{pageLabel(mat, pgm)}</b>}
      </div>}
      {studentTools !== 'hidden' && <ZoomBar canPage={canDrive} />}
    </div>
  );
}
