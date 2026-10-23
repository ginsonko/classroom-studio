// 1.4.0 照片自动转正桌面验收（屏幕外窗口，Windows 自带 OCR）：
//   1. 本机 OCR 四个方向各认一遍：正的不转、横着的转 270°、倒着的转 180°、空白页看不出来交给模型；
//   2. AI 整理：横着拍的英语卷子，模型偏说「正的」——还是先转正，再把转正的图发给模型框题，切出来的题是正的；
//   3. 没配 AI：照片也转正再存。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v140-upright-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict'); const http = require('node:http');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v140u-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-w', name: '王荣浩', grade: '高二', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'english' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  allowedRoots: [out],
  local: { roots: [], students: [stu], studentId: 'stu-w', slots: [], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v140 upright desktop timed out'); app.exit(1); }, 300000);
const pngSize = (f) => { const b = fs.readFileSync(f); return b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null; };
const jpegSize = (b) => { let i = 2; while (i < b.length) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } return null; };

// 假模型：不管照片正不正都说 "up"（真实模型看横着的英文卷子常这样）
const sent = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'), all = JSON.stringify(j.messages || []);
    const img = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(all);
    if (img && all.includes('老师把一张图片交给你整理')) sent.push(jpegSize(Buffer.from(img[1], 'base64')));
    const content = all.includes('老师把一张图片交给你整理') ? JSON.stringify({ kind: 'graded', up: 'up', student: '王荣浩', subject: '英语', title: '英语阅读', questions: [
      { n: 31, boxes: [[40, 60, 960, 300]], mark: 'wrong' }, { n: 32, boxes: [[40, 320, 960, 560]], mark: 'right' }], parent: { summary: '', reschedule: '', requirement: '' } }) : '{}';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 600, completion_tokens: 120 } }));
  });
});

// 一页像样的英语阅读 + 中文题干（A4 竖版）
const PAGE = `(()=>{const c=document.createElement('canvas');c.width=1240;c.height=1754;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#111';
const en=['The team found that the person\\'s posture, whether sitting, standing or lying down, had','an effect on the results. They also found that the system had to be close to the body,','because the signal became weaker at longer distances. What we found was that people','who wanted to make sure the readings were correct should stay still for a few minutes.','31. What does the underlined word "suppress" in the passage mean?','A. Analyze.   B. Disturb.   C. Increase.   D. Prevent.','32. What is the best title for the text according to the passage?','A. The number of participants.   B. The duration of monitoring.','The other thing was position. All of the different results show that this is the','most important part of the study, and we are now ready for the next step of the work.'];
const zh=['阅读下面短文，从每题所给的四个选项中选出最佳选项，并在答题卡上将该项涂黑。','第二节 完形填空（共 15 小题；每小题 1 分，满分 15 分）','根据短文内容，判断下列说法是否正确，正确的写 T，错误的写 F。'];
let y=110;g.font='bold 34px "Times New Roman"';g.fillText('Part III  Reading Comprehension',70,y);y+=70;
for(let k=0;k<3;k++){g.font='26px "Microsoft YaHei"';g.fillText(zh[k%zh.length],70,y);y+=52;g.font='27px "Times New Roman"';for(const l of en){g.fillText(l,70,y);y+=44;}y+=24;}
return c.toDataURL('image/png')})()`;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1300, height: 860 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };

  // 正的一页，再做出横着（顺时针转 90°）、倒着、空白三张照片
  const upright = await call(teacher, PAGE);
  const files = {};
  for (const [name, deg] of [['upright', 0], ['side', 90], ['down', 180]]) {
    const url = await T(`const img=new Image();img.src=${JSON.stringify(upright)};await img.decode();const p={src:img,w:img.naturalWidth,h:img.naturalHeight};const q=Q.qimport.turnPage(p,${deg});const c=document.createElement('canvas');c.width=q.w;c.height=q.h;c.getContext('2d').drawImage(q.src,0,0);return c.toDataURL('image/jpeg',.9)`);
    files[name] = path.join(out, `英语卷-${name}.jpg`); fs.writeFileSync(files[name], Buffer.from(url.split(',')[1], 'base64'));
  }
  files.blank = path.join(out, 'blank.png'); fs.writeFileSync(files.blank, electron.nativeImage.createFromBitmap(Buffer.alloc(600 * 800 * 4, 255), { width: 600, height: 800 }).toPNG());

  // 1. 本机 OCR 看方向
  const t0 = Date.now();
  const turns = {};
  for (const k of ['upright', 'side', 'down', 'blank']) turns[k] = await T(`const p=await Q.qimport.pageOfImage(${JSON.stringify(files[k])});try{return await Q.qimport.ocrTurn(p)}finally{p.close?.()}`);
  const ms = Math.round((Date.now() - t0) / 4);
  assert.deepEqual(turns, { upright: 0, side: 270, down: 180, blank: null });
  mark('local OCR tells the page direction: upright 0, sideways 270, upside-down 180, blank page undecided', { turns, msPerPage: ms });

  // 2. AI 整理：横着的卷子，模型说「正的」
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  await T(`Q.sort.openSort({paths:[${JSON.stringify(files.side)}]});return true`);
  await until(() => T(`return Q.sort.useSort.getState().items.length===1`), 5000, 'photo added');
  await T(`await Q.sort.analyze();return true`);
  await until(() => T(`return Q.sort.useSort.getState().phase==='review'`), 60000, 'sort review');
  const an = (await T(`return Q.sort.useSort.getState().analyses`))[0];
  assert.equal(an.kind, 'graded'); assert.equal(an.turn, 270, JSON.stringify(an));
  assert.equal(sent.length, 1, '转正以后只问了模型一次');
  assert.ok(sent[0] && sent[0].h > sent[0].w, '发给模型的是转正后的竖版：' + JSON.stringify(sent[0]));
  await T(`await Q.sort.archive();return true`);
  await until(() => T(`return Q.sort.useSort.getState().phase==='done'`), 30000, 'archived');
  const rec = await T(`return Q.sort.useSort.getState().record`);
  const imgs = await T(`const d=Q.useStudy.getState().data,r=${JSON.stringify(rec)};return d.questions.filter(q=>r.questions.includes(q.id)).map(q=>q.image)`);
  assert.equal(imgs.length, 2);
  for (const f of imgs) { const sz = pngSize(f); assert.ok(sz && sz.w / sz.h < 3.5 && sz.w > sz.h, '切出来的题是正着的横条：' + JSON.stringify(sz)); }
  fs.copyFileSync(imgs[0], path.join(out, 'crop-31.png'));
  mark('AI 整理: sideways English paper is turned upright before the model boxes questions, even though the model says it is upright', { sent: sent[0] });

  // 3. 没配 AI：照片也转正再存
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:'',model:'',visionModel:'',key:''});return true`);
  await T(`Q.sort.openSort({paths:[${JSON.stringify(files.down)}]});return true`);
  await until(() => T(`const u=Q.sort.useSort.getState();return u.phase==='collect'&&u.items.length===1`), 5000, 'photo added (no AI)');
  await T(`await Q.sort.analyze();return true`);
  await until(() => T(`return Q.sort.useSort.getState().phase==='review'`), 60000, 'review (no AI)');
  const an2 = (await T(`return Q.sort.useSort.getState().analyses`))[0];
  assert.deepEqual([an2.kind, an2.turn], ['photo', 180]);
  mark('without AI, an upside-down photo is still saved upright', {});

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length}/3 passed · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
})().catch((e) => { console.error(e); console.error('errors:', errors.slice(-8)); clearTimeout(timer); app.exit(1); });
