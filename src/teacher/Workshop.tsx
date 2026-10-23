// AI 工坊的零件：思考档位、附件（选文件 / 拖进来 / Ctrl+V 截图）、做插件任务的实时预览和「装上」。
import { useCallback, useEffect, useState, type ClipboardEvent, type DragEvent } from 'react';
import { CheckCircle2, Loader2, Paperclip, PackageCheck, RefreshCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { loadPlugins, openPanel, openShapes, pluginUrl, usePlugins, whereText, type Manifest, type PluginItem } from '../plugins/pluginStore';
import { PluginFrame } from '../plugins/PluginFrame';

export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh';
export const EFFORT_NAME: Record<Effort, string> = { '': '默认', low: '低', medium: '中', high: '高', xhigh: '极高' };
const EFFORT_HINT: Record<Effort, string> = {
  '': '用模型自己的默认档位',
  low: '想得少、回得快、省钱：改改颜色文字这类小事',
  medium: '大多数任务够用',
  high: '复杂的课件、插件、需要反复推敲的题目',
  xhigh: '最难的任务；更慢、更贵，部分模型不支持',
};

export function EffortSeg({ value, onChange }: { value: Effort; onChange: (v: Effort) => void }) {
  return <>
    <div className="ags-seg">
      {(['', 'low', 'medium', 'high', 'xhigh'] as Effort[]).map((k) => <button key={k || 'auto'} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{EFFORT_NAME[k]}</button>)}
    </div>
    <p className="ags-perm-hint"><Sparkles size={12} />{EFFORT_HINT[value]}</p>
  </>;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** 截图等没有路径的图片：转成 PNG 交给主进程存成临时文件 */
async function savePasted(f: File) {
  const bmp = await createImageBitmap(f);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close();
  return host.call<string>('saveImage', c.toDataURL('image/png'));
}

export function useAttachments(onError: (m: string) => void) {
  const [files, setFiles] = useState<string[]>([]);
  const add = useCallback((paths: string[]) => setFiles((f) => {
    const all = [...new Set([...f, ...paths.filter(Boolean)])];
    if (all.length > 8) onError('附件最多 8 个');
    return all.slice(0, 8);
  }), [onError]);
  const pick = () => host.call<string[]>('agents.pickAttach').then(add).catch((e) => onError((e as Error).message));
  const onPaste = (e: ClipboardEvent) => {
    const items = [...e.clipboardData.items];
    if (items.some((i) => i.type === 'text/plain')) return;
    const got = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (!got.length) return;
    e.preventDefault();
    for (const f of got) {
      const p = host.pathForFile(f);
      if (p) add([p]);
      else if (f.type.startsWith('image/')) savePasted(f).then((x) => add([x])).catch((err) => onError('截图没能贴上：' + (err as Error).message));
    }
  };
  const onDrop = (e: DragEvent) => {
    const paths = [...e.dataTransfer.files].map((f) => host.pathForFile(f) ?? '').filter(Boolean);
    if (!paths.length) return;
    e.preventDefault(); add(paths);
  };
  const onDragOver = (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
  return { files, add, pick, onPaste, onDrop, onDragOver, remove: (p: string) => setFiles((f) => f.filter((x) => x !== p)), clear: () => setFiles([]) };
}

export function AttachChips({ a, compact }: { a: ReturnType<typeof useAttachments>; compact?: boolean }) {
  return (
    <div className={'ags-attach' + (compact ? ' compact' : '')}>
      <button type="button" onClick={() => void a.pick()} data-tip="图片、截图、Word、PDF 都可以；也能直接拖进来或 Ctrl+V 贴截图"><Paperclip size={13} />{compact ? '' : '添加附件'}</button>
      {a.files.map((p) => <span key={p} className="ags-chip" title={p}>{baseName(p)}<button type="button" onClick={() => a.remove(p)} aria-label="移除附件"><X size={11} /></button></span>)}
      {!compact && !a.files.length && <i>可以拖进来，或在要求里 Ctrl+V 贴截图（例如「照这张图做」）</i>}
    </div>
  );
}

interface Check { at: number; ok: boolean; problems: string[]; id: string; name: string; version: string }
export interface PluginTask { id: string; status: string; check?: Check; exporting?: boolean; events?: { kind: string }[] }
interface Preview { id: string; manifest: Manifest | null; problems: string[]; files: number; bytes: number }
type Entry = { key: string; tag: string; title: string; entry: string; w: number; h: number; wide: boolean };

/** 做插件的任务：右侧实时预览（plugin://dev-<任务>/），检查结果，满意了「装上」 */
export function PluginPreview({ task, onAsk, onError }: { task: PluginTask; onAsk: (text: string) => void; onError: (m: string) => void }) {
  const [info, setInfo] = useState<Preview | null>(null);
  const [n, setN] = useState(0);
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const list = usePlugins((s) => s.list);
  const running = task.status === 'running';
  const fileEvents = (task.events ?? []).filter((e) => e.kind === 'file').length;
  const refresh = useCallback(async () => {
    try {
      const r = await host.call<Preview>('agents.pluginPreview', { id: task.id });
      usePlugins.setState((s) => {
        const dev = { ...s.dev };
        if (r.manifest) dev[r.id] = r.manifest; else delete dev[r.id];
        return { dev };
      });
      setInfo(r); setN((x) => x + 1);
    } catch (e) { onError((e as Error).message); }
  }, [task.id, onError]);
  useEffect(() => { void loadPlugins(); }, []);
  // AI 写文件时稍等一下再刷新，免得预览到写了一半的页面
  useEffect(() => { const t = setTimeout(() => void refresh(), running ? 2500 : 200); return () => clearTimeout(t); }, [refresh, running, fileEvents, task.exporting]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 4000); return () => clearTimeout(t); }, [note]);

  const m = info?.manifest ?? null;
  const entries: Entry[] = m ? [
    ...m.contributes.panels.map((p) => ({ key: 'panel:' + p.id, tag: '面板', title: p.title, entry: p.entry, w: p.width, h: p.height, wide: false })),
    ...m.contributes.lessons.map((p) => ({ key: 'lesson:' + p.id, tag: '学生画面', title: p.title, entry: p.entry, w: 0, h: 0, wide: true })),
    ...m.contributes.pages.map((p) => ({ key: 'page:' + p.id, tag: '教师页', title: p.title, entry: p.entry, w: 0, h: 0, wide: true })),
  ] : [];
  const shapes = m?.contributes.shapes.filter((g) => g.items.length) ?? [];
  const others = m ? [m.contributes.skills.length && `${m.contributes.skills.length} 个 AI 备课任务`, m.contributes.templates.length && `${m.contributes.templates.length} 个导出模板`].filter(Boolean) as string[] : [];
  const cur = sel === 'shapes' && shapes.length ? null : entries.find((e) => e.key === sel) ?? entries[0] ?? null;
  const showShapes = !cur && shapes.length > 0;
  const installed = m ? list?.items.find((x) => x.id === m.id) : undefined;
  const problems = info?.problems ?? [];
  const ok = !!m && !problems.length;

  const install = async () => {
    setBusy(true); onError('');
    try {
      const p = await host.call<PluginItem>('agents.pluginInstall', { id: task.id });
      await loadPlugins(true);
      const panel = p.contributes.panels.find((x) => x.where.includes('console'));
      const where = whereText(p), g = p.contributes.shapes.findIndex((x) => x.items.length);
      toast(`已装上「${p.name}」v${p.version}` + (where.length ? `，在${where[0]}里用` : ''), panel ? { action: { label: '去导播台打开', run: () => { useStore.getState().set({ page: 'console' }); openPanel(p.id, panel.id); } } } : g >= 0 ? { action: { label: '去绘图库', run: () => openShapes(p, g) } } : {});
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="wk-prev">
      <div className="wk-head">
        <b>{m ? m.name : '插件预览'}</b>{m && <span className="num">v{m.version}</span>}
        {installed && <em data-tip="已经装在导播台里；再点「更新安装」会替换成现在这一版，旧版自动存进历史">已装 v{installed.version}</em>}
        <span className="flex" />
        <button onClick={() => void refresh()} data-tip="重新加载预览"><RefreshCw size={13} /></button>
      </div>
      {!info ? <div className="wk-empty"><Loader2 size={16} className="ags-spin" /></div>
        : !m ? <div className="wk-empty">{running ? <><Loader2 size={16} className="ags-spin" />AI 正在写插件，写好 plugin.json 后这里就能预览</> : '还没有可以预览的插件'}</div>
          : <>
            {(entries.length + (shapes.length ? 1 : 0)) > 1 && (
              <div className="wk-tabs">
                {entries.map((e) => <button key={e.key} className={cur?.key === e.key ? 'on' : ''} onClick={() => setSel(e.key)}><i>{e.tag}</i>{e.title}</button>)}
                {shapes.length > 0 && <button className={showShapes ? 'on' : ''} onClick={() => setSel('shapes')}><i>图形库</i>{shapes.map((g) => g.group).join('、')}</button>}
              </div>
            )}
            {cur && (
              <div className={'wk-stage' + (cur.wide ? ' wide' : '')} style={cur.wide ? undefined : { width: Math.min(cur.w, 520), height: cur.h }}>
                <PluginFrame key={`${info.id}|${cur.entry}|${n}`} id={info.id} entry={cur.entry} where="preview" title={cur.title} onToast={setNote} onClose={() => setNote('插件请求关闭面板（预览里不关）')} />
                {note && <div className="pl-note">{note}</div>}
              </div>
            )}
            {showShapes && shapes.map((g) => (
              <div key={g.group} className="wk-shapes">
                <h5>{g.group}{g.subject && <i>{g.subject}</i>}</h5>
                <div>{g.items.map((it) => <figure key={it.file}><img src={pluginUrl(info.id, it.file) + '?v=' + n} alt={it.name} /><figcaption>{it.name}</figcaption></figure>)}</div>
              </div>
            ))}
            {!entries.length && !shapes.length && <div className="wk-empty">{others.length ? `这个插件提供${others.join('、')}，装上后在「备课」和导出时使用` : '插件里还没有可以预览的界面'}</div>}
            {m.description && <p className="wk-desc">{m.description}</p>}
          </>}
      {problems.length > 0 && (
        <div className="wk-problems">
          <p><TriangleAlert size={13} />还有 {problems.length} 个问题，修好才能装上</p>
          <ul>{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul>
          <button disabled={running} onClick={() => onAsk('请修正插件检查发现的这些问题：\n' + problems.slice(0, 20).map((p) => '- ' + p).join('\n'))}>让 AI 修好</button>
        </div>
      )}
      {ok && <p className="wk-ok"><CheckCircle2 size={13} />检查通过，{(m?.permissions.length ? `需要：${m.permissions.map((k) => list?.permissionNames[k] ?? k).join('、')}` : '不需要任何权限')}{m?.network.length ? `；联网：${m.network.join('、')}` : ''}</p>}
      <button className="wk-install" disabled={!ok || running || busy} onClick={() => void install()}
        data-tip={running ? 'AI 还在改，这一轮做完再装' : installed ? '替换成现在这一版，旧版自动存进历史，可以回退' : '装进导播台，马上能用'}>
        {busy ? <Loader2 size={15} className="ags-spin" /> : <PackageCheck size={15} />}{installed ? '更新安装' : '装上'}
      </button>
    </div>
  );
}
