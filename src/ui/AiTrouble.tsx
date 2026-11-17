// AI 出错时给老师看的一句话 + 一个按钮；服务返回的原文折叠起来（要找客服时再展开复制）。
// AI 工坊的任务日志、小羽对话、AI 设置的连接测试共用。
import { CheckButton } from '../teacher/Experience170';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { explainAiError, type FixAction } from '../lib/aiErrors';
import { openAccount, useAccount } from '../account/account';
import '../styles/aitrouble.css';

/** 打开 AI 设置（右侧 AI 面板的设置页） */
export const openAiSettings = () => { useStore.getState().set({ aiOpen: true }); setTimeout(() => dispatchEvent(new Event('cs-ai-settings')), 50); };

export function runFix(a: FixAction, retry?: () => void) {
  if (a === 'retry') { retry?.(); return; }
  if (a === 'assistant') { void import('../assistant/controller').then((m) => m.openAssistant()); return; }
  if (a === 'settings') { openAiSettings(); return; }
  // 登录了玲珑账号 / 合作站账号：在软件里的账号页充值，不用去网站
  if (a === 'recharge' && useAccount.getState().view?.signedIn) { openAccount(); return; }
  // 一键导入 / 充值都在站点上：打开站点，同时把 AI 设置打开（导入码、导入文件也能从那里贴）
  void host.call('ai.openSite');
  openAiSettings();
  toast(a === 'import' ? '已打开银子 API：在「令牌 / 密钥」里点「一键导入到软件」→「最强网课教辅系统」，软件里会自动弹出确认' : '已打开银子 API，充值后回来点「继续」即可', { ms: 15000 });
}

export function AiTrouble({ raw, onRetry, compact }: { raw: string; onRetry?: () => void; compact?: boolean }) {
  const signed = useAccount((s) => !!s.view?.signedIn);
  const t0 = explainAiError(raw);
  if (!t0) return null;
  const t = t0.action === 'recharge' && signed ? { ...t0, text: '账户余额不够了，充值后再点「继续」就能接着做', label: '去充值' } : t0;
  return <div className={'ai-trouble' + (compact ? ' compact' : '')} role="alert">
    <div className="ai-trouble-h"><TriangleAlert size={14} /><span>{t.text}</span></div>
    <div className="ai-trouble-b">
      {(t.action !== 'retry' || onRetry) && <button className="pri" onClick={() => runFix(t.action, onRetry)}>{t.label}</button>}
      {t.action !== 'settings' && <button onClick={openAiSettings}>去 AI 设置</button>}
      <CheckButton small />
    </div>
    <details className="ai-trouble-raw"><summary><ChevronRight size={11} />服务返回的原文</summary><pre>{raw.slice(0, 4000)}</pre></details>
  </div>;
}
