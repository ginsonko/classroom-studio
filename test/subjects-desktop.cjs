// 学科包桌面验收：数学学生（规则/AI 识题、题库筛选、学习地图、知识网络、隐藏物理演示）+ 物理学生不受影响。
// 用法：npm run build 后 npx electron test/quiet.cjs test/subjects-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'subjects-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stuMath = { id: 'stu-m', name: '小舟', grade: '高二', subject: 'math', hue: 260, textbook: '人教A版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' };
const stuPhys = { id: 'stu-w', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [stuMath, stuPhys], studentId: 'stu-m', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(80); } throw Error('Timed out ' + what); };
const shot = async (w, name) => { await sleep(400); w.webContents.invalidate(); await sleep(300); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('subjects desktop timed out'); app.exit(1); }, 240000);

// ── 假模型：识题按数学包提示词分流 ──
let requests = [];
function reply(j) {
  const all = JSON.stringify(j.messages);
  if (all.includes('知识点清单')) return JSON.stringify({ stem: '已知函数 f(x)=x³-3x²-9x+1，求 f(x) 的单调区间。', answer: '递增区间 (-∞,-1) 和 (3,+∞)，递减区间 (-1,3)', analysis: "f'(x)=3x²-6x-9=3(x+1)(x-3)", points: ['m14.2 导数与单调性'], difficulty: 3, qtype: '解答' });
  return '{}';
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: reply(j) } }], usage: { prompt_tokens: 500, completion_tokens: 150 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  // 隐藏窗口 capturePage 拿到的是上一帧；放在屏幕外显示（不抢焦点）截图才是当前画面
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),S=Q.useStudy.getState();${code}}catch(e){return {__err:String(e&&e.message||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const select = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  await until(() => T(`return S.loaded`), 8000, 'study loaded');

  // ── 1. 数学学生：顶栏显示学科，收件箱粘贴（规则识别）按数学包打标签 ──
  await T(`localStorage.setItem('cs.study.autoRead','0');s.set({page:'study'});return true`);
  await until(() => T(`return document.querySelector('.ags-title span')?.innerText.includes('小舟（数学）')`), 6000, 'subject in header');
  await click('.sd-bar .sd-btn', '粘贴题目');
  await type('.record-editor textarea', '已知函数 f(x)=x³-3x，求 f(x) 的单调区间和极值。');
  await click('.record-editor .btn-cue', '收进收件箱');
  const q1 = await until(() => T(`const q=S.data.questions.find(q=>q.stem.includes('x³-3x'));return q&&q.points.length?q:null`), 6000, 'rules-tagged math question');
  assert.equal(q1.subject, 'math');
  assert.ok(q1.points.some((k) => k === 'm14.2' || k === 'm14.3'), 'points: ' + q1.points);
  assert.ok(q1.points.every((k) => k.startsWith('m')), 'only math points: ' + q1.points);
  assert.equal(q1.qtype, '解答');
  await T(`const b=[...document.querySelectorAll('.sd-editor')];if(b.length)b.forEach(e=>e.querySelector('[aria-label="关闭"]')?.click());return true`);
  mark('math student: header shows subject; pasted question rule-tagged with m-prefixed points and 解答 type', { points: q1.points });

  // ── 2. AI 识题：提示词是数学包（数学题 + m 前缀知识点清单），结果入对知识点 ──
  await T(`localStorage.setItem('cs.study.autoRead','1');return true`);
  await click('.sd-bar .sd-btn', '粘贴题目');
  await type('.record-editor textarea', 'AI识题标记：求函数的单调区间。');
  await click('.record-editor .btn-cue', '收进收件箱');
  const q2 = await until(() => T(`const q=S.data.questions.find(q=>q.stem.includes('AI识题标记'));return q&&q.points.length?q:null`), 15000, 'ai read math question');
  assert.deepEqual(q2.points, ['m14.2']);
  assert.equal(q2.qtype, '解答');
  assert.equal(q2.subject, 'math');
  const readReq = requests.find((r) => JSON.stringify(r.messages).includes('知识点清单'));
  const readText = JSON.stringify(readReq.messages);
  assert.ok(readText.includes('数学题'), 'read prompt is the math pack prompt');
  assert.ok(readText.includes('m14.2') && !readText.includes('洛伦兹力'), 'point list is math-prefixed, no physics');
  await T(`const b=[...document.querySelectorAll('.sd-editor')];if(b.length)b.forEach(e=>e.querySelector('[aria-label="关闭"]')?.click());return true`);
  await shot(teacher, 'subjects-1-math-inbox.png');
  mark('AI read uses the math pack prompt (数学题 + m-prefixed point list), result lands on m14.2');

  // ── 3. 题库：默认只显示当前学科，「全部学科」能看到物理题；章节筛选是数学目录 ──
  await T(`const now=new Date().toISOString();S.update(d=>({...d,questions:[...d.questions,{id:'seed-p',stem:'物理题标记：质子垂直进入匀强磁场，求轨迹半径。',answer:'0.21 m',points:['16.2'],difficulty:3,qtype:'计算',origin:'manual',status:'bank',createdAt:now}]}));return true`);
  await click('.sd-bar .sd-btn', '全部入库');
  await until(() => T(`return S.data.questions.filter(q=>q.status==='bank').length===3`), 4000, 'three in bank');
  await click('.ags-tabs button', '题库');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===2`), 6000, 'bank filtered to math');
  const opts = await T(`return [...document.querySelectorAll('.sd-select')].map(el=>[...el.options].map(o=>o.innerText))`);
  assert.ok(opts[0].some((o) => o.includes('数学（当前学生）')) && opts[0].includes('全部学科'), 'subject options: ' + opts[0]);
  assert.ok(opts[1].some((o) => o.includes('一元函数的导数')) && !opts[1].some((o) => o.includes('磁场')), 'chapter options are math: ' + opts[1].slice(0, 4));
  await select('.sd-select', 'all');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===3`), 4000, 'all subjects');
  assert.ok(await T(`return [...document.querySelectorAll('.sd-q')].some(c=>c.innerText.includes('物理题标记'))`));
  await select('.sd-select', 'math');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===2`), 4000, 'back to math');
  await shot(teacher, 'subjects-2-bank-filter.png');
  mark('bank: defaults to the current subject, chapter filter is the math catalog, 全部学科 shows physics too');

  // ── 4. 学习地图：数学目录（5 本书），点格子写进 stu-m@math，不动物理地图 ──
  await T(`s.set({page:'students'});return true`);
  await until(() => T(`return document.querySelectorAll('.map-book').length===5`), 6000, 'math books');
  const mapInfo = await T(`return {books:[...document.querySelectorAll('.map-bk')].map(b=>b.innerText),chs:document.querySelectorAll('.map-ch').length,meta:document.querySelector('.stu-meta')?.innerText}`);
  assert.deepEqual(mapInfo.books, ['必修一', '必修二', '选必一', '选必二', '选必三']);
  assert.equal(mapInfo.chs, 18, 'math chapters');
  assert.ok(mapInfo.meta.includes('数学'), 'hero shows subject');
  const badges = await T(`return [...document.querySelectorAll('.stu-i')].map(e=>e.querySelector('.stu-sub')?.innerText)`);
  assert.ok(badges.includes('高中数学') && badges.includes('高中物理'), 'list badges: ' + badges);
  assert.ok(await T(`return document.querySelector('.sd-portrait .sub')?.innerText.startsWith('数学')`), 'portrait is per subject');
  assert.ok(await T(`return document.querySelector('.stu-parent')?.innerText.includes('未设置')`), 'parent contacts button in hero');
  await shot(teacher, 'subjects-2b-student-page.png');
  await T(`document.querySelector('.stu-parent').click();return true`);
  await until(() => T(`return document.querySelector('.ps-sheet .card-h b')?.innerText.includes('家长联系方式')`), 4000, 'contacts sheet from student page');
  await T(`document.querySelector('.ps-sheet .card-h button').click();return true`);
  await until(() => T(`return !document.querySelector('.ps-sheet')`), 3000, 'contacts sheet closed');
  await T(`document.querySelector('.map-cells .cell').click();return true`);
  await until(() => T(`return s.learning['stu-m@math']?.[0]?.[0]==='learning'&&s.learning['stu-m']===undefined`), 4000, 'map stored under stu-m@math');
  await shot(teacher, 'subjects-3-math-map.png');
  mark('learning map: math catalog (5 books / 18 chapters), cell click stored under stu-m@math, physics map untouched');

  // ── 5. 知识网络：数学知识点，没有物理内容 ──
  await T(`s.set({page:'study'});return true`);
  await click('.ags-tabs button', '知识网络');
  await until(() => T(`return document.querySelectorAll('.kn-node').length===76`), 6000, 'math network nodes');
  const net = await T(`return {ellipse:[...document.querySelectorAll('.kn-node')].some(b=>b.innerText==='椭圆'),physics:[...document.querySelectorAll('.kn-node')].some(b=>b.innerText.includes('洛伦兹力')),books:[...document.querySelectorAll('.kn-bk')].map(b=>b.innerText),note:document.querySelector('.kn-side .sd-note')?.innerText||''}`);
  assert.ok(net.ellipse && !net.physics);
  assert.equal(net.books.length, 5);
  await T(`[...document.querySelectorAll('.kn-node')].find(b=>b.innerText==='直线与圆锥曲线（专题）').click();return true`);
  await until(() => T(`return document.querySelectorAll('.kn-svg path.kn-e').length>=3&&[...document.querySelectorAll('.kn-chip')].some(c=>c.innerText==='直线与圆、圆与圆的位置关系')`), 4000, 'math prerequisite chain');
  await shot(teacher, 'subjects-4-math-network.png');
  mark('knowledge network: 76 math nodes, math prerequisite chains, no physics content');

  // ── 6. 数学学生：AI 面板的「做成演示」变成数学演示，只有数学演示库，没有物理模板库 ──
  await T(`s.set({page:'console',aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-explain')`), 8000, 'ai panel');
  assert.ok(await T(`return document.querySelector('.ai-act.a-demo')?.innerText.includes('数学演示')`), 'demo action is the math demo');
  // 演示库三科都在，默认停在学生的学科；AI 的学科也跟着学生，可以临时切换
  if (!(await T(`return !!document.querySelector('.ai-lib-tabs')`))) await T(`document.querySelector('.ai-lib-h').click();return true`);
  await until(() => T(`return document.querySelectorAll('.ai-lib-tabs button').length===3`), 4000, 'library tabs');
  assert.match(await T(`return document.querySelector('.ai-lib-tabs button.on').innerText`), /数学/);
  assert.match(await T(`return document.querySelector('.ai-subj > button.on').innerText`), /数学/);
  assert.equal(await T(`return !!document.querySelector('.ai-subj i')`), false, 'no temporary-switch note');
  await click('.ai-subj button', '物理');
  await until(() => T(`return document.querySelector('.ai-subj i')?.innerText.includes('临时切换')&&document.querySelector('.ai-act.a-demo')?.innerText.includes('物理引擎')&&document.querySelector('.ai-lib-tabs button.on').innerText.includes('物理')`), 3000, 'temporary physics');
  await shot(teacher, 'subjects-5-math-ai.png');
  await click('.ai-subj button', '数学');
  mark('math student: AI subject and demo library default to math; teacher can switch to physics tools for a while');

  // ── 7. 切到物理学生：演示入口回来，题库/收件箱/地图都是物理 ──
  await T(`s.set({studentId:'stu-w'});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-demo')`), 6000, 'demo action back');
  await until(() => T(`return document.querySelector('.ai-lib-tabs button.on')?.innerText.includes('物理')&&document.querySelector('.ai-subj > button.on')?.innerText.includes('物理')`), 4000, 'physics library tab');
  await T(`s.set({page:'study',aiOpen:false});return true`);
  await until(() => T(`return document.querySelector('.ags-title span')?.innerText.includes('小林（物理）')`), 6000, 'physics header');
  assert.ok(await T(`return document.querySelector('.lib-empty')?.innerText.includes('收件箱是空的')`), 'physics inbox is empty (math items filtered)');
  await click('.ags-tabs button', '题库');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===1&&[...document.querySelectorAll('.sd-q')].some(c=>c.innerText.includes('物理题标记'))`), 6000, 'physics bank only');
  await T(`s.set({page:'students'});return true`);
  await until(() => T(`return document.querySelectorAll('.map-book').length===6`), 6000, 'physics books');
  assert.ok(await T(`return s.learning['stu-m@math']?.[0]?.[0]==='learning'`), 'math map preserved');
  await shot(teacher, 'subjects-6-physics.png');
  mark('physics student unaffected: demo entries back, bank/inbox/map are physics, math data preserved');

  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, requests: requests.length, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
