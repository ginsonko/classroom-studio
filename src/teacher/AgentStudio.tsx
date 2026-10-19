// AI 工作室：后台任务中心（Codex CLI / Claude Code 在本机无界面运行）+ AI 账本。
// 任务在主进程里跑，这里只负责发起、查看实时进度、追加指令、停止和查看成果。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, ChevronRight, CircleStop, Download, FileText, FolderOpen, FolderPlus, Loader2, Plus, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, Terminal,
  Trash2, TriangleAlert, Wallet, Wrench, X,
} from 'lucide-react';
import { host } from '../lib/host';
import { useStore } from '../lib/store';
import { packOf, studentSubject } from '../lib/subjects';
import { addRoot } from '../lib/useLib';
import { loadAgentModel, loadStudioKey, saveAgentModel, saveStudioKey, type AgentEngine } from '../lib/agentPrefs';
import { importBank, parseBank, studyReady } from '../lib/agentBank';
import { ModelPicker } from '../ui/ModelPicker';
import '../styles/agents.css';

type Engine = AgentEngine;
type Fmt = 'docx' | 'pdf' | 'pptx';
type Permission = 'safe' | 'full' | 'danger';
const PERMISSION_NAME: Record<Permission, string> = { safe: '安全模式', full: '常用权限', danger: '完全访问' };
const PERMISSION_HINT: Record<Permission, string> = {
  safe: '只读写自己的任务文件夹，运行命令前会先问你',
  full: '在任务文件夹里自由读写、运行常见命令，不碰系统和其他目录（推荐）',
  danger: '不做任何限制，可以装软件、改系统，仅交给你完全信任的任务',
};
interface Ev { at: number; kind: 'user' | 'text' | 'think' | 'cmd' | 'tool' | 'file' | 'plan' | 'error' | 'usage' | 'status' | 'note' | 'out'; text: string }
interface Task {
  id: string; engine: Engine; title: string; prompt: string; status: 'running' | 'done' | 'failed' | 'stopped' | 'budget';
  note?: string; cap: number; cny: number; tokens: number; turns: number; created: number; updated: number; work: string;
  queued: number; last?: Ev | null; events?: Ev[]; live?: number; model?: string; pick?: string; permission?: Permission;
  formats?: Fmt[]; exporting?: boolean; calibrated?: boolean; reconciled?: boolean;
}
interface CliInfo { name: string; found: boolean; version: string; pkg: string; where?: string; bundled?: string; native?: boolean }
type Detect = { codex: CliInfo; claude: CliInfo; npm: boolean };
interface Reconcile {
  auto: boolean; matched: number; pending: number; missed: number; est: number; real: number; lastSync: number; error: string;
  site: { origin: string; name: string; type: string; supported?: boolean } | null;
}
interface Summary {
  day: number; month: number; caps: { task: number; day: number; month: number }; warnAt: number; usdRate: number; factor?: number;
  prices: Record<string, { input: number; cached: number; output: number }>; byFeature: Record<string, number>; tokensToday: number;
  modelFactors?: Record<string, { f: number; n: number }>; reconcile?: Reconcile;
  recent: { at: number; source: string; feature: string; model: string; input: number; cached: number; output: number; cny: number; real?: number; miss?: boolean; taskId?: string }[];
}
interface OutFile { path: string; name: string; size: number; mtime: number }

const STATUS: Record<Task['status'], string> = { running: '运行中', done: '已完成', failed: '出错', stopped: '已停止', budget: '到达上限' };
const yuan = (v: number) => '¥' + (v < 10 ? v.toFixed(2) : v.toFixed(1));
const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const FMT_LABEL: Record<Fmt, string> = { docx: 'Word', pdf: 'PDF', pptx: 'PPT' };
const WHERE_LABEL: Record<string, string> = { bundled: '内置', private: '已更新', local: '本机', override: '测试' };

// 每种成品的详细做法写在内置技能（electron/agent-kit/skills）里，这里只放老师最常改的几项要求；
// 导播台会在提示词前面让 AI 先读对应的 SKILL.md。
const TEMPLATES: { id: string; label: string; hint: string; skill: string; formats: Fmt[]; build: (topic: string) => string }[] = [
  {
    id: 'html', label: '互动课件', hint: '单文件 HTML，可调参数的动画', skill: 'courseware-html', formats: [],
    build: (t) => `做一份「${t}」的单文件 HTML 互动课件，保存为「${t}.html」。\n6～10 页；至少一页带滑块调参数的动画演示；最后放 3 道随堂小测和答案页。`,
  },
  {
    id: 'ppt', label: '讲课 PPT', hint: '16:9 幻灯片，公式清晰', skill: 'lecture-slides', formats: ['pptx', 'pdf'],
    build: (t) => `做「${t}」的讲课幻灯片，写在「${t}-课件.md」里，10～14 页。`,
  },
  {
    id: 'quiz', label: '练习题', hint: '分层出题，可一键导入题库', skill: 'practice-set', formats: ['docx', 'pdf'],
    build: (t) => `为「${t}」出一套分层练习：基础 5 题 + 提高 3 题 + 拓展 2 题。\n文件：「${t}-练习.md」「${t}-答案.md」「${t}-题库.json」。`,
  },
  {
    id: 'homework', label: '分层作业', hint: '必做 + 选做，带批改要点', skill: 'homework', formats: ['docx', 'pdf'],
    build: (t) => `为「${t}」布置课后分层作业：必做约 30 分钟（5～6 题）+ 选做 2～3 题。\n文件：「${t}-作业.md」「${t}-作业答案.md」「${t}-题库.json」。`,
  },
  {
    id: 'test', label: '测验卷', hint: '限时测验，分值和评分细则', skill: 'quiz-paper', formats: ['docx', 'pdf'],
    build: (t) => `出一份「${t}」的测验卷：40 分钟，满分 100 分。\n文件：「${t}-测验.md」「${t}-测验答案.md」「${t}-题库.json」。`,
  },
  {
    id: 'notes', label: '课堂讲义', hint: '要点、公式、例题，两页内', skill: 'lesson-notes', formats: ['docx', 'pdf'],
    build: (t) => `写一份「${t}」的课堂讲义「${t}-讲义.md」，两页 A4 以内。`,
  },
  {
    id: 'plan', label: '教案', hint: '一对一流程，分钟级安排', skill: 'lesson-plan', formats: ['docx', 'pdf'],
    build: (t) => `写一份「${t}」的一对一教案「${t}-教案.md」，课时 60 分钟。`,
  },
  { id: 'free', label: '自定义', hint: '自己写要求', skill: '', formats: ['docx', 'pdf'], build: () => '' },
];

