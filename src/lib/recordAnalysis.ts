// 下课自动分析录像：回放生成后按课堂时间线截帧 → 看图模型逐张看 →（有课堂原话时）文字模型听一遍逐题判断 →
// 自动写进题库、作答、学习地图、学生档案。拿不准的放进「待确认」，老师点一下再记。
// 写进去的东西记成一条整理记录（带 recordId），在回放页或「AI 整理 → 整理记录」里整批撤销。
import { create } from 'zustand';
import { ai } from './ai';
import { host } from './host';
import { useStore } from './store';
import { addQuestion, nowIso, recordAttempt, sid, useStudy } from './studyStore';
import { findDuplicate, guessDifficulty, guessType, levelText, looseJSON, mastery, pointLabel, pointsOf, resultOfLevel, type Result, type SortRecord, type StudentNote, type UnsureItem } from './studyLogic';
import { aiConfig } from './studyActions';
import { online } from './studyAi';
import { mapKey, packOf, studentSubject } from './subjects';
import { isGroup, membersOf } from './groups';
import { applyMap, fullGrid } from './mapLogic';
import { setGrid } from './mapUpdate';
import { BATCH, MAX_FRAMES, MAX_FRAMES_VOICE, analysisPrompt, lessonMapPlan, mergeReplies, parseAnalysis, pickFrames, type AnalysisReply } from './recordAnalysisLogic';
import { decide, fineNote, finePrompt, fineTokens, frameDigest, manualDigest, MIN_LINES, MODE_NAME, parseFine, talkMarks, transcriptText, visionTokens, type FineReply } from './fineLogic';
import { asrApi, useAsr } from './asr';
import { undoSort } from './sort';
import { toast } from './toast';
import type { Transcript } from './transcript';
import type { Chapter } from './timeline';
import type { RecordAnalysis, RecordItem, RecordRow } from './recording';

/** 正在分析的录像：id → 进度文字 */
export const useRecordAnalysis = create<{ busy: Record<string, string> }>()(() => ({ busy: {} }));
const step = (id: string, text: string | null) => useRecordAnalysis.setState((s) => {
  const busy = { ...s.busy };
  if (text === null) delete busy[id]; else busy[id] = text;
  return { busy };
});

/** 太短的录像（试录、误点）不分析 */
const MIN_SECONDS = 120;
/** 单节课花费上限（元），设置里能改 */
export const DEFAULT_CAP = 2;
const durationOf = (r: RecordRow) => (r.startedAt && r.endedAt ? (r.endedAt - r.startedAt) / 1000 : 0);
const mmss = (t: number) => { const s = Math.max(0, Math.floor(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const dateOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

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
/** 估价（元）；没有账本或价格表时返回 null，不拦 */
const estimate = (v: { input: number; output: number }, t: { input: number; output: number }) => host.call<{ cny: number } | null>('ai.estimate', { vision: v, text: t }).then((r) => (r && Number.isFinite(r.cny) ? r.cny : null), () => null);
const evenly = <T,>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / Math.max(1, n - 1))]));

