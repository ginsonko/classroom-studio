// 插件列表（主进程 plugins.list）+ 正在打开的插件面板。教师窗口和浮层各有一份，插件变化时主进程发 plugins 事件刷新。
import { create } from 'zustand';
import { host } from '../lib/host';

export type Permission = 'student' | 'board' | 'present' | 'bank.read' | 'bank.write' | 'ai' | 'ai.image' | 'files';
export interface PanelDef { id: string; title: string; entry: string; where: ('console' | 'dock')[]; width: number; height: number }
export interface LessonDef { id: string; title: string; entry: string; subject: string }
export interface PageDef { id: string; title: string; entry: string }
export interface ShapeGroup { subject: string; group: string; items: { name: string; file: string; width: number }[] }
export interface SkillDef { id: string; label: string; hint: string; formats: string[]; prompt: string }
export interface TemplateDef { id: string; title: string; css: string; kinds: string[] }
export interface Manifest {
  protocol: string; id: string; name: string; version: string; author: string; description: string; homepage: string;
  icon: string; subjects: string[]; permissions: Permission[]; network: string[];
  contributes: { panels: PanelDef[]; lessons: LessonDef[]; pages: PageDef[]; shapes: ShapeGroup[]; skills: SkillDef[]; templates: TemplateDef[] };
}
export interface PluginItem extends Manifest { enabled: boolean; active: boolean; installedAt: number; updatedAt: number; disabledReason: string; problems: string[] }
export interface PluginList { paused: boolean; safeMode: boolean; templates: Record<string, string>; permissionNames: Record<string, string>; items: PluginItem[] }
export interface Staged { token: string; manifest: Manifest | null; problems: string[]; files: number; bytes: number; existing: { version: string; name: string; permissions: Permission[]; network: string[] } | null; permissionNames: Record<string, string> }

export interface OpenPanel { id: string; panel: string; key: number }

interface State {
  list: PluginList | null; error: string;
  /** 教师窗口里浮着的插件面板（最多 3 个） */
  open: OpenPanel[];
  /** AI 工坊预览中的插件（plugin://dev-xxx/）：桥接按它检查权限 */
  dev: Record<string, Manifest>;
  /** 插件页点「用 AI 做 / 改」：AI 工坊打开时直接停在做插件的新任务上（id 空 = 新做一个） */
  workshop: { id: string } | null;
}
export const usePlugins = create<State>()(() => ({ list: null, error: '', open: [], dev: {}, workshop: null }));

let loading: Promise<void> | null = null, listening = false;
export function loadPlugins(force = false) {
  if (!host.electron || host.role === 'student') return Promise.resolve();
  if (!listening) {
    listening = true;
    host.onEvent((e) => { if (e?.type === 'plugins') void loadPlugins(true); });
  }
  if (loading && !force) return loading;
  loading = host.call<PluginList>('plugins.list').then((list) => {
    usePlugins.setState({ list, error: '' });
    // 停用 / 删除的插件面板自动关掉
    const live = new Set(list.items.filter((x) => x.active).map((x) => x.id));
    usePlugins.setState((s) => ({ open: s.open.filter((o) => live.has(o.id)) }));
  }).catch((e) => usePlugins.setState({ error: (e as Error).message }));
  return loading;
}

export const activePlugins = (list: PluginList | null) => (list?.items ?? []).filter((x) => x.active);

export function manifestOf(id: string): Manifest | null {
  const s = usePlugins.getState();
  return s.dev[id] ?? s.list?.items.find((x) => x.id === id) ?? null;
}

export const pluginUrl = (id: string, rel: string) => `plugin://${id}/${rel.split('/').map(encodeURIComponent).join('/')}`;

let seq = 0;
export function openPanel(id: string, panel: string) {
  usePlugins.setState((s) => {
    const rest = s.open.filter((o) => !(o.id === id && o.panel === panel));
    return { open: [...rest, { id, panel, key: ++seq }].slice(-3) };
  });
}
export function closePanel(id: string, panel?: string) {
  usePlugins.setState((s) => ({ open: s.open.filter((o) => !(o.id === id && (!panel || o.panel === panel))) }));
}
