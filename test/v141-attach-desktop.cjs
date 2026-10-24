// 1.4.1 桌面验收（屏幕外窗口）：AI 答疑的附件
//   1. 拖入两张图片 → 两个图片附件；粘贴一张图 → 第三个附件；× 能单个移除；
//   2. 「添加附件」选一份图片 + 一份 txt 题目 → 图片附件和文字附件都能加；
//   3. 发送时：所有图片按 image_url 一起发（走看图模型），文档文字拼进提示词，卡片上写明用了哪些附件；
//   4. 上限 6 个：多选时只收前 6 个并提示；「清空」把文字和附件一起清掉；读不了的文件只提示、不影响别的。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v141-attach-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v141a-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const S = { id: 'stu-a', name: '俊宇', grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'physics' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  allowedRoots: [out],
  local: { roots: [], students: [S], studentId: 'stu-a', slots: [], learning: {} },
}));
const PROBLEM = '如图，质量 m = 2 kg 的物块在水平面上受到 6 N 的拉力，动摩擦因数 0.2，g 取 10 m/s²，求加速度。';
const txtPath = path.join(out, '摩擦力题目.txt'); fs.writeFileSync(txtPath, PROBLEM + '\n');
const extra = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'].map((n) => { const p = path.join(out, n); fs.writeFileSync(p, '第 ' + n + ' 份资料'); return p; });
const badPath = path.join(out, '课堂录像.mp4'); fs.writeFileSync(badPath, 'not a video');

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
let pickFiles = [];
electron.dialog.showOpenDialog = async () => ({ canceled: !pickFiles.length, filePaths: pickFiles });
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v141 attach desktop timed out'); app.exit(1); }, 240000);

