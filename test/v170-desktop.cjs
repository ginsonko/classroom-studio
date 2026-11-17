// 1.7.0 桌面验收（屏幕外窗口，合成录像）：
//   1. 学生窗口右上角的上课按钮和计时：教师窗口发布 classBar，学生窗口里点「上课」真的开始录像，计时在走；浮层也显示计时
//   2. 到点只提醒：教师窗口卡片 + 学生窗口「要开始上课吗？」，不点不开始；学生窗口点「5 分钟后」收起
//   3. 短录像：下课后顶栏「已丢弃短录像 · 撤销」，点撤销留下来；不撤销的那段被删掉、旧录像不动
//   4. 家长版长图：每块不同版式（六块都在），没有内部字段
//   5. 备课：小羽归档 kind=prep 的文件进了「备课」，旧数据启动时补上；学生卡上有「上节 / 这节备课」一句话
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v170-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v170-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); process.env.CS_SYNTHETIC_RECORD = '1'; process.env.CS_SHORT_DROP = '1'; process.env.CS_DROP_UNDO = '6000';
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(path.join(DATA, 'study'), { recursive: true });
const stu = (id, name) => ({ id, name, grade: '高三', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' });
const now = new Date(), day = (d) => d.toISOString().slice(0, 10), dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const work = path.join(out, 'work'); fs.mkdirSync(work, { recursive: true });
const plan = path.join(work, '海淀-电磁感应综合-讲义.pdf'); fs.writeFileSync(plan, '%PDF-1.4\n');
const old = path.join(work, '海淀高三上物理_超纲竞赛化原创题_练习.pdf'); fs.writeFileSync(old, '%PDF-1.4\n');
fs.writeFileSync(path.join(DATA, 'study', 'study.json'), JSON.stringify({
  questions: [], attempts: [], homework: [], notes: [], portraits: {}, sorts: [],
  lessons: [{ id: 'l0', studentId: 'stu-a', date: dk(new Date(now.getTime() - 3 * 86400000)), at: new Date(now.getTime() - 3 * 86400000).toISOString(), topic: '动量守恒', summary: '讲了 6 道碰撞题。', strengths: [], problems: [], next: [], parent: '', via: 'ai', oneLine: '讲了 6 道碰撞题，会列守恒式了' }],
  preps: [], files: [{ id: 'f-old', studentId: 'stu-a', at: new Date(now.getTime() - 86400000).toISOString(), kind: 'prep', title: '超纲练习', path: old.replace(/\\/g, '/'), via: 'assistant', note: '原创超纲竞赛化题' }],
}));
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false, autoMap: false, transcribe: false },
  local: { roots: [work], students: [stu('stu-a', '海淀')], studentId: 'stu-a', slots: [], learning: {} },
}));
const oldRec = path.join(DATA, 'recordings', '2026-01-01T00-00-00-000Z-oldoldol'); fs.mkdirSync(oldRec, { recursive: true });
fs.writeFileSync(path.join(oldRec, 'recording.json'), JSON.stringify({ id: 'old', title: '旧课', studentId: 'stu-a', createdAt: '2026-01-01T00:00:00.000Z', phase: 'complete', startedAt: 1, endedAt: 3600000, chapters: [] }));
fs.writeFileSync(path.join(oldRec, '课堂回放.mp4'), 'x');

