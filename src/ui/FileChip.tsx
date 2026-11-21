// 本机文件按钮：1.8.0 起点击直接在当前页弹出原地轻预览（QuickPreview），不再强行跳转回上课页覆盖预监；
// 同时支持直接按住芯片拖进电脑版微信发送，以及用默认程序打开、打开所在文件夹。
// 助教回复、工具卡片、学生页的「学生资料」共用。
import { Database, ExternalLink, FileText, FolderOpen, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { host } from '../lib/host';
import { fileEntry } from '../lib/library';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { baseName, cleanPath } from '../lib/pathText';
import { importBank, parseBank, studyReady } from '../lib/agentBank';
import { subjectOfStudent } from '../lib/subjectState';
import { packOf } from '../lib/subjects';
import { openQuickPreview } from './QuickPreview';
import '../styles/filechip.css';

/** 文件名（file://、%20 之类会解码成原字） */
export const fname = (p: string) => baseName(p);
export const revealFile = (p: string) => void host.call('assistant.reveal', { path: cleanPath(p) }).catch((e) => toast((e as Error).message));
/** 用默认程序打开；这种文件不让从对话里直接开（脚本、程序等）时，给一个「在文件夹中显示」按钮，而不是只弹一句话 */
export const openFile = (p: string) => void host.call('assistant.open', { path: cleanPath(p) }).catch((e) => {
  const msg = (e as Error).message;
  toast(/不能从对话里直接打开/.test(msg) ? `「${fname(p)}」这种文件不从对话里直接运行，可以到文件夹里查看` : msg, { action: /找不到|不存在/.test(msg) ? undefined : { label: '在文件夹中显示', run: () => revealFile(p) } });
});
const canPreview = (p: string) => { try { fileEntry(cleanPath(p)); return true; } catch { return false; } };
const isJson = (p: string) => /\.json$/i.test(cleanPath(p));
/** 文件名就能看出是题库导入文件（AI 工坊 / 小羽约定的「…题库.json」） */
export const looksLikeBank = (p: string) => /题库|bank|questions?/i.test(fname(p)) && isJson(p);

/** 1.8.0 原地弹窗预览（只有老师看得到，不跳转回上课页、不覆盖预监；弹窗内可选择放入预监） */
export async function previewFile(p: string, label?: string) {
  try {
    const real = host.electron ? await host.call<string>('assistant.grant', { path: cleanPath(p) }) : cleanPath(p);
    openQuickPreview({ path: real || cleanPath(p), title: label || fname(p) });
  } catch (e) {
    toast((e as Error).message, { action: { label: '在文件夹中显示', run: () => revealFile(p) } });
  }
}

/** .json：是题库就导入题库（查重，自检过的入库、其余进收件箱）；不是就给「在文件夹中显示」 */
export async function jsonFile(p: string) {
  try {
    const json = await host.call<unknown>('assistant.readJson', { path: cleanPath(p) });
    const subject = subjectOfStudent(useStore.getState().studentId);
    let drafts: ReturnType<typeof parseBank> = [];
    try { drafts = parseBank(json, subject); } catch { /* 不是题库 */ }
    if (!drafts.length) { toast(`「${fname(p)}」是数据文件，不是题库，可以到文件夹里查看`, { action: { label: '在文件夹中显示', run: () => revealFile(p) } }); return; }
    await studyReady();
    const r = importBank(drafts, subject, '小羽 · ' + fname(p).replace(/\.json$/i, ''));
    toast(`已按${packOf(subject).stage}导入题库：入库 ${r.bank}，待核对 ${r.inbox}${r.dup ? `，重复跳过 ${r.dup}` : ''}`, { ms: 12000, action: { label: '去学情看看', run: () => useStore.getState().set({ page: 'study' }) } });
  } catch (e) { toast((e as Error).message, { action: { label: '在文件夹中显示', run: () => revealFile(p) } }); }
}

export function FileChip({ path, label, extra }: { path: string; label?: string; extra?: ReactNode }) {
  const name = fname(path), json = isJson(path), bank = json && looksLikeBank(path), pre = !json && canPreview(path);
  const main = () => (json ? void jsonFile(path) : pre ? void previewFile(path, label) : openFile(path));
  const tip = json
    ? (bank ? '导入题库：自检过的题直接入库，其余进收件箱等你核对；重复的跳过' : '是题库就导入题库，不是就在文件夹中显示')
    : pre ? '原地弹窗预览（不跳转到上课预监；按住也可直接拖进微信发送）' : '用默认程序打开';
  const onDragStart = (e: React.DragEvent) => {
    if (!host.electron || !host.startDrag) return;
    e.preventDefault();
    host.startDrag({ items: [{ path: cleanPath(path) }] });
  };
  return <span className="as-fchip" data-qa="as-file">
    <button
      className="as-fchip-main"
      title={cleanPath(path)}
      draggable={host.electron && !json}
      onDragStart={onDragStart}
      onClick={main}
      data-tip={tip}
    >
      {bank ? <Database size={12} /> : <FileText size={12} />}<span>{label && label !== name ? `${label} · ${name}` : name}</span>
    </button>
    {bank && <button className="as-fchip-b as-fchip-t" onClick={() => void jsonFile(path)} data-tip={tip} aria-label="导入题库">导入题库</button>}
    {host.electron && !json && (
      <button
        className="as-fchip-b"
        draggable
        onDragStart={onDragStart}
        onClick={() => toast('按住这个小把手不松手，直接拖到微信窗口即可发送文件')}
        data-tip="按住直接拖进微信发送"
        aria-label="拖进微信"
      >
        <GripVertical size={11} />
      </button>
    )}
    {pre && <button className="as-fchip-b" onClick={() => openFile(path)} data-tip="用默认程序打开（Word、WPS、PDF 阅读器…）" aria-label="用默认程序打开"><ExternalLink size={11} /></button>}
    <button className="as-fchip-b" onClick={() => revealFile(path)} data-tip="在文件夹中显示" aria-label="在文件夹中显示"><FolderOpen size={11} /></button>
    {extra}
  </span>;
}