// 假网关：记下每次请求，直接回一段文字（「问一问」）
const requests = [];
const ANSWER = '这道题先用牛顿第二定律：合力 6 − μmg = 2 N，加速度 a = 1 m/s²。';
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
});
const parts = (j) => { const c = j.messages.at(-1)?.content; return Array.isArray(c) ? c : [{ type: 'text', text: String(c ?? '') }]; };
const textOf = (j) => parts(j).filter((p) => p.type === 'text').map((p) => p.text).join('\n');

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = async (w, code) => { try { return await w.webContents.executeJavaScript(code); } catch (e) { throw Error('executeJavaScript 失败：' + e.message + '\n代码片段：' + String(code).slice(0, 240)); } };
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  const chips = () => T(`return [...document.querySelectorAll('.ai-atts .ai-att')].filter(e=>!e.classList.contains('busy')&&!e.classList.contains('bad')).map(e=>({cls:e.className,name:e.querySelector('b')?.textContent||''}))`);
  const names = async () => (await chips()).map((x) => x.name);
  const bar = (text) => T(`const b=[...document.querySelectorAll('.ai-compose-bar .ai-chip')].find(b=>b.innerText.includes(${JSON.stringify(text)}));if(!b)throw Error('no bar chip '+${JSON.stringify(text)});return b.innerText`);
  const attTip = () => T(`const b=[...document.querySelectorAll('.ai-compose-bar .ai-chip')].find(b=>b.innerText.includes('添加附件'));return b.getAttribute('data-tip')||''`);

  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});localStorage.setItem('cs.ai.screen','0');s.set({page:'console',aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-compose textarea')`), 8000, 'AI panel');
  await until(() => T(`return document.querySelector('.ai-model')?.innerText.includes('fake-text')`), 8000, '已连上模型');
  assert.match(await bar('添加附件'), /^添加附件$/);

  // 两张真图片：画布画出来存成文件，拖入时用 File 本体（浏览器里拿不到路径的那条路）
  const png = (label, color) => T(`const c=document.createElement('canvas');c.width=640;c.height=360;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,640,360);g.fillStyle=${JSON.stringify(color)};g.font='40px sans-serif';g.fillText(${JSON.stringify(label)},40,140);g.fillText('a = 1 m/s²',40,220);return c.toDataURL('image/png')`);
  const data1 = await png('题目照片', '#c00'), data2 = await png('学生草稿', '#036');
  const img1 = await T(`return await Q.host.call('saveImage', ${JSON.stringify(data1)})`);
  assert.ok(fs.existsSync(img1), '图片已存到磁盘：' + img1);

  // 页面里 CSP 不让 fetch data: 地址，直接按 base64 拼出 File
  const mkDt = (files) => `
    const dt=new DataTransfer();
    for(const [name,url] of ${JSON.stringify(files)}){
      const bin=atob(url.split(',')[1]);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
      dt.items.add(new File([u8],name,{type:'image/png'}));
    }`;
  const dragTo = (files, target, type) => T(`${mkDt(files)}
    const el=document.querySelector(${JSON.stringify(target)});
    el.dispatchEvent(new DragEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,dataTransfer:dt}));
    return dt.files.length`);
  const pasteTo = (files, target) => T(`${mkDt(files)}
    const el=document.querySelector(${JSON.stringify(target)});
    const ev=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});
    el.dispatchEvent(ev);
    return {files:ev.clipboardData?.files.length??-1}`);

  // ── 1. 拖入两张图片 ───────────────────────────────────────────
  assert.equal(await dragTo([['题目照片.png', data1], ['学生草稿.png', data2]], '.ai-compose textarea', 'dragover'), 2);
  await until(() => T(`return !!document.querySelector('.ai-drop')`), 5000, '拖到面板上时给出提示');
  assert.match(await T(`return document.querySelector('.ai-drop').innerText`), /松开就把它们当附件/);
  await shot('attach-1-dragover.png');
  await dragTo([['题目照片.png', data1], ['学生草稿.png', data2]], '.ai-compose textarea', 'drop');
  await until(async () => (await chips()).length === 2, 8000, '两个图片附件');
  let c = await chips();
  assert.deepEqual(c.map((x) => x.name), ['题目照片.png', '学生草稿.png']);
  assert.ok(c.every((x) => /ai-att image/.test(x.cls)), JSON.stringify(c));
  assert.equal(await T(`return !!document.querySelector('.ai-drop')`), false, '松手后提示消失');
  await shot('attach-2-dropped.png');

  // ── 2. 粘贴一张图：输入框里 Ctrl+V 当附件（不该贴到黑板）───────
  assert.deepEqual(await pasteTo([['粘贴的截图.png', data1]], '.ai-compose textarea'), { files: 1 }, '粘贴事件里带上了图片');
  await until(async () => (await chips()).length === 3, 8000, '粘贴的图片成为第三个附件');
  assert.deepEqual(await names(), ['题目照片.png', '学生草稿.png', '粘贴的截图.png']);
  assert.equal(await T(`return document.querySelector('.ai-compose textarea').value`), '', '粘贴图片不会把内容写进输入框');
  assert.equal(await T(`const st=Q.useStore.getState();return st.ink['board:0']?.length??0`), 0, '没有贴到黑板');

  // ── 3. 「添加附件」：一份图片（按路径读）+ 一份 txt 题目 ────────
  pickFiles = [img1, txtPath];
  await click('.ai-compose-bar .ai-chip', '添加附件');
  await until(async () => (await chips()).length === 5, 10000, '选文件加的附件');
  c = await chips();
  assert.deepEqual((await names()).slice(0, 3), ['题目照片.png', '学生草稿.png', '粘贴的截图.png']);
  assert.match(c[3].name, /\.png$/); assert.match(c[3].cls, /ai-att image/, '按路径选的图片也是图片附件');
  assert.equal(c[4].name, '摩擦力题目.txt'); assert.match(c[4].cls, /ai-att doc/);
  assert.match(await bar('添加附件'), /添加附件 5\/6/);
  await shot('attach-3-picked.png');
  pickFiles = [txtPath];
  await click('.ai-compose-bar .ai-chip', '添加附件');
  await sleep(1500);
  assert.equal((await chips()).length, 5, '同一个文件不会重复加进来');

  // ── 4. 发送：四张图 + 文档文字一起发，走看图模型 ────────────────
  requests.length = 0;
  await T(`const el=document.querySelector('.ai-compose textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'这题怎么做？');el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  await click('.ai-act', '问一问');
  await until(() => requests.length === 1, 15000, '一次请求');
  const req = requests[0];
  assert.equal(req.model, 'fake-vision', '带图的请求走看图模型');
  const imgs = parts(req).filter((p) => p.type === 'image_url');
  assert.equal(imgs.length, 4, '四张图都发出去');
  assert.ok(imgs.every((p) => /^data:image\/jpeg;base64,/.test(p.image_url.url) && p.image_url.url.length > 2000), '图片压成 JPEG 再发');
  const text = textOf(req);
  assert.match(text, /这题怎么做/);
  assert.match(text, /老师另外附上了 4 张图片：题目照片\.png、学生草稿\.png、粘贴的截图\.png/);
  assert.match(text, /【附件：摩擦力题目\.txt】/);
  assert.match(text, /质量 m = 2 kg 的物块/);
  assert.ok(!/质量 m = 2 kg 的物块[\s\S]*质量 m = 2 kg 的物块/.test(text), '文档文字只拼一次');
  await until(() => T(`return !!document.querySelector('.ai-card .ai-q-att')`), 5000, '卡片写明用了哪些附件');
  const cardNames = await T(`return document.querySelector('.ai-card .ai-q-att').innerText`);
  assert.match(cardNames, /题目照片\.png、学生草稿\.png、粘贴的截图\.png/);
  assert.match(cardNames, /摩擦力题目\.txt/);
  assert.equal(await T(`return document.querySelectorAll('.ai-card .ai-q img.att').length`), 3, '卡片上最多给出 3 张附件的缩略图');
  assert.equal(await T(`return !!document.querySelector('.ai-card .ai-q .dim')`), false, '有附件时不再写「读取学生画面」');
  assert.match(await T(`return document.querySelector('.ai-card .ai-text').innerText`), /牛顿第二定律/);
  await shot('attach-4-card.png');
  assert.equal((await chips()).length, 5, '发送后附件还留在输入区');

  // ── 5. 单个移除 + 上限 6 个 ──────────────────────────────────
  await T(`document.querySelector('.ai-atts .ai-att button').click();return true`);
  await until(async () => (await chips()).length === 4, 5000, '移除一个');
  const n5 = await names();
  assert.equal(n5.length, 4);
  assert.deepEqual(n5.slice(0, 2), ['学生草稿.png', '粘贴的截图.png']);
  assert.equal(n5[3], '摩擦力题目.txt');
  pickFiles = extra;
  await click('.ai-compose-bar .ai-chip', '添加附件');
  await until(async () => (await chips()).length === 6, 10000, '补到上限 6 个');
  assert.deepEqual((await names()).slice(4), ['a.txt', 'b.txt']);
  await until(() => T(`return !!document.querySelector('.ai-atts .ai-att.bad')`), 8000, '超出的给出提示');
  assert.match(await T(`return document.querySelector('.ai-atts .ai-att.bad').innerText`), /一次最多 6 个附件/);
  assert.match(await attTip(), /一次最多 6 个附件/);
  await shot('attach-5-full.png');

  // ── 6. 清空：文字和附件一起清掉 ──────────────────────────────
  await click('.ai-compose-bar .ai-chip', '清空');
  await until(async () => (await chips()).length === 0, 5000, '附件清空');
  assert.equal(await T(`return document.querySelector('.ai-compose textarea').value`), '');
  assert.equal(await T(`return !!document.querySelector('.ai-atts')`), false);

  // ── 7. 读不了的文件只提示，不影响同批里能读的 ────────────────
  pickFiles = [badPath, txtPath];
  await click('.ai-compose-bar .ai-chip', '添加附件');
  await until(async () => (await chips()).length === 1, 10000, '只有能读的那个进来');
  assert.deepEqual(await names(), ['摩擦力题目.txt']);
  assert.match(await T(`return document.querySelector('.ai-atts .ai-att.bad').innerText`), /这种格式还不能当附件/);

  assert.equal(errors.length, 0, '没有控制台报错：' + errors.join(' | '));
  mark('AI 答疑附件：拖入 / 粘贴 / 选文件 / 多附件 / 移除 / 上限 / 清空 / 读不了只提示');
  clearTimeout(timer);
  console.log('v141 attach desktop: ' + results.length + ' 项全部通过，截图在 ' + out);
  server.close();
  app.exit(0);
})().catch((e) => { console.error('FAIL ' + (e && e.stack || e)); if (errors.length) console.error('console: ' + errors.join(' | ')); app.exit(1); });
