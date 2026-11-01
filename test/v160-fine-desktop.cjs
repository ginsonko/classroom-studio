// 1.6.0 课后学情精析桌面验收（屏幕外窗口，假的 AI 网关，不花钱）：
//   1. 有课堂原话的录像：看图模型看画面 → 文字模型听原话逐题判断；
//      把握高的直接记作答（带几成把握、证据、录像那一刻的时间），拿不准的进「待确认」，老师讲的例题只算讲过，
//      老师课上手点的作答不改对错、只补证据；档案里有课堂精析和「下节课再练」
//   2. 回放页：显示听了几句原话、待确认卡片（证据、按 AI 的记）；整批撤销连老师确认的一起撤，手点的作答只去掉证据
//   3. 转写完（asrDone）自动分析；没有原话的照旧只看画面，并写明原因
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v160-fine-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v160-fine-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高一', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  settings: { autoMap: false, autoRec: { start: false, idle: false } },
  local: { roots: [], students: [stu('stu-a', '张三')], studentId: 'stu-a', slots: [], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const { runProcess } = require('../electron/recording.cjs');
const FFMPEG = process.env.CS_FFMPEG || path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(120); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v160 fine desktop timed out'); app.exit(1); }, 480000);

const STEM1 = '甲车以 10 m/s 匀速行驶，乙车从静止开始以 2 m/s² 的加速度追赶，求追上前两车的最大距离';
const STEM2 = '一物体从 45 m 高处自由下落，求它落地前最后 1 s 内的位移（g 取 10 m/s²）';
const ORAL = '老师口头出题：汽车以 20 m/s 刹车，加速度大小 5 m/s²，求 6 s 内的位移';
const requests = []; let KEYS = []; let visionInRun = 0;
const isFine = (j) => JSON.stringify(j.messages).includes('【课堂原话】');
const isVision = (j) => !isFine(j) && JSON.stringify(j.messages).includes('复盘刚上完的一节课');
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const parts = Array.isArray(j.messages?.at(-1)?.content) ? j.messages.at(-1).content : [{ type: 'text', text: String(j.messages?.at(-1)?.content ?? '') }];
    const imgs = parts.filter((p) => p.type === 'image_url').length;
    let content = '好的';
    if (isVision(j)) {
      const first = visionInRun++ === 0;
      content = JSON.stringify({
        frames: Array.from({ length: imgs }, (_, i) => ({ i, what: '讲追及和自由落体', points: [], questions: first && i === 0 ? [{ stem: STEM1, box: null, answer: '', result: 'none', points: [KEYS[0]] }] : first && i === 1 ? [{ stem: STEM2, box: null, answer: '', result: 'none', points: [KEYS[1]] }] : [] })),
        summary: '画面上讲了追及问题和自由落体。', weak: [],
      });
    } else if (isFine(j)) {
      content = JSON.stringify({
        segments: [{ t0: 0, t1: 120, kind: 'lecture', title: '复习匀变速公式', points: [KEYS[0]] }, { t0: 120, t1: 300, kind: 'practice', title: '学生做追及题', points: [KEYS[0]] }, { t0: 300, t1: 320, kind: 'chat', title: '调麦克风', points: [] }],
        questions: [
          { ref: 'Q1', t0: 120, t1: 260, mode: 'guided', result: 'right', level: 7, conf: 0.9, hints: 1, selfFixed: true, misconception: '', evidence: [{ t: 245, who: 'student', text: '速度相等的时候距离最大，是 25 米' }], points: [KEYS[0]] },
          { ref: 'Q2', t0: 330, t1: 420, mode: 'student_solo', result: 'wrong', level: 3, conf: 0.6, hints: 0, misconception: '把最后 1 秒当成了第 1 秒', evidence: [{ t: 400, who: 'student', text: '是 5 米吧' }], points: [KEYS[1]] },
          { ref: 'A1', t0: 90, t1: 110, mode: 'student_solo', result: 'wrong', level: 2, conf: 0.9, evidence: [{ t: 100, who: 'student', text: '加速度是 2' }], points: [] },
          { ref: null, stem: ORAL, t0: 450, t1: 520, mode: 'teacher_demo', result: 'none', conf: 0.9, evidence: [{ t: 460, who: 'teacher', text: '注意先算停下来的时间' }], points: [KEYS[2]] },
        ],
        points: [{ key: KEYS[0], level: 7, trend: 'up', why: '提示一次后自己找到临界条件' }, { key: KEYS[1], level: 3, trend: 'same', why: '最后 1 秒的位移没想清楚' }],
        summary: '这节课练了追及问题，学生在提示下找到了速度相等的临界条件；自由落体最后 1 秒的位移还不会。',
        stuck: ['自由落体最后 1 秒的位移'], todo: [{ text: '自由落体最后 1 秒的题再练一次', t: 560 }], quotes: [{ t: 245, text: '速度相等的时候距离最大，是 25 米' }],
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
});

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
  await T(`window.__toasts=[];Q.useToast.subscribe(st=>{for(const t of st.list)if(!window.__toasts.includes(t.message))window.__toasts.push(t.message)});return true`);
  const toasts = () => T(`return window.__toasts`);
  await until(() => T(`return Q.useStudy.getState().loaded`), 10000, 'study loaded');
  KEYS = await T(`return Q.studyLogic.pointsOf('physics').slice(3,8).map(p=>p.key)`);
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);

  const recDir = api.recording.directory, now = Date.now(), startedAt = now - 600000;
  const lines = [];
  for (let i = 0; i < 16; i++) lines.push({ t0: i * 15, t1: i * 15 + 10, who: 'teacher', text: `我们先复习一下匀变速直线运动的公式，第 ${i + 1} 条` });
  lines.push({ t0: 240, t1: 248, who: 'student', text: '速度相等的时候距离最大，是 25 米' }, { t0: 398, t1: 402, who: 'student', text: '是 5 米吧' });
  const makeRec = async (id, title, o = {}) => {
    const folder = path.join(recDir, '2026-01-01-' + id); fs.mkdirSync(folder, { recursive: true });
    await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-t', '600', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(folder, '课堂回放.mp4')], { timeout: 180000 });
    const voice = o.voice !== false;
    if (voice) fs.writeFileSync(path.join(folder, 'transcript.json'), JSON.stringify({ v: 1, engine: 'sensevoice-int8', at: new Date().toISOString(), split: 'channel', source: 'voice.webm', seconds: 600, ms: 1000, segments: lines }));
    fs.writeFileSync(path.join(folder, 'recording.json'), JSON.stringify({ id, title, studentId: 'stu-a', createdAt: new Date(now).toISOString(), phase: 'complete', startedAt, endedAt: now, chapters: [{ t: 5, kind: 'material', title: '追及问题课件' }],
      ...(voice ? { transcript: { phase: 'done', at: new Date().toISOString(), count: lines.length, counts: { teacher: 16, student: 2 } } } : {}) }));
    return folder;
  };

  // ── 1. 课后精析写入 ──
  // 老师课上自己点过一道（第 100 秒，记的是对）
  const manual = await T(`const q=Q.studyStore.addQuestion({stem:'一辆车从静止开始匀加速，4 s 内走了 16 m，求加速度',answer:'2 m/s²',analysis:'',points:[${JSON.stringify(KEYS[0])}],difficulty:2,qtype:'计算',origin:'manual',status:'bank',subject:'physics'});
    const a=Q.studyStore.recordAttempt('stu-a',q.id,'right','课堂作答',{at:new Date(${startedAt + 100000}).toISOString()});return {q:q.id,a:a.id}`);
  const f1 = await makeRec('rec-f1', '追及问题');
  visionInRun = 0;
  const rec = await T(`const r=await Q.recordAnalysis.analyzeRecording('rec-f1');return r&&{id:r.id,q:r.questions,a:r.attempts,n:r.notes,unsure:r.unsure,taught:r.taught,enriched:r.enriched,lines:r.lines}`);
  const vis = requests.filter(isVision), fine = requests.filter(isFine);
  assert.equal(vis.length, 3, '有原话时截 18 张，分三批');
  assert.equal(fine.length, 1);
  assert.equal(fine[0].model, 'fake-text', '精析用文字模型');
  const fp = JSON.stringify(fine[0].messages);
  for (const k of ['速度相等的时候距离最大', 'Q1 题干', 'Q2 题干', 'A1（1:40，张三）', '老师记：对', '追及问题课件', '评分标准']) assert.ok(fp.includes(k), '精析提示词里有 ' + k);
  assert.equal(rec.q.length, 3, '画面上两道 + 口头一道进收件箱');
  assert.equal(rec.a.length, 1, '只有把握高的一道直接记');
  const a1 = await T(`return Q.useStudy.getState().data.attempts.find(a=>a.id===${JSON.stringify(rec.a[0])})`);
  assert.deepEqual([a1.result, a1.level, a1.conf, a1.via, a1.recordId, a1.mode, a1.hints, a1.t], ['right', 7, 0.9, 'replay', 'rec-f1', 'guided', 1, 260]);
  assert.equal(a1.at, new Date(startedAt + 260000).toISOString(), '作答记在录像里那一刻');
  assert.equal(a1.evidence[0].text, '速度相等的时候距离最大，是 25 米');
  assert.match(a1.note, /课后精析：提示下做的，七成把握/);
  assert.equal(rec.unsure.length, 1);
  assert.deepEqual([rec.unsure[0].result, rec.unsure[0].level, rec.unsure[0].why, rec.unsure[0].misconception], ['wrong', 3, 'AI 只有 6 成把握', '把最后 1 秒当成了第 1 秒']);
  assert.equal(rec.taught.length, 1, '老师讲的例题只算讲过');
  const oral = await T(`return Q.useStudy.getState().data.questions.find(q=>q.id===${JSON.stringify(rec.taught[0])})`);
  assert.equal(oral.stem, ORAL); assert.equal(oral.status, 'inbox'); assert.match(oral.source, /课堂原话 7:30/);
  assert.deepEqual(rec.enriched, [manual.a]);
  const m1 = await T(`return Q.useStudy.getState().data.attempts.find(a=>a.id===${JSON.stringify(manual.a)})`);
  assert.equal(m1.result, 'right', '老师手点的对错不改'); assert.equal(m1.evidence[0].text, '加速度是 2'); assert.equal(m1.level, undefined);
  const notes = await T(`return Q.useStudy.getState().data.notes.filter(n=>${JSON.stringify(rec.n)}.includes(n.id))`);
  assert.equal(notes.length, 2);
  const summary = notes.find((x) => !x.todo), todo = notes.find((x) => x.todo);
  assert.match(summary.text, /^课堂精析（AI 听了 18 句课堂原话、看了 18 张画面）/);
  for (const k of ['临界条件', '这节课的安排', '学生做追及题', '卡住的地方', '七成把握↑', '三成把握', '可能还没掌握', '“速度相等的时候距离最大，是 25 米”（4:05）']) assert.ok(summary.text.includes(k), '档案里有 ' + k);
  assert.ok(!summary.text.includes('调麦克风'), '闲聊不写');
  assert.equal(todo.todo, 'practice'); assert.match(todo.text, /下节课：自由落体最后 1 秒的题再练一次（课上 9:20 说的）/);
  assert.equal(await T(`return Q.sort.openTodos(Q.useStudy.getState().data.notes).length`), 0, '「下节课再练」不算家长调课提醒');
  const ms = await T(`return Q.studyLogic.mastery('stu-a',Q.useStudy.getState().data).get(${JSON.stringify(KEYS[0])})`);
  assert.equal(ms.n, 2); assert.ok(Math.abs(ms.score - (0.7 + 1 * 0.75) / 1.75) < 1e-9, '掌握度按几成把握算：' + ms.score);
  const meta = JSON.parse(fs.readFileSync(path.join(f1, 'recording.json'), 'utf8')).analysis;
  assert.deepEqual([meta.voice, meta.pending, meta.taught, meta.frames, meta.fineSkip], [18, 1, 1, 18, undefined]);
  assert.deepEqual(meta.items.map((x) => x.state), ['written', 'pending', 'teacher', 'taught']);
  assert.equal(meta.segments.length, 3);
  assert.match(meta.summary, /临界条件/);
  assert.ok((await toasts()).some((t) => /AI 听完、看完了「追及问题」：3 道题进收件箱、记了 1 条作答.*课堂小结记进档案；1 道拿不准，需要你看一眼/.test(t)), JSON.stringify(await toasts()));
  mark('fine analysis: confident judgements become attempts with level / evidence / lesson time; unsure ones wait; demos count as taught; manual attempts only get evidence', { vision: vis.length });

  // ── 2. 回放页：待确认、按 AI 的记、整批撤销 ──
  await T(`Q.useStore.getState().set({page:'replay'});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="pending-item"]')`), 8000, '回放页显示待确认');
  const txt = await T(`return document.querySelector('[data-qa="rp-analysis"]').innerText`);
  assert.match(txt, /AI 听了 18 句原话、看了 18 张画面：3 道题进收件箱、1 条作答、老师讲的例题 1 道/);
  const card = await T(`return document.querySelector('[data-qa="pending-item"]').innerText`);
  for (const k of ['AI 觉得：错', '三成把握', '自己做的', 'AI 只有 6 成把握', '误区：把最后 1 秒当成了第 1 秒', '是 5 米吧', '6:40', '按 AI 的记']) assert.ok(card.includes(k), '待确认卡片里有 ' + k + '：' + card);
  await shot('v160-fine-1-replay-pending.png');
  // 点证据的时间能跳到原话
  await T(`document.querySelector('[data-qa="pending-item"] .sort-uq-ev button').click();return true`);
  await until(() => T(`return !!document.querySelector('.tv')`), 8000, '打开课堂原话');
  await T(`document.querySelector('[data-qa="pending-accept"]').click();return true`);
  await until(() => T(`return !document.querySelector('[data-qa="pending-item"]')`), 5000, '确认后卡片消失');
  const after = await T(`const r=Q.useStudy.getState().data.sorts.find(x=>x.id===${JSON.stringify(rec.id)});return {a:r.attempts,u:r.unsure.length,lines:r.lines}`);
  assert.equal(after.a.length, 2); assert.equal(after.u, 0);
  assert.ok(after.lines.some((l) => l.includes('拿不准的已由你确认')), JSON.stringify(after.lines));
  const a2 = await T(`return Q.useStudy.getState().data.attempts.find(a=>a.id===${JSON.stringify(after.a[1])})`);
  assert.deepEqual([a2.result, a2.level, a2.via, a2.mode, a2.misconception, a2.at], ['wrong', 3, 'teacher', 'student_solo', '把最后 1 秒当成了第 1 秒', new Date(startedAt + 420000).toISOString()]);
  const wb = await T(`return Q.studyLogic.wrongBook('stu-a',Q.useStudy.getState().data).map(w=>w.q.id)`);
  assert.ok(wb.includes(rec.q[1]), '确认做错的进错题本');
  await shot('v160-fine-2-replay-confirmed.png', 600);
  await T(`document.querySelector('[data-qa="rp-analysis-undo"]').click();return true`);
  await until(() => T(`return document.querySelector('[data-qa="rp-analysis"]').innerText.includes('已撤销')`), 5000, '标成已撤销');
  const left2 = await T(`const d=Q.useStudy.getState().data;return {a:d.attempts.filter(a=>${JSON.stringify(after.a)}.includes(a.id)).length,m:d.attempts.find(a=>a.id===${JSON.stringify(manual.a)}),n:d.notes.filter(n=>${JSON.stringify(rec.n)}.includes(n.id)).length,q:d.questions.filter(q=>${JSON.stringify(rec.q)}.includes(q.id)).length}`);
  assert.deepEqual([left2.a, left2.n, left2.q], [0, 0, 0], '作答（含老师确认的）、档案、题整批撤销');
  assert.equal(left2.m.result, 'right'); assert.equal(left2.m.evidence, undefined, '手点的作答只去掉补上的证据'); assert.equal(left2.m.recordId, undefined);
  assert.equal(await T(`return !!document.querySelector('[data-qa="pending-checks"]')`), false);
  mark('replay page: pending cards with evidence, seek, accept with AI level; undo removes everything incl. confirmed, strips evidence from manual attempts');

  // ── 3. 转写完自动分析；没有原话的只看画面 ──
  await makeRec('rec-f2', '转写完自动分析');
  visionInRun = 0;
  const fine0 = requests.filter(isFine).length;
  api.asr.emit({ type: 'asrDone', record: { id: 'rec-f2', title: '转写完自动分析', studentId: 'stu-a' }, count: lines.length });
  await until(() => JSON.parse(fs.readFileSync(path.join(recDir, '2026-01-01-rec-f2', 'recording.json'), 'utf8')).analysis?.sortId, 60000, '转写完自动分析');
  assert.equal(requests.filter(isFine).length - fine0, 1);
  await makeRec('rec-f3', '没有原话', { voice: false });
  visionInRun = 0;
  const fine1 = requests.filter(isFine).length;
  api.recording.onSaved({ id: 'rec-f3', title: '没有原话', studentId: 'stu-a', path: '' });
  const m3 = await until(() => JSON.parse(fs.readFileSync(path.join(recDir, '2026-01-01-rec-f3', 'recording.json'), 'utf8')).analysis, 60000, '没有原话的自动分析');
  assert.equal(requests.filter(isFine).length, fine1, '没有原话不做精析');
  assert.deepEqual([m3.frames, m3.voice, m3.fineSkip], [12, undefined, '还没有课堂原话']);
  await T(`Q.useRecording.setState(s=>({rev:s.rev+1}));return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="rp-fine-skip"]')`), 8000, '回放页写明没听原话的原因');
  assert.match(await T(`return document.querySelector('[data-qa="rp-fine-skip"]').innerText`), /没听课堂原话：还没有课堂原话。转好文字后点「重新分析」/);
  await shot('v160-fine-3-replay-skip.png');
  mark('analysis starts when transcription finishes; recordings without voice fall back to frames only and say why');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
})().catch(async (e) => { console.error('FAIL', e.stack || e); if (errors.length) console.error('console: ' + errors.join(' | ')); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } clearTimeout(timer); app.exit(1); });
