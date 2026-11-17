// 1.7.0 给家长的课后反馈：只留家长需要的（本节内容、表现亮点、需要加强、课后建议 / 作业、老师的话），
// 写得积极、具体；「不能证明…」「暂不能判断」「证据不足」这类防御性说法一律不进家长版，拿不准的只留给老师（待确认）。
// 纯函数，Node 里可以直接测试。
import type { LessonNote } from './studyLogic';
import type { SubjectId } from './subjects';

/** 防御性、拿不准的说法：整句不进家长版（只给老师看） */
export const DEFENSIVE = /不能证明|无法证明|不足以证明|不能说明|无法说明|不能代表|不代表|不能据此|无法据此|不能断定|无法断定|(暂|暂时|尚|还)?(不能|无法|难以|没法)(判断|确定|确认|得知|评估|下结论|看出|核实|认定)|证据不足|没有证据|缺少证据|缺乏证据|未见证据|看不(出|清|到)|没(有)?看(到|出|清)|未能(看到|观察|识别|确认|判断)|没能(看到|识别|确认|判断|听清)|不确定|拿不准|待确认|有待(确认|核实|观察)|不清楚(是否|有没有|学生)|是否(真正|真的|已经)?(掌握|理解|会了)(还|尚)?(不|未)(清楚|确定|知)|只能(推测|猜测)|可能(没有|并未|未必)|未必|不排除|仅凭|单凭|只凭|录像(里|中)?(看不|没有|未)|画面(里|中)?(看不|没有|未)|音频|转写|识别(错误|不准|有误)|截图(不全|有限|里看不)/;
/** 家长不需要知道的内部字段和说法：把握成数、置信度、证据原话、知识点编号、AI/录像分析的过程 */
const INTERNAL: [RegExp, string][] = [
  [/[（(][^（）()]*?(把握|置信|conf|证据|原话|key|编号)[^（）()]*?[)）]/gi, ''],
  [/[，,；;]?\s*(约|大约|大概)?\s*\d+(\.\d+)?\s*成把握/g, ''],
  [/[，,；;]?\s*(把握|置信度|conf)\s*[:：=]?\s*\d+(\.\d+)?\s*(成|%)?/gi, ''],
  [/[，,；;]?\s*(证据|原话证据)\s*[:：][^。！？\n]*/g, ''],
  [/[（(]\s*[a-z]{0,3}\d{1,2}\.\d{1,2}\s*[)）]/g, ''],
  [/\b(key|知识点编号)\s*[:：=]?\s*[a-z]{0,3}\d{1,2}\.\d{1,2}\b/gi, ''],
  [/(AI|模型)(在|从)?(录像|画面|课堂原话|转写)(里|中)?(看到|听到|判断|分析)(的)?/g, ''],
  [/[（(]\s*[)）]/g, ''],
];
/** 消极说法换成家长更好接受的说法（意思不变） */
const SOFTEN: [RegExp, string][] = [
  [/(还|仍|仍然|依然)?(完全|根本|一点也|一点都)?(没有|没|未)掌握/g, '还需要再巩固'],
  [/不会做/g, '还需要多练'],
  [/很差|太差|较差/g, '还有提升空间'],
  [/错误率(很|较)?高/g, '出错还比较多'],
  [/基础(很|太)?(薄弱|差)/g, '基础还需要夯实'],
  [/(粗心|马虎)大意?/g, '细节上还要更仔细'],
];

const SENT = /[^。！？!?；;\n]+[。！？!?；;]?/g;
const tidy = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/([，,、；;])\s*(?=[。！？!?；;，,]|$)/g, '').replace(/^[，,、；;\s]+/, '').replace(/[，,、]\s*([。！？])/g, '$1').trim();

/** 一段话：去掉内部字段；防御性的整句挪到 dropped；消极说法换个说法 */
export function positiveText(s: string): { text: string; dropped: string[] } {
  const dropped: string[] = [], keep: string[] = [];
  for (const raw of String(s ?? '').match(SENT) ?? []) {
    let x = raw;
    for (const [re, to] of INTERNAL) x = x.replace(re, to);
    x = tidy(x);
    if (!x || /^[。！？!?；;，,、]+$/.test(x)) continue;
    if (DEFENSIVE.test(x)) { dropped.push(tidy(raw)); continue; }
    for (const [re, to] of SOFTEN) x = x.replace(re, to);
    keep.push(x);
  }
  // 原文是按段写的：句子之间直接接上（中文不需要空格），段落之间保留换行
  return { text: keep.join('').replace(/([。！？!?；;])(?=\S)/g, '$1').trim(), dropped };
}
const many = (xs: string[]) => { const dropped: string[] = []; const out = xs.map((x) => { const r = positiveText(x); dropped.push(...r.dropped); return r.text; }).filter(Boolean); return { out, dropped }; };