export function AgentStudio() {
  const [tab, setTab] = useState<'tasks' | 'ledger'>('tasks');
  const [sum, setSum] = useState<Summary | null>(null);
  const reloadSum = () => host.call<Summary>('ai.ledger').then(setSum).catch(() => {});
  useEffect(() => { void reloadSum(); const t = setInterval(reloadSum, 15000); return () => clearInterval(t); }, []);
  useEffect(() => host.onEvent((e) => { if (e?.type === 'ledger') void reloadSum(); }), []);
  return (
    <div className="ags">
      <header className="ags-head">
        <div className="ags-title"><Sparkles size={18} /><h2>AI 工作室</h2><span>后台让 Codex / Claude 帮你备课，花费统一记账</span></div>
        <nav className="ags-tabs">
          <button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}><Bot size={14} />任务中心</button>
          <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}><Wallet size={14} />AI 账本</button>
        </nav>
        {sum && <Spend sum={sum} />}
      </header>
      {tab === 'tasks' ? <Tasks onSpend={reloadSum} cap={sum?.caps.task ?? 5} /> : <Ledger sum={sum} onChange={setSum} />}
    </div>
  );
}

function Spend({ sum }: { sum: Summary }) {
  const bar = (v: number, cap: number) => {
    const p = cap > 0 ? Math.min(1, v / cap) : 1;
    return <i style={{ width: `${p * 100}%` }} className={p >= 1 ? 'over' : p >= sum.warnAt ? 'warn' : ''} />;
  };
  return (
    <div className="ags-spend">
      <div><span>今天</span><b className="num">{yuan(sum.day)}</b><em>/ ¥{sum.caps.day}</em><span className="ags-bar">{bar(sum.day, sum.caps.day)}</span></div>
      <div><span>本月</span><b className="num">{yuan(sum.month)}</b><em>/ ¥{sum.caps.month}</em><span className="ags-bar">{bar(sum.month, sum.caps.month)}</span></div>
    </div>
  );
}

function Tasks({ onSpend, cap }: { onSpend: () => void; cap: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sel, setSel] = useState<string | 'new'>('new');
  const [detail, setDetail] = useState<Task | null>(null);
  const [cli, setCli] = useState<Detect | null>(null);
  const [installing, setInstalling] = useState<Engine | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const selRef = useRef(sel); selRef.current = sel;

  useEffect(() => {
    host.call<Task[]>('agents.list').then((l) => { setTasks(l); if (l[0]?.status === 'running') setSel(l[0].id); }).catch((e) => setError(e.message));
    host.call<Detect>('agents.detect').then(setCli).catch(() => {});
    return host.onEvent((e) => {
      if (e?.type !== 'agent') return;
      const m = e.agent;
      if (m?.type === 'install') { setInstallLog((l) => [...l.slice(-60), m.text]); return; }
      if (m?.type !== 'task') return;
      const t: Task = m.task;
      setTasks((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : [t, ...l]));
      if (selRef.current === t.id) setDetail((d) => (d && d.id === t.id ? { ...d, ...t, events: m.event ? [...(d.events ?? []), m.event] : d.events } : d));
      if (m.event?.kind === 'usage') onSpend();
    });
  }, []);
  useEffect(() => {
    if (sel === 'new') { setDetail(null); return; }
    host.call<Task>('agents.get', sel).then(setDetail).catch((e) => setError(e.message));
  }, [sel]);

  const install = async (engine: Engine) => {
    setInstalling(engine); setInstallLog([]); setError('');
    try { setCli(await host.call<Detect>('agents.install', engine)); } catch (e) { setError((e as Error).message); } finally { setInstalling(null); }
  };
  const update = async () => {
    setInstalling('codex'); setInstallLog([]); setError('');
    try {
      const r = await host.call<{ detect: Detect; from: string; to: string; updated: boolean }>('agents.update', 'codex');
      setCli(r.detect);
      setInstallLog((l) => [...l, r.updated ? `已更新到 ${r.to}` : `已经是最新版 ${r.from || r.to}`]);
    } catch (e) { setError((e as Error).message); } finally { setInstalling(null); }
  };
  const canInstall = (k: Engine) => !!cli && (k === 'codex' || cli.npm || !!cli[k].native);

  return (
    <div className="ags-body">
      <aside className="ags-list">
        <button className={'ags-new' + (sel === 'new' ? ' on' : '')} onClick={() => setSel('new')}><Plus size={15} />新任务</button>
        <div className="ags-items">
          {tasks.map((t) => (
            <button key={t.id} className={'ags-item' + (sel === t.id ? ' on' : '')} onClick={() => setSel(t.id)}>
              <span className={'ags-dot s-' + t.status} />
              <span className="ags-item-main">
                <b>{t.title}</b>
                <i>{t.engine === 'codex' ? 'Codex' : 'Claude'} · {STATUS[t.status]} · {yuan(t.cny)}</i>
              </span>
            </button>
          ))}
          {!tasks.length && <p className="ags-empty">还没有任务。左上角「新任务」让 AI 在后台帮你做课件、出题。</p>}
        </div>
        <div className="ags-cli">
          {cli ? (['codex', 'claude'] as Engine[]).map((k) => (
            <div key={k} className={'ags-cli-row' + (cli[k].found ? ' ok' : '')}>
              <Terminal size={13} /><span>{cli[k].name}</span>
              {cli[k].found ? <em title={cli[k].where === 'bundled' ? '导播台内置的官方版本，不需要 Node.js' : cli[k].where === 'private' ? '在导播台里更新下载的版本' : '这台电脑上自己安装的版本'}>
                {WHERE_LABEL[cli[k].where ?? ''] ? WHERE_LABEL[cli[k].where ?? ''] + ' ' : ''}{cli[k].version.replace(/^[^\d]*/, '') || '已安装'}</em>
                : <button disabled={!!installing || !canInstall(k)} onClick={() => void install(k)}
                  title={k === 'codex' ? '从官方 npm 源下载 Codex（不需要 Node.js）' : cli.npm ? '用 npm 全局安装' : '用 Anthropic 官方安装程序安装'}>
                  {installing === k ? <Loader2 size={12} className="ags-spin" /> : <Download size={12} />}安装</button>}
              {k === 'codex' && cli.codex.found && cli.codex.where !== 'override' && (
                <button disabled={!!installing} onClick={() => void update()} title="检查官方新版本；有新版就下载到导播台自己的目录，不动你自己装的那份">
                  {installing === 'codex' ? <Loader2 size={12} className="ags-spin" /> : <RefreshCw size={12} />}更新</button>
              )}
            </div>
          )) : <div className="ags-cli-row"><Loader2 size={13} className="ags-spin" />检查本机 CLI…</div>}
        </div>
      </aside>
      <section className="ags-main">
        {error && <div className="ags-error" role="alert"><TriangleAlert size={14} />{error}<button onClick={() => setError('')}><X size={13} /></button></div>}
        {(installing || installLog.length > 0) && (
          <pre className="ags-install" title={installing ? '' : '点一下关闭'} onClick={() => { if (!installing) setInstallLog([]); }}>{installLog.join('\n') || '正在安装…'}</pre>
        )}
        {sel === 'new' ? <NewTask cli={cli} cap={cap} onError={setError} onStarted={(t) => { setTasks((l) => [t, ...l.filter((x) => x.id !== t.id)]); setSel(t.id); }} />
          : detail ? <Detail task={detail} onError={setError} onRemoved={() => { setTasks((l) => l.filter((x) => x.id !== detail.id)); setSel('new'); }} />
            : <div className="ags-loading"><Loader2 size={18} className="ags-spin" /></div>}
      </section>
    </div>
  );
}

