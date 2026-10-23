// 课表导入：把老师已有的课表（Excel / Word / 图片 / 一段文字）变成排课。
// AI 读出来的、规则拆出来的都当不可信输入，逐字段校验；真正写进课表前给老师预览，冲突和新建学生都说清楚。
import type { LessonSlot, Student } from '../lib/types';
import { MAX_LEN, conflicts, dateKey, localDate, spanText } from './scheduleModel';
import { byLevel, levelOfGrade, packOf, studentSubject, type Level, type SubjectId } from '../lib/subjects';
import { defaultTopic, findGroupFor, individuals, isGroup, makeGroup, splitNames } from '../lib/groups';

export interface ImportLesson {
  student: string; grade: string; subject: string;
  day: number;        // 0=周一
  date: string;       // 单次课的日期；每周课的开始日期（没有就从生效日期算）
  start: number; len: number; topic: string; repeat: boolean;
  guess?: boolean;    // 课表没写上下午、也看不出规律，先按下午 / 晚上算的，预览里标黄让老师确认
  from?: string;      // 来自哪个文件（一次导入好几个文件时）
}

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const DAY_CHARS = '一二三四五六日';
const EN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const clean = (v: unknown, max = 60) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** 周一 / 星期一 / 礼拜天 / Mon / 1~7（1=周一，0 和 7 都当周日） → 0~6 */
export function parseDay(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 7 ? (v + 6) % 7 : null;
  const s = clean(v).toLowerCase();
  const m = /(?:周|星期|礼拜)\s*([一二三四五六日天七1-7])/.exec(s);
  if (m) { const c = m[1]; return c === '天' || c === '七' || c === '日' ? 6 : /\d/.test(c) ? (Number(c) + 6) % 7 : DAY_CHARS.indexOf(c); }
  const en = EN_DAYS.findIndex((d) => new RegExp(`\\b${d}`).test(s));
  if (en >= 0) return en;
  if (/^[1-7]$/.test(s)) return (Number(s) + 6) % 7;
  if (/^[一二三四五六日天]$/.test(s)) return s === '天' ? 6 : DAY_CHARS.indexOf(s);
  return null;
}

const hourOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : CN_NUM[s] ?? NaN);
/** 时刻前面的上下午说法（正则片段） */
const PART = '(?:上午|下午|晚上|中午|早上|早晨|清晨|傍晚|凌晨|半夜|深夜|夜里)';

/**
 * 一个时刻 → { 小时（小数）, 是否靠猜 }。19:00、19：30、晚上7点半、下午3点一刻、7:30pm、1930、凌晨1点。
 * 写成 07:00 这样带前导 0 的是 24 小时制，就是早上 7 点；只写「7:00」、没写上下午的 1~7 点先按下午 / 晚上算并标上 guess，
 * 由调用方看同一张表的规律再定，定不了的让老师在预览里确认。after 给区间的后半段继承前半段的上下午。
 */
export function clockOf(v: unknown, after?: number): { t: number; guess: boolean } | null {
  if (typeof v === 'number') return v >= 0 && v < 24 ? { t: v, guess: false } : null;
  const s = clean(v).replace(/：/g, ':').replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  let h = NaN, min = 0, zero = false;
  let m = /(\d{1,2}):(\d{2})/.exec(s);
  if (m) { h = Number(m[1]); min = Number(m[2]); zero = /^0\d$/.test(m[1]); }
  else if ((m = /(\d{1,2}|十[一二]?|[一二两三四五六七八九十])[点點时時](半|一刻|三刻|(\d{1,2})分?)?/.exec(s))) {
    h = hourOf(m[1]); min = m[2] === '半' ? 30 : m[2] === '一刻' ? 15 : m[2] === '三刻' ? 45 : m[3] ? Number(m[3]) : 0;
  } else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) { h = Number(m[1]); min = Number(m[2]); zero = /^0\d$/.test(m[1]); }
  else if ((m = /^(\d{1,2})(?:am|pm)?$/.exec(s))) h = Number(m[1]);
  if (!Number.isFinite(h) || h > 24 || min >= 60) return null;
  const pm = /下午|晚上|晚|傍晚|pm|p\.m\./.test(s), am = /上午|早上|早晨|清晨|凌晨|am|a\.m\./.test(s), noon = /中午/.test(s), late = /半夜|深夜|夜里/.test(s);
  let guess = false;
  if (pm && h < 12) h += 12;
  else if (noon && h < 6) h += 12;
  else if (late) { if (h === 12) h = 0; else if (h >= 6 && h < 12) h += 12; }
  else if (!am && !pm && !noon) {
    if (after !== undefined) { if (h + min / 60 <= after && h + 12 + min / 60 > after && h < 12) h += 12; }
    else if (h >= 1 && h < 8 && !zero) { h += 12; guess = true; }
  }
  const t = h + min / 60;
  return t < 24 ? { t, guess } : null;
}
export const parseTime = (v: unknown, after?: number): number | null => clockOf(v, after)?.t ?? null;

