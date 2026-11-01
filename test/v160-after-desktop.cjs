// 1.6.0 下课后流水线桌面验收（屏幕外窗口，假的 AI 网关，不花钱）：
//   1. 设置 → 下课后：课后总结、存板书、长图三个开关；课后总结和「AI 自动」里的是同一个开关
//   2. 下课那一下存板书：PDF + 长图放到学生名下、记进录像信息；接着换学生清空课堂时黑板没变，不再存第二份
//   3. 顶栏胶囊：分析中显示进度 → 分析完课后总结自动写（等分析完才写）→ 有拿不准的显示「待确认」；点开看每一步
//   4. 出错的一步标红；「现在写」课后总结；收起后不再显示
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v160-after-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v160-after-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高一', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  settings: { autoMap: false, autoRec: { start: false, idle: false } },
  local: { roots: [], students: [stu('stu-a', '张三'), stu('stu-b', '李四')], studentId: 'stu-a', slots: [], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const { runProcess } = require('../electron/recording.cjs');
const FFMPEG = process.env.CS_FFMPEG || path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(120); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v160 after desktop timed out'); app.exit(1); }, 420000);

const STEM1 = '甲车以 10 m/s 匀速行驶，乙车从静止开始以 2 m/s² 的加速度追赶，求追上前两车的最大距离';
const STEM2 = '一物体从 45 m 高处自由下落，求它落地前最后 1 s 内的位移（g 取 10 m/s²）';
const requests = []; let KEYS = []; let visionInRun = 0; let slow = 0;
const isFine = (j) => JSON.stringify(j.messages).includes('【课堂原话】');
const isVision = (j) => !isFine(j) && JSON.stringify(j.messages).includes('复盘刚上完的一节课');
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const parts = Array.isArray(j.messages?.at(-1)?.content) ? j.messages.at(-1).content : [];
    const imgs = parts.filter((p) => p.type === 'image_url').length;
    let content = '好的';
    if (isVision(j)) {
      const first = visionInRun++ === 0;
      content = JSON.stringify({ frames: Array.from({ length: imgs }, (_, i) => ({ i, what: '讲追及', points: [], questions: first && i === 0 ? [{ stem: STEM1, box: null, answer: '', result: 'none', points: [KEYS[0]] }] : first && i === 1 ? [{ stem: STEM2, box: null, answer: '', result: 'none', points: [KEYS[1]] }] : [] })), summary: '讲了追及问题。', weak: [] });
    } else if (isFine(j)) {
      content = JSON.stringify({
        segments: [{ t0: 0, t1: 300, kind: 'practice', title: '学生做追及题', points: [KEYS[0]] }],
        questions: [
          { ref: 'Q1', t0: 120, t1: 260, mode: 'student_solo', result: 'right', level: 8, conf: 0.92, hints: 0, evidence: [{ t: 245, who: 'student', text: '速度相等的时候距离最大，是 25 米' }], points: [KEYS[0]] },
          { ref: 'Q2', t0: 330, t1: 420, mode: 'student_solo', result: 'wrong', level: 3, conf: 0.6, hints: 0, misconception: '把最后 1 秒当成了第 1 秒', evidence: [{ t: 400, who: 'student', text: '是 5 米吧' }], points: [KEYS[1]] },
        ],
        points: [{ key: KEYS[0], level: 8, trend: 'up', why: '自己找到临界条件' }],
        summary: '学生自己做出了追及问题。', stuck: [], todo: [], quotes: [{ t: 245, text: '速度相等的时候距离最大，是 25 米' }],
      });
    }
    const delay = isVision(j) ? slow : 0;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }, delay);
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
  const settings = () => T(`return await window.csHost.call('settings')`);

  // ── 1. 设置 → 下课后 ──
  const s0 = await settings();
  assert.deepEqual([s0.afterSummary, s0.afterBoard, s0.afterBoardLong], [false, false, false], '默认都关');
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="after-summary"]')`), 8000, '设置里有下课后');
  const sec = await T(`return document.querySelector('[data-qa="after-settings"]').innerText`);
  for (const k of ['保存回放 → 课后语音转写', '下课后自动写课后总结和家长反馈草稿', '同一个开关', '存成 PDF，放到学生名下', '同时存一份长图', '不会存两次']) assert.ok(sec.includes(k), '下课后设置里有 ' + k);
  assert.equal(await T(`return document.querySelector('[data-qa="after-board-long"]').disabled`), true, '没开存板书时长图开关是灰的');
  await T(`document.querySelector('[data-qa="after-summary"]').click();document.querySelector('[data-qa="after-board"]').click();return true`);
  await until(async () => (await settings()).afterBoard === true, 5000, '存板书开了');
  await until(() => T(`return !document.querySelector('[data-qa="after-board-long"]').disabled`), 5000);
  await T(`document.querySelector('[data-qa="after-board-long"]').click();return true`);
  const s1 = await until(async () => { const s = await settings(); return s.afterBoardLong && s; }, 5000, '长图开了');
  assert.equal(s1.afterSummary, true);
  assert.equal(await T(`return Q.autopilot.useAuto.getState().settings.lesson`), true, '「AI 自动」里的课后总结跟着开');
  await T(`document.querySelector('[data-qa="after-settings"]').scrollIntoView();return true`);
  await shot('v160-after-1-settings.png');
  await T(`Q.useRecording.setState({panel:false});return true`);
  mark('settings: after-class section lists the pipeline, summary / board / long image switches, summary synced with autopilot');

  // ── 2. 下课那一下存板书 ──
  const recDir = api.recording.directory;
  const meta = (id) => JSON.parse(fs.readFileSync(path.join(recDir, '2026-01-01-' + id, 'recording.json'), 'utf8'));
  const writeMeta = (id, m) => { const folder = path.join(recDir, '2026-01-01-' + id); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'recording.json'), JSON.stringify({ id, createdAt: new Date().toISOString(), ...m })); return folder; };
  const t0 = Date.now();
  // 比后面那节早下课：顶栏胶囊跟的是最后下课的一段
  writeMeta('rec-b', { title: '板书课', studentId: 'stu-a', phase: 'complete', startedAt: t0 - 2400000, endedAt: t0 - 600000 });
  await T(`s.set({page:'console'});s.focusWin('board');s.clearInk(Q.inkKey('board',0));s.addStroke(Q.inkKey('board',0),{id:'b1',tool:'pen',color:'#d03030',size:8,author:'teacher',pts:[.2,.2,.5,.5,.4,.5,.8,.3,.5]});return true`);
  await T(`Q.useRecording.setState({status:{phase:'recording',id:'rec-b',studentId:'stu-a',startedAt:${t0 - 1800000}}});await new Promise(r=>setTimeout(r,50));Q.useRecording.setState({status:{phase:'stopping',id:'rec-b',studentId:'stu-a'}});return true`);
  const board = await until(() => { const b = meta('rec-b').after?.board; return b && b; }, 15000, '下课存板书记进录像信息');
  assert.equal(board.files, 1);
  const files = await until(() => T(`const f=(Q.useStudy.getState().data.files||[]).filter(x=>x.studentId==='stu-a'&&x.kind==='board');return f.length>=2&&f`), 10000, '板书归到张三名下');
  const pdf = files.find((f) => f.path.endsWith('.pdf')), png = files.find((f) => f.path.endsWith('.png'));
  assert.ok(pdf && png, JSON.stringify(files));
  assert.equal(fs.readFileSync(pdf.path).subarray(0, 5).toString(), '%PDF-');
  assert.equal(fs.readFileSync(png.path).subarray(1, 4).toString(), 'PNG');
  assert.match(png.title, /长图/);
  await T(`Q.useRecording.setState({status:{phase:'idle'}});return true`);
  // 换学生清空：黑板没再写过，不存第二份
  await T(`await Q.classReset.clearClass({archiveTo:'stu-a',why:''});return true`);
  await sleep(500);
  assert.equal(await T(`return (Q.useStudy.getState().data.files||[]).filter(x=>x.studentId==='stu-a'&&x.kind==='board').length`), 2, '内容没变不再存');
  assert.equal(fs.readdirSync(path.dirname(pdf.path)).filter((f) => f.endsWith('.pdf')).length, 1);
  assert.ok((await toasts()).some((t) => /1 块板书已存到「张三」名下/.test(t)), JSON.stringify(await toasts()));
  await T(`Q.classReset.restoreClass();return true`);
  mark('board saved at class end (pdf + long image) into the student folder, recorded on the recording; clearing class afterwards does not save a duplicate');

  // ── 3. 顶栏胶囊：分析中 → 课后总结 → 待确认 ──
  const lines = [];
  for (let i = 0; i < 16; i++) lines.push({ t0: i * 15, t1: i * 15 + 10, who: 'teacher', text: `我们先复习一下匀变速直线运动的公式，第 ${i + 1} 条` });
  lines.push({ t0: 240, t1: 248, who: 'student', text: '速度相等的时候距离最大，是 25 米' }, { t0: 398, t1: 402, who: 'student', text: '是 5 米吧' });
  const now = Date.now(), startedAt = now - 15 * 60000, endedAt = now - 60000;
  const folder = writeMeta('rec-c', { title: '追及问题', studentId: 'stu-a', phase: 'complete', startedAt, endedAt, chapters: [], transcript: { phase: 'done', at: new Date().toISOString(), count: lines.length } });
  await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-t', '840', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(folder, '课堂回放.mp4')], { timeout: 180000 });
  fs.writeFileSync(path.join(folder, 'transcript.json'), JSON.stringify({ v: 1, engine: 'sensevoice-int8', at: new Date().toISOString(), split: 'channel', source: 'voice.webm', seconds: 840, ms: 1000, segments: lines }));
  visionInRun = 0; slow = 1500;
  api.recording.onSaved({ id: 'rec-c', title: '追及问题', studentId: 'stu-a', path: '' });
  await T(`Q.useRecording.setState(s=>({rev:s.rev+1}));return true`);
  await until(() => T(`const b=document.querySelector('[data-qa="after-chip"]');return b&&b.classList.contains('run')&&b.innerText.includes('看画面')`), 20000, '胶囊显示看画面');
  await T(`document.querySelector('[data-qa="after-chip"]').click();return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="after-pop"]')`), 5000, '点开流水线');
  const st1 = await T(`return [...document.querySelectorAll('[data-qa^="after-step-"]')].map(li=>li.dataset.qa.slice(11)+':'+li.dataset.state)`);
  assert.deepEqual(st1.slice(0, 3), ['save:done', 'asr:done', 'vision:run']);
  assert.ok(st1.includes('summary:wait'), JSON.stringify(st1));
  assert.match(await T(`return document.querySelector('[data-qa="after-step-summary"]').innerText`), /等分析完/);
  await shot('v160-after-2-running.png');
  await T(`document.querySelector('.pop-bg').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true`);
  slow = 0;
  await until(() => meta('rec-c').analysis?.sortId, 60000, '分析写完');
  // 分析做完 5 秒后自动跑一轮：录了像的课也写课后总结
  const lesson = await until(() => T(`return Q.useStudy.getState().data.lessons.find(l=>l.studentId==='stu-a')`), 30000, '课后总结自动写好');
  assert.equal(lesson.topic, '追及问题'); assert.equal(lesson.minutes, 14);
  await until(() => meta('rec-c').after?.summary, 10000, '课后总结记进录像信息');
  await T(`Q.useRecording.setState(s=>({rev:s.rev+1}));return true`);
  await until(() => T(`const b=document.querySelector('[data-qa="after-chip"]');return b&&b.classList.contains('pending')&&b.innerText.includes('待确认 1')`), 10000, '胶囊显示待确认');
  await T(`document.querySelector('[data-qa="after-chip"]').click();return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="after-pop"]')`), 5000);
  const st2 = await T(`return [...document.querySelectorAll('[data-qa^="after-step-"]')].map(li=>li.dataset.qa.slice(11)+':'+li.dataset.state)`);
  assert.deepEqual(st2, ['save:done', 'asr:done', 'vision:done', 'fine:done', 'write:done', 'summary:done', 'board:off']);
  assert.match(await T(`return document.querySelector('[data-qa="after-step-write"]').innerText`), /1 题.*待确认 1/);
  assert.match(await T(`return document.querySelector('[data-qa="after-pop"]').innerText`), /去确认 1 道/);
  await shot('v160-after-3-pending.png');
  assert.ok((await T(`return Q.autopilot.useAuto.getState().log.map(l=>l.text)`)).some((t) => /张三：写好 .* 的课后总结/.test(t)));
  mark('top-bar capsule follows the pipeline: running steps, summary waits for analysis then writes itself, pending count after');

  // ── 4. 出错的一步、现在写、收起 ──
  await T(`document.querySelector('[data-qa="after-dismiss"]').click();return true`);
  await until(() => T(`return !document.querySelector('[data-qa="after-chip"]')`), 5000, '收起后不显示');
  writeMeta('rec-d', { title: '李四的课', studentId: 'stu-b', phase: 'complete', startedAt: Date.now() - 40 * 60000, endedAt: Date.now() - 30000, analysis: { at: new Date().toISOString(), frames: 0, questions: 0, attempts: 0, map: 0, summary: '', weak: [], error: '看图模型超时' } });
  fs.writeFileSync(path.join(recDir, '2026-01-01-rec-d', '课堂回放.mp4'), 'x');
  await T(`Q.useRecording.setState(s=>({rev:s.rev+1}));return true`);
  await until(() => T(`const b=document.querySelector('[data-qa="after-chip"]');return b&&b.classList.contains('error')`), 10000, '出错的胶囊');
  await T(`document.querySelector('[data-qa="after-chip"]').click();return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="after-retry-summary"]')`), 5000, '课后总结可以现在写');
  assert.equal(await T(`return document.querySelector('[data-qa="after-step-vision"]').dataset.state`), 'error');
  assert.match(await T(`return document.querySelector('[data-qa="after-retry-vision"]').innerText`), /重新分析/);
  await shot('v160-after-4-error.png');
  await T(`document.querySelector('[data-qa="after-retry-summary"]').click();return true`);
  const l2 = await until(() => T(`return Q.useStudy.getState().data.lessons.find(l=>l.studentId==='stu-b')`), 20000, '现在写课后总结');
  assert.equal(l2.topic, '李四的课');
  await until(() => T(`return document.querySelector('[data-qa="after-step-summary"]')?.dataset.state==='done'`), 10000, '课后总结那步打勾');
  // 提示要等分享长图也导出完才出，比「打勾」晚一点
  await until(async () => (await toasts()).some((t) => /「李四」的课后总结写好了/.test(t)), 30000, '写好提示');
  mark('failed step is red with a retry; "write now" makes the summary; dismissed capsule stays hidden');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
})().catch(async (e) => { console.error('FAIL', e.stack || e); if (errors.length) console.error('console: ' + errors.join(' | ')); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } clearTimeout(timer); app.exit(1); });
