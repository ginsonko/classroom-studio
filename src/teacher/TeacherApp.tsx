import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bot, CalendarDays, Circle, Command, LayoutDashboard, MonitorUp, PanelLeftClose, PanelLeftOpen, PanelRightClose,
  PanelRightOpen, Palette, Square, Users, Settings2, PenTool, Sparkles, BellRing, BookOpenCheck, Shapes, Workflow, LifeBuoy,
  SkipForward, Film, Clapperboard, Puzzle,
} from 'lucide-react';
import { type FileEntry } from '../lib/library';
import { STUDENTS } from '../lib/mock';
import { stepView, useStore } from '../lib/store';
import { ensureLibrary, useLib } from '../lib/useLib';
import { Logo } from '../ui/icons';
import { SkinPicker } from '../ui/SkinPicker';
import { SubjectPicker } from '../ui/SubjectPicker';
import { AiPanel, useAiLib } from './AiPanel';
import { Library } from './Library';
import { dropExternal, PgmMonitor, PvwMonitor } from './Monitors';
import { Reader } from './Reader';
import { Schedule } from './Schedule';
import { FlowPanel, NotesPanel, StudentCard } from './SidePanels';
import { Students } from './Students';
import { host } from '../lib/host';
import { openMaterial } from '../doc/actions';
import { useRecording, toggleRecording, nextLesson, isLive } from '../lib/recording';
import { ReplayPage } from './ReplayPage';
import { installPaste } from '../ink/pasteImage';
import { DesktopPanel } from './DesktopPanel';
import { AgentStudio } from './AgentStudio';
import { StudyPage } from './StudyPage';
import { ensureStudy } from '../lib/studyStore';
import { useAnswerMarks } from '../doc/answers';
import { checkFlow, checkSummary, readFlow, useCheck } from '../lib/warmup';
import { SkillRunner } from './Skills';
import { FormulaHost } from '../ink/FormulaSheet';
import { AutopilotPage } from './Autopilot';
import { startAutopilot, useAuto } from '../lib/autopilot';
import { ImportDialog } from './ImportDialog';
import { HelpCenter, UpdateToast } from './HelpCenter';
import { openHelp, useHelp } from '../lib/update';
import { dismiss, useToast } from '../lib/toast';
import { PluginsPage } from '../plugins/PluginsPage';
import { PluginButton, PluginSheets } from '../plugins/PluginUi';
import { SortButton, SortDialog } from './SortDialog';
import { openSort, useSort } from '../lib/sort';
import { Guide } from '../guide/GuideCards';

