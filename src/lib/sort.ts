// AI 整理：老师把卷子照片、Word / PDF、微信里复制的家长消息丢进来 → AI 认出是什么、是谁的 → 列整理单 →
// 老师勾选确认后才写进题库、学情、学生档案；整批可以撤销。没配 AI 时按规则整理，照片原样存下等以后识别。
import { create } from 'zustand';
import { ai, type AiConfig } from './ai';
import { host } from './host';
import { askUpright, fillByAi, importFiles, jpegOf, ocrTurn, pageOfImage, photoQuestions, TURN_HINT, turnPage } from './importQuestions';
import {
  actionText, defaultTake, estimateTokens, findStudentIn, inputKindOf, matchStudent, parseImageReply, parseTextReply, subjectByName, textByRules,
  type Analysis, type SortInput, type StudentLite,
} from './sortLogic';
import { guessDifficulty, guessPoints, guessType, looseJSON, type Question, type SortRecord, type StudentNote } from './studyLogic';
import { aiConfig } from './studyActions';
import { online } from './studyAi';
import { addQuestion, nowIso, recordAttempt, removeQuestions, sid, useStudy } from './studyStore';
import { useStore } from './store';
import { packOf, studentSubject, subjectName, type SubjectId } from './subjects';
import { toast } from './toast';

export type Phase = 'collect' | 'analyzing' | 'review' | 'saving' | 'done';
interface SortState {
  open: boolean; tab: 'new' | 'records';
  items: SortInput[]; studentId: string;
  phase: Phase; step: string; error: string;
  analyses: Analysis[]; est: { cny: number; calls: number } | null; ai: boolean;
  record: SortRecord | null;
  /** 归档到第几样（从 0 数） */
  cursor: number;
}
const fresh = (): Omit<SortState, 'open' | 'tab' | 'studentId'> => ({ items: [], phase: 'collect', step: '', error: '', analyses: [], est: null, ai: false, record: null, cursor: 0 });
export const useSort = create<SortState>(() => ({ open: false, tab: 'new', studentId: '', ...fresh() }));

const MAX_ITEMS = 30;
// 资料整理要把作答记到具体某个人身上，班组不在名单里
const students = (): StudentLite[] => useStore.getState().students.filter((s) => !s.archived && !s.kind);
const studentName = (id: string) => useStore.getState().students.find((s) => s.id === id)?.name ?? '当前学生';
const subjectOf = (id: string): SubjectId => studentSubject(useStore.getState().students.find((s) => s.id === id));
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** 打开 AI 整理（可以顺便带上拖进来的文件 / 粘贴的文字）。background：只收下资料，不弹出窗口 */
export function openSort(o: { paths?: string[]; texts?: string[]; tab?: 'new' | 'records'; background?: boolean } = {}) {
  const s = useSort.getState(), st = useStore.getState();
  const cur = st.students.some((x) => x.id === st.studentId && !x.archived && !x.kind) ? st.studentId : st.students.find((x) => x.id === st.studentId)?.members?.find((id) => students().some((s) => s.id === id)) ?? students()[0]?.id ?? '';
  const restart = s.phase === 'done';
  useSort.setState({ open: o.background ? s.open : true, tab: o.tab ?? 'new', ...(restart ? fresh() : {}), ...(!s.studentId || restart || (s.phase === 'collect' && !s.items.length) ? { studentId: cur } : {}) });
  if (!restart && s.phase !== 'collect' && (o.paths?.length || o.texts?.length)) { useSort.setState({ error: '上一批还没归档：先归档，或点「返回修改」再加新资料' }); return; }
  if (o.paths?.length) addPaths(o.paths);
  for (const t of o.texts ?? []) addText(t);
  if (useSort.getState().items.length) void estimate();
}
export const closeSort = () => useSort.setState({ open: false });
export function resetSort() { useSort.setState({ ...fresh() }); }