/** 课后总结过一道兜底：家长看到的字段都积极、干净；拿不准的放进 pending（只给老师看） */
export function positiveLesson<T extends Pick<LessonNote, 'summary' | 'strengths' | 'problems' | 'next' | 'parent'> & { pending?: string[] }>(n: T): T {
  const s = positiveText(n.summary), p = positiveText(n.parent), st = many(n.strengths), pr = many(n.problems), nx = many(n.next);
  const pending = [...new Set([...(n.pending ?? []), ...s.dropped, ...p.dropped, ...st.dropped, ...pr.dropped, ...nx.dropped])].slice(0, 12);
  return { ...n, summary: s.text || n.summary.replace(DEFENSIVE, '').trim(), strengths: st.out, problems: pr.out, next: nx.out, parent: p.text, ...(pending.length ? { pending } : {}) };
}

/** 一句话「这节课讲了什么」：AI 写了就用，没有就取总结的第一句（课前卡片、课表详情用） */
export function oneLineOf(n: Pick<LessonNote, 'summary' | 'topic'> & { oneLine?: string }): string {
  const own = (n.oneLine ?? '').trim();
  if (own) return own.slice(0, 80);
  const first = (positiveText(n.summary).text.match(SENT) ?? [])[0]?.trim() ?? '';
  return (first || (n.topic ? `学习了「${n.topic}」` : '')).replace(/^本节课/, '').slice(0, 80);
}

const block = (s: string) => s.trim().split(/\n{2,}/).map((x) => x.replace(/\n/g, ' ')).join('\n\n');
const list = (xs: string[]) => xs.filter(Boolean).map((x) => `- ${x}`).join('\n');

/**
 * 家长版 Markdown（长图 / PDF / Word 都用它）：<!-- cs:parent --> 让排版页按家长版排（每块不同版式和配色、插画式背景）。
 * covered：这节课讲到 / 做过的题（一句话一道，最多 8 道）
 */
export function parentMarkdown(n: LessonNote & { oneLine?: string; covered?: string[] }, student: string, theme: string, covered: string[] = n.covered ?? []): string {
  const c = positiveLesson(n);
  const head = [n.date, n.topic, n.minutes ? `${n.minutes} 分钟` : ''].filter(Boolean).join('　');
  const what = [block(c.summary), covered.length ? list(covered.slice(0, 8).map((x) => positiveText(x).text || x)) : ''].filter(Boolean).join('\n\n');
  return [
    `<!-- cs:theme=${theme} -->`, '<!-- cs:parent -->',
    `# ${student} · 课后反馈`, head,
    `## 本节内容`, what || `今天学习了「${n.topic || '课堂内容'}」。`, '---',
    ...(c.strengths.length ? ['## 表现亮点', list(c.strengths), '---'] : []),
    ...(c.problems.length ? ['## 需要加强', list(c.problems), '---'] : []),
    ...(c.next.length ? ['## 课后建议', list(c.next), '---'] : []),
    ...(n.homework?.trim() ? ['## 课后作业', block(n.homework), '---'] : []),
    ...(c.parent ? ['## 老师的话', block(c.parent), '---'] : []),
  ].join('\n\n') + '\n';
}

/** 家长版每一块：版式和配色各不相同（排版页按标题认） */
export const PARENT_SECTIONS: { title: string; kind: string }[] = [
  { title: '本节内容', kind: 'what' }, { title: '表现亮点', kind: 'good' }, { title: '需要加强', kind: 'work' },
  { title: '课后建议', kind: 'next' }, { title: '课后作业', kind: 'hw' }, { title: '老师的话', kind: 'word' },
];
export const sectionKind = (title: string) => PARENT_SECTIONS.find((s) => title.includes(s.title))?.kind ?? 'what';
export type { SubjectId };
