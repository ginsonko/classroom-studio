import { OBJ_KINDS, type ObjKind, type PhysObj } from './model';
import { mathAspect } from './drawMath';
import { CHEM_SIZE } from './drawChem';

export type ObjLib = 'physics' | 'math' | 'chem';
export type ObjGroup = 'mechanics' | 'fields' | 'circuit' | 'plane' | 'curve' | 'solid' | 'vessel' | 'measure' | 'support';
export interface PropSpec { key: string; label: string; unit?: string; min?: number; max?: number; step?: number; type?: 'boolean' | 'text' }
export interface CatalogItem { kind: ObjKind; name: string; group: ObjGroup; w: number; h: number; props: PhysObj['props']; fields: PropSpec[]; hint?: string }
export const OBJECT_LIBS: { id: ObjLib; name: string; title: string; unit: string; params: string }[] = [
  { id: 'physics', name: '物理', title: '物理器材', unit: '种器材', params: '物理参数 · SI 单位' },
  { id: 'math', name: '数学', title: '数学图形', unit: '种图形', params: '图形参数' },
  { id: 'chem', name: '化学', title: '化学仪器', unit: '种仪器', params: '仪器参数' },
];
export const OBJECT_GROUPS: { id: ObjGroup; name: string; lib: ObjLib }[] = [
  { id: 'mechanics', name: '力学', lib: 'physics' }, { id: 'fields', name: '电磁场', lib: 'physics' }, { id: 'circuit', name: '电路', lib: 'physics' },
  { id: 'plane', name: '平面图形', lib: 'math' }, { id: 'curve', name: '函数与曲线', lib: 'math' }, { id: 'solid', name: '立体图形', lib: 'math' },
  { id: 'vessel', name: '容器', lib: 'chem' }, { id: 'measure', name: '计量与分离', lib: 'chem' }, { id: 'support', name: '加热与连接', lib: 'chem' },
];
export const libOfKind = (kind: string): ObjLib => kind.startsWith('m-') ? 'math' : kind.startsWith('c-') ? 'chem' : 'physics';
/** 学科 → 默认打开的图库：数学、化学各自的库，其余学科（含物理、科学）默认物理器材 */
export const libOfFamily = (family: string): ObjLib => family === 'math' ? 'math' : family === 'chem' || family === 'bio' ? 'chem' : family === 'physics' || family === 'science' ? 'physics' : 'math';

const mass: PropSpec = { key: 'm', label: '质量', unit: 'kg', min: 0.000001, step: 0.1 };
const friction: PropSpec = { key: 'mu', label: '动摩擦因数', min: 0, max: 5, step: 0.05 };
const restitution: PropSpec = { key: 'e', label: '恢复系数', min: 0, max: 1, step: 0.1 };
const velocity: PropSpec[] = [{ key: 'vx', label: '水平初速度', unit: 'm/s', step: 0.5 }, { key: 'vy', label: '竖直初速度 ↑', unit: 'm/s', step: 0.5 }];
const dynamic = [mass, friction, restitution, ...velocity];
const resistance: PropSpec = { key: 'R', label: '电阻', unit: 'Ω', min: 0, step: 1 };
const item = (kind: ObjKind, name: string, group: ObjGroup, w: number, h: number, props: PhysObj['props'] = {}, fields: PropSpec[] = [], hint?: string): CatalogItem => ({ kind, name, group, w, h, props, fields, hint });
const body = { m: 1, mu: 0.2, e: 0.3, vx: 0, vy: 0 };

