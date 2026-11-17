// 1.7.0 体验改进（设计稿 E）：「这次更新了什么」卡、「帮我查查」免费自检面板、硬盘快满提醒条。
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, HardDrive, Loader2, Search, Sparkles, X, XCircle } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { openAccount, useAccount } from '../account/account';
import '../styles/experience.css';

export const WHATS_NEW_VERSION = '1.7.0';

type Go = () => void;
const page = (p: string): Go => () => useStore.getState().set({ page: p } as never);
export const WHATS_NEW: { title: string; text: string; go: Go }[] = [
  { title: '学生窗口也能上下课，课表随便几分钟', text: '学生画面上有「上课 / 下课」按钮；课表的课不再限 40、60 分钟，45、50、75 分钟都行。', go: page('schedule') },
  { title: '家长版长图，六段一目了然', text: '学情页一键出家长版长图：本次内容、表现、错题、进步、作业、下次安排，直接发微信。', go: page('study') },
  { title: '玲珑账号，登录就能用 AI', text: '不用再找 Key：登录玲珑账号就配好了。还能按用途选「省钱 / 均衡 / 质量优先」三个档位。', go: () => openAccount() },
  { title: 'AI 工坊会上网找真题，并对照原卷核对', text: '出卷、找题时先联网搜真题，每道题都和原卷逐字核对，标出处，不再凭空编题。', go: page('agents') },
  { title: '公式课件设计包，离线也能排版', text: '工坊做课件自带离线公式排版（KaTeX）和设计包（.cs-kit），没网也显示得整整齐齐。', go: page('agents') },
  { title: '内置浏览器，做完自己截图检查', text: '工坊做的网页课件会在内置浏览器里打开、截图自查，排版错了自己改好再交给你。', go: page('agents') },
  { title: '出错说人话，还能「帮我查查」', text: 'AI 出错时一句话告诉你原因；点「帮我查查」免费检查账号、网络、余额和档位。网络抖动会自动重连。', go: () => openSelfCheck() },
];

/* ── 这次更新了什么 ─────────────────────────── */
export const useWhatsNew = create<{ open: boolean; checked: boolean; autoTest: boolean }>(() => ({ open: false, checked: false, autoTest: false }));
export const openWhatsNew = () => useWhatsNew.setState({ open: true });
/** 测试里开启自动弹出检查（默认测试环境不自动弹，避免遮挡既有桌面用例；登录遮罩关掉后照真机时机弹） */
export const enableWhatsNewAuto = () => useWhatsNew.setState({ checked: false, autoTest: true });
export async function checkWhatsNew(show = !host.test) {
  const acc = useAccount.getState();
  if (!host.electron || host.role !== 'teacher' || !acc.checked || acc.panel) return false;
  useWhatsNew.setState({ checked: true });
  try {
    const s = await host.call<{ version: string; seen: string }>('whatsNew.state');
    if (s && s.seen !== WHATS_NEW_VERSION && show) { useWhatsNew.setState({ open: true }); return true; }
  } catch { /* 忽略 */ }
  return false;
}

export function WhatsNew() {
  const { open, checked, autoTest } = useWhatsNew();
  const acc = { checked: useAccount((s) => s.checked), panel: useAccount((s) => s.panel) };
  // 只在登录页关掉以后再判断，绝不和登录页同时弹；自动化测试默认不自弹，除非测试显式打开 autoTest
  useEffect(() => {
    if (checked || !host.electron || host.role !== 'teacher' || !acc.checked || acc.panel) return;
    if (host.test && !autoTest) { useWhatsNew.setState({ checked: true }); return; }
    void checkWhatsNew(true);
  }, [checked, autoTest, acc.checked, acc.panel]);
  if (!open || acc.panel) return null;
  const close = () => { useWhatsNew.setState({ open: false }); void host.call('whatsNew.seen', WHATS_NEW_VERSION).catch(() => {}); };
  return <div className="xp-back" role="dialog" aria-label="这次更新了什么" data-qa="whats-new">
    <div className="xp-card">
      <h3><Sparkles size={17} />1.7.0 这次更新了什么<button className="xp-x" aria-label="关闭" onClick={close}><X size={15} /></button></h3>
      <ol>{WHATS_NEW.map((x, i) => <li key={i}><div><b>{x.title}</b><p>{x.text}</p></div><button data-qa={'wn-go-' + i} onClick={() => { close(); x.go(); }}>去看看</button></li>)}</ol>
      <div className="xp-b"><span>以后在「帮助 → 关于与更新」里还能再看</span><button className="pri" data-qa="wn-ok" onClick={close}>知道了</button></div>
    </div>
  </div>;
}

