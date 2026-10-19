// 技能包：把常用的几步操作串成一个按钮。步骤只能从下面的清单里选（不执行任意代码），
// 所以导入别人分享的技能包是安全的。会调用 AI 的步骤默认先停下来让老师确认；
// 「发给家长」永远只打开发送预览，由老师点确认才发。AI 费用照常记进 AI 账本。
import { create } from 'zustand';
import { host } from './host';
import { useStore } from './store';
import { addQuestion, patchQuestion, useStudy } from './studyStore';
import { aiConfig, buildLessonNote, captureFromScreen, dayKey, exportHomework, homeworkTitle, lessonDocument, readInBackground, saveLesson, useReading } from './studyActions';
import { draftQuestions, online } from './studyAi';
import { findDuplicate, guessType, mastery, pickHomework, pointLabel, questionSubject, type LessonNote, type Question } from './studyLogic';
import { nodeInfo, traceBack } from './knowledgeNet';
import { learningOf, subjectOfStudent } from './subjectState';

export type StepId = 'capture' | 'read' | 'bank' | 'variants' | 'homework' | 'lesson' | 'image' | 'parent';
export interface SkillStep { use: StepId; confirm?: boolean; args?: Record<string, number | boolean | string> }
export interface Skill { id: string; name: string; desc?: string; steps: SkillStep[]; builtin?: boolean }

export interface Ctx {
  studentId: string; name: string;
  question?: Question; drafts?: Question[]; lesson?: LessonNote; image?: string; files: string[];
}
interface StepDef {
  name: string; desc: string; ai?: boolean | 'maybe'; confirm: boolean;
  args?: { key: string; label: string; min?: number; max?: number; def: number | boolean; kind: 'number' | 'bool' }[];
  run: (c: Ctx, a: Record<string, number | boolean | string>) => Promise<string>;
}

const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
const q = (id: string) => useStudy.getState().data.questions.find((x) => x.id === id);