export const OBJECTS: CatalogItem[] = [
  item('block', '物块', 'mechanics', .12, .075, body, dynamic),
  item('cart', '小车', 'mechanics', .16, .085, { ...body, mu: 0 }, dynamic),
  item('ball', '小球', 'mechanics', .075, .075, { ...body, e: .8 }, dynamic),
  item('incline', '斜面', 'mechanics', .28, .28 * Math.tan(Math.PI / 6), { fixed: true, angle: 30, mu: .2 }, [{ key: 'angle', label: '倾角', unit: '°', min: 1, max: 80, step: 1 }, friction]),
  item('ground', '水平地面', 'mechanics', .36, .025, { fixed: true, mu: .2 }, [friction]),
  item('wall', '竖直墙', 'mechanics', .025, .24, { fixed: true, mu: .2 }, [friction]),
  item('ceiling', '天花板', 'mechanics', .28, .025, { fixed: true }, []),
  item('conveyor', '传送带', 'mechanics', .34, .065, { fixed: true, mu: .3, speed: 2 }, [{ key: 'speed', label: '带速 →', unit: 'm/s', step: .5 }, friction]),
  item('spring', '弹簧', 'mechanics', .22, .045, { k: 20, L0: 1 }, [{ key: 'k', label: '劲度系数', unit: 'N/m', min: 0, step: 5 }, { key: 'L0', label: '原长', unit: 'm', min: .001, step: .1 }]),
  item('rope', '轻绳', 'mechanics', .24, .012, { L0: 2 }, [{ key: 'L0', label: '绳长', unit: 'm', min: .001, step: .1 }]),
  item('pulley', '定滑轮', 'mechanics', .085, .085, { fixed: true }, []),
  item('rod', '轻杆', 'mechanics', .22, .016, { m: .01 }, [mass]),
  item('plank', '长木板', 'mechanics', .32, .035, { ...body, m: 2 }, dynamic),
  item('track-circle', '圆形轨道', 'mechanics', .25, .25, { fixed: true, mu: 0 }, [friction]),
  item('track-arc', '圆弧轨道', 'mechanics', .24, .24, { fixed: true, mu: 0, a0: 0, a1: 180 }, [friction, { key: 'a0', label: '起始角', unit: '°', step: 15 }, { key: 'a1', label: '结束角', unit: '°', step: 15 }]),
  item('hinge', '铰链支点', 'mechanics', .055, .05, { fixed: true }, []),
  item('weight', '砝码', 'mechanics', .065, .085, body, dynamic),
  item('person', '人', 'mechanics', .065, .14, { ...body, m: 60 }, dynamic),
  item('car', '汽车', 'mechanics', .19, .095, { ...body, m: 1000 }, dynamic),
  item('boat', '小船', 'mechanics', .22, .10, { ...body, m: 50 }, dynamic),
  item('rocket', '火箭', 'mechanics', .06, .15, { ...body, m: 10 }, dynamic),
  item('field-b-in', '磁场 · 垂直向里 ×', 'fields', .28, .18, { B: .5, spacing: .035 }, [{ key: 'B', label: '磁感应强度', unit: 'T', min: 0, step: .1 }, { key: 'spacing', label: '图案间距', min: .015, max: .15, step: .005 }]),
  item('field-b-out', '磁场 · 垂直向外 ·', 'fields', .28, .18, { B: .5, spacing: .035 }, [{ key: 'B', label: '磁感应强度', unit: 'T', min: 0, step: .1 }, { key: 'spacing', label: '图案间距', min: .015, max: .15, step: .005 }]),
  item('field-e', '匀强电场 →', 'fields', .28, .18, { E: 100, angle: 0, spacing: .04 }, [{ key: 'E', label: '电场强度', unit: 'N/C', step: 10 }, { key: 'angle', label: '方向（0 右 · 90 上 · −90 下）', unit: '°', min: -180, max: 180, step: 90 }, { key: 'plates', label: '画成平行板', type: 'boolean' }, { key: 'spacing', label: '电场线间距', min: .015, max: .15, step: .005 }]),
  item('charge-pos', '正电荷', 'fields', .055, .055, { ...body, m: .01, q: 1e-6 }, [mass, { key: 'q', label: '电荷量', unit: 'C', step: 1e-6 }, ...velocity]),
  item('charge-neg', '负电荷', 'fields', .055, .055, { ...body, m: .01, q: -1e-6 }, [mass, { key: 'q', label: '电荷量', unit: 'C', step: 1e-6 }, ...velocity]),
  item('bar-magnet', '条形磁铁', 'fields', .18, .055, {}, []),
  item('coil', '线圈', 'fields', .18, .08, { N: 10 }, [{ key: 'N', label: '匝数', min: 1, max: 10000, step: 1 }]),
  item('rail', '平行导轨', 'fields', .3, .12, {}, []),
  item('conductor-rod', '导体棒', 'fields', .022, .14, { ...body, R: 1 }, [...dynamic, resistance]),
  item('battery', '直流电源', 'circuit', .13, .065, { U: 6, r: 0 }, [{ key: 'U', label: '电动势', unit: 'V', step: .5 }, { key: 'r', label: '内阻', unit: 'Ω', min: 0, step: .1 }]),
  item('resistor', '电阻', 'circuit', .14, .045, { R: 10 }, [resistance]),
  item('rheostat', '滑动变阻器', 'circuit', .16, .08, { R: 20, fraction: .5 }, [resistance, { key: 'fraction', label: '滑片位置', min: 0, max: 1, step: .05 }]),
  item('bulb', '小灯泡', 'circuit', .10, .065, { R: 10 }, [resistance]),
  item('switch', '开关', 'circuit', .14, .055, { on: false }, [{ key: 'on', label: '闭合开关', type: 'boolean' }]),
  item('ammeter', '电流表', 'circuit', .11, .065, { R: 0 }, [resistance]),
  item('voltmeter', '电压表', 'circuit', .11, .065, { R: 1e6 }, [resistance]),
  item('galvanometer', '灵敏电流计', 'circuit', .11, .065, { R: 100 }, [resistance]),
  item('capacitor', '电容器', 'circuit', .12, .065, { C: 1e-6 }, [{ key: 'C', label: '电容量', unit: 'F', min: 1e-12, step: 1e-6 }]),
  item('inductor', '电感', 'circuit', .15, .05, { L: .1 }, [{ key: 'L', label: '电感', unit: 'H', min: 0, step: .1 }]),
  item('diode', '二极管', 'circuit', .12, .055, {}, []),
  item('motor', '电动机', 'circuit', .11, .065, { R: 2 }, [resistance]),
  item('power-ac', '交流电源', 'circuit', .11, .065, { U: 220, frequency: 50 }, [{ key: 'U', label: '有效电压', unit: 'V', step: 1 }, { key: 'frequency', label: '频率', unit: 'Hz', min: 0, step: 1 }]),
  item('junction', '接线点', 'circuit', .025, .025, {}, []),
  item('wire', '导线', 'circuit', .20, .012, {}, []),
  ...MATH_ITEMS(),
  ...CHEM_ITEMS(),
];

