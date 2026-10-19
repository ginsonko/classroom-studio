// 技能包桌面验收：本机假模型 + 假企业微信 + 真实教师端界面 + 真实导出。
// 用法：npm run build 后 npx electron test/quiet.cjs test/skills-desktop.cjs
// 窗口放在所有屏幕之外（不打扰正在用电脑的人），截图仍然是真实画面。
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'skills-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const student = { id: 'stu-1', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', tags: [], lessons: 3, lastTopic: '洛伦兹力', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [student], studentId: 'stu-1', slots: [], learning: {} } }));
const { app, screen } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const shot = async (w, name) => { await sleep(600); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name, Object.keys(details).length ? JSON.stringify(details) : ''); };
const timer = setTimeout(() => { console.error('skills desktop timed out'); app.exit(1); }, 300000);

const STEM = '质子以 2×10^6 m/s 的速度垂直进入磁感应强度 0.1 T 的匀强磁场，求轨迹半径。';
let requests = [], failDraft = 0;
const kind = (j) => { const a = JSON.stringify(j.messages); return a.includes('审题老师') ? 'solve' : a.includes('原创练习题') ? 'draft' : a.includes('知识点清单') ? 'read' : a.includes('请写课后总结') ? 'lesson' : 'other'; };
function reply(j) {
  const all = JSON.stringify(j.messages);
  if (all.includes('审题老师')) return JSON.stringify({ answer: all.includes('变式一') ? '0.42 m' : '9 m' });
  if (all.includes('原创练习题')) return JSON.stringify({ questions: [
    { stem: '变式一：质子以 4×10^6 m/s 的速度垂直进入 0.1 T 的匀强磁场，求轨迹半径。', answer: '0.42 m', analysis: 'r=mv/(qB)', difficulty: 3, points: ['16.2'] },
    { stem: '变式二：电子进入匀强磁场后做半径 4 m 的圆周运动……（数据故意不自洽）', answer: '4 m', analysis: '略', difficulty: 3, points: ['16.2'] }] });
  if (all.includes('知识点清单')) return JSON.stringify({ stem: STEM, answer: '约 0.21 m', analysis: 'r = mv/(qB)', points: ['16.2'], difficulty: 3, qtype: '计算' });
  if (all.includes('请写课后总结')) return JSON.stringify({ summary: '本节课练习了带电粒子在磁场中的运动。', strengths: ['方向判断准确'], problems: ['数量级易错'], next: ['完成变式作业'], parent: '小林家长您好，今天我们练习了带电粒子在磁场中的运动，小林方向判断很准，计算时数量级还要细心。' });
  return '{}';
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(kind(j));
    if (kind(j) === 'draft' && failDraft > 0) { failDraft--; res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"upstream busy"}}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: reply(j) } }], usage: { prompt_tokens: 800, completion_tokens: 200 } }));
  });
});
const hookGot = [];
const hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { hookGot.push(JSON.parse(b)); res.setHeader('Content-Type', 'application/json'); res.end('{"errcode":0,"errmsg":"ok"}'); }); });

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 0, width: 1440, height: 900 }); teacher.showInactive();
  const stu = await until(() => api.windows.get('student'));
  stu.setBounds({ x: left + 1500, y: 0, width: 960, height: 560 }); stu.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),S=Q.useStudy.getState(),R=Q.useRun.getState().run;${code}}catch(e){return {__err:String(e&&e.message||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const run = () => T(`return R&&{phase:R.phase,states:R.states,notes:R.notes,cost:R.cost,files:R.ctx.files}`);
  const phase = (p, what) => until(async () => (await run())?.phase === p, 60000, what || 'phase ' + p);
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  await until(() => T(`return S.loaded`), 8000, 'study loaded');

  // ── 1. 学生卡下的技能按钮；「出变式作业」先自动跑完收题/识题/入库，在会花钱的 AI 出题前停下来问 ──
  await until(() => T(`return document.querySelectorAll('.sk-btns button').length===3`), 8000, 'skill buttons');
  await shot(teacher, 'skills-0-bar.png');
  await click('.sk-btns button', '出变式作业');
  await phase('ask', 'ask before variants');
  let r = await run();
  assert.deepEqual(r.states, ['done', 'done', 'done', 'ask', 'wait']);
  assert.ok(r.notes[1].includes('质子') && r.notes[1].includes('匀强磁场'), 'read note: ' + r.notes[1]);
  assert.equal(requests.filter((k) => k === 'draft').length, 0, 'no paid draft request before the teacher confirms');
  const q1 = await T(`return S.data.questions[0]`);
  assert.equal(q1.status, 'bank'); assert.deepEqual(q1.points, ['16.2']); assert.ok(fs.existsSync(q1.image));
  assert.ok(await T(`return document.querySelector('.sk-runner .sk-q')?.innerText.includes('会调用 AI')`), 'confirm text mentions AI cost');
  await shot(teacher, 'skills-1-ask.png');
  await click('.sk-runner .btn-cue', '继续');
  await phase('done', 'variants run done');
  r = await run();
  assert.deepEqual(r.states, ['done', 'done', 'done', 'done', 'done']);
  assert.ok(r.cost[3] > 0 && r.cost[0] === 0, 'cost recorded on the AI step: ' + r.cost);
  const d1 = await T(`return S.data`);
  const v1 = d1.questions.find((q) => q.stem.startsWith('变式一')), v2 = d1.questions.find((q) => q.stem.startsWith('变式二'));
  assert.equal(v1.status, 'bank'); assert.equal(v2.status, 'inbox', 'failed self-check stays in inbox');
  assert.equal(d1.homework.length, 1); assert.deepEqual(d1.homework[0].questionIds, [q1.id, v1.id], 'original + passed variant');
  const hwFiles = fs.readdirSync(path.join(process.env.CS_DATA_DIR, 'study', '作业'));
  assert.ok(hwFiles.some((f) => f.endsWith('.docx')) && hwFiles.some((f) => f.endsWith('.pdf')), 'homework exported: ' + hwFiles);
  assert.ok(await T(`return /AI 花费 ¥0\\.\\d\\d/.test(document.querySelector('.sk-runner .sk-cost')?.innerText||'')`), 'total cost shown');
  assert.ok(await T(`return document.querySelectorAll('.sk-runner .sk-files .sd-file').length>=2`), 'output files listed');
  await shot(teacher, 'skills-2-done.png');
  await click('.sk-runner .btn-cue', '完成');
  await until(() => T(`return !document.querySelector('.sk-runner')`), 4000, 'runner closed');
  mark('variants skill: capture → read → bank run automatically, pauses before the paid AI step, then drafts (self-check failures to inbox) and exports homework with cost shown', { cost: r.cost[3].toFixed(4), files: hwFiles.length });

  // ── 2. 同一页再跑：沿用这道题；AI 出题失败 → 显示错误 → 重试成功；再跑一次在确认处停止，不发请求 ──
  // 502 会自动重试一次（ai.cjs），连续两次失败才报错
  failDraft = 2;
  await click('.sk-btns button', '出变式作业');
  await phase('ask');
  r = await run();
  assert.ok(r.notes[0].includes('刚收过') && r.notes[2].includes('已经在题库里'), 'reuses question: ' + r.notes.join(' | '));
  assert.equal((await T(`return S.data.questions.filter(q=>q.origin==='board').length`)), 1, 'no duplicate capture');
  await click('.sk-runner .btn-cue', '继续');
  await phase('error', 'draft fails');
  r = await run();
  assert.equal(r.states[3], 'fail'); assert.ok(r.notes[3].length > 0);
  await shot(teacher, 'skills-3-error.png');
  await click('.sk-runner .btn-cue', '重试');
  await phase('done', 'retry done');
  assert.equal((await run()).states[3], 'done');
  await click('.sk-runner .btn-cue', '完成');
  const before = requests.length;
  await click('.sk-btns button', '出变式作业');
  await phase('ask');
  await click('.sk-runner .record-actions button', '停止');
  await phase('stopped');
  assert.equal(requests.length, before, 'stopping at the confirm makes no AI request');
  await click('.sk-runner .btn-cue', '完成');
  mark('rerun reuses the captured question; AI failure shows the error and retry succeeds; stop at the confirm sends nothing');

  // ── 3. 学情 → 技能包：复制内置包改成自己的、导出、导入别人的（未知步骤被丢掉，发家长强制确认） ──
  await T(`s.set({page:'study'});return true`);
  await click('.ags-tabs button', '技能包');
  await until(() => T(`return document.querySelectorAll('.sk-card').length===3`), 6000, 'skill cards');
  await T(`const c=[...document.querySelectorAll('.sk-card')].find(c=>c.innerText.includes('下课收尾'));[...c.querySelectorAll('button')].find(b=>b.innerText.includes('复制后修改')).click();return true`);
  await until(() => T(`return !!document.querySelector('.sk-edit')`), 4000, 'editor');
  await type('.sk-edit label input', '收尾·先问我');
  await T(`const cb=document.querySelector('.sk-edit-steps li .record-check input');cb.click();return true`);
  await shot(teacher, 'skills-4-editor.png');
  await click('.sk-edit .btn-cue', '保存');
  await until(() => T(`return document.querySelectorAll('.sk-card').length===4`), 4000, 'custom saved');
  const skFile = path.join(process.env.CS_DATA_DIR, 'study', 'skills.json');
  await until(() => fs.existsSync(skFile), 4000, 'skills.json written');
  const disk = JSON.parse(fs.readFileSync(skFile, 'utf8'));
  assert.equal(disk.length, 1); assert.equal(disk[0].name, '收尾·先问我'); assert.equal(disk[0].steps[0].confirm, true); assert.equal(disk[0].steps[2].confirm, true);
  await T(`const c=[...document.querySelectorAll('.sk-card')].find(c=>c.innerText.includes('收尾·先问我'));[...c.querySelectorAll('button')].find(b=>b.innerText.includes('导出')).click();return true`);
  await until(() => T(`return document.querySelector('.sd-msg')?.innerText.includes('已导出')`), 4000, 'exported');
  const exp = fs.readdirSync(path.join(process.env.CS_DATA_DIR, 'study', '技能包'));
  const expJson = JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'study', '技能包', exp[0]), 'utf8'));
  assert.equal(expJson.format, 'classroom-studio-skill'); assert.equal(expJson.steps.length, 3);
  const evil = { name: '别人分享的', steps: [{ use: 'shell', args: { cmd: 'del /s' } }, { use: 'lesson' }, { use: 'parent', confirm: false }, { use: 'variants', args: { n: 99 } }] };
  await T(`const i=document.querySelector('.sd-pane input[type=file]');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(evil))}],'share.json',{type:'application/json'}));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await until(() => T(`return document.querySelector('.sd-msg')?.innerText.includes('导入了')`), 4000, 'imported');
  const imp = (await T(`return Q.useSkills.getState().list`)).find((x) => x.name === '别人分享的');
  assert.deepEqual(imp.steps.map((x) => x.use), ['lesson', 'parent', 'variants'], 'unknown step dropped');
  assert.equal(imp.steps[1].confirm, true, 'send to parents always asks'); assert.equal(imp.steps[2].args.n, 5, 'n clamped');
  await T(`const i=document.querySelector('.sd-pane input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['not json'],'bad.json'));i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));return true`);
  await until(() => T(`return document.querySelector('.sd-err')?.innerText.includes('不是有效的 JSON')`), 4000, 'bad import error');
  await shot(teacher, 'skills-5-list.png');
  const delBtn = `[...[...document.querySelectorAll('.sk-card')].find(c=>c.innerText.includes('别人分享的')).querySelectorAll('button')].find(b=>b.innerText.includes('删除'))`;
  await T(`${delBtn}.click();return true`);
  assert.equal((await T(`return Q.useSkills.getState().list.length`)), 2, 'first click only arms delete');
  await T(`${delBtn}.click();return true`);
  await until(() => T(`return Q.useSkills.getState().list.length===1&&document.querySelectorAll('.sk-card').length===4`), 4000, 'deleted');
  mark('skills tab: copy a built-in pack, edit confirm flags, saved to study/skills.json, export JSON, safe import (unknown steps dropped, parent send forced to confirm, args clamped)', { exported: exp[0] });

  // ── 4. 自定义「收尾」包：先问 → 写总结 → 长图 → 发送预览 → 老师确认 → 企业微信收到 → 记录 ──
  await T(`await window.csHost.call('notify.setContact',{studentId:'stu-1',wecom:${JSON.stringify(`http://127.0.0.1:${hook.address().port}/cgi-bin/webhook/send?key=skill-key-1234`)},wecomName:'小林家长群'});return true`);
  await T(`const c=[...document.querySelectorAll('.sk-card')].find(c=>c.innerText.includes('收尾·先问我'));[...c.querySelectorAll('button')].find(b=>b.innerText.includes('运行')).click();return true`);
  await phase('ask', 'custom first step asks');
  assert.equal((await run()).states[0], 'ask');
  await click('.sk-runner .btn-cue', '继续');
  await phase('ask', 'parent asks');
  r = await run();
  assert.deepEqual(r.states, ['done', 'done', 'ask']);
  const png = r.files.find((f) => f.endsWith('.png')); assert.ok(png && fs.existsSync(png), 'long image');
  assert.equal(hookGot.length, 0);
  await click('.sk-runner .btn-cue', '继续');
  await until(() => T(`const el=document.querySelector('.ps-send');return !!el&&!!el.querySelector('.ps-msg')?.innerText.includes('小林家长您好')&&!!el.querySelector('img.ps-img')`), 10000, 'send preview');
  assert.equal(hookGot.length, 0, 'nothing sent before the teacher confirms in the preview');
  await shot(teacher, 'skills-6-send-preview.png');
  await click('.ps-send .btn-cue', '确认发送');
  await until(() => T(`return !!document.querySelector('.ps-res .ok')`), 15000, 'sent');
  assert.equal(hookGot.length, 2); assert.equal(hookGot[0].msgtype, 'markdown'); assert.equal(hookGot[1].msgtype, 'image');
  await click('.ps-send .record-actions button', '完成');
  await phase('done', 'wrap done');
  r = await run();
  assert.equal(r.states[2], 'done');
  const lessons = await T(`return S.data.lessons`);
  assert.equal(lessons.length, 1); assert.equal(lessons[0].sends.length, 1); assert.equal(lessons[0].sends[0].ok, true);
  await shot(teacher, 'skills-7-wrap-done.png');
  await click('.sk-runner .btn-cue', '完成');
  mark('custom wrap-up pack: asks first, writes lesson + long image, opens the send preview, sends only after confirm, records the send');

  const ledger = (api.ledger?.entries ?? []).map((e) => e.feature);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, ledger, requests, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); hook.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
