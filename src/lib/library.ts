import { pinyin } from 'pinyin-pro';
import type { Kind, Material, PageInfo } from './types';
import { host, type ConvertProgress } from './host';
import { assetUrl, imageSize, pdfPages, pdfRaster } from '../doc/pdf';

/** tree.json 的紧凑格式：{ n, d?: Node[], f?: [name, kind, size][] } */
interface RawNode { n: string; d?: RawNode[]; f?: [string, Kind, number][] }

export interface FolderNode {
  id: string;            // 相对路径，'' 为根
  name: string;
  folders: FolderNode[];
  files: FileEntry[];
  count: number;         // 子树文件总数
}

export interface FileEntry {
  id: string;            // 相对路径
  name: string;
  title: string;         // 去掉扩展名
  kind: Kind;
  size: number;
  folder: string;
  ext: string;
  pairId?: string;
  pairRole?: 'question' | 'answer';
  path?: string;         // 桌面版绝对路径；样稿留空
  root?: string;
}

export interface Library {
  root: FolderNode;
  folders: Map<string, FolderNode>;
  files: Map<string, FileEntry>;
  list: FileEntry[];
}

const EXT = /(\.zml)?\.(pdf|docx?|pptx?|jpe?g|png|gif|webp|bmp|mp4|wmv|avi|asf|mpg|flv|mov|rmvb|rm|mp3|wav|m4a|html?|swf|zip|rar|zml)$/i;

export function titleOf(name: string) {
  return name.replace(EXT, '').trim();
}

// ── 试题 / 答案 自动配对 ─────────────────────────────────────
const Q_MARK = /(不含答案|不带答案|无答案|原卷版|原卷|学生版|试题|题目版|空白版)/;
const A_MARK = /(有答案|含答案|带答案|解析版|答案版|教师版|详解|答案)/;

function pairKey(title: string) {
  return title
    .replace(/[（(【\[]?\s*(不含答案|不带答案|无答案|有答案|含答案|带答案|原卷版|解析版|原卷|学生版|教师版|答案版|详解|题目版|空白版|试题|答案)\s*[）)】\]]?/g, '')
    .replace(/[-_\s—·.]+/g, '')
    .toLowerCase();
}

