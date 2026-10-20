// 课堂动画接入桌面验收（假模型服务）：
// 看样片（不用模型）→ 封面点播放 → 引擎实时播放、跳镜头；
// 一句话出动画：第 1 版用了不存在的部件被校验挡下 → 第 2 版通过 → 试渲染联系表发给模型审片 → 通过；
// 同一时间只保留一个播放中的片子；导出 MP4 → 我先看 / 上屏（学生端 1080p 播放）→ 另存为；存档里找得回来；做的过程中取消立即停止。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v120-motion-ai-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'motion-ai-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-w', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'stu-w', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('motion ai desktop timed out'); app.exit(1); }, 420000);

const GOOD = { understand: '光从空气斜射入水中时向法线偏折，入射角大于折射角', plan: '开场点题；光路图演示折射', film: { title: '光的折射', shots: [
  { name: '开场', dur: 3, bg: 'deep', items: [{ type: 'title', text: '光的折射', sub: '空气 → 水' }] },
  { name: '光路', dur: 3.5, bg: 'blueprint', items: [
    { type: 'shape', kind: 'line', points: [[960, 160], [960, 920]], dash: true, color: '#8fb3ff' },
    { type: 'shape', kind: 'line', points: [[300, 540], [1620, 540]], color: '#4c9dff' },
    { type: 'tracer', points: [[560, 180], [960, 540], [1180, 900]], color: '#ffd166' },
    { type: 'caption', text: '折射光线偏向法线：入射角 > 折射角' },
  ] },
] } };
const BAD = { ...GOOD, film: { ...GOOD.film, shots: [GOOD.film.shots[0], { ...GOOD.film.shots[1], items: [{ type: 'laser', from: [0, 0] }] }] } };
let mode = 'normal', motionReqs = [], reviewReqs = [], hold = null;
const text = (m) => (typeof m === 'string' ? m : Array.isArray(m) ? m.map((x) => x.text || '').join('') : '');
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const j = JSON.parse(body || '{}');
    const sys = text(j.messages?.[0]?.content), last = text(j.messages?.at(-1)?.content);
    let content = '{}';
    if (sys.includes('课堂动画导演')) {
      if (last.includes('已经渲染')) { reviewReqs.push(j); content = JSON.stringify({ accept: true, why: '光路清楚，字幕不挡画面' }); }
      else {
        motionReqs.push(j);
        if (mode === 'slow') await new Promise((r) => { hold = r; setTimeout(r, 6000); });
        content = mode === 'normal' && motionReqs.length === 1 ? JSON.stringify(BAD) : '```json\n' + JSON.stringify({ ...GOOD, fix: '去掉不存在的 laser，改用 tracer 画光路' }) + '\n```';
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 3000, completion_tokens: 600 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const typeAsk = (t) => T(`const el=document.querySelector('.ai-compose textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(t)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const card = (sel) => `[...document.querySelectorAll('.ai-card.k-motion')].find(c=>${sel})`;
  const SAMPLE = card(`c.innerText.includes('一节课的宇宙')`), MINE = card(`c.innerText.includes('光的折射')`);
  const btn = (c, label) => T(`const c=${c};[...c.querySelectorAll('button')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click();return true`);

  // ── 1. 没配模型：课堂动画灰着并说明原因，但「看样片」能用 ──
  await T(`localStorage.setItem('cs.ai.screen','0');s.set({page:'console',aiOpen:true});return true`);
  const off = await until(() => T(`const b=document.querySelector('.ai-act.a-motion');return b?{dis:b.disabled,tip:b.dataset.tip}:null`), 8000, 'motion action');
  assert.equal(off.dis, true); assert.match(off.tip, /配置模型[\s\S]*看样片/);
  await T(`document.querySelector('.mv-sample').click();return true`);
  await until(() => T(`return !!${SAMPLE}?.querySelector('.mv-stage.poster .mv-big')`), 5000, 'sample card poster');
  await T(`${SAMPLE}.querySelector('.mv-big').click();return true`);
  await until(() => T(`const c=${SAMPLE};return !!c.querySelector('.mv-stage canvas.mv-canvas')&&/^0:0[1-9]/.test(c.querySelector('.mv-time').innerText)`), 60000, 'sample plays')
    .catch(async (e) => { throw Error(e.message + ' :: ' + await T(`return ${SAMPLE}.querySelector('.mv-time').innerText`)); });
  await T(`const c=${SAMPLE};[...c.querySelectorAll('.mv-shots button')][4].click();return true`);
  const jump = await until(() => T(`const c=${SAMPLE},b=c.querySelector('.mv-shots button.on');return b&&!b.innerText.startsWith('1.')?{on:b.innerText,time:c.querySelector('.mv-time').innerText}:null`), 5000, 'shot jump');
  assert.match(jump.on, /^5\./); assert.match(jump.time, /^\d:\d\d \/ 1:2\d$/);
  await T(`${SAMPLE}.querySelector('.mv-bar button').click();return true`); // 暂停
  await T(`${SAMPLE}.querySelector('.mv').scrollIntoView({block:'center'});return true`);
  await shot(teacher, 'motion-1-sample.png', 600);
  assert.equal(await T(`return !${SAMPLE}.innerText.includes('让 AI 重新做一版')`), true, 'sample has no retry');
  mark('without a model: 课堂动画 disabled with a reason; 看样片 plays the 88 s showcase live and jumps between shots', jump);

  // ── 2. 一句话出动画：校验挡下坏版本 → 修好 → 试渲染 → 看图审片通过 ──
  // 配好模型（和「一键导入」一样发 cs-ai-config），面板不用重开、样片卡片还在
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});dispatchEvent(new Event('cs-ai-config'));return true`);
  await until(() => T(`const b=document.querySelector('.ai-act.a-motion');return b&&!b.disabled`), 10000, 'motion action enabled');
  if (await T(`return !!document.querySelector('.ai-cfg')`)) await T(`document.querySelector('.ai-ico[aria-label="AI 设置"]').click();return true`);
  assert.equal(await T(`return !!${SAMPLE}`), true, 'sample card still there');
  await typeAsk('光的折射：从空气斜射入水中');
  await T(`document.querySelector('.ai-act.a-motion').click();return true`);
  await until(() => T(`return !!document.querySelector('.ai-card.k-motion.pending .ai-manim.busy')`), 6000, 'motion card busy');
  assert.equal(await T(`return document.querySelector('.ai-act.a-motion').disabled`), true, 'one motion job at a time');
  assert.equal(await T(`return document.querySelector('.ai-act.a-ask').disabled`), false, 'other actions stay usable');
  const done = await until(() => T(`const c=${MINE};return c&&!c.classList.contains('pending')?{text:c.innerText,sheet:c.querySelector('.mv-stage.poster img')?.src||''}:null`), 120000, 'motion done');
  assert.equal(motionReqs.length, 2); assert.equal(reviewReqs.length, 1);
  assert.match(done.text, /已试看审片/); assert.match(done.text, /2 个镜头 · 7 秒/); assert.match(done.text, /向法线偏折/);
  assert.ok(done.sheet.startsWith('data:image/jpeg;base64,') && done.sheet.length > 30000, 'contact sheet on the poster ' + done.sheet.length);
  const fixMsg = text(motionReqs[1].messages.at(-1).content);
  assert.match(fixMsg, /没通过引擎的校验/); assert.match(fixMsg, /laser/);
  assert.equal(motionReqs[0].model, 'fake-text');
  const rv = reviewReqs[0], rvLast = rv.messages.at(-1).content;
  assert.equal(rv.model, 'fake-vision', 'review uses the vision model');
  assert.ok(Array.isArray(rvLast) && rvLast.some((p) => p.type === 'image_url' && /^data:image\/jpeg/.test(p.image_url.url)), 'review sees the contact sheet');
  assert.match(text(rvLast), /「光路」/);
  await btn(MINE, '制作过程');
  const log = await T(`return ${MINE}.querySelector('.ai-manim-steps').innerText`);
  for (const re of [/第 1 版没通过校验/, /AI 修改：去掉不存在的 laser/, /第 2 版分镜：光的折射 · 2 个镜头/, /试渲染完成/, /审片通过/]) assert.match(log, re);
  await T(`${MINE}.querySelector('.mv').scrollIntoView({block:'start'});return true`);
  await shot(teacher, 'motion-2-made.png');
  mark('one sentence → storyboard: bad part rejected by the checker, fixed version rendered to a contact sheet, reviewed by the vision model and accepted', { log: log.split('\n').length });

  // ── 3. 同一时间只有一个片子在引擎里：点开新的，样片自动收起 ──
  await T(`${MINE}.querySelector('.mv-big').click();return true`);
  await until(() => T(`return !!${MINE}.querySelector('canvas.mv-canvas')`), 30000, 'mine loads');
  assert.equal(await T(`return document.querySelectorAll('canvas.mv-canvas').length`), 1, 'only one live film');
  assert.equal(await T(`return !!${SAMPLE}.querySelector('.mv-stage.poster')`), true, 'sample went back to its poster');
  await until(() => T(`return /^0:06 \\/ 0:06$/.test(${MINE}.querySelector('.mv-time').innerText)&&!!${MINE}.querySelector('.mv-big.ghost')`), 15000, 'mine plays to the end');
  mark('only one film holds a WebGL context; opening another returns the previous one to its poster');

  // ── 4. 导出 MP4 → 我先看 / 上屏 → 另存为 ──
  await btn(MINE, '导出 MP4');
  await until(() => T(`return /正在导出 MP4/.test(${MINE}.innerText)`), 10000, 'exporting');
  await until(() => T(`return !!${MINE}.querySelector('.ai-sub')`), 120000, 'export done');
  const sub = await T(`return ${MINE}.querySelector('.ai-sub').innerText`);
  assert.match(sub, /已导出 [\d.]+ (MB|KB)/);
  await T(`[...${MINE}.querySelectorAll('.ai-sub button')].find(b=>b.innerText.includes('我先看')).click();return true`);
  const mat = await until(() => T(`const m=s.reader.mat;return m.kind==='video'?m:null`), 8000, 'video in preview');
  assert.equal(mat.title, '课堂动画 · 光的折射');
  assert.ok(/[\\/]motion[\\/]光的折射-\d+\.mp4$/.test(mat.path) && fs.existsSync(mat.path), mat.path);
  const mp4 = fs.readFileSync(mat.path);
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp'); assert.ok(mp4.length > 200000, 'size ' + mp4.length);
  await T(`[...${MINE}.querySelectorAll('.ai-sub button')].find(b=>b.innerText.includes('上屏')).click();return true`);
  const sv = await until(() => S(`const v=document.querySelector('video');return s.pgmMat.kind==='video'&&v&&v.readyState>=1?{d:v.duration,w:v.videoWidth,h:v.videoHeight}:null`), 15000, 'student plays the video');
  assert.ok(sv.w === 1920 && sv.h === 1080 && sv.d > 6 && sv.d < 7.5, JSON.stringify(sv));
  // 学生端真的解出了画面：跳到 4.5 秒截窗口，中间区域看亮度（蓝图背景 + 光路，不能是全黑）
  // lesson:// 要按 Range 回 206，否则视频不能拖进度（以前所有本地视频都有这个问题）
  const rg = await S(`const v=document.querySelector('video'),u=v.currentSrc,one=async(h)=>{const r=await fetch(u,{headers:{Range:h}});const b=new Uint8Array(await r.arrayBuffer());return {st:r.status,cr:r.headers.get('content-range'),len:b.length,b4:[...b.slice(0,8)].join(',')}};return {a:await one('bytes=0-7'),b:await one('bytes=1000-1999'),c:await one('bytes=-100'),d:await one('bytes=999999999-'),seekable:v.seekable.length?v.seekable.end(0):0}`);
  const size = mp4.length;
  assert.deepEqual(rg.a, { st: 206, cr: `bytes 0-7/${size}`, len: 8, b4: [...mp4.subarray(0, 8)].join(',') });
  assert.equal(rg.b.st, 206); assert.equal(rg.b.cr, `bytes 1000-1999/${size}`); assert.equal(rg.b.len, 1000); assert.equal(rg.b.b4, [...mp4.subarray(1000, 1008)].join(','));
  assert.equal(rg.c.cr, `bytes ${size - 100}-${size - 1}/${size}`); assert.equal(rg.c.len, 100);
  assert.equal(rg.d.st, 416);
  assert.ok(rg.seekable > 6, 'video is seekable: ' + rg.seekable);
  const vs = await S(`const v=document.querySelector('video');v.pause();await new Promise(r=>{v.addEventListener('seeked',r,{once:true});v.currentTime=4.5});await new Promise(r=>setTimeout(r,600));return {t:v.currentTime}`);
  assert.ok(Math.abs(vs.t - 4.5) < 0.05, 'seek holds: ' + vs.t);
  await shot(student, 'motion-3-student.png', 1200);
  const img = (await student.webContents.capturePage()).crop({ x: 200, y: 100, width: 600, height: 300 }), bmp = img.toBitmap();
  let sum = 0, max = 0; for (let i = 0; i < bmp.length; i += 4) { const l = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3; sum += l; max = Math.max(max, l); }
  const lum = { avg: +(sum / (bmp.length / 4)).toFixed(1), max };
  assert.ok(lum.avg > 12 && lum.max > 120, 'student frame looks empty ' + JSON.stringify(lum));
  const copy = path.join(out, '我的光的折射.mp4');
  const saved = await T(`return await window.csHost.call('motion.saveAs',{path:${JSON.stringify(mat.path)},title:'光的折射',to:${JSON.stringify(copy)}})`);
  assert.equal(path.resolve(saved), path.resolve(copy)); assert.equal(fs.statSync(copy).size, mp4.length);
  const outside = await T(`try{await window.csHost.call('motion.saveAs',{path:${JSON.stringify(copy)},to:${JSON.stringify(copy + '.x')}});return 'no'}catch(e){return e.message}`);
  assert.match(outside, /找不到导出的视频/);
  const junk = await T(`try{await window.csHost.call('motion.save',{data:new Uint8Array(4096),title:'x'});return 'no'}catch(e){return e.message}`);
  assert.match(junk, /视频数据无效/);
  await T(`${MINE}.querySelector('.ai-sub').scrollIntoView({block:'center'});return true`);
  await shot(teacher, 'motion-4-exported.png');
  mark('export writes a 1080p MP4 to the cache; 我先看 / 上屏 play it as a video (student 1920×1080); 另存为 copies it; invalid data and paths are refused', { MB: +(mp4.length / 1048576).toFixed(2), ...sv });

  // ── 5. 存档：历史记录里有课堂动画，封面是联系表，放回面板还能播放 ──
  await T(`document.querySelector('.ai-ico[aria-label="历史记录"]').click();return true`);
  const hist = await until(() => T(`const i=document.querySelector('.ai-hist-i.k-motion');return i?{text:i.innerText,thumb:i.querySelector('img')?.src||''}:null`), 10000, 'archive entry');
  assert.match(hist.text, /光的折射/); assert.ok(hist.thumb && !hist.thumb.startsWith('data:'), 'sheet stored as a file: ' + hist.thumb.slice(0, 80));
  await T(`[...document.querySelectorAll('.ai-hist-f button')].find(b=>b.innerText==='课堂动画').click();return true`);
  await until(() => T(`const l=[...document.querySelectorAll('.ai-hist-i')];return l.length===1&&l[0].classList.contains('k-motion')`), 8000, 'filter by 课堂动画');
  await T(`document.querySelector('.ai-hist-i.k-motion .ai-hist-main').click();return true`);
  await until(() => T(`const c=document.querySelector('.ai-feed .ai-card.k-motion');return c&&c.innerText.includes('光的折射')&&!!c.querySelector('.mv-stage.poster img')?.complete`), 10000, 'restored card');
  const restored = await T(`const c=document.querySelector('.ai-feed .ai-card.k-motion');return {img:c.querySelector('.mv-stage.poster img').naturalWidth,ok:c.innerText.includes('已试看审片')}`);
  assert.ok(restored.img > 1000 && restored.ok, JSON.stringify(restored));
  mark('archive keeps the film with its contact sheet; 课堂动画 filter works; restoring puts a playable card back', restored);

  // ── 6. 做的过程中取消：卡片马上停，不再请求模型 ──
  mode = 'slow';
  await T(`document.querySelector('.ai-act.a-motion').click();return true`);
  await until(() => T(`return !!document.querySelector('.ai-card.k-motion.pending')`), 6000, 'second job');
  await until(() => motionReqs.length === 3, 10000, 'request sent');
  await T(`[...document.querySelector('.ai-card.k-motion.pending').querySelectorAll('button')].find(b=>b.innerText.includes('取消')).click();return true`);
  const cancelled = await until(() => T(`const c=document.querySelector('.ai-feed .ai-card.k-motion');return c&&!c.classList.contains('pending')?c.innerText:null`), 3000, 'cancel is immediate');
  assert.match(cancelled, /已取消/);
  hold?.(); await sleep(2500);
  assert.equal(motionReqs.length, 3, 'no more requests after cancel'); assert.equal(reviewReqs.length, 1);
  assert.equal(await T(`return document.querySelector('.ai-act.a-motion').disabled`), false, 'can start again');
  mark('cancel stops the job at once and makes no further model calls');

  const bad = errors.filter((e) => !/Autofill|DevTools|WebGL|GPU|swiftshader|Automatic fallback|fallback to software/i.test(e));
  assert.deepEqual(bad, [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log(`RESULT v120-motion-ai-desktop ${results.length}/${results.length}`); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
