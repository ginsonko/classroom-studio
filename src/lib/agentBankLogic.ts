// AI 工作室写的「…题库.json」→ 待导入的题。纯函数，Node 里可以直接测试。
import { guessType } from './studyLogic';
import { packOf, type SubjectId } from './subjects';

export interface BankDraft { stem: string; answer: string; analysis: string; qtype: string; difficulty: number; verified: boolean }

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** 宽松读取：字段缺了就补默认值，题型不在本学科清单里时按题干猜 */
export function parseBank(json: unknown, subject: SubjectId): BankDraft[] {
  const list = Array.isArray(json) ? json : (json as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) throw new Error('题库文件里没有 questions 列表');
  const types = packOf(subject).qtypes;
  const out: BankDraft[] = [];
  for (const raw of list.slice(0, 200)) {
    const q = (raw ?? {}) as Record<string, unknown>;
    const stem = str(q.stem, 4000);
    if (stem.length < 4) continue;
    const t = str(q.qtype ?? q.type, 20);
    const d = Math.round(Number(q.difficulty));
    out.push({
      stem, answer: str(q.answer, 2000), analysis: str(q.analysis, 4000),
      qtype: types.includes(t) ? t : guessType(stem, subject),
      difficulty: d >= 1 && d <= 5 ? d : 3,
      verified: q.verified === true,
    });
  }
  return out;
}
