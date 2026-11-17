// AI 工作室写的「…题库.json」→ 待导入的题。纯函数，Node 里可以直接测试。
import { guessType, type Cite } from './studyLogic';
import { packOf, type SubjectId } from './subjects';

export interface BankDraft { stem: string; answer: string; analysis: string; qtype: string; difficulty: number; verified: boolean; cite?: Cite }

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, n) : '');
const STATUS = ['verified', 'unverified', 'unreachable', 'missing', 'skipped', 'original'] as const;
const LABEL: Record<string, string> = { verified: '来源已核对', unverified: '来源未核实', unreachable: '来源未核实', missing: '来源未核实', skipped: '未抽查', original: '原创' };

/** 出处：对象（{ kind, title, no, year, region, url, check }）或一句话；和主进程 sourceCheck.citeOf 同一套规则 */
export function parseCite(raw: unknown): Cite | undefined {
  if (raw == null || raw === '') return undefined;
  const o = (typeof raw === 'string' ? { title: raw } : typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const title = str(o.title ?? o.paper ?? o['卷名'], 300), url = str(o.url ?? o.link ?? o['网址'], 1000);
  const k = str(o.kind ?? o.type ?? o['类别'], 10);
  const kind: Cite['kind'] = /真题|原题|real/.test(k) ? '真题' : /改编|变式|adapted/.test(k) ? '改编' : /原创|自编|original/.test(k) ? '原创'
    : /原创|自编/.test(title) ? '原创' : /改编|变式/.test(title) ? '改编' : title || url ? '真题' : '原创';
  const check = (o.check && typeof o.check === 'object' ? o.check : {}) as Record<string, unknown>;
  const st = STATUS.find((x) => x === check.status);
  // 没经过核对的真题 / 改编一律当「来源未核实」，不能叫真题
  const status = kind === '原创' ? 'original' : st ?? 'unverified';
  const cite: Cite = { kind, status, label: LABEL[status] };
  const put = (key: 'title' | 'no' | 'year' | 'region' | 'url', v: string) => { if (v) cite[key] = v; };
  put('title', title); put('no', str(o.no ?? o.number ?? o['题号'], 40)); put('year', str(o.year ?? o['年份'], 10)); put('region', str(o.region ?? o['地区'], 40)); put('url', url);
  return cite;
}

/** 出处的一行文字：「真题 · 2024 北京海淀 高一上期中 第 7 题 · 来源已核对」 */
export function citeText(c: Cite): string {
  if (c.kind === '原创') return '原创';
  // 卷名里已经写了年份、地区的不再重复
  const t = c.title ?? '', head = [c.year, c.region].filter((v) => v && !t.includes(v));
  return [c.kind, [...head, t, c.no].filter(Boolean).join(' '), c.label].filter(Boolean).join(' · ');
}

/** 宽松读取：字段缺了就补默认值，题型不在本学科清单里时按题干猜 */
export function parseBank(json: unknown, subject: SubjectId): BankDraft[] {
  const list = Array.isArray(json) ? json : (json as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) throw new Error('题库文件里没有 questions 列表');
  const types = packOf(subject).qtypes;
  const out: BankDraft[] = [];
  for (const raw of list.slice(0, 200)) {
    const q = (raw ?? {}) as Record<string, unknown>;
    const stem = str(q.stem, 4000);
    if (stem.length < 4) continue;
    const t = str(q.qtype ?? q.type, 20);
    const d = Math.round(Number(q.difficulty));
    out.push({
      stem, answer: str(q.answer, 2000), analysis: str(q.analysis, 4000),
      qtype: types.includes(t) ? t : guessType(stem, subject),
      difficulty: d >= 1 && d <= 5 ? d : 3,
      verified: q.verified === true,
      ...(parseCite(q.source ?? q.cite ?? q['出处']) ? { cite: parseCite(q.source ?? q.cite ?? q['出处']) } : {}),
    });
  }
  return out;
}
