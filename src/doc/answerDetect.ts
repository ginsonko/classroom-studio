// 答案页关键词识别（纯函数，便于离线测试）
const STRONG = /(参考答案|答案与解析|答案及解析|答案解析|答案详解|试题答案|习题答案|练习答案|参考解答|答案与提示)/;
const LEAD = /^[\s【\[（(]*答案[\s】\]）):：]/;
// 行首的答案 / 解析标记：「答案：A」「【解析】」「解析：」……单独的「答：」常是学生作答栏，不算
const MARK = /^[\s【\[（(]*(参考答案|答案|解析|详解|解答|分析|点拨|思路)[\s】\]）)]*[:：]|^[\s]*【(参考答案|答案|解析|详解|解答|分析|点拨)】/;
// 下一道题从这里开始：「例 2」「2.」「3、」「【例3】」「题型二」「第 4 题」「二、选择题」「变式 1」
const QUESTION = /^[\s【\[]*(例\s*\d+|例题\s*\d+|变式\s*\d*|练习\s*\d+|题型[一二三四五六七八九十\d]+|第\s*\d+\s*题|\d{1,3}\s*[.．、]|[（(]\s*\d{1,2}\s*[)）]\s*\S|[一二三四五六七八九十]+\s*[、．.])/;

/** 一页的文字：按从上到下的行，y 为这一行顶边、b 为底边占页面高度的比例（不知道时省略） */
export interface PageLines { lines: { t: string; y?: number; b?: number }[] }
/** segs：页 → 要遮住的若干段 [上沿, 下沿]（0~1）；from 是第一段的上沿（兼容旧数据） */
export interface AnswerDetect { pages: number[]; from: Record<number, number>; segs: Record<number, [number, number][]> }

export function linesFromText(text: string): PageLines {
  return { lines: text.split(/[\r\n\v]+/).map((t) => ({ t })).filter((l) => l.t.trim()) };
}

function markLine(t: string) {
  if (!MARK.test(t)) return false;
  const rest = t.replace(MARK, '').trim();
  return !rest || !/^[\s_＿（）()\.。…]+$/.test(rest); // 「答案：____」是填空栏
}
const questionLine = (t: string) => QUESTION.test(t) && !markLine(t);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 1. 页首就是答案标题（第一页除外）：整页算答案；若出现在文档后段，从这页到最后都算答案。
 * 2. 页面中间有一行以「答案：」「【解析】」等开头：只遮这一段——到下一道题的题号为止，上下的题目照常给学生看。
 *    上沿贴着这一行，但不越过上一行的底边（分式、根号这样的高行不会被盖住半截）。
 */
export function detectAnswers(pages: PageLines[]): AnswerDetect {
  const n = pages.length, from: Record<number, number> = {}, segs: Record<number, [number, number][]> = {};
  if (n < 2) return { pages: [], from, segs };
  const starts: number[] = [], mids = new Map<number, [number, number][]>();
  pages.forEach((p, i) => {
    if (i === 0) return;
    // OCR 会在每个汉字之间插空格（「答 案 ：」），先去掉
    const lines = p.lines
      .map((l) => ({ t: l.t.replace(/\s+/g, ' ').replace(/\s+(?=[^\x00-\x7f])|(?<=[^\x00-\x7f])\s+/g, '').trim(), y: l.y, b: l.b }))
      .filter((l) => l.t);
    const placed = lines.every((l) => typeof l.y === 'number');
    if (placed) lines.sort((a, b) => a.y! - b.y!);
    const head = lines.map((l) => l.t).join(' ').slice(0, 40);
    if (STRONG.test(head) || LEAD.test(head)) { starts.push(i); return; }
    const k = lines.findIndex((l) => markLine(l.t));
    if (k < 0) return;
    if (!placed) { mids.set(i, []); return; }
    const out: [number, number][] = [];
    for (let j = k; j < lines.length;) {
      if (!markLine(lines[j].t)) { j++; continue; }
      const y = lines[j].y!;
      if (y <= 0.1) { if (!out.length) { mids.set(i, []); return; } }
      const above = lines.slice(0, j).filter((l) => l.y! < y - 0.004);
      const floor = Math.min(y, above.reduce((m, l) => Math.max(m, (l.b ?? l.y! + 0.012) + 0.002), 0));
      const top = Math.max(floor, y - (lines[j].b !== undefined ? 0.006 : 0.02));
      let e = j + 1;
      while (e < lines.length && !(questionLine(lines[e].t) && lines[e].y! > y + 0.008)) e++;
      const next = lines[e];
      const prev = lines.slice(j, e).reduce((m, l) => Math.max(m, l.b ?? l.y! + 0.012), y);
      const end = next ? Math.min(1, Math.max(prev + 0.002, next.y! - 0.004)) : 1;
      if (end - top > 0.01) out.push([r3(Math.max(0, top)), r3(end)]);
      j = e;
    }
    // 一整页几乎都被遮：按整页答案处理
    if (out.length === 1 && out[0][0] <= 0.1 && out[0][1] >= 0.95) { mids.set(i, []); return; }
    mids.set(i, out);
  });
  const set = new Set<number>();
  if (starts.length) {
    const first = starts[0];
    if (first >= n * 0.3) for (let i = first; i < n; i++) set.add(i);
    else starts.forEach((i) => set.add(i));
  }
  mids.forEach((s, i) => {
    if (set.has(i)) return;
    set.add(i);
    if (s.length && s[0][0] > 0) { from[i] = s[0][0]; segs[i] = s; }
  });
  return { pages: [...set].sort((a, b) => a - b), from, segs };
}

/** 旧接口：只看每页文字 */
export function detectAnswerPages(texts: string[]): number[] {
  return detectAnswers(texts.map(linesFromText)).pages;
}
