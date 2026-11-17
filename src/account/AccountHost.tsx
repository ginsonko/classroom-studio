// 账号相关的几样浮层挂在教师窗口上：登录页、账号页、画图报价确认；顶栏的账号按钮也在这里。
import { useEffect, useState } from 'react';
import { CircleUserRound, Gem, ImageIcon, Link2 } from 'lucide-react';
import { accountApi, openAccount, startAccount, useAccount, yuan } from './account';
import { AccountGate } from './AccountGate';
import { AccountPage } from './AccountPage';
import { host } from '../lib/host';
import '../styles/account.css';

export function AccountHost() {
  const panel = useAccount((s) => s.panel);
  useEffect(() => { void startAccount(); }, []);
  return <>
    {panel === 'gate' && <AccountGate />}
    {panel === 'account' && <AccountPage />}
    <QuoteDialog />
  </>;
}

/** 顶栏右上角：登录了显示账号名，没登录显示「登录」 */
export function AccountButton() {
  const v = useAccount((s) => s.view);
  if (!host.electron) return null;
  const tip = v?.signedIn ? `${v.kind === 'linglong' ? '玲珑账号' : v.site?.name + ' 账号'}：${v.username} · 点开看余额、充值、档位` : '登录玲珑账号或合作站账号，AI 自动配好';
  return <button className={'tb-acc' + (v?.signedIn ? ' on' : '')} data-qa="tb-account" data-tip={tip} onClick={() => openAccount()}>
    {v?.signedIn ? <span className="tb-acc-ava">{v.kind === 'linglong' ? <Gem size={11} /> : <Link2 size={11} />}</span> : <CircleUserRound size={15} />}
    <span>{v?.signedIn ? v.username : '登录'}</span>
  </button>;
}

/** 玲珑账号画图前的报价确认：「这次生成 ¥x（n 张）」。同时到的几张合成一次确认；报价过期没答就当没同意 */
function QuoteDialog() {
  const q = useAccount((s) => s.quote);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!q) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [q]);
  if (!q) return null;
  const left = Math.max(0, Math.round((q.expiresAt - now) / 1000));
  const answer = (yes: boolean) => { void accountApi.quoteAnswer(q.id, yes).catch(() => {}); useAccount.setState({ quote: null }); };
  const what = [...new Set(q.items.map((x) => x.feature).filter(Boolean))].join('、');
  return <div className="acc-back top" role="dialog" aria-label="确认画图价格" data-qa="quote-confirm">
    <div className="acc-quote">
      <h3><ImageIcon size={16} />这次生成 {q.exact ? yuan(q.totalCny) : `最多 ${yuan(q.totalCny)}`}（{q.count} 张）</h3>
      <p>{what ? `「${what}」要画图。` : ''}用的是你的玲珑账号余额，确认以后才会提交、扣费。{q.items.some((x) => x.raised) ? '价格比刚才高了一点，请再确认一次。' : ''}</p>
      {q.items.length > 1 && <ul>{q.items.map((x, i) => <li key={i}><span>{x.model}</span><b className="num">{x.exact ? yuan(x.cny) : `${yuan(x.minCny ?? 0)}～${yuan(x.cny)}`}</b></li>)}</ul>}
      {!q.exact && <p className="acc-dim">按实际线路结算，不会超过上面的金额。</p>}
      <div className="acc-b"><span className="acc-foot">{left > 0 ? `报价 ${left} 秒内有效` : '报价过期了'}</span><button data-qa="quote-no" onClick={() => answer(false)}>不画了</button><button className="pri" data-qa="quote-yes" disabled={left <= 0} onClick={() => answer(true)}>确定生成</button></div>
    </div>
  </div>;
}
