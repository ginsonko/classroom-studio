// 题库导入的纯逻辑：把一份卷子（PDF 文字层 / OCR / 纯文本）的行拆成一道道题，顺带认出答案。
// 不碰窗口，Node 里可以直接测试。

/** 一行文字：page 从 0 开始；y / b 是这一行上沿 / 下沿占页高的比例（纯文本没有位置时 y = b = 行号） */
export interface SrcLine { t: string; page: number; y: number; b: number; nx?: number }
/** 原卷上的一段区域（截图用）：第 page 页从 y0 到 y1；nx / nb：把左上角 [0, nx] × [y0, nb] 的原题号涂白 */
export interface Seg { page: number; y0: number; y1: number; nx?: number; nb?: number; /** 往上留白的极限（上一行的下沿） */ top?: number }
export interface Piece {
  n: number;
  stem: string;
  answer: string;
  analysis: string;
  /** 所在大题的标题（「一、选择题（每题 4 分）」），用来定题型 */
  section: string;
  segs: Seg[];
}

const FW = (s: string) => s.replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const CN = '一二三四五六七八九十';
// PDF 文字层里公式的箭头、上标常被取成控制字符（\0）：去掉
const clean = (s: string) => FW(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f\ufffd]/g, '').replace(/\s+/g, ' ').trim();
/** 页眉页脚、页码、装订线 */
const JUNK = /^(最强网课教辅系统\s*·.*|(?:试卷|试题|答案|答题卡|本卷|数学|物理|化学)?\s*第\s*\d+\s*页\s*[,，/（(]?\s*(?:共\s*\d+\s*页)?\s*[)）]?|[-—\s]*\d{1,3}[-—\s]*|\d+\s*\/\s*\d+|共\s*\d+\s*页|密\s*封\s*线.*|装\s*订\s*线.*|[○\s]*订[○\s]*线.*)$/;
/** 题库网站的水印、页脚（文字层里常有，夹在题目中间会把题拆坏） */
const WATERMARK = /^.{0,12}(学科网|组卷网|菁优网|21世纪教育网|二一教育|zxxk|jyeoo|21cnjy|www\.[\w-]+\.(?:com|cn|net)).{0,20}$/i;
const SECTION = new RegExp(`^(?:第?[${CN}]{1,3}\\s*[、.．]|第[${CN}]{1,3}部分|[ⅠⅡⅢⅣⅤⅥ]+\\s*[、.．])\\s*(.{0,40})$`);
/** 「数学试卷 第 1 页 共 4 页」这类带卷名的页脚 */
const PAGE_FOOT = /^.{0,16}第\s*\d+\s*页\s*[,，/（(]?\s*共\s*\d+\s*页\s*[)）]?$/;
const ANSWER_WORDS = '(?:参考答案|答案(?:与|及|和)?(?:解析|详解|评分标准)?|试题答案|答案速查|参考答案与(?:试题)?解析|试题解析)';
// 前面带卷名时只认这几种说法（「在横线上填写答案」这类题干不能当成答案区）
const TITLED_WORDS = '(?:参考答案(?:与(?:试题)?解析)?|答案(?:与|及|和)(?:解析|详解|评分标准)|试题解析|答案解析|答案速查)';
/** 答案区开头：「参考答案」，也可能带卷名「《10.18 作业-向量和圆》参考答案」「高一数学月考 答案与解析」 */
const ANSWER_HEAD = new RegExp(`^(?:[【\\[(（]?\\s*${ANSWER_WORDS}\\s*[】\\])）]?|《[^》]{1,60}》\\s*${ANSWER_WORDS}|[^\\d\\s（(【].{0,40}?\\s*${TITLED_WORDS})\\s*[:：]?$`);
/** 题号：1. / 1、/ 1． / 第1题；半角小数（1.5 m）不算，全角点后面跟数字（3．20 m）算 */
const QNUM = /^(?:第\s*(\d{1,3})\s*题[:：.．、\s]*|(\d{1,3})\s*(?:[．、]|\.(?!\d)))\s*/;
// 截图经系统 OCR 时【】常被认成（〗〔 之类，括号放宽
const INLINE_ANS = /^[【\[〖〔(（]\s*(答案|解析|详解|分析|点评|解答|考点|答)\s*[】\]〗〕)）]\s*[:：]?\s*|^(答案|解析|详解)\s*[:：]\s*/;
const CHOICE_ROW = /(\d{1,3})\s*[.．、:：]?\s*[(（]?([A-H]{1,4})[)）]?(?=[\s,，;；]|$)/g;

const joinLines = (ls: string[]) => ls.reduce((s, l) => (!s ? l : /[\u4e00-\u9fff，。；：、）)】]$/.test(s) && /^[\u4e00-\u9fff，。；：、（(【]/.test(l) ? s + l : s + '\n' + l), '');

