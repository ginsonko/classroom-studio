// AI 助手存档：每张结果卡做完就存一份（主进程 DATA/archive），可以搜索、放回面板继续用。
import type { Action, AiOut, RunMeta } from './ai';
import { host } from './host';
import { useStore } from './store';
import type { SubjectId } from './subjects';

export interface ArchiveItem { id: string; at: number; action: Action; subject: string; studentName: string; ask: string; title: string; error?: string; model: string; thumb: string }
export interface ArchiveEntry { id: string; at: number; action: Action; subject: string; studentId: string; studentName: string; ask: string; title: string; text: string; error?: string; out?: AiOut; meta?: RunMeta }

/** 卡片标题和可搜索的正文 */
export function summarize(out?: AiOut): { title: string; text: string } {
  if (!out) return { title: '', text: '' };
  switch (out.kind) {
    case 'ask': return { title: out.text.split('\n').find((l) => l.trim())?.replace(/^[#>*\s-]+/, '').slice(0, 60) ?? '', text: out.text };
    case 'explain': case 'anim': {
      const e = out.data;
      return { title: e.title, text: [e.title, e.idea, ...e.steps.map((s) => `${s.t} ${s.plain || s.tex}`), e.answer].filter(Boolean).join('\n') };
    }
    case 'draw': return { title: out.mat.title, text: out.strokes.map((s) => s.text).filter(Boolean).join(' ') };
    case 'demo': return { title: out.mat.title, text: out.note };
  }
}

export const archive = {
  /** 存档失败不影响上课，只在控制台留一条 */
  save(c: { id: string; action: Action; ask: string; at: number; out?: AiOut; meta?: RunMeta; error?: string; subject?: SubjectId }) {
    if (!host.electron) return;
    const st = useStore.getState(), stu = st.students.find((x) => x.id === st.studentId);
    const { title, text } = summarize(c.out);
    void host.call('archive.add', { id: c.id, at: c.at, action: c.action, ask: c.ask, out: c.out, meta: c.meta, error: c.error, subject: c.subject ?? '', studentId: stu?.id ?? '', studentName: stu?.name ?? '', title, text })
      .catch((e) => console.warn('AI 存档失败', e));
  },
  list: (o: { q?: string; action?: string; subject?: string; studentId?: string; before?: number; limit?: number }) => host.call<{ items: ArchiveItem[]; total: number; dir: string }>('archive.list', o),
  get: (id: string) => host.call<ArchiveEntry>('archive.get', id),
  remove: (id: string) => host.call<boolean>('archive.remove', id),
  folder: () => host.call<string>('archive.folder'),
};

/** 存档里的图片是本机文件路径，显示前换成可加载的地址 */
export const mediaUrl = (s?: string) => (!s ? '' : /^(data|https?|lesson|studio):/i.test(s) ? s : host.fileUrl(s));

/** 存档 → 可以放回面板的结果卡内容 */
export function revive(e: ArchiveEntry): { out?: AiOut; meta?: RunMeta } {
  const meta = e.meta ? { ...e.meta, image: mediaUrl(e.meta.image) || undefined } : undefined;
  let out = e.out;
  if (out?.kind === 'demo' && out.preview) out = { ...out, preview: mediaUrl(out.preview) };
  if (out?.kind === 'anim' && out.video?.sheet) out = { ...out, video: { ...out.video, sheet: mediaUrl(out.video.sheet) } };
  return { out, meta };
}