/* ── 帮我查查 ─────────────────────────────── */
type Item = { id: string; title: string; level: 'ok' | 'warn' | 'bad'; detail: string; advice: string; action?: string; pct?: number };
type Report = { at: number; ok: boolean; items: Item[] };
export const useSelfCheck = create<{ open: boolean; busy: boolean; report: Report | null; error: string }>(() => ({ open: false, busy: false, report: null, error: '' }));
export async function runSelfCheck() {
  useSelfCheck.setState({ busy: true, error: '' });
  try { useSelfCheck.setState({ report: await host.call<Report>('ai.diagnose'), busy: false }); }
  catch (e) { useSelfCheck.setState({ busy: false, error: (e as Error).message }); }
}
export function openSelfCheck() { useSelfCheck.setState({ open: true, report: null }); void runSelfCheck(); }

/** 出错条上的「帮我查查」按钮 */
export function CheckButton({ small }: { small?: boolean }) {
  if (!host.electron) return null;
  return <button className={'xp-check-btn' + (small ? ' sm' : '')} data-qa="self-check-btn" data-tip="免费检查账号、网络、余额、档位，不花钱" onClick={openSelfCheck}><Search size={12} />帮我查查</button>;
}

const ICON = { ok: <CheckCircle2 size={15} />, warn: <AlertTriangle size={15} />, bad: <XCircle size={15} /> };
const LEVEL = { ok: '正常', warn: '需留意', bad: '需处理' };
export function SelfCheck() {
  const { open, busy, report, error } = useSelfCheck();
  if (!open) return null;
  const close = () => useSelfCheck.setState({ open: false });
  const act = (a: string) => {
    if (a === 'tier') { close(); useStore.getState().set({ aiOpen: true }); setTimeout(() => dispatchEvent(new Event('cs-ai-settings')), 50); }
    else if (a === 'account' || a === 'topup') { close(); openAccount(); }
    else if (a === 'warmup') void host.call('agents.warmupRun', { force: true }).then(() => setTimeout(() => void runSelfCheck(), 600)).catch(() => {});
  };
  const label: Record<string, string> = { account: '去登录', tier: '去改档位', topup: '去充值', warmup: '立即准备' };
  return <div className="xp-back" role="dialog" aria-label="帮我查查" data-qa="self-check">
    <div className="xp-card xp-sc">
      <h3><Search size={16} />帮我查查（免费，不花钱）<button className="xp-x" aria-label="关闭" onClick={close}><X size={15} /></button></h3>
      {busy && <p className="xp-dim"><Loader2 size={13} className="spin" />正在逐项检查，十几秒内就好…</p>}
      {error && <p className="xp-bad">检查没做完：{error}</p>}
      {report && <>
        <p className={report.ok ? 'xp-good' : 'xp-dim'}>{report.ok ? '全部正常。要是 AI 还出错，多半是网络抖了一下，稍等再试。' : '下面标黄、标红的照着建议处理就好。'}</p>
        <ul>{report.items.map((x) => <li key={x.id} className={'lv-' + x.level} data-qa={'sc-' + x.id} data-level={x.level}>
          <span className="xp-ico">{ICON[x.level]}</span>
          <div><b>{x.title}<em>{LEVEL[x.level]}</em></b><p>{x.detail}</p><p className="xp-adv">{x.advice}</p>
            {x.level === 'warn' && x.id === 'warmup' && x.pct !== undefined && <div className="xp-bar"><i style={{ width: Math.max(4, x.pct) + '%' }} /></div>}</div>
          {x.action && <button data-qa={'sc-act-' + x.action} onClick={() => act(x.action!)}>{label[x.action] || '去处理'}</button>}
        </li>)}</ul>
      </>}
      <div className="xp-b"><button disabled={busy} onClick={() => void runSelfCheck()}>再查一次</button><button className="pri" onClick={close}>关闭</button></div>
    </div>
  </div>;
}

/* ── 硬盘快满提醒 ─────────────────────────── */
type Disk = { message: string; why: string };
export function DiskBanner() {
  const [d, setD] = useState<Disk | null>(null);
  useEffect(() => {
    if (!host.electron || host.role !== 'teacher') return;
    void host.call<Disk | null>('disk.status').then((v) => v && setD(v)).catch(() => {});
    return host.onEvent((e) => { if (e?.type === 'diskLow' && e.disk) setD(e.disk); });
  }, []);
  if (!d) return null;
  const dismiss = () => { setD(null); if (d.why !== 'record') void host.call('disk.dismiss').catch(() => {}); };
  return <div className="xp-disk" role="status" data-qa="disk-low"><HardDrive size={14} /><span>{d.message}</span><button data-qa="disk-dismiss" onClick={dismiss}>{d.why === 'record' ? '知道了' : '今天不再提醒'}</button></div>;
}
