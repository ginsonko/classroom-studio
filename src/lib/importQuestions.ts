// 题库导入：Word / PDF / 图片 / 文本 → 转文字（PDF 文字层，没有就用系统 OCR）→ 按题号拆题 →
// 每道题截下原卷区域当题图（配图、公式跟着题走）→ 查重 → 进收件箱。配了 AI 时后台补答案、知识点并独立再解一遍自检。
import { ai, type AiConfig } from './ai';
import { host } from './host';
import { pdfPageLines, pdfRaster } from '../doc/pdf';
import { IMPORT_EXT, answerTail, flattenPaper, isPhoto, ocrLines, ocrScale, photoRegions, photoTurn, sectionType, splitQuestions, textLines, type OcrLine, type Piece, type Seg, type SrcLine } from './importLogic';
import { answersMatch, findDuplicate, guessDifficulty, guessPoints, guessType, looseJSON, qtypesOf, type Question } from './studyLogic';
import { addQuestion, patchQuestion, removeQuestions, useStudy } from './studyStore';
import { aiConfig, autoReadOn, readInBackground, useReading } from './studyActions';
import { online, onlyNo, readQuestion } from './studyAi';
import { packOf, type SubjectId } from './subjects';

export interface ImportFileResult { name: string; added: number; dup: number; error?: string; note?: string }
/** batch：这次导入的批次号（整批撤回用）；photos：没用 AI、原样存下等以后拆题的照片张数 */
export interface ImportResult { added: Question[]; dup: number; files: ImportFileResult[]; ai: boolean; batch: string; photos: number }

const MAX_PAGES = 40, MAX_QUESTIONS = 300, PAGE_W = 1400;
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读不出来，可能已损坏或格式不支持'));
    img.src = url;
  });
}
/** k：每 pt 多少像素（PDF 页按页宽算；照片按文字行高估） */
export type Page = { src: CanvasImageSource; w: number; h: number; k?: number; close?: () => void; /** 原图像素（缩小前） */ nw?: number; nh?: number };

export async function pageOfImage(path: string): Promise<Page> {
  const img = await loadImage(host.fileUrl(path));
  // 手机拍的大图先缩到 2000px 宽，OCR 和截图都够用
  const k = Math.min(1, 2000 / img.naturalWidth), c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { src: c, w: c.width, h: c.height, nw: img.naturalWidth, nh: img.naturalHeight, close: () => { c.width = 0; c.height = 0; } };
}
export async function pageOfDataUrl(url: string): Promise<Page> {
  const img = await loadImage(url);
  return { src: img, w: img.naturalWidth, h: img.naturalHeight };
}
async function pageOfPdf(pdf: string, index: number, ptWidth: number): Promise<Page> {
  const bmp = await createImageBitmap(await pdfRaster(pdf, index, PAGE_W));
  return { src: bmp, w: bmp.width, h: bmp.height, k: ptWidth > 0 ? bmp.width / ptWidth : undefined, close: () => bmp.close() };
}
const pngOf = (p: Page) => { const c = document.createElement('canvas'); c.width = p.w; c.height = p.h; c.getContext('2d')!.drawImage(p.src, 0, 0); try { return c.toDataURL('image/png'); } finally { c.width = 0; c.height = 0; } };
/** 照片原样存 / 发给 AI：JPEG 小得多；maxW 限制宽度 */
export const jpegOf = (p: Page, maxW = 2000) => {
  const k = Math.min(1, maxW / p.w), c = document.createElement('canvas');
  c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(p.src, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.86); } finally { c.width = 0; c.height = 0; }
};

/** 照片顺时针转 90 / 180 / 270 度（拍歪了的卷子），返回新的一页 */
export function turnPage(p: Page, deg: 0 | 90 | 180 | 270): Page {
  if (!deg) return p;
  const side = deg !== 180, c = document.createElement('canvas');
  c.width = side ? p.h : p.w; c.height = side ? p.w : p.h;
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(p.src, -p.w / 2, -p.h / 2, p.w, p.h);
  return { src: c, w: c.width, h: c.height, nw: side ? p.nh : p.nw, nh: side ? p.nw : p.nh, close: () => { c.width = 0; c.height = 0; } };
}
/**
 * 拍歪的照片：模型说字头朝哪边，转正以后再问一遍（框要按转正的图给）。
 * 转完它还说歪，就按它新说的再补转一次；还不正就当它看错了，用原图的结果。
 */