export const STEPS: Record<StepId, StepDef> = {
  capture: {
    name: '收题', desc: '截下学生画面上的这道题，收进学情收件箱', confirm: false,
    async run(c) { const { q: it, reused } = await captureFromScreen({ fresh: false }); c.question = it; return reused ? '这一页刚收过，用同一道题' : '已截图收进收件箱'; },
  },
  read: {
    name: '识题', desc: 'AI 看图转写题干、答案，标知识点和难度（没配置 AI 时按关键词猜知识点）', ai: 'maybe', confirm: false,
    async run(c) {
      if (!c.question) throw Error('前面没有收到题');
      const cur = q(c.question.id);
      if (cur?.stem && cur.points.length) { c.question = cur; return '题目已经识别过：' + cur.points.map((k) => pointLabel(k)).join('、'); }
      await readInBackground(c.question.id);
      const err = useReading.getState().errors[c.question.id];
      if (err) throw Error('识题失败：' + err);
      c.question = q(c.question.id) ?? c.question;
      if (!c.question.stem && !c.question.points.length) throw Error('没有识别出题目内容（可能没配置看图模型），请到收件箱手动填写');
      return `${c.question.stem.slice(0, 40)}${c.question.stem.length > 40 ? '…' : ''}｜${c.question.points.map((k) => pointLabel(k)).join('、') || '未识别知识点'}`;
    },
  },
  bank: {
    name: '入库', desc: '查重后放进题库（重复的题不再入库，用题库里原来那道）', confirm: false,
    async run(c) {
      if (!c.question) throw Error('前面没有收到题');
      const cur = q(c.question.id) ?? c.question;
      if (cur.status === 'bank') { c.question = cur; return '已经在题库里'; }
      if (!cur.stem.trim() && !cur.image) throw Error('题目是空的');
      const dup = cur.stem ? findDuplicate(cur.stem, useStudy.getState().data.questions.filter((x) => x.status === 'bank'), cur.id) : null;
      if (dup) { c.question = dup.q; return `题库里已有相似的题（相似度 ${Math.round(dup.sim * 100)}%），用原来那道`; }
      patchQuestion(cur.id, { status: 'bank' }); c.question = q(cur.id) ?? cur;
      return '已入库';
    },
  },
  variants: {
    name: '出变式题', desc: 'AI 按这道题的知识点出原创变式题，每道独立再解一遍自检；自检没通过的放进收件箱', ai: true, confirm: true,
    args: [{ key: 'n', label: '题数', min: 1, max: 5, def: 2, kind: 'number' }],
    async run(c, a) {
      const base = c.question && (q(c.question.id) ?? c.question);
      if (!base?.points.length) throw Error('这道题还没有知识点，出不了变式题（先识题或在收件箱里标上知识点）');
      if (!online(await aiConfig())) throw Error('没有配置 AI，不能出题');
      const n = num(a.n, 2, 1, 5), d = base.difficulty || 3;
      const { drafts } = await draftQuestions(base.points, n, Math.max(1, d - 1), Math.min(5, d + 1), [base.stem]);
      const ok: Question[] = []; let bad = 0;
      for (const x of drafts) {
        const it = addQuestion({ stem: x.stem, answer: x.answer, analysis: x.analysis, points: x.points, difficulty: x.difficulty, qtype: guessType(x.stem, questionSubject(base)), origin: 'ai', status: x.check === 'ok' ? 'bank' : 'inbox', check: x.check, checkNote: x.checkNote, source: '变式题 · ' + (base.stem.slice(0, 20) || '题图'), subject: questionSubject(base) });
        if (x.check === 'ok') ok.push(it); else bad++;
      }
      c.drafts = ok;
      if (!ok.length) throw Error(`出了 ${drafts.length} 道，但都没通过自检，已放进收件箱待核对`);
      return `出了 ${drafts.length} 道，${ok.length} 道自检通过已入库` + (bad ? `，${bad} 道没通过放进收件箱` : '');
    },
  },
  homework: {
    name: '组作业并导出', desc: '有变式题就用变式题（连同原题）；否则按薄弱点从题库组卷。导出 Word + PDF', confirm: false,
    args: [{ key: 'count', label: '按薄弱点组卷时的题数', min: 2, max: 20, def: 8, kind: 'number' }, { key: 'prereq', label: '先补前置', def: true, kind: 'bool' }],
    async run(c, a) {
      const data = useStudy.getState().data;
      let qs: Question[], points: string[];
      if (c.drafts?.length) {
        const base = c.question && (q(c.question.id) ?? c.question);
        qs = [...(base?.stem || base?.image ? [base] : []), ...c.drafts]; points = [...new Set(qs.flatMap((x) => x.points))];
      } else {
        const subject = subjectOfStudent(c.studentId);
        const weak = [...mastery(c.studentId, data, subject).values()].filter((m) => m.score < 0.6).sort((x, y) => x.score - y.score).map((m) => m.key).slice(0, 4);
        const roots = a.prereq !== false && weak.length ? traceBack(weak, nodeInfo(c.studentId, data, learningOf(c.studentId, subject), subject)).filter((r) => !weak.includes(r.key)).slice(0, 3) : [];
        const r = pickHomework({ studentId: c.studentId, points: weak, count: num(a.count, 8, 2, 20), minD: 1, maxD: 5, redo: 2, avoidDays: 14, prereqs: roots, subject }, data);
        if (!r.picked.length) throw Error('题库里没有合适的题（先多收一些题，或在「组作业」里让 AI 补题）');
        qs = r.picked.map((p) => p.q); points = weak.length ? weak : r.points;
      }
      const title = homeworkTitle(c.name, points);
      const r = await exportHomework({ studentId: c.studentId, name: c.name, title, questions: qs, points });
      c.files.push(...r.out);
      if (!r.out.length) throw Error('导出失败：' + (r.errors[0] || '未知原因'));
      return `「${title}」${qs.length} 题，已导出 ${r.out.map((f) => f.split('.').pop()?.toUpperCase()).join(' + ')}`;
    },
  },
  lesson: {
    name: '写课后总结', desc: '按今天的作答记录写课后总结和给家长的话（配置了 AI 用 AI，否则用模板）', ai: 'maybe', confirm: false,
    async run(c) {
      const date = dayKey(), today = useStudy.getState().data.lessons.filter((l) => l.studentId === c.studentId && l.date === date).at(-1);
      const hw = useStudy.getState().data.homework.filter((h) => h.studentId === c.studentId && dayKey(h.at) === date).at(-1);
      const st = useStore.getState().students.find((s) => s.id === c.studentId);
      const r = await buildLessonNote({ studentId: c.studentId, name: c.name, date, topic: today?.topic || st?.lastTopic || useStore.getState().pgmMat.title || '', homework: hw?.title, id: today?.id });
      saveLesson(r.note); c.lesson = r.note;
      return (r.note.via === 'ai' ? 'AI 写好了' : '按模板写好了') + (r.warning ? '（AI 失败，用了模板）' : '') + '，可以在「学情 → 课后总结」里改';
    },
  },
  image: {
    name: '导出分享长图', desc: '把课后总结导出成适合手机看的长图', confirm: false,
    async run(c) {
      if (!c.lesson) throw Error('前面没有课后总结');
      const r = await lessonDocument(c.lesson, c.name, ['png']);
      const p = r.out.find((f) => f.endsWith('.png'));
      if (!p) throw Error('长图导出失败：' + (r.errors[0] || '未知原因'));
      c.image = p; c.files.push(p);
      return '长图已导出';
    },
  },
  parent: {
    name: '发给家长', desc: '打开发送预览，老师看过内容、点「确认发送」才会发出去', confirm: true,
    async run() { return '打开发送预览'; },
  },
};

