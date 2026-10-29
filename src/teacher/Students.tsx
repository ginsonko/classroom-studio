import { useEffect, useMemo, useState } from 'react';
import { Archive, CirclePlay, FolderOpen, Plus, Search, Pencil, X, RotateCcw, Users, UsersRound } from 'lucide-react';
import { GROUP_KINDS, groupsOf, isGroup, kindFor, kindName, memberText, membersOf, makeGroup } from '../lib/groups';
import { LEVEL_NAME, LEVELS, SUBJECTS, byLevel, levelOfGrade, localOf, mapKey, packOf, pointKey, studentSubject, type SubjectId } from '../lib/subjects';
const GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];
import { useStore } from '../lib/store';
import type { ChapterState, Student } from '../lib/types';
import { host } from '../lib/host';
import { addRoot } from '../lib/useLib';
import { recordingMinutes, useRecordings } from '../doc/useRecordings';
import '../styles/doc.css';
import { ensureStudy, useStudy } from '../lib/studyStore';
import { mastery, suggestState } from '../lib/studyLogic';
import { Portrait } from './StudentPortrait';
import { StudentRecords } from './StudentRecords';
import { changeText, undoMapRun, useMapLog } from '../lib/mapUpdate';
import { ContactsSheet, useNotify } from './ParentSend';
import '../styles/study.css';

const STATE_NAME: Record<ChapterState, string> = { none: '未学', learning: '在学', done: '已掌握', weak: '薄弱' };
const CYCLE: ChapterState[] = ['none', 'learning', 'done', 'weak'];

