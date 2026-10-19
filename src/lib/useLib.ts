import { create } from 'zustand';
import { buildLibrary, clearPrepared, fileEntry, joinLibraries, loadDocs, normalizePath, webEntry, type FileEntry, type Library } from './library';
import { host } from './host';
import { useStore } from './store';

export const useLib = create<{ lib: Library | null; error: string | null; loading: boolean; warnings: string[]; scanned: number }>(() => ({ lib: null, error: null, loading: false, warnings: [], scanned: 0 }));
let started = false, generation = 0;
const external = new Map<string, FileEntry>();
try {
  const saved = JSON.parse(localStorage.getItem('cs.library.loose') || '[]');
  if (Array.isArray(saved)) for (const f of saved.slice(-500)) if (typeof f?.id === 'string' && typeof f.path === 'string' && typeof f.name === 'string') external.set(f.id, f);
} catch { /* 损坏的快捷入口不影响目录读取。 */ }

const saveExternal = () => localStorage.setItem('cs.library.loose', JSON.stringify([...external.values()].slice(-500)));

/** 复制当前资料库并去掉旧的「临时加入的课件」；根目录在 folders 里也要换成新对象，否则浏览根目录时看到的还是旧的 */
function withoutLoose(current: Library, gone: string[] = []): Library {
  const root = { ...current.root, folders: current.root.folders.filter((r) => r.id !== 'loose:') };
  const folders = new Map(current.folders); folders.delete('loose:'); folders.set('', root);
  const files = new Map(current.files); for (const id of gone) files.delete(id);
  root.count = files.size;
  return { ...current, root, folders, files, list: gone.length ? current.list.filter((f) => !gone.includes(f.id)) : [...current.list] };
}

function publishExternal() {
  saveExternal();
  useLib.setState({ lib: withExternal(withoutLoose(useLib.getState().lib ?? joinLibraries([]))) });
}

/** 从「临时加入的课件」里移除（只是不再列出，磁盘上的文件不动）；全不传则清空 */
export function removeLoose(ids?: string[]) {
  const drop = ids ?? [...external.keys()];
  if (!drop.length) return;
  for (const id of drop) external.delete(id);
  saveExternal();
  const current = useLib.getState().lib ?? joinLibraries([]);
  // 同一个文件也在已添加的资料目录里时，目录里照常显示
  const inRoots = new Set<string>();
  for (const n of current.folders.values()) if (n.id !== 'loose:') for (const f of n.files) if (drop.includes(f.id)) inRoots.add(f.id);
  useLib.setState({ lib: withExternal(withoutLoose(current, drop.filter((id) => !inRoots.has(id)))) });
}

export function addWeb(input: string) {
  const f = webEntry(input); external.set(f.id, f); publishExternal(); return f;
}

export function ensureLibrary() {
  if (started) return;
  started = true;
  void refreshLibrary();
}

function withExternal(lib: Library) {
  if (!external.size) return lib;
  const loose = { id: 'loose:', name: '临时加入的课件', folders: [], files: [...external.values()], count: external.size };
  lib.root.folders.push(loose); lib.folders.set(loose.id, loose);
  for (const f of external.values()) if (!lib.files.has(f.id)) { lib.files.set(f.id, f); lib.list.push(f); }
  lib.root.count = lib.files.size;
  return lib;
}

export async function refreshLibrary(force = false) {
  const ticket = ++generation;
  useLib.setState({ loading: true, error: null, warnings: [] });
  if (force) clearPrepared();
  try {
    if (!host.electron) {
      const [tree] = await Promise.all([fetch('mock/tree.json').then((r) => { if (!r.ok) throw new Error('样稿目录不可用'); return r.json(); }), loadDocs()]);
      if (ticket === generation) useLib.setState({ lib: withExternal(buildLibrary(tree)), loading: false, scanned: Date.now() });
      return;
    }
    const roots = [...new Map(useStore.getState().roots.map((s) => [normalizePath(s).toLowerCase(), normalizePath(s)])).values()];
    const found: Library[] = [], warnings: string[] = [];
    // 磁盘读取顺序执行，避免多根目录同时占用机械盘；每根成功后即可使用。
    for (const root of roots) {
      try { found.push(buildLibrary(await host.scanTree(root, { force }), root)); }
      catch (e) { warnings.push(root + '：' + errorText(e)); }
      if (ticket !== generation) return;
      useLib.setState({ lib: withExternal(joinLibraries(found)), warnings: [...warnings] });
    }
    if (ticket === generation) useLib.setState({ lib: withExternal(joinLibraries(found)), loading: false, warnings, scanned: Date.now() });
  } catch (e) {
    if (ticket === generation) useLib.setState({ loading: false, error: '资料目录读取失败：' + errorText(e) });
  }
}

export async function addRoot(path?: string) {
  const picked = path ?? await host.pickFolder();
  if (!picked) return;
  const root = normalizePath(picked), roots = useStore.getState().roots;
  if (!roots.some((r) => normalizePath(r).toLowerCase() === root.toLowerCase())) useStore.getState().set({ roots: [...roots, root] });
  await refreshLibrary();
}

export async function removeRoot(root: string) {
  useStore.getState().set({ roots: useStore.getState().roots.filter((r) => normalizePath(r).toLowerCase() !== normalizePath(root).toLowerCase()) });
  await refreshLibrary();
}

export async function importPaths(paths: string[]): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  for (const raw of paths) {
    const path = normalizePath(raw);
    const known = useLib.getState().lib?.files.get(path);
    if (known) { files.push(known); continue; }
    let list;
    try { list = await host.listDir(path); }
    catch { /* 文件不是目录，按文件导入。 */ }
    if (list) { await addRoot(path); continue; }
    const parent = path.slice(0, path.lastIndexOf('/'));
    const stat = await host.listDir(parent).then((items) => items.find((f) => normalizePath(f.path).toLowerCase() === path.toLowerCase()), () => undefined);
    const f = fileEntry(path, stat?.size ?? 0); external.set(f.id, f); files.push(f);
  }
  if (files.length) publishExternal();
  return files;
}

export async function addFiles() { return importPaths(await host.pickFiles()); }

/** 必须在 drop 事件当下复制 FileList，异步后 dataTransfer 可能已被浏览器清空。 */
export async function readDroppedFiles(files: File[]): Promise<FileEntry[]> {
  const paths = files.map((f) => host.pathForFile(f)).filter((p): p is string => !!p);
  if (paths.length) return importPaths(paths);
  if (files.length) throw new Error('浏览器演示模式不能读取本机完整路径。请在桌面程序中拖入课件。');
  return [];
}

export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
