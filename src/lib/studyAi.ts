// 学情闭环里用到 AI 的地方：识题打标签、课后总结、学生画像、原创题 + 自检、课件大纲。
// 都有不用模型的规则版兜底；模型的回复一律当不可信输入，逐字段校验。
import { ai, type AiConfig } from './ai';
import {
  answersMatch, guessDifficulty, guessPoints, guessType, looseJSON, parseOutline, pointLabel, pointList, qtypesOf, validPoints,
  type LessonInput, type LessonNote, type Outline, type Profile, type Question,
} from './studyLogic';
import { packOf, subjectOfKey, type SubjectId } from './subjects';

const sys = (subject?: SubjectId) => packOf(subject).prompt.persona;
/** 知识点决定学科：出题、课件按所选知识点的学科写提示词 */
const subjectOfPoints = (points: string[]): SubjectId => (points.map(subjectOfKey).find(Boolean) as SubjectId | undefined) ?? 'physics';
export const online = (c: AiConfig | null) => !!c?.hasKey && !!(c.model || c.visionModel);
// 模型有时把换行写成字面的 \n；\nu、\neq 这类 LaTeX 命令后面跟字母，不受影响
const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.replace(/\\n(?![a-zA-Z])/g, '\n').trim().slice(0, max) : '');
const strs = (v: unknown, n = 6) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, n) : []);
const diff = (v: unknown, fb: number) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : fb; };

export interface ReadResult { stem: string; answer: string; analysis: string; points: string[]; difficulty: number; qtype: string; via: 'ai' | 'rules'; model?: string }

export function readByRules(text: string, subject: SubjectId = 'physics'): ReadResult {
  return { stem: text.trim(), answer: '', analysis: '', points: guessPoints(text, subject), difficulty: guessDifficulty(text), qtype: guessType(text, subject), via: 'rules' };
}

/** 照片上框出来的题，截图边上常带着上一题的结尾或下一题的开头 */
export const onlyNo = (no: number) => `这张截图是第 ${no} 题，边上可能带着别的题的一部分，只看第 ${no} 题。`;

/** 识题：截图（可选）+ 已知文字 → 题干、答案、知识点、难度、题型。只给这个学科的知识点清单 */
export async function readQuestion(cfg: AiConfig | null, o: { text?: string; image?: string; solve?: boolean; subject?: SubjectId; no?: number }): Promise<ReadResult> {
  const text = o.text?.trim() ?? '', subject = o.subject ?? 'physics', pack = packOf(subject), qtypes = qtypesOf(subject);
  if (!online(cfg) || (!text && !o.image)) return readByRules(text, subject);
  const prompt = [
    o.image ? pack.prompt.read : `下面是一道${pack.name}题。`,
    o.image && o.no ? onlyNo(o.no) : '',
    text ? '已知文字：\n' + text : '',
    `然后${o.solve === false ? '' : '给出答案和简要解析，并'}从下面的知识点清单里选 1~3 个最相关的 key，估计难度（1 基础 2 巩固 3 中档 4 提高 5 压轴）和题型（${qtypes.join('/')}）。`,
    '知识点清单（key 名称）：\n' + pointList(subject),
    `输出 JSON：{"stem":"题干","answer":"${pack.prompt.answer}","analysis":"关键步骤，3~6 句","points":["key"],"difficulty":3,"qtype":"${qtypes[2] ?? qtypes[0]}"}`,
  ].filter(Boolean).join('\n\n');
  const r = await ai.chat([{ role: 'system', content: sys(subject) }, { role: 'user', content: prompt }], { image: o.image, json: true, maxTokens: 2000, temperature: 0.1, feature: '题库识题', ...(o.image && cfg!.visionModel ? { model: cfg!.visionModel } : {}) });
  const j = looseJSON(r.content) as Record<string, unknown> | null;
  if (!j) throw new Error('模型没有按格式返回识题结果，请重试或手动填写');
  const stem = str(j.stem) || text;
  const points = validPoints(j.points, subject);
  return { stem, answer: str(j.answer, 1500), analysis: str(j.analysis, 3000), points: points.length ? points : guessPoints(stem, subject), difficulty: diff(j.difficulty, guessDifficulty(stem)), qtype: qtypes.includes(str(j.qtype)) ? str(j.qtype) : guessType(stem, subject), via: 'ai', model: r.model };
}

