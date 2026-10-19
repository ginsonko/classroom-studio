// 一键导入（yinzi-import/1）：网站密钥窗口点「一键导入到软件 → 最强网课教辅系统」后，主进程收到链接并校验、暂存，这里请老师确认。
// Key 只留在主进程，页面上只显示尾号。
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Loader2, XCircle } from 'lucide-react';
import { host } from '../lib/host';
import { ai } from '../lib/ai';
import { pickDefaultModel } from '../lib/models';
import { saveAgentModel, saveStudioKey } from '../lib/agentPrefs';
import { loadModels } from '../ui/ModelPicker';
import { useStore } from '../lib/store';
import '../styles/import.css';

export interface ImportSummary {
  kind: 'yinzi' | 'legacy'; site: { name: string; origin: string; host: string; official: boolean } | null; profile: string; mode: 'merge' | 'replace';
  baseUrl: string; baseFrom: string; keyHint: string; keyName: string; smart: boolean; replaces: boolean;
  text: string; vision: string; textFrom: string; visionFrom: string;
  /** AI 工作室两个引擎的默认模型（网站「Codex 智能体」「Claude 智能体」） */
  codex?: string; claude?: string;
}
type Phase = { k: 'ask' } | { k: 'busy'; t: string } | { k: 'ok'; t: string } | { k: 'bad'; t: string };

export const importLink = {
  parse: (text: string) => host.call<ImportSummary>('ai.importParse', { text }),
  clipboard: () => host.call<ImportSummary>('ai.importClipboard'),
  file: () => host.call<ImportSummary | null>('ai.importFile'),
  pending: () => host.call<ImportSummary | null>('ai.importPending'),
  cancel: () => host.call<null>('ai.importCancel'),
};
/** 设置面板里的粘贴 / 剪贴板 / 文件入口拿到的结果交给确认框 */
export const showImport = (s: ImportSummary | null) => { if (s) window.dispatchEvent(new CustomEvent('cs-import', { detail: s })); };

/** 应用暂存的导入：导入里没给文本模型时沿用原来的；原来也没有就按 Key 能用的模型挑一个，然后测一次连接 */
export async function applyImport(s: ImportSummary, step: (t: string) => void): Promise<string> {
  step('正在保存…');
  let cfg = await host.call<{ model: string }>('ai.importApply', {});
  window.dispatchEvent(new Event('cs-ai-config'));
  // 智能体模型是网站上的模型名，只有走导播台的 AI 接口时 CLI 才能用，所以一起打开
  if (s.codex) saveAgentModel('codex', s.codex);
  if (s.claude) saveAgentModel('claude', s.claude);
  if (s.codex || s.claude) saveStudioKey(true);
  let model = cfg.model;
  if (!s.text) {
    step('正在读取这个 Key 能用的模型…');
    const list = await loadModels(true);
    if (list.ok && list.models.length && (!model || !list.models.includes(model))) {
      const pick = pickDefaultModel(list.models);
      if (pick) { cfg = await ai.save({ model: pick }); model = pick; window.dispatchEvent(new Event('cs-ai-config')); }
    }
    if (!model) return '已导入。读不到模型列表，请在 AI 设置里手动选一个模型。' + (list.message ? `（${list.message}）` : '');
  } else void loadModels(true);
  step(`正在用 ${model} 测试连接…`);
  const r = await ai.test().catch((e: Error) => { throw new Error('配置已保存，但连接测试没通过：' + e.message); });
  return `已导入并连接成功：${r.model}，${(r.ms / 1000).toFixed(1)} 秒`;
}

const Change = ({ from, to, keep }: { from: string; to: string; keep: string }) =>
  !to ? <span className="imp-dim">{from ? `不变（${from}）` : keep}</span>
    : from && from !== to ? <span>{from}<ArrowRight size={11} className="imp-arrow" />{to}</span> : <span>{to}</span>;

