// 1.7.0 B.2.4 来源核对：真出处（网页原文里有这道题，写法不同也认得出）、假出处（网页打得开但没有这道题）、
// 打不开（404 / 连不上）、本地原卷（老师拖进来的 docx / html）、原创题不核对、结果写回题库、一句实话。
// 本机起一个小网站，不联网。运行：node --test test/v170b-source.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sc = require('../electron/sourceCheck.cjs');
const { zip } = require('../electron/exporter.cjs');

const PAPER = `<!doctype html><html><head><meta charset="utf-8"><title>2024北京海淀高一（上）期中物理</title><script>var x = "不是正文";</script></head><body>
<div class="q"><p>7．（3分）质量为 60&nbsp;kg 的人站在电梯里的体重计上，电梯以 2&nbsp;m/s<sup>2</sup> 的加速度<b>减速下降</b>，
取 g＝10&nbsp;m/s<sup>2</sup>，则体重计的示数为（　　）</p><p>A．480 N　B．600 N　C．720 N　D．0</p></div>
<div class="q"><p>8．关于超重和失重，下列说法正确的是（　　）</p><p>A．超重就是物体受到的重力增大了</p></div></body></html>`;
const OTHER = '<html><body><h1>海淀区教师进修学校通知</h1><p>关于开展 2024 年秋季学期教研活动的通知……</p></body></html>';

let server, base;
test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/paper.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAPER); return; }
    if (req.url === '/other.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(OTHER); return; }
    if (req.url === '/slow') return; // 永远不回
    res.writeHead(404); res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.closeAllConnections?.(); server.close(); });

const Q_REAL = '质量为 $60\\ \\mathrm{kg}$ 的人站在电梯里的体重计上，电梯以 $2\\ \\mathrm{m/s^2}$ 的加速度减速下降，取 $g=10\\ \\mathrm{m/s^2}$，则体重计的示数为（　　）\nA. 480 N\nB. 600 N\nC. 720 N\nD. 0';
const Q_FAKE = '一个质量为 2 kg 的物体挂在弹簧测力计下，随升降机以 3 m/s² 的加速度加速上升，求测力计的示数。';

test('真出处：网页原文里有这道题（标点、空格、公式写法不同也算），核对通过', async () => {
  const r = await sc.checkBank({ questions: [{ stem: Q_REAL, source: { kind: '真题', title: '2024 北京海淀高一上期中', no: '第 7 题', year: 2024, region: '北京海淀', url: base + '/paper.html' } }] }, { fetch });
  assert.equal(r.items[0].status, 'verified', JSON.stringify(r.items[0]));
  assert.ok(r.items[0].score >= 0.6);
  assert.equal(r.verified, 1); assert.equal(r.real, 1);
});

test('假出处：网页打得开，但原文里没有这道题 → 来源未核实', async () => {
  const r = await sc.checkBank({ questions: [{ stem: Q_FAKE, source: { kind: '真题', title: '2024 北京海淀高一上期中', url: base + '/paper.html' } }, { stem: Q_REAL, source: { title: '2023 北京西城期末', url: base + '/other.html' } }] }, { fetch });
  assert.deepEqual(r.items.map((x) => x.status), ['unverified', 'unverified']);
  assert.match(r.items[0].why, /原文里没找到这道题/);
  assert.equal(r.verified, 0); assert.equal(r.unverified, 2);
});

test('打不开：404、连不上、超时都标「来源未核实」，原因写清楚', async () => {
  const dead = 'http://127.0.0.1:9/none';
  const r = await sc.checkBank({ questions: [
    { stem: Q_REAL, source: { kind: '真题', title: 'x', url: base + '/gone.html' } },
    { stem: Q_REAL + ' ', source: { kind: '真题', title: 'y', url: dead } },
    { stem: Q_FAKE, source: { kind: '真题', title: '某地某年', url: '' } },
  ] }, { fetch });
  assert.deepEqual(r.items.map((x) => x.status), ['unreachable', 'unreachable', 'missing']);
  assert.match(r.items[0].why, /HTTP 404/);
  assert.match(r.items[2].why, /没写网址/);
  const slow = await sc.checkBank({ questions: [{ stem: Q_REAL, source: { kind: '真题', url: base + '/slow' } }] }, { fetch: (u, o) => fetch(u, o), max: 5 });
  // 超时默认 15 秒；这里只确认不会永远卡住（测试整体有超时）
  assert.equal(slow.items[0].status, 'unreachable');
});

