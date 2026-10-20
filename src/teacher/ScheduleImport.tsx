import { useMemo, useState } from 'react';
import { FileUp, ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { host } from '../lib/host';
import type { LessonSlot, Student } from '../lib/types';
import { dateKey, localDate, monday } from '../doc/scheduleModel';
import { NEW, planImport, rowsOf, whenText, type ImportRow, type RowState } from '../doc/scheduleImport';
import { readLessons, readSource, type ReadOut } from '../lib/scheduleAi';

export interface ImportUndo { students: Student[]; slots: LessonSlot[] }

const fileData = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('图片读不出来')); r.readAsDataURL(f); });

/** 导入课表：选文件 / 粘贴文字或截图 → AI（或规则）识别 → 预览（对学生、看冲突）→ 合并或替换 */
export function ScheduleImport({ onClose, onDone }: { onClose: () => void; onDone: (undo: ImportUndo, message: string) => void }) {
  const students = useStore((s) => s.students), slots = useStore((s) => s.slots);
  const [text, setText] = useState(''), [image, setImage] = useState(''), [file, setFile] = useState('');
  const [from, setFrom] = useState(() => dateKey(monday(new Date())));
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [read, setRead] = useState<ReadOut | null>(null), [rows, setRows] = useState<ImportRow[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge'), [onConflict, setOnConflict] = useState<'keep' | 'replace'>('keep');
  const [over, setOver] = useState(false);
  const names = students.filter((s) => !s.archived).map((s) => s.name);

  const load = async (path: string) => {
    setError(''); setBusy('读取文件…');
    try { const src = await readSource(path, setBusy); setFile(src.name); setText(src.text); setImage(src.image); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  const pick = async () => { const p = await host.call<string | null>('study.pickSchedule').catch((e) => { setError(e.message); return null; }); if (p) await load(p); };
  const paste = async (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); setImage(await fileData(f)); setFile('粘贴的截图'); return; }
    if (!e.clipboardData.getData('text/plain')) {
      const img = await host.call<string | null>('clipboardImage').catch(() => null);
      if (img) { e.preventDefault(); setImage(img); setFile('粘贴的截图'); }
    }
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0], p = f && host.pathForFile(f);
    if (p) void load(p);
  };
  const recognize = async () => {
    if (!text.trim() && !image) { setError('先选一个课表文件，或者把课表文字 / 截图粘贴进来'); return; }
    setError(''); setBusy('识别中…');
    try {
      const r = await readLessons({ text, image }, names, new Date(), setBusy);
      if (!r.lessons.length) { setError(r.note || '没有读出课。课表里需要有星期（或日期）、时间段和学生名'); setRead(null); return; }
      setRead(r); setRows(rowsOf(r.lessons, students));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const fromDate = localDate(from);
  const plan = useMemo(() => rows.length ? planImport({ rows, students, slots, mode, onConflict, from: fromDate, today: new Date(), newId: () => 'preview' + Math.random() }) : null, [rows, students, slots, mode, onConflict, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (id: string, p: Partial<ImportRow>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? '?';
  const stateText = (s: RowState | undefined): [string, string] => {
    if (!s) return ['', ''];
    switch (s.kind) {
      case 'add': return ['add', '新增'];
      case 'replace': return ['swap', '替换 ' + s.slots.map((x) => `${nameOf(x.studentId)}·${x.topic}`).join('、')];
      case 'conflict': return ['skip', `和「${nameOf(s.slots[0].studentId)}·${s.slots[0].topic}」时间重叠，跳过`];
      case 'clash': return ['skip', `和导入的「${s.with}」重叠，跳过`];
      case 'invalid': return ['bad', s.why];
      default: return ['off', '不导入'];
    }
  };
  const commit = () => {
    const st = useStore.getState(), undo = { students: st.students, slots: st.slots };
    const p = planImport({ rows, students: st.students, slots: st.slots, mode, onConflict, from: fromDate, today: new Date() });
    if (!p.added) { setError('没有可以导入的课'); return; }
    st.set({ students: p.students, slots: p.slots });
    const gone = p.replaced.length + p.removed.length;
    onDone(undo, `已导入 ${p.added} 节课` + (p.created.length ? `，新建学生 ${p.created.map((s) => s.name).join('、')}` : '') + (gone ? `，替换掉原来的 ${gone} 节` : ''));
  };

  const pickStudents = (r: ImportRow) => students.filter((s) => !s.archived || s.id === r.studentId);
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <div className="record-editor sch-import" onPaste={(e) => void paste(e)} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div className="card-h"><b>导入课表</b><span className="flex" /><button type="button" onClick={onClose} disabled={!!busy} aria-label="关闭导入课表"><X size={16} /></button></div>
      {!plan ? <>
        <div className={'si-src' + (over ? ' over' : '')}>
          <button type="button" className="btn-cue" onClick={() => void pick()} disabled={!!busy}><FileUp size={14} />选择课表文件</button>
          <span>Excel、Word、PDF、图片、文字都可以；也可以把文件拖进来，或者直接粘贴课表截图（Ctrl+V）</span>
        </div>
        {image ? <div className="si-img"><img src={image} alt="课表截图" /><div><b><ImageIcon size={13} />{file}</b><button type="button" onClick={() => { setImage(''); setFile(''); }}>换一个</button></div></div>
          : <label>{file ? `从「${file}」读到的内容（可以修改）` : '或者把课表文字粘贴在这里'}<textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={'例如：\n周一 19:00-20:30 俊宇 电磁感应\n周三 18:30-20:00 欣怡 函数\n10月25日 14:00-16:00 子轩（单次课）\n\n从 Excel 复制整张表格粘贴进来也可以'} /></label>}
        <label>每周的课从哪天开始<input type="date" value={from} onChange={(e) => setFrom(e.target.value || dateKey(monday(new Date())))} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="record-actions"><button type="button" onClick={onClose} disabled={!!busy}>取消</button><button className="btn-cue" type="button" onClick={() => void recognize()} disabled={!!busy || (!text.trim() && !image)}>{busy ? <Loader2 size={14} className="ags-spin" /> : <Sparkles size={14} />}{busy || '识别课表'}</button></div>
      </> : <>
        <div className="si-meta">读出 <b className="num">{rows.length}</b> 节{read?.via === 'ai' ? `（AI 识别${read.model ? ' · ' + read.model : ''}）` : '（按规则识别）'}{read?.dropped ? `，另有 ${read.dropped} 条看不懂已略过` : ''}。请核对学生和时间，没问题再导入。{read?.note && <em>{read.note}</em>}</div>
        <div className="si-opts">
          <div className="seg"><button type="button" className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>合并到现有课表</button><button type="button" className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>替换这些学生的课表</button></div>
          <label className="record-check"><input type="checkbox" checked={onConflict === 'replace'} onChange={(e) => setOnConflict(e.target.checked ? 'replace' : 'keep')} />和别的课时间重叠时，改用导入的</label>
        </div>
        <div className="si-table" role="table">
          <div className="si-row si-head" role="row"><span /><span>学生</span><span>时间</span><span>内容</span><span>每周</span><span>结果</span></div>
          {rows.map((r) => {
            const [cls, label] = stateText(plan.states[r.id]);
            return <div key={r.id} className={'si-row ' + cls} role="row">
              <input type="checkbox" checked={r.use} onChange={(e) => setRow(r.id, { use: e.target.checked })} aria-label="导入这一节" />
              <select value={r.studentId} onChange={(e) => setRow(r.id, { studentId: e.target.value })}>
                <option value={NEW}>新建「{r.lesson.student}」</option>
                {pickStudents(r).map((s) => <option key={s.id} value={s.id}>{s.name}{s.archived ? '（已归档）' : ''}</option>)}
              </select>
              <span className="num">{whenText(r.lesson)}</span>
              <input value={r.lesson.topic} placeholder="一对一课程" maxLength={120} onChange={(e) => setRow(r.id, { lesson: { ...r.lesson, topic: e.target.value } })} />
              <input type="checkbox" checked={r.lesson.repeat} onChange={(e) => setRow(r.id, { lesson: { ...r.lesson, repeat: e.target.checked, date: e.target.checked ? '' : r.lesson.date || dateKey(new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + (r.lesson.day - (fromDate.getDay() + 6) % 7 + 7) % 7)) } })} aria-label="每周重复" />
              <em title={label}>{label}</em>
            </div>;
          })}
        </div>
        <div className="si-sum">将新增 <b className="num">{plan.added}</b> 节{plan.created.length ? `，新建学生 ${plan.created.map((s) => s.name).join('、')}` : ''}{plan.replaced.length + plan.removed.length ? `，去掉原来的 ${plan.replaced.length + plan.removed.length} 节` : ''}。导入后可以在课表上拖动调整，也可以撤销。</div>
        {error && <p role="alert">{error}</p>}
        <div className="record-actions"><button type="button" onClick={() => { setRows([]); setRead(null); setError(''); }}>返回修改</button><button type="button" onClick={onClose}>取消</button><button className="btn-cue" type="button" disabled={!plan.added} onClick={commit}>导入 {plan.added} 节课</button></div>
      </>}
    </div>
  </div>;
}