function pairFolder(files: FileEntry[]) {
  const groups = new Map<string, FileEntry[]>();
  for (const f of files) {
    if (!['pdf', 'word', 'slides'].includes(f.kind)) continue;
    const k = pairKey(f.title);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  for (const g of groups.values()) {
    if (g.length !== 2) continue;
    const [a, b] = g;
    const role = (f: FileEntry): 'question' | 'answer' | null =>
      Q_MARK.test(f.title) ? 'question' : A_MARK.test(f.title) ? 'answer' : null;
    let ra = role(a), rb = role(b);
    if (!ra && rb) ra = rb === 'question' ? 'answer' : 'question';
    if (!rb && ra) rb = ra === 'question' ? 'answer' : 'question';
    if (!ra || !rb || ra === rb) continue;
    a.pairId = b.id; a.pairRole = ra;
    b.pairId = a.id; b.pairRole = rb;
  }
}

/** 平行目录：「第1章 匀变速直线运动」与「第1章 匀变速直线运动 解析版」同名文件互为答案 */
function pairParallel(parent: FolderNode) {
  const byName = new Map(parent.folders.map((f) => [f.name.replace(/\s*(解析版|答案版|教师版)$/, ''), [] as FolderNode[]]));
  for (const f of parent.folders) byName.get(f.name.replace(/\s*(解析版|答案版|教师版)$/, ''))?.push(f);
  for (const group of byName.values()) {
    if (group.length !== 2) continue;
    const ans = group.find((f) => /(解析版|答案版|教师版)$/.test(f.name));
    const q = group.find((f) => f !== ans);
    if (!ans || !q) continue;
    const nested = (node: FolderNode): FileEntry[] => [...node.files, ...node.folders.flatMap(nested)];
    const answers = new Map(nested(ans).map((f) => [f.folder.slice(ans.id.length) + '/' + pairKey(f.title), f]));
    for (const f of nested(q)) {
      const m = answers.get(f.folder.slice(q.id.length) + '/' + pairKey(f.title));
      if (m && !f.pairId) { f.pairId = m.id; f.pairRole = 'question'; m.pairId = f.id; m.pairRole = 'answer'; }
    }
  }
}

export function buildLibrary(raw: RawNode, rootPath = ''): Library {
  const folders = new Map<string, FolderNode>();
  const files = new Map<string, FileEntry>();
  const list: FileEntry[] = [];
  const visit = (n: RawNode, path: string): FolderNode => {
    const node: FolderNode = { id: path, name: n.n, folders: [], files: [], count: 0 };
    folders.set(path, node);
    for (const [name, kind, size] of n.f ?? []) {
      const id = path ? path + '/' + name : name;
      const ext = (name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
      const fe: FileEntry = { id, name, title: titleOf(name), kind, size, folder: path, ext, ...(rootPath ? { path: id, root: rootPath } : {}) };
      node.files.push(fe); files.set(id, fe); list.push(fe);
    }
    for (const c of n.d ?? []) node.folders.push(visit(c, path ? path + '/' + c.n : c.n));
    node.count = node.files.length + node.folders.reduce((s, f) => s + f.count, 0);
    pairFolder(node.files);
    pairParallel(node);
    return node;
  };
  const root = visit(raw, rootPath);
  return { root, folders, files, list };
}

export function joinLibraries(libs: Library[]): Library {
  const folders = new Map<string, FolderNode>(), files = new Map<string, FileEntry>();
  const root: FolderNode = { id: '', name: '全部资料', folders: [], files: [], count: 0 };
  for (const lib of libs) {
    root.folders.push(lib.root);
    for (const [key, node] of lib.folders) folders.set(key, node);
    for (const [key, file] of lib.files) files.set(key, file);
  }
  root.count = files.size; folders.set('', root);
  return { root, folders, files, list: [...files.values()] };
}

export function normalizePath(path: string) { return path.replace(/\\/g, '/').replace(/\/$/, ''); }

export function kindForPath(path: string): Kind | null {
  const ext = path.split('.').at(-1)?.toLowerCase();
  if (ext && ['pdf', 'zml'].includes(ext)) return 'pdf';
  if (ext && ['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';
  if (ext && ['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
  if (ext && ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
  if (ext && ['mp4', 'webm', 'mov', 'm4v', 'wmv', 'avi', 'asf', 'mpg', 'mpeg', 'flv', 'rm', 'rmvb'].includes(ext)) return 'video';
  if (ext && ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (ext && ['htm', 'html'].includes(ext)) return 'html';
  if (ext === 'swf') return 'flash';
  if (ext && ['zip', 'rar', '7z'].includes(ext)) return 'archive';
  return null;
}

export function fileEntry(path: string, size = 0, root?: string): FileEntry {
  path = normalizePath(path);
  const name = path.split('/').at(-1)!, kind = kindForPath(name);
  if (!kind) throw new Error('暂不支持这种课件格式：' + name);
  return { id: path, path, root, name, title: titleOf(name), kind, size, folder: path.slice(0, path.lastIndexOf('/')), ext: name.slice(name.lastIndexOf('.')).toLowerCase() };
}

export function webEntry(input: string): FileEntry {
  const url = new URL(input.trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('请输入 http 或 https 开头的课程网址。');
  if (url.username || url.password) throw new Error('请使用不含账号密码的课程网址。');
  return { id: url.href, path: url.href, name: url.hostname, title: decodeURIComponent(url.hostname + (url.pathname === '/' ? '' : url.pathname)), kind: 'html', size: 0, folder: 'loose:', ext: '.html' };
}

// ── 搜索：中文、拼音首字母、全拼 ───────────────────────────
const pyCache = new Map<string, string>();
function pyKey(title: string) {
  let v = pyCache.get(title);
  if (v === undefined) {
    const arr = pinyin(title, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
    v = (arr.map((s) => s[0] ?? '').join('') + ' ' + arr.join('')).toLowerCase();
    pyCache.set(title, v);
  }
  return v;
}

export function search(lib: Library, q: string, within = '', limit = 300) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const terms = query.split(/\s+/);
  const ascii = /^[a-z0-9\s]+$/.test(query);
  const out: { f: FileEntry; score: number }[] = [];
  for (const f of lib.list) {
    if (within && !(f.folder === within || f.folder.startsWith(within + '/'))) continue;
    const hay = (f.title + ' ' + f.folder).toLowerCase();
    let ok = terms.every((t) => hay.includes(t));
    let score = ok ? (f.title.toLowerCase().includes(query) ? 3 : 1) : 0;
    if (!ok && ascii) {
      const py = pyKey(f.title);
      if (terms.every((t) => py.includes(t))) { ok = true; score = py.startsWith(query) ? 2.5 : 1.5; }
    }
    if (ok) out.push({ f, score: score - f.title.length / 400 });
    if (out.length > limit * 4) break;
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.f);
}

/** 高亮匹配片段，供列表显示 */
export function highlight(text: string, q: string): [string, boolean][] {
  const t = q.trim();
  if (!t) return [[text, false]];
  const i = text.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return [[text, false]];
  return [[text.slice(0, i), false], [text.slice(i, i + t.length), true], [text.slice(i + t.length), false]];
}

export const KIND_LABEL: Record<Kind, string> = {
  board: '黑板', pdf: 'PDF', word: 'Word', slides: 'PPT', image: '图片', video: '视频',
  audio: '音频', html: '网页', flash: 'Flash', archive: '压缩包', sim: '物理演示',
};

export function bytes(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}

// ── 样稿课件：public/mock 里两份渲染好的示例题（scripts/make-sample-mock.cjs 生成），其余文件用占位页 ───────
interface DocsJson { [k: string]: { title: string; total: number; pages: PageInfo[] } }
let docs: DocsJson | null = null;
export async function loadDocs() {
  if (host.electron) return {} as DocsJson;
  docs ??= await (await fetch('mock/docs.json')).json();
  return docs!;
}

const A4: PageInfo = { w: 595, h: 842 };
const WIDE: PageInfo = { w: 1600, h: 900 };

export function materialFor(f: FileEntry): Material {
  const ready = prepared.get(f.id);
  if (ready) return ready;
  if (f.path) throw new Error('请先准备真实课件，再发布到学生窗口。');
  if (docs) {
    for (const [key, d] of Object.entries(docs)) {
      if (f.title === d.title) {
        return { id: f.id, kind: 'pdf', title: f.title, path: f.id, pages: d.pages, total: d.total, pairId: f.pairId, pairRole: f.pairRole ?? (key === 'blank' ? 'question' : 'answer') };
      }
    }
  }
  const geo = f.kind === 'slides' || f.kind === 'video' || f.kind === 'html' || f.kind === 'flash' ? WIDE : A4;
  const n = f.kind === 'image' || f.kind === 'video' ? 1 : 6;
  return { id: f.id, kind: f.kind, title: f.title, path: f.id, pages: Array.from({ length: n }, () => ({ ...geo })), total: n, pairId: f.pairId, pairRole: f.pairRole };
}

const prepared = new Map<string, Material>();
const preparing = new Map<string, Promise<Material>>();

export function rememberMaterial(mat: Material) {
  prepared.delete(mat.id); prepared.set(mat.id, mat);
  while (prepared.size > 24) prepared.delete(prepared.keys().next().value!);
  return mat;
}

export function clearPrepared() { prepared.clear(); }

/** 只有真实内容准备成功才返回，调用者不得在 await 前替换旧课堂内容。 */
export async function prepareMaterial(f: FileEntry, onProgress?: (p: ConvertProgress) => void): Promise<Material> {
  if (!f.path) { await loadDocs(); return materialFor(f); }
  const ready = prepared.get(f.id); if (ready) return ready;
  const pending = preparing.get(f.id); if (pending) return pending;
  const task = (async () => {
    const path = f.path!;
    if (host.electron && !/^(https?|plugin):/i.test(path) && !await host.exists(path)) throw new Error('找不到原文件，可能已经移动或删除。请刷新目录后重新选择。');
    const base = { id: f.id, kind: f.kind, title: f.title, path, pairId: f.pairId, pairRole: f.pairRole };
    let mat: Material;
    if (f.kind === 'pdf') {
      const pages = await pdfPages(path);
      await pdfRaster(path, 0, 640); // 坏页/无权限在准备阶段失败，不把旧学生画面顶掉
      mat = { ...base, pages, total: pages.length, src: { path, render: 'pdf', pdf: path, status: 'ready' } };
    } else if (f.kind === 'word' || f.kind === 'slides') {
      const result = await host.convert(path, onProgress);
      let pages: PageInfo[];
      if (result.render === 'pdf' && result.pdf) {
        pages = await pdfPages(result.pdf); await pdfRaster(result.pdf, 0, 640);
      } else if (result.render === 'images' && result.images?.length) {
        pages = result.images.map((x) => ({ src: assetUrl(x.path), w: x.w, h: x.h }));
        await imageSize(pages[0].src!);
      } else throw new Error('转换器没有返回可以显示的页面，请重试或先另存为 PDF。');
      mat = { ...base, pages, total: pages.length, src: { path, render: result.render, pdf: result.pdf, status: 'ready' } };
    } else if (f.kind === 'image') {
      const src = assetUrl(path), dims = await imageSize(src);
      mat = { ...base, pages: [{ src, ...dims }], total: 1, src: { path, render: 'image', status: 'ready' } };
    } else if (f.kind === 'video' || f.kind === 'audio') {
      const dims = await mediaSize(assetUrl(path), f.kind);
      mat = { ...base, pages: [dims], total: 1, src: { path, render: 'video', status: 'ready' } };
    } else if (f.kind === 'html') {
      mat = { ...base, pages: [{ ...WIDE }], total: 1, src: { path, render: 'html', status: 'ready' } };
    } else if (f.kind === 'flash') throw new Error('Flash 课件尚未接入兼容播放器。请先使用视频、HTML 或 PDF 版本。');
    else if (f.kind === 'archive') throw new Error('请先在资源管理器中解压，再把里面的课件或文件夹拖入。原压缩包不会被改动。');
    else throw new Error('这种课件目前不能直接显示。');
    return rememberMaterial(mat);
  })();
  preparing.set(f.id, task);
  try { return await task; } finally { preparing.delete(f.id); }
}

export function mediaSize(url: string, kind: 'video' | 'audio'): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind === 'video' ? 'video' : 'audio');
    media.muted = true; media.preload = 'metadata';
    const finish = () => { clearTimeout(timer); media.removeAttribute('src'); media.load(); };
    const timer = window.setTimeout(() => { finish(); reject(new Error('媒体读取超时，请确认文件可用。')); }, 15000);
    media.onloadedmetadata = () => {
      const size = media instanceof HTMLVideoElement ? { w: media.videoWidth || 1600, h: media.videoHeight || 900 } : { w: 1600, h: 900 };
      finish(); resolve(size);
    };
    media.onerror = () => { finish(); reject(new Error('浏览器不支持这份媒体的编码。请转换为 H.264 MP4、WebM 或 MP3 后使用；当前学生画面已保留。')); };
    media.src = url;
  });
}

export function boardMaterial(pages = 3): Material {
  return { id: 'board', kind: 'board', title: '课堂黑板', pages: Array.from({ length: pages }, () => ({ ...WIDE })), total: pages };
}

export function simMaterial(): Material {
  return { id: 'sim:chase', kind: 'html', title: '互动演示 · 追及相遇', pages: [{ ...WIDE }], total: 1 };
}
