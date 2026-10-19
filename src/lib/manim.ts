// manim 讲解动画（可选组件）：AI 按讲解写 manim 脚本 → 主进程渲染成 MP4 → AI 看截帧审片，有问题改一版 → 当普通视频课件预览、上屏。
// 渲染失败时把报错交回 AI 修（最多写 3 版）。脚本的安全检查在主进程（electron/manim.cjs）。
import { create } from 'zustand';
import type { Explain } from '../physics/sim/aiSchema';
import { ai } from './ai';
import { host } from './host';
import type { SubjectId } from './subjects';
import { extractCode, lintScript, manimPrompt, manimSystem, parseReview, repairPrompt, reviewPrompt } from './manimText';

export { extractCode, manimPrompt };

export interface ManimStatus { ok: boolean; version?: string; latex?: boolean; error?: string }
export interface ManimVideo { id: string; video: string; ms: number; bytes: number; duration?: number; sheet?: string }
export interface ManimResult extends ManimVideo { code: string; tries: number; review: string[] }
export type ManimQuality = 'draft' | 'normal' | 'hd';
export const QUALITY_NAME: Record<ManimQuality, string> = { draft: '草稿 480p', normal: '标准 720p', hd: '高清 1080p' };

export const manimApi = {
  status: (force = false) => host.call<ManimStatus>('manim.status', { force }),
  render: (o: { code: string; quality: ManimQuality; title: string; job: string }) => host.call<ManimVideo>('manim.render', o),
  cancel: (job: string) => host.call<boolean>('manim.cancel', job),
};

/** 检测一次（启动 Python 要几秒），之后各个讲解卡片共用结果 */
export const useManim = create<{ status: ManimStatus | null; checking: boolean; check: (force?: boolean) => Promise<ManimStatus> }>()((set, get) => ({
  status: null, checking: false,
  check: async (force = false) => {
    const cur = get().status; if (cur && !force) return cur;
    if (!host.electron) { const s = { ok: false, error: '浏览器预览版不能运行 manim，请用桌面版。' }; set({ status: s }); return s; }
    set({ checking: true });
    try { const s = await manimApi.status(force); set({ status: s }); return s; }
    catch (e) { const s = { ok: false, error: (e as Error).message }; set({ status: s }); return s; }
    finally { set({ checking: false }); }
  },
}));

const clean = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
/** Python 报错的最后一行（例如 NameError: …），给老师看 */
const lastLine = (log: string) => log.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => /^\w*(Error|Exception)\b|Error:/.test(l)) ?? log.split('\n').filter(Boolean).at(-1) ?? log;

/** 只换画质重新渲染（不再调用 AI） */
export async function rerender(code: string, quality: ManimQuality, title: string, job: string): Promise<ManimVideo> {
  return manimApi.render({ code, quality, title, job }).catch((e) => { throw new Error(clean(e).split('\n')[0]); });
}

