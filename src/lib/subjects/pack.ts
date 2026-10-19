// 学科包：一个学科的教材章节、前置关系、题眼规则、题型和各处 AI 提示词。
// 纯数据，不碰窗口和主进程，Node 里可以直接测试。
/** 学科包 id：高中物理 / 数学 / 化学沿用 'physics' | 'math' | 'chem'（旧数据），其余是 "学段前缀-学科"，例如 'j-math'、'p-chinese' */
export type SubjectId = string;
/** 学段 */
export type Level = 'primary' | 'junior' | 'senior';
/** 学科大类：决定能用哪些专用工具（物理引擎、化学式 \ce、数学函数图像…） */
export type Family = 'physics' | 'math' | 'chem' | 'bio' | 'chinese' | 'english' | 'history' | 'geo' | 'politics' | 'science';
export interface Chapter { book: string; ch: string; sec: string[] }

export interface SubjectPack {
  id: SubjectId;
  name: string;               // 物理（同一学科不同学段同名，界面上配合学段显示）
  stage: string;              // 高中物理（提示词里用）
  level: Level;
  family: Family;
  prefix: string;             // 知识点 key 前缀：高中物理 ''，高中数学 'm'，高中化学 'c'，其余 1～2 个小写字母，全局唯一
  textbook: string;           // 默认教材
  /** 常见教材版本（老师在学生资料里选；知识树按课程标准组织，各版本通用，版本只影响提示词和章节叫法） */
  textbooks: string[];
  books: string[];            // 学习地图的分组顺序（册 / 模块 / 年级）
  chapters: Chapter[];
  /** 前置关系：空白分隔的"目标:前置1,前置2"，key 是本学科内的"章.节"（不带前缀） */
  edges: string;
  /** 常见题眼 → 本学科内的"章.节"；章节名本身也会参与匹配 */
  cues: [RegExp, string[]][];
  /** 只是解题工具的章：同时命中别的章节题眼时降权 */
  toolChapters: number[];
  qtypes: string[];
  guessType: (text: string) => string;
  demos: boolean;             // 物理演示、器材库（物理引擎）
  prompt: {
    persona: string;          // 学情各处的 system
    assistant: string;        // 课堂 AI 助手的 system
    read: string;             // 看图识题：图里是什么、怎么转写
    answer: string;           // 识题/出题时"最终答案"的写法
    draft: string;            // 出原创题的要求
    solve: string;            // 审题自检时的惯例
    outline: string;          // 课件大纲的结构
    explain: string;          // 讲题时的数值约定
    draw: string;             // 「画到黑板」的默认要求
  };
}

export const LEVEL_NAME: Record<Level, string> = { primary: '小学', junior: '初中', senior: '高中' };