/**
 * 每页正文的上下界（截图时跨页的题从这里续上）。页上最后一题下面常有不带文字的配图：
 * 下界放到页脚上沿（没有页脚就到页面底部），多出来的空白截图时会裁掉。
 */
function bounds(lines: SrcLine[], dropped: SrcLine[]) {
  const m = new Map<number, { top: number; bottom: number }>();
  for (const l of lines) { const v = m.get(l.page); m.set(l.page, v ? { top: Math.min(v.top, l.y), bottom: Math.max(v.bottom, l.b) } : { top: l.y, bottom: l.b }); }
  // 纯文本没有版面位置（y 是行号），不用放
  if (lines.some((l) => l.b > 1.001)) return m;
  for (const [pg, v] of m) {
    const foot = Math.min(...dropped.filter((l) => l.page === pg && l.y >= v.bottom).map((l) => l.y));
    v.bottom = Number.isFinite(foot) ? Math.max(v.bottom, foot - 0.003) : Math.max(v.bottom, 0.97);
  }
  return m;
}

export function splitQuestions(input: SrcLine[]): { pieces: Piece[]; title: string; answers: number } {
  const all = input.map((l) => ({ ...l, t: clean(l.t) })).filter((l) => l.t);
  const junk = (t: string) => JUNK.test(t) || PAGE_FOOT.test(t) || WATERMARK.test(t);
  const lines = all.filter((l) => !junk(l.t));
  const box = bounds(lines, all.filter((l) => JUNK.test(l.t) || PAGE_FOOT.test(l.t)));
  const pieces: (Piece & { body: string[]; ans: string[]; ana: string[]; mode: 'stem' | 'ans' | 'ana'; start: SrcLine; end?: SrcLine })[] = [];
  let section = '', last = 0, inAnswers = false, title = '';
  let cur: (typeof pieces)[number] | null = null;
  // 答案区：题号 → 答案行
  const answers = new Map<number, { ans: string[]; ana: string[] }>();
  let ansCur: { ans: string[]; ana: string[] } | null = null, rowNums: number[] | null = null;
  const close = (at?: SrcLine) => { if (cur && !cur.end) cur.end = at; cur = null; };

  for (const [i, l] of lines.entries()) {
    const t = l.t;
    if (!inAnswers && ANSWER_HEAD.test(t) && (pieces.length > 0 || i > 0)) { close(l); inAnswers = true; continue; }
    if (inAnswers) {
      // 「题号 1 2 3 4」下一行「答案 B C A D」
      const hd = /^题\s*号\s*((?:\d{1,3}\s*)+)$/.exec(t);
      if (hd) { rowNums = hd[1].trim().split(/\s+/).map(Number); continue; }
      const ar = /^答\s*案\s*((?:[A-H]{1,4}\s*)+)$/.exec(t);
      if (ar && rowNums) { ar[1].trim().split(/\s+/).forEach((v, k) => { if (rowNums![k]) answers.set(rowNums![k], { ans: [v], ana: [] }); }); rowNums = null; continue; }
      // 一行好几个选择题答案：1.B 2.C 3.AD
      const row = [...t.matchAll(CHOICE_ROW)];
      if (row.length >= 2 && row.map((m) => m[0]).join('').replace(/\s/g, '').length >= t.replace(/[\s,，;；]/g, '').length - 2) {
        for (const m of row) answers.set(Number(m[1]), { ans: [m[2]], ana: [] });
        ansCur = null; continue;
      }
      if (SECTION.test(t)) { ansCur = null; continue; }
      const qn = QNUM.exec(t);
      if (qn) {
        const n = Number(qn[1] ?? qn[2]);
        ansCur = { ans: [], ana: [] }; answers.set(n, ansCur);
        let rest = t.slice(qn[0].length);
        const ia = INLINE_ANS.exec(rest);
        if (ia && /解析|详解|分析|解答|点评/.test(ia[1] ?? ia[2] ?? '')) { ansCur.ana.push(rest.slice(ia[0].length)); continue; }
        if (ia) rest = rest.slice(ia[0].length);
        // 「1. B　解析：……」
        const split = /^(.*?)\s*[【\[]?(?:解析|详解|分析)[】\]]?\s*[:：]?\s*(.*)$/.exec(rest);
        if (split && split[1]) { ansCur.ans.push(split[1]); if (split[2]) ansCur.ana.push(split[2]); }
        else if (rest) ansCur.ans.push(rest);
        continue;
      }
      if (ansCur) {
        const ia = INLINE_ANS.exec(t);
        if (ia && /解析|详解|分析|解答|点评/.test(ia[1] ?? ia[2] ?? '')) ansCur.ana.push(t.slice(ia[0].length));
        else (ansCur.ana.length ? ansCur.ana : ansCur.ans).push(ia ? t.slice(ia[0].length) : t);
      }
      continue;
    }
    const sec = SECTION.exec(t);
    if (sec && !QNUM.test(t) && t.length <= 60) { close(l); section = t; continue; }
    const qn = QNUM.exec(t);
    const n = qn ? Number(qn[1] ?? qn[2]) : 0;
    // 题号要接得上：下一号、新大题从 1 重新编号、或者第一道题
    if (qn && n > 0 && (n === last + 1 || !pieces.length || (n === 1 && !cur) || (n === 1 && !!section && (cur as Piece | null)?.section !== section))) {
      close(l);
      cur = { n, stem: '', answer: '', analysis: '', section, segs: [], body: [t.slice(qn[0].length)], ans: [], ana: [], mode: 'stem', start: l };
      pieces.push(cur); last = n;
      continue;
    }
    if (!cur) { if (!title && !pieces.length && t.length <= 40 && !/[:：]/.test(t)) title = t; continue; }
    const ia = INLINE_ANS.exec(t);
    if (ia) {
      const what = ia[1] ?? ia[2] ?? '';
      if (cur.mode === 'stem' && !cur.end) cur.end = l;
      cur.mode = /解析|详解|分析|解答|点评|考点/.test(what) ? 'ana' : 'ans';
      const rest = t.slice(ia[0].length);
      if (rest) (cur.mode === 'ans' ? cur.ans : cur.ana).push(rest);
      continue;
    }
    (cur.mode === 'stem' ? cur.body : cur.mode === 'ans' ? cur.ans : cur.ana).push(t);
  }
  close();

  const out: Piece[] = pieces.map((p) => {
    const { start, end } = p;
    const segs: Seg[] = [];
    const endPage = end ? end.page : Math.max(...lines.filter((x) => x.page >= start.page).map((x) => x.page), start.page);
    for (let pg = start.page; pg <= endPage; pg++) {
      const b = box.get(pg); if (!b) continue;
      const y0 = pg === start.page ? start.y : b.top;
      // 下一题的题号框往往比文字高，截到它上沿再往上一点，免得露出一截
      const y1 = end && pg === end.page ? end.y - (end.b - end.y) * 0.3 : b.bottom;
      // 续页上没有这道题的文字（比如答案区另起一页）就不截
      const has = pg === start.page || lines.some((x) => x.page === pg && x.y >= y0 - 0.001 && x.b <= y1 + 0.01);
      // 题号常带圆圈 / 方框，比文字高一点，涂白的范围往下多留 0.4 行
      // 往上留白时不越过上一行（大题标题）的下沿
      const above = pg === start.page ? Math.max(0, ...lines.filter((x) => x.page === pg && x.y < start.y && x.b <= start.y + 0.002).map((x) => x.b)) : 0;
      if (has && y1 - y0 > 0.004) segs.push({ page: pg, y0, y1, ...(above > 0 ? { top: above } : {}), ...(pg === start.page && start.nx ? { nx: start.nx, nb: start.b + (start.b - start.y) * 0.4 } : {}) });
    }
    const a = answers.get(p.n);
    const answer = joinLines(p.ans).trim() || (a ? joinLines(a.ans).trim() : '');
    const analysis = joinLines(p.ana).trim() || (a ? joinLines(a.ana).trim() : '');
    // 导出的作业里题干后面带「（计算，中档）」，导回来时去掉
    const stem = joinLines(p.body).replace(/[\u3000 ]*[（(][^（）()\n]{1,8}[，,]\s*(?:基础|巩固|中档|提高|压轴)[）)]/g, '').trim();
    return { n: p.n, stem, answer, analysis, section: p.section, segs };
  }).filter((p) => p.stem || p.segs.length);
  // 每个大题从 1 重新编号时，答案区的同号会对不上：只有题号唯一时才用答案区
  const dupNums = new Set(out.map((p) => p.n).filter((n, i, a) => a.indexOf(n) !== i));
  if (dupNums.size) for (const p of out) if (dupNums.has(p.n) && !pieces.find((x) => x.n === p.n)?.ans.length) { p.answer = ''; p.analysis = ''; }
  return { pieces: out, title, answers: out.filter((p) => p.answer).length };
}

