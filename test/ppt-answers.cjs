// 真实 PPT 答案页验收：整页是图片的幻灯片 → 本机 OCR → 识别「答案：」→ 学生端只遮答案部分。
// 需要本机装有 PowerPoint / WPS。用法：npx electron test/quiet.cjs test/ppt-answers.cjs [pptx 路径]
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(__dirname, '../.out/A', 'ppt-answers-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const ppt = process.argv.find((a) => /\.pptx?$/i.test(a)) || process.env.CS_PPT;
if (!ppt) { console.error('用法：npx electron test/quiet.cjs test/ppt-answers.cjs <含图片答案页的 pptx>（或设 CS_PPT）'); process.exit(2); }
const { app } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw Error('Timed out ' + what); };
const timer = setTimeout(() => { console.error('ppt answers timed out'); app.exit(1); }, 420000);

(async () => {
  assert.ok(fs.existsSync(ppt), 'missing ' + ppt);
  const api = await until(() => globalThis.classroomStudioTest, 30000, 'api'), teacher = api.windows.get('teacher'), student = api.windows.get('student');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'), 30000, 'teacher'); await until(() => call(student, '!!window.__studioQA'), 30000, 'student');
  if (process.env.CS_SHOW === '1') { student.setBounds({ x: 200, y: 120, width: 1100, height: 680 }); student.show(); teacher.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); teacher.show(); }
  const T = (code) => call(teacher, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);
  const S = (code) => call(student, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);
  api.files.authorize(ppt);
  const t0 = Date.now();
  await T(`await __studioQA.openMaterial(__studioQA.fileEntry(${JSON.stringify(ppt)}),'student');return true`);
  const shown = Date.now() - t0;
  const r = await until(() => T(`return s.pgmMat.answerPages&&{pages:s.pgmMat.answerPages,from:s.pgmMat.answerFrom,auto:s.pgmMat.answerAuto,total:s.pgmMat.total}`), 300000, 'detect');
  console.log('opened in', shown, 'ms; detected after', Date.now() - t0, 'ms', JSON.stringify(r));
  assert.ok(r.pages.length >= 3, 'expected several answer slides');
  const page = r.pages.find((p) => r.from?.[p] > 0);
  assert.ok(page !== undefined, 'expected an answer slide covered only below the answer line');
  await T(`s.setShared({pgm:{...s.pgm,page:${page}}});return true`);
  await until(() => S(`return !!document.querySelector('.sw-stage .answer-cover.partial')`), 10000, 'student partial cover');
  await sleep(1200); fs.writeFileSync(path.join(out, 'student-ppt-answer.png'), (await student.webContents.capturePage()).toPNG());
  const before = r.pages[0] - 1;
  if (before >= 0 && !r.pages.includes(before)) {
    await T(`s.setShared({pgm:{...s.pgm,page:${before}}});return true`);
    await until(() => S(`return !document.querySelector('.sw-stage .answer-cover')`), 10000, 'question slide visible');
  }
  // 第二次打开走缓存，应当很快
  await T(`s.setShared({pgmMat:{...s.pgmMat,answerPages:undefined}});return true`);
  const t1 = Date.now();
  await until(() => T(`return s.pgmMat.answerPages?.length>0`), 20000, 'cached detect');
  console.log('cached detect', Date.now() - t1, 'ms');
  console.log('PASS real PPT (image slides) answer detection via OCR; partial cover on student; question slides untouched');
  console.log('RESULT ' + out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('FAIL', e); app.exit(1); });