export function addPaths(paths: string[]) {
  const s = useSort.getState();
  if (s.phase !== 'collect') return;
  const have = new Set(s.items.map((x) => x.path));
  const add = paths.filter((p) => p && !have.has(p) && inputKindOf(p)).map((p): SortInput => ({ id: sid(), kind: inputKindOf(p)!, name: baseName(p), path: p }));
  const skipped = paths.filter((p) => p && !inputKindOf(p)).length;
  useSort.setState({ items: [...s.items, ...add].slice(0, MAX_ITEMS), error: skipped ? `${skipped} 个文件不是图片、Word、PDF 或文本，没有加进来` : '' });
  void estimate();
}
export function addText(text: string) {
  const t = text.trim(), s = useSort.getState();
  if (!t || s.phase !== 'collect') return;
  useSort.setState({ items: [...s.items, { id: sid(), kind: 'text' as const, name: t.replace(/\s+/g, ' ').slice(0, 24), text: t.slice(0, 20000) }].slice(0, MAX_ITEMS) });
  void estimate();
}
/** 粘贴的截图 / 照片：先存成文件，和拖进来的图片一样处理 */
export async function addImageData(dataUrl: string, name = '粘贴的图片') {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0);
  const path = await host.call<string>('saveImage', c.toDataURL('image/png')); c.width = 0; c.height = 0;
  const s = useSort.getState();
  if (s.phase !== 'collect') return;
  useSort.setState({ items: [...s.items, { id: sid(), kind: 'image' as const, name, path }].slice(0, MAX_ITEMS) });
  void estimate();
}
export const removeItem = (id: string) => { useSort.setState((s) => ({ items: s.items.filter((x) => x.id !== id) })); void estimate(); };

let estSeq = 0;
export async function estimate() {
  const seq = ++estSeq, cfg = await aiConfig().catch(() => null), on = online(cfg), items = useSort.getState().items;
  if (!on || !items.length) { if (seq === estSeq) useSort.setState({ est: null, ai: on }); return; }
  const t = estimateTokens(items);
  const r = await host.call<{ cny: number } | null>('ai.estimate', t).catch(() => null);
  if (seq === estSeq) useSort.setState({ ai: true, est: r ? { cny: r.cny, calls: t.calls } : null });
}

// ── 第一步：认东西 ─────────────────────────────────────

const roster = () => { const list = students(); return list.length ? '学生名单：' + list.map((s) => s.name).join('、') + '（写的名字尽量对上名单）' : ''; };
const IMAGE_PROMPT = () => [
  '老师把一张图片交给你整理。它可能是：空白的试卷 / 作业（exam）、学生做过并被老师用红笔批改过的卷子（graded）、微信等聊天截图（chat）、成绩单（score）、别的（other）。',
  roster(),
  '输出 JSON：{"kind":"exam|graded|chat|score|other","up":"up","student":"图上写的学生姓名，看不出写空","subject":"学科名（物理、数学、英语…），看不出写空","title":"简短标题，例如「10 月月考 第 2 页」",',
  '"questions":[{"n":大题号（整数）,"boxes":[[x0,y0,x1,y1]],"mark":"right|wrong|half|unsure|none"}],',
  '"text":"chat / score / other 时把图上的文字抄下来；聊天每条一行，写成「谁：内容」",',
  '"parent":{"summary":"家长消息的要点，一句话","reschedule":"家长要调课 / 请假时，写清原来的时间和想改到的时间；没有写空","requirement":"家长对教学提的要求；没有写空"}}',
  'exam / graded 才写 questions：每道大题框一个矩形，题干、配图、选项和它的全部小问 (1)(2)… 框在一起，不要把小问拆成几道；跨栏给两个框；照片边上只露出一两行、看不出在问什么的残题不框（大半拍到了的要框）；坐标用 0~1000 的整数（左上角 0,0，右下角 1000,1000），框要包全，宁大勿小。',
  TURN_HINT,
  'mark 看老师的红笔：打勾 right，打叉 wrong，半对或扣了分 half，有批改痕迹但看不清 unsure，没批改 none。拿不准就写 unsure，不要猜。',
  '不是聊天截图时 parent 的各项写空。',
].filter(Boolean).join('\n');
const TEXT_PROMPT = (text: string) => [
  '老师粘贴给你一段文字。它可能是：微信里家长发的消息（chat）、一道或几道题（questions）、成绩（score）、老师自己的备注（note）。',
  roster(),
  '输出 JSON：{"kind":"chat|questions|score|note","student":"说的是哪个学生，看不出写空","subject":"学科名，看不出写空","title":"简短标题",',
  '"parent":{"summary":"家长消息的要点，一句话","reschedule":"家长要调课 / 请假时，写清原来的时间和想改到的时间；没有写空","requirement":"家长对教学提的要求；没有写空"},',
  '"questions":[{"n":1,"stem":"题干原文，不要改写"}]}',
  '不是题目时 questions 写 []；不是家长消息时 parent 各项写空。',
  '文字如下：\n' + text.slice(0, 12000),
].filter(Boolean).join('\n');

