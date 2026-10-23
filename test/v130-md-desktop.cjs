// 1.3.0 Markdown 课件：真实打开 .md（图片在子文件夹、HTML 表格、公式、混进来的脚本、缺图、越出文件夹的图、GBK 编码），
// 核对排出来的 PDF 文字和学生画面上的图片；原文件不被改动。
// 用法：npx vite build --outDir .out/dist-me 后 CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v130-md-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'md-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  shared: { pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 }, pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 }, ink: {}, studentTools: 'open', boardSkin: 'ivory' },
  local: { roots: [], students: [], studentId: 'free', slots: [], learning: {} },
}));
const electron = require('electron'); const { app, nativeImage } = electron; const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => { console.error('md test timed out'); app.exit(1); }, 300000);
const results = [];
const ok = (name, cond, detail) => { assert.ok(cond, name + ' ' + (detail ?? '')); results.push(name); console.log('PASS', name, detail ?? ''); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** 纯色 PNG */
const solid = (w, h, [r, g, b]) => { const buf = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) buf.set([b, g, r, 255], i * 4); return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG(); };
const RED = [220, 30, 30], BLUE = [30, 60, 220], GREEN = [20, 200, 60], YELLOW = [240, 200, 20], PURPLE = [150, 40, 200];
const { pathToFileURL } = require('node:url');
// Typora 默认插入绝对路径的图片；放在课件文件夹外面
const ABS = path.join(out, '别处', '黄色.png'), FILEURL = path.join(out, '别处', '紫 色.png');

const root = path.join(out, '课件'), unit = path.join(root, 'UNIT 4'), md = path.join(unit, 'UNIT 4.md'), gbk = path.join(unit, '旧编码.md'), big = path.join(unit, '太大.md'), empty = path.join(unit, '空的.md');
const MD = `# 第一单元 测试讲义

正文第一段，**加粗**和*斜体*，价格写成 \\$5 不算公式。

行内公式 $x^2+y_1=z$，下标不被吃掉：$a_1 * b_2$。

$$\\frac{a+b}{2}\\geq\\sqrt{ab}$$

![红色示意图](<images/红色 块.png> "标题")

<img src="images/blue.png" width="160" onerror="document.title='HACKED'">

![缺的图](images/none.png)

![上一级文件夹](../secret.png)

![绝对路径](${ABS}) <img src="${pathToFileURL(FILEURL).href}" width="120">

![网络共享](\\\\nohost\\share\\x.png)

<script>document.body.innerHTML='HACKED'</script>
<iframe src="https://example.com"></iframe>

| 单词 | 释义 |
| --- | --- |
| apple | 苹果 |
| banana | 香蕉 |

<table><tr><th>题号</th><th>答案</th></tr><tr><td>1</td><td onclick="alert(1)">B</td></tr></table>

[点我](javascript:alert(1)) 和 [官网](https://classroom.yinziapi.top)

- [x] 已完成
- [ ] 未完成

\`\`\`
代码里的 $不是公式$ 原样保留
\`\`\`
`;

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false }), doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) { const tc = await (await doc.getPage(i)).getTextContent(); pages.push(tc.items.map((it) => it.str).join('')); }
  await task.destroy();
  return pages;
}

