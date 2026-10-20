// 1.1.0 插件平台桌面验收（屏幕外窗口）：
//   1. 插件页装示例（界面上点「安装」→ 权限确认 → 安装），顶栏菜单打开插件面板
//   2. 计时器：面板设时间 → 投到学生画面，学生窗口里的大号计时读到同一份数据
//   3. 随机抽取：抽名字写到黑板（board 权限）
//   4. 立体几何：绘图库里出现插件分组，点一下贴到黑板（currentColor 跟着黑板墨色）
//   5. 沙盒：没申请的权限被拒、碰不到导播台页面、连不上没声明的网站；出错太多自动停用
//   6. 学情页插件分页、AI 备课任务、导出模板、导出 / 复制 / 历史回退
// 用法：npm run build 后 npx electron test/quiet.cjs test/v110-plugins-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v110p-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-p', name: '小周', grade: '高二', hue: 160, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'math' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', boardSkin: 'chalk' },
  local: { roots: [], students: [stu], studentId: 'stu-p', slots: [], learning: {} },
}));

// 测试用插件：不申请任何权限，带面板、学情分页、AI 任务、导出模板
const probe = path.join(out, 'qa-probe');
fs.mkdirSync(path.join(probe, 'skills', 'probe'), { recursive: true });
fs.writeFileSync(path.join(probe, 'plugin.json'), JSON.stringify({
  protocol: 'cs-plugin/1', id: 'qa-probe', name: '测试探针', version: '1.0.0', description: '验收用',
  contributes: {
    panels: [{ id: 'main', title: '探针面板', entry: 'index.html', where: ['console'] }],
    pages: [{ id: 'stats', title: '探针统计', entry: 'page.html' }],
    skills: [{ id: 'probe', label: '探针任务', hint: '验收用的任务', formats: ['docx'], prompt: '围绕「{主题}」写一页说明。' }],
    templates: [{ id: 'plain', title: '朴素版式', css: 'tpl.css', kinds: ['homework'] }],
  },
}));
fs.writeFileSync(path.join(probe, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>探针</title><link rel="stylesheet" href="/__cs/ui.css"></head><body><div class="cs-wrap"><b id="t">探针面板</b></div></body></html>');
fs.writeFileSync(path.join(probe, 'page.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="h">学情插件页</h1></body></html>');
fs.writeFileSync(path.join(probe, 'skills', 'probe', 'SKILL.md'), '---\nname: probe\ndescription: 验收用\n---\n# 探针任务\n写一页说明。\n');
fs.writeFileSync(path.join(probe, 'tpl.css'), 'h1 { letter-spacing: .3em; }');

const electron = require('electron'); const { app, BrowserWindow } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v110 plugins desktop timed out'); app.exit(1); }, 300000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error('teacher: ' + r.__err); return r; };
  const shot = async (w, name) => { await sleep(400); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name + '.png'), (await w.webContents.capturePage()).toPNG()); };
  const frame = (w, prefix) => w.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith(prefix));
  const F = async (w, prefix, code) => { const f = await until(() => frame(w, prefix), 15000, 'frame ' + prefix); return f.executeJavaScript(`(async()=>{try{${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); };
  const waitCs = (w, prefix) => until(() => F(w, prefix, 'return !!(window.cs&&cs.context)'), 15000, 'sdk ready ' + prefix);

  // ── 1. 插件页：界面上装「随机抽取」，其余两个示例和探针走同一套接口 ──
  await T(`s.set({page:'plugins'});return true`);
  await until(() => T(`return document.querySelectorAll('.pl-ex').length>=3`), 8000, 'examples listed');
  await shot(teacher, 'plugins-empty');
  await T(`[...document.querySelectorAll('.pl-ex')].find(x=>x.innerText.includes('随机抽取')).querySelector('button').click();return true`);
  const dialog = await until(() => T(`const m=document.querySelector('.pl-modal');return m?m.innerText:null`), 8000, 'install dialog');
  assert.ok(dialog.includes('往黑板上放图片、文字') && dialog.includes('读取当前学生'), dialog);
  await shot(teacher, 'plugins-confirm');
  await T(`[...document.querySelectorAll('.pl-modal footer button')].find(b=>b.innerText.includes('安装')).click();return true`);
  await until(() => T(`return document.querySelectorAll('.pl-card').length===1&&!document.querySelector('.pl-modal')`), 8000, 'installed card');
  for (const folder of ['class-timer', 'math-solids']) await T(`const st=await Q.host.call('plugins.stageExample',{folder:'${folder}'});await Q.host.call('plugins.install',{token:st.token});return true`);
  // 相当于老师把文件夹拖进插件页（拖入的路径才允许读）
  api.files.authorize(probe, true); api.files.authorize(out, true);
  const st = await T(`const st=await Q.host.call('plugins.inspectPath',{path:${JSON.stringify(probe)}});return st`);
  assert.deepEqual(st.problems, []); assert.equal(st.manifest.id, 'qa-probe');
  await T(`await Q.host.call('plugins.install',{token:${JSON.stringify(st.token)}});return true`);
  await until(() => T(`return document.querySelectorAll('.pl-card').length===4`), 8000, '4 cards');
  await shot(teacher, 'plugins-page');
  mark('plugins page: examples install through the permission dialog; folder import works');

  // ── 2. 计时器：顶栏菜单打开面板 → 1 分钟 → 投到学生画面 ──
  await T(`s.set({page:'console'});return true`);
  await T(`Q.host.openStudentWindow();return true`);
  const student = await until(() => api.windows.get('student'), 15000, 'student window');
  student.setBounds({ x: left, y: 30, width: 1280, height: 760 }); student.showInactive();
  await until(() => call(student, '!!document.querySelector(".sw")'), 15000, 'student app');
  await T(`document.querySelector('[data-tip^="插件："]').click();return true`);
  const menu = await until(() => T(`const m=document.querySelector('.pl-menu');return m?m.innerText:null`), 5000, 'plugin menu');
  assert.ok(menu.includes('计时器') && menu.includes('随机抽取') && menu.includes('大号计时'), menu);
  assert.ok(!menu.includes('探针统计'), 'pages are not panels');
  await shot(teacher, 'plugins-menu');
  await T(`[...document.querySelectorAll('.pl-menu button.pl-row')].find(b=>b.innerText.includes('计时器')).click();return true`);
  await waitCs(teacher, 'plugin://class-timer/');
  const ctx = await F(teacher, 'plugin://class-timer/', 'return {where:cs.context.where,theme:Object.keys(cs.context.theme||{}).length,bg:getComputedStyle(document.body).backgroundColor}');
  assert.equal(ctx.where, 'console'); assert.ok(ctx.theme >= 8, JSON.stringify(ctx));
  await F(teacher, 'plugin://class-timer/', `[...document.querySelectorAll('#presets button')].find(b=>b.textContent.startsWith('1 '))?.click();await new Promise(r=>setTimeout(r,300));document.getElementById('go').click();await new Promise(r=>setTimeout(r,300));document.getElementById('show').click();return true`);
  await until(() => T(`return Q.useStore.getState().pgmMat.path==='plugin://class-timer/screen.html'`), 10000, 'timer on student screen');
  const big = await until(async () => { const r = await F(student, 'plugin://class-timer/screen.html', `return document.getElementById('t').textContent`); return /^0[01]:\d\d$/.test(r) ? r : null; }, 15000, 'student timer text');
  await shot(teacher, 'timer-panel'); await shot(student, 'timer-student');
  mark('class timer: panel state shared through plugin storage, big timer shown in the student window', { big });

  // ── 3. 随机抽取：名单 → 抽 → 写到黑板 ──
  await T(`Q.useStore.getState().focusWin('board');return true`);
  await T(`Q.plugins.openPanel('random-picker','main');return true`);
  await waitCs(teacher, 'plugin://random-picker/');
  const first = await until(() => F(teacher, 'plugin://random-picker/', `return document.getElementById('names').value`), 5000, 'names prefill');
  assert.equal(first, '小周', 'student name prefilled through student permission');
  const picked = await F(teacher, 'plugin://random-picker/', `const t=document.getElementById('names');t.value='张三\\n李四\\n王五';t.dispatchEvent(new Event('input'));document.getElementById('go').click();await new Promise(r=>setTimeout(r,1200));document.getElementById('board').click();await new Promise(r=>setTimeout(r,500));return {r:document.getElementById('result').textContent,tip:document.getElementById('tip').textContent}`);
  assert.ok(['张三', '李四', '王五'].includes(picked.r) && picked.tip === '已写到黑板', JSON.stringify(picked));
  const textStroke = await T(`const st=Q.useStore.getState();const k=Q.inkKey(st.pgmMat.id,st.pgm.page);return (st.ink[k]||[]).filter(x=>x.tool==='text').map(x=>x.text)`);
  assert.ok(textStroke.includes(picked.r), JSON.stringify(textStroke));
  const stored = await T(`return await Q.host.call('plugins.storage',{id:'random-picker',op:'get',key:'names'})`);
  assert.ok(stored.includes('王五'));
  mark('random picker: prefilled with current student, result written to the board, list saved', picked);

  // ── 4. 绘图库里的插件图形 ──
  // 老师的画笔工具在浮层里
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, '!!window.__studioQA&&!!document.querySelector(".tdock")').catch(() => false), 15000, 'dock ready');
  const D = async (code) => { const r = await call(dock, wrap(code)); if (r && r.__err) throw Error('dock: ' + r.__err); return r; };
  await D(`document.querySelector('[aria-label="绘图库"]').click();return true`);
  const tabs = await until(() => D(`const t=[...document.querySelectorAll('.obj-tab-plugin')].map(b=>b.innerText);return t.length?t:null`), 8000, 'plugin shape tab');
  assert.ok(tabs.some((t) => t.includes('立体几何')), tabs.join());
  await D(`[...document.querySelectorAll('.obj-tab-plugin')].find(b=>b.innerText.includes('立体几何')).click();return true`);
  await until(() => D(`return document.querySelectorAll('.obj-tile-plugin img').length===8&&[...document.querySelectorAll('.obj-tile-plugin img')].every(i=>i.complete&&i.naturalWidth>0)`), 8000, 'shape previews');
  await shot(dock, 'shapes-library');
  const before = await T(`const st=Q.useStore.getState();const k=Q.inkKey(st.pgmMat.id,st.pgm.page);return (st.ink[k]||[]).filter(x=>x.tool==='image').length`);
  await D(`[...document.querySelectorAll('.obj-tile-plugin')].find(b=>b.innerText.includes('圆锥')).click();return true`);
  const img = await until(() => T(`const st=Q.useStore.getState();const k=Q.inkKey(st.pgmMat.id,st.pgm.page);const im=(st.ink[k]||[]).filter(x=>x.tool==='image');return im.length>${before}?im.at(-1).img:null`), 10000, 'shape on board');
  // 深色黑板（chalk）：圆锥线条是浅色
  const bmp = electron.nativeImage.createFromPath(api.files.resolve(img)).toBitmap();
  assert.ok(bmp.length > 0, 'stored image readable: ' + img);
  let n = 0, sum = 0; for (let p = 0; p < bmp.length; p += 4) if (bmp[p + 3] > 200) { n++; sum += bmp[p] + bmp[p + 1] + bmp[p + 2]; }
  const light = n ? sum / n / 3 : 0;
  assert.ok(light > 180, 'stroke color follows dark board ink: ' + light);
  await shot(student, 'shape-student');
  mark('drawing library: plugin shape group listed, shape pasted onto the board in the board ink colour', { tabs, light: Math.round(light) });

  // ── 5. 沙盒 ──
  await T(`Q.plugins.openPanel('qa-probe','main');return true`);
  await waitCs(teacher, 'plugin://qa-probe/');
  const sandbox = await F(teacher, 'plugin://qa-probe/', `
    const deny=await cs.board.addText('越权').then(()=>'allowed',e=>e.message);
    const ai=await cs.ai.ask('hi').then(()=>'allowed',e=>e.message);
    let parentDoc='blocked';try{parent.document.title;parentDoc='leak';}catch{}
    const net=await fetch('https://example.com/').then(()=>'leak',()=>'blocked');
    const other=await fetch('plugin://random-picker/index.html').then(r=>r.ok?'leak':'blocked',()=>'blocked');
    const host=typeof window.csHost;
    return {deny,ai,parentDoc,net,other,host,origin:location.origin}`);
  assert.match(sandbox.deny, /没有申请「board」权限/); assert.match(sandbox.ai, /没有申请「ai」权限/);
  assert.equal(sandbox.parentDoc, 'blocked'); assert.equal(sandbox.net, 'blocked'); assert.equal(sandbox.other, 'blocked'); assert.equal(sandbox.host, 'undefined');
  assert.equal(sandbox.origin, 'plugin://qa-probe');
  // 跳到外部网站被拦下
  await F(teacher, 'plugin://qa-probe/', `location.href='https://example.com/';return true`).catch(() => {});
  await sleep(800);
  assert.ok(frame(teacher, 'plugin://qa-probe/'), 'frame stayed on its own origin');
  mark('sandbox: undeclared permissions rejected, no access to the studio page, host API, other plugins or undeclared websites', sandbox);

  // ── 6. 学情分页、AI 任务、导出模板 ──
  await T(`s.set({page:'study'});return true`);
  await until(() => T(`return [...document.querySelectorAll('.ags-tabs button')].some(b=>b.innerText.includes('探针统计'))`), 8000, 'study plugin tab');
  await T(`[...document.querySelectorAll('.ags-tabs button')].find(b=>b.innerText.includes('探针统计')).click();return true`);
  const h = await until(() => F(teacher, 'plugin://qa-probe/page.html', `return document.getElementById('h')?.textContent`), 8000, 'study plugin page');
  assert.equal(h, '学情插件页');
  const skills = await T(`return await Q.host.call('plugins.skills')`);
  assert.ok(skills.some((x) => x.key === 'plugin-qa-probe-probe' && x.label === '探针任务'), JSON.stringify(skills));
  await T(`s.set({page:'agents'});return true`);
  const agentTpl = await until(() => T(`const b=[...document.querySelectorAll('.ags-tpls button')].find(b=>b.innerText.includes('探针任务'));if(!b)return null;b.click();await new Promise(r=>setTimeout(r,200));return document.querySelector('.ags-new-form textarea').value`), 8000, 'agent template from plugin');
  assert.ok(agentTpl.includes('写一页说明'), agentTpl);
  const kit = path.join(out, 'kit'); require('../electron/agentKit.cjs').installKit(kit, 'codex');
  assert.ok(fs.existsSync(path.join(kit, '.agents', 'skills', 'plugin-qa-probe-probe', 'SKILL.md')), 'plugin skill copied into task folder');
  const tl = await T(`return await Q.host.call('plugins.setTemplate',{kind:'homework',ref:'qa-probe/plain'})`);
  assert.equal(tl.templates.homework, 'qa-probe/plain');
  assert.match(api.plugins.templateCss('homework'), /letter-spacing/);
  const doc = await T(`return await Q.host.call('study.document',{kind:'homework',title:'模板测试',markdown:'# 模板测试\\n\\n1. 一道题',formats:['pdf']})`);
  assert.deepEqual(doc.errors, []);
  mark('extension points: study page tab, AI task type with skill folder, export template applied');

  // ── 7. 导出 / 复制 / 历史 / 出错自动停用 ──
  const exported = await T(`return await Q.host.call('plugins.export',{id:'class-timer',to:${JSON.stringify(path.join(out, 'timer.csplugin'))}})`);
  assert.ok(fs.statSync(path.join(out, 'timer.csplugin')).size > 500, exported);
  const again = await T(`const st=await Q.host.call('plugins.inspectPath',{path:${JSON.stringify(path.join(out, 'timer.csplugin'))}});await Q.host.call('plugins.install',{token:st.token});return st.existing`);
  assert.equal(again.version, '1.0.0');
  const hist = await T(`return await Q.host.call('plugins.history',{id:'class-timer'})`);
  assert.equal(hist.length, 1);
  const dup = await T(`return (await Q.host.call('plugins.duplicate',{id:'random-picker'})).id`);
  assert.equal(dup, 'random-picker-copy');
  await T(`s.set({page:'console'});Q.plugins.openPanel('qa-probe','main');return true`);
  await waitCs(teacher, 'plugin://qa-probe/');
  await F(teacher, 'plugin://qa-probe/', `for(let i=0;i<9;i++)setTimeout(()=>{throw new Error('探针故意出错 '+i)},i*20);return true`);
  await until(() => T(`await Q.plugins.loadPlugins(true);const p=Q.plugins.usePlugins.getState().list.items.find(x=>x.id==='qa-probe');return p&&!p.active&&p.disabledReason.includes('自动停用')`), 10000, 'auto disabled');
  await until(() => T(`return !Q.plugins.usePlugins.getState().open.some(o=>o.id==='qa-probe')`), 5000, 'panel closed');
  mark('export / reimport keeps a history copy, duplicate, faulty plugin auto-disabled and its panel closed', { hist: hist[0] });

  await T(`s.set({page:'plugins'});return true`);
  await shot(teacher, 'plugins-final');
  const bad = errors.filter((e) => !/Autofill|DevTools|favicon|探针故意出错|Refused to connect|example\.com|ERR_BLOCKED|Not allowed to load local resource|net::ERR/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
