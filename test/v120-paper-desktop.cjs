// 1.2.0 组卷排版桌面验收（屏幕外窗口），复现老师反馈的卷子：
//   1. 题库网站样式的 PDF（页脚「试卷第1页（共1页）」、浅灰水印、答案页标题「《卷名》参考答案」）导入：最后一题不带页脚和答案页；
//   2. 连着【答案】【详解】的题目截图：裁掉答案部分，答案单独取出；
//   3. 组卷导出 Word + PDF：导入题只印原卷截图、题号和图同一行不拆页；粘贴截图题只印文字；同分大题不逐题标分。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v120-paper-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v120p-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
const stu = { id: 'stu-x', name: '徐梓涵', grade: '高一', hue: 200, textbook: '人教A版 2019', tags: [], lessons: 0, lastTopic: '', lastAt: '', subject: 'math' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open' },
  allowedRoots: [out],
  local: { roots: [], students: [stu], studentId: 'stu-x', slots: [], learning: {} },
}));

const electron = require('electron'); const { app, BrowserWindow, nativeImage } = electron; const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v120 paper desktop timed out'); app.exit(1); }, 300000);
const PDFTOPPM = ['pdftoppm', 'D:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\pdftoppm.exe'];
/** PDF 每页转成 PNG（人工看版式），返回页数；没有 pdftoppm 返回 0 */
const pdfPng = (pdf, name) => {
  for (const bin of PDFTOPPM) { try { execFileSync(bin, ['-png', '-r', '60', pdf, path.join(out, name)], { stdio: 'ignore' }); return fs.readdirSync(out).filter((f) => f.startsWith(name + '-') && f.endsWith('.png')).length; } catch { /* 换一个 */ } }
  return 0;
};
const docXml = (f) => {
  const buf = fs.readFileSync(f);
  for (let p = 0; p < buf.length - 30 && buf.readUInt32LE(p) === 0x04034b50;) {
    const size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28), name = buf.toString('utf8', p + 30, p + 30 + nl), start = p + 30 + nl + xl;
    if (name === 'word/document.xml') return require('node:zlib').inflateRawSync(buf.subarray(start, start + size)).toString('utf8');
    p = start + size;
  }
  return '';
};