(async () => {
  fs.mkdirSync(path.join(unit, 'images'), { recursive: true });
  fs.writeFileSync(md, MD, 'utf8');
  fs.writeFileSync(path.join(unit, 'images', '红色 块.png'), solid(400, 200, RED));
  fs.writeFileSync(path.join(unit, 'images', 'blue.png'), solid(300, 150, BLUE));
  fs.writeFileSync(path.join(root, 'secret.png'), solid(300, 150, GREEN));
  fs.mkdirSync(path.dirname(ABS), { recursive: true });
  fs.writeFileSync(ABS, solid(200, 100, YELLOW)); fs.writeFileSync(FILEURL, solid(200, 100, PURPLE));
  // 「# 你好世界」的 GBK 字节
  fs.writeFileSync(gbk, Buffer.concat([Buffer.from('# '), Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7]), Buffer.from('\n\nabc\n')]));
  fs.writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 10, 'a'));
  fs.writeFileSync(empty, '  \n\n');
  const before = sha(md);

  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  await call(teacher, `window.csHost.call('student')`);
  const student = await until(() => api.windows.get('student'), 15000, 'student window');
  await until(() => call(student, '!!window.__studioQA'), 15000, 'student ready');
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 }); student.setBounds({ x: left, y: 960, width: 1280, height: 720 });
  for (const w of [teacher, student]) if (process.env.CS_SHOW === '1') w.show(); else w.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.message||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error(r.__err); return r; };
  const Terr = async (code) => { const r = await call(teacher, wrap(code)); return r?.__err ?? null; };
  const S = async (code) => { const r = await call(student, wrap(code)); if (r && r.__err) throw Error(r.__err); return r; };
  await T(`s.set({page:'console',aiOpen:false});return true`);
  for (const f of [md, gbk, big, empty]) api.files.authorize(f);

  ok('.md 认作文档课件', await T(`return Q.fileEntry(${JSON.stringify(md)}).kind`) === 'word');
  ok('.markdown 也认', await T(`return Q.fileEntry('C:/a/b.markdown').kind`) === 'word');

  const t0 = Date.now();
  const mat = await T(`const m=await Q.prepareMaterial(Q.fileEntry(${JSON.stringify(md)}));return {total:m.total,render:m.src.render,pdf:m.src.pdf,w:m.pages[0].w,h:m.pages[0].h}`);
  ok('排成 PDF', mat.render === 'pdf' && mat.total >= 1 && fs.existsSync(mat.pdf), `${mat.total} 页 ${Date.now() - t0}ms`);
  ok('A4 竖版', Math.abs(mat.h / mat.w - 297 / 210) < 0.02, `${mat.w}×${mat.h}`);
  fs.copyFileSync(mat.pdf, path.join(out, 'UNIT 4.pdf'));
  const text = (await pdfText(mat.pdf)).join('\n');
  fs.writeFileSync(path.join(out, 'pdf-text.txt'), text);
  const has = (s) => text.replace(/\s+/g, '').includes(s.replace(/\s+/g, ''));
  ok('标题和正文都在', has('第一单元测试讲义') && has('正文第一段') && has('加粗'));
  ok('\\$5 是美元符号不是公式', has('$5'));
  ok('公式排出来了（没有原始 TeX 命令）', !/\\frac|\\sqrt|\\geq|x\^2/.test(text) && has('≥'), text.match(/行内公式.{0,30}/)?.[0]);
  ok('Markdown 表格和 HTML 表格都在', has('apple') && has('苹果') && has('香蕉') && has('题号') && has('答案'));
  ok('缺的图显示提示', has('图片缺失：缺的图'));
  ok('脚本、框架没有执行也没有留下', !has('HACKED') && !text.includes('document.body'));
  ok('链接文字保留', has('点我') && has('官网'));
  ok('代码块里的 $ 原样', has('$不是公式$'));

  // 学生画面：红色、蓝色图片显示；越出文件夹的绿色图不显示
  await T(`await Q.openMaterial(Q.fileEntry(${JSON.stringify(md)}),'student',{fit:'page'});return true`);
  await until(() => S(`return Q.useStore.getState().pgmMat.kind==='word'&&!!document.querySelector('[data-cur-stage] .stage .page')`), 15000, 'student shows md');
  await sleep(1500);
  const r = await S(`const p=document.querySelector('[data-cur-stage] .stage .page');const b=p.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}`);
  const img = await student.webContents.capturePage();
  fs.writeFileSync(path.join(out, 'student.png'), img.toPNG());
  const k = img.getSize().width / await S(`return innerWidth`), bmp = img.toBitmap(), W = img.getSize().width;
  const count = ([R, G, B]) => { let n = 0; for (let y = Math.round(r.y * k); y < Math.round((r.y + r.h) * k); y++) for (let x = Math.round(r.x * k); x < Math.round((r.x + r.w) * k); x++) { const i = (y * W + x) * 4; if (Math.abs(bmp[i + 2] - R) < 40 && Math.abs(bmp[i + 1] - G) < 40 && Math.abs(bmp[i] - B) < 40) n++; } return n; };
  const px = { red: count(RED), blue: count(BLUE), green: count(GREEN), yellow: count(YELLOW), purple: count(PURPLE) };
  ok('子文件夹里的图片（带空格的名字、<img> 写法）都显示', px.red > 500 && px.blue > 200, JSON.stringify(px));
  ok('上一级文件夹、绝对路径、file:/// 写的图片也显示', px.green > 200 && px.yellow > 100 && px.purple > 50, JSON.stringify(px));
  ok('网络共享路径不去读，显示提示', has('[图片无法显示：网络共享]'));

  // 第二次打开用缓存
  const t1 = Date.now();
  const again = await T(`const r=await Q.host.convert(${JSON.stringify(md)},()=>{});return {cached:!!r.cached,render:r.render}`);
  ok('第二次打开读缓存', again.cached && again.render === 'pdf', `${Date.now() - t1}ms`);
  fs.writeFileSync(path.join(unit, 'images', 'blue.png'), solid(320, 160, BLUE));
  const swapped = await T(`const r=await Q.host.convert(${JSON.stringify(md)},()=>{});return {cached:!!r.cached}`);
  ok('只换了图片也重新排版', !swapped.cached);
  // 改了内容重新排
  fs.appendFileSync(md, '\n\n## 新加的一节\n');
  const changed = await T(`const r=await Q.host.convert(${JSON.stringify(md)},()=>{});return {cached:!!r.cached,pdf:r.pdf}`);
  ok('改了 Markdown 重新排版', !changed.cached && (await pdfText(changed.pdf)).join('').includes('新加的一节'));
  fs.writeFileSync(md, MD, 'utf8');

  const g = await T(`const m=await Q.prepareMaterial(Q.fileEntry(${JSON.stringify(gbk)}));return m.src.pdf`);
  ok('GBK 编码的 Markdown 不乱码', (await pdfText(g)).join('').includes('你好世界'));
  const e1 = await Terr(`await Q.prepareMaterial(Q.fileEntry(${JSON.stringify(big)}));return true`);
  ok('超过 5 MB 给出提示（不提 PowerPoint 之类）', /5 MB/.test(e1 ?? '') && !/PowerPoint/.test(e1), e1);
  const e2 = await Terr(`await Q.prepareMaterial(Q.fileEntry(${JSON.stringify(empty)}));return true`);
  ok('空文件给出提示', /空/.test(e2 ?? ''), e2);

  ok('原文件一个字节都没改', sha(md) === before);
  const bad = errors.filter((e) => !/Autofill|DevTools|net::ERR_ABORTED|5 MB|空的/.test(e));
  ok('没有界面报错', !bad.length, bad.slice(0, 3).join(' | '));
  clearTimeout(timer);
  console.log(`RESULT ${results.length}/${results.length} pass · ${out}`);
  app.exit(0);
})().catch(async (e) => {
  console.error('FAIL', e?.stack || e);
  try { const t = globalThis.classroomStudioTest?.windows.get('student'); if (t) fs.writeFileSync(path.join(out, 'failure-student.png'), (await t.webContents.capturePage()).toPNG()); } catch {}
  app.exit(1);
});
