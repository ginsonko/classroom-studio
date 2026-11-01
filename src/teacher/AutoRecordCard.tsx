import { CircleDot, Clock3, SkipForward, Video } from 'lucide-react';
import { useStore } from '../lib/store';
import { cardAdhoc, cardExtend, cardForCurrent, cardSkip, cardStartNow, cardStopNow, useAutoRecord } from '../lib/autoRecordRun';
import '../styles/autorecord.css';

const left = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} 秒`; };
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const label = (l: { name: string; topic: string }) => l.name + (l.topic ? ' · ' + l.topic : '');

/** 录像自动开关的卡片：只在教师窗口里，学生画面和会议共享里看不到 */
export function AutoRecordCard() {
  const card = useAutoRecord((s) => s.card), now = useAutoRecord((s) => s.now);
  const current = useStore((s) => s.students.find((x) => x.id === s.studentId));
  if (!card) return null;
  if (card.kind === 'start') {
    const l = card.lesson, other = current && current.id !== l.studentId;
    return <div className="arc" role="alertdialog" data-qa="autorec-card" data-kind="start">
      <CircleDot size={18} className="arc-ico rec" />
      <div className="arc-main">
        <b><span className="num">{left(card.deadline - now)}</span>后开始为「{label(l)}」录像</b>
        <span>{card.late ? `这节课 ${hm(l.start)} 已经开始了，现在补上录像。` : `课表上 ${hm(l.start)}–${hm(l.end)}。`}和点「开始上课」一样：换学生时会先清空课堂。</span>
        <div className="arc-acts">
          <button className="go" data-qa="autorec-now" onClick={cardStartNow}>现在开始</button>
          <button data-qa="autorec-skip" onClick={cardSkip}>这节不录</button>
          {other && <button data-qa="autorec-current" onClick={cardForCurrent}>改成给「{current.name}」录</button>}
        </div>
      </div>
    </div>;
  }
  if (card.kind === 'next') return <div className="arc" role="alertdialog" data-qa="autorec-card" data-kind="next">
    <SkipForward size={18} className="arc-ico" />
    <div className="arc-main">
      <b>连堂：<span className="num">{left(card.deadline - now)}</span>后保存这一节，开始录「{label(card.lesson)}」</b>
      <span>{card.from ? `「${card.from.name}」的录像先保存，` : ''}学生窗口和会议共享不用动。</span>
      <div className="arc-acts">
        <button className="go" data-qa="autorec-now" onClick={cardStartNow}>现在换</button>
        <button data-qa="autorec-skip" onClick={cardSkip}>{card.from ? `接着录「${card.from.name}」` : '这节不录'}</button>
      </div>
    </div>
  </div>;
  if (card.kind === 'stop') return <div className="arc warn" role="alertdialog" data-qa="autorec-card" data-kind="stop">
    <Clock3 size={18} className="arc-ico" />
    <div className="arc-main">
      <b><span className="num">{left(card.deadline - now)}</span>后自动下课并保存录像</b>
      <span>{card.reason === 'idle' ? '已经很久没有声音，学生画面上也没有操作。' : card.lesson ? `「${card.lesson.name}」这节课 ${hm(card.lesson.end)} 就下课了。` : '已经过了下课时间。'}</span>
      <div className="arc-acts">
        <button className="go" data-qa="autorec-extend" onClick={cardExtend}>{card.reason === 'idle' ? '还在上课' : '再录 15 分钟'}</button>
        <button data-qa="autorec-stop" onClick={cardStopNow}>现在下课</button>
      </div>
    </div>
  </div>;
  return <div className="arc" role="alertdialog" data-qa="autorec-card" data-kind="adhoc">
    <Video size={18} className="arc-ico" />
    <div className="arc-main">
      <b>要录下这节课吗？</b>
      <span>学生画面上已经写了一会儿了，课表上这会儿没有课。</span>
      <div className="arc-acts">
        <button className="go" data-qa="autorec-adhoc-start" onClick={() => cardAdhoc(true)}>开始录像</button>
        <button data-qa="autorec-adhoc-no" onClick={() => cardAdhoc(false)}>不用</button>
      </div>
    </div>
  </div>;
}