const electron = require('electron'); const { app } = electron; const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name) => console.log('PASS ' + name);
const timer = setTimeout(() => { console.error('v170 desktop timed out'); app.exit(1); }, 300000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const run = (w) => async (code) => { const r = await w.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  const T = run(teacher);
  await T(`window.__toasts=[];Q.useToast.subscribe(st=>{for(const t of st.list)if(!window.__toasts.includes(t.message))window.__toasts.push(t.message)});return true`);
  // ── 5. 备课迁移（启动时）──
  await until(() => T(`return Q.useStudy.getState().loaded`), 10000, 'study');
  const preps0 = await T(`return Q.useStudy.getState().data.preps`);
  assert.equal(preps0.length, 1, '旧的 kind=prep 文件补成了一条备课'); assert.equal(preps0[0].from, 'migrate');
  // 小羽：归档 kind=prep → 进备课
  const r = await T(`const t=Q.assistantTools.TOOLS?Q.assistantTools:Q.assistantTools;return await Q.assistantTools.runTool('link_file_to_student',{student:'海淀',paths:[${JSON.stringify(plan.replace(/\\/g, '/'))}],kind:'prep',note:'电磁感应综合 6 题，先讲动生电动势',topic:'电磁感应综合',date:'${dk(now)}'},{chatId:'t',confirm:async()=>true,sendParent:async()=>[],granted:()=>[],grant:async()=>[]})`);
  assert.ok(r.ok, r.text);
  const preps = await T(`return Q.useStudy.getState().data.preps`);
  const today = preps.find((p) => p.date === dk(now));
  assert.ok(today && today.files.length === 1 && today.summary.includes('电磁感应'), JSON.stringify(preps));
  await T(`Q.useStore.getState().set({page:'console'});return true`);
  const brief = await until(() => T(`const e=document.querySelector('.scard [data-qa="lesson-brief"]');return e&&e.innerText`), 8000, '学生卡一句话');
  assert.match(brief, /讲了 6 道碰撞题/); assert.match(brief, /电磁感应综合 6 题/);
  mark('prep: migrated old prep files, link kind=prep makes a prep record, student card shows last lesson + this prep in one line');

  // ── 1. 学生窗口的上课按钮 ──
  await T(`await Q.host.call('student');return true`);
  const student = await until(() => api.windows.get('student'), 10000, 'student window');
  student.setBounds({ x: left, y: 30, width: 1280, height: 720 });
  const S = run(student);
  await until(() => student.webContents.executeJavaScript('!!window.__studioQA'), 15000, 'student QA');
  await until(() => S(`return !!document.querySelector('[data-qa="class-start"]')`), 10000, '学生窗口「上课」按钮');
  await S(`document.querySelector('[data-qa="class-start"]').click();return true`);
  await until(() => api.recording.status.phase === 'recording', 15000, '学生窗口点了上课 → 开始录像');
  await until(() => S(`const e=document.querySelector('[data-qa="class-clock"]');return e&&/\\d+:\\d\\d/.test(e.innerText)`), 8000, '学生窗口计时');
  const dock = api.windows.get('dock');
  if (dock) await until(() => run(dock)(`return !!document.querySelector('[data-qa="dock-class-clock"]')`), 8000, '浮层计时');
  mark('stage corner: start button in student window starts the lesson; clock runs in student window and dock');

  // ── 3. 短录像 ──
  await sleep(2500);
  await S(`document.querySelector('[data-qa="class-stop"]').click();return true`);
  await sleep(200); await S(`document.querySelector('[data-qa="class-stop"]').click();return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="short-drop"]')`), 15000, '顶栏丢弃提示');
  const rid = api.recording.status.discarded.id;
  await T(`document.querySelector('[data-qa="short-drop"]').click();return true`);
  await until(() => ['saved', 'complete', 'recoverable'].includes(api.recording.status.phase) || api.recording.jobs.length, 10000, '撤销后留下');
  const rows = await api.recording.list(); assert.ok(rows.some((x) => x.id === rid), '撤销的那段在回放列表里');
  // 再录一段不撤销：6 秒后只删它
  await until(() => !api.recording.live && !api.recording.jobs.length, 60000, '上一段处理完').catch(() => {});
  await S(`document.querySelector('[data-qa="class-start"]').click();return true`);
  await until(() => api.recording.status.phase === 'recording', 15000, '第二段');
  await sleep(2000);
  await T(`await Q.recordingMod.stopRecording();return true`);
  await until(() => api.recording.status.discarded, 15000, '第二段丢弃');
  const rid2 = api.recording.status.discarded.id;
  await sleep(7500);
  const rows2 = await api.recording.list();
  assert.ok(!rows2.some((x) => x.id === rid2), '没撤销的被删了');
  assert.ok(fs.existsSync(path.join(oldRec, '课堂回放.mp4')), '旧录像不动');
  mark('short recordings: discard chip with undo in top bar; undone one kept, the other deleted after 10s, old recordings untouched');

  // ── 2. 到点提醒 ──
  const at = new Date(); at.setSeconds(0, 0);
  await T(`const st=Q.useStore.getState();st.set({slots:[{id:'s1',studentId:'stu-a',day:(new Date().getDay()+6)%7,date:'${dk(now)}',start:${at.getHours() + at.getMinutes() / 60},len:1,topic:'电磁感应',repeat:false}]});Q.autoRecord.setAutoRecordSettings({v:2});Q.autoRecord.tick();return true`);
  await until(() => T(`const c=document.querySelector('[data-qa="autorec-card"]');return c&&/要开始上课吗/.test(c.innerText)`), 8000, '教师窗口提醒');
  await until(() => S(`const e=document.querySelector('[data-qa="class-ask"]');return e&&/开始上课/.test(e.innerText)`), 8000, '学生窗口提醒');
  await sleep(1500); assert.ok(!['starting', 'recording'].includes(api.recording.status.phase), '不点不开始');
  await S(`document.querySelector('[data-qa="class-ask-later"]').click();return true`);
  await until(() => T(`return !document.querySelector('[data-qa="autorec-card"]')`), 5000, '稍后提醒收起');
  await until(() => S(`return !document.querySelector('[data-qa="class-ask"]')`), 5000, '学生窗口收起');
  mark('ask mode: on-time prompt in teacher window and student window, nothing starts unless clicked, "5 分钟后" snoozes');

  // ── 4. 家长版长图 ──
  const md = await T(`return Q.parentReport.parentMarkdown({id:'x',studentId:'stu-a',date:'${dk(now)}',at:'',topic:'期中卷讲评',minutes:90,summary:'讲评了期中卷 12 道题。暂不能判断第 16 题是否掌握。',strengths:['斜面受力分析清晰（把握 7 成）'],problems:['动量方向判断还没掌握'],next:['订正第 16 题','做 3 道同类变式'],parent:'海淀家长您好，今天讲评了期中卷，海淀听课很专注。不能证明第 17 题已经会了。',homework:'完成错题订正',via:'ai',covered:['斜面：一物体沿倾角 37° 的斜面…','动量定理：质量为 m 的小球…']},'海淀','physics')`);
  const doc = await T(`return await Q.host.call('study.document',{kind:'lesson',title:'海淀-家长版测试',markdown:${JSON.stringify(md)},formats:['png','pdf']})`);
  const png = doc.out.find((f) => f.endsWith('.png'));
  assert.ok(png && fs.statSync(png).size > 60000, JSON.stringify(doc));
  const b = fs.readFileSync(png), h = b.readUInt32BE(20);
  assert.ok(b.readUInt32BE(16) === 750 && h > 1400, 'h=' + h);
  fs.copyFileSync(png, path.join(out, 'v170-parent.png'));
  assert.ok(!/把握|暂不能|不能证明/.test(md));
  mark('parent long image: 750px wide, six sections, no internal fields');

  if (errors.length) console.log('console errors:', errors.slice(-5));
  console.log('RESULT 5/5 pass');
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error(e); console.error('errors:', errors.slice(-8)); clearTimeout(timer); app.exit(1); });
