// 校验 AI 写的片子规格：模型输出一律当不可信输入。
// 能自动改的（时间越界、颜色写成英文名、字太大放不下）直接改好并记在 fixes；改不了的（部件名写错、表达式错）放进 errors 交回 AI。
import type { FilmSpec, ItemSpec, ShotSpec } from './core';
import { BACKDROPS, CUTS, EASES, MOODS, PART_OF } from './catalog';
import { compile } from '../scene3d/expr';
import { moleculeByName } from '../scene3d/data';

export interface FilmCheck { ok: boolean; spec: FilmSpec | null; errors: string[]; fixes: string[] }

export const LIMITS = { shots: 12, items: 14, total: 150, shotMin: 2, shotMax: 20 };

const NAMED: Record<string, string> = {
  red: '#ff5d5d', blue: '#4c9dff', green: '#3ddc97', yellow: '#ffd166', orange: '#ff8a3d', purple: '#b28dff', violet: '#b28dff', pink: '#ff7ab6',
  white: '#ffffff', black: '#000000', gray: '#9aa7c0', grey: '#9aa7c0', cyan: '#4cc9ff', gold: '#e8b04a', brown: '#a0703c', silver: '#c9d3e6',
  红: '#ff5d5d', 蓝: '#4c9dff', 绿: '#3ddc97', 黄: '#ffd166', 橙: '#ff8a3d', 紫: '#b28dff', 粉: '#ff7ab6', 白: '#ffffff', 黑: '#000000', 灰: '#9aa7c0', 金: '#e8b04a',
};
/** 引擎里的颜色都按 #RRGGBB 解析，其它写法先换算 */
export function toHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s) || /^#[0-9a-f]{3}$/.test(s)) return s;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('');
  return NAMED[s] ?? NAMED[s.replace(/色$/, '')] ?? null;
}
const COLOR_KEYS = ['color', 'accent', 'textColor', 'planet', 'glow:earth', 'from:particleText', 'to:particleText', 'fill'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(isNum);
const isPts = (v: unknown, n = 2) => Array.isArray(v) && v.length >= n && v.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]));
const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** 估算一行字的像素宽度：汉字约 1 个字号，西文约 0.58 个 */
export const textWidth = (s: string, size: number) => [...s].reduce((a, c) => a + (/[\u2E80-\uFFFF]/.test(c) ? 1 : 0.58), 0) * size;

function exprOk(src: unknown, names: string[], where: string, errors: string[]): boolean {
  if (typeof src !== 'string' && typeof src !== 'number') { errors.push(`${where}缺少表达式`); return false; }
  try { compile(src, { names: new Set(names) }); return true; }
  catch (e) { errors.push(`${where}的表达式「${String(src).slice(0, 60)}」写错了：${(e as Error).message}（变量只能用 ${names.join('、')}）`); return false; }
}