export function TeacherApp() {
  const page = useStore((s) => s.page);
  const set = useStore((s) => s.set);
  const skin = useStore((s) => s.skin);
  const motion = useStore((s) => s.motion);
  const aiOpen = useStore((s) => s.aiOpen), libOpen = useAiLib((s) => s.open);
  const recordPanel = useRecording(s=>s.panel);
  const recordError = useRecording(s=>s.error);
  const saveError = useStore(s=>s.saveError);
  const skinsOpen = useStore((s) => s.skinsOpen);
  useAnswerMarks();

  useEffect(() => { ensureLibrary(); ensureStudy(); startAutopilot(); document.title = '最强网课教辅系统 · 教师端'; }, []);
  const autoOn = useAuto((s) => s.settings.on);
  const helpOpen = useHelp((s) => !!s.open), updateDot = useHelp((s) => ['available', 'ready'].includes(s.update.phase) && s.update.info?.latest !== s.skip);
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    document.documentElement.dataset.motion = motion ? 'on' : 'off';
  }, [skin, motion]);

  // 全局快捷键：Enter = 切给学生，←/→ = 学生翻页，Tab = 专注阅读器
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); focusSearch(); return; }
      if (e.key === 'F1') { e.preventDefault(); openHelp('manual'); return; }
      const el = e.target as HTMLElement;
      if (el.closest('input,textarea,[contenteditable]')) return;
      const st = useStore.getState();
      if (e.key === 'Enter' && st.pvw) { e.preventDefault(); st.take(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') st.setShared({ pgm: stepView(st.pgmMat, st.pgm, 1) });
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') st.setShared({ pgm: stepView(st.pgmMat, st.pgm, -1) });
      if (e.key === 'Tab') { e.preventDefault(); const both = st.libraryOpen || st.rightOpen; st.set({ libraryOpen: !both, rightOpen: !both }); }
      if (e.key === '1' && e.altKey) st.set({ page: 'console' });
    };
    window.addEventListener('keydown', k);
    const offPaste = installPaste(() => useStore.getState().page === 'console' && !useSort.getState().open, (m) => useRecording.setState({ error: '贴图失败：' + m }));
    // 文件拖到没人接的地方（不是课件区、题库、资料库这些自己会接的地方）：交给 AI 整理
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.files.length) return;
      e.preventDefault();
      const paths = [...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter((p): p is string => !!p);
      if (paths.length) openSort({ paths });
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('keydown', k); offPaste(); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  return (
    <div className="ta">
      <TopBar />
      <div className="ta-main">
        <nav className="rail">
          <RailBtn icon={<LayoutDashboard size={19} />} label="上课" on={page === 'console'} onClick={() => set({ page: 'console' })} />
          <RailBtn icon={<CalendarDays size={19} />} label="课表" on={page === 'schedule'} onClick={() => set({ page: 'schedule' })} />
          <RailBtn icon={<Users size={19} />} label="学生" on={page === 'students'} onClick={() => set({ page: 'students' })} />
          <RailBtn icon={<BookOpenCheck size={19} />} label="学情" on={page === 'study'} onClick={() => set({ page: 'study' })} />
          <RailBtn icon={<Sparkles size={19} />} label="备课" on={page === 'agents'} onClick={() => set({ page: 'agents' })} />
          <RailBtn icon={<Workflow size={19} className={autoOn ? 'rail-live' : ''} />} label="自动" on={page === 'auto'} onClick={() => set({ page: 'auto' })} />
          <RailBtn icon={<Clapperboard size={19} />} label="回放" on={page === 'replay'} onClick={() => set({ page: 'replay' })} />
          <RailBtn icon={<Puzzle size={19} />} label="插件" on={page === 'plugins'} onClick={() => set({ page: 'plugins' })} />
          <span className="rail-flex" />
          <RailBtn icon={<Shapes size={19} />} label="演示" on={aiOpen && libOpen} onClick={() => { if (aiOpen && libOpen) set({ aiOpen: false }); else { useAiLib.setState({ open: true, focus: Date.now() }); set({ aiOpen: true }); } }} />
          <RailBtn icon={<Bot size={19} />} label="AI" on={aiOpen} onClick={() => set({ aiOpen: !aiOpen })} />
          <RailBtn icon={<Palette size={19} />} label="皮肤" on={skinsOpen} onClick={() => set({ skinsOpen: !skinsOpen })} />
          <RailBtn icon={<span className="rail-ico">{updateDot && <i className="help-dot" />}<LifeBuoy size={19} /></span>} label="帮助" on={helpOpen} onClick={() => helpOpen ? useHelp.setState({ open: false }) : openHelp(updateDot ? 'about' : 'manual')} />
        </nav>
        <div className="ta-page">
          {page === 'console' && <Console />}
          {page === 'schedule' && <Schedule />}
          {page === 'students' && <Students />}
          {page === 'study' && <StudyPage />}
          {page === 'agents' && <AgentStudio />}
          {page === 'auto' && <AutopilotPage />}
          {page === 'replay' && <ReplayPage />}
          {page === 'plugins' && <PluginsPage />}
        </div>
        {aiOpen && <div className="ai-dock"><AiPanel onClose={() => set({ aiOpen: false })} /></div>}
      </div>
      {skinsOpen && <SkinPicker onClose={() => set({ skinsOpen: false })} />}
      {recordPanel && <DesktopPanel />}
      {(recordError||saveError) && <div className="studio-notice" role="alert">{recordError||saveError}<button onClick={()=>useRecording.setState({error:null})}>知道了</button></div>}
      <RemindBanner />
      <SavedNotice />
      <Toasts />
      <ImportDialog />
      <SortDialog />
      <HelpCenter />
      <UpdateToast />
      <SkillRunner />
      <FormulaHost />
      <PluginSheets />
      <Guide />
      <Tooltips />
    </div>
  );
}

