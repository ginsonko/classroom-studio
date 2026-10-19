// AI 演示智能体桌面验收：本机假模型服务（OpenAI 兼容）+ 真实 AI 面板。
// 用法：npx electron test/quiet.cjs test/ai-demo-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'aidemo-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-1', name: '小林' }], slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(60); } throw Error('Timed out ' + what); };
const shot = async (w, name) => { await sleep(700); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('ai demo desktop timed out'); app.exit(1); }, 120000);

// ── 假模型：按剧本回复，记录每次请求 ──
const ground = { id: 'g', kind: 'ground', x: 0.5, y: 0.5, w: 1, h: 0.02, props: { fixed: true } };
const plan = (vx) => JSON.stringify({ understand: '光滑水平面上小车以 2 m/s 匀速运动', expect: '小车 A 向右匀速运动', plan: { preset: 'none', title: '匀速小车', world: { g: 10, ppm: 0.1 }, duration: 4, objs: [ground, { id: 'A', kind: 'block', x: 0.15, y: 0.47, w: 0.06, h: 0.04, label: 'A', props: { m: 1, vx, mu: 0 } }] } });
let script = [], requests = [], rejectImages = false;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    requests.push(j);
    if (rejectImages && JSON.stringify(j.messages).includes('"image_url"')) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"image input not supported"}}'); return; }
    const reply = script.length > 1 ? script.shift() : script[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: reply } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  if (process.env.CS_SHOW === '1') { teacher.setBounds({ x: 40, y: 40, width: 1360, height: 860 }); teacher.show(); }
  const T = (code) => call(teacher, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});localStorage.setItem('cs.ai.screen','0');localStorage.setItem('cs.ai.demoEngine','classic');s.set({aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-demo')&&document.querySelector('.ai-model.on')`), 8000, 'ai panel online');
  const ask = async (text) => {
    await T(`const ta=document.querySelector('.ai-compose textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,${JSON.stringify(text)});ta.dispatchEvent(new Event('input',{bubbles:true}));return true`);
    await sleep(100);
    await T(`document.querySelector('.ai-act.a-demo').click();return true`);
  };

  // ── 1. 第一版不会动 → 导播台试播发现 → 模型修正 → 确认 ──
  script = [plan(0), plan(2), '{"accept":true,"why":"小车向右匀速，与题目一致"}'];
  await ask('光滑水平面上小车以 2 m/s 匀速运动，演示它的运动');
  const sawProgress = await until(() => T(`return document.querySelectorAll('.ai-card.pending .ai-prog > div').length>0`), 15000, 'live progress').catch(() => false);
  await until(() => T(`return !!document.querySelector('.ai-card .ai-ok')`), 30000, 'accepted demo card');
  assert.equal(requests.length, 3);
  assert.ok(requests.every((r) => r.response_format === undefined || r.response_format.type === 'json_object'));
  const report = requests[1].messages.at(-1);
  assert.ok(Array.isArray(report.content), 'trial report has parts');
  const img = report.content.find((p) => p.type === 'image_url');
  assert.ok(img && img.image_url.url.startsWith('data:image/jpeg;base64,') && img.image_url.url.length > 20000, 'contact sheet sent to model');
  assert.match(report.content[0].text, /静止|几乎不动/);
  assert.equal(requests[1].model, 'fake-vision', 'image turns go to the vision model');
  assert.equal(requests[0].model, 'fake-text', 'text-only first turn uses the text model');
  const card = await T(`const c=document.querySelector('.ai-card');const im=c.querySelector('.ai-sheet');return {title:c.querySelector('.ai-out-t')?.innerText,sheet:!!im&&im.naturalWidth>600,note:c.querySelector('.ai-note')?.innerText,log:c.querySelector('.ai-log button')?.innerText}`);
  assert.ok(card.sheet, 'contact sheet image shown'); assert.match(card.title, /匀速小车/); assert.match(card.log, /AI 的过程/);
  await T(`document.querySelector('.ai-card .ai-log button').click();return true`);
  await shot(teacher, 'ai-demo-accepted.png');
  await T(`[...document.querySelectorAll('.ai-card .ai-out-b button')].find(b=>b.innerText.includes('我先看')).click();return true`);
  await until(() => T(`return s.reader.mat.kind==='sim'&&s.reader.mat.scene.objs.some(o=>o.id==='A'&&o.props.vx===2)`), 5000, 'opened in preview');
  mark('static first plan is caught by the trial run, model fixes it, card shows contact sheet + verified badge', { sawProgress, requests: requests.length });

  // ── 2. 模型一直给不出能用的方案 → 报错，不自动换成无关模板；规则猜测只作为按钮 ──
  requests = []; script = ['{"plan":{"preset":"rocket"}}'];
  await ask('倾角为 37° 的斜面上，质量 2 kg 的物块从静止开始下滑，物块与斜面间的动摩擦因数为 0.25，斜面长 4 m。');
  await until(() => T(`return !!document.querySelector('.ai-card.failed')`), 30000, 'failed card');
  assert.ok(requests.length <= 5, 'call cap');
  const btn = await T(`return [...document.querySelectorAll('.ai-card.failed .ai-err-b button')].map(b=>b.innerText)`);
  assert.ok(btn.some((t) => t.includes('规则模板')), 'guess offered: ' + btn.join('|'));
  await shot(teacher, 'ai-demo-failed.png');
  await T(`[...document.querySelectorAll('.ai-card.failed .ai-err-b button')].find(b=>b.innerText.includes('规则模板')).click();return true`);
  await until(() => T(`return [...document.querySelectorAll('.ai-card .ai-foot-note')].some(x=>x.innerText.includes('规则识别'))`), 5000, 'rule card');
  mark('failure does not silently fall back; rule guess is an explicit button that works', { calls: requests.length, buttons: btn });

  // ── 3. 模型不支持看图：试播截图被拒 → 改发文字摘要，流程照常完成 ──
  requests = []; rejectImages = true; script = [plan(0), plan(2), '{"accept":true}'];
  await ask('光滑水平面上小车以 2 m/s 匀速运动（模型不支持看图）');
  await until(() => T(`const c=document.querySelector('.ai-card');return !c.classList.contains('pending')&&(c.querySelector('.ai-ok')||c.classList.contains('failed'))`), 30000, 'text-only result');
  const r3 = await T(`const c=document.querySelector('.ai-card');return {ok:!!c.querySelector('.ai-ok'),err:c.querySelector('.ai-err p')?.innerText}`);
  assert.ok(r3.ok, 'text-only fallback should finish: ' + r3.err);
  assert.ok(requests.some((q) => JSON.stringify(q.messages).includes('image_url')) && !JSON.stringify(requests.at(-1).messages).includes('image_url'));
  rejectImages = false;
  mark('model without image support: contact sheets dropped, text summary only, demo still verified', { calls: requests.length });

  const ledger = api.ledger?.entries?.filter((e) => e.feature === 'AI 演示').length;
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, ledger, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((error) => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
