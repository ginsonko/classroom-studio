// 1.7.0 教案 / 讲义里的两种图：```时间轴（按分钟比例的时间条 + 环节清单）和 ```结构图（知识结构树）。
// Markdown 里照常写文字，导出 PDF / 长图 / PPT 时画成图，Word 里是截好的图片。

export const isDiagram = (lang?: string) => !!lang && /^(时间轴|时间线|timeline|结构图|知识结构|思维导图|tree|mindmap)$/i.test(lang.trim());
const isTimeline = (lang: string) => /^(时间轴|时间线|timeline)$/i.test(lang.trim());

const COLORS = ['var(--c2)', '#e07a2e', '#1f9d55', '#8a5cd6', '#d64545', '#3aa8c1', '#c27a12'];

/**
 * 时间轴：每行一个环节，写法随意一点也认得：
 *   0-5 回顾：上次的错题
 *   5–20′ 新授 电梯里的体重秤
 *   10 分钟 练习：两道变式
 */
export function timelineHtml(text: string, inline: (s: string) => string): string {
  const rows: { a: number; b: number; name: string; desc: string }[] = [];
  let t = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-*]\s*/, '');
    if (!line) continue;
    let m = /^(\d+)\s*[-–—~～至到]\s*(\d+)\s*(?:分钟|分|min|′|')?\s*[|｜:：、,，\s]\s*([^:：|｜\s]+)\s*[:：|｜\s]?\s*(.*)$/.exec(line);
    if (m) { rows.push({ a: +m[1], b: +m[2], name: m[3], desc: m[4] }); t = +m[2]; continue; }
    m = /^(\d+)\s*(?:分钟|分|min|′|')\s*[|｜:：、,，\s]?\s*([^:：|｜\s]+)\s*[:：|｜\s]?\s*(.*)$/.exec(line);
    if (m) { rows.push({ a: t, b: t + +m[1], name: m[2], desc: m[3] }); t += +m[1]; continue; }
    if (rows.length) rows[rows.length - 1].desc += ' ' + line;
  }
  if (!rows.length) return `<pre>${text}</pre>`;
  const total = Math.max(1, rows[rows.length - 1].b - rows[0].a);
  const bar = rows.map((r, k) => `<span style="flex:${Math.max(1, r.b - r.a)} 0 0;background:${COLORS[k % COLORS.length]}"><b>${inline(r.name)}</b><small>${r.b - r.a}′</small></span>`).join('');
  const list = rows.map((r, k) => `<li><span class="tl-t" style="color:${COLORS[k % COLORS.length]}">${r.a}–${r.b}′</span><span class="tl-d"><b>${inline(r.name)}</b>${r.desc ? '　' + inline(r.desc) : ''}</span></li>`).join('');
  return `<div class="dg tl"><div class="tl-bar">${bar}</div><div class="tl-scale"><span>0′</span><span>${total} 分钟</span></div><ol class="tl-list">${list}</ol></div>`;
}

/**
 * 结构图：缩进表示层级（两个空格或一个 tab 一层，前面的「- 」可写可不写），第一行是中心主题：
 *   超重与失重
 *     超重：a 向上
 *       加速上升
 */
export function treeHtml(text: string, inline: (s: string) => string): string {
  const items = text.split('\n').filter((l) => l.trim()).map((l) => {
    const ind = /^[\t ]*/.exec(l)![0].replace(/\t/g, '  ').length;
    return { d: ind, t: l.trim().replace(/^[-*+]\s+|^\d+[.)、]\s*/, '') };
  });
  if (!items.length) return '';
  const levels = [...new Set(items.map((x) => x.d))].sort((a, b) => a - b);
  type Node = { t: string; kids: Node[] };
  const root: Node = { t: '', kids: [] }, stack: { lv: number; n: Node }[] = [{ lv: -1, n: root }];
  for (const it of items) {
    const lv = levels.indexOf(it.d), node: Node = { t: it.t, kids: [] };
    while (stack.length > 1 && stack[stack.length - 1].lv >= lv) stack.pop();
    stack[stack.length - 1].n.kids.push(node);
    stack.push({ lv, n: node });
  }
  const ul = (ns: Node[], depth: number): string => `<ul>${ns.map((n) => `<li><span class="tn d${Math.min(depth, 3)}">${inline(n.t)}</span>${n.kids.length ? ul(n.kids, depth + 1) : ''}</li>`).join('')}</ul>`;
  return `<div class="dg tree">${ul(root.kids.length === 1 ? root.kids : [{ t: '本课要点', kids: root.kids }], 0)}</div>`;
}

export function diagramHtml(lang: string, text: string, inline: (s: string) => string) {
  return isTimeline(lang) ? timelineHtml(text, inline) : treeHtml(text, inline);
}
