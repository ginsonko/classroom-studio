// AI 助教能调用的软件功能。每个工具：给 Codex 看的说明和参数，以及在教师窗口里执行的处理函数。
// 会改数据的工具执行前后各拍一张快照，比出这次改了哪些记录（Change），老师可以整轮撤销。
// 删除数据、发给家长要老师在对话里点确认；电脑上的文件要老师先同意。
import { host } from '../lib/host';
import { useStore, type Page } from '../lib/store';
import type { ChapterState, LessonSlot, Student } from '../lib/types';
import { useStudy, addQuestion, patchQuestion, recordAttempt, removeQuestions, nowIso, sid } from '../lib/studyStore';
import { buildLessonNote, captureFromScreen, dayKey, exportHomework, homeworkTitle, lessonDocument, saveLesson } from '../lib/studyActions';
import { DIFF_NAME, findDuplicate, guessPoints, levelText, mastery, pickHomework, pointLabel, pointsOf, profile, questionSubject, RESULT_NAME, similarity, validPoints, wrongBook, type LessonNote, type Question, type Result, type SendRecord, type StudyData } from '../lib/studyLogic';
import { SUBJECTS, byLevel, levelOfGrade, mapKey, packOf, pointKey, studentSubject, type SubjectId } from '../lib/subjects';
import { fullGrid, planMap, STATE_NAME } from '../lib/mapLogic';
import { changeText, setMapStates } from '../lib/mapUpdate';
import { addNote, makePrep } from '../lib/autopilot';
import { useLib } from '../lib/useLib';
import { fileEntry, search as searchLib } from '../lib/library';
import { openMaterial } from '../doc/actions';
import { openStudy, type StudyTab } from '../teacher/StudyPage';
import { MANUAL } from '../help/manual';
import { ai } from '../lib/ai';
import { readSource } from '../lib/scheduleAi';
import { openSort, sortInBackground } from '../lib/sort';
import { filesOf, linkFiles } from '../lib/studentFiles';
import { fmtT } from '../lib/timeline';
import type { RecordRow } from '../lib/recording';
import { analyzeRecording } from '../lib/recordAnalysis';
import { asrApi } from '../lib/asr';
import { MODE_NAME } from '../lib/fineLogic';
import { dateKey } from '../doc/scheduleModel';
import { checkClash, day, lessonFrom, lessonText, occurrences, pickPeople, pickStudent, putIn, schema, signature, squash, WEEK, type Box, type Change, type Kind, type Param } from './toolsLogic';
import { findGroupFor, GROUP_KINDS, groupsOf, individuals, isGroup, kindName, makeGroup, membersOf, peopleOf, whoText } from '../lib/groups';
import type { GroupKind } from '../lib/types';
import { cleanTrigger, PAGES, triggerJson, type Trigger } from './triggersLogic';
import { putTrigger, removeTrigger, setMemory, setTriggers, useAssistantData, type Memory } from './state';

export interface Card { title: string; lines?: string[]; files?: string[]; tone?: 'ok' | 'warn' | 'bad' }
export interface ToolResult { ok: boolean; text: string; images?: string[]; changes?: Change[]; card?: Card | null }
export interface ToolCtx {
  chatId: string;
  /** 在对话里弹确认卡片，老师点了才继续 */
  confirm(o: { title: string; detail: string; yes?: string }): Promise<boolean>;
  /** 打开发给家长的预览，老师发完 / 关掉后返回发送结果 */
  sendParent(o: { lesson: LessonNote; student: Student }): Promise<SendRecord[]>;
  /** 老师同意过的文件和文件夹 */
  granted(): string[];
  /** 请老师同意访问电脑上的文件；返回同意了的路径（拒绝返回空） */
  grant(o: { paths: string[]; reason: string }): Promise<string[]>;
}
type A = Record<string, unknown>;
interface Def { name: string; description: string; params?: Record<string, Param>; required?: string[]; write?: boolean; run(a: A, c: ToolCtx): Promise<Out> | Out }
type Out = { text: string | object; card?: Card | null; images?: string[]; ok?: boolean };