/** 写脚本 → 检查 → 渲染 → 审片。onStep 报告每一步（失败原因也写进去，老师能看到为什么）。 */
export async function makeManim(e: Explain, subject: SubjectId, o: { quality: ManimQuality; job: string; onStep: (t: string) => void; signal: { cancelled: boolean }; review?: boolean }): Promise<ManimResult> {
  const st = await useManim.getState().check();
  if (!st.ok) throw new Error(st.error || '没有找到 manim');
  const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: manimSystem(subject) }, { role: 'user', content: manimPrompt(e, subject, !!st.latex) }];
  const fails: string[] = [];
  let fallback: ManimResult | null = null;
  const stop = () => { if (o.signal.cancelled) throw new Error('已取消'); };
  // 没有可用版本时最多写 3 版；审片后修改的版本渲染不出来时，把报错交回去再修一次，还不行才退回审片前的版本
  const last = () => (fallback ? fallback.tries + 2 : 3);
  const giveUp = () => { o.onStep('修改版没有成功，先用审片前的版本'); return fallback!; };
  for (let n = 1; n <= 5; n++) {
    stop();
    o.onStep(n === 1 ? 'AI 正在写动画脚本…' : fallback ? 'AI 按审片意见修改脚本…' : `AI 正在修改脚本（第 ${n} 版）…`);
    // 推理模型写一整段脚本常要 3~6 分钟（实测），给 10 分钟
    const r = await ai.chat(msgs, { maxTokens: 12000, temperature: 0.3, feature: 'manim 动画', timeout: 10 * 60000 }).catch((err) => { throw new Error(clean(err)); });
    const code = extractCode(r.content);
    msgs.push({ role: 'assistant', content: '```python\n' + code + '```' });
    stop();
    let problem = '';
    try { await host.call('manim.check', { code }); }
    catch (err) { problem = '没通过安全检查：' + clean(err); }
    if (!problem) { const lint = lintScript(code, !!st.latex); if (lint.length) problem = '有会导致渲染失败的写法：' + lint.join('；'); }
    if (problem) {
      if (r.finish === 'length') problem += '（回答太长被截断了）';
      fails.push(`第 ${n} 版${problem}`); o.onStep(`第 ${n} 版脚本${problem}`);
      if (n >= last()) { if (fallback) return giveUp(); break; }
      msgs.push({ role: 'user', content: `这段脚本${problem}。请修正后输出完整脚本${r.finish === 'length' ? '（写短一些，删掉不必要的动画）' : ''}，同样只输出一个 \`\`\`python 代码块。` });
      continue;
    }
    o.onStep(`第 ${n} 版脚本写好了（${code.split('\n').length} 行），正在渲染（${o.quality === 'draft' ? '约 1 分钟' : o.quality === 'hd' ? '约 5~10 分钟' : '约 2~5 分钟'}）…`);
    let v: ManimVideo;
    try { v = await manimApi.render({ code, quality: o.quality, title: e.title || '讲解动画', job: o.job + '-' + n }); }
    catch (err) {
      const m = clean(err);
      if (/已取消|超过 \d+ 分钟|启动 manim 失败|没有找到 manim/.test(m) || o.signal.cancelled) { if (fallback && !o.signal.cancelled) return fallback; throw new Error(m.split('\n')[0]); }
      const why = lastLine(m.split('\n').slice(1).join('\n') || m);
      fails.push(`第 ${n} 版渲染出错：${why}`); o.onStep(`第 ${n} 版渲染出错：${why}`);
      if (n >= last()) { if (fallback) return giveUp(); break; }
      msgs.push({ role: 'user', content: repairPrompt(m) });
      continue;
    }
    const result: ManimResult = { ...v, code, tries: n, review: [] };
    if (!o.review || fallback || !v.sheet) { if (fallback) o.onStep('修改后的版本渲染完成'); return result; }
    stop();
    o.onStep(`渲染完成（${Math.round(v.duration ?? 0)} 秒），AI 正在看截帧审片…`);
    let rv: { ok: boolean; problems: string[] } | null = null;
    try { const r2 = await ai.chat([{ role: 'user', content: reviewPrompt(e) }], { image: v.sheet, json: true, maxTokens: 4000, temperature: 0.1, feature: 'manim 审片', timeout: 6 * 60000 }); rv = parseReview(r2.content); }
    catch (err) { o.onStep('审片没完成（' + clean(err).slice(0, 60) + '），先用这一版'); return result; }
    if (!rv || rv.ok) { o.onStep(rv ? '审片通过' : '审片结果看不懂，先用这一版'); return result; }
    o.onStep('审片发现：' + rv.problems.join('；'));
    fallback = { ...result, review: rv.problems };
    msgs.push({ role: 'user', content: '渲染成功了，但审片（看了 6 张截帧）发现这些画面问题：\n- ' + rv.problems.join('\n- ') + '\n请修改后输出完整脚本（规则不变，只输出一个 ```python 代码块）。' });
  }
  throw new Error('写了 3 版脚本都没渲染成功：\n' + fails.join('\n'));
}