export function Students() {
  const studentId = useStore((s) => s.studentId), students = useStore((s) => s.students), learning = useStore((s) => s.learning), set = useStore((s) => s.set);
  const [q, setQ] = useState(''), [archived, setArchived] = useState(false), [editing, setEditing] = useState<Student | 'new' | null>(null), [groupEdit, setGroupEdit] = useState<Student | 'new' | null>(null), [message, setMessage] = useState(''), [contacts, setContacts] = useState(false);
  const notify = useNotify((x) => x.v);
  useEffect(() => { void useNotify.getState().refresh(); }, []);
  // 联系方式表单只在打开时读一次数据，先刷新再打开，免得显示旧的
  const openContacts = () => void useNotify.getState().refresh().then(() => setContacts(true));
  const s = students.find((x) => x.id === studentId);
  const { recordings, error, reload } = useRecordings();
  const myGroups = useMemo(() => new Set(groupsOf(studentId, students).map((g) => g.id)), [studentId, students]);
  // 成员的档案里也能看到班组课的录像
  const records = recordings.filter((r) => r.studentId === studentId || (!!r.studentId && myGroups.has(r.studentId)));
  const shown = students.filter((x) => !!x.archived === archived && (x.name.includes(q) || (isGroup(x) && membersOf(x, students).some((m) => m.name.includes(q)))));
  const item = (x: Student) => <button key={x.id} className={'stu-i' + (x.id === studentId ? ' on' : '') + (isGroup(x) ? ' grp' : '')} onClick={() => set({ studentId: x.id })} style={{ ['--h' as string]: x.hue }}><span className="ava">{isGroup(x) ? <UsersRound size={15} /> : x.name.slice(-1)}</span><span><b>{x.name}<em className={'stu-sub f-' + packOf(studentSubject(x)).family} title={packOf(studentSubject(x)).stage}>{packOf(studentSubject(x)).stage}</em></b><i>{isGroup(x) ? `${kindName(x.kind)} · ${memberText(x, students, 2)}` : `${x.grade || '年级未填写'} · ${x.archived ? '已归档' : x.textbook || '个人学生'}`}</i></span></button>;
  const subject = studentSubject(s), pack = packOf(subject), chapters = pack.chapters;
  const map = useMemo(() => chapters.map((c, ci) => c.sec.map((_, si) => learning[mapKey(studentId, subject)]?.[ci]?.[si] ?? 'none')), [chapters, learning, studentId, subject]);
  const study = useStudy((x) => x.data);
  useEffect(ensureStudy, []);
  const ms = useMemo(() => mastery(studentId, study, subject), [studentId, study, subject]);
  const suggest = useMemo(() => [...ms.values()].map((m) => ({ m, st: suggestState(m) })).filter(({ m, st }) => { const at = localOf(m.key); return st && at && map[at.ci]?.[at.si] !== undefined && map[at.ci][at.si] !== st; }), [ms, map]);
  const applySuggest = () => {
    const current = useStore.getState(), key = mapKey(studentId, subject);
    const next = chapters.map((c, row) => c.sec.map((_, col) => current.learning[key]?.[row]?.[col] ?? 'none'));
    for (const { m, st } of suggest) { const at = localOf(m.key)!; next[at.ci][at.si] = st!; }
    set({ learning: { ...current.learning, [key]: next } });
    setMessage(`已按作答记录更新 ${suggest.length} 个知识点，可以继续手动点格子调整。`);
  };
  const lastRun = useMapLog((x) => x.runs.findLast((r) => r.studentId === studentId && !r.undone && r.changes.length > 0));
  const counts = map.flat().reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {} as Record<string, number>);
  const mark = (ci: number, si: number) => {
    const current = useStore.getState(), key = mapKey(studentId, subject);
    const next = chapters.map((c, row) => c.sec.map((_, col) => current.learning[key]?.[row]?.[col] ?? 'none'));
    next[ci][si] = CYCLE[(CYCLE.indexOf(next[ci][si]) + 1) % CYCLE.length];
    set({ learning: { ...current.learning, [key]: next } });
  };
  const toggleArchive = (st: Student) => {
    const current = useStore.getState();
    set({ students: current.students.map((x) => x.id === st.id ? { ...x, archived: !st.archived } : x) });
    setMessage(st.archived ? '学生已恢复。' : '学生已归档，资料和录像保留。可切换到归档列表恢复。');
  };

  return <div className="stu">
    <aside className="stu-list">
      <div className="lib-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="找学生" /></div>
      <div className="lib-tools"><button onClick={() => setArchived(!archived)}><Archive size={12} />{archived ? '查看在读学生' : '查看归档'}</button></div>
      {shown.filter((x) => !isGroup(x)).map(item)}
      {shown.some(isGroup) && <div className="stu-sec">班组 · 一对二 / 小组课 / 班课</div>}
      {shown.filter(isGroup).map(item)}
      <button className="stu-add" onClick={() => setEditing('new')}><Plus size={14} />添加学生</button>
      <button className="stu-add" onClick={() => setGroupEdit('new')} data-tip="一对二、小组课、班课：排课、上课、录像按班组；作答和课后总结落到每个人"><UsersRound size={14} />新建班组</button>
    </aside>
    {!s ? <div className="stu-main"><div className="lib-empty"><h2>开始建立你的学生档案</h2><p>姓名、课件目录和学习地图都只保存在本机。添加学生后，可以为他排课并归档课堂录像。</p><button className="btn-cue" onClick={() => setEditing('new')}><Plus size={14} />添加第一位学生</button></div></div> : <div className="stu-main" style={{ ['--h' as string]: s.hue }}>
      <header className="stu-hero"><span className="ava xl">{isGroup(s) ? <UsersRound size={30} /> : s.name.slice(-1)}</span><div className="stu-id"><h2>{s.name}{s.archived && <small> · 已归档</small>}</h2><div className="stu-meta">{isGroup(s) && <span>{kindName(s.kind)} · {membersOf(s, students).length} 人</span>}<span>{s.grade}</span><span>{pack.name}</span><span>{s.textbook}</span><span>{records.filter((r) => r.phase === 'complete').length} 段录像</span>{s.tags.map((t) => <em key={t}>{t}</em>)}</div>{isGroup(s) ? <div className="stu-members">{membersOf(s, students).map((m) => <button key={m.id} onClick={() => set({ studentId: m.id })} style={{ ['--h' as string]: m.hue }} data-tip={`查看 ${m.name} 的档案（错题、课后总结、家长联系方式）`}><span className="ava sm">{m.name.slice(-1)}</span>{m.name}</button>)}{!membersOf(s, students).length && <i>还没有成员，点「编辑」添加</i>}</div> : groupsOf(s.id, students).length > 0 && <div className="stu-members"><i>所在班组</i>{groupsOf(s.id, students).map((g) => <button key={g.id} onClick={() => set({ studentId: g.id })} style={{ ['--h' as string]: g.hue }}><UsersRound size={12} />{g.name}</button>)}</div>}{s.folder && <button className="stu-folder" onClick={() => host.revealInFolder(s.folder!)}><FolderOpen size={13} />关联资料：{s.folder}</button>}</div><span className="flex" />{host.electron && !isGroup(s) && (() => { const c = notify.contacts[s.id], n = (c?.wecom ? 1 : 0) + (c?.email?.length ?? 0); return <button className="btn-cue stu-parent" onClick={openContacts} data-tip={n ? `已设置：${[c?.wecom && (c.wecomName || '企业微信群'), ...(c?.email ?? [])].filter(Boolean).join('、')}` : '设置家长的企业微信群或邮箱，课后总结可以一键发给家长'}><Users size={13} />家长联系方式{n ? <em className="num">{n}</em> : <i>未设置</i>}</button>; })()}<button className="btn-cue" onClick={() => (isGroup(s) ? setGroupEdit(s) : setEditing(s))}><Pencil size={13} />编辑</button><button className="btn-cue" onClick={() => toggleArchive(s)}><Archive size={13} />{s.archived ? '恢复' : '归档'}</button><button className="next-go" onClick={() => set({ page: 'console' })}><CirclePlay size={17} />进入课堂</button></header>
      {(message || error) && <div className="material-status" role="status"><span>{message || error}</span><button onClick={() => setMessage('')}>关闭</button></div>}
      <div className="stu-grid">
        <section className="card map"><div className="card-h"><b>学习地图</b><span className="legend">{(['done','learning','weak','none'] as ChapterState[]).map((k) => <span key={k}><i className={'cell ' + k} />{STATE_NAME[k]} <em className="num">{counts[k] ?? 0}</em></span>)}</span></div><div className="map-hint">点击知识点切换：未学 → 在学 → 已掌握 → 薄弱。格子外圈颜色是课堂作答算出的掌握度（绿 ≥80%，黄 50~80%，红 &lt;50%）。{suggest.length > 0 && <button className="map-sync" onClick={applySuggest}>按作答更新地图（{suggest.length} 处）</button>}{lastRun && <span className="map-auto" data-qa="map-auto">{lastRun.why} {new Date(lastRun.at).toTimeString().slice(0, 5)}：{lastRun.changes.slice(0, 3).map(changeText).join('、')}{lastRun.changes.length > 3 ? ` 等 ${lastRun.changes.length} 处` : ''}<button className="link-btn" onClick={() => { const n = undoMapRun(lastRun.id); setMessage(n ? `已撤销 ${n} 处自动更新。` : '这些格子你之后又改过，没有动。'); }}>撤销</button></span>}</div><div className="map-body">{pack.books.map((book) => <div key={book} className="map-book"><span className="map-bk">{book}</span><div className="map-chs">{chapters.map((c, ci) => c.book === book && <div key={ci} className="map-ch"><span className="map-cn" title={c.ch}>{c.ch}</span><span className="map-cells">{c.sec.map((sec, si) => { const m = ms.get(pointKey(pack, ci, si)), tip = `${sec} · ${STATE_NAME[map[ci][si]]}${m ? `　作答 ${m.n} 次，掌握 ${Math.round(m.score * 100)}%` : ''}`; return <button key={si} className={'cell ' + map[ci][si] + (m ? ' mk' : '')} style={m ? { ['--mc' as string]: m.score >= 0.8 ? 'var(--ok)' : m.score >= 0.5 ? 'var(--warn)' : 'var(--live)' } : undefined} onClick={() => mark(ci,si)} aria-label={tip} data-tip={tip} />; })}</span></div>)}</div></div>)}</div></section>
        <Portrait student={s} />
        <StudentRecords student={s} />
        <section className="card tline"><div className="card-h"><b>本地课堂回放</b><span className="sub">按学生归档的真实录像</span><button className="sec-a" onClick={() => void reload()} aria-label="刷新录像"><RotateCcw size={13} /></button></div>
          {!records.length && <div className="lib-empty">还没有这位学生的课堂录像。选择该学生后从导播台开始录课，下课保存后显示在这里。</div>}
          {records.map((r, i) => { const mins=recordingMinutes(r),date=new Date(r.createdAt);return <article key={r.id} className={'rec' + (i===0?' latest':'')}><div className="rec-date"><b className="num">{date.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})}</b><span className="num">{mins===null?'时长待确认':`${mins} 分`}</span></div><div className="rec-body"><div className="rec-h"><b>{r.title || '课堂录像'}</b>{i===0&&<em>最近一次</em>}<span className="flex" />{r.phase==='complete'?<button className="rec-play" onClick={() => void host.call('openRecording',r.id).catch((e)=>setMessage(e.message))}><CirclePlay size={14} />播放</button>:['converting','starting','recording','stopping'].includes(r.phase)?null:<button className="rec-play" onClick={()=>{void host.call('recoverRecording',r.id).catch((e)=>setMessage(e.message));setTimeout(()=>void reload(),400);}}><RotateCcw size={14} />生成回放</button>}</div><p className="rec-note">{r.phase==='complete'?'已保存到本机':r.phase==='converting'?`回放生成中 ${Math.round((r.progress??0)*100)}%`:['starting','recording','stopping'].includes(r.phase)?'正在录':'原录像已保留，可生成回放'} · {(r.bytes/1024/1024).toFixed(1)} MB</p><button className="stu-folder" onClick={()=>host.revealInFolder(r.folder)}><FolderOpen size={13} />打开录像目录</button></div></article>})}
        </section>
      </div>
    </div>}
    {contacts && s && <ContactsSheet student={s} onClose={() => setContacts(false)} />}
    {groupEdit && <GroupEditor group={groupEdit === 'new' ? null : groupEdit} onClose={() => setGroupEdit(null)} onSaved={() => { setGroupEdit(null); setArchived(false); }} />}
    {editing && <StudentEditor student={editing==='new'?null:editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setArchived(false)}} />}
  </div>;
}

