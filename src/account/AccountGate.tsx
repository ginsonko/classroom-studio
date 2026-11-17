// 登录页：铺在老师主窗口上（不是新窗口，也不打开网页）。三选一：玲珑账号（推荐）、合作站账号、跳过自己配。
// 启动时玲珑账号、合作站账号、测通过的 Key 三样都没有才自动弹；顶栏头像、AI 设置、用量页也能叫出来。
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Gem, KeyRound, Link2, Sparkles, X } from 'lucide-react';
import { accountApi, closeAccount, refreshAccount, useAccount } from './account';
import { SignIn } from './SignIn';
import { openAiSettings } from '../ui/AiTrouble';
import { maybeWelcome } from '../guide/guide';
import '../styles/account.css';

type Mode = 'linglong' | 'partner';

export function AccountGate() {
  const auto = useAccount((s) => s.auto);
  const never = useAccount((s) => !!s.view?.never);
  const [mode, setMode] = useState<Mode>('linglong');
  const [done, setDone] = useState('');
  useEffect(() => { void refreshAccount(); }, []);
  const close = () => {
    closeAccount();
    // 登录页放在新手引导之前：它关了，彩排邀请才出来
    setTimeout(() => maybeWelcome(), 400);
  };
  const skip = () => { close(); openAiSettings(); };
  const setNever = (v: boolean) => void accountApi.prefs(v).then((x) => useAccount.setState({ view: { ...useAccount.getState().view!, never: x.never } })).catch(() => {});
  return <div className="acc-back" role="dialog" aria-label="登录" data-qa="account-gate">
    <div className="acc-gate">
      <button className="acc-x" aria-label="关闭" data-tip={auto ? '这次先不登录（下次打开还会问，除非勾了下面的「以后不再自动弹出」）' : '关闭'} onClick={close}><X size={16} /></button>
      <header className="acc-gate-h">
        <span className="acc-orb"><Sparkles size={18} /></span>
        <div><h2>登录以后，AI 就能直接用</h2><p>AI 讲题、小羽助教、AI 工坊备课都要连上 AI。登录一个账号，软件自动配好，不用自己去网站找 Key。</p></div>
      </header>
      <div className="acc-gate-b">
        <nav className="acc-opts">
          <button className={'acc-opt big' + (mode === 'linglong' ? ' on' : '')} data-qa="opt-linglong" onClick={() => setMode('linglong')}>
            <span className="acc-opt-i"><Gem size={18} /></span>
            <span className="acc-opt-t"><b>玲珑账号<em>推荐</em></b><i>在软件里注册、登录、充值，一个账号全搞定；和万能创作终端、玲珑工坊同一个账号</i></span>
          </button>
          <button className={'acc-opt' + (mode === 'partner' ? ' on' : '')} data-qa="opt-partner" onClick={() => setMode('partner')}>
            <span className="acc-opt-i"><Link2 size={16} /></span>
            <span className="acc-opt-t"><b>合作站账号</b><i>银子 API、长风、扶摇、青云的老账号直接登录</i></span>
          </button>
          <button className="acc-opt" data-qa="opt-skip" onClick={skip}>
            <span className="acc-opt-i"><KeyRound size={16} /></span>
            <span className="acc-opt-t"><b>跳过，我自己配</b><i>去 AI 设置：网站一键导入，或手填别家的 Key</i></span>
            <ArrowRight size={14} className="acc-opt-go" />
          </button>
        </nav>
        <section className="acc-pane">
          {done ? <div className="acc-done">
            <div className="acc-state ok"><Check size={18} /><span>{done}</span></div>
            <p>以后打开软件不会再弹这个页面。顶栏右上角的账号按钮、AI 设置、AI 账本里随时可以看余额、充值、换档位或切换账号。</p>
            <div className="acc-b"><button className="pri" data-qa="acc-start" onClick={close}>开始使用</button></div>
          </div> : <>
            <h3>{mode === 'linglong' ? '玲珑账号' : '合作站账号'}</h3>
            <SignIn mode={mode} onDone={(m) => { setDone(m); void refreshAccount(); }} />
          </>}
        </section>
      </div>
      {auto && !done && <footer className="acc-gate-f">
        <label className="acc-check"><input type="checkbox" data-qa="acc-never" checked={never} onChange={(e) => setNever(e.target.checked)} />以后不再自动弹出</label>
        <span>不登录也能上课：录课、黑板、课件这些都不需要 AI</span>
      </footer>}
    </div>
  </div>;
}