type LessonText = Pick<LessonNote, 'summary' | 'strengths' | 'problems' | 'next' | 'parent'>;
export async function lessonByAi(i: LessonInput): Promise<LessonText & { model: string }> {
  const lines = i.attempts.map(({ q, a }, n) => `${n + 1}. [${a.result === 'right' ? '对' : a.result === 'half' ? '半对' : '错'}] ${q.points.map(pointLabel).join('、') || '未标注'}｜${(q.stem || '看图题').slice(0, 160)}${a.note ? '｜备注：' + a.note : ''}`);
  const prompt = [
    `学生：${i.student}。本节课主题：${i.topic || '未填写'}${i.minutes ? `，时长 ${i.minutes} 分钟` : ''}。`,
    lines.length ? '课堂作答记录：\n' + lines.join('\n') : '本节课没有记录作答。',
    i.notes.trim() ? '老师的课堂笔记：\n' + i.notes.trim().slice(0, 2000) : '',
    i.homework ? '布置的作业：' + i.homework : '',
    i.roots?.length ? '知识网络提示（错题对应知识点的前置掌握不好，可能是出错的根源）：\n' + i.roots.join('\n') + '\n如果和本节课的问题相关，在需要加强或下一步里点出来；不相关就不提。' : '',
    '请写课后总结。要求：具体、基于上面的记录，不编造没发生的内容；给家长的话 120~200 字，语气礼貌、专业、有温度，不用"您的孩子"这种生硬称呼，直接用学生名字；不知道学生性别，不要用"他/她"，需要指代时重复名字或省略主语。"下一步"每条一句话，不要把题目答案写进去。',
    '输出 JSON：{"summary":"本节课总结 2~4 句","strengths":["做得好的点"],"problems":["需要加强的点"],"next":["下一步建议"],"parent":"给家长的话"}',
  ].filter(Boolean).join('\n\n');
  const r = await ai.chat([{ role: 'system', content: sys(i.subject) }, { role: 'user', content: prompt }], { json: true, maxTokens: 1500, temperature: 0.4, feature: '课后总结' });
  const j = looseJSON(r.content) as Record<string, unknown> | null;
  if (!j || !str(j.summary) || !str(j.parent)) throw new Error('模型没有按格式返回课后总结，请重试');
  return { summary: str(j.summary, 1200), strengths: strs(j.strengths), problems: strs(j.problems), next: strs(j.next), parent: str(j.parent, 1200), model: r.model };
}

