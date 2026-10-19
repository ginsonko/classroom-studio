// 学科包自检：key 合法、前置关系无环、题眼指向存在的知识点、提示词齐全。返回问题列表（空 = 通过）。
import type { SubjectPack } from './pack';

const KEY = /^\d{1,2}\.\d{1,2}$/;

export function validatePack(p: SubjectPack): string[] {
  const bad: string[] = [];
  const has = (k: string) => { if (!KEY.test(k)) return false; const [c, s] = k.split('.').map(Number); return p.chapters[c]?.sec[s] !== undefined; };
  if (!/^[a-z]{0,2}$/.test(p.prefix)) bad.push(`prefix "${p.prefix}" 只能是 0～2 个小写字母`);
  if (!p.id || !p.name || !p.stage) bad.push('id / name / stage 不能为空');
  if (!p.textbooks?.length || !p.textbooks.includes(p.textbook)) bad.push('textbooks 必须包含默认教材 textbook');
  if (!p.chapters.length || p.chapters.length > 99) bad.push('章数要在 1～99 之间');
  p.chapters.forEach((c, i) => {
    if (!p.books.includes(c.book)) bad.push(`第 ${i} 章的 book「${c.book}」不在 books 里`);
    if (!c.ch.trim()) bad.push(`第 ${i} 章没有章名`);
    if (!c.sec.length || c.sec.length > 99) bad.push(`第 ${i} 章「${c.ch}」节数要在 1～99 之间`);
    if (new Set(c.sec).size !== c.sec.length) bad.push(`第 ${i} 章「${c.ch}」有重名的节`);
  });
  const prereq = new Map<string, string[]>();
  for (const item of p.edges.trim().split(/\s+/).filter(Boolean)) {
    const [to, from] = item.split(':');
    if (!from) { bad.push(`前置关系「${item}」格式不对`); continue; }
    if (!has(to)) bad.push(`前置关系目标 ${to} 不存在`);
    const list = from.split(',');
    for (const f of list) { if (!has(f)) bad.push(`前置关系 ${to} 的前置 ${f} 不存在`); if (f === to) bad.push(`${to} 不能是自己的前置`); }
    if (prereq.has(to)) bad.push(`前置关系目标 ${to} 重复出现，合并成一项`);
    prereq.set(to, list);
  }
  // 有环检测
  const state = new Map<string, 1 | 2>();
  const visit = (k: string, path: string[]): void => {
    if (state.get(k) === 2) return;
    if (state.get(k) === 1) { bad.push('前置关系有环：' + [...path, k].join(' → ')); return; }
    state.set(k, 1);
    for (const f of prereq.get(k) ?? []) visit(f, [...path, k]);
    state.set(k, 2);
  };
  for (const k of prereq.keys()) visit(k, []);
  for (const [re, keys] of p.cues) {
    if (!(re instanceof RegExp)) bad.push('题眼必须是正则');
    for (const k of keys) if (!has(k)) bad.push(`题眼 ${re} 指向不存在的 ${k}`);
  }
  for (const c of p.toolChapters) if (!p.chapters[c]) bad.push(`toolChapters 里的 ${c} 不存在`);
  if (!p.qtypes.length || !p.qtypes.includes('其他')) bad.push('qtypes 要包含「其他」');
  try { const t = p.guessType('下列说法正确的是 A. 甲 B. 乙 C. 丙 D. 丁'); if (!p.qtypes.includes(t)) bad.push(`guessType 返回了 qtypes 之外的「${t}」`); } catch (e) { bad.push('guessType 出错：' + e); }
  for (const [k, v] of Object.entries(p.prompt)) if (typeof v !== 'string' || v.trim().length < 8) bad.push(`prompt.${k} 太短或缺失`);
  return bad;
}
