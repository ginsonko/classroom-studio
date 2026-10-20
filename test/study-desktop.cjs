// 学情闭环桌面验收：本机假模型服务 + 真实教师端界面 + 真实导出。
// 用法：npm run build 后 npx electron test/quiet.cjs test/study-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'study-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const student = { id: 'stu-1', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', tags: ['电磁偏弱'], lessons: 3, lastTopic: '洛伦兹力', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [student], studentId: 'stu-1', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(80); } throw Error('Timed out ' + what); };
const shot = async (w, name) => { await sleep(600); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('study desktop timed out'); app.exit(1); }, 300000);

// ── 假模型：按提示词内容分流 ──
const STEM = '质子以 2×10^6 m/s 的速度垂直进入磁感应强度 0.1 T 的匀强磁场，求轨迹半径。';
const outline = { title: '带电粒子在磁场中的运动', subtitle: '一对一 · 高二', slides: [
  { title: '学习目标', bullets: ['会判断洛伦兹力方向', '会求圆周运动半径和周期'] },
  { title: '洛伦兹力', bullets: ['方向：左手定则', '大小：v⊥B 时最大'], formulas: ['F=qvB'] },
  { title: '匀速圆周运动', bullets: ['洛伦兹力提供向心力'], formulas: ['r=\\frac{mv}{qB}', 'T=\\frac{2\\pi m}{qB}'] },
  { title: '例题', bullets: [], example: { stem: STEM, answer: '约 0.21 m' } },
  { title: '小结', bullets: ['定圆心、求半径、找圆心角'] }] };
