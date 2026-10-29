// AI 助教的设置、记忆和提醒（存在 DATA/study/assistant.json、triggers.json）。
// 工具和界面都从这里读写；提醒的调度在 controller 里。
import { create } from 'zustand';
import { host } from '../lib/host';
import { DEFAULT_NAME, type PersonaId } from './prompt';
import { cleanTrigger, type Trigger } from './triggersLogic';

export type Api = 'auto' | 'studio' | 'own';
/** 助教能动老师电脑到什么程度：ask 每步都问；common 在工作目录里随便做、其余要问；full 不再问 */
export type Access = 'ask' | 'common' | 'full';
export const ACCESS: [Access, string, string][] = [
  ['ask', '每次都问', '看文件、运行命令、改文件前都先问你'],
  ['common', '常用', '在它的工作目录里做文件、跑命令、联网查资料，看你的课件和学生资料都不再问；改工作目录以外的文件、删数据前会问'],
  ['full', '完全访问', '不再弹任何确认，能读写电脑上所有文件、运行任何命令；做错了可以「撤销这一轮」（只能撤销软件里的改动）'],
];
export interface Settings {
  name: string; persona: PersonaId; custom: string;
  /** auto：配了导播台 AI 接口就用它，否则用老师自己登录的 Codex */
  api: Api; model: string; effort: '' | 'low' | 'medium' | 'high';
  access: Access;
  /** 右下角的助教形象 */
  avatar: boolean;
}
export interface Memory { id: string; text: string; at: string; by: 'ai' | 'teacher' }

export const DEFAULT_SETTINGS: Settings = { name: DEFAULT_NAME, persona: 'sister', custom: '', api: 'auto', model: '', effort: '', access: 'common', avatar: true };
const PERSONA_IDS: PersonaId[] = ['sister', 'assistant', 'expert'];

export function cleanSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Settings>;
  return {
    name: String(o.name ?? '').trim().slice(0, 12) || DEFAULT_NAME,
    persona: PERSONA_IDS.includes(o.persona as PersonaId) ? (o.persona as PersonaId) : 'sister',
    custom: String(o.custom ?? '').slice(0, 1500),
    api: o.api === 'studio' || o.api === 'own' ? o.api : 'auto',
    model: String(o.model ?? '').trim().slice(0, 60),
    effort: o.effort === 'low' || o.effort === 'medium' || o.effort === 'high' ? o.effort : '',
    access: o.access === 'ask' || o.access === 'full' ? o.access : 'common',
    avatar: o.avatar !== false,
  };
}

interface State { settings: Settings; memory: Memory[]; triggers: Trigger[]; current: string; loaded: boolean }
export const useAssistantData = create<State>()(() => ({ settings: DEFAULT_SETTINGS, memory: [], triggers: [], current: '', loaded: false }));

let loading: Promise<void> | null = null;
export function loadAssistantData() {
  if (!loading) loading = (async () => {
    if (!host.electron) { useAssistantData.setState({ loaded: true }); return; }
    const [a, t] = await Promise.all([
      host.call<{ settings?: unknown; memory?: Memory[]; current?: string } | null>('study.store', 'assistant').catch(() => null),
      host.call<{ list?: unknown[] } | null>('study.store', 'triggers').catch(() => null),
    ]);
    const triggers: Trigger[] = [];
    for (const raw of Array.isArray(t?.list) ? t!.list : []) {
      try { const r = raw as Trigger; triggers.push({ ...cleanTrigger(r as unknown as Record<string, unknown>, { base: r }), fired: Number(r.fired) || 0 }); } catch { /* 坏记录跳过 */ }
    }
    useAssistantData.setState({
      settings: cleanSettings(a?.settings),
      memory: (Array.isArray(a?.memory) ? a!.memory : []).filter((m) => m && typeof m.text === 'string').slice(-100),
      current: typeof a?.current === 'string' ? a.current : '', triggers, loaded: true,
    });
  })();
  return loading;
}

let tA: number | undefined, tT: number | undefined;
function saveA() {
  clearTimeout(tA);
  tA = window.setTimeout(() => { const s = useAssistantData.getState(); if (host.electron && s.loaded) void host.call('study.saveStore', { name: 'assistant', value: { version: 1, settings: s.settings, memory: s.memory, current: s.current } }).catch(() => {}); }, 300);
}
function saveT() {
  clearTimeout(tT);
  tT = window.setTimeout(() => { const s = useAssistantData.getState(); if (host.electron && s.loaded) void host.call('study.saveStore', { name: 'triggers', value: { version: 1, list: s.triggers } }).catch(() => {}); }, 300);
}

export function setSettings(p: Partial<Settings>) { useAssistantData.setState((s) => ({ settings: cleanSettings({ ...s.settings, ...p }) })); saveA(); }
export function setCurrent(id: string) { useAssistantData.setState({ current: id }); saveA(); }
export function setMemory(list: Memory[]) { useAssistantData.setState({ memory: list.slice(-100) }); saveA(); }
export function setTriggers(list: Trigger[]) { useAssistantData.setState({ triggers: list.slice(-200) }); saveT(); }
export function putTrigger(t: Trigger) { const list = useAssistantData.getState().triggers; setTriggers(list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]); }
export function removeTrigger(id: string) { setTriggers(useAssistantData.getState().triggers.filter((x) => x.id !== id)); }
