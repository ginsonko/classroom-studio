// 立体演示规格（纯 JSON，存进 Material.s3d，跨窗口广播）。
// 设计给能力一般的模型：顶层字段少、名字直白、处处有默认值；数值既可以写数字，也可以写含 t 的公式字符串。

export type Num = number | string;
export type Vec = Num[];
/** 点：坐标 [x,y,z] / 已命名的点（立体图形顶点 "A1"、point 的 id）/ 对象 id / "mid(A,B)" */
export type PointRef = string | Vec;

export interface S3DParam { key: string; label: string; min: number; max: number; value: number; step: number; unit: string }
export interface S3DSeries { y: string; name: string; color: string }
export interface S3DChart { title: string; type: 'line' | 'bars'; series: S3DSeries[]; bars: { name: string; value: string; color: string }[]; xLabel: string; yLabel: string; ymin?: number; ymax?: number }
export interface S3DStep { say: string; camera?: string; at?: number }
export interface S3DObject { id: string; type: ObjType; [field: string]: unknown }

export interface S3DSpec {
  v: 1;
  title: string;
  subject: string;
  /** motion：东西会动；static：静态题（受力、结构、几何），用分步讲解 + 运镜展示 */
  mode: 'motion' | 'static';
  /** 竖直向上的坐标轴：物理 / 化学 / 生物 / 地理默认 y；数学立体几何、曲面默认 z */
  up: 'y' | 'z';
  duration: number;
  camera: CameraName;
  stage: 'floor' | 'space' | 'plain';
  params: S3DParam[];
  vars: Record<string, string>;
  objects: S3DObject[];
  charts: S3DChart[];
  steps: S3DStep[];
  notes: string[];
}

export const CAMERAS = ['iso', 'front', 'side', 'top', 'back', 'low'] as const;
export type CameraName = (typeof CAMERAS)[number];
export const CAMERA_LABEL: Record<CameraName, string> = { iso: '斜视', front: '正视', side: '侧视', top: '俯视', back: '背视', low: '仰视' };

/** 字段类型：num 数字或公式；vec 坐标；pt 点；pts 点列表；ref 对象 id；refs 多个 id；dir 方向；json 由专门代码检查 */
export type FieldKind = 'num' | 'vec' | 'pt' | 'pts' | 'str' | 'text' | 'bool' | 'ref' | 'refs' | 'dir' | 'color' | 'json' | `enum:${string}`;

const BODY = { pos: 'vec', on: 'ref', s: 'num', rot: 'num', rot3: 'vec', motion: 'json', material: 'enum:plastic|metal|wood|glass|rubber' } as const;

