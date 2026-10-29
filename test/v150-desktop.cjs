// 1.5.0 桌面验收（屏幕外窗口，假的 AI 网关，不花钱）：
//   1. 设置：「默认答案全部不遮」启动即生效；「下课后」两个开关能改
//   2. 长黑板 / 普通黑板来回切，回到原来那块，板书还在；在长黑板上再点才新开
//   3. 换学生上课：板书存成 PDF 归到上一位学生名下，课堂清空；可以撤销
//   4. 学生资料卡：看到归档的板书；study.json 在软件外被改后自动重新载入
//   5. 录课时课堂时间线：换课件、记作答记进录像
//   6. 下课按作答更新学习地图，可撤销
//   7. 录像分析：截帧 → 看图模型（两批）→ 题进收件箱（带截图）、记作答、地图往前推、小结进档案；
//      回放页显示结果，一键整批撤销；回放生成后自动分析；设置里关掉就不分析
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v150-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v150-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { answerOff: true },
  local: { roots: [], students: [stu('stu-a', '张三'), stu('stu-b', '李四')], studentId: 'stu-a', slots: [], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const { runProcess } = require('../electron/recording.cjs');
const FFMPEG = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(120); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v150 desktop timed out'); app.exit(1); }, 420000);

// 假网关：录像分析的请求回一份固定的 JSON；别的回一句话
const requests = []; let KEYS = [];
const STEM = '如图所示，闭合线圈从条形磁铁正上方由静止落下，判断线圈中感应电流的方向';
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const parts = Array.isArray(j.messages?.at(-1)?.content) ? j.messages.at(-1).content : [{ type: 'text', text: String(j.messages?.at(-1)?.content ?? '') }];
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n'), imgs = parts.filter((p) => p.type === 'image_url').length;
    let content = '好的';
    if (text.includes('复盘刚上完的一节课')) {
      // 每次分析两批：第一批带小结和薄弱点
      const first = analysisCalls().length % 2 === 1;
      content = JSON.stringify({
        frames: Array.from({ length: imgs }, (_, i) => ({ i, what: '讲电磁感应', points: i === 0 ? [KEYS[1]] : [], questions: i === 0 ? [{ stem: STEM, box: [100, 100, 600, 500], answer: '逆时针', result: 'wrong', points: [KEYS[0]] }] : [] })),
        summary: first ? '这节课讲了楞次定律，学生判断感应电流方向时出错。' : '',
        weak: first ? [KEYS[2]] : [],
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
});
const analysisCalls = () => requests.filter((r) => JSON.stringify(r.messages).includes('复盘刚上完的一节课'));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = async (code) => { try { return await teacher.webContents.executeJavaScript(code); } catch (e) { throw Error('executeJavaScript 失败：' + e.message + '\n' + String(code).slice(0, 240)); } };
  await until(() => call('!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(`(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  // 提示条最多同时留 3 条，全部记下来再查
  await T(`window.__toasts=[];Q.useToast.subscribe(st=>{for(const t of st.list)if(!window.__toasts.includes(t.message))window.__toasts.push(t.message)});return true`);
  const toasts = () => T(`return window.__toasts`);
  await until(() => T(`return Q.useStudy.getState().loaded`), 10000, 'study loaded');
  KEYS = await T(`return Q.studyLogic.pointsOf('physics').slice(0,6).map(p=>p.key)`);
  const cell = (k) => T(`const [ci,si]=${JSON.stringify(k)}.split('.').map(Number);return (Q.useStore.getState().learning['stu-a']||[])[ci]?.[si]??'none'`);

  // ── 1. 设置 ──
  assert.equal(await T(`return s.answerGuard`), false, '「默认答案全部不遮」启动就生效');
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="auto-analyze"]')`), 8000, '设置面板');
  assert.equal(await T(`return document.querySelector('[data-qa="answer-off"]').checked`), true);
  assert.equal(await T(`return document.querySelector('[data-qa="auto-map"]').checked&&document.querySelector('[data-qa="auto-analyze"]').checked`), true, '下课后两个开关默认开');
  await shot('v150-1-settings.png');
  await T(`document.querySelector('[data-qa="auto-analyze"]').click();return true`);
  await until(() => T(`return Q.host.call('settings').then(x=>x.autoAnalyze===false)`), 5000, '关掉自动分析');
  await T(`document.querySelector('[data-qa="auto-analyze"]').click();return true`);
  await until(() => T(`return Q.host.call('settings').then(x=>x.autoAnalyze===true)`), 5000, '再打开');
  await T(`Q.useRecording.setState({panel:false});return true`);
  mark('settings: answers unmasked by default on start; after-class switches persist');

  // ── 2. 长黑板 / 普通黑板来回切 ──
  const stroke = (key, id) => T(`s.addStroke(${key},{id:${JSON.stringify(id)},tool:'pen',color:'#d03030',size:8,author:'teacher',pts:[.2,.2,.5,.5,.4,.5,.8,.3,.5]});return true`);
  await stroke(`Q.inkKey('board',0)`, 'b1');
  await T(`s.toBoard(true);return true`);
  const long1 = await until(() => T(`const st=Q.useStore.getState();return Q.longBoard.isLong(st.pgmMat)&&st.pgmMat.id`), 5000, '开了长黑板');
  await stroke(`Q.inkKey(${JSON.stringify(long1)},0)`, 'l1');
  await T(`Q.useStore.getState().toBoard(false);return true`);
  assert.equal(await T(`return Q.useStore.getState().pgmMat.id`), 'board', '回到普通黑板');
  assert.equal(await T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).length`), 1);
  await T(`Q.useStore.getState().toBoard(true);return true`);
  assert.equal(await T(`return Q.useStore.getState().pgmMat.id`), long1, '回到原来那块长黑板');
  assert.equal(await T(`return (Q.useStore.getState().ink[Q.inkKey(${JSON.stringify(long1)},0)]||[]).length`), 1, '板书还在');
  await T(`Q.useStore.getState().toBoard(true);return true`);
  const long2 = await T(`return Q.useStore.getState().pgmMat.id`);
  assert.ok(long2 !== long1 && (await T(`return Q.longBoard.isLong(Q.useStore.getState().pgmMat)`)), '已在长黑板上再点：新开一块');
  await T(`Q.useStore.getState().toBoard(true);return true`);
  await T(`Q.useStore.getState().toBoard(false);return true`);
  await T(`Q.useStore.getState().toBoard(true);return true`);
  assert.equal(await T(`return Q.useStore.getState().pgmMat.id`), (await T(`return Q.useStore.getState().desk.filter(w=>Q.longBoard.isLong(w.mat)).sort((a,b)=>b.at-a.at)[0].id`)), '回到最近用的那块');
  await T(`Q.useStore.getState().toBoard(false);return true`);
  mark('long / plain board switch returns to the same board with its writing', { long1, long2 });

  // ── 3. 换学生上课：存板书、清空、撤销 ──
  await until(() => T(`return Q.useStore.getState().classOf==='stu-a'`), 3000, '课堂内容记在张三名下');
  await T(`Q.useStore.getState().set({studentId:'stu-b'});return true`);
  assert.equal(await T(`return Q.useStore.getState().classOf`), 'stu-a', '只换学生不改归属');
  await T(`await Q.classReset.clearForLesson();return true`);
  const files = await until(() => T(`const f=(Q.useStudy.getState().data.files||[]).filter(x=>x.studentId==='stu-a'&&x.kind==='board');return f.length>=2&&f`), 15000, '板书归到张三名下');
  for (const f of files) { assert.ok(fs.existsSync(f.path), f.path); assert.equal(fs.readFileSync(f.path).subarray(0, 5).toString(), '%PDF-'); assert.equal(f.via, 'class'); }
  assert.equal(await T(`const st=Q.useStore.getState();return Object.values(st.ink).flat().length+'/'+st.desk.length+'/'+st.pgmMat.id`), '0/1/board', '课堂清空');
  assert.ok((await toasts()).some((t) => /换成了「李四」，课堂已清空，\d 块板书已存到「张三」名下/.test(t)), JSON.stringify(await toasts()));
  await shot('v150-3-cleared.png');
  await T(`Q.classReset.restoreClass();return true`);
  assert.equal(await T(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).length`), 1, '撤销后板书回来');
  assert.ok(await T(`return Q.useStore.getState().desk.some(w=>w.id===${JSON.stringify(long1)})`), '长黑板也回来');
  await T(`Q.useStore.getState().clearDesk();Q.useStore.getState().set({studentId:'stu-a'});return true`);
  mark('switching student archives boards as PDFs to the previous student, clears, and can be undone', { files: files.length });

  // ── 4. 学生资料卡 + 软件外修改 ──
  await T(`Q.useStore.getState().set({page:'students',studentId:'stu-a'});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="student-records"]')`), 8000, '学生资料卡');
  assert.match(await T(`return document.querySelector('[data-qa="records-files"]').innerText`), new RegExp(String(files.length)));
  assert.ok((await T(`return document.querySelectorAll('[data-qa="student-records"] [data-qa="as-file"]').length`)) >= files.length);
  await shot('v150-4-records.png');
  await T(`await Q.flushStudy();return true`);
  await sleep(1200);
  const sj = path.join(DATA, 'study', 'study.json'), d0 = JSON.parse(fs.readFileSync(sj, 'utf8'));
  d0.notes.push({ id: 'ext-1', studentId: 'stu-a', at: new Date().toISOString(), kind: 'teacher', text: '小羽直接写进文件的备注' });
  fs.writeFileSync(sj, JSON.stringify(d0));
  await until(() => T(`return Q.useStudy.getState().data.notes.some(n=>n.id==='ext-1')`), 8000, '外部修改后自动重新载入');
  await T(`document.querySelector('[data-qa="records-notes"]').click();return true`);
  await until(() => T(`return document.querySelector('[data-qa="student-records"]').innerText.includes('小羽直接写进文件的备注')`), 3000, '备注页显示');
  mark('student records show archived boards; study.json changed outside reloads automatically');

  // ── 5. 课堂时间线（主进程里假装在录） ──
  api.recording.current = { id: 'live-1', startedAt: Date.now() - 3000, chapters: [] }; api.recording.status = { ...api.recording.status, phase: 'recording' };
  await T(`Q.useRecording.setState({status:{phase:'recording'}});return true`);
  await sleep(300);
  await T(`Q.useStore.getState().toBoard(true);return true`);
  const q0 = await T(`const q=Q.studyStore.addQuestion({stem:'时间线测试题：求加速度的大小和方向',answer:'',analysis:'',points:[${JSON.stringify(KEYS[3])}],difficulty:2,qtype:'计算',origin:'manual',status:'bank',subject:'physics'});Q.studyStore.recordAttempt('stu-a',q.id,'right');Q.studyStore.recordAttempt('stu-a',q.id,'right');return q.id`);
  await until(() => api.recording.current.chapters.filter((c) => c.kind === 'attempt').length >= 1, 5000, '作答记进时间线');
  const kinds = api.recording.current.chapters.map((c) => c.kind);
  assert.ok(kinds.includes('board') || kinds.includes('material'), JSON.stringify(api.recording.current.chapters));
  assert.ok(api.recording.current.chapters.some((c) => c.kind === 'attempt' && c.title.includes('张三')));
  api.recording.current = null; api.recording.status = { ...api.recording.status, phase: 'idle' };
  await T(`Q.useRecording.setState({status:{phase:'idle'}});Q.useStore.getState().clearDesk();return true`);
  mark('lesson timeline records board / material switches and attempts while recording', { chapters: kinds });

  // ── 6. 下课更新学习地图 + 撤销 ──
  const runs = await T(`return (await Q.mapUpdate.afterClassMap('stu-a',Date.now()-600000)).map(r=>({id:r.id,changes:r.changes.length}))`);
  assert.equal(await cell(KEYS[3]), 'done', '两次都对：未学 → 已掌握');
  assert.ok((await toasts()).some((t) => /学习地图已按这节课的作答更新/.test(t)));
  await T(`Q.mapUpdate.undoMapRun(${JSON.stringify(runs[0].id)});return true`);
  assert.equal(await cell(KEYS[3]), 'none', '撤销');
  await T(`await Q.host.call('setSettings',{autoMap:false});return true`);
  assert.deepEqual(await T(`return (await Q.mapUpdate.afterClassMap('stu-a',Date.now()-600000)).length`), 0, '关了就不动');
  await T(`await Q.host.call('setSettings',{autoMap:true});Q.studyStore.removeQuestions([${JSON.stringify(q0)}]);return true`);
  mark('after class: map advances by attempts, undo restores, setting off skips');

  // ── 7. 录像分析 ──
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  const recDir = api.recording.directory;
  const makeRec = async (id, title, extra = {}) => {
    const folder = path.join(recDir, '2026-01-01-' + id); fs.mkdirSync(folder, { recursive: true });
    await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-t', '600', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(folder, '课堂回放.mp4')], { timeout: 180000 });
    const now = Date.now();
    fs.writeFileSync(path.join(folder, 'recording.json'), JSON.stringify({ id, title, studentId: 'stu-a', createdAt: new Date(now).toISOString(), phase: 'complete', startedAt: now - 600000, endedAt: now, chapters: [{ t: 5, kind: 'material', title: '电磁感应课件' }, { t: 200, kind: 'attempt', title: '张三 错：线圈' }, { t: 400, kind: 'board', title: '课堂黑板' }], ...extra }));
    return folder;
  };
  const f1 = await makeRec('rec-1', '电磁感应');
  const rec = await T(`const r=await Q.recordAnalysis.analyzeRecording('rec-1');return r&&{id:r.id,q:r.questions,a:r.attempts,n:r.notes,map:r.map,recordId:r.recordId,lines:r.lines}`);
  assert.equal(analysisCalls().length, 2, '12 张画面分两批');
  for (const r of analysisCalls()) { assert.equal(r.model, 'fake-vision'); assert.equal(r.messages.at(-1).content.filter((p) => p.type === 'image_url').length, 6); }
  assert.match(JSON.stringify(analysisCalls()[0].messages), /电磁感应课件/, '时间线一起发给模型');
  assert.equal(rec.recordId, 'rec-1');
  assert.equal(rec.q.length, 1, '两批里同一道题只进一次');
  assert.equal(rec.a.length, 1, '同一道题的作答只记一次');
  assert.equal(rec.n.length, 1);
  assert.deepEqual(rec.map.map((c) => c.to).sort(), ['learning', 'learning'], JSON.stringify(rec.map));
  const q1 = await until(() => T(`const q=Q.useStudy.getState().data.questions.find(x=>x.id===${JSON.stringify(rec.q[0])});return q?.image?q:null`), 8000, '题图截好');
  assert.equal(q1.stem, STEM); assert.equal(q1.status, 'inbox'); assert.deepEqual(q1.points, [KEYS[0]]); assert.equal(q1.batch, rec.id);
  assert.ok(fs.existsSync(q1.image), q1.image);
  const att = await T(`return Q.useStudy.getState().data.attempts.find(a=>a.id===${JSON.stringify(rec.a[0])})`);
  assert.equal(att.result, 'wrong'); assert.match(att.note, /录像分析/);
  assert.equal(await cell(KEYS[0]), 'learning'); assert.equal(await cell(KEYS[1]), 'learning');
  const note = await T(`return Q.useStudy.getState().data.notes.find(n=>n.id===${JSON.stringify(rec.n[0])}).text`);
  assert.match(note, /楞次定律/); assert.match(note, /可能还没掌握（只是建议，学习地图没改）/);
  assert.equal(await cell(KEYS[2]), 'none', '薄弱只写建议，不改地图');
  const meta = JSON.parse(fs.readFileSync(path.join(f1, 'recording.json'), 'utf8'));
  assert.equal(meta.analysis.sortId, rec.id); assert.equal(meta.analysis.frames, 12); assert.equal(meta.analysis.questions, 1);
  assert.ok(fs.readdirSync(path.join(f1, 'frames')).length === 12);
  assert.ok((await toasts()).some((t) => /AI 看完了「电磁感应」的录像：1 道题进收件箱、记了 1 条作答、学习地图 2 处/.test(t)), JSON.stringify(await toasts()));
  // 回放页：显示结果，一键撤销
  await T(`Q.useStore.getState().set({page:'replay'});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="rp-analysis-undo"]')`), 8000, '回放页显示分析结果');
  assert.match(await T(`return document.querySelector('[data-qa="rp-analysis"]').innerText`), /AI 看了 12 张画面：1 道题进收件箱、1 条作答、学习地图 2 处/);
  await shot('v150-7-replay-analysis.png');
  await T(`document.querySelector('[data-qa="rp-analysis-undo"]').click();return true`);
  await until(() => T(`return document.querySelector('[data-qa="rp-analysis"]').innerText.includes('已撤销')`), 5000, '标成已撤销');
  assert.equal(await T(`return Q.useStudy.getState().data.questions.some(q=>q.id===${JSON.stringify(rec.q[0])})`), false);
  assert.equal(await T(`return Q.useStudy.getState().data.attempts.some(a=>a.id===${JSON.stringify(rec.a[0])})`), false);
  assert.equal(await T(`return Q.useStudy.getState().data.notes.some(n=>n.id===${JSON.stringify(rec.n[0])})`), false);
  assert.equal(await cell(KEYS[0]), 'none'); assert.equal(await cell(KEYS[1]), 'none');
  assert.ok(await T(`return !!document.querySelector('[data-qa="rp-analyze"]')`), '撤销后可以重新分析');
  mark('recording analysis writes questions / attempts / map / note, shows on the replay page, and undoes as a batch', { frames: 12 });

  // 回放生成后自动分析；设置里关了不分析
  await makeRec('rec-2', '自动分析课');
  const before = analysisCalls().length;
  api.recording.onSaved({ id: 'rec-2', title: '自动分析课', studentId: 'stu-a', path: '' });
  await until(() => JSON.parse(fs.readFileSync(path.join(recDir, '2026-01-01-rec-2', 'recording.json'), 'utf8')).analysis?.sortId, 60000, '自动分析完成');
  assert.equal(analysisCalls().length - before, 2);
  await T(`await Q.host.call('setSettings',{autoAnalyze:false});return true`);
  await makeRec('rec-3', '不分析的课');
  const before3 = analysisCalls().length;
  api.recording.onSaved({ id: 'rec-3', title: '不分析的课', studentId: 'stu-a', path: '' });
  await sleep(3000);
  assert.equal(analysisCalls().length, before3, '关了就不分析');
  assert.equal(JSON.parse(fs.readFileSync(path.join(recDir, '2026-01-01-rec-3', 'recording.json'), 'utf8')).analysis, undefined);
  // 太短的录像、没绑定学生的录像不分析
  await makeRec('rec-4', '误点', { startedAt: Date.now() - 30000, endedAt: Date.now() });
  await assert.rejects(T(`await Q.recordAnalysis.analyzeRecording('rec-4');return true`), /不到 2 分钟/);
  mark('auto analysis after the replay is generated; skipped when the setting is off or the recording is too short');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
})().catch(async (e) => { console.error('FAIL', e.stack || e); if (errors.length) console.error('console: ' + errors.join(' | ')); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } clearTimeout(timer); app.exit(1); });
