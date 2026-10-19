import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Copy, Download, ExternalLink, Info, Loader2, RefreshCw, Rocket, Search, X } from 'lucide-react';
import { MANUAL, QQ_GROUP, REPO, SITE, YINZI, type Chapter } from '../help/manual';
import { checkUpdate, downloadUpdate, installUpdate, mb, openHelp, openPage, setUpdateCheck, skipVersion, useHelp } from '../lib/update';
import { host } from '../lib/host';
import { Logo } from '../ui/icons';
import '../styles/help.css';

/** 帮助中心：说明书 + 关于与更新 */
export function HelpCenter() {
  const open = useHelp((s) => s.open);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') useHelp.setState({ open: false }); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open]);
  if (!open) return null;
  return (
    <div className="help-bg" onPointerDown={(e) => e.target === e.currentTarget && useHelp.setState({ open: false })}>
      <section className="help" role="dialog" aria-label="帮助">
        <header className="help-h">
          <Logo size={26} />
          <div><b>最强网课教辅系统</b><small>帮助中心</small></div>
          <nav className="help-tabs">
            <button className={open === 'manual' ? 'on' : ''} onClick={() => openHelp('manual')}><BookOpen size={14} />说明书</button>
            <button className={open === 'about' ? 'on' : ''} onClick={() => openHelp('about')}><Info size={14} />关于与更新<UpdateDot /></button>
          </nav>
          <span className="flex" />
          <button className="help-x" aria-label="关闭帮助" onClick={() => useHelp.setState({ open: false })}><X size={18} /></button>
        </header>
        {open === 'manual' ? <Manual /> : <About />}
      </section>
    </div>
  );
}

const UpdateDot = () => { const p = useHelp((s) => s.update.phase); return ['available', 'ready'].includes(p) ? <i className="help-dot" /> : null; };