function StudentEditor({student,onClose,onSaved}:{student:Student|null;onClose:()=>void;onSaved:()=>void}) {
  const [name,setName]=useState(student?.name||''),[grade,setGrade]=useState(student?.grade||'高一'),[subject,setSubject]=useState<SubjectId>(studentSubject(student)),[textbook,setTextbook]=useState(student?.textbook||packOf(studentSubject(student)).textbook),[folder,setFolder]=useState(student?.folder||''),[tags,setTags]=useState(student?.tags.join('，')||''),[topic,setTopic]=useState(student?.lastTopic||''),[hue,setHue]=useState(student?.hue??195),[error,setError]=useState(''),[saving,setSaving]=useState(false),[ownBook,setOwnBook]=useState(false);
  const pickSubject=(id:SubjectId)=>{setSubject(id);if(!textbook.trim()||!student||SUBJECTS.some(p=>p.textbooks.includes(textbook))){setTextbook(packOf(id).textbook);setOwnBook(false)}};
  // 改年级时如果学段变了，学科跟着换到同学段的同一科（高一物理 → 初二 → 初中物理）
  const pickGrade=(g:string)=>{setGrade(g);const lv=levelOfGrade(g),cur=packOf(subject);if(lv&&lv!==cur.level){const next=byLevel(lv).find(p=>p.family===cur.family)??byLevel(lv)[0];if(next)pickSubject(next.id)}};
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(!name.trim())return;setSaving(true);try{if(folder&&!useStore.getState().roots.some(r=>folder===r||folder.startsWith(r+'/')))await addRoot(folder);const current=useStore.getState(),old=student&&current.students.find(s=>s.id===student.id);const next:Student={id:old?.id||crypto.randomUUID(),name:name.trim(),grade:grade.trim(),subject,textbook:textbook.trim(),folder:folder||undefined,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean),hue,lessons:old?.lessons||0,lastTopic:topic.trim(),lastAt:old?.lastAt||'',archived:false};current.set({students:old?current.students.map(s=>s.id===next.id?next:s):[...current.students,next],studentId:next.id});onSaved()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setSaving(false)}};
  return <div className="sheet-bg" onPointerDown={e=>e.target===e.currentTarget&&onClose()}><form className="record-editor" onSubmit={save}><div className="card-h"><b>{student?'编辑学生':'添加学生'}</b><span className="flex"/><button type="button" onClick={onClose} aria-label="关闭编辑"><X size={16}/></button></div><label>姓名<input required maxLength={60} autoFocus value={name} onChange={e=>setName(e.target.value)}/></label><div className="record-two"><label>年级<select value={grade} onChange={e=>pickGrade(e.target.value)}>{!GRADES.includes(grade)&&<option value={grade}>{grade||'未填写'}</option>}<optgroup label="小学">{GRADES.slice(0,6).map(g=><option key={g} value={g}>{g}</option>)}</optgroup><optgroup label="初中">{GRADES.slice(6,9).map(g=><option key={g} value={g}>{g}</option>)}</optgroup><optgroup label="高中">{GRADES.slice(9).map(g=><option key={g} value={g}>{g}</option>)}</optgroup></select></label><label>学科<select value={subject} onChange={e=>pickSubject(e.target.value as SubjectId)}>{LEVELS.map(l=><optgroup key={l} label={LEVEL_NAME[l]}>{byLevel(l).map(p=><option key={p.id} value={p.id}>{p.stage}</option>)}</optgroup>)}</select></label></div><label>教材版本{ownBook||!packOf(subject).textbooks.includes(textbook)?<div className="record-folder"><input value={textbook} placeholder="填写教材版本" onChange={e=>setTextbook(e.target.value)}/><button type="button" onClick={()=>{setOwnBook(false);setTextbook(packOf(subject).textbook)}}>从列表选</button></div>:<select value={textbook} onChange={e=>{if(e.target.value==='\u0000own'){setOwnBook(true);setTextbook('')}else setTextbook(e.target.value)}}>{packOf(subject).textbooks.map(b=><option key={b} value={b}>{b}</option>)}<option value={'\u0000own'}>自己填写…</option></select>}</label><label>标签（用逗号分隔）<input value={tags} onChange={e=>setTags(e.target.value)}/></label><label>上次讲到 / 教学提醒<input value={topic} onChange={e=>setTopic(e.target.value)}/></label><label>关联课件目录<div className="record-folder"><input readOnly value={folder} placeholder="可选"/><button type="button" disabled={!host.electron} onClick={()=>void host.pickFolder().then(p=>{if(p)setFolder(p)}).catch(e=>setError(e.message))}><FolderOpen size={14}/>选择</button><button type="button" onClick={()=>setFolder('')}>清空</button></div></label><label>学生标识色<input type="range" min="0" max="359" value={hue} onChange={e=>setHue(Number(e.target.value))}/><span className="ava" style={{['--h' as string]:hue}}>{name.slice(-1)||'生'}</span></label>{error&&<p role="alert">{error}</p>}<div className="record-actions"><button type="button" onClick={onClose}>取消</button><button className="btn-cue" disabled={saving} type="submit">{saving?'保存中…':'保存学生'}</button></div></form></div>;
}

