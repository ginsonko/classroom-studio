// 0.4 桌面验收：文字工具、答案页、网页课件、课前提醒、防截屏开关、AI 任务中心（假 CLI）。
// 用法：npx electron test/quiet.cjs test/v040-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v040-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-1', name: '小林' }], slots: [], learning: {} } }));
const { app, BrowserWindow } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(80); } throw Error('Timed out ' + what); };
const shot = async (w, name) => { await sleep(900); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v040 desktop timed out'); app.exit(1); }, 180000);

async function makePdf(file, pages) {
  const html = '<meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font:20px "Microsoft YaHei",sans-serif}section{page-break-after:always;height:240mm}</style>'
    + pages.map((t) => `<section>${t}</section>`).join('');
  const src = path.join(out, path.basename(file, '.pdf') + '.html'); fs.writeFileSync(src, html);
  const w = new BrowserWindow({ show: false }); await w.loadFile(src);
  fs.writeFileSync(file, await w.webContents.printToPDF({ pageSize: 'A4' })); w.destroy();
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA')); await until(() => call(student, '!!window.__studioQA'));
  // CS_SHOW=1：窗口真的显示在屏幕上，截图才是实际画面（测试模式默认不显示窗口）
  if (process.env.CS_SHOW === '1') { teacher.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); teacher.show(); student.setBounds({ x: 200, y: 120, width: 1100, height: 680 }); student.show(); }
  const T = (code) => call(teacher, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);
  const S = (code) => call(student, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);

  // ── 文字工具：老师在学生窗口上点一下就能打字（含输入法上屏） ──
  await T(`s.setShared({drawAuthor:'teacher'});s.set({tool:'text',color:'blue',size:3});return true`);
  await until(() => S(`return s.tool==='text'&&s.drawAuthor==='teacher'`), 8000, 'tool sync');
  const box = await S(`const c=document.querySelector('.sw-stage .ink');const r=c.getBoundingClientRect();return {x:Math.round(r.left+r.width*.3),y:Math.round(r.top+r.height*.3)}`);
  student.webContents.focus();
  student.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
  student.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  student.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await until(() => S(`return document.activeElement?.classList.contains('ink-text')`), 5000, 'textarea focus');
  for (const ch of 'Hi') student.webContents.sendInputEvent({ type: 'char', keyCode: ch });
  await student.webContents.insertText('力的分解');
  await until(() => S(`return document.querySelector('.ink-text')?.value==='Hi力的分解'`), 5000, 'typed value');
  student.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] });
  student.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] });
  const textKey = await S(`return __studioQA.inkKey(s.pgm.materialId,s.pgm.page)`);
  await until(() => T(`return (s.ink[${JSON.stringify(textKey)}]||[]).some(x=>x.tool==='text'&&x.text==='Hi力的分解')`), 5000, 'text stroke');
  mark('text tool: click, type (keys + IME commit), Ctrl+Enter commits and syncs to teacher');
  await T(`s.set({tool:'pointer'});return true`);

  // ── 答案页：真实 PDF 自动识别 → 学生遮挡 → 老师揭晓 / 收回 → 手动标记按文件记住 ──
  const pdf = path.join(out, '期末练习.pdf');
  await makePdf(pdf, ['期末练习（含参考答案）<br>一、选择题', '二、填空题<br>1. 物体做匀加速直线运动……', '参考答案<br>一、1.B 2.C 3.A', '二、1. 2 m/s² 2. 12 m']);
  api.files.authorize(pdf);
  await T(`await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(pdf)}),'student');return true`);
  const pages = await until(() => T(`return s.pgmMat.answerPages`), 20000, 'answer detect');
  assert.deepEqual(pages, [2, 3]); assert.equal(await T(`return s.pgmMat.answerAuto`), true);
  mark('answer pages auto-detected from real PDF text', { pages });
  await until(() => S(`return s.pgmMat.answerPages?.length===2`), 5000, 'student gets marks');
  await T(`s.setShared({pgm:{...s.pgm,page:2}});return true`);
  await until(() => S(`return !!document.querySelector('.sw-stage .answer-cover')`), 8000, 'student cover');
  assert.equal(await S(`return document.querySelector('.sw-stage .doc-canvas, .sw-stage canvas.pdf')===null`), true);
  await shot(student, 'student-answer-cover.png');
  await T(`s.set({page:'console'});return true`);
  await until(() => T(`return !!document.querySelector('.answer-badge')`), 8000, 'teacher badge');
  await shot(teacher, 'teacher-answer-badge.png');
  mark('student sees cover on answer page, teacher monitor shows reveal badge');
  await T(`document.querySelector('.answer-badge button').click();return true`);
  await until(() => S(`return !document.querySelector('.sw-stage .answer-cover')`), 8000, 'reveal');
  await T(`document.querySelector('.answer-badge button').click();return true`);
  await until(() => S(`return !!document.querySelector('.sw-stage .answer-cover')`), 8000, 'hide again');
  mark('teacher reveal and re-hide reach the student window');

  await api.makeWindow('dock'); const dock = api.windows.get('dock'); await until(() => call(dock, '!!window.__studioQA'));
  await until(() => call(dock, `!!document.querySelector('.tdock-ans-b')`), 8000, 'dock answer row');
  await call(dock, `document.querySelector('.tdock-ans-b').click();true`);
  await until(() => S(`return !document.querySelector('.sw-stage .answer-cover')`), 8000, 'dock reveal');
  await call(dock, `document.querySelector('.tdock-page').click();true`);
  await until(() => call(dock, `!!document.querySelector('.tdock-pages-mark button:not(.tdock-guard)')`), 5000, 'page grid');
  assert.equal(await call(dock, `document.querySelectorAll('.pthumb-n em').length`), 2);
  await call(dock, `document.querySelector('.tdock-pages-mark button:not(.tdock-guard)').click();true`);
  await until(() => T(`return s.pgmMat.answerPages.join()==='3'&&s.pgmMat.answerAuto===false`), 5000, 'manual unmark');
  await until(() => T(`return (s.answerMarks[${JSON.stringify(pdf.replace(/\\/g, '/'))}]||s.answerMarks[${JSON.stringify(pdf)}])?.pages?.join()==='3'`), 5000, 'remember marks');
  mark('dock reveal button + page grid marks; manual change is remembered per file');
  await T(`await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(pdf)}),'student');return true`);
  await until(() => T(`return s.pgmMat.answerPages?.join()==='3'`), 10000, 'reopen keeps manual');
  mark('reopening the file uses the teacher\'s saved marks');

  // ── 答案遮挡总开关：浮层和导播台都能关 / 开，学生端立即生效 ──
  await T(`s.setShared({revealed:[],pgm:{...s.pgm,page:3}});return true`);
  await until(() => S(`return !!document.querySelector('.sw-stage .answer-cover')`), 8000, 'cover before guard off');
  if (!await call(dock, `!!document.querySelector('.tdock-guard')`)) await call(dock, `document.querySelector('.tdock-page').click();true`);
  await until(() => call(dock, `!!document.querySelector('.tdock-guard.on')`), 5000, 'guard switch');
  await call(dock, `document.querySelector('.tdock-guard').click();true`);
  await until(() => S(`return s.answerGuard===false&&!document.querySelector('.sw-stage .answer-cover')`), 8000, 'guard off');
  await until(() => T(`return !document.querySelector('.answer-badge')&&!!document.querySelector('.mon-ans:not(.on)')`), 5000, 'teacher guard off');
  await T(`document.querySelector('.mon-ans').click();return true`);
  await until(() => S(`return s.answerGuard===true&&!!document.querySelector('.sw-stage .answer-cover')`), 8000, 'guard on');
  mark('answer guard switch (dock + console) turns covering off and on for students');

  // ── 题目和答案在同一页：只遮「答案：」以下，题目照常给学生看 ──
  const pdf2 = path.join(out, '例题讲解.pdf');
  await makePdf(pdf2, ['例题1<br>一物体做匀加速直线运动，2 s 内速度从 1 m/s 增加到 5 m/s，求加速度。', '例题1<br>一物体做匀加速直线运动，2 s 内速度从 1 m/s 增加到 5 m/s，求加速度。<br><br><br><br><br>答案：2 m/s²<br>解析：由 a=Δv/Δt 得 a=(5-1)/2=2 m/s²', '例题2<br>下一题']);
  api.files.authorize(pdf2);
  await T(`await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(pdf2)}),'student');return true`);
  const part = await until(() => T(`return s.pgmMat.answerPages&&{pages:s.pgmMat.answerPages,from:s.pgmMat.answerFrom}`), 20000, 'partial detect');
  assert.deepEqual(part.pages, [1]); assert.ok(part.from?.[1] > 0.15 && part.from[1] < 0.7, JSON.stringify(part));
  await T(`s.setShared({pgm:{...s.pgm,page:1}});return true`);
  await until(() => S(`return !!document.querySelector('.sw-stage .answer-cover.partial')&&!!document.querySelector('.sw-stage canvas')`), 8000, 'partial cover');
  await shot(student, 'student-answer-partial.png');
  await until(() => T(`return !!document.querySelector('.answer-zone')`), 5000, 'teacher answer zone');
  await shot(teacher, 'teacher-answer-line.png');
  mark('answer below the question: student sees the question, only the answer part is covered', part);

  // ── 网页课件：脚本、动画、本地存储都能用，且碰不到导播台本身 ──
  const html = path.join(out, '千面演示.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>@keyframes s{to{transform:rotate(360deg)}}#b{width:60px;height:60px;background:#46f;animation:s 1s linear infinite}</style>
<div id="b"></div><script>localStorage.setItem('k','v');let n=0;setInterval(()=>{document.body.dataset.n=++n},30);let f=0;(function t(){document.body.dataset.f=++f;requestAnimationFrame(t)})();</script>`);
  api.files.authorize(html);
  await T(`await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(html)}),'student');return true`);
  const frame = await until(() => student.webContents.mainFrame.framesInSubtree.find((f) => f !== student.webContents.mainFrame && /千面|%E5%8D%83/.test(decodeURI(f.url)) ), 10000, 'iframe');
  const probe = await until(async () => { const r = await frame.executeJavaScript(`({ls:localStorage.getItem('k'),n:+document.body.dataset.n||0,f:+document.body.dataset.f||0,anim:getComputedStyle(document.getElementById('b')).animationName,cookie:(document.cookie='m=off;path=/',document.cookie),quirks:document.compatMode,parent:(()=>{try{return parent.document?'leak':'?'}catch{return 'isolated'}})()})`); return r.n > 10 ? r : null; }, 10000, 'html run');
  await shot(student, 'student-html.png');
  assert.equal(probe.ls, 'v'); assert.equal(probe.anim, 's'); assert.equal(probe.parent, 'isolated');
  assert.ok(probe.cookie.includes('m=off'), 'cookie not kept: ' + probe.cookie); assert.equal(probe.quirks, 'CSS1Compat');
  mark('local HTML courseware runs scripts/animation with its own storage, isolated from the app', probe);

  // ── 课前提醒横幅 ──
  api.remindLesson({ at: new Date(Date.now() + 10 * 60000), minutes: 10, studentName: '小林', slot: { studentId: 'stu-1', topic: '牛顿第二定律' } });
  await until(() => T(`return !!document.querySelector('.remind-banner')`), 5000, 'banner');
  await shot(teacher, 'teacher-remind.png');
  await T(`document.querySelector('.remind-banner .go').click();return true`);
  assert.equal(await T(`return s.studentId`), 'stu-1');
  mark('class reminder banner appears and "准备上课" switches student');

  // ── 防截屏开关：默认关闭，可随时切换（教师窗口 + 浮层） ──
  assert.equal(api.settings.captureGuard, false);
  const prot = () => (typeof teacher.isContentProtected === 'function' ? teacher.isContentProtected() : null);
  if (prot() !== null) assert.equal(prot(), false);
  await T(`await window.csHost.call('setSettings',{captureGuard:true});return true`);
  assert.equal(api.settings.captureGuard, true); if (prot() !== null) assert.equal(prot(), true);
  await T(`await window.csHost.call('setSettings',{captureGuard:false});return true`);
  if (prot() !== null) assert.equal(prot(), false);
  mark('capture protection defaults off and toggles live', { checkedWindowFlag: prot() !== null });

  // ── AI 任务中心：经过真实 IPC 跑假 CLI，记账 ──
  const det = await T(`return await window.csHost.call('agents.detect')`);
  assert.ok(det.codex?.found, JSON.stringify(det));
  const task = await T(`return await window.csHost.call('agents.start',{engine:'codex',title:'测试课件',prompt:'做一个斜面课件',cap:2})`);
  const done = await until(async () => { const t = await T(`return await window.csHost.call('agents.get',${JSON.stringify(task.id)})`); return t.status !== 'running' && t.status !== 'starting' ? t : null; }, 30000, 'agent finish');
  assert.equal(done.status, 'done', JSON.stringify(done).slice(0, 400));
  const files = await T(`return await window.csHost.call('agents.files',${JSON.stringify(task.id)})`);
  await T(`s.set({page:'agents'});return true`);
  await until(() => T(`return document.querySelector('.ags')!==null||document.body.innerText.includes('任务中心')`), 5000, 'agents page');
  await shot(teacher, 'teacher-agents.png');
  assert.ok(api.ledger.entries.some((e) => e.source === 'task' && e.taskId === task.id), 'task not in ledger');
  mark('agent task runs through IPC, finishes, and is charged to the ledger', { status: done.status, files: files?.length });

  // ── 成果自动排版：Markdown → Word + PDF（真实离屏排版窗口），任务详情默认收起操作细节 ──
  const doc = await T(`return await window.csHost.call('agents.start',{engine:'claude',title:'练习题',prompt:'速度公式 $v=v_0+at$，位移 $$x=v_0t+\\\\frac12at^2$$',cap:2,formats:['docx','pdf']})`);
  const made = await until(async () => { const l = await T(`return await window.csHost.call('agents.files',${JSON.stringify(doc.id)})`); const t = await T(`return await window.csHost.call('agents.get',${JSON.stringify(doc.id)})`); return !t.exporting && l.some((f) => f.name === '题目.docx') && l.some((f) => f.name === '题目.pdf') ? l : null; }, 60000, 'auto export');
  const docxFile = made.find((f) => f.name === '题目.docx');
  assert.ok(docxFile.size > 2000, 'docx has content');
  assert.equal(fs.readFileSync(made.find((f) => f.name === '题目.pdf').path).subarray(0, 5).toString(), '%PDF-');
  await T(`[...document.querySelectorAll('.ags-item')].find(b=>b.innerText.includes('练习题'))?.click();return true`);
  await until(() => T(`return document.querySelectorAll('.ags-file .ags-fk.k-Word').length>0&&document.querySelectorAll('.ags-steps').length>0`), 8000, 'compact steps + Word file in UI');
  assert.equal(await T(`return document.querySelectorAll('.ags-ev.k-cmd,.ags-ev.k-tool').length`), 0, 'commands hidden by default');
  await shot(teacher, 'teacher-agent-detail.png');
  await T(`document.querySelector('.ags-files .ags-check input').click();return true`);
  await until(() => T(`return document.querySelectorAll('.ags-steps').length===0&&document.querySelectorAll('.ags-ev.k-file').length>0`), 4000, 'details shown');
  await T(`document.querySelector('.ags-files .ags-check input').click();return true`);
  mark('markdown output auto-exported to Word + PDF; steps collapsed by default with a details toggle', { files: made.map((f) => f.name) });

  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((error) => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
