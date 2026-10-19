// 成果导出验收：Markdown（含公式、表格、列表）→ PDF / Word / PPT，检查文件结构，并把页面截图存下来人工看。
// 用法：npx electron test/quiet.cjs test/export.cjs [某个 .md]
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict'); const zlib = require('node:zlib');
const out = path.join(__dirname, '../.out/A', 'export-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
const { app } = require('electron');
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw Error('Timed out ' + what); };
const timer = setTimeout(() => { console.error('export timed out'); app.exit(1); }, 240000);

const SAMPLE = `# 匀变速直线运动 · 课堂讲义

> 本讲重点：速度公式、位移公式及其适用条件。

## 一、核心公式

速度公式 $v=v_0+at$，位移公式：

$$x=v_0t+\\frac{1}{2}at^2$$

推论：$v^2-v_0^2=2ax$，适用于**匀变速**直线运动。

| 物理量 | 符号 | 单位 |
| --- | --- | --- |
| 加速度 | $a$ | $\\mathrm{m/s^2}$ |
| 位移 | $x$ | m |

---

## 二、例题

1. 汽车以 $v_0=10\\ \\mathrm{m/s}$ 刹车，加速度大小 $a=2\\ \\mathrm{m/s^2}$，求 $6\\ \\mathrm{s}$ 内的位移。
2. 判断：*匀变速* 运动的位移一定随时间均匀增大。
   - 提示：看 $x$-$t$ 图像的斜率。

---

## 三、易错点

- 刹车问题先算停下的时间 $t_0=\\dfrac{v_0}{a}$
- 公式中的 $a$ 带符号
`;

function unzip(buf) {
  const files = new Map();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28), method = buf.readUInt16LE(p + 8);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8'), data = buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    files.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    p += 30 + nlen + xlen + size;
  }
  return files;
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest, 30000, 'api');
  const src = process.argv.find((a) => /\.md$/i.test(a));
  const md = path.join(out, src ? path.basename(src) : '讲义.md');
  fs.writeFileSync(md, src ? fs.readFileSync(src) : SAMPLE);
  const t0 = Date.now();
  const r = await api.exportDoc(md, ['pdf', 'docx', 'pptx']);
  console.log('exported in', Date.now() - t0, 'ms', JSON.stringify(r));
  assert.deepEqual(r.errors, []);
  const base = md.replace(/\.md$/, '');
  const pdf = fs.readFileSync(base + '.pdf');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const docx = unzip(fs.readFileSync(base + '.docx'));
  const doc = docx.get('word/document.xml').toString();
  assert.ok(doc.includes('<w:drawing>'), 'formulas embedded as images');
  const imgs = [...docx.keys()].filter((k) => k.startsWith('word/media/'));
  const dollars = (fs.readFileSync(md, 'utf8').match(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g) || []).length;
  assert.equal(imgs.length, dollars, 'one picture per formula');
  assert.ok(!/\$[^$]+\$/.test(doc.replace(/<[^>]+>/g, '')), 'no raw $...$ left in Word text');
  for (const k of imgs.slice(0, 6)) fs.writeFileSync(path.join(out, 'docx-' + path.basename(k)), docx.get(k));
  const pptx = unzip(fs.readFileSync(base + '.pptx'));
  const slides = [...pptx.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  assert.ok(slides.length >= (src ? 1 : 3), 'slides');
  for (const k of [...pptx.keys()].filter((k) => k.startsWith('ppt/media/')).slice(0, 4)) fs.writeFileSync(path.join(out, 'pptx-' + path.basename(k)), pptx.get(k));
  console.log('PASS pdf', pdf.length, 'bytes; docx', imgs.length, 'formula images; pptx', slides.length, 'slides');
  console.log('RESULT ' + out);
  clearTimeout(timer); app.exit(0);
})().catch((e) => { console.error('FAIL', e); app.exit(1); });
