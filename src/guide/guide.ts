// 上课彩排：用练习学生「小明」和一块彩排黑板，把一节课从头到尾亲手走一遍。
// 进度存在本机（关掉软件下次接着做）；彩排里新加的学生、黑板、题目、学情、整理记录，退出时按开始时的样子清掉。
import { create } from 'zustand';
import { host } from '../lib/host';
import { boardMaterial } from '../lib/library';
import { inkKey, useStore } from '../lib/store';
import { BASE, matOfKey } from '../lib/desk';
import { SCREEN, isLong } from '../lib/longBoard';
import { removeQuestions, useStudy } from '../lib/studyStore';
import { aiConfig } from '../lib/studyActions';
import { online } from '../lib/studyAi';
import { packOf, hasDemo } from '../lib/subjects';
import { usePlugins, loadPlugins } from '../plugins/pluginStore';
import { useToolbar } from '../ui/toolbarPrefs';
import { pasteToBoard } from '../ink/pasteImage';
import { DEMOS, demosOf, makeDemo } from '../demos';
import { addImageData, addText, openSort, useSort } from '../lib/sort';
import { toast } from '../lib/toast';
import { openStudy } from '../teacher/StudyPage';
import type { Stroke } from '../lib/types';
import { setGuideSpot, useGuideSignals } from './hits';
import { BOARD_STEPS, GUIDE_STUDENT, nextChapter, nextOpen, stepsOf, type GuideBase, type GuideCtx, type RouteId, type StepStatus } from './steps';

const KEY = 'cs.guide', SNAP = 'cs.guide.snap';
const BOARD_TITLE = '彩排黑板';

/** 开始彩排时的样子：退出时只删这之后新加的 */
interface Snap {
  at: number; studentId: string; hadStudent: boolean;
  desk: string[]; inkKeys: string[];
  study: Record<'questions' | 'attempts' | 'lessons' | 'homework' | 'notes' | 'preps' | 'sorts', string[]>;
}
interface Saved {
  seen?: boolean; snooze?: number;
  active?: boolean; route?: RouteId; idx?: number; status?: Record<string, StepStatus>;
  boardId?: string; photoId?: string;
}
interface GuideState extends Required<Pick<Saved, 'active' | 'route' | 'idx' | 'status' | 'boardId' | 'photoId'>> {
  welcome: boolean; seen: boolean; snooze: number;
  phase: 'step' | 'cheer' | 'finish';
  since: number; base: GuideBase | null; mem: Record<string, string>;
  ai: boolean; dock: boolean; min: boolean; busy: string;
}

const read = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Saved; } catch { return {}; } };
const saved = read();
export const useGuide = create<GuideState>(() => ({
  welcome: false, seen: !!saved.seen, snooze: saved.snooze ?? 0,
  active: !!saved.active, route: saved.route ?? 'quick', idx: saved.idx ?? 0, status: saved.status ?? {},
  boardId: saved.boardId ?? '', photoId: saved.photoId ?? '',
  phase: 'step', since: Date.now(), base: null, mem: {}, ai: false, dock: false, min: false, busy: '',
}));
function persist() {
  const s = useGuide.getState();
  const v: Saved = { seen: s.seen, snooze: s.snooze, active: s.active, route: s.route, idx: s.idx, status: s.status, boardId: s.boardId, photoId: s.photoId };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 存不下就只在这次打开里记着 */ }
}
const snap = (): Snap | null => { try { return JSON.parse(localStorage.getItem(SNAP) || 'null') as Snap | null; } catch { return null; } };

export const currentSteps = () => stepsOf(useGuide.getState().route);
export const currentStep = () => currentSteps()[useGuide.getState().idx];

// ── 第一次打开时的邀请卡 ─────────────────────────────

/** 第一次打开（或「以后再说」过了三天）时邀请彩排；测试和学生窗口不弹 */
export function maybeWelcome() {
  const s = useGuide.getState();
  if (host.test || host.role !== 'teacher' || s.seen || s.active || Date.now() < s.snooze) return;
  useGuide.setState({ welcome: true });
}
export function laterWelcome() { useGuide.setState({ welcome: false, snooze: Date.now() + 3 * 86400_000 }); persist(); }
export function neverWelcome() { useGuide.setState({ welcome: false, seen: true }); persist(); }
export const showWelcome = () => useGuide.setState({ welcome: true });

