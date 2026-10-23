// 插件桥：插件页面（plugin://<id>/，独立来源的 iframe）通过 postMessage 请导播台办事。
// 每次调用都核对：消息确实来自页面里的某个插件框架、来源和框架地址对得上、plugin.json 申请过对应权限。
import { host } from '../lib/host';
import { inkKey, useStore } from '../lib/store';
import { BASE } from '../lib/desk';
import { resolveColor, PEN_COLORS } from '../lib/palette';
import { toast } from '../lib/toast';
import { pasteToBoard } from '../ink/pasteImage';
import { freshId } from '../ink/geometry';
import { openMaterial } from '../doc/actions';
import type { FileEntry } from '../lib/library';
import type { Stroke } from '../lib/types';
import { addQuestion, useStudy } from '../lib/studyStore';
import { guessPoints } from '../lib/studyLogic';
import { ai } from '../lib/ai';
import { manifestOf, type Manifest, type Permission } from './pluginStore';

export type Where = 'console' | 'dock' | 'page' | 'lesson' | 'preview';
export interface FrameHooks { where: Where; onClose?: () => void; onResize?: (w: number, h: number) => void; onToast?: (text: string) => void }

const frames = new Map<HTMLIFrameElement, FrameHooks>();
/** 插件宿主组件挂上 iframe 时登记；没登记的插件框架（学生画面上的课件页）按 lesson 处理 */
export function registerFrame(el: HTMLIFrameElement, hooks: FrameHooks) { frames.set(el, hooks); return () => { frames.delete(el); }; }
export function updateFrame(el: HTMLIFrameElement, hooks: Partial<FrameHooks>) { const h = frames.get(el); if (h) Object.assign(h, hooks); }

const NEED: Record<string, Permission | null> = {
  'app.info': null, 'student.current': 'student', 'board.addText': 'board', 'board.addImage': 'board', 'present.open': 'present',
  'bank.list': 'bank.read', 'bank.add': 'bank.write', 'ai.chat': 'ai', 'ai.image': 'ai.image', 'files.pick': 'files',
  'storage.get': null, 'storage.set': null, 'storage.remove': null, 'storage.keys': null, 'ui.toast': null, 'ui.close': null, 'ui.resize': null,
};
/** 学生画面（学生窗口）里只能读写自己的数据：其它操作都是老师的事 */
const STUDENT_OK = new Set(['app.info', 'storage.get', 'storage.keys', 'ui.toast']);

const THEME: [string, string][] = [
  ['--cs-bg', '--bg-1'], ['--cs-bg-2', '--bg-2'], ['--cs-bg-3', '--bg-3'], ['--cs-line', '--line'], ['--cs-fg', '--fg-0'], ['--cs-fg-2', '--fg-1'],
  ['--cs-fg-3', '--fg-2'], ['--cs-accent', '--cue'], ['--cs-accent-soft', '--cue-soft'], ['--cs-ok', '--ok'], ['--cs-warn', '--warn'], ['--cs-danger', '--live'],
];
function theme() {
  const cs = getComputedStyle(document.documentElement), out: Record<string, string> = {};
  for (const [to, from] of THEME) { const v = cs.getPropertyValue(from).trim(); if (v) out[to] = v; }
  return { vars: out, scheme: cs.colorScheme === 'light' ? 'light' : 'dark' };
}

function frameOf(source: MessageEventSource | null) {
  if (!source) return null;
  for (const el of document.querySelectorAll('iframe')) if (el.contentWindow === source) return el;
  return null;
}

function pluginIdOf(el: HTMLIFrameElement, origin: string) {
  let u: URL; try { u = new URL(el.src); } catch { return null; }
  if (u.protocol !== 'plugin:' || origin !== `plugin://${u.host}`) return null;
  return u.host;
}

type Ctx = { id: string; manifest: Manifest | null; el: HTMLIFrameElement; hooks: FrameHooks };

/** 插件给的相对路径 → plugin://<id>/路径（不允许跑到别的插件里） */
function ownUrl(c: Ctx, rel: string) {
  const u = new URL(String(rel || ''), c.el.src);
  if (u.protocol !== 'plugin:' || u.host !== c.id) throw new Error('只能使用插件自己的文件');
  return u.href.split('#')[0];
}