/** 新建 / 编辑班组：类型、成员（从已有学生里勾，或一行一个名字直接新建） */
function GroupEditor({ group, onClose, onSaved }: { group: Student | null; onClose: () => void; onSaved: () => void }) {
  const all = useStore((s) => s.students);
  const pool = all.filter((s) => !isGroup(s) && (!s.archived || group?.members?.includes(s.id)));
  const [name, setName] = useState(group?.name ?? ''), [kind, setKind] = useState(group?.kind ?? 'pair'), [kindTouched, setKindTouched] = useState(!!group);
  const [members, setMembers] = useState<string[]>(group?.members ?? []), [fresh, setFresh] = useState(''), [q, setQ] = useState('');
  const [subject, setSubject] = useState<SubjectId>(studentSubject(group ?? pool.find((s) => s.id === members[0]))), [grade, setGrade] = useState(group?.grade ?? '');
  const [hue, setHue] = useState(group?.hue ?? 40), [error, setError] = useState('');
  const freshNames = fresh.split(/[\n,，、;；]/).map((x) => x.trim()).filter(Boolean);
  const total = members.length + freshNames.length;
  useEffect(() => { if (!kindTouched) setKind(kindFor(total)); }, [total, kindTouched]);
  const toggle = (id: string) => {
    const next = members.includes(id) ? members.filter((x) => x !== id) : [...members, id];
    setMembers(next);
    // 第一位成员定学科和年级（还没手动改过时）
    if (!group && next.length === 1) { const m = pool.find((s) => s.id === next[0]); if (m) { setSubject(studentSubject(m)); setGrade(m.grade); } }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (total < 2) { setError('班组至少要两位学生'); return; }
    const cur = useStore.getState(), made: Student[] = [], picked = [...members];
    for (const n of freshNames) {
      const same = cur.students.find((s) => !isGroup(s) && !s.archived && s.name === n);
      if (same) { if (!picked.includes(same.id)) picked.push(same.id); continue; }
      made.push({ id: crypto.randomUUID(), name: n.slice(0, 60), grade, subject, textbook: packOf(subject).textbook, tags: [], hue: (cur.students.length + made.length) * 137 % 360, lessons: 0, lastTopic: '', lastAt: '' });
    }
    const list = [...cur.students, ...made];
    const ids = [...new Set([...picked, ...made.map((s) => s.id)])];
    const base = makeGroup({ name, kind, members: ids, id: group?.id, hue }, list);
    const next: Student = group ? { ...group, name: base.name, kind, members: ids, grade, subject, hue, textbook: packOf(subject).textbooks.includes(group.textbook) ? group.textbook : packOf(subject).textbook } : { ...base, grade, subject, textbook: packOf(subject).textbook };
    cur.set({ students: group ? list.map((s) => (s.id === next.id ? next : s)) : [...list, next], studentId: next.id });
    onSaved();
  };
  return <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}><form className="record-editor grp-editor" onSubmit={save}>
    <div className="card-h"><b>{group ? '编辑班组' : '新建班组'}</b><span className="flex" /><button type="button" onClick={onClose} aria-label="关闭编辑"><X size={16} /></button></div>
    <div className="grp-kinds">{GROUP_KINDS.map((k) => <button type="button" key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => { setKind(k.id); setKindTouched(true); }}><b>{k.name}</b><span>{k.desc}</span></button>)}</div>
    <label>班组名称<input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'class' ? '例如：初二(3)班' : '可不填，默认用成员名字'} /></label>
    <div className="record-two"><label>年级<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">未填写</option>{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
      <label>学科<select value={subject} onChange={(e) => setSubject(e.target.value as SubjectId)}>{LEVELS.map((l) => <optgroup key={l} label={LEVEL_NAME[l]}>{byLevel(l).map((p) => <option key={p.id} value={p.id}>{p.stage}</option>)}</optgroup>)}</select></label></div>
    <div className="grp-pick"><div className="grp-pick-h"><b>成员 <em className="num">{total}</em> 人</b><span className="flex" />{pool.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="找学生" />}</div>
      <div className="grp-list">{pool.filter((s) => !q || s.name.includes(q)).map((s) => <label key={s.id} className={'grp-m' + (members.includes(s.id) ? ' on' : '')} style={{ ['--h' as string]: s.hue }}><input type="checkbox" checked={members.includes(s.id)} onChange={() => toggle(s.id)} /><span className="ava sm">{s.name.slice(-1)}</span>{s.name}<i>{s.grade}</i></label>)}
        {!pool.length && <p className="grp-none">还没有学生档案，可以直接在下面写名字。</p>}</div></div>
    <label>新同学（一行一个名字，会自动建学生档案）<textarea rows={kind === 'class' ? 4 : 2} value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder={'王小明\n李华'} /></label>
    <label>标识色<input type="range" min="0" max="359" value={hue} onChange={(e) => setHue(Number(e.target.value))} /><span className="ava" style={{ ['--h' as string]: hue }}><UsersRound size={14} /></span></label>
    <p className="record-note">排课、上课绑定、录像都按班组；课堂上点「对 / 错」时可以分别记给每位成员，课后总结每人一份，分别发给各自的家长。</p>
    {error && <p role="alert">{error}</p>}
    <div className="record-actions"><button type="button" onClick={onClose}>取消</button><button className="btn-cue" type="submit">保存班组</button></div>
  </form></div>;
}