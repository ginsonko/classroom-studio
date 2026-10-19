// 课前检查 + 网页课件预加载/保活 桌面验收。
// 用法：npm run build 后 npx electron test/quiet.cjs test/warmup-desktop.cjs
// 窗口放在所有屏幕之外（不打扰正在用电脑的人），截图仍然是真实画面。
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'warmup-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const student = { id: 'stu-1', name: '小林', grade: '高二', hue: 200, textbook: '人教版 2019', tags: [], lessons: 3, lastTopic: '', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [student], studentId: 'stu-1', slots: [], learning: {} } }));

// ── 课件样本 ──
const fx = path.join(out, '课件'); fs.mkdirSync(fx);
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:28px sans-serif;background:#eef6ff;color:#123;padding:40px}</style></head><body>${body}</body></html>`;
fs.writeFileSync(path.join(fx, '好课件.html'), page('好课件', '<h1>好课件：匀速圆周运动</h1><p>点一下按钮计数</p><audio id="a"></audio><video id="v" autoplay muted></video><script>window.__born=Date.now()+Math.random();window.__n=0;</script>'));
fs.writeFileSync(path.join(fx, '缺文件.html'), page('缺文件', '<h1>缺图片和脚本</h1><img src="images/missing.png"><script src="js/missing.js"></script>'));
fs.writeFileSync(path.join(fx, '空白.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff"><div id="app"></div><script>throw new Error("app init failed")</script></body></html>');
fs.writeFileSync(path.join(fx, '坏视频.avi'), Buffer.alloc(4096, 7));
fs.writeFileSync(path.join(fx, '秘密.html'), page('秘密', '<h1>没有加入流程</h1>'));
const P = (n) => path.join(fx, n).replaceAll('\\', '/');

const { app, screen } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 页面刷新时 executeJavaScript 会失败，等待期间当作"还没好"
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const shot = async (w, name) => { await sleep(700); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name, Object.keys(details).length ? JSON.stringify(details) : ''); };
const timer = setTimeout(() => { console.error('warmup desktop timed out'); app.exit(1); }, 240000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  // 放到所有屏幕左边之外：真实渲染、真实截图，但不出现在使用者的屏幕上
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 0, width: 1440, height: 900 }); teacher.showInactive();
  const stu = await until(() => api.windows.get('student'));
  stu.setBounds({ x: left + 1500, y: 0, width: 960, height: 560 }); stu.showInactive();
  await until(() => call(stu, '!!window.csWebKeep'), 15000, 'student keep api');
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.message||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const S = (code) => call(stu, `(async()=>{${code}})()`);
  const frameOf = (name) => stu.webContents.mainFrame.framesInSubtree.find((f) => decodeURIComponent(f.url).includes(name));

  // 老师在资料库里打开过这个目录（授权），本课流程里放 6 项
  api.files.authorize(fx, true);
  const flow = [
    { id: 'f1', ref: P('好课件.html'), title: '好课件', page: 0, done: false },
    { id: 'f2', ref: P('缺文件.html'), title: '缺文件', page: 0, done: false },
    { id: 'f3', ref: P('空白.html'), title: '空白', page: 0, done: false },
    { id: 'f4', ref: P('坏视频.avi'), title: '坏视频', page: 0, done: false },
    { id: 'f5', ref: P('已删除.pdf'), title: '已删除的讲义', page: 0, done: false },
    { id: 'f6', ref: 'board', title: '黑板', page: 0, done: false },
  ];
  await T(`localStorage.setItem('cs.lesson.flow', ${JSON.stringify(JSON.stringify(flow))}); location.reload(); return true`).catch(() => {});
  await sleep(500);
  await until(() => call(teacher, '!!window.__studioQA && !!document.querySelector(".flow-check")'), 20000, 'flow check button');

  // ── 1. 课前检查：逐项给出正常 / 留意 / 有问题 ──
  await T(`document.querySelector('.flow-check').click(); return true`);
  await until(() => T(`const el=document.querySelector('.flow-sum');return el&&!el.innerText.includes('正在检查')&&!document.querySelector('.flow-check').disabled`), 90000, 'check finished');
  const rows = await T(`return [...document.querySelectorAll('.flow li')].map(li=>({cls:li.className,text:li.innerText}))`);
  const row = (i) => rows[i];
  assert.match(row(0).cls, /ck-ok/, '好课件 ok: ' + row(0).text);
  assert.match(row(1).cls, /ck-warn/); assert.match(row(1).text, /missing\.(png|js)/, '缺文件说出了哪个文件');
  assert.match(row(2).cls, /ck-bad/); assert.match(row(2).text, /空白/);
  assert.match(row(3).cls, /ck-bad/); assert.match(row(3).text, /播放不了|读取|格式/);
  assert.match(row(4).cls, /ck-bad/); assert.match(row(4).text, /找不到/);
  assert.match(row(5).cls, /ck-ok/);
  const sum = await T(`return document.querySelector('.flow-sum').innerText`);
  assert.match(sum, /3 项有问题/); assert.match(sum, /1 项要留意/);
  await T(`document.querySelector('.col-right .right-stack')?.scrollTo(0, 99999); return true`);
  await shot(teacher, 'warm-1-check.png');
  mark('pre-class check marks good/warn/bad items with reasons', { summary: sum.split('\n')[0], warn: row(1).text.split('\n').slice(-1)[0], blank: row(2).text.split('\n').slice(-1)[0] });

  // ── 2. 通过检查的本地网页课件在学生窗口后台加载好（静音），没通过的不加载 ──
  const warmShared = await T(`return s.warm`);
  assert.deepEqual(warmShared.map((x) => x.title), ['好课件', '缺文件']);
  const ks = await until(async () => { const k = await S(`return window.csWebKeep()`); return k.frames.length === 2 && k.frames.every((f) => f.loaded) ? k : null; }, 20000, 'parked frames loaded');
  assert.equal(ks.canMove, true, 'moveBefore supported');
  assert.ok(ks.frames.every((f) => f.parked && f.warm && !f.busy));
  const good = frameOf('好课件.html');
  const born = await good.executeJavaScript('window.__born');
  assert.ok(born > 0);
  assert.equal(await good.executeJavaScript(`document.getElementById('a').muted`), true, 'parked page is muted');
  assert.equal(await good.executeJavaScript(`document.body.innerText.includes('好课件')`), true, 'real page loaded, not an error');
  mark('passed local web courseware is preloaded, muted, in the student window');

  // ── 3. 切给学生：直接用预加载好的那份，不重新加载；有声音 ──
  await T(`document.querySelectorAll('.flow li')[0].querySelector('.flow-go').click(); return true`);
  try { await until(async () => (await S(`return window.csWebKeep().frames.find(f=>f.path.includes('好课件')).busy`)), 10000, 'good on stage'); }
  catch (e) {
    console.log('DEBUG teacher', JSON.stringify(await T(`return {pgm:s.pgmMat.title,kind:s.pgmMat.kind,load:document.querySelector('.mat-load, .load-err, [role=alert]')?.innerText}`)));
    console.log('DEBUG student', JSON.stringify(await S(`return {keep:window.csWebKeep(),title:document.querySelector('.sw-foot')?.innerText,html:document.querySelector('.sw-stage')?.innerHTML.slice(0,600)}`)));
    throw e;
  }
  assert.equal(await good.executeJavaScript('window.__born'), born, 'not reloaded');
  await sleep(300);
  assert.equal(await good.executeJavaScript(`document.getElementById('a').muted`), false, 'on stage → unmuted');
  const waitShown = await S(`return !!document.querySelector('.doc-web-wait')`);
  assert.equal(waitShown, false, 'no loading overlay');
  await good.executeJavaScript('window.__n = 5');
  await shot(stu, 'warm-2-student-instant.png');
  mark('switching to a preloaded page is instant (same document, no loading overlay) and unmuted');

  // ── 4. 切到黑板再切回来：课件进度还在 ──
  await T(`document.querySelectorAll('.flow li')[5].querySelector('.flow-go').click(); return true`);
  await until(async () => (await S(`return !window.csWebKeep().frames.find(f=>f.path.includes('好课件')).busy`)), 10000, 'good parked');
  assert.equal(await good.executeJavaScript(`document.getElementById('a').muted`), true, 'parked again → muted');
  await T(`document.querySelectorAll('.flow li')[0].querySelector('.flow-go').click(); return true`);
  await until(async () => (await S(`return window.csWebKeep().frames.find(f=>f.path.includes('好课件')).busy`)), 10000, 'good back');
  assert.equal(await good.executeJavaScript('window.__born'), born, 'still the same document');
  assert.equal(await good.executeJavaScript('window.__n'), 5, 'state kept');
  mark('switching away and back keeps the web courseware state');

  // ── 5. 学生窗口只能读正在展示 / 老师预加载的文件 ──
  const denied = await S(`try{window.csHost.fileUrl(${JSON.stringify(P('秘密.html'))});return 'allowed'}catch(e){return e.message}`);
  assert.match(denied, /只能访问/);
  const forged = await S(`window.csHost.busPost({t:'shared',patch:{warm:[{path:${JSON.stringify(P('秘密.html'))},title:'x'}]}});await new Promise(r=>setTimeout(r,400));try{window.csHost.fileUrl(${JSON.stringify(P('秘密.html'))});return 'allowed'}catch(e){return e.message}`);
  assert.match(forged, /只能访问/, 'student cannot add files to the preload list');
  mark('student window cannot read files outside the shown / teacher-preloaded list');

  // ── 6. 课前提醒一到自动检查，横幅上显示结果 ──
  await T(`localStorage.setItem('cs.lesson.flow', JSON.stringify(JSON.parse(localStorage.getItem('cs.lesson.flow')).map(x=>({...x,done:false})))); return true`);
  api.remindLesson({ key: 'k', slot: { id: 'slot1', studentId: 'stu-1', topic: '圆周运动' }, at: new Date(Date.now() + 600000), minutes: 10, studentName: '小林' });
  await until(() => T(`const b=document.querySelector('.remind-check');return b&&!b.innerText.includes('正在检查')?b.innerText:null`), 90000, 'banner check result');
  const banner = await T(`return document.querySelector('.remind-banner').innerText`);
  assert.match(banner, /课前检查：.*有问题/);
  await shot(teacher, 'warm-3-remind.png');
  mark('class reminder runs the check automatically and shows the result', { banner: banner.split('\n').find((l) => l.includes('课前检查')) });

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log('RESULT ' + out);
  clearTimeout(timer); app.exit(0);
})().catch(async (e) => {
  console.error('FAIL', e);
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  app.exit(1);
});
