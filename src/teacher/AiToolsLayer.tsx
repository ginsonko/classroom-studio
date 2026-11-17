// AI 工具的全局界面：老师要拍板的确认卡片（键鼠授权、浏览器里的付款 / 提交 / 下载）、AI 浏览器面板
// （网页本身是主进程挂在这个面板位置上的原生视图）、键鼠控制的状态条。挂在教师窗口最外层，哪个页面都看得到。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, Hand, Loader2, Minus, MousePointer2, Pause, Play, RotateCw, ShieldAlert, X } from 'lucide-react';
import { host } from '../lib/host';
import { answerConfirm, browserAction, closeBrowserPane, deskResume, deskStop, openBrowser, startAiTools, useAiTools, type AiConfirm, type BrowserState } from '../lib/aiTools';
import '../styles/aitools.css';

export function AiToolsLayer() {
  useEffect(() => startAiTools(), []);
  return <>
    <DeskBar />
    <BrowserPane />
    <BrowserChip />
    <Confirms />
  </>;
}

const CHOICE: Record<string, string> = { once: '这次允许', always: '这个任务一直允许', deny: '不允许' };

function Confirms() {
  const items = useAiTools((s) => s.confirms);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!items.length) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [items.length]);
  if (!items.length) return null;
  return <div className="aitc-stack" role="region" aria-label="AI 需要你确认">
    {items.map((c) => <ConfirmCard key={c.id} c={c} left={Math.max(0, Math.round((c.expires - now) / 1000))} />)}
  </div>;
}

function ConfirmCard({ c, left }: { c: AiConfirm; left: number }) {
  const label = (k: string) => (k === 'once' && c.choices.length === 2 ? '允许' : k === 'always' && c.key === 'assistant' ? '小羽一直允许' : CHOICE[k]);
  return <div className={'aitc-card k-' + c.kind} data-qa="aitools-confirm">
    <div className="aitc-h">{c.kind === 'desk' ? <MousePointer2 size={15} /> : <ShieldAlert size={15} />}<b>{c.title}</b><i>{left}s</i></div>
    <p className="aitc-who">{c.who}{c.site ? ` · ${c.site}` : ''}</p>
    {c.detail && <p className="aitc-d">{c.detail}</p>}
    <div className="aitc-b">
      {c.choices.map((k) => <button key={k} className={k === 'deny' ? 'no' : k === 'once' ? 'yes' : ''} data-qa={'aitools-confirm-' + k} onClick={() => void answerConfirm(c.id, k)}>{label(k)}</button>)}
    </div>
    <p className="aitc-hint">不点的话 {left} 秒后按「不允许」处理</p>
  </div>;
}

function DeskBar() {
  const d = useAiTools((s) => s.desk);
  if (!d) return null;
  return <div className={'aitd-bar' + (d.paused ? ' paused' : '')} role="status" data-qa="aitools-desk">
    {d.paused ? <Hand size={15} /> : <MousePointer2 size={15} />}
    <span>{d.paused ? <>键鼠已暂停：{d.why || '你动了键鼠'}</> : <>{d.who}正在操作键鼠，你一动键鼠它就会停下；急停：Ctrl+Alt+Q</>}</span>
    {d.paused && <button className="yes" onClick={() => void deskResume()}><Play size={13} />继续</button>}
    <button onClick={() => void deskStop()}><X size={13} />停止</button>
  </div>;
}

function BrowserChip() {
  const browsers = useAiTools((s) => s.browsers), pane = useAiTools((s) => s.pane), min = useAiTools((s) => s.min);
  const list = Object.values(browsers);
  if (!list.length || (pane && !min)) return null;
  const wait = list.find((b) => b.handoff || b.paused);
  return <button className={'aitb-chip' + (wait ? ' wait' : list.some((b) => b.driving) ? ' live' : '')} data-qa="aitools-browser-chip" onClick={() => openBrowser((wait ?? list[0]).key)}>
    <Globe size={14} />AI 浏览器{list.length > 1 ? `（${list.length}）` : ''}{wait ? ' · 等你操作' : list.some((b) => b.driving) ? ' · AI 在操作' : ''}
  </button>;
}

