// 下课自动分析录像：回放生成后按课堂时间线截帧 → 看图模型逐张看 → 自动写进题库、作答、学习地图、学生档案。
// 写进去的东西记成一条整理记录（带 recordId），在回放页或「AI 整理 → 整理记录」里整批撤销。
import { create } from 'zustand';
import { ai } from './ai';
import { host } from './host';
import { useStore } from './store';
import { addQuestion, nowIso, recordAttempt, sid, useStudy } from './studyStore';
import { findDuplicate, guessDifficulty, guessType, looseJSON, mastery, pointLabel, pointsOf, type SortRecord, type StudentNote } from './studyLogic';
import { aiConfig } from './studyActions';
import { online } from './studyAi';
import { mapKey, packOf, studentSubject } from './subjects';
import { isGroup, membersOf } from './groups';
import { applyMap, fullGrid } from './mapLogic';
import { setGrid } from './mapUpdate';
import { BATCH, analysisPrompt, lessonMapPlan, mergeReplies, parseAnalysis, pickFrames, type AnalysisReply } from './recordAnalysisLogic';
import { undoSort } from './sort';
import { toast } from './toast';
import type { RecordAnalysis, RecordRow } from './recording';

/** 正在分析的录像：id → 进度文字 */
export const useRecordAnalysis = create<{ busy: Record<string, string> }>()(() => ({ busy: {} }));
const step = (id: string, text: string | null) => useRecordAnalysis.setState((s) => {
  const busy = { ...s.busy };
  if (text === null) delete busy[id]; else busy[id] = text;
  return { busy };
});

/** 太短的录像（试录、误点）不分析 */
const MIN_SECONDS = 120;
const durationOf = (r: RecordRow) => (r.startedAt && r.endedAt ? (r.endedAt - r.startedAt) / 1000 : 0);

const cropBox = async (url: string, box: [number, number, number, number]) => {
  const img = new Image(); img.src = url; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight, pad = 12;
  const x0 = Math.max(0, Math.floor((box[0] / 1000) * W) - pad), y0 = Math.max(0, Math.floor((box[1] / 1000) * H) - pad);
  const x1 = Math.min(W, Math.ceil((box[2] / 1000) * W) + pad), y1 = Math.min(H, Math.ceil((box[3] / 1000) * H) + pad);
  if (x1 - x0 < 40 || y1 - y0 < 24) return null;
  const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/jpeg', 0.88); } finally { c.width = 0; c.height = 0; }
};

const patch = (id: string, analysis: RecordAnalysis) => host.call('recordPatch', { id, patch: { analysis } }).catch(() => {});

/**
 * 分析一段录像并写入。返回写进去的整理记录（什么都没写时为 null）。
 * 没配 AI、录像还在录 / 太短时报错，调用方决定提不提示。
 */
