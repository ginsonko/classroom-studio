// ── 规则识别：题目文本 → 预设 + 参数（未连接模型时的实现；模型接入后走 aiSchema.ts 的同一出口）──
import { extract, Picker, type Q } from './quantity';
import { clampParams, defaultParams, presetById } from './presets';
import type { P } from './presetKit';

export interface Recognized {
  preset: string;
  title: string;
  params: P;
  score: number;                         // 关键词得分（越高越确定）
  used: { key: string; label: string; raw: string; value: number }[];   // 从题目里读出的参数
  defaulted: string[];                   // 题目没给、用了默认值的参数
  clamped: string[];                     // 超出演示范围被夹住的参数
  alternatives: { preset: string; title: string; score: number }[];
  g?: number;
}

// 关键词 → 预设（权重）。先强特征后弱特征；同分时取列表靠前的。
const RULES: { id: string; kw: [RegExp, number][] }[] = [
  { id: 'belt-incline', kw: [[/传送带/, 4], [/倾斜|倾角|斜向|θ\s*=|与水平/, 3]] },
  { id: 'belt-h', kw: [[/传送带/, 5], [/水平/, 1]] },
  { id: 'magnetic', kw: [[/磁场|磁感应|洛伦兹/, 6], [/质子|α\s*粒子|氘核|粒子|电荷/, 2], [/圆周|半径|周期/, 1]] },
  { id: 'efield', kw: [[/偏转|平行板|极板|两板|板间/, 5], [/电场|电压|电子/, 2], [/射入|射出/, 1]] },
  { id: 'person-boat', kw: [[/人船|人.{0,6}船|船.{0,6}人/, 6], [/走到|行走|船长|船头|船尾/, 2]] },
  { id: 'recoil', kw: [[/反冲|弹开|弹射|压缩.{0,6}弹簧.{0,10}(释放|松手)/, 5], [/两.?车|小车/, 1], [/弹簧/, 1]] },
  { id: 'plank', kw: [[/木板|长木板|滑板|板块/, 5], [/滑上|冲上|放在.{0,8}板/, 2]] },
  { id: 'collision', kw: [[/碰撞|相碰|碰后|碰前|弹性碰|完全非弹性|正碰/, 6], [/动量守恒/, 2]] },
  { id: 'pulley', kw: [[/滑轮/, 6], [/绳.{0,6}(跨过|绕过)|跨过|阿特伍德|悬挂/, 2]] },
  { id: 'circle-vertical', kw: [[/竖直(平面)?内?.{0,4}圆周|最高点|最低点|过山车|圆轨道|内轨道|轻杆|轻绳.{0,8}圆/, 5], [/圆周|半径/, 1]] },
  { id: 'pendulum', kw: [[/单摆/, 7], [/摆长|摆角|摆球|周期/, 2]] },
  { id: 'spring', kw: [[/弹簧振子|简谐|振幅|振动/, 5], [/劲度系数|弹簧/, 2]] },
  { id: 'projectile', kw: [[/平抛|水平抛出|水平飞出|水平射出|水平扔/, 7], [/抛出|落地|高处|高台|射程|水平距离/, 2]] },
  { id: 'incline', kw: [[/斜面/, 5], [/倾角|下滑|上滑|沿.{0,4}斜/, 2], [/物块|滑块|木块/, 1]] },
];

