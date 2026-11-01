import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, FileText, FolderSearch, Loader2, MessageSquareText, Play, Power, Trash2, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { useStudy, ensureStudy } from '../lib/studyStore';
import { useLib } from '../lib/useLib';
import { fileEntry } from '../lib/library';
import { openMaterial } from '../doc/actions';
import { addNote, canEnable, clearLog, ensureAuto, makePrep, removeNote, setAuto, tick, useAuto, type LogItem } from '../lib/autopilot';
import { upcoming } from '../lib/autopilotLogic';
import { dateKey } from '../doc/scheduleModel';
import { useCatalog, ensureCatalog } from '../lib/catalog';
import { SHELVES, SHELF_NAME } from '../lib/catalogLogic';
import { host } from '../lib/host';
import type { StudentNote } from '../lib/studyLogic';
import { Outputs } from './StudyParts';
import { CatalogPanel } from './CatalogPanel';
import '../styles/agents.css';
import '../styles/study.css';
import '../styles/autopilot.css';

type Tab = 'home' | 'prep' | 'notes' | 'catalog';
const KIND_NAME: Record<LogItem['kind'], string> = { lesson: '课后', homework: '作业', prep: '备课', catalog: '整理', note: '资料', error: '提醒' };
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export function AutopilotPage() {
  useEffect(() => { ensureStudy(); void ensureAuto(); void ensureCatalog(); }, []);
  const [tab, setTab] = useState<Tab>('home');
  const on = useAuto((s) => s.settings.on), running = useAuto((s) => s.running);
  return <div className="ags ap">
    <header className="ags-head">
      <div className="ags-title"><Bot size={20} /><h2>AI 自动</h2><span className={'ap-state' + (on ? ' on' : '')}>{on ? '已开启' : '未开启'}</span>{running && <span className="sd-note"><Loader2 size={12} className="ags-spin" /> {running}</span>}</div>
      <nav className="ags-tabs">
        {([['home', '自动处理', <Power size={14} key="i" />], ['prep', '备课', <CalendarClock size={14} key="i" />], ['notes', '家长沟通', <MessageSquareText size={14} key="i" />], ['catalog', '资料整理', <FolderSearch size={14} key="i" />]] as [Tab, string, React.ReactNode][]).map(([k, l, i]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{i}{l}</button>)}
      </nav>
    </header>
    <div className="sd-body">
      {tab === 'home' && <HomeTab />}
      {tab === 'prep' && <PrepTab />}
      {tab === 'notes' && <NotesTab />}
      {tab === 'catalog' && <div className="sd-pane"><CatalogPanel /></div>}
    </div>
  </div>;
}

function HomeTab() {
  const s = useAuto((x) => x.settings), log = useAuto((x) => x.log), lastRun = useAuto((x) => x.lastRun), running = useAuto((x) => x.running);
  const [ask, setAsk] = useState(false), [err, setErr] = useState('');
  const turnOn = async () => { setErr(''); const why = await canEnable(); if (why) { setErr(why); setAsk(false); return; } setAuto({ on: true }); setAsk(false); void tick(); };
  const items = [...log].reverse().slice(0, 80);
  const check = (k: 'lesson' | 'homework' | 'original' | 'prep' | 'courseware' | 'agent' | 'catalog', label: string, tip?: string) =>
    <label className="sd-check"><input type="checkbox" checked={s[k]} onChange={(e) => { setAuto({ [k]: e.target.checked }); if (k === 'lesson' && !e.target.checked) void host.call('setSettings', { afterSummary: false }).catch(() => {}); }} /><span className="ap-check-t">{label}{tip && <i className="sd-note">{tip}</i>}</span></label>;
  return <div className="sd-pane sd-two">
    <section className="sd-form">
      <div className={'ap-switch' + (s.on ? ' on' : '')}>
        <div><b>{s.on ? 'AI 正在帮你处理课外杂事' : 'AI 自动处理（默认关闭）'}</b><p>{s.on ? '每 5 分钟看一次课表和学情：下课后写总结、组作业，上课前备课，空闲时整理资料。' : '开启后，AI 会在课后自动写总结和家长反馈草稿、组作业，在上课前自动备课，并整理资料库。手动功能照常可用。'}</p></div>
        {s.on ? <button className="sd-btn" onClick={() => setAuto({ on: false })}><Power size={13} />关闭</button> : <button className="ags-go" onClick={() => setAsk(true)}><Power size={14} />开启</button>}
      </div>
      {err && <p className="sd-err">{err}</p>}
      <h4>课后</h4>
      {check('lesson', '下课后写课后总结 + 家长反馈草稿 + 分享长图', '（不会自动发给家长；有录像时等 AI 分析完再写。和「设置 → 下课后」里的是同一个开关，那边单独开了，总开关关着也会写）')}
      {check('homework', '按当天错题和薄弱点从题库组作业')}
      {check('original', '题库不够时 AI 原创补齐（每道独立再解一遍自检）')}
      <label>作业题数<input type="number" min={3} max={20} value={s.hwCount} onChange={(e) => setAuto({ hwCount: Number(e.target.value) })} /></label>
      <h4>课前</h4>
      {check('prep', '自动备课：先找本地课件和题，再写备课建议')}
      <label>提前几小时备课<input type="number" min={2} max={72} value={s.prepHours} onChange={(e) => setAuto({ prepHours: Number(e.target.value) })} /></label>
      {check('courseware', '本地没有合适课件时，AI 原创一份课件（PPT + PDF）')}
      {check('agent', '本地没有课件时，交给后台 Agent 联网找公开资料', '（花费更多，默认关）')}
      {s.agent && <label>后台 Agent 每次最多花（元）<input type="number" min={1} max={20} value={s.agentCap} onChange={(e) => setAuto({ agentCap: Number(e.target.value) })} /></label>}
      <h4>资料和花费</h4>
      {check('catalog', '自动整理资料库：新文件归到课件库 / 题库 / 学生档案')}
      <label>每天最多自动运行的 AI 任务数<input type="number" min={1} max={60} value={s.dailyJobs} onChange={(e) => setAuto({ dailyJobs: Number(e.target.value) })} /></label>
      <p className="sd-note">每项花费都记在「备课 → AI 账本」里。一次课后处理大约 ¥0.05~0.3，一次备课 ¥0.05~0.5（看模型）。</p>
    </section>
    <section className="sd-preview">
      <div className="sd-bar"><b>运行记录</b><span className="sd-note">{lastRun ? '上次检查 ' + new Date(lastRun).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '还没运行过'}</span><span className="flex" />
        <button className="sd-btn" disabled={!!running} onClick={() => void tick(true)}>{running ? <Loader2 size={13} className="ags-spin" /> : <Play size={13} />}现在运行一次</button>
        {!!log.length && <button className="sd-btn" onClick={clearLog}><Trash2 size={13} />清空记录</button>}
      </div>
      {!s.on && <p className="sd-note">总开关关着时，「现在运行一次」只做免费的规则整理（按文件名归类资料）。</p>}
      {!items.length && <div className="lib-empty">还没有记录。开启后，下课和上课前会自动出现处理结果。</div>}
      <div className="ap-log">{items.map((l) => <div key={l.id} className={'ap-ev k-' + l.kind}>
        <span className="ap-k">{KIND_NAME[l.kind]}</span>
        <div><p>{l.text}</p><i>{new Date(l.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</i>{!!l.files?.length && <Outputs r={{ out: l.files, errors: [] }} />}</div>
      </div>)}</div>
    </section>
    {ask && <div className="sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && setAsk(false)}>
      <div className="record-editor ap-ask">
        <div className="card-h"><b>开启 AI 自动处理？</b><span className="flex" /><button onClick={() => setAsk(false)} aria-label="关闭"><X size={16} /></button></div>
        <p>开启后，导播台开着的时候 AI 会自动：</p>
        <ul>
          <li>下课后：根据当天作答和课表写课后总结、家长反馈草稿和分享长图，组好课后作业（Word + PDF）。</li>
          <li>上课前：在本地课件库和题库里找资料，结合学情和家长要求写备课建议；没有合适课件时可以原创一份。</li>
          <li>空闲时：把资料库里的新文件归到课件库 / 题库 / 学生档案。</li>
        </ul>
        <p className="sd-note">需要先配置 AI。会按你设的上限消耗 AI 额度；家长反馈只写草稿，不会自动发送；原课件文件只读，不会被修改或移动。</p>
        <div className="record-actions"><button onClick={() => setAsk(false)}>先不开</button><button className="btn-cue" onClick={() => void turnOn()}>开启</button></div>
      </div>
    </div>}
  </div>;
}

function PrepTab() {
  const students = useStore((s) => s.students), slots = useStore((s) => s.slots), studentId = useStore((s) => s.studentId);
  const preps = useStudy((s) => s.data.preps ?? []);
  const lib = useLib((s) => s.lib);
  const [busy, setBusy] = useState(''), [step, setStep] = useState(''), [err, setErr] = useState('');
  const [who, setWho] = useState(studentId), [topic, setTopic] = useState(''), [date, setDate] = useState(() => dateKey(new Date())), [minutes, setMinutes] = useState(90);
  const next = useMemo(() => upcoming(new Date(), slots, students, 24 * 7, [], new Set()), [slots, students]);
  const run = async (o: { studentId: string; topic: string; date: string; start?: number; minutes: number; slotId?: string }, key: string) => {
    setBusy(key); setErr(''); setStep('');
    try { await makePrep({ ...o, auto: false }, setStep); setStep('备课完成。'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const open = (p: string) => { void openMaterial(lib?.files.get(p) ?? fileEntry(p), 'teacher'); useStore.getState().set({ page: 'console' }); };
  const name = (id: string) => students.find((s) => s.id === id)?.name ?? '已删除的学生';
  const list = [...preps].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  return <div className="sd-pane sd-two">
    <section className="sd-form">
      <h3>接下来 7 天的课</h3>
      {!next.length && <p className="sd-note">课表里接下来 7 天没有课。也可以在下面手动备课。</p>}
      <div className="ap-next">{next.slice(0, 14).map((u) => { const has = preps.find((p) => p.slotId === u.slotId && p.date === u.date); return <div key={u.key} className="ap-slot">
        <div><b>{name(u.studentId)} · {u.topic}</b><i>{u.date.slice(5)} {hhmm(u.start)} · {Math.round(u.len * 60)} 分钟</i></div>
        {has ? <span className="sd-tag ok">已备课</span> : <button className="sd-btn" disabled={!!busy} onClick={() => void run({ studentId: u.studentId, topic: u.topic, date: u.date, start: u.start, minutes: Math.round(u.len * 60), slotId: u.slotId }, u.key)}>{busy === u.key ? <Loader2 size={13} className="ags-spin" /> : <FileText size={13} />}备课</button>}
      </div>; })}</div>
      <h4>手动备课</h4>
      <label>学生<select value={who} onChange={(e) => setWho(e.target.value)}>{students.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>主题<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：二次函数的图像与性质" /></label>
      <div className="sd-grid"><label>日期<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>时长（分钟）<input type="number" min={20} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 90)} /></label></div>
      <div className="ags-row"><button className="ags-go" disabled={!!busy || !who} onClick={() => void run({ studentId: who, topic: topic.trim(), date, minutes }, 'manual')}>{busy === 'manual' ? <Loader2 size={14} className="ags-spin" /> : <FileText size={14} />}开始备课</button></div>
      {step && <p className="sd-msg">{step}</p>}
      {err && <p className="sd-err">{err}</p>}
      <p className="ags-sub">备课先在「资料整理」过的课件库、题库里找（按主题、知识点、学科），再结合学情、最近的课后总结和家长要求写建议。没有合适课件时可以让 AI 原创。</p>
    </section>
    <section className="sd-preview">
      <b>备课记录</b>
      {!list.length && <div className="lib-empty">还没有备课记录。</div>}
      {list.map((p) => <article key={p.id} className="ap-prep">
        <header><b>{name(p.studentId)} · {p.topic || '本节课'}</b><i>{p.date}{p.start !== undefined ? ' ' + hhmm(p.start) : ''} · {p.via === 'ai' ? 'AI 建议' : '模板'}{p.auto ? ' · 自动' : ''}</i></header>
        {!!p.materials.length && <div className="ap-mats">{p.materials.map((m) => <button key={m} className="sd-file" onClick={() => open(m)} title={m}><span className="ext">课件</span><span>{m.split('/').pop()}</span></button>)}</div>}
        <Outputs r={{ out: [...p.files, ...(p.courseware ?? [])], errors: [] }} />
      </article>)}
    </section>
  </div>;
}

const NOTE_KIND: [StudentNote['kind'], string][] = [['parent', '家长聊天记录'], ['requirement', '家长要求'], ['teacher', '我的备注']];
function NotesTab() {
  const students = useStore((s) => s.students), current = useStore((s) => s.studentId);
  const notes = useStudy((s) => s.data.notes ?? []);
  const [who, setWho] = useState(current), [kind, setKind] = useState<StudentNote['kind']>('parent'), [text, setText] = useState(''), [err, setErr] = useState(''), [source, setSource] = useState('');
  const mine = notes.filter((n) => n.studentId === who).sort((a, b) => b.at.localeCompare(a.at));
  const pick = async () => { setErr(''); try { const r = await host.call<{ path: string; text: string } | null>('study.pickText'); if (r) { setText(r.text.slice(0, 20000)); setSource(r.path.split('/').pop() ?? ''); } } catch (e) { setErr((e as Error).message); } };
  return <div className="sd-pane sd-two">
    <section className="sd-form">
      <h3>交给 AI 的学生资料</h3>
      <p className="ags-sub">把和家长的聊天记录、家长的要求、你自己的观察贴进来。AI 备课和写课后反馈时会参考（只在本机保存）。</p>
      <label>学生<select value={who} onChange={(e) => setWho(e.target.value)}>{students.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="ags-seg">{NOTE_KIND.map(([k, l]) => <button key={k} className={'sd-btn' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}</div>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：家长希望下次多讲压轴题；孩子最近周测函数部分丢分多……" />
      {err && <p className="sd-err">{err}</p>}
      <div className="ags-row">
        <button className="ags-go" disabled={!text.trim() || !who} onClick={() => { addNote({ studentId: who, kind, text, source: source || undefined }); setText(''); setSource(''); }}>保存</button>
        <button className="sd-btn" disabled={!host.electron} onClick={() => void pick()}>从文本文件导入（txt / md）</button>
        {source && <span className="sd-note">来自 {source}</span>}
      </div>
    </section>
    <section className="sd-preview">
      <b>{students.find((s) => s.id === who)?.name ?? ''} 的资料 · {mine.length} 条</b>
      {!mine.length && <div className="lib-empty">还没有资料。</div>}
      {mine.map((n) => <article key={n.id} className="ap-note">
        <header><span className="sd-tag">{NOTE_KIND.find(([k]) => k === n.kind)?.[1]}</span><i>{new Date(n.at).toLocaleString('zh-CN')}{n.source ? ' · ' + n.source : ''}</i><span className="flex" /><button onClick={() => removeNote(n.id)} aria-label="删除这条资料"><Trash2 size={13} /></button></header>
        <p>{n.text.length > 600 ? n.text.slice(0, 600) + '…' : n.text}</p>
      </article>)}
    </section>
  </div>;
}

/** 课表、学生页可以用的一行小结：资料库整理了多少 */
export function CatalogSummary() {
  const items = useCatalog((s) => s.items);
  const counts = SHELVES.map((k) => [k, Object.values(items).filter((e) => e.shelf === k).length] as const);
  return <span className="sd-note">{counts.filter(([, n]) => n).map(([k, n]) => `${SHELF_NAME[k]} ${n}`).join(' · ') || '资料库还没整理'}</span>;
}