export async function analyzeRecording(rid: string, o: { auto?: boolean } = {}): Promise<SortRecord | null> {
  if (useRecordAnalysis.getState().busy[rid] !== undefined) throw Error('这段录像正在分析');
  const cfg = await aiConfig();
  if (!online(cfg)) throw Error('还没配 AI：在「设置 → AI」里填好看图模型后再分析');
  const row = (await host.call<RecordRow[]>('recordings')).find((r) => r.id === rid);
  if (!row) throw Error('找不到这段录像');
  if (['starting', 'recording', 'stopping', 'converting'].includes(row.phase)) throw Error('回放还没生成好，等生成完再分析');
  const st = useStore.getState(), who = st.students.find((s) => s.id === row.studentId);
  if (!who) throw Error('这段录像没绑定学生，不知道该记到谁名下');
  const duration = durationOf(row);
  if (duration < MIN_SECONDS) throw Error('录像不到 2 分钟，不用分析');
  const subject = studentSubject(who), pack = packOf(subject), valid = new Set(pointsOf(subject).map((p) => p.key));
  const members = isGroup(who) ? membersOf(who, st.students) : [who];
  const title = row.title || '课堂回放', chapters = row.chapters ?? [];
  step(rid, '正在从录像里截画面');
  try {
    const frames = await host.call<{ t: number; url: string }[]>('recordFrames', { id: rid, times: pickFrames(chapters, duration) });
    if (!frames.length) throw Error('没能从录像里截到画面');
    const replies: AnalysisReply[] = [];
    for (let i = 0; i < frames.length; i += BATCH) {
      const part = frames.slice(i, i + BATCH);
      step(rid, `AI 正在看第 ${i + 1}–${i + part.length} / ${frames.length} 张画面`);
      const r = await ai.chat([{ role: 'user', content: analysisPrompt({ subject, student: who.name, title, chapters, times: part.map((f) => f.t) }) }], {
        images: part.map((f) => f.url), json: true, maxTokens: 6000, temperature: 0, feature: '录像分析', timeout: 5 * 60000, ...(cfg!.visionModel ? { model: cfg!.visionModel } : {}),
      });
      const v = looseJSON(r.content);
      if (!v) throw Error('AI 的回复格式不对');
      replies.push(parseAnalysis(v, part.length, i));
    }
    step(rid, '正在写进题库和学情');
    const res = mergeReplies(replies, valid);
    const rec = write(rid, res, frames, { subject, members: members.map((m) => m.id), group: isGroup(who), title, startedAt: row.startedAt ?? 0 });
    const a: RecordAnalysis = { at: nowIso(), frames: frames.length, questions: rec?.questions.length ?? 0, attempts: rec?.attempts.length ?? 0, map: rec?.map?.length ?? 0, summary: res.summary, weak: res.weak, ...(rec ? { sortId: rec.id } : {}) };
    await patch(rid, a);
    if (rec) {
      const bits = [a.questions ? `${a.questions} 道题进收件箱` : '', a.attempts ? `记了 ${a.attempts} 条作答` : '', a.map ? `学习地图 ${a.map} 处` : '', rec.notes.length ? '课堂小结记进档案' : ''].filter(Boolean);
      toast(`AI 看完了「${title}」的录像：${bits.join('、') || '没认出题目'}${res.weak.length ? `；${res.weak.length} 个知识点可能薄弱，写在档案里` : ''}`, { ms: 20000, action: { label: '撤销', run: () => undoSort(rec.id) } });
    } else if (!o.auto) toast(`AI 看完了「${title}」的录像，没看到能记下来的题目或小结`);
    return rec;
  } catch (e) {
    await patch(rid, { at: nowIso(), frames: 0, questions: 0, attempts: 0, map: 0, summary: '', weak: [], error: (e as Error).message.slice(0, 200) });
    throw e;
  } finally { step(rid, null); }
}