function checkItem(it: ItemSpec, dur: number, where: string, errors: string[], fixes: string[]): ItemSpec | null {
  const doc = PART_OF.get(String(it.type));
  if (!doc) { errors.push(`${where}用了不存在的部件「${String(it.type)}」，只能用目录里的部件`); return null; }
  const o: ItemSpec = { ...it };
  const at = isNum(o.at) ? o.at : 0;
  if (at < 0 || at > dur - 0.5) { o.at = clampN(at, 0, Math.max(0, dur - 1)); fixes.push(`${where}的出场时间 ${at} 超出镜头，改成 ${o.at}`); }
  if (o.dur !== undefined && (!isNum(o.dur) || o.dur <= 0)) delete o.dur;
  for (const key of COLOR_KEYS) {
    const [k, only] = key.split(':');
    if (only && only !== o.type) continue;
    if (o[k] === undefined) continue;
    const hex = toHex(o[k]);
    if (hex) { if (hex !== o[k]) o[k] = hex; }
    else { delete o[k]; fixes.push(`${where}的颜色「${String(it[k])}」看不懂，用默认色`); }
  }
  const W = 1920, t = String(o.type);
  switch (t) {
    case 'title': case 'text': case 'caption': case 'kinetic': {
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!text) { errors.push(`${where}的 ${t} 没有文字`); return null; }
      const size = isNum(o.size) ? o.size : t === 'title' ? 128 : t === 'caption' ? 38 : t === 'kinetic' ? 150 : 48;
      const room = t === 'caption' ? 1700 : t === 'text' && o.align && o.align !== 'center' ? W - (isNum(o.x) ? (o.align === 'left' ? o.x : W - o.x) : 960) - 60 : 1760;
      const wide = Math.max(...text.split('\n').map((l) => textWidth(l, size) * (t === 'title' ? 1.06 : 1)));
      if (wide > room && room > 200) { o.size = Math.max(22, Math.floor(size * room / wide)); fixes.push(`${where}的文字太长，字号从 ${size} 缩到 ${o.size}`); }
      break;
    }
    case 'formula':
      if (typeof o.tex !== 'string' || !o.tex.trim()) { errors.push(`${where}的 formula 没有 tex`); return null; }
      if (isNum(o.size) && (o.size < 28 || o.size > 170)) { o.size = clampN(o.size, 28, 170); fixes.push(`${where}的公式字号调到 ${o.size}`); }
      break;
    case 'plot':
      if (!Array.isArray(o.fns) || !o.fns.length) { errors.push(`${where}的 plot 没有 fns`); return null; }
      if (!(o.fns as { expr?: unknown; to?: unknown }[]).map((f, i) => exprOk(f?.expr, ['x', 't'], `${where}的第 ${i + 1} 条曲线`, errors) && (f?.to === undefined || exprOk(f.to, ['x', 't'], `${where}的第 ${i + 1} 条曲线变形目标`, errors))).every(Boolean)) return null;
      for (const k of ['xr', 'yr']) if (o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).length === 2 && (o[k] as unknown[]).every(isNum) && (o[k] as number[])[0] < (o[k] as number[])[1])) { delete o[k]; fixes.push(`${where}的 ${k} 范围不对，用默认`); }
      break;
    case 'surface':
      if (!exprOk(o.f ?? 'sin(x)*cos(y)', ['x', 'y', 't'], `${where}的曲面`, errors)) return null;
      if (o.to !== undefined && !exprOk(o.to, ['x', 'y', 't'], `${where}的曲面变形目标`, errors)) return null;
      break;
    case 'field':
      if (o.charges !== undefined && !(Array.isArray(o.charges) && o.charges.length && o.charges.every((c: { x?: unknown; y?: unknown; q?: unknown }) => isNum(c?.x) && isNum(c?.y) && isNum(c?.q) && c.q !== 0))) { errors.push(`${where}的 charges 要写成 [{x,y,q}]，q 不能为 0`); return null; }
      break;
    case 'timeline':
      if (!Array.isArray(o.items) || o.items.length < 2 || !o.items.every((x: { year?: unknown; name?: unknown }) => isNum(x?.year) && typeof x?.name === 'string')) { errors.push(`${where}的 timeline 需要至少 2 个 {year(数字), name, note}`); return null; }
      break;
    case 'poem':
      if (!Array.isArray(o.lines) || !o.lines.length || !o.lines.every((l) => typeof l === 'string' && l.length)) { errors.push(`${where}的 poem 需要 lines（每句一项）`); return null; }
      break;
    case 'molecule':
      if (!(Array.isArray(o.atoms) && o.atoms.length) && !moleculeByName(String(o.name ?? ''))) { errors.push(`${where}的分子「${String(o.name)}」不在内置分子里，请换一个，或用 atoms + bonds 自己给坐标`); return null; }
      break;
    case 'reaction': {
      const f = o.from as unknown[], to = o.to as unknown[];
      const okAtoms = (a: unknown) => Array.isArray(a) && a.length > 0 && a.every((x) => Array.isArray(x) && typeof x[0] === 'string' && x.slice(1, 4).every(isNum));
      if (!okAtoms(f) || !okAtoms(to)) { errors.push(`${where}的 reaction 需要 from / to：[[元素,x,y,z],...]`); return null; }
      if (f.length !== to.length || f.some((a, i) => (a as string[])[0] !== (to[i] as string[])[0])) { errors.push(`${where}的 reaction 里 from 和 to 必须是同样的原子、同样的顺序（原子守恒）`); return null; }
      for (const k of ['bondsFrom', 'bondsTo']) if (o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).every((b) => Array.isArray(b) && b.length >= 2 && b.slice(0, 2).every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < f.length)))) { errors.push(`${where}的 ${k} 里有不存在的原子编号`); return null; }
      break;
    }
    case 'label':
      if (typeof o.text !== 'string' || !o.text) { errors.push(`${where}的 label 没有文字`); return null; }
      if (!isVec(o.anchor) && !(isNum(o.x) && isNum(o.y))) { errors.push(`${where}的 label 需要 anchor:[x,y,z] 或像素 x、y`); return null; }
      break;
    case 'shape': {
      const kind = String(o.kind ?? (o.points ? 'polyline' : 'circle'));
      if (!['line', 'arrow', 'polyline', 'polygon', 'circle', 'rect', 'dot'].includes(kind)) { errors.push(`${where}的 shape 种类「${kind}」不存在`); return null; }
      if (['line', 'arrow', 'polyline', 'polygon'].includes(kind) && !isPts(o.points, kind === 'polygon' ? 3 : 2)) { errors.push(`${where}的 ${kind} 需要 points：[[x,y],...]`); return null; }
      if (o.move !== undefined && !(Array.isArray(o.move) && o.move.length >= 2 && o.move.slice(0, 2).every(isNum))) { delete o.move; fixes.push(`${where}的 move 格式不对，已去掉`); }
      break;
    }
    case 'tracer':
      if (!isPts(o.points)) { errors.push(`${where}的 tracer 需要至少 2 个点的 points`); return null; }
      break;
    case 'bars':
      if (!Array.isArray(o.data) || !o.data.length || !o.data.every((d: { value?: unknown }) => isNum(d?.value))) { errors.push(`${where}的 bars 需要 data：[{label, value(数字)}]`); return null; }
      break;
    case 'counter':
      if (!isNum(o.to)) { errors.push(`${where}的 counter 需要数字 to`); return null; }
      break;
    case 'particleText': {
      const text = String(o.text ?? '');
      if (!text) { errors.push(`${where}的 particleText 没有文字`); return null; }
      if ([...text].length > 14) { errors.push(`${where}的 particleText 文字太长（${[...text].length} 字），不超过 12 个字`); return null; }
      if (isNum(o.width) && o.width > 13) { o.width = 13; fixes.push(`${where}的粒子文字太宽，缩到 13`); }
      break;
    }
    case 'body':
      if (o.path !== undefined && !(Array.isArray(o.path) && o.path.every(isVec))) { delete o.path; fixes.push(`${where}的 path 格式不对，已去掉`); }
      if (o.to !== undefined && !isVec(o.to)) { delete o.to; fixes.push(`${where}的 to 格式不对，已去掉`); }
      if (o.ease !== undefined && !(EASES as readonly string[]).includes(String(o.ease))) delete o.ease;
      break;
  }
  if (o.pos !== undefined && !isVec(o.pos)) { delete o.pos; fixes.push(`${where}的 pos 格式不对，放到原点`); }
  return o;
}