export async function askUpright<T>(p: Page, ask: (img: string) => Promise<unknown>, parse: (v: unknown, w: number, h: number) => T): Promise<{ v: T; page: Page; turn: 0 | 90 | 180 | 270 }> {
  // 模型若回像素坐标，是相对发过去的那张（缩到 1600 宽）
  const send = (q: Page) => { const k = Math.min(1, 1600 / q.w); return { img: jpegOf(q, 1600), w: Math.round(q.w * k), h: Math.round(q.h * k) }; };
  const a = send(p), first = await ask(a.img);
  let turn = photoTurn(first);
  for (let tries = 0; turn && tries < 2; tries++) {
    const q = turnPage(p, turn), b = send(q), again = await ask(b.img), more = photoTurn(again);
    if (!more) return { v: parse(again, b.w, b.h), page: q, turn };
    q.close?.();
    turn = ((turn + more) % 360) as 0 | 90 | 180 | 270;
  }
  return { v: parse(first, a.w, a.h), page: p, turn: 0 };
}
export const TURN_HINT = '"up"：照片里文字的字头朝哪边：up 朝上（正常）、left 朝左、right 朝右、down 倒过来。';

/** 让 AI 看照片，框出每道题的位置（含配图、选项、小问）；看不出来时返回空。照片拍歪了会转正，page 是转正后的那页 */
async function locateByAi(p: Page, cfg: AiConfig | null): Promise<{ regions: { n: number; segs: Seg[] }[]; page: Page }> {
  if (!online(cfg)) return { regions: [], page: p };
  const prompt = [
    '这是老师拍的一页试卷 / 作业照片。请找出照片里每一道题（大题下的小题按大题算一道；连同它的题干、配图、选项、小问一起）所在的矩形区域。',
    '卷子可能分左右两栏；一道题跨栏时给两个框。不要框标题、注意事项、页眉页脚、答题卡、学生的草稿，也不要框照片边上只露出一两行、看不出在问什么的残题（大半拍到了的要框）。',
    '坐标用 0~1000 的整数表示（左上角 0,0，右下角 1000,1000），框要把整道题包全，宁大勿小。',
    '输出 JSON：{"up":"up","questions":[{"n":大题号（整数）,"boxes":[[x0,y0,x1,y1]]}]}；照片里没有题目就输出 {"up":"up","questions":[]}',
    TURN_HINT,
  ].join('\n');
  const ask = async (img: string) => looseJSON((await ai.chat([{ role: 'user', content: prompt }], { image: img, json: true, maxTokens: 2500, temperature: 0, feature: '照片拆题', ...(cfg!.visionModel ? { model: cfg!.visionModel } : {}) })).content);
  const r = await askUpright(p, ask, (v, w, h) => photoRegions(v, w, h));
  return { regions: r.v, page: r.page };
}

