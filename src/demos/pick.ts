// 「做成演示」在数学 / 化学课里：让模型从演示目录里挑一个并给出参数；没有模型时按题眼关键词挑。
import { kitOf, type SubjectId } from '../lib/subjects';
import { demoById, demosOf, guessDemo, makeDemo } from './index';
import { clampDemo, type DemoDef } from './kit';
import { REACTIONS, balance, parseEquation } from './chemCore';
import type { Material } from '../lib/types';

const line = (d: DemoDef) => `- ${d.id}「${d.title}」${d.summary}\n  参数：${d.params.filter((x) => !(x.hidden && !/^[abc][xy]$/.test(x.key))).map((x) => `${x.key}=${x.label} ${x.min}~${x.max}${x.options ? '（' + x.options.map((o) => o.v + '=' + o.label).join('，') + '）' : ''}`).join('；')}`;

export function pickPrompt(text: string, subject: SubjectId, hasImage: boolean) {
  const list = demosOf(subject).map(line).join('\n'), kit = kitOf(subject);
  return [
    `下面是课堂上可以直接上屏的${kit === 'math' ? '数学' : '化学'}互动演示。请根据${hasImage ? '图片里的题目和' : ''}老师给的内容，选最能帮学生看懂的一个，并按题目数据填参数。`,
    list,
    kit === 'chem' ? '配平题：选 c.balance，并在 equation 字段写出未配平的方程式（化学式用 H2O、Fe^3+ 这样的写法，箭头用 =）。' : '',
    '三角形四心题可以填顶点坐标 ax ay bx by cx cy（x 在 -7.5~7.5，y 在 -4~4）。没给的参数不要填。',
    '只输出 JSON：{"id":"演示 id","params":{...},"title":"给学生看的标题（12 字内）","note":"一句话说明为什么选它、参数从哪来","equation":"仅配平题需要"}',
    '内容：' + (text.trim() || '（看图片）'),
  ].filter(Boolean).join('\n\n');
}

export interface Picked { mat: Material; def: DemoDef; note: string; issues: string[] }

export function parsePick(raw: string, subject: SubjectId): Picked | null {
  let j: { id?: string; params?: Record<string, unknown>; title?: string; note?: string; equation?: string };
  try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  const def = demoById(j.id);
  if (!def || def.subject !== kitOf(subject)) return null;
  const issues: string[] = [];
  const raw0 = { ...(j.params ?? {}) };
  for (const [k, v] of Object.entries(raw0)) {
    const d = def.params.find((x) => x.key === k);
    if (!d) { delete raw0[k]; continue; }
    const n = Number(v);
    if (Number.isFinite(n) && !d.options && (n < d.min || n > d.max)) issues.push(`${d.label} = ${v} 超出演示范围，已调整`);
  }
  let text: string | undefined;
  if (def.id === 'c.balance' && j.equation) {
    const norm = (s: string) => s.replace(/\s+/g, '');
    const i = REACTIONS.findIndex((r) => norm(r.eq) === norm(j.equation!));
    if (i >= 0) raw0.rx = i + 1;
    else if (parseEquation(j.equation) && balance(parseEquation(j.equation)!)) { raw0.rx = 0; text = j.equation; }
    else issues.push('AI 给的方程式读不出来，先用目录里的反应');
  }
  const params = clampDemo(def, raw0);
  return { def, mat: makeDemo(def.id, params, { title: j.title?.slice(0, 24) || def.title, text }), note: j.note?.slice(0, 200) ?? '', issues };
}

export function pickByRules(text: string, subject: SubjectId): Picked | null {
  const def = guessDemo(text, subject);
  if (!def) return null;
  const eq = def.id === 'c.balance' ? /([A-Z][\w()[\]^+\-· ]*?=[\w()[\]^+\-· ]+)/.exec(text)?.[1]?.trim() : undefined;
  const parsed = eq ? parseEquation(eq) : null;
  const custom = parsed && balance(parsed) ? eq : undefined;
  return { def, mat: makeDemo(def.id, custom ? { rx: 0 } : {}, { text: custom }), note: `按题目里的关键词选了「${def.title}」，参数用默认值，请在预览里调整。`, issues: [] };
}
