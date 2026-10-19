// ── 宿主接口：Electron 预加载脚本注入 window.csHost；浏览器样稿走降级实现 ──────
// 所有路径均为绝对路径、正斜杠（D:/名师物理/...）。原课件只读，任何写入都只能落在 dataDir / cacheDir。
import type { Kind } from './types';

/** 与 public/mock/tree.json 相同的紧凑目录树：{ n, d?: 子目录[], f?: [文件名, 类型, 字节][] } */
export interface RawNode { n: string; d?: RawNode[]; f?: [string, Kind, number][] }

export interface DirEntry { name: string; path: string; dir: boolean; size: number; mtime: number }

export interface ConvertProgress { stage: 'queued' | 'opening' | 'exporting' | 'done' | 'error'; done?: number; total?: number; message?: string }

/** 把 pptx/ppt/doc/docx 等变成可渲染内容；结果按 (路径, 修改时间, 大小) 缓存在 cacheDir */
export interface ConvertResult {
  render: 'pdf' | 'images';
  pdf?: string;                                       // render=pdf
  images?: { path: string; w: number; h: number }[];  // render=images（例如 PPT 每张幻灯片导出 PNG）
  cached: boolean;
  engine: string;                                     // 'powerpoint' | 'wps' | 'word' | 'passthrough' …
}

export interface DisplayInfo { id: number; label: string; primary: boolean; bounds: { x: number; y: number; width: number; height: number } }

export interface Host {
  electron: boolean;
  test?: boolean;
  role?: 'teacher' | 'student' | 'dock';
  initial?: { shared?: Record<string, unknown>; local?: Record<string, unknown>; history?: Record<string, unknown> };
  dataDir: string;
  cacheDir: string;
  /** 扫描整个根目录（后台、带缓存，增量用 mtime）。n 为根目录的名字 */
  scanTree(root: string, opts?: { force?: boolean }): Promise<RawNode>;
  listDir(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  /** 渲染进程可直接加载的 URL（图片、PDF、视频） */
  fileUrl(path: string): string;
  /** 拖入的 File → 绝对路径（Electron webUtils）；浏览器为 null */
  pathForFile(f: File): string | null;
  convert(path: string, onProgress?: (p: ConvertProgress) => void): Promise<ConvertResult>;
  openStudentWindow(): void;
  displays(): Promise<DisplayInfo[]>;
  placeStudent(displayId: number, fullscreen: boolean): void;
  revealInFolder(path: string): void;
  openDock(): void;
  persist(value: unknown): Promise<void>;
  busPost(message: unknown): void;
  onBus(handler: (message: unknown) => void): () => void;
  call<T = unknown>(method: string, value?: unknown): Promise<T>;
  onEvent(handler: (event: any) => void): () => void;
}

declare global { interface Window { csHost?: Host } }

const browserHost: Host = {
  electron: false,
  dataDir: '',
  cacheDir: '',
  async scanTree() { return (await fetch('mock/tree.json')).json(); },
  async listDir() { return []; },
  async exists() { return false; },
  async pickFolder() { return window.prompt('输入文件夹路径（浏览器样稿无法真正读取，请在桌面版使用）'); },
  async pickFiles() { return []; },
  fileUrl: (p) => p,
  pathForFile: () => null,
  async convert() { throw new Error('浏览器样稿不能转换课件，请使用桌面版'); },
  openStudentWindow() { window.open('?w=student', 'student', 'width=1280,height=760'); },
  async displays() { return []; },
  placeStudent() {},
  revealInFolder() {},
  openDock() { window.open('?w=dock', 'teacher-tools', 'width=320,height=780'); },
  async persist() {},
  busPost() {},
  onBus() { return () => {}; },
  async call() { throw new Error('请在桌面版使用此功能'); },
  onEvent() { return () => {}; },
};

export const host: Host = window.csHost ?? browserHost;