export interface Range { start: number; len: number; guess: boolean }
/** 19:00-20:30、晚上7点到8点半、19:00~20:30(1.5h)、23:00-01:00（跨午夜）、19:00 2小时 → 开始、时长、上下午是否靠猜 */
export function rangeOf(v: unknown): Range | null {
  const s = clean(v, 200).replace(/：/g, ':');
  // 开始时刻必须带 ":" 或 "点"，免得把 2026-10-25 这样的日期当成时间段
  const H = '(?:\\d{1,2}|十[一二]?|[一二两三四五六七八九十])', MARK = '(?::\\d{2}|[点點时時](?:半|一刻|三刻|\\d{1,2}分?)?)';
  const re = new RegExp(`(${PART}?\\s*${H}${MARK}\\s*(?:am|pm)?)\\s*(?:-|~|～|—|–|－|至|到)+\\s*(${PART}?\\s*${H}${MARK}?\\s*(?:am|pm)?)`, 'gi');
  for (const m of s.matchAll(re)) {
    const a = clockOf(m[1]);
    let end = a === null ? null : parseTime(m[2], a.t);
    if (a === null || end === null) continue;
    if (end <= a.t && end + 12 < 24 && end + 12 > a.t) end += 12;
    if (end <= a.t) end += 24;
    const len = Math.round((end - a.t) * 4) / 4;
    if (len > 0 && len <= MAX_LEN) return { start: a.t, len, guess: a.guess };
  }
  const one = new RegExp(`(${PART}?\\s*\\d{1,2}(?::\\d{2}|[点點](?:半|\\d{1,2}分?)?))`).exec(s), dur = /(\d+(?:\.\d+)?)\s*(?:h|小时|个小时|课时)/i.exec(s);
  const a = one ? clockOf(one[1]) : null;
  if (a && dur) return { start: a.t, len: Number(dur[1]), guess: a.guess };
  return null;
}
export function parseRange(v: unknown): [number, number] | null { const r = rangeOf(v); return r ? [r.start, r.len] : null; }

/**
 * 表格第一列的时段一般从早到晚排。没写上下午的一行，拿它前后写得明白的行比一比：
 * 只有上午说得通就改回上午，只有下午说得通就确定是下午，都说得通（或者整张表都没写）才继续标黄。
 */
export function settleRows<T extends Range | null>(rows: T[]): T[] {
  const sure = rows.map((r) => (r && !r.guess ? r.start : null));
  return rows.map((r, i) => {
    if (!r || !r.guess) return r;
    const prev = sure.slice(0, i).reverse().find((x) => x !== null) ?? null, next = sure.slice(i + 1).find((x) => x !== null) ?? null;
    if (prev === null && next === null) return r;
    const fits = (t: number) => (prev === null || prev <= t) && (next === null || next >= t);
    const am = fits(r.start - 12), pm = fits(r.start);
    if (am && !pm) return { ...r, start: r.start - 12, guess: false };
    if (pm && !am) return { ...r, guess: false };
    return r;
  });
}

/** 2026-10-25、2026/10/25、2026年10月25日、10月25日、10/25、10.25 → yyyy-mm-dd；没写年份时取离今天最近的那一年 */
export function parseDate(v: unknown, today: Date): string {
  const s = clean(v, 40);
  let y = 0, mo = 0, d = 0;
  let m = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(s);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /(?:^|[^\d])(\d{1,2})\s*(?:月|\/|-|\.)\s*(\d{1,2})(?:日|号)?(?!\d|:)/.exec(s))) { mo = +m[1]; d = +m[2]; }
  else return '';
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  if (!y) {
    y = today.getFullYear();
    const diff = (new Date(y, mo - 1, d).getTime() - today.getTime()) / 864e5;
    if (diff < -183) y++; else if (diff > 183) y--;
  }
  const out = new Date(y, mo - 1, d);
  return out.getMonth() === mo - 1 ? dateKey(out) : '';
}

