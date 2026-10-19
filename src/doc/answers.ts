// 答案页：学生端默认遮住，老师揭晓后才显示。标记来自文字识别（PDF 文字层 / PPT 文本框 / 整页图片 OCR）或老师手动标记（按文件记住）。
// 老师可在设置里整体关闭遮挡（answerGuard），也可以关闭自动识别（answerAutoDetect）。
import { useEffect } from 'react';
import type { AnswerMark, Material } from '../lib/types';
import { useStore, ROLE } from '../lib/store';
import { host } from '../lib/host';
import { pdfPageLines } from './pdf';
import { detectAnswers, detectAnswerPages, type PageLines } from './answerDetect';
export { detectAnswerPages, detectAnswers };

export const answerKey = (matId: string, page: number) => `${matId}#${page}`;

export function isAnswer(mat: Material, page: number) { return !!mat.answerPages?.includes(page); }

export function hiddenFromStudent(mat: Material, page: number, revealed: string[], guard = true) {
  return guard && isAnswer(mat, page) && !revealed.includes(answerKey(mat.id, page));
}

/** 答案从页面多高处开始（0 = 整页都是答案） */
export function coverFrom(mat: Material, page: number) {
  const y = mat.answerFrom?.[page];
  return typeof y === 'number' && y > 0 && y < 0.95 ? y : 0;
}

function normalMark(v: number[] | AnswerMark | undefined): AnswerMark | null {
  if (!v) return null;
  // 0.4.0 没识别到时会存下空数组，那不算老师确认过，允许重新识别
  if (Array.isArray(v)) return v.length ? { pages: v.filter(Number.isInteger) } : null;
  return { pages: (v.pages ?? []).filter(Number.isInteger), from: v.from };
}

async function pageLines(mat: Material): Promise<PageLines[] | null> {
  const path = mat.src?.path;
  if (!path) return null;
  if (mat.src?.render === 'pdf' && mat.src.pdf) return pdfPageLines(mat.src.pdf, Math.min(mat.total, 120));
  if (mat.src?.render === 'images' && /\.pptx?$/i.test(path) && host.electron) return host.call<PageLines[] | null>('slideTexts', path);
  return null;
}

/** 老师在当前文件上的答案页标记（老师确认过的优先，其次自动识别） */
export async function marksFor(mat: Material): Promise<(AnswerMark & { auto: boolean }) | null> {
  const path = mat.src?.path;
  if (!path) return null;
  const st = useStore.getState(), saved = normalMark(st.answerMarks[path]);
  if (saved) return { ...saved, auto: false };
  if (!st.answerAutoDetect || mat.total < 2) return null;
  const pages = await pageLines(mat);
  if (!pages?.length) return null;
  const found = detectAnswers(pages.slice(0, mat.total));
  return found.pages.length ? { pages: found.pages, from: found.from, auto: true } : null;
}

/** 学生画面换课件时，套用答案页标记（只在教师窗口执行） */
export async function applyMarks(mat: Material) {
  if (ROLE !== 'teacher' || mat.answerPages !== undefined || !mat.src?.path) return;
  try {
    const m = await marksFor(mat);
    const st = useStore.getState();
    if (st.pgmMat.id !== mat.id || st.pgmMat.answerPages !== undefined) return;
    st.setShared({ pgmMat: { ...st.pgmMat, answerPages: m?.pages ?? [], answerFrom: m?.from, answerAuto: m ? m.auto : undefined } });
  } catch { /* 识别失败不影响上课 */ }
}

/** 重新识别当前课件（老师打开自动识别、或想丢掉手动标记时用） */
export async function redetect() {
  const st = useStore.getState(), mat = st.pgmMat, path = mat.src?.path;
  if (!path) return;
  if (st.answerMarks[path]) { const { [path]: _, ...rest } = st.answerMarks; st.set({ answerMarks: rest }); }
  st.setShared({ pgmMat: { ...mat, answerPages: undefined, answerFrom: undefined, answerAuto: undefined } });
}

/** 老师手动切换某页是否为答案页；按文件路径记住。手动标的页整页遮住。 */
export function toggleAnswerPage(page: number) {
  const st = useStore.getState(), mat = st.pgmMat;
  const set = new Set(mat.answerPages ?? []);
  const from = { ...mat.answerFrom };
  if (set.has(page)) set.delete(page); else set.add(page);
  delete from[page];
  const pages = [...set].sort((a, b) => a - b);
  st.setShared({ pgmMat: { ...mat, answerPages: pages, answerFrom: from, answerAuto: false } });
}

/**
 * 教师窗口里运行：学生画面换课件时套用标记；老师（可能在浮层里）改了标记后按文件路径记住。
 * 浮层窗口没有本地存档，所以记忆统一放在教师窗口做。
 */
export function useAnswerMarks() {
  const mat = useStore((s) => s.pgmMat);
  useEffect(() => {
    if (ROLE !== 'teacher' || !mat.src?.path) return;
    if (mat.answerPages === undefined) { void applyMarks(mat); return; }
    if (mat.answerAuto !== false) return;
    const st = useStore.getState(), prev = normalMark(st.answerMarks[mat.src.path]);
    const next: AnswerMark = { pages: mat.answerPages, ...(mat.answerFrom && Object.keys(mat.answerFrom).length ? { from: mat.answerFrom } : {}) };
    if (JSON.stringify(prev) !== JSON.stringify(next)) st.set({ answerMarks: { ...st.answerMarks, [mat.src.path]: next } });
  }, [mat]);
}

/** 打开 / 关闭自动识别（教师窗口本地设置）；当前课件没有老师确认过的标记时立即按新设置重算 */
export function setAnswerAutoDetect(on: boolean) {
  const st = useStore.getState();
  st.set({ answerAutoDetect: on });
  const mat = st.pgmMat;
  if (mat.src?.path && mat.answerAuto !== false) st.setShared({ pgmMat: { ...mat, answerPages: undefined, answerFrom: undefined, answerAuto: undefined } });
}

export function toggleReveal(matId: string, page: number) {
  const st = useStore.getState(), key = answerKey(matId, page);
  st.setShared({ revealed: st.revealed.includes(key) ? st.revealed.filter((k) => k !== key) : [...st.revealed, key] });
}
