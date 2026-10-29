// 1.4.0 AI 助教桌面验收（假的 Codex app-server，见 fake-app-server.cjs）：
//   1. 右下角的小羽、顶栏按钮；点开抽屉看到问候和建议
//   2. 发一句话：开新会话带上全部软件工具、附上软件状态；流式回复显示出来
//   3. 「加学生」：助教调用 add_student 直接加上，出操作卡片；「撤销这一轮」后学生没了
//   4. 「删课」：弹确认卡，点「不要」课还在；再来一次点确认课被删
//   5. 「运行命令」：审批卡片，点「允许这一次」，app-server 收到 accept
//   6. 「慢慢说」：点「停下」，这一轮停止
//   7. 提醒：打开某页时冒泡；「交给助教」的定时任务进「提醒和定时任务」对话自动执行
//   8. 历史对话、设置页、提醒页能打开；收起小羽后不再显示
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v140-assistant-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v140-assistant-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-app-server.cjs');
const LOG = path.join(out, 'fake-log.jsonl'); process.env.FAKE_LOG = LOG;
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const PLAN = path.join(out, '浮力教案.md').replace(/\\/g, '/'); fs.writeFileSync(PLAN, '# 浮力\n\n1. 阿基米德原理\n'); process.env.FAKE_FILE = PLAN;
const today = new Date(), day = (today.getDay() + 6) % 7;
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [{ id: 's1', name: '李俊宇', grade: '初二', hue: 200, lessons: 3, subject: 'physics' }], studentId: 's1',
    slots: [{ id: 'slot-del', studentId: 's1', day: (day + 2) % 7, start: 19, len: 1.5, topic: '浮力', repeat: true }], learning: {}, libraryOpen: false, rightOpen: false, libraryW: 420 },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (ev) => { if (ev.level === 'error') errors.push(ev.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v140 assistant desktop timed out'); app.exit(1); }, 240000);
const logLines = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(code);
  await until(() => call('!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1360, height: 860 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(200); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  const A = `__studioQA.assistant.useAssistant.getState()`;
  const click = (sel, text) => call(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)return false;b.click();return true})()`);
  const typeSend = async (text) => {
    await call(`(()=>{const t=document.querySelector('.as-input textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await until(() => call(`!document.querySelector('.as-send').disabled`), 3000, 'send enabled');
    await click('.as-send');
  };
  const idle = () => until(() => call(`(()=>{const s=${A};return s.chat&&!s.chats.find(c=>c.id===s.chat.id)?.running&&!s.busy})()`), 15000, 'turn finished');
  const lastAi = () => call(`[...document.querySelectorAll('.as-msg.ai')].at(-1)?.innerText||''`);

  // ── 1. 小羽和顶栏按钮 ──
  await until(() => call(`${A}.ready`), 15000, 'assistant ready');
  await until(() => call(`!!document.querySelector('.as-float .as-me svg')&&!!document.querySelector('.tb-as')`), 5000, 'mascot + button');
  const st = await call(`${A}.status`);
  assert.equal(st.found, true, 'fake codex found'); assert.equal(st.where, 'override');
  await shot('as-1-mascot.png');
  await call(`(()=>{const e=document.querySelector('.as-me');const o={bubbles:true,pointerId:3,button:0,clientX:10,clientY:10};e.dispatchEvent(new PointerEvent('pointerdown',o));e.dispatchEvent(new PointerEvent('pointerup',o));return true})()`);
  await until(() => call(`!!document.querySelector('.as-drawer .as-hello')`), 5000, 'drawer with hello');
  assert.ok((await call(`document.querySelectorAll('.as-sugs button').length`)) >= 4);
  assert.equal(await call(`!!document.querySelector('.as-float')`), false, 'floating mascot hides while the drawer is open');
  await shot('as-2-drawer-hello.png');
  mark('mascot + top bar button + drawer greeting', { status: st });

  // ── 2. 第一句话 ──
  await typeSend('你好');
  await idle();
  await until(async () => (await lastAi()).includes('我是小羽'), 5000, 'streamed reply');
  const start = logLines().find((l) => l.method === 'thread/start'), turn = logLines().find((l) => l.method === 'turn/start');
  const names = start.params.dynamicTools.map((t) => t.name);
  for (const n of ['add_student', 'delete_lesson', 'list_lessons', 'send_to_parent', 'create_trigger', 'request_computer_access']) assert.ok(names.includes(n), 'tool registered: ' + n);
  assert.ok(start.params.baseInstructions.length > 400, 'rules sent as base instructions');
  assert.match(start.params.developerInstructions, /学姐[\s\S]*高中物理/, 'default persona + subject hint');
  assert.match(turn.params.input[0].text, /软件状态[\s\S]*李俊宇[\s\S]*你好$/, 'context is prepended to the teacher text');
  // 1.5.0 默认「常用」权限：遇到要动电脑的事才问，能联网，只能写工作目录
  assert.equal(start.params.approvalPolicy, 'on-request'); assert.equal(start.params.sandbox, 'workspace-write');
  assert.equal(turn.params.approvalPolicy, 'on-request');
  assert.equal(turn.params.sandboxPolicy.type, 'workspaceWrite'); assert.equal(turn.params.sandboxPolicy.networkAccess, true); assert.equal(turn.params.sandboxPolicy.writableRoots.length, 1);
  assert.match(turn.params.input[0].text, /权限：常用/, '软件状态里告诉小羽现在的权限');
  const chatTitle = await call(`${A}.chat.title`);
  assert.equal(chatTitle, '你好');
  mark('first message: new thread with all app tools + app context, streamed reply', { tools: names.length });

  // ── 3. 加学生 + 撤销 ──
  await typeSend('帮我加学生测试小王');
  await idle();
  await until(() => call(`__studioQA.useStore.getState().students.some(s=>s.name==='测试小王')`), 5000, 'student added');
  await until(() => call(`!!document.querySelector('.as-op .as-op-h')&&!!document.querySelector('.as-foot button')`), 5000, 'op card + undo');
  const reply = logLines().filter((l) => l.reply).at(-1).reply;
  assert.equal(reply.success, true);
  await shot('as-3-tool-card.png');
  await click('.as-foot button', '撤销这一轮');
  await click('.as-foot button', '撤销');
  await until(() => call(`!__studioQA.useStore.getState().students.some(s=>s.name==='测试小王')`), 5000, 'student removed by undo');
  await until(() => call(`!![...document.querySelectorAll('.as-foot span')].find(s=>s.innerText==='已撤销')`), 5000, 'turn marked undone');
  mark('write tool runs without asking, shows a card, and the whole turn can be undone');

  // ── 4. 删课：先拒绝再确认 ──
  await typeSend('删课 slot-del');
  await until(() => call(`!!document.querySelector('.as-ask .as-yes.danger')`), 8000, 'confirm card');
  await shot('as-4-confirm.png');
  await click('.as-ask .as-no');
  await idle();
  assert.ok(await call(`__studioQA.useStore.getState().slots.some(s=>s.id==='slot-del')`), 'declined: lesson stays');
  assert.match(await lastAi(), /^没删/);
  await typeSend('删课 slot-del');
  await until(() => call(`!!document.querySelector('.as-ask .as-yes.danger')`), 8000, 'confirm card again');
  await click('.as-ask .as-yes.danger');
  await idle();
  assert.equal(await call(`__studioQA.useStore.getState().slots.some(s=>s.id==='slot-del')`), false, 'confirmed: lesson deleted');
  assert.match(await lastAi(), /^删掉了/);
  mark('delete asks the teacher first (decline keeps it, confirm deletes)');

  // ── 5. 命令审批 ──
  await typeSend('运行命令看看');
  await until(() => call(`!!document.querySelector('.as-ask .as-yes')&&[...document.querySelectorAll('.as-ask b')].some(b=>b.innerText.includes('运行命令'))`), 8000, 'approval card');
  assert.ok((await call(`document.querySelector('.tb-as .tb-as-dot')!==null`)), 'top bar shows a waiting dot');
  await shot('as-5-approval.png');
  await click('.as-ask .as-yes', '允许这一次');
  await idle();
  assert.match(await lastAi(), /decision=accept/);
  assert.ok(await call(`!![...document.querySelectorAll('.as-done')].find(x=>x.innerText==='已允许')`));
  mark('computer command needs approval; allow-once reaches the app-server');

  // ── 6. 停下 ──
  await typeSend('慢慢说');
  await until(() => call(`!!document.querySelector('.as-stop')`), 5000, 'stop button');
  await sleep(400);
  await click('.as-stop');
  await idle();
  assert.ok(logLines().some((l) => l.method === 'turn/interrupt'));
  mark('stop interrupts the running turn');

  // ── 7. 提醒 / 定时任务 ──
  await call(`__studioQA.assistant.closeAssistant();true`);
  const now = new Date().toISOString();
  await call(`__studioQA.assistantData.putTrigger({id:'t-remind',name:'看错题',when:{type:'open_page',page:'study'},action:{type:'remind',text:'看看俊宇上次的错题'},times:'once',fired:0,enabled:true,created:${JSON.stringify(now)},by:'teacher'});true`);
  await call(`__studioQA.useStore.getState().set({page:'study'});true`);
  await until(() => call(`(document.querySelector('.as-bubble')?.innerText||'').includes('看看俊宇上次的错题')`), 6000, 'remind bubble');
  await shot('as-6-bubble.png');
  const fired = await call(`__studioQA.assistantData.useAssistantData.getState().triggers.find(t=>t.id==='t-remind')`);
  assert.equal(fired.fired, 1);
  await call(`__studioQA.useStore.getState().set({page:'console'});true`);
  await call(`__studioQA.assistantData.putTrigger({id:'t-task',name:'课前准备',when:{type:'open_page',page:'schedule'},action:{type:'assistant',prompt:'你好，帮我准备一下'},times:'every',fired:0,enabled:true,created:${JSON.stringify(now)},by:'ai'});true`);
  await call(`__studioQA.useStore.getState().set({page:'schedule'});true`);
  const taskChat = await until(() => call(`${A}.chats.find(c=>c.source==='trigger'&&c.count>0&&!c.running)`), 15000, 'trigger chat ran');
  assert.equal(taskChat.title, '提醒和定时任务');
  const tTurn = logLines().filter((l) => l.method === 'turn/start').at(-1);
  assert.match(tTurn.params.input[0].text, /定时任务「课前准备」触发[\s\S]*帮我准备一下/);
  mark('triggers: remind pops a bubble; assistant task runs in its own chat');

  // ── 8. 其它页面 + 收起小羽 ──
  await call(`__studioQA.assistant.openAssistant('list');true`);
  await until(() => call(`document.querySelectorAll('.as-chat-i').length>=2`), 5000, 'history list');
  await shot('as-7-list.png');
  await call(`__studioQA.assistant.openAssistant('triggers');true`);
  await until(() => call(`document.querySelectorAll('.as-tr').length===2`), 5000, 'trigger list');
  await shot('as-8-triggers.png');
  await call(`__studioQA.assistant.openAssistant('settings');true`);
  await until(() => call(`document.querySelectorAll('.as-personas button').length===3`), 5000, 'settings personas');
  await shot('as-9-settings.png');
  await call(`__studioQA.assistant.closeAssistant();true`);
  await until(() => call(`!!document.querySelector('.as-float .as-hide')`), 3000);
  await click('.as-float .as-hide');
  await until(() => call(`!document.querySelector('.as-float')`), 3000, 'mascot hidden');
  assert.equal(await call(`__studioQA.assistantData.useAssistantData.getState().settings.avatar`), false);
  mark('history / triggers / settings views; hide the mascot');

  // ── 9. 1.5.0 完全访问：确认一次；之后命令不再弹审批，每轮带 dangerFullAccess ──
  await call(`__studioQA.assistant.openAssistant('settings');true`);
  await until(() => call(`!!document.querySelector('[data-qa="as-access"] [data-qa="access-common"].on')`), 5000, '默认选中「常用」');
  await click('[data-qa="access-full"]');
  await until(() => call(`!!document.querySelector('[data-qa="access-full-confirm"]')`), 3000, '完全访问先确认');
  assert.equal(await call(`__studioQA.assistantData.useAssistantData.getState().settings.access`), 'common', '没点确认前不改');
  await shot('as-10-full-confirm.png');
  await click('[data-qa="access-full-yes"]');
  await until(() => call(`__studioQA.assistantData.useAssistantData.getState().settings.access==='full'`), 3000, '开启完全访问');
  await call(`__studioQA.assistant.openAssistant('chat');true`);
  await until(() => call(`!!document.querySelector('[data-qa="access-chip"].full')`), 5000, '输入框旁显示「完全访问」');
  const before = logLines().length;
  await typeSend('运行命令看看');
  await idle();
  await until(async () => /decision=acceptForSession/.test(await lastAi()), 8000, '命令自动放行');
  assert.equal(await call(`!!document.querySelector('.as-ask .as-yes')`), false, '不弹审批卡');
  const fullTurn = logLines().slice(before).find((l) => l.method === 'turn/start');
  assert.equal(fullTurn.params.approvalPolicy, 'never'); assert.deepEqual(fullTurn.params.sandboxPolicy, { type: 'dangerFullAccess' });
  assert.match(fullTurn.params.input[0].text, /权限：完全访问/);
  // 输入框旁的小开关切回「常用」不用确认
  await click('[data-qa="access-chip"]');
  await until(() => call(`!!document.querySelector('[data-qa="access-chip-common"]')`), 3000, '权限菜单');
  await click('[data-qa="access-chip-common"]');
  await until(() => call(`__studioQA.assistantData.useAssistantData.getState().settings.access==='common'`), 3000, '切回常用');
  mark('full access: confirm once, commands auto-approved, turn uses dangerFullAccess; chip switches back');

  // ── 10. 1.5.0 回复里的文件路径变成可点的文件卡片；粘贴截图当附件 ──
  await typeSend('给我文件');
  await idle();
  await until(() => call(`!![...document.querySelectorAll('.as-msg.ai')].at(-1)?.querySelector('[data-qa="as-file"]')`), 5000, '回复里的路径变成文件卡片');
  assert.match(await call(`[...document.querySelectorAll('.as-msg.ai')].at(-1).querySelector('[data-qa="as-file"]').innerText`), /浮力教案\.md/);
  await shot('as-11-file-chip.png');
  await call(`[...document.querySelectorAll('.as-msg.ai')].at(-1).querySelector('.as-fchip-main').click();true`);
  await until(() => call(`(()=>{const s=__studioQA.useStore.getState();return s.page==='console'&&(s.pvwMat?.title||s.reader?.mat?.title||'').includes('浮力教案')})()`), 10000, '点文件卡片在导播台预览');
  await call(`__studioQA.assistant.openAssistant('chat');true`);
  await until(() => call(`!!document.querySelector('.as-input textarea')`), 5000, 'input back');
  await call(`(()=>{const c=document.createElement('canvas');c.width=200;c.height=120;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,200,120);g.fillStyle='#c00';g.fillText('截图',20,60);
    const bin=atob(c.toDataURL('image/png').split(',')[1]);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    const dt=new DataTransfer();dt.items.add(new File([u8],'shot.png',{type:'image/png'}));
    document.querySelector('.as-input textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));return true})()`);
  await until(() => call(`document.querySelectorAll('.as-files span img').length===1`), 8000, '粘贴的截图成为附件');
  mark('reply file paths become clickable chips that preview in the console; pasted screenshot becomes an attachment');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|Electron Security/.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  clearTimeout(timer); app.exit(0);
})().catch(async (e) => { console.error('FAIL', e.stack || e); try { const w = globalThis.classroomStudioTest?.windows.get('teacher'); if (w) fs.writeFileSync(path.join(out, 'fail.png'), (await w.webContents.capturePage()).toPNG()); } catch { /* 截不了 */ } fs.writeFileSync(path.join(out, 'error.txt'), String(e.stack || e)); clearTimeout(timer); app.exit(1); });