interface Settings { autoAnalyze?: boolean; transcribe?: boolean; voiceTrack?: boolean; analysisCap?: number }
const settingsNow = () => host.call<Settings>('settings').catch(() => ({} as Settings));

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
  const subject = studentSubject(who), valid = new Set(pointsOf(subject).map((p) => p.key));
  const members = isGroup(who) ? membersOf(who, st.students) : [who];
  const title = row.title || '课堂回放', chapters = row.chapters ?? [];
  const settings = await settingsNow(), cap = typeof settings.analysisCap === 'number' && settings.analysisCap > 0 ? settings.analysisCap : DEFAULT_CAP;
  step(rid, '正在读课堂原话');
  try {
    const tr = row.transcript?.phase === 'done' ? await asrApi.transcript(rid).catch(() => null) : null;
    const segs = tr?.segments ?? [], voice = segs.length >= MIN_LINES;
    let times = pickFrames(chapters, duration, voice ? MAX_FRAMES_VOICE : MAX_FRAMES, voice ? talkMarks(segs) : []);
    const vcost = await estimate(visionTokens(times.length, BATCH), { input: 0, output: 0 });
    // 看图模型很贵时少截几张，最少 4 张；还超就不做
    if (vcost !== null && vcost > cap) {
      const n = Math.floor((times.length * cap) / vcost);
      if (n < 4) throw Error(`按现在的看图模型价格，看一遍录像约 ¥${vcost.toFixed(2)}，超过单节课上限 ¥${cap}`);
      times = evenly(times, n);
    }
    step(rid, '正在从录像里截画面');
    const frames = await host.call<{ t: number; url: string }[]>('recordFrames', { id: rid, times });
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
    const res = mergeReplies(replies, valid);
    const ctx: WriteCtx = { rid, subject, members: members.map((m) => ({ id: m.id, name: m.name })), group: isGroup(who) ? who.id : null, title, startedAt: row.startedAt ?? 0, endedAt: row.endedAt ?? 0 };
    // 课后精析：有课堂原话才做；出错或超过上限只做画面分析，不整个失败
    let fine: FineCtx | null = null, fineSkip = '';
    const asr = useAsr.getState().state;
    if (!tr) fineSkip = row.transcript?.phase === 'error' ? '课堂原话没转成文字' : asr && (asr.current?.id === rid || asr.queue.includes(rid)) ? '课堂原话还没转完' : settings.transcribe === false ? '没开课后语音转写' : '还没有课堂原话';
    else if (!voice) fineSkip = '课堂原话太少（不到 12 句）';
    else {
      step(rid, 'AI 正在听课堂原话、逐题判断');
      try { const f = await runFine(tr, res, frames, ctx, { subject, who: who.name, chapters, duration, valid, cap: vcost === null ? null : cap - vcost }); if (typeof f === 'string') fineSkip = f; else fine = f; }
      catch (e) { fineSkip = 'AI 精析没做完：' + (e as Error).message.slice(0, 80); }
    }
    step(rid, '正在写进题库和学情');
    const out = write(res, frames, ctx, fine);
    const rec = out.rec;
    const a: RecordAnalysis = {
      at: nowIso(), frames: frames.length, questions: rec?.questions.length ?? 0, attempts: rec?.attempts.length ?? 0, map: rec?.map?.length ?? 0,
      summary: fine?.reply.summary || res.summary, weak: res.weak, ...(rec ? { sortId: rec.id } : {}),
      ...(fine ? { voice: fine.lines, pending: rec?.unsure.length ?? 0, taught: rec?.taught?.length ?? 0, segments: fine.reply.segments.map((s) => ({ t0: s.t0, t1: s.t1, kind: s.kind, title: s.title })), items: out.items } : {}),
      ...(fineSkip ? { fineSkip } : {}),
    };
    await patch(rid, a);
    if (rec) {
      const pending = rec.unsure.length;
      const bits = [a.questions ? `${a.questions} 道题进收件箱` : '', a.attempts ? `记了 ${a.attempts} 条作答` : '', a.map ? `学习地图 ${a.map} 处` : '', rec.notes.length ? '课堂小结记进档案' : ''].filter(Boolean);
      const head = fine ? `AI 听完、看完了「${title}」` : `AI 看完了「${title}」的录像`;
      toast(`${head}：${bits.join('、') || '没认出题目'}${pending ? `；${pending} 道拿不准，需要你看一眼` : ''}${!fine && res.weak.length ? `；${res.weak.length} 个知识点可能薄弱，写在档案里` : ''}`, {
        ms: 20000, action: pending ? { label: '去确认', run: () => useStore.getState().set({ page: 'replay' }) } : { label: '撤销', run: () => undoSort(rec.id) },
      });
    } else if (!o.auto) toast(`AI 看完了「${title}」的录像，没看到能记下来的题目或小结`);
    return rec;
  } catch (e) {
    await patch(rid, { at: nowIso(), frames: 0, questions: 0, attempts: 0, map: 0, summary: '', weak: [], error: (e as Error).message.slice(0, 200) });
    throw e;
  } finally { step(rid, null); }
}

interface FineCtx { reply: FineReply; lines: number; frameRefs: Map<string, { frame: number; q: number }>; manualRefs: Map<string, { attemptId: string; questionId: string }> }

/** 老师课上自己点的作答（不是 AI 记的）：这节课时间里、这几位学生的 */
const manualIn = (c: WriteCtx) => {
  const ids = new Set([...c.members.map((m) => m.id), ...(c.group ? [c.group] : [])]), since = c.startedAt - 60000, until = (c.endedAt || Date.now()) + 60000;
  return useStudy.getState().data.attempts.filter((a) => ids.has(a.studentId) && a.via !== 'replay' && Date.parse(a.at) >= since && Date.parse(a.at) <= until);
};

