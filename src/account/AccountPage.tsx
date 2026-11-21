// 账号页（登录以后）：余额、软件内充值、消费明细（站点实扣）、价格板（三档 × 文字 / 图片，仅估算）、档位、退出登录。
// 不显示分组、倍率、原价：主进程只交过来白名单字段。
import { useEffect, useState } from 'react';
import { CreditCard, Gem, Gift, Link2, Loader2, LogOut, RefreshCw, Repeat, X } from 'lucide-react';
import { accountApi, closeAccount, openAccount, refreshAccount, TIER_NAME, USE_NAME, useAccount, yuan, type Board, type LogRow, type SelfInfo, type TierUse, type TopupInfo } from './account';
import { TierSeg } from './TierPick';
import { toast } from '../lib/toast';
import { host } from '../lib/host';
import '../styles/account.css';

type Tab = 'home' | 'logs' | 'price';

export function AccountPage() {
  const view = useAccount((s) => s.view);
  const tiers = useAccount((s) => s.tiers);
  const [tab, setTab] = useState<Tab>('home');
  const [me, setMe] = useState<SelfInfo | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => { setErr(''); void accountApi.self().then(setMe).catch((e) => setErr((e as Error).message)); };
  useEffect(() => { load(); const on = () => load(); addEventListener('cs-account-paid', on); return () => removeEventListener('cs-account-paid', on); }, []);
  const act = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setErr(''); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  if (!view?.signedIn) return null;
  const linglong = view.kind === 'linglong';
  return <div className="acc-back" role="dialog" aria-label="账号" data-qa="account-page" onPointerDown={(e) => { if (e.target === e.currentTarget) closeAccount(); }}>
    <div className="acc-page">
      <header className="acc-page-h">
        <span className="acc-ava">{(view.username || '?').slice(0, 1).toUpperCase()}</span>
        <div className="acc-who"><b>{me?.displayName || view.username}</b><span>{linglong ? <><Gem size={11} />玲珑账号</> : <><Link2 size={11} />{view.site?.name} 账号</>}{me?.email ? ' · ' + me.email : ''}</span></div>
        <span className="flex" />
        <button data-tip="换一个账号登录" onClick={() => openAccount('signin')}><Repeat size={13} />切换账号</button>
        <button data-qa="acc-signout" data-tip="退出后，账号建的专用 Key 从这台电脑上拿掉；你登录前自己配的连接会放回来" onClick={() => void act('out', async () => { await accountApi.signOut(); await refreshAccount(); window.dispatchEvent(new Event('cs-ai-config')); closeAccount(); toast('已退出登录'); })}><LogOut size={13} />退出登录</button>
        <button className="acc-x2" aria-label="关闭" onClick={closeAccount}><X size={16} /></button>
      </header>
      <nav className="acc-page-tabs">
        <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>余额和充值</button>
        <button className={tab === 'logs' ? 'on' : ''} data-qa="acc-tab-logs" onClick={() => setTab('logs')}>消费明细</button>
        <button className={tab === 'price' ? 'on' : ''} data-qa="acc-tab-price" onClick={() => setTab('price')}>价格和档位</button>
      </nav>
      <div className="acc-page-b">
        {err && <p className="acc-err">{err}</p>}
        {tab === 'home' && <>
          <section className="acc-bal">
            <div><span>余额</span><b className="num" data-qa="acc-balance">{me ? yuan(me.balance) : '…'}</b></div>
            <div><span>累计用掉</span><b className="num">{me ? yuan(me.used) : '…'}</b></div>
            <div><span>调用次数</span><b className="num">{me ? me.requests : '…'}</b></div>
            <button onClick={load} data-tip="刷新余额"><RefreshCw size={13} /></button>
          </section>
          <Topup site={view.site?.name ?? ''} onPaid={load} />
          <section className="acc-sec">
            <h4>连接</h4>
            <p className="acc-dim">登录时自动建了一把专用 Key（名字叫「玲珑课堂」），小羽、AI 工坊、课堂 AI 都用它；Key 本身不显示，也不用你管。AI 用不了时可以点这里重新接一次。</p>
            <div className="acc-b left"><button disabled={!!busy} onClick={() => void act('re', async () => { await accountApi.connect(); window.dispatchEvent(new Event('cs-ai-config')); toast('已重新连接'); })}>{busy === 're' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}重新连接</button></div>
          </section>
        </>}
        {tab === 'logs' && <Logs />}
        {tab === 'price' && <>
          <section className="acc-sec">
            <h4>档位</h4>
            <p className="acc-dim">档位决定 AI 走哪一级线路：质量优先只用评级最高的线路，效果最稳，价格高一些。默认：小羽和课堂 AI 均衡，AI 工坊出成品质量优先，后台自动均衡。</p>
            {(['chat', 'workshop', 'background'] as TierUse[]).map((u) => <div key={u} className="acc-tier-row"><span>{USE_NAME[u]}</span><TierSeg use={u} />{tiers?.defaults?.[u] && tiers.uses[u] !== tiers.defaults[u] && <i>默认 {TIER_NAME[tiers.defaults[u]]}</i>}</div>)}
          </section>
          {linglong ? <PriceBoard /> : <section className="acc-sec"><h4>价格</h4><p className="acc-dim">合作站账号按{view.site?.name}网站的价格扣费，可以在网站的「模型广场」里看。</p></section>}
        </>}
      </div>
    </div>
  </div>;
}