/** 把题目所在的区域（可能跨页）竖着拼成一张图，四周空白裁掉；pt：按原卷大小排版时的宽度 */
export async function cropSegs(segs: Seg[], page: (i: number) => Promise<Page | undefined>, opt: { paper?: boolean } = {}): Promise<{ png: string; pt?: number }> {
  const got: { s: Seg; p: Page | undefined }[] = [];
  for (const s of segs) got.push({ s, p: await page(s.page) });
  const parts = got.filter((x): x is { s: Seg; p: Page } => !!x.p).map(({ s, p }) => {
    const pad = 0.006 * p.h, y0 = Math.max(0, (s.top ?? 0) * p.h + 1, s.y0 * p.h - pad), y1 = Math.min(p.h, s.y1 * p.h - 1);
    const x0 = Math.max(0, Math.round((s.x0 ?? 0) * p.w)), x1 = Math.min(p.w, Math.round((s.x1 ?? 1) * p.w));
    return { p, s, y0, h: Math.max(1, Math.round(y1 - y0)), x0, w: Math.max(1, x1 - x0) };
  }).filter((x) => x.h > 6 && x.w > 6);
  if (!parts.length) return { png: '' };
  const w = Math.max(...parts.map((x) => x.w)), H = parts.reduce((a, x) => a + x.h, 0);
  const c = document.createElement('canvas'); c.width = w; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, H);
  let y = 0;
  for (const x of parts) {
    g.drawImage(x.p.src, x.x0, x.y0, x.w, x.h, 0, y, x.w, x.h);
    // 原卷的题号涂掉：导出时会重新编号
    // 文字层给的横坐标和渲染出来的字形有几像素偏差，留一点余量，免得把题干第一个字涂掉半边
    if (x.s.nx && x.s.nb) { g.fillStyle = '#fff'; g.fillRect(0, y, Math.round((x.s.nx - 0.004) * x.p.w), Math.min(x.h, Math.round(x.s.nb * x.p.h - x.y0) + 2)); }
    y += x.h;
  }
  const k = parts[0].p.k;
  try {
    const img = g.getImageData(0, 0, w, H), d = img.data;
    if (opt.paper) flattenPaper(d, w, H);
    // 题库网站的浅灰水印、底纹：很浅且不带颜色的像素直接变白（正文是深色，不受影响）
    for (let i = 0; i < d.length; i += 4) {
      const lo = Math.min(d[i], d[i + 1], d[i + 2]), hi = Math.max(d[i], d[i + 1], d[i + 2]);
      if (lo >= 200 && hi - lo <= 30) { d[i] = d[i + 1] = d[i + 2] = 255; }
    }
    g.putImageData(img, 0, 0);
    // 裁掉四周空白（解答题后面留给学生写的大片空白也去掉）
    let L = w, R = 0, T = H, B = 0;
    for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < w; xx += 2) { const i = (yy * w + xx) * 4; if (d[i] + d[i + 1] + d[i + 2] < 660) { if (xx < L) L = xx; if (xx > R) R = xx; if (yy < T) T = yy; if (yy > B) B = yy; } }
    if (R <= L || B <= T) return { png: '' };
    L = Math.max(0, L - 14); R = Math.min(w, R + 14); T = Math.max(0, T - 12); B = Math.min(H, B + 14);
    const o = document.createElement('canvas'); o.width = R - L; o.height = B - T;
    o.getContext('2d')!.drawImage(c, L, T, R - L, B - T, 0, 0, R - L, B - T);
    try { return { png: o.toDataURL('image/png'), pt: k ? Math.round((R - L) / k) : undefined }; } finally { o.width = 0; o.height = 0; }
  } finally { c.width = 0; c.height = 0; }
}

/**
 * 粘贴的题目截图里常连着【答案】【详解】：识别文字，把答案那几行以下裁掉，答案、解析单独返回。
 * 本机没有文字识别、或者截图里没有答案时原样返回。
 */
export async function trimShot(dataUrl: string): Promise<{ png: string; answer: string; analysis: string; text: string }> {
  const same = { png: dataUrl, answer: '', analysis: '', text: '' };
  const r = await host.call<{ lines: OcrLine[] }[] | null>('study.ocr', [dataUrl]).catch(() => null);
  if (!r?.[0]) return same;
  const lines = ocrLines(r), tail = answerTail(lines);
  const text = lines.filter((l) => tail.cut === undefined || l.y < tail.cut).map((l) => l.t).join('\n');
  if (tail.cut === undefined || tail.cut < 0.08) return { ...same, text };
  const img = await loadImage(dataUrl);
  const p: Page = { src: img, w: img.naturalWidth, h: img.naturalHeight };
  const crop = await cropSegs([{ page: 0, y0: 0, y1: tail.cut - 0.004 }], async () => p);
  return crop.png ? { png: crop.png, answer: tail.answer, analysis: tail.analysis, text } : { ...same, text };
}

