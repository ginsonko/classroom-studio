// ── 课件与页面 ─────────────────────────────────────────────
export type Kind =
  | 'board' | 'pdf' | 'word' | 'slides' | 'image' | 'video' | 'audio'
  | 'html' | 'flash' | 'archive' | 'sim';

import type { PhysObj, Scene } from '../physics/model';
export type { PhysObj, Scene };

/** 原文件来源（真机课件）。path 为绝对路径，正斜杠。 */
export interface DocSource {
  path: string;                       // 原文件（只读，不改动）
  render: 'pdf' | 'images' | 'image' | 'video' | 'html' | 'none';
  pdf?: string;                       // render=pdf 时实际渲染的 PDF（原文件或转换缓存）
  status?: 'ready' | 'converting' | 'error';
  error?: string;
}

/** 一页的几何：宽高比 + 页内的幻灯片区块（归一化 [x,y,w,h]） */
export interface PageInfo {
  src?: string;              // 图片 URL（样稿 / 图片 / PPT 导出的幻灯片图）
  doc?: { pdf: string; index: number };   // 用 pdf.js 渲染 pdf 的第 index 页（0 起）
  w: number; h: number;
  slides?: number[][];
}

export interface Material {
  id: string;
  kind: Kind;
  title: string;
  path?: string;          // 资料库内相对路径（样稿）
  pages: PageInfo[];      // 黑板也有页
  total: number;          // 文件真实总页数（样稿只渲染了前几页）
  pairId?: string;        // 自动配对的答案 / 原卷
  pairRole?: 'question' | 'answer';
  answerPages?: number[];   // 答案页（0 起）：学生端默认遮住，老师揭晓后才显示
  answerAuto?: boolean;     // answerPages 来自关键词自动识别（老师可改）
  answerFrom?: Record<number, number>;   // 页 → 答案从页面多高处开始（0~1）；没有则整页遮住
  answerSegs?: Record<number, [number, number][]>;   // 页 → 只遮这几段 [上沿, 下沿]（优先于 answerFrom）
  src?: DocSource;
  scene?: Scene;          // kind = 'sim'
  s3d?: import('../scene3d/spec').S3DSpec;   // kind = 'sim' 的立体演示规格（scene 只留时长 / 参数给共享时钟用）
}

/** 老师确认过的答案页标记（按文件路径记住） */
export interface AnswerMark { pages: number[]; from?: Record<number, number>; segs?: Record<number, [number, number][]> }

/** 展示方式：整页、按宽、幻灯片切分、框选区域 */
export type FitMode = 'page' | 'width' | 'slides' | 'region';

export interface View {
  materialId: string;
  page: number;           // 0 起
  slide: number;          // slides 模式下的块序号
  fit: FitMode;
  region?: [number, number, number, number]; // 归一化区域（相对页面）
  zoom: number;
}

/**
 * 学生画面里「打开着」的一项（黑板 / 文档 / 演示），各自记住页码。
 * max：占满画面（像标签页，切回来还在原来那页）；normal：浮在黑板上的窗口；min：只收在侧边切换栏里。
 * 正在操作的那一项就是 pgm / pgmMat，desk 里它的 mat / view 以 pgm 为准。
 */
export interface DeskWin {
  id: string;
  mat: Material;
  view: View;
  rect: [number, number, number, number];   // 浮动窗口位置（相对学生画面 0~1）
  mode: 'max' | 'normal' | 'min';
  prev?: 'max' | 'normal';                   // 收起前的样子，点开时恢复
  z: number;                                 // 叠放次序
  at: number;                                // 最近使用时间（超过上限时先关最久没用的）
  sim?: unknown;                             // 演示的播放状态（切走时保存）
}

// ── 笔迹 ──────────────────────────────────────────────────
export type Tool =
  | 'pointer' | 'pen' | 'marker' | 'highlighter' | 'eraser' | 'lasso'
  | 'line' | 'arrow' | 'darrow' | 'curve' | 'dashed'
  | 'rect' | 'ellipse' | 'triangle'
  | 'force' | 'axes' | 'text' | 'poly' | 'laser' | 'spotlight' | 'curtain'
  | 'select'   // 点选物理对象 / 笔迹：移动、旋转、缩放、改属性
  | 'obj'      // 放置物理对象（种类见 store.objKind）
  | 'image';   // 贴在板面上的图片（粘贴的截图）；pts 存外接矩形两角，img 是图片地址

export type Author = 'teacher' | 'student' | 'ai';

/**
 * 笔迹坐标锚定在页面上：x ∈ [0,1] 以页宽为单位，y 以页宽为单位（0..h/w）。
 * 这样任意窗口尺寸、任意页面比例下都不变形。
 */
export interface Stroke {
  id: string;
  tool: Tool;
  color: string;           // 语义色 token 或 #hex
  size: number;            // 以页宽的 1/1000 为单位
  pts: number[];           // x, y, pressure 三元组
  text?: string;           // 文字 / 力的符号；公式时是一行纯文本读法（公式画不出来时显示）
  tex?: string;            // tool = 'text'：LaTeX 公式；pts 存外接矩形两角 [x0,y0,.5,x1,y1,.5]
  author: Author;
  layer?: 'public' | 'private'; // private：只在教师端显示
  obj?: PhysObj;           // tool = 'obj'：物理对象；pts 存外接矩形两角 [x0,y0,.5,x1,y1,.5] 供命中 / 套索
  img?: string;            // tool = 'image'：图片地址（lesson:// 或 data:）
  shape?: 'plain';         // tool = 'triangle'：普通三角形（非物理学科），缺省是带地面阴影线的斜面
  plot?: { expr: string; x0: number; x1: number; y0: number; y1: number; xl: string; yl: string; shade?: [number, number] };
}

// ── 学生 / 课表 ───────────────────────────────────────────
export interface Student {
  archived?: boolean;
  id: string;
  name: string;
  grade: string;
  hue: number;             // 头像与课表颜色
  textbook: string;
  subject?: string;        // 学科包 id（physics / math / j-math / p-chinese …），缺省为高中物理
  folder?: string;
  tags: string[];
  lessons: number;
  lastTopic: string;
  lastAt: string;          // ISO
}

export interface LessonSlot {
  date?: string;
  id: string;
  studentId: string;
  day: number;             // 0=周一
  start: number;           // 小时（小数）
  len: number;             // 小时
  topic: string;
  repeat?: boolean;
}

export interface LessonRecord {
  id: string;
  studentId: string;
  date: string;
  minutes: number;
  topic: string;
  items: { title: string; detail: string; at: string }[];
  note: string;
  homework?: string;
  video: string;
}

export type ChapterState = 'none' | 'learning' | 'done' | 'weak';
