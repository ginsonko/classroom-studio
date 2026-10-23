// 插件页：装好的插件（开关、导出、复制、历史版本、删除）、导出模板、示例插件、导入（按钮或拖进来）。
import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Download, FolderOpen, FolderInput, History, Loader2, PackageOpen, Pause, Play, Puzzle, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { loadPlugins, openPanel, openShapes, usePlugins, whereText, type Manifest, type PluginItem, type PluginList, type Staged } from './pluginStore';
import { PluginIcon } from './PluginUi';
import '../styles/agents.css';
import '../styles/study.css';
import '../styles/plugins.css';

/** 去备课页的 AI 工坊：id 给了就是改这个插件，空的是新做一个 */
function toWorkshop(id = '') {
  usePlugins.setState({ workshop: { id } });
  useStore.getState().set({ page: 'agents' });
}

const DOC_KINDS: { k: string; name: string }[] = [
  { k: 'homework', name: '作业' }, { k: 'paper', name: '试卷' }, { k: 'wrongbook', name: '错题本' }, { k: 'lesson', name: '课后总结' },
];
interface Example extends Manifest { folder: string; installed: boolean }
interface HistoryRow { name: string; at: number; version: string; reason: string; bytes: number }

const fmtBytes = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fmtDate = (t: number) => t ? new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

/** 插件给导播台加了什么：老师一眼能看懂的话 */
export function contributionText(m: Manifest) {
  const c = m.contributes, out: string[] = [];
  if (c.panels.length) out.push(`${c.panels.length} 个工具面板`);
  if (c.lessons.length) out.push(`${c.lessons.length} 个学生画面页面`);
  if (c.pages.length) out.push(`学情页多 ${c.pages.length} 个分页`);
  const shapes = c.shapes.reduce((a, g) => a + g.items.length, 0);
  if (shapes) out.push(`绘图库多 ${shapes} 个图形`);
  if (c.skills.length) out.push(`${c.skills.length} 种 AI 备课任务`);
  if (c.templates.length) out.push(`${c.templates.length} 套导出模板`);
  return out;
}