// ── 练习空间 ────────────────────────────────────────

const ids = (a: { id: string }[] | undefined) => (a ?? []).map((x) => x.id);
function gradeFor(level: string) { return level === 'junior' ? '初二' : level === 'primary' ? '四年级' : '高一'; }

function openSandbox() {
  const st = useStore.getState(), d = useStudy.getState().data;
  if (!snap()) {
    const s: Snap = {
      at: Date.now(), studentId: st.studentId, hadStudent: st.students.some((x) => x.id === GUIDE_STUDENT),
      desk: [...new Set([BASE, st.pgmMat.id, ...st.desk.map((w) => w.id)])], inkKeys: Object.keys(st.ink),
      study: { questions: ids(d.questions), attempts: ids(d.attempts), lessons: ids(d.lessons), homework: ids(d.homework), notes: ids(d.notes), preps: ids(d.preps), sorts: ids(d.sorts) },
    };
    localStorage.setItem(SNAP, JSON.stringify(s));
  }
  if (!st.students.some((x) => x.id === GUIDE_STUDENT)) {
    const pack = packOf(st.subject);
    st.set({ students: [...st.students, { id: GUIDE_STUDENT, name: '小明', grade: gradeFor(pack.level), hue: 140, textbook: pack.textbook, subject: st.subject, tags: ['彩排'], lessons: 0, lastTopic: '', lastAt: '' }] });
  }
}

/** 把彩排期间新加的东西清掉，回到开始时的样子 */
function closeSandbox() {
  const s = snap();
  if (s) {
    // 学情：彩排里新加的题、作答、总结、作业、档案、整理记录
    const keep = Object.fromEntries(Object.entries(s.study).map(([k, v]) => [k, new Set(v)])) as Record<keyof Snap['study'], Set<string>>;
    const d = useStudy.getState().data;
    removeQuestions(d.questions.filter((q) => !keep.questions.has(q.id)).map((q) => q.id));
    useStudy.getState().update((x) => ({
      ...x,
      attempts: x.attempts.filter((a) => keep.attempts.has(a.id)), lessons: x.lessons.filter((a) => keep.lessons.has(a.id)),
      homework: x.homework.filter((a) => keep.homework.has(a.id)), notes: x.notes.filter((a) => keep.notes.has(a.id)),
      preps: x.preps.filter((a) => keep.preps.has(a.id)), sorts: (x.sorts ?? []).filter((a) => keep.sorts.has(a.id)),
      portraits: s.hadStudent ? x.portraits : Object.fromEntries(Object.entries(x.portraits).filter(([k]) => !k.startsWith(GUIDE_STUDENT))),
    }));
    // 黑板：彩排里新开的黑板关掉，笔迹删掉
    const deskKeep = new Set(s.desk), inkKeep = new Set(s.inkKeys);
    for (const w of useStore.getState().desk) if (!deskKeep.has(w.id)) useStore.getState().closeWin(w.id);
    const ink = Object.fromEntries(Object.entries(useStore.getState().ink).filter(([k]) => inkKeep.has(k) || deskKeep.has(matOfKey(k))));
    useStore.getState().setShared({ ink, selectedInk: null });
    if (!deskKeep.has(useStore.getState().pgmMat.id)) useStore.getState().focusWin(BASE);
  }
  // 练习学生
  const had = s?.hadStudent ?? false, cur = useStore.getState();
  if (!had) {
    const learning = { ...cur.learning }; delete learning[GUIDE_STUDENT];
    cur.set({ students: cur.students.filter((x) => x.id !== GUIDE_STUDENT), slots: cur.slots.filter((x) => x.studentId !== GUIDE_STUDENT), learning });
  }
  if (useStore.getState().studentId === GUIDE_STUDENT) {
    const back = s?.studentId && useStore.getState().students.some((x) => x.id === s.studentId) ? s.studentId : 'free';
    useStore.getState().set({ studentId: back });
  }
  if (useSort.getState().open) useSort.setState({ open: false });
  localStorage.removeItem(SNAP);
}

