// AI 助教的界面：右下角的小羽（可拖动、可隐藏）、冒泡提醒、右侧聊天抽屉（对话、历史、设置、提醒）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronDown, CircleStop, FileText, FolderOpen, History, Loader2, MessageSquarePlus, Paperclip, Pencil, Plus, SendHorizontal, Settings2, ShieldCheck, Terminal, Trash2, Undo2, X } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { useStudy } from '../lib/studyStore';
import { lessonDocument } from '../lib/studyActions';
import { toast } from '../lib/toast';
import type { SendRecord } from '../lib/studyLogic';
import { MdText } from '../teacher/TexText';
import { SendSheet, useNotify } from '../teacher/ParentSend';
import { Mascot, type Mood } from './Mascot';
import { PERSONAS } from './prompt';
import { cleanTrigger, PAGES, timesText, whenText, type Trigger, type When } from './triggersLogic';
import { changeSummary } from './toolsLogic';
import { TOOL_LABEL } from './tools';
import { putTrigger, removeTrigger, setMemory, setSettings, useAssistantData } from './state';
import {
  answerApproval, answerConfirm, answerGrant, closeAssistant, closeParent, dismissBubble, helloText, newChat, openAssistant, openChat, refreshStatus,
  removeChat, renameChat, send, startAssistant, stop, undoTurn, useAssistant, type Item, type Turn,
} from './controller';
import '../styles/assistant.css';

const yuan = (v: number) => (v >= 0.01 ? '¥' + v.toFixed(2) : v > 0 ? '<¥0.01' : '');
const fname = (p: string) => p.split(/[\\/]/).pop() ?? p;
const openFile = (p: string) => void host.call('assistant.open', { path: p }).catch((e) => toast((e as Error).message));
const POS = 'cs.assistant.pos';

/** 当前该摆什么表情 */
function useMood(): Mood {
  const st = useAssistant();
  const [happy, setHappy] = useState(0);
  const last = st.chat?.turns.at(-1);
  useEffect(() => { if (last?.status === 'completed' && Date.now() - (last.at ?? 0) < 30 * 60000) { setHappy(Date.now()); const t = setTimeout(() => setHappy(0), 2600); return () => clearTimeout(t); } }, [last?.id, last?.status]);
  if (st.status && !st.status.found) return 'sleep';
  if (st.confirms.length || st.grants.length || Object.keys(st.approvals).length || st.parent) return 'alert';
  const running = st.chat && st.chats.find((c) => c.id === st.chat!.id)?.running;
  if (running) {
    const items = st.chat!.items.filter((x) => x.turn === last?.id || !x.turn);
    const tail = items.at(-1);
    if (tail?.kind === 'text' && tail.streaming) return 'talk';
    if (tail && (tail.kind === 'tool' || tail.kind === 'cmd' || tail.kind === 'file') && tail.status === 'run') return 'work';
    return 'think';
  }
  if (st.bubble) return 'alert';
  return happy ? 'happy' : 'idle';
}

// ── 入口 ─────────────────────────────────────────────
export function AssistantHost() {
  useEffect(() => { startAssistant(); }, []);
  const open = useAssistant((s) => s.open), parent = useAssistant((s) => s.parent);
  const avatar = useAssistantData((s) => s.settings.avatar);
  return <>
    {avatar && !open && <Floating />}
    {open && <Drawer />}
    {parent && <ParentHost />}
  </>;
}

/** 顶栏按钮 */
export function AssistantButton() {
  const open = useAssistant((s) => s.open), name = useAssistantData((s) => s.settings.name), mood = useMood();
  const wait = useAssistant((s) => s.confirms.length + s.grants.length + Object.keys(s.approvals).length);
  return <button className={'tb-as' + (open ? ' on' : '')} data-tip={`AI 助教${name}：排课、学生、题库、作业、课后反馈、备课，跟它说一声就行`} onClick={() => (open ? closeAssistant() : openAssistant())}>
    <Mascot mood={open ? mood : wait ? 'alert' : 'idle'} size={22} className="still" /><span>{name}</span>{wait > 0 && <i className="tb-as-dot" />}
  </button>;
}