export function PluginsPage() {
  const list = usePlugins((s) => s.list), loadError = usePlugins((s) => s.error);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(''), [over, setOver] = useState(false);
  const [history, setHistory] = useState<{ id: string; rows: HistoryRow[] } | null>(null);
  const refreshExamples = () => host.call<Example[]>('plugins.examples').then(setExamples).catch(() => {});
  useEffect(() => { void loadPlugins(true); void refreshExamples(); }, []);
  useEffect(() => { void refreshExamples(); }, [list]);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setErr(''); setBusy(key);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const stage = (fn: () => Promise<Staged | null>) => run('stage', async () => { const s = await fn(); if (s) setStaged(s); });
  const apply = (l: PluginList) => usePlugins.setState({ list: l });

  const drop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0], p = f && host.pathForFile(f);
    if (!p) { setErr('请把插件包（.csplugin / .zip）或插件文件夹拖进来'); return; }
    void stage(() => host.call<Staged>('plugins.inspectPath', { path: p }));
  };

  const items = list?.items ?? [];
  return <div className={'ags pl-page' + (over ? ' drop' : '')}
    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
    onDragLeave={(e) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver(false); }}
    onDrop={drop}>
    <header className="ags-head">
      <div className="ags-title"><Puzzle size={20} /><h2>插件</h2><span className="sd-note">给导播台加小工具：计时器、随机点名、绘图库图形、AI 备课任务、导出模板……</span></div>
      <div className="pl-head-acts">
        <button className="sd-btn" disabled={!!busy} onClick={() => void stage(() => host.call<Staged | null>('plugins.pickImport', {}))}><Upload size={14} />导入插件包</button>
        <button className="sd-btn" disabled={!!busy} onClick={() => void stage(() => host.call<Staged | null>('plugins.pickImport', { folder: true }))}><FolderInput size={14} />从文件夹导入</button>
        {list && <button className={'sd-btn' + (list.paused ? ' on' : '')} onClick={() => void run('pause', async () => apply(await host.call<PluginList>('plugins.pause', { on: !list.paused })))} data-tip="上课出问题时一键停掉所有插件，导播台本身不受影响">{list.paused ? <><Play size={14} />恢复全部插件</> : <><Pause size={14} />暂停全部插件</>}</button>}
      </div>
    </header>
    <div className="pl-body">
      {list?.safeMode && <div className="pl-banner warn"><AlertTriangle size={16} /><span>上两次软件都没能正常运行，为了保险这次没有加载插件。如果是某个插件引起的，可以先把它关掉，再点「恢复加载」。</span><button className="sd-btn" onClick={() => void run('safe', async () => apply(await host.call<PluginList>('plugins.pause', { on: false })))}>恢复加载</button></div>}
      {(err || loadError) && <p className="sd-err">{err || loadError}</p>}

      <section>
        <h3>已安装 <span className="sd-note">{items.length ? `${items.length} 个` : ''}</span></h3>
        {!list ? <p className="sd-note"><Loader2 size={13} className="ags-spin" /> 正在读取…</p>
          : !items.length ? <div className="pl-empty-big"><PackageOpen size={34} /><p>还没有插件。可以先装下面的示例试试，或者把别人分享的 .csplugin 文件拖进来。</p></div>
          : <div className="pl-list">{items.map((p) => <PluginCard key={p.id} p={p} names={list.permissionNames} busy={busy} run={run} apply={apply}
            onHistory={() => void run('hist', async () => setHistory({ id: p.id, rows: await host.call<HistoryRow[]>('plugins.history', { id: p.id }) }))} />)}</div>}
      </section>

      {history && <HistoryDialog id={history.id} rows={history.rows} name={items.find((x) => x.id === history.id)?.name ?? history.id} onClose={() => setHistory(null)}
        onRollback={(row) => void run('roll', async () => {
          if (!confirm(`把插件回到 ${fmtDate(row.at)} 的版本（v${row.version}）？\n现在的版本会先存进历史，之后还能再换回来。`)) return;
          await host.call('plugins.rollback', { id: history.id, name: row.name }); await loadPlugins(true); setHistory(null); toast('已回到所选版本');
        })} />}

      {items.some((p) => p.contributes.templates.length) && <TemplatePicker list={list!} run={run} apply={apply} />}

      <section>
        <h3>示例插件 <span className="sd-note">导播台自带，装上就能用，也可以照着改</span></h3>
        <div className="pl-examples">{examples.map((x) => <article key={x.folder} className="pl-ex">
          <PluginIcon p={{ id: '', icon: '', name: x.name }} size={28} />
          <div><b>{x.name}</b><p>{x.description}</p><small>{contributionText(x).join(' · ')}</small></div>
          <button className="sd-btn" disabled={!!busy} onClick={() => void stage(() => host.call<Staged>('plugins.stageExample', { folder: x.folder }))}>{x.installed ? '重新安装' : '安装'}</button>
        </article>)}</div>
      </section>

      <section className="pl-dev">
        <h3>自己做插件</h3>
        <p>插件就是一个文件夹：里面一个 <code>plugin.json</code> 写清楚名字、要用的权限和加到哪里，再加上网页、图片等文件。打包成 zip 改名为 <code>.csplugin</code> 就能分享给别的老师。</p>
        <p>不会写代码也没关系：在「备课」页的 <b>AI 工坊</b> 里说清楚想要什么，AI 会按插件协议写好、检查、预览，满意了一键安装。</p>
        <p><button className="sd-btn" onClick={() => toWorkshop()}><Sparkles size={14} />让 AI 做一个新插件</button></p>
        <p className="sd-note"><ShieldCheck size={13} /> 插件运行在独立的沙盒里：拿不到电脑上的文件和 AI 密钥，只能做安装时你同意过的事；出错太多会自动停用，不影响上课。</p>
      </section>
    </div>
    {over && <div className="pl-drop">松手导入插件</div>}
    {staged && <InstallDialog s={staged} busy={busy === 'install'}
      onCancel={() => { void host.call('plugins.discard', { token: staged.token }).catch(() => {}); setStaged(null); }}
      onInstall={() => void run('install', async () => {
        const p = await host.call<PluginItem>('plugins.install', { token: staged.token });
        setStaged(null); await loadPlugins(true);
        const where = whereText(p), panel = p.contributes.panels.find((x) => x.where.includes('console')), g = p.contributes.shapes.findIndex((x) => x.items.length);
        toast(`已安装「${p.name}」` + (where.length ? `，在${where[0]}里用` : ''), panel ? { action: { label: '打开', run: () => { useStore.getState().set({ page: 'console' }); openPanel(p.id, panel.id); } } } : g >= 0 ? { action: { label: '去绘图库', run: () => openShapes(p, g) } } : {});
      })} />}
  </div>;
}

