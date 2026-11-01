// 1.6.0 课后语音转写桌面验收（屏幕外窗口）：
//   1. 录课时多存一条双声道 voice.webm；设置里关掉就不存
//   2. 没装语音组件：下课后提示一次去下载；设置里能看到组件、点下载（本机假下载站给真的组件文件），装好后自检通过
//   3. 回放生成完自动转写（真的 SenseVoice），提示条、回放页「课堂原话」、字幕跟着播放走、点一句跳过去、本节搜索、全部课搜索
//   4. 正在录课时不转写，下课后接着转
//   5. 删除组件
// 需要：CS_ASR_TGZ（sherpa-onnx-node-2.0.1.tgz、sherpa-onnx-win-x64-2.0.1.tgz 所在目录）、CS_ASR_MODELS（三个模型文件）、CS_ASR_VOICE（合成假课 voice.webm，20 秒）
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v160-asr-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict'); const http = require('node:http');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v160-asr-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); process.env.CS_SYNTHETIC_RECORD = '1';
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
const TGZ = process.env.CS_ASR_TGZ, MODELS = process.env.CS_ASR_MODELS, VOICE = process.env.CS_ASR_VOICE;
if (!TGZ || !MODELS || !VOICE) { console.error('需要 CS_ASR_TGZ、CS_ASR_MODELS、CS_ASR_VOICE'); process.exit(1); }
const stu = (id, name) => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false, autoRec: { start: false, idle: false } },
  local: { roots: [], students: [stu('stu-a', '张三')], studentId: 'stu-a', slots: [], learning: {} },
}));

const { plan } = require('../electron/asrSetup.cjs');
const files = plan('win32-x64').map((f) => {
  const local = f.kind === 'npm' ? path.join(TGZ, `${f.name}-2.0.1.tgz`) : path.join(MODELS, f.file);
  return { ...f, local };
});
const hits = [];
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''); hits.push(name);
  const f = files.find((x) => x.file === name);
  if (!f) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(f.local).size, r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (r) { const a = +r[1], b = r[2] ? +r[2] : size - 1; res.writeHead(206, { 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f.local, { start: a, end: b }).pipe(res); return; }
  res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f.local).pipe(res);
});

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v160 asr desktop timed out'); app.exit(1); }, 600000);

server.listen(0, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  process.env.CS_ASR_SETUP = JSON.stringify({ platform: 'win32-x64', proxies: [], files: files.map(({ local, ...f }) => ({ ...f, urls: [base + f.file] })) });
  require('../electron/main.cjs');
  void run().catch(async (e) => { console.error('FAIL', e.stack || e); if (errors.length) console.error('console: ' + errors.join(' | ')); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } clearTimeout(timer); app.exit(1); });
});