/** 每种器材 / 元素认的字段（其余字段丢弃）。通用字段见 COMMON。 */
export const TYPES = {
  // 力学与通用物体
  box: { ...BODY, size: 'vec' },
  ball: { ...BODY, r: 'num' },
  cylinder: { ...BODY, r: 'num', h: 'num', axis: 'enum:x|y|z' },
  cart: { ...BODY, size: 'vec' },
  ground: { pos: 'vec', size: 'vec', rough: 'bool' },
  wall: { pos: 'vec', height: 'num', depth: 'num', side: 'enum:left|right' },
  ceiling: { pos: 'vec', size: 'vec' },
  incline: { pos: 'vec', angle: 'num', length: 'num', height: 'num', depth: 'num', dir: 'enum:right|left', rough: 'bool', showAngle: 'bool' },
  conveyor: { pos: 'vec', length: 'num', speed: 'num', depth: 'num', r: 'num' },
  pulley: { pos: 'vec', r: 'num', support: 'enum:post|ceiling|wall|none', spin: 'num' },
  rope: { from: 'pt', to: 'pt', via: 'refs' },
  spring: { from: 'pt', to: 'pt', coils: 'num', r: 'num' },
  rod: { from: 'pt', to: 'pt', r: 'num' },
  pendulum: { pivot: 'vec', length: 'num', angle: 'num', angle0: 'num', g: 'num', r: 'num', trail: 'bool' },
  arrow: { at: 'ref', from: 'pt', to: 'pt', dir: 'dir', len: 'num', kind: 'enum:force|velocity|accel|field|other', offset: 'vec', dashed: 'bool' },
  angle: { at: 'pt', from: 'num', to: 'num', between: 'pts', r: 'num' },
  trail: { of: 'ref', seconds: 'num', dots: 'bool' },
  measure: { from: 'pt', to: 'pt', offset: 'vec' },
  field: { kind: 'enum:B|E|g', dir: 'dir', pos: 'vec', size: 'vec', density: 'num' },
  charge: { ...BODY, q: 'num', r: 'num' },
  wave: { pos: 'vec', length: 'num', amp: 'num', lambda: 'num', speed: 'num', kind: 'enum:transverse|longitudinal', axis: 'enum:x|y|z' },
  // 数学
  axes: { pos: 'vec', x: 'vec', y: 'vec', z: 'vec', labels: 'json', grid: 'bool', ticks: 'bool' },
  curve: { fn: 'str', x: 'json', y: 'str', z: 'str', u: 'vec', draw: 'num', width: 'num', points: 'json' },
  surface: { f: 'str', x: 'vec', y: 'vec', wire: 'bool', colorBy: 'enum:height|solid' },
  solid: { shape: 'enum:cube|cuboid|tetra|pyramid|prism|cylinder|cone|sphere', pos: 'vec', size: 'json', names: 'json', section: 'pts', circumsphere: 'bool', labels: 'bool', faces: 'bool', rot: 'num', motion: 'json' },
  point: { pos: 'pt', r: 'num', motion: 'json' },
  segment: { from: 'pt', to: 'pt', dashed: 'bool', width: 'num' },
  polygon: { points: 'pts', outline: 'bool' },
  plane: { points: 'pts', size: 'num' },
  sphere: { center: 'pt', r: 'num', wire: 'bool' },
  // 化学
  molecule: { name: 'str', atoms: 'json', bonds: 'json', pos: 'vec', scale: 'num', style: 'enum:ballstick|space', labels: 'bool', spin: 'bool', angles: 'bool' },
  crystal: { name: 'enum:NaCl|CsCl|diamond|bcc|fcc|graphite', pos: 'vec', scale: 'num', labels: 'bool', spin: 'bool' },
  atom: { pos: 'vec', symbol: 'str', shells: 'json', scale: 'num' },
  // 地理 / 天文
  earth: { pos: 'vec', r: 'num', tilt: 'num', spin: 'num', orbit: 'json', grid: 'bool', sunPoint: 'bool', marks: 'json', lightFrom: 'vec' },
  sun: { pos: 'vec', r: 'num' },
  moon: { pos: 'vec', around: 'ref', r: 'num', dist: 'num', period: 'num' },
  orbit: { center: 'pt', r: 'num', seasons: 'bool', plane: 'enum:xz|xy|yz' },
  // 生物
  cell: { kind: 'enum:animal|plant', pos: 'vec', r: 'num', labels: 'bool', cut: 'bool' },
  dna: { pos: 'vec', turns: 'num', length: 'num', labels: 'bool', spin: 'bool', unzip: 'num' },
  // 通用
  label: { pos: 'pt', text: 'text', size: 'enum:small|normal|big' },
  timeline: { pos: 'vec', length: 'num', events: 'json' },
} satisfies Record<string, Record<string, FieldKind>>;
export type ObjType = keyof typeof TYPES;
export const OBJ_TYPES = Object.keys(TYPES) as ObjType[];

/** 每个对象都可以写的字段 */
export const COMMON: Record<string, FieldKind> = { id: 'str', type: 'str', label: 'text', color: 'color', show: 'num', step: 'num', opacity: 'num', highlight: 'num', scale: 'num' };