function PluginCard({ p, names, busy, run, apply, onHistory }: { p: PluginItem; names: Record<string, string>; busy: string; run: (k: string, fn: () => Promise<unknown>) => Promise<void>; apply: (l: PluginList) => void; onHistory: () => void }) {
  const panel0 = p.contributes.panels.find((x) => x.where.includes('console'));
  return <article className={'pl-card' + (p.active ? '' : ' off')}>
    <PluginIcon p={p} size={34} />
    <div className="pl-main">
      <div className="pl-title"><b>{p.name}</b><span className="num">v{p.version}</span>{p.author && <i>{p.author}</i>}</div>
      {p.description && <p>{p.description}</p>}
      <div className="pl-chips">{contributionText(p).map((t) => <span key={t} className="sd-tag">{t}</span>)}</div>
      {p.active && !!whereText(p).length && <p className="pl-where"><b>在哪用：</b>{whereText(p).join('；')}</p>}
      <div className="pl-perms">{p.permissions.length ? p.permissions.map((k) => <span key={k} data-tip={names[k]}>{names[k] ?? k}</span>) : <span className="none">不需要任何权限</span>}
        {!!p.network.length && <span className="net" data-tip="插件可以访问这些网站">联网：{p.network.join('、')}</span>}</div>
      {p.disabledReason && <p className="pl-bad"><AlertTriangle size={13} />{p.disabledReason}</p>}
      {!!p.problems.length && <p className="pl-bad"><AlertTriangle size={13} />{p.problems.slice(0, 3).join('；')}</p>}
    </div>
    <div className="pl-side">
      <button className={'pl-switch' + (p.enabled ? ' on' : '')} role="switch" aria-checked={p.enabled} disabled={!!busy}
        onClick={() => void run('en' + p.id, async () => apply(await host.call<PluginList>('plugins.enable', { id: p.id, on: !p.enabled })))}><i />{p.enabled ? '已启用' : '已停用'}</button>
      <div className="pl-acts">
        {panel0 && p.active && <button className="sd-btn" onClick={() => { useStore.getState().set({ page: 'console' }); openPanel(p.id, panel0.id); }}>打开</button>}
        {!panel0 && p.active && p.contributes.shapes.some((g) => g.items.length) && <button className="sd-btn" data-tip="在上课浮层工具条里打开绘图库，停在这个插件的图形分组" onClick={() => { openShapes(p, p.contributes.shapes.findIndex((g) => g.items.length)); toast('已在浮层工具条打开绘图库，点一个图形就放到黑板上'); }}>去绘图库</button>}
        {!panel0 && p.active && !p.contributes.shapes.length && !!p.contributes.pages.length && <button className="sd-btn" onClick={() => useStore.getState().set({ page: 'study' })}>去学情</button>}
        <button className="sd-btn" data-tip="在 AI 工坊里说想怎么改，AI 改好后先预览，满意了再更新" onClick={() => toWorkshop(p.id)}><Sparkles size={14} /></button>
        <button className="sd-btn" disabled={!!busy} data-tip="导出成 .csplugin 文件，可以发给别的老师" onClick={() => void run('ex', async () => { const to = await host.call<string | null>('plugins.export', { id: p.id }); if (to) toast('已导出：' + to); })}><Download size={14} /></button>
        <button className="sd-btn" disabled={!!busy} data-tip="复制一份（想改又怕改坏时用）" onClick={() => void run('dup', async () => { const n = await host.call<PluginItem>('plugins.duplicate', { id: p.id }); toast(`已复制为「${n.name}」`); await loadPlugins(true); })}><Copy size={14} /></button>
        <button className="sd-btn" disabled={!!busy} data-tip="历史版本：每次更新、回退、AI 修改前都会自动存一份" onClick={onHistory}><History size={14} /></button>
        <button className="sd-btn" data-tip="打开插件所在的文件夹" onClick={() => void run('rev', () => host.call('plugins.reveal', { id: p.id }))}><FolderOpen size={14} /></button>
        <button className="sd-btn danger" disabled={!!busy} data-tip="删除（会先存一份到历史版本）" onClick={() => void run('rm', async () => {
          if (!confirm(`删除插件「${p.name}」？\n它保存的数据也会一起删除；插件本身会在历史版本里留一份备份。`)) return;
          apply(await host.call<PluginList>('plugins.remove', { id: p.id })); toast(`已删除「${p.name}」`);
        })}><Trash2 size={14} /></button>
      </div>
      {p.updatedAt > 0 && <small className="sd-note">更新于 {fmtDate(p.updatedAt)}</small>}
    </div>
  </article>;
}