/** Ctrl+K：回到上课页并把光标放进资料库搜索框 */
function focusSearch() {
  useStore.getState().set({ page: 'console', libraryOpen: true });
  setTimeout(() => { const i = document.querySelector<HTMLInputElement>('.lib-search input'); i?.focus(); i?.select(); }, 0);
}

function RailBtn({ icon, label, on, onClick }: { icon: ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={'rail-b' + (on ? ' on' : '')} onClick={onClick} aria-label={label}>
      {icon}<span>{label}</span>
    </button>
  );
}

function TopBar() {
  const status = useRecording(s=>s.status);
  const rec={on:isLive(status.phase), start:status.startedAt??Date.now()};
  const set = useStore((s) => s.set);
  const studentId = useStore((s) => s.studentId);
  const students=useStore(s=>s.students);
  const pgmTitle = useStore((s) => s.pgmMat.title);
  const [now, setNow] = useState(Date.now());
  const [pick, setPick] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = students.find(x=>x.id===studentId)??{id:'free',name:'自由课堂',hue:192,lessons:0};
  const el = rec.on ? Math.floor((now - rec.start) / 1000) : 0;
  const hms = [Math.floor(el / 3600), Math.floor(el / 60) % 60, el % 60].map((v) => String(v).padStart(2, '0')).join(':');
  const lv=[status.micLevel??0,status.systemLevel??0];
  const finalizing=status.phase==='stopping';
  const job=status.jobs?.[0];

  return (
    <header className="tb">
      <button className="tb-brand" onClick={() => openHelp('about')} data-tip="关于、检查更新与说明书"><Logo /><b>最强网课教辅系统</b></button>
      <button className={'tb-rec' + (rec.on ? ' on' : '')} disabled={!host.electron||finalizing||status.phase==='starting'} onClick={()=>void toggleRecording()}>
        {rec.on ? <Square size={11} fill="currentColor" /> : <Circle size={11} fill="currentColor" />}
        <span>{finalizing?'正在保存…':status.phase==='starting'?'正在准备…':rec.on?'下课并保存':'开始上课'}</span>
        {rec.on && <b className="num">{hms}</b>}
      </button>
      {status.phase==='recording' && <button className="tb-next" onClick={()=>void nextLesson()} data-tip="连堂课：这一节保存，马上开始录下一节（学生窗口和会议共享不用动）"><SkipForward size={13}/><span>下一节</span></button>}
      {job && <button className="tb-job" onClick={()=>set({page:'replay'})} data-tip={`「${job.title||'课堂回放'}」正在后台生成 MP4，不影响上课${(status.jobs?.length??0)>1?`；后面还有 ${status.jobs!.length-1} 段排队`:''}`}><Film size={13}/><span>回放生成中</span><b className="num">{Math.round((job.progress??0)*100)}%</b></button>}
      {rec.on && (
        <div className="tb-meters" data-tip="录音电平：麦克风 / 系统声音（含腾讯会议里学生的声音）">
          <Meter v={lv[0]} label="麦" /><Meter v={lv[1]} label="系统" />
        </div>
      )}
      <div className="tb-student">
        <button className="tb-stu" onClick={() => setPick(!pick)} style={{ ['--h' as string]: s.hue }}>
          <span className="ava sm">{s.name.slice(-1)}</span>
          <span>{s.name}</span>
          <i>{s.id==='free'?'未绑定学生':`第 ${(Number(s.lessons)||0)+1} 课`}</i>
        </button>
        {pick && (
          <>
          <div className="pop-bg" onPointerDown={() => setPick(false)} />
          <div className="pop stu-pop">
            <button className={s.id==='free'?'on':''} onClick={() => { set({ studentId: 'free' }); setPick(false); }} style={{ ['--h' as string]: 192 }}><span className="ava sm">课</span><b>自由课堂</b><i>不绑学生</i></button>
            {!students.length&&<button onClick={()=>{set({page:'students'});setPick(false);}}>添加学生档案</button>}
            {students.map((x) => (
              <button key={x.id} className={x.id === studentId ? 'on' : ''} onClick={() => { set({ studentId: x.id }); setPick(false); }} style={{ ['--h' as string]: x.hue }}>
                <span className="ava sm">{x.name.slice(-1)}</span><b>{x.name}</b><i>{x.grade}</i>
              </button>
            ))}
          </div>
          </>
        )}
      </div>
      <SubjectPicker className="tb-subj" />
      <div className="tb-now"><span className="tally-dot" /><span className="tb-now-t">学生画面</span><b title={pgmTitle}>{pgmTitle}</b></div>
      <span className="flex" />
      <SortButton />
      <PenHolder />
      <button className="tb-cmd" onClick={focusSearch}><Command size={13}/><span>搜索课件</span><kbd>Ctrl K</kbd></button>
      <PluginButton />
      <DockToggle />
      <button className="tb-ico" onClick={()=>useRecording.setState({panel:true})} data-tip="窗口、录课与回放"><Settings2 size={16}/></button>
      <button className="tb-ico" data-guide="student-window" onClick={()=>host.openStudentWindow()} data-tip="打开学生窗口"><MonitorUp size={16} /></button>
    </header>
  );
}