function backgroundFor(): string {
  const s = useStore.getState(), stu = s.students.find((x) => x.id === s.studentId);
  const pack = packOf(studentSubject(stu));
  const lines = ['# 任务背景（导播台自动生成）', '', `老师：一对一${pack.stage}家教，课上通过腾讯会议共享画面。`, ''];
  if (stu) {
    lines.push(`学生：${stu.name}`, `年级：${stu.grade || '未填写'}`, `学科：${pack.stage}`, `教材：${stu.textbook || pack.textbook}`, `已上课：${stu.lessons} 次`);
    if (stu.lastTopic) lines.push(`上次课：${stu.lastTopic}`);
    if (stu.tags.length) lines.push(`标签：${stu.tags.join('、')}`);
  } else lines.push(`学生：未指定（按${pack.stage}${pack.name}平均水平）`);
  lines.push('', '## 本学科约定', `排版主题：Markdown 成品第一行写 <!-- cs:theme=${pack.family} -->`, `题型（题库文件的 qtype 只能用这些）：${pack.qtypes.join('、')}`,
    `难度：1 基础、2 巩固、3 中档、4 较难、5 压轴`, `出原创题的要求：${pack.prompt.draft}`, `答案写法：${pack.prompt.answer}`);
  lines.push('', '输出要求：所有文件保存在当前文件夹；文件名用中文；不要联网下载东西。');
  return lines.join('\n');
}

