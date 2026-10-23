import type { ComponentType } from 'react';
import { X } from 'lucide-react';
import type { Tool } from '../lib/types';
import { KEEP, PRESETS, TOOL_GROUPS, applyPreset, setToolbar, toggleTool, useToolbar } from './toolbarPrefs';

type Meta = (t: Tool) => { icon: ComponentType<{ size?: number; strokeWidth?: number }>; name: string };

/** 定制浮层工具栏：三套预设 + 每个工具单独显示 / 藏起来 */
export function ToolbarEditor({ meta, physics, onClose }: { meta: Meta; physics: boolean; onClose?: () => void }) {
  const p = useToolbar();
  return <div className="tb-edit" role="dialog" aria-label="定制工具栏">
    <header><b>定制工具栏</b><span>只影响老师浮层，学生那边不变</span>{onClose && <button onClick={onClose} aria-label="关闭"><X size={15} /></button>}</header>
    <div className="tb-presets" role="radiogroup" aria-label="预设">
      {PRESETS.map((x) => <button key={x.id} role="radio" aria-checked={p.preset === x.id} className={p.preset === x.id ? 'on' : ''} onClick={() => setToolbar(applyPreset(p, x.id))}><b>{x.name}</b><small>{x.tip}</small></button>)}
    </div>
    <p className="tb-hint">{p.preset === 'custom' ? '现在是自己调过的样子。' : ''}点工具可以显示 / 藏起来；藏起来的工具用快捷键还能用。每组按钮上显示上次用的那个。</p>
    <div className="tb-groups">
      {TOOL_GROUPS.map((g) => {
        const tools = g.tools.filter((t) => physics || t !== 'force');
        return <div key={g.id} className="tb-group"><span>{g.name}</span><div>
          {tools.map((t) => {
            const M = meta(t), I = M.icon, keep = KEEP.includes(t), on = !p.hidden.includes(t);
            return <button key={t} className={'tb-tool' + (on ? ' on' : '')} disabled={keep} aria-pressed={on} onClick={() => setToolbar(toggleTool(p, t))} data-tip={keep ? '这个一直留着' : on ? '点一下藏起来' : '点一下显示'}><I size={15} strokeWidth={1.9} />{M.name.split(' · ')[0]}</button>;
          })}
        </div></div>;
      })}
    </div>
  </div>;
}
