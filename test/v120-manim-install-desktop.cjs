// manim 一键安装桌面验收（离线：假 PyPI 镜像 + 真的 Python 便携包和 pip，假 manim 包）：
// 没装时「讲解动画」按钮旁边是「一键安装 manim」，讲题卡片里也有安装入口 → 第一次镜像出错，卡片和面板里看到失败原因和「重试安装」
// → 镜像恢复后重试 → 进度条走完 → 自动重新检测，「讲解动画」能点、讲题卡片出现「做成讲解动画」。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v120-manim-install-desktop.cjs   （CS_SHOW=1 显示窗口并截图）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const { fakeMirror, fakeUrls } = require('./manimFake.cjs');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'manim-install-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data'); process.env.CS_MANIM = 'own';
const PORT = 20000 + Math.floor(Math.random() * 20000);
const urls = fakeUrls(`http://127.0.0.1:${PORT}`);
process.env.CS_MANIM_SETUP = JSON.stringify({ mirrors: [urls.mirror('测试', 'a')], pyUrls: urls.pyUrls });
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'stu-w', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('manim install desktop timed out'); app.exit(1); }, 480000);

const EXPLAIN = { title: '匀加速', problem: '汽车从静止以 2 m/s² 加速，5 s 末速度多大？', idea: '速度公式', steps: [{ t: '代入', tex: 'v=at=10', plain: 'v=10 m/s' }], answer: '10 m/s', pitfalls: [] };
const ai = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: JSON.stringify(EXPLAIN) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
  });
});

(async () => {
  const opts = { port: PORT, fail: ['a'] };
  const fake = await fakeMirror(opts);
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (code) => teacher.webContents.executeJavaScript(code);
  await until(() => call('!!window.__studioQA'));
  const show = process.env.CS_SHOW === '1';
  const left = show ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (show) teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(`(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error(r.__err); return r; };
  const shot = async (name) => { if (!show) return; await sleep(400); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('no button '+${JSON.stringify(text)});b.click();return true`);

  await T(`await window.csHost.call('ai.setConfig',{baseUrl:'http://127.0.0.1:${ai.address().port}/v1',model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});localStorage.setItem('cs.ai.screen','0');s.set({page:'console',aiOpen:true});return true`);

  // ── 1. 没装：按钮不能点，旁边有「一键安装 manim」；讲题卡片里也有安装入口 ──
  const status = await T(`return await window.csHost.call('manim.status')`);
  assert.equal(status.ok, false); assert.equal(status.installable, true);
  const before = await until(() => T(`const b=document.querySelector('.ai-act.a-anim'),g=document.querySelector('.ai-act-wrap:has(.a-anim) .ai-manim-inst-go');return b&&g&&!/正在检测/.test(b.dataset.tip||'')?{dis:b.disabled,tip:b.dataset.tip,go:g.innerText}:null`), 60000, 'install button');
  assert.equal(before.dis, true); assert.match(before.tip, /还没装 manim/); assert.match(before.go, /一键安装 manim/);
  await T(`const el=document.querySelector('.ai-compose textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(EXPLAIN.problem)});el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ai-act.a-explain').click();return true`);
  const card = await until(() => T(`const m=document.querySelector('.ai-card.k-explain .ai-manim');return m&&m.querySelector('.ai-manim-inst-btn')?m.innerText:null`), 30000, 'explain card install entry');
  assert.match(card, /可选组件/); assert.match(card, /380 MB/);
  assert.equal(await T(`return !!document.querySelector('.ai-card.k-explain .ai-manim-go')`), false);
  await shot('install-1-before.png');
  mark('not installed: 讲解动画 disabled with 一键安装 manim beside it; explain card offers 一键安装');

  // ── 2. 镜像出错：卡片和面板都显示失败原因和「重试安装」 ──
  await click('.ai-card.k-explain .ai-manim-inst-btn', '一键安装');
  await until(() => T(`return !!document.querySelector('.ai-manim-inst.run .ai-manim-bar')`), 10000, 'progress shown');
  const running = await T(`return {go:document.querySelector('.ai-act-wrap:has(.a-anim) .ai-manim-inst-go')?.innerText,panel:!!document.querySelector('.ai-panel .ai-manim-inst.run, .ai-manim-inst.run')}`);
  assert.match(running.go, /安装中 \d+%/);
  await shot('install-2-running.png');
  const failed = await until(() => T(`const m=document.querySelector('.ai-card.k-explain .ai-manim-inst.bad');return m?m.innerText:null`), 180000, 'install failure');
  assert.match(failed, /安装没成功/); assert.match(failed, /重试安装/); assert.match(failed, /网络不稳定或镜像暂时出错/);
  assert.ok(!/HTTPConnectionPool|ERROR:/.test(failed.split('安装记录')[0]), 'no raw pip text in the message: ' + failed);
  await click('.ai-card.k-explain .ai-manim-inst.bad .ai-manim-log', '安装记录');
  const log = await T(`return document.querySelector('.ai-card.k-explain .ai-manim-inst pre').innerText`);
  assert.match(log, /下载 Python/); assert.match(log, /失败：/); assert.match(log, /测试镜像出错：.*500/);
  assert.equal(await T(`return document.querySelectorAll('.ai-manim-inst.bad').length`), 2, 'panel shows the failure too');
  await shot('install-3-failed.png');
  mark('mirror error: card and panel show the reason, the install log and 重试安装', { log: log.split('\n').slice(-3) });

  // ── 3. 镜像恢复，重试 → 装好后自动重新检测，按钮和卡片都能用了 ──
  opts.fail.length = 0;
  await click('.ai-card.k-explain .ai-manim-inst-btn', '重试安装');
  const pcts = [];
  const after = await until(async () => {
    const r = await T(`const b=document.querySelector('.ai-act.a-anim'),bar=document.querySelector('.ai-manim-bar > i');return {dis:b.disabled,text:b.innerText,bar:bar?parseFloat(bar.style.width):null,go:!!document.querySelector('.ai-card.k-explain .ai-manim-go')}`);
    if (r.bar !== null) pcts.push(r.bar);
    return !r.dis && r.go ? r : null;
  }, 240000, 'installed and detected');
  assert.match(after.text, /manim 0\.22\.0/);
  assert.ok(pcts.length >= 2 && pcts.at(-1) > pcts[0], 'progress bar moved: ' + pcts.join(','));
  assert.equal(await T(`return !!document.querySelector('.ai-manim-inst')`), false, 'install UI gone');
  const st2 = await T(`return await window.csHost.call('manim.status')`);
  assert.equal(st2.ok, true); assert.equal(st2.portable, true);
  assert.ok(fs.existsSync(path.join(process.env.CS_DATA_DIR, 'tools', 'manim', 'ok.json')), 'installed under the data dir');
  await shot('install-4-done.png');
  mark('retry succeeds: progress bar moves, status re-checked automatically, 讲解动画 and 做成讲解动画 become available', { pcts: pcts.length, status: st2 });

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); await fake.close(); ai.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t && process.env.CS_SHOW === '1') fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