/** 下课保存好录像后告诉老师放在哪：绑定了学生就归档到学生页，自由课堂到「窗口、录课与回放」里找 */
function SavedNotice() {
  const st = useRecording((s) => s.status);
  const [closed, setClosed] = useState('');
  const student = useStore((s) => s.students.find((x) => x.id === st.studentId));
  const set = useStore((s) => s.set);
  const key = st.phase + ':' + (st.id ?? '');
  if (closed === key) return null;
  const close = () => setClosed(key);
  if (st.phase === 'saved') return (
    <div className="saved-notice" role="status">
      <b>这节课的录像已保存</b>
      <span>回放视频正在后台生成（顶部能看到进度）。现在就可以关学生窗口、开始下一节课。</span>
      <div className="saved-acts">
        <button onClick={() => { set({ page: 'replay' }); close(); }}>去回放页</button>
        <button className="ghost" onClick={close}>知道了</button>
      </div>
    </div>
  );
  if (st.phase !== 'complete' || !st.path) return null;
  return (
    <div className="saved-notice" role="status">
      <b>回放已生成</b>
      <span>{student ? <>已归到「{student.name}」的档案。左侧「回放」页和「学生」页都能找到。</> : <>这节课没有绑定学生，录像在左侧「回放」页。</>}</span>
      <code title={st.path}>{st.path}</code>
      <div className="saved-acts">
        <button onClick={() => void host.call('openRecording', st.id)}>播放</button>
        <button onClick={() => host.revealInFolder(st.path!)}>打开文件夹</button>
        <button onClick={() => { set({ page: 'replay' }); close(); }}>全部回放</button>
        {student && <button onClick={() => { set({ page: 'students', studentId: student.id }); close(); }}>去学生页</button>}
        <button className="ghost" onClick={close}>关闭</button>
      </div>
    </div>
  );
}

function Toasts() {
  const list = useToast((s) => s.list);
  if (!list.length) return null;
  return <div className="toasts" role="status">{list.map((t) => <div key={t.id} className="toast"><span>{t.message}</span>{t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}<button className="ghost" onClick={() => dismiss(t.id)} aria-label="关闭提示">×</button></div>)}</div>;
}

