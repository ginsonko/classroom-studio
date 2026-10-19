// 课前检查：把本课流程里的课件逐个提前准备好。
// PPT / Word 提前转换、PDF 试读第一页、视频读一次信息（格式不支持会在这里暴露）；
// 网页课件在主进程的隐藏窗口里真正打开一遍，查打不开的文件、空白页。
// 准备好的课件留在内存缓存里，上课切过去不用再等；检查通过的本地网页课件交给学生窗口在后台预加载。
import { create } from 'zustand';
import { fileEntry, prepareMaterial, webEntry, type FileEntry } from './library';
import { host } from './host';
import { useStore } from './store';
import { errorText, useLib } from './useLib';
import type { Material } from './types';

export type CheckState = 'checking' | 'ok' | 'warn' | 'bad';
export interface ItemCheck { state: CheckState; text: string }
export interface FlowItem { id: string; ref: string; title: string; page: number; slide?: number; done: boolean; mat?: Material }
interface HtmlResult { state: 'ok' | 'warn' | 'bad'; text: string; ms: number }

export const FLOW_KEY = 'cs.lesson.flow';
export const useCheck = create<{ running: boolean; at: number; auto: boolean; items: Record<string, ItemCheck> }>(() => ({ running: false, at: 0, auto: false, items: {} }));

export function readFlow(): FlowItem[] {
  try { const v = JSON.parse(localStorage.getItem(FLOW_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

const KIND_OK: Partial<Record<FileEntry['kind'], (m: Material) => string>> = {
  slides: (m) => `PPT 已提前转换好（${m.total} 页）`,
  word: (m) => `Word 已提前转换好（${m.total} 页）`,
  pdf: (m) => `能正常打开（${m.total} 页）`,
  image: () => '图片正常',
  video: () => '视频能播放',
  audio: () => '音频能播放',
};

/** 备课项的 ref 是绝对路径或网址时（拖进来的、资料库已不包含的），直接按路径打开 */
export function pathEntry(ref: string): FileEntry | null {
  try { return /^https?:/i.test(ref) ? webEntry(ref) : /^([a-z]:)?[\\/]/i.test(ref) ? fileEntry(ref) : null; } catch { return null; }
}

/** 找到备课项对应的文件；黑板、演示这类不需要文件的返回 'none' */
function entryOf(it: FlowItem): FileEntry | null | 'none' {
  const known = useLib.getState().lib?.files.get(it.ref);
  if (known) return known;
  const p = it.mat?.src?.path;
  if (p) return /^https?:/i.test(p) ? webEntry(p) : fileEntry(p);
  const byPath = /^https?:/i.test(it.ref) || /^([a-z]:)?[\\/]/i.test(it.ref) ? it.ref : '';
  if (byPath) return /^https?:/i.test(byPath) ? webEntry(byPath) : fileEntry(byPath);
  if (['board', 'sim'].includes(it.ref) || it.mat?.kind === 'board' || it.mat?.kind === 'sim' || it.mat?.id.startsWith('anim:') || it.mat?.id.startsWith('sim:')) return 'none';
  return null;
}

export async function checkItem(it: FlowItem, onText?: (t: string) => void): Promise<ItemCheck> {
  let f: FileEntry | null | 'none';
  try { f = entryOf(it); } catch (e) { return { state: 'bad', text: errorText(e) }; }
  if (f === 'none') return { state: 'ok', text: '黑板 / 演示，不需要准备' };
  if (!f) return { state: 'bad', text: '找不到对应的原文件，请从资料库重新加入' };
  try {
    const mat = await prepareMaterial(f, (p) => onText?.(p.message || (p.stage === 'queued' ? '等待转换…' : '正在转换…')));
    if (f.kind === 'html') {
      onText?.('正在试开网页…');
      const r = await host.call<HtmlResult>('warmup.html', { path: f.path });
      return { state: r.state, text: r.text };
    }
    return { state: 'ok', text: KIND_OK[f.kind]?.(mat) ?? '可以使用' };
  } catch (e) {
    const msg = errorText(e);
    // 打开课件时的报错是写给"切给学生失败"场景的，课前检查里去掉那半句
    const text = msg.replace(/[；;]?\s*当前学生画面已保留。?/, '。').replace(/。+$/, '');
    if ((f.kind === 'video' || f.kind === 'audio') && /编码/.test(text)) return { state: 'bad', text: '播放不了：' + text.replace(/^浏览器/, '') };
    return { state: 'bad', text };
  }
}

/** 检查整个本课流程（已完成的项跳过）。同时只跑一轮 */
export async function checkFlow(opts: { auto?: boolean; flow?: FlowItem[] } = {}) {
  if (useCheck.getState().running || !host.electron) return;
  const flow = (opts.flow ?? readFlow()).filter((x) => !x.done);
  if (!flow.length) return;
  const put = (id: string, c: ItemCheck) => useCheck.setState((s) => ({ items: { ...s.items, [id]: c } }));
  useCheck.setState({ running: true, auto: !!opts.auto, items: Object.fromEntries(flow.map((x) => [x.id, { state: 'checking', text: '排队检查' } as ItemCheck])) });
  try {
    for (const it of flow) {
      put(it.id, { state: 'checking', text: '正在检查…' });
      put(it.id, await checkItem(it, (t) => put(it.id, { state: 'checking', text: t })));
    }
  } finally {
    useCheck.setState({ running: false, at: Date.now() });
  }
  preloadWeb(flow);
}

/** 检查通过的本地网页课件交给学生窗口后台加载（最多 3 个，按流程顺序） */
export function preloadWeb(flow: FlowItem[] = readFlow()) {
  const items = useCheck.getState().items, out: { path: string; title: string }[] = [];
  for (const it of flow) {
    if (it.done || out.length >= 3) continue;
    const c = items[it.id];
    if (!c || (c.state !== 'ok' && c.state !== 'warn')) continue;
    let f: FileEntry | null | 'none' = null;
    try { f = entryOf(it); } catch {}
    if (f && f !== 'none' && f.kind === 'html' && f.path && !/^https?:/i.test(f.path)) out.push({ path: f.path, title: f.title });
  }
  const cur = useStore.getState().warm ?? [];
  if (JSON.stringify(cur) !== JSON.stringify(out)) useStore.getState().setShared({ warm: out });
}

/** 一句话总结 */
export function checkSummary(items: Record<string, ItemCheck>, ids: string[]) {
  const list = ids.map((id) => items[id]).filter(Boolean);
  const bad = list.filter((c) => c.state === 'bad').length, warn = list.filter((c) => c.state === 'warn').length, ok = list.filter((c) => c.state === 'ok').length;
  if (!list.length) return '';
  if (list.some((c) => c.state === 'checking')) return `正在检查 ${list.length - list.filter((c) => c.state === 'checking').length}/${list.length}`;
  if (!bad && !warn) return `${ok} 项都准备好了`;
  return [bad && `${bad} 项有问题`, warn && `${warn} 项要留意`, ok && `${ok} 项正常`].filter(Boolean).join('，');
}