/** 一份文件 → 行 + 每页的图（截题图用） */
type Doc = { lines: SrcLine[]; page: (i: number) => Promise<Page | undefined>; whole: number; release: () => void; note?: string; photo?: boolean };
async function readFile(path: string, onStep: (t: string) => void): Promise<Doc> {
  const name = baseName(path), ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
  const pages = new Map<number, Page>(), release = () => { for (const p of pages.values()) p.close?.(); pages.clear(); };
  if (ext === 'txt' || ext === 'md') return { lines: textLines(await host.call<string>('study.readText', path)), page: async () => undefined, whole: 0, release };
  if (/^(png|jpe?g|bmp|webp)$/.test(ext)) {
    const p = await pageOfImage(path); pages.set(0, p);
    // 照片上的字系统识别不准（拆出来是乱码），不做文字识别，交给 AI 看图
    if (isPhoto(ext, p.nw ?? p.w, p.nh ?? p.h)) return { lines: [], page: async (i) => pages.get(i), whole: 1, release, photo: true };
    onStep(`识别图片文字：${name}`);
    const r = await host.call<{ lines: OcrLine[] }[] | null>('study.ocr', [pngOf(p)]).catch(() => null);
    const lines = r ? ocrLines(r) : [];
    p.k = ocrScale(lines, p.h);
    return { lines, page: async (i) => pages.get(i), whole: 1, release, note: r ? undefined : '本机没有文字识别，整张图作为一道题' };
  }
  let pdf = path;
  if (ext !== 'pdf') {
    onStep(`转换 Word 文档：${name}`);
    const c = await host.convert(path);
    if (!c.pdf) throw new Error('这份文档没有转换成 PDF');
    pdf = c.pdf;
  }
  onStep(`读取文字：${name}`);
  const text = await pdfPageLines(pdf, MAX_PAGES);
  const lines: SrcLine[] = [];
  const blank: number[] = [];
  text.forEach((p, page) => { if (p.lines.filter((l) => l.t.trim()).length < 2) blank.push(page); else for (const l of p.lines) lines.push({ t: l.t, page, y: l.y ?? 0, b: l.b ?? l.y ?? 0, nx: l.nx }); });
  // 整页图按需渲染，只留最近 3 页（40 页的卷子全渲染出来要好几百 MB）
  const page = async (i: number) => {
    if (i < 0 || i >= text.length) return undefined;
    let p = pages.get(i);
    if (p) { pages.delete(i); pages.set(i, p); return p; }
    p = await pageOfPdf(pdf, i, text[i].w); pages.set(i, p);
    while (pages.size > 3) { const k = pages.keys().next().value!; pages.get(k)?.close?.(); pages.delete(k); }
    return p;
  };
  let note: string | undefined;
  if (blank.length) {
    // 扫描版：整页是图片，没有文字层；一次最多送 6 页给 OCR
    onStep(`扫描版，识别 ${blank.length} 页文字：${name}`);
    for (let k = 0; k < blank.length; k += 6) {
      const batch = blank.slice(k, k + 6), pngs: string[] = [];
      for (const i of batch) { const p = await page(i); if (p) pngs.push(pngOf(p)); }
      const r = await host.call<{ lines: OcrLine[] }[] | null>('study.ocr', pngs).catch(() => null);
      if (!r) { note = '扫描版 PDF，本机没有文字识别，每页作为一道题'; break; }
      ocrLines(r).forEach((l) => lines.push({ ...l, page: batch[l.page] }));
    }
    lines.sort((a, b) => a.page - b.page || a.y - b.y);
  }
  return { lines, page, whole: text.length, release, note };
}

