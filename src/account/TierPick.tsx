// 档位选择：省钱优先 / 均衡 / 质量优先。小羽输入框旁、AI 工坊新任务和任务对话框底下用小下拉，AI 设置和账号页用三段按钮。
// 只对银子 API 系站点（玲珑账号和四个合作站）显示；手填的第三方 Key 不显示。
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import { refreshTiers, setTier, TIER_HINT, TIER_IDS, TIER_NAME, useAccount, type TierId, type TierUse } from './account';
import { toast } from '../lib/toast';
import '../styles/account.css';

/** 档位对现在的 AI 接口起不起作用 */
export function useTierSite() {
  const applies = useAccount((s) => !!s.tiers?.applies);
  useEffect(() => { if (!useAccount.getState().tiers) void refreshTiers(); }, []);
  return applies;
}

/**
 * value / onChange 给了就是受控的（工坊任务自己的档位）；不给就读写这个用途的全局档位。
 * up：弹出层往上开（输入框在底部时）
 */
export function TierChip({ use, value, onChange, up, note, qa }: { use: TierUse; value?: TierId; onChange?: (t: TierId) => void; up?: boolean; note?: string; qa?: string }) {
  const applies = useTierSite();
  const saved = useAccount((s) => s.tiers?.uses?.[use]);
  const cur: TierId = value ?? saved ?? (use === 'workshop' ? 'quality' : 'balanced');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', off); return () => removeEventListener('pointerdown', off);
  }, [open]);
  if (!applies) return null;
  const pick = (t: TierId) => {
    setOpen(false);
    if (t === cur) return;
    if (onChange) onChange(t);
    else void setTier(use, t).then(() => note && toast(note.replace('{档位}', TIER_NAME[t]))).catch((e) => toast((e as Error).message));
  };
  return <span className={'tier-w' + (up ? ' up' : '')} ref={box}>
    <button className={'tier-chip t-' + cur} data-qa={qa ?? 'tier-chip-' + use} data-tip={`档位：${TIER_NAME[cur]} · ${TIER_HINT[cur]}`} onClick={() => setOpen(!open)}><Gauge size={12} />{TIER_NAME[cur]}<ChevronDown size={11} /></button>
    {open && <div className="tier-pop" role="menu">{TIER_IDS.map((t) => <button key={t} className={t === cur ? 'on' : ''} data-qa={'tier-' + t} onClick={() => pick(t)}><b className={'t-' + t}>{TIER_NAME[t]}</b><span>{TIER_HINT[t]}</span></button>)}</div>}
  </span>;
}

/** 三段按钮：AI 设置里的全局默认 */
export function TierSeg({ use, value, onChange }: { use: TierUse; value?: TierId; onChange?: (t: TierId) => void }) {
  const saved = useAccount((s) => s.tiers?.uses?.[use]);
  const cur: TierId = value ?? saved ?? (use === 'workshop' ? 'quality' : 'balanced');
  return <div className="tier-seg" data-qa={'tier-seg-' + use}>{TIER_IDS.map((t) => <button key={t} className={(t === cur ? 'on ' : '') + 't-' + t} data-tip={TIER_HINT[t]}
    onClick={() => { if (onChange) onChange(t); else void setTier(use, t).catch((e) => toast((e as Error).message)); }}>{TIER_NAME[t]}</button>)}</div>;
}
