// 本机文件按钮：点了在导播台阅读器里预览（只有老师看得到），旁边可以用默认程序打开、打开所在文件夹。
// 助教回复、工具卡片、学生页的「学生资料」共用。
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { host } from '../lib/host';
import { fileEntry } from '../lib/library';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { openMaterial } from '../doc/actions';
import '../styles/filechip.css';

export const fname = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const openFile = (p: string) => void host.call('assistant.open', { path: p }).catch((e) => toast((e as Error).message));
export const revealFile = (p: string) => void host.call('assistant.reveal', { path: p }).catch((e) => toast((e as Error).message));
const canPreview = (p: string) => { try { fileEntry(p); return true; } catch { return false; } };

/** 在导播台的阅读器里看（老师这边，学生看不到）；Word / PPT 会先转换 */
export async function previewFile(p: string) {
  try {
    await host.call('assistant.grant', { path: p });
    useStore.getState().set({ page: 'console' });
    const mat = await openMaterial(fileEntry(p), 'teacher');
    if (!mat) toast('没能打开预览，可以点旁边的按钮用默认程序打开');
  } catch (e) { toast((e as Error).message); }
}

export function FileChip({ path, label, extra }: { path: string; label?: string; extra?: ReactNode }) {
  const name = fname(path), pre = canPreview(path);
  return <span className="as-fchip" data-qa="as-file">
    <button className="as-fchip-main" title={path} onClick={() => (pre ? void previewFile(path) : openFile(path))} data-tip={pre ? '在导播台里预览（只有你能看到）' : '用默认程序打开'}>
      <FileText size={12} /><span>{label && label !== name ? `${label} · ${name}` : name}</span>
    </button>
    {pre && <button className="as-fchip-b" onClick={() => openFile(path)} data-tip="用默认程序打开（Word、WPS、PDF 阅读器…）" aria-label="用默认程序打开"><ExternalLink size={11} /></button>}
    <button className="as-fchip-b" onClick={() => revealFile(path)} data-tip="打开所在文件夹" aria-label="打开所在文件夹"><FolderOpen size={11} /></button>
    {extra}
  </span>;
}