/** 导入若干文件到收件箱；配了 AI 且开着「自动识题」时，后台补全答案 / 知识点并自检 */
export async function importFiles(paths: string[], subject: SubjectId, onStep: (t: string) => void = () => {}, o: { batch?: string; ai?: boolean } = {}): Promise<ImportResult> {
  const cfg = await aiConfig(), useAi = online(cfg) && (o.ai ?? autoReadOn()), qtypes = qtypesOf(subject);
  const added: Question[] = [], files: ImportFileResult[] = [], batch = o.batch ?? crypto.randomUUID();
  let dup = 0, photos = 0;
  for (const path of paths.filter((p) => IMPORT_EXT.test(p))) {
    const name = baseName(path), res: ImportFileResult = { name, added: 0, dup: 0 };
    files.push(res);
    let doc: Doc | null = null;
    try {
      doc = await readFile(path, onStep);
      res.note = doc.note;
      const source = name.replace(/\.[^.]+$/, '');
      if (doc.photo) {
        const p = (await doc.page(0))!;
        if (!useAi) {
          // 原样存一张，等配好 AI 再拆
          const image = await host.call<string>('study.image', jpegOf(p));
          added.push(addQuestion({ stem: '', image, answer: '', analysis: '', points: [], difficulty: 3, qtype: '其他', source, origin: 'import', status: 'inbox', subject, batch, needsAi: true }));
          res.added++; photos++;
          continue;
        }
        onStep(`AI 正在照片上找题：${name}`);
        const got = await splitPhoto(p, cfg, { source, subject, batch }).catch((e: Error) => { res.note = `AI 拆题没成功（${e.message}），整张照片作为一道题`; return [] as Question[]; });
        if (got.length) { added.push(...got); res.added += got.length; continue; }
        if (!res.note) res.note = 'AI 没在照片上找到题目，整张照片作为一道题';
        const image = await host.call<string>('study.image', jpegOf(p));
        added.push(addQuestion({ stem: '', image, answer: '', analysis: '', points: [], difficulty: 3, qtype: '其他', source, origin: 'import', status: 'inbox', subject, batch }));
        res.added++;
        continue;
      }
      let pieces: Piece[] = splitQuestions(doc.lines).pieces;
      // 拆不出题号（一张截图就是一道题、扫描件没法识别）：整页当一道题，交给 AI 看图
      if (!pieces.length && doc.whole) pieces = Array.from({ length: doc.whole }, (_, i) => ({ n: i + 1, stem: doc!.lines.filter((l) => l.page === i).map((l) => l.t).join('\n'), answer: '', analysis: '', section: '', segs: [{ page: i, y0: 0, y1: 1 }] }));
      if (!pieces.length) throw new Error(doc.lines.length ? '没有找到题号（1. 2. 3. 这样的编号），可以用「粘贴题目」逐题收' : '文件里没有读到文字');
      onStep(`拆出 ${pieces.length} 题，截取题图：${name}`);
      for (const p of pieces.slice(0, MAX_QUESTIONS)) {
        const pool = useStudy.getState().data.questions;
        if (p.stem && findDuplicate(p.stem, pool)) { res.dup++; dup++; continue; }
        const crop = p.segs.length ? await cropSegs(p.segs, doc.page) : { png: '' };
        const image = crop.png ? await host.call<string>('study.image', crop.png) : undefined;
        if (!p.stem && !image) continue;
        const qtype = sectionType(p.section, qtypes) || (p.stem ? guessType(p.stem, subject) : '其他');
        const q = addQuestion({ stem: p.stem, image, imagePt: image ? crop.pt : undefined, answer: p.answer, analysis: p.analysis, points: useAi ? [] : guessPoints(p.stem, subject), difficulty: guessDifficulty(p.stem), qtype, source: `${source} 第 ${p.n} 题`, origin: 'import', status: 'inbox', subject, batch });
        added.push(q); res.added++;
      }
    } catch (e) { res.error = (e as Error).message; }
    finally { doc?.release(); }
  }
  if (useAi && added.length) void fillByAi(added.map((q) => q.id), cfg);
  return { added, dup, files, ai: useAi, batch, photos };
}

/** 照片 → AI 框题 → 每题截一张图进收件箱（题干等 fillByAi 看图补）；框不出题返回空 */
async function splitPhoto(p: Page, cfg: AiConfig | null, o: { source: string; subject: SubjectId; batch?: string }): Promise<Question[]> {
  const { regions, page } = await locateByAi(p, cfg);
  try { return (await photoQuestions(page, regions, o)).map((x) => x.q); }
  finally { if (page !== p) page.close?.(); }
}
/** 照片上框好的题 → 每题截一张图进收件箱；返回题和它对应的框 */
export async function photoQuestions<R extends { n: number; segs: Seg[] }>(p: Page, regions: R[], o: { source: string; subject: SubjectId; batch?: string }): Promise<{ q: Question; r: R }[]> {
  const out: { q: Question; r: R }[] = [];
  for (const r of regions.slice(0, MAX_QUESTIONS)) {
    const crop = await cropSegs(r.segs, async () => p, { paper: true });
    if (!crop.png) continue;
    const image = await host.call<string>('study.image', crop.png);
    out.push({ r, q: addQuestion({ stem: '', image, answer: '', analysis: '', points: [], difficulty: 3, qtype: '其他', source: `${o.source} 第 ${r.n} 题`, origin: 'import', status: 'inbox', subject: o.subject, ...(o.batch ? { batch: o.batch } : {}) }) });
  }
  return out;
}

/**
 * 「AI 识别未整理的题」：先把没配 AI 时原样存下的照片拆成一道道题（原照片删掉），再逐题识题。
 * 拆不出来时整张照片当一道题识别。
 */
