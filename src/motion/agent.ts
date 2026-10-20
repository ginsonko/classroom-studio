// 课堂动画智能体：模型写片子规格 → 本机校验（能改的自动改）→ 渲染联系表 → 模型看图审片，有问题改一版。
// 流程和立体演示智能体（scene3d/agent.ts）一致：模型输出一律当不可信输入，调用次数有上限。
import type { AgentChat, AgentMsg, Part } from '../lib/aiDemo';
import { parseJSONLoose } from '../physics/sim/aiSchema';
import type { FilmSpec } from './core';
import { checkFilm, summarizeFilm } from './check';
import { MOTION_SYSTEM, motionFirst, motionReview } from './skill';

export interface MotionCandidate { spec: FilmSpec; sheet: string | null; fixes: string[]; problems: string[]; understand: string; round: number; duration: number }
export interface MotionAgentResult { best: MotionCandidate | null; accepted: boolean; why: string; steps: string[]; model: string; ms: number; calls: number; issues: string[] }

const MAX_CALLS = 4;
const MAX_PLANS = 3;
const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

async function render(spec: FilmSpec): Promise<{ sheet: string | null; problems: string[]; duration: number }> {
  try {
    const { filmSheet } = await import('./sheet');
    return await filmSheet(spec);
  } catch (e) {
    return { sheet: null, problems: ['渲染联系表失败：' + ((e as Error).message || String(e))], duration: spec.shots.reduce((a, x) => a + x.dur, 0) };
  }
}

export async function motionAgent(ask: string, image: string | undefined, subject: string, chat: AgentChat, onStep: (t: string) => void = () => {}, signal?: { cancelled: boolean }): Promise<MotionAgentResult> {
  const steps: string[] = [];
  const step = (t: string) => { steps.push(t); onStep(t); };
  const stop = () => { if (signal?.cancelled) throw new Error('已取消'); };
  const first: Part[] = [{ type: 'text', text: motionFirst(ask, subject, !!image) }];
  if (image) first.push({ type: 'image_url', image_url: { url: image } });
  const msgs: AgentMsg[] = [{ role: 'system', content: MOTION_SYSTEM }, { role: 'user', content: first }];
  let best: MotionCandidate | null = null, accepted = false, why = '', model = '', ms = 0, calls = 0, plans = 0, sheets = true;
  let fallback: FilmSpec | null = null;
  const issues: string[] = [];
  const hasImages = () => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  const dropOldSheets = () => { for (let i = 2; i < msgs.length; i++) { const m = msgs[i]; if (m.role === 'user' && Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === 'text'); } };
  const ask_ = async () => {
    try { return await chat(msgs, { json: true, maxTokens: 16000, temperature: 0.4, images: hasImages() }); }
    catch (e) {
      // 模型不支持看图：去掉联系表只发文字摘要再试一次（题目截图是必需的，不能去）
      if (!sheets || !msgs.slice(2).some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))) throw e;
      sheets = false; dropOldSheets();
      step('模型看不了截图，改为只发文字摘要');
      return chat(msgs, { json: true, maxTokens: 16000, temperature: 0.4, images: hasImages() });
    }
  };
  step(image ? 'AI 正在看学生画面、构思镜头…' : 'AI 正在构思镜头、写分镜…');
  while (calls < MAX_CALLS) {
    stop();
    calls++;
    const r = await ask_();
    model = r.model; ms += r.ms;
    stop();
    msgs.push({ role: 'assistant', content: r.content });
    const j = parseJSONLoose(r.content);
    if (!j) { msgs.push({ role: 'user', content: '没有读到 JSON。请只输出一个 JSON 对象。' }); step('AI 回复格式不对，让它重来'); continue; }
    if (j.accept === true) {
      if (best) { accepted = true; why = s(j.why, 200); step('AI 审片通过 ✓' + (why ? '：' + why : '')); break; }
      msgs.push({ role: 'user', content: '你还没有提交片子。请按格式提交 {"understand":…,"plan":…,"film":{…}}。' });
      continue;
    }
    const raw = j.film ?? j.spec ?? (Array.isArray(j.shots) ? j : null);
    if (plans >= MAX_PLANS) break;
    plans++;
    const understand = s(j.understand);
    if (plans === 1 && understand) step('理解：' + understand);
    if (plans > 1 && s(j.fix)) step('AI 修改：' + s(j.fix, 200));
    const v = checkFilm(raw);
    if (!v.ok || !v.spec) {
      issues.push(...v.errors);
      if (v.spec && v.spec.shots.some((x) => x.items.length)) fallback = v.spec;
      step(`第 ${plans} 版没通过校验：${v.errors.slice(0, 2).join('；')}`);
      if (calls >= MAX_CALLS) break;
      msgs.push({ role: 'user', content: '这份片子没通过引擎的校验：\n- ' + v.errors.slice(0, 10).join('\n- ') + '\n请修正后重新提交完整 JSON（{"understand":…,"plan":…,"film":{…}}）。' });
      continue;
    }
    const total = v.spec.shots.reduce((a, x) => a + x.dur, 0);
    step(`第 ${plans} 版分镜：${v.spec.title} · ${v.spec.shots.length} 个镜头 · ${Math.round(total)} 秒，正在试渲染…`);
    await new Promise((res) => setTimeout(res, 0));
    stop();
    const rr = await render(v.spec);
    best = { spec: v.spec, sheet: rr.sheet, fixes: v.fixes, problems: rr.problems, understand, round: plans, duration: rr.duration };
    step(rr.sheet ? `试渲染完成${rr.problems.length ? `（${rr.problems.length} 个部件有问题）` : ''}` : '试渲染失败（这台电脑可能不支持 WebGL），只发文字摘要');
    if (calls >= MAX_CALLS) break;
    dropOldSheets();
    const report: Part[] = [{ type: 'text', text: motionReview(plans, summarizeFilm(v.spec), v.fixes, rr.problems, !!(rr.sheet && sheets)) }];
    if (rr.sheet && sheets) report.push({ type: 'image_url', image_url: { url: rr.sheet } });
    msgs.push({ role: 'user', content: report });
    step('AI 正在看截图审片…');
  }
  // 一版都没通过校验，但去掉坏部件后还能放：先给老师看，并说明问题
  if (!best && fallback) {
    step('AI 没能写出完全正确的版本，先去掉有问题的部件给你看');
    const rr = await render(fallback);
    best = { spec: fallback, sheet: rr.sheet, fixes: [], problems: rr.problems, understand: '', round: plans, duration: rr.duration };
  }
  if (!accepted && best) step('AI 没来得及最后确认，请在预览里看一遍');
  return { best, accepted, why, steps, model, ms, calls, issues: [...new Set(issues)] };
}