function Floating() {
  const mood = useMood(), bubble = useAssistant((s) => s.bubble), name = useAssistantData((s) => s.settings.name);
  const [pos, setPos] = useState<{ r: number; b: number }>(() => { try { const p = JSON.parse(localStorage.getItem(POS) || ''); if (Number.isFinite(p.r) && Number.isFinite(p.b)) return p; } catch { /* 没存过 */ } return { r: 18, b: 70 }; });
  const drag = useRef<{ x: number; y: number; r: number; b: number; moved: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const clamp = (p: { r: number; b: number }) => ({ r: Math.max(4, Math.min(innerWidth - 90, p.r)), b: Math.max(4, Math.min(innerHeight - 110, p.b)) });
  useEffect(() => { const fit = () => setPos((p) => clamp(p)); addEventListener('resize', fit); return () => removeEventListener('resize', fit); }, []);
  useEffect(() => { if (!bubble) return; const t = setTimeout(dismissBubble, 15000); return () => clearTimeout(t); }, [bubble?.id]);
  const drop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter((p): p is string => !!p);
    if (paths.length) { openAssistant(); pending.files = paths; pending.at = Date.now(); }
  };
  return <div className={'as-float' + (over ? ' drop' : '')} style={{ right: pos.r, bottom: pos.b }}
    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={(e) => void drop(e)}>
    {bubble && <div className="as-bubble" role="status" onClick={() => { if (bubble.chatId) void openChat(bubble.chatId); else openAssistant(); }}>
      {bubble.title && <b>{bubble.title}</b>}<span>{bubble.text}</span>
      <button aria-label="关闭" onClick={(e) => { e.stopPropagation(); dismissBubble(); }}><X size={12} /></button>
    </div>}
    <div className="as-me" data-tip={`${name}：点我聊天，拖动换位置，文件拖到我身上直接交给我`}
      onPointerDown={(e) => { try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 触屏笔等指针已失效 */ } drag.current = { x: e.clientX, y: e.clientY, r: pos.r, b: pos.b, moved: false }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; if (d.moved) setPos(clamp({ r: d.r - dx, b: d.b - dy })); }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (!d) return; if (d.moved) localStorage.setItem(POS, JSON.stringify(pos)); else openAssistant(); }}>
      <Mascot mood={mood} size={78} follow />
    </div>
    <button className="as-hide" data-tip="收起小羽（顶栏的助教按钮还在，设置里可以再放出来）" onClick={() => { setSettings({ avatar: false }); toast(`${name}收起来了，顶栏的「${name}」按钮随时能找到我`); }}><X size={11} /></button>
  </div>;
}
/** 拖到小羽身上的文件：抽屉打开后放进附件 */
const pending: { files: string[]; at: number } = { files: [], at: 0 };

// ── 抽屉 ─────────────────────────────────────────────
function Drawer() {
  const view = useAssistant((s) => s.view), chat = useAssistant((s) => s.chat), mood = useMood();
  const name = useAssistantData((s) => s.settings.name), status = useAssistant((s) => s.status);
  const cny = useAssistant((s) => s.chats.find((c) => c.id === s.chat?.id)?.cny ?? 0);
  useEffect(() => { void refreshStatus(); }, []);
  const tab = (v: typeof view, icon: ReactNode, tip: string) => <button className={'as-tab' + (view === v ? ' on' : '')} data-tip={tip} onClick={() => useAssistant.setState({ view: v })}>{icon}</button>;
  return <aside className="as-drawer" role="dialog" aria-label={'AI 助教' + name}>
    <header className="as-head">
      <Mascot mood={mood} size={40} follow />
      <div className="as-title"><b>{name}</b><span>{view === 'chat' ? (chat?.title && chat.items.length ? chat.title : 'AI 助教') : view === 'list' ? '历史对话' : view === 'settings' ? '设置' : '提醒和定时任务'}{view === 'chat' && cny > 0 && <em> · {yuan(cny)}</em>}</span></div>
      <span className="flex" />
      <button className="as-tab" data-tip="新对话" onClick={() => void newChat()}><MessageSquarePlus size={16} /></button>
      {tab('list', <History size={16} />, '历史对话')}{tab('triggers', <Bell size={16} />, '提醒和定时任务')}{tab('settings', <Settings2 size={16} />, '设置')}
      <button className="as-tab" aria-label="关闭" onClick={closeAssistant}><X size={16} /></button>
    </header>
    {status && !status.found && <div className="as-warn">还没有安装 AI 助教的内核（Codex）。到「备课」页的任务中心点「安装」，装好就能用。</div>}
    {status?.found && !status.studioKey && useAssistantData.getState().settings.api === 'studio' && <div className="as-warn">还没有配置导播台的 AI 接口：在右侧「AI」面板设置里导入银子 API 密钥；或者到这里的「设置」改用你自己登录的 Codex。</div>}
    {view === 'chat' && <ChatView />}
    {view === 'list' && <ListView />}
    {view === 'settings' && <SettingsView />}
    {view === 'triggers' && <TriggersView />}
  </aside>;
}

