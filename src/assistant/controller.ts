// AI 助教在教师窗口里的一端：接主进程推来的对话事件，执行工具调用，管确认 / 审批 / 撤销，调度提醒。
import { create } from 'zustand';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { useStudy } from '../lib/studyStore';
import { toast } from '../lib/toast';
import type { LessonNote, SendRecord } from '../lib/studyLogic';
import type { Student } from '../lib/types';
import { packOf, studentSubject } from '../lib/subjects';
import { isDefaultTopic, isGroup, kindName, membersOf } from '../lib/groups';
import { dateKey } from '../doc/scheduleModel';
import { baseInstructions, developerInstructions, hello } from './prompt';
import { box, runTool, toolSpecs, toolsSignature, type ToolCtx } from './tools';
import { changeSummary, occurrences, undoChanges, WEEK, type Change } from './toolsLogic';
import { afterFire, dueEvent, dueTimed, PAGES, whenText, type AppEvent, type Fire } from './triggersLogic';
import { loadAssistantData, putTrigger, setCurrent, useAssistantData, type Access } from './state';

export interface Meta { id: string; title: string; created: number; updated: number; running: boolean; cny: number; source: string; persona: string; count: number }
export interface Item {
  id: string; kind: 'user' | 'text' | 'cmd' | 'file' | 'tool' | 'approval' | 'note' | 'error'; turn: string; at: number;
  text?: string; files?: string[] | { path: string; kind: string }[]; phase?: string; streaming?: boolean;
  command?: string; status?: string; exit?: number | null; output?: string;
  name?: string; args?: unknown; card?: { title: string; lines?: string[]; files?: string[]; tone?: string } | null; undoable?: boolean;
  type?: string; title?: string; detail?: string; reason?: string; questions?: { id: string; header: string; question: string; options: { label: string; description: string }[]; secret: boolean }[]; answers?: Record<string, string> | null;
}
export interface Turn { id: string; at: number; status: string; changes: Change[]; cny: number; undone?: number }
interface Chat extends Meta { items: Item[]; turns: Turn[] }
export interface Status { found: boolean; where: string; version: string; studioKey: boolean; running: boolean; workspace: string }
interface Ask { reqId: string; chatId: string; kind: 'tool' | 'approval'; tool?: string; args?: unknown; callId?: string; turnId?: string; itemId?: string }
export interface Confirm { id: string; chatId: string; title: string; detail: string; yes: string; resolve: (ok: boolean) => void }
export interface GrantReq { id: string; chatId: string; paths: string[]; reason: string; resolve: (paths: string[]) => void }
export interface ParentReq { chatId: string; lesson: LessonNote; student: Student; resolve: (r: SendRecord[]) => void }
export interface Bubble { id: number; text: string; title?: string; studentId?: string; chatId?: string }

interface State {
  status: Status | null; chats: Meta[]; chat: Chat | null; open: boolean; view: 'chat' | 'list' | 'settings' | 'triggers';
  confirms: Confirm[]; grants: GrantReq[]; parent: ParentReq | null; approvals: Record<string, string>;
  bubble: Bubble | null; error: string; busy: boolean; granted: Record<string, string[]>; ready: boolean;
}
export const useAssistant = create<State>()(() => ({ status: null, chats: [], chat: null, open: false, view: 'chat', confirms: [], grants: [], parent: null, approvals: {}, bubble: null, error: '', busy: false, granted: {}, ready: false }));
const G = () => useAssistant.getState();
const set = useAssistant.setState;
const call = <T>(m: string, v?: unknown) => host.call<T>('assistant.' + m, v);
const rid = () => Math.random().toString(36).slice(2, 10);
const norm = (p: string) => p.replace(/\\/g, '/');

// ── 启动 ─────────────────────────────────────────────
let started = false;
export function startAssistant() {
  if (started || !host.electron) return;
  started = true;
  host.onEvent((e) => { if (e?.type === 'assistant' && e.assistant) onEvent(e.assistant); });
  void (async () => {
    await loadAssistantData();
    try {
      const [status, chats] = await Promise.all([call<Status>('status'), call<Meta[]>('list')]);
      set({ status, chats, ready: true });
      const cur = useAssistantData.getState().current;
      if (cur && chats.some((c) => c.id === cur)) await openChat(cur, false);
      for (const a of await call<Ask[]>('pending')) void onAsk(a);
    } catch (e) { set({ error: (e as Error).message, ready: true }); }
    startTriggers();
  })();
}
export const refreshStatus = async () => { try { set({ status: await call<Status>('status') }); } catch { /* 主进程没准备好 */ } };