function InstallDialog({ s, busy, onCancel, onInstall }: { s: Staged; busy: boolean; onCancel: () => void; onInstall: () => void }) {
  const m = s.manifest, old = s.existing;
  const added = m && old ? m.permissions.filter((k) => !old.permissions.includes(k)) : [];
  const addedNet = m && old ? m.network.filter((h) => !old.network.includes(h)) : [];
  return <div className="pl-modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <div className="pl-modal" role="dialog" aria-label="安装插件">
      {!m ? <><h3>不能安装</h3><ul className="pl-problems">{s.problems.map((x) => <li key={x}>{x}</li>)}</ul></> : <>
        <header><PluginIcon p={{ id: '', icon: '', name: m.name }} size={36} /><div><h3>{old ? `更新「${m.name}」` : `安装「${m.name}」`}</h3><span className="sd-note">v{old ? `${old.version} → ` : ''}{m.version}{m.author ? ` · ${m.author}` : ''} · {s.files} 个文件，{fmtBytes(s.bytes)}</span></div></header>
        {m.description && <p>{m.description}</p>}
        {!!contributionText(m).length && <p className="sd-note">会添加：{contributionText(m).join('、')}</p>}
        <h4>需要的权限</h4>
        {m.permissions.length ? <ul className="pl-permlist">{m.permissions.map((k) => <li key={k} className={added.includes(k) ? 'new' : ''}>{s.permissionNames[k] ?? k}{added.includes(k) && <em>新增</em>}</li>)}</ul> : <p className="sd-note">不需要任何权限，只在自己的窗口里运行。</p>}
        {!!m.network.length && <><h4>需要联网</h4><ul className="pl-permlist">{m.network.map((h) => <li key={h} className={addedNet.includes(h) ? 'new' : ''}>{h}{addedNet.includes(h) && <em>新增</em>}</li>)}</ul></>}
        {!!s.problems.length && <><h4 className="bad">有问题，不能安装</h4><ul className="pl-problems">{s.problems.map((x) => <li key={x}>{x}</li>)}</ul></>}
        {old && <p className="sd-note">旧版本会自动存进历史版本，装完不满意可以回退。</p>}
      </>}
      <footer>
        <button className="sd-btn" disabled={busy} onClick={onCancel}>取消</button>
        {m && !s.problems.length && <button className="sd-btn primary" disabled={busy} onClick={onInstall}>{busy ? <Loader2 size={14} className="ags-spin" /> : <Sparkles size={14} />}{old ? '更新' : '安装'}</button>}
      </footer>
    </div>
  </div>;
}

function HistoryDialog({ name, rows, onClose, onRollback }: { id: string; name: string; rows: HistoryRow[]; onClose: () => void; onRollback: (r: HistoryRow) => void }) {
  return <div className="pl-modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="pl-modal" role="dialog" aria-label="历史版本">
      <header><History size={20} /><div><h3>「{name}」的历史版本</h3><span className="sd-note">每次更新、回退、删除、AI 修改之前都会自动保存一份，最多保留 20 份</span></div></header>
      {!rows.length ? <p className="sd-note">还没有历史版本。</p> : <ul className="pl-history">{rows.map((r) => <li key={r.name}>
        <span className="num">{fmtDate(r.at)}</span><b>v{r.version}</b><i>{r.reason}</i><small>{fmtBytes(r.bytes)}</small>
        <button className="sd-btn" onClick={() => onRollback(r)}>回到这个版本</button>
      </li>)}</ul>}
      <footer><button className="sd-btn" onClick={onClose}>关闭</button></footer>
    </div>
  </div>;
}

function TemplatePicker({ list, run, apply }: { list: PluginList; run: (k: string, fn: () => Promise<unknown>) => Promise<void>; apply: (l: PluginList) => void }) {
  const all = list.items.filter((p) => p.active).flatMap((p) => p.contributes.templates.map((t) => ({ p, t })));
  return <section>
    <h3>导出模板 <span className="sd-note">作业、试卷等导出成 Word / PDF 时用的版式</span></h3>
    <div className="pl-templates">{DOC_KINDS.map((d) => {
      const opts = all.filter(({ t }) => t.kinds.includes(d.k) || t.kinds.includes('all'));
      return <label key={d.k}><span>{d.name}</span>
        <select value={list.templates[d.k] ?? ''} disabled={!opts.length} onChange={(e) => void run('tpl', async () => apply(await host.call<PluginList>('plugins.setTemplate', { kind: d.k, ref: e.target.value })))}>
          <option value="">默认版式</option>
          {opts.map(({ p, t }) => <option key={p.id + t.id} value={`${p.id}/${t.id}`}>{t.title}（{p.name}）</option>)}
        </select>
      </label>;
    })}</div>
  </section>;
}