async function analyzeOne(it: SortInput, cfg: AiConfig | null, fallback: string): Promise<Analysis> {
  const on = online(cfg), byName = findStudentIn(it.name, students());
  const who = (name: string, text = '') => {
    if (name) return matchStudent(name, students(), byName ?? fallback);
    const id = byName ?? findStudentIn(text, students()) ?? fallback;
    return { id };
  };
  const done = (a: Omit<Analysis, 'take' | 'subject' | 'studentId'> & { subjectName?: string; studentId: string; note?: string }): Analysis => {
    const subject = subjectByName(a.subjectName ?? '', subjectOf(a.studentId));
    const { subjectName: _s, ...rest } = a;
    return { ...rest, subject, take: defaultTake(a) };
  };
  if (it.kind === 'doc') {
    const id = byName ?? fallback;
    return done({ itemId: it.id, kind: 'doc', via: on ? 'ai' : 'rules', name: '', studentId: id, title: it.name.replace(/\.[^.]+$/, '') });
  }
  if (it.kind === 'text') {
    const text = it.text ?? '';
    if (!on) { const r = textByRules(text), w = who('', text); return done({ itemId: it.id, via: 'rules', name: '', studentId: w.id, ...r, title: r.title ?? '' }); }
    const r = await ai.chat([{ role: 'user', content: TEXT_PROMPT(text) }], { json: true, maxTokens: 3000, temperature: 0, feature: 'AI 整理' });
    const p = parseTextReply(looseJSON(r.content), text), w = who(p.name, text);
    return done({ itemId: it.id, via: 'ai', ...p, studentId: w.id, note: w.note, title: p.title || (p.kind === 'chat' ? '家长消息' : '粘贴的文字') });
  }
  // 图片
  const title0 = it.name.replace(/\.[^.]+$/, '');
  if (!on) {
    // 没配 AI 也把拍横了、拍倒了的照片转正再存
    const raw = await pageOfImage(it.path!).catch(() => null), turn = raw ? await ocrTurn(raw).catch(() => null) : null;
    raw?.close?.();
    return done({ itemId: it.id, kind: 'photo', via: 'rules', name: '', studentId: byName ?? fallback, title: title0, ...(turn ? { turn } : {}) });
  }
  const page = await pageOfImage(it.path!);
  try {
    const ask = async (img: string) => {
      const v = looseJSON((await ai.chat([{ role: 'user', content: IMAGE_PROMPT() }], { image: img, json: true, maxTokens: 4000, temperature: 0, feature: 'AI 整理', ...(cfg!.visionModel ? { model: cfg!.visionModel } : {}) })).content);
      // 回复读不出来就算没认出来：照片原样存，不能当成一条空备注
      if (!v) throw new Error('AI 的回复格式不对');
      return v;
    };
    const r = await askUpright(page, ask, parseImageReply);
    if (r.page !== page) r.page.close?.();
    const p = r.v, w = who(p.name);
    return done({ itemId: it.id, via: 'ai', ...p, ...(r.turn ? { turn: r.turn } : {}), studentId: w.id, note: w.note, title: p.title || title0 });
  } finally { page.close?.(); }
}