function NewTask({ cli, cap, onStarted, onError }: { cli: Detect | null; cap: number; onStarted: (t: Task) => void; onError: (m: string) => void }) {
  const [engine, setEngine] = useState<Engine>(() => (localStorage.getItem('cs.agent.engine') as Engine) || 'codex');
  const [model, setModel] = useState(() => loadAgentModel(engine));
  const [permission, setPermission] = useState<Permission>(() => (localStorage.getItem('cs.agent.permission') as Permission) || 'full');
  const [tpl, setTpl] = useState('html');
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState('');
  const [taskCap, setTaskCap] = useState(cap);
  const [studioKey, setStudioKey] = useState(loadStudioKey);
  const [busy, setBusy] = useState(false);
  const student = useStore((s) => s.students.find((x) => x.id === s.studentId));
  const [formats, setFormats] = useState<Fmt[]>([]);
  useEffect(() => setTaskCap(cap), [cap]);
  useEffect(() => { const t = TEMPLATES.find((x) => x.id === tpl)!; if (t.id !== 'free') setPrompt(t.build(topic.trim() || '（主题）')); }, [tpl, topic]);
  useEffect(() => setFormats(TEMPLATES.find((x) => x.id === tpl)!.formats), [tpl]);
  const ready = cli?.[engine]?.found;
  const start = async () => {
    setBusy(true); onError('');
    try {
      localStorage.setItem('cs.agent.engine', engine);
      saveAgentModel(engine, model);
      saveStudioKey(studioKey);
      localStorage.setItem('cs.agent.permission', permission);
      const t = TEMPLATES.find((x) => x.id === tpl)!;
      const title = (topic.trim() ? topic.trim() + ' · ' : '') + t.label;
      onStarted(await host.call<Task>('agents.start', { engine, title, prompt, context: backgroundFor(), cap: taskCap, useStudioKey: studioKey, formats, model, permission, skill: t.skill }));
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="ags-new-form">
      <h3>新任务</h3>
      <p className="ags-sub">任务在本机后台运行，只能读写它自己的文件夹。{student ? `会附上「${student.name}」的学生情况。` : '顶栏选好学生后，会自动附上学生情况。'}</p>
      <div className="ags-field">
        <label>用谁来做</label>
        <div className="ags-seg">
          {(['codex', 'claude'] as Engine[]).map((k) => (
            <button key={k} className={engine === k ? 'on' : ''} onClick={() => { setEngine(k); setModel(loadAgentModel(k)); }}>
              {k === 'codex' ? 'Codex CLI' : 'Claude Code'}{cli && !cli[k].found && <em>未安装</em>}
            </button>
          ))}
        </div>
      </div>
      <div className="ags-field">
        <label>模型 <i className="ags-opt">可选，留空用 CLI 自己的默认模型；勾选「用导播台的 AI 接口」时从接口可用模型里挑</i></label>
        <ModelPicker value={model} onChange={setModel} placeholder="默认模型" title="自动读取 AI 接口里能用的模型；可以搜索、收藏，也能直接输入模型名" />
      </div>
      <div className="ags-field">
        <label>AI 的权限</label>
        <div className="ags-seg">
          {(['safe', 'full', 'danger'] as Permission[]).map((p) => (
            <button key={p} className={permission === p ? 'on' : ''} onClick={() => setPermission(p)}>{PERMISSION_NAME[p]}</button>
          ))}
        </div>
        <p className="ags-perm-hint"><ShieldCheck size={12} />{PERMISSION_HINT[permission]}</p>
      </div>
      <div className="ags-field">
        <label>做什么</label>
        <div className="ags-tpls">
          {TEMPLATES.map((t) => <button key={t.id} className={tpl === t.id ? 'on' : ''} onClick={() => setTpl(t.id)}><b>{t.label}</b><i>{t.hint}</i></button>)}
        </div>
        {tpl !== 'free' && <p className="ags-perm-hint"><Sparkles size={12} />已内置「{TEMPLATES.find((x) => x.id === tpl)!.label}」的完整做法（结构、格式、自检），AI 会先照着做，下面只写这次的特别要求即可</p>}
      </div>
      {tpl !== 'free' && (
        <div className="ags-field"><label>主题</label><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：斜面上的受力分析" /></div>
      )}
      <div className="ags-field grow"><label>给 AI 的要求（可以直接改）</label><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="写清楚要做什么、做成什么格式、存成什么文件名" /></div>
      {tpl !== 'html' && (
        <div className="ags-field">
          <label>成品格式</label>
          <div className="ags-fmts">
            {(['docx', 'pdf', 'pptx'] as Fmt[]).map((f) => (
              <label key={f} className={'ags-fmt' + (formats.includes(f) ? ' on' : '')}>
                <input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))} />{FMT_LABEL[f]}
              </label>
            ))}
            <span className="ags-fmt-hint">AI 写好的文稿会自动排版成勾选的格式，公式清晰、版式统一</span>
          </div>
        </div>
      )}
      <div className="ags-row">
        <label className="ags-cap">本任务最多花 <span>¥</span><input type="number" min={0.5} step={0.5} value={taskCap} onChange={(e) => setTaskCap(Number(e.target.value) || cap)} /></label>
        <label className="ags-check" title="不勾选时使用 CLI 自己登录的账号；勾选后改用 AI 设置里的接口地址和 Key（Key 只通过环境变量交给 CLI）">
          <input type="checkbox" checked={studioKey} onChange={(e) => setStudioKey(e.target.checked)} />用导播台的 AI 接口
        </label>
        <span className="flex" />
        <button className="ags-go" disabled={busy || !ready || !prompt.trim() || (tpl !== 'free' && !topic.trim())} onClick={() => void start()}>
          {busy ? <Loader2 size={15} className="ags-spin" /> : <Sparkles size={15} />}开始
        </button>
      </div>
      {cli && !ready && <p className="ags-warn"><Wrench size={13} />{cli[engine].name} 还没有安装，左下角可以一键安装{engine === 'codex' ? '（直接下载官方版，不需要 Node.js）' : ''}。</p>}
    </div>
  );
}

const KIND_LABEL: Partial<Record<Ev['kind'], string>> = { user: '你', cmd: '命令', tool: '工具', file: '文件', plan: '计划', error: '注意', usage: '花费', status: '进度', think: '思考', note: '提示', out: '成品' };
const STEP_KINDS = new Set<Ev['kind']>(['cmd', 'tool', 'think', 'plan', 'file']);
type Row = { kind: 'ev'; e: Ev; i: number } | { kind: 'steps'; items: Ev[]; i: number };

/** 简洁模式：连续的命令 / 工具 / 思考 / 文件操作合成一行「做了 N 步」，只把计划和文件名用文字说出来 */
function rowsOf(events: Ev[], detailed: boolean): Row[] {
  if (detailed) return events.map((e, i) => ({ kind: 'ev', e, i }));
  const out: Row[] = [];
  events.forEach((e, i) => {
    if (!STEP_KINDS.has(e.kind)) { out.push({ kind: 'ev', e, i }); return; }
    const last = out.at(-1);
    if (last?.kind === 'steps') last.items.push(e); else out.push({ kind: 'steps', items: [e], i });
  });
  return out;
}