/** 文字模型听一遍：返回结果，或者没做的原因 */
async function runFine(tr: Transcript, res: AnalysisReply, frames: { t: number }[], c: WriteCtx, o: { subject: WriteCtx['subject']; who: string; chapters: Chapter[]; duration: number; valid: Set<string>; cap: number | null }): Promise<FineCtx | string> {
  const d = useStudy.getState().data, qs = new Map(d.questions.map((q) => [q.id, q]));
  const fd = frameDigest(res.frames, frames.map((f) => f.t));
  const manual = manualIn(c).sort((a, b) => a.at.localeCompare(b.at));
  const md = manualDigest(manual.map((a) => ({ attemptId: a.id, questionId: a.questionId, studentId: a.studentId, name: c.members.find((m) => m.id === a.studentId)?.name ?? '班组', t: (Date.parse(a.at) - c.startedAt) / 1000, stem: qs.get(a.questionId)?.stem ?? '', result: a.result })));
  const target = c.group ?? c.members[0].id, ms = mastery(target, d, o.subject);
  const seen = new Set(res.frames.flatMap((f) => [...f.points, ...f.questions.flatMap((q) => q.points)]));
  const weakest = [...ms.values()].sort((a, b) => a.score - b.score).slice(0, 8).map((m) => m.key);
  const mastLines = [...new Set([...seen, ...weakest])].filter((k) => ms.has(k)).slice(0, 20).map((k) => { const m = ms.get(k)!; return `${k} ${pointLabel(k)}：${levelText(m.level)}（做过 ${m.n} 次）`; }).join('\n');
  const day = dateOf(c.startedAt), prep = d.preps.filter((p) => (p.studentId === target || c.members.some((m) => m.id === p.studentId)) && p.date === day).sort((a, b) => b.at.localeCompare(a.at))[0];
  const base = {
    subject: o.subject, student: o.who, members: c.members.map((m) => m.name), group: !!c.group, title: c.title, minutes: Math.round(o.duration / 60), chapters: o.chapters,
    split: tr.split, frames: fd.text, manual: md.text, mastery: mastLines, points: pointsOf(o.subject).map((p) => `${p.key} ${p.ch}·${p.sec}`).join('\n'),
    ...(prep ? { prep: `${prep.topic}；打算讲的知识点：${prep.points.map(pointLabel).join('、') || '没写'}` } : {}),
  };
  let prompt = '', lines = 0;
  for (const budget of [16000, 8000, 4000]) {
    const t = transcriptText(tr.segments, budget);
    prompt = finePrompt({ ...base, transcript: t.text }); lines = t.lines;
    if (o.cap === null) break;
    const cny = await estimate({ input: 0, output: 0 }, fineTokens(prompt.length));
    if (cny === null || cny <= o.cap) break;
    if (budget === 4000) return `超过单节课花费上限，只看了画面`;
  }
  const r = await ai.chat([{ role: 'user', content: prompt }], { json: true, maxTokens: 8000, temperature: 0, feature: '课后精析', timeout: 5 * 60000 });
  const v = looseJSON(r.content);
  if (!v) throw Error('AI 的回复格式不对');
  const refs = new Set([...fd.refs.map((x) => x.ref), ...md.refs.map((x) => x.ref)]);
  return {
    reply: parseFine(v, { duration: o.duration, valid: o.valid, refs }), lines,
    frameRefs: new Map(fd.refs.map((x) => [x.ref, { frame: x.frame, q: x.q }])), manualRefs: new Map(md.refs.map((x) => [x.ref, { attemptId: x.attemptId, questionId: x.questionId }])),
  };
}

interface WriteCtx { rid: string; subject: ReturnType<typeof studentSubject>; members: { id: string; name: string }[]; group: string | null; title: string; startedAt: number; endedAt: number }
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

