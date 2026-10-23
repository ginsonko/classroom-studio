// 1.3.0 桌面验收（屏幕外窗口，不动真实鼠标）：
//   1. 拍照的卷子：没配 AI 原样存一张（不出乱码题干、不能直接入库）；配好 AI 后「AI 识别未整理的题」按题框出来、逐题截图、识题；
//      配着 AI 直接导入照片就按题拆；
//   2. 收件箱 / 题库：单题删除、多选删除、10 秒内撤销；「撤回这次导入」整批删除；
//   3. AI 助手：回车发送，输入法组字和 Shift+回车不发；说「做插件」提示去 AI 工坊并带上要求；
//   4. 黑板：双击文字原地修改（笔、选择工具都行），清空就删除；单击文字照常落笔；
//   5. 贴图：连贴两张不重叠；浮层「编辑选中内容」里左转 / 右转 / 翻转 / 恢复原样，学生画面同步；
//   6. 插件图形「去绘图库」：导播台发命令，浮层打开绘图库；
//   7. 绘图库新图形：正棱台、空间直角坐标系；
//   8. 板书存 PDF：A4 排版、长黑板分页、打印省墨版；
//   9. 定制工具栏：预设、右键打开、各窗口同步、每组记住上次用的；
//  10. AI 整理：批改过的卷子照片 + 家长消息 → 整理单 → 归档 → 补记没认准的题 → 调课提醒 → 整批撤销；
//  11. 上课彩排：5 分钟路线、接着走完整版（做过的跳过）、每步按真实操作打勾、引导卡避开 AI 抽屉和对话框、退出清掉练习数据。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v130-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict'); const http = require('node:http');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v130-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [stu], studentId: 'stu-w', slots: [], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
// 「导入 Word / PDF / 图片」的选文件对话框：测试里直接给文件
let pickFiles = [];
electron.dialog.showOpenDialog = async () => ({ canceled: !pickFiles.length, filePaths: pickFiles });
// 彩排里点「存成 PDF」走真正的保存对话框：测试里直接给位置
let saveTo = '';
electron.dialog.showSaveDialog = async () => ({ canceled: !saveTo, filePath: saveTo });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v130 desktop timed out'); app.exit(1); }, 420000);
const pngSize = (f) => { const b = fs.readFileSync(f); return b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null; };