function stepSummary(items: Ev[]) {
  const n = (k: Ev['kind']) => items.filter((e) => e.kind === k).length;
  const search = items.filter((e) => e.kind === 'tool' && e.text.startsWith('搜索')).length;
  const names = [...new Set(items.filter((e) => e.kind === 'file').flatMap((e) => e.text.split(/[，,]\s*/)).map((s) => s.replace(/^(新建|修改|删除)\s*/, '').split(/[\\/]/).pop()!.trim()).filter(Boolean))];
  const parts = [n('cmd') && `运行 ${n('cmd')} 条命令`, search && `查了 ${search} 次资料`, n('tool') - search > 0 && `用了 ${n('tool') - search} 次工具`, n('think') && `思考 ${n('think')} 次`].filter(Boolean) as string[];
  const plan = [...items].reverse().find((e) => e.kind === 'plan');
  const done = plan ? plan.text.split('\n').filter((l) => l.startsWith('✓')).length : 0, all = plan ? plan.text.split('\n').filter(Boolean).length : 0;
  return { parts, names, plan, done, all };
}

function nowDoing(events: Ev[]) {
  const e = [...events].reverse().find((x) => x.kind !== 'usage');
  if (!e) return 'AI 正在准备';
  if (e.kind === 'cmd') return 'AI 正在运行命令、检查结果';
  if (e.kind === 'think') return 'AI 正在思考';
  if (e.kind === 'file') return 'AI 正在写文件';
  if (e.kind === 'tool') return e.text.startsWith('搜索') ? 'AI 正在查资料' : 'AI 正在使用工具';
  if (e.kind === 'plan') { const s = e.text.split('\n'); return `AI 正在按计划做（${s.filter((l) => l.startsWith('✓')).length}/${s.filter(Boolean).length}）`; }
  return 'AI 正在工作';
}

const FILE_KIND: [RegExp, string][] = [[/\.docx?$/i, 'Word'], [/\.pdf$/i, 'PDF'], [/\.pptx?$/i, 'PPT'], [/\.html?$/i, '网页'], [/\.(md|markdown)$/i, '文稿'], [/\.(png|jpe?g|svg|gif|webp)$/i, '图片'], [/\.(mp4|webm|mov|mkv|avi)$/i, '视频'], [/\.(mp3|wav|m4a|ogg|flac)$/i, '音频']];
const fileKind = (name: string) => FILE_KIND.find(([r]) => r.test(name))?.[1] ?? '文件';
const RANK: Record<string, number> = { Word: 0, PDF: 1, PPT: 2, 网页: 3, 视频: 4, 图片: 5, 音频: 6, 文稿: 7, 文件: 8 };

/** 任务文件夹授权过 host.fileUrl，图片直接预览、视频给缩略画面 */
function Media({ file }: { file: OutFile }) {
  const kind = fileKind(file.name), url = host.fileUrl(file.path);
  if (kind === '图片') return <img className="ags-thumb" src={url} alt={file.name} loading="lazy" />;
  if (kind === '视频') return <video className="ags-thumb" src={url} muted preload="metadata" />;
  if (kind === '音频') return <audio className="ags-audio" src={url} controls preload="none" />;
  return null;
}

