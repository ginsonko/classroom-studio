// 1.2.0 课表导入桌面验收（屏幕外窗口）：
//   1. 真的 .xlsx（共享字符串、合并单元格、Excel 时间小数）和 .docx（表格）读出文字，规则识别出课；
//   2. 课表页「导入课表」：粘贴文字 → 预览（已有学生对上号、和现有课冲突的跳过、新学生自动建）→ 改用导入的 → 导入 → 撤销；
//   3. 配了 AI：课表截图交给看图模型，按模型返回的结果出预览。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v120-schedule-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const JSZip = require('jszip');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v120s-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const S = (id, name, subject = 'physics') => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject });
const monday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; })();
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const oldSlot = { id: 'old-1', studentId: 'stu-a', date: key(monday), day: 0, start: 19, len: 1.5, topic: '原来的周一课', repeat: true };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  allowedRoots: [out],
  local: { roots: [], students: [S('stu-a', '俊宇'), S('stu-b', '欣怡')], studentId: 'stu-a', slots: [oldSlot], learning: {} },
}));

const electron = require('electron'); const { app, nativeImage } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v120 schedule desktop timed out'); app.exit(1); }, 180000);

// 假的模型服务：看到课表提示词就返回两节课
const requests = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}'); requests.push(j);
    const all = JSON.stringify(j.messages || []);
    const content = all.includes('排课助理') ? JSON.stringify({ lessons: [{ student: '欣怡', day: '周二', start: '18:00', end: '19:30', topic: '截图里的课', repeat: true }, { student: '王小明', grade: '初三', subject: '物理', day: '周日', start: '14:00', end: '16:00', repeat: true }] }) : '{}';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 500, completion_tokens: 100 } }));
  });
});

