import { create } from 'zustand';
import { prepareMaterial, type FileEntry } from '../lib/library';
import { defaultView, useStore } from '../lib/store';
import type { View } from '../lib/types';
import { errorText, useLib } from '../lib/useLib';

export type MaterialTarget = 'teacher' | 'student' | 'cue';
type LoadInfo = { target: MaterialTarget; name: string; message: string; error?: string };
export const useMaterialLoad = create<{ active: LoadInfo | null }>(() => ({ active: null }));
const seq: Record<MaterialTarget, number> = { teacher: 0, student: 0, cue: 0 };
export function claimMaterialTarget(target: MaterialTarget) {
  const token = ++seq[target];
  return () => token === seq[target];
}

export function cancelMaterialLoad(target?: MaterialTarget) {
  if (target) seq[target]++; else for (const t of ['teacher', 'student', 'cue'] as const) seq[t]++;
  useMaterialLoad.setState({ active: null });
}

export function reportMaterialError(error: unknown, name = '课件', target: MaterialTarget = 'teacher') {
  useMaterialLoad.setState({ active: { target, name, message: '打开失败', error: errorText(error) } });
}

/** 同一发布目标只接受最新选择。转换失败、文件移动或用户取消都不替换当前画面。 */
export async function openMaterial(input: FileEntry | Promise<FileEntry | null>, target: MaterialTarget, view?: Partial<View>) {
  const token = ++seq[target];
  let name = '课件';
  useMaterialLoad.setState({ active: { target, name, message: '正在读取课件…' } });
  try {
    const f = await input;
    if (token !== seq[target]) return null;
    if (!f) { useMaterialLoad.setState({ active: null }); return null; }
    name = f.title;
    useMaterialLoad.setState({ active: { target, name: f.title, message: ['word', 'slides'].includes(f.kind) ? '正在准备分页课件…' : '正在读取原课件…' } });
    const mat = await prepareMaterial(f, (p) => {
      if (token === seq[target]) useMaterialLoad.setState({ active: { target, name: f.title, message: p.message || (p.stage === 'queued' ? '等待转换…' : '正在转换课件…') } });
    });
    if (token !== seq[target]) return null;
    const st = useStore.getState();
    if (target === 'teacher') st.open(mat, view?.page);
    else if (target === 'cue') st.cue(mat, view);
    else st.showNow(mat, view);
    if (useMaterialLoad.getState().active?.target === target) useMaterialLoad.setState({ active: null });
    // 原卷上屏时可私下打开解析；若老师在期间选择了其它材料则不抢阅读器。
    if (target === 'student' && mat.pairRole === 'question' && mat.pairId) {
      const pair = useLib.getState().lib?.files.get(mat.pairId), teacherAt = seq.teacher;
      if (pair) void prepareMaterial(pair).then((answer) => {
        if (token !== seq.student || teacherAt !== seq.teacher) return;
        const current = useStore.getState();
        current.set({ reader: { mat: answer, view: defaultView(answer, { page: Math.min(view?.page ?? 0, answer.pages.length - 1) }), split: null } });
      }).catch((e) => reportMaterialError(e, '解析版 · ' + pair.title, 'teacher'));
    }
    return mat;
  } catch (e) {
    if (token === seq[target]) reportMaterialError(e, name, target);
    return null;
  }
}
