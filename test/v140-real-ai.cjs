// 1.4.0 真实 AI 端到端（花真钱，不在回归里跑）：用本机配好的 AI 接口和本机的 Codex。
//   1. 课表导入：一段带一对二、班课、没写上下午的课表文字 → 预览 → 导入，班组和新学生自动建好
//   2. AI 助教：一句话排一对二（用上一步建的班组，不重复建）→ 改时间 → 建课前提醒 → 删课（先确认）
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v140-real-ai.cjs
//   CS_REAL_DATA=真实数据目录（默认 G:\ClassroomStudioData，只拷 ai.json 和解密密钥用的 Local State，测完删掉）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const real = process.env.CS_REAL_DATA || 'G:\\ClassroomStudioData';
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v140-real-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(path.join(process.env.CS_DATA_DIR, 'browser'), { recursive: true });
fs.copyFileSync(path.join(real, 'ai.json'), path.join(process.env.CS_DATA_DIR, 'ai.json'));
fs.copyFileSync(path.join(real, 'browser', 'Local State'), path.join(process.env.CS_DATA_DIR, 'browser', 'Local State'));
const S = (id, name, more = {}) => ({ id, name, grade: '初二', hue: 200, lessons: 0, subject: 'physics', tags: [], textbook: '', lastTopic: '', lastAt: '', ...more });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  local: { roots: [], students: [S('s1', '李俊宇', { lessons: 3 }), S('s2', '王欣怡', { hue: 330 })], studentId: 's1', slots: [], learning: {}, libraryOpen: false, rightOpen: false },
}));