// 假模型：照片框题、看图识题、自检、问答
const requests = [];
function reply(j) {
  const all = JSON.stringify(j.messages);
  // AI 整理：批改过的卷子照片、家长消息
  if (all.includes('老师把一张图片交给你整理')) return JSON.stringify({ kind: 'graded', student: '王荣浩', subject: '物理', title: '10 月月考 第 1 页', questions: [
    { n: 1, boxes: [[40, 70, 960, 320]], mark: 'wrong' }, { n: 2, boxes: [[40, 350, 960, 610]], mark: 'right' }, { n: 3, boxes: [[40, 640, 960, 900]], mark: 'unsure' }], parent: { summary: '', reschedule: '', requirement: '' } });
  if (all.includes('老师粘贴给你一段文字')) return JSON.stringify({ kind: 'chat', student: '荣浩', subject: '', title: '荣浩妈妈的消息', parent: { summary: '想把下周三的课改到晚上 7 点，希望多练计算题', reschedule: '下周三的课改到晚上 7 点', requirement: '多练练计算题' }, questions: [] });
  if (all.includes('0~1000')) return JSON.stringify({ questions: [
    { n: 1, boxes: [[40, 70, 960, 320]] }, { n: 2, boxes: [[40, 350, 960, 610]] }, { n: 3, boxes: [[40, 640, 960, 900]] }] });
  if (all.includes('审题老师')) return JSON.stringify({ issue: '', answer: '5 m' });
  if (all.includes('知识点清单')) return JSON.stringify({ stem: '照片里读出的题：物体从静止下落 1 s，求下落高度（g 取 10 m/s²）。', answer: '5 m', analysis: 'h = gt²/2', points: [], difficulty: 2, qtype: '计算' });
  return '牛顿第二定律：物体加速度与所受合力成正比、与质量成反比。';
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: reply(j) } }], usage: { prompt_tokens: 600, completion_tokens: 120 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),S=Q.useStudy.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), ST = run(student, 'student');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const qs = () => T(`return Q.useStudy.getState().data.questions`);
  await until(() => T(`return S.loaded`), 8000, 'study loaded');

  // ── 1. 拍照的卷子 ──
  // 手机照片：4:3 大 JPEG，纸张偏灰、有阴影
  const photoData = await T(`const c=document.createElement('canvas');c.width=3000;c.height=4000;const g=c.getContext('2d');
    const gr=g.createLinearGradient(0,0,3000,4000);gr.addColorStop(0,'#e8e4dc');gr.addColorStop(1,'#bdb8ae');g.fillStyle=gr;g.fillRect(0,0,3000,4000);
    g.fillStyle='#1b1b1b';g.font='bold 92px "Microsoft YaHei"';
    ['1. 物体从静止开始下落，1 s 内下落多高？','2. 汽车以 10 m/s 匀速行驶 5 s，位移多大？','3. 质量 2 kg 的物体受 4 N 合力，加速度多大？'].forEach((t,i)=>{g.fillText(t,160,450+i*1100);g.strokeStyle='#333';g.lineWidth=6;g.strokeRect(1900,600+i*1100,700,420);});
    return c.toDataURL('image/jpeg',0.88)`);
  const photo = path.join(out, '卷子照片.jpg'), photo2 = path.join(out, '卷子照片2.jpg');
  fs.writeFileSync(photo, Buffer.from(photoData.split(',')[1], 'base64')); fs.copyFileSync(photo, photo2);
  // 文件要经过选文件对话框授权才读得到
  const imp = (p) => { pickFiles = p; return T(`const r=await Q.qimport.importFiles(await Q.host.call('study.pickImport'),'physics');return {added:r.added.map(q=>({id:q.id,stem:q.stem,image:q.image,needsAi:q.needsAi,batch:q.batch,source:q.source})),photos:r.photos,batch:r.batch,ai:r.ai,files:r.files}`); };
  const r1 = await imp([photo]);
  assert.equal(r1.ai, false, JSON.stringify(r1)); assert.equal(r1.photos, 1, JSON.stringify(r1)); assert.equal(r1.added.length, 1, JSON.stringify(r1));
  const p1 = r1.added[0];
  assert.equal(p1.stem, '', 'no garbled OCR stem'); assert.equal(p1.needsAi, true); assert.equal(p1.batch, r1.batch);
  assert.ok(fs.statSync(p1.image).size > 20000 && /\.jpg$/.test(p1.image), 'photo stored as JPEG');
  await T(`s.set({page:'study'});return true`);
  await until(() => T(`return [...document.querySelectorAll('.sd-q')].some(r=>r.innerText.includes('拍照的卷子'))`), 6000, 'photo row');
  assert.ok(await T(`const r=[...document.querySelectorAll('.sd-q')].find(r=>r.innerText.includes('拍照的卷子'));return r.querySelector('.btn-cue').disabled`), '入库 disabled for an unsplit photo');
  await click('.sd-bar .sd-btn', '全部入库');
  assert.equal((await qs()).find((q) => q.id === p1.id).status, 'inbox', '全部入库 skips the photo');
  await shot(teacher, 'v130-1-photo-noai.png');
  mark('photo exam without AI: stored as one image, empty stem (no garbled text), can not be banked by accident');

  // 撤回这次导入：走真实的导入按钮 + 结果条
  pickFiles = [photo2];
  await click('.sd-bar .sd-btn', '导入 Word');
  const bar = await until(() => T(`const b=document.querySelector('.sd-import');return b&&b.innerText.includes('导入 1 道题')?b.innerText:null`), 15000, 'import report');
  assert.match(bar, /拍照的卷子/); assert.match(bar, /去配置 AI/);
  assert.equal((await qs()).filter((q) => q.needsAi).length, 2);
  await click('.sd-undo-import');
  await until(async () => (await qs()).filter((q) => q.needsAi).length === 1, 4000, 'batch withdrawn');
  assert.ok(await T(`return Q.useToast.getState().list.some(t=>/这次导入/.test(t.message))`), 'withdraw toast');
  mark('withdraw this import removes exactly the questions of that batch', { bar: bar.replace(/\s+/g, ' ').slice(0, 120) });

  // 配好 AI：AI 识别未整理的题 → 照片拆成 3 题、逐题截图、看图识题
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  await click('.sd-bar .sd-btn', 'AI 识别未整理的题');
  const split = await until(async () => { const a = (await qs()).filter((q) => /卷子照片 第 \d 题/.test(q.source || '')); return a.length === 3 && a.every((q) => q.stem && q.check) ? a : null; }, 30000, 'photo split by AI');
  assert.ok(!(await qs()).some((q) => q.id === p1.id), 'original photo replaced');
  assert.ok(split.every((q) => q.batch === p1.batch && q.status === 'inbox' && !q.needsAi));
  const boxReq = requests.find((j) => JSON.stringify(j.messages).includes('0~1000'));
  assert.equal(boxReq.model, 'fake-vision'); assert.ok(JSON.stringify(boxReq.messages).includes('data:image/jpeg'), 'photo sent as JPEG');
  for (const [i, q] of split.entries()) {
    const sz = pngSize(q.image); assert.ok(sz && sz.w > 1500 && sz.h < sz.w * 0.6, 'one question per crop: ' + JSON.stringify(sz));
    fs.copyFileSync(q.image, path.join(out, `v130-crop-${i + 1}.png`));
  }
  assert.ok(split.every((q) => q.check === 'ok'), 'self-check ran');
  mark('with AI: the stored photo is split into one cropped image per question, then read and self-checked', { sources: split.map((q) => q.source) });

  // 配着 AI（自动识题开着）直接导入照片
  await T(`localStorage.setItem('cs.study.autoRead','1');return true`);
  const r2 = await imp([photo2]);
  assert.equal(r2.ai, true); assert.equal(r2.photos, 0); assert.equal(r2.added.length, 3, JSON.stringify(r2.files));
  assert.ok(r2.added.every((q) => !q.needsAi && q.batch === r2.batch && /卷子照片2 第 \d 题/.test(q.source)));
  mark('importing a photo with AI on splits it right away');

  // ── 2. 删除 / 多选删除 / 撤销 ──
  await T(`for(const id of Q.useStudy.getState().data.questions.map(q=>q.id))Q.studyStore.removeQuestions([id]);
    for(const t of ['甲题：求加速度','乙题：求位移','丙题：求速度','丁题：求时间'])Q.studyStore.addQuestion({stem:t,points:[],difficulty:2,qtype:'计算',origin:'manual',status:'inbox',subject:'physics'});return true`);
  await until(() => T(`return document.querySelectorAll('.sd-q').length===4`), 4000, '4 rows');
  await T(`const r=[...document.querySelectorAll('.sd-q')].find(r=>r.innerText.includes('甲题'));r.querySelector('.sd-del').click();return true`);
  await until(async () => (await qs()).length === 3, 3000, 'deleted one');
  await T(`[...document.querySelectorAll('.toast button')].filter(b=>b.innerText==='撤销').at(-1).click();return true`);
  await until(async () => (await qs()).length === 4, 3000, 'undo one');
  // 勾两道（第二道按住 Shift 连选到第三道）→ 删除所选
  await T(`const rows=[...document.querySelectorAll('.sd-q')];rows[0].querySelector('.sd-pick').click();return true`);
  await T(`const rows=[...document.querySelectorAll('.sd-q')];rows[2].querySelector('.sd-pick').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));return true`);
  const picked = await until(() => T(`const b=document.querySelector('.sd-pickbar');return b?b.innerText:null`), 3000, 'pick bar');
  assert.match(picked, /已选 3 题/);
  await click('.sd-pickbar .sd-btn', '删除所选');
  await until(async () => (await qs()).length === 1, 3000, 'deleted 3');
  await shot(teacher, 'v130-2-deleted.png', 100);
  await T(`[...document.querySelectorAll('.toast button')].filter(b=>b.innerText==='撤销').at(-1).click();return true`);
  await until(async () => (await qs()).length === 4, 3000, 'undo 3');
  mark('inbox: delete one, shift-range pick + delete selected, undo restores');

  // ── 3. AI 助手回车发送 ──
  await T(`s.set({page:'console',aiOpen:true});return true`);
  const ta = '.ai-compose textarea';
  await until(() => T(`return !!document.querySelector('${ta}')`), 5000, 'ai panel');
  const setTa = (v) => T(`const el=document.querySelector('${ta}');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const key = (o) => T(`document.querySelector('${ta}').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,...${JSON.stringify(o)}}));return true`);
  await setTa('牛顿第二定律是什么？');
  const n0 = requests.length;
  await key({ isComposing: true }); await key({ shiftKey: true }); await sleep(600);
  assert.equal(requests.length, n0, 'IME composition and Shift+Enter do not send');
  await key({});
  await until(() => requests.length > n0 && JSON.stringify(requests.at(-1).messages).includes('牛顿第二定律是什么'), 8000, 'enter sends');
  await setTa('帮我做一个画棱台的插件');
  await until(() => T(`return !!document.querySelector('.ai-plugin-hint')`), 3000, 'plugin hint');
  const n1 = requests.length;
  await key({});
  // AI 工坊打开就把要求接走（workshop 清空），要求写进新任务的说明里
  await until(() => T(`return Q.useStore.getState().page==='agents'&&[...document.querySelectorAll('textarea')].some(t=>t.value.includes('老师的要求：帮我做一个画棱台的插件'))`), 6000, 'go to workshop with the ask');
  assert.equal(requests.length, n1, 'plugin request is not sent to chat');
  mark('AI panel: Enter sends, IME / Shift+Enter do not; "make a plugin" goes to the workshop with the request');

  // ── 4. 双击文字原地修改 ──
  await T(`s.set({page:'console',aiOpen:false});s.focusWin('board');s.clearInk(Q.inkKey('board',0));s.setShared({tool:'pen'});
    s.addStroke(Q.inkKey('board',0),{id:'t1',tool:'text',color:'#ffffff',size:4,pts:[.3,.2,.5],text:'原来的字',author:'teacher',layer:'public'});return true`);
  const ink = () => T(`return Q.useStore.getState().ink[Q.inkKey('board',0)]||[]`);
  const box = await until(() => T(`const c=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).filter(r=>r.width>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return c?{x:c.x,y:c.y,w:c.width,h:c.height}:null`), 5000, 'canvas');
  const P = (x, y) => [Math.round(box.x + box.w * x), Math.round(box.y + box.h * (y / 0.5625))];
  const tap = async ([x, y], count = 1) => { teacher.webContents.sendInputEvent({ type: 'mouseMove', x, y }); teacher.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: count }); await sleep(30); teacher.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: count }); };
  const dbl = async (p) => { await tap(p, 1); await sleep(120); await tap(p, 2); };
  const onText = P(.33, .215);
  const editBox = () => until(() => T(`const el=document.querySelector('textarea.ink-text.editing');return el?el.value:null`), 3000, 'edit box');
  const typeEdit = (v) => T(`const el=document.querySelector('textarea.ink-text.editing');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));return true`);
  await dbl(onText);
  assert.equal(await editBox(), '原来的字');
  await shot(teacher, 'v130-4-edit-text.png', 100);
  await typeEdit('改过的字');
  await until(async () => (await ink()).find((s) => s.id === 't1')?.text === '改过的字', 3000, 'text changed');
  await sleep(600);
  assert.equal((await ink()).filter((s) => s.tool === 'pen').length, 0, 'double-click with the pen leaves no dots');
  await until(() => ST(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).find(s=>s.id==='t1')?.text==='改过的字'`), 4000, 'student sees edit');
  // 单击文字：照常落一个点（等双击判定过了才落）
  await tap(onText);
  await until(async () => (await ink()).filter((s) => s.tool === 'pen').length === 1, 2000, 'single tap still draws');
  // 选择工具双击，清空 = 删除
  await T(`s.setShared({tool:'select'});return true`); await sleep(500);
  await dbl(onText);
  assert.equal(await editBox(), '改过的字');
  await typeEdit('');
  await until(async () => !(await ink()).some((s) => s.id === 't1'), 3000, 'empty text removes it');
  mark('double-click text edits it in place (pen and select tool); empty deletes; a single tap still draws');

  // ── 5. 贴图不重叠 + 旋转 / 翻转 ──
  await T(`s.clearInk(Q.inkKey('board',0));s.setShared({tool:'pen',selectedInk:null});return true`);
  const png = (w, h, color, label) => `(()=>{const c=document.createElement('canvas');c.width=${w};c.height=${h};const x=c.getContext('2d');x.fillStyle='${color}';x.fillRect(0,0,${w},${h});x.fillStyle='#fff';x.font='bold 56px sans-serif';x.fillText('${label}',30,80);x.fillRect(0,${h}-30,80,30);return c.toDataURL('image/png');})()`;
  const idA = await T(`return await Q.paste.pasteToBoard(${png(1200, 260, '#1d4ed8', '题干图')})`);
  const idB = await T(`return await Q.paste.pasteToBoard(${png(1000, 420, '#047857', '题目图')})`);
  const imgs = (await ink()).filter((s) => s.tool === 'image');
  const [a, b] = [idA, idB].map((id) => imgs.find((s) => s.id === id).pts);
  const overlap = a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4];
  assert.ok(!overlap, 'second image does not cover the first: ' + JSON.stringify({ a, b }));
  assert.ok([a, b].every((p) => p[0] >= 0 && p[3] <= 1 && p[1] >= 0 && p[4] <= 0.5625 + 1e-9), 'both visible');
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock')`).catch(() => false), 10000, 'dock');
  await T(`s.setShared({tool:'select',selectedInk:{key:Q.inkKey('board',0),ids:[${JSON.stringify(idB)}]}});return true`);
  await until(() => call(dock, `!document.querySelector('[aria-label="编辑选中内容"]').disabled`), 4000, 'editor button enabled');
  await call(dock, `document.querySelector('[aria-label="编辑选中内容"]').click();true`);
  await until(() => call(dock, `!!document.querySelector('.obj-turns')`), 4000, 'image turn buttons');
  const turn = (label) => call(dock, `[...document.querySelectorAll('.obj-turns button,.obj-turn-reset')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click();true`);
  const imgB = async () => (await ink()).find((s) => s.id === idB);
  await turn('右转');
  await until(async () => Math.abs(((await imgB()).rot ?? 0) - Math.PI / 2) < 1e-6, 3000, 'turned right');
  await turn('翻转');
  await until(async () => (await imgB()).flip === true, 3000, 'flipped');
  await until(() => ST(`const k=(Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).find(x=>x.id===${JSON.stringify(idB)});return k&&k.flip&&Math.abs(k.rot+Math.PI/2)<1e-6`), 4000, 'student sees rotate + flip');
  await shot(student, 'v130-5-student-rotated.png');
  await shot(dock, 'v130-5-dock-editor.png', 100);
  await until(() => call(dock, `!!document.querySelector('.obj-turn-reset')`), 3000, 'reset button');
  await turn('恢复原样');
  await until(async () => { const s = await imgB(); return !s.rot && !s.flip; }, 3000, 'reset');
  mark('images: second paste finds free space; dock editor turns / flips / resets, students see it', { a: a.slice(0, 5), b: b.slice(0, 5) });

  // ── 6. 插件图形：导播台点「去绘图库」，浮层打开绘图库 ──
  await call(dock, `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
  await T(`s.setShared({selectedInk:null});Q.plugins.openShapes({id:'demo-shapes',contributes:{shapes:[{subject:'math',group:'立体几何',items:[{name:'正方体',file:'a.png',width:.2}]}]}},0);return true`);
  await until(() => call(dock, `!!document.querySelector('.obj-pop')`), 5000, 'object library opened in the dock');
  const where = await T(`return Q.plugins.whereText({contributes:{panels:[],lessons:[],pages:[{id:'p',title:'x',entry:'a.html'}],shapes:[{subject:'math',group:'立体几何',items:[{name:'a',file:'a.png',width:.2}]}],skills:[],templates:[]}})`);
  assert.ok(where.some((w) => w.includes('立体几何')) && where.some((w) => w.includes('学情')), JSON.stringify(where));
  mark('plugin shapes: "go to drawing library" opens the dock object library; where-to-use text lists each entry', { where });

  // ── 7. 绘图库新图形：正棱台、空间直角坐标系 ──
  const placed = await T(`const k=Q.inkKey('board',0);s.clearInk(k);
    const items=[['m-frustum-p',{}],['m-frustum-p',{n:3,oblique:false,yaw:35,pitch:22,k:.4}],['m-axes3',{}],['m-axes3',{point:true,nums:true,neg:true,px:2,py:3,pz:2}]];
    items.forEach(([kind,p],i)=>{const o=Q.objects.createObject(kind,(i%2+.5)*.5,(Math.floor(i/2)+.5)*.28);o.props={...o.props,...p};const z=Math.min(.4/o.w,.24/o.h);o.w*=z;o.h*=z;
      s.addStroke(k,Q.withObject({id:'shape'+i,tool:'obj',color:'ink',size:3,pts:[o.x,o.y,.5],author:'teacher',layer:'public'},o));});
    return (Q.useStore.getState().ink[k]||[]).filter(x=>x.obj).map(x=>x.obj.kind)`);
  assert.deepEqual(placed, ['m-frustum-p', 'm-frustum-p', 'm-axes3', 'm-axes3']);
  await until(() => ST(`return (Q.useStore.getState().ink[Q.inkKey('board',0)]||[]).filter(x=>x.obj).length===4`), 4000, 'student has shapes');
  await shot(student, 'v130-7-shapes.png', 800);
  mark('drawing library: 正棱台 and 空间直角坐标系 draw on the board');

  // ── 8. 板书存 PDF：多页黑板一张 A4 放两页；长黑板按纸切，切口不穿过字；省墨版白底 ──
  const pdfOut = await T(`s.setShared({boardSkin:'chalk'});const pages=[0,1,2].map(()=>({w:1600,h:900}));const m={id:'pdf-multi',kind:'board',title:'多页黑板',pages,total:3};
    for(let i=0;i<3;i++){const k=Q.inkKey(m.id,i);s.clearInk(k);s.addStroke(k,{id:'pt'+i,tool:'text',color:'#ffffff',size:6,pts:[.1,.1,.5],text:'第 '+(i+1)+' 页的板书',author:'teacher',layer:'public'});
      s.addStroke(k,{id:'pl'+i,tool:'pen',color:'orange',size:4,pts:[.1,.3,.5,.5,.4,.5,.9,.3,.5],author:'teacher',layer:'public'});}
    const L={id:'pdf-long',kind:'board',long:true,title:'长黑板',pages:[{w:1600,h:Math.round(1600*.5625*8)}],total:1};const k=Q.inkKey(L.id,0);s.clearInk(k);
    for(let r=0;r<28;r++)s.addStroke(k,{id:'lt'+r,tool:'text',color:'#ffffff',size:5,pts:[.06,.05+r*.15,.5],text:'第 '+(r+1)+' 行：长黑板上的一行字 F = ma',author:'teacher',layer:'public'});
    const multi=await Q.boardExport.boardPdfSheets(m),ink=await Q.boardExport.boardPdfSheets(m,{saveInk:true}),long=await Q.boardExport.boardPdfSheets(L);
    const lay=Q.boardExport.a4Layout(L,()=>Q.useStore.getState().ink[k]||[]);
    const cuts=lay.slice(0,-1).map(p=>p[0].top+p[0].height);
    const file=await Q.host.call('exportBoard',{title:m.title,pdf:multi,to:${JSON.stringify(path.join(out, '多页黑板.pdf'))}});
    const fileLong=await Q.host.call('exportBoard',{title:L.title,pdf:long,to:${JSON.stringify(path.join(out, '长黑板'))}});
    return {multi,ink,long,file,fileLong,cuts}`);
  assert.equal(pdfOut.multi.length, 2, '3 pages → 2 sheets');
  assert.ok(pdfOut.long.length >= 3, 'long board spans several sheets: ' + pdfOut.long.length);
  const pdfBuf = fs.readFileSync(pdfOut.file[0]), pdfStr = pdfBuf.toString('latin1');
  assert.ok(pdfStr.startsWith('%PDF-1.4') && pdfStr.trimEnd().endsWith('%%EOF'), 'pdf header/trailer');
  assert.ok(/\/Count 2 /.test(pdfStr), 'pdf has 2 pages');
  assert.ok(pdfOut.fileLong[0].endsWith('.pdf') && new RegExp(`/Count ${pdfOut.long.length} `).test(fs.readFileSync(pdfOut.fileLong[0], 'latin1')), 'long pdf gets .pdf and all sheets');
  const { jpegInfo } = require('../electron/jpegPdf.cjs');
  const jpgs = { 'v130-8-pdf-sheet1.jpg': pdfOut.multi[0], 'v130-8-pdf-ink1.jpg': pdfOut.ink[0], 'v130-8-pdf-long1.jpg': pdfOut.long[0], 'v130-8-pdf-long2.jpg': pdfOut.long[1] };
  for (const [name, d] of Object.entries(jpgs)) { const b = Buffer.from(d.slice(23), 'base64'); assert.deepEqual([jpegInfo(b).w, jpegInfo(b).h], [1654, 2339]); fs.writeFileSync(path.join(out, name), b); }
  // 省墨版：页面中间（板面里）基本是白色
  const inkImg = electron.nativeImage.createFromBuffer(Buffer.from(pdfOut.ink[0].slice(23), 'base64')).toBitmap();
  const px = (img, x, y) => { const i = (y * 1654 + x) * 4; return img[i] + img[i + 1] + img[i + 2]; };
  assert.ok(px(inkImg, 1500, 400) > 740, 'ink saver background is white');
  const fullImg = electron.nativeImage.createFromBuffer(Buffer.from(pdfOut.multi[0].slice(23), 'base64')).toBitmap();
  assert.ok(px(fullImg, 1500, 400) < 300, 'normal pdf keeps the dark board');
  await call(dock, `[...document.querySelectorAll('.tdock .tp-b')].find(b=>(b.dataset.tip||'').startsWith('保存板书')).click();true`);
  const menu = await until(() => call(dock, `(()=>{const m=document.querySelector('.tdock-save');return m&&m.getBoundingClientRect().left>=0?m.innerText:null})()`), 4000, 'dock save menu');
  assert.ok(menu.includes('存成 PDF') && menu.includes('打印省墨'), menu);
  await shot(dock, 'v130-8-dock-save-menu.png', 100);
  await call(dock, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));true`);
  mark('board PDF: A4 sheets (2 pages per sheet, long board sliced), ink-saver is white, file is a valid PDF', { sheets: pdfOut.multi.length, long: pdfOut.long.length, cuts: pdfOut.cuts });

  // ── 9. 定制工具栏：预设、右键打开、各窗口同步、记住每组上次用的 ──
  await call(dock, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
  await T(`s.setShared({tool:'pen',selectedInk:null});localStorage.removeItem('cs.toolbar');return true`);
  const groupsIn = () => call(dock, `[...document.querySelectorAll('.tdock .tp > .tp-g > .tp-b')].map(b=>b.getAttribute('aria-label').split(' · ')[0])`);
  await until(async () => (await groupsIn()).length === 8, 4000, 'full toolbar');
  assert.equal((await groupsIn())[3], '直线', 'lines group starts with 直线');
  await T(`localStorage.setItem('cs.toolbar',JSON.stringify({preset:'simple',hidden:['lasso','marker','darrow','curve','dashed','triangle','force','axes','spotlight','curtain'],last:{}}));return true`);
  await until(async () => (await groupsIn()).length === 7, 4000, 'dock follows the preset set in another window');
  await call(dock, `document.querySelector('.tdock .tp').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:120}));true`);
  await until(() => call(dock, `!!document.querySelector('.tb-edit')`), 3000, 'customize popup');
  assert.equal(await call(dock, `document.querySelector('.tb-presets .on b').innerText`), '讲题常用');
  await shot(dock, 'v130-9-toolbar-editor.png', 300);
  await call(dock, `[...document.querySelectorAll('.tb-tool')].find(b=>b.innerText.trim()==='虚线').click();true`);
  await until(() => T(`const p=JSON.parse(localStorage.getItem('cs.toolbar'));return p.preset==='custom'&&!p.hidden.includes('dashed')`), 3000, 'show dashed again → custom, saved for every window');
  await call(dock, `[...document.querySelectorAll('.tb-presets button')].find(b=>b.innerText.includes('全部工具')).click();true`);
  await until(async () => (await groupsIn()).length === 8, 3000, 'back to all tools');
  await call(dock, `document.querySelector('.tb-edit header button').click();true`);
  // 线条组：选箭头以后，按钮上一直显示箭头（重开也记得）
  const lineBtn = `[...document.querySelectorAll('.tdock .tp > .tp-g > .tp-b')][3]`;
  await call(dock, `${lineBtn}.click();true`); await sleep(150);
  await call(dock, `${lineBtn}.click();true`);
  await until(() => call(dock, `!!document.querySelector('.tdock .tp-fly')`), 3000, 'lines flyout');
  assert.ok(await call(dock, `!!document.querySelector('.tdock .tp-fly .tp-customize')`), 'flyout has 定制工具栏');
  await call(dock, `[...document.querySelectorAll('.tdock .tp-fly .tp-fi')].find(b=>b.innerText.includes('双向箭头')).click();true`);
  await T(`s.setShared({tool:'pen'});return true`);
  await until(async () => (await groupsIn())[3] === '双向箭头', 3000, 'lines group remembers 双向箭头');
  assert.equal(await T(`return JSON.parse(localStorage.getItem('cs.toolbar')).last.lines`), 'darrow');
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`const e=document.querySelector('.desktop-section .tb-edit');if(e)e.scrollIntoView();return !!e`), 4000, 'toolbar section in desktop settings');
  await shot(teacher, 'v130-9-desktop-panel.png', 300);
  await T(`Q.useRecording.setState({panel:false});return true`);
  mark('toolbar: presets, right-click to customize, synced across windows, each group remembers the last tool');

  // ── 10. AI 整理：拖进批改过的卷子照片 + 粘贴家长消息 → 整理单 → 归档 → 补记没认准的题 → 调课提醒 → 整批撤销 ──
  await T(`s.set({page:'console',students:[...s.students,{id:'stu-r',name:'王荣浩',grade:'高二',hue:20,textbook:'人教版 2019',tags:[],lessons:0,lastTopic:'',lastAt:''}]});return true`);
  const before = await T(`const d=Q.useStudy.getState().data;return {q:d.questions.length,a:d.attempts.length,n:d.notes.length}`);
  await click('.tb-sort');
  await until(() => T(`return !!document.querySelector('.sort[role=dialog]')`), 3000, 'sort dialog');
  assert.equal(await T(`return document.querySelector('.sort-who select').value`), 'stu-w', 'defaults to the current student');
  await T(`Q.sort.openSort({paths:[${JSON.stringify(photo)}]});return true`);
  const msg = '荣浩妈妈：老师好，下周三的课能不能改到晚上 7 点？孩子计算老出错，希望多练练计算题。';
  // 微信里复制的文字直接 Ctrl+V（对话框开着时不贴到黑板上）
  const inkBefore = (await ink()).length;
  await T(`const dt=new DataTransfer();dt.setData('text/plain',${JSON.stringify(msg)});document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return true`);
  await until(() => T(`return Q.sort.useSort.getState().items.length===2`), 3000, 'pasted text added');
  assert.equal((await ink()).length, inkBefore, 'paste did not land on the board');
  await until(() => T(`return document.querySelector('.sort-f p')?.innerText.includes('AI 会先看一遍')`), 4000, 'AI cost hint');
  await shot(teacher, 'v130-10-sort-collect.png', 300);
  await click('.sort-f .btn-cue', '开始整理');
  await until(() => T(`return Q.sort.useSort.getState().phase==='review'`), 20000, 'sort review');
  const an = await T(`return Q.sort.useSort.getState().analyses`);
  const [img, chat] = an;
  assert.equal(img.kind, 'graded', JSON.stringify(img)); assert.equal(img.studentId, 'stu-r', 'name on the paper picks 王荣浩');
  assert.deepEqual(img.regions.map((r) => r.mark), ['wrong', 'right', 'unsure']);
  assert.equal(chat.kind, 'chat'); assert.equal(chat.studentId, 'stu-r', '荣浩妈妈 → 王荣浩');
  assert.match(chat.parent.reschedule, /周三.*7 点/); assert.ok(chat.take.reschedule && chat.take.requirement && chat.take.parent);
  const cards = await T(`return [...document.querySelectorAll('.sort-card')].map(c=>c.innerText)`);
  assert.equal(cards.length, 2); assert.match(cards[0], /批改过的卷子/); assert.match(cards[0], /错 1/); assert.match(cards[0], /没认准 1/);
  assert.match(cards[1], /课表不会自动改/);
  await shot(teacher, 'v130-10-sort-review.png', 300);
  const nReq = requests.length;
  await click('.sort-f .btn-cue', '全部归档');
  await until(() => T(`return Q.sort.useSort.getState().phase==='done'`), 20000, 'archived');
  const rec = await T(`return Q.sort.useSort.getState().record`);
  assert.equal(rec.questions.length, 3, JSON.stringify(rec)); assert.equal(rec.attempts.length, 2); assert.equal(rec.unsure.length, 1); assert.equal(rec.notes.length, 3);
  const d1 = await T(`const d=Q.useStudy.getState().data,r=${JSON.stringify(rec)};return {qs:d.questions.filter(q=>r.questions.includes(q.id)).map(q=>({batch:q.batch,image:q.image,status:q.status})),at:d.attempts.filter(a=>r.attempts.includes(a.id)).map(a=>a.studentId+':'+a.result),notes:d.notes.filter(n=>r.notes.includes(n.id)).map(n=>({s:n.studentId,kind:n.kind,todo:n.todo,text:n.text}))}`);
  assert.ok(d1.qs.every((q) => q.batch === rec.id && q.status === 'inbox' && q.image), JSON.stringify(d1.qs));
  for (const q of d1.qs) { const sz = pngSize(q.image) || {}; assert.ok(sz.w > sz.h, 'one question per crop'); }
  assert.deepEqual(d1.at.sort(), ['stu-r:right', 'stu-r:wrong']);
  assert.ok(d1.notes.every((n) => n.s === 'stu-r'));
  assert.ok(d1.notes.some((n) => n.kind === 'parent' && n.text.includes('计算老出错')), 'parent message kept');
  assert.ok(d1.notes.some((n) => n.todo === 'reschedule' && /周三/.test(n.text)), 'reschedule reminder');
  assert.ok(await T(`return Q.useToast.getState().list.some(t=>/课表不会自动改/.test(t.message))`), 'reschedule toast');
  assert.ok(rec.lines[0].startsWith('王荣浩：3 题进收件箱'), rec.lines[0]);
  await until(() => T(`return !!document.querySelector('.sort-uq img')`), 4000, 'unsure question shown');
  await shot(teacher, 'v130-10-sort-done.png', 500);
  // AI 随后补题干
  await until(async () => (await qs()).filter((q) => rec.questions.includes(q.id)).every((q) => q.stem), 30000, 'AI fills the stems');
  assert.ok(requests.length > nReq);
  // 没认准的题：老师点「错」
  await click('.sort-uq button', '错');
  await until(() => T(`const r=Q.useStudy.getState().data.sorts.find(x=>x.id===${JSON.stringify(rec.id)});return r.unsure.length===0&&r.attempts.length===3`), 3000, 'unsure settled');
  assert.equal(await T(`return document.querySelector('.tb-sort .num')?.innerText`), '1', 'top bar shows the reschedule reminder');
  await click('.sort-h .seg button', '整理记录');
  await until(() => T(`return !!document.querySelector('.sort-todo')`), 3000, 'todo list');
  assert.match(await T(`return document.querySelector('.sort-todo').innerText`), /王荣浩/);
  assert.match(await T(`return document.querySelector('.sort-rec').innerText`), /10 月月考 第 1 页 等 2 样[\s\S]*没认准的已由你补记/);
  await shot(teacher, 'v130-10-sort-records.png', 300);
  await click('.sort-rec button', '撤销这次整理');
  await until(() => T(`const d=Q.useStudy.getState().data;return d.questions.length===${before.q}&&d.attempts.length===${before.a}&&d.notes.length===${before.n}`), 4000, 'undo restores everything');
  assert.ok(await T(`return Q.useStudy.getState().data.sorts.find(x=>x.id===${JSON.stringify(rec.id)}).undone`));
  await until(() => T(`return !document.querySelector('.tb-sort .num')&&document.querySelector('.sort-rec .sort-tag')?.innerText==='已撤销'`), 3000, 'badge gone, record marked undone');
  await click('.sort-x');
  mark('AI sort: graded photo + pasted parent message → per-student review → archive (3 questions, 2 attempts, 1 unsure, reschedule reminder) → undo restores', { lines: rec.lines });

  // ── 11. 上课彩排：5 分钟路线 → 接着走完整版 → 结束时清掉练习数据 ──
  const G = () => T(`const g=Q.guide.useGuide.getState();return {active:g.active,route:g.route,idx:g.idx,phase:g.phase,status:g.status,step:Q.guide.currentStep()?.id,base:!!g.base,dock:g.dock,ai:g.ai,boardId:g.boardId,photoId:g.photoId}`);
  const atStep = (id) => until(async () => { const g = await G(); return g.phase === 'step' && g.step === id && g.base && g; }, 10000, 'guide step ' + id);
  const doneStep = (id) => until(async () => (await G()).status[id] === 'done', 10000, 'guide done ' + id);
  const coachText = () => T(`return document.querySelector('.guide-coach')?.innerText||''`);
  const extra = (label) => click('.guide-acts button', label);
  const pgmKey = () => T(`const st=Q.useStore.getState();return Q.inkKey(st.pgmMat.id,0)`);
  const spotOn = (w, sel) => call(w, `(()=>{const s=document.querySelector('.guide-spot'),b=document.querySelector(${JSON.stringify(sel)});if(!s||!b)return false;const r=s.getBoundingClientRect(),q=b.getBoundingClientRect();return r.left<=q.left+1&&r.top<=q.top+1&&r.right>=q.right-1&&r.bottom>=q.bottom-1})()`);
  const pre = await T(`s.set({pvw:null,aiOpen:false});const d=Q.useStudy.getState().data,st=Q.useStore.getState();
    return {students:st.students.map(x=>x.id),studentId:st.studentId,q:d.questions.length,a:d.attempts.length,n:d.notes.length,l:d.lessons.length,sorts:(d.sorts||[]).length,desk:st.desk.map(w=>w.id),ink:Object.keys(st.ink).sort()}`);
  await T(`localStorage.removeItem('cs.guide');localStorage.removeItem('cs.guide.snap');Q.guide.useGuide.setState({status:{}});return true`);
  // 帮助里的入口打开邀请卡
  await T(`Q.guide.showWelcome();return true`);
  await until(() => T(`return !!document.querySelector('.guide-welcome')`), 3000, 'welcome card');
  await shot(teacher, 'v130-11-welcome.png', 400);
  await click('.guide-route', '5 分钟会上课');
  // 配 AI：前面配好了，几秒内自己打勾
  await doneStep('ai');
  await atStep('student');
  assert.ok(await T(`return Q.useStore.getState().students.some(x=>x.id==='guide-xiaoming'&&x.name==='小明')`), 'practice student added');
  await until(() => spotOn(teacher, '.tb-stu'), 3000, 'student button highlighted');
  await shot(teacher, 'v130-11-coach-student.png', 300);
  await click('.tb-stu'); await until(() => T(`return !!document.querySelector('.stu-pop')`), 2000, 'student list');
  await click('.stu-pop button', '小明');
  await doneStep('student');
  await atStep('open');
  await extra('用自带演示');
  await doneStep('open');
  await atStep('take');
  await until(() => spotOn(teacher, '.take-btn'), 3000, 'take button highlighted');
  await click('.take-btn');
  await doneStep('take');
  await atStep('share');
  assert.match(await coachText(), /腾讯会议/);
  await click('.guide-acts .guide-go', '共享好了');
  await doneStep('share');
  // 写板书：学生画面换成彩排黑板，浮层工具栏被圈出来；在导播台学生画面上真的拖一笔
  const gPen = await atStep('pen');
  await until(() => T(`return Q.useStore.getState().pgmMat.id===${JSON.stringify(gPen.boardId)}`), 3000, 'rehearsal board on air');
  await until(() => ST(`return Q.useStore.getState().pgmMat.title==='彩排黑板'`), 4000, 'student sees the rehearsal board');
  await until(() => spotOn(dock, '.tdock .tp'), 4000, 'dock toolbar highlighted');
  await shot(dock, 'v130-11-dock-spot.png', 100);
  await T(`s.setShared({tool:'pen',selectedInk:null});return true`);
  const pgmBox = await until(() => T(`const m=[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto'&&e.closest('.mon-pgm,.pgm,[data-mon=pgm]')).map(e=>e.getBoundingClientRect()).filter(r=>r.width>100)[0]||[...document.querySelectorAll('.ink')].filter(e=>e.style.pointerEvents==='auto').map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return m?{x:m.x,y:m.y,w:m.width,h:m.height}:null`), 4000, 'board canvas');
  const drag = async (pts) => {
    const at = ([x, y]) => [Math.round(pgmBox.x + pgmBox.w * x), Math.round(pgmBox.y + pgmBox.h * y)];
    const [x0, y0] = at(pts[0]);
    teacher.webContents.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 }); teacher.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (const p of pts.slice(1)) { const [x, y] = at(p); await sleep(16); teacher.webContents.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftButtonDown'] }); }
    const [x1, y1] = at(pts.at(-1)); teacher.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
  };
  await drag([[.3, .4], [.36, .46], [.42, .4], [.48, .46], [.54, .4]]);
  await doneStep('pen');
  // 存 PDF：浮层「保存板书」→「存成 PDF」，保存对话框里选好位置
  await atStep('save');
  saveTo = path.join(out, '彩排板书.pdf');
  await until(() => spotOn(dock, '.tdock .tp-b[data-tip^="保存板书"]'), 4000, 'save button highlighted');
  await call(dock, `[...document.querySelectorAll('.tdock .tp-b')].find(b=>(b.dataset.tip||'').startsWith('保存板书')).click();true`);
  await until(() => call(dock, `(()=>{const m=document.querySelector('.tdock-save');return m&&m.getBoundingClientRect().left>=0})()`), 4000, 'save menu');
  await call(dock, `[...document.querySelectorAll('.tdock-save > button')].find(b=>b.innerText.includes('存成 PDF')).click();true`);
  await doneStep('save');
  await until(() => fs.existsSync(saveTo), 5000, 'pdf saved');
  assert.ok(fs.readFileSync(saveTo, 'latin1').startsWith('%PDF'), 'rehearsal board saved as PDF');
  await until(async () => (await G()).phase === 'finish', 5000, 'quick route finished');
  assert.match(await T(`return document.querySelector('.guide-finish').innerText`), /7\s*\/ 7[\s\S]*可以上真课了/);
  await shot(teacher, 'v130-11-finish-quick.png', 400);
  mark('rehearsal quick route: welcome → 7 steps detected from real actions (AI, student, preview, take, share, pen, save PDF) → finish card');

  // 接着走完整版：做过的不再重复
  await click('.guide-finish footer button', '接着走完整版');
  await atStep('slides');
  await click('.guide-acts .guide-go', '知道了');
  const gl = await atStep('lines');
  assert.equal(gl.status.pen, 'done', 'pen already done → straight to lines');
  let k = await pgmKey();
  await T(`s.addStroke(${JSON.stringify(k)},{id:'gl1',tool:'line',color:'#fff',size:3,pts:[.1,.1,.5,.4,.1,.5],author:'teacher',layer:'public'});return true`);
  await sleep(500);
  assert.equal((await G()).step, 'lines', 'one straight line is not enough');
  await T(`s.addStroke(${JSON.stringify(k)},{id:'gl2',tool:'dashed',color:'#fff',size:3,pts:[.1,.15,.5,.4,.15,.5],author:'teacher',layer:'public'});return true`);
  await doneStep('lines');
  await atStep('text');
  await T(`s.addStroke(${JSON.stringify(k)},{id:'gt1',tool:'text',color:'#fff',size:4,pts:[.1,.25,.5],text:'牛顿第一定率',author:'teacher',layer:'public'});return true`);
  await sleep(900);
  assert.equal((await G()).step, 'text', 'typing alone does not finish the step');
  await T(`const t=(Q.useStore.getState().ink[${JSON.stringify(k)}]||[]).find(x=>x.id==='gt1');s.editInk(${JSON.stringify(k)},{upsert:[{...t,text:'牛顿第一定律'}]});return true`);
  await doneStep('text');
  // 倒着的照片：自动贴好、选中；浮层里先圈「编辑选中内容」，打开后圈「右转」
  const gp = await atStep('photo');
  const photoRot = () => T(`const st=Q.useStore.getState();return (st.ink[Q.inkKey(st.pgmMat.id,0)]||[]).find(x=>x.id===Q.guide.useGuide.getState().photoId)?.rot??null`);
  await until(async () => Math.abs((await photoRot()) - Math.PI) < 1e-6, 6000, 'upside-down photo pasted');
  await until(() => spotOn(dock, '[aria-label="编辑选中内容"]'), 4000, 'edit-selection button highlighted');
  await call(dock, `document.querySelector('[aria-label="编辑选中内容"]').click();true`);
  await until(() => spotOn(dock, '.obj-turns'), 4000, 'turn buttons highlighted');
  await shot(dock, 'v130-11-dock-photo.png', 100);
  await turn('右转'); await sleep(300);
  assert.equal((await G()).step, 'photo', 'one turn is not upright yet');
  await turn('右转');
  await doneStep('photo');
  await call(dock, `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
  await atStep('shape');
  await T(`s.setShared({selectedInk:null});const o=Q.objects.createObject('m-frustum-p',.6,.3);s.addStroke(${JSON.stringify(k)},Q.withObject({id:'gs1',tool:'obj',color:'ink',size:3,pts:[o.x,o.y,.5],author:'teacher',layer:'public'},o));return true`);
  await doneStep('shape');
  await atStep('move');
  await T(`const t=(Q.useStore.getState().ink[${JSON.stringify(k)}]||[]).find(x=>x.id==='gs1');s.editInk(${JSON.stringify(k)},{upsert:[{...t,pts:t.pts.map((v,i)=>i%3===0?v-.1:v)}]});return true`);
  await doneStep('move');
  // 长黑板：点导播台上的「长黑板」，往下滚到第一屏外再写
  await atStep('long');
  await until(() => spotOn(teacher, '[data-guide="long-board"]'), 3000, 'long board button highlighted');
  await click('[data-guide="long-board"]');
  await until(() => T(`return Q.longBoard.isLong(Q.useStore.getState().pgmMat)`), 4000, 'long board on air');
  k = await pgmKey();
  await T(`s.addStroke(${JSON.stringify(k)},{id:'gL1',tool:'pen',color:'#fff',size:3,pts:[.2,.3,.5,.3,.32,.5],author:'teacher',layer:'public'});return true`);
  await sleep(500);
  assert.equal((await G()).step, 'long', 'writing on the first screen is not enough');
  await T(`s.addStroke(${JSON.stringify(k)},{id:'gL2',tool:'pen',color:'#fff',size:3,pts:[.2,.9,.5,.3,.92,.5],author:'teacher',layer:'public'});return true`);
  await doneStep('long');
  // AI 讲题：AI 抽屉在右边，引导卡自己挪到左边
  const ga = await atStep('ask');
  assert.equal(ga.status.save, 'done', 'save already done → skipped');
  await extra('打开 AI 助手');
  await until(() => T(`return !!document.querySelector('.ai-dock')&&document.querySelector('.guide-coach').className.includes('at-bl')`), 4000, 'coach card moves away from the AI drawer');
  await setTa('自由落体 1 s 下落多高？'); await key({});
  await doneStep('ask');
  await shot(teacher, 'v130-11-coach-ai.png', 200);
  await T(`s.set({aiOpen:false});return true`);
  // AI 整理：样例资料 → 整理 → 归档 → 撤销
  await atStep('sortIn');
  await extra('放进样例资料');
  await until(() => T(`return Q.sort.useSort.getState().items.length===2`), 5000, 'sample items');
  await until(() => T(`const c=document.querySelector('.guide-coach'),d=document.querySelector('.sort[role=dialog]');if(!c||!d)return false;const a=c.getBoundingClientRect(),b=d.getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom`), 4000, 'coach card does not cover the sort dialog');
  await shot(teacher, 'v130-11-coach-sort.png', 300);
  await click('.sort-f .btn-cue', '开始整理');
  await until(() => T(`return Q.sort.useSort.getState().phase==='review'`), 20000, 'sample review');
  await click('.sort-f .btn-cue', '全部归档');
  await doneStep('sortIn');
  await atStep('sortUndo');
  await extra('打开整理记录');
  await until(() => T(`return !!document.querySelector('.sort-rec')`), 3000, 'records');
  await click('.sort-rec button', '撤销这次整理');
  await doneStep('sortUndo');
  await click('.sort-x');
  // 课后两步跳过整章；插件跳过这步
  await atStep('lesson');
  await click('.guide-coach footer button', '跳过这一章');
  await atStep('plugin');
  await click('.guide-coach footer button', '跳过这步');
  await atStep('toolbar');
  await call(dock, `document.querySelector('.tdock .tp').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:120}));true`);
  await until(() => call(dock, `!!document.querySelector('.tb-edit')`), 3000, 'customize popup');
  await call(dock, `[...document.querySelectorAll('.tb-presets button')].find(b=>b.innerText.includes('讲题常用')).click();true`);
  await doneStep('toolbar');
  await call(dock, `document.querySelector('.tb-edit header button')?.click();true`);
  await atStep('skin');
  await T(`s.set({skin:s.skin==='midnight'?'graphite':'midnight'});return true`);
  await doneStep('skin');
  await until(async () => (await G()).phase === 'finish', 5000, 'full route finished');
  const fin = await T(`return {text:document.querySelector('.guide-finish').innerText,redo:[...document.querySelectorAll('.guide-li button')].length}`);
  assert.match(fin.text, /19\s*\/ 22/); assert.equal(fin.redo, 3, 'lesson, paper, plugin can be redone');
  await shot(teacher, 'v130-11-finish-full.png', 400);
  // 补做：回到「装插件」那步，再回完成清单
  await click('.guide-li button', '补做');
  assert.equal((await G()).step, 'lesson');
  await click('.guide-coach footer button', '跳过这一章'); await atStep('plugin'); await click('.guide-coach footer button', '跳过这步');
  await until(async () => (await G()).phase === 'finish', 5000, 'back to finish');
  await click('.guide-finish .guide-go', '结束彩排');
  await until(async () => !(await G()).active, 3000, 'guide closed');
  const post = await T(`const d=Q.useStudy.getState().data,st=Q.useStore.getState();
    return {students:st.students.map(x=>x.id),studentId:st.studentId,q:d.questions.length,a:d.attempts.length,n:d.notes.length,l:d.lessons.length,sorts:(d.sorts||[]).length,desk:st.desk.map(w=>w.id),ink:Object.keys(st.ink).sort(),spot:!!document.querySelector('.guide-spot'),
      snap:localStorage.getItem('cs.guide.snap'),saved:JSON.parse(localStorage.getItem('cs.guide')),toast:Q.useToast.getState().list.some(t=>/彩排结束/.test(t.message))}`);
  assert.deepEqual(post.students, pre.students, 'practice student removed');
  assert.equal(post.studentId, pre.studentId, 'current student restored');
  for (const f of ['q', 'a', 'n', 'l', 'sorts']) assert.equal(post[f], pre[f], 'study ' + f + ' restored');
  assert.ok(post.desk.every((id) => pre.desk.includes(id)), 'windows opened in the rehearsal are closed: ' + post.desk);
  assert.ok(post.ink.every((x) => pre.ink.includes(x)), 'rehearsal ink dropped: ' + post.ink.filter((x) => !pre.ink.includes(x)));
  assert.ok(!post.spot && !post.snap && post.toast, JSON.stringify({ spot: post.spot, snap: post.snap, toast: post.toast }));
  assert.equal(post.saved.status.pen, 'done', 'progress kept for next time');
  await shot(teacher, 'v130-11-after-exit.png', 300);
  mark('rehearsal full route: done steps skipped, auto-detects lines / text edit / photo turn / shapes / move / long board / AI / sort + undo / toolbar / skin; card dodges the AI drawer and dialogs; exit removes the practice data');

  const bad = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning|favicon/i.test(e));
  fs.writeFileSync(path.join(out, 'v130-results.json'), JSON.stringify({ results, errors: bad }, null, 2));
  assert.deepEqual(bad.filter((e) => /renderer-gone|Uncaught/.test(e)), [], bad.join('\n'));
  console.log(`RESULT ${results.length} passed · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
})().catch((e) => { console.error('FAIL', e); fs.writeFileSync(path.join(out, 'v130-results.json'), JSON.stringify({ results, error: String(e.stack || e), errors }, null, 2)); clearTimeout(timer); app.exit(1); });