export const BUILTIN: Skill[] = [
  { id: 'b-variants', builtin: true, name: '这题讲完：出变式作业', desc: '收题 → 识题 → 入库 → AI 出 2 道变式题 → 连同原题导出作业', steps: [{ use: 'capture' }, { use: 'read' }, { use: 'bank' }, { use: 'variants', confirm: true, args: { n: 2 } }, { use: 'homework' }] },
  { id: 'b-wrap', builtin: true, name: '下课收尾：总结发家长', desc: '写课后总结 → 导出长图 → 打开发给家长的预览', steps: [{ use: 'lesson' }, { use: 'image' }, { use: 'parent', confirm: true }] },
  { id: 'b-weak', builtin: true, name: '薄弱点补练', desc: '按作答记录里的薄弱点（先补前置）从题库组 8 道题并导出', steps: [{ use: 'homework', args: { count: 8, prereq: true } }] },
];

/** 导入的 JSON 只保留认识的步骤和参数 */
export function cleanSkill(raw: unknown, id?: string): Skill {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = String(r.name ?? '').trim().slice(0, 40);
  if (!name) throw Error('技能包没有名字');
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, 12).flatMap((s): SkillStep[] => {
    const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>, def = STEPS[x.use as StepId];
    if (!def) return [];
    const args: SkillStep['args'] = {};
    for (const a of def.args ?? []) { const v = (x.args as Record<string, unknown> | undefined)?.[a.key]; if (v !== undefined) args[a.key] = a.kind === 'bool' ? v !== false : num(v, a.def as number, a.min ?? 0, a.max ?? 99); }
    return [{ use: x.use as StepId, confirm: x.use === 'parent' ? true : typeof x.confirm === 'boolean' ? x.confirm : def.confirm, ...(Object.keys(args).length ? { args } : {}) }];
  });
  if (!steps.length) throw Error('技能包里没有可以运行的步骤');
  return { id: id ?? 'u-' + crypto.randomUUID().slice(0, 8), name, desc: String(r.desc ?? '').slice(0, 120), steps };
}

export function skillJson(s: Skill) { return JSON.stringify({ format: 'classroom-studio-skill', version: 1, name: s.name, desc: s.desc, steps: s.steps }, null, 2); }

// ── 老师自己的技能包：存在学情目录 skills.json ──
export const useSkills = create<{ list: Skill[]; loaded: boolean }>(() => ({ list: [], loaded: false }));
export async function loadSkills() {
  if (useSkills.getState().loaded || !host.electron) return;
  try { const v = await host.call<unknown[]>('study.skills'); useSkills.setState({ list: (Array.isArray(v) ? v : []).flatMap((x) => { try { return [cleanSkill(x, (x as Skill).id)]; } catch { return []; } }), loaded: true }); }
  catch { useSkills.setState({ loaded: true }); }
}
export async function saveSkills(list: Skill[]) {
  useSkills.setState({ list });
  await host.call('study.saveSkills', list);
}
export const allSkills = (mine: Skill[]) => [...BUILTIN, ...mine];

