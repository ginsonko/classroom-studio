import type { ChapterState, LessonRecord, LessonSlot, Student } from './types';
import { PHYSICS_CHAPTERS } from './subjects/physics';

// 样稿数据：学生与课表为虚构示例（俊宇取自资料目录中的文件夹名）
export const STUDENTS: Student[] = [
  { id: 'junyu', name: '俊宇', grade: '高二', hue: 192, textbook: '人教版 2019', folder: '俊宇同学寒假课件练习资料', tags: ['冲刺 985', '电磁偏弱'], lessons: 37, lastTopic: '追及相遇【提高版】例题 1-2', lastAt: '2026-10-14T19:00' },
  { id: 'xinyi', name: '欣怡', grade: '高一', hue: 338, textbook: '人教版 2019', tags: ['新高一', '计算细心'], lessons: 12, lastTopic: '匀变速直线运动的位移与时间的关系', lastAt: '2026-10-15T18:30' },
  { id: 'haoran', name: '浩然', grade: '高三', hue: 38, textbook: '沪科版', folder: '上海一模', tags: ['上海卷', '一模冲刺'], lessons: 54, lastTopic: '2024 上海一模 · 电磁感应综合', lastAt: '2026-10-13T20:00' },
  { id: 'zixuan', name: '子轩', grade: '高二', hue: 262, textbook: '人教版 2019', tags: ['竞赛兴趣'], lessons: 21, lastTopic: '带电粒子在圆形边界磁场中的运动', lastAt: '2026-10-12T15:00' },
  { id: 'yutong', name: '雨桐', grade: '高三', hue: 146, textbook: '人教版 2019', tags: ['理综 270+', '实验题'], lessons: 46, lastTopic: '2023 最后一卷 · 理综 第 24 题', lastAt: '2026-10-11T19:30' },
];

export const SLOTS: LessonSlot[] = [
  { id: 's1', studentId: 'junyu', day: 1, start: 19, len: 2, topic: '追及相遇 · 图像法', repeat: true },
  { id: 's2', studentId: 'junyu', day: 4, start: 19, len: 2, topic: '相互作用 · 受力分析', repeat: true },
  { id: 's3', studentId: 'xinyi', day: 2, start: 18.5, len: 1.5, topic: '自由落体运动', repeat: true },
  { id: 's4', studentId: 'xinyi', day: 5, start: 10, len: 1.5, topic: '周测讲评' },
  { id: 's5', studentId: 'haoran', day: 0, start: 20, len: 2, topic: '一模 · 电磁感应', repeat: true },
  { id: 's6', studentId: 'haoran', day: 6, start: 14, len: 3, topic: '整卷限时 + 讲评' },
  { id: 's7', studentId: 'zixuan', day: 3, start: 15, len: 1.5, topic: '磁场 · 边界问题', repeat: true },
  { id: 's8', studentId: 'yutong', day: 5, start: 19.5, len: 2, topic: '理综物理 · 选择压轴', repeat: true },
  { id: 's9', studentId: 'yutong', day: 6, start: 9, len: 2, topic: '实验题专项' },
  { id: 's10', studentId: 'zixuan', day: 6, start: 19, len: 1.5, topic: '洛伦兹力 · 复习' },
];

export const RECORDS: LessonRecord[] = [
  {
    id: 'r37', studentId: 'junyu', date: '2026-10-14T19:00', minutes: 118, topic: '追及相遇【提高版】',
    items: [
      { title: '复习：匀变速直线运动三个公式', detail: '黑板 第 1 页', at: '00:02:10' },
      { title: '追及相遇【提高版】例题 1-1', detail: '最远距离 · 速度相等', at: '00:14:35' },
      { title: '追及相遇【提高版】例题 1-2', detail: '位移相等 · 追上时刻', at: '00:41:02' },
      { title: '画 v–t 图找面积差', detail: '黑板 第 2 页', at: '01:05:48' },
      { title: '互动演示：追及相遇', detail: '参数化模板', at: '01:22:16' },
    ],
    note: '速度相等时距离最大理解到位；位移相等列方程时 t\' 的物理意义还不稳，下节课先用 v–t 图复盘。',
    homework: '追及相遇模型_提高档_原卷版 第 1–6 题',
    video: '俊宇/2026-10-14_第37课.mp4',
  },
  {
    id: 'r36', studentId: 'junyu', date: '2026-10-10T19:00', minutes: 120, topic: '匀变速直线运动 · 综合',
    items: [
      { title: '自由落体与竖直上抛', detail: '课件 第 3–7 页', at: '00:05:00' },
      { title: '纸带问题：逐差法', detail: '黑板 第 1 页', at: '00:48:20' },
    ],
    note: '逐差法公式会用，但纸带单位换算出错两次。',
    video: '俊宇/2026-10-10_第36课.mp4',
  },
  {
    id: 'r35', studentId: 'junyu', date: '2026-10-07T19:00', minutes: 115, topic: '电磁感应复习（寒假资料）',
    items: [{ title: '楞次定律 · 来拒去留', detail: '课堂教案-电磁感应', at: '00:09:12' }],
    note: '双杆模型需要再练。',
    video: '俊宇/2026-10-07_第35课.mp4',
  },
];

export const CHAPTERS = PHYSICS_CHAPTERS;

/** 学习地图状态：由样稿规则生成，正式版来自课后标记 */
export function mapFor(studentId: string): ChapterState[][] {
  const lvl: Record<string, number> = { junyu: 11, xinyi: 2, haoran: 25, zixuan: 17, yutong: 25 };
  const done = lvl[studentId] ?? 0;
  const seed = [...studentId].reduce((a, c) => a + c.charCodeAt(0), 0);
  return CHAPTERS.map((c, ci) =>
    c.sec.map((_, si) => {
      const k = ci * 5 + si;
      if (studentId === 'junyu' && ci === 1 && si === 3) return 'learning';
      if (studentId === 'junyu' && ci >= 16 && ci <= 18) return (k + seed) % 3 === 0 ? 'weak' : 'done';
      if (ci < done) return (k * 7 + seed) % 11 === 0 ? 'weak' : 'done';
      if (ci === done && si < 2) return 'learning';
      return 'none';
    }),
  );
}

export const FLOW_DEFAULT = [
  { id: 'f0', title: '黑板 · 复习三个公式', ref: 'board', page: 0, done: true },
  { id: 'f1', title: '例题 1-1 · 相距最远', ref: 'q', page: 4, slide: 0, done: false },
  { id: 'f2', title: '例题 1-2 · 何时追上', ref: 'q', page: 4, slide: 1, done: false },
  { id: 'f3', title: '互动演示 · 追及相遇', ref: 'sim', page: 0, done: false },
  { id: 'f4', title: '同向运动 · 图像小结', ref: 'q', page: 5, slide: 0, done: false },
];