export function ImportDialog() {
  const [s, setS] = useState<ImportSummary | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: 'ask' });
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!host.electron) return;
    const open = (p: ImportSummary) => { setS(p); setPhase({ k: 'ask' }); setSure(false); };
    void importLink.pending().then((p) => { if (p) open(p); }).catch(() => {});
    const pasted = (e: Event) => open((e as CustomEvent<ImportSummary>).detail);
    addEventListener('cs-import', pasted);
    const off = host.onEvent((e) => {
      if (e?.type !== 'import') return;
      // 出错时只显示原因，没有可确认的内容（mode 为空时不画明细）
      if (e.error) { setS({} as ImportSummary); setPhase({ k: 'bad', t: e.message }); return; }
      open(e.summary);
    });
    return () => { off(); removeEventListener('cs-import', pasted); };
  }, []);
  if (!s) return null;
  const close = () => { if (phase.k === 'ask') void importLink.cancel(); setS(null); };
  const go = async () => {
    try { const t = await applyImport(s, (t) => setPhase({ k: 'busy', t })); setPhase({ k: 'ok', t }); }
    catch (e) { setPhase({ k: 'bad', t: e instanceof Error ? e.message : String(e) }); }
  };
  const replace = s.mode === 'replace';
  const autoText = s.textFrom ? `不变（${s.textFrom}）` : '自动挑选（能看图的旗舰模型）';
  return (
    <div className="imp-back" onPointerDown={(e) => { if (e.target === e.currentTarget && phase.k !== 'busy') close(); }}>
      <div className="imp" role="dialog" aria-label="一键导入 AI 配置">
        <div className="imp-h"><KeyRound size={16} /><b>一键导入 AI 配置</b>{s.profile && <span className="imp-prof">{s.profile}</span>}</div>
        {s.mode && <>
          {s.site && <div className={'imp-site' + (s.site.official ? ' ok' : ' warn')}>
            {s.site.official ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            <span>来自 <b>{s.site.name}</b>（{s.site.host}）{!s.site.official && '：未知站点，请确认这是你信任的中转站'}</span>
          </div>}
          <dl className="imp-kv">
            <dt>接口地址</dt><dd><Change from={s.baseFrom} to={s.keyHint ? s.baseUrl : ''} keep="不变" /></dd>
            <dt>API Key</dt><dd>{s.keyHint ? <>sk-…{s.keyHint}{s.keyName && <i className="imp-dim">「{s.keyName}」</i>}{s.smart && <i className="imp-tag">智能路由</i>}{s.replaces && <em>会替换现在保存的 Key</em>}</> : <span className="imp-dim">不变（用本机已保存的 Key）</span>}</dd>
            <dt>文本模型</dt><dd>{s.text ? <Change from={s.textFrom} to={s.text} keep="" /> : <span className="imp-dim">{replace ? '清空后自动挑选' : autoText}</span>}</dd>
            <dt>看图模型</dt><dd>{s.vision ? <Change from={s.visionFrom} to={s.vision === (s.text || s.textFrom) ? '同文本模型' : s.vision} keep="" /> : <span className="imp-dim">{replace ? '清空（同文本模型）' : s.visionFrom ? `不变（${s.visionFrom}）` : '同文本模型'}</span>}</dd>
            {s.codex && <><dt>Codex 智能体</dt><dd>{s.codex}<i className="imp-dim">（AI 工作室）</i></dd></>}
            {s.claude && <><dt>Claude 智能体</dt><dd>{s.claude}<i className="imp-dim">（AI 工作室）</i></dd></>}
          </dl>
        </>}
        {phase.k === 'ask' && replace && <label className="imp-sure"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />覆盖模式：没勾选的项目会被清空，我已确认</label>}
        {phase.k === 'ask' && <p className="imp-note">只在这台电脑上保存，Key 用 Windows 系统加密，不会出现在学生窗口和录像里。</p>}
        {phase.k === 'busy' && <div className="imp-msg"><Loader2 size={14} className="spin" />{phase.t}</div>}
        {phase.k === 'ok' && <div className="imp-msg ok"><CheckCircle2 size={14} />{phase.t}</div>}
        {phase.k === 'bad' && <div className="imp-msg bad"><XCircle size={14} />{phase.t}</div>}
        <div className="imp-b">
          {phase.k === 'ask' && <><button onClick={close}>取消</button><button className="pri" disabled={replace && !sure} onClick={() => void go()}>导入并测试</button></>}
          {phase.k === 'ok' && <button className="pri" onClick={() => { setS(null); useStore.getState().set({ aiOpen: true }); }}>打开 AI 助手</button>}
          {(phase.k === 'ok' || phase.k === 'bad') && <button onClick={() => setS(null)}>关闭</button>}
        </div>
      </div>
    </div>
  );
}
