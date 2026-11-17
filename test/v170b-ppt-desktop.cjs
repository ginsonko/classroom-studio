// 1.7.0 B 讲课 PPT 转换器：6 种版式（封面、情境图、对比、图解、例题分步、总结卡）各转一页 + 默认版式 + 自定义主题色，
// 检查：文字是 PowerPoint 里能直接改的文字框、公式是清楚的图片（说明里留着 LaTeX）、插图位、单击分步动画（导播台自己的分步读取器认得）；
// 再用内置的 PPTX 排版器（pptx-preview，不依赖 Office）把转出的 PPTX 逐页出图截图。截图在 .out/v170b-ppt/
// 用法：npx vite build --outDir .out/dist-me && CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v170b-ppt-desktop.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict'); const zlib = require('node:zlib');
const out = process.env.CS_TEST_OUT || path.join(__dirname, '../.out/v170b-ppt'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const { app } = require('electron');
require('../electron/main.cjs');
const pptSteps = require('../electron/pptSteps.cjs');
const { entries } = require('../electron/zipkit.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw Error('Timed out ' + what); };
setTimeout(() => { console.error('ppt test timed out'); app.exit(1); }, 300000);

/** 一张 480×300 的测试插图：天蓝渐变 + 一块深色「电梯」 */
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3, lift = x > w * 0.4 && x < w * 0.6 && y > h * 0.2 && y < h * 0.85;
      raw[o] = lift ? 40 : 120 + (y / h) * 100; raw[o + 1] = lift ? 70 : 170 + (y / h) * 60; raw[o + 2] = lift ? 130 : 230;
    }
  }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const MD = `<!-- cs:theme=physics -->
<!-- 主题色 #1f7a8c -->
# 超重与失重

高一物理 · 人教版必修第一册 第四章

---

<!-- 版式：情境 -->
## 电梯里的体重秤

![电梯里的体重秤](配图/电梯.png)

> 电梯启动、匀速、减速时，秤的示数一样吗？

小明 $m = 50\\ \\mathrm{kg}$，站在秤上从 1 楼到 10 楼。

---

<!-- 版式：对比 -->
## 超重和失重对比

### 超重

- 加速度向上
- 示数大于重力：$F_N > mg$

### 失重

- 加速度向下
- 示数小于重力：$F_N < mg$

---

<!-- 版式：图解 -->
<!-- 分步 -->
## 受力分析

[[插图 人站在电梯里的秤上：支持力 F_N 向上、重力 mg 向下]]

- 研究对象：人
- 受两个力：支持力和重力
- 取加速度方向为正方向

---

## 例题

> 质量 $60\\ \\mathrm{kg}$ 的人站在电梯里的秤上，电梯以 $2\\ \\mathrm{m/s^2}$ 减速下降，求秤的示数。

- 减速下降，加速度方向向上
- 由牛顿第二定律 $F_N - mg = ma$
- 示数 720 N，处于超重状态

---

## 小结

- **超重**：加速度向上，示数大于重力
- **失重**：加速度向下，示数小于重力
- **完全失重**：加速度等于 g，示数为零
- **重力不变**：变的只是示数（视重）

---

## 判断方法

1. 先找加速度方向，不看速度方向
2. 向上超重，向下失重
3. 常见误区：「向上运动就是超重」
`;

const LAYOUTS = ['cover', 'scene', 'compare', 'diagram', 'example', 'summary', 'content'];

