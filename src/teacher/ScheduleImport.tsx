import { useMemo, useState } from 'react';
import { FileText, FileUp, ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { host } from '../lib/host';
import type { LessonSlot, Student } from '../lib/types';
import { dateKey, localDate, monday } from '../doc/scheduleModel';
import { NEW, combineSources, createdText, flipHalf, isClassName, planImport, rowsOf, whenText, type ImportRow, type RowState } from '../doc/scheduleImport';
import { splitNames, whoText } from '../lib/groups';
import { readLessons, readSource, type ReadOut, type Source } from '../lib/scheduleAi';

export interface ImportUndo { students: Student[]; slots: LessonSlot[] }
interface Src extends Source { id: string; open?: boolean }
interface FileResult { name: string; count: number; why?: string }

const MAX_FILES = 12;
const fileData = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('图片读不出来')); r.readAsDataURL(f); });
const sid = () => Math.random().toString(36).slice(2, 10);

/** 导入课表：选文件（可以一次选好几个）/ 拖进来 / 粘贴文字或截图 → AI（或规则）逐个识别 → 合在一起预览 → 合并或替换，一次撤销 */
export function ScheduleImport({ onClose, onDone }: { onClose: () => void; onDone: (undo: ImportUndo, message: string) => void }) {
  const students = useStore((s) => s.students), slots = useStore((s) => s.slots);
  const [files, setFiles] = useState<Src[]>([]), [text, setText] = useState('');
  const [from, setFrom] = useState(() => dateKey(monday(new Date())));
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [read, setRead] = useState<(ReadOut & { per: FileResult[] }) | null>(null), [rows, setRows] = useState<ImportRow[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge'), [onConflict, setOnConflict] = useState<'keep' | 'replace'>('keep');
  const [over, setOver] = useState(false);
  const names = students.filter((s) => !s.archived).map((s) => s.name);

  const add = (list: Src[]) => {
    if (files.length + list.length > MAX_FILES) setError(`一次最多导入 ${MAX_FILES} 份课表，多出来的先没加`);
    setFiles((old) => {
      const next = [...old];
      for (const f of list) if (!next.some((x) => x.name === f.name && x.text === f.text && x.image === f.image)) next.push(f);
      return next.slice(0, MAX_FILES);
    });
  };
  const load = async (paths: string[]) => {
    setError('');
    const got: Src[] = [], bad: string[] = [];
    for (const [i, p] of paths.slice(0, MAX_FILES).entries()) {
      const tag = paths.length > 1 ? `读取 ${i + 1}/${paths.length}：` : '';
      setBusy(tag || '读取文件…');
      try { got.push({ ...(await readSource(p, (t) => setBusy(tag ? tag + t.replace(/^读取：/, '') : t))), id: sid() }); }
      catch (e) { bad.push(`「${p.split(/[\\/]/).pop()}」${(e as Error).message}`); }
    }
    add(got); setBusy('');
    if (bad.length) setError(bad.join('\n'));
  };
  const pick = async () => {
    const p = await host.call<string[] | string | null>('study.pickSchedule').catch((e) => { setError(e.message); return null; });
    const list = Array.isArray(p) ? p : p ? [p] : [];
    if (list.length) await load(list);
  };
  const shots = (n: number) => files.filter((f) => f.image).length + n + 1;
  const paste = async (e: React.ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((x) => x.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); add(await Promise.all(imgs.map(async (f, i) => ({ id: sid(), name: '粘贴的截图 ' + shots(i), text: '', image: await fileData(f) })))); return; }
    if (!e.clipboardData.getData('text/plain')) {
      const img = await host.call<string | null>('clipboardImage').catch(() => null);
      if (img) { e.preventDefault(); add([{ id: sid(), name: '粘贴的截图 ' + shots(0), text: '', image: img }]); }
    }
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter(Boolean) as string[];
    if (paths.length) void load(paths);
  };
  const editFile = (id: string, p: Partial<Src>) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const sources: Source[] = [...files, ...(text.trim() ? [{ name: files.length ? '粘贴的文字' : '课表文字', text, image: '' }] : [])];
  const recognize = async () => {
    if (!sources.length) { setError('先选课表文件，或者把课表文字 / 截图粘贴进来'); return; }
    setError('');
    const per: FileResult[] = [], got: { name: string; lessons: ReadOut['lessons'] }[] = [], notes = new Set<string>();
    let dropped = 0, via: ReadOut['via'] = 'rules', model: string | undefined;
    for (const [i, src] of sources.entries()) {
      const tag = sources.length > 1 ? `识别 ${i + 1}/${sources.length}：${src.name} · ` : '';
      setBusy(tag + '识别中…');
      try {
        const r = await readLessons(src, names, new Date(), (t) => setBusy(tag + t));
        if (r.via === 'ai') { via = 'ai'; model ??= r.model; }
        dropped += r.dropped; if (r.note) notes.add(r.note);
        per.push({ name: src.name, count: r.lessons.length, ...(r.lessons.length ? {} : { why: r.note || '没读出课' }) });
        got.push({ name: src.name, lessons: r.lessons });
      } catch (e) { per.push({ name: src.name, count: 0, why: (e as Error).message }); }
    }
    setBusy('');
    const lessons = sources.length > 1 ? combineSources(got) : got[0]?.lessons ?? [];
    if (!lessons.length) {
      setError(sources.length > 1 ? per.map((p) => `「${p.name}」${p.why ?? '没读出课'}`).join('\n') : per[0]?.why || '没有读出课。课表里需要有星期（或日期）、时间段和学生名');
      setRead(null); return;
    }
    setRead({ lessons, dropped, via, model, note: [...notes].join(' '), per }); setRows(rowsOf(lessons, students));
  };

  const fromDate = localDate(from);
  const plan = useMemo(() => rows.length ? planImport({ rows, students, slots, mode, onConflict, from: fromDate, today: new Date(), newId: () => 'preview' + Math.random() }) : null, [rows, students, slots, mode, onConflict, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (id: string, p: Partial<ImportRow>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const unsure = rows.filter((r) => r.lesson.guess && !r.sure);
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
    const gone = p.replaced.length + p.removed.length, n = read?.per.filter((x) => x.count).length ?? 1;
    onDone(undo, `已导入 ${p.added} 节课` + (n > 1 ? `（来自 ${n} 份课表）` : '') + (p.created.length ? '，' + createdText(p.created) : '') + (gone ? `，替换掉原来的 ${gone} 节` : ''));
  };

  const pickStudents = (r: ImportRow) => students.filter((s) => !s.archived || s.id === r.studentId);
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <div className="record-editor sch-import" onPaste={(e) => void paste(e)} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div className="card-h"><b>导入课表</b><span className="flex" /><button type="button" onClick={onClose} disabled={!!busy} aria-label="关闭导入课表"><X size={16} /></button></div>
      {!plan ? <>
        <div className={'si-src' + (over ? ' over' : '')}>
          <button type="button" className="btn-cue" onClick={() => void pick()} disabled={!!busy}><FileUp size={14} />选择课表文件</button>
          <span>Excel、Word、PDF、图片、文字都可以，<b>一次可以选好几个</b>；也可以把文件拖进来，或者直接粘贴课表截图（Ctrl+V）</span>
        </div>
        {!!files.length && <div className="si-files">
          {files.map((f) => <div key={f.id} className="si-file">
            <div className="si-file-h">
              {f.image ? <img src={f.image} alt={f.name} /> : <FileText size={15} />}
              <b title={f.name}>{f.image ? <ImageIcon size={12} /> : null}{f.name}</b>
              <span>{f.image ? '截图 · 交给 AI 看图' : `${f.text.length} 字`}</span>
              <span className="flex" />
              {!f.image && <button type="button" onClick={() => editFile(f.id, { open: !f.open })}>{f.open ? '收起' : '查看 / 修改'}</button>}
              <button type="button" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))} disabled={!!busy} aria-label={'移除 ' + f.name}><X size={13} /></button>
            </div>
            {f.open && <textarea value={f.text} onChange={(e) => editFile(f.id, { text: e.target.value })} rows={7} aria-label={`从「${f.name}」读到的内容`} />}
            {f.image && files.length === 1 && <div className="si-img"><img src={f.image} alt="课表截图" /></div>}
          </div>)}
        </div>}
        <label>{files.length ? '再补充一些课表文字（可以不填）' : '或者把课表文字粘贴在这里'}<textarea value={text} onChange={(e) => setText(e.target.value)} rows={files.length ? 3 : 9} placeholder={'例如：\n周一 19:00-20:30 俊宇 电磁感应\n周三 18:30-20:00 欣怡 函数\n周四 19:00-20:30 俊宇、欣怡（一对二）\n10月25日 14:00-16:00 子轩（单次课）\n周五 23:00-01:00 浩然（过了午夜的课照写）\n\n从 Excel 复制整张表格粘贴进来也可以'} /></label>
        <label>每周的课从哪天开始<input type="date" value={from} onChange={(e) => setFrom(e.target.value || dateKey(monday(new Date())))} /></label>
        {error && <p role="alert" className="si-err">{error}</p>}
        <div className="record-actions"><button type="button" onClick={onClose} disabled={!!busy}>取消</button><button className="btn-cue" type="button" onClick={() => void recognize()} disabled={!!busy || !sources.length}>{busy ? <Loader2 size={14} className="ags-spin" /> : <Sparkles size={14} />}{busy || (sources.length > 1 ? `识别 ${sources.length} 份课表` : '识别课表')}</button></div>
      </> : <>
        <div className="si-meta">读出 <b className="num">{rows.length}</b> 节{read?.via === 'ai' ? `（AI 识别${read.model ? ' · ' + read.model : ''}）` : '（按规则识别）'}{read?.dropped ? `，另有 ${read.dropped} 条看不懂已略过` : ''}。请核对学生和时间，没问题再导入。
          {read && read.per.length > 1 && <span className="si-per">来自 {read.per.length} 份课表：{read.per.map((p) => `${p.name} ${p.count ? p.count + ' 节' : '（' + (p.why ?? '没读出课') + '）'}`).join('、')}；几份里重复写的同一节只算一次。</span>}
          {read?.note && <em>{read.note}</em>}
          {!!unsure.length && <em className="si-guess-note">有 {unsure.length} 节课表上没写上下午，先按下午 / 晚上排了（标黄的），不对的点「改成上午」。{unsure.length > 1 && <button type="button" onClick={() => setRows((l) => l.map((r) => (r.lesson.guess && !r.sure ? { ...r, lesson: r.lesson.start >= 12 ? flipHalf(r.lesson) : r.lesson, sure: true } : r)))}>这几节都改成上午</button>}</em>}
        </div>
        <div className="si-opts">
          <div className="seg"><button type="button" className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>合并到现有课表</button><button type="button" className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>替换这些学生的课表</button></div>
          <label className="record-check"><input type="checkbox" checked={onConflict === 'replace'} onChange={(e) => setOnConflict(e.target.checked ? 'replace' : 'keep')} />和别的课时间重叠时，改用导入的</label>
        </div>
        <div className="si-table" role="table">
          <div className="si-row si-head" role="row"><span /><span>学生</span><span>时间</span><span>内容</span><span>每周</span><span>结果</span></div>
          {rows.map((r) => {
            const [cls, label] = stateText(plan.states[r.id]);
            return <div key={r.id} className={'si-row ' + cls + (r.lesson.guess && !r.sure ? ' guess' : '')} role="row" title={r.lesson.from ? '来自 ' + r.lesson.from : undefined}>
              <input type="checkbox" checked={r.use} onChange={(e) => setRow(r.id, { use: e.target.checked })} aria-label="导入这一节" />
              <select value={r.studentId} onChange={(e) => setRow(r.id, { studentId: e.target.value })}>
                <option value={NEW}>{splitNames(r.lesson.student).length > 1 || isClassName(r.lesson.student) ? '新建班组' : '新建'}「{r.lesson.student}」</option>
                {pickStudents(r).map((s) => <option key={s.id} value={s.id}>{whoText(s, students)}{s.archived ? '（已归档）' : ''}</option>)}
              </select>
              <div className="si-when"><span className="num">{whenText(r.lesson)}</span>
                {r.lesson.guess && (r.lesson.start >= 12 || r.lesson.start + 12 < 24) && <button type="button" className="si-half" title="课表上没写上下午" onClick={() => setRow(r.id, { lesson: flipHalf(r.lesson), sure: true })}>{r.lesson.start >= 12 ? '改成上午' : '改成下午'}</button>}
              </div>
              <input value={r.lesson.topic} placeholder="一对一课程" maxLength={120} onChange={(e) => setRow(r.id, { lesson: { ...r.lesson, topic: e.target.value } })} />
              <input type="checkbox" checked={r.lesson.repeat} onChange={(e) => setRow(r.id, { lesson: { ...r.lesson, repeat: e.target.checked, date: e.target.checked ? '' : r.lesson.date || dateKey(new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + (r.lesson.day - (fromDate.getDay() + 6) % 7 + 7) % 7)) } })} aria-label="每周重复" />
              <em title={label}>{label}</em>
            </div>;
          })}
        </div>
        <div className="si-sum">将新增 <b className="num">{plan.added}</b> 节{plan.created.length ? '，' + createdText(plan.created) : ''}{plan.replaced.length + plan.removed.length ? `，去掉原来的 ${plan.replaced.length + plan.removed.length} 节` : ''}。导入后可以在课表上拖动调整，也可以一键撤销这次导入。</div>
        {error && <p role="alert" className="si-err">{error}</p>}
        <div className="record-actions"><button type="button" onClick={() => { setRows([]); setRead(null); setError(''); }}>返回修改</button><button type="button" onClick={onClose}>取消</button><button className="btn-cue" type="button" disabled={!plan.added} onClick={commit}>导入 {plan.added} 节课</button></div>
      </>}
    </div>
  </div>;
}