function Topup({ site, onPaid }: { site: string; onPaid: () => void }) {
  const [info, setInfo] = useState<TopupInfo | null>(null);
  const [err, setErr] = useState('');
  const [amount, setAmount] = useState(0);
  const [pay, setPay] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { void accountApi.topupInfo().then((i) => { setInfo(i); setAmount(i.options[0] || Math.max(10, i.min)); }).catch((e) => setErr((e as Error).message)); }, []);
  useEffect(() => { if (!amount || !info?.online) { setPay(null); return; } const t = setTimeout(() => void accountApi.price(amount).then(setPay).catch(() => setPay(null)), 300); return () => clearTimeout(t); }, [amount, info?.online]);
  const go = (method: string) => { setMsg(''); void accountApi.pay(amount, method).then(() => setMsg('已打开支付窗口：付完关掉它，余额会自动刷新')).catch((e) => setErr((e as Error).message)); };
  const redeem = () => { setMsg(''); void accountApi.redeem(code).then((r) => { setMsg(`兑换成功，到账 ${yuan(r.added)}`); setCode(''); onPaid(); }).catch((e) => setErr((e as Error).message)); };
  return <section className="acc-sec" data-qa="acc-topup">
    <h4><CreditCard size={14} />充值</h4>
    {err && <p className="acc-err">{err}</p>}
    {!info && !err && <p className="acc-dim"><Loader2 size={12} className="spin" />正在读取充值方式…</p>}
    {info && (info.online && info.methods.length ? <>
      <div className="acc-amts">{[...new Set([...info.options, ...(info.options.length ? [] : [10, 30, 50, 100])])].map((n) => <button key={n} className={amount === n ? 'on' : ''} onClick={() => setAmount(n)}>¥{n}</button>)}
        <label>其他<input type="number" min={info.min} value={amount || ''} onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))} /></label></div>
      <div className="acc-b left">{info.methods.map((m) => <button key={m.type} className="pri" disabled={amount < Math.max(info.min, m.min || 0)} onClick={() => go(m.type)}>{m.name}支付{pay ? ` ¥${pay.toFixed(2)}` : ''}</button>)}
        <span className="acc-foot">最少 ¥{info.min}；在软件里的支付窗口付款，不用打开浏览器</span></div>
    </> : <p className="acc-dim">{site}暂时没开在线充值{info.link ? '，可以去网站充值' : ''}。{info.link && <a onClick={() => void host.call('ai.openSite')}>打开网站</a>}</p>)}
    {info?.redeem && <div className="acc-redeem"><Gift size={13} /><input placeholder="有兑换码？填在这里" value={code} onChange={(e) => setCode(e.target.value)} /><button disabled={!code.trim()} onClick={redeem}>兑换</button></div>}
    {msg && <p className="acc-ok">{msg}</p>}
  </section>;
}

function Logs() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: LogRow[]; total: number; spent: number | null } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setErr(''); void accountApi.logs(page).then(setData).catch((e) => setErr((e as Error).message)); }, [page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  return <section className="acc-sec">
    <h4>最近 30 天的消费{data?.spent != null && <em>合计 {yuan(data.spent)}</em>}</h4>
    <p className="acc-dim">这里是站点实际扣的钱（不是软件估算的）。</p>
    {err && <p className="acc-err">{err}</p>}
    {!data && !err && <p className="acc-dim"><Loader2 size={12} className="spin" />正在读取…</p>}
    {data && (data.items.length ? <table className="acc-logs"><thead><tr><th>时间</th><th>模型</th><th>输入 / 输出</th><th>用时</th><th>金额</th></tr></thead>
      <tbody>{data.items.map((l, i) => <tr key={i}><td>{new Date(l.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>{l.model}</td><td className="num">{l.input} / {l.output}</td><td className="num">{l.seconds}s</td><td className="num">{yuan(l.cost)}</td></tr>)}</tbody></table>
      : <p className="acc-dim">最近 30 天还没有消费。</p>)}
    {pages > 1 && <div className="acc-b left"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span className="acc-foot">{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</button></div>}
  </section>;
}

function PriceBoard() {
  const [b, setB] = useState<Board | null>(null);
  const [tier, setTier] = useState<'save' | 'balanced' | 'quality'>('quality');
  useEffect(() => { void accountApi.board().then(setB).catch((e) => setB({ ready: false, reason: (e as Error).message })); }, []);
  return <section className="acc-sec" data-qa="acc-board">
    <h4>价格板<em>仅估算，以实际账单为准</em></h4>
    {!b && <p className="acc-dim"><Loader2 size={12} className="spin" />正在读取…</p>}
    {b && !b.ready && <p className="acc-dim" data-qa="acc-board-off">{b.reason}</p>}
    {b?.ready && <>
      <div className="tier-seg small">{b.tiers.map((t) => <button key={t.id} className={(tier === t.id ? 'on ' : '') + 't-' + t.id} onClick={() => setTier(t.id)}>{TIER_NAME[t.id] ?? t.name}</button>)}</div>
      {b.tiers.find((t) => t.id === tier)?.sections.map((s) => <div key={s.kind} className="acc-price">
        <h5>{s.kind === 'text' ? '文字（每百万 tokens）' : '图片'}</h5>
        {s.none ? <p className="acc-dim">{s.none}</p> : <table className="acc-logs"><tbody>{s.items.slice(0, 20).map((i) => <tr key={i.model} className={i.configured ? 'mine' : ''}><td>{i.model}{i.configured && <em>你在用</em>}</td>
          <td className="num">{!i.available ? '暂无报价' : s.kind === 'text' ? `输入 ¥${i.input_cny} · 输出 ¥${i.output_cny}` : i.min_cny === i.max_cny ? `¥${i.min_cny} / ${i.unit === 'per_image' ? '张' : '次'}` : `¥${i.min_cny}～¥${i.max_cny} / ${i.unit === 'per_image' ? '张' : '次'}`}</td></tr>)}</tbody></table>}
      </div>)}
      <p className="acc-dim">{b.notice}。画图每次都会先报价，你确认了才扣钱。</p>
    </>}
  </section>;
}
