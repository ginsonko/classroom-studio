// 0.9.0 桌面验收：
//   1. 浮层「插入公式」输入框点了能打字（焦点不再被还给学生窗口）；
//   2. AI 自动页：默认关闭、没配 AI 时不让开；「现在运行一次」按文件名整理资料库（课件库 / 题库 / 学生档案）；
//   3. 资料整理面板 + 左侧资料栏「分类」+ 学生档案按文件时间；
//   4. 手动备课（没配 AI 走模板）：优先用本地课件、导出 Word + PDF；家长沟通资料；
//   5. 新模板导出样张（作业留空、课件 PPT/PDF、学科主题色），截图留给人工看。
// 所有输入都发给屏幕外的窗口（webContents.sendInputEvent / executeJavaScript），不动真实鼠标。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v090-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v090-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });

// 资料库样本：只看名字归类，文件内容无所谓
const libDir = path.join(out, '资料库');
const sample = {
  cw: '高二物理/动量守恒定律 课件.pptx', qs: '高二物理/动量守恒定律 练习（含答案）.pdf', own: '学生/小林/错题整理 10月.docx',
  odd: '下载/abc123.pdf', jm: '初中数学/八上 一次函数 课件.pptx',
};
for (const rel of Object.values(sample)) { const f = path.join(libDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'sample'); }
fs.utimesSync(path.join(libDir, sample.own), new Date(2026, 2, 8), new Date(2026, 2, 8));
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const stu = { id: 'stu-l', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', subject: 'physics', tags: [], lessons: 2, lastTopic: '动量定理', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: {
  roots: [libDir.replace(/\\/g, '/')], students: [stu, { ...stu, id: 'stu-m', name: '小舟', grade: '初二', subject: 'j-math', hue: 260 }], studentId: 'stu-l',
  slots: [{ id: 'slot-1', studentId: 'stu-l', day: (tomorrow.getDay() + 6) % 7, date: ymd(tomorrow), start: 9, len: 1.5, topic: '动量守恒定律' }], learning: {},
} }));