export function portraitByRules(name: string, p: Profile, roots: string[] = []): string {
  const parts = [`${name}累计记录作答 ${p.attempts} 题`];
  if (p.accuracy !== null) parts.push(`总体正确率 ${Math.round(p.accuracy * 100)}%` + (p.recentAccuracy !== null ? `，近 30 天 ${Math.round(p.recentAccuracy * 100)}%` : ''));
  if (p.strong.length) parts.push('掌握较好：' + p.strong.slice(0, 3).map((m) => pointLabel(m.key)).join('、'));
  if (p.weak.length) parts.push('需要加强：' + p.weak.slice(0, 3).map((m) => pointLabel(m.key)).join('、'));
  if (roots.length) parts.push('建议先补前置：' + roots.slice(0, 2).map((r) => r.split('（')[0]).join('、'));
  if (p.open) parts.push(`还有 ${p.open} 道错题待订正`);
  return parts.join('；') + '。';
}
export async function portraitByAi(name: string, grade: string, tags: string[], p: Profile, recent: string[], roots: string[] = [], subject: SubjectId = 'physics'): Promise<{ text: string; model: string }> {
  const prompt = [
    `学生：${name}，${grade}，学科：${packOf(subject).name}，标签：${tags.join('、') || '无'}。`,
    `作答 ${p.attempts} 题，总体正确率 ${p.accuracy === null ? '无数据' : Math.round(p.accuracy * 100) + '%'}，近 30 天 ${p.recentAccuracy === null ? '无数据' : Math.round(p.recentAccuracy * 100) + '%'}；待订正错题 ${p.open} 道，已订正 ${p.fixed} 道。`,
    '薄弱知识点：' + (p.weak.map((m) => `${pointLabel(m.key)}（${Math.round(m.score * 100)}%，${m.n} 次）`).join('；') || '暂无'),
    '较强知识点：' + (p.strong.map((m) => `${pointLabel(m.key)}（${Math.round(m.score * 100)}%）`).join('；') || '暂无'),
    '近 6 周正确率：' + p.weeks.map((w) => `${w.label} ${w.acc === null ? '-' : Math.round(w.acc * 100) + '%'}`).join('，'),
    roots.length ? '知识网络追溯（薄弱点的前置也掌握不好，可能是根源）：\n' + roots.join('\n') : '',
    recent.length ? '最近几次课后总结：\n' + recent.join('\n') : '',
    '用 3~5 句话写一段学生画像（学习特点、优势、短板、建议的教学策略），只基于上面的数据。输出 JSON：{"text":"..."}',
  ].filter(Boolean).join('\n');
  const r = await ai.chat([{ role: 'system', content: sys(subject) }, { role: 'user', content: prompt }], { json: true, maxTokens: 1500, temperature: 0.4, feature: '学生画像' });
  const j = looseJSON(r.content) as Record<string, unknown> | null;
  const text = str(j?.text, 1200);
  if (!text) throw new Error('模型没有返回画像文字，请重试');
  return { text, model: r.model };
}

export interface Draft { stem: string; answer: string; analysis: string; difficulty: number; points: string[]; check: 'ok' | 'mismatch'; solved: string; checkNote?: string }

/** 出题时模型标的知识点经常偷懒全写第一个；以题干关键词为准，限定在老师选的知识点里 */
export function draftPoints(stem: string, model: unknown, wanted: string[]): string[] {
  const fromModel = validPoints(model).filter((k) => wanted.includes(k));
  const fromText = guessPoints(stem, subjectOfPoints(wanted)).filter((k) => wanted.includes(k));
  const out = [...new Set([...fromText, ...fromModel])].slice(0, 2);
  return out.length ? out : wanted.slice(0, 1);
}
/**
 * AI 原创题：先出题，再让模型在不看答案的情况下独立解一遍，答案对得上才标"已自检"。
 * 对不上的保留但标"待核对"，不会被组作业自动选中。
 */