function Detail({ task, onError, onRemoved }: { task: Task; onError: (m: string) => void; onRemoved: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<OutFile[]>([]);
  const [detailed, setDetailed] = useState(() => localStorage.getItem('cs.agent.detailed') === '1');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [calib, setCalib] = useState<string | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const running = task.status === 'running';
  const rows = useMemo(() => rowsOf(task.events ?? [], detailed), [task.events, detailed]);
  useEffect(() => { const el = log.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight; }, [task.events?.length, rows.length]);
  useEffect(() => { log.current?.scrollTo({ top: 1e9 }); setOpen(new Set()); setCalib(null); }, [task.id]);
  const lastFile = (task.events ?? []).filter((e) => e.kind === 'file').length;
  useEffect(() => { host.call<OutFile[]>('agents.files', task.id).then(setFiles).catch(() => setFiles([])); }, [task.id, task.status, lastFile, task.exporting]);
  const act = async (fn: () => Promise<unknown>) => { try { onError(''); await fn(); } catch (e) { onError((e as Error).message); } };
  const send = () => { const t = text.trim(); if (!t) return; setText(''); void act(() => host.call('agents.inject', { id: task.id, text: t })); };
  const toggleDetailed = (v: boolean) => { setDetailed(v); localStorage.setItem('cs.agent.detailed', v ? '1' : '0'); };
  const sorted = useMemo(() => [...files].filter((f) => !f.name.startsWith('.')).sort((a, b) => (RANK[fileKind(a.name)] - RANK[fileKind(b.name)]) || b.mtime - a.mtime), [files]);
  /** 「文件」事件里提到的图片 / 视频 / 音频，直接在对话里预览 */
  const mediaFor = (e: Ev): OutFile[] => {
    if (e.kind !== 'file' || !files.length) return [];
    const names = e.text.split(/[，,]\s*/).map((s) => s.replace(/^(新建|修改|删除)\s*/, '').split(/[\\/]/).pop()!.trim());
    return names.map((n) => files.find((f) => f.name === n)).filter((f): f is OutFile => !!f && ['图片', '视频', '音频'].includes(fileKind(f.name)));
  };
  const evMedia = (e: Ev) => {
    const m = mediaFor(e);
    return m.length ? <div className="ags-ev-media">{m.map((f) => <Media key={f.path} file={f} />)}</div> : null;
  };
  const [bankMsg, setBankMsg] = useState('');
  useEffect(() => setBankMsg(''), [task.id]);
  const importBankFile = (f: OutFile) => void act(async () => {
    const json = await host.call<unknown>('agents.bank', { id: task.id, file: f.path });
    const s = useStore.getState(), subject = studentSubject(s.students.find((x) => x.id === s.studentId));
    const drafts = parseBank(json, subject);
    if (!drafts.length) throw new Error('题库文件里没有可导入的题');
    await studyReady();
    const r = importBank(drafts, subject, 'AI 工作室 · ' + task.title);
    setBankMsg(`按${packOf(subject).stage}导入：入库 ${r.bank}，待核对 ${r.inbox}${r.dup ? `，重复跳过 ${r.dup}` : ''}`);
  });
  const configure = (v: { model?: string; permission?: Permission }) => void act(() => host.call('agents.configure', { id: task.id, ...v }));
  const saveCalib = () => {
    const v = Number(calib);
    if (!(v >= 0)) { onError('请填写中转站后台显示的这个任务实际扣费（元）'); return; }
    void act(async () => { await host.call('agents.calibrate', { id: task.id, actual: v }); setCalib(null); });
  };
  return (
    <div className="ags-detail">
      <div className="ags-d-head">
        <div>
          <h3>{task.title}</h3>
          <p><span className={'ags-pill s-' + task.status}>{running && <Loader2 size={11} className="ags-spin" />}{STATUS[task.status]}</span>
            {task.engine === 'codex' ? 'Codex CLI' : 'Claude Code'} · {task.pick || task.model || '默认模型'} · {PERMISSION_NAME[task.permission ?? 'safe']} · {when(task.created)} · 第 {task.turns} 轮 ·
            <b className="num"> {yuan(task.cny)}</b>{running && task.live ? <em className="ags-live">本轮进行中 +{yuan(task.live)}</em> : null} / ¥{task.cap}
            {task.calibrated && <em className="ags-calibrated">已按实际扣费校准</em>}
            {task.reconciled && <em className="ags-calibrated">已和中转站对账</em>}
            {task.queued ? ` · 排队 ${task.queued} 条` : ''}{task.note ? ' · ' + task.note : ''}</p>
          {!running && task.cny > 0 && (calib === null
            ? <button className="ags-link" onClick={() => setCalib('')}>花费和中转站后台对不上？按实际扣费校准</button>
            : <div className="ags-calib">
              <span>中转站后台显示这个任务实际花了</span><em>¥</em>
              <input type="number" min={0} step={0.01} autoFocus value={calib} onChange={(e) => setCalib(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveCalib(); }} />
              <button onClick={saveCalib}>校准</button><button className="ghost" onClick={() => setCalib(null)}>取消</button>
              <i>会同时更正账本，并按比例调整以后的估算</i>
            </div>)}
        </div>
        <div className="ags-d-act">
          <button className={cfgOpen ? 'on' : ''} title="换模型、改权限（下一轮对话生效）" onClick={() => setCfgOpen(!cfgOpen)}><Settings2 size={14} />模型 / 权限</button>
          {running ? <button className="danger" onClick={() => void act(() => host.call('agents.stop', task.id))}><CircleStop size={14} />停止</button>
            : <button onClick={() => { if (confirm('删除这个任务和它生成的所有文件？')) void act(async () => { await host.call('agents.remove', task.id); onRemoved(); }); }}><Trash2 size={14} />删除</button>}
        </div>
      </div>
      {cfgOpen && (
        <div className="ags-cfg">
          <div className="ags-cfg-item">
            <label>模型</label>
            <ModelPicker value={task.pick ?? ''} onChange={(m) => configure({ model: m })} placeholder="默认模型" title="下一轮对话开始用新模型" />
          </div>
          <div className="ags-cfg-item">
            <label>权限</label>
            <div className="ags-seg">
              {(['safe', 'full', 'danger'] as Permission[]).map((p) => (
                <button key={p} className={(task.permission ?? 'safe') === p ? 'on' : ''} onClick={() => configure({ permission: p })}>{PERMISSION_NAME[p]}</button>
              ))}
            </div>
          </div>
          <p className="ags-perm-hint"><ShieldCheck size={12} />{PERMISSION_HINT[task.permission ?? 'safe']}；改动从下一轮对话开始生效</p>
        </div>
      )}
      <div className="ags-d-body">
        <div className="ags-log" ref={log}>
          {rows.map((r) => {
            if (r.kind === 'ev') {
              const e = r.e;
              return (
                <div key={r.i} className={'ags-ev k-' + e.kind}>
                  {e.kind !== 'text' && <span className="ags-ev-k">{KIND_LABEL[e.kind] ?? e.kind}</span>}
                  <div className="ags-ev-t">{e.text}{evMedia(e)}</div>
                </div>
              );
            }
            const s = stepSummary(r.items), expanded = open.has(r.i);
            const media = expanded ? [] : [...new Map(r.items.flatMap(mediaFor).map((f) => [f.path, f])).values()].slice(0, 6);
            return (
              <div key={r.i} className="ags-steps">
                <button className="ags-steps-head" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(r.i)) n.delete(r.i); else n.add(r.i); return n; })} aria-expanded={expanded}>
                  <ChevronRight size={13} className={expanded ? 'open' : ''} />
                  {(s.parts.length > 0 || !s.names.length) && <span>{s.parts.length ? s.parts.join(' · ') : `${r.items.length} 个步骤`}</span>}
                  {s.names.length > 0 && <em>写了 {s.names.slice(0, 3).join('、')}{s.names.length > 3 ? ` 等 ${s.names.length} 个文件` : ''}</em>}
                  {s.plan && <i>计划 {s.done}/{s.all}</i>}
                </button>
                {s.plan && !expanded && <div className="ags-plan">{s.plan.text.split('\n').filter(Boolean).map((l, k) => <div key={k} className={l.startsWith('✓') ? 'done' : ''}>{l.replace(/^[✓·]\s*/, '')}</div>)}</div>}
                {media.length > 0 && <div className="ags-ev-media">{media.map((f) => <Media key={f.path} file={f} />)}</div>}
                {expanded && <div className="ags-steps-body">{r.items.map((e, k) => <div key={k} className={'ags-ev k-' + e.kind}><span className="ags-ev-k">{KIND_LABEL[e.kind]}</span><div className="ags-ev-t">{e.text}{evMedia(e)}</div></div>)}</div>}
              </div>
            );
          })}
          {running && <div className="ags-ev k-wait"><Loader2 size={13} className="ags-spin" />{nowDoing(task.events ?? [])}，可以随时在下面追加要求</div>}
          {!running && task.exporting && <div className="ags-ev k-wait"><Loader2 size={13} className="ags-spin" />正在排版成 {(task.formats ?? []).map((f) => FMT_LABEL[f]).join(' / ')}…</div>}
        </div>
        <aside className="ags-files">
          <h4><FileText size={13} />成果文件</h4>
          {sorted.length ? sorted.map((f) => {
            const kind = fileKind(f.name), md = kind === '文稿' && f.name !== '任务背景.md';
            return (
              <div key={f.path} className={'ags-file' + (f.name === '任务背景.md' ? ' dim' : '')} title={f.path}>
                <button className="ags-file-main" onClick={() => void act(() => host.call('agents.open', { id: task.id, file: f.path }))}>
                  <b className={'ags-fk k-' + kind}>{kind}</b><span>{f.name}</span><i>{f.size > 1024 ? (f.size / 1024).toFixed(0) + ' KB' : f.size + ' B'}</i>
                </button>
                {(kind === '图片' || kind === '视频' || kind === '音频') && <div className="ags-file-media"><Media file={f} /></div>}
                {md && (
                  <div className="ags-file-to">
                    <span>转成</span>
                    {(['docx', 'pdf', 'pptx'] as Fmt[]).map((fm) => <button key={fm} disabled={task.exporting} onClick={() => void act(() => host.call('agents.export', { id: task.id, file: f.path, formats: [fm] }))}>{FMT_LABEL[fm]}</button>)}
                  </div>
                )}
                {/题库\.json$/i.test(f.name) && (
                  <div className="ags-file-to">
                    <button disabled={running} onClick={() => importBankFile(f)} title="自检通过的题直接进题库，其余放进收件箱等你核对；重复的题会跳过">导入题库</button>
                    {bankMsg && <span>{bankMsg}</span>}
                  </div>
                )}
              </div>
            );
          }) : <p>还没有文件</p>}
          <div className="ags-files-act">
            <button onClick={() => void act(() => host.call('agents.reveal', task.id))}><FolderOpen size={13} />打开文件夹</button>
            <button disabled={!files.length} onClick={() => void act(async () => { const p = await host.call<string>('agents.folder', task.id); await addRoot(p); })}><FolderPlus size={13} />加入资料库</button>
          </div>
          <label className="ags-check small"><input type="checkbox" checked={detailed} onChange={(e) => toggleDetailed(e.target.checked)} />显示 AI 的每一步操作（命令、思考）</label>
        </aside>
      </div>
      <div className="ags-input">
        <textarea value={text} rows={2} onChange={(e) => setText(e.target.value)} placeholder={running ? '追加要求：AI 会在当前工作里接着处理' : '继续这个任务：例如「把第三题改简单一点」'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button disabled={!text.trim()} onClick={send}><Send size={15} />{running ? '追加' : '继续'}</button>
      </div>
    </div>
  );
}