let requests = [];
function reply(j) {
  const all = JSON.stringify(j.messages);
  if (all.includes('审题老师')) return JSON.stringify({ answer: all.includes('第一题标记') ? '2 s' : '9 m' });
  if (all.includes('原创练习题')) return JSON.stringify({ questions: [
    { stem: '第一题标记：物块以 4 m/s 的初速度滑上粗糙水平面，动摩擦因数 0.2，g 取 10 m/s²，求物块停下所用时间。', answer: '2 s', analysis: 'a=μg=2 m/s²，t=v/a', difficulty: 2, points: ['16.2'] },
    { stem: '第二题：电子以某速度进入匀强磁场后做半径 4 m 的圆周运动，求……（数据故意不自洽）', answer: '4 m', analysis: '略', difficulty: 3, points: ['16.2'] }] });
  // 实测里模型会把换行写成字面 \n、知识点带上名字，这里照样返回
  if (all.includes('知识点清单')) return JSON.stringify({ stem: STEM.replace('，求', '，\\n求'), answer: '约 0.21 m', analysis: 'r = mv/(qB)', points: ['16.2 匀强磁场中的运动'], difficulty: 3, qtype: '计算' });
  if (all.includes('请写课后总结')) return JSON.stringify({ summary: '本节课复习洛伦兹力和圆周运动半径公式，课堂练习完成较好。', strengths: ['能正确判断洛伦兹力方向'], problems: ['半径公式代入数量级出错'], next: ['订正错题，再做两道变式'], parent: '小林家长您好，今天我们复习了带电粒子在磁场中的运动。小林能正确判断洛伦兹力方向，课堂反应积极；计算半径时数量级容易出错，已经安排订正和变式练习。辛苦您提醒他按时完成作业，有问题随时联系我。' });
  if (all.includes('学生画像')) return JSON.stringify({ text: '小林思维活跃，电磁部分方向判断扎实，但计算细节易错。建议每题写出公式后再代数，并定期回顾错题。' });
  if (all.includes('讲课 PPT 大纲')) return JSON.stringify(outline);
  if (all.includes('一对一讲题')) return JSON.stringify({ title: '斜面摩擦', problem: '讲题标记：质量 2 kg 的物块沿倾角 37° 的粗糙斜面下滑，动摩擦因数 0.5，求加速度。', idea: '沿斜面分解重力', steps: [{ t: '牛顿第二定律', tex: 'a=g\\sin37^\\circ-\\mu g\\cos37^\\circ', plain: 'a=gsin37°-μgcos37°' }], answer: '2 m/s²', pitfalls: ['正压力不是 mg'] });
  return '{}';
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: reply(j) } }], usage: { prompt_tokens: 800, completion_tokens: 200 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  // 收题要截学生窗口：窗口必须真的显示出来（不抢焦点）；放在所有屏幕之外，不打扰正在用电脑的人
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show();
  const stu = api.windows.get('student'); stu.setBounds({ x: left + 1500, y: 60, width: 960, height: 560 }); stu.showInactive();
  // 页面里抛的错原样带回来，不然只看到"Script failed to execute"
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState(),S=Q.useStudy.getState();${code}}catch(e){return {__err:String(e&&e.message||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const study = () => T(`return S.data`);
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});localStorage.setItem('cs.study.autoRead','1');return true`);
  await until(() => T(`return S.loaded`), 8000, 'study loaded');

  // ── 1. 课堂上点「错」：截学生画面收题 + 记作答 + 后台看图识题；同一页再点「对」算同一道题 ──
  await until(() => T(`return !!document.querySelector('.scard-ans-b button.r-wrong')`), 8000, 'class answer buttons');
  await click('.scard-ans-b button.r-wrong');
  const q1 = await until(() => T(`const q=S.data.questions[0];return q&&q.stem.includes('质子')&&S.data.attempts.length===1?q:null`), 20000, 'capture + auto read');
  assert.ok(fs.existsSync(q1.image), 'question image saved'); assert.ok(fs.statSync(q1.image).size > 2000);
  assert.deepEqual(q1.points, ['16.2']); assert.equal(q1.status, 'inbox');
  assert.ok(!q1.stem.includes('\\n') && q1.stem.includes('\n求'), 'literal \\n becomes a line break'); assert.equal(q1.origin, 'board');
  const readReq = requests.find((r) => JSON.stringify(r.messages).includes('知识点清单'));
  assert.equal(readReq.model, 'fake-vision', 'screenshot goes to the vision model');
  assert.ok(JSON.stringify(readReq.messages).includes('data:image/'), 'image sent');
  await click('.scard-ans-b button.r-right');
  await until(() => T(`return S.data.attempts.length===2&&S.data.questions.length===1`), 8000, 'same question reused');
  await until(() => T(`return document.querySelector('.scard-ans-m')?.innerText.includes('同一题')`), 4000, 'reuse message');
  await shot(teacher, 'study-1-class-answers.png');
  mark('in-class answer: capture student screen into inbox, record attempt, vision read fills stem/points; same page reuses the question', { image: path.basename(q1.image) });

  // ── 2. 收件箱 → 入库；粘贴同一道题会提示重复 ──
  await T(`s.set({page:'study'});return true`);
  await until(() => T(`return document.querySelectorAll('.sd-q').length===1`), 6000, 'inbox list');
  await shot(teacher, 'study-2-inbox.png');
  await click('.sd-q-act .btn-cue', '入库');
  await until(() => T(`return S.data.questions[0].status==='bank'`), 4000, 'moved to bank');
  await click('.sd-bar .sd-btn', '粘贴题目');
  await type('.record-editor textarea', STEM.replace(/ /g, ''));
  await click('.record-editor .btn-cue', '收进收件箱');
  await until(() => T(`return !!document.querySelector('.sd-editor .sd-warn')`), 6000, 'duplicate warning');
  await shot(teacher, 'study-3-duplicate.png');
  await click('.sd-editor .sd-danger'); await click('.sd-editor .sd-danger', '再点一次');
  await until(() => T(`return S.data.questions.length===1&&!document.querySelector('.sd-editor')`), 4000, 'pasted duplicate deleted');
  mark('inbox to bank; pasted duplicate is flagged and can be deleted with a two-step button');

  // ── 3. 题库记作答 → 错题本 → 导出 Word/PDF（含题图） ──
  await T(`const now=new Date().toISOString();S.update(d=>({...d,questions:[...d.questions,
    {id:'seed-1',stem:'电子在匀强磁场中做匀速圆周运动，周期与速度大小的关系是？',answer:'无关',points:['16.2'],difficulty:2,qtype:'选择',origin:'manual',status:'bank',createdAt:now},
    {id:'seed-2',stem:'带电粒子从圆形磁场边界沿半径方向射入，求射出方向。',answer:'沿半径方向射出',points:['16.2'],difficulty:4,qtype:'计算',origin:'manual',status:'bank',createdAt:now},
    {id:'seed-3',stem:'质谱仪中两种同位素离子的轨迹半径之比为 3:2，求质量之比。',answer:'3:2',points:['16.3'],difficulty:3,qtype:'计算',origin:'manual',status:'bank',createdAt:now}]}));s.set({});return true`);
  await click('.ags-tabs button', '题库');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===4`), 6000, 'bank list');
  await T(`const card=[...document.querySelectorAll('.sd-q')].find(c=>c.innerText.includes('周期与速度'));card.querySelector('.sd-res .r-wrong').click();return true`);
  await until(() => T(`return S.data.attempts.length===3`), 4000, 'bank attempt');
  await shot(teacher, 'study-4-bank.png');
  await click('.ags-tabs button', '错题本');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===1`), 4000, 'wrong list open');
  await click('.sd-pane .ags-tabs button', '全部');
  await until(() => T(`return document.querySelectorAll('.sd-q').length===2`), 4000, 'wrong list all');
  // 学生画面收来的题：识别出文字、题目不涉及图时只印文字（1.2.0 起，截图不和文字重复印）；提到「如图」就印截图
  const wbDir = path.join(process.env.CS_DATA_DIR, 'study', '错题本');
  const exportBook = async () => {
    const t0 = Date.now() - 1000;
    await T(`document.querySelectorAll('.sd-file').forEach(b=>b.remove());return true`);
    await click('.ags-go', '导出错题本');
    const files = await until(() => T(`const f=[...document.querySelectorAll('.sd-file')].map(b=>b.innerText);return f.length>=2?f:null`), 60000, 'wrongbook export');
    const now = fs.readdirSync(wbDir).map((f) => ({ f, t: fs.statSync(path.join(wbDir, f)).mtimeMs })).filter((x) => x.t >= t0).sort((a, b) => b.t - a.t).map((x) => x.f);
    const docx = now.find((f) => f.endsWith('.docx')), pdf = now.find((f) => f.endsWith('.pdf'));
    assert.ok(docx && pdf, 'docx + pdf: ' + now.join(','));
    return { files, docx: fs.readFileSync(path.join(wbDir, docx)), pdf: path.join(wbDir, pdf) };
  };
  const plain = await exportBook();
  assert.ok(!plain.docx.includes(Buffer.from('word/media/image')), 'text-only capture prints no screenshot');
  await T(`S.update(d=>({...d,questions:d.questions.map(q=>q.origin==='board'?{...q,stem:'如图所示，'+q.stem}:q)}));return true`);
  await sleep(300);
  const { files: wb, docx: docxBuf, pdf: pdfFile } = await exportBook();
  assert.ok(docxBuf.includes(Buffer.from('word/media/image')), 'question image embedded in Word');
  const pdf = path.basename(pdfFile);
  assert.ok(fs.statSync(path.join(wbDir, pdf)).size > 20000);
  await shot(teacher, 'study-5-wrongbook.png');
  mark('bank attempt buttons feed the wrong book; export Word + PDF with the captured question image embedded', { files: wb });

  // ── 4. 组作业：薄弱点默认、错题重做、题不够 AI 出题 + 独立自检 ──
  await click('.ags-tabs button', '组作业');
  await until(() => T(`return !!document.querySelector('.sd-form')&&document.querySelectorAll('.sd-pp-sel .sd-chip:not(.none)').length>0`), 6000, 'weak points prefilled');
  await type('.sd-grid input', '5');
  await click('.ags-go', '从题库组卷');
  const picked = await until(() => T(`const l=[...document.querySelectorAll('.sd-picked li')].map(li=>li.innerText);return l.length?l:null`), 4000, 'picked');
  assert.ok(picked[0].includes('错题重做'), 'redo first: ' + picked[0]);
  assert.ok(!picked.some((t) => t.includes('质子以')), 'question already answered right is not picked again');
  await until(() => T(`return !!document.querySelector('.sd-short button')`), 4000, 'short with AI fill');
  await click('.sd-short button');
  await until(() => T(`return document.querySelector('.sd-msg')?.innerText.includes('自检通过')`), 20000, 'ai fill done');
  const hw = await study();
  const ai = hw.questions.filter((q) => q.origin === 'ai');
  assert.equal(ai.length, 2);
  assert.equal(ai.find((q) => q.stem.includes('第一题标记')).check, 'ok');
  assert.equal(ai.find((q) => q.stem.includes('第二题')).check, 'mismatch');
  assert.equal(ai.find((q) => q.stem.includes('第二题')).status, 'inbox', 'failed self-check goes to inbox for review');
  const solveReqs = requests.filter((r) => JSON.stringify(r.messages).includes('审题老师'));
  assert.equal(solveReqs.length, 2); assert.ok(!JSON.stringify(solveReqs[0].messages).includes('2 s'), 'solver does not see the answer');
  const pickedNow = await T(`return [...document.querySelectorAll('.sd-picked li')].map(li=>li.innerText)`);
  assert.ok(pickedNow.some((t) => t.includes('第一题标记')) && !pickedNow.some((t) => t.includes('第二题')));
  await shot(teacher, 'study-6-homework.png');
  await click('.ags-go', '导出作业');
  await until(() => T(`return document.querySelectorAll('.sd-preview .sd-file').length>=2`), 60000, 'homework export');
  const hwDir = path.join(process.env.CS_DATA_DIR, 'study', '作业'), hwPdf = fs.readdirSync(hwDir).find((f) => f.endsWith('.pdf'));
  const pages = (fs.readFileSync(path.join(hwDir, hwPdf)).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pages >= 2, 'answers on a separate page, pages=' + pages);
  assert.equal((await study()).homework.length, 1);
  mark('homework: redo-first, no already-solved questions, AI fill with blind self-check (mismatch → inbox), export with answers on a new page', { picked: pickedNow.length, pdfPages: pages });

  // ── 4b. 自检没通过的题：收件箱里只能「核对」，看过入库后才参与组作业 ──
  const badQ = (await study()).questions.find((q) => q.stem.includes('第二题'));
  assert.ok(badQ.checkNote && badQ.checkNote.includes('对不上'), 'check note: ' + badQ.checkNote);
  await click('.ags-tabs button', '收件箱');
  await until(() => T(`return [...document.querySelectorAll('.sd-q')].some(c=>c.innerText.includes('第二题'))`), 4000, 'mismatch in inbox');
  await T(`const c=[...document.querySelectorAll('.sd-q')].find(c=>c.innerText.includes('第二题'));const b=c.querySelector('.sd-q-act button');if(b.innerText.trim()!=='核对')throw Error('row button '+b.innerText);b.click();return true`);
  await until(() => T(`return [...document.querySelectorAll('.sd-editor .sd-warn')].some(p=>p.innerText.includes('对不上'))`), 4000, 'editor shows check note');
  await click('.sd-bar .sd-btn', '全部入库');
  await sleep(200);
  assert.equal((await study()).questions.find((q) => q.id === badQ.id).status, 'inbox', 'bulk import skips unchecked AI questions');
  await click('.sd-editor .btn-cue', '入库');
  await until(() => T(`const q=S.data.questions.find(q=>q.id===${JSON.stringify(badQ.id)});return q.status==='bank'&&q.check==='ok'`), 4000, 'reviewed into bank');
  mark('failed self-check: inbox row only offers review, note explains why, bulk import skips it, reviewing clears the flag');

  // ── 5. 课后总结：当天作答 → AI 总结 + 家长反馈 → 长图 + Word/PDF；学生课次 +1 ──
  await click('.ags-tabs button', '课后总结');
  await until(() => T(`return document.querySelector('.sd-today b')?.innerText.includes('3')`), 6000, 'today attempts');
  await type('.sd-form textarea', '受力分析画图有进步');
  await click('.ags-go', '生成总结');
  await until(() => T(`return document.querySelectorAll('.sd-note-edit textarea').length>=5&&document.querySelector('.sd-note-edit textarea').value.includes('洛伦兹力')`), 10000, 'lesson generated');
  const lessonReq = requests.find((r) => JSON.stringify(r.messages).includes('请写课后总结'));
  assert.ok(JSON.stringify(lessonReq.messages).includes('受力分析画图有进步') && JSON.stringify(lessonReq.messages).includes('[错]'), 'notes + attempts sent');
  await click('.ags-go', '导出分享长图');
  await until(() => T(`return [...document.querySelectorAll('.sd-preview .sd-file')].some(b=>b.innerText.includes('.png'))`), 60000, 'long image');
  const lsDir = path.join(process.env.CS_DATA_DIR, 'study', '课后总结'), png = fs.readdirSync(lsDir).find((f) => f.endsWith('.png'));
  const pb = fs.readFileSync(path.join(lsDir, png)), pw = pb.readUInt32BE(16), ph = pb.readUInt32BE(20);
  assert.ok(pw >= 750 && ph > 900, `long image ${pw}x${ph}`);
  fs.copyFileSync(path.join(lsDir, png), path.join(out, 'study-lesson-card.png'));
  await click('.sd-btn', 'Word + PDF');
  await until(() => fs.readdirSync(lsDir).some((f) => f.endsWith('.docx')), 60000, 'lesson docx');
  const after = await T(`return {lessons:S.data.lessons.length,stu:s.students[0]}`);
  assert.equal(after.lessons, 1); assert.equal(after.stu.lessons, 4);
  await shot(teacher, 'study-7-lesson.png');
  mark('lesson summary from today\'s attempts + notes, editable, long share image (750px wide) and Word/PDF; student lesson count +1', { card: `${pw}x${ph}` });

  // ── 5b. 发送给家长：设置联系方式（Webhook 加密保存）→ 预览 → 老师确认 → 企业微信收到 markdown + 长图 → 发送记录 ──
  const hookGot = []; const hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { hookGot.push(JSON.parse(b)); res.setHeader('Content-Type', 'application/json'); res.end('{"errcode":0,"errmsg":"ok"}'); }); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${hook.address().port}/cgi-bin/webhook/send?key=desk-key-9876`;
  await click('.sd-btn', '家长联系方式');
  await until(() => T(`return !!document.querySelector('.ps-sheet')`), 4000, 'contacts sheet');
  await type('.ps-sheet input[placeholder^="https://qyapi"]', hookUrl);
  await type('.ps-sheet input[placeholder^="例如：小林"]', '小林家长群');
  await type('.ps-sheet input[placeholder^="例如：12345678"]', 'xiaolin.parent@qq.com');
  await shot(teacher, 'study-7a-contacts.png');
  await click('.ps-sheet .btn-cue', '保存');
  await until(() => T(`return document.querySelector('.ps-sheet .sd-msg')?.innerText.includes('已保存')`), 4000, 'contacts saved');
  const notifyRaw = fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'notify.json'), 'utf8');
  assert.ok(!notifyRaw.includes('desk-key-9876'), 'webhook stored encrypted');
  await click('.ps-sheet .sd-btn', '测试消息');
  await until(() => hookGot.length === 1, 6000, 'test message');
  assert.equal(hookGot[0].msgtype, 'text');
  await click('.ps-sheet .record-actions button', '关闭');
  assert.equal(hookGot.length, 1, 'nothing is sent before the teacher confirms');
  await click('.ags-go', '发送给家长');
  await until(() => T(`const el=document.querySelector('.ps-send');return !!el&&!!el.querySelector('.ps-msg')?.innerText.includes('小林家长您好')&&!!el.querySelector('img.ps-img')`), 8000, 'send preview with long image');
  const chs = await T(`return [...document.querySelectorAll('.ps-ch input')].map(i=>({checked:i.checked,disabled:i.disabled}))`);
  assert.deepEqual(chs, [{ checked: true, disabled: false }, { checked: false, disabled: true }], 'wecom ready, email disabled until the sender mailbox is set');
  assert.ok(await T(`return document.querySelectorAll('.ps-ch')[1].innerText.includes('还没有设置你的发件邮箱')`));
  await shot(teacher, 'study-7b-send-preview.png');
  assert.equal(hookGot.length, 1);
  await click('.ps-send .btn-cue', '确认发送');
  await until(() => T(`return !!document.querySelector('.ps-res .ok')`), 15000, 'sent');
  assert.equal(hookGot.length, 3); assert.equal(hookGot[1].msgtype, 'markdown'); assert.match(hookGot[1].markdown.content, /小林 · .* 课后反馈/); assert.equal(hookGot[2].msgtype, 'image');
  await shot(teacher, 'study-7c-sent.png');
  await click('.ps-send .record-actions button', '完成');
  await until(() => T(`return document.querySelector('.ps-log .ok')?.innerText.includes('小林家长群')`), 4000, 'send log');
  const sends = await T(`return S.data.lessons[0].sends`);
  assert.equal(sends.length, 1); assert.equal(sends[0].ok, true); assert.equal(sends[0].channel, 'wecom');
  hook.close();
  mark('send to parents: contacts sheet (webhook encrypted), test message, preview with long image, nothing sent before confirm, WeCom gets markdown + image, send record saved', { hookCalls: hookGot.length });

  // ── 6. AI 课件：大纲 → PPTX + PDF ──
  await click('.ags-tabs button', 'AI 课件');
  await type('.sd-form input', '带电粒子在磁场中的运动');
  await click('.ags-go', '课件大纲');
  await until(() => T(`return document.querySelector('.sd-md')?.value.includes('qvB')`), 10000, 'outline');
  await click('.ags-go', '导出 PPT');
  await until(() => T(`return document.querySelectorAll('.sd-preview .sd-file').length>=2`), 90000, 'courseware export');
  const cwDir = path.join(process.env.CS_DATA_DIR, 'study', 'AI课件'), pptx = fs.readdirSync(cwDir).find((f) => f.endsWith('.pptx'));
  const slides = new Set(fs.readFileSync(path.join(cwDir, pptx)).toString('latin1').match(/ppt\/slides\/slide\d+\.xml/g)).size;
  assert.ok(slides >= 6, 'slides=' + slides);
  await click('.sd-btn', '加入资料库');
  await until(() => T(`return s.roots.some(r=>r.endsWith('AI课件'))`), 6000, 'added to library');
  await shot(teacher, 'study-8-courseware.png');
  mark('AI courseware outline → PPTX + PDF, folder added to the library', { slides });

  // ── 7. 学生档案：掌握度叠加、按作答更新地图、画像 ──
  await T(`s.set({page:'students'});return true`);
  await until(() => T(`return !!document.querySelector('.sd-portrait')`), 6000, 'portrait card');
  const cells = await T(`return document.querySelectorAll('.map-cells .cell.mk').length`);
  assert.ok(cells >= 1, 'mastery rings on the map');
  await click('.map-sync');
  await until(() => T(`return s.learning['stu-1']?.[16]?.[2]==='weak'||s.learning['stu-1']?.[16]?.[2]==='learning'`), 4000, 'map updated from attempts');
  await click('.sd-portrait .sd-btn', '画像');
  await until(() => T(`return document.querySelector('.sd-ptext')?.innerText.includes('思维活跃')`), 10000, 'AI portrait');
  await shot(teacher, 'study-9-student.png');
  mark('student page: mastery rings, one-click map update from attempts, AI portrait');

  // ── 7b. 知识网络：老师把「向心力」标为薄弱 → 画像显示可能的根源 → 网络里选中磁场题的知识点能追溯到它 → 先补前置组作业 ──
  await T(`const now=new Date().toISOString();S.update(d=>({...d,questions:[...d.questions,{id:'seed-4',stem:'圆盘以角速度 3 rad/s 转动，物块到转轴 0.2 m，质量 0.5 kg，求所需向心力。',answer:'0.9 N',points:['5.1'],difficulty:2,qtype:'计算',origin:'manual',status:'bank',createdAt:now}]}));const m=(s.learning['stu-1']??[]).map(r=>[...r]);m[5]=m[5]??[];m[5][1]='weak';s.set({learning:{...s.learning,'stu-1':m}});return true`);
  await until(() => T(`return [...document.querySelectorAll('.sd-pts em.root')].some(e=>e.innerText.includes('向心力'))`), 4000, 'portrait root cause');
  await click('.sd-links button', '知识网络');
  await until(() => T(`return document.querySelectorAll('.kn-node').length>=100`), 6000, 'network nodes');
  await T(`[...document.querySelectorAll('.kn-node')].find(b=>b.innerText==='匀强磁场中的运动').click();return true`);
  await until(() => T(`return [...document.querySelectorAll('.kn-roots b')].some(b=>b.innerText==='向心力')&&document.querySelectorAll('.kn-svg path.kn-e').length>=5`), 4000, 'trace back + chain drawn');
  const netInfo = await T(`return {sel:document.querySelector('.kn-node.sel')?.innerText,anc:document.querySelectorAll('.kn-node.anc').length,paths:document.querySelectorAll('.kn-svg path.kn-e').length,roots:[...document.querySelectorAll('.kn-roots b')].map(b=>b.innerText)}`);
  assert.equal(netInfo.sel, '匀强磁场中的运动'); assert.ok(netInfo.anc >= 8, 'ancestors highlighted: ' + netInfo.anc);
  await shot(teacher, 'study-11-network.png');
  await click('.kn-side .ags-go', '先补前置');
  await until(() => T(`return document.querySelector('.sd-check input')?.checked&&document.querySelector('.sd-form .sd-note')?.innerText.includes('向心力')`), 4000, 'homework preset with prerequisites');
  await click('.ags-go', '从题库组卷');
  const pre = await until(() => T(`const l=[...document.querySelectorAll('.sd-picked li')].map(li=>li.innerText);return l.length?l:null`), 4000, 'picked with prereq');
  assert.ok(pre.some((x) => x.includes('先补前置：向心力')), 'prerequisite question picked: ' + pre.join(' | '));
  await shot(teacher, 'study-12-homework-prereq.png');
  mark('knowledge network: teacher-marked weak prerequisite shows as a root cause, chain drawn, trace-back lists it, homework puts prerequisite practice first', netInfo);

  // ── 8. 存盘：学情库独立文件，重读一致 ──
  await T(`await Q.flushStudy();return true`);
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'study', 'study.json'), 'utf8'));
  const mem = await study();
  assert.equal(disk.questions.length, mem.questions.length); assert.equal(disk.attempts.length, mem.attempts.length);
  assert.ok(disk.portraits['stu-1']); assert.equal(disk.lessons.length, 1);
  const ws = fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), 'utf8');
  assert.ok(!ws.includes('第一题标记'), 'question bank is not written into workspace.json');
  mark('study.json saved separately from workspace.json', { questions: disk.questions.length, attempts: disk.attempts.length });

  // ── 9. AI 讲题卡片「存入题库」：题干、答案、解析带进收件箱 ──
  await T(`localStorage.setItem('cs.ai.screen','0');s.set({aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-explain:not([disabled])')`), 8000, 'ai panel');
  await type('.ai-compose textarea', '质量 2 kg 的物块沿倾角 37° 的粗糙斜面下滑，动摩擦因数 0.5，求加速度。');
  await T(`document.querySelector('.ai-act.a-explain').click();return true`);
  await until(() => T(`return [...document.querySelectorAll('.ai-card .ai-out-b button')].some(b=>b.innerText.includes('存入题库'))`), 15000, 'explain card');
  await click('.ai-card .ai-out-b button', '存入题库');
  const saved = await until(() => T(`return S.data.questions.find(q=>q.origin==='explain')`), 6000, 'explain saved');
  assert.ok(saved.stem.includes('讲题标记') && saved.answer === '2 m/s²' && saved.analysis.includes('沿斜面分解'));
  assert.equal(saved.status, 'inbox'); assert.ok(saved.points.length >= 1, 'points guessed: ' + saved.points);
  await until(() => T(`return [...document.querySelectorAll('.ai-card .ai-out-b button')].some(b=>b.innerText.includes('已存入'))`), 4000, 'saved label');
  await shot(teacher, 'study-10-explain-save.png');
  await T(`s.set({aiOpen:false});return true`);
  mark('AI explain card saves the question with answer and analysis into the study inbox', { points: saved.points });

  const ledger = (api.ledger?.entries ?? []).map((e) => e.feature);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, ledger, requests: requests.length, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