export async function analyze(o: { quiet?: boolean } = {}) {
  const s = useSort.getState();
  if (s.phase !== 'collect' || !s.items.length) return;
  if (!s.studentId) { useSort.setState({ error: '先在上面选一个学生（还没有学生的话，先去「学生」页添加）' }); return; }
  const cfg = await aiConfig().catch(() => null);
  useSort.setState({ phase: 'analyzing', error: '', analyses: [], ai: online(cfg) });
  const out: Analysis[] = [];
  for (const [i, it] of s.items.entries()) {
    useSort.setState({ step: `${online(cfg) ? 'AI 正在看' : '正在整理'}第 ${i + 1} / ${s.items.length} 样：${it.name}` });
    try { out.push(await analyzeOne(it, cfg, s.studentId)); }
    catch (e) {
      // AI 没认出来：照片原样存，文字存成备注，不丢东西
      const kind = it.kind === 'image' ? 'photo' : it.kind === 'doc' ? 'doc' : 'note';
      const a: Analysis = { itemId: it.id, kind, via: 'rules', name: '', studentId: s.studentId, subject: subjectOf(s.studentId), title: it.name, text: it.text, note: `AI 没认出来（${(e as Error).message.slice(0, 80)}），按原样保存`, take: {} };
      a.take = defaultTake(a); out.push(a);
    }
    useSort.setState({ analyses: [...out] });
  }
  useSort.setState({ phase: 'review', step: '' });
  // 窗口收起来了（整理在后台跑）：好了提醒一声
  if (!useSort.getState().open && !o.quiet) toast(`AI 整理看完了 ${out.length} 样资料，列好了整理单，等你确认后归档`, { ms: 20000, action: { label: '去确认', run: () => openSort() } });
}

/** 整理到第几样了（看资料、归档两步都算） */
export const sortProgress = (s: Pick<SortState, 'phase' | 'analyses' | 'items' | 'cursor'>) => {
  if (s.phase === 'analyzing') return { done: s.analyses.length, total: s.items.length };
  if (s.phase === 'saving') return { done: s.cursor, total: s.analyses.length };
  return null;
};

/**
 * AI 助教用：把文件交给 AI 整理，在后台看资料、列整理单，不弹窗口。
 * archive = true 时列好单子直接归档（老师说过不用确认时才这样）；归档后照样可以在「整理记录」里整批撤销。
 */
export async function sortInBackground(paths: string[], o: { studentId?: string; archive?: boolean } = {}) {
  const s = useSort.getState();
  if (s.phase === 'analyzing' || s.phase === 'saving' || s.phase === 'review') throw Error('上一批 AI 整理还没确认归档：请老师先在顶栏「AI 整理」里处理完');
  openSort({ background: true });
  if (useSort.getState().items.length) useSort.setState({ items: [] });
  if (o.studentId && students().some((x) => x.id === o.studentId)) useSort.setState({ studentId: o.studentId });
  addPaths(paths);
  if (!useSort.getState().items.length) throw Error(useSort.getState().error || '这些文件 AI 整理认不了（只收图片、Word、PDF、文本）');
  const n = useSort.getState().items.length;
  const job = (async () => { await analyze({ quiet: o.archive }); if (o.archive && useSort.getState().phase === 'review') await archive(); })();
  job.catch((e) => toast('AI 整理出错：' + (e as Error).message));
  return n;
}

export function patchAnalysis(itemId: string, p: Partial<Analysis>) {
  useSort.setState((s) => ({ analyses: s.analyses.map((a) => a.itemId === itemId ? { ...a, ...p, take: { ...a.take, ...p.take } } : a) }));
}

// ── 第二步：归档 ───────────────────────────────────────

function addNoteRaw(n: Omit<StudentNote, 'id' | 'at'>): StudentNote {
  const note: StudentNote = { ...n, text: n.text.trim().slice(0, 20000), id: sid(), at: nowIso() };
  useStudy.getState().update((d) => ({ ...d, notes: [...d.notes, note] }));
  return note;
}

