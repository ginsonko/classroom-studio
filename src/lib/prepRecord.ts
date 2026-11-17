// 1.7.0 备课记录对得上：小羽自己写好教案 / 讲义 / 练习后归到学生名下（kind=prep），或者调用「记一次备课」，
// 都在学生资料的「备课」页出现一条备课记录（日期、主题、一句话摘要、文件）；以前只进了「文件」页的，启动时补上。
// 纯函数，Node 里可以直接测试。
import type { Prep, StudentFile, StudyData } from './studyLogic';

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const nameOf = (p: string) => p.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? p;
export const dateOfIso = (iso: string) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return iso.slice(0, 10); const z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
/** 成品（家长、学生能直接点开的）排前面；md / json 是中间文件 */
const rank = (p: string) => (/\.(pdf|png|jpe?g|html?)$/i.test(p) ? 0 : /\.(docx?|pptx?)$/i.test(p) ? 1 : 2);
/** 从文件名猜主题：去掉学生名、日期、「教案 / 讲义 / 答案」之类的尾巴 */
export function topicOf(files: string[], student = ''): string {
  const n = [...files].sort((a, b) => rank(a) - rank(b)).map(nameOf)[0] ?? '';
  return n.replace(new RegExp(student ? student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '^$', 'g'), '')
    .replace(/\d{4}[-.年]\d{1,2}[-.月]\d{1,2}日?|\d{1,2}月\d{1,2}日/g, '').replace(/[-_·\s]*(教案|备课|讲义|练习|答案|解析|题库|学案|课件|导学案|final|v\d+)$/gi, '')
    .replace(/^[-_·\s]+|[-_·\s]+$/g, '').replace(/[_]+/g, ' ').slice(0, 60) || n.slice(0, 60);
}

/**
 * 记一次备课：同一位学生同一天（同一个主题或没写主题）已经有一条就合进去（文件去重、摘要补上），没有就新建。
 * 返回新的 preps 和这次落到的那条。
 */
export function upsertPrep(preps: Prep[], o: { studentId: string; date: string; topic?: string; summary?: string; files?: string[]; points?: string[]; questionIds?: string[]; plan?: string; subject?: Prep['subject']; from: NonNullable<Prep['from']>; at: string; id: () => string; slotId?: string; start?: number }): { preps: Prep[]; prep: Prep; fresh: boolean } {
  const files = [...new Set((o.files ?? []).filter(Boolean))];
  const topic = (o.topic ?? '').trim().slice(0, 80);
  const same = preps.filter((p) => p.studentId === o.studentId && p.date === o.date && (!topic || !p.topic || p.topic === topic || topicLike(p.topic, topic)))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (same) {
    const have = new Set([...same.files, ...(same.courseware ?? [])].map(norm));
    const add = files.filter((f) => !have.has(norm(f)));
    const prep: Prep = { ...same, topic: same.topic || topic, files: [...same.files, ...add], ...(o.summary && !same.summary ? { summary: o.summary.slice(0, 200) } : {}), ...(o.points?.length && !same.points.length ? { points: o.points } : {}), ...(o.plan && !same.plan ? { plan: o.plan } : {}), at: o.at };
    return { preps: preps.map((p) => (p.id === same.id ? prep : p)), prep, fresh: false };
  }
  const prep: Prep = { id: o.id(), studentId: o.studentId, ...(o.subject ? { subject: o.subject } : {}), date: o.date, ...(o.start !== undefined ? { start: o.start } : {}), ...(o.slotId ? { slotId: o.slotId } : {}), at: o.at, topic: topic || topicOf(files) || '备课', points: o.points ?? [], materials: [], questionIds: o.questionIds ?? [], plan: o.plan ?? '', files, via: 'ai', ...(o.summary ? { summary: o.summary.slice(0, 200) } : {}), from: o.from };
  return { preps: [...preps, prep].slice(-500), prep, fresh: true };
}
const topicLike = (a: string, b: string) => { const x = a.replace(/\s+/g, ''), y = b.replace(/\s+/g, ''); return x.includes(y) || y.includes(x); };

