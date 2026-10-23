// 班组：一对二、小组课（一对多）、班课。班组也是一条 Student 记录（kind + members），
// 所以课表、上课绑定、录像归档、提醒都不用另外处理；作答、错题、课后总结、发家长落到每位成员。
import type { GroupKind, Student } from './types';

export const GROUP_KINDS: { id: GroupKind; name: string; desc: string }[] = [
  { id: 'pair', name: '一对二', desc: '两位学生一起上' },
  { id: 'small', name: '小组课', desc: '一对多，3～8 人左右' },
  { id: 'class', name: '班课', desc: '整班上课，人数不限' },
];
export const kindName = (k?: GroupKind) => GROUP_KINDS.find((x) => x.id === k)?.name ?? '';
export const isGroup = (s?: Pick<Student, 'kind'> | null): boolean => !!s?.kind;
/** 按人数推荐类型 */
export const kindFor = (n: number): GroupKind => (n <= 2 ? 'pair' : n <= 8 ? 'small' : 'class');

/** 班组的成员（按 members 顺序；已删除的跳过） */
export function membersOf(g: Pick<Student, 'members'> | undefined | null, students: Student[]): Student[] {
  const by = new Map(students.map((s) => [s.id, s]));
  return (g?.members ?? []).map((id) => by.get(id)).filter((s): s is Student => !!s && !isGroup(s));
}
/** 这位学生在哪些班组里 */
export const groupsOf = (studentId: string, students: Student[]) => students.filter((g) => isGroup(g) && g.members?.includes(studentId));
/** 作答、课后总结真正落到的人：学生自己，或班组的全部成员 */
export function peopleOf(id: string, students: Student[]): Student[] {
  const s = students.find((x) => x.id === id);
  if (!s) return [];
  return isGroup(s) ? membersOf(s, students) : [s];
}
export const individuals = (students: Student[]) => students.filter((s) => !isGroup(s));
export const groups = (students: Student[]) => students.filter(isGroup);

/** 「初二(3)班（班课 · 32 人）」 */
export function whoText(s: Student, students: Student[]): string {
  if (!isGroup(s)) return s.name;
  return `${s.name}（${kindName(s.kind)} · ${membersOf(s, students).length} 人）`;
}
/** 成员名单的简短写法：「王小明、李华 等 5 人」 */
export function memberText(g: Student, students: Student[], max = 3): string {
  const m = membersOf(g, students);
  if (!m.length) return '还没有成员';
  return m.slice(0, max).map((x) => x.name).join('、') + (m.length > max ? ` 等 ${m.length} 人` : '');
}

/** 正好是这几个人的班组（顺序无关） */
export function findGroupFor(ids: string[], students: Student[]): Student | undefined {
  const want = [...new Set(ids)].sort().join('|');
  return students.find((g) => isGroup(g) && !g.archived && [...new Set(g.members ?? [])].sort().join('|') === want);
}

/** 新建班组：学科、年级、教材默认跟第一位成员 */
export function makeGroup(o: { name?: string; kind?: GroupKind; members: string[]; id?: string; hue?: number }, students: Student[]): Student {
  const mem = o.members.map((id) => students.find((s) => s.id === id)).filter((s): s is Student => !!s && !isGroup(s));
  const first = mem[0];
  const name = (o.name ?? '').trim() || mem.map((s) => s.name).slice(0, 3).join('、') + (mem.length > 3 ? '等' : '') + (mem.length <= 2 ? '一对二' : '小组');
  return {
    id: o.id ?? crypto.randomUUID(), name: name.slice(0, 60), grade: first?.grade ?? '', subject: first?.subject, textbook: first?.textbook ?? '',
    tags: [], hue: o.hue ?? (students.length * 137 + 40) % 360, lessons: 0, lastTopic: first?.lastTopic ?? '', lastAt: '',
    kind: o.kind ?? kindFor(mem.length), members: [...new Set(mem.map((s) => s.id))],
  };
}

/** 课表上没写内容时的默认标题 */
export const defaultTopic = (s?: Pick<Student, 'kind'> | null) => (s?.kind === 'pair' ? '一对二课程' : s?.kind ? kindName(s.kind) : '一对一课程');
export const isDefaultTopic = (t?: string) => !t || /^(一对[一二]课程|小组课|班课)$/.test(t);

/** 课表、文件里写的「王小明、李华」「王小明/李华」「王小明+李华」拆成名字 */
export function splitNames(text: string): string[] {
  // 「和」只认两边有空格的：名字里本来就可能有「和」（王和平）
  return text.split(/[、，,/／+＋&＆;；]|\s和\s/).map((x) => x.trim()).filter(Boolean);
}
