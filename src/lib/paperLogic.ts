// 自己组卷：老师从题库挑题、分大题、配分，导出学生版和答案版。纯逻辑，Node 里可以直接测试。
import { imgMd, pictureOnly, questionSubject, themeLine, type Question } from './studyLogic';
import type { SubjectId } from './subjects';

export interface PaperItem { id: string; score: number }
export interface PaperSection { id: string; title: string; items: PaperItem[] }
export interface Paper { id: string; title: string; minutes: number; subject?: SubjectId; sections: PaperSection[]; updatedAt: string }

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export const cnNum = (i: number) => CN[i] ?? String(i + 1);
const SHORT = /选择|判断|单选|多选/;
const FILL = /填空/;
/** 题型默认分值：选择 4、填空 5、其他（解答、计算、实验…）12 */
export const defaultScore = (qtype: string) => (SHORT.test(qtype) ? 4 : FILL.test(qtype) ? 5 : 12);
const sid = () => Math.random().toString(36).slice(2, 10);

export const emptyPaper = (subject?: SubjectId): Paper => ({ id: sid(), title: '', minutes: 40, subject, sections: [], updatedAt: new Date().toISOString() });
export const paperTotal = (p: Paper) => p.sections.reduce((s, x) => s + x.items.reduce((a, i) => a + (Number(i.score) || 0), 0), 0);
export const paperCount = (p: Paper) => p.sections.reduce((s, x) => s + x.items.length, 0);
export const paperIds = (p: Paper) => p.sections.flatMap((s) => s.items.map((i) => i.id));
/** 大题标题里的题型（「一、选择题」→ 选择）；去掉序号和括号里的分值说明 */
export const sectionKind = (title: string) => title.replace(/^[一二三四五六七八九十]+[、.．]\s*/, '').replace(/[（(].*$/, '').replace(/题$/, '').trim();

/** 加一道题：放进同题型的大题；没有就按本学科题型顺序新开一个大题 */
export function addToPaper(p: Paper, q: Question, order: string[] = []): Paper {
  if (paperIds(p).includes(q.id)) return p;
  const kind = q.qtype || '其他', item = { id: q.id, score: defaultScore(kind) };
  const at = p.sections.findIndex((s) => sectionKind(s.title) === kind);
  if (at >= 0) return { ...p, sections: p.sections.map((s, i) => (i === at ? { ...s, items: [...s.items, item] } : s)) };
  const rank = (t: string) => { const k = order.indexOf(t); return k < 0 ? order.length : k; };
  const sec: PaperSection = { id: sid(), title: kind + '题', items: [item] };
  const pos = p.sections.findIndex((s) => rank(sectionKind(s.title)) > rank(kind));
  const sections = pos < 0 ? [...p.sections, sec] : [...p.sections.slice(0, pos), sec, ...p.sections.slice(pos)];
  return { ...p, sections };
}
export const removeFromPaper = (p: Paper, id: string): Paper => ({ ...p, sections: p.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })) });
/** 把题移到某个大题的第 index 个位置（拖动排序、跨大题移动都用它） */
export function moveInPaper(p: Paper, id: string, toSection: string, index: number): Paper {
  const item = p.sections.flatMap((s) => s.items).find((i) => i.id === id);
  if (!item) return p;
  const stripped = p.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
  return { ...p, sections: stripped.map((s) => (s.id === toSection ? { ...s, items: [...s.items.slice(0, Math.max(0, index)), item, ...s.items.slice(Math.max(0, index))] } : s)) };
}
/** 总分凑整：按当前比例把各题分值缩放到目标总分，整数，差额补给最后几道大题 */
export function scaleTo(p: Paper, total: number): Paper {
  const cur = paperTotal(p), n = paperCount(p);
  if (!n || total <= 0) return p;
  const items = p.sections.flatMap((s) => s.items);
  const raw = items.map((i) => (cur ? (i.score * total) / cur : total / n));
  const fl = raw.map((v) => Math.max(1, Math.floor(v)));
  let left = total - fl.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) fl[order[k][1]]++;
  let at = 0;
  return { ...p, sections: p.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, score: fl[at++] })) })) };
}

