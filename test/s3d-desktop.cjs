// 立体演示智能体桌面验收：本机假模型服务（OpenAI 兼容）+ 真实 AI 面板，默认立体引擎。
// 用法：npx electron test/quiet.cjs test/s3d-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 's3d-' + Date.now()); fs.mkdirSync(out, { recursive: true });
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
const timer = setTimeout(() => { console.error('s3d desktop timed out'); app.exit(1); }, 120000);

// ── 假模型：按剧本回复，记录每次请求 ──
// 立体规格：平抛小球（一次过）；经典方案：匀速小车（回退测试用）
const spec = JSON.stringify({
  understand: '小球从 5 m 高处水平抛出', expect: '1 秒落地，水平 3 m',
  spec: {
    title: '平抛运动', subject: 'physics', mode: 'motion', duration: 1.2,
    params: [{ key: 'v0', label: '初速度', min: 1, max: 6, value: 3, unit: 'm/s' }],
    objects: [
      { id: 'floor', type: 'ground', pos: [3, 0, 0], size: [10, 3] },
      { id: 'A', type: 'ball', pos: [0, 5, 0], r: 0.25, color: 'red', label: 'A', motion: { type: 'projectile', v0: 'v0', angle: 0 } },
      { id: 'tr', type: 'trail', of: 'A' },
    ],
    charts: [{ title: '速度', series: [{ y: 'A.v', name: 'v' }], yLabel: 'v/(m/s)' }],
  },
});
const ground = { id: 'g', kind: 'ground', x: 0.5, y: 0.5, w: 1, h: 0.02, props: { fixed: true } };
const classicPlan = JSON.stringify({ understand: '匀速小车', expect: '小车向右', plan: { preset: 'none', title: '匀速小车', world: { g: 10, ppm: 0.1 }, duration: 4, objs: [ground, { id: 'A', kind: 'block', x: 0.15, y: 0.47, w: 0.06, h: 0.04, label: 'A', props: { m: 1, vx: 2, mu: 0 } }] } });
let script = [], requests = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    requests.push(j);
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
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});localStorage.setItem('cs.ai.screen','0');localStorage.removeItem('cs.ai.demoEngine');s.set({aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-demo')&&document.querySelector('.ai-model.on')`), 8000, 'ai panel online');
  const ask = async (text) => {
    await T(`const ta=document.querySelector('.ai-compose textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,${JSON.stringify(text)});ta.dispatchEvent(new Event('input',{bubbles:true}));return true`);
    await sleep(100);
    await T(`document.querySelector('.ai-act.a-demo').click();return true`);
  };

  // ── 0. 默认引擎是立体，面板上有切换按钮 ──
  const chip = await T(`return [...document.querySelectorAll('.ai-chip')].map(b=>b.innerText).join('|')`);
  assert.ok(chip.includes('立体演示'), 'engine chip: ' + chip);

  // ── 1. 模型先给坏 JSON，再给规格 → 校验、渲染联系表 → 确认 ──
  script = ['看不懂', spec, '{"accept":true,"why":"和题目一致"}'];
  await ask('小球从 5 m 高的桌面以 3 m/s 水平抛出，演示平抛运动');
  await until(() => T(`return !!document.querySelector('.ai-card .ai-ok')`), 40000, 'accepted s3d card');
  assert.equal(requests.length, 3);
  assert.match(String(requests[0].messages[0].content), /立体演示规格/, 's3d system prompt');
  const report = requests[2].messages.at(-1);
  assert.ok(Array.isArray(report.content), 'review has parts');
  assert.match(report.content[0].text, /导播台渲染了你的第 1 版规格/);
  const img = report.content.find((p) => p.type === 'image_url');
  assert.ok(img && img.image_url.url.startsWith('data:image/jpeg;base64,') && img.image_url.url.length > 20000, 'contact sheet sent to model');
  assert.ok(requests[2].model === 'fake-vision', 'image turns go to the vision model');
  const card = await T(`const c=document.querySelector('.ai-card');return {title:c.querySelector('.ai-out-t')?.innerText,kind:c.querySelector('.ai-card-k')?.innerText,sheet:!!c.querySelector('.ai-sheet'),classic:!![...c.querySelectorAll('button')].find(b=>b.innerText.includes('换经典演示'))}`);
  assert.match(card.title, /平抛运动/);
  assert.match(card.title, /立体/, 's3d badge');
  assert.match(card.kind, /立体演示/, 'card kind');
  assert.ok(card.sheet && card.classic, 'sheet + 换经典演示 button: ' + JSON.stringify(card));
  await shot(teacher, 's3d-accepted.png');
  // 我先看 → 预览里是立体演示（canvas + 控制条），上屏到学生窗口
  await T(`[...document.querySelectorAll('.ai-card .ai-out-b button')].find(b=>b.innerText.includes('我先看')).click();return true`);
  await until(() => T(`return s.reader.mat.kind==='sim'&&!!s.reader.mat.s3d&&!!document.querySelector('.s3dhost canvas')`), 8000, 's3d preview');
  const px = await until(() => T(`const c=document.querySelector('.s3dhost canvas');if(!c||!c.width)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<d.length;i+=997)if(d[i]>40||d[i+1]>40||d[i+2]>40)lit++;return lit>20`), 10000, 'preview 3D canvas painted').catch(() => false);
  assert.ok(px, '3D canvas has pixels');
  await T(`[...document.querySelectorAll('.ai-card .ai-out-b button')].find(b=>b.innerText.includes('上屏')).click();return true`);
  await until(() => T(`return s.pgmMat&&s.pgmMat.id===s.reader.mat.id&&!!s.pgmMat.s3d`), 5000, 'on air');
  mark('s3d agent: bad JSON corrected, contact sheet verified by model, preview renders WebGL, goes on air', { requests: requests.length });

  // ── 2. 学生窗口也在渲染同一个三维场景（共享时钟） ──
  const student = api.windows.get('student');
  assert.ok(student, 'student window');
  await until(() => call(student, `(()=>{const c=document.querySelector('.s3dhost canvas');if(!c)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=997)if(d[i]>40)return true;return false})()`), 15000, 'student 3D canvas');
  mark('student window renders the same 3D scene');

  // ── 3. 五次都通不过校验 → 自动回退经典引擎，备注里说明 ──
  requests = []; script = ['胡说', '胡说', '胡说', '胡说', '胡说', classicPlan, '{"accept":true,"why":"好"}'];
  await ask('光滑水平面上小车以 2 m/s 匀速运动，演示它的运动');
  await until(() => T(`const c=document.querySelector('.ai-card');return !c.classList.contains('pending')&&(!!c.querySelector('.ai-ok')||c.classList.contains('failed'))`), 60000, 'fallback card');
  const fb = await T(`const c=document.querySelector('.ai-card');return {ok:!!c.querySelector('.ai-ok'),note:c.querySelector('.ai-note')?.innerText,warn:c.querySelector('.ai-warn')?.innerText,foot:c.querySelector('.ai-foot-note')?.innerText}`);
  assert.ok(fb.ok, 'fallback finished: ' + JSON.stringify(fb));
  assert.match(fb.warn || '', /已改用经典演示/);
  assert.match(fb.foot || '', /导播台真的运行了一遍/, 'classic engine footnote');
  await shot(teacher, 's3d-fallback.png');
  mark('invalid specs five times: automatic fallback to the classic engine with a clear note', { calls: requests.length });

  const ledger = api.ledger?.entries?.filter((e) => e.feature === 'AI 立体演示').length;
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, ledger, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((error) => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
