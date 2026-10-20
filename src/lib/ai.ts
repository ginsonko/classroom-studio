import type { Material, Stroke } from './types';
import { host } from './host';
import { buildPreset, makePreset } from '../physics/sim/presets';
import { sceneErrors } from '../physics/sim/domain';
import type { Scene } from '../physics/model';
import { libOfKind } from '../physics/catalog';
import { recognize, type Recognized } from '../physics/sim/recognize';
import { drawPrompt, explainPrompt, parseDraw, parseExplain, type Explain } from '../physics/sim/aiSchema';
import { boardStroke, explainPages, flatText } from './explainBoard';
import { texMeasurer } from '../ink/texCache';
import { demoAgent, type AgentMsg } from './aiDemo';
import { s3dAgent } from '../scene3d/agent';
import { makeS3DMaterial } from '../scene3d/material';
import { packOf, studentSubject, type SubjectId } from './subjects';
import { useStore } from './store';
import { parsePick, pickByRules, pickPrompt } from '../demos/pick';
import type { ManimResult } from './manim';
import type { FilmSpec } from '../motion/core';
import { motionAgent } from '../motion/agent';

export { makePreset };

const uid = () => Math.random().toString(36).slice(2, 10);
const WIDE = { w: 1600, h: 900 };

// ── 主进程 AI 桥（Key 只存在主进程，用系统加密保存）──────────────────────
export interface AiConfig { baseUrl: string; model: string; visionModel: string; hasKey: boolean; keyHint: string; encrypted: boolean }
export interface ChatResult { content: string; model: string; ms: number; sawImage: boolean; finish?: string }
type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export const ai = {
  config: () => host.call<AiConfig>('ai.getConfig'),
  save: (p: Partial<{ baseUrl: string; model: string; visionModel: string; key: string }>) => host.call<AiConfig>('ai.setConfig', p),
  models: () => host.call<string[]>('ai.models'),
  test: (model?: string) => host.call<{ ok: boolean; model: string; ms: number; reply: string }>('ai.test', { model }),
  screen: () => host.call<string>('ai.screen'),
  // feature 用于 AI 账本按用途分类
  chat: (messages: (Msg | AgentMsg)[], o: { image?: string; json?: boolean; maxTokens?: number; temperature?: number; feature?: string; model?: string; timeout?: number } = {}) => host.call<ChatResult>('ai.chat', { messages, ...o }),
};

/** 当前学生的学科（没选学生按物理） */
const subjectNow = (): SubjectId => { const s = useStore.getState(); return studentSubject(s.students.find((x) => x.id === s.studentId)); };
const systemOf = (subject: SubjectId) => packOf(subject).prompt.assistant;

// ── 结果类型 ─────────────────────────────────────────────
export type Action = 'demo' | 'explain' | 'draw' | 'ask' | 'anim' | 'motion';
export interface DemoOut { kind: 'demo'; mat: Material; note: string; issues: string[]; rec?: Recognized; via: 'model' | 'rules'; src: string; steps?: string[]; preview?: string; checked?: boolean; kit?: boolean }
export interface ExplainOut { kind: 'explain'; data: Explain }
export interface DrawOut { kind: 'draw'; mat: Material; strokes: Stroke[]; issues: string[] }
export interface AskOut { kind: 'ask'; text: string }
/** 讲解动画：先讲题，再按讲解做 manim 视频 */
export interface AnimOut { kind: 'anim'; data: Explain; video: ManimResult }
/** 课堂动画：本机动画引擎的片子规格（实时播放、导出 MP4） */
export interface MotionOut { kind: 'motion'; spec: FilmSpec; sheet?: string; note: string; issues: string[]; checked: boolean; steps?: string[] }
export type AiOut = DemoOut | ExplainOut | DrawOut | AskOut | AnimOut | MotionOut;
export interface RunMeta { model?: string; ms?: number; image?: string }
export interface DemoGuess { preset: string; title: string; src: string }
/** AI 没搭出可用演示。guess 是规则识别的猜测，只作为老师可选的备选项，不自动替换。 */
export class DemoError extends Error {
  constructor(message: string, readonly guess?: DemoGuess, readonly steps: string[] = []) { super(message); this.name = 'DemoError'; }
}

function simMat(scene: Scene, title: string): Material {
  return { id: 'sim:ai-' + uid(), kind: 'sim', title, pages: [{ ...WIDE }], total: 1, scene: { ...scene, title } };
}

// ── 演示引擎：立体（three.js，默认）/ 经典（2D 物理引擎 + 学科演示库）──────
export type DemoEngine = 's3d' | 'classic';
export function demoEngine(): DemoEngine {
  try { return localStorage.getItem('cs.ai.demoEngine') === 'classic' ? 'classic' : 's3d'; } catch { return 's3d'; }
}
export function setDemoEngine(e: DemoEngine) { try { localStorage.setItem('cs.ai.demoEngine', e); } catch { /* 隐私模式 */ } }

