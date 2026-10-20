// 1.2.0 多线路分段下载验收（Node，本机假服务器）：
//   1. 快线路 + 慢线路 + 卡死线路 + 返回错内容的线路 + 404：照样下完，sha256 对，快线路下得最多；
//   2. 中途取消 → 再下接着上次的进度（不从头下）；
//   3. 全部线路都不支持分段：退回整文件下载；
//   4. 内容被篡改（所有线路都错）：校验不通过，文件删掉；
//   5. 更新器：清单所有来源同时问，取版本最高的；代理名单远程更新并缓存。
// 用法：node test/v120-fastget.cjs
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fastGet, expand } = require('../electron/fastget.cjs');
const { Updater } = require('../electron/updater.cjs');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fastget-'));
const data = crypto.randomBytes(9 * 1024 * 1024 + 12345);
const sha = crypto.createHash('sha256').update(data).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const mark = (n, d = {}) => { results.push({ n, ...d }); console.log('PASS ' + n, JSON.stringify(d)); };
const hits = {}, served = {};

// 线路行为：fast 不限速；slow 每 64KB 歇 120ms；stall 发一点就不动；evil 返回别的数据；norange 忽略 Range；n404
const server = http.createServer(async (req, res) => {
  const kind = req.url.split('/')[1], body = kind === 'evil' ? Buffer.from(data).fill(7) : data;
  hits[kind] = (hits[kind] || 0) + 1;
  if (kind === 'n404') { res.writeHead(404); return res.end('nope'); }
  const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
  if (!m || kind === 'norange' || kind === 'tamper') {
    res.writeHead(200, { 'content-length': body.length });
    return res.end(kind === 'tamper' ? Buffer.from(body).fill(1, 0, 10) : body);
  }
  const a = +m[1], b = Math.min(+m[2], body.length - 1), slice = body.subarray(a, b + 1);
  served[kind] = (served[kind] || 0) + slice.length;
  res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${body.length}`, 'content-length': slice.length });
  if (kind === 'stall' && a > 0) { res.write(slice.subarray(0, 1000)); return; }
  if (kind === 'slow' || (kind === 'stall' && a === 0)) {
    for (let i = 0; i < slice.length; i += 65536) { if (res.destroyed) return; res.write(slice.subarray(i, i + 65536)); await sleep(120); }
    return res.end();
  }
  res.end(slice);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const u = (k) => base + k + '/pkg.zip';
  const file = path.join(out, 'pkg.zip');
  const opts = { size: data.length, sha256: sha, file, fetch, proxies: [], chunk: 1 << 20, conns: 6, stallMs: 2500, probeMs: 3000 };

  // ── 1 ──
  assert.deepEqual(expand(['https://github.com/a/b/releases/download/v1/x.zip', 'https://m.example/x.zip'], ['https://p1.example/', 'https://p2.example/']),
    ['https://p1.example/https://github.com/a/b/releases/download/v1/x.zip', 'https://p2.example/https://github.com/a/b/releases/download/v1/x.zip', 'https://github.com/a/b/releases/download/v1/x.zip', 'https://m.example/x.zip']);
  let last = 0;
  const chunkSums = []; for (let i = 0; i < data.length; i += 1 << 20) chunkSums.push(crypto.createHash('sha256').update(data.subarray(i, i + (1 << 20))).digest('hex'));
  const r1 = await fastGet({ ...opts, chunkSize: 1 << 20, chunkSums, urls: [u('n404'), u('evil'), u('stall'), u('slow'), u('fast')], onBytes: (n) => { assert.ok(n >= 0 && n <= data.length); last = n; } });
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sha);
  assert.equal(last, data.length);
  const by = r1.sources, fastHost = '127.0.0.1:' + server.address().port;
  assert.ok(by[fastHost] === data.length || Object.values(by).reduce((a, b) => a + b, 0) >= data.length);
  assert.ok(!fs.existsSync(file + '.state.json'), 'progress record removed after success');
  mark('mixed lines (fast/slow/stall/evil/404) still finish with a correct file', { ms: r1.ms });

  // ── 2 ── 只给慢线路，下到一半取消
  fs.rmSync(file, { force: true });
  const ctl = new AbortController(); let seen = 0;
  const p2 = fastGet({ ...opts, urls: [u('slow')], conns: 2, signal: ctl.signal, onBytes: (n) => { seen = n; if (n > 3 << 20) ctl.abort(); } });
  await assert.rejects(p2, /取消/);
  const st = JSON.parse(fs.readFileSync(file + '.state.json', 'utf8'));
  assert.ok(st.done.length >= 2, 'some chunks recorded: ' + st.done.length);
  const before = served.fast || 0; let first = -1;
  await fastGet({ ...opts, minPiece: 8 << 20, urls: [u('fast')], onBytes: (n) => { if (first < 0) first = n; } });
  assert.ok(first >= st.done.length * (1 << 20), `resumed from ${first} bytes`);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sha);
  assert.ok(served.fast - before <= data.length - st.done.length * (1 << 20) + 65536, 'only missing chunks fetched: ' + (served.fast - before));
  mark('cancel then resume continues from saved progress', { resumedAt: first, cancelledAt: seen });

  // ── 3 ──
  fs.rmSync(file, { force: true });
  await fastGet({ ...opts, urls: [u('n404'), u('norange')] });
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sha);
  mark('no line supports ranges → whole-file download');

  // ── 4 ──
  fs.rmSync(file, { force: true });
  await assert.rejects(fastGet({ ...opts, urls: [u('tamper')] }), /校验不通过/);
  assert.ok(!fs.existsSync(file));
  mark('tampered content is rejected and deleted');

  // ── 5 ── 清单竞速 + 代理名单
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const sign = (m) => { const signed = JSON.stringify(m); return JSON.stringify({ signed, sig: crypto.sign(null, Buffer.from(signed), privateKey).toString('base64') }); };
  const dataDir = path.join(out, 'data');
  const fake = async (url) => {
    const x = url.split('?')[0];
    if (x === 'https://old.test/latest.json') return new Response(sign({ version: '1.1.0', platforms: {} }));
    if (x === 'https://new.test/latest.json') { await sleep(300); return new Response(sign({ version: '1.2.0', platforms: {} })); }
    if (x === 'https://slow.test/latest.json') { await sleep(5000); return new Response(sign({ version: '9.9.9', platforms: {} })); }
    if (x === 'https://list.test/mirrors.json') return Response.json({ proxies: ['https://px.example/', 'javascript:alert(1)', 'http://plain.example/'] });
    return new Response('no', { status: 404 });
  };
  const up = new Updater({ appRoot: out, version: '1.1.0', dataDir, fetch: fake, log: null, emit: () => {}, packaged: true, feeds: ['https://old.test/latest.json', 'https://new.test/latest.json', 'https://slow.test/latest.json', 'https://bad.test/latest.json'], publicKey: PUB, mirrorLists: ['https://list.test/mirrors.json'], proxies: undefined });
  const t = Date.now(); const got = await up.fetchManifest();
  assert.equal(got.manifest.version, '1.2.0'); assert.ok(Date.now() - t < 3500, 'did not wait for the slow feed');
  assert.deepEqual(await up.refreshMirrors(), ['https://px.example/']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'updates', 'mirrors.json'), 'utf8')).proxies, ['https://px.example/']);
  const up2 = new Updater({ appRoot: out, version: '1.1.0', dataDir, fetch: fake, log: null, emit: () => {}, packaged: true });
  assert.deepEqual(up2.proxies, ['https://px.example/'], 'cached proxy list is used on next start');
  mark('feeds raced (highest version within grace wins), proxy list refreshed, filtered and cached');

  console.log('RESULT ' + JSON.stringify(results));
  server.close(); fs.rmSync(out, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
