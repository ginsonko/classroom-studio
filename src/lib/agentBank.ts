// AI 工作室出的题导入学情题库：查重，自检通过的直接入库，其余放进收件箱等老师核对。
import { addQuestion, ensureStudy, useStudy } from './studyStore';
import { findDuplicate, guessPoints, type Question } from './studyLogic';
import type { SubjectId } from './subjects';
import type { BankDraft } from './agentBankLogic';

export { parseBank } from './agentBankLogic';

/** 学情库没读进来之前改动会被随后的读取覆盖，所以先等它读完 */
export async function studyReady(): Promise<void> {
  ensureStudy();
  if (!useStudy.getState().loaded) {
    await new Promise<void>((resolve) => {
      const off = useStudy.subscribe((s) => { if (s.loaded) { off(); resolve(); } });
      if (useStudy.getState().loaded) { off(); resolve(); }
    });
  }
  const err = useStudy.getState().error;
  if (err) throw new Error(err);
}

/** 导入：返回新入库、放进收件箱、重复跳过的数量 */
export function importBank(drafts: BankDraft[], subject: SubjectId, source: string): { bank: number; inbox: number; dup: number } {
  const r = { bank: 0, inbox: 0, dup: 0 };
  for (const d of drafts) {
    const pool: Question[] = useStudy.getState().data.questions;
    if (findDuplicate(d.stem, pool)) { r.dup++; continue; }
    addQuestion({
      stem: d.stem, answer: d.answer, analysis: d.analysis, points: guessPoints(d.stem + ' ' + d.analysis, subject), subject,
      difficulty: d.difficulty, qtype: d.qtype, origin: 'ai', status: d.verified ? 'bank' : 'inbox',
      check: d.verified ? 'ok' : 'unchecked', ...(d.verified ? {} : { checkNote: 'AI 没有确认自检，请核对答案' }), source,
    });
    if (d.verified) r.bank++; else r.inbox++;
  }
  return r;
}
