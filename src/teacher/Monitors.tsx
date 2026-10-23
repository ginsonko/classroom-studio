import { useState } from 'react';
import { AppWindow, Columns2, Eye, EyeOff, MonitorUp, Plus, Radio, Scissors, ScrollText, X } from 'lucide-react';
import { isLong } from '../lib/longBoard';
import { longWheel } from '../stage/longNav';
import { useStore } from '../lib/store';
import { BASE, deskOrder, pageLabel } from '../lib/desk';
import { Desk } from '../stage/Desk';
import { readDroppedFiles, useLib } from '../lib/useLib';
import { openMaterial, reportMaterialError } from '../doc/actions';
import { Stage } from '../stage/Stage';
import { pasteToBoard, snipToBoard } from '../ink/pasteImage';

/** PGM：学生此刻看到的画面（矢量同源渲染，不是截图），老师也可以直接在上面写 */
export function PgmMonitor({ onOpenStudent }: { onOpenStudent: () => void }) {
  const pgm = useStore((s) => s.pgm);
  const mat = useStore((s) => s.pgmMat);
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const size = useStore((s) => s.size);
  const takeAt = useStore((s) => s.takeAt);
  const guard = useStore((s) => s.answerGuard !== false);
  const lib = useLib((s) => s.lib);
  const [over, setOver] = useState(false);

  return (
    <div
      className={'mon pgm' + (over ? ' drop' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const id = e.dataTransfer.getData('text/x-cs-file');
        const f = id && lib?.files.get(id);
        if (f) void openMaterial(f, 'student');
        else dropExternal(e, 'student');
      }}
    >
      <div className="mon-h">
        <span className="tally live"><Radio size={12} />学生正在看</span>
        <span className="mon-t" title={mat.title}>{mat.title}</span>
        {mat.kind !== 'board' && mat.kind !== 'sim' && mat.total > 1 && (
          <button className={'mon-ans' + (guard ? ' on' : '')} role="switch" aria-checked={guard}
            onClick={() => useStore.getState().setShared({ answerGuard: !guard })}
            data-tip={guard ? '答案页对学生遮住（点一下关闭）。在教师工具的页码里可以手动标记答案页' : '答案遮挡已关闭，学生能看到所有页（点一下打开）'}>
            {guard ? <EyeOff size={12} /> : <Eye size={12} />}
            {!guard ? '答案可见' : mat.answerPages === undefined ? '识别答案中' : `答案遮挡 · ${mat.answerPages.length} 页`}
          </button>
        )}
        <button className="mon-btn" onClick={onOpenStudent} data-tip="打开学生窗口（另一个标签页 / 屏幕）"><MonitorUp size={14} /></button>
      </div>
      <DeskTabs />
      <div className="mon-body" key={takeAt}>
        <Desk author="teacher" tool={tool} color={color} size={size} canArrange compact onWheel={longWheel} />
      </div>
      {over && <div className="drop-hint">松手 · 立刻展示给学生</div>}
    </div>
  );
}