/** 模型常写的别名 / 中文名 → 规范类型 */
export const TYPE_ALIAS: Record<string, ObjType> = {
  block: 'box', cube: 'box', cuboid: 'box', 物块: 'box', 木块: 'box', 方块: 'box', 滑块: 'box',
  sphere3d: 'ball', particle: 'ball', 小球: 'ball', 球: 'ball', 粒子: 'ball', mass: 'ball',
  floor: 'ground', plane_ground: 'ground', table: 'ground', 地面: 'ground', 水平面: 'ground', 桌面: 'ground',
  slope: 'incline', ramp: 'incline', 斜面: 'incline',
  belt: 'conveyor', 传送带: 'conveyor',
  wheel: 'pulley', 滑轮: 'pulley', 定滑轮: 'pulley',
  string: 'rope', line_rope: 'rope', 绳: 'rope', 细绳: 'rope', 轻绳: 'rope',
  弹簧: 'spring', stick: 'rod', 杆: 'rod', 轻杆: 'rod', 单摆: 'pendulum',
  vector: 'arrow', force: 'arrow', velocity: 'arrow', 力: 'arrow', 箭头: 'arrow', 矢量: 'arrow',
  arc: 'angle', 角: 'angle', 角度: 'angle', path: 'trail', 轨迹: 'trail', dimension: 'measure', 标注: 'label',
  magnetic: 'field', 磁场: 'field', 电场: 'field', 电荷: 'charge',
  axis: 'axes', axis3d: 'axes', 坐标轴: 'axes', 坐标系: 'axes', function: 'curve', graph: 'curve', 曲线: 'curve', 函数: 'curve',
  'surface3d': 'surface', 曲面: 'surface', shape: 'solid', polyhedron: 'solid', 立体: 'solid', 几何体: 'solid',
  vertex: 'point', 点: 'point', line: 'segment', edge: 'segment', 线段: 'segment', face: 'polygon', section: 'polygon', 截面: 'polygon', 平面: 'plane',
  ball3d: 'sphere', 球面: 'sphere', 分子: 'molecule', 晶胞: 'crystal', lattice: 'crystal', 原子: 'atom', bohr: 'atom',
  globe: 'earth', 地球: 'earth', 太阳: 'sun', 月球: 'moon', 月亮: 'moon', 轨道: 'orbit',
  细胞: 'cell', helix: 'dna', 双螺旋: 'dna', text: 'label', formula: 'label', 文字: 'label', 时间轴: 'timeline',
  car: 'cart', 小车: 'cart', 车: 'cart', 墙: 'wall', 天花板: 'ceiling', cylinder3d: 'cylinder', 圆柱: 'cylinder',
};

/** 命名颜色（课堂投屏用的柔和高饱和配色） */
export const COLORS: Record<string, string> = {
  blue: '#4f8cff', red: '#ff5d5d', green: '#34d399', orange: '#ff9f43', yellow: '#facc15', purple: '#a78bfa',
  pink: '#f472b6', cyan: '#22d3ee', teal: '#2dd4bf', gray: '#94a3b8', grey: '#94a3b8', white: '#f1f5f9', black: '#334155',
  brown: '#b07a4f', gold: '#f5c542', silver: '#cbd5e1', navy: '#3b5bdb', lime: '#a3e635', magenta: '#e879f9', sky: '#7dd3fc',
  蓝: '#4f8cff', 红: '#ff5d5d', 绿: '#34d399', 橙: '#ff9f43', 黄: '#facc15', 紫: '#a78bfa', 灰: '#94a3b8', 白: '#f1f5f9', 黑: '#334155',
};
/** 箭头的默认颜色：力、速度、加速度、场 */
export const KIND_COLOR: Record<string, string> = { force: '#ff6b57', velocity: '#3ddc97', accel: '#c084fc', field: '#60a5fa', other: '#fbbf24' };

/** 能当作「有位置的物体」被 at / of / on / from / to 引用的类型 */
export const BODY_TYPES = new Set<ObjType>(['box', 'ball', 'cylinder', 'cart', 'charge', 'point', 'pulley', 'earth', 'sun', 'moon', 'molecule', 'atom', 'pendulum', 'label', 'crystal', 'cell', 'dna', 'solid']);
/** 可以被 on 引用的表面 */
export const SURFACE_TYPES = new Set<ObjType>(['incline', 'ground', 'conveyor']);