async function makeFiles() {
  const strings = ['时间', '周一', '周三', '周六', '俊宇 电磁感应', '欣怡 函数', '李明 初二数学'];
  const si = (s) => strings.indexOf(s);
  const c = (ref, s) => `<c r="${ref}" t="s"><v>${si(s)}</v></c>`;
  const x = new JSZip();
  x.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  x.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="秋季课表" sheetId="1" r:id="rId1"/></sheets></workbook>');
  x.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  x.file('xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`);
  x.file('xl/styles.xml', '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="20"/></cellXfs></styleSheet>');
  // 18:30 和 19:30 是 Excel 的时间小数；周六 9 点这一格向下合并了两行（两个小时）
  x.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
    + `<row r="1">${c('A1', '时间')}${c('B1', '周一')}${c('C1', '周三')}${c('D1', '周六')}</row>`
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>09:00-10:00</t></is></c>' + c('D2', '李明 初二数学') + '</row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>10:00-11:00</t></is></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>19:00-20:30</t></is></c>' + c('B4', '俊宇 电磁感应') + c('C4', '欣怡 函数') + '</row>'
    + '</sheetData><mergeCells count="1"><mergeCell ref="D2:D3"/></mergeCells></worksheet>');
  const xlsx = path.join(out, '秋季课表.xlsx'); fs.writeFileSync(xlsx, await x.generateAsync({ type: 'nodebuffer' }));
  const d = new JSZip();
  d.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const tc = (t) => `<w:tc><w:tcPr><w:tcW w:w="2000"/></w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  d.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>王老师 本学期课表</w:t></w:r></w:p>'
    + `<w:tbl><w:tr>${tc('时间')}${tc('周二')}${tc('周五')}</w:tr><w:tr>${tc('18:00-19:30')}${tc('欣怡')}${tc('')}</w:tr><w:tr>${tc('晚上8点到9点半')}${tc('')}${tc('俊宇 复习')}</w:tr></w:tbl><w:sectPr/></w:body></w:document>`);
  const docx = path.join(out, '课表.docx'); fs.writeFileSync(docx, await d.generateAsync({ type: 'nodebuffer' }));
  const w = 320, h = 160, buf = Buffer.alloc(w * h * 4, 255);
  const png = path.join(out, '课表截图.png'); fs.writeFileSync(png, nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG());
  return { xlsx, docx, png };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const files = await makeFiles();
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1360, height: 860 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const rows = () => T(`return [...document.querySelectorAll('.si-row:not(.si-head)')].map(r=>({cls:r.className,who:r.querySelector('select').selectedOptions[0].textContent,when:r.querySelector('span').textContent,state:r.querySelector('em').textContent}))`);

  // 1. Excel / Word 文件
  const names = ['俊宇', '欣怡'];
  const xl = await T(`const src=await Q.schedule.readSource(${JSON.stringify(files.xlsx)});const r=await Q.schedule.readLessons(src,${JSON.stringify(names)},new Date());return {text:src.text,r}`);
  assert.match(xl.text, /时间\t周一\t周三\t周六/);
  assert.equal(xl.r.via, 'rules');
  const li = xl.r.lessons.find((l) => l.student === '李明');
  assert.deepEqual([li.day, li.start, li.len], [5, 9, 2], '合并单元格的两小时合成一节');
  assert.equal(xl.r.lessons.length, 3);
  const dx = await T(`const src=await Q.schedule.readSource(${JSON.stringify(files.docx)});const r=await Q.schedule.readLessons(src,${JSON.stringify(names)},new Date());return {text:src.text,r}`);
  assert.match(dx.text, /^王老师 本学期课表\n时间\t周二\t周五/);
  const jy = dx.r.lessons.find((l) => l.student === '俊宇');
  assert.deepEqual([dx.r.lessons.length, jy.day, jy.start, jy.len, jy.topic], [2, 4, 20, 1.5, '复习']);
  mark('real .xlsx (shared strings, merged cells) and .docx (table) are read and split into lessons without AI', { xlsx: xl.r.lessons.length, docx: dx.r.lessons.length });

  // 2. 课表页导入：粘贴文字 → 预览 → 改用导入的 → 导入 → 撤销
  await T(`s.set({page:'schedule'});return true`);
  await until(() => T(`return !!document.querySelector('.sch-imp')`), 8000, 'schedule page');
  await click('.sch-imp');
  await until(() => T(`return !!document.querySelector('.sch-import textarea')`), 5000, 'import dialog');
  await type('.sch-import textarea', '周一 19:00-20:30 俊宇 电磁感应\n周三 18:30-20:00 欣怡 函数\n周六 9:00-11:00 李明 初二数学\n周日 7:00-8:00 欣怡 早读');
  await click('.sch-import .btn-cue', '识别课表');
  await until(async () => (await rows()).length === 4, 8000, 'preview rows');
  let r = await rows();
  assert.deepEqual(r.map((x) => x.who), ['俊宇', '欣怡', '新建「李明」', '欣怡']);
  assert.match(r[0].state, /原来的周一课.*跳过/); assert.match(r[0].cls, /skip/);
  assert.equal(r[1].state, '新增'); assert.equal(r[2].state, '新增');
  assert.equal(r[3].when, '每周日 19:00–20:00', '没写上下午的 7:00 按晚上');
  // 屏幕外的窗口截不了图（UnknownVizError），CS_SHOW=1 时留一张预览图看排版
  if (process.env.CS_SHOW === '1') { teacher.focus(); teacher.webContents.invalidate(); await sleep(1200); fs.writeFileSync(path.join(out, 'preview.png'), (await teacher.webContents.capturePage()).toPNG()); }
  await click('.si-opts .record-check input');
  await until(async () => /替换/.test((await rows())[0].state), 3000, 'replace conflicts');
  await click('.sch-import .btn-cue', '导入 4 节课');
  await until(() => T(`return !document.querySelector('.sch-import')`), 3000, 'dialog closed');
  const after = await T(`const st=Q.useStore.getState();return {slots:st.slots,students:st.students}`);
  assert.equal(after.slots.length, 4); assert.ok(!after.slots.some((x) => x.id === 'old-1'), '撞上的旧课被换掉');
  const lm = after.students.find((x) => x.name === '李明');
  assert.ok(lm && lm.subject === 'math', '新学生自动建好');
  assert.ok(after.slots.filter((x) => x.studentId === lm.id).length === 1);
  const banner = await T(`return document.querySelector('.material-status')?.innerText||''`);
  assert.match(banner, /已导入 4 节课，新建学生 李明，替换掉原来的 1 节/);
  await click('.material-status button', '撤销导入');
  const undone = await T(`const st=Q.useStore.getState();return {slots:st.slots.map(x=>x.id),students:st.students.map(x=>x.name)}`);
  assert.deepEqual(undone, { slots: ['old-1'], students: ['俊宇', '欣怡'] });
  mark('schedule page import: paste text, preview matches students and flags conflicts, replace option, import, undo', { rows: r.map((x) => x.state) });

  // 3. 配了 AI：课表截图交给看图模型
  await T(`await window.csHost.call('ai.setConfig',{baseUrl:${JSON.stringify(base)},model:'fake-text',visionModel:'fake-vision',key:'sk-test-0000'});return true`);
  await click('.sch-imp');
  await until(() => T(`return !!document.querySelector('.sch-import')`), 5000, 'import dialog 2');
  const img = await T(`const src=await Q.schedule.readSource(${JSON.stringify(files.png)});return src.image.slice(0,22)`);
  assert.equal(img, 'data:image/png;base64,');
  // 在对话框里粘贴截图（剪贴板事件里带着图片文件）
  await T(`const b=await (await fetch(Q.host.fileUrl(${JSON.stringify(files.png)}))).blob();const dt=new DataTransfer();dt.items.add(new File([b],'shot.png',{type:'image/png'}));document.querySelector('.sch-import').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return true`);
  await until(() => T(`return !!document.querySelector('.si-img img')`), 5000, 'pasted image shown');
  await click('.sch-import .btn-cue', '识别课表');
  await until(async () => (await rows()).length === 2, 10000, 'AI preview rows');
  r = await rows();
  assert.deepEqual(r.map((x) => [x.who, x.when, x.state]), [['欣怡', '每周二 18:00–19:30', '新增'], ['新建「王小明」', '每周日 14:00–16:00', '新增']]);
  const meta = await T(`return document.querySelector('.si-meta').innerText`);
  assert.match(meta, /AI 识别 · fake-vision/);
  const req = requests.find((j) => JSON.stringify(j.messages).includes('排课助理'));
  assert.equal(req.model, 'fake-vision');
  assert.match(JSON.stringify(req.messages), /image_url|data:image\/png/);
  await click('.sch-import .btn-cue', '导入 2 节课');
  const ai = await T(`const st=Q.useStore.getState();return st.students.find(x=>x.name==='王小明')`);
  assert.equal(ai.subject, 'j-physics'); assert.equal(ai.grade, '初三');
  mark('with AI configured, a pasted timetable screenshot goes to the vision model and its lessons are previewed and imported', { model: req.model });

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length}/3 passed · ${out}`);
  clearTimeout(timer); server.close(); app.exit(0);
})().catch((e) => { console.error(e); console.error('errors:', errors.slice(-8)); clearTimeout(timer); app.exit(1); });
