// 资料整理的纯逻辑：把资料库里的文件归到课件库 / 题库 / 学生档案，打上学科、年级、主题、知识点。
// 先按文件名和目录名用规则归类（免费、瞬间完成）；规则没把握的再交给 AI。这里不碰窗口，Node 里可以直接测试。
import type { Kind } from './types';
import { guessPoints, looseJSON, pointLabel } from './studyLogic';
import { LEVELS, SUBJECTS, packOf, type Family, type Level, type SubjectId } from './subjects';

export type Shelf = 'courseware' | 'questions' | 'student' | 'media' | 'other';
export const SHELVES: Shelf[] = ['courseware', 'questions', 'student', 'media', 'other'];
export const SHELF_NAME: Record<Shelf, string> = { courseware: '课件库', questions: '题库', student: '学生档案', media: '素材', other: '未归类' };

export interface CatEntry {
  path: string; title: string; kind: Kind; shelf: Shelf;
  subject?: SubjectId; grade?: string; topic?: string; points?: string[];
  studentId?: string; date?: string; answer?: boolean;
  /** 「错题库/张三/…」这类目录里认出的学生名字（还没建这个学生时先记名字，建了以后按名字关联） */
  owner?: string;
  /** 规则没把握（只看名字分不出来），等 AI 或老师确认 */
  unsure?: boolean;
  by: 'rules' | 'ai' | 'teacher'; at: string;
}
export interface CatFile { path: string; title: string; kind: Kind; folder: string }
export interface CatStudent { id: string; name: string; grade?: string; subject?: string }

const FAMILY_WORDS: [Family, RegExp][] = [
  ['physics', /物理|力学|电磁|电学|光学|热学|牛顿|动量|冲量|电路|电场|磁场|电势|电容|电流|电阻|电压|欧姆|电功|焦耳|动能|势能|机械能|平抛|圆周运动|匀变速|自由落体|加速度|超重|失重|摩擦力|弹力|受力|共点力|光电效应|楞次|电磁感应|交变电流|变压器|万有引力|天体|洛伦兹|安培力|伏安|单摆|简谐|机械波|折射|干涉|衍射|热力学|力学单位制|运动的描述|组合场|复合场/],
  ['math', /数学|函数|几何|代数|数列|导数|三角函数|解三角形|方程|不等式|概率|统计|向量|集合|奥数|圆锥曲线|椭圆|双曲线|抛物线|相似|全等|勾股|因式分解|分数|小数/],
  ['chem', /化学|元素|有机|无机|离子|氧化还原|化学式|方程式配平|化学平衡|电解质|物质的量|摩尔|酸碱|盐类|金属|非金属|原电池|电解池/],
  ['bio', /生物|细胞|遗传|生态|光合|基因|免疫/],
  ['chinese', /语文|作文|阅读理解|文言|古诗|诗词|名著|拼音|识字/],
  ['english', /英语|English|单词|语法|完形|听力|作文英语|阅读英语/i],
  ['history', /历史|朝代|近代史|世界史|中国史/],
  ['geo', /地理|地图|气候|地形|洋流|区域地理/],
  ['politics', /政治|道法|道德与法治|思想品德|法治|思政/],
  ['science', /科学(?!家)/],
];
const LEVEL_WORDS: [Level, RegExp][] = [
  ['senior', /高[一二三]|高中|高考|必修|选择性必修|选修/],
  ['junior', /初[一二三]|初中|中考|[七八九]年级|[789]年级|七[上下]|八[上下]|九[上下]/],
  ['primary', /小学|小升初|[一二三四五六]年级|[1-6]年级|[一二三四五六][上下]册/],
];
const GRADE = /高[一二三]|初[一二三]|[七八九一二三四五六]年级|[1-9]年级|高考|中考|小升初/;

const SHELF_WORDS: [Shelf, RegExp][] = [
  ['questions', /试卷|试题|习题|练习|真题|模拟|月考|期中|期末|周测|单元测|测试|检测|作业|题库|训练|学案|导学|同步练|答案|解析|错题|专项|考点|押题|卷/],
  ['courseware', /课件|讲义|教案|教学设计|新授|复习课|微课|精讲|知识点|知识清单|思维导图|导图|ppt|PPT|讲解|课堂|笔记/],
];
const MEDIA: Kind[] = ['video', 'audio', 'image', 'flash'];
const OWN = /错题|订正|作业|试卷|测试|考试|周测|月考|期中|期末|笔记|作文|成绩|报告|反馈/;

