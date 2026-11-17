// 「变笨了」主动推荐（设计稿 D.3）：回复下面一条小提示「这次效果不太好？切到质量优先再做一遍（大约贵 x 倍）」。
// 小羽和 AI 工坊共用；贵多少倍按价格板算（玲珑账号），读不到就写经验值并标「仅估算」。
import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { accountApi, useAccount, type Board } from './account';

let board: Promise<Board | null> | null = null;
const loadBoard = () => (board ??= accountApi.board().catch(() => null));

/** 同一个模型在质量优先和均衡下的文字价之比；没有价格板返回 0 */
export function qualityRatio(b: Board | null, model: string): number {
  if (!b?.ready || !model) return 0;
  const price = (id: string) => b.tiers.find((t) => t.id === id)?.sections.find((s) => s.kind === 'text')?.items.find((i) => i.model === model && i.available);
  const q = price('quality'), base = price('balanced') ?? price('save');
  if (!q?.input_cny || !base?.input_cny) return 0;
  const r = ((q.input_cny ?? 0) + (q.output_cny ?? 0)) / ((base.input_cny ?? 0) + (base.output_cny ?? 0));
  return Number.isFinite(r) && r > 0 ? Math.max(1, Math.round(r * 10) / 10) : 0;
}
export const ratioText = (r: number) => (r > 1.05 ? `大约贵 ${r} 倍，仅估算` : r ? '价格差不多' : '通常贵 1～2 倍，仅估算');

export function SuggestTip({ why, model, onRetry, qa }: { why: string; model?: string; onRetry: () => Promise<unknown> | void; qa?: string }) {
  const linglong = useAccount((s) => s.view?.kind === 'linglong');
  const [ratio, setRatio] = useState(0);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => { if (linglong && model) void loadBoard().then((b) => setRatio(qualityRatio(b, model))); }, [linglong, model]);
  if (gone) return null;
  return <div className="tier-tip" data-qa={qa ?? 'tier-suggest'}>
    <Sparkles size={14} />
    <span>这次效果不太好？{why ? `（${why}）` : ''}切到<b>质量优先</b>再做一遍（{ratioText(ratio)}）</span>
    <button disabled={busy} onClick={() => { setBusy(true); void Promise.resolve(onRetry()).finally(() => { setBusy(false); setGone(true); }); }}>{busy ? <Loader2 size={12} className="spin" /> : null}切到质量优先再做一遍</button>
    <button className="ghost" onClick={() => setGone(true)}>不用</button>
  </div>;
}