function Manual() {
  const section = useHelp((s) => s.section);
  const [q, setQ] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return MANUAL;
    const text = (c: Chapter) => [c.title, c.scene, ...(c.steps ?? []), ...(c.tips ?? []), ...(c.table ?? []).flat()].join(' ').toLowerCase();
    return MANUAL.filter((c) => words.every((w) => text(c).includes(w)));
  }, [q]);
  const go = (id: string) => { useHelp.setState({ section: id }); body.current?.querySelector('#help-' + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  useEffect(() => { if (section) setTimeout(() => body.current?.querySelector('#help-' + section)?.scrollIntoView({ block: 'start' }), 30); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = [...new Set(hits.map((c) => c.group))];
  return (
    <div className="help-main">
      <aside className="help-nav">
        <label className="help-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索说明书，比如 录像" spellCheck={false} />{q && <button onClick={() => setQ('')} aria-label="清除搜索"><X size={12} /></button>}</label>
        {groups.map((g) => (
          <div key={g} className="help-ng"><small>{g}</small>
            {hits.filter((c) => c.group === g).map((c) => <button key={c.id} className={section === c.id ? 'on' : ''} onClick={() => go(c.id)}>{c.title}</button>)}
          </div>
        ))}
        {!hits.length && <p className="help-none">没有找到「{q}」，换个词试试。</p>}
        <div className="help-qq">遇到问题？<br />QQ 群 <b className="num">{QQ_GROUP}</b></div>
      </aside>
      <div className="help-body" ref={body}>
        {hits.map((c) => (
          <article key={c.id} id={'help-' + c.id} className="help-ch">
            <small>{c.group}</small>
            <h2>{c.title}</h2>
            <p className="help-scene">{c.scene}</p>
            {c.steps && <ol>{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            {c.table && <table><tbody>{c.table.map(([a, b]) => <tr key={a}><th>{a}</th><td>{b}</td></tr>)}</tbody></table>}
            {c.tips && <ul className="help-tips">{c.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          </article>
        ))}
      </div>
    </div>
  );
}

function About() {
  const { update: u, version, check, skip } = useHelp();
  const [copied, setCopied] = useState(false);
  const info = u.info, newer = !!info && info.latest !== info.current && ['available', 'downloading', 'ready'].includes(u.phase);
  const copy = () => void navigator.clipboard.writeText(QQ_GROUP).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  return (
    <div className="help-about">
      <div className="ab-hero">
        <Logo size={56} />
        <div>
          <h2>最强网课教辅系统</h2>
          <p>给一对一网课老师的上课、录课、备课一体化工具</p>
          <span className="ab-ver">版本 <b className="num">{version || '开发版'}</b>{host.electron ? '' : ' · 浏览器预览'}</span>
        </div>
      </div>

      <section className="ab-card ab-update">
        <h3><Rocket size={15} />软件更新</h3>
        {u.phase === 'checking' ? <p><Loader2 size={13} className="spin" /> 正在检查新版本…</p>
          : newer && info ? (
            <>
              <p className="ab-new">发现新版本 <b className="num">{info.latest}</b>{info.date && <i>（{info.date}）</i>}</p>
              {info.notes.length > 0 && <ul className="ab-notes">{info.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              {u.phase === 'downloading' ? (
                <div className="ab-prog"><div><i style={{ width: `${u.total ? Math.min(100, ((u.got ?? 0) / u.total) * 100) : 5}%` }} /></div><span className="num">{u.note || `${mb(u.got)} / ${mb(u.total)}`}</span></div>
              ) : u.phase === 'ready' ? (
                <div className="ab-acts"><button className="go" onClick={() => void installUpdate()}><RefreshCw size={14} />重启并安装</button><span className="ab-hint">软件会关闭几秒后自动打开，数据不受影响</span></div>
              ) : info.auto ? (
                <div className="ab-acts"><button className="go" onClick={() => void downloadUpdate()}><Download size={14} />立即更新</button><span className="ab-hint">只下载变了的部分，约 {mb(info.bytes)}</span><button className="ghost" onClick={() => skipVersion(info.latest)}>{skip === info.latest ? '已跳过这个版本' : '跳过这个版本'}</button></div>
              ) : (
                <div className="ab-acts"><button className="go" onClick={() => void openPage(info.page)}><ExternalLink size={14} />去官网下载</button><span className="ab-hint">{info.reason}</span></div>
              )}
            </>
          ) : u.phase === 'latest' ? <p className="ab-ok"><Check size={14} />已经是最新版本</p>
          : u.phase === 'done' && u.result ? <p className="ab-ok"><Check size={14} />已从 {u.result.from} 更新到 {u.result.to}</p>
          : u.phase === 'failed' && u.result ? <p className="ab-err">更新没完成，已恢复到 {u.result.from}：{u.result.error}</p>
          : <p className="ab-hint">打开软件后会自动检查一次，也可以手动检查。更新从不强制。</p>}
        {u.error && <p className="ab-err">{u.error}</p>}
        <div className="ab-row">
          <button onClick={() => void checkUpdate()} disabled={!host.electron || ['checking', 'downloading'].includes(u.phase)}><RefreshCw size={13} />检查更新</button>
          <label><input type="checkbox" checked={check} disabled={!host.electron} onChange={(e) => void setUpdateCheck(e.target.checked)} />打开软件时自动检查</label>
        </div>
      </section>

      <div className="ab-grid">
        <section className="ab-card">
          <h3>交流与反馈</h3>
          <p>使用问题、功能建议、单位授权，都可以在 QQ 群里找到作者。</p>
          <div className="ab-qq"><span>QQ 群</span><b className="num">{QQ_GROUP}</b><button onClick={copy}>{copied ? <><Check size={13} />已复制</> : <><Copy size={13} />复制群号</>}</button></div>
        </section>
        <section className="ab-card">
          <h3>授权</h3>
          <p>开放源代码。<b>个人老师免费使用</b>（包括自己的收费家教课）；<b>公司、学校、培训机构等单位使用需要授权</b>，请在 QQ 群联系。不允许出售本软件或它的修改版。</p>
          <button className="link" onClick={() => openHelp('manual', 'license')}>查看授权说明</button>
        </section>
      </div>

      <section className="ab-card ab-links">
        <button onClick={() => void openPage(SITE)}><ExternalLink size={13} />官网与下载</button>
        <button onClick={() => void openPage(REPO)}><ExternalLink size={13} />GitHub 源码</button>
        <button onClick={() => void openPage(YINZI)}><ExternalLink size={13} />银子 API（AI 接口）</button>
        <button onClick={() => openHelp('manual')}><BookOpen size={13} />说明书</button>
      </section>
      <p className="ab-foot">内置第三方组件：Electron（MIT）、Codex CLI（Apache-2.0）、FFmpeg（GPL）、PDF.js、three.js、KaTeX 等，按各自的开源协议使用。</p>
    </div>
  );
}

/** 右下角的更新提示：静默检查发现新版本、上次更新的结果 */
export function UpdateToast() {
  const { toast, update: u } = useHelp();
  if (!toast) return null;
  const hide = () => useHelp.setState({ toast: false });
  if (u.phase === 'done' && u.result) return <div className="up-toast ok" role="status"><b>已更新到 {u.result.to}</b><span>看看这次更新了什么？</span><div><button className="go" onClick={() => openHelp('about')}>查看</button><button onClick={hide}>关闭</button></div></div>;
  if (u.phase === 'failed' && u.result) return <div className="up-toast bad" role="alert"><b>更新没完成</b><span>已恢复到 {u.result.from}，可以稍后再试。{u.result.error}</span><div><button onClick={hide}>知道了</button></div></div>;
  if (!['available', 'downloading', 'ready'].includes(u.phase) || !u.info) return null;
  const info = u.info;
  return (
    <div className="up-toast" role="status">
      <b>发现新版本 {info.latest}</b>
      <span>{info.notes[0] || '有新的改进和修复。'}{info.notes.length > 1 ? ` 等 ${info.notes.length} 项` : ''}</span>
      <div>
        <button className="go" onClick={() => { openHelp('about'); if (info.auto && u.phase === 'available') void downloadUpdate(); }}>{info.auto ? '立即更新' : '查看'}</button>
        <button onClick={hide}>以后再说</button>
        <button className="ghost" onClick={() => skipVersion(info.latest)}>跳过这个版本</button>
      </div>
    </div>
  );
}
