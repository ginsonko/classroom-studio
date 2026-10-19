// ── 物理对象与仿真场景：绘图（矢量编辑）与物理引擎共用的数据契约 ─────────
// 坐标与笔迹一致：x 以页宽为 1，y 也以页宽为单位（0..h/w），原点在页面左上角，y 向下。
// rot 为弧度，顺时针为正（与 canvas 一致）。

export const OBJ_KINDS = [
  // 力学
  'block', 'cart', 'ball', 'incline', 'ground', 'wall', 'ceiling', 'conveyor', 'spring', 'rope', 'pulley',
  'rod', 'plank', 'track-circle', 'track-arc', 'hinge', 'weight', 'person', 'car', 'boat', 'rocket',
  // 电磁
  'field-b-in', 'field-b-out', 'field-e', 'charge-pos', 'charge-neg', 'bar-magnet', 'coil', 'rail', 'conductor-rod',
  // 电路
  'battery', 'resistor', 'rheostat', 'bulb', 'switch', 'ammeter', 'voltmeter', 'galvanometer', 'capacitor',
  'inductor', 'diode', 'motor', 'power-ac', 'junction', 'wire',
] as const;
export type ObjKind = (typeof OBJ_KINDS)[number];

/**
 * props 约定（物理单位 SI；缺省由引擎给默认值）：
 *  m 质量 kg · mu 动摩擦因数 · e 恢复系数(0..1) · vx vy 初速度 m/s（y 向上为正）
 *  angle 斜面倾角(度) · speed 传送带速度 m/s（正为顺时针/向右）· k 劲度系数 N/m · L0 原长 m
 *  q 电荷 C（或 e 的倍数，见 qUnit）· B 磁感应强度 T · E 电场强度 N/C
 *  fixed 是否固定 · showV / showF / trail 显示速度矢量 / 受力 / 轨迹
 *  R 电阻 Ω · U 电动势 V · r 内阻 Ω · on 开关闭合
 *  a,b：rope/spring/rod/wire 的两端连接对象 id（字符串）；points：wire 折线（JSON 字符串 "x,y;x,y"）
 */
export interface PhysObj {
  id: string;
  kind: ObjKind;
  x: number; y: number;      // 中心
  w: number; h: number;      // 未旋转时的宽高（页面单位）
  rot: number;
  props: Record<string, number | string | boolean>;
  label?: string;            // 显示的符号，如 "A"、"m₁"、"R₁"
}

export interface Scene {
  title?: string;
  preset?: string;           // 预设模板 id（引擎侧定义）
  objs: PhysObj[];
  world: { g: number; ppm: number };   // ppm：每米对应的页面单位
  params?: Record<string, number>;     // 预设的可调参数
  graphs?: ('vt' | 'xt' | 'at' | 'energy' | 'momentum')[];
  duration?: number;          // 秒
  text?: string;              // 数学 / 化学演示的文字输入（如自定义方程式）
}

/** 学生窗口与老师端同步的仿真时钟：两端用确定性固定步长各自计算到同一时刻 */
export interface SimSync {
  matId: string;
  playing: boolean;
  startedAt: number;          // Date.now()（playing 时有效）
  offset: number;             // 已经过的仿真时间 s
  rate: number;               // 播放倍速
  rev: number;                // 参数 / 场景每改一次 +1，两端据此重建
  params: Record<string, number>;
  overlays?: { v?: boolean; f?: boolean; trail?: boolean; graph?: boolean; formula?: boolean };
}