const SUGGEST = ['周三晚上 7 点给俊宇加一节课，一个半小时', '把今天的错题组成作业，导出 Word', '写今天的课后总结，并打开发给家长的预览', '帮我备明天的课', '每节课前 10 分钟提醒我看错题', '软件怎么录课？'];

function ChatView() {
  const chat = useAssistant((s) => s.chat), busy = useAssistant((s) => s.busy), error = useAssistant((s) => s.error);
  const running = useAssistant((s) => !!s.chats.find((c) => c.id === s.chat?.id)?.running);
  const allConfirms = useAssistant((s) => s.confirms), allGrants = useAssistant((s) => s.grants);
  const confirms = allConfirms.filter((c) => c.chatId === chat?.id), grants = allGrants.filter((c) => c.chatId === chat?.id);
  const others = allConfirms.length + allGrants.length - confirms.length - grants.length;
  const [text, setText] = useState(''), [files, setFiles] = useState<string[]>([]), [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (Date.now() - pending.at < 5000 && pending.files.length) { void grantAll(pending.files).then((p) => setFiles((f) => [...new Set([...f, ...p])])); pending.files = []; } input.current?.focus(); }, []);
  const n = chat?.items.length ?? 0, lastLen = chat?.items.at(-1)?.text?.length ?? 0;
  useEffect(() => { const el = box.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 220) el.scrollTop = el.scrollHeight; }, [n, lastLen, confirms.length, grants.length]);
  useEffect(() => { box.current && (box.current.scrollTop = box.current.scrollHeight); }, [chat?.id]);
  const go = (t = text) => { if (!t.trim()) return; void send(t, { files }); setText(''); setFiles([]); };
  const pick = async () => { try { const p = await host.call<string[]>('assistant.pickFiles'); setFiles((f) => [...new Set([...f, ...p])]); } catch (e) { toast((e as Error).message); } };
  const groups = useMemo(() => groupTurns(chat?.items ?? []), [chat?.items]);
  return <div className={'as-chat' + (over ? ' drop' : '')}
    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
    onDragLeave={(e) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver(false); }}
    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const p = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter((x): x is string => !!x); void grantAll(p).then((g) => setFiles((f) => [...new Set([...f, ...g])])); }}>
    <div className="as-list" ref={box}>
      {!chat?.items.length && <div className="as-hello"><Mascot mood="talk" size={64} /><div className="as-msg ai"><MdText text={helloText()} /></div>
        <div className="as-sugs">{SUGGEST.map((s) => <button key={s} onClick={() => go(s)}>{s}</button>)}</div></div>}
      {groups.map((g, i) => <TurnBlock key={g.key} items={g.items} turn={chat?.turns.find((t) => t.id === g.turn)} running={running && i === groups.length - 1} />)}
      {confirms.map((c) => <div key={c.id} className="as-ask"><b><ShieldCheck size={14} />{c.title}</b><pre>{c.detail}</pre>
        <div className="as-ask-b"><button className="as-no" onClick={() => answerConfirm(c.id, false)}>不要</button><button className="as-yes danger" onClick={() => answerConfirm(c.id, true)}>{c.yes}</button></div></div>)}
      {grants.map((g) => <div key={g.id} className="as-ask"><b><FolderOpen size={14} />想看你电脑上的文件</b><p>{g.reason}</p>{g.paths.length > 0 && <pre>{g.paths.join('\n')}</pre>}
        <div className="as-ask-b"><button className="as-no" onClick={() => void answerGrant(g.id, 'no')}>不行</button><button onClick={() => void answerGrant(g.id, 'pick')}>我自己选文件…</button>{g.paths.length > 0 && <button className="as-yes" onClick={() => void answerGrant(g.id, 'yes')}>同意</button>}</div></div>)}
      {others > 0 && <div className="as-note">另一段对话里还有 {others} 件事等你确认（见「历史对话」）</div>}
      {error && <div className="as-err">{error}</div>}
    </div>
    <div className="as-input">
      {files.length > 0 && <div className="as-files">{files.map((f) => <span key={f} title={f}><FileText size={12} />{fname(f)}<button aria-label="移除" onClick={() => setFiles(files.filter((x) => x !== f))}><X size={11} /></button></span>)}</div>}
      <textarea ref={input} rows={2} value={text} placeholder={running ? '还在做…可以接着补充，它会看到' : '跟助教说要做什么（Enter 发送，Shift+Enter 换行，文件可以直接拖进来）'}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
      <div className="as-input-b">
        <button className="as-tab" data-tip="附上电脑里的文件（Word、Excel、PDF、PPT、图片）" onClick={() => void pick()}><Paperclip size={16} /></button>
        <span className="flex" />
        {running && <button className="as-stop" onClick={() => void stop()}><CircleStop size={14} />停下</button>}
        <button className="as-send" disabled={busy || !text.trim()} onClick={() => go()}>{busy ? <Loader2 size={15} className="ags-spin" /> : <SendHorizontal size={15} />}</button>
      </div>
    </div>
    {over && <div className="as-drop">松手 · 把文件交给助教</div>}
  </div>;
}
async function grantAll(paths: string[]) {
  const out: string[] = [];
  for (const p of paths) { try { out.push(await host.call<string>('assistant.grant', { path: p })); } catch (e) { toast(fname(p) + '：' + (e as Error).message); } }
  return out;
}