const weekday = (key: string) => (localDate(key).getDay() + 6) % 7;

/** 模型返回的 {"lessons":[…]} → 校验过的课；读不懂的条数单独计数，预览里提示老师 */
export function lessonsFromJson(j: unknown, today: Date): { lessons: ImportLesson[]; dropped: number } {
  const o = j as { lessons?: unknown } | null;
  const list = Array.isArray(o?.lessons) ? o!.lessons : Array.isArray(j) ? j : [];
  const lessons: ImportLesson[] = [];
  let dropped = 0;
  for (const raw of list.slice(0, 300) as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') { dropped++; continue; }
    const student = clean(raw.student ?? raw.name, 20);
    const date = parseDate(raw.date, today);
    const day = date ? weekday(date) : parseDay(raw.day);
    const a = clockOf(raw.start);
    let start = a?.t ?? null, len = Number(raw.len ?? raw.hours), guess = !!a?.guess;
    const end = start === null ? null : parseTime(raw.end, start);
    if (start === null && typeof raw.time === 'string') { const r = rangeOf(raw.time); if (r) ({ start, len, guess } = r); }
    // 结束时间早于开始时间的是过了午夜才下课
    if (start !== null && end !== null && !(len > 0)) len = end > start ? end - start : end + 24 - start;
    if (!student || day === null || start === null || !(len > 0) || len > MAX_LEN) { dropped++; continue; }
    const repeat = !date || raw.repeat === true || raw.repeat === 'true';
    lessons.push({ student, grade: clean(raw.grade, 12), subject: clean(raw.subject, 12), day, date, start, len: Math.round(len * 4) / 4, topic: clean(raw.topic, 120), repeat, ...(guess || raw.unsure === true ? { guess: true } : {}) });
  }
  return { lessons: mergeAdjacent(lessons), dropped };
}

/** 表格里两格连着的同一节课（合并单元格展开后）合成一节 */
export function mergeAdjacent(list: ImportLesson[]): ImportLesson[] {
  const out: ImportLesson[] = [];
  const sorted = [...list].sort((a, b) => a.day - b.day || a.date.localeCompare(b.date) || a.start - b.start);
  for (const l of sorted) {
    const prev = out.find((p) => p.student === l.student && p.day === l.day && p.date === l.date && p.repeat === l.repeat && Math.abs(p.start + p.len - l.start) < 0.01 && (p.topic === l.topic || !l.topic));
    if (prev) { prev.len += l.len; if (l.guess) prev.guess = true; }
    else if (!out.some((p) => p.student === l.student && p.day === l.day && p.date === l.date && p.start === l.start)) out.push({ ...l });
  }
  return out;
}

/** 一次导入好几个文件：每节课记上来源，再一起合并相邻的、去掉几个文件里重复写的同一节 */
export function combineSources(list: { name: string; lessons: ImportLesson[] }[]): ImportLesson[] {
  return mergeAdjacent(list.flatMap((s) => s.lessons.map((l) => ({ ...l, from: s.name }))));
}

// ── 不用模型的规则版：表格（周几在表头、时间在第一列）和一行一节的文字 ──
const SUBJECT_WORDS = /物理|数学|语文|英语|化学|生物|历史|地理|政治|道法|道德与法治|科学|奥数|作文|阅读/g;
// 「周」只在像星期的时候跳过：周杰、周子涵是名字
const STOP = /^(周[一二三四五六日天末]|星期|礼拜|上午|下午|晚上|中午|早上|凌晨|深夜|半夜|时间|课程|课表|一对一|一对二|一对多|小组|班课|网课|线上|线下|老师|复习|预习|作业|备注|休息|空|无|节次|第.节)/;
function oneName(text: string, names: string[]): string {
  const known = [...names].sort((a, b) => b.length - a.length).find((n) => n.length >= 2 && text.includes(n));
  if (known) return known;
  const bare = text.replace(/每?(?:周|星期|礼拜)[一二三四五六日天]|每周|每星期/g, ' ')
    .replace(/(?:\d{1,2}|十[一二]?|[一二两三四五六七八九十])\s*(?:[:：]\d{2}|[点點时時](?:半|一刻|三刻|\d{1,2}分?)?)|[到至]|\d+(?:\.\d+)?\s*(?:个?小时|课时)|\d{1,2}月\d{1,2}[日号]?/g, ' ').replace(new RegExp(PART, 'g'), ' ').replace(SUBJECT_WORDS, ' ').replace(/同学|老师/g, ' ');
  for (const m of bare.matchAll(/[\u4e00-\u9fa5]{2,4}/g)) if (!STOP.test(m[0])) return m[0];
  return '';
}
/**
 * 一格 / 一行文字里的学生名：先找已有学生，找不到取第一个像名字的 2~4 个汉字。
 * 「俊宇、欣怡」「俊宇+欣怡」这样紧挨着写的几个人一起返回（「俊宇、欣怡」），算一对二 / 小组课。
 */