function write(res: AnalysisReply, frames: { t: number; url: string }[], c: WriteCtx, fine: FineCtx | null): { rec: SortRecord | null; items: RecordItem[] } {
  const ids = c.members.map((m) => m.id);
  const rec: SortRecord = { id: sid(), at: nowIso(), title: `录像分析：${c.title}`, studentIds: ids, lines: [], questions: [], attempts: [], notes: [], unsure: [], map: [], recordId: c.rid, ...(fine ? { taught: [], enriched: [] } : {}) };
  const since = c.startedAt ? c.startedAt - 60000 : 0, practiced = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const seen = new Set<string>(res.frames.flatMap((f) => f.points)), pending: Promise<void>[] = [], items: RecordItem[] = [];
  const tally = { right: 0, wrong: 0, half: 0 };
  const qOf = (id: string) => useStudy.getState().data.questions.find((q) => q.id === id);
  const done = (studentId: string, qid: string) => useStudy.getState().data.attempts.some((a) => a.studentId === studentId && a.questionId === qid && Date.parse(a.at) >= since);
  const practice = (studentId: string, qid: string, fallback: string[]) => { for (const k of qOf(qid)?.points ?? fallback) practiced.get(studentId)?.add(k); };
  const atOf = (t: number) => (c.startedAt ? new Date(c.startedAt + t * 1000).toISOString() : nowIso());
  // 画面上的题进收件箱（和已有题重复的挂到原题上）
  const frameQ = new Map<string, string>();
  for (const f of res.frames) {
    f.questions.forEach((x, k) => {
      for (const p of x.points) seen.add(p);
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
      frameQ.set(`${f.i}:${k}`, qid);
    });
  }
  // 课后精析逐题写
  const covered = new Set<string>();
  if (fine) {
    const manual = new Map([...fine.manualRefs].map(([ref, m]) => [ref, m.attemptId]));
    for (const x of fine.reply.items) {
      const fr = x.ref ? fine.frameRefs.get(x.ref) : undefined, mr = x.ref ? fine.manualRefs.get(x.ref) : undefined;
      if (fr) covered.add(`${fr.frame}:${fr.q}`);
      let qid = fr ? frameQ.get(`${fr.frame}:${fr.q}`) : mr?.questionId;
      // 口头出的题：题干够完整才进收件箱
      if (!qid && x.stem.replace(/\s+/g, '').length >= 12) {
        const d = useStudy.getState().data, dup = findDuplicate(x.stem, d.questions.filter((q) => (q.subject ?? 'physics') === c.subject));
        qid = dup?.q.id;
        if (!qid) {
          const q = addQuestion({ stem: x.stem, answer: '', analysis: '', points: x.points, difficulty: guessDifficulty(x.stem), qtype: guessType(x.stem, c.subject), source: `${c.title} 课堂原话 ${mmss(x.t0)}`, origin: 'import', status: 'inbox', subject: c.subject, batch: rec.id });
          qid = q.id; rec.questions.push(q.id);
        }
      }
      const dec = decide(x, { members: c.members, group: c.group, manual });
      const item: RecordItem = { t0: x.t0, t1: x.t1, stem: clip(x.stem || (qid ? qOf(qid)?.stem ?? '' : ''), 80), mode: x.mode, result: x.result, level: x.level, conf: x.conf, ...(qid ? { questionId: qid } : {}), state: 'skip' };
      items.push(item);
      for (const k of x.points) seen.add(k);
      if (!qid) continue;
      const mode = x.mode === 'teacher_demo' ? undefined : x.mode;
      const extra = { conf: x.conf, via: 'replay' as const, recordId: c.rid, t: x.t1, at: atOf(x.t1), ...(mode ? { mode } : {}), ...(x.hints !== null ? { hints: x.hints } : {}), ...(x.misconception ? { misconception: x.misconception } : {}), evidence: x.evidence };
      if (dec.kind === 'taught') { if (!rec.taught!.includes(qid)) rec.taught!.push(qid); item.state = 'taught'; continue; }
      if (dec.kind === 'enrich') {
        item.state = 'teacher';
        const a = useStudy.getState().data.attempts.find((y) => y.id === dec.attemptId);
        if (a && !a.evidence?.length) {
          useStudy.getState().update((dd) => ({ ...dd, attempts: dd.attempts.map((y) => (y.id === a.id ? { ...y, evidence: x.evidence, recordId: c.rid, t: x.t1 } : y)) }));
          rec.enriched!.push(a.id);
        }
        continue;
      }
      if (dec.kind === 'skip') { if (mr) item.state = 'teacher'; continue; }
      if (done(dec.studentId, qid)) { item.state = 'teacher'; continue; }
      if (dec.kind === 'unsure') {
        if (rec.unsure.some((u) => u.questionId === qid && u.studentId === dec.studentId)) continue;
        const u: UnsureItem = { questionId: qid, studentId: dec.studentId, result: dec.result, level: dec.level, conf: x.conf, t: x.t1, at: atOf(x.t1), why: dec.why, evidence: x.evidence, recordId: c.rid, ...(mode ? { mode } : {}), ...(x.misconception ? { misconception: x.misconception } : {}), ...(x.hints !== null ? { hints: x.hints } : {}) };
        rec.unsure.push(u); item.state = 'pending';
        continue;
      }
      rec.attempts.push(recordAttempt(dec.studentId, qid, dec.result, `课后精析：${MODE_NAME[x.mode]}，${levelText(dec.level)}`, { ...extra, level: dec.level }).id);
      tally[dec.result]++; item.state = 'written';
      practice(dec.studentId, qid, x.points);
    }
  }
  // 精析没提到的题：画面上看得出老师批改的照旧记（班组课分不清是谁做的，不记）
  if (!c.group) for (const f of res.frames) f.questions.forEach((x, k) => {
    const qid = frameQ.get(`${f.i}:${k}`), sid0 = ids[0];
    if (!qid || !x.result || covered.has(`${f.i}:${k}`) || done(sid0, qid)) return;
    rec.attempts.push(recordAttempt(sid0, qid, x.result, '录像分析：按老师的批注', { via: 'replay', recordId: c.rid, t: frames[f.i]?.t ?? 0 }).id);
    tally[x.result]++;
    practice(sid0, qid, x.points);
  });
  // 课上记过的作答也算这节课练到的
  const d = useStudy.getState().data, qs = new Map(d.questions.map((q) => [q.id, q]));
  for (const a of d.attempts) if (practiced.has(a.studentId) && Date.parse(a.at) >= since) for (const k of qs.get(a.questionId)?.points ?? []) practiced.get(a.studentId)!.add(k);
  const pack = packOf(c.subject);
  for (const id of ids) {
    // 按这节课的学科（班组成员各自的主学科可能不同）
    const key = mapKey(id, c.subject), grid = fullGrid(pack, useStore.getState().learning[key]);
    const plan = lessonMapPlan(pack, grid, mastery(id, useStudy.getState().data, c.subject), practiced.get(id)!, seen);
    if (!plan.apply.length) continue;
    setGrid(key, applyMap(grid, plan.apply));
    rec.map!.push(...plan.apply.map((x) => ({ mapKey: key, ci: x.ci, si: x.si, from: x.from, to: x.to })));
  }
  const text = fine ? fineNote(fine.reply) : visionNote(res);
  const head = fine ? `课堂精析（AI 听了 ${fine.lines} 句课堂原话、看了 ${frames.length} 张画面）` : `课堂录像小结（AI 看了 ${frames.length} 张画面）`;
  const addNote = (n: Omit<StudentNote, 'id' | 'at'>) => { const x: StudentNote = { id: sid(), at: nowIso(), ...n }; useStudy.getState().update((dd) => ({ ...dd, notes: [...dd.notes, x] })); rec.notes.push(x.id); };
  if (text) for (const id of ids) addNote({ studentId: id, kind: 'teacher', text: `${head}：\n${text}`, source: `录像分析 · ${c.title}` });
  // 老师课上说「下节课再练」：记成待办，备课时会看到
  for (const t of fine?.reply.todo ?? []) for (const id of ids) addNote({ studentId: id, kind: 'teacher', text: `下节课：${t.text}（课上 ${mmss(t.t)} 说的）`, source: `录像分析 · ${c.title}`, todo: 'practice' });
  if (!rec.questions.length && !rec.attempts.length && !rec.notes.length && !rec.map!.length && !rec.unsure.length) return { rec: null, items };
  const names = c.members.map((m) => m.name).filter(Boolean).join('、'), n = tally.right + tally.wrong + tally.half;
  rec.lines.push(`${names}：${[rec.questions.length ? `${rec.questions.length} 题进收件箱` : '', n ? `记作答：错 ${tally.wrong} · 半对 ${tally.half} · 对 ${tally.right}` : '', rec.unsure.length ? `${rec.unsure.length} 道拿不准，等你确认` : '', rec.taught?.length ? `老师讲的例题 ${rec.taught.length} 道（只算讲过）` : '', rec.map!.length ? `学习地图 ${rec.map!.length} 处` : '', rec.notes.length ? '课堂小结记进档案' : ''].filter(Boolean).join('；')}`);
  const summary = fine?.reply.summary || res.summary;
  if (summary) rec.lines.push(summary);
  useStudy.getState().update((dd) => ({ ...dd, sorts: [...(dd.sorts ?? []), rec].slice(-200) }));
  void Promise.all(pending);
  return { rec, items };
}