function groupTurns(items: Item[]) {
  const out: { key: string; turn: string; items: Item[] }[] = [];
  for (const it of items) {
    const t = it.turn || '', last = out.at(-1);
    if (last && (last.turn === t || (!t && it.kind !== 'user') || (!last.turn && t && last.items.every((x) => x.kind === 'user')))) { last.items.push(it); if (t) last.turn = t; }
    else out.push({ key: it.id, turn: t, items: [it] });
  }
  return out;
}

function TurnBlock({ items, turn, running }: { items: Item[]; turn?: Turn; running: boolean }) {
  const [sure, setSure] = useState(false);
  const changes = turn?.changes ?? [];
  return <div className={'as-turn' + (turn?.undone ? ' undone' : '')}>
    {items.map((it) => <ItemView key={it.id} it={it} />)}
    {running && items.every((x) => !(x.kind === 'text' && x.streaming)) && <div className="as-thinking"><Loader2 size={13} className="ags-spin" />在想…</div>}
    {turn && !running && (changes.length > 0 || turn.cny > 0) && <div className="as-foot">
      {turn.cny > 0 && <span>{yuan(turn.cny)}</span>}
      {changes.length > 0 && !turn.undone && (sure
        ? <><span className="as-foot-q">撤销这一轮的 {changeSummary(changes)}？</span><button onClick={() => { setSure(false); void undoTurn(turn.id); }}>撤销</button><button onClick={() => setSure(false)}>算了</button></>
        : <button data-tip={'撤回这一轮改动：' + changeSummary(changes) + '（你之后自己改过的不动）'} onClick={() => setSure(true)}><Undo2 size={12} />撤销这一轮</button>)}
      {turn.undone && <span>已撤销</span>}
    </div>}
  </div>;
}