// ── 运行 ──
export type RunState = 'wait' | 'ask' | 'run' | 'done' | 'skip' | 'fail';
export interface Run {
  skill: Skill; ctx: Ctx; at: number; states: RunState[]; notes: string[]; cost: number[];
  phase: 'running' | 'ask' | 'error' | 'parent' | 'done' | 'stopped';
}
export const useRun = create<{ run: Run | null }>(() => ({ run: null }));
let answer: ((v: 'go' | 'skip' | 'stop' | 'retry') => void) | null = null;
export function answerRun(v: 'go' | 'skip' | 'stop' | 'retry') { const f = answer; answer = null; f?.(v); }
const ask = () => new Promise<'go' | 'skip' | 'stop' | 'retry'>((r) => { answer = r; });
const patch = (f: (r: Run) => Partial<Run>) => useRun.setState((s) => (s.run ? { run: { ...s.run, ...f(s.run) } } : s));
const spentToday = async () => { try { return (await host.call<{ day: number } | null>('ai.ledger'))?.day ?? 0; } catch { return 0; } };

export async function runSkill(skill: Skill) {
  const st = useStore.getState(), student = st.students.find((s) => s.id === st.studentId);
  if (useRun.getState().run && !['done', 'stopped'].includes(useRun.getState().run!.phase)) throw Error('上一个技能包还没运行完');
  if (!student) throw Error('先在顶栏选择一位学生');
  const ctx: Ctx = { studentId: student.id, name: student.name, files: [] };
  useRun.setState({ run: { skill, ctx, at: Date.now(), states: skill.steps.map(() => 'wait'), notes: skill.steps.map(() => ''), cost: skill.steps.map(() => 0), phase: 'running' } });
  const set = (i: number, s: RunState, note = '') => patch((r) => ({ states: r.states.map((x, k) => (k === i ? s : x)), notes: r.notes.map((x, k) => (k === i ? note : x)) }));
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i], def = STEPS[step.use];
    if (step.confirm || step.use === 'parent') {
      set(i, 'ask'); patch(() => ({ phase: 'ask' }));
      const v = await ask();
      if (v === 'stop') { set(i, 'skip', '已停止'); patch(() => ({ phase: 'stopped' })); return; }
      if (v === 'skip') { set(i, 'skip', '跳过了'); patch(() => ({ phase: 'running' })); continue; }
    }
    if (step.use === 'parent') {
      if (!ctx.lesson) { set(i, 'fail', '前面没有课后总结，不能发给家长'); continue; }
      set(i, 'run', '在预览窗口里确认发送'); patch(() => ({ phase: 'parent' }));
      const v = await ask();
      set(i, v === 'go' ? 'done' : 'skip', v === 'go' ? '已发给家长，发送记录在「课后总结」里' : '没有发送');
      patch(() => ({ phase: 'running' }));
      continue;
    }
    for (;;) {
      set(i, 'run', '正在' + def.name + '…'); patch(() => ({ phase: 'running' }));
      const before = def.ai ? await spentToday() : 0;
      try {
        const note = await def.run(ctx, step.args ?? {});
        const used = def.ai ? Math.max(0, (await spentToday()) - before) : 0;
        patch((r) => ({ cost: r.cost.map((x, k) => (k === i ? used : x)) }));
        set(i, 'done', note);
        break;
      } catch (e) {
        const used = def.ai ? Math.max(0, (await spentToday()) - before) : 0;
        patch((r) => ({ cost: r.cost.map((x, k) => (k === i ? x + used : x)) }));
        set(i, 'fail', (e as Error).message); patch(() => ({ phase: 'error' }));
        const v = await ask();
        if (v === 'retry') continue;
        if (v === 'stop') { patch(() => ({ phase: 'stopped' })); return; }
        set(i, 'skip', (e as Error).message + '（已跳过）');
        break;
      }
    }
  }
  patch(() => ({ phase: 'done' }));
}
export function closeRun() { const r = useRun.getState().run; if (r && !['done', 'stopped'].includes(r.phase)) answerRun('stop'); useRun.setState({ run: null }); }
