// 1.4.0 班组桌面验收：
//   1. 上课绑一对二：学生卡「记给」两个人，点「对」两人各记一次；点名字单独改成半对
//   2. 学生页：班组单独一段、成员 chips、没有家长联系方式；「新建班组」建班课（勾已有学生 + 写新名字）
//   3. 课后总结：成员切换、「全组每人生成」每人一份带班组，班组和成员的课次都 +1
//   4. 助教工具：几个人排课自动建班组、给班组记作答、班组写总结不重复建
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v140-groups-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v140-groups-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const S = (id, name, more = {}) => ({ id, name, grade: '初二', hue: 200, lessons: 0, subject: 'physics', tags: [], textbook: '', lastTopic: '', lastAt: '', ...more });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [S('s1', '李俊宇', { hue: 200, lessons: 3 }), S('s2', '王欣怡', { hue: 330 }), S('s3', '赵六', { hue: 40 }), S('g1', '俊宇欣怡一对二', { kind: 'pair', members: ['s1', 's2'], hue: 150, lastTopic: '浮力' })], studentId: 'g1',
    slots: [], learning: {}, libraryOpen: false, rightOpen: true, libraryW: 420 },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (ev) => { if (ev.level === 'error') errors.push(ev.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v140 groups desktop timed out'); app.exit(1); }, 240000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(code);
  await until(() => call('!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1360, height: 860 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(200); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  const store = `__studioQA.useStore.getState()`, study = `__studioQA.useStudy.getState().data`;
  const click = (sel, text) => call(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)return false;b.click();return true})()`);
  const tool = (name, args) => call(`__studioQA.assistantTools.runTool(${JSON.stringify(name)},${JSON.stringify(args)},{chatId:'t',confirm:async()=>true,sendParent:async()=>[],granted:()=>[],grant:async()=>[]})`);
  const typeInto = (sel, value) => call(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});const P=t.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(P.prototype,'value').set.call(t,${JSON.stringify(value)});t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await until(() => call(`!!document.querySelector('.scard-ans')`), 15000, 'student card');

  // ── 1. 上课：给一对二记作答 ──
  assert.deepEqual(await call(`[...document.querySelectorAll('.scard-who button')].map(b=>b.innerText)`), ['李俊宇', '王欣怡']);
  await click('.scard-ans-b button.r-right');
  await until(() => call(`${study}.attempts.filter(a=>a.result==='right').length===2`), 15000, 'two attempts');
  const att = await call(`${study}.attempts.map(a=>[a.studentId,a.questionId])`);
  assert.deepEqual(att.map((a) => a[0]).sort(), ['s1', 's2']);
  assert.equal(att[0][1], att[1][1], 'same question for both');
  await until(() => call(`document.querySelectorAll('.scard-each button').length===2`), 5000, 'per-member results');
  await click('.scard-each button', '王欣怡');
  await until(() => call(`${study}.attempts.some(a=>a.studentId==='s2'&&a.result==='half')&&!${study}.attempts.some(a=>a.studentId==='s2'&&a.result==='right')`), 5000, 'cycled to half');
  await shot('grp-1-card.png');
  mark('class answers: one capture, recorded for each selected member, per-member fix');

  // ── 2. 学生页 ──
  await call(`${store}.set({page:'students'})`);
  await until(() => call(`!!document.querySelector('.stu-i.grp')&&!!document.querySelector('.stu-sec')`), 5000, 'group section');
  assert.match(await call(`document.querySelector('.stu-members').innerText`), /李俊宇[\s\S]*王欣怡/);
  assert.equal(await call(`document.querySelectorAll('.stu-members button').length`), 2);
  assert.equal(await call(`!!document.querySelector('.stu-parent')`), false, 'no parent contacts on a group');
  await shot('grp-2-students.png');
  await click('.stu-add', '新建班组');
  await until(() => call(`!!document.querySelector('.grp-editor')`), 5000, 'group editor');
  await click('.grp-kinds button', '班课');
  await typeInto('.grp-editor label input[maxlength="60"]', '初二(3)班');
  await call(`(()=>{const l=[...document.querySelectorAll('.grp-m')].find(x=>x.innerText.includes('赵六'));l.querySelector('input').click();return true})()`);
  await typeInto('.grp-editor textarea', '孙七\n周八');
  await shot('grp-3-editor.png');
  await click('.grp-editor .record-actions .btn-cue');
  const cls = await until(() => call(`(()=>{const s=${store}.students;const g=s.find(x=>x.name==='初二(3)班');return g&&{kind:g.kind,members:g.members.map(id=>s.find(x=>x.id===id)?.name),current:${store}.studentId===g.id}})()`), 5000, 'class saved');
  assert.deepEqual(cls, { kind: 'class', members: ['赵六', '孙七', '周八'], current: true });
  await shot('grp-4-class.png');
  mark('students page: group section, member chips, no parent contacts; new class with existing + new students');

  // ── 3. 课后总结：全组每人生成 ──
  await call(`${store}.set({studentId:'g1'})`);
  await tool('navigate', { page: 'study', study_tab: 'lesson' });
  await until(() => call(`document.querySelectorAll('.sd-members button:not(.ags-go)').length===2`), 8000, 'member switch').catch(async (e) => { await shot('grp-x-lesson-fail.png'); console.log(await call(`document.querySelector('.study,main')?.innerText?.slice(0,600)`)); throw e; });
  await click('.ags-go', '全组每人生成');
  await until(() => call(`${study}.lessons.filter(l=>l.groupId==='g1').length===2`), 30000, 'two member notes');
  const counts = await call(`Object.fromEntries(${store}.students.map(s=>[s.id,s.lessons]))`);
  assert.deepEqual([counts.g1, counts.s1, counts.s2], [1, 4, 1], 'group + each member counted once');
  await until(() => call(`document.querySelectorAll('.sd-members button.done').length===2`), 5000, 'done marks');
  await shot('grp-5-lesson.png', 600);
  mark('lesson summary: one note per member tagged with the group; lesson counts');

  // ── 4. 助教工具 ──
  const d = new Date(Date.now() + 3 * 864e5), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const r1 = await tool('add_lesson', { student: '李俊宇、赵六', date, start: '10:00' });
  assert.equal(r1.ok, true, r1.text);
  const g = await call(`(()=>{const s=${store}.students;const g=s.find(x=>x.kind&&x.members.length===2&&x.members.includes('s1')&&x.members.includes('s3'));const slot=${store}.slots.find(x=>x.studentId===g?.id);return g&&slot&&{kind:g.kind,topic:slot.topic}})()`);
  assert.deepEqual(g, { kind: 'pair', topic: '一对二课程' });
  assert.ok(r1.changes.some((c) => c.kind === 'student' && !c.before), 'new group is in the undo set');
  const again = await tool('add_lesson', { student: '赵六、李俊宇', date, start: '13:00' });
  assert.equal(again.ok, true, again.text);
  assert.equal(await call(`${store}.students.filter(x=>x.kind&&x.members.includes('s3')&&x.members.includes('s1')&&x.members.length===2).length`), 1, 'reuses the group');
  const qid = att[0][1];
  const r2 = await tool('record_attempt', { student: '俊宇欣怡一对二', question: qid, result: 'wrong' });
  assert.equal(r2.ok, true, r2.text);
  assert.equal(await call(`${study}.attempts.filter(a=>a.result==='wrong').length`), 2);
  const r3 = await tool('list_students', {});
  assert.match(r3.text, /"type":"一对二","members":\["李俊宇","王欣怡"\]/);
  const r4 = await tool('write_lesson_summary', { student: 'g1' });
  assert.equal(r4.ok, true, r4.text);
  assert.equal(await call(`${study}.lessons.filter(l=>l.groupId==='g1').length`), 2, 'rewrites the same two notes');
  assert.equal(await call(`${store}.students.find(s=>s.id==='g1').lessons`), 1);
  const r5 = await tool('list_lessons', { student: '李俊宇', days: 7 });
  assert.equal(JSON.parse(r5.text).length, 2, "member sees the group's lessons");
  mark('assistant tools: multi-name lesson creates/reuses a group, group attempts, per-member summaries');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/4 pass`, out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(out, 'error.txt'), String(e && e.stack || e)); clearTimeout(timer); app.exit(1); });