/** 学生拿着笔时在顶栏常驻提示；浮层被隐藏时也能一键收回 */
function PenHolder() {
  const who = useStore((s) => s.drawAuthor);
  if (who !== 'student') return null;
  return (
    <button className="tb-pen" onClick={() => useStore.getState().setShared({ drawAuthor: 'teacher' })} data-tip="学生正在用学生工具条书写，点击把笔收回到老师">
      <i />学生在写<b>收回</b>
    </button>
  );
}

/** 教师浮层开关：跟随学生窗口的隐形工具栏 */
function DockToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!host.electron) return;
    void host.call<{ visible?: boolean; shown?: boolean }>('dockState').then((s) => setOn(!!s?.visible)).catch(() => {});
  }, []);
  return (
    <button
      className={'tb-ico' + (on ? ' on' : '')}
      data-tip={on ? '教师浮层：显示中（贴在学生窗口上，学生看不到）· 点击隐藏' : '教师浮层：已隐藏 · 点击显示'}
      onClick={() => {
        if (!host.electron) return;
        const next = !on;
        setOn(next);
        void host.call<{ visible?: boolean }>(next ? 'dockVisible' : 'hideDock').then((s) => { if (s && typeof s.visible === 'boolean') setOn(s.visible); }).catch(() => setOn(!next));
      }}
    >
      <PenTool size={16} />
    </button>
  );
}

function Meter({ v, label }: { v: number; label: string }) {
  return (
    <span className="meter"><i>{label}</i><span>{[0, 1, 2, 3, 4, 5].map((k) => <b key={k} className={v * 6 > k ? (k > 4 ? 'hot' : 'on') : ''} />)}</span></span>
  );
}

/** 上课页：资料库 | 阅读器 | 主监/预监/流程 */
function Console() {
  const libraryOpen = useStore((s) => s.libraryOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const libraryW = useStore((s) => s.libraryW);
  const rightW = useStore((s) => s.rightW);
  const set = useStore((s) => s.set);
  const lib = useLib((s) => s.lib);
  const [over, setOver] = useState(false);

  const toTeacher = (f:FileEntry)=>void openMaterial(f,'teacher');
  const toStudent=(f:FileEntry)=>void openMaterial(f,'student');
  const toCue=(f:FileEntry)=>void openMaterial(f,'cue');

  return (
    <div className="con" style={{ gridTemplateColumns: `${libraryOpen ? libraryW + 'px' : '0px'} ${libraryOpen ? '5px' : '0px'} minmax(0,1fr) ${rightOpen ? '5px' : '0px'} ${rightOpen ? rightW + 'px' : '0px'}` }}>
      <aside className={'col col-lib' + (libraryOpen ? '' : ' shut')}>{libraryOpen && <Library onTeacher={toTeacher} onStudent={toStudent} onCue={toCue} />}</aside>
      <Splitter on={libraryOpen} onDrag={(dx) => set({ libraryW: Math.max(240, Math.min(560, useStore.getState().libraryW + dx)) })} />
      <section
        className={'col col-mid' + (over ? ' drop' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const id = e.dataTransfer.getData('text/x-cs-file');
          const f = id && lib?.files.get(id);
          if (f) toTeacher(f); else dropExternal(e, 'teacher');
        }}
      >
        <button className="edge l" onClick={() => set({ libraryOpen: !libraryOpen })} data-tip={libraryOpen ? '收起资料库' : '展开资料库'}>{libraryOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}</button>
        <button className="edge r" onClick={() => set({ rightOpen: !rightOpen })} data-tip={rightOpen ? '收起右栏' : '展开右栏'}>{rightOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button>
        <Reader />
        {over && <div className="drop-hint">松手 · 只给老师打开</div>}
      </section>
      <Splitter on={rightOpen} onDrag={(dx) => set({ rightW: Math.max(300, Math.min(640, useStore.getState().rightW - dx)) })} />
      <aside className={'col col-right' + (rightOpen ? '' : ' shut')}>
        {rightOpen && (
          <div className="right-stack">
            <PgmMonitor onOpenStudent={()=>host.openStudentWindow()} />
            <PvwMonitor />
            <StudentCard onOpen={() => set({ page: 'students' })} />
            <FlowPanel />
            <NotesPanel />
          </div>
        )}
      </aside>
    </div>
  );
}

function Splitter({ on, onDrag }: { on: boolean; onDrag: (dx: number) => void }) {
  const last = useRef<number | null>(null);
  if (!on) return <div />;
  return (
    <div
      className="split-h"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); last.current = e.clientX; document.body.classList.add('resizing'); }}
      onPointerMove={(e) => { if (last.current === null) return; onDrag(e.clientX - last.current); last.current = e.clientX; }}
      onPointerUp={() => { last.current = null; document.body.classList.remove('resizing'); }}
    />
  );
}