export function nameIn(text: string, names: string[]): string {
  const whole = [...names].sort((a, b) => b.length - a.length).find((n) => n.length >= 2 && splitNames(n).length > 1 && text.includes(n));
  if (whole) return whole;
  const bits = text.split(/(\s*(?:[、，,/／+＋&＆]|\s和\s)\s*)/);
  if (bits.length < 3) return oneName(text, names);
  const known = new Set(names);
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += 2) {
    const part = bits[i].trim(), name = part ? oneName(part, names) : '';
    if (!out.length) {
      if (!name) continue;
      out.push(name);
      if (!part.endsWith(name)) break;
      continue;
    }
    // 逗号后面的多半是课程内容，只有对得上已有学生才算；顿号、加号连着的 2~3 个字也算名字
    const loose = /[、+＋&＆/／]|和/.test(bits[i - 1]) && name.length <= 3;
    if (!name || !part.startsWith(name) || !(known.has(name) || loose)) break;
    out.push(name);
    if (!part.endsWith(name)) break;
  }
  return out.join('、');
}

function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes('|')) return line.split('|').map((c) => c.trim()).filter((c, i, a) => c || (i > 0 && i < a.length - 1));
  if (/,|，/.test(line) && line.split(/,|，/).length >= 3) {
    const out: string[] = []; let cur = '', q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if ((ch === ',' || ch === '，') && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
    out.push(cur.trim()); return out;
  }
  return line.split(/\s{2,}/).map((c) => c.trim());
}

const dropNames = (text: string, name: string) => (text.includes(name) ? [name] : splitNames(name)).reduce((t, n) => t.replace(n, ' '), text);
const topicOf = (text: string, name: string) => clean(dropNames(text, name).replace(/(?:周|星期|礼拜)[一二三四五六日天]/g, ' ').replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}[日号]?/g, ' ')
  .replace(new RegExp(`${PART}?\\s*\\d{1,2}(?::|：)\\d{2}\\s*(?:-|~|～|—|–|至|到)+\\s*${PART}?\\s*\\d{1,2}(?::|：)\\d{2}`, 'g'), ' ').replace(/[（(]\s*[)）]/g, ' ').replace(/^[\s,，、:：|·+＋&＆/-]+|[\s,，、:：|·+＋&＆/-]+$/g, ''), 120);

