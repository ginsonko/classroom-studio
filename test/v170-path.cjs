// 1.7.0 第 1 项（主进程）：fixPath 把 %20、file://、~ 还原成真实路径；Files.authorize / allowed 都走它
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fixPath } = require('../electron/core.cjs');
const { Files } = require('../electron/files.cjs');

const root = fs.mkdtempSync(path.join(process.env.CS_TEST_OUT || os.tmpdir(), 'v170-path-'));
const dir = path.join(root, 'Application Support', 'ClassroomStudioData', 'assistant', 'workspace');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, '2026北京海淀高三上期中物理-试卷分析.docx');
fs.writeFileSync(file, 'x');
const literal = path.join(root, 'a%20b.txt'); fs.writeFileSync(literal, 'y');
const enc = (p) => p.replace(/ /g, '%20');

test('含 %20 且原样找不到 → 解码后找到', () => { assert.equal(fixPath(enc(file)), path.resolve(file)); });
test('整段网址编码（中文也编码了）', () => { assert.equal(fixPath(path.join(root, encodeURIComponent('Application Support'), 'ClassroomStudioData', 'assistant', 'workspace', encodeURIComponent(path.basename(file)))), path.resolve(file)); });
test('文件名本来就带 %20 时不乱解码', () => { assert.equal(fixPath(literal), path.resolve(literal)); });
test('file:// 网址', () => { assert.equal(fixPath(pathToFileURL(file).href), path.resolve(file)); });
test('~ 展开到用户目录', () => { assert.equal(fixPath('~/x/y.pdf', { home: root }), path.join(root, 'x', 'y.pdf')); });
test('<> 和引号包着的路径', () => { assert.equal(fixPath('<' + enc(file) + '>'), path.resolve(file)); assert.equal(fixPath('"' + file + '"'), path.resolve(file)); });
test('都找不到时返回规范化的原路径，不抛错', () => { const p = path.join(root, 'nope%20x.pdf'); assert.equal(fixPath(p), path.resolve(p)); });
test('Files.authorize / allowed 接受编码过的路径；找不到给人话不给 ENOENT 原文', () => {
  const f = new Files(path.join(root, 'cache'));
  assert.equal(f.authorize(enc(file)), path.resolve(file).replaceAll('\\', '/'));
  assert.equal(f.allowed(enc(file)), fs.realpathSync(file));
  assert.throws(() => f.authorize(path.join(root, 'gone.docx')), (e) => /找不到这个文件/.test(e.message) && !/ENOENT/.test(e.message));
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