/** 文件名和所在目录合在一起看（给 AI 和书架关键词用）；去掉盘符 */
const textOf = (f: CatFile) => (f.folder.split('/').slice(-4).join('/') + '/' + f.title).replace(/^[a-z]:\//i, '');
/** 从近到远：文件名、所在目录、上一级……一直到资料库根目录（学科常写在最外层，例如「D:/名师物理/…」） */
const layers = (f: CatFile) => [f.title, ...f.folder.replace(/^[a-z]:\//i, '').split('/').filter(Boolean).reverse()];
/** Office 打开文件时留下的锁文件、系统缩略图之类，不进索引 */
export const junkFile = (title: string) => /^~\$|^\.|^thumbs$|^desktop$/i.test(title);

export function subjectOf(family: Family, level: Level | null): SubjectId | undefined {
  const all = SUBJECTS.filter((s) => s.family === family);
  return (level ? all.find((s) => s.level === level) : undefined)?.id ?? all.find((s) => s.level === 'senior')?.id ?? all[0]?.id;
}
export function levelOf(text: string): Level | null { return LEVEL_WORDS.find(([, re]) => re.test(text))?.[0] ?? null; }
export function familyIn(text: string): Family | null { return FAMILY_WORDS.find(([, re]) => re.test(text))?.[0] ?? null; }
const familiesIn = (text: string) => FAMILY_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
/** 最近的一层里认出学科就用它；同一层认出几个学科时，看外层目录支持哪个 */
function familyOfFile(f: CatFile): Family | null {
  const ls = layers(f);
  for (let i = 0; i < ls.length; i++) {
    const hit = familiesIn(ls[i]);
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) { const outer = ls.slice(i + 1).join('/'); return hit.find((k) => familiesIn(outer).includes(k)) ?? hit[0]; }
  }
  return null;
}
const levelOfFile = (f: CatFile) => { for (const l of layers(f)) { const v = levelOf(l); if (v) return v; } return null; };

/** 主题：标题去掉"答案、解析版、（2024）"这类尾巴 */
export function topicOf(title: string) {
  return title.replace(/[（(【\[][^）)】\]]{0,16}[）)】\]]/g, ' ').replace(/(精品)?(说课)?(课件)?\.?(pptx?|docx?|pdf)\b/gi, ' ').replace(/(含|带|有)?(答案|解析|详解)(版)?|原卷版?|学生版|教师版|word版|pdf版|\d{4}(-\d{4})?学年|\d{4}年?/gi, ' ').replace(/[-_—·.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || title.slice(0, 40);
}

const OWNER_DIR = /错题|学生|订正|作业|试卷/;
const NOT_NAME = /高[一二三]|初[一二三]|年级|物理|数学|化学|生物|语文|英语|历史|地理|政治|科学|练习|试卷|专题|作业|错题|整理|汇总|资料|其他|其它|图片|照片|上册|下册|期中|期末|月考|周测|复习|寒假|暑假|春季|秋季|新建|文件|备份|课件|讲义|答案|学生|老师|一对一|已完成|未完成/;
/** 「错题库/张三同学/…」：错题、学生、作业这类目录下面一层像人名的目录 */
export function ownerOf(f: CatFile): string | undefined {
  const segs = f.folder.replace(/^[a-z]:\//i, '').split('/').filter(Boolean);
  for (let i = segs.length - 1; i > 0; i--) {
    const name = segs[i].replace(/同学$/, '');
    if (OWNER_DIR.test(segs[i - 1]) && /^[\u4e00-\u9fa5]{2,4}$/.test(name) && !NOT_NAME.test(name)) return name;
  }
  return undefined;
}
/**
 * 学生档案按时间排：老师常把日期写在文件名里（25.7.22-3.jpg、2023.10.23周测试卷），比文件时间准。
 * 只写了月.日（9.17-1.jpg）时年份取文件时间那年；不合理的日期（比如 34.4.11）退回文件时间。
 */
export function dateOfName(title: string, mtime?: number, now = Date.now()): string | undefined {
  const p = (n: number) => String(n).padStart(2, '0'), ok = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2010 && Date.UTC(y, m - 1, d) <= now + 86400000;
  // 年月日的分隔要一致（25.7.22、2023-10-23、2023年10月23日）；10.5-1 是「10 月 5 日第 1 张」，不是 2010 年
  const full = /(?:^|\D)((?:20)?\d{2})(?:([.\-_])(\d{1,2})\2|年(\d{1,2})月)(\d{1,2})(?!\d)/.exec(title);
  if (full) { let y = +full[1]; if (y < 100) y += 2000; const m = +(full[3] ?? full[4]), d = +full[5]; if (ok(y, m, d)) return `${y}-${p(m)}-${p(d)}`; }
  const md = /^(\d{1,2})[.月](\d{1,2})(?!\d)/.exec(title);
  if (md && mtime) {
    const t = new Date(mtime); let y = t.getFullYear();
    if (Date.UTC(y, +md[1] - 1, +md[2]) > mtime + 86400000) y--;
    if (ok(y, +md[1], +md[2])) return `${y}-${p(+md[1])}-${p(+md[2])}`;
  }
  return mtime ? dayOf(mtime) : undefined;
}

export function classifyByRules(f: CatFile, students: CatStudent[], mtime?: number, now = new Date().toISOString()): CatEntry {
  const text = textOf(f);
  const owner = ownerOf(f);
  const student = students.find((s) => s.name.length >= 2 && (text.includes(s.name) || owner === s.name));
  const family = familyOfFile(f);
  const level = levelOfFile(f) ?? levelOf(student?.grade ?? '');
  let subject = family ? subjectOf(family, level) : undefined;
  if (!subject && student?.subject) subject = student.subject;
  const grade = GRADE.exec(text)?.[0];
  let shelf: Shelf = 'other', unsure = false;
  if ((student || owner) && (OWN.test(text) || MEDIA.includes(f.kind))) shelf = 'student';
  else if (MEDIA.includes(f.kind)) shelf = /错题|试卷|题/.test(text) ? 'questions' : 'media';
  else {
    const hit = SHELF_WORDS.find(([, re]) => re.test(f.title)) ?? SHELF_WORDS.find(([, re]) => re.test(text));
    if (hit) shelf = hit[0];
    else if (f.kind === 'slides' || f.kind === 'html') shelf = 'courseware';
    else unsure = true;
  }
  // 学生自己的错题照片名字里没有学科，交给 AI 也看不出来，不标"没把握"，免得白花钱
  if (!subject && shelf !== 'student') unsure = true;
  const topic = topicOf(f.title);
  const points = subject ? guessPoints(topic, subject).slice(0, 2) : [];
  return {
    path: f.path, title: f.title, kind: f.kind, shelf, subject, grade, topic, points: points.length ? points : undefined,
    studentId: student?.id, owner: shelf === 'student' && !student ? owner : undefined,
    date: shelf === 'student' ? dateOfName(f.title, mtime) : mtime ? dayOf(mtime) : undefined, answer: /答案|解析|详解|教师版/.test(f.title) || undefined,
    unsure: unsure || undefined, by: 'rules', at: now,
  };
}
export const dayOf = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// ── AI 归类 ─────────────────────────────────────────────
export function aiClassifyPrompt(batch: CatFile[], students: CatStudent[]) {
  const subjects = LEVELS.flatMap((l) => SUBJECTS.filter((s) => s.level === l).map((s) => `${s.id}=${s.stage}`)).join('，');
  return [
    '你在帮一位一对一辅导老师整理本地教学资料。只根据文件名和所在目录判断，每个文件归到一类：',
    'courseware=课件库（讲课用的 PPT、讲义、教案、知识点总结、互动网页）；questions=题库（试卷、练习、作业、真题、答案解析）；student=学生档案（某个学生自己的作业、错题、试卷、成绩、作文）；media=素材（视频、音频、图片素材）；other=和教学无关。',
    '学科只能从这些 id 里选，判断不出写空字符串：' + subjects,
    students.length ? '学生名单（文件属于某个学生时写 student 为名字）：' + students.map((s) => s.name).join('、') : '',
    '文件：\n' + batch.map((f, i) => `${i + 1}. ${textOf(f)}（${f.kind}）`).join('\n'),
    '输出 JSON：{"items":[{"i":1,"shelf":"questions","subject":"physics","grade":"高二","topic":"简短主题，10 字以内","student":""}]}，每个文件一条，不要漏。',
  ].filter(Boolean).join('\n\n');
}
export function parseAiClassify(raw: string, batch: CatFile[], students: CatStudent[], prior: (CatEntry | undefined)[], now = new Date().toISOString()): CatEntry[] {
  const j = looseJSON(raw) as { items?: unknown[] } | null;
  const items = Array.isArray(j?.items) ? j!.items as Record<string, unknown>[] : [];
  const out: CatEntry[] = [];
  for (const it of items) {
    const i = Number(it.i) - 1, f = batch[i];
    if (!f || out.some((x) => x.path === f.path)) continue;
    const shelf = SHELVES.includes(it.shelf as Shelf) ? it.shelf as Shelf : null;
    if (!shelf) continue;
    const sid = typeof it.subject === 'string' && SUBJECTS.some((s) => s.id === it.subject) ? it.subject : undefined;
    const name = typeof it.student === 'string' ? it.student.trim() : '';
    const student = name ? students.find((s) => s.name === name) : undefined;
    const base = prior[i];
    const subject = sid ?? base?.subject;
    const topic = typeof it.topic === 'string' && it.topic.trim() ? it.topic.trim().slice(0, 30) : base?.topic ?? topicOf(f.title);
    const points = subject ? guessPoints(topic + ' ' + f.title, subject).slice(0, 2) : [];
    out.push({
      ...(base ?? { path: f.path, title: f.title, kind: f.kind }), path: f.path, title: f.title, kind: f.kind,
      shelf: student && shelf !== 'other' ? 'student' : shelf, subject, topic, points: points.length ? points : undefined,
      grade: typeof it.grade === 'string' && GRADE.test(it.grade) ? it.grade.trim().slice(0, 6) : base?.grade,
      studentId: student?.id ?? base?.studentId, unsure: undefined, by: 'ai', at: now,
    });
  }
  return out;
}

// ── 检索：备课时按主题 / 知识点 / 学科找本地资料 ──────────────────
export interface CatQuery { text?: string; subject?: SubjectId; points?: string[]; shelf?: Shelf | Shelf[]; studentId?: string }
/** 中文按两字切词，英文数字按词 */
export function words(s: string): string[] {
  const out = new Set<string>();
  for (const part of s.toLowerCase().split(/[\s,，、;；:：·()（）【】\[\]/\\|_\-—.]+/)) {
    if (!part) continue;
    const zh = part.replace(/[^\u4e00-\u9fff]/g, ''), en = part.match(/[a-z0-9]{2,}/g) ?? [];
    for (let i = 0; i + 1 < zh.length; i++) out.add(zh.slice(i, i + 2));
    for (const w of en) out.add(w);
  }
  return [...out].filter((w) => !/^(第一|第二|第三|课件|讲义|练习|答案|解析|一节|章节|专题|高中|初中|小学|年级)$/.test(w));
}
export function scoreEntry(e: CatEntry, q: CatQuery, terms: string[]): number {
  const shelves = q.shelf ? (Array.isArray(q.shelf) ? q.shelf : [q.shelf]) : null;
  if (shelves && !shelves.includes(e.shelf)) return 0;
  if (q.studentId && e.shelf === 'student' && e.studentId !== q.studentId) return 0;
  const hay = (e.title + ' ' + (e.topic ?? '') + ' ' + (e.points ?? []).map(pointLabel).join(' ')).toLowerCase();
  let s = 0;
  for (const t of terms) if (hay.includes(t)) s += 2;
  if (q.points?.length && e.points?.length) s += 4 * e.points.filter((k) => q.points!.includes(k)).length;
  if (s === 0) return 0;
  if (q.subject && e.subject) s += e.subject === q.subject ? 3 : packOf(e.subject).family === packOf(q.subject).family ? 1 : -6;
  // 学科不明的文件只碰上一个词（如「平衡」）不算，免得化学课找出物理的「动态平衡」
  else if (q.subject) s -= 2;
  if (e.answer) s -= 0.5;
  return s;
}
export function searchCatalog(items: CatEntry[], q: CatQuery, limit = 8): { e: CatEntry; score: number }[] {
  const terms = words([q.text ?? '', ...(q.points ?? []).map((k) => pointLabel(k).split(' · ').pop() ?? '')].join(' '));
  return items.map((e) => ({ e, score: scoreEntry(e, q, terms) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