export async function draftQuestions(points: string[], n: number, minD: number, maxD: number, avoid: string[], onStep?: (t: string) => void): Promise<{ drafts: Draft[]; model: string }> {
  onStep?.(`AI 出 ${n} 道原创题…`);
  const subject = subjectOfPoints(points), pack = packOf(subject);
  const prompt = [
    `为${pack.stage}一对一辅导出 ${n} 道原创练习题，知识点：${points.map((k) => `${k} ${pointLabel(k)}`).join('；')}。难度 ${minD}~${maxD}（1 基础 … 5 压轴），由易到难。`,
    points.length > 1 ? `题目要分散到各个知识点：每个知识点至少 1 题（题数不够时优先前面的知识点）。每题的 points 只能从这些 key 里选：${points.join('、')}。` : `每题的 points 写 ["${points[0]}"]。`,
    pack.prompt.draft,
    avoid.length ? '不要和这些题重复：\n' + avoid.slice(0, 12).map((s) => '- ' + s.slice(0, 80)).join('\n') : '',
    `输出 JSON：{"questions":[{"stem":"题干","answer":"${pack.prompt.answer}","analysis":"关键步骤","difficulty":3,"points":["key"]}]}`,
  ].filter(Boolean).join('\n\n');
  const r = await ai.chat([{ role: 'system', content: sys(subject) }, { role: 'user', content: prompt }], { json: true, maxTokens: 4000, temperature: 0.7, feature: '组作业出题' });
  const j = looseJSON(r.content) as { questions?: unknown[] } | null;
  const raw = Array.isArray(j?.questions) ? j!.questions.slice(0, n) as Record<string, unknown>[] : [];
  if (!raw.length) throw new Error('模型没有按格式出题，请重试');
  const drafts: Draft[] = [];
  for (const [i, q] of raw.entries()) {
    const stem = str(q.stem), answer = str(q.answer, 800);
    if (!stem || !answer) continue;
    onStep?.(`自检第 ${i + 1}/${raw.length} 题：独立解一遍…`);
    let solved = '', issue = '', failed = false;
    try {
      const s = await ai.chat([{ role: 'system', content: sys(subject) }, { role: 'user', content: `你是审题老师。${pack.prompt.solve}\n\n${stem}\n\n输出 JSON：{"issue":"题目有问题时用一句话说明，没有问题写空字符串","answer":"..."}` }], { json: true, maxTokens: 1200, temperature: 0, feature: '组作业自检' });
      const j = looseJSON(s.content) as Record<string, unknown> | null;
      solved = str(j?.answer, 400); issue = str(j?.issue, 300);
    } catch { failed = true; }
    if (/^(无|没有|无问题|none|null|ok)[。.]?$/i.test(issue)) issue = '';
    const same = !!solved && answersMatch(answer, solved);
    const checkNote = failed ? '自检请求失败，请人工核对' : issue ? '题目可能有问题：' + issue : !same ? `独立解出的答案是「${solved || '无'}」，和出题答案「${answer}」对不上` : undefined;
    drafts.push({ stem, answer, analysis: str(q.analysis, 2000), difficulty: diff(q.difficulty, Math.round((minD + maxD) / 2)), points: draftPoints(stem, q.points, points), check: same && !issue ? 'ok' : 'mismatch', solved, checkNote });
  }
  return { drafts, model: r.model };
}

export async function outlineByAi(topic: string, points: string[], student: string, minutes: number, examples: Question[], subject: SubjectId = points.length ? subjectOfPoints(points) : 'physics'): Promise<{ outline: Outline; model: string }> {
  const pack = packOf(subject);
  const prompt = [
    `为一对一${pack.stage}网课做讲课 PPT 大纲。主题：${topic || points.map(pointLabel).join('、')}。学生：${student}。课时 ${minutes} 分钟。`,
    points.length ? '涉及知识点：' + points.map(pointLabel).join('、') : '',
    examples.length ? '题库里可用的例题（可以选用，也可以自己出）：\n' + examples.map((q, i) => `${i + 1}. ${q.stem.slice(0, 200)}${q.answer ? '（答案：' + q.answer.slice(0, 60) + '）' : ''}`).join('\n') : '',
    pack.prompt.outline + '8~14 页。要点短句，不写成大段文字。只围绕主题讲，涉及知识点里和主题无关的不要硬凑。',
    '输出 JSON：{"title":"","subtitle":"","slides":[{"title":"","bullets":[""],"formulas":["LaTeX，不带 $"],"example":{"stem":"","answer":""},"notes":"讲解提示"}]}。只有例题页写 example，其他页不要写 example 字段；没有公式的页 formulas 写 []。',
  ].filter(Boolean).join('\n\n');
  const r = await ai.chat([{ role: 'system', content: sys(subject) }, { role: 'user', content: prompt }], { json: true, maxTokens: 5000, temperature: 0.5, feature: 'AI 课件' });
  const outline = parseOutline(looseJSON(r.content));
  if (!outline) throw new Error('模型没有按格式返回课件大纲，请重试');
  return { outline, model: r.model };
}
