// 内置课件排版（macOS / 没装 Office 时用）验收：PPTX → 逐页图片 + texts.json，DOCX / RTF → PDF。
// 另外造一份带 MathType 式 OLE 公式（WMF 预览图）的 PPTX，确认公式能显示。
// 用法：npx electron test/office-convert.cjs <pptx> <docx> [rtf]   （先 npm run build）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const { app, BrowserWindow, protocol, session, net } = require('electron');
const { pathToFileURL } = require('node:url');
const JSZip = require('jszip');
const { Files } = require('../electron/files.cjs');
const { OfficeConverter } = require('../electron/office.cjs');
const { within } = require('../electron/core.cjs');

const out = path.join(__dirname, '../.out/A', 'office-' + Date.now()); fs.mkdirSync(out, { recursive: true });
const inputs = process.argv.slice(2).filter((a) => !a.startsWith('-') && fs.existsSync(a) && !a.endsWith('.cjs'));
const pptxs = inputs.filter((a) => /\.pptx$/i.test(a)), pptx = pptxs[0], docx = inputs.find((a) => /\.docx$/i.test(a)), rtf = inputs.find((a) => /\.rtf$/i.test(a));
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }, { scheme: 'lesson', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('office test timed out'); app.exit(1); }, 600000);

/** 在第一页加一个 OLE 公式对象：AlternateContent + graphicFrame/oleObj，Fallback 里是 WMF 预览图 */
async function withOle(src, wmf, file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(src));
  zip.file('ppt/media/csole1.wmf', wmf);
  const relName = 'ppt/slides/_rels/slide1.xml.rels';
  zip.file(relName, (await zip.file(relName).async('text')).replace('</Relationships>', '<Relationship Id="rIdCsOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/csole1.wmf"/></Relationships>'));
  const xfrm = '<a:off x="600000" y="5200000"/><a:ext cx="3200000" cy="900000"/>';
  const pic = `<p:pic><p:nvPicPr><p:cNvPr id="9901" name="公式"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdCsOle"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm>${xfrm}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const frame = (inner) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9900" name="对象"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm>${xfrm}</p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="Equation" progId="Equation.DSMT4">${inner}</p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
  const block = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:v="urn:schemas-microsoft-com:vml" Requires="v">${frame('<p:embed/>')}</mc:Choice><mc:Fallback>${frame('<p:embed/>' + pic)}</mc:Fallback></mc:AlternateContent>`;
  const slide = 'ppt/slides/slide1.xml';
  zip.file(slide, (await zip.file(slide).async('text')).replace('</p:spTree>', block + '</p:spTree>'));
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

app.whenReady().then(async () => {
  const files = new Files(path.join(out, 'cache'));
  const ses = session.fromPartition('office-test');
  const dist = path.join(__dirname, '../dist');
  ses.protocol.handle('studio', async (req) => { const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, ''); const f = path.resolve(dist, rel); if (!within(dist, f)) return new Response('no', { status: 403 }); return net.fetch(pathToFileURL(f).href); });
  ses.protocol.handle('lesson', async (req) => { try { return net.fetch(pathToFileURL(files.resolve(req.url)).href); } catch { return new Response('gone', { status: 404 }); } });
  const errors = [];
  const makeWindow = () => { const w = new BrowserWindow({ show: false, width: 1600, height: 900, useContentSize: true, frame: false, webPreferences: { offscreen: true, session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } }); w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); }); return w; };
  const office = new OfficeConverter({ makeWindow, url: (p) => files.url(p), log: { warn: (...a) => console.log('warn', ...a) } });
  const report = {};
  const conv = async (label, input) => {
    const ext = path.extname(input).toLowerCase(), folder = path.join(out, label);
    fs.mkdirSync(folder, { recursive: true });
    files.authorize(input);
    const t = Date.now();
    const steps = [];
    const r = await office.convert({ input, ext, folder, progress: (p) => steps.push(p.stage) });
    report[label] = { ms: Date.now() - t, engine: r.engine, render: r.render, pages: r.images?.length, pdf: r.pdf && fs.statSync(r.pdf).size };
    console.log(label, JSON.stringify(report[label]));
    return r;
  };
  // 第一份 PPTX 应该有文字（识别答案页靠它）；后面的可以是整页图片的
  for (const [i, file] of pptxs.entries()) {
    const label = 'pptx' + (i || '');
    const r = await conv(label, file);
    assert.equal(r.render, 'images'); assert.ok(r.images.length > 0);
    const sizes = r.images.map((im) => fs.statSync(im.path).size);
    assert.ok(sizes.every((s) => s > 2000), '有空白页');
    assert.ok(new Set(sizes).size > 1 || sizes.length === 1, '每页截图都一样');
    const texts = JSON.parse(fs.readFileSync(path.join(out, label, 'slides', 'texts.json'), 'utf8'));
    assert.equal(texts.length, r.images.length);
    if (i === 0) assert.ok(texts.some((p) => p.length), '幻灯片文字为空');
    console.log(label, 'texts[0]', JSON.stringify(texts[0]).slice(0, 300));
  }
  if (pptx && docx) {
    const dz = await JSZip.loadAsync(fs.readFileSync(docx));
    const wmfName = Object.keys(dz.files).find((n) => /\.wmf$/i.test(n));
    if (wmfName) {
      const ole = path.join(out, 'ole-test.pptx');
      await withOle(pptx, await dz.file(wmfName).async('nodebuffer'), ole);
      const r = await conv('ole', ole);
      assert.equal(r.render, 'images');
    }
  }
  if (docx) { const r = await conv('docx', docx); assert.equal(r.render, 'pdf'); assert.ok(fs.statSync(r.pdf).size > 5000); }
  if (rtf) { const r = await conv('rtf', rtf); assert.equal(r.render, 'pdf'); }
  // 走 Files.convert：Windows 上 Office 自动化失败时自动换内置排版；第二次命中缓存；slideTexts 能读到内置排版写的文字
  if (pptx) {
    files.office = office;
    files.windowsOffice = async () => { throw new Error('模拟：没装 Office'); };
    files.authorize(pptx);
    const r1 = await files.convert(pptx, () => {});
    assert.equal(r1.render, 'images'); assert.equal(r1.engine, '内置排版'); assert.ok(r1.images.every((x) => !x.path.includes('\\')));
    const r2 = await files.convert(pptx, () => {});
    assert.equal(r2.cached, true); assert.equal(r2.images.length, r1.images.length);
    const texts = await files.slideTexts(pptx);
    assert.ok(texts && texts.length === r1.images.length && texts[0].lines.length, 'slideTexts 没读到内置排版的文字');
    report.files = { pages: r1.images.length, cached: r2.cached, firstLines: texts[0].lines.length };
    console.log('files.convert OK', JSON.stringify(report.files));
  }
  report.consoleErrors = errors.slice(0, 20);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('OFFICE OK', out, 'console errors:', errors.length);
  clearTimeout(timer); app.exit(0);
}).catch((e) => { console.error('OFFICE FAIL', e); app.exit(1); });