const electron = require('electron'); const { app } = electron; const results = []; const log = [];
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(300); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name, JSON.stringify(details)); };
const cleanup = () => { for (const f of ['ai.json', path.join('browser', 'Local State')]) fs.rmSync(path.join(process.env.CS_DATA_DIR, f), { force: true }); };
const timer = setTimeout(() => { console.error('v140 real timed out'); cleanup(); app.exit(1); }, 20 * 60000);
const pad = (n) => String(n).padStart(2, '0'), ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(code);
  await until(() => call('!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1360, height: 860 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(`(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const shot = async (name) => { teacher.webContents.invalidate(); await sleep(300); try { fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); } catch { /* 屏幕外窗口有时截不了 */ } };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const state = () => T(`const st=Q.useStore.getState();return {slots:st.slots,students:st.students}`);
  const pairOf = (st, a, b) => st.students.filter((x) => x.kind && x.members?.length === 2 && x.members.includes(a) && x.members.includes(b));

  // ── 1. 课表导入 ──
  await T(`s.set({page:'schedule'});return true`);
  await until(() => T(`return !!document.querySelector('.sch-imp')`), 8000, 'schedule page');
  await click('.sch-imp');
  await until(() => T(`return !!document.querySelector('.sch-import textarea')`), 5000, 'import dialog');
  const text = '下周课表\n周一 19:00-20:30 李俊宇 浮力\n周二 晚上7点到8点半 俊宇、欣怡 一对二 压强\n周四 上午10:00-11:30 初二(3)班 物理复习\n周六 3点 赵六 力学 两小时';
  await type('.sch-import textarea', text);
  const t0 = Date.now();
  await click('.sch-import .btn-cue', '识别课表');
  await until(() => T(`return document.querySelectorAll('.si-row:not(.si-head)').length>0||/没有|失败|出错/.test(document.querySelector('.sch-import')?.innerText||'')&&!document.querySelector('.sch-import .ags-spin')`), 180000, 'AI read the schedule');
  const rows = await T(`return [...document.querySelectorAll('.si-row:not(.si-head)')].map(r=>({who:r.querySelector('select').selectedOptions[0].textContent,when:r.querySelector('span').textContent,state:r.querySelector('em').textContent,warn:r.className.includes('guess')||r.className.includes('warn')}))`);
  const meta = await T(`return document.querySelector('.si-meta')?.innerText||''`);
  log.push({ step: 'import preview', rows, meta, ms: Date.now() - t0 });
  console.log('rows', JSON.stringify(rows, null, 1), meta);
  await shot('real-1-import.png');
  assert.equal(rows.length, 4, '4 lessons');
  assert.match(rows[0].who, /李俊宇/); assert.match(rows[1].who, /新建班组|俊宇.*欣怡|李俊宇.*王欣怡/); assert.match(rows[2].who, /初二\(3\)班|初二（3）班/); assert.match(rows[3].who, /赵六/);
  assert.match(rows[0].when, /周一 19:00–20:30/); assert.match(rows[1].when, /周二 19:00–20:30/); assert.match(rows[2].when, /周四 10:00–11:30/); assert.match(rows[3].when, /周六 15:00–17:00/);
  await click('.sch-import .btn-cue', '导入 4 节课');
  await until(() => T(`return !document.querySelector('.sch-import')`), 5000, 'dialog closed');
  let st = await state();
  const pair = pairOf(st, 's1', 's2'), cls = st.students.find((x) => x.kind === 'class' && /初二.3.班/.test(x.name)), zl = st.students.find((x) => x.name === '赵六' && !x.kind);
  assert.equal(pair.length, 1, 'one pair group'); assert.equal(pair[0].kind, 'pair'); assert.ok(cls, 'class group created'); assert.ok(zl, '赵六 created');
  assert.equal(st.slots.length, 4); assert.ok(st.slots.some((x) => x.studentId === pair[0].id && x.start === 19), 'pair lesson');
  assert.ok(st.slots.some((x) => x.studentId === cls.id && x.start === 10), 'class lesson');
  mark('schedule import with real AI: pair / class / new student, AM-PM guess', { ms: Date.now() - t0, meta });

  // ── 2. AI 助教 ──
  const A = `__studioQA.assistant.useAssistant.getState()`;
  await until(() => call(`${A}.ready`), 20000, 'assistant ready');
  const status = await call(`${A}.status`);
  assert.equal(status.found, true, 'codex found'); log.push({ status });
  await call(`__studioQA.useStore.getState().set({page:'console'});__studioQA.assistant.openAssistant('chat');true`);
  await until(() => call(`!!document.querySelector('.as-input textarea')`), 5000, 'drawer');
  const send = async (msg) => {
    await call(`(()=>{const t=document.querySelector('.as-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(msg)});t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await until(() => call(`!document.querySelector('.as-send').disabled`), 3000, 'send enabled');
    const n = await call(`${A}.chat?.items.length||0`), t = Date.now();
    await call(`document.querySelector('.as-send').click();true`);
    await until(() => call(`(()=>{const s=${A};return s.chat&&s.chat.items.length>${n}+1})()`), 30000, 'turn started');
    return { n, t };
  };
  const finish = async ({ n, t }, label, confirm) => {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      if (confirm && await call(`!!document.querySelector('.as-ask .as-yes')`)) { await shot('real-confirm.png'); await click('.as-ask .as-yes'); log.push({ step: label, confirmed: true }); }
      if (await call(`(()=>{const s=${A};return s.chat&&!s.chats.find(c=>c.id===s.chat.id)?.running&&!s.busy&&s.chat.items.length>${n}+1})()`)) break;
      await sleep(500);
    }
    const items = await call(`${A}.chat.items.slice(${n}).map(i=>({kind:i.kind,name:i.name,status:i.status,text:(i.text||'').slice(0,400),card:i.card?.title,lines:i.card?.lines}))`);
    const err = await call(`${A}.error`);
    log.push({ step: label, ms: Date.now() - t, items, err });
    console.log('--- ' + label + ' (' + Math.round((Date.now() - t) / 1000) + 's)'); for (const i of items) console.log('  ' + i.kind + (i.name ? ' ' + i.name : '') + (i.card ? ' [' + i.card + '] ' + (i.lines || []).join(' / ') : '') + (i.text ? ' ' + i.text.replace(/\n/g, ' ').slice(0, 200) : ''));
    if (err) console.log('  ERROR', err);
    return items;
  };
  // 「下周三」= 下个自然周的周三
  const wed = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 9); return ymd(d); })();

  let it = await finish(await send('下周三晚上7点给李俊宇和王欣怡加一节一对二，一个半小时，讲浮力'), 'add pair lesson');
  st = await state();
  assert.equal(pairOf(st, 's1', 's2').length, 1, 'reuses the imported pair group');
  assert.equal(st.slots.filter((x) => x.studentId === pair[0].id).length, 2, 'a second pair lesson');
  const fresh = st.slots.filter((x) => x.studentId === pair[0].id).find((x) => x.day === 2);
  assert.ok(fresh, 'on a Wednesday'); assert.equal(fresh.start, 19); assert.equal(fresh.len, 1.5); assert.match(fresh.topic, /浮力/);
  mark('assistant: add a pair lesson by two names (reuses the group)', { slot: fresh, wanted: wed, cards: it.filter((x) => x.card).map((x) => x.card) });

  it = await finish(await send('刚才那节改成晚上7点半开始'), 'move lesson');
  st = await state();
  const moved = st.slots.find((x) => x.id === fresh.id);
  assert.ok(moved && moved.start === 19.5, 'moved to 19:30 (' + JSON.stringify(moved) + ')');
  mark('assistant: move the lesson', { start: moved.start });

  it = await finish(await send('以后每节课开始前15分钟提醒我看一眼这个学生的错题'), 'create trigger');
  const trig = await call(`__studioQA.assistantData.useAssistantData.getState().triggers`);
  assert.ok(trig.some((t) => t.when.type === 'before_lesson' && t.when.minutes === 15 && t.enabled), 'before_lesson 15 trigger: ' + JSON.stringify(trig));
  mark('assistant: create a before-lesson reminder', { triggers: trig.map((t) => [t.name, t.when, t.action.type]) });

  it = await finish(await send('把刚才那节一对二删掉'), 'delete lesson', true);
  st = await state();
  assert.ok(!st.slots.some((x) => x.id === fresh.id), 'deleted after confirm');
  assert.ok(log.some((l) => l.step === 'delete lesson' && l.confirmed), 'asked before deleting');
  mark('assistant: delete asks first, then deletes');

  const chats = await call(`${A}.chats.map(c=>({title:c.title,cny:c.cny,count:c.count}))`);
  log.push({ chats });
  console.log('chats', JSON.stringify(chats));
  await shot('real-2-assistant.png');
  fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify({ results, log }, null, 2));
  console.log(`RESULT ${results.length}/5 pass · ${out}`);
  cleanup(); clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); try { fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify({ results, log, error: String(e.stack || e) }, null, 2)); } catch { /* 写不了 */ } cleanup(); clearTimeout(timer); app.exit(1); });
