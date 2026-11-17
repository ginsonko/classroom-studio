// 1.7.0 第 4 项真实验证（花钱，不进 run-all）：拿一节真实录像（H 盘只读拷贝到 I 盘的副本数据里）跑一次下课分析，
// 对比 1.6.0 当时认出的题数；再写课后总结、导出家长版长图。Key 用 .real\data 副本里的配置。
// 用法：CS_DIST=.out/dist-me CS_REAL_REC=<录像文件夹名> npx electron test/quiet.cjs test/v170-real-analysis.cjs
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const REC = process.env.CS_REAL_REC, SRC = process.env.CS_REAL_SRC || 'H:/ClassroomStudioData', REAL = process.env.CS_REAL_DATA || path.resolve(__dirname, '../../.real/data');
const root = process.env.CS_REAL_OUT || path.join(os.tmpdir(), 'cs-real170'), DATA = path.join(root, 'data');
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(path.join(DATA, 'recordings'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'study'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'browser'), { recursive: true }); if (fs.existsSync(path.join(REAL, 'browser', 'Local State'))) fs.copyFileSync(path.join(REAL, 'browser', 'Local State'), path.join(DATA, 'browser', 'Local State'));
for (const f of ['ai.json', 'ai-budget.json', 'ai-ledger.jsonl']) if (fs.existsSync(path.join(REAL, f))) fs.copyFileSync(path.join(REAL, f), path.join(DATA, f));
// 和老师本机一样用 gpt-6-astra（副本里原来是 gpt-6.1-sol），这样和 1.6.0 当时的结果可比
{ const f = path.join(DATA, 'ai.json'), j = JSON.parse(fs.readFileSync(f, 'utf8')); j.model = process.env.CS_REAL_MODEL || 'gpt-6-astra'; fs.writeFileSync(f, JSON.stringify(j, null, 2)); }
const from = path.join(SRC, 'recordings', REC), to = path.join(DATA, 'recordings', REC); fs.mkdirSync(to);
for (const f of ['recording.json', 'transcript.json', '课堂回放.mp4']) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
const meta = JSON.parse(fs.readFileSync(path.join(to, 'recording.json'), 'utf8')), before = meta.analysis; delete meta.analysis; delete meta.after;
fs.writeFileSync(path.join(to, 'recording.json'), JSON.stringify(meta));
const ws = JSON.parse(fs.readFileSync(path.join(SRC, 'workspace.json'), 'utf8'));
const students = (ws.local?.students ?? []).filter((s) => s.id === meta.studentId);
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({ shared: {}, settings: { autoAnalyze: false, autoMap: false, transcribe: false, analysisCap: 2, recordings: path.join(DATA, 'recordings') }, local: { roots: [], students, studentId: meta.studentId, slots: [], learning: {} } }));
fs.writeFileSync(path.join(DATA, 'study', 'study.json'), JSON.stringify({ questions: [], attempts: [], lessons: [], homework: [], notes: [], preps: [], portraits: {}, sorts: [], files: [] }));
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = DATA;
const electron = require('electron'); const { app } = electron;
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw Error('timeout'); };
const timer = setTimeout(() => { console.error('timeout'); app.exit(1); }, 40 * 60000);
(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  teacher.setBounds({ x: -6000, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const T = async (code) => { const r = await teacher.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error(r.__err); return r; };
  await until(() => T('return Q.useStudy.getState().loaded'));
  const LED = path.join(DATA, 'ai-ledger.jsonl'), spent = () => { try { return fs.readFileSync(LED, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l)).reduce((a, e) => a + (Number(e.cny) || 0), 0); } catch { return 0; } }, led0 = spent();
  const t0 = Date.now();
  await T(`await Q.recordAnalysis.analyzeRecording(${JSON.stringify(meta.id)});return true`);
  const row = (await api.recording.list()).find((r) => r.id === meta.id), a = row.analysis;
  const name = students[0]?.name ?? '学生', date = new Date(meta.startedAt); const dk = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  // 写课后总结 + 家长版长图（走软件自己的流程）
  const lesson = await T(`const n=await Q.lessonTools.buildLessonNote({studentId:${JSON.stringify(meta.studentId)},name:${JSON.stringify(name)},date:'${dk}',topic:${JSON.stringify(meta.title || '课堂')},minutes:${Math.round((meta.endedAt - meta.startedAt) / 60000)}});const d=await Q.lessonTools.lessonDocument(n.note,${JSON.stringify(name)},['png','pdf']);return {note:n.note,warning:n.warning,out:d.out,errors:d.errors}`);
  const led1 = spent();
  const report = { record: REC, minutes: Math.round((meta.endedAt - meta.startedAt) / 60000), before: before && { frames: before.frames, questions: before.questions, attempts: before.attempts }, after: { frames: a.frames, pages: a.pages, pagesAll: a.pagesAll, boards: a.boards, questions: a.questions, attempts: a.attempts, error: a.error, summary: a.summary }, lesson: { oneLine: lesson.note.oneLine, summary: lesson.note.summary, covered: lesson.note.covered, pending: lesson.note.pending, parent: lesson.note.parent, out: lesson.out, errors: lesson.errors }, cny: led0 !== null && led1 !== null ? Math.round((led1 - led0) * 100) / 100 : null, seconds: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.join(root, 'report-' + REC.slice(0, 19) + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error(e); clearTimeout(timer); app.exit(1); });
