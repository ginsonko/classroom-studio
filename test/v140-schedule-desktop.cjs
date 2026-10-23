// 1.4.0 课表桌面验收（屏幕外窗口）：
//   1. 一次选三份课表（.xlsx + .docx + .txt）：逐个读、合在一起预览，重复的只算一次；没写上下午的标黄，点「改成上午」改过来；
//      Excel 第一列的 6:00 排在 09:00 前面，认成早上；23:00–01:00 跨午夜；导入后横幅写明来自几份，一次撤销；
//   2. 周课表：跨午夜的课当天画到 24 点，第二天凌晨接着画一段「接前一天」；
//   3. 排课：23:00 开始两小时能保存（提示次日 01:00 下课），第二天 00:30 的课提示重叠，改到 01:00 能保存。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v140-schedule-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const JSZip = require('jszip');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v140s-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const S = (id, name, subject = 'physics') => ({ id, name, grade: '高二', hue: 190, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject });
const monday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; })();
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n) => { const d = new Date(monday); d.setDate(d.getDate() + n); return d; };
const oldSlot = { id: 'old-1', studentId: 'stu-a', date: key(monday), day: 0, start: 19, len: 1.5, topic: '原来的周一课', repeat: true };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {} },
  allowedRoots: [out],
  local: { roots: [], students: [S('stu-a', '俊宇'), S('stu-b', '欣怡')], studentId: 'stu-a', slots: [oldSlot], learning: {} },
}));

const electron = require('electron'); const { app } = electron; const errors = []; const results = [];
let pickFiles = [];
electron.dialog.showOpenDialog = async () => ({ canceled: !pickFiles.length, filePaths: pickFiles });
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v140 schedule desktop timed out'); app.exit(1); }, 180000);

async function makeFiles() {
  const strings = ['时间', '周一', '周三', '周六', '俊宇 电磁感应', '欣怡 函数', '李明 初二数学', '子轩 晨读'];
  const si = (s) => strings.indexOf(s);
  const c = (ref, s) => `<c r="${ref}" t="s"><v>${si(s)}</v></c>`;
  const t = (ref, s) => `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`;
  const x = new JSZip();
  x.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  x.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="秋季课表" sheetId="1" r:id="rId1"/></sheets></workbook>');
  x.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  x.file('xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`);
  // 第一列从早到晚：6:00（没写上下午）排在 09:00 前面，应当认成早上
  x.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
    + `<row r="1">${c('A1', '时间')}${c('B1', '周一')}${c('C1', '周三')}${c('D1', '周六')}</row>`
    + `<row r="2">${t('A2', '6:00-7:00')}${c('D2', '子轩 晨读')}</row>`
    + `<row r="3">${t('A3', '09:00-10:00')}${c('D3', '李明 初二数学')}</row>`
    + `<row r="4">${t('A4', '10:00-11:00')}</row>`
    + `<row r="5">${t('A5', '19:00-20:30')}${c('B5', '俊宇 电磁感应')}${c('C5', '欣怡 函数')}</row>`
    + '</sheetData><mergeCells count="1"><mergeCell ref="D3:D4"/></mergeCells></worksheet>');
  const xlsx = path.join(out, '秋季课表.xlsx'); fs.writeFileSync(xlsx, await x.generateAsync({ type: 'nodebuffer' }));
  const d = new JSZip();
  d.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const tc = (s) => `<w:tc><w:tcPr><w:tcW w:w="2000"/></w:tcPr><w:p><w:r><w:t>${s}</w:t></w:r></w:p></w:tc>`;
  d.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>王老师 本学期课表</w:t></w:r></w:p>'
    + `<w:tbl><w:tr>${tc('时间')}${tc('周二')}${tc('周五')}</w:tr><w:tr>${tc('18:00-19:30')}${tc('欣怡')}${tc('')}</w:tr><w:tr>${tc('晚上8点到9点半')}${tc('')}${tc('俊宇 复习')}</w:tr></w:tbl><w:sectPr/></w:body></w:document>`);
  const docx = path.join(out, '课表.docx'); fs.writeFileSync(docx, await d.generateAsync({ type: 'nodebuffer' }));
  const txt = path.join(out, '补充课表.txt');
  // 第一行和 Excel 里的重复；浩然的课过了午夜；欣怡的 7:00 没写上下午
  fs.writeFileSync(txt, '周一 19:00-20:30 俊宇 电磁感应\n周五 23:00-01:00 浩然 冲刺\n周日 7:00-8:00 欣怡 早读\n');
  return [xlsx, docx, txt];
}