test('本地原文：老师拖进来的 Word 原卷、下载下来的网页，按文件核对；网址打不开时用本地文件', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-src-'));
  fs.mkdirSync(path.join(work, '资料', '来源'), { recursive: true });
  const docXml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>7．质量为60kg的人站在电梯里的体重计上，电梯以2m/s</w:t></w:r><w:r><w:t>2的加速度减速下降，取g＝10m/s2，则体重计的示数为（ ）</w:t></w:r></w:p></w:body></w:document>`;
  fs.mkdirSync(path.join(work, '附件'), { recursive: true });
  fs.writeFileSync(path.join(work, '附件', '海淀期中.docx'), zip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/document.xml', data: docXml }]));
  fs.writeFileSync(path.join(work, '资料', '来源', 'paper.html'), PAPER);
  const r = await sc.checkBank([
    { stem: Q_REAL, source: { kind: '真题', title: '海淀期中', file: '附件/海淀期中.docx' } },
    { stem: Q_REAL, source: { kind: '真题', title: '海淀期中', url: 'http://127.0.0.1:9/login', file: '资料/来源/paper.html' } },
    { stem: Q_REAL, source: { kind: '真题', file: '../外面的文件.html' } },
  ], { work, fetch });
  assert.deepEqual(r.items.map((x) => x.status), ['verified', 'verified', 'missing']);
});

test('原创、改编：原创不核对、计数；改编也要核对出处；结果写回题库，导入时认得', async () => {
  const bank = { version: 1, topic: '超重与失重', questions: [
    { stem: Q_REAL, answer: 'C', source: { kind: '真题', title: '2024 北京海淀高一上期中', no: '第 7 题', url: base + '/paper.html' } },
    { stem: '电梯以 1 m/s² 的加速度加速上升，质量 50 kg 的人对地板的压力多大？', answer: '550 N', source: { kind: '原创' } },
    { stem: Q_FAKE, answer: '26 N', source: { kind: '改编', title: '改编自 2023 西城期末第 5 题', url: base + '/other.html' } },
    { stem: '没有写出处的题，当作原创', answer: '1' },
  ] };
  const r = await sc.checkBank(bank, { fetch });
  assert.equal(r.real, 1); assert.equal(r.adapted, 1); assert.equal(r.original, 2);
  assert.equal(r.verified, 1); assert.equal(r.unverified, 1);
  const s = sc.summary(r);
  assert.match(s, /找到真题 1 道，改编 1 道，来源核对过 1 道，原创 2 道/);
  assert.match(s, /1 道来源对不上，已标「来源未核实」/);
  sc.annotate(bank, r, '2026-11-17T00:00:00Z');
  assert.equal(bank.questions[0].source.check.label, '来源已核对');
  assert.equal(bank.questions[2].source.check.label, '来源未核实');
  assert.equal(bank.questions[3].source.kind, '原创');
  assert.match(bank.sourceCheck.summary, /来源核对过 1 道/);
  const p = sc.problems(r, bank);
  assert.equal(p.length, 1); assert.match(p[0], /第 3 题.*改编自 2023 西城期末第 5 题/);
});

test('一句话出处也认得；题量大时均匀抽查，报「抽查了几道」', async () => {
  assert.equal(sc.citeOf({ source: '2024 北京海淀高一期中 第 7 题' }).kind, 'real');
  assert.equal(sc.citeOf({ source: '原创' }).kind, 'original');
  const many = Array.from({ length: 30 }, (_, i) => ({ stem: Q_REAL + i, source: { kind: '真题', url: base + '/paper.html' } }));
  const r = await sc.checkBank(many, { fetch, max: 10 });
  assert.equal(r.checked, 10); assert.equal(r.skipped, 20); assert.equal(r.verified, 10);
  assert.match(sc.summary(r), /抽查了 10 道/);
});

test('模糊匹配：只差标点 / 全角 / 公式写法时分数高，换了数字或条件时分数低', () => {
  const t = sc.htmlText(PAPER);
  assert.ok(sc.matchScore(Q_REAL, t) > 0.6);
  assert.ok(sc.matchScore(Q_REAL.replace('减速下降', '加速上升').replace('60', '45').replace('2\\ ', '3\\ '), t) < 0.75);
  assert.ok(sc.matchScore(Q_FAKE, t) < 0.2);
});

test('改了数字还标真题：相似但数字对不上 → 来源未核实，提示改标「改编」；标了改编就算核对过', async () => {
  const changed = Q_REAL.replace('60\\ ', '45\\ ').replace('2\\ \\mathrm{m/s^2}$ 的加速度', '3\\ \\mathrm{m/s^2}$ 的加速度');
  assert.notEqual(changed, Q_REAL);
  const r = await sc.checkBank([{ stem: changed, source: { kind: '真题', url: base + '/paper.html' } }, { stem: changed, source: { kind: '改编', url: base + '/paper.html' } }], { fetch });
  assert.deepEqual(r.items.map((x) => x.status), ['unverified', 'verified'], JSON.stringify(r.items));
  assert.match(r.items[0].why, /数字对不上/);
  // 真跑里遇到的：原卷是图，题干里补了一行「图 4 条件文字化：静止时读数 500 N」，这些数字原卷文字里没有，不算改了数字
  const withFig = Q_REAL.replace('则体重计的示数为', '则体重计的示数为').replace('\nA.', '\n图 1 条件文字化：秤的量程 0～1500 N，刻度每格 10 N。\nA.');
  const r2 = await sc.checkBank([{ stem: withFig, source: { kind: '真题', url: base + '/paper.html' } }], { fetch });
  assert.equal(r2.items[0].status, 'verified', JSON.stringify(r2.items[0]));
  assert.equal(sc.norm('Ｆ＝ｍａ， $\\frac{1}{2}$'), 'fma12');
});