function ItemView({ it }: { it: Item }) {
  const [open, setOpen] = useState(false);
  const approvals = useAssistant((s) => s.approvals);
  switch (it.kind) {
    case 'user': return <div className="as-msg me">{(it.text ?? '').replace(/^【定时任务「(.+?)」触发.*?】\n?/, '⏰ $1：')}{Array.isArray(it.files) && it.files.length > 0 && <div className="as-files">{(it.files as string[]).map((f) => <span key={f}><FileText size={12} />{fname(f)}</span>)}</div>}</div>;
    case 'text': return it.phase === 'commentary' ? <div className="as-msg ai sub"><MdText text={it.text ?? ''} /></div> : <div className="as-msg ai"><MdText text={it.text ?? ''} />{it.streaming && <i className="as-caret" />}</div>;
    case 'tool': {
      const label = TOOL_LABEL[it.name ?? ''] ?? it.name, c = it.card;
      if (!c) return <div className={'as-op quiet ' + (it.status ?? '')}>{it.status === 'run' ? <Loader2 size={12} className="ags-spin" /> : it.status === 'fail' ? <X size={12} /> : <Check size={12} />}<span>{label}</span></div>;
      return <div className={'as-op ' + (c.tone ?? 'ok')}><div className="as-op-h"><Check size={13} /><b>{c.title}</b></div>{c.lines?.map((l, i) => <p key={i}>{l}</p>)}
        {c.files?.length ? <div className="as-op-f">{c.files.map((f) => <button key={f} onClick={() => openFile(f)}><FileText size={12} />{fname(f)}</button>)}</div> : null}</div>;
    }
    case 'cmd': return <div className={'as-op cmd ' + (it.status ?? '')}><div className="as-op-h" onClick={() => setOpen(!open)}>{it.status === 'run' ? <Loader2 size={13} className="ags-spin" /> : <Terminal size={13} />}<b>{it.status === 'declined' ? '没有运行' : it.status === 'fail' ? '命令出错了' : '运行了命令'}</b><ChevronDown size={12} className={open ? 'up' : ''} /></div><code>{it.command}</code>{open && it.output && <pre>{it.output}</pre>}</div>;
    case 'file': return <div className="as-op"><div className="as-op-h"><FileText size={13} /><b>{it.status === 'run' ? '正在写文件…' : '写了文件'}</b></div><div className="as-op-f">{(it.files as { path: string }[] | undefined)?.map((f) => <button key={f.path} onClick={() => openFile(f.path)}><FileText size={12} />{fname(f.path)}</button>)}</div></div>;
    case 'approval': return <Approval it={it} live={!!approvals[it.id]} />;
    case 'note': return <div className="as-note">{it.text}</div>;
    case 'error': return <div className="as-err">{it.text}</div>;
  }
  return null;
}

function Approval({ it, live }: { it: Item; live: boolean }) {
  const [ans, setAns] = useState<Record<string, string>>({});
  const done = it.status === 'yes' ? '已允许' : it.status === 'session' ? '已允许（这段对话里都允许）' : it.status === 'no' ? '已拒绝' : it.status === 'stopped' ? '已取消' : '';
  if (it.type === 'input') return <div className="as-ask"><b><ShieldCheck size={14} />{it.title}</b>
    {it.questions?.map((q) => <div key={q.id} className="as-q"><p>{q.question}</p>{q.options.length ? <div className="as-q-o">{q.options.map((o) => <button key={o.label} className={ans[q.id] === o.label ? 'on' : ''} disabled={!live} data-tip={o.description} onClick={() => setAns({ ...ans, [q.id]: o.label })}>{o.label}</button>)}</div> : <input type={q.secret ? 'password' : 'text'} disabled={!live} value={ans[q.id] ?? ''} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} />}</div>)}
    {live ? <div className="as-ask-b"><button className="as-no" onClick={() => void answerApproval(it.id, 'decline')}>不回答</button><button className="as-yes" onClick={() => void answerApproval(it.id, 'accept', ans)}>好了</button></div> : <i className="as-done">{done || '已回答'}</i>}</div>;
  return <div className="as-ask"><b><ShieldCheck size={14} />{it.title}</b>{it.reason && <p>{it.reason}</p>}{it.detail && <pre>{it.detail}</pre>}
    {live ? <div className="as-ask-b"><button className="as-no" onClick={() => void answerApproval(it.id, 'decline')}>不允许</button><button onClick={() => void answerApproval(it.id, 'session')} data-tip="这段对话里同类操作不再问">都允许</button><button className="as-yes" onClick={() => void answerApproval(it.id, 'accept')}>允许这一次</button></div> : <i className="as-done">{done}</i>}</div>;
}

