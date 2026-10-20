// 课表导入的读文件和识别：Excel / Word / PDF / 文字取出文字，图片交给看图模型；没配 AI 时按规则拆。
import JSZip from 'jszip';
import { ai } from './ai';
import { host } from './host';
import { pdfPageLines } from '../doc/pdf';
import { dateStyleSet, docxText, lessonsByRules, lessonsFromJson, schedulePrompt, sharedStrings, sheetText, type ImportLesson } from '../doc/scheduleImport';
import { aiConfig } from './studyActions';
import { online } from './studyAi';
import { looseJSON } from './studyLogic';

export interface Source { name: string; text: string; image: string }

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const bytes = async (path: string) => { const r = await fetch(host.fileUrl(path)); if (!r.ok) throw new Error('文件读不出来'); return r.arrayBuffer(); };

/** 图片缩到 2000px 宽以内，转成 data URL 发给模型 */
export function imageData(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const k = Math.min(1, 2000 / img.naturalWidth), c = document.createElement('canvas');
      try {
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      } catch (e) { reject(e); } finally { c.width = 0; c.height = 0; }
    };
    img.onerror = () => reject(new Error('图片读不出来，可能已损坏或格式不支持'));
    img.src = url;
  });
}

async function xlsxText(path: string) {
  const zip = await JSZip.loadAsync(await bytes(path));
  const read = (f: string) => zip.file(f)?.async('string') ?? Promise.resolve('');
  const shared = sharedStrings(await read('xl/sharedStrings.xml')), dates = dateStyleSet(await read('xl/styles.xml'));
  const book = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...book.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)].map((m) => ({ name: m[1], file: 'xl/' + (target.get(m[2]) ?? '').replace(/^\/?xl\//, '').replace(/^\//, '') }));
  const list = sheets.length ? sheets : Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort().map((file, i) => ({ name: 'Sheet' + (i + 1), file }));
  const out: string[] = [];
  for (const s of list.slice(0, 6)) {
    const t = sheetText(await read(s.file), shared, dates);
    if (t) out.push((list.length > 1 ? `【${s.name}】\n` : '') + t);
  }
  return out.join('\n\n');
}

/** 一个课表文件 → 文字或图片 */
export async function readSource(path: string, onStep: (t: string) => void = () => {}): Promise<Source> {
  const name = baseName(path), ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
  onStep(`读取：${name}`);
  if (ext === 'xls' || ext === 'et') throw new Error('旧版表格（.xls / .et）请先在 Excel 或 WPS 里「另存为」.xlsx 再导入，或者直接截图粘贴');
  if (['txt', 'md', 'csv'].includes(ext)) return { name, text: await host.call<string>('study.readText', path), image: '' };
  if (ext === 'xlsx') return { name, text: await xlsxText(path), image: '' };
  if (ext === 'docx') {
    const zip = await JSZip.loadAsync(await bytes(path));
    return { name, text: docxText(await zip.file('word/document.xml')?.async('string') ?? ''), image: '' };
  }
  if (/^(png|jpe?g|bmp|webp)$/.test(ext)) return { name, text: '', image: await imageData(host.fileUrl(path)) };
  let pdf = path;
  if (ext !== 'pdf') { onStep(`转换文档：${name}`); const c = await host.convert(path); if (!c.pdf) throw new Error('这份文档没有转换成功，可以另存为 .docx 或截图粘贴'); pdf = c.pdf; }
  const pages = await pdfPageLines(pdf, 6);
  const text = pages.map((p) => p.lines.map((l) => l.t).join('\n')).join('\n').trim();
  if (!text) throw new Error('这份 PDF 是扫描件，没有文字。请截图后粘贴进来，交给 AI 看图识别');
  return { name, text, image: '' };
}

export interface ReadOut { lessons: ImportLesson[]; dropped: number; via: 'ai' | 'rules'; model?: string; note?: string }

/** 配了 AI 交给模型读；没配、或模型没读出课时按规则拆（图片先识别文字） */
export async function readLessons(src: { text: string; image: string }, names: string[], today: Date, onStep: (t: string) => void = () => {}): Promise<ReadOut> {
  const cfg = await aiConfig();
  if (online(cfg)) {
    onStep(src.image ? 'AI 看图识别课表…' : 'AI 识别课表…');
    const r = await ai.chat([
      { role: 'system', content: '你是细心的排课助理，帮一对一辅导老师把已有课表整理成结构化数据。只输出 JSON。' },
      { role: 'user', content: schedulePrompt(today, names, src.text) },
    ], { image: src.image || undefined, json: true, maxTokens: 6000, temperature: 0, feature: '课表导入', ...(src.image && cfg!.visionModel ? { model: cfg!.visionModel } : {}) });
    const got = lessonsFromJson(looseJSON(r.content), today);
    if (got.lessons.length || !src.text) return { ...got, via: 'ai', model: r.model, note: got.lessons.length ? undefined : 'AI 没有从图片里读出课，可以换一张更清楚的截图，或把课表文字粘贴进来' };
  }
  let text = src.text;
  if (!text && src.image) {
    onStep('识别图片文字…');
    const r = await host.call<{ lines: { t?: string }[] }[] | null>('study.ocr', [src.image]).catch(() => null);
    text = (r?.[0]?.lines ?? []).map((l) => l.t ?? '').join('\n');
    if (!text) return { lessons: [], dropped: 0, via: 'rules', note: '没有配置 AI，本机也识别不了图片文字。请在「设置 → AI」配置模型，或把课表文字粘贴进来' };
  }
  const lessons = lessonsByRules(text, names, today);
  return { lessons, dropped: 0, via: 'rules', note: online(cfg) ? 'AI 没有读出课，下面是按规则拆出来的结果' : src.image ? '没有配置 AI，图片按识别出的文字拆分，表格可能读不全；配置 AI 后效果更好' : undefined };
}
