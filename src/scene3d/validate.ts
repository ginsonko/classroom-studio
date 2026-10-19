// 立体演示规格的校验与自动修正：夹范围、补默认、丢弃未知字段、把常见写错的字段名改对，
// 并给出中文问题清单（反馈给模型 / 显示给老师）。模型输出一律当作不可信输入。
import { compile, identifiers, RESERVED } from './expr';
import { BODY_TYPES, CAMERAS, COLORS, COMMON, KIND_COLOR, OBJ_TYPES, SURFACE_TYPES, TYPE_ALIAS, TYPES, type CameraName, type FieldKind, type ObjType, type S3DChart, type S3DObject, type S3DParam, type S3DSpec, type S3DStep } from './spec';
import { moleculeByName } from './data';
import { DIR_REL, DIR_WORDS, solidNames, splitNames, World } from './world';

export interface Checked { ok: boolean; spec: S3DSpec | null; issues: string[]; errors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
const finite = (v: unknown) => { const n = typeof v === 'string' && /^\s*-?[\d.]+(e-?\d+)?\s*$/i.test(v) ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : undefined; };
const IDENT = /^[\p{L}_][\p{L}\p{N}_]{0,23}$/u;

/** 宽松地从模型回复里取 JSON（去掉代码块、前后说明文字、尾逗号） */
export function looseJSON(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  s = s.slice(a, b + 1);
  for (const cand of [s, s.replace(/,\s*([}\]])/g, '$1'), s.replace(/,\s*([}\]])/g, '$1').replace(/\/\/[^\n"]*\n/g, '\n')]) {
    try { const j = JSON.parse(cand); if (isObj(j)) return j; } catch { /* 下一个 */ }
  }
  return null;
}

/** 模型常写错的字段名 → 正确字段名 */
const FIELD_ALIAS: Record<string, string> = {
  position: 'pos', p: 'pos', xy: 'pos', xyz: 'pos', location: 'pos', radius: 'r', R: 'r', rotation: 'rot', rotate: 'rot', theta: 'angle', angleDeg: 'angle', deg: 'angle',
  visible: 'show', colour: 'color', start: 'from', end: 'to', target: 'to', origin: 'from',
  vertices: 'points', pts: 'points', path: 'points', direction: 'dir', anchor: 'at', attach: 'at', object: 'at', body: 'at', surface: 'on',
  pulleys: 'via', over: 'via', formula: 'f', expr: 'fn', func: 'fn', function: 'fn', range: 'x', urange: 'u', length: 'len',
};

