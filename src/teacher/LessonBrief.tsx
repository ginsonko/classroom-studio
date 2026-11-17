// 1.7.0 课前一键看：「上节课讲了什么」（AI 分析时写的一句话，没有就用课后总结第一句）+「这节课讲什么」（备课一句话）。
// 导播台学生卡、课前横幅、课表里这节课的详情都用它；点开看详细（课后总结全文、备课建议和文件）。
import { useState } from 'react';
import { BookOpenCheck, ChevronDown, History } from 'lucide-react';
import { useStudy } from '../lib/studyStore';
import { lessonBrief } from '../lib/prepRecord';
import { oneLineOf } from '../lib/parentReport';
import { dayKey } from '../lib/studyActions';
import { MdText } from './TexText';
import { FileChip } from '../ui/FileChip';
import '../styles/brief.css';

export function LessonBrief({ studentId, date = dayKey(), compact }: { studentId: string; date?: string; compact?: boolean }) {
  const data = useStudy((s) => s.data);
  const [open, setOpen] = useState(false);
  const b = lessonBrief(studentId, data, date, oneLineOf);
  if (!b.last && !b.prep) return compact ? null : <div className="lbrief empty" data-qa="lesson-brief">还没有上节课总结和这节课的备课。让小羽备课、下课写总结后，这里会一句话告诉你。</div>;
  const lesson = b.last ? data.lessons.find((l) => l.id === b.last!.id) : undefined, prep = b.prep ? data.preps.find((p) => p.id === b.prep!.id) : undefined;
  return <div className={'lbrief' + (compact ? ' compact' : '')} data-qa="lesson-brief">
    <button className="lbrief-h" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="lbrief-rows">
        {b.last && <span className="lbrief-r" data-qa="brief-last"><History size={12} /><i>上节 {b.last.date.slice(5).replace('-', '/')}</i><b>{b.last.line}</b></span>}
        {b.prep && <span className="lbrief-r" data-qa="brief-prep"><BookOpenCheck size={12} /><i>这节备课</i><b>{b.prep.line}</b></span>}
      </span>
      <ChevronDown size={13} className={open ? 'open' : ''} />
    </button>
    {open && <div className="lbrief-body">
      {lesson && <section><h5>上节课 · {lesson.date} {lesson.topic}</h5><MdText text={lesson.summary} className="lbrief-md" />{!!lesson.next.length && <p className="lbrief-note">下一步：{lesson.next.join('；')}</p>}</section>}
      {prep && <section><h5>这节课 · {prep.date} {prep.topic}</h5>{prep.summary && <p className="lbrief-note">{prep.summary}</p>}{[...prep.files, ...(prep.courseware ?? [])].slice(0, 6).map((f) => <FileChip key={f} path={f} />)}{prep.plan && <details><summary>备课建议</summary><MdText text={prep.plan.slice(0, 3000)} className="lbrief-md" /></details>}</section>}
    </div>}
  </div>;
}
