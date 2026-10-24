// ── 模型输出契约：预设 / 自由场景 / 板书绘图 的校验与夹紧 + 提示词 ─────────────
// 模型输出一律视为不可信：未知字段丢弃、数值夹到范围、连接修正；失败时给出可读的问题列表。
import type { PhysObj, Scene } from '../model';
import { OBJ_KINDS, type ObjKind } from '../model';
import type { Stroke, Tool } from '../../lib/types';
import { PRESETS, clampParams, presetById } from './presets';
import { sceneErrors, SUPPORTED } from './domain';
import { packOf, type SubjectId } from '../../lib/subjects';
import { mathTex, texPlain, unicodeScripts } from '../../lib/formulaText';

const PAGE_RATIO = 900 / 1600;

const PROP_RANGE: Record<string, [number, number]> = {
  m: [1e-31, 1e6], mu: [0, 2], e: [0, 1], vx: [-100, 100], vy: [-100, 100], ax: [-100, 100], ay: [-100, 100], angle: [-180, 180], speed: [-50, 50],
  k: [0.1, 1e5], L0: [0, 100], q: [-1e-3, 1e-3], B: [-20, 20], E: [-1e8, 1e8], L: [0.001, 100],
};
const STR_PROPS = new Set(['a', 'b', 'qUnit']);
const BOOL_PROPS = new Set(['fixed', 'showV', 'showF', 'trail', 'plates', 'rigid', 'gravity', 'rotate', 'pt']);