// ── 主进程推来的事件 ────────────────────────────────────
type Ev = { ev: string; chat?: Meta; chatId?: string; item?: Item; itemId?: string; delta?: string; turn?: Turn; id?: string; ask?: Ask; reqId?: string };
function onEvent(m: Ev) {
  const s = G(), cur = s.chat && s.chat.id === m.chatId ? s.chat : null;
  switch (m.ev) {
    case 'chat': {
      const c = m.chat!;
      set({ chats: [c, ...s.chats.filter((x) => x.id !== c.id)].sort((a, b) => b.updated - a.updated), ...(s.chat && s.chat.id === c.id ? { chat: { ...s.chat, ...c } } : {}) });
      if (!c.running) drainQueue();
      break;
    }
    case 'item': {
      const it = m.item;
      if (!cur || !it) break;
      const i = cur.items.findIndex((x) => x.id === it.id);
      set({ chat: { ...cur, items: i >= 0 ? cur.items.map((x, k) => (k === i ? it : x)) : [...cur.items, it] } });
      break;
    }
    case 'delta': if (cur) set({ chat: { ...cur, items: cur.items.map((x) => (x.id === m.itemId ? { ...x, text: (x.text ?? '') + (m.delta ?? '') } : x)) } }); break;
    case 'drop': if (cur) set({ chat: { ...cur, items: cur.items.filter((x) => x.id !== m.itemId) } }); break;
    case 'turn': {
      const t = m.turn;
      if (!cur || !t) break;
      const turns = cur.turns.some((x) => x.id === t.id) ? cur.turns.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : [...cur.turns, t];
      set({ chat: { ...cur, turns } });
      if (t.status !== 'running') void refreshChat(cur.id);
      break;
    }
    case 'removed': set({ chats: s.chats.filter((x) => x.id !== m.id), ...(s.chat?.id === m.id ? { chat: null } : {}) }); break;
    case 'ask': void onAsk(m.ask!); break;
    case 'askDone': {
      const id = m.reqId!;
      for (const c of s.confirms.filter((x) => x.id === id)) c.resolve(false);
      for (const g of s.grants.filter((x) => x.id === id)) g.resolve([]);
      if (s.parent && pendingParent === id) { s.parent.resolve([]); set({ parent: null }); }
      set((x) => ({ confirms: x.confirms.filter((c) => c.id !== id), grants: x.grants.filter((g) => g.id !== id), approvals: Object.fromEntries(Object.entries(x.approvals).filter(([, v]) => v !== id)) }));
      break;
    }
  }
}
async function refreshChat(id: string) {
  if (G().chat?.id !== id) return;
  try { const c = await call<Chat>('get', { id }); if (G().chat?.id === id) set({ chat: { ...G().chat!, ...c } }); } catch { /* 已删除 */ }
}

