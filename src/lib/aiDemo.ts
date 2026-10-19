// AI 演示智能体：模型读题 → 提交方案 → 导播台真的运行（文字摘要 + 4 帧截图）→ 模型对照题目检查 / 修改。
// 每一步都在本机校验和计算，模型输出一律当作不可信输入。最多 MAX_CALLS 次模型调用。
import type { Scene } from '../physics/model';
import { DEMO_AGENT_SYSTEM, demoAgentFirst, parseJSONLoose, presetSceneTool, validateSceneJSON, type Validated } from '../physics/sim/aiSchema';
import { trial, type Trial } from '../physics/sim/preview';

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface AgentMsg { role: 'system' | 'user' | 'assistant'; content: string | Part[] }
export interface AgentChat { (messages: AgentMsg[], o: { json: boolean; maxTokens: number; temperature: number; images: boolean }): Promise<{ content: string; model: string; ms: number }> }

export interface Candidate { v: Validated & { scene: Scene }; trial: Trial; understand: string; expect: string; round: number }
export interface AgentResult { best: Candidate | null; accepted: boolean; why: string; steps: string[]; model: string; ms: number; calls: number; issues: string[] }

const MAX_CALLS = 5;
const MAX_PLANS = 3;
const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** 比较两个方案：会动的优先，其次是更晚（修改过）的 */
const better = (a: Candidate | null, b: Candidate) => (!a || (b.trial.ok && !a.trial.ok) || b.trial.ok === a.trial.ok ? b : a);

export async function demoAgent(problem: string, image: string | undefined, chat: AgentChat, onStep: (text: string) => void = () => {}): Promise<AgentResult> {
  const steps: string[] = [];
  const step = (t: string) => { steps.push(t); onStep(t); };
  const first: Part[] = [{ type: 'text', text: demoAgentFirst(problem, !!image) }];
  if (image) first.push({ type: 'image_url', image_url: { url: image } });
  const msgs: AgentMsg[] = [{ role: 'system', content: DEMO_AGENT_SYSTEM }, { role: 'user', content: first }];
  let best: Candidate | null = null, last: Candidate | null = null, accepted = false, why = '', model = '', ms = 0, calls = 0, plans = 0;
  const issues: string[] = [];
  // 旧的试播截图只保留最近一张，避免每轮重复上传
  const dropOldPreviews = () => {
    for (let i = 2; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === 'user' && Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === 'text');
    }
  };
  const hasImages = () => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  let sheets = true;
  const ask = async () => {
    try { return await chat(msgs, { json: true, maxTokens: 3000, temperature: 0.15, images: hasImages() }); }
    catch (e) {
      // 模型不支持看图时，试播截图去掉、只留文字摘要再试一次；题目截图本身是必需的，不能去掉
      if (!sheets || !msgs.slice(2).some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))) throw e;
      sheets = false;
      for (let i = 2; i < msgs.length; i++) { const m = msgs[i]; if (Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === 'text'); }
      step('模型看不了试播截图，改为只发文字摘要');
      return chat(msgs, { json: true, maxTokens: 3000, temperature: 0.15, images: hasImages() });
    }
  };
  step(image ? '读题：看学生画面里的题目' : '读题');
  while (calls < MAX_CALLS) {
    calls++;
    const r = await ask();
    model = r.model; ms += r.ms;
    msgs.push({ role: 'assistant', content: r.content });
    const j = parseJSONLoose(r.content);
    if (!j) { msgs.push({ role: 'user', content: '没有读到 JSON。请只输出一个 JSON 对象。' }); step('AI 回复格式不对，让它重来'); continue; }

    if (j.tool === 'preset_scene') {
      step(`查看模板「${s(j.preset, 30)}」的器材`);
      msgs.push({ role: 'user', content: presetSceneTool(j.preset, j.params) });
      continue;
    }

    if (j.accept === true) {
      if (last?.trial.ok) { accepted = true; why = s(j.why, 200); step('AI 检查：和题目一致 ✓'); break; }
      msgs.push({ role: 'user', content: last ? '最后一次运行的结果还有问题（见上面的摘要），不能确认。请提交修正后的方案。' : '你还没有提交方案。请先提交 plan。' });
      continue;
    }

    const plan = (j.plan && typeof j.plan === 'object' ? j.plan : j) as Record<string, unknown>;
    if (plans >= MAX_PLANS) break;
    plans++;
    const understand = s(j.understand), expect = s(j.expect);
    if (plans === 1 && understand) step('理解：' + understand);
    const v = validateSceneJSON(plan);
    if (!v.ok || !v.scene) {
      issues.push(...v.issues);
      step(`第 ${plans} 版方案没通过校验：${v.issues.slice(0, 2).join('；')}`);
      msgs.push({ role: 'user', content: '这个方案没通过导播台的校验：\n- ' + v.issues.slice(0, 8).join('\n- ') + '\n请修正后重新提交完整方案。' });
      continue;
    }
    step(`第 ${plans} 版：${v.preset ? '模板「' + v.title + '」' : '自由场景 · ' + v.scene.objs.length + ' 个器材'}，试播中…`);
    // 让进度先画出来，再做同步的整段计算
    await new Promise((res) => setTimeout(res, 0));
    const t = trial(v.scene);
    const cand: Candidate = { v: v as Candidate['v'], trial: t, understand, expect, round: plans };
    last = cand; best = better(best, cand);
    step(t.ok ? `试播完成：${firstLine(t.text)}` : `试播发现问题：${t.motion.reason || '画面几乎不动'}`);
    if (calls >= MAX_CALLS) break;
    dropOldPreviews();
    const report: Part[] = [{ type: 'text', text: `导播台运行了你的第 ${plans} 版方案。${v.issues.length ? '\n校验提示：' + v.issues.slice(0, 5).join('；') : ''}\n${t.text}\n附图是 ①~④ 四个时刻的画面（含轨迹和速度箭头）。\n对照你的 expect 和题目检查：一致就回复 {"accept":true,"why":"..."}；不一致就提交修正后的完整方案（同样的格式）。` }];
    if (t.image && sheets) report.push({ type: 'image_url', image_url: { url: t.image } });
    msgs.push({ role: 'user', content: report });
  }
  if (!accepted && best) step(best.trial.ok ? 'AI 没来得及最后确认，先给出会动的那一版，请预览核对' : '几次修改后画面仍然不对');
  return { best, accepted, why, steps, model, ms, calls, issues: [...new Set(issues)] };
}

function firstLine(text: string) {
  const l = text.split('\n').find((x) => x.startsWith('- '));
  return l ? l.slice(2, 90) + (l.length > 92 ? '…' : '') : text.split('\n')[0].slice(0, 90);
}