(async () => {
  const files = await makeFiles();
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1360, height: 860 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const shot = async (name, wait = 300) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };
  const T = async (code) => { const r = await call(teacher, `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`); if (r && r.__err) throw Error('page: ' + r.__err); return r; };
  const click = (sel, text) => T(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>${text ? `b.innerText.includes(${JSON.stringify(text)})` : 'true'});if(!b)throw Error('no button '+${JSON.stringify(sel + ' ' + (text || ''))});if(b.disabled)throw Error('disabled '+${JSON.stringify(text || sel)});b.click();return true`);
  const type = (sel, value) => T(`const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true`);
  const rows = () => T(`return [...document.querySelectorAll('.si-row:not(.si-head)')].map(r=>({cls:r.className,who:r.querySelector('select').selectedOptions[0].textContent,when:r.querySelector('.si-when span').textContent,half:r.querySelector('.si-half')?.textContent||'',state:r.querySelector('em').textContent,from:r.title}))`);

  // 1. 一次选三份课表
  await T(`s.set({page:'schedule'});return true`);
  await until(() => T(`return !!document.querySelector('.sch-imp')`), 8000, 'schedule page');
  await click('.sch-imp');
  await until(() => T(`return !!document.querySelector('.sch-import')`), 5000, 'import dialog');
  pickFiles = files;
  await click('.sch-import .si-src .btn-cue', '选择课表文件');
  await until(async () => (await T(`return document.querySelectorAll('.si-file').length`)) === 3, 10000, 'three files listed');
  assert.match(await T(`return document.querySelector('.sch-import .record-actions .btn-cue').innerText`), /识别 3 份课表/);
  await click('.si-file button', '查看 / 修改');
  assert.match(await T(`return document.querySelector('.si-file textarea').value`), /时间\t周一\t周三\t周六/);
  await click('.sch-import .record-actions .btn-cue', '识别 3 份课表');
  await until(async () => (await rows()).length >= 8, 10000, 'preview rows');
  let r = await rows();
  const by = (who, when) => r.find((x) => x.who.includes(who) && (!when || x.when.includes(when)));
  assert.equal(r.length, 8, JSON.stringify(r));
  const meta = await T(`return document.querySelector('.si-meta').innerText`);
  assert.match(meta, /来自 3 份课表：秋季课表\.xlsx 4 节、课表\.docx 2 节、补充课表\.txt 3 节/);
  assert.match(meta, /有 1 节课表上没写上下午/);
  assert.equal(by('子轩').when, '每周六 06:00–07:00', 'Excel 里排在 09:00 前面的 6:00 是早上');
  assert.doesNotMatch(by('子轩').cls, /guess/);
  assert.equal(by('浩然').when, '每周五 23:00–次日 01:00');
  const early = by('欣怡', '周日');
  assert.equal(early.when, '每周日 19:00–20:00'); assert.match(early.cls, /guess/); assert.equal(early.half, '改成上午');
  assert.equal(by('俊宇', '周一').from, '来自 秋季课表.xlsx');
  await shot('import-preview.png');
  await T(`[...document.querySelectorAll('.si-row')].find(r=>r.querySelector('.si-when span')?.textContent.includes('周日')).querySelector('.si-half').click();return true`);
  await until(async () => (await rows()).some((x) => x.when === '每周日 07:00–08:00'), 3000, 'flipped to morning');
  r = await rows();
  const flipped = r.find((x) => x.when.startsWith('每周日'));
  assert.equal(flipped.when, '每周日 07:00–08:00'); assert.doesNotMatch(flipped.cls, /guess/);
  assert.doesNotMatch(await T(`return document.querySelector('.si-meta').innerText`), /没写上下午/);
  assert.match(by('俊宇', '周一').state, /原来的周一课.*跳过/);
  await click('.sch-import .btn-cue', '导入 7 节课');
  await until(() => T(`return !document.querySelector('.sch-import')`), 3000, 'dialog closed');
  const banner = await T(`return document.querySelector('.material-status')?.innerText||''`);
  assert.match(banner, /已导入 7 节课（来自 3 份课表），新建学生 (李明|子轩|浩然)、(李明|子轩|浩然)、(李明|子轩|浩然)/);
  const after = await T(`const st=Q.useStore.getState();return {slots:st.slots,students:st.students.map(x=>x.name)}`);
  assert.equal(after.slots.length, 8);
  const hr = after.slots.find((x) => x.topic === '冲刺');
  assert.deepEqual([hr.day, hr.start, hr.len], [4, 23, 2]);
  mark('three timetables picked at once: read one by one, merged preview with duplicates counted once, unsure AM/PM flagged and flipped, cross-midnight lesson, one banner', { rows: r.length });

  // 2. 周课表：跨午夜的课接着画在第二天
  const grid = await T(`const c=document.querySelector('.slot.cross'),t=document.querySelector('.slot.tail');return {cross:c&&{text:c.innerText,top:c.style.top,h:c.offsetHeight},tail:t&&{text:t.innerText,left:t.style.left,top:t.style.top,h:t.offsetHeight},inner:document.querySelector('.week-inner').offsetHeight,hours:[...document.querySelectorAll('.week-hr span')].map(x=>x.textContent)}`);
  assert.ok(grid.cross && grid.tail, JSON.stringify(grid));
  assert.match(grid.cross.text, /浩然/); assert.match(grid.cross.text, /23:00–次日 01:00/);
  assert.match(grid.tail.text, /浩然（续）/); assert.match(grid.tail.text, /至 01:00/);
  assert.match(grid.tail.left, /71\.428/, '周五的尾巴画在周六（第 6 列，5/7）');
  assert.equal(grid.hours.length, 24); assert.equal(grid.hours[0], '00:00'); assert.equal(grid.hours[23], '23:00');
  await T(`document.querySelector('.week-grid').scrollTo({top:99999});return true`);
  await shot('week-late.png');
  await T(`document.querySelector('.week-grid').scrollTo({top:0});return true`);
  await shot('week-early.png');
  mark('week grid covers 00:00–24:00 and draws the after-midnight part of a lesson on the next day', { tail: grid.tail.h });

  await click('.material-status button', '撤销导入');
  const undone = await T(`const st=Q.useStore.getState();return {slots:st.slots.map(x=>x.id),students:st.students.map(x=>x.name)}`);
  assert.deepEqual(undone, { slots: ['old-1'], students: ['俊宇', '欣怡'] });

  // 3. 排课：23:00 开始两小时；第二天 00:30 撞上；01:00 可以
  const editor = async (date, start, len) => {
    await click('.btn-cue', '排课');
    await until(() => T(`return !!document.querySelector('.record-editor input[type=time]')`), 4000, 'editor');
    await type('.record-editor input[type=date]', date); await type('.record-editor input[type=time]', start); await type('.record-editor input[type=number]', len);
  };
  await editor(key(plus(2)), '23:00', '2');
  assert.match(await T(`return document.querySelector('.record-note')?.innerText||''`), /过了午夜，次日 01:00 下课/);
  await shot('editor-late.png');
  await click('.record-editor .btn-cue', '保存排课');
  await until(() => T(`return !document.querySelector('.record-editor')`), 3000, 'saved late lesson');
  await editor(key(plus(3)), '00:30', '1');
  await click('.record-editor .btn-cue', '保存排课');
  assert.match(await until(() => T(`return document.querySelector('.record-editor [role=alert]')?.innerText`), 3000, 'overlap error'), /时间重叠/);
  await type('.record-editor input[type=time]', '01:00');
  await click('.record-editor .btn-cue', '保存排课');
  await until(() => T(`return !document.querySelector('.record-editor')`), 3000, 'saved early lesson');
  const saved = await T(`return Q.useStore.getState().slots.filter(x=>x.id!=='old-1').map(x=>[x.day,x.start,x.len]).sort()`);
  assert.deepEqual(saved, [[2, 23, 2], [3, 1, 1]]);
  mark('slot editor accepts a 23:00 two-hour lesson and a 01:00 lesson, rejects 00:30 next day as overlapping', { saved });

  assert.deepEqual(errors.filter((e) => !/Autofill|DevTools|favicon/i.test(e)), []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length}/3 passed · ${out}`);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error(e); console.error('errors:', errors.slice(-8)); clearTimeout(timer); app.exit(1); });