// ── 小工具 ───────────────────────────────────────────
const S = () => useStore.getState();
const D = () => useStudy.getState().data;
const str = (v: unknown, n = 2000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, n));
const has = (v: unknown) => v !== undefined && v !== null && v !== '';
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return has(v) && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : has(v) ? String(v).split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean) : []);
const clip = (s: string | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const P = (type: Param['type'], description: string, more: Partial<Param> = {}): Param => ({ type, description, ...more });
const live = () => S().students.filter((s) => !s.archived);
const who = (id: string) => S().students.find((s) => s.id === id)?.name ?? '（已删除的学生）';
const fname = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** 没说是谁就用当前上课的学生（或班组）；「俊宇、欣怡」找正好是这几个人的班组 */
function studentOf(ref: unknown): Student {
  if (has(ref)) {
    const p = pickPeople(S().students, ref);
    if (!p) return pickStudent(S().students, ref);
    if (p.group) return p.group;
    throw Error(`还没有「${p.members.map((m) => m.name).join('、')}」一起上课的班组，可以先用 add_group 建一个`);
  }
  const cur = S().students.find((s) => s.id === S().studentId && !s.archived);
  if (!cur) throw Error('没有说是哪位学生（当前是自由课堂）。现有学生：' + (live().map((s) => s.name).join('、') || '还没有学生'));
  return cur;
}
/** 排课用：几个人一起上、又还没有这样的班组时，先做一个新班组（fresh），确认能排上再存 */
function lessonWho(ref: unknown): { id: unknown; fresh?: Student } {
  const p = has(ref) ? pickPeople(S().students, ref) : null;
  if (!p) return { id: ref };
  if (p.group) return { id: p.group.id };
  const fresh = makeGroup({ members: p.members.map((m) => m.id) }, S().students);
  return { id: fresh.id, fresh };
}
function makeStudent(name: string, grade: string, subject: SubjectId, more: Partial<Student> = {}, n = 0): Student {
  return { id: crypto.randomUUID(), name, grade, subject, textbook: packOf(subject).textbook, tags: [], hue: ((S().students.length + n) * 137 + 195) % 360, lessons: 0, lastTopic: '', lastAt: '', archived: false, ...more };
}
/** 名单里的人：找已有学生；create 时没有的新建档案（放进 made） */
function membersFrom(v: unknown, o: { create: boolean; grade: string; subject: SubjectId; made: Student[] }): string[] {
  return [...new Set(list(v).map((n) => {
    try { return pickStudent(individuals(S().students), n).id; } catch (e) {
      const had = o.made.find((x) => x.name === n); if (had) return had.id;
      // 只有完全找不到才新建；名字对上好几位时照样报错让 AI 指定
      if (!o.create || !(e as Error).message.startsWith('没有叫')) throw e;
      const s = makeStudent(str(n, 60), o.grade, o.subject, {}, o.made.length); o.made.push(s); return s.id;
    }
  }))];
}

/** 学科：id、「高中物理」、或「物理」+年级 */
function subjectFrom(v: unknown, grade = ''): SubjectId {
  const s = str(v, 30);
  if (SUBJECTS.some((p) => p.id === s)) return s as SubjectId;
  const level = levelOfGrade(grade);
  const pool = level ? byLevel(level) : SUBJECTS;
  const hit = SUBJECTS.find((p) => p.stage === s) ?? pool.find((p) => s && (p.name === s || s.includes(p.name) || p.stage.includes(s))) ?? (s ? undefined : pool[0]);
  if (!hit) throw Error(`不认识的学科「${s}」，可选：${SUBJECTS.map((p) => p.id + '（' + p.stage + '）').join('、')}`);
  return hit.id;
}

/** 知识点：key 或名字（「牛顿第二定律」）→ key */
function pointsFrom(v: unknown, subject: SubjectId): string[] {
  const out = new Set<string>();
  for (const x of list(v)) {
    const k = validPoints([x], subject);
    if (k.length) { k.forEach((y) => out.add(y)); continue; }
    const hit = pointsOf(subject).filter((p) => p.sec.includes(x) || x.includes(p.sec));
    if (hit.length) hit.slice(0, 2).forEach((p) => out.add(p.key));
    else guessPoints(x, subject).slice(0, 2).forEach((y) => out.add(y));
  }
  return [...out].slice(0, 8);
}

const qJson = (q: Question, full = false) => ({
  id: q.id, stem: full ? q.stem : clip(q.stem, 160) || (q.image ? '（只有题图）' : ''), ...(q.answer ? { answer: full ? q.answer : clip(q.answer, 80) } : {}),
  ...(full && q.analysis ? { analysis: q.analysis } : {}), points: q.points.map(pointLabel), difficulty: DIFF_NAME[q.difficulty] ?? q.difficulty, qtype: q.qtype,
  status: q.status === 'bank' ? '题库' : '收件箱', subject: packOf(questionSubject(q)).stage, ...(q.source ? { source: clip(q.source, 40) } : {}), ...(q.image ? { has_image: true } : {}),
});
const stuJson = (s: Student) => {
  const all = S().students, g = isGroup(s) ? { type: kindName(s.kind), members: membersOf(s, all).map((m) => m.name) } : { groups: groupsOf(s.id, all).filter((x) => !x.archived).map((x) => x.name) };
  return { id: s.id, name: s.name, ...g, grade: s.grade, subject: packOf(studentSubject(s)).stage, textbook: s.textbook, tags: s.tags, lessons: s.lessons, last_topic: s.lastTopic, ...(s.archived ? { archived: true } : {}) };
};
const noteJson = (l: LessonNote) => ({ id: l.id, date: l.date, topic: l.topic, summary: l.summary, strengths: l.strengths, problems: l.problems, next: l.next, parent: l.parent, homework: l.homework ?? '', via: l.via, sent: (l.sends ?? []).some((x) => x.ok) });
const findQ = (id: unknown) => { const q = D().questions.find((x) => x.id === str(id)); if (!q) throw Error('找不到这道题：' + str(id)); return q; };
const findSlot = (id: unknown) => { const s = S().slots.find((x) => x.id === str(id)); if (!s) throw Error('找不到这节课（id=' + str(id) + '），先用 list_lessons 查一下'); return s; };
const setSlots = (slots: LessonSlot[]) => S().set({ slots });
const setStudents = (students: Student[]) => S().set({ students });

// ── 撤销用的快照 ─────────────────────────────────────
type Snap = Record<Kind, { id: string }[]>;
/** 学习地图按「学生@学科」一份一份记，地图没变时沿用同一个对象，比较快照不用每次序列化 */
const mapCache = new WeakMap<ChapterState[][], { id: string; grid: ChapterState[][] }>();
const mapRows = () => Object.entries(S().learning).map(([id, grid]) => { const hit = mapCache.get(grid); if (hit && hit.id === id) return hit; const row = { id, grid }; mapCache.set(grid, row); return row; });
function snap(): Snap {
  const d = D(), a = useAssistantData.getState();
  return { student: S().students, slot: S().slots, question: d.questions, attempt: d.attempts, lesson: d.lessons, homework: d.homework, note: d.notes ?? [], prep: d.preps ?? [], file: d.files ?? [], map: mapRows(), trigger: a.triggers, memory: a.memory };
}
function diff(before: Snap, after: Snap): Change[] {
  const out: Change[] = [];
  for (const kind of Object.keys(before) as Kind[]) {
    const b = before[kind], f = after[kind];
    if (b === f) continue;
    const bm = new Map(b.map((x) => [x.id, x])), fm = new Map(f.map((x) => [x.id, x]));
    for (const [id, x] of bm) { const y = fm.get(id); if (x !== y && JSON.stringify(x) !== JSON.stringify(y ?? null)) out.push({ kind, id, before: x, after: y ?? null }); }
    for (const [id, y] of fm) if (!bm.has(id)) out.push({ kind, id, before: null, after: y });
  }
  return out;
}
type StudyKey = 'questions' | 'attempts' | 'lessons' | 'homework' | 'notes' | 'preps' | 'files';
const STUDY: Partial<Record<Kind, StudyKey>> = { question: 'questions', attempt: 'attempts', lesson: 'lessons', homework: 'homework', note: 'notes', prep: 'preps', file: 'files' };
/** 撤销时读写各处的数据 */
export const box: Box = {
  get(kind, id) { return (snap()[kind] as { id: string }[]).find((x) => x.id === id) ?? null; },
  put(kind, id, value) {
    const v = value as { id: string } | null;
    if (kind === 'student') setStudents(putIn(S().students, id, v as Student | null));
    else if (kind === 'slot') setSlots(putIn(S().slots, id, v as LessonSlot | null));
    else if (kind === 'trigger') setTriggers(putIn(useAssistantData.getState().triggers, id, v as Trigger | null));
    else if (kind === 'memory') setMemory(putIn(useAssistantData.getState().memory, id, v as Memory | null));
    else if (kind === 'map') { const learning = { ...S().learning }; if (v) learning[id] = (v as unknown as { grid: ChapterState[][] }).grid; else delete learning[id]; S().set({ learning }); }
    else { const k = STUDY[kind]!; useStudy.getState().update((d) => ({ ...d, [k]: putIn((d[k] ?? []) as { id: string }[], id, v) }) as StudyData); }
  },
};

// ── 工具清单 ─────────────────────────────────────────
const WHEN_DESC = '触发条件，对象。type 取：before_lesson（课前 minutes 分钟，可选 student=学生 id）、after_lesson（下课后 minutes 分钟，0 = 下课时）、daily（每天 time="HH:MM"，可选 weekdays=[1..7] 周一=1）、at（某个时刻 datetime="YYYY-MM-DDTHH:MM"）、app_start（打开软件时）、open_page（打开某页 page=' + Object.keys(PAGES).join('/') + '）、view_student（切换到某学生时，可选 student）、import_questions（导入题目时）';
const ACTION_DESC = '触发后做什么，对象。{type:"remind",text:"提醒老师的话"} 只弹提醒；{type:"assistant",prompt:"交给助教去做的事"} 由助教自动去办（会花 AI 费用）';
const TIMES_DESC = '触发几次："once" 只一次，"every" 每次，或数字 N 表示一共 N 次。不填时某个时刻的提醒默认 once，其余默认 every';

const DEFS: Def[] = [
  {
    name: 'get_overview', description: '软件当前概况：现在时间、所在页面、当前学生、今明两天的课、学生 / 题库数量、提醒数量、老师让记住的事。不确定从哪开始时先调用',
    run() {
      const st = S(), d = D(), now = new Date();
      return { text: {
        now: `${dateKey(now)} ${WEEK[(now.getDay() + 6) % 7]} ${now.toTimeString().slice(0, 5)}`, page: PAGES[st.page], current_student: ((c) => (c ? whoText(c, st.students) : '自由课堂'))(st.students.find((s) => s.id === st.studentId)),
        student_screen: st.pgmMat.title, students: live().length, lessons_today_tomorrow: occurrences(st.slots, st.students, now, 2).slice(0, 12),
        bank: d.questions.filter((q) => q.status === 'bank').length, inbox: d.questions.filter((q) => q.status === 'inbox').length,
        triggers: useAssistantData.getState().triggers.length, memory: useAssistantData.getState().memory.map((m) => ({ id: m.id, text: m.text })),
      } };
    },
  },
  // ── 学生 ──
  {
    name: 'list_students', description: '列出学生和班组（姓名、年级、学科、教材、标签、已上课次、上次讲到）。班组（一对二 / 小组课 / 班课）带 type 和 members；个人带所在的 groups',
    params: { include_archived: P('boolean', '是否包含已归档的学生') },
    run(a) { const all = a.include_archived === true ? S().students : live(); return { text: all.length ? all.map(stuJson) : '还没有学生' }; },
  },
  {
    name: 'get_student', description: '一位学生的详细情况：基本资料、正确率、薄弱 / 掌握好的知识点、未订正错题数、最近的课后总结、家长要求和老师备注、接下来两周的课、最近作业和备课',
    params: { student: P('string', '学生姓名或 id；不填 = 当前学生') },
    run(a) {
      const s = studentOf(a.student), d = D(), subject = studentSubject(s), p = profile(s.id, d, Date.now(), subject);
      return { text: {
        ...stuJson(s), accuracy: p.accuracy === null ? '暂无作答' : Math.round(p.accuracy * 100) + '%', recent_accuracy: p.recentAccuracy === null ? '' : Math.round(p.recentAccuracy * 100) + '%',
        attempts: p.attempts, weak: p.weak.map((m) => `${pointLabel(m.key)}（掌握 ${Math.round(m.score * 100)}%，${m.n} 次）`), strong: p.strong.map((m) => pointLabel(m.key)),
        wrong_open: p.open, wrong_fixed: p.fixed,
        lesson_notes: d.lessons.filter((l) => (isGroup(s) ? l.groupId === s.id : l.studentId === s.id)).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 3).map((l) => ({ id: l.id, ...(isGroup(s) ? { student: who(l.studentId) } : {}), date: l.date, topic: l.topic, summary: clip(l.summary, 200), next: l.next })),
        notes: (d.notes ?? []).filter((n) => n.studentId === s.id).slice(-6).map((n) => ({ kind: n.kind === 'parent' ? '家长沟通' : n.kind === 'requirement' ? '家长要求' : '老师备注', at: n.at.slice(0, 10), text: clip(n.text, 300) })),
        upcoming: occurrences(S().slots, S().students, new Date(), 14, s.id).slice(0, 6),
        homework: d.homework.filter((h) => h.studentId === s.id).slice(-3).map((h) => ({ title: h.title, at: h.at.slice(0, 10), count: h.questionIds.length })),
        preps: (d.preps ?? []).filter((x) => x.studentId === s.id).slice(-2).map((x) => ({ date: x.date, topic: x.topic, files: x.files })),
        files: filesOf(s.id, d.files).slice(0, 8).map((f) => ({ title: f.title, kind: f.kind, at: f.at.slice(0, 10), path: f.path, ...(f.note ? { note: f.note } : {}) })),
      } };
    },
  },
  {
    name: 'get_learning_map', description: '学生的学习地图：每个知识点标的是未学 / 在学 / 已掌握 / 薄弱，以及课堂作答算出的掌握度和「按作答该怎么改」的建议。班组会列出每位成员',
    params: { student: P('string', '学生姓名或 id；不填 = 当前学生'), all: P('boolean', 'true 把「未学」且没作答过的知识点也列出来（很长）') },
    run(a) {
      const s = studentOf(a.student), people = isGroup(s) ? membersOf(s, S().students) : [s], d = D();
      return { text: people.map((p) => {
        const subject = studentSubject(p), pack = packOf(subject), grid = fullGrid(pack, S().learning[mapKey(p.id, subject)]), ms = mastery(p.id, d, subject);
        const plan = planMap(pack, grid, ms), counts: Record<string, number> = {};
        const points = pack.chapters.flatMap((c, ci) => c.sec.map((sec, si) => {
          const key = pointKey(pack, ci, si), st = grid[ci][si], m = ms.get(key);
          counts[STATE_NAME[st]] = (counts[STATE_NAME[st]] ?? 0) + 1;
          return st === 'none' && !m && a.all !== true ? null : { key, point: `${c.book} · ${c.ch} · ${sec}`, state: STATE_NAME[st], ...(m ? { mastery: Math.round(m.score * 100) + '%', attempts: m.n } : {}) };
        })).filter(Boolean);
        return { student: p.name, subject: pack.stage, counts, points, suggestions: [...plan.apply, ...plan.suggest].map((c) => ({ key: c.key, point: pointLabel(c.key), from: STATE_NAME[c.from], to: STATE_NAME[c.to] })) };
      }) };
    },
  },
  {
    name: 'set_map_state', description: '改学习地图上知识点的状态。老师说「这几节讲完了」「这个已经掌握」「把 xx 标成薄弱」时用；班组给每位成员都改。只按作答更新时用 apply_map_suggestions', write: true,
    params: {
      student: P('string', '学生姓名或 id；不填 = 当前学生'), points: P('array', '知识点 key（get_learning_map 里的）或名字，最多 30 个', { items: { type: 'string' } }),
      state: P('string', 'none=未学，learning=在学，done=已掌握，weak=薄弱', { enum: ['none', 'learning', 'done', 'weak'] }),
    },
    required: ['points', 'state'],
    run(a) {
      const s = studentOf(a.student), people = isGroup(s) ? membersOf(s, S().students) : [s];
      const to = (['none', 'learning', 'done', 'weak'] as ChapterState[]).find((x) => x === a.state);
      if (!to) throw Error('state 只能是 none / learning / done / weak');
      const lines: string[] = [];
      for (const p of people) {
        const subject = studentSubject(p), keys = [...new Set(list(a.points).slice(0, 30).flatMap((x) => pointsFrom([x], subject)))];
        if (!keys.length) throw Error('没找到这些知识点，先用 get_learning_map 看看 key');
        const run = setMapStates(p.id, keys, to, '小羽改的');
        lines.push(`${p.name}：${run ? run.changes.map(changeText).join('、') : `已经都是「${STATE_NAME[to]}」`}`);
      }
      return { text: { ok: true, changed: lines }, card: { title: '改了学习地图', lines } };
    },
  },
  {
    name: 'apply_map_suggestions', description: '按课堂作答把学习地图一次更新到位（和学生页「按作答更新地图」按钮一样，包括标薄弱）。只在老师要求时用；下课时软件会自动做只往前推的那部分', write: true,
    params: { student: P('string', '学生姓名或 id；不填 = 当前学生') },
    run(a) {
      const s = studentOf(a.student), people = isGroup(s) ? membersOf(s, S().students) : [s], d = D(), lines: string[] = [];
      for (const p of people) {
        const subject = studentSubject(p), pack = packOf(subject), grid = fullGrid(pack, S().learning[mapKey(p.id, subject)]);
        const plan = planMap(pack, grid, mastery(p.id, d, subject)), all = [...plan.apply, ...plan.suggest];
        if (!all.length) { lines.push(`${p.name}：不用改`); continue; }
        for (const st of ['learning', 'done', 'weak'] as ChapterState[]) { const keys = all.filter((c) => c.to === st).map((c) => c.key); if (keys.length) setMapStates(p.id, keys, st, '小羽按作答更新'); }
        lines.push(`${p.name}：${all.slice(0, 6).map(changeText).join('、')}${all.length > 6 ? ` 等 ${all.length} 处` : ''}`);
      }
      return { text: { ok: true, changed: lines }, card: { title: '按作答更新了学习地图', lines } };
    },
  },
  {
    name: 'list_recordings', description: '最近的课堂录像：哪天、哪个学生、多长、课堂时间线（换课件 / 翻页 / 记作答）、AI 分析过没有和分析结论',
    params: { student: P('string', '只看这位学生（姓名或 id）；不填 = 全部'), limit: P('integer', '最多几段，默认 8', { minimum: 1, maximum: 30 }), timeline: P('boolean', 'true 带上每段的课堂时间线') },
    async run(a) {
      const s = has(a.student) ? studentOf(a.student) : undefined;
      const rows = (await host.call<RecordRow[]>('recordings')).filter((r) => !s || r.studentId === s.id);
      return { text: { total: rows.length, recordings: rows.slice(0, int(a.limit, 1, 30, 8)).map((r) => ({
        id: r.id, at: r.createdAt.slice(0, 16).replace('T', ' '), title: r.title ?? '', student: who(r.studentId ?? ''), minutes: r.startedAt && r.endedAt ? Math.round((r.endedAt - r.startedAt) / 60000) : null, phase: r.phase,
        ...(a.timeline === true && r.chapters?.length ? { timeline: r.chapters.slice(0, 120).map((c) => `${fmtT(c.t)} ${c.title}`) } : {}),
        analysis: r.analysis ? (r.analysis.error ? { error: r.analysis.error } : { questions: r.analysis.questions, attempts: r.analysis.attempts, map: r.analysis.map, summary: clip(r.analysis.summary, 400), weak: r.analysis.weak.map(pointLabel), ...(r.analysis.voice ? { heard_lines: r.analysis.voice, pending: r.analysis.pending ?? 0 } : {}), ...(r.analysis.fineSkip ? { no_voice: r.analysis.fineSkip } : {}) }) : null,
        transcript: r.transcript?.phase === 'done' ? `${r.transcript.count ?? 0} 句` : r.transcript?.phase ?? null,
      })) } };
    },
  },
  {
    name: 'analyze_recording', description: '让 AI 看一遍某段课堂录像（按时间线截十来张画面），有课堂原话时再听一遍逐题判断几成把握：认出的题进收件箱，把握大的记作答，拿不准的进「待确认」，学习地图往前推，课堂精析记进档案。回放生成后软件默认会自动做；老师要求重新分析或补分析时用。会花 AI 用量', write: true,
    params: { id: P('string', '录像 id（list_recordings 里的）') }, required: ['id'],
    async run(a) {
      const rec = await analyzeRecording(str(a.id, 80));
      return rec ? { text: { ok: true, lines: rec.lines, undo: '老师可以在「课堂回放」里整批撤销' }, card: { title: '分析了课堂录像', lines: rec.lines } } : { text: { ok: true, lines: ['没看到能记下来的题目或小结'] } };
    },
  },
  {
    name: 'search_transcript', description: '搜课堂原话（下课后本地语音转写的文字）：按关键词、学生、谁说的、最近几天找。老师问「小王上周哪里没听懂」「我讲过 xx 没有」时用；返回日期、录像、第几分钟、谁说的和原话',
    params: {
      q: P('string', '关键词，几个词用空格隔开（都出现才算）'), student: P('string', '只看这位学生的课（姓名或 id）'),
      who: P('string', 'student=学生说的，teacher=老师说的，all=都要（默认）', { enum: ['student', 'teacher', 'all'] }),
      days: P('integer', '最近几天，默认 30', { minimum: 1, maximum: 365 }), limit: P('integer', '最多几句，默认 30', { minimum: 1, maximum: 100 }),
    }, required: ['q'],
    async run(a) {
      const s = has(a.student) ? studentOf(a.student) : undefined, q = str(a.q, 100);
      if (!q) throw Error('要给关键词 q');
      const since = Date.now() - int(a.days, 1, 365, 30) * 864e5, side = a.who === 'student' || a.who === 'teacher' ? a.who : null;
      const hits = (await asrApi.search(q, s?.id)).filter((h) => Date.parse(h.createdAt) >= since && (!side || h.who === side));
      const n = int(a.limit, 1, 100, 30);
      return { text: { total: hits.length, ...(hits.length ? {} : { hint: '转写过的课里没有这句话。只有开了「课后语音转写」以后录的课才有原话' }), lines: hits.slice(0, n).map((h) => ({
        date: h.createdAt.slice(0, 10), recording: h.id, title: h.title ?? '', student: h.studentId ? who(h.studentId) : '', at: fmtT(h.t0), who: h.who === 'teacher' ? '老师' : h.who === 'student' ? '学生' : '', text: h.text,
      })) } };
    },
  },
  {
    name: 'lesson_evidence', description: '某个知识点在这位学生的历次课上的表现：课后精析记下的每次作答（几成把握、自己做 / 提示下做、误区、学生原话和录像时间）和还在「待确认」的判断。老师问「他追及问题掌握得怎么样、哪节课卡住的」时用',
    params: { student: P('string', '学生（姓名或 id）'), point: P('string', '知识点名称或 key'), limit: P('integer', '最多几条，默认 12', { minimum: 1, maximum: 40 }) }, required: ['student', 'point'],
    run(a) {
      const s = studentOf(a.student), subject = studentSubject(s), keys = pointsFrom([a.point], subject);
      if (!keys.length) throw Error('没找到这个知识点：' + str(a.point, 40) + '。可以先用 list_points 查');
      const d = D(), qs = new Map(d.questions.map((q) => [q.id, q])), ids = new Set([s.id, ...(isGroup(s) ? membersOf(s, S().students).map((m) => m.id) : [])]);
      const onPoint = (qid: string) => !!qs.get(qid)?.points.some((k) => keys.includes(k));
      const rows = d.attempts.filter((x) => ids.has(x.studentId) && onPoint(x.questionId)).sort((x, y) => y.at.localeCompare(x.at)).slice(0, int(a.limit, 1, 40, 12)).map((x) => ({
        date: x.at.slice(0, 16).replace('T', ' '), student: who(x.studentId), result: RESULT_NAME[x.result], ...(typeof x.level === 'number' ? { level: levelText(x.level) } : {}),
        ...(x.mode ? { how: MODE_NAME[x.mode] } : {}), ...(x.hints ? { hints: x.hints } : {}), ...(x.misconception ? { misconception: x.misconception } : {}),
        question: clip(qs.get(x.questionId)?.stem, 80), ...(x.evidence?.length ? { evidence: x.evidence.map((e) => `${fmtT(e.t)} ${e.who === 'teacher' ? '老师' : e.who === 'student' ? '学生' : ''}：${e.text}`) } : {}),
        ...(x.recordId ? { recording: x.recordId } : {}), via: x.via === 'replay' ? 'AI 听录像记的' : '老师记的',
      }));
      const pending = (d.sorts ?? []).filter((r) => !r.undone && r.recordId).flatMap((r) => r.unsure.filter((u) => ids.has(u.studentId) && onPoint(u.questionId)).map((u) => ({
        recording: r.recordId, question: clip(qs.get(u.questionId)?.stem, 80), ai: `${u.result ? RESULT_NAME[u.result] : ''}${typeof u.level === 'number' ? ' · ' + levelText(u.level) : ''}`, why: u.why ?? '', evidence: (u.evidence ?? []).map((e) => `${fmtT(e.t)} ${e.text}`),
      })));
      const m = mastery(s.id, d, subject);
      return { text: { student: s.name, points: keys.map((k) => ({ point: pointLabel(k), ...(m.get(k) ? { now: levelText(m.get(k)!.level), attempts: m.get(k)!.n } : { now: '还没有作答' }) })), history: rows, ...(pending.length ? { pending, pending_hint: '这几条 AI 拿不准，老师在「课堂回放」里确认后才算数' } : {}) } };
    },
  },
  {
    name: 'add_student', description: '添加一位学生档案', write: true,
    params: {
      name: P('string', '姓名'), grade: P('string', '年级：一年级…六年级、初一…初三、高一…高三'),
      subject: P('string', '学科 id 或名称，例如 physics / 高中物理 / 初中数学。可选：' + SUBJECTS.map((p) => p.id + '=' + p.stage).join('，')),
      textbook: P('string', '教材版本，不填用该学科默认教材'), tags: P('array', '标签', { items: { type: 'string' } }), last_topic: P('string', '上次讲到 / 教学提醒'),
      allow_duplicate: P('boolean', '已有同名学生时仍然添加'),
    },
    required: ['name'],
    run(a) {
      const name = str(a.name, 60); if (!name) throw Error('缺少姓名');
      const grade = str(a.grade, 10) || '高一', subject = subjectFrom(a.subject, grade);
      const same = live().find((s) => s.name === name);
      if (same && a.allow_duplicate !== true) throw Error(`已经有一位叫「${name}」的学生（${same.grade}，id=${same.id}）。确实是另一位就传 allow_duplicate=true`);
      const s = makeStudent(name, grade, subject, { textbook: str(a.textbook, 40) || packOf(subject).textbook, tags: list(a.tags).slice(0, 8), lastTopic: str(a.last_topic, 80) });
      setStudents([...S().students, s]);
      return { text: { ok: true, student: stuJson(s) }, card: { title: '添加了学生', lines: [`${s.name} · ${s.grade} · ${packOf(subject).stage}`] } };
    },
  },
  {
    name: 'add_group', description: '建一个班组：一对二、小组课（一对多）、班课。成员是已有学生；名单里还没有档案的学生传 create_missing=true 会一起建上。之后排课、上课、记作答、写课后总结都可以直接用班组', write: true,
    params: {
      name: P('string', '班组名，例如 初二(3)班、周六物理小组；不填按成员名字起'), kind: P('string', GROUP_KINDS.map((k) => `${k.id}=${k.name}`).join('，') + '；不填按人数定', { enum: GROUP_KINDS.map((k) => k.id) }),
      members: P('array', '成员姓名或 id', { items: { type: 'string' } }), create_missing: P('boolean', '名单里没有档案的学生自动新建'),
      grade: P('string', '年级（不填跟第一位成员）'), subject: P('string', '学科 id 或名称（不填跟第一位成员）'),
    },
    required: ['members'],
    run(a) {
      const kind = GROUP_KINDS.some((k) => k.id === a.kind) ? (a.kind as GroupKind) : undefined;
      const grade0 = str(a.grade, 10), made: Student[] = [];
      const ids = membersFrom(a.members, { create: a.create_missing === true, grade: grade0 || '高一', subject: subjectFrom(a.subject, grade0 || '高一'), made });
      if (ids.length < 2 && !(kind === 'class' && has(a.name))) throw Error('班组至少要两位学生（班课可以先只写班名，之后再加成员）');
      const pool = [...S().students, ...made];
      const same = ids.length >= 2 ? findGroupFor(ids, pool) : undefined;
      if (same) throw Error(`已经有这几个人的班组「${same.name}」（id=${same.id}），直接用它就行`);
      let g = makeGroup({ name: str(a.name, 60), kind, members: ids }, pool);
      if (grade0 || has(a.subject)) { const grade = grade0 || g.grade, subject = has(a.subject) ? subjectFrom(a.subject, grade) : studentSubject(g); g = { ...g, grade, subject, textbook: packOf(subject).textbook }; }
      setStudents([...pool, g]);
      return { text: { ok: true, group: stuJson(g), ...(made.length ? { created_students: made.map((s) => s.name) } : {}) }, card: { title: '建了班组', lines: [whoText(g, S().students), ...(made.length ? ['新建学生：' + made.map((s) => s.name).join('、')] : [])] } };
    },
  },
  {
    name: 'update_group', description: '改班组：改名、改类型、加 / 减成员。改年级学科、归档用 update_student', write: true,
    params: {
      group: P('string', '班组名或 id'), name: P('string', '新名字'), kind: P('string', '类型', { enum: GROUP_KINDS.map((k) => k.id) }),
      add_members: P('array', '加入的学生', { items: { type: 'string' } }), remove_members: P('array', '移出的学生', { items: { type: 'string' } }), create_missing: P('boolean', '加入的学生没有档案时自动新建'),
    },
    required: ['group'],
    run(a) {
      const old = pickStudent(S().students, a.group, { archived: true });
      if (!isGroup(old)) throw Error(`「${old.name}」是一位学生，不是班组`);
      const made: Student[] = [];
      const add = membersFrom(a.add_members, { create: a.create_missing === true, grade: old.grade, subject: studentSubject(old), made });
      const out = new Set(membersFrom(a.remove_members, { create: false, grade: old.grade, subject: studentSubject(old), made }));
      const members = [...new Set([...(old.members ?? []), ...add])].filter((id) => !out.has(id));
      const g: Student = { ...old, ...(has(a.name) ? { name: str(a.name, 60) } : {}), ...(GROUP_KINDS.some((k) => k.id === a.kind) ? { kind: a.kind as GroupKind } : {}), members };
      setStudents([...S().students.map((x) => (x.id === g.id ? g : x)), ...made]);
      return { text: { ok: true, group: stuJson(g) }, card: { title: '修改了班组', lines: [whoText(g, S().students)] } };
    },
  },
  {
    name: 'update_student', description: '修改学生资料，或归档 / 恢复学生（归档后资料和录像都保留）', write: true,
    params: {
      student: P('string', '学生姓名或 id'), name: P('string', '新姓名'), grade: P('string', '年级'), subject: P('string', '学科 id 或名称'), textbook: P('string', '教材版本'),
      tags: P('array', '标签（整组替换）', { items: { type: 'string' } }), last_topic: P('string', '上次讲到 / 教学提醒'), archived: P('boolean', 'true 归档，false 恢复'),
    },
    required: ['student'],
    run(a) {
      const old = pickStudent(S().students, a.student, { archived: true });
      const grade = has(a.grade) ? str(a.grade, 10) : old.grade;
      const s: Student = { ...old, ...(has(a.name) ? { name: str(a.name, 60) } : {}), grade, ...(has(a.subject) ? { subject: subjectFrom(a.subject, grade) } : {}), ...(has(a.textbook) ? { textbook: str(a.textbook, 40) } : {}), ...(a.tags !== undefined ? { tags: list(a.tags).slice(0, 8) } : {}), ...(has(a.last_topic) ? { lastTopic: str(a.last_topic, 80) } : {}), ...(typeof a.archived === 'boolean' ? { archived: a.archived } : {}) };
      setStudents(S().students.map((x) => (x.id === s.id ? s : x)));
      const what = typeof a.archived === 'boolean' && a.archived !== !!old.archived ? (a.archived ? '归档了学生' : '恢复了学生') : '修改了学生资料';
      return { text: { ok: true, student: stuJson(s) }, card: { title: what, lines: [`${s.name} · ${s.grade} · ${packOf(studentSubject(s)).stage}`] } };
    },
  },
  {
    name: 'add_student_note', description: '给学生记一条资料：家长沟通（聊天记录要点）、家长要求、老师备注。备课和写总结时会参考', write: true,
    params: { student: P('string', '学生姓名或 id；不填 = 当前学生'), kind: P('string', 'parent=家长沟通，requirement=家长要求，teacher=老师备注', { enum: ['parent', 'requirement', 'teacher'] }), text: P('string', '内容') },
    required: ['text'],
    run(a) {
      const s = studentOf(a.student), text = str(a.text, 20000); if (!text) throw Error('内容是空的');
      const kind = a.kind === 'parent' || a.kind === 'requirement' ? a.kind : 'teacher';
      addNote({ studentId: s.id, kind, text, source: 'AI 助教' });
      return { text: { ok: true }, card: { title: '记下了学生资料', lines: [`${s.name}：${clip(text, 60)}`] } };
    },
  },
  {
    name: 'link_file_to_student', description: '把文件归到学生名下：学生页「学生资料」和左侧资料库「学生档案」书架里都能看到、点开。你给某位学生做了教案、讲义、练习、报告等文件（包括在工作目录里自己写的），做完一定要调用这个；老师给的这位学生的资料也可以归进来', write: true,
    params: {
      student: P('string', '学生姓名或 id；不填 = 当前学生'), paths: P('array', '文件完整路径', { items: { type: 'string' } }),
      kind: P('string', 'prep=教案 / 备课资料，doc=其他资料（讲义、练习、报告、试卷）', { enum: ['prep', 'doc'] }), note: P('string', '一句话说明，例如「10/29 期中冲刺教案」'),
    },
    required: ['paths'],
    async run(a) {
      const s = studentOf(a.student), paths = list(a.paths).map((p) => str(p, 600).replace(/\\/g, '/'));
      if (!paths.length) throw Error('没有给文件路径');
      const ok: string[] = [], bad: string[] = [];
      // 工作目录、学情库里的文件和老师同意过的文件才能归档（exists 对没授权的路径也返回 false）
      for (const p of paths) (await host.call<boolean>('exists', p).catch(() => false) ? ok : bad).push(p);
      if (!ok.length) throw Error('这些文件不存在，或老师还没同意给你看（先用 request_computer_access）：' + bad.join('；'));
      const made = linkFiles(s.id, ok, { kind: a.kind === 'prep' ? 'prep' : 'doc', via: 'assistant', note: str(a.note, 120) || undefined });
      return { text: { ok: true, linked: made.length, already: ok.length - made.length, ...(bad.length ? { missing: bad } : {}) }, card: { title: `归到了「${s.name}」名下`, files: ok } };
    },
  },
  // ── 课表 ──
  {
    name: 'list_lessons', description: '查课表：从某天起若干天里的每一节课（每周重复的课会展开成每一次）。返回的 id 用来改课 / 删课',
    params: { from: P('string', '起始日期 YYYY-MM-DD，不填 = 今天'), days: P('integer', '查几天，默认 7，最多 62', { minimum: 1, maximum: 62 }), student: P('string', '只看某位学生（姓名或 id）') },
    run(a) {
      const from = has(a.from) ? new Date(day(a.from) + 'T00:00') : new Date(), days = int(a.days, 1, 62, 7);
      const s = has(a.student) ? pickStudent(S().students, a.student) : undefined;
      const out = occurrences(S().slots, S().students, from, days, s?.id);
      return { text: out.length ? out : `${dateKey(from)} 起 ${days} 天里没有课` };
    },
  },
  {
    name: 'add_lesson', description: '排一节课（可每周重复）。时间撞了会报错并告诉你撞了哪节。一对二 / 小组课在 student 里写几个人的名字（「俊宇、欣怡」），会用这几个人的班组，还没有就自动建一个', write: true,
    params: {
      student: P('string', '学生或班组的姓名 / id；几个人一起上写「名、名」'), date: P('string', '上课日期 YYYY-MM-DD（每周重复的课填第一次的日期）'), start: P('string', '开始时间 HH:MM，24 小时制'),
      minutes: P('integer', '时长（分钟），默认 60'), end: P('string', '或者给结束时间 HH:MM'), topic: P('string', '课程内容 / 主题'), repeat_weekly: P('boolean', '每周这个时间都上'),
      allow_overlap: P('boolean', '老师明确说可以和别的课重叠时才传 true'),
    },
    required: ['student', 'date', 'start'],
    run(a) {
      const w = lessonWho(a.student), pool = w.fresh ? [...S().students, w.fresh] : S().students;
      const slot = lessonFrom({ ...a, student: w.id, minutes: has(a.minutes) || has(a.end) ? a.minutes : 60 }, pool.filter((s) => !s.archived));
      if (a.allow_overlap !== true) checkClash(slot, S().slots, pool);
      if (w.fresh) setStudents(pool);
      setSlots([...S().slots, slot]);
      return { text: { ok: true, id: slot.id, lesson: lessonText(slot, S().students), ...(w.fresh ? { created_group: stuJson(w.fresh) } : {}) }, card: { title: '排了一节课', lines: [lessonText(slot, S().students), ...(w.fresh ? ['新建班组：' + whoText(w.fresh, S().students)] : [])] } };
    },
  },
  {
    name: 'update_lesson', description: '调课 / 改课：改日期、时间、时长、内容、学生、是否每周重复。只传要改的字段', write: true,
    params: {
      id: P('string', '课的 id（list_lessons 返回的）'), student: P('string', '换学生或班组（几个人一起写「名、名」）'), date: P('string', '新日期 YYYY-MM-DD'), start: P('string', '新开始时间 HH:MM'),
      minutes: P('integer', '新时长（分钟）'), end: P('string', '新结束时间 HH:MM'), topic: P('string', '新内容'), repeat_weekly: P('boolean', '是否每周重复'), allow_overlap: P('boolean', '允许和别的课重叠'),
    },
    required: ['id'],
    run(a) {
      const w = has(a.student) ? lessonWho(a.student) : { id: a.student }, pool = w.fresh ? [...S().students, w.fresh] : S().students;
      const old = findSlot(a.id), next = lessonFrom({ ...a, student: w.id }, pool.filter((s) => !s.archived), old);
      if (a.allow_overlap !== true) checkClash(next, S().slots.filter((x) => x.id !== old.id), pool);
      if (w.fresh) setStudents(pool);
      setSlots(S().slots.map((x) => (x.id === old.id ? next : x)));
      return { text: { ok: true, before: lessonText(old, S().students), after: lessonText(next, S().students) }, card: { title: '调整了课程', lines: [lessonText(old, S().students) + ' → ' + lessonText(next, S().students)] } };
    },
  },
  {
    name: 'delete_lesson', description: '删除一节课（每周重复的课会整组删掉）。会弹确认框请老师点', write: true,
    params: { id: P('string', '课的 id') }, required: ['id'],
    async run(a, c) {
      const s = findSlot(a.id), text = lessonText(s, S().students);
      if (!(await c.confirm({ title: '删除这节课？', detail: text + (s.repeat ? '\n这是每周重复的课，会整组删掉。' : ''), yes: '删除' }))) return { ok: false, text: '老师没有同意删除' };
      setSlots(S().slots.filter((x) => x.id !== s.id));
      return { text: { ok: true, deleted: text }, card: { title: '删除了课程', lines: [text], tone: 'warn' } };
    },
  },
  // ── 题库 / 作答 ──
  {
    name: 'search_questions', description: '在题库里找题：按文字、知识点、学科、状态找；student + wrong_only 查这位学生的错题',
    params: {
      text: P('string', '题干里的文字'), points: P('array', '知识点名称或 key', { items: { type: 'string' } }), subject: P('string', '学科 id 或名称'),
      student: P('string', '学生（按他的学科找；配合 wrong_only）'), wrong_only: P('boolean', '只看这位学生做错、还没订正的题'),
      status: P('string', 'bank=题库，inbox=收件箱，all=全部（默认 bank）', { enum: ['bank', 'inbox', 'all'] }), limit: P('integer', '最多几道，默认 10', { minimum: 1, maximum: 40 }),
    },
    run(a) {
      const s = has(a.student) ? studentOf(a.student) : undefined;
      const subject = has(a.subject) ? subjectFrom(a.subject, s?.grade) : s ? studentSubject(s) : undefined;
      let pool: Question[] = s && a.wrong_only === true ? wrongBook(s.id, D()).filter((w) => w.status === 'open').map((w) => w.q) : D().questions;
      const status = a.status === 'inbox' || a.status === 'all' ? a.status : 'bank';
      if (status !== 'all' && !(s && a.wrong_only)) pool = pool.filter((q) => q.status === status);
      if (subject) pool = pool.filter((q) => questionSubject(q) === subject);
      const pts = subject && has(a.points) ? pointsFrom(a.points, subject) : [];
      if (pts.length) pool = pool.filter((q) => q.points.some((k) => pts.includes(k)));
      const text = str(a.text, 200);
      let ranked = pool;
      if (text) ranked = pool.map((q) => ({ q, v: (q.stem + (q.source ?? '')).includes(text) ? 2 : similarity(text, q.stem) })).filter((x) => x.v > 0.3).sort((x, y) => y.v - x.v).map((x) => x.q);
      const n = int(a.limit, 1, 40, 10);
      return { text: { total: ranked.length, ...(pts.length ? { points: pts.map(pointLabel) } : {}), questions: ranked.slice(0, n).map((q) => qJson(q)) } };
    },
  },
  {
    name: 'get_question', description: '看一道题的全部内容（题干、答案、解析、知识点），有题图时附上图片',
    params: { id: P('string', '题目 id') }, required: ['id'],
    async run(a) {
      const q = findQ(a.id);
      const img = q.image ? await host.call<string>('study.imageData', q.image).catch(() => '') : '';
      return { text: qJson(q, true), images: img ? [img] : [] };
    },
  },
  {
    name: 'add_question', description: '往题库加一道题（你自己出的题、老师口述的题）。题干和答案里的公式用 $…$ 写 LaTeX', write: true,
    params: {
      stem: P('string', '题干'), answer: P('string', '答案'), analysis: P('string', '解析'), points: P('array', '知识点名称或 key（不填按题干自动判断）', { items: { type: 'string' } }),
      difficulty: P('integer', '难度 1 基础 … 5 压轴，默认 3', { minimum: 1, maximum: 5 }), qtype: P('string', '题型，如 选择 / 填空 / 计算'), subject: P('string', '学科 id 或名称；不填按学生 / 当前学生'),
      student: P('string', '给哪位学生出的（决定学科）'), to_inbox: P('boolean', '先放收件箱待老师核对（没把握时用）'), allow_duplicate: P('boolean', '题库里有相似题也照样加'),
    },
    required: ['stem'],
    run(a) {
      const stem = str(a.stem, 6000); if (!stem) throw Error('题干是空的');
      const s = has(a.student) ? studentOf(a.student) : S().students.find((x) => x.id === S().studentId);
      const subject = has(a.subject) ? subjectFrom(a.subject, s?.grade) : studentSubject(s);
      const dup = findDuplicate(stem, D().questions.filter((q) => q.status === 'bank'));
      if (dup && a.allow_duplicate !== true) throw Error(`题库里已有相似的题（相似度 ${Math.round(dup.sim * 100)}%，id=${dup.q.id}）：${clip(dup.q.stem, 60)}。确实要加就传 allow_duplicate=true`);
      const points = has(a.points) ? pointsFrom(a.points, subject) : guessPoints(stem, subject);
      const q = addQuestion({ stem, answer: str(a.answer, 4000), analysis: str(a.analysis, 6000), points, subject, difficulty: int(a.difficulty, 1, 5, 3), qtype: str(a.qtype, 10) || packOf(subject).guessType(stem), origin: 'ai', status: a.to_inbox === true ? 'inbox' : 'bank', source: 'AI 助教' });
      return { text: { ok: true, question: qJson(q) }, card: { title: a.to_inbox === true ? '题目放进了收件箱' : '加了一道题', lines: [clip(stem, 70)] } };
    },
  },
  {
    name: 'update_question', description: '修改一道题：题干、答案、解析、知识点、难度、题型，或在收件箱 / 题库之间移动', write: true,
    params: {
      id: P('string', '题目 id'), stem: P('string', '题干'), answer: P('string', '答案'), analysis: P('string', '解析'), points: P('array', '知识点（整组替换）', { items: { type: 'string' } }),
      difficulty: P('integer', '难度 1-5', { minimum: 1, maximum: 5 }), qtype: P('string', '题型'), status: P('string', 'bank 放进题库 / inbox 退回收件箱', { enum: ['bank', 'inbox'] }),
    },
    required: ['id'],
    run(a) {
      const q = findQ(a.id), subject = questionSubject(q);
      const p: Partial<Question> = { ...(has(a.stem) ? { stem: str(a.stem, 6000) } : {}), ...(a.answer !== undefined ? { answer: str(a.answer, 4000) } : {}), ...(a.analysis !== undefined ? { analysis: str(a.analysis, 6000) } : {}), ...(a.points !== undefined ? { points: pointsFrom(a.points, subject) } : {}), ...(has(a.difficulty) ? { difficulty: int(a.difficulty, 1, 5, q.difficulty) } : {}), ...(has(a.qtype) ? { qtype: str(a.qtype, 10) } : {}), ...(a.status === 'bank' || a.status === 'inbox' ? { status: a.status } : {}) };
      patchQuestion(q.id, p);
      return { text: { ok: true, question: qJson(findQ(q.id)) }, card: { title: '修改了题目', lines: [clip(findQ(q.id).stem, 70) || '（题图）'] } };
    },
  },
  {
    name: 'delete_questions', description: '删除题目（连同作答记录）。会弹确认框请老师点', write: true,
    params: { ids: P('array', '题目 id 列表', { items: { type: 'string' } }) }, required: ['ids'],
    async run(a, c) {
      const ids = list(a.ids), qs = D().questions.filter((q) => ids.includes(q.id));
      if (!qs.length) throw Error('没有找到这些题');
      const n = D().attempts.filter((x) => ids.includes(x.questionId)).length;
      if (!(await c.confirm({ title: `删除 ${qs.length} 道题？`, detail: qs.slice(0, 5).map((q) => '· ' + (clip(q.stem, 50) || '（题图）')).join('\n') + (qs.length > 5 ? `\n…等 ${qs.length} 道` : '') + (n ? `\n连同 ${n} 条作答记录` : ''), yes: '删除' }))) return { ok: false, text: '老师没有同意删除' };
      const r = removeQuestions(qs.map((q) => q.id));
      return { text: { ok: true, deleted: r.questions.length, attempts: r.attempts.length }, card: { title: `删除了 ${r.questions.length} 道题`, tone: 'warn' } };
    },
  },
  {
    name: 'record_attempt', description: '记一次作答：某学生某道题做对 / 做错 / 半对。会进错题本和掌握度。student 是班组时给全组每人都记同一个结果；几个人结果不同就分开调用，或用 students 列出这次要记的人', write: true,
    params: {
      student: P('string', '学生或班组；不填 = 当前学生 / 班组'), students: P('array', '这几位学生都记这个结果（姓名或 id）', { items: { type: 'string' } }),
      question: P('string', '题目 id'), result: P('string', 'right / wrong / half', { enum: ['right', 'wrong', 'half'] }), note: P('string', '备注（错因等）'),
    },
    required: ['question', 'result'],
    run(a) {
      const q = findQ(a.question), r = (['right', 'wrong', 'half'].includes(String(a.result)) ? a.result : 'wrong') as Result;
      const people = has(a.students) ? [...new Map(list(a.students).map((n) => pickStudent(individuals(S().students), n)).map((s) => [s.id, s])).values()] : peopleOf(studentOf(a.student).id, S().students);
      if (!people.length) throw Error('这个班组还没有成员，先用 update_group 加人');
      for (const s of people) recordAttempt(s.id, q.id, r, str(a.note, 300) || undefined);
      return { text: { ok: true, students: people.map((s) => s.name) }, card: { title: '记了作答', lines: [`${people.map((s) => s.name).join('、')}：${RESULT_NAME[r]} · ${clip(q.stem, 40) || '（题图）'}`] } };
    },
  },
  {
    name: 'look_at_screen', description: '看一眼学生画面（现在给学生显示的内容），返回截图。讲题、收题前先看',
    async run() { const img = await ai.screen(); return { text: '学生画面：' + S().pgmMat.title, images: [img] }; },
  },
  {
    name: 'capture_screen_question', description: '把学生画面上的这道题截图收进收件箱（后台自动识题）；给了 result 就同时记一次作答', write: true,
    params: { student: P('string', '学生；不填 = 当前学生'), result: P('string', '学生这道题的结果', { enum: ['right', 'wrong', 'half'] }) },
    async run(a) {
      const s = has(a.student) || a.result ? studentOf(a.student) : undefined;
      const r = a.result ? (a.result as Result) : undefined;
      // 班组：题收一次，每位成员各记一次
      const group = isGroup(s) ? membersOf(s, S().students) : null;
      const { q, reused } = await captureFromScreen({ result: group ? undefined : r, studentId: group ? undefined : s?.id });
      if (group && r) for (const m of group) recordAttempt(m.id, q.id, r);
      return { text: { ok: true, id: q.id, reused, ...(group && r ? { recorded_for: group.map((m) => m.name) } : {}) }, card: { title: reused ? '这一页刚收过，用同一道题' : '收了一道题到收件箱', lines: [S().pgmMat.title + (r ? ` · ${s?.name} ${RESULT_NAME[r]}` : '')] } };
    },
  },
  {
    name: 'wrong_book', description: '学生的错题本：还没订正的错题（错几次、最近哪天错的）。老师说某道错题已经讲过 / 订正了，用 record_attempt 给它记一次 right（note 写「已订正」），它就会变成已订正',
    params: { student: P('string', '学生；不填 = 当前学生'), include_fixed: P('boolean', '也列出已订正的'), limit: P('integer', '最多几道，默认 15', { minimum: 1, maximum: 50 }) },
    run(a) {
      const s = studentOf(a.student), all = wrongBook(s.id, D()).filter((w) => a.include_fixed === true || w.status === 'open');
      return { text: { student: s.name, total: all.length, items: all.slice(0, int(a.limit, 1, 50, 15)).map((w) => ({ ...qJson(w.q), wrong: w.wrongCount, last_wrong: w.lastWrong.slice(0, 10), fixed: w.status === 'fixed' })) } };
    },
  },
  {
    name: 'list_points', description: '查某学科的知识点（名称和 key），组卷、标知识点时用',
    params: { subject: P('string', '学科 id 或名称；不填 = 当前学生的学科'), text: P('string', '按名称筛选') },
    run(a) {
      const subject = has(a.subject) ? subjectFrom(a.subject) : studentSubject(S().students.find((x) => x.id === S().studentId));
      const t = str(a.text, 30), all = pointsOf(subject).filter((p) => !t || (p.ch + p.sec).includes(t));
      return { text: { subject: packOf(subject).stage, points: all.slice(0, 80).map((p) => `${p.key} ${p.ch}·${p.sec}`), more: Math.max(0, all.length - 80) } };
    },
  },
  // ── 课后、作业、备课、家长 ──
  {
    name: 'write_lesson_summary', description: '写课后总结和给家长的话（按这天的作答记录；配了 AI 用 AI 写，否则用模板），保存到学情 → 课后总结。export 可同时导出长图 / PDF / Word。student 是班组时给每位成员各写一份', write: true,
    params: {
      student: P('string', '学生或班组；不填 = 当前学生 / 班组'), date: P('string', '哪天的课 YYYY-MM-DD，默认今天'), topic: P('string', '这节课讲了什么'), minutes: P('integer', '上了多少分钟'),
      notes: P('string', '老师补充的课堂情况'), homework: P('string', '布置的作业'), export: P('array', '同时导出：png 长图 / pdf / docx', { items: { type: 'string', enum: ['png', 'pdf', 'docx'] } }),
    },
    async run(a) {
      const who = studentOf(a.student), date = has(a.date) ? day(a.date) : dayKey();
      const people = peopleOf(who.id, S().students);
      if (!people.length) throw Error('这个班组还没有成员，先用 update_group 加人');
      const formats = list(a.export).filter((f) => ['png', 'pdf', 'docx'].includes(f));
      const done: { note: LessonNote; name: string; files: string[]; warning?: string }[] = [];
      for (const s of people) {
        // 这天上的是班组课：总结记上班组，班组的课次也跟着算
        const slot = occurrences(S().slots, S().students, new Date(date + 'T00:00'), 1, isGroup(who) ? who.id : s.id)[0];
        const groupId = isGroup(who) ? who.id : slot && slot.studentId !== s.id ? slot.studentId : undefined;
        const old = D().lessons.filter((l) => l.studentId === s.id && l.date === date && (!groupId || l.groupId === groupId)).at(-1);
        const r = await buildLessonNote({ studentId: s.id, name: s.name, date, topic: str(a.topic, 80) || old?.topic || slot?.topic || who.lastTopic || s.lastTopic, minutes: has(a.minutes) ? int(a.minutes, 10, 600, 60) : slot?.minutes, notes: str(a.notes, 4000), homework: str(a.homework, 200) || old?.homework, id: old?.id, groupId });
        saveLesson(r.note);
        const files = formats.length ? (await lessonDocument(r.note, s.name, formats)).out : [];
        done.push({ note: r.note, name: s.name, files, warning: r.warning });
      }
      const files = done.flatMap((x) => x.files), warn = done.filter((x) => x.warning).map((x) => (people.length > 1 ? x.name + '：' : '') + x.warning);
      if (!isGroup(who)) return { text: { ok: true, ...noteJson(done[0].note), files, ...(warn.length ? { warning: warn[0] } : {}) }, card: { title: `写好了${who.name} ${date} 的课后总结`, lines: [clip(done[0].note.summary, 80)], files } };
      return { text: { ok: true, group: who.name, summaries: done.map((x) => ({ student: x.name, ...noteJson(x.note), files: x.files })), ...(warn.length ? { warnings: warn } : {}) }, card: { title: `写好了${who.name} ${date} 每人的课后总结`, lines: done.map((x) => `${x.name}：${clip(x.note.summary, 50)}`), files } };
    },
  },
  {
    name: 'edit_lesson_summary', description: '修改一份课后总结（例如把给家长的话改得更口语）。只传要改的字段', write: true,
    params: {
      id: P('string', '课后总结 id'), topic: P('string', '主题'), summary: P('string', '总结'), strengths: P('array', '做得好的', { items: { type: 'string' } }),
      problems: P('array', '问题', { items: { type: 'string' } }), next: P('array', '下一步', { items: { type: 'string' } }), parent: P('string', '给家长的话'), homework: P('string', '作业'),
    },
    required: ['id'],
    run(a) {
      const old = D().lessons.find((l) => l.id === str(a.id)); if (!old) throw Error('找不到这份课后总结');
      const n: LessonNote = { ...old, ...(has(a.topic) ? { topic: str(a.topic, 80) } : {}), ...(has(a.summary) ? { summary: str(a.summary, 4000) } : {}), ...(a.strengths !== undefined ? { strengths: list(a.strengths) } : {}), ...(a.problems !== undefined ? { problems: list(a.problems) } : {}), ...(a.next !== undefined ? { next: list(a.next) } : {}), ...(has(a.parent) ? { parent: str(a.parent, 4000) } : {}), ...(a.homework !== undefined ? { homework: str(a.homework, 200) } : {}) };
      saveLesson(n);
      return { text: { ok: true, ...noteJson(n) }, card: { title: '修改了课后总结', lines: [`${who(n.studentId)} ${n.date}`] } };
    },
  },
  {
    name: 'list_lesson_summaries', description: '查学生最近的课后总结（含给家长的话、是否已发送）。班组列出这个班组课上每位成员的',
    params: { student: P('string', '学生或班组；不填 = 当前学生'), limit: P('integer', '最多几份，默认 5', { minimum: 1, maximum: 20 }) },
    run(a) {
      const s = studentOf(a.student), g = isGroup(s);
      return { text: D().lessons.filter((l) => (g ? l.groupId === s.id : l.studentId === s.id)).sort((x, y) => y.at.localeCompare(x.at)).slice(0, int(a.limit, 1, 20, g ? 12 : 5)).map((l) => ({ ...(g ? { student: who(l.studentId) } : {}), ...noteJson(l) })) };
    },
  },
  {
    name: 'send_to_parent', description: '把课后总结发给家长：打开发送预览（企业微信群 / 邮件），老师看过点发送才发出去。没给 lesson_id 就用这位学生最近一份；student 是班组时依次打开每位成员最近一次班组课的总结',
    params: { lesson_id: P('string', '课后总结 id'), student: P('string', '学生或班组；不填 = 当前学生') },
    async run(a, c) {
      const latest = (pick: (l: LessonNote) => boolean) => D().lessons.filter(pick).sort((x, y) => y.at.localeCompare(x.at))[0];
      let todo: LessonNote[];
      if (has(a.lesson_id)) todo = D().lessons.filter((x) => x.id === str(a.lesson_id));
      else {
        const s = studentOf(a.student);
        if (isGroup(s)) {
          const last = latest((l) => l.groupId === s.id)?.date;
          todo = last ? membersOf(s, S().students).map((m) => latest((l) => l.studentId === m.id && l.groupId === s.id && l.date === last)).filter((l): l is LessonNote => !!l) : [];
        } else todo = [latest((x) => x.studentId === s.id)].filter((l): l is LessonNote => !!l);
      }
      if (!todo.length) throw Error('还没有课后总结，先用 write_lesson_summary 写一份');
      const lines: string[] = [], texts: string[] = [];
      for (const l of todo) {
        const s = S().students.find((x) => x.id === l.studentId);
        if (!s) { texts.push(`${l.date} 的总结：学生已经删除了`); continue; }
        const r = await c.sendParent({ lesson: l, student: s });
        const ok = r.filter((x) => x.ok);
        const head = todo.length > 1 ? s.name + '：' : '';
        texts.push(head + (ok.length ? `已发送：${ok.map((x) => (x.channel === 'wecom' ? '企业微信群' : '邮件 ' + x.to)).join('、')}` + (r.some((x) => !x.ok) ? `；失败：${r.filter((x) => !x.ok).map((x) => x.error).join('；')}` : '') : '老师关掉了发送预览，没有发送'));
        if (ok.length) lines.push(`${s.name} ${l.date} 的课后反馈`);
      }
      return { ok: true, text: texts.join('\n'), card: lines.length ? { title: '发给了家长', lines } : null };
    },
  },
  {
    name: 'make_homework', description: '组一份作业并导出 Word + PDF（答案另起一页）。给 question_ids 就用这些题；否则按知识点（不填 = 薄弱点）从题库挑，错题优先重做', write: true,
    params: {
      student: P('string', '学生；不填 = 当前学生'), question_ids: P('array', '指定题目 id', { items: { type: 'string' } }), points: P('array', '知识点名称或 key', { items: { type: 'string' } }),
      count: P('integer', '题数，默认 8', { minimum: 1, maximum: 30 }), min_difficulty: P('integer', '最低难度 1-5', { minimum: 1, maximum: 5 }), max_difficulty: P('integer', '最高难度 1-5', { minimum: 1, maximum: 5 }), title: P('string', '作业标题'),
    },
    async run(a) {
      const s = studentOf(a.student), subject = studentSubject(s);
      let qs: Question[], points: string[], why: string[] = [];
      if (has(a.question_ids)) { qs = list(a.question_ids).map(findQ); points = [...new Set(qs.flatMap((q) => q.points))]; }
      else {
        const r = pickHomework({ studentId: s.id, points: pointsFrom(a.points, subject), count: int(a.count, 1, 30, 8), minD: int(a.min_difficulty, 1, 5, 1), maxD: int(a.max_difficulty, 1, 5, 5), redo: 2, avoidDays: 14, subject }, D());
        if (!r.picked.length) throw Error('题库里没有合适的题。可以先用 add_question 出几道题，再组作业');
        qs = r.picked.map((p) => p.q); points = r.points; why = r.picked.map((p) => p.why);
      }
      const title = str(a.title, 60) || homeworkTitle(s.name, points);
      const out = await exportHomework({ studentId: s.id, name: s.name, title, questions: qs, points });
      if (!out.out.length) throw Error('导出失败：' + (out.errors[0] || '未知原因'));
      return { text: { ok: true, title, count: qs.length, questions: qs.map((q, i) => ({ id: q.id, why: why[i] ?? '', stem: clip(q.stem, 60) })), files: out.out, errors: out.errors }, card: { title: `组好了作业「${title}」`, lines: [`${qs.length} 道题`], files: out.out } };
    },
  },
  {
    name: 'prepare_lesson', description: '给一节课备课：在本地课件库和题库里找资料、写备课建议（配了 AI 用 AI），导出备课文档 Word + PDF。比较慢（半分钟到几分钟）', write: true,
    params: { student: P('string', '学生；不填 = 当前学生'), topic: P('string', '这节课讲什么'), date: P('string', '上课日期 YYYY-MM-DD，默认今天'), minutes: P('integer', '时长（分钟），默认 60'), lesson_id: P('string', '对应课表里的课 id（可选）') },
    required: ['topic'],
    async run(a) {
      const s = studentOf(a.student), slot = has(a.lesson_id) ? findSlot(a.lesson_id) : undefined;
      const p = await makePrep({ studentId: s.id, topic: str(a.topic, 80), date: has(a.date) ? day(a.date) : slot?.date ?? dayKey(), start: slot?.start, minutes: int(a.minutes, 10, 600, slot ? Math.round(slot.len * 60) : 60), slotId: slot?.id, auto: false });
      return { text: { ok: true, topic: p.topic, via: p.via, materials: p.materials, questions: p.questionIds.length, files: p.files, plan: clip(p.plan, 3000) }, card: { title: `备好了课：${s.name} ${p.topic}`, lines: [`本地课件 ${p.materials.length} 份，讲练题 ${p.questionIds.length} 道`], files: [...p.files, ...(p.courseware ?? [])] } };
    },
  },
  // ── 课件、页面、说明书 ──
  {
    name: 'search_library', description: '在老师的课件资料库里按名字找课件（支持拼音首字母）',
    params: { text: P('string', '关键词'), limit: P('integer', '最多几个，默认 10', { minimum: 1, maximum: 30 }) }, required: ['text'],
    run(a) {
      const lib = useLib.getState().lib; if (!lib) return { text: '资料库还没加载，或者老师还没添加课件目录' };
      const hit = searchLib(lib, str(a.text, 60), '', int(a.limit, 1, 30, 10));
      return { text: hit.length ? hit.map((f) => ({ path: f.path ?? f.id, title: f.title, kind: f.kind, folder: f.folder })) : '没有找到' };
    },
  },
  {
    name: 'open_material', description: '打开一份课件：teacher 只在老师这边的阅读器打开；preview 放到预监（老师确认后再切给学生）；student 直接显示给学生',
    params: { path: P('string', '课件路径（search_library 返回的）'), to: P('string', '打开到哪里，默认 teacher', { enum: ['teacher', 'preview', 'student'] }), page: P('integer', '第几页（从 1 起）') },
    required: ['path'],
    async run(a) {
      const p = str(a.path, 600), lib = useLib.getState().lib;
      const f = lib?.list.find((x) => x.path === p || x.id === p) ?? fileEntry(p);
      const to = a.to === 'student' ? 'student' : a.to === 'preview' ? 'cue' : 'teacher';
      S().set({ page: 'console' });
      const mat = await openMaterial(f, to, has(a.page) ? { page: int(a.page, 1, 9999, 1) - 1 } : undefined);
      if (!mat) throw Error('没有打开（文件可能已移动，或格式转换失败）');
      return { text: { ok: true, title: mat.title, pages: mat.pages.length }, card: { title: to === 'student' ? '给学生显示了课件' : to === 'cue' ? '课件放到了预监' : '打开了课件', lines: [mat.title] } };
    },
  },
  {
    name: 'navigate', description: '切换软件页面（也可同时切换当前学生、学情页的分页）',
    params: {
      page: P('string', Object.entries(PAGES).map(([k, v]) => `${k}=${v}`).join('，'), { enum: Object.keys(PAGES) }), student: P('string', '同时切换到这位学生'),
      study_tab: P('string', '学情页的分页：inbox 收件箱 / bank 题库 / wrong 错题本 / net 知识网络 / homework 组作业 / lesson 课后总结 / courseware 课件库 / skills 技能包', { enum: ['inbox', 'bank', 'wrong', 'net', 'homework', 'lesson', 'courseware', 'skills'] }),
    },
    required: ['page'],
    run(a) {
      const page = (String(a.page) in PAGES ? a.page : 'console') as Page;
      if (has(a.student)) S().set({ studentId: studentOf(a.student).id });
      if (page === 'study' && has(a.study_tab)) openStudy(a.study_tab as StudyTab); else S().set({ page });
      return { text: { ok: true, page: PAGES[page] } };
    },
  },
  {
    name: 'app_help', description: '查软件说明书：老师问「怎么用」「在哪里」时先查再回答',
    params: { query: P('string', '要查的功能或问题，例如 录课 / 浮层 / 导入题目') }, required: ['query'],
    run(a) {
      const terms = str(a.query, 60).split(/\s+/).filter(Boolean);
      const score = (c: (typeof MANUAL)[number]) => { const t = [c.title, c.scene, ...(c.steps ?? []), ...(c.tips ?? []), ...(c.table ?? []).flat()].join('\n'); return terms.reduce((n, w) => n + (c.title.includes(w) ? 5 : 0) + (t.split(w).length - 1), 0); };
      const hit = MANUAL.map((c) => ({ c, v: score(c) })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v).slice(0, 3);
      if (!hit.length) return { text: '说明书里没有找到。章节有：' + MANUAL.map((c) => c.title).join('、') };
      return { text: hit.map(({ c }) => `## ${c.title}\n${c.scene}\n${(c.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}${c.tips?.length ? '\n窍门：' + c.tips.join(' ') : ''}${c.table?.length ? '\n' + c.table.map(([k, v]) => `${k}：${v}`).join('\n') : ''}`).join('\n\n') };
    },
  },
  {
    name: 'sort_files', description: '把老师电脑上的一批文件（卷子照片、Word、PDF、聊天截图）交给「AI 整理」：自动拆题入库、批改、归到学生档案。默认在后台静默整理（不弹窗口、不打断老师），列好整理单后提醒老师确认；老师明确说「直接归档、不用确认」时 archive 设 true。整理结果可以在「整理记录」里整批撤销',
    params: {
      paths: P('array', '文件路径（必须是老师给你的或同意过的）', { items: { type: 'string' } }),
      student: P('string', '这些资料默认是谁的（学生名字）；不写用当前学生。AI 也会从内容里认名字'),
      archive: P('boolean', '列好整理单后直接归档，不等老师确认；默认 false'),
      show: P('boolean', '打开整理窗口给老师看（老师要求打开时才用）；默认 false，后台整理'),
    }, required: ['paths'],
    async run(a, c) {
      const ok = c.granted(), paths = list(a.paths).filter((p) => ok.some((g) => p.replace(/\\/g, '/').toLowerCase().startsWith(g.toLowerCase())));
      if (!paths.length) throw Error('这些文件老师还没有同意给你看，先用 request_computer_access');
      if (a.show === true) { openSort({ paths }); return { text: { ok: true, opened: paths.length }, card: { title: '打开了 AI 整理', lines: paths.slice(0, 4).map(fname) } }; }
      const sid0 = has(a.student) ? studentOf(a.student).id : undefined;
      const n = await sortInBackground(paths, { studentId: sid0, archive: a.archive === true });
      return {
        text: { ok: true, started: n, background: true, note: a.archive === true ? '正在后台整理，看完直接归档；顶栏「AI 整理」按钮显示进度，结果在「整理记录」里，可以整批撤销' : '正在后台整理；顶栏「AI 整理」按钮显示进度，列好整理单后会提醒老师确认归档。不用等它，继续做别的事' },
        card: { title: a.archive === true ? 'AI 整理在后台进行（完成后直接归档）' : 'AI 整理在后台进行（好了提醒你确认）', lines: paths.slice(0, 4).map(fname) },
      };
    },
  },
  // ── 提醒和定时任务 ──
  {
    name: 'list_triggers', description: '列出提醒和定时任务',
    run() { const all = useAssistantData.getState().triggers; return { text: all.length ? all.map((t) => triggerJson(t, S().students)) : '还没有提醒' }; },
  },
  {
    name: 'create_trigger', description: '建一个提醒或定时任务。例：每节课前 10 分钟提醒看错题；每周五 20:00 让助教给每位学生写周报草稿；导入题目时让助教检查知识点', write: true,
    params: { name: P('string', '名字（简短）'), when: P('object', WHEN_DESC), action: P('object', ACTION_DESC), times: P('string', TIMES_DESC) },
    required: ['when', 'action'],
    run(a) {
      const w = { ...((a.when ?? {}) as A) };
      if (has(w.student)) w.student = pickStudent(S().students, w.student).id;
      const t = cleanTrigger({ ...a, when: w }, { by: 'ai' });
      putTrigger(t);
      return { text: { ok: true, trigger: triggerJson(t, S().students) }, card: { title: '建了一个提醒', lines: [triggerJson(t, S().students).when_text + '：' + (t.action.type === 'remind' ? t.action.text : t.action.prompt)] } };
    },
  },
  {
    name: 'update_trigger', description: '修改提醒：改条件、内容、次数，或暂停 / 启用', write: true,
    params: { id: P('string', '提醒 id'), name: P('string', '名字'), when: P('object', WHEN_DESC), action: P('object', ACTION_DESC), times: P('string', TIMES_DESC), enabled: P('boolean', 'false 暂停，true 启用') },
    required: ['id'],
    run(a) {
      const old = useAssistantData.getState().triggers.find((t) => t.id === str(a.id)); if (!old) throw Error('找不到这个提醒');
      const raw: A = { ...a };
      if (raw.when) { const w = { ...(raw.when as A) }; if (has(w.student)) w.student = pickStudent(S().students, w.student).id; raw.when = w; }
      let t = cleanTrigger(raw, { base: old });
      if (a.enabled === true && !old.enabled && t.times !== 'every' && t.fired >= (t.times === 'once' ? 1 : t.times)) t = { ...t, fired: 0 };
      putTrigger(t);
      return { text: { ok: true, trigger: triggerJson(t, S().students) }, card: { title: '修改了提醒', lines: [t.name] } };
    },
  },
  {
    name: 'delete_trigger', description: '删除提醒。会弹确认框请老师点', write: true,
    params: { id: P('string', '提醒 id') }, required: ['id'],
    async run(a, c) {
      const t = useAssistantData.getState().triggers.find((x) => x.id === str(a.id)); if (!t) throw Error('找不到这个提醒');
      if (!(await c.confirm({ title: '删除这个提醒？', detail: t.name, yes: '删除' }))) return { ok: false, text: '老师没有同意删除' };
      removeTrigger(t.id);
      return { text: { ok: true }, card: { title: '删除了提醒', lines: [t.name], tone: 'warn' } };
    },
  },
  {
    name: 'remember', description: '记住老师的偏好或长期要求（「以后都这样」「记住」），之后每次对话都会带上', write: true,
    params: { text: P('string', '要记住的事，一句话') }, required: ['text'],
    run(a) {
      const text = str(a.text, 300); if (!text) throw Error('内容是空的');
      const m: Memory = { id: 'm-' + sid().slice(0, 8), text, at: nowIso(), by: 'ai' };
      setMemory([...useAssistantData.getState().memory.filter((x) => x.text !== text), m]);
      return { text: { ok: true, id: m.id }, card: { title: '记住了', lines: [text] } };
    },
  },
  {
    name: 'forget', description: '忘掉一条记住的事（id 或其中的文字）', write: true,
    params: { id: P('string', '记忆 id 或其中的文字') }, required: ['id'],
    run(a) {
      const q = str(a.id, 200), all = useAssistantData.getState().memory, hit = all.find((m) => m.id === q) ?? all.find((m) => m.text.includes(q));
      if (!hit) throw Error('没有这条记忆。现有：' + all.map((m) => `${m.id} ${m.text}`).join('；'));
      setMemory(all.filter((m) => m.id !== hit.id));
      return { text: { ok: true }, card: { title: '忘掉了', lines: [hit.text], tone: 'warn' } };
    },
  },
  // ── 电脑上的文件 ──
  {
    name: 'request_computer_access', description: '请老师同意你访问电脑上的文件或文件夹（看文件、运行命令前先调用）。说清楚要看什么、为什么',
    params: { paths: P('array', '要访问的文件或文件夹的完整路径；不知道具体位置可以不填，请老师自己选', { items: { type: 'string' } }), reason: P('string', '为什么要访问') },
    required: ['reason'],
    async run(a, c) {
      const got = await c.grant({ paths: list(a.paths).slice(0, 10), reason: str(a.reason, 300) });
      return got.length ? { text: { ok: true, granted: got } } : { ok: false, text: '老师没有同意' };
    },
  },
  {
    name: 'read_file', description: '读老师电脑上的文件内容（Word、Excel、PDF、PPT、txt、图片）。只能读老师拖给你、附在消息里、或同意过的文件',
    params: { path: P('string', '文件完整路径') }, required: ['path'],
    async run(a, c) {
      const p = str(a.path, 600).replace(/\\/g, '/');
      if (!c.granted().some((g) => p.toLowerCase() === g.toLowerCase() || p.toLowerCase().startsWith(g.toLowerCase().replace(/\/?$/, '/')))) throw Error('这个文件老师还没有同意给你看，先用 request_computer_access');
      if (/\.pptx?$/i.test(p)) {
        const pages = await host.call<{ lines: { t: string }[] }[] | null>('slideTexts', p);
        return { text: pages ? pages.map((x, i) => `【第 ${i + 1} 页】\n` + x.lines.map((l) => l.t).join('\n')).join('\n\n').slice(0, 50000) : '读不出这份 PPT 的文字' };
      }
      const src = await readSource(p);
      return src.image ? { text: fname(p) + '（图片）', images: [src.image] } : { text: src.text.slice(0, 50000) || '文件里没有文字' };
    },
  },
  {
    name: 'open_file', description: '用电脑上的默认程序打开你在工作目录里做好的文件（讲义、PPT、Word、PDF），或软件导出的文件',
    params: { path: P('string', '文件完整路径') }, required: ['path'],
    async run(a) { await host.call('assistant.open', { path: str(a.path, 600) }); return { text: { ok: true }, card: { title: '打开了文件', files: [str(a.path, 600)] } }; },
  },
];