export interface Validated { ok: boolean; scene?: Scene; title: string; issues: string[]; preset?: string; params?: Record<string, number> }

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) return +v;
  return undefined;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 从模型文本里取出 JSON 对象（容忍 ```json 包裹和前后说明文字） */
export function parseJSONLoose(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== 'string') return null;
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : input;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(body.slice(a, b + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

export function validateSceneJSON(input: unknown): Validated {
  const issues: string[] = [];
  const r = parseJSONLoose(input);
  if (!r) return { ok: false, title: '', issues: ['模型没有给出合法的 JSON'] };
  const title = typeof r.title === 'string' ? r.title.slice(0, 40) : '';

  if (typeof r.preset === 'string' && r.preset !== 'none') {
    const pre = presetById(r.preset);
    if (!pre) return { ok: false, title, issues: [`模型选了不存在的模板 ${r.preset}`] };
    const raw: Record<string, number> = {};
    const p = (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      const n = num(v);
      if (n === undefined) { issues.push(`参数 ${k} 不是数`); continue; }
      if (!pre.params.some((d) => d.key === k) && k !== 'g') { issues.push(`忽略未知参数 ${k}`); continue; }
      raw[k] = n;
    }
    const g = num(r.g); if (g !== undefined) raw.g = clamp(g, 0, 30);
    const params = clampParams(pre, raw);
    for (const d of pre.params) if (raw[d.key] !== undefined && Math.abs(params[d.key] - raw[d.key]) > 1e-9 * Math.max(1, Math.abs(raw[d.key]))) issues.push(`${d.label} 超出演示范围，已调整为 ${params[d.key]}`);
    const scene = pre.build(params);
    return { ok: true, scene: { ...scene, title: title || pre.title }, title: title || pre.title, issues, preset: pre.id, params };
  }

  if (!Array.isArray(r.objs)) return { ok: false, title, issues: ['模型既没选模板，也没给出器材'] };
  const rp0 = (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>;
  const micro = (num(rp0.timeScale ?? r.timeScale) ?? 1) < 1;
  const objs: PhysObj[] = [];
  (r.objs as unknown[]).slice(0, 40).forEach((x, i) => {
    if (!x || typeof x !== 'object') { issues.push(`第 ${i + 1} 个器材无效`); return; }
    const q = x as Record<string, unknown>;
    if (!OBJ_KINDS.includes(q.kind as ObjKind) || !SUPPORTED.has(String(q.kind))) { issues.push(`器材 ${String(q.kind)} 本版不能仿真，已跳过`); return; }
    const props: PhysObj['props'] = {};
    for (const [k, v] of Object.entries((q.props && typeof q.props === 'object' ? q.props : {}) as Record<string, unknown>)) {
      if (STR_PROPS.has(k) && (typeof v === 'string' || typeof v === 'number')) props[k] = String(v).slice(0, 40);
      else if (BOOL_PROPS.has(k) && typeof v === 'boolean') props[k] = v;
      else if (micro && (k === 'vx' || k === 'vy') && String(q.kind).startsWith('charge')) { const n = num(v); if (n !== undefined) props[k] = clamp(n, -3e8, 3e8); }
      else if (PROP_RANGE[k]) { const n = num(v); if (n !== undefined) props[k] = clamp(n, ...PROP_RANGE[k]); }
    }
    objs.push({
      id: typeof q.id === 'string' && q.id ? q.id.slice(0, 40) : `o${i + 1}`, kind: q.kind as ObjKind,
      x: clamp(num(q.x) ?? 0.5, 0, 1), y: clamp(num(q.y) ?? PAGE_RATIO / 2, 0, PAGE_RATIO),
      w: clamp(num(q.w) ?? 0.05, 0.004, 1), h: clamp(num(q.h) ?? 0.05, 0.004, 1),
      rot: clamp(num(q.rot) ?? 0, -2 * Math.PI, 2 * Math.PI), props,
      label: typeof q.label === 'string' ? q.label.slice(0, 6) : undefined,
    });
  });
  const ids = new Set(objs.map((x) => x.id));
  for (const x of objs) for (const k of ['a', 'b'] as const) if (x.props[k] !== undefined && !ids.has(String(x.props[k]))) { issues.push(`${x.id} 连接到不存在的 ${x.props[k]}`); delete x.props[k]; }
  const w = (r.world && typeof r.world === 'object' ? r.world : {}) as Record<string, unknown>;
  // 微观粒子：timeScale = 演示 1 秒对应的真实秒数（例如 1e-7），substeps 让高速圆周更精确
  const rp = rp0;
  const params: Record<string, number> = {};
  const ts = num(rp.timeScale ?? r.timeScale);
  if (ts !== undefined && ts > 0 && ts < 1) params.timeScale = clamp(ts, 1e-12, 1);
  const sub = num(rp.substeps);
  if (sub !== undefined && sub > 1) params.substeps = Math.round(clamp(sub, 1, 32));
  const scene: Scene = {
    title: title || 'AI 演示', objs,
    world: { g: clamp(num(w.g) ?? 10, 0, 30), ppm: clamp(num(w.ppm) ?? 0.1, 1e-6, 1e6) },
    duration: clamp(num(r.duration) ?? 8, 0.5, 30), graphs: ['vt', 'xt', 'energy'],
    ...(Object.keys(params).length ? { params } : {}),
  };
  const errs = sceneErrors(scene);
  if (errs.length) return { ok: false, title, issues: [...issues, ...errs] };
  return { ok: true, scene, title: scene.title!, issues };
}

/** 题目 → 演示 JSON 的提示词 */
export function scenePrompt(problem: string, withImage: boolean): string {
  const list = PRESETS.map((p) => `- ${p.id}（${p.title}）：${p.params.map((d) => `${d.key}=${d.label}${d.unit ? '[' + d.unit + ']' : ''} ${d.min}~${d.max}${d.options ? '（可选 ' + d.options.map((o) => o.v + '=' + o.label).join('，') + '）' : ''}`).join('；')}`).join('\n');
  return [
    '任务：把一道高中物理题变成可以播放的物理演示。只输出一个 JSON 对象，不要任何解释。',
    withImage ? '题目在附带的图片里（学生当前看到的画面，或老师上传的题目照片）。有多张图时，它们是同一道题的多个部分，都要看。先读懂题目和图，再选择模板。' : '',
    '首选：从下面的模板里选最贴切的一个：{"preset":"<id>","params":{...},"title":"<不超过 16 字>","g":10,"why":"<一句话说明为什么选它>"}',
    '参数必须换算成括号里的单位（例如磁场模板速度用 ×10⁶ m/s，电场模板板长用 cm）；题目没给的参数直接省略，不要编造。',
    '如果所有模板都明显不合适，再输出自由场景：{"preset":"none","title":"...","world":{"g":10,"ppm":0.1},"duration":8,"objs":[...]}',
    '  自由场景坐标：x 以页宽为 1，y 向下，页高 0.5625；ppm = 每米对应的页宽比例；kind 只能取 ' + [...SUPPORTED].join('/') + '；props 用国际单位：m mu e vx vy(向上为正) angle speed k L0 q B E fixed；斜面 angle 是倾角；field-e 的 angle 是电场方向（0 向右、90 向上、-90 向下），加 "plates":true 画成平行板；spring/rope/rod 用 props.a 与 props.b 指向两端器材 id。',
    '',
    '可用模板：',
    list,
    '',
    problem ? '题目：\n' + problem.slice(0, 4000) : '',
  ].filter(Boolean).join('\n');
}

// ── 演示智能体：模型和导播台的仿真工具多轮对话 ─────────────────────
const presetLine = (p: (typeof PRESETS)[number]) => `- ${p.id}「${p.title}」${p.summary}\n  参数：${p.params.map((d) => `${d.key}=${d.label}${d.unit ? '[' + d.unit + ']' : ''} ${d.min}~${d.max}${d.options ? '（' + d.options.map((o) => o.v + '=' + o.label).join('，') + '）' : ''}`).join('；')}`;

export const DEMO_AGENT_SYSTEM = [
  '你是高中物理演示的搭建助手。你和「导播台」的二维物理仿真器对话：你提交方案，导播台真的运行它，把运动摘要和 4 帧截图发回给你，你对照题目检查，不对就改。',
  '每次回复只输出一个 JSON 对象，不要任何其他文字。可用的回复：',
  '1. 查看模板生成的器材（想在模板基础上改，或想知道模板里有什么）：{"tool":"preset_scene","preset":"<id>","params":{...}}',
  '2. 提交方案：{"understand":"<题目描述的物理过程，1~2 句>","expect":"<播放时应看到的运动：哪个物体、往哪动、依次发生什么>","plan":<方案>}',
  '   方案 A（模板，首选，带公式和读数卡）：{"preset":"<id>","params":{...},"title":"<≤16 字>","g":10}',
  '   方案 B（自由场景，模板覆盖不了时用）：{"preset":"none","title":"...","world":{"g":10,"ppm":0.1},"duration":8,"params":{},"objs":[...]}',
  '3. 确认最后一次运行结果与题目一致：{"accept":true,"why":"<一句话>"}',
  '',
  '原则：',
  '- 演示必须「会动」，而且运动过程要和题目一致（方向、先后顺序、是否离开场区/落地/共速）。看截图里的轨迹判断，不要只看数字。',
  '- 模板只覆盖它描述的那一种过程。题目有多段过程或多个场区（例如先电场加速再进磁场）时，先用 preset_scene 取最接近的模板器材，再改成自由场景。',
  '- 题目是概念题（例如速度与加速度的关系）时，搭最简单、能说明概念的场景：例如两辆小车，一辆 ax 与 vx 同向（加速）、一辆反向（减速），显示速度矢量和 v-t 图。',
  '- 参数换算成模板括号里的单位；题目没给的参数省略，不要编造。',
  '- 自由场景坐标：x 以页宽为 1（0~1，向右），y 向下（0~0.5625）；物体要放在画面内（x 0.05~0.95，y 0.05~0.52）。ppm = 每米对应的页宽，选得让整个运动范围占画面宽度的 50%~80%。',
  '- 器材 kind 只能取：' + [...SUPPORTED].join('、') + '。每个器材：{"id":"A","kind":"ball","x":0.2,"y":0.4,"w":0.04,"h":0.04,"rot":0,"label":"A","props":{...}}。',
  '- props（国际单位）：m 质量、mu 动摩擦因数、e 恢复系数、vx vy 初速度（y 向上为正）、ax ay 恒定外力产生的加速度（牵引/推力，向上为正）、angle（斜面倾角；field-e 为电场方向：0 向右、90 向上、-90 向下）、speed 传送带速度、k L0 弹簧、L 绳/杆长、q 电荷（C）、B 磁感应强度（T）、E 场强（N/C）、fixed 固定、gravity（带电粒子是否受重力）、plates（field-e 画成平行板）、a/b（spring/rope/rod 两端的器材 id）。',
  '- 场区 field-b-in（垂直纸面向里）/field-b-out（向外）/field-e 是矩形区域，带电粒子 charge-pos/charge-neg 只在区域内受力。ground 是地面（放在物体下方）。',
  '- 微观带电粒子用真实 SI 数值（例如 q=1.6e-19，m=1.67e-27，v=1e6），并在 plan.params 里给 "timeScale"：演示 1 秒对应的真实秒数（例如 1e-7），使整个过程在 3~10 秒播完；ppm 按真实尺度选（例如半径 0.05 m 时 ppm≈6）。',
  '- 宏观物体速度不超过 100 m/s，质量不小于 0.001 kg。',
].join('\n');

export function demoAgentFirst(problem: string, withImage: boolean): string {
  return [
    withImage ? '题目在附带的图片里（学生当前看到的画面，或老师上传的题目照片；若有多张，是同一道题的多个部分）。若图片里有多道题，以老师文字说明为准，否则选画面中央最完整的那道。' : '',
    problem ? '老师给的题目 / 要求：\n' + problem.slice(0, 4000) : '',
    '',
    '可用模板：',
    PRESETS.map(presetLine).join('\n'),
    '',
    '先读懂题目，然后直接提交方案（或先用 preset_scene 查看模板器材）。',
  ].filter((x) => x !== '').join('\n');
}

/** preset_scene 工具：返回模板按参数生成的完整器材 JSON，供模型改成自由场景 */
export function presetSceneTool(id: unknown, raw: unknown): string {
  const pre = typeof id === 'string' ? presetById(id) : undefined;
  if (!pre) return `没有模板 ${String(id)}。可用：${PRESETS.map((p) => p.id).join('、')}`;
  const p: Record<string, number> = {};
  for (const [k, v] of Object.entries((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>)) { const n = num(v); if (n !== undefined) p[k] = n; }
  const scene = pre.build(clampParams(pre, p));
  const r6 = (v: unknown) => (typeof v === 'number' ? +v.toPrecision(6) : v);
  const objs = scene.objs.map((o) => ({ id: o.id, kind: o.kind, x: r6(o.x), y: r6(o.y), w: r6(o.w), h: r6(o.h), rot: r6(o.rot), ...(o.label ? { label: o.label } : {}), props: Object.fromEntries(Object.entries(o.props).map(([k, v]) => [k, r6(v)])) }));
  const params = Object.fromEntries(Object.entries(scene.params ?? {}).filter(([k]) => k === 'timeScale' || k === 'substeps').map(([k, v]) => [k, r6(v)]));
  return `模板 ${pre.id} 生成的器材（改成自由场景时可以照抄再修改；注意改成自由场景后没有模板的公式卡）：\n`
    + JSON.stringify({ preset: 'none', title: scene.title, world: scene.world, duration: scene.duration, params, objs });
}

// ── 讲题 ───────────────────────────────────────────────
export interface Explain { title: string; problem: string; idea: string; steps: { t: string; tex: string; plain: string }[]; answer: string; pitfalls: string[] }

export function explainPrompt(problem: string, withImage: boolean, subject: SubjectId = 'physics'): string {
  const pack = packOf(subject);
  return [
    `你是经验丰富的${pack.stage}老师，正在给一位学生一对一讲题。只输出一个 JSON 对象，不要任何解释。`,
    withImage ? '题目在附带的图片里（学生当前看到的画面，或老师上传的题目照片），先完整读出题目。' : '',
    '格式：{"title":"<题型，不超过 12 字>","problem":"<读出的题目原文，含所有数据>","idea":"<解题突破口，一两句话>","steps":[{"t":"<这一步在做什么>","tex":"<这一步的公式，LaTeX>","plain":"<同一公式的纯文本写法，用 Unicode 上下标，如 v₀、m/s²>"}],"answer":"<最终答案，带单位>","pitfalls":["<学生最容易错的地方>"]}',
    '步骤 3~7 步，每步只写一条关键式子。tex 只写公式本身：不要用 $ 包裹，不要把整句中文写进 tex（文字放在 t 里，公式里少量中文用 \\text{}）。answer 和 pitfalls 里的公式用 $…$ 包起来。' + pack.prompt.explain,
    problem ? '题目：\n' + problem.slice(0, 4000) : '',
  ].filter(Boolean).join('\n');
}

export function parseExplain(text: string): Explain | null {
  const o = parseJSONLoose(text);
  if (!o) return null;
  const s = (v: unknown, n = 400) => (typeof v === 'string' ? v.slice(0, n) : '');
  const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, 10).map((x) => {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return { t: s(q.t, 120), tex: mathTex(s(q.tex, 400)), plain: s(q.plain, 200) || texPlain(mathTex(s(q.tex, 400))) };
  }).filter((x) => x.t || x.tex);
  if (!steps.length && !s(o.answer)) return null;
  return { title: s(o.title, 30) || '讲题', problem: s(o.problem, 3000), idea: s(o.idea), steps, answer: s(o.answer, 200), pitfalls: (Array.isArray(o.pitfalls) ? o.pitfalls : []).slice(0, 4).map((x) => s(x, 160)).filter(Boolean) };
}

// ── 板书绘图：模型在 160×90 的网格上画（y 向下），这里转成可编辑的矢量笔迹 ─────────────
export const DRAW_COLORS = ['ink', 'red', 'blue', 'green', 'orange', 'violet'];

export function drawPrompt(request: string, withImage: boolean, subject: SubjectId = 'physics'): string {
  return [
    `你是${packOf(subject).stage}老师的板书助手。把要求画成矢量板书，只输出一个 JSON 对象，不要任何解释。`,
    withImage ? '附带的图片是学生当前看到的画面或老师上传的题目照片（题目/图），按图片内容来画。' : '',
    '画布 160×90，原点在左上角，x 向右，y 向下。留 6 格边距，文字不要互相重叠，整体布局要清楚好看。',
    '格式：{"title":"<不超过 14 字>","items":[...]}，items 可用：',
    '  {"t":"line"|"dashed"|"arrow","from":[x,y],"to":[x,y],"color":"ink"}',
    '  {"t":"force","from":[x,y],"to":[x,y],"label":"F_N","color":"blue"}  受力箭头，从作用点画出，label 用 _ 表示下标；label 会自动标在箭头尖旁，不要再用 text 重复写力的名字',
    '  {"t":"rect"|"ellipse","x":左,"y":上,"w":宽,"h":高,"color":"ink"}',
    '  {"t":"poly","pts":[[x,y],[x,y],[x,y]],"color":"ink"}  斜面、物块等多边形（自动闭合）',
    '  {"t":"text","at":[x,y],"text":"文字或公式，可换行","size":1}  size 取 0.8~1.6；at 是文字左上角',
    '  {"t":"plot","id":"g","box":[x0,y0,x1,y1],"expr":"3t; 6","x":[0,5],"y":[0,16],"xl":"t/s","yl":"v/(m·s⁻¹)","shade":[0,2]}  函数图像，自变量写 t 或 x，多条用 ; 分隔；expr 用算式写法如 x^2-2*x-3、2*sin(2*x+pi/3)、sqrt(x)',
    '  {"t":"dot","at":[x,y],"label":"顶点 (1, −4)","pos":"ur","color":"red"}  标一个点并写标注，pos 是标注在点的哪一侧：ur ul dr dl r l u d',
    '函数图像上的点、对称轴、渐近线要用图像自己的坐标：任何坐标都可以写成 ["g", 函数x, 函数y]（g 是 plot 的 id），程序会换算到画布上，例如顶点 {"t":"dot","at":["g",1,-4]}，对称轴 {"t":"dashed","from":["g",1,-5],"to":["g",1,12]}。不要自己换算。',
    '文字里不要用 $ 和 LaTeX 命令，直接写 Unicode：x²、aₙ₊₁、v₀、√、π、≤、→、°。',
    '颜色只能用 ink red blue green orange violet。受力习惯：重力 red，支持力 blue，摩擦力 green，拉力 violet。最多 40 个 items。',
    '要求：' + request.slice(0, 2000),
  ].filter(Boolean).join('\n');
}

export interface DrawResult { title: string; strokes: Stroke[]; issues: string[] }

export function parseDraw(text: string, idOf: () => string): DrawResult | null {
  const o = parseJSONLoose(text);
  if (!o || !Array.isArray(o.items)) return null;
  const issues: string[] = [];
  const S = 1 / 160;
  const X = (v: unknown) => clamp(num(v) ?? 0, 0, 160) * S;
  const Y = (v: unknown) => clamp(num(v) ?? 0, 0, 90) * S;
  // 函数图像坐标 ["g", x, y] → 画布坐标（和 drawPlot 的换算一致）
  const plots = new Map<string, (x: number, y: number) => [number, number]>();
  for (const raw of o.items) {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const b = Array.isArray(it.box) ? it.box.map(num) : [], xr = Array.isArray(it.x) ? it.x.map(num) : [], yr = Array.isArray(it.y) ? it.y.map(num) : [];
    if (String(it.t ?? it.type) !== 'plot' || b.length < 4 || b.some((v) => v === undefined)) continue;
    const [bx0, bx1] = [Math.min(b[0]!, b[2]!), Math.max(b[0]!, b[2]!)], [by0, by1] = [Math.min(b[1]!, b[3]!), Math.max(b[1]!, b[3]!)];
    const [x0, x1, y0, y1] = [xr[0] ?? 0, xr[1] ?? 5, yr[0] ?? 0, yr[1] ?? 10];
    if (!(x1 > x0 && y1 > y0)) continue;
    plots.set(typeof it.id === 'string' ? it.id : 'g' + plots.size, (x, y) => [bx0 + (x - x0) / (x1 - x0) * (bx1 - bx0), by1 - (y - y0) / (y1 - y0) * (by1 - by0)]);
  }
  const P = (v: unknown): [number, number] | null => {
    if (!Array.isArray(v)) return null;
    if (typeof v[0] === 'string') {
      const f = plots.get(v[0]) ?? (plots.size === 1 ? [...plots.values()][0] : undefined), x = num(v[1]), y = num(v[2]);
      if (!f || x === undefined || y === undefined) { issues.push(`找不到函数图像 ${v[0]}`); return null; }
      const [cx, cy] = f(x, y); return [X(cx), Y(cy)];
    }
    return v.length >= 2 ? [X(v[0]), Y(v[1])] : null;
  };
  // 文字是纯文本笔迹：模型偶尔还是写 $…$，换成读法
  const plainText = (s: string) => unicodeScripts(s.replace(/\$\$?([^$]+)\$\$?/g, (_m, t: string) => texPlain(t)));
  // 受力箭头自己会标名字；模型常再用 text 写一遍，板书上就出现两个 F_N
  const norm = (s: string) => plainText(s).replace(/\s+/g, '');
  const forceNames = new Set(o.items.filter((x) => x && typeof x === 'object' && (x as Record<string, unknown>).t === 'force' && typeof (x as Record<string, unknown>).label === 'string').map((x) => norm((x as Record<string, string>).label)));
  const col = (v: unknown, d = 'ink') => (typeof v === 'string' && DRAW_COLORS.includes(v) ? v : d);
  const mk = (tool: Tool, color: string, pts: number[], extra: Partial<Stroke> = {}): Stroke => ({ id: idOf(), tool, color, size: 3, pts, author: 'ai', layer: 'public', ...extra });
  const out: Stroke[] = [];
  for (const raw of o.items.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const t = String(it.t ?? it.type ?? '');
    if (t === 'line' || t === 'dashed' || t === 'arrow' || t === 'force') {
      const a = P(it.from), b = P(it.to);
      if (!a || !b) { issues.push(`${t} 缺少端点`); continue; }
      out.push(mk(t as Tool, col(it.color), [a[0], a[1], .5, b[0], b[1], .5], { size: t === 'force' ? 3.2 : t === 'dashed' ? 2.2 : 2.6, text: typeof it.label === 'string' ? it.label.slice(0, 12) : undefined }));
    } else if (t === 'rect' || t === 'ellipse') {
      const x = X(it.x), y = Y(it.y), w = clamp(num(it.w) ?? 10, 0.5, 160) * S, h = clamp(num(it.h) ?? 10, 0.5, 90) * S;
      out.push(mk(t, col(it.color), [x, y, .5, Math.min(1, x + w), Math.min(PAGE_RATIO, y + h), .5], { size: 2.6 }));
    } else if (t === 'poly') {
      const pts = (Array.isArray(it.pts) ? it.pts : []).map(P).filter((p): p is [number, number] => !!p).slice(0, 24);
      if (pts.length < 2) { issues.push('poly 点数不足'); continue; }
      out.push(mk('poly', col(it.color), pts.flatMap((p) => [p[0], p[1], .5]), { size: 2.6 }));
    } else if (t === 'text') {
      const at = P(it.at); const s = typeof it.text === 'string' ? plainText(it.text.slice(0, 300)) : '';
      if (!at || !s) continue;
      if (forceNames.has(norm(s))) { issues.push(`去掉重复的力名 ${s}`); continue; }
      out.push(mk('text', col(it.color), [at[0], at[1], .5], { text: s, size: 2.6 * clamp(num(it.size) ?? 1, 0.6, 2) }));
    } else if (t === 'dot') {
      const at = P(it.at); if (!at) { issues.push('dot 缺少位置'); continue; }
      const r = 0.8 * S, c = col(it.color);
      out.push(mk('ellipse', c, [at[0] - r, at[1] - r, .5, at[0] + r, at[1] + r, .5], { size: 3 }));
      const label = typeof it.label === 'string' ? plainText(it.label.slice(0, 60)) : '';
      if (label) {
        // 文字笔迹的字高 = size × 8 / 1000 页宽（见 draw.ts text）；宽度按中文 1 个字高、其它 0.55 估
        const size = 2.3, h = size * 8 / 1000, w = [...label].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? h : h * 0.55), 0), g = 1.2 * S;
        const pos = typeof it.pos === 'string' ? it.pos : 'ur';
        const lx = pos.includes('l') ? at[0] - g - w : pos === 'u' || pos === 'd' ? at[0] - w / 2 : at[0] + g;
        const ly = pos.includes('u') ? at[1] - g - h : pos.includes('d') ? at[1] + g : at[1] - h / 2;
        out.push(mk('text', c, [Math.max(0, lx), Math.max(0, ly), .5], { text: label, size }));
      }
    } else if (t === 'plot') {
      const b = Array.isArray(it.box) ? it.box : [];
      const xr = Array.isArray(it.x) ? it.x.map(num) : [], yr = Array.isArray(it.y) ? it.y.map(num) : [];
      const expr = typeof it.expr === 'string' ? it.expr.slice(0, 120) : '';
      if (b.length < 4 || !expr) { issues.push('plot 缺少区域或函数'); continue; }
      const shade = Array.isArray(it.shade) && it.shade.length === 2 && it.shade.every((v) => num(v) !== undefined) ? [num(it.shade[0])!, num(it.shade[1])!] as [number, number] : undefined;
      out.push(mk('rect', 'ink', [X(b[0]), Y(b[1]), .5, X(b[2]), Y(b[3]), .5], {
        size: 2.6,
        plot: { expr, x0: xr[0] ?? 0, x1: xr[1] ?? 5, y0: yr[0] ?? 0, y1: yr[1] ?? 10, xl: typeof it.xl === 'string' ? it.xl.slice(0, 16) : 'x', yl: typeof it.yl === 'string' ? it.yl.slice(0, 16) : 'y', shade },
      }));
    } else issues.push(`不认识的图元 ${t}`);
  }
  if (!out.length) return null;
  return { title: typeof o.title === 'string' ? o.title.slice(0, 30) : 'AI 板书', strokes: out, issues };
}
