// 课堂时间线：录课时把换课件、翻页、开黑板、记作答、收题记到录像的 recording.json 里，
// 回放页能按时间跳着看，下课分析录像时也拿它当线索。
import { host } from './host';
import { useStore } from './store';
import { useStudy } from './studyStore';
import { RESULT_NAME } from './studyLogic';
import { useRecording } from './recording';

export interface Chapter { t: number; kind: 'material' | 'page' | 'board' | 'attempt' | 'question' | 'note'; title: string; ref?: string }

const post = (c: Omit<Chapter, 't'>) => void host.call('recordChapter', c).catch(() => {});
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

let started = false;
export function startTimeline() {
  if (started || !host.electron || host.role !== 'teacher') return;
  started = true;
  let off: (() => void) | null = null;
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
    off = () => { a(); b(); };
  };
  const sync = (phase: string) => {
    if (phase === 'recording' && !off) attach();
    else if (phase !== 'recording' && off) { off(); off = null; }
  };
  sync(useRecording.getState().status.phase);
  useRecording.subscribe((s) => sync(s.status.phase));
}

export const fmtT = (t: number) => { const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), z = (n: number) => String(n).padStart(2, '0'); return (h ? h + ':' + z(m) : String(m)) + ':' + z(s % 60); };