export function lessonsByRules(text: string, names: string[], today: Date): ImportLesson[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const rows = lines.map(splitCells);
  const out: ImportLesson[] = [];
  const used = new Set<number>();
  // 表格：某一行里至少两格是周几，下面每行的第一格（或任一非周几列）是时间段
  for (let h = 0; h < rows.length; h++) {
    const cols = new Map<number, { day: number; date: string }>();
    rows[h].forEach((c, i) => { const d = c.length <= 16 ? parseDay(c) : null; if (d !== null) cols.set(i, { day: d, date: parseDate(c, today) }); });
    // 表头本身不带时间段（带的话是「周一 19:00-20:30 俊宇」这样一行一节的写法）
    if (!cols.size || rows[h].filter(Boolean).length < 2 || parseRange(rows[h].join(' '))) continue;
    used.add(h);
    let end = h + 1;
    while (end < rows.length && [...rows[end].keys()].filter((i) => rows[end][i] && parseDay(rows[end][i]) !== null && rows[end][i].length <= 6).length < 2) end++;
    // 第一列的时段先整列看一遍，没写上下午的按前后行的规律定
    const times = settleRows(rows.slice(h + 1, end).map((cells) => rangeOf(cells.filter((_, i) => !cols.has(i)).join(' '))));
    for (let r = h + 1; r < end; r++) {
      const cells = rows[r], slotRange = times[r - h - 1];
      for (const [i, { day, date }] of cols) {
        const cell = cells[i] ?? '';
        if (!cell || /^[-—/、\s]*$|^(休息|空|无)$/.test(cell)) continue;
        for (const part of cell.split(/[;；\n]|\s+\/\s+/).filter((p) => p.trim())) {
          const range = rangeOf(part) ?? slotRange, name = nameIn(part, names);
          if (!range || !name) continue;
          out.push({ student: name, grade: '', subject: (part.match(SUBJECT_WORDS) ?? [''])[0], day, date, start: range.start, len: range.len, topic: topicOf(part, name), repeat: true, ...(range.guess ? { guess: true } : {}) });
        }
      }
      used.add(r);
    }
  }
  // 一行一节：周三 19:00-20:30 俊宇 电磁感应 / 10月25日 14:00-16:00 欣怡
  let current: { day: number | null; date: string } = { day: null, date: '' };
  lines.forEach((line, i) => {
    if (used.has(i)) return;
    const date = parseDate(line, today), day = date ? weekday(date) : parseDay(line), range = rangeOf(line);
    if (!range) { if (day !== null) current = { day, date }; return; }
    const d = day ?? current.day, dt = day !== null ? date : current.date;
    const name = nameIn(line, names);
    if (d === null || !name) return;
    out.push({ student: name, grade: '', subject: (line.match(SUBJECT_WORDS) ?? [''])[0], day: d, date: dt, start: range.start, len: range.len, topic: topicOf(line, name), repeat: !dt || /每周|每星期|每礼拜/.test(line), ...(range.guess ? { guess: true } : {}) });
  });
  return mergeAdjacent(out);
}

/** 交给模型的提示词：今天的日期、已有学生名（方便对上号）、严格的 JSON 格式 */
export function schedulePrompt(today: Date, names: string[], text: string): string {
  const wd = '一二三四五六日'[(today.getDay() + 6) % 7];
  return [
    `今天是 ${dateKey(today)}（周${wd}）。下面是一位辅导老师的课表${text ? '' : '（见图片）'}，请把每一节课读出来。`,
    names.length ? `老师已有的学生和班组：${names.slice(0, 80).join('、')}。课表里的称呼对得上的（包括只写了名或姓+名）请直接写成这里的名字。` : '',
    '规则：',
    '- 一对二、小组课（几位学生一起上）在 student 里把每位学生的名字都写上，用顿号隔开，例如 "俊宇、欣怡"；班课写班级名，例如 "初二(3)班"。',
    '- 每周固定的课写 day（周一~周日）、repeat 为 true、date 留空；只上一次的课写 date（yyyy-mm-dd）、repeat 为 false。表头带了具体日期的周课表，date 写这一周对应的日期，repeat 为 true。',
    '- 时间一律用 24 小时制 HH:MM（两位小时，早上 7 点写 07:00）。凌晨的课照实写（例如 00:30）；过了午夜才下课的，end 照写第二天的时刻（例如 start 23:00、end 01:00）。',
    '- 只写了"7:00-8:30"之类、没写上下午的，先看同一张表里其他课的规律（比如时段从上到下按早到晚排）；实在判断不了的按下午 / 晚上写，并加上 "unsure": true。',
    '- 合并单元格或相邻时段写着同一个学生的，算一节课。空格子、"休息"、老师自己的事务不要输出，不要编造课表里没有的课。',
    '- topic 写课程内容或备注（没有就留空）；能看出来的年级、学科分别写在 grade（例如初二）、subject（例如数学），看不出来留空。',
    '输出 JSON：{"lessons":[{"student":"学生名","grade":"","subject":"","day":"周一","date":"","start":"19:00","end":"20:30","topic":"","repeat":true}]}',
    text ? '课表内容：\n' + text.slice(0, 12000) : '',
  ].filter(Boolean).join('\n');
}

// ── 预览与写入 ──
/** sure：没写上下午的课，老师在预览里看过、定下来了 */
export interface ImportRow { id: string; lesson: ImportLesson; studentId: string; use: boolean; sure?: boolean }