/** 学生画面里打开着的各项：点一下切过去（回到上次那页），可以关、并排、再开一块黑板，设同时打开的上限 */
function DeskTabs() {
  const desk = useStore((s) => s.desk);
  const pgm = useStore((s) => s.pgm);
  const pgmMat = useStore((s) => s.pgmMat);
  const limit = useStore((s) => s.deskLimit);
  const st = () => useStore.getState();
  const list = deskOrder(desk.map((w) => (w.id === pgmMat.id ? { ...w, mat: pgmMat, view: pgm } : w)));
  const docs = desk.filter((w) => w.id !== BASE).length;
  const cur = desk.find((w) => w.id === pgmMat.id);
  return (
    <div className="dtabs-wrap">
    <div className="dtabs" role="tablist" aria-label="学生画面里打开的课件">
      {list.map((w) => (
        <button key={w.id} role="tab" aria-selected={w.id === pgmMat.id} className={'dtab' + (w.id === pgmMat.id ? ' cur' : '') + (w.mode === 'min' ? ' min' : '')}
          onClick={() => st().focusWin(w.id)} data-tip={w.mat.title + (!pageLabel(w.mat, w.view) ? '' : isLong(w.mat) ? ' · ' + pageLabel(w.mat, w.view) : ' · 第 ' + pageLabel(w.mat, w.view) + ' 页') + (w.mode === 'normal' ? ' · 窗口' : w.mode === 'min' ? ' · 已收起' : '')}>
          {w.mode === 'normal' && w.id !== BASE ? <AppWindow size={11} /> : null}
          <span>{w.mat.title}</span>
          {pageLabel(w.mat, w.view) && !isLong(w.mat) && <small className="num">{w.view.page + 1}</small>}
          {w.id !== BASE && <i className="x" role="button" aria-label={'关闭 ' + w.mat.title} onClick={(e) => { e.stopPropagation(); st().closeWin(w.id); }}><X size={10} /></i>}
        </button>
      ))}
    </div>
    <div className="dtabs-acts">
      <button className="dtabs-act" onClick={() => st().newBoard()} data-tip="再开一块空白黑板"><Plus size={12} />黑板</button>
      <button className="dtabs-act" data-guide="long-board" onClick={() => st().newLongBoard()} data-tip="长黑板：一整条往下写，滚轮 / 翻页键往下滚，写到底自动加长"><ScrollText size={12} />长黑板</button>
      <button className="dtabs-act" onClick={() => void snipToBoard().catch((e) => reportMaterialError(e, '截屏', 'student'))} data-tip="框选屏幕上任意区域贴到黑板。也可以用微信 / QQ 截图后直接 Ctrl+V"><Scissors size={12} />截屏</button>
      {cur && cur.id !== BASE && <button className="dtabs-act" onClick={() => st().setWin(cur.id, { mode: cur.mode === 'normal' ? 'max' : 'normal' })} data-tip="当前课件在「占满画面」和「浮在黑板上的窗口」之间切换"><AppWindow size={12} />{cur.mode === 'normal' ? '占满' : '窗口'}</button>}
      <button className="dtabs-act" disabled={docs < 2} onClick={() => st().tileWins()} data-tip={docs < 2 ? '打开两个以上课件后可以并排' : '当前课件和最近用过的课件并排（最多 4 个）'}><Columns2 size={12} />并排</button>
      <select className="dtabs-limit" value={limit} onChange={(e) => st().setShared({ deskLimit: Number(e.target.value) })} data-tip="学生画面最多同时打开几个课件（不含黑板），超过时自动关掉最久没用的">
        {[...new Set([5, 10, 15, 20, 30, limit])].filter((n) => n > 0).sort((a, b) => a - b).map((n) => <option key={n} value={n}>最多 {n} 个</option>)}
        <option value={0}>不限数量</option>
      </select>
    </div>
    </div>
  );
}

export function PvwMonitor() {
  const pvw = useStore((s) => s.pvw);
  const take = useStore((s) => s.take);
  const set = useStore((s) => s.set);
  const lib = useLib((s) => s.lib);
  const [over, setOver] = useState(false);
  return (
    <div
      className={'mon pvw' + (over ? ' drop' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const id = e.dataTransfer.getData('text/x-cs-file');
        const f = id && lib?.files.get(id);
        if (f) void openMaterial(f, 'cue');
        else dropExternal(e, 'cue');
      }}
    >
      <div className="mon-h">
        <span className="tally cue">预监</span>
        <span className="mon-t">{pvw ? pvw.mat.title : '下一项'}</span>
        {pvw && <button className="mon-btn" onClick={() => set({ pvw: null })} aria-label="清空预监"><X size={13} /></button>}
      </div>
      <div className="mon-body">
        {pvw ? (
          <Stage mat={pvw.mat} view={pvw.view} author="teacher" tool="pointer" color="ink" size={3} inkEnabled={false} boardFill overlays={false} />
        ) : (
          <div className="mon-empty">把课件拖到这里，或在阅读器点「放预监」<br />确认无误再按 <kbd>Enter</kbd> 切给学生</div>
        )}
      </div>
      <button className="take-btn" disabled={!pvw} onClick={take}>
        <span>切给学生</span><kbd>Enter</kbd>
      </button>
    </div>
  );
}

/** 从系统拖入图片 / 文件（微信、QQ、资源管理器） */
export function dropExternal(e: React.DragEvent, target: 'student' | 'cue' | 'teacher') {
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  // 拖到学生画面上的截图 / 图片：贴到黑板上（不占满画面，周围照样能写）
  if (target === 'student' && files.every((f) => /^image\/(png|jpeg|gif|webp|bmp)$/.test(f.type))) {
    void (async () => { for (const f of files.slice(0, 6)) await pasteToBoard(f); })().catch((err) => reportMaterialError(err, '贴图', target));
    return;
  }
  void openMaterial(readDroppedFiles(files).then((entries) => entries[0] ?? null), target).catch((e) => reportMaterialError(e, '拖入课件', target));
}