/** 学生画面换到彩排黑板（没有就开一块） */
function ensureBoard() {
  const st = useStore.getState(), g = useGuide.getState();
  if (st.page !== 'console') st.set({ page: 'console' });
  const have = st.desk.find((w) => w.id === g.boardId);
  if (have) { if (st.pgmMat.id !== have.id) st.focusWin(have.id); return; }
  const b = { ...boardMaterial(1), id: 'board-guide-' + Date.now().toString(36), title: BOARD_TITLE };
  useGuide.setState({ boardId: b.id }); persist();
  st.showNow(b);
}

/** 一张倒着拍的「照片」：图上的字是正的，贴上去以后转 180° */
function samplePhoto(lines: string[], o: { w?: number; h?: number; marks?: boolean; name?: string } = {}) {
  const w = o.w ?? 1200, h = o.h ?? 760, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#f1eee6'); gr.addColorStop(1, '#d9d4c8'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d1d1d'; g.font = `bold ${Math.round(w / 30)}px "Microsoft YaHei", sans-serif`;
  if (o.name) g.fillText(o.name, w * 0.06, h * 0.08);
  const top = o.name ? 0.18 : 0.12, step = (0.92 - top) / lines.length;
  lines.forEach((t, i) => {
    const y = h * (top + step * i);
    g.fillStyle = '#1d1d1d'; g.fillText(t, w * 0.06, y);
    if (o.marks) {
      // 红笔批改：对勾、叉、看不清的一笔
      g.strokeStyle = '#d0302a'; g.lineWidth = w / 160; g.beginPath();
      const x = w * 0.86, yy = y - h * 0.02;
      if (i % 3 === 0) { g.moveTo(x - 20, yy - 20); g.lineTo(x + 20, yy + 20); g.moveTo(x + 20, yy - 20); g.lineTo(x - 20, yy + 20); }
      else if (i % 3 === 1) { g.moveTo(x - 24, yy); g.lineTo(x - 6, yy + 18); g.lineTo(x + 26, yy - 22); }
      else { g.moveTo(x - 20, yy); g.quadraticCurveTo(x, yy - 18, x + 20, yy + 4); }
      g.stroke();
    }
  });
  const url = c.toDataURL('image/jpeg', 0.9); c.width = 0; c.height = 0;
  return url;
}

async function preparePhoto() {
  ensureBoard();
  const g = useGuide.getState(), st = useStore.getState(), key = inkKey(g.boardId, 0);
  if ((st.ink[key] ?? []).some((s) => s.id === g.photoId)) return;
  const url = samplePhoto(['倒着拍的题：', '一个物体从静止开始下落，', '1 s 内下落多高？（g 取 10 m/s²）']);
  const id = await pasteToBoard(url, { note: '彩排：黑板上贴了一张倒着拍的照片' });
  const cur = useStore.getState(), k = inkKey(cur.pgmMat.id, cur.pgm.page), s = (cur.ink[k] ?? []).find((x) => x.id === id);
  if (s) { cur.editInk(k, { upsert: [{ ...s, rot: Math.PI }] }); cur.setShared({ tool: 'select', selectedInk: { key: k, ids: [id] } }); }
  useGuide.setState({ photoId: id }); persist();
}

// ── 每一步：准备、底样、判断 ─────────────────────────