/** 规则识别（没配模型或模型失败时的兜底）：题目原文 → 预设演示 */
export function demoByRules(text: string, force?: string): DemoOut | null {
  const rec = recognize(text, force);
  if (!rec) return null;
  const scene = buildPreset(rec.preset, rec.params);
  if (!scene) return null;
  return { kind: 'demo', mat: simMat(scene, 'AI 演示 · ' + rec.title), note: describeRecognition(rec), issues: [], rec, via: 'rules', src: text };
}

export function describeRecognition(r: Recognized): string {
  const fmt = (v: number) => String(+v.toPrecision(4));
  const lines = [`模板：${r.title}`];
  if (r.used.length) lines.push('从题目读出：' + r.used.map((u) => `${u.label} = ${fmt(r.params[u.key])}（${u.raw}）`).join('；'));
  if (r.defaulted.length) lines.push('题目没给，用默认值：' + r.defaulted.join('、'));
  if (r.clamped.length) lines.push('超出演示范围已调整：' + r.clamped.join('、'));
  if (r.g !== undefined) lines.push(`g 取 ${r.g} m/s²`);
  return lines.join('\n');
}

function userMsg(prompt: string, subject: SubjectId): Msg[] { return [{ role: 'system', content: systemOf(subject) }, { role: 'user', content: prompt }]; }

/** 跑一个动作。cfg 为空或没有 Key 时，只有「做成演示」能用规则兜底。 */
export async function runAction(action: Action, text: string, o: { cfg: AiConfig | null; image?: string; history?: Msg[]; onStep?: (t: string) => void; subject?: SubjectId; engine?: DemoEngine }): Promise<{ out: AiOut; meta: RunMeta }> {
  const subj = o.subject ?? subjectNow();
  const online = !!o.cfg?.hasKey && !!(o.cfg.model || o.cfg.visionModel);
  const image = o.image;
  if (action === 'anim' || action === 'motion') throw new Error('动画由面板单独处理');

  if (action === 'demo') {
    const engine = o.engine ?? demoEngine();
    let fallbackNote = '';
    // 立体引擎（默认，在线时全学科）：失败后自动回退经典引擎，并在备注里说明
    if (engine === 's3d' && online && (text.trim() || image)) {
      try {
        const r = await s3dDemo(text, subj, image, o.cfg!, o.onStep);
        if (r) return r;
        fallbackNote = '立体演示没有做出能通过校验的画面，已改用经典演示';
      } catch (e) {
        fallbackNote = '立体演示出错（' + ((e as Error).message || String(e)).slice(0, 80) + '），已改用经典演示';
      }
      o.onStep?.(fallbackNote);
    }
    const finish = (res: { out: AiOut; meta: RunMeta }) => {
      if (fallbackNote && res.out.kind === 'demo') { res.out.note = fallbackNote + '\n' + res.out.note; res.out.issues = [fallbackNote, ...res.out.issues]; }
      return res;
    };
    if (!packOf(subj).demos) return finish(await kitDemo(text, subj, online, image));
    if (!online) {
      if (!text.trim()) throw new Error('还没有配置模型，AI 读不了学生画面。可以先把题目文字粘贴进来，用规则识别做演示；或在「设置」里填 API Key。');
      const r = demoByRules(text);
      if (!r) throw new Error('规则识别没认出题型。可以补全题目数据和单位，或在「设置」里配置模型让 AI 来读题。');
      return finish({ out: r, meta: {} });
    }
    if (!text.trim() && !image) throw new Error('请输入题目或要求，或打开「读学生画面」。');
    return finish(await classicDemoModel(text, image, o.cfg!, o.onStep));
  }

  if (!online) throw new Error('这个功能需要先在「设置」里填写 API Key 和模型。');
  if (!text.trim() && !image) throw new Error('请输入题目或要求，或打开「读学生画面」。');

  if (action === 'explain') {
    const subject = subj;
    const r = await ai.chat(userMsg(explainPrompt(text, !!image, subject), subject), { image, json: true, maxTokens: 8000, temperature: 0.2, feature: 'AI 讲题', timeout: 8 * 60000 });
    const data = parseExplain(r.content);
    if (!data) throw new Error('模型的讲解格式不对，请重试一次');
    return { out: { kind: 'explain', data }, meta: { model: r.model, ms: r.ms, image } };
  }

  if (action === 'draw') {
    const subject = subj;
    const r = await ai.chat(userMsg(drawPrompt(text || packOf(subject).prompt.draw, !!image, subject), subject), { image, json: true, maxTokens: 10000, temperature: 0.2, feature: 'AI 画图', timeout: 8 * 60000 });
    const d = parseDraw(r.content, uid);
    if (!d) throw new Error('模型没有给出可以画的图元，请换个说法再试');
    const mat: Material = { id: 'board-ai-' + uid(), kind: 'board', title: 'AI 板书 · ' + d.title, pages: [{ ...WIDE }], total: 1 };
    return { out: { kind: 'draw', mat, strokes: d.strokes, issues: d.issues }, meta: { model: r.model, ms: r.ms, image } };
  }

  const msgs: Msg[] = [{ role: 'system', content: systemOf(subj) }, ...(o.history ?? []).slice(-8), { role: 'user', content: text || '请看学生当前的画面，告诉我这是什么题，关键点在哪里。' }];
  const r = await ai.chat(msgs, { image, maxTokens: 6000, temperature: 0.4, feature: 'AI 问答', timeout: 5 * 60000 });
  return { out: { kind: 'ask', text: r.content }, meta: { model: r.model, ms: r.ms, image } };
}

