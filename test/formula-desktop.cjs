// 手写公式识别桌面验收：浮层 Σ → 截图发视觉模型 → 预览 → 替换笔迹 → 学生端画出公式 → 撤销 → 修改公式 → 直接输入 LaTeX → 写错提示。
// 用法：npm run build 后 npx electron test/quiet.cjs test/formula-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'formula-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-m', name: '小舟', grade: '高二', subject: 'math', hue: 260, textbook: '人教A版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, drawAuthor: 'teacher' },
  local: { roots: [], students: [stu], studentId: 'stu-m', slots: [], learning: {} },
}));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(80); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('formula desktop timed out'); app.exit(1); }, 240000);

const LATEX = '\\frac{x^2-1}{x+1}=x-1';
let requests = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const content = JSON.stringify({ latex: '$' + LATEX + '$', text: '(x^2-1)/(x+1)=x-1', note: '分母里的 1 有点像 l' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 900, completion_tokens: 60 } }));
  });
});

// 一个手写的「x²−1」大致形状：几笔折线，带压感
const pen = (id, pts) => ({ id, tool: 'pen', color: 'ink', size: 3.5, author: 'teacher', layer: 'public', pts: pts.flatMap(([x, y]) => [x, y, 0.5]) });
const strokes = [
  pen('h1', [[0.30, 0.20], [0.33, 0.25], [0.36, 0.30]]), pen('h2', [[0.36, 0.20], [0.33, 0.25], [0.30, 0.30]]),
  pen('h3', [[0.37, 0.18], [0.385, 0.17], [0.39, 0.185], [0.375, 0.20], [0.395, 0.20]]),
  pen('h4', [[0.41, 0.25], [0.45, 0.25]]), pen('h5', [[0.47, 0.20], [0.47, 0.30]]),
];

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1280, height: 800 });
  student.setBounds({ x: left, y: 860, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock')&&!!window.__studioQA`).catch(() => false), 15000, 'dock ready');
  const shapes = []; const orig = api.dock.message;
  api.dock.message = (m) => { if (m?.type === 'shape') shapes.push(m.rects); return orig(m); };
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), D = run(dock, 'dock'), S = run(student, 'student');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const setText = (sel, value) => D(`const el=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const key = await T(`return Q.inkKey('board',0)`);
  const K = JSON.stringify(key);

  // ── 1. 数学学生：浮层有 Σ 公式按钮、编辑按钮，没有「力」工具 ──
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  await until(() => D(`return s.subject==='math'&&!!document.querySelector('.tp-fx')`), 8000, 'formula button').catch(async (e) => { throw Error(e.message + ' dock subject=' + await D('return s.subject') + ' teacher subject=' + await T('return s.subject+" "+s.studentId+" "+s.students.length')); });
  assert.equal(await D(`return [...document.querySelectorAll('.tdock [aria-label]')].some((b) => /^力 /.test(b.getAttribute('aria-label')))`), false, 'no force tool for math');
  assert.ok(await D(`return !!document.querySelector('[aria-label="编辑选中内容"]')`), 'selection editor available for math');
  mark('math dock: Σ formula button and selection editor are there, physics objects are not');

  // ── 2. 选中手写笔迹 → Σ → 截图发给视觉模型 → 识别结果 + 预览 ──
  await T(`for(const x of ${JSON.stringify(strokes)})s.addStroke(${K},x);s.setShared({selectedInk:{key:${K},ids:${JSON.stringify(strokes.map((x) => x.id))}}});s.set({tool:'select'});return true`);
  await until(() => D(`return s.selectedInk?.ids.length===5&&(s.ink[${K}]||[]).length===5`), 6000, 'selection synced to dock');
  assert.match(await D(`return document.querySelector('.tp-fx').dataset.tip`), /识别/);
  await D(`document.querySelector('.tp-fx').click();return true`);
  await until(() => D(`return document.querySelector('.fx header b')?.innerText==='识别手写公式'`), 6000, 'sheet opens in dock');
  await until(() => D(`return document.querySelector('.fx-tex textarea').value===${JSON.stringify(LATEX)}`), 10000, 'recognized latex (dollar signs stripped)');
  const req = requests.at(-1), user = req.messages.at(-1);
  assert.equal(req.model, 'fake-vision', 'uses the vision model');
  const img = user.content.find((c) => c.type === 'image_url'), txt = user.content.find((c) => c.type === 'text');
  assert.ok(img && /^data:image\/png;base64,/.test(img.image_url.url), 'sends the ink snapshot as PNG');
  assert.ok(img.image_url.url.length > 2000 && txt.text.includes('数学课') && txt.text.includes('不要解题'), 'math prompt');
  const ui = await D(`await new Promise(r=>setTimeout(r,500));const c=document.querySelector('.fx-preview canvas'),x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<x.length;i+=4)if(x[i]>0)n++;return {status:document.querySelector('.fx-status').innerText,note:document.querySelector('.fx-note')?.innerText,shot:document.querySelector('.fx-shot img')?.naturalWidth,ink:n,go:!document.querySelector('.fx-go').disabled,w:innerWidth,h:innerHeight,box:document.querySelector('.fx').getBoundingClientRect().toJSON()}`);
  assert.match(ui.status, /识别完成 · fake-vision/);
  assert.match(ui.note, /有点像 l/);
  assert.ok(ui.shot > 100 && ui.ink > 300 && ui.go, 'snapshot shown, preview drawn, apply enabled: ' + JSON.stringify(ui));
  assert.ok(ui.box.left >= 0 && ui.box.top >= 0 && ui.box.right <= ui.w && ui.box.bottom <= ui.h, 'sheet fully inside the dock window');
  await until(() => { const l = shapes.at(-1); return l && l.length === 1 && l[0].x === 0 && Math.round(l[0].width) === ui.w; }, 3000, 'dock shape opens up for the sheet');
  await shot(dock, 'formula-1-recognized.png');
  mark('Σ on selected ink: PNG snapshot sent to the vision model with a math prompt, LaTeX cleaned, note shown, MathJax preview drawn, sheet fully visible', { status: ui.status });

  // ── 3. 替换笔迹：手写删掉，换成公式；学生端画出来；撤销能恢复 ──
  await D(`[...document.querySelectorAll('.fx footer button')].find(b=>b.innerText.includes('替换笔迹')).click();return true`);
  await until(() => D(`return !document.querySelector('.fx')`), 3000, 'sheet closed');
  const placed = await until(() => T(`const l=s.ink[${K}]||[];return l.length===1&&l[0].tex?l[0]:null`), 4000, 'ink replaced by a formula');
  assert.equal(placed.tex, LATEX); assert.equal(placed.text, '(x^2-1)/(x+1)=x-1'); assert.equal(placed.tool, 'text');
  const [x0, y0, , x1, y1] = placed.pts;
  assert.ok(Math.abs(x0 - 0.30) < 0.01 && y1 - y0 >= 0.035 && x1 - x0 > (y1 - y0) * 2, 'formula sits where the ink was: ' + placed.pts);
  assert.deepEqual(await D(`return s.selectedInk`), { key, ids: [placed.id] }, 'new formula is selected');
  await until(() => S(`return (s.ink[${K}]||[]).some(x=>x.tex)`), 6000, 'student got the formula');
  const drawn = await until(() => S(`const c=document.querySelector('.ink .ink-c'),r=c.getBoundingClientRect(),k=c.width/r.width,W=r.width;const sx=Math.floor(${x0}*W*k),sy=Math.floor(${y0}*W*k),sw=Math.ceil((${x1}-${x0})*W*k),sh=Math.ceil((${y1}-${y0})*W*k);const d=c.getContext('2d').getImageData(sx,sy,sw,sh).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n>200?n:0`), 10000, 'student canvas draws the formula');
  await shot(student, 'formula-2-student.png', 600);
  await T(`s.undo(${K},'teacher');return true`);
  await until(() => T(`const l=s.ink[${K}]||[];return l.length===5&&!l.some(x=>x.tex)`), 4000, 'undo restores the handwriting');
  await T(`s.redo(${K},'teacher');return true`);
  await until(() => T(`const l=s.ink[${K}]||[];return l.length===1&&!!l[0].tex`), 4000, 'redo puts the formula back');
  mark('替换笔迹: handwriting replaced in one undoable step, formula placed at the ink, selected, drawn on the student canvas', { pixels: drawn });

  // ── 4. 选中公式 → 编辑弹窗里「修改公式」→ 改 LaTeX → 同一个 id 更新 ──
  await D(`s.setShared({selectedInk:{key:${K},ids:[${JSON.stringify(placed.id)}]}});return true`);
  await until(() => D(`return !document.querySelector('[aria-label="编辑选中内容"]').disabled`), 3000, 'editor enabled');
  await D(`document.querySelector('[aria-label="编辑选中内容"]').click();return true`);
  await until(() => D(`return [...document.querySelectorAll('.obj-inspector button')].some(b=>b.innerText.includes('修改公式'))`), 3000, 'inspector offers 修改公式');
  assert.equal(await D(`return !!document.querySelector('.obj-inspector .obj-label')`), false, 'no plain text label field for formulas');
  await D(`[...document.querySelectorAll('.obj-inspector button')].find(b=>b.innerText.includes('修改公式')).click();return true`);
  await until(() => D(`return document.querySelector('.fx header b')?.innerText==='修改公式'&&!document.querySelector('.obj-inspector')`), 3000, 'edit sheet replaces the popup');
  assert.equal(await D(`return document.querySelector('.fx-tex textarea').value`), LATEX);
  await setText('.fx-tex textarea', '\\frac{a}{b}=\\sqrt{2}');
  await until(() => D(`return !document.querySelector('.fx-go').disabled`), 3000, 'compiled');
  await D(`document.querySelector('.fx-go').click();return true`);
  const edited = await until(() => T(`const l=s.ink[${K}]||[];return l.length===1&&l[0].tex==='\\\\frac{a}{b}=\\\\sqrt{2}'?l[0]:null`), 4000, 'formula updated');
  assert.equal(edited.id, placed.id); assert.equal(edited.text, 'a/b=√(2)', 'plain text regenerated for the new LaTeX');
  assert.ok(Math.abs(edited.pts[1] - placed.pts[1]) < 1e-9 && Math.abs((edited.pts[4] - edited.pts[1]) - (y1 - y0)) < 1e-9, 'keeps top and height');
  mark('selection editor → 修改公式: same stroke updated, plain-text reading regenerated, position kept');

  // ── 5. 不选任何东西 → Σ → 直接输入 LaTeX；写错时提示并禁用 ──
  await D(`s.setShared({selectedInk:null});return true`);
  await until(() => D(`return /直接输入 LaTeX/.test(document.querySelector('.tp-fx').dataset.tip)`), 3000, 'tip for insert');
  await D(`document.querySelector('.tp-fx').click();return true`);
  await until(() => D(`return document.querySelector('.fx header b')?.innerText==='插入公式'&&document.querySelectorAll('.fx-eg button').length===4`), 3000, 'insert sheet with examples');
  const before = requests.length;
  await setText('.fx-tex textarea', '\\frac{1}{');
  await until(() => D(`return /公式有误/.test(document.querySelector('.fx-preview span')?.innerText||'')&&document.querySelector('.fx-go').disabled`), 3000, 'syntax error shown');
  await setText('.fx-tex textarea', '\\ce{2H2 + O2 ->[点燃] 2H2O}');
  await until(() => D(`return !document.querySelector('.fx-go').disabled&&!document.querySelector('.fx-preview span')`), 3000, 'chem compiled');
  await shot(dock, 'formula-3-insert.png');
  await D(`document.querySelector('.fx-go').click();return true`);
  const chem = await until(() => T(`return (s.ink[${K}]||[]).find(x=>x.tex&&x.tex.startsWith('\\\\ce'))||null`), 4000, 'chem formula inserted');
  assert.equal(requests.length, before, 'typing LaTeX never calls the model');
  assert.ok(chem.pts[0] > 0.1 && chem.pts[0] + (chem.pts[3] - chem.pts[0]) / 2 - 0.5 < 0.01, 'centered horizontally');
  assert.ok(chem.pts[1] > edited.pts[4], 'placed below what is already on the board, not on top of it');
  await until(() => S(`return (s.ink[${K}]||[]).filter(x=>x.tex).length===2`), 4000, 'student has both formulas');
  await shot(student, 'formula-4-student-both.png', 800);
  mark('no selection → 插入公式: syntax errors disable placing, \\ce chemistry renders, inserted centered without calling the model');

  // ── 6. 浮层「编辑选中内容」→「识别公式」：弹窗关掉，公式面板打开 ──
  const more = [pen('k1', [[0.2, 0.6], [0.25, 0.65]]), pen('k2', [[0.25, 0.6], [0.2, 0.65]])];
  await T(`for(const x of ${JSON.stringify(more)})s.addStroke(${K},x);s.setShared({selectedInk:{key:${K},ids:['k1','k2']}});return true`);
  await until(() => D(`return s.selectedInk?.ids.length===2`), 3000);
  await D(`document.querySelector('[aria-label="编辑选中内容"]').click();return true`);
  await until(() => D(`return [...document.querySelectorAll('.obj-inspector button')].some(b=>b.innerText.includes('识别公式'))`), 3000, 'inspector offers 识别公式');
  await D(`[...document.querySelectorAll('.obj-inspector button')].find(b=>b.innerText.includes('识别公式')).click();return true`);
  await until(() => D(`return document.querySelector('.fx header b')?.innerText==='识别手写公式'&&!document.querySelector('.obj-inspector')`), 3000, 'recognize sheet from inspector');
  await until(() => D(`return /识别完成/.test(document.querySelector('.fx-status')?.innerText||'')`), 8000, 'recognized again');
  await until(() => D(`return !document.querySelector('.fx-go').disabled`), 3000, 'preview compiled');
  await D(`[...document.querySelectorAll('.fx footer button')].find(b=>b.innerText.includes('放在下方')).click();return true`);
  const below = await until(() => T(`const l=s.ink[${K}]||[];const f=l.filter(x=>x.tex);return l.some(x=>x.id==='k1')&&f.length===3?f.at(-1):null`), 4000, 'placed below, ink kept');
  assert.ok(below.pts[1] > 0.65, 'below the ink: ' + below.pts[1]);
  mark('selection editor → 识别公式 opens the sheet; 放在下方 keeps the handwriting');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, requests: requests.length, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const d = globalThis.classroomStudioTest?.windows.get('dock'); if (d) fs.writeFileSync(path.join(out, 'failure-dock.png'), (await d.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
