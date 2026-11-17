// 1.7.0 新界面截图（给不懂代码的老师看）：屏幕外窗口摆好真实状态，webContents.capturePage 存 PNG。
// 用法：CS_DIST=.out/dist-me CS_SHOT_OUT=<输出目录> npx electron test/quiet.cjs test/v170-shots.cjs
const fs = require('node:fs'); const path = require('node:path');
const out = process.env.CS_SHOT_OUT || path.join(__dirname, '../.out/shots'); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, '_data'); process.env.CS_SYNTHETIC_RECORD = '1';
process.env.CS_SHORT_DROP = '1'; process.env.CS_DROP_UNDO = '120000'; // 撤销提示多挂一会儿，够截图
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(path.join(DATA, 'study'), { recursive: true });
const now = new Date(), dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
fs.writeFileSync(path.join(DATA, 'study', 'study.json'), JSON.stringify({ questions: [], attempts: [], homework: [], notes: [], portraits: {}, sorts: [], lessons: [], preps: [], files: [] }));
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, answerGuard: true },
  settings: { autoAnalyze: false, autoMap: false, transcribe: false, shortDrop: true, autoRec: { v: 2, start: true, stageButton: true } },
  local: { roots: [], students: [{ id: 'stu-a', name: '莫莫', grade: '高一', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' }], studentId: 'stu-a', slots: [], learning: {} },
}));
const electron = require('electron'); const { app } = electron;
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('v170 shots timed out'); app.exit(1); }, 240000);
const shot = async (w, name, rect) => {
  const img = await w.webContents.capturePage(rect ? { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.floor(rect.width), height: Math.floor(rect.height) } : undefined);
  const f = path.join(out, name + '.png'); fs.writeFileSync(f, img.toPNG()); console.log('SHOT ' + f);
};

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const run = (w) => async (code) => { const r = await w.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'));
  const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); teacher.showInactive();
  const T = run(teacher);
  await until(() => T(`return Q.useStudy.getState().loaded`), 10000, 'study');
  // 黑板上画几笔，学生窗口看起来像正在上课
  await T(`const k=Q.inkKey('board',0);Q.useStore.getState().editInk(k,{upsert:[
    {id:'d1',tool:'line',color:'ink',size:3,pts:[.12,.2,.4,.2,.4,.62,.12,.62,.12,.2],author:'teacher',layer:'public'},
    {id:'d2',tool:'arrow',color:'ink',size:3,pts:[.26,.62,.26,.85],author:'teacher',layer:'public'},
    {id:'d3',tool:'arrow',color:'ink',size:3,pts:[.4,.4,.56,.4],author:'teacher',layer:'public'},
    {id:'d4',tool:'line',color:'accent',size:3,pts:[.6,.25,.6,.75],author:'teacher',layer:'public'},
    {id:'d5',tool:'arrow',color:'accent',size:3,pts:[.52,.75,.7,.75],author:'teacher',layer:'public'},
  ]},'teacher');return k`);

  // ── 学生窗口：上课按钮（常态 / 悬停 / 计时中）──
  await T(`await Q.host.call('student');return true`);
  const student = await until(() => api.windows.get('student'), 10000, 'student window');
  student.setBounds({ x: left, y: 30, width: 1280, height: 720 });
  const S = run(student);
  await until(() => student.webContents.executeJavaScript('!!window.__studioQA'), 15000, 'student QA');
  const corner = await until(() => S(`const e=document.querySelector('[data-qa="class-corner"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x-16,y:r.y-16,width:r.width+32,height:r.height+32}`), 10000, '上课按钮');
  await shot(student, '01-学生窗口-上课按钮-常态', corner);
  const btn = await S(`const e=document.querySelector('[data-qa="class-start"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`);
  student.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(btn.x), y: Math.round(btn.y) });
  await sleep(600);
  await shot(student, '02-学生窗口-上课按钮-鼠标移上去', corner);
  await shot(student, '03-学生窗口全图-上课前');

  await S(`document.querySelector('[data-qa="class-start"]').click();return true`);
  await until(() => api.recording.status.phase === 'recording', 15000, '开始录像');
  await until(() => S(`const e=document.querySelector('[data-qa="class-clock"]');return e&&/\\d+:\\d\\d/.test(e.innerText)`), 8000, '计时在走');
  await sleep(2600);
  const corner2 = await S(`const e=document.querySelector('[data-qa="class-corner"]');const r=e.getBoundingClientRect();return {x:r.x-16,y:r.y-16,width:r.width+32,height:r.height+32}`);
  await shot(student, '04-学生窗口-下课按钮和计时-常态', corner2);
  const btn2 = await S(`const e=document.querySelector('[data-qa="class-stop"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}`);
  student.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(btn2.x), y: Math.round(btn2.y) });
  await sleep(600);
  await shot(student, '05-学生窗口-下课按钮和计时-鼠标移上去', corner2);

  // ── 下课：顶栏「已丢弃短录像 · 撤销」──
  await S(`document.querySelector('[data-qa="class-stop"]').click();return true`);
  await sleep(300); await S(`document.querySelector('[data-qa="class-stop"]').click();return true`);
  const chip = await until(() => T(`const e=document.querySelector('[data-qa="short-drop"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.max(0,r.x-460),y:0,width:Math.min(1440,r.width+900),height:Math.min(120,r.bottom+40)}`), 15000, '丢弃提示');
  await shot(teacher, '06-教师端-已丢弃短录像-撤销提示', chip);

  // ── 到点提醒：教师窗口卡片 + 学生窗口提示 ──
  const at = new Date(); at.setSeconds(0, 0);
  await T(`const st=Q.useStore.getState();st.set({slots:[{id:'s1',studentId:'stu-a',day:(new Date().getDay()+6)%7,date:'${dk(now)}',start:${at.getHours() + at.getMinutes() / 60},len:1,topic:'牛顿第二定律 超重和失重',repeat:false}]});Q.autoRecord.setAutoRecordSettings({v:2,stageButton:true});Q.autoRecord.tick();return true`);
  const card = await until(() => T(`const e=document.querySelector('[data-qa="autorec-card"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x-16,y:r.y-16,width:r.width+32,height:r.height+32}`), 8000, '教师窗口提醒');
  // 离屏窗口里入场动画停在第一帧（真实使用 0.3 秒就放完）：定格到完成态再截
  await T(`const e=document.querySelector('[data-qa="autorec-card"]');e.style.animation='none';e.style.opacity='1';e.style.transform='none';return true`);
  await sleep(200);
  await shot(teacher, '07-教师端-到点提醒-要开始上课吗', card);
  await shot(teacher, '07b-教师端全图-到点提醒');
  const ask = await until(() => S(`const e=document.querySelector('[data-qa="class-ask"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x-16,y:r.y-16,width:r.width+32,height:r.height+32}`), 8000, '学生窗口提醒');
  await S(`const e=document.querySelector('[data-qa="class-ask"]');e.style.animation='none';e.style.opacity='1';e.style.transform='none';return true`);
  await shot(student, '08-学生窗口-到点提醒-要开始上课吗', ask);
  await shot(student, '09-学生窗口全图-到点提醒');
  await S(`document.querySelector('[data-qa="class-ask-later"]').click();return true`);

  // ── 设置项：按课表提醒上课 + 太短的录像 ──
  await T(`Q.useRecording.setState({panel:true});return true`);
  await until(() => T(`return !!document.querySelector('[data-qa="autorec-settings"]')`), 8000, '设置面板');
  const sec1 = await T(`const e=document.querySelector('[data-qa="autorec-settings"]');e.scrollIntoView({block:'start'});const p=e.closest('.desktop-panel').getBoundingClientRect(),r=e.getBoundingClientRect();return {x:p.x,y:r.y-10,width:p.width,height:Math.min(r.height+20,p.bottom-r.y-6)}`);
  await sleep(400);
  await shot(teacher, '10-设置-按课表提醒上课', sec1);
  const sec2 = await T(`const e=document.querySelector('[data-qa="short-drop-settings"]');e.scrollIntoView({block:'start'});const p=e.closest('.desktop-panel').getBoundingClientRect(),r=e.getBoundingClientRect();return {x:p.x,y:r.y-10,width:p.width,height:Math.min(r.height+20,p.bottom-r.y-6)}`);
  await sleep(400);
  await shot(teacher, '11-设置-太短的录像不算上课', sec2);
  const panel = await T(`const p=document.querySelector('.desktop-panel').getBoundingClientRect();return {x:p.x,y:p.y,width:p.width,height:p.height}`);
  await shot(teacher, '12-设置面板全图', panel);

  console.log('DONE ' + out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error(e); clearTimeout(timer); app.exit(1); });