export function checkSpec(raw: unknown, o: { subject?: string } = {}): Checked {
  const issues: string[] = [], errors: string[] = [];
  const note = (s: string) => { if (!issues.includes(s) && issues.length < 60) issues.push(s); };
  let j: unknown = typeof raw === 'string' ? looseJSON(raw) : raw;
  if (!isObj(j)) return { ok: false, spec: null, issues, errors: ['没有读到 JSON 对象'] };
  for (const k of ['spec', 'scene', 'demo', 'plan', 'scene3d']) if (isObj(j[k]) && Array.isArray((j[k] as Record<string, unknown>).objects)) { j = j[k]; break; }
  const J = j as Record<string, unknown>;

  const subject = str(J.subject, 20) || o.subject || 'physics';
  const title = str(J.title, 40) || '立体演示';

  // ── 参数 ──
  const params: S3DParam[] = [];
  const rawParams = Array.isArray(J.params) ? J.params : isObj(J.params) ? Object.entries(J.params).map(([key, v]) => (isObj(v) ? { key, ...v } : { key, value: v })) : [];
  for (const p0 of rawParams.slice(0, 10)) {
    if (!isObj(p0)) continue;
    let key = str(p0.key ?? p0.name ?? p0.id, 24).replace(/\s/g, '');
    if (!IDENT.test(key)) { note(`参数名「${key}」不合法，已忽略（只能用字母、数字、下划线）`); continue; }
    if (RESERVED.has(key)) { note(`参数名「${key}」和内置名字冲突，已改成 ${key}_`); key += '_'; }
    if (params.some((x) => x.key === key)) continue;
    let min = finite(p0.min), max = finite(p0.max), value = finite(p0.value ?? p0.default ?? p0.def ?? p0.v);
    if (value === undefined) value = min !== undefined && max !== undefined ? (min + max) / 2 : 1;
    if (min === undefined) min = value > 0 ? 0 : value * 2 - 1;
    if (max === undefined) max = value > 0 ? value * 2 : Math.max(min + 1, 0);
    if (min > max) [min, max] = [max, min];
    if (max - min < 1e-9) { max = min + Math.max(1, Math.abs(min)); note(`参数 ${key} 的范围是空的，已放宽`); }
    if (value < min || value > max) { note(`参数 ${key} 的初始值超出范围，已夹到范围内`); value = Math.max(min, Math.min(max, value)); }
    const raw = (max - min) / 100, mag = Math.pow(10, Math.floor(Math.log10(raw))), stepAuto = raw / mag < 2 ? mag : raw / mag < 5 ? 2 * mag : 5 * mag;
    const st = finite(p0.step);
    const step = st !== undefined && st > 0 ? Math.min(st, max - min) : stepAuto;
    params.push({ key, label: str(p0.label ?? p0.name, 20) || key, min, max, value, step: +step.toPrecision(3), unit: str(p0.unit, 12) });
  }
  if (rawParams.length > 8) note('参数最多 8 个，多的已丢弃');
  params.splice(8);

  // ── 对象（先定 id，引用检查要用） ──
  const rawObjs = (Array.isArray(J.objects) ? J.objects : Array.isArray(J.objs) ? J.objs : Array.isArray(J.items) ? J.items : []).filter(isObj).slice(0, 80);
  if ((Array.isArray(J.objects) ? J.objects.length : 0) > 80) note('对象最多 80 个，多的已丢弃');
  const typed: { r: Record<string, unknown>; type: ObjType; id: string }[] = [];
  const ids = new Set<string>();
  rawObjs.forEach((r0, i) => {
    let r = r0;
    const t0 = str(r.type ?? r.kind ?? r.shape, 30);
    const tl = t0.toLowerCase();
    let type = (OBJ_TYPES as string[]).includes(tl) ? (tl as ObjType) : TYPE_ALIAS[tl] ?? TYPE_ALIAS[t0];
    if (!type && ['cube', 'cuboid', 'tetra', 'pyramid', 'prism', 'cone'].includes(tl)) type = 'solid';
    if (!type) { note(`第 ${i + 1} 个对象的类型「${t0 || '空'}」不认识，已丢弃（可用：${OBJ_TYPES.join(' ')}）`); return; }
    if (type === 'solid' && !r.shape && ['cube', 'cuboid', 'tetra', 'pyramid', 'prism', 'cone'].includes(tl)) r = { ...r, shape: tl };
    let id = str(r.id ?? (type === 'molecule' || type === 'crystal' ? '' : r.name), 16).replace(/[\s.]/g, '_');
    if (!IDENT.test(id) || RESERVED.has(id)) id = type + (i + 1);
    while (ids.has(id)) id += '_';
    ids.add(id);
    typed.push({ r, type, id });
  });
  const typeOf = new Map(typed.map((x) => [x.id, x.type]));

  // ── 中间量 ──
  const vars: Record<string, string> = {};
  const rawVars = Array.isArray(J.vars) ? Object.fromEntries((J.vars as unknown[]).filter(isObj).map((v) => [str(v.name ?? v.key, 24), v.expr ?? v.value])) : isObj(J.vars) ? J.vars : {};
  const pkeys = new Set(params.map((p) => p.key));
  for (const [name0, v] of Object.entries(rawVars).slice(0, 40)) {
    let name = name0.trim();
    if (!IDENT.test(name)) { note(`中间量名「${name}」不合法，已忽略`); continue; }
    if (RESERVED.has(name) || pkeys.has(name) || ids.has(name)) { note(`中间量「${name}」和参数 / 对象 / 内置名重名，已改成 ${name}_v`); name += '_v'; }
    const e = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (!e) { note(`中间量 ${name} 没有表达式，已忽略`); continue; }
    vars[name] = e.slice(0, 400);
  }
  const deps = new Map<string, string[]>();
  for (const [name, e] of Object.entries(vars)) {
    try { deps.set(name, identifiers(e).ids.filter((x) => Object.hasOwn(vars, x))); }
    catch (er) { note(`中间量 ${name}：${(er as Error).message}，已改成 0`); vars[name] = '0'; deps.set(name, []); }
  }
  const order: string[] = [], state = new Map<string, number>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 2) return true;
    if (state.get(n) === 1) return false;
    state.set(n, 1);
    for (const d of deps.get(n) ?? []) if (!visit(d)) { note(`中间量 ${n} 和 ${d} 互相引用（循环），已把 ${n} 改成 0`); vars[n] = '0'; deps.set(n, []); break; }
    state.set(n, 2); order.push(n); return true;
  };
  Object.keys(vars).forEach(visit);
  const sortedVars: Record<string, string> = {};
  // 用到但没定义的 g 自动补 10（放在最前面，其它中间量可以用）
  const allText = JSON.stringify([rawObjs, J.charts, J.vars, J.steps]);
  if (/\bg\b/.test(allText) && !pkeys.has('g') && !('g' in vars)) {
    const probe = (s: string) => { try { return identifiers(s).ids.includes('g'); } catch { return false; } };
    if ([...allText.matchAll(/"([^"]{1,400})"/g)].some((m) => /\bg\b/.test(m[1]) && probe(m[1]))) sortedVars.g = '10';
  }
  for (const n of order) sortedVars[n] = vars[n];
  const names = new Set(['t', ...pkeys, ...Object.keys(sortedVars)]);
  const exprOK = (e: unknown, where: string, extra: string[] = []): boolean => {
    if (typeof e === 'number') return Number.isFinite(e);
    if (typeof e !== 'string') return false;
    try { compile(e, { names: extra.length ? new Set([...names, ...extra]) : names, objects: ids }); return true; }
    catch (er) { note(`${where}：「${e.slice(0, 60)}」${(er as Error).message}`); return false; }
  };
  for (const [n, e] of Object.entries(sortedVars)) if (!exprOK(e, '中间量 ' + n)) sortedVars[n] = '0';

  // 可以作为「点」引用的名字
  const pointNames = new Set<string>(ids);
  for (const x of typed) {
    if (x.type === 'solid') solidNames({ ...x.r, id: x.id, type: 'solid', names: typeof x.r.names === 'string' ? splitNames(x.r.names) : x.r.names } as S3DObject).forEach((n) => pointNames.add(n));
    if (x.type === 'point' && typeof x.r.label === 'string') pointNames.add(x.r.label.trim());
  }
  const vecOK = (v: unknown, where: string): unknown[] | undefined => {
    if (isObj(v) && ('x' in v || 'y' in v)) v = [v.x ?? 0, v.y ?? 0, v.z ?? 0];
    if (typeof v === 'string' && /^\s*\[?[-\d.\s,]+\]?\s*$/.test(v)) v = v.replace(/[[\]]/g, '').split(',').map(Number);
    if (!Array.isArray(v) || v.length < 1) return undefined;
    const out = v.slice(0, 3).map((x, i) => {
      const n = finite(x);
      if (n !== undefined) return n;
      if (typeof x === 'string' && exprOK(x, `${where} 第 ${i + 1} 个分量`)) return x.trim();
      return 0;
    });
    while (out.length < 2) out.push(0);
    return out;
  };
  const pointOK = (p: unknown, where: string): unknown => {
    if (typeof p === 'string') {
      const s = p.trim().replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080));
      const mid = /^(mid|lerp)\((.+)\)$/i.exec(s);
      if (mid) { const parts = mid[2].split(',').map((x) => x.trim()); if (parts.slice(0, 2).every((x) => pointNames.has(x))) return mid[1].toLowerCase() + '(' + parts.join(',') + ')'; }
      if (pointNames.has(s)) return s;
      note(`${where}：点「${s}」不存在（可以写坐标 [x,y,z]、对象 id、立体图形顶点名或 mid(A,B)）`);
      return undefined;
    }
    return vecOK(p, where);
  };

  // ── 逐个对象清洗字段 ──
  const objects: S3DObject[] = [];
  for (const { r, type, id } of typed) {
    const schema: Record<string, FieldKind> = { ...COMMON, ...(TYPES[type] as Record<string, FieldKind>) };
    const out: S3DObject = { id, type };
    const unknown: string[] = [];
    const where = `对象 ${id}（${type}）`;
    const src: Record<string, unknown> = {};
    for (const [k0, v] of Object.entries(r)) {
      if (k0 === 'id' || k0 === 'type' || (k0 === 'kind' && !schema.kind)) continue;
      let k = k0;
      if (!(k in schema)) {
        const al = FIELD_ALIAS[k];
        if (al && al in schema) k = al;
        else if (k === 'name' && type !== 'molecule' && type !== 'crystal') { if (!r.label) src.label = v; continue; }
        else if ((k === 'center' || k === 'centre') && 'pos' in schema) k = 'pos';
        else if (k === 'text' && type !== 'label') { if (!r.label) src.label = v; continue; }
        else if (['width', 'height', 'depth', 'w', 'h', 'd'].includes(k) && (type === 'box' || type === 'cart')) {
          const s = (Array.isArray(src.size) ? src.size : Array.isArray(r.size) ? [...(r.size as unknown[])] : type === 'box' ? [1, 0.7, 0.8] : [1.4, 0.45, 0.8]) as unknown[];
          s[({ width: 0, w: 0, height: 1, h: 1, depth: 2, d: 2 } as Record<string, number>)[k]] = v; src.size = s; continue;
        } else if (k === 'shape' && type !== 'solid') continue;
        else if (['mass', 'm', 'mu', 'note', 'desc', 'description', 'comment', 'unit', 'physics', 'name'].includes(k)) continue;
        else { unknown.push(k0); continue; }
      }
      src[k] = v;
    }
    if ((type === 'molecule' || type === 'crystal') && !src.name && typeof r.label === 'string') src.name = r.label;
    if (unknown.length) note(`${where} 忽略了不认识的字段：${unknown.slice(0, 6).join('、')}`);
    for (const [k, v] of Object.entries(src)) {
      const kind = schema[k];
      if (v === null || v === undefined) continue;
      const fw = `${where} 的 ${k}`;
      if (kind === 'num') {
        const n = finite(typeof v === 'string' ? v.replace(/°$/, '') : v);
        if (n !== undefined) out[k] = n;
        else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
        else if (typeof v === 'string' && exprOK(v.replace(/°/g, ''), fw)) out[k] = v.trim().replace(/°/g, '');
      } else if (kind === 'vec') {
        const n = finite(v);
        if (n !== undefined && k === 'size') out[k] = [n, n, n];
        else if (n !== undefined && type === 'solid') out[k] = n;
        else { const vv = vecOK(v, fw); if (vv) out[k] = vv; else note(`${fw} 应该是 [x,y,z] 坐标，已忽略`); }
      } else if (kind === 'pt') { const p = pointOK(v, fw); if (p !== undefined) out[k] = p; }
      else if (kind === 'pts') {
        if (!Array.isArray(v)) { note(`${fw} 应该是点的列表`); continue; }
        const list = v.slice(0, 24).map((p, i) => pointOK(p, `${fw} 第 ${i + 1} 个点`)).filter((p) => p !== undefined);
        if (list.length) out[k] = list;
      } else if (kind === 'str') { const s = str(v, k === 'fn' || k === 'f' || k === 'y' || k === 'z' ? 400 : 60); if (s) out[k] = s; }
      else if (kind === 'text') { const s = str(v, 160); if (s) out[k] = s; }
      else if (kind === 'bool') out[k] = v === true || v === 1 || v === 'true' || v === 'yes';
      else if (kind === 'color') {
        const s = str(v, 20).toLowerCase();
        const c = COLORS[s] ?? COLORS[str(v, 20)] ?? (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) ? s : undefined) ?? KIND_COLOR[s];
        if (c) out[k] = c; else note(`${fw}「${s}」不是认识的颜色，用默认色`);
      } else if (kind === 'ref') {
        const s = str(v, 30);
        if (!ids.has(s)) { note(`${fw}：对象「${s}」不存在`); continue; }
        if (k === 'on' && !SURFACE_TYPES.has(typeOf.get(s)!)) { note(`${fw}：「${s}」不是斜面 / 地面 / 传送带，不能放在上面`); continue; }
        if ((k === 'at' || k === 'of') && !BODY_TYPES.has(typeOf.get(s)!)) { note(`${fw}：「${s}」不是物体`); continue; }
        out[k] = s;
      } else if (kind === 'refs') {
        const list = (Array.isArray(v) ? v : [v]).map((x) => str(x, 30)).filter((x) => ids.has(x) && typeOf.get(x) === 'pulley');
        if (list.length) out[k] = list.slice(0, 4); else note(`${fw} 里没有找到滑轮（via 只写滑轮的 id）`);
      } else if (kind === 'dir') {
        if (typeof v === 'string' && (v in DIR_WORDS || DIR_REL.has(v))) out[k] = v;
        else if (Array.isArray(v)) { const vv = vecOK(v, fw); if (vv) out[k] = vv; }
        else { const n = finite(typeof v === 'string' ? v.replace(/°$/, '') : v); if (n !== undefined) out[k] = n; else if (typeof v === 'string' && exprOK(v.replace(/°/g, ''), fw)) out[k] = v.trim().replace(/°/g, ''); }
      } else if (kind?.startsWith('enum:')) {
        const opts = kind.slice(5).split('|'), s = str(v, 20);
        const hit = opts.find((x) => x.toLowerCase() === s.toLowerCase());
        if (hit) out[k] = hit; else note(`${fw}「${s}」不在可选值 ${opts.join('/')} 里，用默认`);
      } else if (kind === 'json') {
        const fixed = jsonField(type, k, v, fw, note, exprOK, pointOK);
        if (fixed !== undefined) out[k] = fixed;
      }
    }
    if (out.step !== undefined) out.step = Math.max(1, Math.round(Number(out.step) || 1));
    if (type === 'arrow' && !out.at && !out.from) { note(`${where} 没有起点（at 物体 id 或 from 坐标），已丢弃`); continue; }
    if (type === 'arrow' && out.dir === undefined && !out.to) { note(`${where} 没有方向（dir 或 to），默认向上`); out.dir = 'up'; }
    if (type === 'arrow' && typeof out.dir === 'string' && DIR_REL.has(out.dir)) {
      const host = typeof out.at === 'string' ? objectsOn(typed, out.at) : false;
      if (!host) note(`${where}：dir="${out.dir}" 只对放在斜面 / 地面上（写了 on）的物体有效，已按竖直 / 水平处理`);
    }
    if ((type === 'rope' || type === 'spring' || type === 'rod' || type === 'segment' || type === 'measure') && (!out.from || !out.to)) { note(`${where} 缺少两端 from / to，已丢弃`); continue; }
    if (type === 'trail' && !out.of) { note(`${where} 缺少 of（要画轨迹的物体 id），已丢弃`); continue; }
    if (type === 'curve' && !out.fn && !out.points && !(out.x || out.y || out.z)) { note(`${where} 没有 fn（y=f(x)）也没有参数方程 x/y/z(u)，已丢弃`); continue; }
    if (type === 'curve' && out.fn && !exprOK(out.fn, `${where} 的 fn`, ['x'])) continue;
    if (type === 'curve' && !out.fn) for (const k of ['x', 'y', 'z']) if (typeof out[k] === 'string' && !exprOK(out[k], `${where} 的 ${k}(u)`, ['u'])) delete out[k];
    if (type === 'surface' && (!out.f || !exprOK(out.f, `${where} 的 f`, ['x', 'y']))) { note(`${where} 缺少可用的 f(x,y)，已丢弃`); continue; }
    if ((type === 'polygon' || type === 'plane') && (!Array.isArray(out.points) || out.points.length < 3)) { note(`${where} 至少要 3 个点，已丢弃`); continue; }
    if (type === 'molecule' && !out.atoms && !(typeof out.name === 'string' && moleculeByName(out.name))) { note(`${where}：内置分子里没有「${str(out.name) || '空'}」，请改用 atoms 自己写坐标（内置：H2O CO2 CH4 NH3 C2H4 C2H2 C6H6 C2H5OH CH3COOH CH3OH H2 O2 N2 Cl2 HCl SO2 C2H6）`); continue; }
    if (type === 'sphere' && !out.center) out.center = [0, 0, 0];
    if (type === 'label' && !out.text && out.label) { out.text = out.label; delete out.label; }
    if (type === 'label' && !out.text) { note(`${where} 没有 text，已丢弃`); continue; }
    if (type === 'solid' && Array.isArray(out.section) && (out.section as unknown[]).length < 3) { note(`${where} 的 section 至少要 3 个点`); delete out.section; }
    objects.push(out);
  }
  if (!objects.length) errors.push('没有可以显示的对象（objects 为空或全部不合法）');

  // ── 图表、步骤、说明 ──
  const charts: S3DChart[] = [];
  const palette = ['#4f8cff', '#ff9f43', '#34d399', '#f472b6', '#a78bfa'];
  const colorOf = (c: unknown, i: number) => COLORS[str(c).toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(str(c)) ? str(c) : palette[i % palette.length]);
  for (const c0 of (Array.isArray(J.charts) ? J.charts : isObj(J.charts) ? [J.charts] : []).slice(0, 3)) {
    if (!isObj(c0)) continue;
    const type = c0.type === 'bars' || Array.isArray(c0.bars) ? 'bars' : 'line';
    const series = (Array.isArray(c0.series) ? c0.series : c0.y !== undefined ? [{ y: c0.y, name: c0.name, color: c0.color }] : []).filter(isObj)
      .map((s, i) => ({ y: typeof s.y === 'number' ? String(s.y) : str(s.y, 300), name: str(s.name ?? s.label, 16), color: colorOf(s.color, i) }))
      .filter((s) => s.y && exprOK(s.y, `图表「${str(c0.title) || '未命名'}」的 y`)).slice(0, 4);
    const bars = (Array.isArray(c0.bars) ? c0.bars : []).filter(isObj)
      .map((b, i) => ({ name: str(b.name ?? b.label, 12) || `第${i + 1}项`, value: typeof b.value === 'number' ? String(b.value) : str(b.value ?? b.y, 300), color: colorOf(b.color, i) }))
      .filter((b) => b.value && exprOK(b.value, `柱状图「${str(c0.title) || '未命名'}」的 ${b.name}`)).slice(0, 6);
    if (type === 'line' && !series.length) { note('有一个图表没有可用的 y 表达式，已丢弃'); continue; }
    if (type === 'bars' && !bars.length) { note('有一个柱状图没有可用的 bars，已丢弃'); continue; }
    const ymin = finite(c0.ymin), ymax = finite(c0.ymax);
    charts.push({ title: str(c0.title, 20) || (type === 'bars' ? '能量' : '图像'), type, series, bars, xLabel: str(c0.xLabel, 12) || 't/s', yLabel: str(c0.yLabel, 16), ...(ymin !== undefined && ymax !== undefined && ymax > ymin ? { ymin, ymax } : {}) });
  }
  const steps: S3DStep[] = (Array.isArray(J.steps) ? J.steps : []).slice(0, 12).map((s): S3DStep => {
    if (typeof s === 'string') return { say: s.slice(0, 120) };
    if (!isObj(s)) return { say: '' };
    const cam = str(s.camera);
    const at = finite(s.at);
    return { say: str(s.say ?? s.text ?? s.title, 120), ...((CAMERAS as readonly string[]).includes(cam) ? { camera: cam } : {}), ...(at !== undefined ? { at } : {}) };
  }).filter((s) => s.say);
  const notes = (Array.isArray(J.notes) ? J.notes : typeof J.notes === 'string' ? [J.notes] : []).map((x) => str(x, 140)).filter(Boolean).slice(0, 6);
  const maxStep = Math.max(0, ...objects.map((x) => Number(x.step) || 0));
  if (maxStep > steps.length) {
    if (steps.length) note(`有对象写了 step=${maxStep}，但 steps 只有 ${steps.length} 步`);
    for (const x of objects) if (Number(x.step) > steps.length) delete x.step;
  }

  // ── 模式、时长、坐标、机位 ──
  const exprWithT = (v: unknown): boolean => typeof v === 'string' ? /(^|[^\p{L}\p{N}_.])t($|[^\p{L}\p{N}_(])/u.test(v) : Array.isArray(v) ? v.some(exprWithT) : isObj(v) ? Object.values(v).some(exprWithT) : false;
  const varsWithT = Object.entries(sortedVars).filter(([, e]) => exprWithT(e)).map(([n]) => n);
  const usesVarT = (v: unknown): boolean => typeof v === 'string' ? varsWithT.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}_])${n}($|[^\\p{L}\\p{N}_])`, 'u').test(v)) : Array.isArray(v) ? v.some(usesVarT) : isObj(v) ? Object.values(v).some(usesVarT) : false;
  const moving = objects.some((x) => x.motion || (x.type === 'earth' && (x.orbit || x.spin)) || (x.type === 'pendulum' && x.angle === undefined) || x.type === 'moon' || x.type === 'atom' || x.type === 'wave' || Object.entries(x).some(([k, v]) => k !== 'show' && k !== 'step' && (exprWithT(v) || usesVarT(v))));
  const modeRaw = str(J.mode).toLowerCase();
  let mode: 'motion' | 'static' = modeRaw === 'motion' || modeRaw === '运动' || modeRaw === 'dynamic' ? 'motion' : modeRaw === 'static' || modeRaw === '静态' ? 'static' : moving ? 'motion' : 'static';
  if (mode === 'motion' && !moving) { note('mode 写的是 motion，但没有任何东西在动（没有 motion 配方、也没有含 t 的公式），已改成 static'); mode = 'static'; }
  let duration = finite(J.duration) ?? (mode === 'static' ? Math.max(8, steps.length * 4) : 8);
  if (duration < 1 || duration > 60) { note('duration 应在 1~60 秒之间，已调整'); duration = Math.max(1, Math.min(60, duration)); }
  const hasMath3d = objects.some((x) => x.type === 'surface' || x.type === 'solid' || (x.type === 'axes' && Array.isArray(x.z)));
  const upRaw = str(J.up).toLowerCase();
  const up: 'y' | 'z' = upRaw === 'z' ? 'z' : upRaw === 'y' ? 'y' : hasMath3d ? 'z' : 'y';
  const camRaw = isObj(J.camera) ? str(J.camera.view ?? J.camera.preset) : str(J.camera);
  const camera: CameraName = (CAMERAS as readonly string[]).includes(camRaw) ? camRaw as CameraName : ({ 正视: 'front', 侧视: 'side', 俯视: 'top', 斜视: 'iso', 正面: 'front', 侧面: 'side' } as Record<string, CameraName>)[camRaw] ?? 'iso';
  const space = objects.some((x) => x.type === 'earth' || x.type === 'sun' || x.type === 'moon');
  const plain = objects.every((x) => ['molecule', 'crystal', 'atom', 'cell', 'dna', 'label', 'arrow', 'timeline', 'angle', 'point', 'segment'].includes(x.type));
  const stRaw = str(J.stage);
  const stage = stRaw === 'floor' || stRaw === 'space' || stRaw === 'plain' ? stRaw : space ? 'space' : plain ? 'plain' : 'floor';

  const spec: S3DSpec = { v: 1, title, subject, mode, up, duration, camera, stage, params, vars: sortedVars, objects, charts, steps, notes };
  if (errors.length) return { ok: false, spec: null, issues, errors };

  try {
    const w = new World(spec);
    for (const p of w.problems.slice(0, 5)) note(p);
    const b = w.bounds();
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    if (size > 200) note(`场景太大（约 ${Math.round(size)} 个单位），物体会显得很小；请按比例缩小到 2~20 个单位（在 notes 里写明比例）`);
    if (size < 0.3) note('场景太小（不到 0.3 个单位），请把尺寸放大到 2~20 个单位');
  } catch (e) { errors.push('试算失败：' + (e as Error).message); }
  const bytes = JSON.stringify(spec).length;
  if (bytes > 120000) errors.push(`规格太大（${Math.round(bytes / 1024)} KB），请精简对象`);
  return { ok: !errors.length, spec: errors.length ? null : spec, issues, errors };
}

function objectsOn(typed: { r: Record<string, unknown>; id: string }[], id: string) {
  const host = typed.find((x) => x.id === id);
  return !!host && (typeof host.r.on === 'string' || typeof host.r.surface === 'string');
}

/** json 字段（运动配方、分子原子表、坐标轴标签、地球轨道、时间轴事件…）的检查 */
function jsonField(type: ObjType, k: string, v: unknown, where: string, note: (s: string) => void, exprOK: (e: unknown, w: string, extra?: string[]) => boolean, pointOK: (p: unknown, w: string) => unknown): unknown {
  const num = (x: unknown, d: number) => { const n = finite(x); return n === undefined ? d : n; };
  const numOrExpr = (x: unknown, w: string) => { const n = finite(x); if (n !== undefined) return n; if (typeof x === 'string' && exprOK(x, w)) return x; return undefined; };
  const vec = (x: unknown, w: string) => {
    if (typeof x === 'number' || typeof x === 'string') return numOrExpr(x, w);
    if (!Array.isArray(x)) return undefined;
    return x.slice(0, 3).map((c, i) => numOrExpr(c, `${w} 第 ${i + 1} 个分量`) ?? 0);
  };
  if (k === 'motion') {
    if (!isObj(v)) { note(`${where} 应该是 {"type":...} 对象`); return undefined; }
    const ALIAS: Record<string, string> = { uniform_accel: 'accel', accelerate: 'accel', 匀加速: 'accel', 匀变速: 'accel', 匀速: 'linear', constant: 'linear', throw: 'projectile', 抛体: 'projectile', 平抛: 'projectile', 斜抛: 'projectile', circular: 'circle', 圆周: 'circle', oscillate: 'shm', vibrate: 'shm', 简谐: 'shm', 振动: 'shm', piecewise: 'phases', stages: 'phases', 分段: 'phases', keyframes: 'keys', rotate: 'spin', 自转: 'spin', 转动: 'spin' };
    const t0 = str(v.type).toLowerCase(), type2 = ['accel', 'linear', 'uniform', 'projectile', 'circle', 'shm', 'phases', 'keys', 'spin'].includes(t0) ? t0 : ALIAS[t0] ?? ALIAS[str(v.type)];
    if (!type2) { note(`${where}：运动配方「${t0 || '空'}」不认识（可用 accel linear projectile circle shm phases keys spin）`); return undefined; }
    const out: Record<string, unknown> = { type: type2 };
    for (const [kk, x] of Object.entries(v)) {
      if (kk === 'type') continue;
      if (kk === 'phases' && Array.isArray(x)) out.phases = x.filter(isObj).slice(0, 8).map((p) => ({ dur: Math.max(0, num(p.dur ?? p.duration ?? p.t, 1)), a: Array.isArray(p.a) ? (p.a as unknown[]).slice(0, 3).map((c) => num(c, 0)) : num(p.a ?? p.acc, 0) }));
      else if (kk === 'keys' && Array.isArray(x)) out.keys = x.filter(isObj).slice(0, 30).map((p) => ({ t: num(p.t, 0), ...(Array.isArray(p.pos) ? { pos: (p.pos as unknown[]).slice(0, 3).map((c) => num(c, 0)) } : { s: num(p.s ?? p.pos, 0) }) }));
      else if (kk === 'center') { const p = pointOK(x, `${where} 的 center`); if (p !== undefined) out.center = p; }
      else if (['dir', 'plane', 'axis', 'ease'].includes(kk) && typeof x === 'string') out[kk] = x.slice(0, 12);
      else if (kk === 'start' && typeof x === 'string' && !/^-?[\d.]+$/.test(x)) out.start = x.slice(0, 12);
      else if (kk === 'stop') out.stop = !!x;
      else if (['v0', 'a'].includes(kk)) { const vv = vec(x, `${where} 的 ${kk}`); if (vv !== undefined) out[kk] = vv; }
      else if (['s0', 'r', 'period', 'omega', 'angle', 'g', 'amp', 'phase', 'start', 'until', 'floor'].includes(kk)) { const n = numOrExpr(x, `${where} 的 ${kk}`); if (n !== undefined) out[kk] = n; }
      else if (kk === 'speed' && type2 === 'circle') { const n = finite(x); if (n) out.omega = n / Math.max(0.01, num(v.r, 1)); }
      else if (kk === 'speed' || kk === 'v') { const n = numOrExpr(x, `${where} 的 ${kk}`); if (n !== undefined) out.v0 = n; }
      else note(`${where}：配方里的「${kk}」没有用到`);
    }
    if (type2 === 'phases' && !Array.isArray(out.phases)) { note(`${where}：phases 配方需要 phases 列表 [{"dur":秒,"a":加速度}]`); return undefined; }
    if (type2 === 'keys' && !Array.isArray(out.keys)) { note(`${where}：keys 配方需要 keys 列表 [{"t":秒,"pos":[x,y,z]}]`); return undefined; }
    return out;
  }
  if (type === 'molecule' && k === 'atoms') {
    if (!Array.isArray(v)) return undefined;
    const atoms = v.slice(0, 80).map((a) => (Array.isArray(a) ? [str(a[0], 3), num(a[1], 0), num(a[2], 0), num(a[3], 0)] : isObj(a) ? [str(a.el ?? a.e ?? a.element, 3), num(a.x, 0), num(a.y, 0), num(a.z, 0)] : null)).filter((a) => a && a[0]);
    return atoms.length ? atoms : undefined;
  }
  if (type === 'molecule' && k === 'bonds') {
    if (!Array.isArray(v)) return undefined;
    return v.slice(0, 120).filter(Array.isArray).map((b) => [Math.round(num(b[0], 0)), Math.round(num(b[1], 0)), Math.max(1, Math.min(3, Math.round(num(b[2], 1))))]);
  }
  if (type === 'axes' && k === 'labels') return Array.isArray(v) ? v.slice(0, 3).map((x) => str(x, 12)) : undefined;
  if (type === 'curve' && k === 'x') { if (typeof v === 'string') return exprOK(v, where, ['u']) ? v : undefined; const n = vec(v, where); return Array.isArray(n) ? n : undefined; }
  if (type === 'curve' && k === 'points') return Array.isArray(v) ? v.slice(0, 200).map((p, i) => pointOK(p, `${where} 第 ${i + 1} 个点`)).filter((p) => p !== undefined) : undefined;
  if (type === 'solid' && k === 'size') { const n = finite(v); if (n !== undefined) return Math.max(0.1, n); return Array.isArray(v) ? v.slice(0, 3).map((x) => Math.max(0.1, num(x, 2))) : undefined; }
  if (type === 'solid' && k === 'names') return Array.isArray(v) ? v.slice(0, 8).map((x) => str(x, 4)) : typeof v === 'string' ? splitNames(v).slice(0, 8) : undefined;
  if (type === 'earth' && k === 'orbit') {
    if (v === true) return { r: 6 };
    if (!isObj(v)) return undefined;
    const c = v.center !== undefined ? pointOK(v.center, `${where} 的 center`) : undefined;
    const per = finite(v.period);
    return { r: Math.max(1, num(v.r, 6)), ...(per ? { period: Math.max(1, per) } : {}), start: num(v.start, 0), ...(c !== undefined ? { center: c } : {}) };
  }
  if (type === 'earth' && k === 'marks') return Array.isArray(v) ? v.filter(isObj).slice(0, 12).map((m) => ({ lat: Math.max(-90, Math.min(90, num(m.lat, 0))), lon: Math.max(-180, Math.min(180, num(m.lon, 0))), text: str(m.text ?? m.name, 16) })) : undefined;
  if (type === 'atom' && k === 'shells') return Array.isArray(v) ? v.slice(0, 7).map((x) => Math.max(1, Math.min(32, Math.round(num(x, 1))))) : undefined;
  if (type === 'timeline' && k === 'events') {
    if (!Array.isArray(v)) return undefined;
    const ev = v.filter(isObj).slice(0, 14).map((e, i) => ({ at: num(e.at ?? e.year ?? e.time, i), text: str(e.text ?? e.title ?? e.name, 24), sub: str(e.sub ?? e.desc ?? e.detail, 40) })).filter((e) => e.text);
    return ev.length ? ev.sort((a, b) => a.at - b.at) : undefined;
  }
  return undefined;
}

/** 规格的默认可调参数值（存进 scene.params，供共享时钟使用） */
export const paramDefaults = (spec: S3DSpec) => Object.fromEntries(spec.params.map((p) => [p.key, p.value]));
