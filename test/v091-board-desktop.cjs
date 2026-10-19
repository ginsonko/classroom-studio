// 0.9.1 桌面验收（讲题板书公式 + AI 长调用）：
//   1. AI 长调用走流式：假网关按 SSE 一段段发回复，主进程拼回完整内容，用量和请求 ID（x-oneapi-request-id）照样记账；
//   2. 按调用传超时：timeout=10 秒的调用在网关 12 秒才回时报「AI 响应超时（10 秒）」，错误里没有 Electron 的英文前缀；
//   3. 「讲这道题」→「写成板书」：步骤公式、答案里的分式是 TeX 公式笔迹（不是 m_A/m_B 纯文本），中文是文字笔迹，互不重叠；
//      上屏后学生窗口画出公式；公式笔迹可以选中、移动（移动后学生端跟着动）。
// 所有窗口在屏幕外，不动真实鼠标。用法：npm run build 后 npx electron test/quiet.cjs test/v091-board-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v091-board-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', subject: 'physics', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'stu-w', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(120); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v091 board desktop timed out'); app.exit(1); }, 240000);

const EXPLAIN = {
  title: '摩擦平衡问题', problem: 'A 在 53° 拉、B 在 37° 拉，两物体均恰好平衡，求 m_A/m_B',
  idea: '两物体均恰好处于平衡，水平方向拉力等于最大静摩擦力；绳子拉力相同，分别列两物体的水平、竖直方向关系并消去拉力。',
  steps: [
    { t: '对 A 受力，列水平方向平衡及最大静摩擦力关系', tex: 'T\\cos 53^\\circ=\\mu\\left(m_A g-T\\sin 53^\\circ\\right)', plain: 'T cos53°=μ(m_Ag−T sin53°)' },
    { t: '代入三角函数值，整理 A 的质量关系', tex: '\\mu m_A g=T(0.6+0.8\\mu)', plain: 'μm_Ag=T(0.6+0.8μ)' },
    { t: '对 B 受力，列水平方向平衡及最大静摩擦力关系', tex: 'T\\cos 37^\\circ=\\mu\\left(m_B g-T\\sin 37^\\circ\\right)', plain: 'T cos37°=μ(m_Bg−T sin37°)' },
    { t: '代入三角函数值并求质量比', tex: '\\frac{m_A}{m_B}=\\frac{0.6+0.8\\mu}{0.8+0.6\\mu}=\\frac{4\\mu+3}{3\\mu+4}', plain: 'm_A/m_B=(0.6+0.8μ)/(0.8+0.6μ)=(4μ+3)/(3μ+4)' },
  ],
  answer: '$\\frac{m_A}{m_B}=\\frac{4\\mu+3}{3\\mu+4}$，选 A。', pitfalls: ['拉力斜向上时支持力 $N=mg-T\\sin\\theta$，不是 $mg$'],
};
const requests = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const last = j.messages?.at(-1)?.content, lastText = typeof last === 'string' ? last : Array.isArray(last) ? last.map((x) => x.text || '').join('') : '';
    if (lastText.includes('慢一点')) { await sleep(12000); if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '晚了' }, finish_reason: 'stop' }] })); } return; }
    const content = lastText.includes('只回复') ? '在线' : JSON.stringify(EXPLAIN);
    if (j.stream) {
      // 真实网关的样子：先发推理过程（content 为空），再一段段发内容，最后一块带 usage，然后 [DONE]
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'x-oneapi-request-id': 'rid-stream-001' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      send({ id: 'c1', model: j.model, choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '想一想…' } }] });
      for (let i = 0; i < content.length; i += 37) { send({ id: 'c1', model: j.model, choices: [{ index: 0, delta: { content: content.slice(i, i + 37) } }] }); await sleep(2); }
      send({ id: 'c1', model: j.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      if (j.stream_options?.include_usage) send({ id: 'c1', model: j.model, choices: [], usage: { prompt_tokens: 1234, completion_tokens: 567 } });
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'x-oneapi-request-id': 'rid-plain-001' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
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
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const run = (w, name) => async (code) => { const r = await call(w, wrap(code)); if (r && r.__err) throw Error(name + ': ' + r.__err); return r; };
  const T = run(teacher, 'teacher'), S = run(student, 'student');
  const shot = async (w, name, wait = 400) => { await sleep(wait); w.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',key:'sk-test-0000'});localStorage.setItem('cs.ai.screen','0');s.set({page:'console',aiOpen:true});return true`);

  // ── 1. 流式：拼回完整 JSON，usage、请求 ID 记账 ──
  const r1 = await T(`return await window.csHost.call('ai.chat',{messages:[{role:'user',content:'讲题'}],json:true,maxTokens:8000,timeout:300000,feature:'流式测试'})`);
  assert.equal(requests.at(-1).stream, true, 'long call streams'); assert.deepEqual(requests.at(-1).stream_options, { include_usage: true });
  assert.deepEqual(JSON.parse(r1.content), EXPLAIN, 'content reassembled from SSE chunks');
  assert.equal(r1.rid, 'rid-stream-001'); assert.deepEqual(r1.usage, { prompt_tokens: 1234, completion_tokens: 567 }); assert.equal(r1.finish, 'stop');
  const ledger = fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'ai-ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const e1 = ledger.find((x) => x.feature === '流式测试');
  assert.ok(e1 && e1.rid === 'rid-stream-001' && e1.input === 1234 && e1.output === 567, 'ledger has usage + request id: ' + JSON.stringify(e1));
  const r0 = await T(`return await window.csHost.call('ai.test')`);
  assert.equal(r0.reply, '在线'); assert.ok(!requests.at(-1).stream, 'short calls stay non-streaming');
  mark('long AI calls stream (SSE reassembled, usage + x-oneapi-request-id recorded); short calls unchanged', { rid: r1.rid });

  // ── 2. 按调用传超时，错误没有 Electron 前缀 ──
  const t0 = Date.now();
  const err = await T(`try{await window.csHost.call('ai.chat',{messages:[{role:'user',content:'慢一点'}],timeout:10000});return 'no error'}catch(e){return e.message}`);
  const took = Date.now() - t0;
  assert.match(err, /^AI 响应超时（10 秒）/, err); assert.ok(took >= 9500 && took < 14000, 'timed out after ~10 s: ' + took);
  assert.ok(!/invoking remote method/.test(err));
  mark('per-call timeout honoured (10 s) and the error reads in Chinese without the IPC prefix', { took });

  // ── 3. 讲这道题 → 写成板书：公式是 TeX 笔迹 ──
  await T(`const el=document.querySelector('.ai-compose textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(EXPLAIN.problem)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  await until(() => T(`const b=document.querySelector('.ai-act.a-explain');return b&&!b.disabled`), 8000, 'explain enabled');
  await T(`document.querySelector('.ai-act.a-explain').click();return true`);
  await until(() => T(`const c=document.querySelector('.ai-card.k-explain');return c&&!c.classList.contains('pending')&&[...c.querySelectorAll('button')].some(b=>b.innerText.includes('写成板书'))`), 20000, 'explain card');
  await T(`[...document.querySelector('.ai-card.k-explain').querySelectorAll('button')].find(b=>b.innerText.includes('写成板书')).click();return true`);
  const board = await until(() => T(`const m=s.reader?.mat;if(!m||!m.id.startsWith('board-ai-'))return null;const k=Q.inkKey(m.id,0);const l=s.ink[k]||[];return l.length?{id:m.id,total:m.total,key:k,strokes:l}:null`), 10000, 'board written');
  assert.equal(board.total, 1, 'fits one page');
  const tex = board.strokes.filter((x) => x.tex), txt = board.strokes.filter((x) => !x.tex);
  for (const st of EXPLAIN.steps) assert.ok(tex.some((x) => x.tex === st.tex), 'step formula is TeX: ' + st.tex);
  const ans = tex.find((x) => x.color === 'red');
  assert.ok(ans && ans.tex.includes('\\frac{m_A}{m_B}') && ans.tex.includes('\\text{答'), 'answer is a TeX line: ' + ans?.tex);
  assert.ok(txt.some((x) => x.text === '摩擦平衡问题') && !txt.some((x) => /m_A\/m_B|\\frac|\$/.test(x.text)), 'Chinese stays text, no raw formulas as text');
  for (const x of tex) assert.ok(x.pts.length === 6 && x.pts[3] > x.pts[0] && x.pts[4] > x.pts[1] && x.pts[3] <= 0.95 && x.pts[4] <= 0.53, 'tex box inside the page');
  await T(`[...document.querySelectorAll('.ai-card.k-explain .ai-sub button')].find(b=>b.innerText.includes('上屏')).click();return true`);
  await until(() => S(`return s.pgmMat.id===${JSON.stringify(board.id)}&&(s.ink[${JSON.stringify(board.key)}]||[]).filter(x=>x.tex).length===${tex.length}`), 10000, 'student shows the board');
  // 学生窗口真的画出了公式（MathJax 懒加载完以后）：每个公式框里都有墨迹
  const inked = (who, list) => who(`const c=[...document.querySelectorAll('.ink .ink-c')].find(c=>c.width>200),r=c.getBoundingClientRect(),k=c.width/r.width,W=r.width;return ${JSON.stringify(list.map((x) => x.pts))}.map(p=>{const sx=Math.floor(p[0]*W*k),sy=Math.floor(p[1]*W*k),sw=Math.max(1,Math.ceil((p[3]-p[0])*W*k)),sh=Math.max(1,Math.ceil((p[4]-p[1])*W*k));const d=c.getContext('2d').getImageData(sx,sy,sw,sh).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})`);
  const px = await until(async () => { const v = await inked(S, tex); return v.every((n) => n > 60) ? v : null; }, 10000, 'student canvas draws every formula');
  await shot(student, 'board-student.png', 600);
  await T(`document.querySelector('.ai-scroll').scrollTop=0;return true`);
  await shot(teacher, 'board-teacher.png', 300);
  mark('讲这道题 → 写成板书: step formulas and the fraction answer are TeX strokes, Chinese is text, one page, drawn on the student window', { tex: tex.length, text: txt.length, px });

  // ── 4. 公式笔迹能选中、移动：和其它笔迹走同一套编辑接口，学生端跟着动 ──
  const f = tex.find((x) => x.tex === EXPLAIN.steps[3].tex), K = JSON.stringify(board.key);
  await T(`s.setShared({selectedInk:{key:${K},ids:[${JSON.stringify(f.id)}]}});return true`);
  await until(() => S(`return s.selectedInk?.ids?.[0]===${JSON.stringify(f.id)}`), 4000, 'selection synced');
  const moved = { ...f, pts: [f.pts[0] + 0.05, f.pts[1] + 0.02, 0.5, f.pts[3] + 0.05, f.pts[4] + 0.02, 0.5] };
  await T(`s.editInk(${K},{upsert:[${JSON.stringify(moved)}]},'teacher');return true`);
  await until(() => S(`const x=(s.ink[${K}]||[]).find(x=>x.id===${JSON.stringify(f.id)});return x&&Math.abs(x.pts[0]-${moved.pts[0]})<1e-9`), 4000, 'student got the move');
  await until(async () => (await inked(S, [moved]))[0] > 60, 6000, 'redrawn at the new place');
  await T(`s.undo(${K},'teacher');return true`);
  await until(() => S(`const x=(s.ink[${K}]||[]).find(x=>x.id===${JSON.stringify(f.id)});return x&&Math.abs(x.pts[0]-${f.pts[0]})<1e-9`), 4000, 'undo moves it back');
  mark('formula strokes select, move (student follows) and undo like any other ink');

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, requests: requests.length, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); const st = globalThis.classroomStudioTest?.windows.get('student'); if (st) fs.writeFileSync(path.join(out, 'failure-student.png'), (await st.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