function MATH_ITEMS(): CatalogItem[] {
  const names = (label = '字母（空格分隔，留空不标）'): PropSpec => ({ key: 'names', label, type: 'text' });
  const yes = (key: string, label: string): PropSpec => ({ key, label, type: 'boolean' });
  const view: PropSpec[] = [yes('oblique', '斜二测画法'), { key: 'yaw', label: '水平转角（关斜二测后）', unit: '°', min: -180, max: 180, step: 15 }, { key: 'pitch', label: '俯视角（关斜二测后）', unit: '°', min: -80, max: 80, step: 5 }];
  const viewProps = { oblique: true, yaw: 30, pitch: 20 };
  const deg = (key: string, label: string): PropSpec => ({ key, label, unit: '°', min: -720, max: 720, step: 15 });
  const pos = (key: string, label: string, step = .1): PropSpec => ({ key, label, min: .05, max: 100, step });
  const m = (kind: ObjKind, name: string, group: ObjGroup, w: number, h: number | null, props: PhysObj['props'], fields: PropSpec[]): CatalogItem => {
    const probe: PhysObj = { id: '', kind, x: 0, y: 0, w, h: h ?? w, rot: 0, props };
    return item(kind, name, group, w, h ?? w * (mathAspect(probe) ?? 1), props, fields);
  };
  return [
    m('m-segment', '线段', 'plane', .26, .05, { names: 'A B' }, [names()]),
    m('m-ray', '射线', 'plane', .28, .05, { names: 'O A' }, [names()]),
    m('m-line', '直线', 'plane', .32, .05, { names: 'A B' }, [names()]),
    m('m-angle', '角', 'plane', .2, null, { angle: 60, names: 'A O B', deg: true }, [{ key: 'angle', label: '角度', unit: '°', min: 1, max: 359, step: 5 }, names('字母（边上点 顶点 边上点）'), yes('deg', '标出度数')]),
    m('m-triangle', '三角形', 'plane', .24, .18, { apex: .35, names: 'A B C D', alt: false }, [{ key: 'apex', label: '顶点位置（0 或 1 为直角）', min: 0, max: 1, step: .05 }, names('字母（A B C，第 4 个是垂足）'), yes('alt', '画高线')]),
    m('m-polygon', '正多边形', 'plane', .18, null, { n: 6, letters: true }, [{ key: 'n', label: '边数', min: 3, max: 12, step: 1 }, yes('letters', '标顶点字母')]),
    m('m-circle', '圆', 'plane', .18, null, { center: true, radius: true }, [yes('center', '标圆心 O'), yes('radius', '画半径')]),
    m('m-arc', '圆弧', 'plane', .2, null, { a0: 0, a1: 120, names: 'A B', center: false }, [deg('a0', '起始角'), deg('a1', '终止角'), names(), yes('center', '标圆心 O')]),
    m('m-sector', '扇形', 'plane', .2, null, { a0: 0, a1: 90, names: 'A B' }, [deg('a0', '起始角'), deg('a1', '终止角'), names()]),
    m('m-axes', '平面直角坐标系', 'plane', .3, .3, { n: 4, grid: false, nums: true }, [{ key: 'n', label: '每侧刻度数', min: 1, max: 20, step: 1 }, yes('nums', '标数字'), yes('grid', '画网格')]),
    m('m-numberline', '数轴', 'plane', .4, .07, { min: -3, max: 3, step: 1 }, [{ key: 'min', label: '最小值', step: 1 }, { key: 'max', label: '最大值', step: 1 }, { key: 'step', label: '间隔', min: .01, step: .5 }]),
    m('m-grid', '方格纸', 'plane', .3, .3, { cols: 8, rows: 8 }, [{ key: 'cols', label: '列数', min: 1, max: 60, step: 1 }, { key: 'rows', label: '行数', min: 1, max: 60, step: 1 }]),
    m('m-func', '函数图像', 'curve', .36, .27, { expr: 'x^2-2x', xmin: -3, xmax: 5, ymin: -2, ymax: 6, grid: false, eq: true }, [{ key: 'expr', label: '表达式 y =', type: 'text' }, { key: 'xmin', label: 'x 最小', step: 1 }, { key: 'xmax', label: 'x 最大', step: 1 }, { key: 'ymin', label: 'y 最小', step: 1 }, { key: 'ymax', label: 'y 最大', step: 1 }, yes('eq', '标出解析式'), yes('grid', '画网格')]),
    m('m-ellipse', '椭圆', 'curve', .3, null, { a: 2, b: 1.732, foci: true, eq: true }, [pos('a', '长半轴 a（x 方向）'), pos('b', '半轴 b（y 方向）'), yes('foci', '标焦点'), yes('eq', '标方程')]),
    m('m-hyperbola', '双曲线', 'curve', .3, null, { a: 1, b: 1.732, foci: true, asym: true, eq: true }, [pos('a', '实半轴 a'), pos('b', '虚半轴 b'), yes('asym', '画渐近线'), yes('foci', '标焦点'), yes('eq', '标方程')]),
    m('m-parabola', '抛物线', 'curve', .26, null, { p: 1, open: 0, focus: true, directrix: true, eq: true }, [pos('p', '焦准距 p'), { key: 'open', label: '开口（0 右 1 上 2 左 3 下）', min: 0, max: 3, step: 1 }, yes('focus', '标焦点'), yes('directrix', '画准线'), yes('eq', '标方程')]),
    m('m-cube', '正方体', 'solid', .2, null, { ...viewProps, letters: true }, [yes('letters', '标顶点字母'), ...view]),
    m('m-cuboid', '长方体', 'solid', .26, null, { ...viewProps, a: 1.6, b: 1, c: 1, letters: true }, [pos('a', '长'), pos('b', '宽'), pos('c', '高'), yes('letters', '标顶点字母'), ...view]),
    m('m-prism', '直棱柱', 'solid', .2, null, { ...viewProps, n: 3, H: 1.6, letters: true }, [{ key: 'n', label: '底面边数', min: 3, max: 8, step: 1 }, pos('H', '高（底面外接圆半径为 1）'), yes('letters', '标顶点字母'), ...view]),
    m('m-pyramid', '正棱锥', 'solid', .2, null, { ...viewProps, n: 4, H: 1.6, letters: true }, [{ key: 'n', label: '底面边数', min: 3, max: 8, step: 1 }, pos('H', '高（底面外接圆半径为 1）'), yes('letters', '标顶点字母'), ...view]),
    m('m-cylinder', '圆柱', 'solid', .18, null, { ...viewProps, H: 2, axis: false }, [pos('H', '高（底面半径为 1）'), yes('axis', '画轴线和圆心'), ...view]),
    m('m-cone', '圆锥', 'solid', .18, null, { ...viewProps, H: 2, axis: false }, [pos('H', '高（底面半径为 1）'), yes('axis', '画高和圆心'), ...view]),
    m('m-frustum', '圆台', 'solid', .2, null, { ...viewProps, r1: 1, r2: .55, H: 1.3, axis: false }, [pos('r1', '下底半径'), pos('r2', '上底半径', .05), pos('H', '高'), yes('axis', '画轴线和圆心'), ...view]),
    m('m-frustum-p', '正棱台', 'solid', .2, null, { ...viewProps, n: 4, H: 1.2, k: .5, letters: true }, [{ key: 'n', label: '底面边数', min: 3, max: 8, step: 1 }, pos('H', '高（下底面外接圆半径为 1）'), { key: 'k', label: '上底与下底的比', min: .05, max: .95, step: .05 }, yes('letters', '标顶点字母'), ...view]),
    m('m-axes3', '空间直角坐标系', 'solid', .24, null, { ...viewProps, n: 3, nums: false, neg: false, point: false, px: 1, py: 2, pz: 2 }, [{ key: 'n', label: '每轴刻度数', min: 1, max: 10, step: 1 }, yes('nums', '标数字'), yes('neg', '画负半轴'), yes('point', '画点 P 和它的投影'), { key: 'px', label: 'P 的 x 坐标', step: .5 }, { key: 'py', label: 'P 的 y 坐标', step: .5 }, { key: 'pz', label: 'P 的 z 坐标', step: .5 }, ...view]),
    m('m-sphere', '球', 'solid', .18, null, { ...viewProps, center: true }, [yes('center', '标球心 O'), view[0], view[2]]),
  ];
}