// ── 工具调用、审批 ─────────────────────────────────────
let pendingParent = '';
async function onAsk(a: Ask) {
  if (a.kind === 'approval') {
    if (a.itemId) set((s) => ({ approvals: { ...s.approvals, [a.itemId!]: a.reqId } }));
    pop({ text: '需要你点一下确认', chatId: a.chatId });
    return;
  }
  const access = useAssistantData.getState().settings.access;
  const askGrant = (o: { paths: string[]; reason: string }) => new Promise<string[]>((resolve) => { set((s) => ({ grants: [...s.grants, { id: a.reqId, chatId: a.chatId, ...o, resolve }] })); pop({ text: '想看你电脑上的文件，需要你同意', chatId: a.chatId }); });
  const ctx: ToolCtx = {
    chatId: a.chatId,
    // 完全访问：删除也不再问（这一轮整体能撤销）
    confirm: (o) => access === 'full' ? Promise.resolve(true) : new Promise((resolve) => { set((s) => ({ confirms: [...s.confirms, { id: a.reqId, chatId: a.chatId, title: o.title, detail: o.detail, yes: o.yes ?? '确定', resolve }] })); pop({ text: o.title, chatId: a.chatId }); }),
    sendParent: (o) => new Promise((resolve) => { pendingParent = a.reqId; set({ parent: { chatId: a.chatId, ...o, resolve } }); }),
    granted: () => G().granted[a.chatId] ?? [],
    grant: async (o) => {
      const free = access === 'full' || (access === 'common' && o.paths.length > 0 && o.paths.every((p) => inside(p, freeRoots())));
      if (!free || !o.paths.length) return askGrant(o);
      const got: string[] = [];
      for (const p of o.paths) { try { got.push(await call<string>('grant', { path: p })); } catch { /* 不存在的路径跳过 */ } }
      if (!got.length) return askGrant(o);
      addGranted(a.chatId, got);
      return got;
    },
  };
  const r = await runTool(String(a.tool), a.args, ctx);
  await call('reply', { reqId: a.reqId, value: r }).catch(() => {});
}
export function answerConfirm(id: string, ok: boolean) {
  const c = G().confirms.find((x) => x.id === id); if (!c) return;
  set((s) => ({ confirms: s.confirms.filter((x) => x !== c) }));
  c.resolve(ok);
}
export function closeParent(r: SendRecord[]) {
  const p = G().parent; if (!p) return;
  set({ parent: null }); pendingParent = '';
  p.resolve(r);
}
const addGranted = (chatId: string, paths: string[]) => set((s) => ({ granted: { ...s.granted, [chatId]: [...new Set([...(s.granted[chatId] ?? []), ...paths.map(norm)])] } }));
/** 老师在请求卡片上点了：同意（给的路径）/ 自己选文件 / 拒绝 */
export async function answerGrant(id: string, how: 'yes' | 'pick' | 'no') {
  const g = G().grants.find((x) => x.id === id); if (!g) return;
  let paths: string[] = [];
  try {
    if (how === 'yes') for (const p of g.paths) paths.push(await call<string>('grant', { path: p }));
    if (how === 'pick') paths = await call<string[]>('pickFiles');
  } catch (e) { toast('有的路径打不开：' + (e as Error).message); }
  if (how === 'pick' && !paths.length) return;
  set((s) => ({ grants: s.grants.filter((x) => x !== g) }));
  if (paths.length) addGranted(g.chatId, paths);
  g.resolve(paths);
}
export async function answerApproval(itemId: string, choice: 'accept' | 'session' | 'decline', answers?: Record<string, string>) {
  const reqId = G().approvals[itemId]; if (!reqId) return;
  set((s) => ({ approvals: Object.fromEntries(Object.entries(s.approvals).filter(([k]) => k !== itemId)) }));
  await call('reply', { reqId, value: { choice, answers } }).catch((e) => toast((e as Error).message));
}

// ── 对话 ─────────────────────────────────────────────
export async function openChat(id: string, show = true) {
  const c = await call<Chat>('get', { id });
  set({ chat: c, view: 'chat', ...(show ? { open: true } : {}) });
  setCurrent(id);
}
export async function newChat(o: { title?: string; source?: string } = {}) {
  const meta = await call<Meta>('create', { persona: useAssistantData.getState().settings.persona, ...o });
  if (!o.source) { set({ chat: { ...meta, items: [], turns: [] }, view: 'chat' }); setCurrent(meta.id); }
  return meta;
}
export async function removeChat(id: string) { await call('remove', { id }); if (useAssistantData.getState().current === id) setCurrent(''); }
export const renameChat = (id: string, title: string) => call('rename', { id, title });
export function openAssistant(view: State['view'] = 'chat') { set({ open: true, view, bubble: null }); }
export const closeAssistant = () => set({ open: false });
export const helloText = () => { const s = useAssistantData.getState().settings; return hello(s.persona, s.name); };