/**
 * 一张题目截图（OCR 行）里的答案部分：从第一个「【答案】/【详解】/答案：」那行起往下都是答案。
 * cut 是那一行的上沿（占图高的比例），截图裁到这里；答案、解析单独记下。
 */
export function answerTail(input: SrcLine[]): { cut?: number; answer: string; analysis: string } {
  const lines = input.map((l) => ({ ...l, t: clean(l.t) })).filter((l) => l.t);
  const k = lines.findIndex((l, i) => i > 0 && (INLINE_ANS.test(l.t) || ANSWER_HEAD.test(l.t)));
  if (k < 0) return { answer: '', analysis: '' };
  const ans: string[] = [], ana: string[] = [];
  let into = ans;
  for (const l of lines.slice(k)) {
    const m = INLINE_ANS.exec(l.t);
    if (m) { into = /解析|详解|分析|解答|点评|考点/.test(m[1] ?? m[2] ?? '') ? ana : ans; const rest = l.t.slice(m[0].length); if (rest) into.push(rest); continue; }
    if (ANSWER_HEAD.test(l.t)) continue;
    into.push(l.t);
  }
  return { cut: lines[k].y, answer: joinLines(ans).trim(), analysis: joinLines(ana).trim() };
}

/** 大题标题里的题型（选择、填空…）；对不上本学科题型就返回空，交给规则或 AI 判断 */
export function sectionType(section: string, qtypes: string[]): string {
  const s = section.replace(/\s/g, '');
  if (!s) return '';
  const hit = qtypes.find((q) => q !== '其他' && s.includes(q));
  if (hit) return hit;
  if (/单选|多选|单项选择|不定项/.test(s)) return qtypes.find((q) => q.includes('选择')) ?? '';
  if (/解答|计算|论述|证明/.test(s)) return qtypes.find((q) => /解答|计算/.test(q)) ?? '';
  return '';
}