(async () => {
  const api = await until(() => globalThis.classroomStudioTest, 30000, 'api');
  const results = [];
  const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok  ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '\n', e.stack); } };
  const dir = path.join(out, 'deck'); fs.mkdirSync(path.join(dir, '配图'), { recursive: true });
  fs.writeFileSync(path.join(dir, '配图', '电梯.png'), png(480, 300));
  const md = path.join(dir, '超重与失重-课件.md'); fs.writeFileSync(md, MD);
  let files;
  await test('转出 PPTX：7 页，每页一个版式', async () => {
    const r = await api.exportDoc(md, ['pptx']);
    assert.deepEqual(r.errors, []);
    files = new Map(entries(fs.readFileSync(md.replace(/\.md$/, '.pptx'))).map((e) => [e.name, e.data]));
    const slides = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    assert.equal(slides.length, 7);
    for (const [k, v] of files) if (k.startsWith('ppt/media/') && /-bg\.png$/.test(k)) fs.writeFileSync(path.join(out, 'bg-' + path.basename(k)), v);
  });
  const xml = (i) => files.get(`ppt/slides/slide${i}.xml`).toString('utf8');
  const texts = (i) => [...xml(i).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
  await test('文字是能直接改的文字框（标题、要点、页码都在 <a:t> 里），背景是一张图', async () => {
    assert.match(texts(1), /超重与失重/); assert.match(texts(1), /人教版必修第一册/);
    assert.match(texts(2), /电梯里的体重秤/); assert.match(texts(2), /示数一样吗/);
    assert.match(texts(3), /超重/); assert.match(texts(3), /失重/); assert.match(texts(3), /加速度向上/); assert.match(texts(3), /VS/);
    assert.match(texts(4), /研究对象：人/); assert.match(texts(4), /插图位/);
    assert.match(texts(5), /减速下降，加速度方向向上/);
    assert.match(texts(6), /完全失重/); assert.match(texts(6), /重力不变/);
    assert.match(texts(7), /先找加速度方向/);
    for (let i = 1; i <= 7; i++) { assert.match(xml(i), /<p:bg><p:bgPr><a:blipFill/); assert.match(xml(i), /<p:sp>/); if (i > 1) assert.match(texts(i), new RegExp(`${i} / 7`)); }
    // 自定义主题色 #1f7a8c 用在页码徽章上
    assert.match(xml(2), /1F7A8C/);
  });
  await test('公式是图片，说明里留着原来的 LaTeX；插图是图片；插图位是虚线框', async () => {
    assert.match(xml(2), /name="公式 \d+" descr="[^"]*\$m = 50\\ \\mathrm\{kg\}\$/);
    assert.match(xml(2), /name="图片 \d+"/);
    assert.match(xml(3), /name="公式 \d+" descr="[^"]*F_N &gt; mg/);
    assert.match(xml(4), /<a:prstDash val="dash"\/>/);
    assert.match(xml(5), /name="公式 \d+"/);
  });
  await test('单击分步：例题每一步一下、图解页写了「分步」逐条出现；导播台的 PPT 分步读取器算出同样的步数', async () => {
    const p5 = pptSteps.plan(xml(5)), p4 = pptSteps.plan(xml(4));
    assert.ok(p5 && p5.clicks === 3, '例题 ' + JSON.stringify(p5?.clicks));
    assert.ok(p4 && p4.clicks === 3, '图解 ' + JSON.stringify(p4?.clicks));
    assert.equal(pptSteps.plan(xml(3)), null, '没写分步的页不加动画');
    const a = pptSteps.analyze(fs.readFileSync(md.replace(/\.md$/, '.pptx')));
    assert.deepEqual(a.slides.map((s) => s.page), [3, 4]);
  });
  await test('内置 PPTX 排版器能打开转出的文件，逐页出图（截图）', async () => {
    const folder = path.join(out, 'preview'); fs.mkdirSync(folder, { recursive: true });
    const input = md.replace(/\.md$/, '.pptx');
    api.files.authorize?.(input);
    const r = await api.files.office.convert({ input, ext: '.pptx', folder, progress: () => {} });
    assert.equal(r.render, 'images'); assert.equal(r.images.length, 7);
    r.images.forEach((im, i) => fs.copyFileSync(im.path, path.join(out, `pptx-${i + 1}-${LAYOUTS[i]}.png`)));
    const t = JSON.parse(fs.readFileSync(path.join(path.dirname(r.images[0].path), "texts.json"), 'utf8'));
    assert.ok(JSON.stringify(t[4]).includes('加速度方向向上'), '排版器读得到文字');
  });
  await test('教案 / 讲义的时间轴图和结构图：PDF、Word（图片）、手机长图都画出来', async () => {
    const plan = path.join(dir, '超重与失重-教案.md');
    fs.writeFileSync(plan, '<!-- cs:theme=physics -->\n# 超重与失重 · 教案\n\n## 时间安排\n\n```时间轴\n0-5 回顾：上次的错题\n5-15 情境引入：电梯里的体重秤\n15-30 新授：推出 $F_N=m(g+a)$\n30-45 练习：两道变式\n45-55 小测\n55-60 小结与作业\n```\n\n## 板书设计\n\n```结构图\n超重与失重\n  超重：a 向上\n    加速上升\n    减速下降\n  失重：a 向下\n    减速上升\n    加速下降\n  完全失重：a = g\n```\n');
    const r = await api.exportDoc(plan, ['pdf', 'docx', 'png']);
    assert.deepEqual(r.errors, []);
    const docx = new Map(entries(fs.readFileSync(plan.replace(/\.md$/, '.docx'))).map((e) => [e.name, e.data]));
    const media = [...docx.keys()].filter((k) => k.startsWith('word/media/'));
    const big = media.map((k) => docx.get(k)).filter((b) => b.readUInt32BE(16) > 300);
    assert.ok(big.length >= 2, 'Word 里有两张图：' + media.length);
    big.forEach((b, i) => fs.writeFileSync(path.join(out, `教案-word-图${i + 1}.png`), b));
    fs.copyFileSync(plan.replace(/\.md$/, '.png'), path.join(out, '教案-长图.png'));
    assert.doesNotMatch(docx.get('word/document.xml').toString(), /0-5 回顾/, '时间轴不该按代码原样排');
  });
  const bad = results.filter((r) => r[0] !== 'ok');
  console.log(`RESULT ${results.length - bad.length}/${results.length} pass`);
  app.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); app.exit(1); });