/**
 * 一次性迁移（启动时跑，幂等）：学生名下 kind=prep 的文件，还没被任何备课记录收进去的，按「学生 + 那天」补成备课记录。
 * 已经收进去的不动；跑几次结果都一样，不丢不重。
 */
export function migratePreps(d: Pick<StudyData, 'preps' | 'files'>, o: { id: () => string; names?: Record<string, string> }): { preps: Prep[]; added: number } {
  let preps = d.preps ?? [];
  const known = () => new Set(preps.flatMap((p) => [...p.files, ...(p.courseware ?? []), ...p.materials]).map(norm));
  let have = known(), added = 0;
  const groups = new Map<string, StudentFile[]>();
  for (const f of d.files ?? []) {
    if (f.kind !== 'prep' || have.has(norm(f.path))) continue;
    const k = f.studentId + '@' + dateOfIso(f.at);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const list of groups.values()) {
    const f0 = list[0], note = list.map((f) => f.note).find(Boolean);
    const r = upsertPrep(preps, { studentId: f0.studentId, date: dateOfIso(f0.at), topic: note && note.length <= 40 ? note.replace(/^\d{1,2}\/\d{1,2}\s*/, '') : topicOf(list.map((f) => f.path), o.names?.[f0.studentId]), summary: note, files: list.map((f) => f.path), from: 'migrate', at: list.map((f) => f.at).sort().at(-1)!, id: o.id });
    if (r.fresh) added++;
    preps = r.preps; have = known();
  }
  return { preps, added };
}

/**
 * 1.7.0 课前一眼看：上节课讲了什么（一句话）+ 这节课的备课（一句话）。
 * date：这节课是哪天；上节 = 这天之前（含当天更早写的）最近一份课后总结；这节备课 = 这天的备课，没有就取最近一份还没上的备课。
 */
export function lessonBrief(studentId: string, d: Pick<StudyData, 'lessons' | 'preps'>, date: string, oneLine: (l: StudyData['lessons'][number]) => string): { last: { date: string; line: string; id: string } | null; prep: { date: string; line: string; id: string; topic: string } | null } {
  const ls = (d.lessons ?? []).filter((l) => l.studentId === studentId && l.date <= date).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const ps = (d.preps ?? []).filter((p) => p.studentId === studentId);
  const prep = ps.filter((p) => p.date === date).sort((a, b) => b.at.localeCompare(a.at))[0] ?? ps.filter((p) => p.date > date).sort((a, b) => a.date.localeCompare(b.date))[0]
    ?? ps.filter((p) => p.date < date && !ls.some((l) => l.date >= p.date)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const last = ls.find((l) => l.date < date) ?? ls[0];
  return { last: last ? { date: last.date, line: oneLine(last), id: last.id } : null, prep: prep ? { date: prep.date, line: prepLine(prep), id: prep.id, topic: prep.topic } : null };
}

/** 需要提前转码的：PPT、Word（PDF、图片本来就能直接显示） */
export const needsConvert = (p: string) => /\.(pptx?|docx?|rtf)$/i.test(p) && !/^https?:/i.test(p);
/** 这条备课里要提前转的文件 */
export const prepPaths = (p: Pick<Prep, 'files' | 'materials' | 'courseware'>) => [...new Set([...p.files, ...(p.courseware ?? []), ...p.materials])].filter(needsConvert);

/** 备课的一句话摘要：有 summary 用它，没有就从备课建议里取第一句有内容的话 */
export function prepLine(p: Pick<Prep, 'summary' | 'plan' | 'topic' | 'points'>): string {
  if (p.summary?.trim()) return p.summary.trim().slice(0, 80);
  const s = p.plan.replace(/^#+\s.*$/gm, '').replace(/^\s*[-*]\s*/gm, '').split(/[。\n]/).map((x) => x.trim()).find((x) => x.length >= 6);
  return (s ? s.slice(0, 80) : `这节课讲「${p.topic}」`);
}