const SIZES: Record<string, number> = { s: 3, m: 4.5, l: 7, xl: 10 };
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);

function boardTarget() {
  const st = useStore.getState();
  if (st.pgmMat.kind !== 'board') st.focusWin(BASE);
  const { pgmMat, pgm } = useStore.getState();
  const page = pgmMat.pages[pgm.page] ?? pgmMat.pages[0];
  return { key: inkKey(pgmMat.id, pgm.page), ratio: page.h / page.w, view: pgm };
}

function addText(a: Record<string, unknown>) {
  const text = str(a.text, 2000).trim();
  if (!text) throw new Error('文字是空的');
  const size = typeof a.size === 'number' ? Math.max(2, Math.min(14, a.size)) : SIZES[String(a.size)] ?? SIZES.m;
  const color = typeof a.color === 'string' && (PEN_COLORS.some((p) => p.id === a.color) || /^#[0-9a-f]{6}$/i.test(a.color)) ? a.color : 'ink';
  const { key, ratio, view } = boardTarget();
  const [rx, ry, rw, rh] = view.fit === 'region' && view.region ? view.region : [0, 0, 1, 1];
  // 同一插件连续写：一行行往下排，不叠在一起
  const mine = (useStore.getState().ink[key] ?? []).filter((s) => s.tool === 'text' && s.author === 'teacher' && s.id.startsWith('pl-'));
  const lineH = Math.max(0.016, size * 0.008) * 1.35;
  let y = ry * ratio + rh * ratio * 0.08;
  for (const s of mine) if (s.pts[0] < rx + rw * 0.2 && s.pts[1] >= y - 1e-6) y = Math.max(y, s.pts[1] + lineH * ((s.text ?? '').split('\n').length) + lineH * 0.4);
  if (y > (ry + rh) * ratio - lineH) y = ry * ratio + rh * ratio * 0.08;
  const stroke: Stroke = { id: 'pl-' + freshId(), tool: 'text', color, size, pts: [rx + rw * 0.06, y, .5], text, author: 'teacher', layer: 'public' };
  useStore.getState().addStroke(key, stroke);
  return { id: stroke.id };
}

/** SVG 里的 currentColor 换成黑板墨色（深色黑板是浅色笔），再按大尺寸栅格化，贴上去不糊 */
async function svgData(svg: string) {
  const st = useStore.getState(), ink = resolveColor('ink', st.boardSkin, false);
  const doc = new DOMParser().parseFromString(svg.replace(/currentColor/g, ink), 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg') throw new Error('SVG 格式不对');
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const w0 = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(root.getAttribute('width') || '300'), h0 = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(root.getAttribute('height') || '150');
  const k = 1200 / Math.max(w0, h0);
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w0} ${h0}`);
  root.setAttribute('width', String(Math.round(w0 * k))); root.setAttribute('height', String(Math.round(h0 * k)));
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
}

/** shape：绘图库里的插件图形，裁掉四周空白；黑色线稿在深色黑板上自动变粉笔色 */
export async function imageToBoard(src: string, note?: string, shape = false) {
  let data = src;
  if (/^plugin:/i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error('图片读取失败');
    if (/svg/i.test(res.headers.get('content-type') || '') || /\.svg$/i.test(new URL(src).pathname)) data = await svgData(await res.text());
    else data = URL.createObjectURL(await res.blob());
  } else if (/^data:image\/svg\+xml/i.test(src)) {
    const body = src.slice(src.indexOf(',') + 1);
    data = await svgData(/;base64,/i.test(src.slice(0, src.indexOf(',') + 1)) ? decodeURIComponent(escape(atob(body))) : decodeURIComponent(body));
  } else if (!/^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(src)) throw new Error('图片只能是 data: 地址或插件自己的文件');
  try { return await pasteToBoard(data, { note: note ?? '已放到黑板，可以拖动、缩放，上面也能写字', trim: shape, tint: shape }); }
  finally { if (data.startsWith('blob:')) URL.revokeObjectURL(data); }
}

async function presentOpen(c: Ctx, a: Record<string, unknown>, target: 'student' | 'teacher' = 'student') {
  const url = ownUrl(c, str(a.page, 200) || 'index.html');
  if (!/\.html?(\?|$)/i.test(new URL(url).pathname)) throw new Error('只能投屏插件里的网页');
  const title = str(a.title, 40) || c.manifest?.name || '插件';
  const entry: FileEntry = { id: url, path: url, name: title, title, kind: 'html', size: 0, folder: 'loose:', ext: '.html' };
  const mat = await openMaterial(entry, target);
  if (!mat) throw new Error('没能打开这个页面');
  return true;
}

async function bankList(a: Record<string, unknown>) {
  if (host.role !== 'teacher') throw new Error('题库只能在导播台主窗口里读取');
  const q = str(a.query, 60).trim(), subject = str(a.subject, 20), limit = Math.max(1, Math.min(200, Number(a.limit) || 50));
  return useStudy.getState().data.questions
    .filter((x) => x.status === 'bank' && (!subject || x.subject === subject) && (!q || x.stem.includes(q)))
    .slice(-limit).reverse()
    .map((x) => ({ id: x.id, stem: x.stem, answer: x.answer ?? '', analysis: x.analysis ?? '', subject: x.subject ?? '', qtype: x.qtype, difficulty: x.difficulty, points: x.points, hasImage: !!x.image }));
}

async function bankAdd(c: Ctx, a: Record<string, unknown>) {
  if (host.role !== 'teacher') throw new Error('题库只能在导播台主窗口里写入');
  const stem = str(a.stem, 6000).trim();
  if (!stem) throw new Error('题干是空的');
  const subject = (str(a.subject, 20) || useStore.getState().subject) as never;
  const q = addQuestion({
    stem, answer: str(a.answer, 6000), analysis: str(a.analysis, 12000), points: guessPoints(stem, subject), subject,
    difficulty: Math.max(1, Math.min(5, Math.round(Number(a.difficulty) || 3))), qtype: str(a.qtype, 10) || '其他',
    origin: 'import', status: 'inbox', source: `插件「${c.manifest?.name ?? c.id}」`,
  });
  return { id: q.id, status: 'inbox' };
}

function cleanMessages(list: unknown) {
  if (!Array.isArray(list) || !list.length) throw new Error('messages 不能为空');
  return list.slice(-24).map((m) => {
    const role = ['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user';
    if (Array.isArray(m?.content)) return { role, content: m.content.filter((p: { type?: string; image_url?: { url?: string } }) => p?.type === 'text' || (p?.type === 'image_url' && /^data:image\//.test(String(p.image_url?.url)))).slice(0, 6) };
    return { role, content: str(m?.content, 20000) };
  });
}

async function handle(c: Ctx, method: string, a: Record<string, unknown>) {
  const feature = `插件·${c.manifest?.name ?? c.id}`.slice(0, 40);
  switch (method) {
    case 'app.info': return { app: '最强网课教辅系统', protocol: 'cs-plugin/1', where: c.hooks.where, subject: useStore.getState().subject, role: host.role ?? 'teacher' };
    case 'student.current': {
      const st = useStore.getState(), s = st.students.find((x) => x.id === st.studentId);
      return s ? { id: s.id, name: s.name, grade: s.grade, subject: st.subject } : { id: '', name: '', grade: '', subject: st.subject };
    }
    case 'board.addText': return addText(a);
    case 'board.addImage': {
      const src = str(a.src, 30 * 1024 * 1024);
      return { id: await imageToBoard(/^data:/i.test(src) ? src : ownUrl(c, src)) };
    }
    case 'present.open': return presentOpen(c, a);
    case 'bank.list': return bankList(a);
    case 'bank.add': return bankAdd(c, a);
    case 'ai.chat': {
      const r = await ai.chat(cleanMessages(a.messages) as never, { json: !!a.json, maxTokens: Math.min(8000, Number(a.maxTokens) || 2000), temperature: typeof a.temperature === 'number' ? a.temperature : 0.4, feature, model: a.model ? str(a.model, 120) : undefined, timeout: 5 * 60000 });
      return { content: r.content, model: r.model };
    }
    case 'ai.image': {
      const r = await host.call<{ image: string; model: string }>('ai.image', { prompt: str(a.prompt, 4000), size: a.size, model: a.model ? str(a.model, 120) : undefined, feature });
      return { image: r.image, model: r.model };
    }
    case 'files.pick': return host.call('plugins.pickFile', { accept: str(a.accept, 10), multiple: !!a.multiple, title: str(a.title, 40) });
    case 'storage.get': case 'storage.set': case 'storage.remove': case 'storage.keys':
      return host.call('plugins.storage', { id: c.id, op: method.slice(8), key: a.key, value: a.value });
    case 'ui.toast': {
      const text = str(a.text, 200);
      if (c.hooks.onToast) c.hooks.onToast(text); else if (host.role === 'teacher') toast(`${c.manifest?.name ?? '插件'}：${text}`, { ms: 5000 });
      return true;
    }
    case 'ui.close': c.hooks.onClose?.(); return true;
    case 'ui.resize': c.hooks.onResize?.(Number(a.width) || 0, Number(a.height) || 0); return true;
    default: throw new Error('不认识的接口：' + method);
  }
}

const reply = (src: MessageEventSource, m: Record<string, unknown>) => { try { (src as Window).postMessage({ __csp: 1, ...m }, '*'); } catch { /* 页面已关 */ } };

function sendInit(el: HTMLIFrameElement, id: string) {
  const hooks = frames.get(el) ?? { where: 'lesson' as Where }, m = manifestOf(id), t = theme();
  reply(el.contentWindow!, { t: 'event', name: 'init', data: { where: hooks.where, subject: useStore.getState().subject, scheme: t.scheme, theme: t.vars, plugin: m ? { id: m.id, name: m.name, version: m.version, permissions: m.permissions } : { id } } });
}

let installed = false;
export function installPluginBridge() {
  if (installed || !host.electron) return;
  installed = true;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__csp !== 1 || !e.source) return;
    const el = frameOf(e.source);
    if (!el) return;
    const id = pluginIdOf(el, e.origin);
    if (!id) return;
    if (d.t === 'ready') { sendInit(el, id); return; }
    if (d.t === 'error') {
      console.warn(`[插件 ${id}]`, d.message);
      if (!id.startsWith('dev-')) void host.call('plugins.error', { id, message: str(d.message, 600) }).catch(() => {});
      return;
    }
    if (d.t !== 'call') return;
    const method = str(d.method, 40), args = d.args && typeof d.args === 'object' ? d.args as Record<string, unknown> : {};
    const ctx: Ctx = { id, el, manifest: manifestOf(id), hooks: frames.get(el) ?? { where: 'lesson' } };
    const run = async () => {
      if (!(method in NEED)) throw new Error('不认识的接口：' + method);
      if (host.role === 'student' && !STUDENT_OK.has(method)) throw new Error('学生画面里的插件页面不能做这个操作');
      const need = NEED[method];
      if (need && !ctx.manifest?.permissions.includes(need)) throw new Error(`插件没有申请「${need}」权限（在 plugin.json 的 permissions 里加上）`);
      return handle(ctx, method, args);
    };
    void run().then((value) => reply(e.source!, { t: 'res', id: d.id, ok: true, value: value ?? null }), (err) => reply(e.source!, { t: 'res', id: d.id, ok: false, error: str((err as Error)?.message ?? err, 300) }));
  });
}

/** 换皮肤后通知已打开的插件页面 */
export function broadcastTheme() {
  const t = theme();
  for (const el of document.querySelectorAll('iframe')) {
    const id = (() => { try { const u = new URL(el.src); return u.protocol === 'plugin:' ? u.host : ''; } catch { return ''; } })();
    if (id && el.contentWindow) reply(el.contentWindow, { t: 'event', name: 'theme', data: { scheme: t.scheme, theme: t.vars } });
  }
}