async function run() {
  const { runProcess } = require('../electron/recording.cjs');
  const FFMPEG = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = async (code) => { try { return await teacher.webContents.executeJavaScript(code); } catch (e) { throw Error('executeJavaScript 失败：' + e.message + '\n' + String(code).slice(0, 240)); } };
  await until(() => call('!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(`(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  await T(`window.__toasts=[];window.confirm=()=>true;Q.useToast.subscribe(st=>{for(const t of st.list)if(!window.__toasts.some(x=>x.message===t.message))window.__toasts.push({message:t.message,action:t.action?.label})});return true`);
  const toasts = () => T(`return window.__toasts`);
  const type = (sel, text) => T(`const el=document.querySelector(${JSON.stringify(sel)});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const recDir = () => api.recording.directory;
  const metaOf = (folder) => JSON.parse(fs.readFileSync(path.join(folder, 'recording.json'), 'utf8'));

  // ── 1. 录课多存一条 voice.webm ──
  const lesson = async (title, seconds = 5) => {
    await T(`await Q.host.call('startLesson',{studentId:'stu-a',title:${JSON.stringify(title)}});return true`);
    await until(() => api.recording.status.phase === 'recording', 30000, '开始录');
    await sleep(seconds * 1000);
    const folder = api.recording.current.folder;
    await T(`await Q.host.call('stopLesson');return true`);
    await until(() => !['starting', 'recording', 'stopping'].includes(api.recording.status.phase), 30000, '收尾');
    await until(() => api.recording.jobs.length === 0, 60000, '回放生成');
    return folder;
  };
  const f1 = await lesson('第一节');
  const voice1 = path.join(f1, 'voice.webm'), m1 = metaOf(f1);
  assert.ok(fs.existsSync(voice1) && fs.statSync(voice1).size > 2000, 'voice.webm 写了');
  assert.ok(m1.voiceBytes > 2000 && !m1.voiceFailed, JSON.stringify(m1));
  assert.ok(fs.existsSync(path.join(f1, '课堂回放.mp4')));
  // 合成音：左声道 440 Hz、右声道 880 Hz，两个声道是分开的
  const probe = await runProcess(FFMPEG, ['-hide_banner', '-i', voice1, '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-'], { timeout: 60000 }).catch((e) => String(e.message));
  assert.match(probe, /Stream #0:0.*Audio: opus.*stereo/, probe.slice(0, 600));
  mark('recording writes a separate stereo voice.webm', { bytes: m1.voiceBytes });

  // ── 2. 没装组件：提示一次 ──
  const need = await until(async () => (await toasts()).find((t) => /下载语音组件/.test(t.message)), 10000, '提示下载');
  assert.equal(need.action, '下载');
  await T(`await Q.host.call('setSettings',{voiceTrack:false});return true`);
  const f2 = await lesson('不存语音');
  assert.ok(!fs.existsSync(path.join(f2, 'voice.webm')), '关掉以后不存');
  await T(`await Q.host.call('setSettings',{voiceTrack:true});return true`);
  assert.equal((await toasts()).filter((t) => /下载语音组件/.test(t.message)).length, 1, '只提示一次');
  mark('no component: one prompt to download; voice track can be turned off');

  // ── 3. 设置里下载组件 ──
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="voice-install"]')`), 8000, '设置面板');
  assert.equal(await T(`return document.querySelector('[data-qa="voice-track"]').checked&&document.querySelector('[data-qa="voice-transcribe"]').checked`), true, '默认都开');
  assert.match(await T(`return document.querySelector('[data-qa="voice-install"]').innerText`), /下载语音组件（约 2\d\d MB）/);
  await T(`document.querySelector('[data-qa="voice-settings"]').scrollIntoView({block:'center'});return true`);
  await shot('v160-asr-1-settings.png');
  await T(`document.querySelector('[data-qa="voice-install"]').click();return true`);
  await until(() => T(`return /正在|下载|加载/.test(document.querySelector('[data-qa="voice-setup"]')?.innerText||'')`), 8000, '下载进度');
  await shot('v160-asr-2-installing.png', 100);
  await until(() => T(`return document.querySelector('[data-qa="voice-setup"]')?.innerText.includes('语音组件已装好')`), 240000, '装好');
  const ok = JSON.parse(fs.readFileSync(path.join(DATA, 'tools', 'asr', 'ok.json'), 'utf8'));
  assert.equal(ok.engine, 'sensevoice-int8-2024-07-17');
  assert.ok(fs.existsSync(path.join(DATA, 'tools', 'asr', 'node_modules', 'sherpa-onnx-win-x64', 'sherpa-onnx.node')));
  assert.ok(!fs.existsSync(path.join(DATA, 'tools', 'asr', 'download')));
  assert.ok(hits.includes('model.int8.onnx'));
  await shot('v160-asr-3-installed.png');
  mark('settings: download the voice component, self-check in utilityProcess passes');
  // 装好后最近的课自动接着转（第一节有合成音，转出来几乎没字，但会走完）
  await until(() => metaOf(f1).transcript?.phase === 'done', 120000, '第一节接着转完');
  await T(`Q.useRecording.setState({panel:false});return true`);

  // ── 4. 假课：回放生成完自动转写 ──
  const makeLesson = async (id, title) => {
    const folder = path.join(recDir(), '2026-11-01-' + id); fs.mkdirSync(folder, { recursive: true });
    fs.copyFileSync(VOICE, path.join(folder, 'voice.webm'));
    await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=20', '-i', VOICE, '-map', '0:v', '-map', '1:a', '-af', 'pan=mono|c0=0.5*c0+0.5*c1', '-c:v', 'libvpx', '-b:v', '200k', '-deadline', 'realtime', '-c:a', 'libopus', '-shortest', path.join(folder, 'capture.webm')], { timeout: 120000 });
    const now = Date.now();
    fs.writeFileSync(path.join(folder, 'recording.json'), JSON.stringify({ id, title, studentId: 'stu-a', createdAt: new Date().toISOString(), phase: 'recoverable', pending: true, startedAt: now - 20000, endedAt: now, chapters: [] }));
    return folder;
  };
  const f3 = await makeLesson('rec-fake', '追及相遇');
  await api.recording.enqueue(f3, { id: 'rec-fake', title: '追及相遇', studentId: 'stu-a', seconds: 20 });
  await until(() => metaOf(f3).transcript?.phase === 'done', 120000, '假课转写');
  const tr = JSON.parse(fs.readFileSync(path.join(f3, 'transcript.json'), 'utf8'));
  assert.ok(tr.segments.some((s) => s.who === 'student' && /速度相等/.test(s.text)), JSON.stringify(tr.segments));
  assert.ok(tr.segments.some((s) => s.who === 'teacher' && /追及/.test(s.text)));
  await until(async () => (await toasts()).some((t) => /「追及相遇」的课堂原话已转成文字/.test(t.message)), 8000, '转好提示');
  mark('after replay is generated, the lesson is transcribed automatically with speakers', { segments: tr.segments.length });

  // ── 5. 回放页：课堂原话、字幕、跳转、搜索 ──
  await T(`Q.useStore.getState().set({page:'replay'});return true`);
  await until(() => T(`return [...document.querySelectorAll('[data-qa="rp-voice"]')].some(e=>/课堂原话 · \\d+ 句（学生 1 句）/.test(e.innerText))`), 10000, '回放页显示课堂原话');
  await T(`[...document.querySelectorAll('[data-qa="rp-voice"]')].find(e=>/学生 1 句/.test(e.innerText)).click();return true`);
  await until(() => T(`const v=document.querySelector('[data-qa="rp-transcript"] video');return v&&v.readyState>=1`), 15000, '播放器');
  await T(`[...document.querySelectorAll('.tv-lines li.w-student')][0].click();return true`);
  await until(() => T(`return /速度相等/.test(document.querySelector('[data-qa="rp-subtitle"]').innerText)`), 8000, '字幕跳到学生那句');
  const tNow = await T(`return document.querySelector('[data-qa="rp-transcript"] video').currentTime`);
  assert.ok(tNow > 11 && tNow < 14, String(tNow));
  assert.match(await T(`return document.querySelector('[data-qa="rp-subtitle"]').innerText`), /^学生/);
  await T(`const v=document.querySelector('[data-qa="rp-transcript"] video');v.pause();v.currentTime=5.5;return true`);
  await until(() => T(`return /甲车/.test(document.querySelector('[data-qa="rp-subtitle"]').innerText)`), 8000, '拖到第 5 秒显示老师那句');
  assert.ok(await T(`return document.querySelectorAll('.tv-bands i').length>=1`), '进度条上标了学生发言');
  await shot('v160-asr-4-replay.png');
  await type('[data-qa="rp-transcript-search"]', '甲车');
  await until(() => T(`return document.querySelectorAll('.tv-lines li:not(.tv-none)').length===1`), 5000, '本节搜索');
  await type('[data-qa="rp-transcript-search"]', '没说过的话');
  await until(() => T(`return /没有说过这句话/.test(document.querySelector('.tv-lines').innerText)`), 5000, '搜不到');
  await type('[data-qa="rp-transcript-search"]', '');
  // 全部课搜索：点结果打开那节课并跳到那句
  await T(`[...document.querySelectorAll('[data-qa="rp-voice"]')].find(e=>/学生 1 句/.test(e.innerText)).click();return true`);
  await until(() => T(`return !document.querySelector('[data-qa="rp-transcript"]')`), 5000, '收起');
  await type('[data-qa="rp-search"]', '速度相等');
  await T(`document.querySelector('[data-qa="rp-search"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true`);
  await until(() => T(`return document.querySelectorAll('[data-qa="rp-hits"] li').length>=1`), 8000, '全部课搜索');
  assert.match(await T(`return document.querySelector('[data-qa="rp-hits"]').innerText`), /找到 1 句[\s\S]*张三 · 追及相遇[\s\S]*学生[\s\S]*速度相等/);
  await T(`document.querySelector('[data-qa="rp-hits"] li').click();return true`);
  await until(() => T(`const v=document.querySelector('[data-qa="rp-transcript"] video');return v&&v.currentTime>11&&/速度相等/.test(document.querySelector('[data-qa="rp-subtitle"]').innerText)`), 15000, '点搜索结果跳过去');
  await shot('v160-asr-5-search.png');
  mark('replay: subtitles follow playback, click a line to seek, search this lesson and all lessons');

  // ── 6. 上课时不转 ──
  const f4 = await makeLesson('rec-wait', '等下课');
  await runProcess(FFMPEG, ['-hide_banner', '-y', '-i', path.join(f4, 'capture.webm'), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', path.join(f4, '课堂回放.mp4')], { timeout: 120000 });
  fs.rmSync(path.join(f4, 'capture.webm'));
  fs.writeFileSync(path.join(f4, 'recording.json'), JSON.stringify({ ...metaOf(f4), phase: 'complete', pending: false }));
  await T(`await Q.host.call('startLesson',{studentId:'stu-a',title:'正在上课'});return true`);
  await until(() => api.recording.status.phase === 'recording', 30000, '开始录');
  await T(`await Q.host.call('asr.transcribe','rec-wait');return true`);
  await until(() => api.asr.view().paused, 10000, '上课时停着');
  await until(() => T(`return [...document.querySelectorAll('[data-qa="rp-voice"]')].some(e=>/正在上课，下课后再转写/.test(e.innerText))`), 10000, '回放页显示等下课');
  await sleep(1500);
  assert.equal(metaOf(f4).transcript, undefined, '上课时没开始');
  await T(`await Q.host.call('stopLesson');return true`);
  await until(() => metaOf(f4).transcript?.phase === 'done', 180000, '下课后转完');
  mark('while a lesson is being recorded, transcription waits until it ends');

  // ── 7. 删除组件 ──
  await T(`Q.useStore.getState().set({page:'board'});Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="voice-uninstall"]')&&!document.querySelector('[data-qa="voice-uninstall"]').disabled`), 60000, '删除按钮');
  await T(`document.querySelector('[data-qa="voice-uninstall"]').click();return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="voice-install"]')`), 15000, '删掉了');
  assert.ok(!fs.existsSync(path.join(DATA, 'tools', 'asr')));
  assert.ok(fs.existsSync(path.join(f3, 'transcript.json')), '转好的文字还在');
  mark('settings: remove the component; transcripts stay');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
}
