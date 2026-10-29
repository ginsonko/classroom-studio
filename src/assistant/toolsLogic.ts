// AI 助教工具的纯逻辑：找学生、读时间、展开课表、整轮撤销。不碰窗口，Node 里可以直接测试。
import type { LessonSlot, Student } from '../lib/types';
import { conflicts, dateKey, localDate, MAX_LEN, onDate, spanText } from '../doc/scheduleModel';
import { defaultTopic, findGroupFor, groupsOf, individuals, isGroup, kindName, membersOf, splitNames } from '../lib/groups';

export const WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 按 id 或名字找学生；名字有歧义、找不到都抛错，错误里列出候选，AI 看了能自己改 */
export function pickStudent(list: Student[], ref: unknown, o: { archived?: boolean } = {}): Student {
  const q = String(ref ?? '').trim();
  if (!q) throw Error('没有说是哪位学生');
  const pool = o.archived ? list : list.filter((s) => !s.archived);
  const byId = list.find((s) => s.id === q);
  if (byId) return byId;
  const exact = pool.filter((s) => s.name === q);
  if (exact.length === 1) return exact[0];
  const part = (exact.length ? exact : pool.filter((s) => s.name.includes(q) || q.includes(s.name)));
  if (part.length === 1) return part[0];
  // 「俊宇」既像张俊宇、又在「张俊宇、欣怡一对二」的名字里：说的是人
  const solo = part.filter((s) => !s.kind);
  if (part.length > 1 && solo.length === 1) return solo[0];
  if (part.length > 1) throw Error(`「${q}」对应多位学生：${part.map((s) => `${s.name}（${s.grade || '年级未填'}，id=${s.id}）`).join('、')}，请用 id 指定`);
  const arch = list.filter((s) => s.archived && s.name.includes(q));
  if (arch.length) throw Error(`「${q}」已经归档了（id=${arch[0].id}），需要先恢复`);
  throw Error(`没有叫「${q}」的学生。现有学生：${pool.map((s) => s.name).join('、') || '还没有学生'}`);
}

/**
 * 「俊宇、欣怡」或 ["俊宇","欣怡"]：几位学生一起上。一个个找人，正好是这几个人的班组就用它；
 * 没有这样的班组时 group 为空，由调用的地方决定要不要新建。只有一个人时返回 null。
 */
export function pickPeople(list: Student[], ref: unknown): { group?: Student; members: Student[] } | null {
  const raw = Array.isArray(ref) ? ref.map((x) => String(x).trim()).filter(Boolean) : splitNames(String(ref ?? ''));
  if (raw.length < 2) return null;
  if (!Array.isArray(ref)) {
    const q = String(ref).trim(), whole = list.find((s) => !s.archived && (s.id === q || s.name === q));
    if (whole) return isGroup(whole) ? { group: whole, members: membersOf(whole, list) } : null;
  }
  const members = [...new Map(raw.map((n) => pickStudent(individuals(list), n)).map((s) => [s.id, s])).values()];
  if (members.length < 2) return null;
  return { group: findGroupFor(members.map((m) => m.id), list), members };
}

/** "19:30" / "7:30" / "19.5" / 19.5 → 小时数；读不出来返回 NaN */
export function hours(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  let m = /^(\d{1,2})[:：](\d{1,2})$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(\d{1,2})(?:\.(\d+))?$/.exec(s);
  if (m) return Number(s);
  return NaN;
}

/** "2026-10-23" 校验；不合法抛错 */
export function day(v: unknown, what = '日期'): string {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(localDate(s).getTime()) || dateKey(localDate(s)) !== s) throw Error(`${what}要写成 YYYY-MM-DD，例如 ${dateKey(new Date())}`);
  return s;
}

export interface LessonArgs { student?: unknown; date?: unknown; start?: unknown; minutes?: unknown; end?: unknown; topic?: unknown; repeat_weekly?: unknown }

/** 工具参数 → 一节课；base 是改课时的原来那节（没给的字段沿用） */
export function lessonFrom(a: LessonArgs, students: Student[], base?: LessonSlot, newId: () => string = () => crypto.randomUUID()): LessonSlot {
  const studentId = a.student !== undefined && a.student !== '' ? pickStudent(students, a.student).id : base?.studentId;
  if (!studentId) throw Error('没有说是哪位学生的课');
  const date = a.date !== undefined && a.date !== '' ? day(a.date) : base?.date ?? '';
  if (!date) throw Error('缺少上课日期（YYYY-MM-DD）');
  const start = a.start !== undefined && a.start !== '' ? hours(a.start) : base?.start ?? NaN;
  if (!(start >= 0 && start < 24)) throw Error('开始时间要写成 HH:MM（24 小时制），例如 19:00');
  let len = base?.len ?? 1;
  if (a.minutes !== undefined && a.minutes !== '') len = Number(a.minutes) / 60;
  else if (a.end !== undefined && a.end !== '') { let e = hours(a.end); if (e <= start) e += 24; len = e - start; }
  if (!(len >= 0.5 && len <= MAX_LEN)) throw Error(`时长要在 30 分钟到 ${MAX_LEN} 小时之间`);
  const repeat = a.repeat_weekly === undefined ? base?.repeat ?? false : a.repeat_weekly === true || a.repeat_weekly === 'true';
  const topic = a.topic !== undefined ? String(a.topic).trim().slice(0, 60) : base?.topic ?? '';
  const g = students.find((s) => s.id === studentId && isGroup(s));
  return { id: base?.id ?? newId(), studentId, date, day: (localDate(date).getDay() + 6) % 7, start: Math.round(start * 4) / 4, len: Math.round(len * 4) / 4, topic: topic || defaultTopic(g), repeat };
}

