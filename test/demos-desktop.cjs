// 数学 / 化学演示桌面验收：演示库 → 预览调参 → 上屏学生同步 → 浮层调参 → 配平互动 → AI / 规则挑演示 → 18 个演示截图。
// 用法：npm run build 后 npx electron test/quiet.cjs test/demos-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'demos-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = (id, name, subject, hue) => ({ id, name, grade: '高二', subject, hue, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [stu('stu-m', '小舟', 'math', 260), stu('stu-c', '小禾', 'chem', 140)], studentId: 'stu-m', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(80); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('demos desktop timed out'); app.exit(1); }, 300000);

let requests = [], reply = () => '{}';
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: reply(j) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await until(() => call(student, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),D=Q.demos;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error('teacher: ' + r.__err); return r; };
  const S = async (code) => { const r = await call(student, wrap(code)); if (r && r.__err) throw Error('student: ' + r.__err); return r; };
  const click = (sel, text, root = 'document') => T(`const b=[...${root}.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);

  // ── 1. 数学学生、没配模型：「做成演示」改成数学演示，演示库 12 个 ──
  await T(`localStorage.setItem('cs.ai.screen','0');s.set({page:'console',aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-demo')`), 8000, 'demo action for math');
  const act = await T(`return document.querySelector('.ai-act.a-demo').innerText`);
  assert.match(act, /数学演示/);
  await click('.ai-lib-h', '演示库');
  await until(() => T(`return document.querySelectorAll('.ai-lib-grid button').length===12`), 4000, '12 math demos');
  assert.match(await T(`return document.querySelector('.ai-lib-tabs button.on').innerText`), /数学/);
  // 数学课上也能直接拿物理模板（和摆器材）
  await click('.ai-lib-tabs button', '物理');
  await until(() => T(`return document.querySelectorAll('.ai-lib-grid button').length===15&&!!document.querySelector('.ai-lib-obj')`), 4000, 'physics tab in a math class');
  await click('.ai-lib-tabs button', '数学');
  await until(() => T(`return document.querySelectorAll('.ai-lib-grid button').length===12`), 4000, 'back to math tab');
  await click('.ai-lib-grid button', '三角形的四心');
  await until(() => T(`return s.reader.mat.scene?.preset==='m.triangle'&&!!document.querySelector('.demohost[data-scope="preview"] .demo-svg')`), 6000, 'triangle in preview');
  const handles = await T(`return document.querySelectorAll('.demohost[data-scope="preview"] .demo-handle').length`);
  assert.equal(handles, 3, 'three draggable vertices');
  mark('math student: demo action says 数学演示, library lists 12 math demos, triangle opens in preview with 3 handles', { act });

  // ── 2. 预览里拖顶点：参数写进预览课件；上屏后学生看到同样的三角形 ──
  // 等布局动画停下：手柄位置连续两次一样，且手柄在最上层
  let last = '';
  const box = await until(async () => {
    const b = await T(`const h=document.querySelectorAll('.demohost[data-scope="preview"] .demo-handle')[2].getBoundingClientRect();const x=h.x+h.width/2,y=h.y+h.height/2;const e=document.elementFromPoint(x,y);return {x,y,top:!!e&&e.classList.contains('demo-handle')}`);
    const key = `${b.x},${b.y}`, ok = b.top && key === last; last = key; return ok ? b : null;
  }, 6000, 'handle settled');
  const before = await T(`return s.reader.mat.scene.params`);
  teacher.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(box.x), y: Math.round(box.y) });
  teacher.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { teacher.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(box.x + i * 8), y: Math.round(box.y + i * 4), button: 'left', modifiers: ['leftButtonDown'] }); await sleep(30); }
  teacher.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(box.x + 64), y: Math.round(box.y + 32), button: 'left', clickCount: 1 });
  const after = await until(() => T(`const p=s.reader.mat.scene.params;return p.cx!==${before.cx}?p:null`), 4000, 'vertex dragged');
  assert.ok(after.cx > before.cx && after.cy < before.cy, `C moved right/down: ${before.cx},${before.cy} -> ${after.cx},${after.cy}`);
  await shot(teacher, 'demos-1-triangle-preview.png');
  await T(`s.showNow(s.reader.mat);return true`);
  await until(() => S(`return s.pgmMat.scene?.preset==='m.triangle'&&!!document.querySelector('.demohost .demo-svg')`), 8000, 'student shows triangle');
  const sp = await S(`return {p:s.sim?.params,ctl:!!document.querySelector('.demo-ctl'),handles:document.querySelectorAll('.demo-handle').length,info:document.querySelector('.demo-card')?.innerText||''}`);
  assert.equal(sp.p.cx, after.cx); assert.equal(sp.ctl, false, 'student has no teacher controls'); assert.equal(sp.handles, 0);
  assert.match(sp.info, /形状[\s\S]*面积/);
  await shot(student, 'demos-2-triangle-student.png');
  mark('dragging a vertex in preview updates params; on air the student sees the same triangle without controls', { from: [before.cx, before.cy], to: [after.cx, after.cy] });

  // ── 3. 上屏后：节目区播放 → 学生同步播放；浮层调参 → 学生同步 ──
  await T(`s.open(D.makeDemo('m.trig',{A:2}));return true`);
  await until(() => T(`return s.reader.mat.scene?.preset==='m.trig'`), 4000);
  await T(`s.showNow(s.reader.mat);return true`);
  await until(() => S(`return s.pgmMat.scene?.preset==='m.trig'`), 6000, 'trig on air');
  await api.dock.ensure(); const dock = api.windows.get('dock');
  await until(() => call(dock, `!!document.querySelector('.tdock-sim .tdock-params-toggle')`), 10000, 'dock sim section');
  const toggle = await call(dock, `document.querySelector('.tdock-params-toggle').innerText`);
  assert.match(toggle, /正弦型函数/);
  await call(dock, `document.querySelector('.tdock-params-toggle').click();true`);
  await until(() => call(dock, `document.querySelectorAll('.tdock-params label').length>=3`), 4000, 'dock params');
  const dockLabels = await call(dock, `[...document.querySelectorAll('.tdock-params label > span:first-child')].map(x=>x.innerText)`);
  await call(dock, `(()=>{const r=[...document.querySelectorAll('.tdock-params label')].find(l=>l.innerText.includes('振幅'))?.querySelector('input[type=range]');if(!r)throw Error('no A slider '+document.querySelector('.tdock-params').innerText);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r,'3');r.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await until(() => S(`return s.sim?.params?.A===3`), 4000, 'student gets A=3 from dock');
  await call(dock, `document.querySelector('.tdock-sim .sim-play').click();true`);
  await until(() => S(`return s.sim?.playing===true`), 4000, 'student playing');
  await sleep(1500);
  const tPlay = await S(`return document.querySelector('.demohost')!==null`);
  assert.ok(tPlay);
  await shot(student, 'demos-3-trig-playing-student.png', 100);
  fs.writeFileSync(path.join(out, 'demos-3-dock.png'), (await dock.webContents.capturePage()).toPNG());
  await call(dock, `document.querySelector('.tdock-sim .sim-play').click();true`);
  await until(() => S(`return s.sim?.playing===false`), 4000, 'paused');
  mark('dock lists the demo params (no hidden ones); a dock slider and play/pause reach the student window', { dockLabels });

  // ── 4. 化学学生：演示库 6 个；配平互动：± 系数、揭晓、换反应清零、自定义方程式 ──
  await T(`s.set({studentId:'stu-c'});return true`);
  await until(() => T(`return document.querySelector('.ai-lib-tabs button.on')?.innerText.includes('化学')`), 6000, 'chem library');
  assert.equal(await T(`return document.querySelectorAll('.ai-lib-grid button').length`), 6);
  assert.equal(await S(`return s.subject`), 'chem', 'subject synced to student window');
  await click('.ai-lib-grid button', '方程式配平');
  await until(() => T(`return s.reader.mat.scene?.preset==='c.balance'&&!!document.querySelector('.demohost[data-scope="preview"] .demo-ctl')`), 6000, 'balance demo');
  const ctlCls = await T(`return document.querySelector('.demohost[data-scope="preview"] .demo-ctl').className`);
  assert.ok(ctlCls.includes('tiny') && !(await T(`return !!document.querySelector('.demohost[data-scope="preview"] .demo-balance')`)), 'small preview: params folded by default, ' + ctlCls);
  await click('.demohost[data-scope="preview"] .simctl-pbtn');
  await until(() => T(`return !!document.querySelector('.demohost[data-scope="preview"] .demo-balance')`), 3000, 'balance panel opened');
  const ensureOpen = async () => { await until(() => T(`return !!document.querySelector('.demohost[data-scope="preview"] .simctl-pbtn')`), 4000, 'params button'); await T(`const b=document.querySelector('.demohost[data-scope="preview"] .simctl-pbtn');if(!b.classList.contains('on'))b.click();return true`); await until(() => T(`return !!document.querySelector('.demohost[data-scope="preview"] .demo-balance')`), 3000, 'balance panel'); };
  const plus = async (i, n) => { for (let k = 0; k < n; k++) await T(`document.querySelectorAll('.demohost[data-scope="preview"] .demo-coef')[${i}].querySelectorAll('button')[1].click();return true`); };
  const coefTxt = () => T(`return [...document.querySelectorAll('.demohost[data-scope="preview"] .demo-coef b')].map(b=>b.innerText).join(' ')`);
  await plus(0, 1);
  await until(async () => (await coefTxt()).startsWith('2'), 3000, 'coef +1');
  await click('.demohost[data-scope="preview"] .demo-balance button', '揭晓配平结果');
  await until(() => T(`return s.reader.mat.scene.params.show===1`), 3000, 'revealed');
  const revealed = await coefTxt();
  await shot(teacher, 'demos-4-balance-revealed.png');
  await T(`const sel=document.querySelector('.demohost[data-scope="preview"] .demo-ctl select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,'3');sel.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await until(() => T(`const p=s.reader.mat.scene.params;return p.rx===3&&p.show===0&&p.c0===1`), 3000, 'reaction switch resets coefs');
  await type('.demohost[data-scope="preview"] .demo-custom input', 'KMnO4 + HCl = KCl + MnCl2 + Cl2 + H2O');
  await click('.demohost[data-scope="preview"] .demo-custom button', '打开');
  await until(() => T(`return s.reader.mat.scene?.text?.includes('KMnO4')&&s.reader.mat.scene.params.rx===0`), 4000, 'custom equation opened');
  await ensureOpen();
  await click('.demohost[data-scope="preview"] .demo-balance button', '揭晓配平结果');
  await until(async () => (await coefTxt()) === '2 16 2 2 5 8', 3000, 'KMnO4 balanced 2 16 2 2 5 8');
  await shot(teacher, 'demos-5-balance-custom.png');
  mark('chem: 6 demos; balance ± and reveal work, switching reaction resets coefficients, custom KMnO4 equation balances to 2 16 2 2 5 8', { revealed });

  // ── 5. 没配模型：「做成演示」按关键词挑化学演示 ──
  const askDemo = async (text) => { await type('.ai-compose textarea', text); await sleep(80); await click('.ai-act.a-demo'); };
  await askDemo('用 0.1 mol/L NaOH 滴定 20 mL 0.1 mol/L 盐酸，画出滴定曲线，找突跃范围');
  await until(() => T(`const c=document.querySelector('.ai-card');return c&&!c.classList.contains('pending')`), 8000, 'rules card');
  const rc = await T(`const c=document.querySelector('.ai-card');return {title:c.querySelector('.ai-out-t')?.innerText||'',foot:c.querySelector('.ai-foot-note')?.innerText||'',err:c.querySelector('.ai-err p')?.innerText||''}`);
  assert.ok(!rc.err, rc.err); assert.match(rc.title + rc.foot, /滴定|关键词/);
  await click('.ai-card .ai-out-b button', '我先看');
  await until(() => T(`return s.reader.mat.scene?.preset==='c.titration'`), 4000, 'titration opened');
  mark('offline: rules pick the titration demo from keywords', rc);

  // ── 6. 配了模型：AI 选演示 + 填参数；配平题给方程式 → 自定义反应 ──
  // 0.9.1 起在线默认走立体引擎（s3d-desktop 覆盖）；这里验的是经典引擎的演示库挑选
  await T(`localStorage.setItem('cs.ai.demoEngine','classic');return true`);
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});s.set({aiOpen:false});return true`);
  await sleep(200); await T(`s.set({aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-model.on')`), 8000, 'online');
  // 目录里有的反应 → 直接选中那一条
  requests = []; reply = () => JSON.stringify({ id: 'c.balance', params: {}, title: '铜与稀硝酸', note: '题目要求配平', equation: 'Cu + HNO3 = Cu(NO3)2 + NO + H2O' });
  await askDemo('配平：铜与稀硝酸反应生成硝酸铜、一氧化氮和水');
  await until(() => T(`const c=document.querySelector('.ai-card');return c&&!c.classList.contains('pending')`), 10000, 'ai card');
  assert.equal(requests.length, 1);
  const prompt = JSON.stringify(requests[0].messages);
  assert.ok(prompt.includes('c.balance') && prompt.includes('c.titration') && !prompt.includes('m.trig'), 'prompt lists chem demos only');
  assert.equal(await T(`return document.querySelector('.ai-card .ai-card-k').innerText.trim()`), '化学演示');
  await click('.ai-card .ai-out-b button', '我先看');
  await until(() => T(`const sc=s.reader.mat.scene;return sc?.preset==='c.balance'&&sc.params.rx===13&&!sc.text`), 4000, 'catalog reaction picked');
  // 目录里没有的反应 → 自定义方程式
  reply = () => JSON.stringify({ id: 'c.balance', params: {}, title: '铁与稀硝酸', note: '题目要求配平', equation: 'Fe + HNO3 = Fe(NO3)3 + NO + H2O' });
  await askDemo('配平：铁与过量稀硝酸反应');
  await until(() => T(`const c=document.querySelector('.ai-card');return c&&!c.classList.contains('pending')&&c.innerText.includes('铁与稀硝酸')`), 10000, 'ai card 2');
  await click('.ai-card .ai-out-b button', '我先看');
  await until(() => T(`return s.reader.mat.scene?.text==='Fe + HNO3 = Fe(NO3)3 + NO + H2O'`), 4000, 'ai custom equation');
  await ensureOpen();
  await click('.demohost[data-scope="preview"] .demo-balance button', '揭晓配平结果');
  await until(async () => (await coefTxt()) === '1 4 1 1 2', 3000, 'Fe + HNO3 balanced 1 4 1 1 2');
  await shot(teacher, 'demos-6-ai-balance.png');
  await T(`s.set({studentId:'stu-m'});return true`);
  await until(() => T(`return document.querySelector('.ai-lib-tabs button.on')?.innerText.includes('数学')`), 6000, 'back to math');
  requests = []; reply = () => JSON.stringify({ id: 'm.quad', params: { a: 1, b: -4, c: 3, zz: 9 }, title: 'y=x²−4x+3', note: '二次函数性质' });
  await askDemo('已知 y=x²-4x+3，求顶点、对称轴和零点');
  await until(() => T(`const c=document.querySelector('.ai-card');return c&&!c.classList.contains('pending')`), 10000, 'ai math card');
  await click('.ai-card .ai-out-b button', '我先看');
  const mq = await until(() => T(`const m=s.reader.mat;return m.scene?.preset==='m.quad'?m.scene.params:null`), 4000, 'quad opened');
  assert.deepEqual([mq.a, mq.b, mq.c, mq.zz], [1, -4, 3, undefined]);
  const card = await T(`return document.querySelector('.demohost[data-scope="preview"] .demo-card')?.innerText||''`);
  assert.match(card, /x\s*=\s*2|顶点/);
  await shot(teacher, 'demos-7-ai-quad.png');
  mark('online: AI picks c.balance (catalog reaction → rx, new reaction → custom equation balancing 1 4 1 1 2) and m.quad with its params; unknown params dropped; card says 化学演示');

  // ── 7. 18 个演示逐个上屏：学生窗口截图、没有渲染错误 ──
  const ids = await T(`return D.DEMOS.map(d=>d.id)`);
  const gallery = [];
  for (const id of ids) {
    await T(`s.showNow(D.makeDemo(${JSON.stringify(id)}));return true`);
    await until(() => S(`return s.pgmMat.scene?.preset===${JSON.stringify(id)}&&document.querySelectorAll('.demohost .demo-svg *').length>5`), 6000, 'student renders ' + id);
    const n = await S(`return document.querySelectorAll('.demohost .demo-svg *').length`);
    await shot(student, `gallery-${id}.png`, 250);
    gallery.push({ id, nodes: n });
  }
  // 向量画框按夹角扫过的全部位置定：大夹角、长向量、三种运算都不出画面
  for (const [k, v] of Object.entries({ sum150: { mode: 1, th: 150 }, diff30: { mode: 2, th: 30, la: 6, lb: 6 }, dot120: { mode: 3, th: 120, la: 2, lb: 6 } })) {
    await T(`s.showNow(D.makeDemo('m.vector',${JSON.stringify(v)}));return true`);
    await until(() => S(`return s.pgmMat.scene?.params?.th===${v.th}&&document.querySelectorAll('.demohost .demo-svg *').length>5`), 6000, 'vector ' + k);
    const out = await S(`const svg=document.querySelector('.demohost .demo-svg'),r=svg.getBoundingClientRect(),bad=[];for(const el of svg.querySelectorAll('line,path,text,circle')){const b=el.getBoundingClientRect();if(b.width+b.height>0&&(b.left<r.left-2||b.right>r.right+2||b.top<r.top-2||b.bottom>r.bottom+2))bad.push(el.tagName+':'+(el.textContent||'').slice(0,12))}return bad`);
    assert.deepEqual(out, [], 'vector ' + k + ' stays inside the stage');
    await shot(student, `gallery-m.vector-${k}.png`, 250);
  }
  mark('all demos render on the student window', { gallery });

  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  const bad = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/.test(e));
  if (bad.length) console.log('console errors:\n' + bad.slice(0, 10).join('\n'));
  assert.equal(bad.length, 0, 'no renderer errors');
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((error) => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1); });
