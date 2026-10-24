// AI 面板的附件：图片压成 JPEG 交给看图模型，文档抽出文字交给模型读题。
// 粘贴（Ctrl+V）、拖进来、点「添加附件」都走这里。一次最多 6 个，单个最大 30 MB。
import { host } from './host';
import { readSource } from './scheduleAi';

export interface Attach {
  id: string;
  name: string;
  kind: 'image' | 'doc';
  /** 图片：发给模型的 dataURL（已经缩过、压过） */
  image?: string;
  /** 文档：抽出来的文字 */
  text?: string;
  /** 附带的说明，例如「文件很长，只发了前一段」 */
  note?: string;
}

export const ATTACH_MAX = 6;
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_TEXT = 200000;
const MAX_PAGES = 12;
const MAX_SIDE = 1600;
const IMAGE = /\.(png|jpe?g|bmp|webp)$/i;
// 白名单和 electron/files.cjs 的 convert 保持一致：能读的才收，读不了的当场说清楚
const DOC = /\.(pdf|docx?|pptx?|rtf|xlsx|csv|txt|md|markdown)$/i;

const uid = () => Math.random().toString(36).slice(2, 10);
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const ok = (p: string) => IMAGE.test(p) || DOC.test(p);

/** 图片 → JPEG data URL（缩到 1600px 以内）：题目照片和截图都够清楚，又比 PNG 小得多，一次能多发几张 */
function photoData(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      try {
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.9));
      } catch (e) { reject(e); } finally { c.width = 0; c.height = 0; }
    };
    img.onerror = () => reject(new Error('这张图片打不开，可能已损坏或格式不支持'));
    img.src = url;
  });
}

async function blobPhoto(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try { return await photoData(url); } finally { URL.revokeObjectURL(url); }
}

/** 绝对路径 → 附件（拖入、选择文件走这里） */
export async function attachFromPath(path: string, onStep?: (t: string) => void): Promise<Attach> {
  const name = baseName(path);
  if (!ok(path)) throw new Error(`「${name}」这种格式还不能当附件。支持图片、PDF、Word、PPT、Excel、txt / md。`);
  if (IMAGE.test(path)) return { id: uid(), name, kind: 'image', image: await photoData(host.fileUrl(path)) };
  const src = await readSource(path, onStep, MAX_PAGES);
  const all = src.text.trim();
  if (!all) throw new Error(`「${name}」里没有读到文字（可能是扫描件），可以打开它截图后直接粘贴。`);
  const text = all.slice(0, MAX_TEXT);
  return { id: uid(), name, kind: 'doc', text, ...(text.length < all.length ? { note: `文件很长，只发了前 ${Math.round(MAX_TEXT / 10000)} 万字` } : {}) };
}

/** 拖入 / 粘贴的 File → 附件；拿不到绝对路径时（浏览器样稿、网页里复制的图片）只有图片能直接读 */
export async function attachFromFile(f: File, onStep?: (t: string) => void): Promise<Attach> {
  const name = f.name || '粘贴的图片';
  if (f.size > MAX_BYTES) throw new Error(`「${name}」太大了（超过 30 MB），请先压缩，或只截取要讲的那部分。`);
  const path = host.pathForFile(f);
  if (path) return attachFromPath(path, onStep);
  if (!/^image\//.test(f.type)) throw new Error('这个文件读不到路径，只能粘贴图片。请在桌面版里拖进来，或点「添加附件」选择文件。');
  return { id: uid(), name, kind: 'image', image: await blobPhoto(f) };
}

/** 主进程从系统剪贴板读到的图片（微信 / QQ 里「复制」的图片拿不到 File） */
export async function attachFromDataUrl(name: string, data: string): Promise<Attach> {
  return { id: uid(), name, kind: 'image', image: await photoData(data) };
}

/** 一批文件 → 附件：到上限就停，读不出来的只记原因，不影响其它文件 */
async function readEach<T>(list: T[], now: Attach[], read: (x: T) => Promise<Attach>): Promise<{ added: Attach[]; errors: string[] }> {
  const added: Attach[] = [], errors: string[] = [];
  let room = ATTACH_MAX - now.length;
  for (const x of list) {
    if (room <= 0) { errors.push(`一次最多 ${ATTACH_MAX} 个附件，多的没有加进来`); break; }
    try {
      const a = await read(x);
      if ([...now, ...added].some((y) => y.name === a.name)) continue;
      added.push(a); room--;
    } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  return { added, errors };
}

/** 拖入 / 粘贴的文件 */
export const addFiles = (list: File[], now: Attach[], onStep?: (t: string) => void) => readEach(list, now, (f) => attachFromFile(f, onStep));
/** 点「添加附件」选中的路径 */
export const addPaths = (list: string[], now: Attach[], onStep?: (t: string) => void) => readEach(list, now, (p) => attachFromPath(p, onStep));

/** 弹系统文件对话框选附件（多选） */
export const pickAttachments = () => host.call<string[]>('pickAttach');

/** 附件写进提示词：图片只报名字（本体走 image_url），文档把文字带上 */
export function attachPrompt(list: Attach[]): string {
  if (!list.length) return '';
  const imgs = list.filter((a) => a.kind === 'image'), docs = list.filter((a) => a.kind === 'doc');
  const out: string[] = [];
  if (imgs.length) out.push(`老师另外附上了 ${imgs.length} 张图片：${imgs.map((a) => a.name).join('、')}。`);
  for (const a of docs) out.push(`【附件：${a.name}】\n${a.text}`);
  return out.join('\n\n');
}

/** 发给模型的图片（顺序就是附件顺序） */
export const attachImages = (list: Attach[]) => list.map((a) => a.image).filter((x): x is string => !!x);
/** 存档 / 卡片上显示用 */
export const attachNames = (list: Attach[]) => list.map((a) => a.name);