export function scoreText(text: string) {
  return RULES.map((r) => ({ id: r.id, score: r.kw.reduce((s, [re, w]) => s + (re.test(text) ? w : 0), 0) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

const deg = /^[θα]|倾角|角/;
type Map = (pk: Picker, text: string) => Record<string, Q | number | undefined>;

// 每个预设：怎样从题目里的量找参数（返回 Q 表示读到的量，数字表示推断出的取值）
const MAPS: Record<string, Map> = {
  'belt-h': (pk, t) => ({
    v: pk.take('v', { sym: /^v(带|$)|^u/, ctx: /传送带|带速|匀速|运行|速度/ , not: /初速|滑上|冲上|物块以/ }),
    v0: pk.take('v', { sym: /^v0/, ctx: /初速|滑上|冲上|以/, fallback: false }),
    mu: pk.take('num', { sym: /^μ/, ctx: /摩擦/ }),
    L: pk.take('len', { sym: /^[Ll]|^AB|^s/, ctx: /长|距离|AB|两端/ }),
    m: pk.take('m', {}),
    ...(/轻放|无初速|静止释放|轻轻放/.test(t) ? { v0: 0 } : {}),
  }),
  'belt-incline': (pk, t) => ({
    th: pk.take('deg', { sym: deg, ctx: /倾角|与水平|角/ }),
    v: pk.take('v', { sym: /^v|^u/, ctx: /传送带|速度|速率|运行/ }),
    L: pk.take('len', { sym: /^[Ll]|^AB/, ctx: /长|AB|两端|距离/ }),
    mu: pk.take('num', { sym: /^μ/, ctx: /摩擦/ }),
    m: pk.take('m', {}),
    dir: /(逆时针|向上运[行动]|斜向上运动|向上传送)/.test(t) && !/向下运[行动]|顺时针/.test(t) ? 1 : 0,
  }),
  incline: (pk) => ({
    th: pk.take('deg', { sym: deg, ctx: /倾角|斜面|角/ }),
    mu: pk.take('num', { sym: /^μ/, ctx: /摩擦/ }),
    m: pk.take('m', {}),
    L: pk.take('len', { sym: /^[Ll]|^s|^x/, ctx: /长|距离|斜面/ }),
    v0: pk.take('v', { sym: /^v0/, ctx: /初速|以/ }),
  }),
  plank: (pk) => ({
    v0: pk.take('v', { sym: /^v0|^v/, ctx: /初速|滑上|冲上|以/ }),
    mu1: pk.take('num', { sym: /^μ1/, ctx: /(物块|滑块|小物|木块).{0,8}(与|和).{0,6}(木板|板)|板.{0,4}(上表面|间)/ }),
    mu2: pk.take('num', { sym: /^μ2/, ctx: /(木板|板).{0,8}(与|和).{0,6}(地面|水平面)|地面/ }),
    m: pk.take('m', { sym: /^m$|^m1/, ctx: /物块|滑块|木块|小物|铁块/ }),
    M: pk.take('m', { sym: /^M|^m2/, ctx: /木板|长木板|板/ }),
    L: pk.take('len', { sym: /^[Ll]/, ctx: /板长|长度|长/ }),
  }),
  collision: (pk, t) => ({
    m1: pk.take('m', { sym: /^m1|^mA|^m$/, ctx: /A|甲|第一|入射/ }),
    v1: pk.take('v', { sym: /^v1|^vA|^v0|^v$/, ctx: /A|甲|以|速度/ }),
    m2: pk.take('m', { sym: /^m2|^mB|^M/, ctx: /B|乙|静止|另一/ }),
    v2: pk.take('v', { sym: /^v2|^vB/, ctx: /B|乙/, fallback: false }),
    e: /完全非弹性|粘在一起|一起运动|合为一体|共同运动/.test(t) ? 0 : /弹性碰撞|无机械能损失|无能量损失/.test(t) && !/非弹性/.test(t) ? 1 : /非弹性/.test(t) ? 0.5 : undefined,
  }),
  recoil: (pk) => ({
    m1: pk.take('m', { sym: /^m1|^mA|^m$/, ctx: /A|甲|左/ }),
    m2: pk.take('m', { sym: /^m2|^mB|^M/, ctx: /B|乙|右/ }),
    k: pk.take('k', {}),
    dx: pk.take('len', { sym: /^Δ?x|^d/, ctx: /压缩|形变/ }),
  }),
  'person-boat': (pk) => ({
    m: pk.take('m', { sym: /^m$|^m人/, ctx: /人/ }),
    M: pk.take('m', { sym: /^M/, ctx: /船/ }),
    L: pk.take('len', { sym: /^[Ll]/, ctx: /船长|长/ }),
    u: pk.take('v', { ctx: /人|走/ }),
  }),
  projectile: (pk) => ({
    h: pk.take('len', { sym: /^[hH]/, ctx: /高|离地|高度/ }),
    v0: pk.take('v', { sym: /^v0|^v/, ctx: /初速|水平|以/ }),
  }),
  'circle-vertical': (pk, t) => ({
    mode: /轻杆|杆/.test(t) ? 2 : /轨道|管道|过山车|圆轨/.test(t) ? 1 : 0,
    R: pk.take('len', { sym: /^[Rr]|^[Ll]/, ctx: /半径|绳长|杆长|长/ }),
    v0: pk.take('v', { sym: /^v0|^v/, ctx: /最低点|初速|以/ }),
    m: pk.take('m', {}),
  }),
  spring: (pk) => ({
    m: pk.take('m', {}),
    k: pk.take('k', {}),
    A: pk.take('len', { sym: /^A|^x/, ctx: /振幅|拉开|拉离|压缩|偏离/ }),
  }),
  pendulum: (pk) => ({
    L: pk.take('len', { sym: /^[Ll]|^l/, ctx: /摆长|绳长|长/ }),
    th: pk.take('deg', { sym: deg, ctx: /摆角|偏角|角/ }),
    m: pk.take('m', {}),
  }),
  pulley: (pk, t) => ({
    mode: /两边|两端.{0,4}悬挂|阿特伍德|都悬挂|分别悬挂|两侧/.test(t) && !/桌面|水平面|平台/.test(t) ? 1 : 0,
    mA: pk.take('m', { sym: /^mA|^m1|^M/, ctx: /A|桌面|水平面|甲/ }),
    mB: pk.take('m', { sym: /^mB|^m2|^m$/, ctx: /B|悬挂|乙/ }),
    mu: pk.take('num', { sym: /^μ/, ctx: /摩擦/ }),
    h: pk.take('len', { sym: /^[hH]/, ctx: /高|离地|距地/ }),
  }),
  magnetic: (pk, t) => ({
    mU: /α\s*粒子|氦核/.test(t) ? 4 : /氘核/.test(t) ? 2 : /质子|氢核/.test(t) ? 1 : undefined,
    qe: /α\s*粒子|氦核/.test(t) ? 2 : undefined,
    v: pk.take('v', { sym: /^v/, ctx: /速度|射入|以/ }),
    B: pk.take('B', {}),
  }),
  efield: (pk) => ({
    U: pk.take('U', {}),
    d: pk.take('len', { sym: /^d/, ctx: /板间距|间距|距离|相距/ }),
    L: pk.take('len', { sym: /^[Ll]/, ctx: /板长|长/ }),
    v0: pk.take('v', { sym: /^v0|^v/, ctx: /速度|射入|以/ }),
  }),
};

// 参数单位换算：预设参数的单位 → 从 SI 换过去
const SCALE: Record<string, Record<string, number>> = {
  magnetic: { v: 1e-6 },
  efield: { d: 100, L: 100, v0: 1e-7 },
};

export function recognize(text: string, forcePreset?: string): Recognized | null {
  const { norm, qs, g } = extract(text);
  const ranked = scoreText(norm);
  const id = forcePreset ?? ranked[0]?.id;
  const pre = id ? presetById(id) : undefined;
  if (!pre || !MAPS[pre.id]) return null;
  const pk = new Picker(qs);
  const got = MAPS[pre.id](pk, norm);
  const def = defaultParams(pre);
  const raw: P = { ...def };
  const used: Recognized['used'] = [], defaulted: string[] = [];
  for (const d of pre.params) {
    const x = got[d.key];
    if (x === undefined) { defaulted.push(d.label); continue; }
    const value = typeof x === 'number' ? x : x.v * (SCALE[pre.id]?.[d.key] ?? 1);
    raw[d.key] = value;
    used.push({ key: d.key, label: d.label, raw: typeof x === 'number' ? '按题意推断' : x.raw, value });
  }
  if (g !== undefined) raw.g = g;
  const params = clampParams(pre, raw);
  const clamped = pre.params.filter((d) => raw[d.key] !== undefined && Math.abs(params[d.key] - raw[d.key]) > 1e-9 * Math.max(1, Math.abs(raw[d.key]))).map((d) => d.label);
  return {
    preset: pre.id, title: pre.title, params, score: ranked.find((r) => r.id === pre.id)?.score ?? 0,
    used, defaulted, clamped, g,
    alternatives: ranked.filter((r) => r.id !== pre.id).slice(0, 3).map((r) => ({ preset: r.id, title: presetById(r.id)?.title ?? r.id, score: r.score })),
  };
}