// ── 历史对话 ─────────────────────────────────────────
function ListView() {
  const chats = useAssistant((s) => s.chats), cur = useAssistant((s) => s.chat?.id);
  const confirms = useAssistant((s) => s.confirms), grants = useAssistant((s) => s.grants);
  const waiting = new Set([...confirms.map((c) => c.chatId), ...grants.map((g) => g.chatId)]);
  const [edit, setEdit] = useState(''), [title, setTitle] = useState(''), [del, setDel] = useState('');
  if (!chats.length) return <div className="as-empty">还没有对话。</div>;
  return <div className="as-chats">{chats.map((c) => <div key={c.id} className={'as-chat-i' + (c.id === cur ? ' on' : '')}>
    {edit === c.id ? <form onSubmit={(e) => { e.preventDefault(); void renameChat(c.id, title); setEdit(''); }}><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setEdit('')} /></form>
      : <button className="as-chat-t" onClick={() => void openChat(c.id)}><b>{c.source === 'trigger' && <Bell size={12} />}{c.title}{waiting.has(c.id) && <i className="tb-as-dot" />}</b><span>{new Date(c.updated).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {c.count} 句{c.cny > 0 ? ' · ' + yuan(c.cny) : ''}{c.running ? ' · 进行中' : ''}</span></button>}
    {del === c.id ? <><button className="as-mini danger" onClick={() => { setDel(''); void removeChat(c.id).catch((e) => toast((e as Error).message)); }}>删除</button><button className="as-mini" onClick={() => setDel('')}>算了</button></>
      : <><button className="as-mini" aria-label="改名" onClick={() => { setEdit(c.id); setTitle(c.title); }}><Pencil size={12} /></button><button className="as-mini" aria-label="删除" disabled={c.running} onClick={() => setDel(c.id)}><Trash2 size={12} /></button></>}
  </div>)}</div>;
}

// ── 设置 ─────────────────────────────────────────────
function SettingsView() {
  const s = useAssistantData((x) => x.settings), memory = useAssistantData((x) => x.memory), status = useAssistant((x) => x.status);
  const [mem, setMem] = useState('');
  return <div className="as-set">
    <section><h4>名字和性格</h4>
      <label>名字<input value={s.name} maxLength={12} onChange={(e) => setSettings({ name: e.target.value })} /></label>
      <div className="as-personas">{PERSONAS.map((p) => <button key={p.id} className={s.persona === p.id ? 'on' : ''} onClick={() => setSettings({ persona: p.id })}><b>{p.name}{p.tag && <em>{p.tag}</em>}</b><span>{p.desc}</span></button>)}</div>
      <label>额外要求<textarea rows={3} value={s.custom} placeholder="例如：称呼我王老师；回复尽量短；给家长的话用正式一点的语气" onChange={(e) => setSettings({ custom: e.target.value })} /></label>
    </section>
    <section><h4>记住的事 <i>助教每次都会参考</i></h4>
      {memory.length ? memory.map((m) => <div key={m.id} className="as-mem"><span>{m.text}</span><button className="as-mini" aria-label="忘掉" onClick={() => setMemory(memory.filter((x) => x.id !== m.id))}><Trash2 size={12} /></button></div>) : <p className="as-hint">还没有。对它说「记住……」，或在下面加一条。</p>}
      <form className="as-mem-add" onSubmit={(e) => { e.preventDefault(); const t = mem.trim(); if (!t) return; setMemory([...memory, { id: 'm-' + Date.now().toString(36), text: t.slice(0, 300), at: new Date().toISOString(), by: 'teacher' }]); setMem(''); }}><input value={mem} placeholder="例如：俊宇的家长只看企业微信" onChange={(e) => setMem(e.target.value)} /><button className="as-mini" aria-label="添加"><Plus size={13} /></button></form>
    </section>
    <section><h4>AI 接口</h4>
      <div className="as-radio">{([['auto', '自动', '配了导播台的 AI 接口就用它，否则用你自己登录的 Codex'], ['studio', '导播台的 AI 接口', '费用记进 AI 账本'], ['own', '我自己登录的 Codex', '用你电脑上 Codex 的账号和额度']] as const).map(([k, n, d]) => <button key={k} className={s.api === k ? 'on' : ''} onClick={() => setSettings({ api: k })}><b>{n}</b><span>{d}</span></button>)}</div>
      <p className="as-hint">{status ? (status.found ? `内核 Codex ${status.version || ''} 已就绪` : '还没有安装内核 Codex：到「备课」页的任务中心安装') + (status.studioKey ? '；导播台 AI 接口已配置' : '；导播台 AI 接口未配置') : '…'}</p>
      <div className="record-two"><label>模型<input value={s.model} placeholder="默认" onChange={(e) => setSettings({ model: e.target.value })} /></label>
        <label>思考深度<select value={s.effort} onChange={(e) => setSettings({ effort: e.target.value as typeof s.effort })}><option value="">默认</option><option value="low">快</option><option value="medium">适中</option><option value="high">深入（更慢、更贵）</option></select></label></div>
    </section>
    <section><h4>其他</h4>
      <label className="as-check"><input type="checkbox" checked={s.avatar} onChange={(e) => setSettings({ avatar: e.target.checked })} />右下角显示{s.name}</label>
      <button className="sd-btn" onClick={() => void host.call('assistant.workspace')}><FolderOpen size={13} />打开助教的工作目录（它做的文件在这里）</button>
    </section>
  </div>;
}