/** 上午 ↔ 下午：7:00 ↔ 19:00，时长不变 */
export const flipHalf = (l: ImportLesson): ImportLesson => ({ ...l, start: l.start >= 12 ? l.start - 12 : l.start + 12 });
export type RowState =
  | { kind: 'add' } | { kind: 'replace'; slots: LessonSlot[] }
  | { kind: 'conflict'; slots: LessonSlot[] } | { kind: 'clash'; with: string } | { kind: 'invalid'; why: string } | { kind: 'off' };
export const NEW = 'new';

/** 课表上写的是班课（班级名）而不是某位学生 */
export const isClassName = (name: string) => /班$|班课$|小组$|[（(]\d+[)）]班/.test(name.trim());

/**
 * 课表上的称呼对到已有学生：全名、包含（张俊宇 ↔ 俊宇）；对上多个时不猜。
 * 写了好几个人（「俊宇、欣怡」）时，每个人都对得上、并且正好有这几个人的班组才算对上。
 */
export function matchStudent(name: string, students: Student[]): Student | undefined {
  const n = name.replace(/\s|同学|老师/g, '');
  if (!n) return undefined;
  const pool = [...students].sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
  const exact = pool.find((s) => s.name === n);
  if (exact) return exact;
  const many = splitNames(name);
  if (many.length > 1) {
    const ids = many.map((x) => matchStudent(x, individuals(students))?.id);
    return ids.every(Boolean) ? findGroupFor(ids as string[], students) : undefined;
  }
  // 单个名字只在个人里模糊找：「欣怡」不该对上「俊宇、欣怡一对二」；班级名只在班组里找
  const kindPool = pool.filter((s) => isGroup(s) === isClassName(n));
  const near = kindPool.filter((s) => s.name.length >= 2 && n.length >= 2 && (s.name.includes(n) || n.includes(s.name)));
  const active = near.filter((s) => !s.archived);
  return (active.length === 1 ? active : near.length === 1 ? near : [])[0];
}

export function rowsOf(lessons: ImportLesson[], students: Student[]): ImportRow[] {
  return lessons.map((lesson, i) => ({ id: 'r' + i, lesson, studentId: matchStudent(lesson.student, students)?.id ?? NEW, use: true }));
}

/** 从生效日期起的第一个周 day */
export function firstOn(day: number, from: Date) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + (day - (d.getDay() + 6) % 7 + 7) % 7);
  return dateKey(d);
}

