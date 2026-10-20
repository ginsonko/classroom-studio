import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../lib/store';
import { byLevel, LEVEL_NAME, LEVELS, packOf } from '../lib/subjects';
import { AnchoredPopup } from './ToolPalette';
import '../styles/subject.css';

/** 当前学科标签：形状菜单、绘图库默认分类、演示都跟着它。浮层和导播台顶栏都能切。 */
export function SubjectPicker({ className = '', vertical, compact }: { className?: string; vertical?: boolean; compact?: boolean }) {
  const subject = useStore((s) => s.subject);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const pack = packOf(subject);
  return <>
    <button ref={ref} className={'subj-tag ' + className + (open ? ' on' : '')} onClick={() => setOpen(!open)} aria-label={'当前学科：' + pack.stage} data-tip={'当前学科：' + pack.stage + ' · 点击切换（形状菜单、绘图库跟着变）'}>
      <span>{compact ? pack.name.slice(0, 2) : pack.stage}</span><ChevronDown size={11} />
    </button>
    {open && <AnchoredPopup anchor={ref.current} vertical={vertical} onClose={() => setOpen(false)}>
      <div className="subj-pop" role="dialog" aria-label="切换学科">
        <header><b>这节课的学科</b><span>形状菜单、绘图库、演示跟着变</span></header>
        {LEVELS.map((l) => <div key={l} className="subj-level"><i>{LEVEL_NAME[l]}</i><div>{byLevel(l).map((p) => <button key={p.id} className={p.id === subject ? 'on' : ''} onClick={() => { useStore.getState().setShared({ subject: p.id }); setOpen(false); }}>{p.name}</button>)}</div></div>)}
        <footer>不绑学生时会记住这里的选择；换到某个学生时，按他档案里的学科。</footer>
      </div>
    </AnchoredPopup>}
  </>;
}