// ── 提醒 ─────────────────────────────────────────────
const WHEN_TYPES: [When['type'], string][] = [['before_lesson', '每节课前'], ['after_lesson', '每节课下课后'], ['daily', '每天 / 每周固定时间'], ['at', '某个时刻'], ['app_start', '打开软件时'], ['open_page', '打开某个页面时'], ['view_student', '切换到学生时'], ['import_questions', '导入题目时']];
function TriggersView() {
  const list = useAssistantData((s) => s.triggers), students = useStore((s) => s.students);
  const [edit, setEdit] = useState<Trigger | 'new' | null>(null), [del, setDel] = useState('');
  if (edit) return <TriggerForm base={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />;
  return <div className="as-trs">
    <p className="as-hint">提醒到点会在右下角冒泡；「交给助教去做」的会自动开始干活（花 AI 费用）。也可以直接对助教说「每次上课前 10 分钟提醒我……」。</p>
    <button className="sd-btn" onClick={() => setEdit('new')}><Plus size={13} />新建提醒</button>
    {list.map((t) => <div key={t.id} className={'as-tr' + (t.enabled ? '' : ' off')}>
      <div className="as-tr-m"><b>{t.name}{t.by === 'ai' && <em>助教建的</em>}</b><span>{whenText(t.when, students)} · {timesText(t)}</span><p>{t.action.type === 'remind' ? '提醒：' + t.action.text : '交给助教：' + t.action.prompt}</p></div>
      <div className="as-tr-b">
        <label className="as-switch" data-tip={t.enabled ? '暂停' : '启用'}><input type="checkbox" checked={t.enabled} onChange={(e) => putTrigger({ ...t, enabled: e.target.checked, ...(e.target.checked && t.times !== 'every' && t.fired >= (t.times === 'once' ? 1 : t.times) ? { fired: 0 } : {}) })} /><i /></label>
        <button className="as-mini" aria-label="编辑" onClick={() => setEdit(t)}><Pencil size={12} /></button>
        {del === t.id ? <button className="as-mini danger" onClick={() => { removeTrigger(t.id); setDel(''); }}>删除</button> : <button className="as-mini" aria-label="删除" onClick={() => setDel(t.id)}><Trash2 size={12} /></button>}
      </div>
    </div>)}
    {!list.length && <div className="as-empty">还没有提醒。</div>}
  </div>;
}

function TriggerForm({ base, onDone }: { base: Trigger | null; onDone: () => void }) {
  const all = useStore((s) => s.students), students = all.filter((x) => !x.archived);
  const w = (base?.when ?? { type: 'before_lesson', minutes: 10 }) as When & Record<string, unknown>;
  const [type, setType] = useState<When['type']>(w.type), [minutes, setMinutes] = useState(String(w.minutes ?? 10)), [student, setStudent] = useState(String(w.student ?? ''));
  const [time, setTime] = useState(String(w.time ?? '20:00')), [days, setDays] = useState<number[]>((w.weekdays as number[]) ?? []), [at, setAt] = useState(String(w.datetime ?? ''));
  const [page, setPage] = useState(String(w.page ?? 'study'));
  const [act, setAct] = useState<'remind' | 'assistant'>(base?.action.type ?? 'remind'), [body, setBody] = useState(base ? (base.action.type === 'remind' ? base.action.text : base.action.prompt) : '');
  const [times, setTimes] = useState(String(base?.times ?? 'every')), [name, setName] = useState(base?.name ?? ''), [err, setErr] = useState('');
  const save = () => {
    try {
      const when: Record<string, unknown> = { type };
      if (type === 'before_lesson' || type === 'after_lesson') { when.minutes = Number(minutes) || 0; if (student) when.student = student; }
      if (type === 'daily') { when.time = time; if (days.length) when.weekdays = days; }
      if (type === 'at') when.datetime = at;
      if (type === 'open_page') when.page = page;
      if (type === 'view_student' && student) when.student = student;
      const t = cleanTrigger({ name, when, action: act === 'remind' ? { type: 'remind', text: body } : { type: 'assistant', prompt: body }, times: /^\d+$/.test(times) ? Number(times) : times }, { base: base ?? undefined, by: 'teacher' });
      putTrigger(base ? { ...t, when: t.when, action: t.action, times: t.times, name: name.trim() || t.name } : t); onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return <div className="as-set">
    <section><h4>{base ? '编辑提醒' : '新建提醒'}</h4>
      <label>什么时候<select value={type} onChange={(e) => setType(e.target.value as When['type'])}>{WHEN_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
      {(type === 'before_lesson' || type === 'after_lesson') && <div className="record-two"><label>{type === 'before_lesson' ? '提前几分钟' : '下课后几分钟（0 = 下课时）'}<input type="number" min={0} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label><label>哪位学生<select value={student} onChange={(e) => setStudent(e.target.value)}><option value="">所有学生</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>}
      {type === 'daily' && <><label>时间<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label><div className="as-days">{['一', '二', '三', '四', '五', '六', '日'].map((d, i) => <button key={d} className={days.includes(i + 1) ? 'on' : ''} onClick={() => setDays(days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1])}>周{d}</button>)}<i>{days.length ? '' : '不选 = 每天'}</i></div></>}
      {type === 'at' && <label>时刻<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>}
      {type === 'open_page' && <label>页面<select value={page} onChange={(e) => setPage(e.target.value)}>{Object.entries(PAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {type === 'view_student' && <label>哪位学生<select value={student} onChange={(e) => setStudent(e.target.value)}><option value="">任何学生</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <div className="as-radio two">{([['remind', '提醒我', '冒泡说一句话'], ['assistant', '交给助教去做', '自动开始干活，会花 AI 费用']] as const).map(([k, n, d]) => <button key={k} className={act === k ? 'on' : ''} onClick={() => setAct(k)}><b>{n}</b><span>{d}</span></button>)}</div>
      <label>{act === 'remind' ? '提醒的话' : '让助教做什么'}<textarea rows={3} value={body} placeholder={act === 'remind' ? '例如：看一下这位学生上次的错题' : '例如：给这节课的学生写课后总结，打开发给家长的预览'} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="record-two"><label>触发几次<select value={/^\d+$/.test(times) ? 'n' : times} onChange={(e) => setTimes(e.target.value === 'n' ? '3' : e.target.value)}><option value="every">每次</option><option value="once">只一次</option><option value="n">指定次数</option></select></label>
        {/^\d+$/.test(times) && <label>次数<input type="number" min={2} max={999} value={times} onChange={(e) => setTimes(e.target.value.replace(/\D/g, '') || '2')} /></label>}</div>
      <label>名字（可不填）<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      {err && <p className="sd-err">{err}</p>}
      <div className="record-actions"><button onClick={onDone}>取消</button><button className="btn-cue" onClick={save}>保存</button></div>
    </section>
  </div>;
}

// ── 发给家长 ─────────────────────────────────────────
function ParentHost() {
  const p = useAssistant((s) => s.parent)!;
  const sent = useRef<SendRecord[]>([]);
  useEffect(() => { void useNotify.getState().refresh(); }, []);
  return <SendSheet note={p.lesson} student={p.student} image=""
    makeImage={async () => { const r = await lessonDocument(p.lesson, p.student.name, ['png']); const f = r.out.find((x) => x.endsWith('.png')); if (!f) throw Error(r.errors[0] || '没有生成长图'); return f; }}
    onSent={(r) => { sent.current.push(...r); useStudy.getState().update((d) => ({ ...d, lessons: d.lessons.map((l) => (l.id === p.lesson.id ? { ...l, sends: [...(l.sends ?? []), ...r].slice(-30) } : l)) })); }}
    onClose={() => closeParent(sent.current)} />;
}
