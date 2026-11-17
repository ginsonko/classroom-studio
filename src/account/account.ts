// 玲珑账号 / 合作站账号 / 档位 / 报价确认：页面这一侧的状态和调用。账号会话和 Key 都只在主进程里，这里只有账号名、余额这类能看的东西。
import { create } from 'zustand';
import { host } from '../lib/host';
import { ai } from '../lib/ai';
import { pickDefaultModel } from '../lib/models';
import { saveAgentModel, saveStudioKey } from '../lib/agentPrefs';
import { agentProbeText } from '../lib/aiErrors';
import { loadModels } from '../ui/ModelPicker';

export type TierId = 'save' | 'balanced' | 'quality';
export type TierUse = 'chat' | 'workshop' | 'background';
export const TIER_NAME: Record<TierId, string> = { save: '省钱优先', balanced: '均衡', quality: '质量优先' };
export const TIER_HINT: Record<TierId, string> = {
  save: '挑最便宜的线路，日常聊天、查资料够用',
  balanced: '只用评级 B 以上的线路，价格和效果折中',
  quality: '只用评级最高的线路，做要交出去的成品时用',
};
export const TIER_IDS: TierId[] = ['save', 'balanced', 'quality'];
export const USE_NAME: Record<TierUse, string> = { chat: '小羽和课堂 AI', workshop: 'AI 工坊出成品', background: '后台自动（课后总结、录像分析）' };

export interface SiteRow { id: string; name: string; origin: string; app: boolean; loginOnly: boolean }
export interface AccountView {
  signedIn: boolean; kind: '' | 'linglong' | 'partner'; site: { id: string; name: string; origin: string } | null; username: string;
  hasKey: boolean; pending2fa: boolean; sites: SiteRow[]; secure: boolean; never: boolean; need2fa?: boolean;
  ai?: { baseUrl: string; model: string; hasKey: boolean; account: { kind: string; site: string; name: string; username: string } | null; tested: boolean; tierSite: boolean };
}
export interface SiteInfo { site: string; reachable: boolean; login: boolean; register: boolean; emailVerification: boolean; note: string }
export interface SelfInfo { username: string; displayName: string; email: string; balance: number; used: number; requests: number; topupLink: string; commercial: boolean }
export interface TopupInfo { online: boolean; redeem: boolean; methods: { type: string; name: string; min: number }[]; min: number; options: number[]; link: string }
export interface LogRow { at: number; model: string; key: string; cost: number; input: number; output: number; seconds: number }
export interface BoardItem { model: string; configured: boolean; available: boolean; unit?: string; input_cny?: number; output_cny?: number; min_cny?: number; max_cny?: number; message?: string }
export type Board = { ready: false; reason: string } | { ready: true; revision: string; notice: string; tiers: { id: TierId; name: string; sections: { kind: 'text' | 'image'; items: BoardItem[]; none?: string }[] }[] };
export interface TierView { uses: Record<TierUse, TierId>; defaults: Record<TierUse, TierId>; applies: boolean }
export interface QuoteConfirm { id: string; items: { mode: string; model: string; cny: number; exact: boolean; minCny: number | null; units: number; raised: boolean; feature: string }[]; totalCny: number; count: number; exact: boolean; expiresAt: number }

export const accountApi = {
  view: () => host.call<AccountView>('account.view'),
  gate: () => host.call<{ show: boolean; why: string; view: AccountView }>('account.gate'),
  prefs: (never: boolean) => host.call<AccountView>('account.prefs', { never }),
  siteInfo: (site: string) => host.call<SiteInfo>('account.siteInfo', { site }),
  login: (v: { site: string; username: string; password: string }) => host.call<AccountView>('account.login', v),
  verify2fa: (code: string) => host.call<AccountView>('account.verify2fa', { code }),
  sendCode: (v: { site: string; email: string }) => host.call<boolean>('account.sendCode', v),
  register: (v: { site: string; username: string; password: string; email: string; code: string; aff?: string }) => host.call<AccountView>('account.register', v),
  connect: () => host.call<AccountView>('account.connect'),
  signOut: () => host.call<AccountView>('account.signOut'),
  self: () => host.call<SelfInfo>('account.self'),
  topupInfo: () => host.call<TopupInfo>('account.topupInfo'),
  price: (amount: number) => host.call<number>('account.price', { amount }),
  pay: (amount: number, method: string) => host.call<{ opened: boolean }>('account.pay', { amount, method }),
  redeem: (code: string) => host.call<{ added: number }>('account.redeem', { code }),
  logs: (page = 1) => host.call<{ items: LogRow[]; total: number; page: number; spent: number | null }>('account.logs', { page, size: 20, days: 30 }),
  board: () => host.call<Board>('account.board'),
  quoteAnswer: (id: string, yes: boolean) => host.call<boolean>('account.quoteAnswer', { id, yes }),
  quotePending: () => host.call<QuoteConfirm | null>('account.quotePending'),
  tiers: () => host.call<TierView | null>('ai.tiers'),
  setTier: (use: TierUse, tier: TierId) => host.call<TierView>('ai.setTier', { use, tier }),
};