const HUES = [192, 338, 38, 262, 146, 18, 300, 88, 222, 0, 170, 52];
/** 新学生的学科：年级定学段，课表里的学科名定科目；都没有时跟老师现有学生最常见的学科走 */
export function subjectFor(grade: string, subject: string, students: Student[]): SubjectId {
  const counts = new Map<SubjectId, number>();
  for (const s of students) if (!s.archived) counts.set(studentSubject(s), (counts.get(studentSubject(s)) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'physics';
  const level: Level = levelOfGrade(grade) ?? packOf(usual).level;
  const word = subject.replace(/^道法$|^思想政治$/, (w) => (w === '道法' ? '道德与法治' : '政治'));
  const inLevel = byLevel(level);
  const hit = word ? inLevel.find((p) => p.name === word || p.name.includes(word) || word.includes(p.name)) : undefined;
  if (hit) return hit.id;
  return inLevel.find((p) => p.family === packOf(usual).family)?.id ?? inLevel[0]?.id ?? usual;
}

export function newStudent(name: string, grade: string, subject: string, students: Student[], n: number): Student {
  const id = subjectFor(grade, subject, students);
  return { id: crypto.randomUUID(), name, grade, subject: id, textbook: packOf(id).textbook, tags: [], hue: HUES[(students.length + n) % HUES.length], lessons: 0, lastTopic: '', lastAt: '' };
}

export interface ImportPlan {
  students: Student[]; slots: LessonSlot[];
  states: Record<string, RowState>;
  added: number; replaced: LessonSlot[]; removed: LessonSlot[]; created: Student[];
}

/**
 * 预览和写入用同一个函数：mode=merge 保留现有课表，只加新的；mode=replace 先清掉这些学生以后的课再加。
 * onConflict=keep 时和别的课撞了就跳过这一节，replace 时把撞上的旧课换掉。导入的两节互相撞时只留前一节。
 */
export function planImport(o: { rows: ImportRow[]; students: Student[]; slots: LessonSlot[]; mode: 'merge' | 'replace'; onConflict: 'keep' | 'replace'; from: Date; today: Date; newId?: () => string }): ImportPlan {
  const newId = o.newId ?? (() => crypto.randomUUID());
  const states: Record<string, RowState> = {};
  const created: Student[] = [];
  let students = [...o.students];
  const live = o.rows.filter((r) => r.use);
  for (const r of o.rows) if (!r.use) states[r.id] = { kind: 'off' };
  const made = new Map<string, string>();
  const idOf = (r: ImportRow) => {
    if (r.studentId !== NEW) return r.studentId;
    const name = r.lesson.student;
    const had = made.get(name);
    if (had) return had;
    // 年级、学科可能只写在这个学生的某一节课上
    const same = o.rows.filter((x) => x.studentId === NEW && x.lesson.student === name);
    const grade = same.find((x) => x.lesson.grade)?.lesson.grade ?? '', subject = same.find((x) => x.lesson.subject)?.lesson.subject ?? '';
    const all = () => [...o.students, ...created];
    const person = (n: string, reuse: boolean) => {
      const s = (reuse ? matchStudent(n, individuals(all())) : undefined) ?? created.find((c) => c.name === n && !isGroup(c));
      if (s) return s.id;
      const fresh = newStudent(n, grade, subject, o.students, created.length);
      created.push(fresh);
      return fresh.id;
    };
    const many = splitNames(name);
    let id: string;
    if (many.length > 1) {
      // 一对二 / 小组课：缺的成员先建上，已经有这几个人的班组就直接用
      const ids = [...new Set(many.map((n) => person(n, true)))];
      const g = findGroupFor(ids, all()) ?? makeGroup({ members: ids, hue: HUES[(o.students.length + created.length) % HUES.length] }, all());
      if (!all().includes(g)) created.push(g);
      id = g.id;
    } else if (isClassName(name)) {
      const sub = subjectFor(grade, subject, o.students);
      const g = { ...makeGroup({ name, kind: 'class', members: [], hue: HUES[(o.students.length + created.length) % HUES.length] }, all()), grade, subject: sub, textbook: packOf(sub).textbook };
      created.push(g);
      id = g.id;
    } else id = person(name, false);
    made.set(name, id);
    return id;
  };
  const valid = live.filter((r) => {
    const l = r.lesson;
    const why = !students.some((s) => s.id === r.studentId) && r.studentId !== NEW ? '学生不存在'
      : !(l.start >= 0 && l.start < 24) ? '开始时间不对' : l.len < 0.5 ? '课时至少半小时' : l.len > MAX_LEN ? `一节课最长 ${MAX_LEN} 小时` : '';
    if (why) states[r.id] = { kind: 'invalid', why };
    return !why;
  });
  const ids = new Set(valid.filter((r) => r.studentId !== NEW).map((r) => r.studentId));
  const todayKey = dateKey(o.today);
  let slots = [...o.slots];
  const removed = o.mode === 'replace' ? slots.filter((s) => ids.has(s.studentId) && (s.repeat || !s.date || s.date >= todayKey)) : [];
  if (removed.length) slots = slots.filter((s) => !removed.includes(s));
  const replaced: LessonSlot[] = [];
  const mine = new Map<string, ImportRow>();
  let added = 0;
  for (const r of valid) {
    const l = r.lesson, date = l.date || firstOn(l.day, o.from);
    const slot: LessonSlot = { id: newId(), studentId: r.studentId === NEW ? '?' : r.studentId, date, day: weekday(date), start: l.start, len: l.len, topic: l.topic || '一对一课程', repeat: l.repeat };
    const hit = conflicts(slot, slots);
    const ownHit = hit.find((s) => mine.has(s.id));
    if (ownHit) { states[r.id] = { kind: 'clash', with: mine.get(ownHit.id)!.lesson.student }; continue; }
    if (hit.length && o.onConflict === 'keep') { states[r.id] = { kind: 'conflict', slots: hit }; continue; }
    if (hit.length) { replaced.push(...hit); slots = slots.filter((s) => !hit.includes(s)); }
    slot.studentId = idOf(r);
    if (!l.topic) slot.topic = defaultTopic([...o.students, ...created].find((s) => s.id === slot.studentId));
    slots.push(slot); mine.set(slot.id, r); added++;
    states[r.id] = hit.length ? { kind: 'replace', slots: hit } : { kind: 'add' };
  }
  students = [...students, ...created];
  return { students, slots, states, added, replaced, removed, created };
}

/** 「新建学生 俊宇、欣怡，新建班组 俊宇、欣怡一对二」 */
export function createdText(list: Student[]): string {
  const p = list.filter((s) => !isGroup(s)), g = list.filter(isGroup);
  return [p.length ? '新建学生 ' + p.map((s) => s.name).join('、') : '', g.length ? '新建班组 ' + g.map((s) => s.name).join('、') : ''].filter(Boolean).join('，');
}

/** 预览里一节课的时间说明 */
export function whenText(l: Pick<ImportLesson, 'day' | 'date' | 'start' | 'len' | 'repeat'>) {
  const day = '周' + '一二三四五六日'[l.day];
  const when = l.date && !l.repeat ? `${Number(l.date.slice(5, 7))}月${Number(l.date.slice(8))}日 ${day}` : `每${day}` + (l.date ? `（${Number(l.date.slice(5, 7))}/${Number(l.date.slice(8))} 起）` : '');
  return `${when} ${spanText(l.start, l.len)}`;
}

// ── Excel / Word 文件里的文字（解压后的 XML 由调用方给） ──
const unxml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const textRuns = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => unxml(m[1])).join('');

export function sharedStrings(xml: string): string[] {
  // <rPh> 是给汉字标的拼音，不算单元格内容
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''), 't'));
}