function Ledger({ sum, onChange }: { sum: Summary | null; onChange: (s: Summary) => void }) {
  const [caps, setCaps] = useState(sum?.caps ?? { task: 5, day: 20, month: 200 });
  const [rows, setRows] = useState<[string, { input: number; cached: number; output: number }][]>([]);
  const [rate, setRate] = useState(sum?.usdRate ?? 7.2);
  const [factor, setFactor] = useState(sum?.factor ?? 1);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (sum) { setCaps(sum.caps); setRate(sum.usdRate); setFactor(sum.factor ?? 1); setRows(Object.entries(sum.prices)); } }, [!!sum, sum?.factor]);
  if (!sum) return <div className="ags-loading"><Loader2 size={18} className="ags-spin" /></div>;
  const save = async () => {
    try { onChange(await host.call<Summary>('ai.setBudget', { caps, usdRate: rate, factor, prices: Object.fromEntries(rows.filter(([k]) => k.trim())) })); setMsg('已保存'); }
    catch (e) { setMsg((e as Error).message); }
    setTimeout(() => setMsg(''), 2500);
  };
  const feats = Object.entries(sum.byFeature).sort((a, b) => b[1] - a[1]);
  const top = Math.max(0.01, ...feats.map((f) => f[1]));
  return (
    <div className="ags-ledger">
      <section className="agl-card">
        <h3>花费上限</h3>
        <p className="ags-sub">到了上限，新的 AI 请求会被拒绝；后台任务到了单任务上限会自动停止。金额按下面的价格表估算，以中转站实际扣费为准。</p>
        <div className="agl-caps">
          {([['task', '单个任务'], ['day', '每天'], ['month', '每月']] as const).map(([k, l]) => (
            <label key={k}><span>{l}</span><div><em>¥</em><input type="number" min={0} step={1} value={caps[k]} onChange={(e) => setCaps({ ...caps, [k]: Number(e.target.value) })} /></div></label>
          ))}
          <label><span>美元汇率</span><div><em>×</em><input type="number" min={1} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div></label>
          <label title="中转站价格 ÷ 官方价格。例如中转站按官方价一折收费就填 0.1。在任务详情里按实际扣费校准一次，会自动算出这个数"><span>中转站倍率</span><div><em>×</em><input type="number" min={0.001} max={10} step={0.01} value={factor} onChange={(e) => setFactor(Number(e.target.value) || 1)} /></div></label>
        </div>
        <h3>价格表 <small>官方价，每百万 tokens（元）；模型名包含左列文字就用这一行，* 是兜底价；实际估算 = 官方价 × 中转站倍率</small></h3>
        <div className="agl-prices">
          <div className="agl-ph"><span>模型名包含</span><span>输入</span><span>缓存命中</span><span>输出</span><span /></div>
          {rows.map(([k, p], i) => (
            <div key={i} className="agl-pr">
              <input value={k} disabled={k === '*'} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="例如 gpt-5" />
              {(['input', 'cached', 'output'] as const).map((f) => <input key={f} type="number" min={0} step={0.5} value={p[f]} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], { ...r[1], [f]: Number(e.target.value) }] : r)))} />)}
              {k !== '*' ? <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="删除这一行"><X size={13} /></button> : <span />}
            </div>
          ))}
          <button className="agl-add" onClick={() => setRows([...rows, ['', { input: 10, cached: 2.5, output: 40 }]])}><Plus size={13} />添加模型价格</button>
        </div>
        <div className="ags-row"><span className="flex" />{msg && <span className="agl-msg">{msg}</span>}<button className="ags-go" onClick={() => void save()}>保存</button></div>
      </section>
      <div className="agl-col">
      <ReconcileCard sum={sum} onChange={onChange} />
      <section className="agl-card">
        <h3>今天花在哪里 <small>{sum.tokensToday.toLocaleString()} tokens</small></h3>
        {feats.length ? <div className="agl-feats">{feats.map(([k, v]) => <div key={k}><span>{k}</span><i><b style={{ width: `${(v / top) * 100}%` }} /></i><em className="num">{yuan(v)}</em></div>)}</div>
          : <p className="ags-sub">今天还没有 AI 花费。</p>}
        <h3>最近记录</h3>
        <div className="agl-recent">
          {sum.recent.map((e, i) => (
            <div key={i}><span>{when(e.at)}</span><b>{e.source === 'task' ? '后台 · ' + e.feature : e.feature || '课堂 AI'}</b><i>{e.model}</i><em className="num">{(e.input + e.cached + e.output).toLocaleString()}</em>
              {Number.isFinite(e.real)
                ? <strong className="num real" title={`中转站实扣；本地估算 ${yuan(e.cny)}`}>{yuan(e.real!)}</strong>
                : <strong className={'num' + (e.miss ? ' miss' : ' est')} title={e.miss ? '中转站记录里没找到这一笔，按估算计' : '估算，等待和中转站对账'}>≈{yuan(e.cny)}</strong>}
            </div>
          ))}
          {!sum.recent.length && <p className="ags-sub">暂无记录</p>}
        </div>
      </section>
      </div>
    </div>
  );
}