// 仿题库网站导出的作业卷：第 1 页题目（中间夹着浅灰水印，底部页脚），第 2 页答案
const PAPER = `<!doctype html><meta charset="utf-8"><style>
@page { size: A4; margin: 0 } body { margin: 0; font: 15px/1.9 "SimSun", "Times New Roman", serif; color: #000 }
.pg { position: relative; width: 210mm; height: 296mm; padding: 22mm 20mm; box-sizing: border-box; page-break-after: always; overflow: hidden }
h1 { font-size: 20px; text-align: center; margin: 0 0 14px } h2 { font-size: 16px; margin: 14px 0 6px }
.o { display: flex; justify-content: space-between; padding: 0 2em 0 1.5em } .q { margin: 6px 0 }
.wm { position: absolute; left: 0; right: 0; top: 47%; text-align: center; font-size: 44px; color: #c8c8c8; opacity: .6; letter-spacing: 8px }
.ft { position: absolute; left: 0; right: 0; bottom: 12mm; text-align: center; font-size: 12px }
table { border-collapse: collapse; margin: 6px 0 } td { border: 1px solid #000; padding: 0 14px }
</style>
<div class="pg"><h1>徐梓涵10.18作业-向量和圆</h1>
<h2>一、选择题</h2>
<p class="q">1．已知向量 a⃗＝(4，2)，b⃗＝(x，1)，且 a⃗∥b⃗，则 a⃗·b⃗＝（　　）</p><div class="o"><span>A．10</span><span>B．8</span><span>C．6</span><span>D．4</span></div>
<h2>二、填空题</h2>
<p class="q">2．已知平面向量 a⃗，b⃗，c⃗，对任意实数 x，y 都有 |a⃗－xb⃗|≥|a⃗－b⃗|，|a⃗－yc⃗|≥|a⃗－c⃗| 成立．若 |a⃗|＝2，则 b⃗·(c⃗－a⃗) 的最大值为________．</p>
<div class="wm">学科网 zxxk.com</div>
<div style="height:150px"></div>
<h2>三、解答题</h2>
<p class="q">3．如图，圆 O 的半径为 2，AB 是直径，点 P 在圆上运动，求 PA⃗·PB⃗ 的值．</p>
<svg width="200" height="150" style="margin-left:3em"><circle cx="100" cy="75" r="60" fill="none" stroke="#000"/><line x1="40" y1="75" x2="160" y2="75" stroke="#000"/><line x1="40" y1="75" x2="130" y2="23" stroke="#000"/><line x1="160" y1="75" x2="130" y2="23" stroke="#000"/><text x="24" y="80" font-size="14">A</text><text x="164" y="80" font-size="14">B</text><text x="132" y="18" font-size="14">P</text><text x="96" y="92" font-size="14">O</text></svg>
<div class="ft">试卷第1页（共1页）</div></div>
<div class="pg"><h1 style="font-size:16px">《徐梓涵10.18作业-向量和圆》参考答案</h1>
<table><tr><td>题号</td><td>1</td></tr><tr><td>答案</td><td>A</td></tr></table>
<p>1．A</p><p>2．2＋2√3</p><p>3．0</p><p>【详解】PA⃗·PB⃗＝(PO⃗＋OA⃗)·(PO⃗－OA⃗)＝|PO⃗|²－|OA⃗|²＝0．</p>
<div class="ft">答案第1页（共1页）</div></div>`;

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error('teacher: ' + r.__err); return r; };

  // ── 1. 仿真卷子 PDF → 导入 ──
  const pw = new BrowserWindow({ show: false, width: 900, height: 1200 });
  await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAPER));
  await sleep(300);
  const pdfFile = path.join(out, '徐梓涵10.18作业-向量和圆.pdf');
  fs.writeFileSync(pdfFile, await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } }));
  pw.destroy();
  pdfPng(pdfFile, 'source');
  const r = await T(`const r=await Q.qimport.importFiles(${JSON.stringify([pdfFile])},'math');return {added:r.added.map(q=>({id:q.id,stem:q.stem,answer:q.answer,analysis:q.analysis,qtype:q.qtype,image:q.image,imagePt:q.imagePt})),files:r.files}`);
  assert.equal(r.files[0].error, undefined, JSON.stringify(r.files));
  assert.equal(r.added.length, 3, JSON.stringify(r.added.map((q) => q.stem)));
  const ans = r.added.map((q) => q.answer);
  assert.ok(ans[0] === 'A' && /2\s*[+＋]\s*2\s*√\s*3/.test(ans[1]) && ans[2] === '0', JSON.stringify(ans).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
  assert.ok(!/参考答案|试卷第|zxxk|学科网/.test(r.added.map((q) => q.stem).join('')), JSON.stringify(r.added.map((q) => q.stem)));
  const sizes = r.added.map((q, i) => { fs.copyFileSync(q.image, path.join(out, `import-q${i + 1}.png`)); return nativeImage.createFromPath(q.image).getSize(); });
  // 页面渲染宽 1400px、高约 1980px：最后一题（含配图）也不该超过半页，更不会带上答案页
  assert.ok(sizes.every((s) => s.height < 990), JSON.stringify(sizes));
  mark('exam-site PDF: footer, watermark and the titled answer page stay out of questions; answers matched', { sizes, answers: r.added.map((q) => q.answer) });

  // ── 2. 连着【答案】【详解】的截图 ──
  const shot = await T(`const c=document.createElement('canvas');c.width=1100;c.height=420;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1100,420);g.fillStyle='#111';g.font='30px "Microsoft YaHei"';
    g.fillText('1．已知向量 a=(4,2)，b=(x,1)，且 a∥b，则 a·b=（  ）',30,60);g.fillText('A．10        B．8        C．6        D．4',60,120);
    g.fillStyle='#1f5fbf';g.fillText('【答案】A',30,220);g.fillText('【详解】向量 a=(4,2)，b=(x,1)，且 a∥b，则 4×1−2x=0，得 x=2，',30,290);g.fillText('所以 a·b=4×2+2×1=10．',90,350);
    const url=c.toDataURL('image/png');const t=await Q.qimport.trimShot(url);const im=new Image();im.src=t.png;await im.decode();
    const file=await Q.host.call('study.image',url);
    return {answer:t.answer,analysis:t.analysis,text:t.text,h:im.naturalHeight,png:await Q.host.call('study.image',t.png),file}`);
  fs.copyFileSync(shot.png, path.join(out, 'shot-trimmed.png'));
  const ocr = !!shot.text;
  if (ocr) {
    assert.equal(shot.answer, 'A', JSON.stringify(shot));
    assert.ok(shot.analysis.includes('x=2') || shot.analysis.includes('x＝2') || shot.analysis.length > 10, shot.analysis);
    assert.ok(shot.h < 200, '裁到【答案】上面：' + shot.h);
  }
  mark('pasted screenshot: answer / analysis part cut off and kept separately', { ocr, h: shot.h, answer: shot.answer });

  // ── 3. 组卷导出 ──
  const paper = await T(`const L=Q.paperLogic;const st=Q.useStudy.getState();
    const paste={id:'paste-1',stem:'已知向量 $\\\\vec a=(4,2)$，$\\\\vec b=(x,1)$，且 $\\\\vec a\\\\parallel\\\\vec b$，则 $\\\\vec a\\\\cdot\\\\vec b=$（　）\\nA. 10\\nB. 8\\nC. 6\\nD. 4',image:${JSON.stringify(shot.file)},answer:'A',analysis:'',points:[],difficulty:2,qtype:'选择',origin:'paste',status:'bank',createdAt:new Date().toISOString(),subject:'math'};
    st.update(d=>({...d,questions:[...d.questions.map(q=>({...q,status:'bank'})),paste]}));
    const qs=Q.useStudy.getState().data.questions;let p={...L.emptyPaper('math'),title:'1 · 数学练习卷'};
    for(const q of [...qs.filter(q=>q.origin==='import'),paste]) p=L.addToPaper(p,qs.find(x=>x.id===q.id),['选择','填空','解答']);
    const md=L.paperMarkdown(p,qs,'student'),ans=L.paperMarkdown(p,qs,'answer');
    const a=await Q.host.call('study.document',{kind:'paper',title:'1 · 数学练习卷',markdown:md,formats:['docx','pdf']});
    const b=await Q.host.call('study.document',{kind:'paper',title:'1 · 数学练习卷-答案',markdown:ans,formats:['pdf']});
    return {md,files:[...a.out,...b.out],errors:[...a.errors,...b.errors]}`);
  assert.deepEqual(paper.errors, []);
  fs.writeFileSync(path.join(out, 'paper-student.md'), paper.md);
  assert.ok(paper.md.includes('（共 2 题，每题 4 分，共 8 分）') && paper.md.includes('**1.**\n\n![题图'), paper.md);
  assert.equal((paper.md.match(/!\[题图/g) || []).length, 3, '粘贴截图题只印文字：' + paper.md);
  assert.ok(paper.md.includes('**2.** 已知向量'), paper.md);
  for (const f of paper.files) {
    const dst = path.join(out, (f.includes('答案') ? 'paper-answer' : 'paper-student') + path.extname(f));
    fs.copyFileSync(f, dst);
  }
  const xml = docXml(path.join(out, 'paper-student.docx'));
  assert.equal((xml.match(/<w:cantSplit\/>/g) || []).length, 3, '三道原卷截图题都是题号 + 图同一行、不拆页');
  const pages = pdfPng(path.join(out, 'paper-student.pdf'), 'paper-student');
  pdfPng(path.join(out, 'paper-answer.pdf'), 'paper-answer');
  if (pages) assert.ok(pages <= 2, 'pages ' + pages);
  mark('paper export: imported questions print only the original crop next to the number, pasted ones only text, same-score sections not repeated', { pages, files: fs.readdirSync(out).filter((f) => /^paper-/.test(f)) });

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch(async (e) => {
  try { const t = globalThis.classroomStudioTest?.windows.get('teacher'); if (t) fs.writeFileSync(path.join(out, 'failure.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1);
});