/** 每轮附在老师的话前面：软件现在的状态（老师看不到） */
export function contextText(files: string[] = []): string {
  const st = useStore.getState(), now = new Date(), stu = st.students.find((x) => x.id === st.studentId);
  const next = occurrences(st.slots, st.students, now, 2).filter((o) => o.date > dateKey(now) || o.time.split('–')[1] >= now.toTimeString().slice(0, 5)).slice(0, 4);
  return [
    `【软件状态（自动附上，老师看不到）】现在 ${dateKey(now)} ${WEEK[(now.getDay() + 6) % 7]} ${now.toTimeString().slice(0, 5)}`,
    `页面：${PAGES[st.page]}；当前${stu && isGroup(stu) ? `班组：${stu.name}（${kindName(stu.kind)}，成员 ${membersOf(stu, st.students).map((m) => m.name).join('、') || '还没有'}，${stu.grade}·${packOf(studentSubject(stu)).stage}，id=${stu.id}）` : `学生：${stu ? `${stu.name}（${stu.grade}·${packOf(studentSubject(stu)).stage}，id=${stu.id}）` : '自由课堂（没绑学生）'}`}；学生画面：${st.pgmMat.title}`,
    next.length ? '接下来的课：' + next.map((o) => `${o.date === dateKey(now) ? '今天' : '明天'} ${o.time} ${o.student}${o.group ? `（${o.group}：${(o.members ?? []).join('、')}）` : ''}${!isDefaultTopic(o.topic) ? '（' + o.topic + '）' : ''}`).join('；') : '今明两天没有课',
    files.length ? '老师附上的文件（已同意，可以直接 read_file）：' + files.join('；') : '',
    ACCESS_TEXT[useAssistantData.getState().settings.access],
  ].filter(Boolean).join('\n');
}
const ACCESS_TEXT: Record<Access, string> = {
  ask: '权限：每次都问。看文件前先 request_computer_access；运行命令、改文件都会弹窗请老师确认。',
  common: '权限：常用。你的工作目录里随便做文件、跑命令、联网查资料；老师的课件目录、学生资料可以直接 read_file；要改工作目录以外的文件或运行越出沙箱的命令时会请老师确认。',
  full: '权限：完全访问（老师开的）。电脑上的文件可以直接读写、命令直接运行，不会再弹确认；动手前想清楚，删除和覆盖老师的原文件前先在回复里说明。',
};
/** 常用权限下不用问就能看的地方：课件目录、学生关联的资料文件夹、软件自己的数据目录 */
function freeRoots() {
  const st = useStore.getState();
  return [...st.roots, ...st.students.map((s) => s.folder ?? ''), host.dataDir].filter(Boolean).map((r) => norm(r).replace(/\/?$/, '/').toLowerCase());
}
const inside = (p: string, roots: string[]) => { const x = norm(p).toLowerCase(); return roots.some((r) => x.startsWith(r) || x + '/' === r); };

function apiFlag() { const a = useAssistantData.getState().settings.api; return a === 'studio' ? true : a === 'own' ? false : undefined; }

/** 发一句话；没有对话就开一段新的 */
export async function send(text: string, o: { files?: string[]; images?: string[]; chatId?: string; quiet?: boolean } = {}) {
  const t = text.trim();
  if (!t) return;
  set({ error: '', busy: true });
  try {
    let id = o.chatId ?? G().chat?.id;
    if (!id) id = (await newChat()).id;
    const files = (o.files ?? []).map(norm);
    if (files.length) addGranted(id, files);
    const d = useAssistantData.getState(), s = d.settings;
    const stu = useStore.getState().students.find((x) => x.id === useStore.getState().studentId);
    await call('send', {
      id, text: t, files, images: o.images ?? files.filter((f) => /\.(png|jpe?g|webp|bmp)$/i.test(f)).slice(0, 4),
      context: contextText(files), base: baseInstructions(s.name),
      developer: developerInstructions({ name: s.name, persona: s.persona, custom: s.custom, memory: d.memory, subjectHint: stu ? packOf(studentSubject(stu)).stage : '' }),
      tools: toolSpecs(), toolsSig: toolsSignature(), model: s.model || undefined, effort: s.effort || undefined, studio: apiFlag(), access: s.access,
    });
  } catch (e) {
    set({ error: (e as Error).message });
    if (o.quiet) throw e;
  } finally { set({ busy: false }); }
}
export async function stop() { const c = G().chat; if (c) await call('stop', { id: c.id }).catch(() => {}); }

/** 撤销一轮：每条记录放回去；老师之后自己改过的不动 */
export async function undoTurn(turnId: string) {
  const c = G().chat; if (!c) return;
  const t = c.turns.find((x) => x.id === turnId); if (!t || t.undone) return;
  const r = undoChanges(t.changes, box);
  const note = `已撤销这一轮：${changeSummary(t.changes) || '没有改动'}` + (r.skipped.length ? `（${r.skipped.length} 处你之后又改过，保留了你的修改）` : '');
  await call('undone', { id: c.id, turnId, note });
  await refreshChat(c.id);
  toast(note);
}

