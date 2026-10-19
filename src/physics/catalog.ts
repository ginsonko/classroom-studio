import { OBJ_KINDS, type ObjKind, type PhysObj } from './model';

export type ObjGroup = 'mechanics' | 'fields' | 'circuit';
export interface PropSpec { key: string; label: string; unit?: string; min?: number; max?: number; step?: number; type?: 'boolean' }
export interface CatalogItem { kind: ObjKind; name: string; group: ObjGroup; w: number; h: number; props: PhysObj['props']; fields: PropSpec[]; hint?: string }
export const OBJECT_GROUPS: { id: ObjGroup; name: string }[] = [
  { id: 'mechanics', name: '力学' }, { id: 'fields', name: '电磁场' }, { id: 'circuit', name: '电路' },
];

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
];

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
    else if (typeof v === 'number') out.props[f.key] = Number.isFinite(v) ? Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v)) : (o.props[f.key] ?? 0);
  }
  out.w = Math.max(.008, Math.min(4, Number.isFinite(out.w) ? out.w : o.w));
  out.h = Math.max(.008, Math.min(4, Number.isFinite(out.h) ? out.h : o.h));
  out.rot = Number.isFinite(out.rot) ? out.rot : o.rot;
  if (o.kind === 'incline' && patch.props?.angle !== undefined) out.h = out.w * Math.tan(Number(out.props.angle) * Math.PI / 180);
  else if (o.kind === 'incline' && (patch.w !== undefined || patch.h !== undefined)) out.props.angle = Math.atan2(out.h, out.w) * 180 / Math.PI;
  return out;
}
