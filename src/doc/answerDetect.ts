// 答案页关键词识别（纯函数，便于离线测试）
const STRONG = /(参考答案|答案与解析|答案及解析|答案解析|答案详解|试题答案|习题答案|练习答案|参考解答|答案与提示)/;
const LEAD = /^[\s【\[（(]*答案[\s】\]）):：]/;
// 行首的答案 / 解析标记：「答案：A」「【解析】」「解析：」……单独的「答：」常是学生作答栏，不算
const MARK = /^[\s【\[（(]*(参考答案|答案|解析|详解|解答|分析|点拨|思路)[\s】\]）)]*[:：]|^[\s]*【(参考答案|答案|解析|详解|解答|分析|点拨)】/;

/** 一页的文字：按从上到下的行，y 为这一行顶边占页面高度的比例（不知道时省略） */
export interface PageLines { lines: { t: string; y?: number }[] }
export interface AnswerDetect { pages: number[]; from: Record<number, number> }

export function linesFromText(text: string): PageLines {
  return { lines: text.split(/[\r\n\v]+/).map((t) => ({ t })).filter((l) => l.t.trim()) };
}

function markLine(t: string) {
  if (!MARK.test(t)) return false;
  const rest = t.replace(MARK, '').trim();
  return !rest || !/^[\s_＿（）()\.。…]+$/.test(rest); // 「答案：____」是填空栏
}

/**
 * 1. 页首就是答案标题（第一页除外）：整页算答案；若出现在文档后段，从这页到最后都算答案。
 * 2. 页面中间有一行以「答案：」「【解析】」等开头：从这一行往下遮，上面的题目照常给学生看。
 */
export function detectAnswers(pages: PageLines[]): AnswerDetect {
  const n = pages.length, from: Record<number, number> = {};
  if (n < 2) return { pages: [], from };
  const starts: number[] = [], mids = new Map<number, number>();
  pages.forEach((p, i) => {
    if (i === 0) return;
    // OCR 会在每个汉字之间插空格（「答 案 ：」），先去掉
    const lines = p.lines
      .map((l) => ({ t: l.t.replace(/\s+/g, ' ').replace(/\s+(?=[^\x00-\x7f])|(?<=[^\x00-\x7f])\s+/g, '').trim(), y: l.y }))
      .filter((l) => l.t);
    if (lines.every((l) => typeof l.y === 'number')) lines.sort((a, b) => a.y! - b.y!);
    const head = lines.map((l) => l.t).join(' ').slice(0, 40);
    if (STRONG.test(head) || LEAD.test(head)) { starts.push(i); return; }
    const k = lines.findIndex((l) => markLine(l.t));
    if (k < 0) return;
    const y = lines[k].y;
    mids.set(i, typeof y === 'number' && y > 0.1 && y < 0.95 ? Math.max(0, y - 0.02) : 0);
  });
  const set = new Set<number>();
  if (starts.length) {
    const first = starts[0];
    if (first >= n * 0.3) for (let i = first; i < n; i++) set.add(i);
    else starts.forEach((i) => set.add(i));
  }
  mids.forEach((y, i) => { if (!set.has(i)) { set.add(i); if (y > 0) from[i] = Math.round(y * 1000) / 1000; } });
  return { pages: [...set].sort((a, b) => a - b), from };
}

/** 旧接口：只看每页文字 */
export function detectAnswerPages(texts: string[]): number[] {
  return detectAnswers(texts.map(linesFromText)).pages;
}
