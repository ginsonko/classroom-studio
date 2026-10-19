// 当前学生的学科和学习地图（依赖 store；纯数据在 subjects/）。
import { useStore } from './store';
import { mapKey, packOf, studentSubject, type SubjectId } from './subjects';
import type { ChapterState } from './types';

export const subjectOfStudent = (studentId: string): SubjectId => studentSubject(useStore.getState().students.find((s) => s.id === studentId));
export const currentSubject = (): SubjectId => subjectOfStudent(useStore.getState().studentId);
export const useSubject = (): SubjectId => useStore((s) => studentSubject(s.students.find((x) => x.id === s.studentId)));
export const usePack = () => packOf(useSubject());

/** 学生在自己学科下的学习地图 */
export const learningOf = (studentId: string, subject = subjectOfStudent(studentId)): ChapterState[][] | undefined => useStore.getState().learning[mapKey(studentId, subject)];
export const useLearning = (studentId: string): ChapterState[][] | undefined => useStore((s) => s.learning[mapKey(studentId, studentSubject(s.students.find((x) => x.id === studentId)))]);