function BrowserPane() {
  const key = useAiTools((s) => s.pane), min = useAiTools((s) => s.min), browsers = useAiTools((s) => s.browsers);
  const b = key ? browsers[key] : undefined;
  const body = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  const shown = !!key && !min;
  useEffect(() => { setUrl(b?.url ?? ''); }, [b?.url]);
  // 网页是原生视图：把面板正文的位置告诉主进程；面板关掉或缩小时藏起来
  useLayoutEffect(() => {
    if (!shown || !key) return;
    const el = body.current; if (!el) return;
    let last = '';
    const report = () => {
      const r = el.getBoundingClientRect(), rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      const sig = JSON.stringify(rect); if (sig === last) return; last = sig;
      void host.call('aitools.browserShow', { key, rect }).catch(() => {});
    };
    report();
    const ro = new ResizeObserver(report); ro.observe(el);
    window.addEventListener('resize', report);
    const t = setInterval(report, 1000);
    return () => { ro.disconnect(); window.removeEventListener('resize', report); clearInterval(t); void host.call('aitools.browserShow', { key, rect: null }).catch(() => {}); };
  }, [shown, key]);
  if (!key) return null;
  const others = Object.values(browsers).filter((x) => x.key !== key);
  const st: BrowserState | undefined = b;
  if (min) return null;
  return <div className="aitb-pane" data-qa="aitools-browser">
    <div className="aitb-head">
      <Globe size={15} /><b>AI 浏览器</b><span className="aitb-who">{st ? `${st.who}${st.title ? `「${st.title}」` : ''}` : ''}</span>
      {others.length > 0 && <select value={key} onChange={(e) => openBrowser(e.target.value)} aria-label="换一个任务的浏览器">{[st, ...others].filter(Boolean).map((x) => <option key={x!.key} value={x!.key}>{x!.who}{x!.title ? ` · ${x!.title}` : ''}</option>)}</select>}
      <span className="flex" />
      <button aria-label="缩小" data-tip="先收起来，AI 继续在后台操作" onClick={() => useAiTools.setState({ min: true })}><Minus size={14} /></button>
      <button aria-label="关闭面板" data-tip="关闭面板（AI 的浏览器还在，可以从右下角再打开）" onClick={closeBrowserPane}><X size={14} /></button>
    </div>
    {st ? <>
      <div className="aitb-bar">
        <button disabled={!st.canBack} aria-label="后退" onClick={() => void browserAction(key, 'back')}><ArrowLeft size={14} /></button>
        <button disabled={!st.canForward} aria-label="前进" onClick={() => void browserAction(key, 'forward')}><ArrowRight size={14} /></button>
        <button aria-label="刷新" onClick={() => void browserAction(key, 'reload')}>{st.loading ? <Loader2 size={14} className="ags-spin" /> : <RotateCw size={14} />}</button>
        <form onSubmit={(e) => { e.preventDefault(); void browserAction(key, 'go', url); }}><input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} placeholder="网址" aria-label="网址" /></form>
        {st.paused ? <button className="yes" data-qa="aitools-browser-resume" onClick={() => void browserAction(key, 'resume')}><Play size={13} />继续</button>
          : <button onClick={() => void browserAction(key, 'pause')} data-tip="暂停 AI，自己操作"><Pause size={13} />暂停 AI</button>}
      </div>
      {st.tabs.length > 1 && <div className="aitb-tabs">{st.tabs.map((t) => <button key={t.i} className={t.active ? 'on' : ''} onClick={() => void browserAction(key, 'tab', t.i)}>{t.title}</button>)}</div>}
      {(st.handoff || st.notice || st.driving) && <div className={'aitb-note' + (st.handoff ? ' handoff' : st.paused ? ' paused' : '')}>
        {st.handoff ? <><Hand size={14} /><span>{st.handoff ? `AI 请你帮忙：${st.handoff}。在下面的网页里完成后点「继续」。` : ''}</span></> : st.paused ? <><Pause size={14} /><span>{st.notice}</span></> : st.driving ? <><Loader2 size={13} className="ags-spin" /><span>AI 正在操作网页{st.notice ? `：${st.notice}` : ''}（你一动鼠标键盘它就暂停）</span></> : <span>{st.notice}</span>}
      </div>}
    </> : <div className="aitb-note">这个任务还没有打开网页。</div>}
    <div className="aitb-body" ref={body}>{!st && <p>AI 用 browser_open 打开网页后会显示在这里。</p>}</div>
    <p className="aitb-foot">独立的浏览器，和你自己的浏览器、教辅的课件页面分开；网页需要登录时请你自己登，软件不保存密码。</p>
  </div>;
}