const colIndex = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
/** 一张工作表 → 制表符分隔的文字；合并单元格把值铺满（表格识别靠它对齐时段），Excel 的时间 / 日期数字转回文字 */
export function sheetText(xml: string, shared: string[], dateStyles: Set<number> = new Set()): string {
  const grid: string[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = /\sr="(\d+)"/.exec(row[1])?.[1];
    const r = rn ? Number(rn) - 1 : grid.length;
    const cells: string[] = (grid[r] = grid[r] ?? []);
    for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? '';
      const ref = /\sr="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '', t = /\st="(\w+)"/.exec(attrs)?.[1] ?? '', s = Number(/\ss="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      let text = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? textRuns(body, 't') : unxml(v);
      if (!t && v && /^-?\d+(\.\d+)?(E-?\d+)?$/i.test(v)) {
        const n = Number(v);
        if (n > 0 && n < 1) { const m = Math.round(n * 1440); text = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
        else if (dateStyles.has(s) && n > 20000 && n < 80000) text = dateKey(new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5 + new Date().getTimezoneOffset() * 6e4));
      }
      cells[ref ? colIndex(ref) : cells.length] = text.replace(/\s*\n\s*/g, ' / ').trim();
    }
  }
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    const c0 = colIndex(m[1]), r0 = +m[2] - 1, c1 = colIndex(m[3]), r1 = +m[4] - 1, v = grid[r0]?.[c0] ?? '';
    if (!v || (r1 - r0) * (c1 - c0 + 1) > 200) continue;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { grid[r] = grid[r] ?? []; if (!grid[r][c]) grid[r][c] = v; }
  }
  return Array.from({ length: grid.length }, (_, r) => Array.from({ length: grid[r]?.length ?? 0 }, (_, c) => grid[r]?.[c] ?? '').join('\t')).filter((l) => l.replace(/\t/g, '').trim()).join('\n');
}

/** styles.xml 里是日期格式的单元格样式序号（内置 14~22、自定义含 y/m/d 的格式） */
export function dateStyleSet(xml: string): Set<number> {
  const custom = new Set([...xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].filter((m) => /[ymd]/i.test(m[2].replace(/"[^"]*"|\[[^\]]*\]/g, ''))).map((m) => +m[1]));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const out = new Set<number>();
  [...xfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => { const id = +m[1]; if ((id >= 14 && id <= 17) || id === 22 || custom.has(id)) out.add(i); });
  return out;
}

/** Word 正文：段落一行，表格每行的格子用制表符隔开 */
export function docxText(xml: string): string {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const out: string[] = [];
  const para = (p: string) => textRuns(p.replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t> / </w:t>'), 'w:t');
  for (const m of body.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    if (m[1] !== undefined) {
      for (const tr of m[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        out.push([...tr[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((tc) => [...tc[1].matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)].map((p) => para(p[1] ?? '')).filter(Boolean).join(' / ')).join('\t'));
      }
    } else out.push(para(m[2] ?? ''));
  }
  return out.filter((l) => l.replace(/\t/g, '').trim()).join('\n');
}