const WIDE = '\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef';
/** Windows 中文 OCR 在每个词之间加空格、把题号的点认成逗号（「1 ， 计算 3 8」）：去掉中文两侧和数字之间的空格，题号后的逗号还原成点 */
export const ocrText = (s: string) => s.trim()
  .replace(new RegExp(`(?<=[${WIDE}])\\s+|\\s+(?=[${WIDE}])`, 'g'), '')
  .replace(/(?<=\d) (?=\d)/g, '')
  .replace(/^(\d{1,3})\s*[，,]\s*/, '$1. ');

/** OCR 只给每行的上沿：下沿取下一行的上沿（最后一行加一个行高） */
export type OcrLine = { t: string; y?: number; b?: number; ws?: [string, number][] };
/** 行首是题号时，题号后面第一个词的横坐标（占图宽的比例） */
function ocrNumberEnd(t: string, ws?: [string, number][]) {
  const m = QNUM.exec(t);
  if (!m || !ws?.length) return undefined;
  const need = m[0].replace(/\s/g, '').length;
  let acc = 0;
  for (let k = 0; k < ws.length; k++) {
    acc += ws[k][0].replace(/\s/g, '').length;
    if (acc === need) return ws[k + 1]?.[1];
    if (acc > need) return undefined;
  }
  return undefined;
}
export function ocrLines(pages: { lines: OcrLine[] }[]): SrcLine[] {
  const out: SrcLine[] = [];
  pages.forEach((p, page) => {
    const ls = p.lines.filter((l) => l.t?.trim()).map((l, i) => {
      const t = ocrText(l.t), y = Number.isFinite(l.y) ? Number(l.y) : i / Math.max(1, p.lines.length);
      return { t, y, bottom: Number.isFinite(l.b) && Number(l.b) > y ? Math.min(1, Number(l.b) + (Number(l.b) - y) * 0.15) : undefined, nx: ocrNumberEnd(t, l.ws) };
    });
    const gaps = ls.slice(1).map((l, i) => l.y - ls[i].y).filter((g) => g > 0).sort((a, b) => a - b);
    const h = gaps[Math.floor(gaps.length / 2)] ?? 0.03;
    ls.forEach((l, i) => out.push({ t: l.t, page, y: l.y, b: l.bottom ?? Math.min(1, Math.max(l.y + h * 0.5, i + 1 < ls.length ? Math.min(ls[i + 1].y, l.y + h * 2.5) : l.y + h)), ...(l.nx ? { nx: l.nx } : {}) }));
  });
  return out;
}
/** 照片 / 截图没有物理尺寸：按文字框高度（中位数）折算到 10.5pt 正文（识别框约为字号的 0.9），得到每 pt 多少像素 */
export function ocrScale(lines: SrcLine[], pageH: number): number | undefined {
  const hs = lines.map((l) => (l.b - l.y) * pageH).filter((x) => x > 4).sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)] / 9.5 : undefined;
}

/** 纯文本（txt / md / 粘贴的整份卷子）：没有位置，只按行拆 */
export const textLines = (text: string): SrcLine[] => text.replace(/\r\n?/g, '\n').split('\n').map((t, i) => ({ t, page: 0, y: i, b: i + 1 }));

export const IMPORT_EXT = /\.(pdf|docx?|rtf|png|jpe?g|bmp|webp|txt|md)$/i;