function visionNote(res: AnalysisReply): string {
  const weak = res.weak.map((k) => pointLabel(k).split(' · ').pop()).filter(Boolean).join('、');
  return [res.summary, weak ? `可能还没掌握（只是建议，学习地图没改）：${weak}` : ''].filter(Boolean).join('\n');
}
/** 这次分析给这道题记的作答（回放页上改对错用） */
export function analysisAttempt(sortId: string, questionId: string) {
  const d = useStudy.getState().data, rec = (d.sorts ?? []).find((x) => x.id === sortId);
  if (!rec || rec.undone) return null;
  const mine = new Set(rec.attempts);
  return d.attempts.find((a) => mine.has(a.id) && a.questionId === questionId) ?? null;
}
/** 老师在回放页改了 AI 的判断：对错和几成把握以老师为准；几成把握和对错对不上时去掉 */
export function correctAttempt(id: string, result: Result, level?: number) {
  useStudy.getState().update((d) => ({ ...d, attempts: d.attempts.map((a) => {
    if (a.id !== id) return a;
    const { level: old, ...rest } = a;
    const keep = level ?? (typeof old === 'number' && resultOfLevel(old) === result ? old : undefined);
    return { ...rest, result, via: 'teacher' as const, ...(keep !== undefined ? { level: keep } : {}) };
  }) }));
}