/** 数学 / 化学：从演示目录里挑一个并填参数（模型优先，失败或没配模型时按关键词） */
async function kitDemo(text: string, subject: SubjectId, online: boolean, image?: string): Promise<{ out: AiOut; meta: RunMeta }> {
  const name = packOf(subject).name;
  if (online && (text.trim() || image)) {
    const r = await ai.chat(userMsg(pickPrompt(text, subject, !!image), subject), { image, json: true, maxTokens: 4000, temperature: 0.1, feature: 'AI 演示' });
    const pk = parsePick(r.content, subject);
    if (pk) return { out: { kind: 'demo', mat: pk.mat, note: '演示：' + pk.def.title + (pk.note ? '\n' + pk.note : ''), issues: pk.issues, via: 'model', src: text, kit: true }, meta: { model: r.model, ms: r.ms, image } };
  }
  const rb = text.trim() ? pickByRules(text, subject) : null;
  if (!rb) throw new Error(online ? `AI 没有选出合适的${name}演示。可以在下方「${name}演示库」里直接挑一个。` : `没有从文字里认出对应的${name}演示。可以在下方「${name}演示库」里直接挑，或配置模型让 AI 读题。`);
  return { out: { kind: 'demo', mat: rb.mat, note: rb.note, issues: [], via: 'rules', src: text, kit: true }, meta: {} };
}

/** 立体演示：模型写规格 → 本机校验 + 联系表自检。做不出来返回 null，由调用方回退经典引擎。 */
async function s3dDemo(text: string, subj: SubjectId, image: string | undefined, cfg: AiConfig, onStep?: (t: string) => void): Promise<{ out: AiOut; meta: RunMeta } | null> {
  const vision = cfg.visionModel || cfg.model;
  const res = await s3dAgent(text, image, subj, (messages, c) => ai.chat(messages, { json: c.json, maxTokens: c.maxTokens, temperature: c.temperature, feature: 'AI 立体演示', ...(c.images ? { model: vision } : {}) }), onStep);
  const b = res.best;
  if (!b) return null;
  const mat = makeS3DMaterial(b.spec, { title: 'AI 演示 · ' + b.spec.title });
  const head = '立体演示：' + b.spec.title + (b.understand ? '\n' + b.understand : '');
  const issues = [
    ...(!res.accepted ? ['AI 没来得及最后确认，请在预览里看一遍再上屏'] : []),
    ...b.issues.slice(0, 3),
  ];
  return { out: { kind: 'demo', mat, note: head + (b.expect ? '\n应看到：' + b.expect : ''), issues, via: 'model', src: text, steps: res.steps, preview: b.sheet ?? undefined, checked: res.accepted }, meta: { model: res.model, ms: res.ms, image } };
}

/** 经典物理引擎演示（原「AI 演示」全流程） */
async function classicDemoModel(text: string, image: string | undefined, cfg: AiConfig, onStep?: (t: string) => void): Promise<{ out: AiOut; meta: RunMeta }> {
  const vision = cfg.visionModel || cfg.model;
  const res = await demoAgent(text, image, (messages, c) => ai.chat(messages, { json: c.json, maxTokens: c.maxTokens, temperature: c.temperature, feature: 'AI 演示', ...(c.images ? { model: vision } : {}) }), onStep);
  const meta = { model: res.model, ms: res.ms, image };
  const b = res.best;
  if (!b) {
    // 不再自动换成规则识别：规则只认关键词，常常选到和题目无关的模板。只把它的猜测作为可选项给老师。
    const guess = text.trim() ? recognize(text) : null;
    throw new DemoError('AI 没能搭出能通过校验的演示' + (res.issues.length ? '：' + res.issues.slice(0, 3).join('；') : '') + '。可以补充文字说明（例如「粒子先在电场中加速，再进入磁场」）后重试。', guess ? { preset: guess.preset, title: guess.title, src: text } : undefined, res.steps);
  }
  const sc = b.v.scene;
  const head = (b.v.preset ? '模板：' + b.v.title : '自由场景：' + sc.objs.length + ' 个器材') + (b.understand ? '\n' + b.understand : '');
  const issues = [
    ...(!b.trial.ok ? ['注意：这一版播放时几乎不动（' + (b.trial.motion.reason || '画面静止') + '）。可以在预览里调参数，或补充说明后重试'] : []),
    ...(!res.accepted && b.trial.ok ? ['AI 没来得及最后确认，请在预览里看一遍再上屏'] : []),
    ...b.v.issues.slice(0, 3),
  ];
  return { out: { kind: 'demo', mat: simMat(sc, 'AI 演示 · ' + b.v.title), note: head + (b.expect ? '\n应看到：' + b.expect : ''), issues, via: 'model', src: text, steps: res.steps, preview: b.trial.image, checked: res.accepted }, meta };
}