/** 课前提醒：系统通知之外，导播台里也停一条横幅，点「准备上课」直接切到这个学生 */
function RemindBanner() {
  const [r, setR] = useState<{ title: string; body: string; studentId?: string } | null>(null);
  // 课前提醒一到就在后台做课前检查（本机操作，不花钱）：PPT 提前转换、网页课件试开并预加载
  useEffect(() => host.onEvent((e) => { if (e?.type === 'remind') { setR({ title: e.title, body: e.body, studentId: e.studentId }); void checkFlow({ auto: true }); } }), []);
  const ck = useCheck();
  if (!r) return null;
  const go = () => {
    const st = useStore.getState();
    if (r.studentId && st.students.some((x) => x.id === r.studentId)) st.set({ studentId: r.studentId });
    st.set({ page: 'console', rightOpen: true }); setR(null);
  };
  const flowIds = readFlow().filter((x) => !x.done).map((x) => x.id), sum = ck.auto ? checkSummary(ck.items, flowIds) : '';
  return (
    <div className="remind-banner" role="status">
      <BellRing size={18} />
      <div><b>{r.title}</b><span>{r.body.replace('点这里打开导播台。', '')}{sum && <em className={'remind-check' + (/有问题/.test(sum) ? ' bad' : '')}>课前检查：{sum}{/有问题|留意/.test(sum) ? '（见右侧本课流程）' : ''}</em>}</span></div>
      <button className="go" onClick={go}>准备上课</button>
      <button onClick={() => setR(null)}>知道了</button>
    </div>
  );
}

/** 统一提示：任何带 data-tip 的元素 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; pos: 'above' | 'below' | 'right' | 'left' } | null>(null);
  useEffect(() => {
    let t = 0;
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
      clearTimeout(t);
      if (!el) { setTip(null); return; }
      t = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        // 教师浮层是窄条窗口：提示放在浮层旁边的空白处（那里有给弹层留的位置），不压在按钮上
        const rail = el.closest('.tdock, .tdock-mini');
        if (rail) {
          const b = rail.getBoundingClientRect(), right = rail.classList.contains('side-left');
          setTip({ text: el.dataset.tip!, x: right ? b.right + 10 : b.left - 10, y: Math.min(innerHeight - 30, Math.max(30, r.top + r.height / 2)), pos: right ? 'right' : 'left' });
          return;
        }
        const below = r.top < 60;
        setTip({ text: el.dataset.tip!, x: Math.min(innerWidth - 20, Math.max(20, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, pos: below ? 'below' : 'above' });
      }, 380);
    };
    const hide = () => { clearTimeout(t); setTip(null); };
    const out = (e: PointerEvent) => { if (!e.relatedTarget) hide(); };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide);
    document.addEventListener('pointerout', out);
    return () => { window.removeEventListener('pointerover', over); window.removeEventListener('pointerdown', hide); document.removeEventListener('pointerout', out); };
  }, []);
  if (!tip) return null;
  return <div className={'tip ' + tip.pos} style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
