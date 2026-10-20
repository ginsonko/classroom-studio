// 教师窗口里的轻提示（非错误）：几秒后自动消失，也可以带一个操作按钮
import { create } from 'zustand';

export interface Toast { id: number; message: string; action?: { label: string; run: () => void }; ms?: number }
export const useToast = create<{ list: Toast[] }>()(() => ({ list: [] }));
let seq = 0;

export function toast(message: string, o: { action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: ++seq, message, ...o };
  useToast.setState((s) => ({ list: [...s.list.filter((x) => x.message !== message), t].slice(-3) }));
  setTimeout(() => dismiss(t.id), o.ms ?? 9000);
  return t.id;
}
export const dismiss = (id: number) => useToast.setState((s) => ({ list: s.list.filter((x) => x.id !== id) }));