const BY_NAME = new Map(DEFS.map((d) => [d.name, d]));
export const TOOL_NAMES = DEFS.map((d) => d.name);
export const WRITE_TOOLS = new Set(DEFS.filter((d) => d.write).map((d) => d.name));

/** 给 Codex 的 dynamicTools */
export function toolSpecs() {
  return DEFS.map((d) => ({ type: 'function', name: d.name, description: d.description, inputSchema: schema(d.params ?? {}, d.required ?? []) }));
}
export const toolsSignature = () => signature(toolSpecs());

/** 卡片上的工具名 */
export const TOOL_LABEL: Record<string, string> = {
  get_overview: '看了软件概况', list_students: '查了学生', get_student: '看了学生情况', add_student: '添加学生', update_student: '修改学生', add_group: '建班组', update_group: '改班组', add_student_note: '记学生资料', link_file_to_student: '归档学生文件', get_learning_map: '看了学习地图', set_map_state: '改学习地图', apply_map_suggestions: '按作答更新地图', list_recordings: '看了课堂录像', analyze_recording: '分析课堂录像',
  list_lessons: '查了课表', add_lesson: '排课', update_lesson: '调课', delete_lesson: '删课', search_questions: '找题', get_question: '看题', add_question: '加题', update_question: '改题',
  delete_questions: '删题', record_attempt: '记作答', look_at_screen: '看了学生画面', capture_screen_question: '收题', wrong_book: '看了错题本', list_points: '查了知识点',
  write_lesson_summary: '写课后总结', edit_lesson_summary: '改课后总结', list_lesson_summaries: '查了课后总结', send_to_parent: '发给家长', make_homework: '组作业', prepare_lesson: '备课',
  search_library: '找课件', open_material: '打开课件', navigate: '切换页面', app_help: '查了说明书', sort_files: 'AI 整理', list_triggers: '查了提醒', create_trigger: '建提醒',
  update_trigger: '改提醒', delete_trigger: '删提醒', remember: '记住', forget: '忘掉', request_computer_access: '请求访问电脑文件', read_file: '读文件', open_file: '打开文件',
};

/** 执行一次工具调用 */
export async function runTool(name: string, args: unknown, c: ToolCtx): Promise<ToolResult> {
  const d = BY_NAME.get(name);
  if (!d) return { ok: false, text: `没有这个工具：${name}。可用：${TOOL_NAMES.join(', ')}` };
  const a = (args && typeof args === 'object' ? args : {}) as A;
  const before = d.write ? snap() : null;
  try {
    const out = await d.run(a, c);
    const changes = before ? squash(diff(before, snap())) : [];
    return { ok: out.ok !== false, text: typeof out.text === 'string' ? out.text : JSON.stringify(out.text), images: out.images, changes, card: out.card ?? null };
  } catch (e) {
    // 出错前已经改了的也要能撤销
    const changes = before ? squash(diff(before, snap())) : [];
    return { ok: false, text: '出错了：' + ((e as Error)?.message || String(e)), changes };
  }
}