let started = false;
/** 从头到尾都没有声音和操作、被自动下课的录像（多半是课没上）：不自动花钱分析，老师需要时在回放页手动点 */
export const quietRecords = new Set<string>();
/**
 * 回放生成好了：设置里开着、配了 AI、还没分析过，就在后台分析。
 * 开着课后语音转写、语音组件也装好了时，先等课堂原话转完（asrDone）再分析，这样能听着原话逐题判断。
 */
export function startRecordAnalysis() {
  if (started || !host.electron || host.role !== 'teacher') return;
  started = true;
  const auto = (id: string) => void (async () => {
    if (quietRecords.has(id)) return;
    const s = await settingsNow();
    if (s.autoAnalyze === false || !online(await aiConfig())) return;
    const row = (await host.call<RecordRow[]>('recordings').catch(() => [] as RecordRow[])).find((r) => r.id === id);
    if (!row || row.analysis || row.phase !== 'complete' || durationOf(row) < MIN_SECONDS || !useStore.getState().students.some((x) => x.id === row.studentId)) return;
    if (useRecordAnalysis.getState().busy[id] !== undefined) return;
    await analyzeRecording(id, { auto: true });
  })().catch((err) => toast('录像分析没做完：' + (err as Error).message, { ms: 12000, action: { label: '重试', run: () => void analyzeRecording(id).catch((x) => toast('录像分析没做完：' + (x as Error).message)) } }));
  // 下课后没等分析做完就关了软件：再打开时把最近 3 小时下课、还没分析的补上（转写还在排队的等 asrDone）
  setTimeout(() => void (async () => {
    const [rows, st] = await Promise.all([host.call<RecordRow[]>('recordings').catch(() => [] as RecordRow[]), asrApi.state().catch(() => null)]);
    for (const r of rows) {
      if (r.analysis || r.phase !== 'complete' || !r.endedAt || Date.now() - r.endedAt > 3 * 3600000) continue;
      if (st && (st.current?.id === r.id || st.queue.includes(r.id))) continue;
      auto(r.id);
    }
  })(), host.test ? 3_600_000 : 120_000);
  host.onEvent((e) => {
    if (e.type === 'asrDone' && e.record?.id) { auto(String(e.record.id)); return; }
    if (e.type !== 'recordSaved' || !e.record?.id) return;
    const id = String(e.record.id);
    // 主进程收到同一个「回放生成好了」后决定转不转写；等它排上队再看
    setTimeout(() => void (async () => {
      const st = await asrApi.state().catch(() => null);
      if (st && (st.current?.id === id || st.queue.includes(id))) return;
      auto(id);
    })(), 3000);
  });
}