// ── 提醒和定时任务 ─────────────────────────────────────
const queue: { chatId: string; text: string }[] = [];
let draining = false;
function drainQueue() {
  const next = queue[0]; if (!next || draining) return;
  if (G().chats.find((c) => c.id === next.chatId)?.running) return;
  queue.shift(); draining = true;
  void send(next.text, { chatId: next.chatId, quiet: true }).catch((e) => pop({ title: '定时任务没有执行', text: (e as Error).message })).finally(() => { draining = false; });
}
let taskChat = '';
async function taskChatId() {
  if (taskChat && G().chats.some((c) => c.id === taskChat)) return taskChat;
  const old = G().chats.find((c) => c.source === 'trigger');
  taskChat = old?.id ?? (await newChat({ title: '提醒和定时任务', source: 'trigger' })).id;
  return taskChat;
}

export function pop(b: Omit<Bubble, 'id'>) { set({ bubble: { id: Date.now(), ...b } }); }
export const dismissBubble = () => set({ bubble: null });

async function fire(list: Fire[]) {
  const now = new Date(), st = useStore.getState();
  for (const f of list) {
    putTrigger(afterFire(useAssistantData.getState().triggers.find((t) => t.id === f.t.id) ?? f.t, f.key, now));
    const stu = f.studentId ? st.students.find((s) => s.id === f.studentId) : undefined;
    const head = whenText(f.t.when, st.students) + (f.note ? '：' + f.note : '');
    if (f.t.action.type === 'remind') {
      pop({ title: f.t.name, text: f.t.action.text + (f.note ? `（${f.note}）` : ''), studentId: f.studentId });
      if (!useAssistantData.getState().settings.avatar || G().open) toast(`提醒：${f.t.action.text}`, { ms: 15000 });
      continue;
    }
    try {
      const id = await taskChatId();
      const text = `【定时任务「${f.t.name}」触发｜${head}${stu ? `｜学生：${stu.name}（id=${stu.id}）` : ''}】\n${f.t.action.prompt}`;
      queue.push({ chatId: id, text });
      pop({ title: '定时任务开始了', text: f.t.name, chatId: id });
      drainQueue();
    } catch (e) { pop({ title: '定时任务没有执行', text: (e as Error).message }); }
  }
}
/** 软件里发生的事（打开软件、换页、换学生、导入题目） */
export function appEvent(e: AppEvent) {
  const d = useAssistantData.getState();
  if (!d.loaded) return;
  const due = dueEvent(d.triggers, e, new Date());
  if (due.length) void fire(due);
}
let triggersOn = false;
function startTriggers() {
  if (triggersOn) return;
  triggersOn = true;
  const tick = () => { const st = useStore.getState(), due = dueTimed(useAssistantData.getState().triggers, new Date(), st.slots, st.students); if (due.length) void fire(due); };
  window.setTimeout(() => { appEvent({ type: 'app_start' }); tick(); }, host.test ? 500 : 4000);
  window.setInterval(tick, host.test ? 2000 : 30_000);
  useStore.subscribe((s, p) => {
    if (s.page !== p.page) appEvent({ type: 'open_page', page: s.page });
    if (s.studentId !== p.studentId && s.studentId !== 'free') appEvent({ type: 'view_student', studentId: s.studentId });
  });
  // 新导入的一批题（同一个 batch）：等 3 秒收齐再触发一次
  const seen = new Set(useStudy.getState().data.questions.map((q) => q.batch).filter(Boolean) as string[]);
  let loaded = useStudy.getState().loaded, wait = 0;
  useStudy.subscribe((s) => {
    if (!s.loaded) return;
    if (!loaded) { loaded = true; s.data.questions.forEach((q) => q.batch && seen.add(q.batch)); return; }
    const fresh = [...new Set(s.data.questions.map((q) => q.batch).filter((b): b is string => !!b && !seen.has(b)))];
    if (!fresh.length) return;
    clearTimeout(wait);
    wait = window.setTimeout(() => {
      for (const b of fresh) { if (seen.has(b)) continue; seen.add(b); appEvent({ type: 'import_questions', batch: b, count: useStudy.getState().data.questions.filter((q) => q.batch === b).length }); }
    }, 3000);
  });
}