function CHEM_ITEMS(): CatalogItem[] {
  const level = (label = '液面高度'): PropSpec => ({ key: 'liquid', label, min: 0, max: 1, step: .05 });
  const yes = (key: string, label: string): PropSpec => ({ key, label, type: 'boolean' });
  const c = (kind: ObjKind, name: string, group: ObjGroup, props: PhysObj['props'], fields: PropSpec[], k = .032): CatalogItem => { const [mw, mh] = CHEM_SIZE[kind]; return item(kind, name, group, mw * k, mh * k, props, fields); };
  return [
    c('c-test-tube', '试管', 'vessel', { liquid: .3, stopper: false }, [level(), yes('stopper', '塞上橡胶塞')]),
    c('c-beaker', '烧杯', 'vessel', { liquid: .45 }, [level()]),
    c('c-conical', '锥形瓶', 'vessel', { liquid: .25, stopper: false }, [level(), yes('stopper', '塞上橡胶塞')]),
    c('c-round-flask', '圆底烧瓶', 'vessel', { liquid: .35, stopper: false }, [level(), yes('stopper', '塞上橡胶塞')]),
    c('c-gas-bottle', '集气瓶', 'vessel', { liquid: 0, plate: true }, [level(), yes('plate', '盖玻璃片')]),
    c('c-trough', '水槽', 'vessel', { liquid: .7 }, [level('水位')], .036),
    c('c-dish', '蒸发皿', 'vessel', { liquid: .5 }, [level()]),
    c('c-u-tube', 'U 形管', 'vessel', { liquid: .55 }, [level()]),
    c('c-cylinder', '量筒', 'measure', { liquid: .5 }, [level()]),
    c('c-burette', '滴定管', 'measure', { liquid: .85 }, [level()]),
    c('c-funnel', '漏斗', 'measure', { paper: false }, [yes('paper', '放滤纸')]),
    c('c-sep-funnel', '分液漏斗', 'measure', { liquid: .5, layers: true }, [level(), yes('layers', '分两层液体')]),
    c('c-condenser', '冷凝管', 'measure', { labels: true }, [yes('labels', '标进水 / 出水')], .03),
    c('c-dropper', '胶头滴管', 'measure', {}, []),
    c('c-thermometer', '温度计', 'measure', { liquid: .45 }, [level('液柱高度')]),
    c('c-lamp', '酒精灯', 'support', { liquid: .5, flame: true }, [yes('flame', '点燃'), level('酒精量')]),
    c('c-stand', '铁架台', 'support', { clamp: .62, ring: false }, [{ key: 'clamp', label: '铁夹高度', min: 0, max: 1, step: .05 }, yes('ring', '加铁圈')]),
    c('c-tube', '导管', 'support', { shape: 0 }, [{ key: 'shape', label: '形状（0 倒 U · 1 直角 · 2 直）', min: 0, max: 2, step: 1 }]),
  ];
}

