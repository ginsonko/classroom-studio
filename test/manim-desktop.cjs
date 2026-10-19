// manim 讲解动画桌面验收（需要本机装 manim，没装时只验证「可选组件」提示）：
// 「讲解动画」一开始就能点 → AI 讲题 → 写脚本 → 第一版被安全检查挡下 → 第二版渲染报错交回 AI 修 → 第三版渲染成 MP4
// → AI 看截帧审片发现问题 → 第四版修好 → 卡片里看得到每一步 → 预览、上屏、学生端播放；再做一个并中途取消。
// 用法：npm run build 后 npx electron test/quiet.cjs test/manim-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'manim-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '' }], studentId: 'stu-w', slots: [], learning: {} } }));
const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('manim desktop timed out'); app.exit(1); }, 600000);

const EXPLAIN = { title: '匀加速追及', problem: '汽车从静止以 2 m/s² 加速，5 s 末速度多大？', idea: '直接用速度公式', steps: [{ t: '写出速度公式', tex: 'v=v_0+at', plain: 'v=v0+at' }, { t: '代入数据', tex: 'v=0+2\\times5=10\\,\\text{m/s}', plain: 'v=10 m/s' }], answer: '10 m/s', pitfalls: ['初速度是 0'] };
const GOOD = `from manim import *

class Explain(Scene):
    def construct(self):
        title = Text("匀加速直线运动", font="Microsoft YaHei", font_size=40).to_edge(UP)
        f = MathTex(r"v = v_0 + at = 10\\,\\mathrm{m/s}")
        car = Dot(LEFT * 4, color=YELLOW)
        self.play(Write(title), run_time=0.6)
        self.play(FadeIn(f), car.animate.shift(RIGHT * 6), run_time=1)
        self.wait(0.3)
`;
const FIXED = GOOD.replace('MathTex(r"v', 'MathTex(r"v').replace('car = Dot', 'f.next_to(title, DOWN, buff=1)\n        car = Dot');
// 第 1 版 import os（安全检查），第 2 版拼错函数名（渲染报错），第 3 版能渲染但审片挑出问题，第 4 版修好；第 5 版起（取消测试）用好脚本
// 第 1 版还故意把脚本包成 {"code": …}：之前真实模型就是这样，导致三次都「没有 class Explain」
const scripts = [JSON.stringify({ code: 'import os\n' + GOOD }), '```python\n' + GOOD.replace('Write(title)', 'Wrte(title)') + '```', '```python\n' + GOOD + '```', '```python\n' + FIXED + '```'];
let requests = [], manimReqs = [], reviewReqs = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const sys = String(j.messages?.[0]?.content || ''), last = j.messages?.at(-1)?.content;
    const lastText = typeof last === 'string' ? last : Array.isArray(last) ? last.map((x) => x.text || '').join('') : '';
    let content;
    if (sys.includes('manim Community')) { manimReqs.push(j); content = '好的：\n' + (scripts[manimReqs.length - 1] ?? '```python\n' + GOOD + '```'); }
    else if (lastText.includes('审片的老师')) { reviewReqs.push(j); content = JSON.stringify(reviewReqs.length === 1 ? { ok: false, problems: ['第 2 帧：公式压在标题上，往下移'] } : { ok: true, problems: [] }); }
    else content = JSON.stringify(EXPLAIN);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 300 } }));
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
  const typeAsk = (text) => T(`const el=document.querySelector('.ai-compose textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);

  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});localStorage.setItem('cs.ai.screen','0');s.set({page:'console',aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-act.a-explain')&&!document.querySelector('.ai-act.a-explain').disabled`), 8000, 'explain action');
  const status = await T(`return await window.csHost.call('manim.status')`);
  // 等讲解动画按钮检测完 manim
  const animBtn = await until(() => T(`const b=document.querySelector('.ai-act.a-anim');return b&&!/正在检测/.test(b.dataset.tip||'')?{dis:b.disabled,tip:b.dataset.tip,text:b.innerText}:null`), 90000, 'anim action detection');

  if (!status.ok) {
    assert.equal(animBtn.dis, true); assert.match(animBtn.tip, /没检测到 manim/);
    await typeAsk(EXPLAIN.problem);
    await T(`document.querySelector('.ai-act.a-explain').click();return true`);
    const st = await until(() => T(`const m=document.querySelector('.ai-card.k-explain .ai-manim');return m&&!m.innerText.includes('正在检测')?{text:m.innerText,ok:!!m.querySelector('.ai-manim-go')}:null`), 30000, 'manim hint');
    assert.match(st.text, /可选组件/); assert.equal(st.ok, false);
    mark('manim not installed: 讲解动画 button disabled with a reason, explain card shows a one-line optional-component hint', { status });
  } else {
    // ── 1. 不用先讲题：输入题目直接点「讲解动画」（草稿画质） ──
    assert.equal(animBtn.dis, false, 'anim action enabled from the start: ' + animBtn.tip);
    assert.match(animBtn.text, new RegExp('manim ' + status.version.replace(/\./g, '\\.')));
    await T(`[...document.querySelectorAll('.ai-act-wrap .ai-manim-q button')].find(b=>b.innerText==='草稿').click();return true`);
    await until(() => T(`return document.querySelector('.ai-act-wrap .ai-manim-q button.on')?.innerText==='草稿'`), 3000, 'draft selected');
    await typeAsk(EXPLAIN.problem);
    await T(`document.querySelector('.ai-act.a-anim').click();return true`);
    await until(() => T(`return !!document.querySelector('.ai-card.k-anim.pending .ai-manim.busy .ai-prog')`), 6000, 'anim card busy');
    assert.equal(await T(`return document.querySelector('.ai-act.a-explain').disabled`), false, 'other AI actions stay usable while the animation renders');
    assert.equal(await T(`return document.querySelector('.ai-act.a-anim').disabled`), true, 'only one animation at a time');
    const live = await until(() => T(`const c=document.querySelector('.ai-card.k-anim');return c&&/正在渲染/.test(c.innerText)?c.innerText:null`), 120000, 'render step visible');
    assert.match(live, /讲解好了：匀加速追及/); assert.match(live, /第 1 版脚本没通过安全检查/); assert.match(live, /已用 \d+ 秒/);
    await shot(teacher, 'manim-1-busy.png', 100);
    const done = await until(() => T(`const c=document.querySelector('.ai-card.k-anim');return c&&!c.classList.contains('pending')?{cls:c.className,text:c.innerText,res:!!c.querySelector('.ai-manim-res'),sheet:!!c.querySelector('.ai-manim-res img.ai-sheet')}:null`), 400000, 'anim finished');
    assert.ok(done.res, 'rendered: ' + done.text);
    assert.equal(manimReqs.length, 4, 'four script versions'); assert.equal(reviewReqs.length, 1, 'one review');
    const r2 = manimReqs[1].messages.at(-1).content, r3 = manimReqs[2].messages.at(-1).content, r4 = manimReqs[3].messages.at(-1).content;
    assert.match(r2, /安全检查/); assert.match(r2, /导入了不允许的模块：import os/);
    assert.match(r3, /渲染失败/); assert.match(r3, /NameError: name 'Wrte' is not defined/);
    assert.ok(!/│/.test(r3), 'rich box characters stripped from the error log');
    assert.match(r4, /审片/); assert.match(r4, /公式压在标题上/);
    assert.ok(JSON.stringify(reviewReqs[0]).includes('data:image/jpeg;base64,'), 'review sees the contact sheet');
    const firstPrompt = manimReqs[0].messages.at(-1).content;
    assert.ok(firstPrompt.includes('v=v_0+at') && firstPrompt.includes('class Explain(Scene)') && firstPrompt.includes('Microsoft YaHei'), 'prompt carries the explanation and the rules');
    assert.ok(done.sheet && /第 4 版脚本/.test(done.text) && /答案/.test(done.text), done.text);
    await T(`[...document.querySelectorAll('.ai-card.k-anim button')].find(b=>b.innerText.includes('制作过程')).click();return true`);
    const log = await T(`return document.querySelector('.ai-card.k-anim .ai-manim-steps').innerText`);
    for (const re of [/没通过安全检查/, /渲染出错：NameError/, /审片发现：第 2 帧：公式压在标题上/, /修改后的版本渲染完成/]) assert.match(log, re);
    assert.ok(await T(`return document.querySelectorAll('.ai-card.k-anim .ai-manim-steps .bad').length>=3`), 'failed steps are marked');
    mark('讲解动画 works without explaining first; each step (blocked script, render error, review problem, revision) is visible in the card', { steps: log.split('\n').length });

    // ── 2. 我先看 → 预览是视频；上屏 → 学生端播放；任务目录只留成片和脚本 ──
    await T(`[...document.querySelectorAll('.ai-card.k-anim .ai-sub button')].find(b=>b.innerText.includes('我先看')).click();return true`);
    const mat = await until(() => T(`const m=s.reader.mat;return m.kind==='video'?m:null`), 8000, 'video in preview');
    assert.ok(mat.path.endsWith('.mp4') && mat.title.startsWith('讲解动画'), JSON.stringify(mat).slice(0, 300));
    const dir = path.dirname(mat.path);
    assert.ok(fs.existsSync(mat.path) && fs.existsSync(path.join(dir, 'scene.py')) && !fs.existsSync(path.join(dir, 'media')), 'job dir keeps only the video and the script');
    assert.match(fs.readFileSync(path.join(dir, 'scene.py'), 'utf8'), /buff=1/, 'the revised (4th) script is the one shown');
    await until(() => T(`const v=document.querySelector('video');return v&&v.readyState>=1&&v.duration>1`), 15000, 'teacher preview video loads');
    await T(`[...document.querySelectorAll('.ai-card.k-anim .ai-sub button')].find(b=>b.innerText.includes('上屏')).click();return true`);
    const sv = await until(() => S(`const v=document.querySelector('video');return s.pgmMat.kind==='video'&&v&&v.readyState>=1?{d:v.duration,w:v.videoWidth,h:v.videoHeight}:null`), 15000, 'student plays the video');
    assert.ok(sv.d > 1 && sv.w === 854 && sv.h === 480, 'draft 480p video: ' + JSON.stringify(sv));
    await T(`[...document.querySelectorAll('.ai-card.k-anim button')].find(b=>b.innerText.includes('查看脚本')).click();return true`);
    assert.match(await T(`return document.querySelector('.ai-manim-code').innerText`), /class Explain\(Scene\)/);
    await shot(teacher, 'manim-2-done.png');
    await S(`const v=document.querySelector('video');v.currentTime=Math.max(0,v.duration-0.2);return true`);
    await shot(student, 'manim-3-student.png', 900);
    mark('preview opens the MP4 as a normal video material, 上屏 plays it on the student window (854×480 draft), script viewable, media cache removed', sv);

    // ── 3. 再做一个，渲染中取消：卡片马上停下，不再继续 ──
    await T(`document.querySelector('.ai-act.a-anim').click();return true`);
    await until(() => T(`const c=document.querySelector('.ai-card.k-anim');return c&&c.classList.contains('pending')&&/正在渲染/.test(c.innerText)`), 60000, 'second anim rendering');
    const before = manimReqs.length;
    await T(`[...document.querySelector('.ai-card.k-anim').querySelectorAll('button')].find(b=>b.innerText.includes('取消')).click();return true`);
    const cancelled = await until(() => T(`const c=document.querySelector('.ai-card.k-anim');return c&&!c.classList.contains('pending')?c.innerText:null`), 3000, 'cancel is immediate');
    assert.match(cancelled, /已取消/);
    await sleep(4000);
    assert.equal(manimReqs.length, before, 'no more script requests after cancel');
    assert.equal(reviewReqs.length, 1, 'no review after cancel');
    assert.equal(await T(`return document.querySelector('.ai-act.a-anim').disabled`), false, 'can start again');
    mark('cancel during render stops the card at once and makes no further AI calls');

    // ── 4. 讲题卡片下面仍然有「做成讲解动画」 ──
    await T(`document.querySelector('.ai-act.a-explain').click();return true`);
    await until(() => T(`return !!document.querySelector('.ai-card.k-explain .ai-manim-go')`), 15000, 'explain card offers animation');
    mark('explain card still offers 做成讲解动画');
  }

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools/.test(e)), [], 'console errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, requests: requests.length, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (error) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); clearTimeout(timer); app.exit(1);
});