/** 和中转站逐笔对账：能查到的用实扣，查不到的用估算；对上的记录会自动校准各模型的估算倍率 */
function ReconcileCard({ sum, onChange }: { sum: Summary; onChange: (s: Summary) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const r = sum.reconcile;
  if (!r) return null;
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      const before = r.matched, s = await host.call<Summary>('ai.reconcile');
      onChange(s);
      const n = (s.reconcile?.matched ?? 0) - before;
      setMsg(s.reconcile?.error ? '' : n > 0 ? `新对上 ${n} 笔` : '没有新的可对账记录');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = async (auto: boolean) => { try { onChange(await host.call<Summary>('ai.setBudget', { reconcile: auto })); } catch (e) { setMsg((e as Error).message); } };
  const factors = Object.entries(sum.modelFactors ?? {}).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const saved = r.est > 0 ? 1 - r.real / r.est : 0;
  const unsupported = r.site?.supported === false;
  return (
    <section className="agl-card agl-rec">
      <h3>和中转站对账 {r.site?.name ? <small>{r.site.name}</small> : null}</h3>
      <p className="ags-sub">每次 AI 请求都会带一个请求编号。能从中转站查到消费记录时，按编号逐笔换成真实扣费；查不到时继续用估算，并用已对上的记录自动校准估算倍率。</p>
      <div className="agl-rec-stats">
        <div><b className="num">{r.matched}</b><span>已对上</span></div>
        <div><b className="num">{r.pending}</b><span>等待对账</span></div>
        <div><b className="num">{r.missed}</b><span>没找到</span></div>
        <div><b className="num">{yuan(r.real)}</b><span>实扣（估算 {yuan(r.est)}）</span></div>
      </div>
      {r.matched > 0 && Math.abs(saved) > 0.02 && <p className="agl-rec-note">已对上的记录里，实扣比估算{saved > 0 ? '低' : '高'} {Math.abs(saved * 100).toFixed(0)}%，以后的估算已按这个比例校准。</p>}
      {(r.error || unsupported) && <p className={'agl-rec-err' + (unsupported ? ' soft' : '')}><TriangleAlert size={12} />{r.error || '这个中转站不支持按 Key 查询消费记录，继续用估算'}</p>}
      {factors.length > 0 && (
        <div className="agl-rec-models">
          {factors.map(([m, v]) => <div key={m}><i>{m}</i><span>倍率 ×{v.f.toFixed(3)}</span><em>{v.n} 笔</em></div>)}
        </div>
      )}
      <div className="ags-row">
        <label className="ags-check"><input type="checkbox" checked={r.auto} onChange={(e) => void toggle(e.target.checked)} />自动对账（每 10 分钟，有新请求时提前）</label>
        <span className="flex" />
        {r.lastSync > 0 && <span className="agl-rec-time">上次 {when(r.lastSync)}</span>}
        {msg && <span className="agl-msg">{msg}</span>}
        <button className="ags-go small" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={13} className="ags-spin" /> : <RefreshCw size={13} />}立即对账</button>
      </div>
    </section>
  );
}