export function lessonText(s: LessonSlot, students: Student[]) {
  const st = students.find((x) => x.id === s.studentId);
  const who = st ? (isGroup(st) ? `${st.name}（${kindName(st.kind)}）` : st.name) : '（已删除的学生）';
  return `${who} ${s.repeat ? '每' + WEEK[s.day] + (s.date ? '（从 ' + s.date + ' 起）' : '') : (s.date ? s.date + ' ' : '') + WEEK[s.day]} ${spanText(s.start, s.len)} ${s.topic}`;
}

/** 和别的课撞了就抛错（说清楚撞了哪节） */
export function checkClash(s: LessonSlot, slots: LessonSlot[], students: Student[]) {
  const hit = conflicts(s, slots);
  if (hit.length) throw Error(`和「${lessonText(hit[0], students)}」时间重叠（id=${hit[0].id}）。可以换个时间，或先调整那节课`);
}

export interface Occurrence { id: string; studentId: string; student: string; date: string; weekday: string; time: string; topic: string; repeat: boolean; minutes: number; group?: string; members?: string[] }
/** 从 from 起 days 天里每一节课（每周重复的课展开成每一次）。只看某位学生时，他所在班组的课也算 */
export function occurrences(slots: LessonSlot[], students: Student[], from: Date, days: number, studentId?: string): Occurrence[] {
  const out: Occurrence[] = [];
  const mine = studentId ? new Set([studentId, ...groupsOf(studentId, students).map((g) => g.id)]) : null;
  for (let n = 0; n < days; n++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);
    for (const s of slots) {
      if (mine && !mine.has(s.studentId)) continue;
      if (!onDate(s, d)) continue;
      const st = students.find((x) => x.id === s.studentId);
      if (st?.archived) continue;
      const g = isGroup(st) ? { group: kindName(st!.kind), members: membersOf(st, students).map((m) => m.name) } : {};
      out.push({ id: s.id, studentId: s.studentId, student: st?.name ?? '（已删除的学生）', date: dateKey(d), weekday: WEEK[(d.getDay() + 6) % 7], time: spanText(s.start, s.len), topic: s.topic, repeat: !!s.repeat, minutes: Math.round(s.len * 60), ...g });
    }
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ── 整轮撤销 ──────────────────────────────────────────
export type Kind = 'student' | 'slot' | 'question' | 'attempt' | 'lesson' | 'homework' | 'note' | 'prep' | 'file' | 'map' | 'trigger' | 'memory';
/** 一处改动：before / after 是整条记录（null = 不存在） */
export interface Change { kind: Kind; id: string; before: unknown; after: unknown }
export interface Box { get(kind: Kind, id: string): unknown; put(kind: Kind, id: string, value: unknown): void }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 同一条记录一轮里改了几次：合成一次（最早的 before + 最后的 after） */
export function squash(list: Change[]): Change[] {
  const map = new Map<string, Change>();
  for (const c of list) {
    const k = c.kind + ':' + c.id, old = map.get(k);
    map.set(k, old ? { ...old, after: c.after } : { ...c });
  }
  return [...map.values()].filter((c) => !same(c.before, c.after));
}

/** 撤销：每条记录放回 before；之后老师又改过的（现在 ≠ after）不动，免得冲掉老师的修改 */
export function undoChanges(list: Change[], box: Box): { restored: number; skipped: Change[] } {
  const all = squash(list).reverse();
  let restored = 0; const skipped: Change[] = [];
  for (const c of all) {
    if (!same(box.get(c.kind, c.id), c.after)) { skipped.push(c); continue; }
    box.put(c.kind, c.id, c.before ?? null);
    restored++;
  }
  return { restored, skipped };
}

/** 列表里按 id 放回 / 删除一条（undo 用） */
export function putIn<T extends { id: string }>(list: T[], id: string, value: T | null): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (value === null) return i < 0 ? list : list.filter((x) => x.id !== id);
  return i < 0 ? [...list, value] : list.map((x) => (x.id === id ? value : x));
}

/** 卡片上的一句话：哪些东西会被撤回 */
export function changeSummary(list: Change[]): string {
  const NAME: Record<Kind, string> = { student: '学生', slot: '节课', question: '道题', attempt: '条作答', lesson: '份课后总结', homework: '份作业', note: '条学生资料', prep: '份备课', file: '个学生文件', map: '位学生的学习地图', trigger: '个提醒', memory: '条记忆' };
  const n = new Map<Kind, number>();
  for (const c of squash(list)) n.set(c.kind, (n.get(c.kind) ?? 0) + 1);
  return [...n].map(([k, v]) => (k === 'student' ? `${v} 位学生` : `${v} ${NAME[k]}`)).join('、');
}

/** 工具参数的 JSON Schema（Codex dynamicTools 用） */
export type Param = { type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'; description: string; enum?: string[]; items?: { type: string; enum?: string[] }; minimum?: number; maximum?: number };
export function schema(params: Record<string, Param>, required: string[] = []) {
  return { type: 'object', properties: params, required, additionalProperties: false };
}

/** 工具清单的指纹：工具变了（软件升级）旧会话就开新会话 */
export function signature(tools: unknown[]): string {
  const s = JSON.stringify(tools);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + '-' + tools.length;
}
