// 立体演示智能体：模型读题 → 写规格 JSON → 导播台本机校验并渲染 2×2 联系表 → 模型对照题目检查 / 修改。
// 流程和经典演示智能体（lib/aiDemo.ts）一致：模型输出一律当不可信输入，最多 MAX_CALLS 次调用。
import type { AgentChat, AgentMsg, Part } from '../lib/aiDemo';
import { parseJSONLoose } from '../physics/sim/aiSchema';
import { S3D_SYSTEM, s3dFirst, s3dReview } from './skill';
import { checkSpec } from './validate';
import { summarize } from './summary';
import type { S3DSpec } from './spec';

export interface S3DCandidate { spec: S3DSpec; issues: string[]; summary: string; sheet: string | null; understand: string; expect: string; round: number }
export interface S3DAgentResult { best: S3DCandidate | null; accepted: boolean; why: string; steps: string[]; model: string; ms: number; calls: number; issues: string[] }

const MAX_CALLS = 5;
const MAX_PLANS = 3;
const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** 校验 + 试渲染联系表（渲染失败不挡路：摘要照发，只不发图） */
async function makeCandidate(spec: S3DSpec, issues: string[], understand: string, expect: string, round: number): Promise<S3DCandidate> {
  const summary = summarize(spec);
  let sheet: string | null = null;
  try {
    const { contactSheet } = await import('./three/scene');
    sheet = contactSheet(spec);
  } catch { sheet = null; }
  return { spec, issues, summary, sheet, understand, expect, round };
}

export async function s3dAgent(problem: string, images: string[], subject: string, chat: AgentChat, onStep: (text: string) => void = () => {}): Promise<S3DAgentResult> {
  const steps: string[] = [];
  const step = (t: string) => { steps.push(t); onStep(t); };
  const first: Part[] = [{ type: 'text', text: s3dFirst(problem, subject, images.length > 0) }];
  for (const url of images) first.push({ type: 'image_url', image_url: { url } });
  const msgs: AgentMsg[] = [{ role: 'system', content: S3D_SYSTEM }, { role: 'user', content: first }];
  let best: S3DCandidate | null = null, last: S3DCandidate | null = null, accepted = false, why = '', model = '', ms = 0, calls = 0, plans = 0;
  const issues: string[] = [];
  // 旧的联系表只保留最近一张，避免每轮重复上传
  const dropOldSheets = () => {
    for (let i = 2; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === 'user' && Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === 'text');
    }
  };
  const hasImages = () => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  let sheets = true;
  const ask = async () => {
    try { return await chat(msgs, { json: true, maxTokens: 6000, temperature: 0.15, images: hasImages() }); }
    catch (e) {
      // 模型不支持看图时，联系表去掉、只留文字摘要再试一次；题目截图本身是必需的，不能去掉
      if (!sheets || !msgs.slice(2).some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))) throw e;
      sheets = false;
      for (let i = 2; i < msgs.length; i++) { const m = msgs[i]; if (Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === 'text'); }
      step('模型看不了联系表，改为只发文字摘要');
      return chat(msgs, { json: true, maxTokens: 6000, temperature: 0.15, images: hasImages() });
    }
  };
  step(images.length ? '读题：看图片里的题目' : '读题');
  while (calls < MAX_CALLS) {
    calls++;
    const r = await ask();
    model = r.model; ms += r.ms;
    msgs.push({ role: 'assistant', content: r.content });
    const j = parseJSONLoose(r.content);
    if (!j) { msgs.push({ role: 'user', content: '没有读到 JSON。请只输出一个 JSON 对象。' }); step('AI 回复格式不对，让它重来'); continue; }

    if (j.accept === true) {
      if (last) { accepted = true; why = s(j.why, 200); step('AI 检查：和题目一致 ✓'); break; }
      msgs.push({ role: 'user', content: '你还没有提交规格。请先按格式提交 {"understand":…,"expect":…,"spec":{…}}。' });
      continue;
    }

    const raw = (j.spec && typeof j.spec === 'object' ? j.spec : j) as Record<string, unknown>;
    if (plans >= MAX_PLANS) break;
    plans++;
    const understand = s(j.understand), expect = s(j.expect);
    if (plans === 1 && understand) step('理解：' + understand);
    const v = checkSpec(raw, { subject });
    if (!v.ok || !v.spec) {
      issues.push(...v.errors);
      step(`第 ${plans} 版规格没通过校验：${v.errors.slice(0, 2).join('；')}`);
      msgs.push({ role: 'user', content: '这份规格没通过导播台的校验：\n- ' + v.errors.slice(0, 8).join('\n- ') + '\n请修正后重新提交完整规格（{"understand":…,"expect":…,"spec":{…}}）。' });
      continue;
    }
    step(`第 ${plans} 版：${v.spec.title} · ${v.spec.objects.length} 个对象，渲染联系表中…`);
    // 让进度先画出来，再做同步的整段渲染
    await new Promise((res) => setTimeout(res, 0));
    const cand = await makeCandidate(v.spec, v.issues, understand, expect, plans);
    last = cand; best = cand;
    step(cand.sheet ? '联系表渲染完成' : '联系表渲染失败（这台机器可能没有 WebGL），改用文字摘要');
    if (calls >= MAX_CALLS) break;
    dropOldSheets();
    const warn = cand.issues.length ? '\n导播台的自动调整：' + cand.issues.slice(0, 5).join('；') : '';
    const report: Part[] = [{ type: 'text', text: s3dReview(plans, cand.summary + warn, !!(cand.sheet && sheets)) }];
    if (cand.sheet && sheets) report.push({ type: 'image_url', image_url: { url: cand.sheet } });
    msgs.push({ role: 'user', content: report });
  }
  if (!accepted && best) step('AI 没来得及最后确认，先给出最后一版，请预览核对');
  return { best, accepted, why, steps, model, ms, calls, issues: [...new Set(issues)] };
}