export async function archive() {
  const s = useSort.getState();
  if (s.phase !== 'review') return;
  const cfg = await aiConfig().catch(() => null), on = online(cfg);
  const rec: SortRecord = { id: sid(), at: nowIso(), title: '', studentIds: [], lines: [], questions: [], attempts: [], notes: [], unsure: [] };
  const fill: string[] = [];
  const per = new Map<string, { q: number; right: number; wrong: number; half: number; unsure: number; notes: number; todo: number }>();
  const tally = (id: string) => { let t = per.get(id); if (!t) { t = { q: 0, right: 0, wrong: 0, half: 0, unsure: 0, notes: 0, todo: 0 }; per.set(id, t); } return t; };
  useSort.setState({ phase: 'saving', error: '', cursor: 0 });
  try {
    for (const [i, a] of s.analyses.entries()) {
      const it = s.items.find((x) => x.id === a.itemId);
      if (!it || !Object.values(a.take).some(Boolean)) continue;
      useSort.setState({ step: `归档第 ${i + 1} / ${s.analyses.length} 样：${it.name}`, cursor: i });
      const t = tally(a.studentId), source = a.title || it.name;
      const note = (kind: StudentNote['kind'], text: string, todo?: StudentNote['todo']) => {
        if (!text.trim()) return;
        rec.notes.push(addNoteRaw({ studentId: a.studentId, kind, text, source: 'AI 整理 · ' + it.name, ...(todo ? { todo } : {}) }).id);
        if (todo) t.todo++; else t.notes++;
      };
      if (a.take.questions) {
        const qs: Question[] = [];
        if (a.kind === 'doc') {
          const r = await importFiles([it.path!], a.subject, (x) => useSort.setState({ step: x }), { batch: rec.id, ai: true });
          const bad = r.files.find((f) => f.error);
          if (bad) rec.lines.push(`${it.name}：${bad.error}`);
          rec.questions.push(...r.added.map((q) => q.id)); t.q += r.added.length;
        } else if (a.kind === 'photo' || a.kind === 'exam' || a.kind === 'graded') {
          const raw = await pageOfImage(it.path!), page = turnPage(raw, a.turn ?? 0);
          try {
            const got = a.regions?.length ? await photoQuestions(page, a.regions, { source, subject: a.subject, batch: rec.id }) : [];
            if (!got.length) {
              const image = await host.call<string>('study.image', jpegOf(page));
              const q = addQuestion({ stem: '', image, answer: '', analysis: '', points: [], difficulty: 3, qtype: '其他', source, origin: 'import', status: 'inbox', subject: a.subject, batch: rec.id, ...(a.kind === 'photo' ? { needsAi: true } : {}) });
              qs.push(q);
            }
            for (const { q, r } of got) {
              qs.push(q);
              if (!a.take.attempts) continue;
              if (r.mark === 'right' || r.mark === 'wrong' || r.mark === 'half') { rec.attempts.push(recordAttempt(a.studentId, q.id, r.mark, 'AI 整理：按红笔批改').id); t[r.mark]++; }
              else if (r.mark === 'unsure') { rec.unsure.push({ questionId: q.id, studentId: a.studentId }); t.unsure++; }
            }
          } finally { page.close?.(); raw.close?.(); }
        } else if (a.kind === 'questions') {
          for (const x of a.questions ?? []) qs.push(addQuestion({ stem: x.stem, answer: '', analysis: '', points: on ? [] : guessPoints(x.stem, a.subject), difficulty: guessDifficulty(x.stem), qtype: guessType(x.stem, a.subject), source: `${source} 第 ${x.n} 题`, origin: 'paste', status: 'inbox', subject: a.subject, batch: rec.id }));
        }
        rec.questions.push(...qs.map((q) => q.id)); t.q += qs.length;
        if (a.kind !== 'photo') fill.push(...qs.map((q) => q.id));
      }
      if (a.take.parent) note(a.kind === 'note' ? 'teacher' : 'parent', a.text ?? '');
      if (a.take.requirement && a.parent?.requirement) note('requirement', a.parent.requirement);
      if (a.take.reschedule && a.parent?.reschedule) note('requirement', '调课：' + a.parent.reschedule, 'reschedule');
      if (a.take.score) note('teacher', '成绩：\n' + (a.text ?? ''));
      if (!rec.studentIds.includes(a.studentId)) rec.studentIds.push(a.studentId);
    }
    for (const [id, t] of per) {
      const bits = [
        t.q ? `${t.q} 题进收件箱` : '',
        t.right + t.wrong + t.half ? `记作答：错 ${t.wrong} · 半对 ${t.half} · 对 ${t.right}` : '',
        t.unsure ? `${t.unsure} 道批改没认准，等你点对错` : '',
        t.notes ? `${t.notes} 条记进档案` : '',
        t.todo ? `${t.todo} 条调课提醒` : '',
      ].filter(Boolean);
      if (bits.length) rec.lines.unshift(`${studentName(id)}：${bits.join('；')}`);
    }
    const first = s.analyses[0]?.title || s.items[0]?.name || 'AI 整理';
    rec.title = s.analyses.length === 1 ? first : `${first} 等 ${s.analyses.length} 样`;
    useStudy.getState().update((d) => ({ ...d, sorts: [...(d.sorts ?? []), rec].slice(-200) }));
    useSort.setState({ phase: 'done', step: '', record: rec });
    if (!useSort.getState().open) toast(`AI 整理归档好了：${rec.lines[0] ?? rec.title}`, { ms: 15000, action: { label: '看结果', run: () => useSort.setState({ open: true, tab: 'new' }) } });
    if (on && fill.length) void fillByAi(fill, cfg);
    const todo = [...per.values()].reduce((n, t) => n + t.todo, 0);
    if (todo) toast(`有 ${todo} 条家长调课的消息：课表不会自动改，记得去调一下`, { ms: 12000, action: { label: '去课表', run: () => { useStore.getState().set({ page: 'schedule' }); closeSort(); } } });
  } catch (e) {
    // 已经写进去的部分留着，记录也留着，老师可以整批撤销
    if (rec.questions.length || rec.notes.length || rec.attempts.length) useStudy.getState().update((d) => ({ ...d, sorts: [...(d.sorts ?? []), { ...rec, title: rec.title || '整理到一半出错', lines: [...rec.lines, '整理到一半出错：' + (e as Error).message] }] }));
    useSort.setState({ phase: 'review', step: '', error: '归档没完成：' + (e as Error).message + '。已经写进去的可以在「整理记录」里撤销' });
    if (!useSort.getState().open) toast('AI 整理归档没完成：' + (e as Error).message, { ms: 15000, action: { label: '去看看', run: () => openSort() } });
  }
}