function guideBoards(): Record<string, Stroke[]> {
  const s = snap(), st = useStore.getState();
  const keepDesk = new Set(s?.desk ?? [BASE]), keepInk = new Set(s?.inkKeys ?? []);
  return Object.fromEntries(Object.entries(st.ink).filter(([k]) => !keepInk.has(k) && !keepDesk.has(matOfKey(k))));
}
function baseNow(): GuideBase {
  const st = useStore.getState(), d = useStudy.getState().data, all = Object.values(guideBoards()).flat();
  return {
    strokes: Object.fromEntries(all.map((s) => [s.id, JSON.stringify(s.pts)])),
    texts: Object.fromEntries(all.filter((s) => s.tool === 'text' && s.text).map((s) => [s.id, s.text!])),
    pgmId: st.pgmMat.id, lessons: d.lessons.filter((l) => l.studentId === GUIDE_STUDENT).length, homework: d.homework.length,
    preset: useToolbar.getState().preset, skin: st.skin,
  };
}
export function ctxNow(): GuideCtx {
  const g = useGuide.getState(), st = useStore.getState(), d = useStudy.getState().data;
  const s = snap(), mine = new Set(s?.study.sorts ?? []);
  return {
    since: g.since, studentId: st.studentId, skin: st.skin, preset: useToolbar.getState().preset,
    pvw: !!st.pvw, pgmId: st.pgmMat.id, pgmKind: st.pgmMat.kind, pgmLong: isLong(st.pgmMat),
    boards: guideBoards(), screen: SCREEN, photoId: g.photoId,
    hits: useGuideSignals.getState().hits, ai: g.ai, dock: g.dock,
    lessons: d.lessons.filter((l) => l.studentId === GUIDE_STUDENT).length, homework: d.homework.length,
    sorts: (d.sorts ?? []).filter((r) => !mine.has(r.id)).map((r) => ({ id: r.id, at: r.at, undone: r.undone })),
    plugins: (usePlugins.getState().list?.items ?? []).map((p) => ({ installedAt: p.installedAt, updatedAt: p.updatedAt })),
    base: g.base ?? baseNow(),
  };
}

function enter(i: number) {
  const steps = currentSteps();
  if (i >= steps.length) { useGuide.setState({ idx: steps.length, phase: 'finish', min: false }); setGuideSpot(null); persist(); return; }
  const step = steps[i];
  useGuide.setState({ idx: i, phase: 'step', since: Date.now(), mem: {}, base: null });
  if (BOARD_STEPS.has(step.id)) ensureBoard();
  if (step.id === 'photo') void preparePhoto().catch((e) => toast('贴练习照片没成功：' + (e as Error).message));
  if (step.id === 'plugin') void loadPlugins(true);
  if (step.id === 'save' && useStore.getState().pgmMat.kind !== 'board') ensureBoard();
  // 底样在准备动作之后取：准备时贴上去的照片不算老师写的
  setTimeout(() => { if (useGuide.getState().idx === i && !useGuide.getState().base) useGuide.setState({ base: baseNow() }); }, 0);
  setGuideSpot(step.spot ?? null);
  persist();
}

/** 往下走：已经做到的步骤（比如走完 5 分钟版再接着走完整版）不再重复 */
function advance(from: number) {
  const g = useGuide.getState(), steps = currentSteps();
  let i = from;
  while (i < steps.length && g.status[steps[i].id] === 'done') i++;
  enter(i);
}
let cheerTimer = 0;
function complete(how: StepStatus) {
  const g = useGuide.getState(), step = currentStep();
  if (!step || g.phase !== 'step') return;
  useGuide.setState({ status: { ...g.status, [step.id]: how } });
  persist();
  if (how === 'skipped') { advance(g.idx + 1); return; }
  useGuide.setState({ phase: 'cheer' });
  setGuideSpot(null);
  clearTimeout(cheerTimer);
  cheerTimer = window.setTimeout(() => { if (useGuide.getState().phase === 'cheer') advance(useGuide.getState().idx + 1); }, host.test ? 300 : 2200);
}
export const skipStep = () => complete('skipped');
export const ackStep = () => complete('done');
export const nextNow = () => { clearTimeout(cheerTimer); advance(useGuide.getState().idx + 1); };
export function skipChapter() {
  const g = useGuide.getState(), steps = currentSteps(), to = nextChapter(g.route, g.idx);
  const status = { ...g.status };
  for (let i = g.idx; i < to; i++) if (status[steps[i].id] !== 'done') status[steps[i].id] = 'skipped';
  useGuide.setState({ status }); advance(to);
}
export function goStep(id: string) { const i = currentSteps().findIndex((s) => s.id === id); if (i >= 0) { useGuide.setState({ min: false }); enter(i); } }

