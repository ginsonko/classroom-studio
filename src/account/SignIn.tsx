// 登录 / 注册表单：玲珑账号（软件里注册、登录、二次验证）和合作站账号（只登录）。登录页和账号页「切换账号」共用。
// 密码只在这一次请求里交给主进程，软件不保存密码。
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, LogIn, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { accountApi, afterSignIn, useAccount, type SiteInfo } from './account';

type Phase = { k: 'form' } | { k: '2fa' } | { k: 'busy'; t: string } | { k: 'ok'; t: string } | { k: 'warn'; t: string };

export function SignIn({ mode, onDone }: { mode: 'linglong' | 'partner'; onDone: (msg: string) => void }) {
  const all = useAccount((s) => s.view?.sites);
  const sites = (all ?? []).filter((x) => (mode === 'linglong' ? x.app : !x.app));
  const [site, setSite] = useState(mode === 'linglong' ? 'linglong' : 'yinzi');
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [u, setU] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [email, setEmail] = useState(''), [code, setCode] = useState(''), [otp, setOtp] = useState('');
  const [cool, setCool] = useState(0);
  const [phase, setPhase] = useState<Phase>({ k: 'form' });
  const [err, setErr] = useState('');
  useEffect(() => { setSite(mode === 'linglong' ? 'linglong' : 'yinzi'); setTab('login'); setErr(''); setPhase({ k: 'form' }); }, [mode]);
  useEffect(() => { setInfo(null); let live = true; void accountApi.siteInfo(site).then((i) => live && setInfo(i)).catch(() => live && setInfo(null)); return () => { live = false; }; }, [site]);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(t); }, [cool]);
  const siteName = sites.find((x) => x.id === site)?.name ?? '';
  const loginOff = mode === 'linglong' && info && !info.login;
  const regOff = !info?.register;
  // 站点没开放的功能写明白（C.4 开关策略：开了才显示能用，没开就说「暂未开放」）
  const note = !info ? '' : !info.reachable ? info.note : mode === 'partner' ? '' : info.note;
  // 注册没开放（或站点还读不到开关）：隐藏注册，只留登录
  const canReg = !!info?.register;
  useEffect(() => { if (!canReg && tab === 'register') setTab('login'); }, [canReg, tab]);

  const finish = async () => {
    try { const msg = await afterSignIn((t) => setPhase({ k: 'busy', t })); setPhase({ k: 'ok', t: msg }); onDone(msg); }
    catch (e) { const m = (e as Error).message; setPhase({ k: 'warn', t: m }); onDone(m); }
  };
  const run = async (fn: () => Promise<{ need2fa?: boolean } | unknown>, busy: string) => {
    setErr(''); setPhase({ k: 'busy', t: busy });
    try {
      const r = await fn() as { need2fa?: boolean };
      if (r?.need2fa) { setPhase({ k: '2fa' }); return; }
      setPw(''); setPw2('');
      await finish();
    } catch (e) { setErr((e as Error).message); setPhase((p) => (p.k === 'busy' && otp ? { k: '2fa' } : { k: 'form' })); }
  };
  const login = () => void run(() => accountApi.login({ site, username: u, password: pw }), '正在登录…');
  const verify = () => void run(() => accountApi.verify2fa(otp), '正在验证…');
  const register = () => {
    if (pw !== pw2) { setErr('两次输入的密码不一样'); return; }
    void run(() => accountApi.register({ site, username: u, password: pw, email, code }), '正在注册…');
  };
  const send = async () => {
    setErr('');
    try { await accountApi.sendCode({ site, email }); setCool(60); }
    catch (e) { setErr((e as Error).message); }
  };
  const enter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) fn(); };

  if (phase.k === 'busy') return <div className="acc-state"><Loader2 size={18} className="spin" /><span>{phase.t}</span></div>;
  if (phase.k === 'ok') return <div className="acc-state ok"><CheckCircle2 size={18} /><span>{phase.t}</span></div>;
  if (phase.k === 'warn') return <div className="acc-state warn"><AlertTriangle size={18} /><span>{phase.t}</span></div>;
  if (phase.k === '2fa') return <div className="acc-form">
    <p className="acc-lead"><ShieldCheck size={14} />这个账号开了二次验证：打开验证器 App，输入 6 位验证码</p>
    <label>验证码<input data-qa="acc-otp" autoFocus inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\s/g, ''))} onKeyDown={enter(verify)} /></label>
    {err && <p className="acc-err"><AlertTriangle size={13} />{err}</p>}
    <div className="acc-b"><button onClick={() => { setPhase({ k: 'form' }); setOtp(''); }}>返回</button><button className="pri" disabled={otp.length < 6} onClick={verify}>验证并登录</button></div>
  </div>;

  return <div className="acc-form" data-qa={'acc-form-' + mode}>
    {mode === 'partner' && <label>哪个站的账号<div className="acc-sites">{sites.map((x) => <button key={x.id} className={site === x.id ? 'on' : ''} onClick={() => setSite(x.id)}>{x.name}</button>)}</div></label>}
    {mode === 'linglong' && canReg && <div className="acc-tabs">
      <button className={tab === 'login' ? 'on' : ''} onClick={() => setTab('login')}><LogIn size={13} />登录</button>
      <button className={tab === 'register' ? 'on' : ''} data-qa="acc-tab-register" onClick={() => setTab('register')}><UserPlus size={13} />注册</button>
    </div>}
    {note && <p className="acc-note" data-qa="acc-note">{note}</p>}
    {tab === 'login' || mode === 'partner' ? <>
      <label>用户名<input data-qa="acc-user" autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" spellCheck={false} disabled={!!loginOff} /></label>
      <label>密码<input data-qa="acc-pass" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={enter(login)} autoComplete="current-password" disabled={!!loginOff} /></label>
      {err && <p className="acc-err" data-qa="acc-err"><AlertTriangle size={13} />{err}</p>}
      <div className="acc-b"><span className="acc-foot">{mode === 'partner' ? `只登录，不在这里注册；还没有账号请到${siteName}网站注册` : '软件不保存密码，登录状态加密保存在这台电脑'}</span>
        <button className="pri" data-qa="acc-login" disabled={!u.trim() || !pw || !!loginOff} onClick={login}><LogIn size={13} />登录</button></div>
    </> : <>
      <label>用户名<input value={u} onChange={(e) => setU(e.target.value)} disabled={regOff} spellCheck={false} /></label>
      <label>邮箱<div className="acc-row"><input value={email} onChange={(e) => setEmail(e.target.value)} disabled={regOff} spellCheck={false} placeholder="用来收验证码、找回密码" />
        <button disabled={regOff || cool > 0 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)} onClick={() => void send()}><Mail size={12} />{cool > 0 ? `${cool} 秒后重发` : '发验证码'}</button></div></label>
      <label>邮箱验证码<input value={code} onChange={(e) => setCode(e.target.value.trim())} disabled={regOff} inputMode="numeric" /></label>
      <div className="acc-two">
        <label>密码<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={regOff} placeholder="至少 8 位" autoComplete="new-password" /></label>
        <label>再输一遍<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={regOff} onKeyDown={enter(register)} autoComplete="new-password" /></label>
      </div>
      {err && <p className="acc-err"><AlertTriangle size={13} />{err}</p>}
      <div className="acc-b"><span className="acc-foot">玲珑账号只能在软件里用，网页上登录不了</span>
        <button className="pri" disabled={regOff || !u.trim() || pw.length < 8 || !email || !code} onClick={register}><UserPlus size={13} />注册并登录</button></div>
    </>}
  </div>;
}
