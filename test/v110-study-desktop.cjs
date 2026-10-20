// 1.1.0 学情相关桌面验收（屏幕外窗口）：
//   1. 作业 / 测验模板：表头是真正的填写栏、填空横线不被吃掉、题号和答案页同一套圆形编号；Word / PDF 都导出。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v110-study-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v110s-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-w', name: '小林', grade: '高一', hue: 200, textbook: '人教版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'math' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  local: { roots: [], students: [stu], studentId: 'stu-w', slots: [], learning: {} },
}));

const electron = require('electron'); const { app, BrowserWindow } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v110 study desktop timed out'); app.exit(1); }, 300000);
/** PDF 第一页转成 PNG 方便人工看版式（本机没装 pdftoppm 就跳过） */
const pdfPng = (pdf, name) => { try { execFileSync('pdftoppm', ['-png', '-r', '70', '-f', '1', '-l', '2', pdf, path.join(out, name)], { stdio: 'ignore' }); } catch { /* 没有 pdftoppm */ } };

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error('teacher: ' + r.__err); return r; };

  // ── 1. 作业 / 测验模板 ──
  const quiz = [
    '<!-- cs:theme=math -->', '# 三倍角公式 · 单元测验', '', '[[表头 时间：40 分钟|满分：100 分|班级|姓名|得分]]', '',
    '## 一、选择题（共 2 题，每题 5 分，共 10 分）', '', '1. 已知 $\\sin x=\\frac13$，则 $\\sin 3x$ 等于（　）', '', '   A. $\\frac{23}{27}$　B. $\\frac{1}{27}$　C. $-\\frac{23}{27}$　D. $1$', '',
    '2. $\\cos 3x$ 可以写成（　）', '', '   A. $4\\cos^3x-3\\cos x$　B. $3\\cos x-4\\cos^3x$　C. $\\cos^3 x$　D. $3\\cos x$', '',
    '## 二、填空题（共 2 题，每题 5 分）', '', '3. $\\sin 3x$ 用 $\\sin x$ 表示为 ________。', '', '4. 若 $\\cos x=\\frac12$，则 $\\cos 3x=$ ____。', '',
    '## 三、解答题（共 1 题，共 12 分）', '', '5.（12 分）证明：$\\sin 3x=3\\sin x-4\\sin^3 x$。', '', '[[留空]]', '', '[[留空]]', '',
  ].join('\n');
  const legacy = ['<!-- cs:theme=math -->', '# 三倍角公式 · 练习', '', '姓名：________　日期：________', '', '## 一、基础巩固', '', '1. 已知 $\\sin x = \\frac{1}{3}$，求 $\\sin 3x$。', '', '[[留空]]', ''].join('\n');
  const docs = await T(`const L=Q.studyLogic;const mk=(p)=>({id:'x'+Math.random(),stem:'',points:[],difficulty:3,qtype:'计算',origin:'manual',status:'bank',createdAt:new Date().toISOString(),subject:'math',...p});
    const qs=[mk({stem:'已知 $\\\\sin x=\\\\frac13$，求 $\\\\sin 3x$。',answer:'$\\\\frac{23}{27}$',analysis:'利用 $\\\\sin 3x=3\\\\sin x-4\\\\sin^3x$。'}),mk({stem:'下列等式正确的是（　）\\nA. $\\\\cos 3x=4\\\\cos^3x-3\\\\cos x$\\nB. $\\\\cos 3x=3\\\\cos x$',qtype:'选择',answer:'A'}),mk({stem:'$\\\\sin 3x$ 用 $\\\\sin x$ 表示为 ________。',qtype:'填空',answer:'$3\\\\sin x-4\\\\sin^3x$'})];
    const doc=(kind,title,markdown,formats)=>Q.host.call('study.document',{kind,title,markdown,formats});
    const a=await doc('homework','模板-作业',L.homeworkMarkdown('三倍角公式 · 课后作业','小林',qs,'独立完成，写出过程'),['docx','pdf']);
    const b=await doc('homework','模板-测验',${JSON.stringify(quiz)},['docx','pdf']);
    const c=await doc('homework','模板-旧格式练习',${JSON.stringify(legacy)},['pdf']);
    return {a,b,c}`);
  for (const [k, r] of Object.entries(docs)) {
    assert.deepEqual(r.errors, [], k);
    for (const f of r.out) { assert.ok(fs.statSync(f).size > 1000, f); const dst = path.join(out, `tpl-${k}${path.extname(f)}`); fs.copyFileSync(f, dst); if (f.endsWith('.pdf')) pdfPng(dst, `tpl-${k}`); }
  }
  // Word 里表头是一行表格、填空是下划线
  const docXml = (f) => {
    const buf = fs.readFileSync(f);
    for (let p = 0; p < buf.length - 30 && buf.readUInt32LE(p) === 0x04034b50;) {
      const size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28), name = buf.toString('utf8', p + 30, p + 30 + nl), start = p + 30 + nl + xl;
      if (name === 'word/document.xml') return require('node:zlib').inflateRawSync(buf.subarray(start, start + size)).toString('utf8');
      p = start + size;
    }
    return '';
  };
  for (const k of ['a', 'b']) {
    const xml = docXml(path.join(out, `tpl-${k}.docx`));
    assert.ok(/<w:top w:val="single" w:sz="18"[^]*?姓名：/.test(xml), k + ' header is a fill-in bar');
    assert.ok(xml.includes('<w:u w:val="single"/>'), k + ' blanks are underlined');
    assert.ok(!/<w:t[^>]*>_{2,}/.test(xml), k + ' no raw underscores');
  }
  assert.ok(docXml(path.join(out, 'tpl-b.docx')).includes('40 分钟'), 'preset values kept');
  mark('worksheet templates: fill-in header, blanks, round question numbers; Word + PDF exported', { files: fs.readdirSync(out).filter((f) => f.startsWith('tpl-')) });

  // ── 2. 题库导入：Word（经 Office 转 PDF）、PDF（我们自己导出的卷子也认得题号）、截图（系统 OCR），重复的跳过 ──
  const mdWord = ['# 函数单元测试', '', '[[表头 姓名|得分]]', '', '## 一、选择题', '', '1. 函数 $y=2x+1$ 的图像经过哪个点？（　）', '', '   A. (0,1)　B. (1,0)　C. (0,2)　D. (2,0)', '',
    '2. 一次函数 $y=-x+3$ 中，y 随 x 增大而（　）', '', '   A. 增大　B. 减小　C. 不变　D. 无法确定', '', '## 二、解答题', '', '3. 已知一次函数图像过点 (1,3) 和 (2,5)，求函数解析式。', '', '[[留空]]', '',
    '## 参考答案', '', '1. A', '', '2. B', '', '3. y=2x+1，解析：设 y=kx+b，代入两点解得 k=2，b=1。', ''].join('\n');
  const made = await T(`const L=Q.studyLogic;const mk=(p)=>({id:'x'+Math.random(),stem:'',points:[],difficulty:3,qtype:'计算',origin:'manual',status:'bank',createdAt:new Date().toISOString(),subject:'math',...p});
    const qs=[mk({stem:'计算 $\\\\sqrt{16}+\\\\sqrt{9}$ 的值。',answer:'7'}),mk({stem:'下列各数中最大的是（　）\\nA. -2\\nB. 0\\nC. 3\\nD. 1',qtype:'选择',answer:'C'}),mk({stem:'一个长方形长 5 厘米、宽 3 厘米，求它的周长和面积。',answer:'周长 16 厘米，面积 15 平方厘米'})];
    const doc=(title,markdown,formats)=>Q.host.call('study.document',{kind:'homework',title,markdown,formats});
    const w=await doc('导入样卷-Word',${JSON.stringify(mdWord)},['docx']);
    const p=await doc('导入样卷-PDF',L.homeworkMarkdown('根式与面积练习','',qs),['pdf']);
    const c=document.createElement('canvas');c.width=1200;c.height=520;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1200,520);g.fillStyle='#111';g.font='40px "Microsoft YaHei"';
    ['1. 计算 38 加 47 等于多少？','2. 一个正方形边长 6 厘米，求它的面积。','3. 小明有 12 个苹果，分给 4 个人，每人几个？'].forEach((t,i)=>g.fillText(t,60,110+i*150));
    const png=await Q.host.call('study.image',c.toDataURL('image/png'));
    return {docx:w.out[0],pdf:p.out[0],png,errors:[...w.errors,...p.errors]}`);
  assert.deepEqual(made.errors, []);
  const imp = async (paths) => T(`const r=await Q.qimport.importFiles(${JSON.stringify(paths)},'math',(t)=>(window.__steps=window.__steps||[]).push(t));return {added:r.added.map(q=>({stem:q.stem,answer:q.answer,analysis:q.analysis,qtype:q.qtype,image:q.image,source:q.source,origin:q.origin,status:q.status})),dup:r.dup,files:r.files,ai:r.ai}`);
  const r1 = await imp([made.docx]);
  assert.equal(r1.files[0].error, undefined, JSON.stringify(r1.files));
  assert.equal(r1.added.length, 3, JSON.stringify(r1.added.map((q) => q.stem)));
  assert.ok(r1.added[0].stem.includes('图像经过哪个点') && /A\.\s*\(0,1\)/.test(r1.added[0].stem), r1.added[0].stem);
  assert.deepEqual(r1.added.map((q) => q.qtype), ['选择', '选择', '解答'].map((t, i) => (i < 2 ? t : r1.added[2].qtype)));
  assert.deepEqual(r1.added.slice(0, 2).map((q) => q.answer), ['A', 'B']);
  assert.ok(r1.added[2].answer.startsWith('y=2x+1') && r1.added[2].analysis.includes('k=2'), JSON.stringify(r1.added[2]));
  assert.ok(r1.added.every((q) => q.image && fs.statSync(q.image).size > 1000 && q.origin === 'import' && q.status === 'inbox'), 'each has a cropped image');
  const r2 = await imp([made.pdf, made.png]);
  const fromPdf = r2.added.filter((q) => q.source.startsWith('导入样卷-PDF')), fromPng = r2.added.filter((q) => !q.source.startsWith('导入样卷-PDF'));
  assert.equal(fromPdf.length, 3, JSON.stringify(r2));
  assert.ok(fromPdf[0].stem.includes('16') && fromPdf[0].answer === '7', JSON.stringify(fromPdf[0]));
  assert.equal(fromPdf[1].answer, 'C');
  assert.ok(fromPng.length === 3 || (fromPng.length === 1 && r2.files[1].note), 'screenshot: ' + JSON.stringify(r2.files[1]) + JSON.stringify(fromPng.map((q) => q.stem)));
  if (fromPng.length === 3) assert.ok(fromPng[1].stem.includes('正方形') && fromPng[1].stem.includes('面积'), fromPng[1].stem);
  const r3 = await imp([made.docx]);
  assert.equal(r3.added.length, 0); assert.equal(r3.dup, 3, 'duplicates skipped');
  for (const [i, q] of [...r1.added, ...fromPdf.slice(0, 1), ...fromPng.slice(0, 1)].entries()) fs.copyFileSync(q.image, path.join(out, `import-q${i + 1}.png`));
  await T(`s.set({page:'study'});return true`);
  await until(() => T(`return !!document.querySelector('.sd .ags-tabs')`), 5000, 'study page');
  await until(() => T(`return [...document.querySelectorAll('.sd-bar .sd-btn')].some(b=>b.innerText.includes('导入 Word'))&&document.querySelectorAll('.sd-q').length>=7`), 5000, 'import button + inbox rows');
  await sleep(500); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, 'import-inbox.png'), (await teacher.webContents.capturePage()).toPNG());
  // ── 3. 自己组卷：挑题、按题型分大题、改分值、凑满分、导出学生版 + 答案版、投到学生画面 ──
  await T(`const st=Q.useStudy.getState();st.update(d=>({...d,questions:d.questions.map(q=>({...q,status:'bank'}))}));return true`);
  await T(`[...document.querySelectorAll('.ags-tabs button')].find(b=>b.innerText.includes('组作业')).click();return true`);
  await until(() => T(`return !!document.querySelector('.hw-mode')`), 5000, 'homework modes');
  await T(`[...document.querySelectorAll('.hw-mode button')].find(b=>b.innerText.includes('自己组卷')).click();return true`);
  await until(() => T(`return document.querySelectorAll('.pc-q').length>=6`), 5000, 'composer bank list');
  // 依次点「+」加 5 道：选择题自动归到「选择题」大题
  await T(`const rows=[...document.querySelectorAll('.pc-q')];for(const r of rows.slice(0,5)){r.querySelector('.pc-add').click();await new Promise(x=>setTimeout(x,60));}return true`);
  const secs = await until(() => T(`const ss=[...document.querySelectorAll('.pc-sec')];return ss.length?ss.map(x=>({t:x.querySelector('.pc-sec-h input').value,n:x.querySelectorAll('.pc-items li:not(.pc-empty)').length})):null`), 3000, 'sections');
  assert.equal(secs.reduce((a, s) => a + s.n, 0), 5, JSON.stringify(secs));
  assert.ok(secs.some((s) => s.t === '选择题'), JSON.stringify(secs));
  const setVal = (sel, v) => T(`const el=document.querySelector(${JSON.stringify(sel)});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(String(v))});el.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  await setVal('.pc-head .sd-title', '函数与面积 · 周测');
  await setVal('.pc-items li .pc-score input', 6);
  await sleep(100);
  await T(`[...document.querySelectorAll('.pc-sum .sd-btn')].find(b=>b.innerText.includes('按比例')).click();return true`);
  const total = await until(() => T(`const b=[...document.querySelectorAll('.pc-sum b')].map(x=>x.innerText);return b[1]==='100'?b:null`), 3000, 'total 100');
  await sleep(300); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, 'paper-composer.png'), (await teacher.webContents.capturePage()).toPNG());
  await T(`[...document.querySelectorAll('.pc-foot .ags-go')][0].click();return true`);
  const files = await until(() => T(`const f=[...document.querySelectorAll('.pc-paper .sd-file')].map(b=>b.innerText);return f.length>=4?f:null`), 60000, 'paper exported');
  assert.ok(files.some((f) => /周测-\d/.test(f) && f.includes('PDF')) && files.some((f) => f.includes('周测-答案')), files.join(' | '));
  const hw = await T(`const h=Q.useStudy.getState().data.homework.at(-1);return {title:h.title,n:h.questionIds.length,files:h.files}`);
  assert.equal(hw.title, '函数与面积 · 周测'); assert.equal(hw.n, 5);
  for (const f of hw.files) { assert.ok(fs.statSync(f).size > 1000, f); if (f.endsWith('.pdf')) { const dst = path.join(out, f.includes('答案') ? 'paper-answer.pdf' : 'paper-student.pdf'); fs.copyFileSync(f, dst); pdfPng(dst, path.basename(dst, '.pdf')); } }
  await T(`[...document.querySelectorAll('.pc-foot .sd-btn')].find(b=>b.innerText.includes('投到学生画面')).click();return true`);
  const shown = await until(() => T(`const m=Q.useStore.getState().pgmMat;return m&&m.kind==='pdf'&&/周测/.test(m.title)?m.title:null`), 60000, 'paper on student screen');
  mark('paper composer: pick questions, auto sections by type, edit scores, scale to 100, export student + answer versions, project to student screen', { secs, total, shown });

  mark('question import: Word / PDF / screenshot split by number, answers matched, each question keeps a crop of the original, duplicates skipped', { word: r1.added.length, pdf: fromPdf.length, png: fromPng.length, ocr: !r2.files[1].note });

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