/** 每隔一会儿看一眼：老师做到了就往下走 */
export function tick() {
  const g = useGuide.getState(), step = currentStep();
  if (!g.active || g.phase !== 'step' || !step?.done || !g.base) return;
  if (step.done(ctxNow(), g.mem)) complete('done');
}
let polling = 0;
async function pollSlow() {
  const g = useGuide.getState();
  if (!g.active) return;
  const cfg = await aiConfig().catch(() => null);
  const dock = host.electron ? await host.call<{ shown?: boolean }>('dockState').then((s) => !!s?.shown).catch(() => false) : false;
  useGuide.setState({ ai: online(cfg), dock });
}

// ── 开始 / 退出 ─────────────────────────────────────

export function startGuide(route: RouteId) {
  useGuide.setState({ welcome: false, seen: true, active: true, route, min: false });
  openSandbox();
  const from = nextOpen(route, useGuide.getState().status);
  enter(from < 0 ? 0 : from);
  startPolling();
}
export function startPolling() {
  if (polling) return;
  void pollSlow();
  polling = window.setInterval(() => void pollSlow(), 2000);
}
/** 退出彩排：练习数据清掉，做到了哪几步留着（下次接着做） */
export function exitGuide() {
  clearTimeout(cheerTimer);
  closeSandbox();
  setGuideSpot(null);
  clearInterval(polling); polling = 0;
  useGuide.setState({ active: false, phase: 'step', idx: 0, boardId: '', photoId: '', base: null, mem: {}, min: false });
  persist();
  toast('彩排结束，练习学生小明和彩排黑板都清掉了。随时可以在「帮助」里再来一次');
}
/** 从头再来：清掉进度 */
export function restartGuide(route: RouteId) { useGuide.setState({ status: {} }); startGuide(route); }

/** 软件重开时接着彩排 */
export function resumeGuide() {
  if (host.role !== 'teacher' || !useGuide.getState().active) return;
  if (!snap()) openSandbox();
  enter(Math.min(useGuide.getState().idx, currentSteps().length));
  startPolling();
}

// ── 卡片上的辅助按钮 ─────────────────────────────────

export interface Extra { label: string; run: () => void | Promise<void> }
export function extrasOf(id: string): Extra[] {
  const st = useStore.getState();
  switch (id) {
    case 'ai': return [{ label: '打开 AI 设置', run: () => st.set({ aiOpen: true }) }, { label: '去银子 API 网站', run: () => void host.call('ai.openSite').catch(() => {}) }];
    case 'open': return [{ label: '用自带演示', run: () => { const m = makeDemo(demosOf(st.subject)[0]?.id ?? DEMOS[0].id); st.set({ page: 'console' }); st.cue(m); } }];
    case 'share': return [{ label: '打开学生窗口', run: () => host.openStudentWindow() }];
    case 'ask': return [{ label: '打开 AI 助手', run: () => st.set({ aiOpen: true }) }];
    case 'sortIn': return [{ label: '放进样例资料', run: sampleSort }];
    case 'sortUndo': return [{ label: '打开整理记录', run: () => openSort({ tab: 'records' }) }];
    case 'lesson': return [{ label: '带我去', run: () => openStudy('lesson') }];
    case 'paper': return [{ label: '带我去', run: () => openStudy('homework') }];
    case 'plugin': return [{ label: '带我去', run: () => st.set({ page: 'plugins' }) }];
    case 'skin': return [{ label: '打开皮肤', run: () => st.set({ skinsOpen: true }) }];
    default: return [];
  }
}
export const canDemoNow = () => hasDemo(useStore.getState().subject);

/** AI 整理的样例：一张批改过的月考照片 + 一段家长消息 */
export async function sampleSort() {
  const s = useSort.getState();
  if (s.phase !== 'collect') useSort.setState({ phase: 'collect', analyses: [], items: [], record: null, error: '' });
  openSort({ tab: 'new' });
  useSort.setState({ studentId: GUIDE_STUDENT });
  const url = samplePhoto(['1. 物体从静止开始下落，1 s 内下落多高？', '2. 汽车以 10 m/s 匀速行驶 5 s，位移多大？', '3. 质量 2 kg 的物体受 4 N 合力，加速度多大？'], { w: 1400, h: 1000, marks: true, name: '小明  10 月月考' });
  await addImageData(url, '样例：小明的月考卷.jpg');
  addText('小明妈妈：老师好，下周三的课能不能改到周四晚上 7 点？孩子计算老出错，希望多练练计算题。');
}