export async function readPending(ids: string[], cfg: AiConfig | null): Promise<void> {
  const fill: string[] = [];
  for (const id of ids) {
    const q = useStudy.getState().data.questions.find((x) => x.id === id);
    if (!q) continue;
    if (!q.needsAi || !q.image || !online(cfg)) { fill.push(id); continue; }
    useReading.setState((s) => ({ ids: [...s.ids, id], errors: { ...s.errors, [id]: '' } }));
    try {
      const p = await pageOfDataUrl(await host.call<string>('study.imageData', q.image));
      const got = await splitPhoto(p, cfg, { source: (q.source ?? '照片').replace(/ 第 \d+ 题$/, ''), subject: q.subject ?? 'physics', batch: q.batch });
      if (got.length) { removeQuestions([id]); fill.push(...got.map((x) => x.id)); }
      else { patchQuestion(id, { needsAi: undefined }); fill.push(id); }
    } catch (e) {
      useReading.setState((s) => ({ errors: { ...s.errors, [id]: (e as Error).message } }));
    } finally {
      useReading.setState((s) => ({ ids: s.ids.filter((x) => x !== id) }));
    }
  }
  if (online(cfg)) await fillByAi(fill, cfg);
  else for (const id of fill) await readInBackground(id, cfg);
}

// 开放题（作文、阅读、简答……）没有唯一答案，不做「再解一遍对答案」
const OPEN = /作文|写作|阅读|论述|简答|翻译|材料|书面表达|默写|名著/;
let chain: Promise<void> = Promise.resolve();

/**
 * 后台两路并行：看图补题干 / 答案 / 解析 / 知识点 / 难度 / 题型（已有的不覆盖），
 * 再让模型不看答案独立解一遍，和答案对得上记 ok，对不上记 mismatch，老师在收件箱里核对。
 */
export function fillByAi(ids: string[], cfg: AiConfig | null): Promise<void> {
  const one = async (id: string) => {
    const q0 = useStudy.getState().data.questions.find((q) => q.id === id);
    if (!q0 || !online(cfg)) return;
    const subject = q0.subject ?? 'physics', pack = packOf(subject);
    useReading.setState((s) => ({ ids: [...s.ids, id], errors: { ...s.errors, [id]: '' } }));
    try {
      const image = q0.image ? await host.call<string>('study.imageData', q0.image) : undefined;
      // 照片框出来的题（还没题干）：告诉模型是第几题
      const no = image && !q0.stem ? Number(q0.source?.match(/第 (\d+) 题$/)?.[1]) || undefined : undefined;
      const r = await readQuestion(cfg, { text: q0.stem, image, subject, no });
      const q = useStudy.getState().data.questions.find((x) => x.id === id);
      if (!q) return;
      const hadAnswer = !!q.answer;
      const patch = { stem: image && r.stem ? r.stem : q.stem || r.stem, answer: q.answer || r.answer, analysis: q.analysis || r.analysis, points: q.points.length ? q.points : r.points, difficulty: r.difficulty, qtype: q.qtype === '其他' ? r.qtype : q.qtype };
      patchQuestion(id, patch);
      const answer = patch.answer ?? '';
      if (!answer || OPEN.test(patch.qtype ?? '')) return;
      const res = await ai.chat([
        { role: 'system', content: pack.prompt.persona },
        { role: 'user', content: `你是审题老师。${pack.prompt.solve}${no ? onlyNo(no) : ''}\n\n${patch.stem}\n\n输出 JSON：{"issue":"题目有问题时用一句话说明，没有问题写空字符串","answer":"..."}` },
      ], { image, json: true, maxTokens: 1200, temperature: 0, feature: '题库导入自检', ...(image && cfg!.visionModel ? { model: cfg!.visionModel } : {}) });
      const j = looseJSON(res.content) as { answer?: unknown } | null;
      const mine = typeof j?.answer === 'string' ? j.answer.trim().slice(0, 400) : '';
      patchQuestion(id, mine && answersMatch(answer, mine) ? { check: 'ok', checkNote: undefined } : { check: 'mismatch', checkNote: `独立解出的答案是「${mine || '无'}」，和${hadAnswer ? '原卷' : 'AI 给的'}答案「${answer.slice(0, 80)}」对不上` });
    } catch (e) {
      useReading.setState((s) => ({ errors: { ...s.errors, [id]: (e as Error).message } }));
    } finally {
      useReading.setState((s) => ({ ids: s.ids.filter((x) => x !== id) }));
    }
  };
  const queue = [...ids];
  const lane = async () => { for (let id = queue.shift(); id; id = queue.shift()) await one(id); };
  chain = chain.then(() => Promise.all([lane(), lane()])).then(() => {}, () => {});
  return chain;
}