export const OBJECT_CATALOG = Object.fromEntries(OBJECTS.map((x) => [x.kind, x])) as Record<ObjKind, CatalogItem>;
export function isObjKind(kind: string): kind is ObjKind { return (OBJ_KINDS as readonly string[]).includes(kind); }
export function createObject(kind: ObjKind, x: number, y: number, id: string = crypto.randomUUID()): PhysObj {
  const c = OBJECT_CATALOG[kind];
  return { id, kind, x, y, w: c.w, h: c.h, rot: 0, props: { ...c.props } };
}

/** Property edits stay within the catalog's documented physical domain. */
export function updateObject(o: PhysObj, patch: Partial<PhysObj>): PhysObj {
  const out: PhysObj = { ...o, ...patch, props: { ...o.props, ...patch.props } };
  for (const f of OBJECT_CATALOG[o.kind].fields) {
    const v = out.props[f.key];
    if (f.type === 'boolean') out.props[f.key] = v === true;
    else if (f.type === 'text') out.props[f.key] = String(v ?? '').slice(0, 200);
    else if (typeof v === 'number') out.props[f.key] = Number.isFinite(v) ? Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v)) : (o.props[f.key] ?? 0);
  }
  out.w = Math.max(.008, Math.min(4, Number.isFinite(out.w) ? out.w : o.w));
  out.h = Math.max(.008, Math.min(4, Number.isFinite(out.h) ? out.h : o.h));
  out.rot = Number.isFinite(out.rot) ? out.rot : o.rot;
  if (o.kind === 'incline' && patch.props?.angle !== undefined) out.h = out.w * Math.tan(Number(out.props.angle) * Math.PI / 180);
  else if (o.kind === 'incline' && (patch.w !== undefined || patch.h !== undefined)) out.props.angle = Math.atan2(out.h, out.w) * 180 / Math.PI;
  else if (patch.props !== undefined && libOfKind(o.kind) === 'math') { const a = mathAspect(out); if (a) out.h = Math.max(.008, Math.min(4, out.w * a)); }
  return out;
}

/** 拖出来时保持比例的器材：等比的数学图形和化学仪器（导管除外） */
export function keepsAspect(o: PhysObj): boolean {
  return libOfKind(o.kind) === 'math' ? mathAspect(o) !== null : libOfKind(o.kind) === 'chem' && o.kind !== 'c-tube';
}
