// 老师浮层工具栏：显示哪些工具、每组默认显示哪一个。存在本机（各窗口共用 localStorage，改了别的窗口马上跟着变）。
import { create } from 'zustand';
import type { Tool } from '../lib/types';

export const TOOL_GROUPS: { id: string; name: string; tools: Tool[] }[] = [
  { id: 'select', name: '选择', tools: ['pointer', 'select', 'lasso'] },
  { id: 'write', name: '笔', tools: ['pen', 'marker', 'highlighter'] },
  { id: 'erase', name: '橡皮', tools: ['eraser'] },
  { id: 'lines', name: '线条', tools: ['line', 'arrow', 'darrow', 'curve', 'dashed'] },
  { id: 'shapes', name: '形状', tools: ['rect', 'ellipse', 'triangle'] },
  { id: 'physics', name: '受力 / 坐标', tools: ['force', 'axes'] },
  { id: 'text', name: '文字', tools: ['text'] },
  { id: 'teach', name: '讲课', tools: ['laser', 'spotlight', 'curtain'] },
];

/** 这几个不能藏：藏了就没法翻课件、写字、擦掉 */
export const KEEP: Tool[] = ['pointer', 'pen', 'eraser'];

export type PresetId = 'full' | 'simple' | 'draw';
export const PRESETS: { id: PresetId; name: string; tip: string; hidden: Tool[]; last?: Record<string, Tool> }[] = [
  { id: 'full', name: '全部工具', tip: '所有工具都摆出来', hidden: [] },
  { id: 'simple', name: '讲题常用', tip: '只留写字、画线、圈画、激光笔，界面最清爽', hidden: ['lasso', 'marker', 'darrow', 'curve', 'dashed', 'triangle', 'force', 'axes', 'spotlight', 'curtain'] },
  { id: 'draw', name: '作图为主', tip: '线条、形状、坐标系都在，少了荧光笔、聚光灯这些', hidden: ['marker', 'highlighter', 'spotlight', 'curtain'], last: { lines: 'line', shapes: 'rect' } },
];

export interface ToolbarPrefs { preset: PresetId | 'custom'; hidden: Tool[]; last: Record<string, Tool> }
const KEY = 'cs.toolbar';
const DEFAULTS: ToolbarPrefs = { preset: 'full', hidden: [], last: {} };
const ALL = new Set<string>(TOOL_GROUPS.flatMap((g) => g.tools));

export function parsePrefs(raw: string | null): ToolbarPrefs {
  try {
    const v = JSON.parse(raw || 'null') as Partial<ToolbarPrefs> | null;
    if (!v || typeof v !== 'object') return DEFAULTS;
    const hidden = Array.isArray(v.hidden) ? v.hidden.filter((t): t is Tool => typeof t === 'string' && ALL.has(t) && !KEEP.includes(t as Tool)) : [];
    const last: Record<string, Tool> = {};
    for (const g of TOOL_GROUPS) { const t = v.last?.[g.id]; if (typeof t === 'string' && g.tools.includes(t as Tool)) last[g.id] = t as Tool; }
    const preset = v.preset === 'custom' || PRESETS.some((p) => p.id === v.preset) ? v.preset! : 'custom';
    return { preset, hidden, last };
  } catch { return DEFAULTS; }
}

/** 实际显示的分组：藏掉的工具拿掉，整组都藏了就不显示；当前正在用的工具即使藏了也照常显示（快捷键选到的） */
export function visibleGroups(p: ToolbarPrefs, o: { physics: boolean; tool?: Tool }) {
  return TOOL_GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => (o.physics || t !== 'force') && (!p.hidden.includes(t) || t === o.tool)) })).filter((g) => g.tools.length);
}

/** 这一组按钮上显示哪个工具：正在用的 > 上次用的 > 组里第一个 */
export function shownTool(g: { id: string; tools: Tool[] }, p: ToolbarPrefs, tool: Tool): Tool {
  if (g.tools.includes(tool)) return tool;
  const last = p.last[g.id];
  return last && g.tools.includes(last) ? last : g.tools[0];
}

export function applyPreset(p: ToolbarPrefs, id: PresetId): ToolbarPrefs {
  const x = PRESETS.find((q) => q.id === id)!;
  return { preset: id, hidden: [...x.hidden], last: { ...p.last, ...x.last } };
}

export function toggleTool(p: ToolbarPrefs, t: Tool): ToolbarPrefs {
  if (KEEP.includes(t)) return p;
  const hidden = p.hidden.includes(t) ? p.hidden.filter((x) => x !== t) : [...p.hidden, t];
  const same = PRESETS.find((q) => q.hidden.length === hidden.length && q.hidden.every((x) => hidden.includes(x)));
  return { ...p, hidden, preset: same?.id ?? 'custom' };
}

const read = () => { try { return parsePrefs(localStorage.getItem(KEY)); } catch { return DEFAULTS; } };
export const useToolbar = create<ToolbarPrefs>(() => read());
export function setToolbar(next: ToolbarPrefs) {
  useToolbar.setState(next, true);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 存不了就只在这次生效 */ }
}
export const rememberLast = (group: string, t: Tool) => { const p = useToolbar.getState(); if (p.last[group] !== t) setToolbar({ ...p, last: { ...p.last, [group]: t } }); };
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) useToolbar.setState(parsePrefs(e.newValue), true); });