const { app, ipcMain } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
const focusMsgs = [];
ipcMain.on('cs:dock', (_e, m) => { if (m?.type === 'focus') focusMsgs.push({ on: m.on, t: Date.now() }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v090 desktop timed out'); app.exit(1); }, 300000);

(async () => {
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
  const T = run(teacher, 'teacher');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const tap = async (w, x, y) => {
    w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await sleep(40);
    w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await sleep(40);
  };
  const clickText = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.innerText.trim().includes(${JSON.stringify(text)}));if(!b)throw Error('no button '+${JSON.stringify(text)});b.click();return true`);

  // ── 1. 浮层「插入公式」：点输入框后能连续打字，浮层不把焦点还给学生窗口 ──
  await T(`s.set({page:'console',aiOpen:false});return true`);
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock')`).catch(() => false), 8000, 'dock');
  if (process.env.CS_SHOW !== '1') dock.setPosition(left, 30);
  const D = async (code) => { const r = await call(dock, `(async()=>{try{${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('dock: ' + r.__err); return r; };
  await D(`document.querySelector('.tdock .tp-fx').click();return true`);
  const ta = await until(() => D(`const t=document.querySelector('.fx-bg textarea');if(!t)return null;const r=t.getBoundingClientRect();return r.width>50?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null`), 5000, 'formula textarea in dock');
  await until(() => focusMsgs.some((m) => m.on), 3000, 'dock asks for keyboard focus while the formula sheet is open');
  dock.focus(); await sleep(200);
  const since = Date.now();
  await tap(dock, ta.x, ta.y); await sleep(400);
  assert.deepEqual(focusMsgs.filter((m) => m.t >= since && !m.on), [], 'pointerup inside the textarea must not hand focus back to the student window');
  for (const ch of 'E=mc^2') { dock.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(20); }
  const typed = await until(() => D(`const t=document.querySelector('.fx-bg textarea');return t&&t.value.includes('mc^2')?{v:t.value,active:document.activeElement===t}:null`), 3000, 'typed text');
  assert.ok(typed.active, 'textarea keeps focus');
  await shot(dock, 'v090-1-formula-typing.png', 200);
  await D(`document.querySelector('.fx header button[aria-label="关闭"]').click();return true`);
  await until(() => D(`return !document.querySelector('.fx-bg')`), 3000, 'sheet closed');
  await until(() => focusMsgs.at(-1)?.on === false, 3000, 'focus released after the sheet closes');
  mark('dock formula sheet: clicking the LaTeX box keeps keyboard focus, typing works, focus returns after closing', typed);
  dock.hide();

  // ── 2. AI 自动页：默认关闭；没配 AI 时开启被拦下 ──
  await until(() => T(`return (Q.useLib.getState().lib?.list.length??0)>=5`), 15000, 'library scanned');
  await T(`s.set({page:'auto'});return true`);
  await until(() => T(`return !!document.querySelector('.ap .ap-switch')`), 8000, 'autopilot page');
  const state0 = await T(`return {on:Q.autopilot.useAuto.getState().settings.on,label:document.querySelector('.ap-state').innerText}`);
  assert.deepEqual(state0, { on: false, label: '未开启' });
  await T(`document.querySelector('.ap-switch .ags-go').click();return true`);
  await until(() => T(`return !!document.querySelector('.ap-ask')`), 3000, 'confirm dialog');
  await shot(teacher, 'v090-2-enable-confirm.png');
  await T(`document.querySelector('.ap-ask .btn-cue').click();return true`);
  const blocked = await until(() => T(`const e=document.querySelector('.ap .sd-err');return e&&!document.querySelector('.ap-ask')?e.innerText:null`), 5000, 'enable blocked');
  assert.match(blocked, /还没有配置 AI/);
  assert.equal(await T(`return Q.autopilot.useAuto.getState().settings.on`), false);
  mark('autopilot is off by default, asks before enabling, and refuses to enable without AI config', { blocked });

  // ── 3. 「现在运行一次」：规则整理资料库 ──
  await clickText('.ap .sd-btn', '现在运行一次');
  const cat = await until(() => T(`const it=Q.catalog.useCatalog.getState().items;const v=Object.values(it);return v.length>=5&&Q.autopilot.useAuto.getState().log.some(l=>l.kind==='catalog')?v.map(e=>({t:e.title,shelf:e.shelf,subject:e.subject,studentId:e.studentId,date:e.date,unsure:!!e.unsure})):null`), 15000, 'catalog filled');
  const by = (t) => cat.find((e) => e.t.startsWith(t));
  assert.deepEqual([by('动量守恒定律 课件').shelf, by('动量守恒定律 课件').subject], ['courseware', 'physics']);
  assert.equal(by('动量守恒定律 练习').shelf, 'questions');
  assert.deepEqual([by('错题整理').shelf, by('错题整理').studentId, by('错题整理').date], ['student', 'stu-l', '2026-03-08']);
  assert.equal(by('abc123').unsure, true);
  assert.deepEqual([by('八上 一次函数').shelf, by('八上 一次函数').subject], ['courseware', 'j-math']);
  await sleep(900);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'study', 'catalog.json'), 'utf8'));
  assert.equal(Object.keys(saved.items).length, 5, 'catalog persisted');
  await shot(teacher, 'v090-3-autopilot-home.png');
  mark('run-once organizes the library by file name into courseware / questions / student files and saves catalog.json', { n: cat.length });

  // ── 4. 资料整理面板：学生档案按学生和月份分组；老师手动改类别 ──
  await clickText('.ap .ags-tabs button', '资料整理');
  await until(() => T(`return !!document.querySelector('.ap .cat')`), 3000, 'catalog tab');
  await clickText('.ap .cat-shelves button', '学生档案');
  const group = await until(() => T(`return document.querySelector('.ap .cat-group h5')?.innerText`), 3000, 'student group');
  assert.match(group, /小林 · 2026-03/);
  await clickText('.ap .cat-shelves button', '未归类');
  await until(() => T(`return [...document.querySelectorAll('.ap .cat-row b')].some(b=>b.innerText==='abc123')`), 3000, 'unsure listed');
  await shot(teacher, 'v090-4-catalog.png');
  await T(`const row=[...document.querySelectorAll('.ap .cat-row')].find(r=>r.querySelector('b').innerText==='abc123');const sel=row.querySelector('select');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(sel,'questions');sel.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  const edited = await until(() => T(`const e=Object.values(Q.catalog.useCatalog.getState().items).find(e=>e.title==='abc123');return e.by==='teacher'?{shelf:e.shelf,unsure:!!e.unsure}:null`), 3000, 'teacher edit');
  assert.deepEqual(edited, { shelf: 'questions', unsure: false });
  mark('catalog panel groups student files by month and lets the teacher re-shelve a file', { group });

  // ── 5. 左侧资料栏「分类」和学生页的学生档案 ──
  await T(`s.set({page:'console'});return true`);
  await until(() => T(`return !!document.querySelector('.lib-tabs')`), 5000, 'library panel');
  await clickText('.lib-tabs button', '分类');
  await until(() => T(`return !!document.querySelector('.cat.compact .cat-row')`), 3000, 'compact catalog');
  await shot(teacher, 'v090-5-library-shelf.png');
  await clickText('.lib-tabs button', '小林');
  const own = await until(() => T(`const h=[...document.querySelectorAll('.lib-head')].find(h=>h.innerText.includes('学生档案'));return h?h.innerText:null`), 3000, 'student files');
  assert.match(own, /学生档案（按文件时间） · 1/);
  mark('library side panel has a 分类 tab and the student tab lists the student archive by file time', { own });

  // ── 6. 家长沟通资料 + 手动备课（没配 AI：模板 + 本地课件） ──
  await T(`Q.autopilot.addNote({studentId:'stu-l',kind:'requirement',text:'家长希望多练动量守恒的计算题'});return true`);
  await T(`s.set({page:'auto'});return true`);
  await until(() => T(`return !!document.querySelector('.ap .ags-tabs')`), 5000, 'autopilot page again');
  await clickText('.ap .ags-tabs button', '家长沟通');
  await until(() => T(`return [...document.querySelectorAll('.ap-note p')].some(p=>p.innerText.includes('多练动量守恒'))`), 3000, 'note shown');
  await clickText('.ap .ags-tabs button', '备课');
  await until(() => T(`return [...document.querySelectorAll('.ap-slot b')].some(b=>b.innerText.includes('小林 · 动量守恒定律'))`), 3000, 'upcoming slot');
  await T(`[...document.querySelectorAll('.ap-slot')].find(x=>x.innerText.includes('小林'))?.querySelector('button').click();return true`);
  const prep = await until(() => T(`const p=(Q.useStudy.getState().data.preps||[])[0];return p&&p.files.length?p:null`), 60000, 'prep done');
  assert.equal(prep.via, 'rules');
  assert.equal(prep.slotId, 'slot-1');
  assert.ok(prep.materials.some((m) => m.endsWith(sample.cw)), 'uses local courseware first: ' + prep.materials.join(','));
  assert.ok(prep.files.some((f) => f.endsWith('.docx')) && prep.files.some((f) => f.endsWith('.pdf')), prep.files.join(','));
  for (const f of prep.files) assert.ok(fs.statSync(f).size > 1000, f);
  assert.ok(prep.plan.includes('家长') && prep.plan.startsWith('<!-- cs:theme=physics -->'));
  await until(() => T(`return !!document.querySelector('.ap-prep')&&[...document.querySelectorAll('.ap-slot .sd-tag')].some(t=>t.innerText==='已备课')`), 5000, 'prep listed');
  await shot(teacher, 'v090-6-prep.png');
  fs.copyFileSync(prep.files.find((f) => f.endsWith('.pdf')), path.join(out, 'sample-prep.pdf'));
  mark('manual prep without AI: picks local courseware, reads parent requirement, exports Word + PDF', { files: prep.files.map((f) => path.basename(f)) });

  // ── 7. 模板样张：作业留空 + 学科主题、课件 PPT/PDF、语文作业 ──
  const docs = await T(`const L=Q.studyLogic;const mk=(p)=>({id:'x'+Math.random(),stem:'',points:[],difficulty:3,qtype:'计算',origin:'manual',status:'bank',createdAt:new Date().toISOString(),...p});
    const phys=[mk({stem:'质量为 $m=2\\\\,\\\\text{kg}$ 的小球以 $v_0=3\\\\,\\\\text{m/s}$ 与静止的等质量小球正碰后粘在一起，求共同速度。',answer:'$1.5\\\\,\\\\text{m/s}$',analysis:'动量守恒：$mv_0=2mv$。',points:['6.2'],subject:'physics'}),mk({stem:'下列说法正确的是（　）\\nA. 动量是标量\\nB. 冲量的方向与力的方向相同',qtype:'选择',answer:'B',points:['6.1'],subject:'physics'})];
    const chin=[mk({stem:'阅读《背影》选段，概括父亲买橘子时的动作描写有什么作用。',qtype:'阅读',answer:'表现父爱的深沉。',subject:'j-chinese',points:[]}),mk({stem:'以「那一刻，我长大了」为题写一篇 600 字作文。',qtype:'作文',answer:'略',subject:'j-chinese',points:[]})];
    const doc=(kind,title,markdown,formats)=>Q.host.call('study.document',{kind,title,markdown,formats});
    const outline={title:'动量守恒定律',subtitle:'高二物理 · 一对一',slides:[{title:'导入：冰面上的推人游戏',bullets:['两人站在冰面上互推，会怎样运动？','猜一猜：谁跑得更快？']},{title:'动量守恒的条件',bullets:['系统不受外力或合外力为零','内力远大于外力时近似守恒'],formulas:['m_1v_1+m_2v_2=m_1v_1\\'+m_2v_2\\'']},{title:'例题：完全非弹性碰撞',bullets:['先选系统、规定正方向'],example:{stem:'质量 2 kg 的小球以 3 m/s 与静止的等质量小球正碰后粘在一起，求共同速度。',answer:'1.5 m/s'}},{title:'练一练',bullets:['子弹打木块：求木块获得的速度','人船模型：人走船退']},{title:'小结',bullets:['守恒条件','解题步骤：选系统 → 定方向 → 列方程']}]};
    const a=await doc('homework','样张-物理作业',L.homeworkMarkdown('动量守恒 课后作业','小林',phys,'独立完成，写出过程'),['docx','pdf']);
    const b=await doc('homework','样张-语文作业',L.homeworkMarkdown('阅读与写作练习','小舟',chin),['pdf']);
    const c=await doc('courseware','样张-物理课件',L.outlineMarkdown(outline,'physics'),['pptx','pdf']);
    return {a,b,c}`);
  for (const r of [docs.a, docs.b, docs.c]) { assert.deepEqual(r.errors, []); for (const f of r.out) { assert.ok(fs.statSync(f).size > 1000, f); fs.copyFileSync(f, path.join(out, 'sample-' + path.basename(f).replace(/-\d{8}.*?(\.\w+)$/, '$1'))); } }
  assert.ok(docs.c.out.some((f) => f.endsWith('.pptx')));
  mark('themed templates export: homework (with answer space) docx/pdf, Chinese homework pdf, courseware pptx/pdf', { files: [...docs.a.out, ...docs.b.out, ...docs.c.out].map((f) => path.basename(f)) });

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