/** 课堂动画：一句话 → 分镜规格 → 本机试渲染 → AI 看截图审片。几分钟，期间其它 AI 功能照常用。 */
export async function makeMotion(text: string, o: { cfg: AiConfig | null; image?: string; subject?: SubjectId; onStep?: (t: string) => void; signal?: { cancelled: boolean } }): Promise<{ out: MotionOut; meta: RunMeta }> {
  const cfg = o.cfg;
  if (!cfg?.hasKey || !(cfg.model || cfg.visionModel)) throw new Error('课堂动画需要先在「设置」里填写 API Key 和模型。');
  if (!text.trim() && !o.image) throw new Error('请说说要做什么动画，例如「光的折射，讲清入射角和折射角的关系」，或打开「读学生画面」。');
  const subj = o.subject ?? subjectNow(), vision = cfg.visionModel || cfg.model;
  // 一整部片子的 JSON 较长，推理模型要写几分钟，给 8 分钟
  const res = await motionAgent(text, o.image, packOf(subj).stage, (messages, c) => ai.chat(messages, { json: c.json, maxTokens: c.maxTokens, temperature: c.temperature, feature: '课堂动画', timeout: 8 * 60000, ...(c.images ? { model: vision } : {}) }), o.onStep, o.signal);
  const b = res.best;
  if (!b) throw new Error('AI 没能写出可以播放的动画' + (res.issues.length ? '：' + res.issues.slice(0, 3).join('；') : '') + '。可以换个说法，或把要讲的内容说得更具体一些。');
  const issues = [
    ...(!res.accepted ? ['AI 没来得及最后确认，请先预览看一遍再上屏'] : []),
    ...b.problems.slice(0, 3),
  ];
  const note = `${b.spec.shots.length} 个镜头 · ${Math.round(b.duration)} 秒` + (b.understand ? '\n' + b.understand : '');
  return { out: { kind: 'motion', spec: b.spec, sheet: b.sheet ?? undefined, note, issues, checked: res.accepted, steps: res.steps }, meta: { model: res.model, ms: res.ms, image: o.image } };
}

/** 讲题步骤 → 板书笔迹：中文说明是文字笔迹，公式是 TeX 公式笔迹（学生端可见，可选中、移动、编辑）。排版见 explainBoard.ts。 */
export async function explainToBoard(e: Explain): Promise<{ mat: Material; pages: Stroke[][] }> {
  const pages = explainPages(e, await texMeasurer(), boardStroke(uid));
  const mat: Material = { id: 'board-ai-' + uid(), kind: 'board', title: 'AI 板书 · ' + flatText(e.title), pages: pages.map(() => ({ ...WIDE })), total: pages.length };
  return { mat, pages };
}

// ── 不用模型的物理演示入口（模板库 / 当前页器材）──────────────────────
export function materialFromObjects(strokes: Stroke[], title = '当前器材物理演示'): Material {
  const objs = strokes.filter(s => s.obj && s.layer !== 'private' && libOfKind(s.obj.kind) === 'physics').map(s => structuredClone(s.obj!));
  const scene: Scene = { title, objs, world: { g: 10, ppm: .1 }, duration: 8, graphs: ['vt', 'xt', 'energy'] };
  const errors = sceneErrors(scene);
  if (errors.length) throw new Error(errors.join('\n'));
  return { id: 'sim:objects:' + crypto.randomUUID(), kind: 'sim', title, pages: [{ ...WIDE }], total: 1, scene };
}

export const SAMPLE_PROBLEM = '如图所示，水平传送带以 v=2 m/s 的速度匀速运行，将质量 m=1 kg 的物块轻放在传送带左端，物块与传送带间的动摩擦因数 μ=0.2，传送带两端相距 L=4 m，g 取 10 m/s²。求物块从左端运动到右端的时间。';
