// 1.1.0 AI 工坊桌面验收（屏幕外窗口，假 Codex）：
//   1. 备课页「做插件」：填名称和要求、选思考档位、附上一张图 → 开始
//   2. 右侧实时预览 plugin://dev-<任务>/：插件页面真的跑起来（SDK 就绪、where = preview），能点
//   3. 检查通过 →「装上」→ 进入已装插件，导播台菜单里能打开
//   4. 插件页「用 AI 修改」→ 回到 AI 工坊，停在改这个插件的新任务上
// 用法：npm run build 后 npx electron test/quiet.cjs test/v110-workshop-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v110w-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
process.env.CODEX_HOME = path.join(out, 'codex-home');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-w', name: '小林', grade: '初二', hue: 200, textbook: '人教版', tags: [], lessons: 3, lastTopic: '', lastAt: '', subject: 'physics' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', boardSkin: 'chalk' },
  local: { roots: [], students: [stu], studentId: 'stu-w', slots: [], learning: {} },
}));
const ref = path.join(out, '参考图.png');
fs.writeFileSync(ref, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

const electron = require('electron'); const { app, BrowserWindow } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v110 workshop desktop timed out'); app.exit(1); }, 240000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),$=(q)=>document.querySelector(q),$$=(q)=>[...document.querySelectorAll(q)];${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error('teacher: ' + r.__err); return r; };
  const shot = async (name) => { await sleep(400); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name + '.png'), (await teacher.webContents.capturePage()).toPNG()); };
  const frame = (prefix) => teacher.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith(prefix));
  const F = async (prefix, code) => { const f = await until(() => frame(prefix), 15000, 'frame ' + prefix); return f.executeJavaScript(`(async()=>{try{${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); };
  const setVal = (sel, v) => T(`const el=$(${JSON.stringify(sel)});const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const click = (sel, text) => T(`const b=$$(${JSON.stringify(sel)}).find(x=>x.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('没有按钮 '+${JSON.stringify(text)});b.click();return true`);

  // ── 1. 新任务：做插件 ──
  await T(`s.set({page:'agents'});return true`);
  await until(() => T(`return !!$('.ags-new-form')&&$$('.ags-cli-row.ok').length>0`), 15000, 'agent studio + fake codex');
  assert.equal(await T(`return $('.ags-title h2').innerText`), 'AI 工坊');
  await click('.ags-tpls button', '做插件');
  await until(() => T(`return $('.ags-new-form').innerText.includes('插件名称')&&!!$('.ags-select')`), 5000, 'plugin form');
  await setVal('.ags-new-form .ags-field input:not([type])', '课堂骰子');
  const prompt = await T(`return $('.ags-field.grow textarea').value`);
  assert.ok(prompt.includes('做一个导播台插件「课堂骰子」'), prompt);
  await setVal('.ags-field.grow textarea', prompt + '点一下随机出 1 到 6，可以写到黑板 PLUGIN');
  await T(`$$('.ags-field').find(f=>f.innerText.startsWith('思考档位')).querySelectorAll('.ags-seg button')[3].click();return true`);
  // 在要求里 Ctrl+V 贴一张截图（剪贴板里的图片没有路径，存成临时文件再附上）
  const b64 = fs.readFileSync(ref).toString('base64');
  await T(`const bin=Uint8Array.from(atob(${JSON.stringify(b64)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bin],'shot.png',{type:'image/png'}));const ta=$('.ags-field.grow textarea');ta.focus();ta.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return true`);
  await until(() => T(`return $$('.ags-chip').length===1&&/\\.png$/.test($('.ags-chip').innerText)`), 8000, 'attachment chip');
  assert.ok((await T(`return $('.ags-field.grow textarea').value`)).endsWith('PLUGIN'), 'pasting an image does not touch the text');
  await shot('workshop-new');
  await click('.ags-go', '开始');
  mark('new plugin task from the workshop form (name, requirement, effort, attachment)');

  // ── 2. 实时预览 ──
  const devId = await until(() => T(`const f=$('.wk-prev iframe');return f&&f.src.startsWith('plugin://dev-')?new URL(f.src).host:null`), 30000, 'preview iframe');
  const task = await T(`return (await Q.host.call('agents.list'))[0]`);
  assert.equal(task.kind, 'plugin'); assert.equal(task.effort, 'high');
  assert.equal(fs.readdirSync(path.join(task.work, '附件')).filter((n) => n.endsWith('.png')).length, 1);
  const argv = fs.readFileSync(path.join(task.work, 'args.log'), 'utf8').split('\n')[0];
  assert.ok(argv.includes('model_reasoning_effort=\\"high\\"') && argv.includes('"-i"'), argv);
  await until(() => F('plugin://' + devId + '/', `return document.body.dataset.where==='preview'&&!!window.cs.context`), 15000, 'dev plugin sdk');
  await F('plugin://' + devId + '/', `document.getElementById('roll').click();return true`);
  const n = await F('plugin://' + devId + '/', `return document.getElementById('n').textContent`);
  assert.ok(/^[1-6]$/.test(n), n);
  await until(() => T(`return !!$('.wk-ok')&&!$('.wk-install').disabled`), 20000, 'check passed');
  const log = await T(`return $('.ags-log').innerText`);
  assert.ok(log.includes('检查通过'), log);
  await shot('workshop-preview');
  mark('live preview runs the plugin in the dev sandbox with the SDK, check passes', { devId });

  // ── 3. 装上 ──
  await T(`$('.wk-install').click();return true`);
  await until(() => T(`await Q.plugins.loadPlugins(true);const p=Q.plugins.usePlugins.getState().list.items.find(x=>x.id==='dice-roller');return p&&p.active`), 10000, 'installed');
  await until(() => T(`return $('.wk-install').innerText.includes('更新安装')&&$('.wk-head em')?.innerText.includes('已装')`), 5000, 'installed badge');
  await T(`s.set({page:'console'});return true`);
  await T(`document.querySelector('[data-tip^="插件："]').click();return true`);
  const menu = await until(() => T(`const m=$('.pl-menu');return m?m.innerText:null`), 5000, 'plugin menu');
  assert.ok(menu.includes('骰子'), menu);
  await T(`$('.pop-bg').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true`);
  mark('install from the workshop puts the plugin into the console menu');

  // ── 4. 插件页「用 AI 修改」 ──
  await T(`s.set({page:'plugins'});return true`);
  await until(() => T(`return $$('.pl-card').some(c=>c.innerText.includes('课堂骰子'))`), 8000, 'plugin card');
  await T(`$$('.pl-card').find(c=>c.innerText.includes('课堂骰子')).querySelector('[data-tip^="在 AI 工坊里"]').click();return true`);
  await until(() => T(`return s.page!==undefined&&Q.useStore.getState().page==='agents'&&$('.ags-select')?.value==='dice-roller'`), 8000, 'workshop edit intent');
  const p2 = await T(`return $('.ags-field.grow textarea').value`);
  assert.ok(p2.startsWith('修改插件「课堂骰子」'), p2);
  assert.ok(!(await T(`return $('.ags-new-form').innerText.includes('插件名称')`)), 'editing hides the name field');
  await shot('workshop-edit');
  mark('plugins page "edit with AI" opens the workshop on the right plugin');

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon|net::ERR/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