// ── 记录：撤销、补记批改、调课提醒 ─────────────────────

export function undoSort(id: string) {
  const r = (useStudy.getState().data.sorts ?? []).find((x) => x.id === id);
  if (!r || r.undone) return;
  removeQuestions(r.questions);
  const att = new Set(r.attempts), notes = new Set(r.notes);
  useStudy.getState().update((d) => ({
    ...d, attempts: d.attempts.filter((a) => !att.has(a.id)), notes: d.notes.filter((n) => !notes.has(n.id)),
    sorts: (d.sorts ?? []).map((x) => x.id === id ? { ...x, undone: nowIso() } : x),
  }));
  let cells = 0;
  if (r.map?.length) {
    const learning = { ...useStore.getState().learning };
    for (const c of r.map) {
      const g = learning[c.mapKey];
      if (g?.[c.ci]?.[c.si] !== c.to) continue;
      learning[c.mapKey] = g.map((row, i) => (i === c.ci ? row.map((v, j) => (j === c.si ? c.from : v)) : row));
      cells++;
    }
    if (cells) useStore.getState().set({ learning });
  }
  toast(`已撤销${r.recordId ? '这次录像分析' : '这次整理'}：${r.questions.length} 道题、${r.attempts.length} 条作答、${r.notes.length} 条档案记录${cells ? `、${cells} 处学习地图` : ''}`);
}

/** 批改没认准的题：老师点了对错再记 */
export function settleUnsure(recordId: string, questionId: string, result: 'right' | 'wrong' | 'half' | null) {
  const r = (useStudy.getState().data.sorts ?? []).find((x) => x.id === recordId), u = r?.unsure.find((x) => x.questionId === questionId);
  if (!r || !u) return;
  const a = result ? recordAttempt(u.studentId, questionId, result, 'AI 整理：老师确认') : null;
  const name = studentName(u.studentId), left = r.unsure.filter((y) => y.studentId === u.studentId).length - 1;
  const lines = r.lines.map((l) => l.startsWith(name + '：') ? l.replace(/\d+ 道批改没认准，等你点对错/, left > 0 ? `${left} 道批改没认准，等你点对错` : '没认准的已由你补记') : l);
  useStudy.getState().update((d) => ({ ...d, sorts: (d.sorts ?? []).map((x) => x.id === recordId ? { ...x, lines, unsure: x.unsure.filter((y) => y.questionId !== questionId), attempts: a ? [...x.attempts, a.id] : x.attempts } : x) }));
}

export function finishTodo(noteId: string) {
  useStudy.getState().update((d) => ({ ...d, notes: d.notes.map((n) => n.id === noteId ? { ...n, done: nowIso() } : n) }));
}

export const openTodos = (notes: StudentNote[]) => notes.filter((n) => n.todo && !n.done);
export const describe = (a: Analysis) => (k: Parameters<typeof actionText>[1]) => actionText(a, k, studentName(a.studentId));
export const subjectText = (id: SubjectId) => `${packOf(id).stage || subjectName(id)}`;
