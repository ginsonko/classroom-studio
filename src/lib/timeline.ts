// 课堂时间线：录课时把换课件、翻页、开黑板、记作答、收题记到录像的 recording.json 里，
// 回放页能按时间跳着看，下课分析录像时也拿它当线索。
import { host } from './host';
import { useStore } from './store';
import { useStudy } from './studyStore';
import { RESULT_NAME } from './studyLogic';
import { useRecording } from './recording';
import { boardPngs } from '../ink/boardExport';
import type { Material, Stroke } from './types';

/** ink（1.7.0）：这一页上有新的书写；同一页一直在写只留一条，t 是最后一笔的时刻，n 是记了几次 */
export interface Chapter { t: number; kind: 'material' | 'page' | 'board' | 'attempt' | 'question' | 'note' | 'ink'; title: string; ref?: string; n?: number }

const post = (c: Omit<Chapter, 't'>) => void host.call('recordChapter', c).catch(() => {});
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

let started = false;
export function startTimeline() {
  if (started || !host.electron || host.role !== 'teacher') return;
  started = true;
  let off: (() => void) | null = null, inked: Map<string, { title: string; strokes: number; at: number }> | null = null, started0 = 0;
  const attach = () => {
    const st = useStore.getState();
    let mat = st.pgmMat.id, page = st.pgm.page;
    let attempts = new Set(useStudy.getState().data.attempts.map((a) => a.id)), questions = new Set(useStudy.getState().data.questions.map((q) => q.id));
    post({ kind: st.pgmMat.kind === 'board' ? 'board' : 'material', title: st.pgmMat.title, ref: st.pgmMat.id });
    const a = useStore.subscribe((s) => {
      if (s.pgmMat.id !== mat) { mat = s.pgmMat.id; page = s.pgm.page; post({ kind: s.pgmMat.kind === 'board' ? 'board' : 'material', title: s.pgmMat.title, ref: s.pgmMat.id }); return; }
      if (s.pgm.page !== page) { page = s.pgm.page; if (s.pgmMat.pages.length > 1) post({ kind: 'page', title: `${s.pgmMat.title} 第 ${page + 1} 页`, ref: `${s.pgmMat.id}#${page}` }); }
    });
    const b = useStudy.subscribe((s) => {
      const d = s.data, names = useStore.getState().students;
      if (d.attempts.length !== attempts.size) {
        for (const x of d.attempts) if (!attempts.has(x.id)) {
          const q = d.questions.find((y) => y.id === x.questionId);
          post({ kind: 'attempt', title: `${names.find((n) => n.id === x.studentId)?.name ?? ''} ${RESULT_NAME[x.result]}：${clip(q?.stem || '题图', 30)}`, ref: x.questionId });
        }
        attempts = new Set(d.attempts.map((x) => x.id));
      }
      if (d.questions.length !== questions.size) {
        for (const q of d.questions) if (!questions.has(q.id) && Date.now() - Date.parse(q.createdAt) < 60000) post({ kind: 'question', title: '收题：' + clip(q.stem || '题图', 30), ref: q.id });
        questions = new Set(d.questions.map((q) => q.id));
      }
    });
    // 1.7.0 书写：哪一页有新的笔迹，攒 2.5 秒报一次（主进程把同一页连着写的并成一条、时间挪到最后一笔）
    inked = new Map();
    let ink = st.ink, dirty = new Set<string>();
    const pub = (xs: Stroke[] | undefined) => (xs ?? []).filter((x) => x.layer !== 'private').length;
    const c = useStore.subscribe((s) => {
      if (s.ink === ink) return;
      for (const k of new Set([...Object.keys(s.ink), ...Object.keys(ink)])) if (s.ink[k] !== ink[k] && pub(s.ink[k]) > 0 && pub(s.ink[k]) !== pub(ink[k])) dirty.add(k);
      ink = s.ink;
    });
    const flush = setInterval(() => {
      if (!dirty.size) return;
      const s = useStore.getState();
      for (const k of dirty) {
        const mat = matOf(k.slice(0, k.lastIndexOf('#'))), page = Number(k.slice(k.lastIndexOf('#') + 1)) || 0;
        const title = `${mat?.title ?? '黑板'}${mat && mat.pages.length > 1 ? ` 第 ${page + 1} 页` : ''}`;
        inked!.set(k, { title, strokes: pub(s.ink[k]), at: Date.now() });
        post({ kind: 'ink', title: '书写：' + title, ref: k });
      }
      dirty = new Set();
    }, 2500);
    off = () => { a(); b(); c(); clearInterval(flush); };
  };
  const sync = (phase: string) => {
    if (phase === 'recording' && !off) { started0 = useRecording.getState().status.startedAt ?? Date.now(); attach(); }
    else if (phase !== 'recording' && off) { off(); off = null; const rid = useRecording.getState().status.id; if (rid && inked?.size) void saveBoards(rid, inked, started0).catch(() => {}); inked = null; }
  };
  sync(useRecording.getState().status.phase);
  useRecording.subscribe((s) => sync(s.status.phase));
}

/** 学生画面里打开着的一项（黑板 / 课件） */
function matOf(id: string): Material | undefined {
  const st = useStore.getState();
  return st.pgmMat.id === id ? st.pgmMat : st.desk.find((w) => w.id === id)?.mat;
}
/**
 * 1.7.0 下课时把这节课写过的黑板页按原始笔迹画成图，存进录像文件夹：下课分析直接看板书原图（比录像截帧清楚、也省钱）。
 * 课件上的批注还是靠录像截帧（课件本身要和笔迹叠在一起看）。
 */
async function saveBoards(rid: string, inked: Map<string, { title: string; strokes: number; at: number }>, startedAt: number) {
  const items: { ref: string; title: string; t: number; strokes: number; png: string }[] = [];
  for (const [k, v] of inked) {
    const mat = matOf(k.slice(0, k.lastIndexOf('#')));
    if (mat?.kind !== 'board') continue;
    const page = Number(k.slice(k.lastIndexOf('#') + 1)) || 0;
    const pngs = await boardPngs(mat, page, 'page').catch(() => [] as string[]);
    pngs.slice(0, 6).forEach((png, i) => items.push({ ref: k, title: v.title + (pngs.length > 1 ? `（第 ${i + 1} 段）` : ''), t: Math.max(0, (v.at - startedAt) / 1000), strokes: v.strokes, png }));
    if (items.length >= 60) break;
  }
  if (items.length) await host.call('recordBoards', { id: rid, items });
}

export const fmtT = (t: number) => { const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), z = (n: number) => String(n).padStart(2, '0'); return (h ? h + ':' + z(m) : String(m)) + ':' + z(s % 60); };
