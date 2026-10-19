// 学科包汇总。知识点 key = 前缀 + "章.节"：高中物理没有前缀（兼容旧数据），高中数学 m、化学 c，其余 1～2 个小写字母。
import type { Student } from '../types';
import { bio } from './bio';
import { chem } from './chem';
import { chinese } from './chinese';
import { english } from './english';
import { geo } from './geo';
import { history } from './history';
import { jBio } from './jBio';
import { jChem } from './jChem';
import { jChinese } from './jChinese';
import { jEnglish } from './jEnglish';
import { jGeo } from './jGeo';
import { jHistory } from './jHistory';
import { jMath } from './jMath';
import { jPhysics } from './jPhysics';
import { jPolitics } from './jPolitics';
import { math } from './math';
import { pChinese } from './pChinese';
import { pEnglish } from './pEnglish';
import { pMath } from './pMath';
import { pPolitics } from './pPolitics';
import { pScience } from './pScience';
import type { Family, Level, SubjectId, SubjectPack } from './pack';
import { physics } from './physics';
import { politics } from './politics';

export type { Chapter, Family, Level, SubjectId, SubjectPack } from './pack';
export { LEVEL_NAME } from './pack';
/** 顺序就是界面里的顺序：高中 → 初中 → 小学，同学段内理科在前 */
export const SUBJECTS: SubjectPack[] = [
  physics, math, chem, bio, chinese, english, history, geo, politics,
  jMath, jPhysics, jChem, jBio, jChinese, jEnglish, jHistory, jGeo, jPolitics,
  pMath, pScience, pChinese, pEnglish, pPolitics,
];
export const SUBJECT_IDS = SUBJECTS.map((s) => s.id);
const BY_ID = new Map(SUBJECTS.map((s) => [s.id, s]));
export const isSubject = (v: unknown): v is SubjectId => typeof v === 'string' && BY_ID.has(v);
export const packOf = (id?: string | null): SubjectPack => BY_ID.get(id ?? '') ?? physics;
export const subjectName = (id?: string | null) => packOf(id).name;
/** 带学段的名字（初中数学）；同名学科在不同学段时界面上用它区分 */
export const subjectLabel = (id?: string | null) => packOf(id).stage;
export const familyOf = (id?: string | null): Family => packOf(id).family;
export const LEVELS: Level[] = ['senior', 'junior', 'primary'];
export const byLevel = (level: Level) => SUBJECTS.filter((s) => s.level === level);
/** 数学 / 化学演示目录按学科大类共用（初中数学也能用函数图像演示） */
export const kitOf = (id?: string | null): 'math' | 'chem' | null => { const f = familyOf(id); return f === 'math' || f === 'chem' ? f : null; };
/** 能不能「做成演示」：物理引擎，或数学 / 化学演示目录 */
export const hasDemo = (id?: string | null) => packOf(id).demos || kitOf(id) !== null;
/** 按年级猜学段：小学 / 初中 / 高中，猜不出返回 null */
export function levelOfGrade(grade?: string | null): Level | null {
  const g = String(grade ?? '');
  if (/高[一二三]|高中|1[0-2]年级|高考/.test(g)) return 'senior';
  if (/初[一二三]|初中|[七八九]年级|中考/.test(g)) return 'junior';
  if (/小学|[一二三四五六1-6]年级/.test(g)) return 'primary';
  return null;
}

export const pointKey = (p: SubjectPack, ci: number, si: number) => `${p.prefix}${ci}.${si}`;
const KEY = /^([a-z]{0,2})(\d{1,2})\.(\d{1,2})$/;
/** key 属于哪个学科；不是合法格式时返回 null */
export function subjectOfKey(key: string): SubjectId | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const p = SUBJECTS.find((s) => s.prefix === m[1]);
  return p && p.chapters[+m[2]]?.sec[+m[3]] !== undefined ? p.id : null;
}
/** key → 本学科内的章、节序号 */
export function localOf(key: string): { ci: number; si: number } | null {
  const m = KEY.exec(key);
  return m ? { ci: +m[2], si: +m[3] } : null;
}

/** 学生的学科（没填按高中物理，0.7 之前的学生都是物理） */
export const studentSubject = (s?: Pick<Student, 'subject'> | null): SubjectId => (isSubject(s?.subject) ? s!.subject! : 'physics');
/** 学习地图的存放位置：物理沿用学生 id，其他学科是 "学生id@学科" */
export const mapKey = (studentId: string, subject: SubjectId) => (subject === 'physics' ? studentId : `${studentId}@${subject}`);