interface WriteCtx { subject: ReturnType<typeof studentSubject>; members: string[]; group: boolean; title: string; startedAt: number }
function write(rid: string, res: AnalysisReply, frames: { t: number; url: string }[], c: WriteCtx): SortRecord | null {
  const rec: SortRecord = { id: sid(), at: nowIso(), title: `录像分析：${c.title}`, studentIds: c.members, lines: [], questions: [], attempts: [], notes: [], unsure: [], map: [], recordId: rid };
  const since = c.startedAt ? c.startedAt - 60000 : 0, practiced = new Map<string, Set<string>>(c.members.map((id) => [id, new Set()]));
  const seen = new Set<string>(res.frames.flatMap((f) => f.points)), pending: Promise<void>[] = [];
  let right = 0, wrong = 0, half = 0;
  for (const f of res.frames) {
    for (const x of f.questions) {
      for (const k of x.points) seen.add(k);
      const d = useStudy.getState().data, dup = findDuplicate(x.stem, d.questions.filter((q) => (q.subject ?? 'physics') === c.subject));
      let qid = dup?.q.id;
      if (!qid) {
        const q = addQuestion({ stem: x.stem, answer: x.answer, analysis: '', points: x.points, difficulty: guessDifficulty(x.stem), qtype: guessType(x.stem, c.subject), source: `${c.title} 录像 ${Math.floor(frames[f.i]?.t ?? 0)} 秒`, origin: 'import', status: 'inbox', subject: c.subject, batch: rec.id });
        qid = q.id; rec.questions.push(q.id);
        const url = frames[f.i]?.url;
        if (url && x.box) pending.push(cropBox(url, x.box).then((img) => img ? host.call<string>('study.image', img) : null).then((image) => {
          if (image) useStudy.getState().update((dd) => ({ ...dd, questions: dd.questions.map((q2) => (q2.id === q.id ? { ...q2, image } : q2)) }));
        }).catch(() => {}));
      }
      // 班组课分不清画面上是谁做的，不记作答
      if (!x.result || c.group) continue;
      const sid0 = c.members[0], done = useStudy.getState().data.attempts.some((a) => a.studentId === sid0 && a.questionId === qid && Date.parse(a.at) >= since);
      if (done) continue;
      rec.attempts.push(recordAttempt(sid0, qid, x.result, '录像分析：按老师的批注').id);
      if (x.result === 'right') right++; else if (x.result === 'wrong') wrong++; else half++;
      for (const k of (useStudy.getState().data.questions.find((q) => q.id === qid)?.points ?? x.points)) practiced.get(sid0)?.add(k);
    }
  }
  // 课上记过的作答也算这节课练到的
  const d = useStudy.getState().data, qs = new Map(d.questions.map((q) => [q.id, q]));
  for (const a of d.attempts) if (practiced.has(a.studentId) && Date.parse(a.at) >= since) for (const k of qs.get(a.questionId)?.points ?? []) practiced.get(a.studentId)!.add(k);
  const pack = packOf(c.subject);
  for (const id of c.members) {
    // 按这节课的学科（班组成员各自的主学科可能不同）
    const key = mapKey(id, c.subject), grid = fullGrid(pack, useStore.getState().learning[key]);
    const plan = lessonMapPlan(pack, grid, mastery(id, useStudy.getState().data, c.subject), practiced.get(id)!, seen);
    if (!plan.apply.length) continue;
    setGrid(key, applyMap(grid, plan.apply));
    rec.map!.push(...plan.apply.map((x) => ({ mapKey: key, ci: x.ci, si: x.si, from: x.from, to: x.to })));
  }
  const weak = res.weak.map((k) => pointLabel(k).split(' · ').pop()).filter(Boolean);
  const text = [res.summary, weak.length ? `可能还没掌握（只是建议，学习地图没改）：${weak.join('、')}` : ''].filter(Boolean).join('\n');
  if (text) for (const id of c.members) {
    const n: StudentNote = { id: sid(), studentId: id, at: nowIso(), kind: 'teacher', text: `课堂录像小结（AI 看了 ${frames.length} 张画面）：\n${text}`, source: `录像分析 · ${c.title}` };
    useStudy.getState().update((dd) => ({ ...dd, notes: [...dd.notes, n] }));
    rec.notes.push(n.id);
  }
  if (!rec.questions.length && !rec.attempts.length && !rec.notes.length && !rec.map!.length) return null;
  const names = c.members.map((id) => useStore.getState().students.find((s) => s.id === id)?.name ?? '').filter(Boolean).join('、');
  rec.lines.push(`${names}：${[rec.questions.length ? `${rec.questions.length} 题进收件箱` : '', right + wrong + half ? `记作答：错 ${wrong} · 半对 ${half} · 对 ${right}` : '', rec.map!.length ? `学习地图 ${rec.map!.length} 处` : '', rec.notes.length ? '课堂小结记进档案' : ''].filter(Boolean).join('；')}`);
  if (res.summary) rec.lines.push(res.summary);
  useStudy.getState().update((dd) => ({ ...dd, sorts: [...(dd.sorts ?? []), rec].slice(-200) }));
  void Promise.all(pending);
  return rec;
}

let started = false;
/** 回放生成好了：设置里开着、配了 AI、还没分析过，就在后台分析 */
export function startRecordAnalysis() {
  if (started || !host.electron || host.role !== 'teacher') return;
  started = true;
  host.onEvent((e) => {
    if (e.type !== 'recordSaved' || !e.record?.id) return;
    const id = String(e.record.id);
    void (async () => {
      const s = await host.call<{ autoAnalyze?: boolean }>('settings').catch(() => null);
      if (s?.autoAnalyze === false || !online(await aiConfig())) return;
      const row = (await host.call<RecordRow[]>('recordings').catch(() => [] as RecordRow[])).find((r) => r.id === id);
      if (!row || row.analysis || durationOf(row) < MIN_SECONDS || !useStore.getState().students.some((x) => x.id === row.studentId)) return;
      await analyzeRecording(id, { auto: true });
    })().catch((err) => toast('录像分析没做完：' + (err as Error).message, { ms: 12000, action: { label: '重试', run: () => void analyzeRecording(id).catch((x) => toast('录像分析没做完：' + (x as Error).message)) } }));
  });
}