/** 大题标题：「一、选择题（共 8 题，每题 4 分，共 32 分）」 */
export function sectionHeading(s: PaperSection, i: number) {
  const n = s.items.length, sum = s.items.reduce((a, x) => a + (Number(x.score) || 0), 0), same = s.items.every((x) => x.score === s.items[0]?.score);
  const name = s.title.replace(/^[一二三四五六七八九十]+[、.．]\s*/, '').replace(/[（(][^）)]*[）)]\s*$/, '').trim() || '大题';
  return `${cnNum(i)}、${name}（共 ${n} 题，${same && n > 1 ? `每题 ${s.items[0].score} 分，` : ''}共 ${sum} 分）`;
}

const OPTION = /^\s*[（(]?[A-H][)）]?\s*[.．、:：]/;
const blockText = (s: string) => s.trim().split(/\n{2,}/).map((x) => x.replace(/\n/g, ' ')).join('\n\n');
function stemMd(q: Question) {
  if (!q.stem) return ['（见下图）', ''];
  const lines = q.stem.trim().split('\n'), k = lines.findIndex((l, i) => i > 0 && OPTION.test(l));
  if (k < 0) return [blockText(q.stem), ''];
  return [blockText(lines.slice(0, k).join('\n')), lines.slice(k).map((l) => l.trim()).filter(Boolean).join('\u3000\u3000')];
}
/** 解答题按分值留作答空白：每 6 分左右一格，最多 4 格 */
const gaps = (q: Question, score: number) => (SHORT.test(q.qtype) || FILL.test(q.qtype) ? '' : Array.from({ length: Math.max(1, Math.min(4, Math.round(score / 6))) }, () => '[[留空]]').join('\n\n'));

/**
 * 学生版：卷头填写栏 + 大题 + 题目（含配分、题图、作答空白）；答案版：同样的题号和大题，只有答案、解析。
 * 题图写成 img:<文件名>，主进程换成真实图片。
 */
export function paperMarkdown(p: Paper, questions: Question[], kind: 'student' | 'answer'): string {
  const qs = new Map(questions.map((q) => [q.id, q]));
  const first = paperIds(p).map((id) => qs.get(id)).find(Boolean);
  const subject = p.subject ?? (first ? questionSubject(first) : undefined);
  const title = p.title.trim() || '练习卷';
  const out = [themeLine(subject)];
  let n = 0;
  if (kind === 'student') {
    out.push(`# ${title}`, `[[表头 ${p.minutes > 0 ? `时间：${p.minutes} 分钟|` : ''}满分：${paperTotal(p)} 分|班级|姓名|得分]]`);
    p.sections.forEach((s, i) => {
      if (!s.items.length) return;
      out.push(`## ${sectionHeading(s, i)}`);
      for (const it of s.items) {
        const q = qs.get(it.id); n++;
        if (!q) { out.push(`**${n}.** （这道题已从题库删除）`); continue; }
        const [stem, opts] = pictureOnly(q) ? ['', ''] : stemMd(q);
        out.push([`**${n}.** （${it.score} 分）${stem}`, opts, imgMd(q), gaps(q, it.score)].filter(Boolean).join('\n\n'));
      }
    });
  } else {
    out.push(`# ${title} · 参考答案`, `满分 ${paperTotal(p)} 分　　共 ${paperCount(p)} 题${p.minutes > 0 ? `　　时间 ${p.minutes} 分钟` : ''}`);
    p.sections.forEach((s, i) => {
      if (!s.items.length) return;
      out.push(`## ${sectionHeading(s, i).replace(/（/, ' 答案（')}`);
      for (const it of s.items) {
        const q = qs.get(it.id); n++;
        out.push(`**${n}.** ${q?.answer ? blockText(q.answer) : '（答案待补充）'}　（${it.score} 分）` + (q?.analysis ? `\n\n> ${blockText(q.analysis)}` : '') + (q && (q.check === 'mismatch' || q.check === 'unchecked') ? '\n\n> 注意：这道题的答案没有通过 AI 自检，请老师核对。' : ''));
      }
    });
  }
  return out.filter(Boolean).join('\n\n') + '\n';
}

/** 题库里删掉的题从卷子里去掉；分值不是正整数的改成默认分 */
export function cleanPaper(p: Paper, questions: Question[]): Paper {
  const qs = new Map(questions.map((q) => [q.id, q]));
  return { ...p, sections: p.sections.map((s) => ({ ...s, items: s.items.filter((i) => qs.has(i.id)).map((i) => ({ ...i, score: Number.isFinite(i.score) && i.score > 0 ? Math.round(i.score * 2) / 2 : defaultScore(qs.get(i.id)!.qtype) })) })) };
}
