// 1.7.0 学生窗口（会议里共享的那个）右上角：小小的「开始上课 / 下课」按钮和课堂计时，到点时一个「要开始上课吗？」小提示。
// 学生能看到这个窗口，所以做得小、半透明、不挡课件；按钮只是请教师窗口去做（会议里的学生点不到老师电脑上的鼠标）。
// 浮层（dock）里也用它显示计时。状态来自教师窗口发布的 classBar。
import { useEffect, useState } from 'react';
import { Circle, Clock3, Square } from 'lucide-react';
import { useStore } from '../lib/store';
import { bus } from '../lib/bus';
import '../styles/classcorner.css';

export const clockText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
};
const send = (act: 'start' | 'stop' | 'later' | 'skip') => bus.post({ t: 'class', act });

/** 每秒走一次的课堂计时（since=0 时不走） */
export function useClassClock(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!since) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [since]);
  return since ? clockText(now - since) : '';
}

export function ClassCorner({ where = 'stage' }: { where?: 'stage' | 'dock' }) {
  const bar = useStore((s) => s.classBar);
  const live = bar?.phase === 'recording', busy = bar?.phase === 'starting' || bar?.phase === 'stopping';
  const clock = useClassClock(live ? bar!.since : 0);
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  if (!bar) return null;
  // 浮层只显示计时（浮层本身只有老师看得到，按钮在顶栏和学生窗口里已经有了）
  if (where === 'dock') return live ? <span className="cc-dock num" data-qa="dock-class-clock" data-tip="课堂计时"><i />{clock}</span> : null;
  if (!bar.show && !bar.ask) return null;
  return <div className="cc" data-qa="class-corner" data-live={live ? '1' : '0'}>
    {bar.show && <div className={'cc-pill' + (live ? ' live' : '')}>
      {live && <span className="cc-clock num" data-qa="class-clock"><i />{clock}</span>}
      {busy ? <span className="cc-busy">{bar.phase === 'starting' ? '准备中…' : '保存中…'}</span>
        : live ? <button className={'cc-b' + (sure ? ' sure' : '')} data-qa="class-stop" onClick={() => { if (sure) { setSure(false); send('stop'); } else setSure(true); }} aria-label="下课">{sure ? '再点一次下课' : <><Square size={9} fill="currentColor" />下课</>}</button>
          : <button className="cc-b" data-qa="class-start" onClick={() => send('start')} aria-label="开始上课"><Circle size={9} fill="currentColor" />上课</button>}
    </div>}
    {bar.ask && !live && <div className="cc-ask" role="alertdialog" data-qa="class-ask">
      <Clock3 size={13} /><span>{bar.ask.next ? `换到「${bar.ask.name}」这节课？` : `「${bar.ask.name}」${bar.ask.late ? '已经' : ''}到上课时间了，开始上课？`}</span>
      <button className="go" data-qa="class-ask-start" onClick={() => send('start')}>开始</button>
      <button data-qa="class-ask-later" onClick={() => send('later')}>5 分钟后</button>
    </div>}
    {bar.ask && live && bar.ask.next && <div className="cc-ask" role="alertdialog" data-qa="class-ask">
      <Clock3 size={13} /><span>换到「{bar.ask.name}」这节课？</span>
      <button className="go" data-qa="class-ask-start" onClick={() => send('start')}>换</button>
      <button data-qa="class-ask-later" onClick={() => send('later')}>5 分钟后</button>
    </div>}
  </div>;
}