export function checkFilm(raw: unknown): FilmCheck {
  const errors: string[] = [], fixes: string[] = [];
  const j = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!j || !Array.isArray(j.shots) || !j.shots.length) return { ok: false, spec: null, errors: ['没有 shots（镜头列表）'], fixes };
  if (j.shots.length > LIMITS.shots) errors.push(`镜头太多（${j.shots.length} 个），不超过 ${LIMITS.shots} 个`);
  const shots: ShotSpec[] = [];
  (j.shots as unknown[]).slice(0, LIMITS.shots).forEach((s0, si) => {
    const s = (s0 && typeof s0 === 'object' ? s0 : {}) as Record<string, unknown>;
    const where = `第 ${si + 1} 个镜头`;
    const shot: ShotSpec = { name: typeof s.name === 'string' ? s.name.slice(0, 40) : `镜头 ${si + 1}`, dur: 6, items: [] };
    const d = isNum(s.dur) ? s.dur : 6;
    shot.dur = clampN(d, LIMITS.shotMin, LIMITS.shotMax);
    if (shot.dur !== d) fixes.push(`${where}的时长 ${d} 秒调成 ${shot.dur} 秒`);
    if (s.bg !== undefined) { if ((BACKDROPS as readonly string[]).includes(String(s.bg))) shot.bg = s.bg as ShotSpec['bg']; else fixes.push(`${where}的背景「${String(s.bg)}」不存在，用默认`); }
    if (s.cut !== undefined && (CUTS as readonly string[]).includes(String(s.cut))) shot.cut = s.cut as ShotSpec['cut'];
    if (s.mood !== undefined && (MOODS as readonly string[]).includes(String(s.mood))) shot.mood = s.mood as ShotSpec['mood'];
    if (s.tint !== undefined) { const h = toHex(s.tint); if (h) shot.tint = h; }
    if (isNum(s.bloom)) shot.bloom = clampN(s.bloom, 0, 2);
    if (s.light === 'sun' || s.light === 'studio') shot.light = s.light;
    if (s.camera !== undefined) {
      const c = s.camera as Record<string, unknown>;
      if (c && isVec(c.from)) {
        const cam: ShotSpec['camera'] = { from: (c.from as number[]).slice(0, 3) as [number, number, number] };
        for (const k of ['to', 'look', 'lookTo'] as const) if (isVec(c[k])) cam[k] = (c[k] as number[]).slice(0, 3) as [number, number, number];
        if (isNum(c.fov)) cam.fov = clampN(c.fov, 15, 90);
        if (isNum(c.orbit)) cam.orbit = clampN(c.orbit, -360, 360);
        if ((EASES as readonly string[]).includes(String(c.ease))) cam.ease = c.ease as never;
        shot.camera = cam;
      } else fixes.push(`${where}的 camera 需要 from:[x,y,z]，用默认相机`);
    }
    const items = Array.isArray(s.items) ? s.items : [];
    if (!items.length) errors.push(`${where}没有任何部件`);
    if (items.length > LIMITS.items) errors.push(`${where}的部件太多（${items.length} 个），不超过 ${LIMITS.items} 个`);
    items.slice(0, LIMITS.items).forEach((it, ii) => {
      if (!it || typeof it !== 'object') return;
      const o = checkItem(it as ItemSpec, shot.dur, `${where}第 ${ii + 1} 个部件（${String((it as ItemSpec).type)}）`, errors, fixes);
      if (o) shot.items.push(o);
    });
    // 字幕都在底部同一个位置，重叠了就把前一条截短
    const caps = shot.items.filter((x) => x.type === 'caption').sort((p, q) => num(p.at) - num(q.at));
    for (let i = 1; i < caps.length; i++) {
      const prev = caps[i - 1], end = num(prev.at) + (isNum(prev.dur) ? prev.dur : shot.dur - num(prev.at));
      if (num(caps[i].at) < end - 0.05) {
        const d = num(caps[i].at) - num(prev.at) - 0.15;
        if (d < 0.8) { errors.push(`${where}有两条字幕几乎同时出现，请错开至少 1 秒`); break; }
        prev.dur = +d.toFixed(2); fixes.push(`${where}的字幕「${String(prev.text).slice(0, 10)}」和下一条重叠，缩短到 ${prev.dur} 秒`);
      }
    }
    shots.push(shot);
  });
  const total = shots.reduce((a, s) => a + s.dur, 0);
  if (total > LIMITS.total) errors.push(`片子太长（${Math.round(total)} 秒），不超过 ${LIMITS.total} 秒`);
  const spec: FilmSpec = { title: typeof j.title === 'string' && j.title.trim() ? j.title.trim().slice(0, 60) : '课堂动画', music: j.music !== false, shots };
  return { ok: errors.length === 0, spec, errors: [...new Set(errors)], fixes };
}
const num = (v: unknown) => (isNum(v) ? v : 0);

/** 给 AI 看的文字摘要：每个镜头的时长、部件 */
export function summarizeFilm(f: FilmSpec): string {
  let t = 0;
  return f.shots.map((s, i) => {
    const line = `${i + 1}. ${t.toFixed(1)}~${(t + s.dur).toFixed(1)}s「${s.name}」${s.bg ?? ''} ${s.items.map((x) => x.type + (typeof x.text === 'string' ? `(${x.text.slice(0, 16)})` : typeof x.tex === 'string' ? `(${x.tex.slice(0, 20)})` : '')).join('、')}`;
    t += s.dur; return line;
  }).join('\n');
}
