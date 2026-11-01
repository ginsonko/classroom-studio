'use strict';
// 1.6.0 课后语音转写：组件下载（假下载站）、串音去重、真的 SenseVoice 转写合成的「假课」、上课时让路、老录像退回混音。
// 真转写部分需要已装好的组件：CS_ASR_ADDON（含 sherpa-onnx-node 的 node_modules）和 CS_ASR_MODELS（三个模型文件），没给就跳过。
// 用法：CS_FFMPEG=... CS_ASR_ADDON=... CS_ASR_MODELS=... node test/v160-asr.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Recording, runProcess } = require('../electron/recording.cjs');
const { Asr, dedupeEcho, similar, cover } = require('../electron/asr.cjs');
const { AsrSetup, plan, MODELS } = require('../electron/asrSetup.cjs');
const ffmpeg = process.env.CS_FFMPEG || path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const root = path.join(process.env.CS_TEST_OUT || os.tmpdir(), 'v160-asr-' + Date.now());
const ADDON = process.env.CS_ASR_ADDON, MODELDIR = process.env.CS_ASR_MODELS;
const real = !!(ADDON && MODELDIR && fs.existsSync(path.join(ADDON, 'sherpa-onnx-node')));
let n = 0, skipped = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const skip = (name) => { skipped++; console.log('skip ' + name + '（没给 CS_ASR_ADDON / CS_ASR_MODELS）'); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const until = async (fn, ms = 60000, what = '条件') => { const t = Date.now() + ms; while (Date.now() < t) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw Error('等待超时：' + what); };

/** 本机的假下载站：/good/ 正常给（支持分段），/bad/ 内容是坏的 */
async function fakeSite(files) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]); hits.push(u);
    const m = /^\/(good|bad)\/(.+)$/.exec(u), body = m && files[m[2]];
    if (!body) { res.writeHead(404); res.end('not found'); return; }
    const data = m[1] === 'bad' ? Buffer.alloc(body.length, 7) : body;
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (r) { const a = +r[1], b = r[2] ? +r[2] : data.length - 1; res.writeHead(206, { 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Accept-Ranges': 'bytes' }); res.end(data.subarray(a, b + 1)); return; }
    res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }); res.end(data);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

/** 一个 npm 包的 tgz（package/ 目录） */
async function tgz(name, extra = {}) {
  const dir = path.join(root, 'pkg-' + name), out = path.join(root, name + '.tgz');
  await fsp.mkdir(path.join(dir, 'package'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'package', 'package.json'), JSON.stringify({ name, version: '2.0.1' }));
  for (const [f, s] of Object.entries(extra)) await fsp.writeFile(path.join(dir, 'package', f), s);
  execFileSync('tar', ['-czf', out, '-C', dir, 'package'], { windowsHide: true });
  return fsp.readFile(out);
}

/** Windows 自带的中文语音合成一句话（第一次运行时生成，存在测试目录里） */
function say(text, file) {
  const ps = `Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'zh-CN'}|Select-Object -First 1;if($v){$s.SelectVoice($v.VoiceInfo.Name)};$s.Rate=0;$s.SetOutputToWaveFile('${file}');$s.Speak('${text}');$s.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function makeRecord(rec, name, { voice, mp4, createdAt } = {}) {
  const folder = path.join(rec.directory, name); await fsp.mkdir(folder, { recursive: true });
  const now = Date.now();
  if (voice) await fsp.copyFile(voice, path.join(folder, 'voice.webm'));
  if (mp4) await fsp.copyFile(mp4, path.join(folder, '课堂回放.mp4'));
  else await fsp.writeFile(path.join(folder, '课堂回放.mp4'), 'x');
  await fsp.writeFile(path.join(folder, 'recording.json'), JSON.stringify({ id: 'rec-' + name, title: '追及相遇', studentId: 's1', chapters: [], createdAt: createdAt || new Date().toISOString(), phase: 'complete', bytes: 0, startedAt: now - 20000, endedAt: now }));
  return { id: 'rec-' + name, folder };
}
const meta = async (f) => JSON.parse(await fsp.readFile(path.join(f, 'recording.json'), 'utf8'));
const transcript = async (f) => JSON.parse(await fsp.readFile(path.join(f, 'transcript.json'), 'utf8'));

(async () => {
  await fsp.mkdir(root, { recursive: true });

  await ok('相似度与串音去重：同一时间两边差不多的一句只留音量大的；不同的话、不重叠的都保留', async () => {
    assert.equal(similar('老师，我觉得两车速度相等的时候距离最大。', '老师我觉得两车速度相等的时候距离最大'), 1);
    assert.ok(similar('两车速度相等的时候距离最大', '两车速度相等时距离最大') > 0.6);
    assert.ok(similar('先看第一题', '两车速度相等') < 0.2);
    assert.equal(cover('老师。', '老师，我觉得两车速度相等的时候距离最大。'), 1);
    assert.ok(cover('两车速度', '先看第一题') < 0.3);
    const segs = [
      { t0: 12.1, t1: 16.5, who: 'student', text: '老师，我觉得两车速度相等的时候距离最大。', rms: 0.12 },
      { t0: 12.3, t1: 16.4, who: 'teacher', text: '老师我觉得两车速度相等的时候距离最大', rms: 0.02 },
      { t0: 0.2, t1: 3.8, who: 'teacher', text: '同学们好，今天我们讲追及相遇问题。', rms: 0.1 },
      { t0: 2.0, t1: 3.0, who: 'student', text: '好的', rms: 0.1 },
      { t0: 20, t1: 22, who: 'teacher', text: '老师我觉得两车速度相等的时候距离最大', rms: 0.2 },
      { t0: 30, t1: 34, who: 'student', text: '那它们速度相等的时候距离最小', rms: 0.1 },
      { t0: 30.1, t1: 30.6, who: 'teacher', text: '那它', rms: 0.01 },
      { t0: 31, t1: 32, who: 'teacher', text: '对', rms: 0.15 },
    ];
    const out = dedupeEcho(segs);
    assert.deepEqual(out.map((s) => s.t0), [0.2, 2.0, 12.1, 20, 30, 31]);
    assert.equal(out.find((s) => s.t0 === 12.1).who, 'student');
  });

  await ok('下载清单：Windows / mac 两种芯片都有，先小后大，总共约 250 MB；不支持的系统返回空', async () => {
    for (const p of ['win32-x64', 'darwin-arm64', 'darwin-x64']) {
      const list = plan(p), total = list.reduce((a, f) => a + f.size, 0);
      assert.equal(list.length, 5); assert.equal(list[0].name, 'sherpa-onnx-node'); assert.equal(list.at(-1).file, 'model.int8.onnx');
      assert.ok(total > 245e6 && total < 265e6, p + ' ' + total);
      for (const f of list) { assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.ok(f.urls.length >= 1 && f.urls.every((u) => u.startsWith('https://'))); }
    }
    assert.equal(plan('linux-arm'), null);
    assert.equal(new AsrSetup({ dir: path.join(root, 'x'), fetch, platform: 'linux-arm' }).view().supported, false);
  });

  await ok('组件下载：坏线路换好线路、解压到 node_modules、模型放 models、装好才写 ok.json；再装一次跳过已有模型；删除', async () => {
    const js = await tgz('sherpa-onnx-node', { 'addon.js': 'module.exports=1' }), native = await tgz('sherpa-onnx-win-x64', { 'sherpa-onnx.node': 'fake' });
    const blobs = { 'sherpa-onnx-node.tgz': js, 'sherpa-onnx-win-x64.tgz': native, 'model.int8.onnx': crypto.randomBytes(9 << 20), 'tokens.txt': Buffer.from('a 0\nb 1\n'), 'silero_vad.onnx': crypto.randomBytes(5000) };
    const site = await fakeSite(blobs);
    try {
      const files = plan('win32-x64').map((f) => ({ ...f, size: blobs[f.file].length, sha256: sha(blobs[f.file]), urls: [`${site.base}/bad/${f.file}`, `${site.base}/good/${f.file}`] }));
      const states = [], checked = [];
      const dir = path.join(root, 'asr-setup');
      const s = new AsrSetup({ dir, fetch, files, platform: 'win32-x64', proxies: [], emit: (v) => states.push(v), verify: async (p) => { checked.push(p); } });
      assert.equal(s.view().installed, false);
      s.install();
      await until(() => s.state.phase !== 'running', 60000, '下载完成');
      assert.equal(s.state.phase, 'done', s.state.error);
      assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'sherpa-onnx-node', 'addon.js')));
      assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'sherpa-onnx-win-x64', 'sherpa-onnx.node')));
      for (const m of MODELS) assert.equal(sha(fs.readFileSync(path.join(dir, 'models', m.file))), sha(blobs[m.file]));
      assert.equal(checked.length, 1); assert.equal(checked[0].addonDir, path.join(dir, 'node_modules'));
      assert.ok(!fs.existsSync(path.join(dir, 'download')), '下载临时目录删掉了');
      assert.deepEqual(s.paths(), { addonDir: path.join(dir, 'node_modules'), modelDir: path.join(dir, 'models'), engine: 'sensevoice-int8-2024-07-17' });
      assert.ok(states.some((v) => v.pct > 30 && v.pct < 95), '有中间进度');
      assert.ok(states.every((v, i) => i === 0 || v.pct >= states[i - 1].pct || v.phase !== 'running'), '进度不往回走');
      // 再装一次：模型不重下
      const before = site.hits.filter((h) => h.endsWith('model.int8.onnx')).length;
      s.install(); await until(() => s.state.phase !== 'running', 60000, '第二次完成');
      assert.equal(s.state.phase, 'done');
      assert.equal(site.hits.filter((h) => h.endsWith('model.int8.onnx')).length, before);
      assert.ok(s.state.lines.some((l) => /已有语音识别模型/.test(l)));
      // 自检不过：不写 ok.json，报一句看得懂的话
      const bad = new AsrSetup({ dir: path.join(root, 'asr-bad'), fetch, files, platform: 'win32-x64', proxies: [], verify: async () => { throw Error('加载失败'); } });
      bad.install(); await until(() => bad.state.phase !== 'running', 60000, '自检失败');
      assert.equal(bad.state.phase, 'error'); assert.match(bad.state.error, /运行不起来：加载失败/); assert.equal(bad.paths(), null);
      // 只有坏线路：报下载失败
      const broken = new AsrSetup({ dir: path.join(root, 'asr-broken'), fetch, files: files.map((f) => ({ ...f, urls: [`${site.base}/bad/${f.file}`] })), platform: 'win32-x64', proxies: [] });
      broken.install(); await until(() => broken.state.phase !== 'running', 60000, '下载失败');
      assert.equal(broken.state.phase, 'error'); assert.match(broken.state.error, /下载识别程序失败/);
      await s.uninstall(); assert.ok(!fs.existsSync(dir)); assert.equal(s.view().installed, false);
    } finally { await site.close(); }
  });

  await ok('安装包自带组件：文件齐、模型大小对得上才算；算装好、不用下载、不能单独删；缺一个文件就退回下载', async () => {
    const bundled = path.join(root, 'bundled'), mods = path.join(bundled, 'node_modules'), models = path.join(bundled, 'models');
    for (const n of ['sherpa-onnx-node', 'sherpa-onnx-win-x64']) { await fsp.mkdir(path.join(mods, n), { recursive: true }); await fsp.writeFile(path.join(mods, n, 'package.json'), '{}'); }
    await fsp.mkdir(models, { recursive: true });
    // 只按大小核对：造稀疏的同样大小的文件
    for (const m of MODELS) { const fd = fs.openSync(path.join(models, m.file), 'w'); fs.ftruncateSync(fd, m.size); fs.closeSync(fd); }
    const s = new AsrSetup({ dir: path.join(root, 'asr-data'), bundled, fetch, platform: 'win32-x64' });
    assert.deepEqual(s.paths(), { addonDir: mods, modelDir: models, engine: 'sensevoice-int8-2024-07-17', bundled: true });
    const v = s.view(); assert.equal(v.installed, true); assert.equal(v.bundled, true);
    assert.equal(s.install().phase, 'idle', '自带的不再下载'); assert.ok(!fs.existsSync(path.join(root, 'asr-data')));
    await assert.rejects(() => s.uninstall(), /安装包自带/);
    // mac 版没有 Windows 的本机组件：不算
    assert.equal(new AsrSetup({ dir: path.join(root, 'asr-data'), bundled, fetch, platform: 'darwin-arm64' }).bundledPaths(), null);
    const fd = fs.openSync(path.join(models, 'tokens.txt'), 'r+'); fs.ftruncateSync(fd, 10); fs.closeSync(fd);
    const partial = new AsrSetup({ dir: path.join(root, 'asr-data'), bundled, fetch, platform: 'win32-x64' });
    assert.equal(partial.paths(), null); assert.equal(partial.view().bundled, false); assert.equal(partial.view().installed, false);
    assert.equal(new AsrSetup({ dir: path.join(root, 'asr-data'), fetch, platform: 'win32-x64' }).bundledPaths(), null, '没给 bundled');
    await fsp.rm(bundled, { recursive: true, force: true });
  });

  // ── 用真的组件转写 ──
  if (!real) { for (const t of ['真转写', '串音', '混音', '搜原话', '上课让路', '自检', '接着转']) skip(t); console.log(`v160-asr: ${n} passed, ${skipped} skipped`); return; }

  const wav = path.join(root, 'wav'); await fsp.mkdir(wav, { recursive: true });
  const T = path.join(wav, 'teacher.wav'), S = path.join(wav, 'student.wav');
  say('同学们好，今天我们讲追及相遇问题。先看第一题，甲车以十米每秒的速度匀速行驶。', T);
  say('老师，我觉得两车速度相等的时候距离最大。', S);
  const voice = path.join(wav, 'voice.webm'), echo = path.join(wav, 'echo.webm'), mixed = path.join(wav, 'mixed.mp4');
  const base = ['-hide_banner', '-y', '-i', T, '-i', S, '-filter_complex'];
  await runProcess(ffmpeg, [...base, '[0:a]aresample=48000,pan=mono|c0=c0,apad=whole_dur=20[l];[1:a]aresample=48000,pan=mono|c0=c0,adelay=12000,apad=whole_dur=20[r];[l][r]join=inputs=2:channel_layout=stereo[o]', '-map', '[o]', '-t', '20', '-c:a', 'libopus', '-b:a', '64k', voice]);
  await runProcess(ffmpeg, [...base, '[1:a]aresample=48000,pan=mono|c0=c0,adelay=12000,apad=whole_dur=20,asplit[s1][s2];[s2]volume=0.3[e];[0:a]aresample=48000,pan=mono|c0=c0,apad=whole_dur=20[t];[t][e]amix=inputs=2:normalize=0:duration=first[l];[l][s1]join=inputs=2:channel_layout=stereo[o]', '-map', '[o]', '-t', '20', '-c:a', 'libopus', '-b:a', '64k', echo]);
  await runProcess(ffmpeg, [...base, '[0:a]aresample=48000,pan=mono|c0=c0,apad=whole_dur=20[t];[1:a]aresample=48000,pan=mono|c0=c0,adelay=12000,apad=whole_dur=20[s];[t][s]amix=inputs=2:normalize=0:duration=first[o]', '-map', '[o]', '-t', '20', '-c:a', 'aac', mixed]);

  const recDir = path.join(root, 'recordings');
  const rec = new Recording({ directory: recDir, ffmpeg, onChange() {}, send() {} });
  await fsp.mkdir(recDir, { recursive: true });
  // 装好的组件：ok.json 指向外面已有的 node_modules 和模型
  const none = new AsrSetup({ dir: path.join(root, 'asr-none'), fetch, platform: 'win32-x64' });
  const setupDir = path.join(root, 'asr-ready'); await fsp.mkdir(setupDir, { recursive: true });
  await fsp.writeFile(path.join(setupDir, 'ok.json'), JSON.stringify({ addonDir: ADDON, modelDir: MODELDIR, engine: 'sensevoice-int8-2024-07-17' }));
  const ready = new AsrSetup({ dir: setupDir, fetch, platform: 'win32-x64' });
  assert.ok(ready.paths());
  const events = [];
  let busy = false;
  const make = (setup) => new Asr({ setup, recording: rec, ffmpeg, emit: (m) => events.push(m), busy: () => busy, threads: 2, poll: 200 });

  await ok('没装组件：下课只提醒一次去下载，不排队', async () => {
    const r = await makeRecord(rec, 'need', { voice });
    const asr = make(none);
    assert.equal(await asr.offer({ id: r.id }), false);
    assert.equal(await asr.offer({ id: r.id }), false);
    const need = events.filter((e) => e.type === 'asrNeeded');
    assert.equal(need.length, 1); assert.equal(need[0].record.id, r.id); assert.ok(need[0].mb > 200);
    assert.equal(asr.queue.length, 0);
    await fsp.rm(r.folder, { recursive: true });
  });

  const asr = make(ready);
  await ok('真转写：左声道记老师、右声道记学生，按时间排好，写 transcript.json 和录像信息', async () => {
    const r = await makeRecord(rec, 'clean', { voice });
    assert.equal(await asr.offer({ id: r.id }), true);
    await until(() => events.some((e) => e.type === 'asrDone' && e.record.id === r.id), 120000, '转写完成');
    const t = await transcript(r.folder);
    assert.equal(t.split, 'channel'); assert.equal(t.source, 'voice.webm'); assert.equal(t.engine, 'sensevoice-int8-2024-07-17');
    const who = t.segments.map((s) => s.who);
    assert.ok(who.filter((w) => w === 'teacher').length >= 1 && who.filter((w) => w === 'student').length === 1, JSON.stringify(t.segments));
    assert.ok(t.segments.every((s, i) => i === 0 || s.t0 >= t.segments[i - 1].t0));
    const all = t.segments.map((s) => s.text).join('');
    assert.match(all, /追及/); assert.match(t.segments.find((s) => s.who === 'student').text, /速度相等/);
    const st = t.segments.find((s) => s.who === 'student'); assert.ok(st.t0 > 11 && st.t0 < 13.5, '学生的话在第 12 秒左右 ' + st.t0);
    assert.ok(!('rms' in st) && !('lang' in st));
    const m = await meta(r.folder);
    assert.equal(m.transcript.phase, 'done'); assert.equal(m.transcript.count, t.segments.length); assert.equal(m.transcript.counts.student, 1);
    assert.equal(m.title, '追及相遇', '原来的字段不丢');
    assert.equal((await asr.handle('asr.transcript', r.id)).segments.length, t.segments.length);
    assert.equal(asr.view().current, null);
  });

  await ok('外放串音：学生的话也漏进了老师的麦克风，只记成学生说的一句', async () => {
    const r = await makeRecord(rec, 'echo', { voice: echo });
    asr.enqueue({ id: r.id, title: '追及相遇', folder: r.folder });
    await until(() => events.some((e) => e.type === 'asrDone' && e.record.id === r.id), 120000, '转写完成');
    const t = await transcript(r.folder), late = t.segments.filter((s) => s.t0 > 11);
    assert.equal(late.length, 1, JSON.stringify(t.segments)); assert.equal(late[0].who, 'student');
  });

  await ok('老录像没有双声道音轨：手动转写时用回放里的混音，说话人记「未区分」', async () => {
    const r = await makeRecord(rec, 'mixed', { mp4: mixed });
    await asr.handle('asr.transcribe', r.id);
    await until(() => events.some((e) => e.type === 'asrDone' && e.record.id === r.id), 120000, '转写完成');
    const t = await transcript(r.folder);
    assert.equal(t.split, 'mixed'); assert.ok(t.segments.length >= 2); assert.ok(t.segments.every((s) => s.who === 'unknown'));
    assert.match(t.segments.map((s) => s.text).join(''), /速度相等/);
  });

  await ok('搜原话：几个词都出现才算，能按学生筛，带时间和说话人', async () => {
    const hits = await asr.handle('asr.search', { q: '速度相等' });
    assert.ok(hits.length >= 3, JSON.stringify(hits));
    assert.ok(hits.every((h) => /速度相等/.test(h.text) && h.t0 > 11 && h.createdAt && h.title === '追及相遇'));
    assert.ok(hits.some((h) => h.who === 'student') && hits.some((h) => h.who === 'unknown'));
    assert.equal((await asr.handle('asr.search', { q: '速度相等 甲车' })).length, 0);
    assert.ok((await asr.handle('asr.search', { q: '甲车 匀速' })).length >= 2);
    assert.equal((await asr.handle('asr.search', { q: '速度相等', studentId: 'nobody' })).length, 0);
    assert.deepEqual(await asr.handle('asr.search', { q: '  ' }), []);
  });

  await ok('上课让路：转到一半开始录课就停下（不留半截结果），下课后从头转完；正在转的不能删', async () => {
    const r = await makeRecord(rec, 'pause', { voice });
    const seen = events.length;
    asr.enqueue({ id: r.id, title: '追及相遇', folder: r.folder });
    await until(() => asr.current?.id === r.id, 10000, '开始转写');
    assert.throws(() => asr.drop(r.id), /正在转写/);
    busy = true;
    await until(() => asr.view().paused, 20000, '停下');
    assert.equal(asr.view().current, null); assert.deepEqual(asr.view().queue, [r.id]);
    assert.ok(!fs.existsSync(path.join(r.folder, 'transcript.json')));
    assert.equal((await meta(r.folder)).transcript, undefined);
    assert.ok(!events.slice(seen).some((e) => e.type === 'asrDone'));
    await new Promise((res) => setTimeout(res, 800));
    assert.equal(asr.view().current, null, '上课时不开始');
    busy = false;
    await until(() => events.some((e) => e.type === 'asrDone' && e.record.id === r.id), 120000, '下课后转完');
    assert.equal((await meta(r.folder)).transcript.phase, 'done');
  });

  await ok('组件自检：模型能加载就通过，模型目录不对就报错', async () => {
    await asr.check({ addonDir: ADDON, modelDir: MODELDIR });
    await assert.rejects(() => asr.check({ addonDir: ADDON, modelDir: path.join(root, 'nope') }));
  });

  await ok('接着转：最近 7 天有双声道音轨、还没转（或上次转到一半）的才排队；关掉自动转写时不排', async () => {
    const a = await makeRecord(rec, 'r-new', { voice });
    const b = await makeRecord(rec, 'r-old', { voice, createdAt: new Date(Date.now() - 10 * 86400000).toISOString() });
    const c = await makeRecord(rec, 'r-novoice');
    const d = await makeRecord(rec, 'r-half', { voice });
    await rec.mergeMeta(d.folder, { transcript: { phase: 'running' } });
    const off = new Asr({ setup: ready, recording: rec, ffmpeg, enabled: () => false, busy: () => true, poll: 200 });
    assert.equal(await off.resumeRecent(), 0);
    const q = new Asr({ setup: ready, recording: rec, ffmpeg, busy: () => true, poll: 200 });
    assert.equal(await q.resumeRecent(), 2);
    assert.deepEqual(q.queue.map((x) => x.id).sort(), [a.id, d.id].sort());
    assert.ok(!q.queue.some((x) => x.id === b.id || x.id === c.id));
    q.queue = [];
  });

  console.log(`v160-asr: ${n} passed, ${skipped} skipped`);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => { if (!process.env.CS_KEEP) fs.rmSync(root, { recursive: true, force: true }); });