type Panel = 'gate' | 'account' | null;
interface State {
  view: AccountView | null;
  /** 铺在主窗口上的登录页 / 账号页 */
  panel: Panel;
  /** 登录页是启动时自动弹的（显示「跳过」「以后不再自动弹出」），还是老师自己叫出来的 */
  auto: boolean;
  /** 这次启动是否已经判断过要不要弹登录页（新手引导等它判断完） */
  checked: boolean;
  tiers: TierView | null;
  quote: QuoteConfirm | null;
}
export const useAccount = create<State>(() => ({ view: null, panel: null, auto: false, checked: false, tiers: null, quote: null }));

export const refreshAccount = async () => { if (!host.electron) return null; const v = await accountApi.view().catch(() => null); if (v) useAccount.setState({ view: v }); return v; };
export const refreshTiers = async () => { if (!host.electron) return null; const t = await accountApi.tiers().catch(() => null); useAccount.setState({ tiers: t }); return t; };
export async function setTier(use: TierUse, tier: TierId) { const t = await accountApi.setTier(use, tier); useAccount.setState({ tiers: t }); window.dispatchEvent(new CustomEvent('cs-tier', { detail: { use, tier } })); return t; }

/** 顶栏头像、AI 设置、用量页都能叫出登录页（已登录时打开账号页） */
export function openAccount(want: 'auto' | 'signin' = 'auto') {
  const v = useAccount.getState().view;
  useAccount.setState({ panel: want === 'signin' || !v?.signedIn ? 'gate' : 'account', auto: false });
}
export const closeAccount = () => useAccount.setState({ panel: null });

let started = false;
/** 教师窗口启动时调一次：判断要不要铺登录页，接上主进程的事件 */
export async function startAccount() {
  if (started || !host.electron || host.role !== 'teacher') { useAccount.setState({ checked: true }); return; }
  started = true;
  host.onEvent((e: { type?: string; confirm?: QuoteConfirm | null }) => {
    if (e?.type === 'aiConfig') { window.dispatchEvent(new Event('cs-ai-config')); void refreshAccount(); void refreshTiers(); }
    if (e?.type === 'quote') useAccount.setState({ quote: e.confirm ?? null });
    if (e?.type === 'accountPayClosed') window.dispatchEvent(new Event('cs-account-paid'));
  });
  window.addEventListener('cs-ai-config', () => { void refreshTiers(); });
  void accountApi.quotePending().then((q) => q && useAccount.setState({ quote: q })).catch(() => {});
  void refreshTiers();
  // 自动测试不自动弹（测试自己调 checkGate(true)）
  await checkGate(!host.test);
}

/** 问主进程三样（玲珑账号、合作站账号、测通过的 Key）有没有，都没有、也没勾「以后不再自动弹出」就铺登录页 */
export async function checkGate(show = true) {
  try {
    const g = await accountApi.gate();
    useAccount.setState({ view: g.view, ...(g.show && show ? { panel: 'gate', auto: true } : {}) });
    useAccount.setState({ checked: true });
    return g;
  } catch { useAccount.setState({ checked: true }); return null; }
}

/**
 * 登录（或注册）成功以后：按专用 Key 能用的模型挑默认模型，AI 工坊默认用导播台的接口和推荐模型，最后测一次连接。
 * 和一键导入（ImportDialog.applyImport）是同一套做法。返回给老师看的一句话。
 */
export async function afterSignIn(step: (t: string) => void): Promise<string> {
  window.dispatchEvent(new Event('cs-ai-config'));
  step('正在读取能用的模型…');
  let cfg = await ai.config();
  const list = await loadModels(true);
  const ids = list.ok ? list.models : [];
  if (ids.length && (!cfg.model || !ids.includes(cfg.model))) {
    const pick = pickDefaultModel(ids);
    if (pick) { cfg = await ai.save({ model: pick }); window.dispatchEvent(new Event('cs-ai-config')); }
  }
  const find = (re: RegExp) => ids.filter((m) => re.test(m)).sort().reverse()[0] || '';
  const codex = ids.find((m) => m.toLowerCase() === 'gpt-6-astra') || find(/^gpt-\d+(\.\d+)?-astra$/i) || cfg.model;
  const claude = ids.find((m) => m.toLowerCase() === 'claude-opus-5-5') || find(/^claude-opus-/i);
  if (codex) saveAgentModel('codex', codex);
  if (claude) saveAgentModel('claude', claude);
  saveStudioKey(true);
  void refreshTiers();
  if (!cfg.model) return '已登录。读不到模型列表，请在 AI 设置里选一个模型。' + (list.message ? `（${list.message}）` : '');
  step(`正在用 ${cfg.model} 测试连接…`);
  const r = await ai.test(undefined, codex || undefined).catch((e: Error) => { throw new Error('已登录，但连接测试没通过：' + e.message); });
  const bad = agentProbeText(r.agent);
  void refreshAccount();
  if (bad) throw new Error(`已登录，聊天能用（${r.model}），${bad}`);
  return `已登录并接好 AI：${r.model}${r.agent?.ok ? '，小羽和 AI 工坊也能用' : ''}`;
}

/** 老师说「不对」「重做」「太笨」这类话（和主进程 tier.cjs 的 COMPLAINT 一致） */
export const isComplaint = (t: string) => /不对|错了|有错|不是这样|重做|重新做|再做一遍|太笨|好笨|真笨|笨死|不行|不好用|做得不好|不太好|做得(很)?差|太差|胡说|乱写|瞎写|没用|看不懂|不满意/.test(String(t || '').slice(0, 200));

export const yuan = (v: number) => '¥' + (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1));
