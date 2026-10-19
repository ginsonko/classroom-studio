// 1.0.0 自动更新验收（Node，不开窗口）：
//   1. 清单签名：对的能读，改过一个字就拒绝；路径里有 .. 的清单拒绝；
//   2. 只下变了的块：哈希一样的不下；
//   3. 真走一遍：假下载源 → 校验 → 解压 → 用真实的 PowerShell 换文件脚本替换 → 重新打开 → 写结果；
//   4. 换到一半文件被占用：自动挪回去，旧版本原样可用。
// 用法：node test/v100-update.cjs
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const crypto = require('node:crypto');
const assert = require('node:assert/strict'); const { spawn, execFileSync } = require('node:child_process');
const { Updater, openManifest, plan } = require('../electron/updater.cjs');

// 假安装目录放系统临时目录：项目里开着的 vite 会盯住名叫 dist 的文件夹，导致它挪不动
const out = path.join(os.tmpdir(), 'cs-v100-update-' + Date.now());
if (process.argv[2] !== '--app') fs.mkdirSync(out, { recursive: true });
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sign = (m) => { const signed = JSON.stringify(m); return JSON.stringify({ signed, sig: crypto.sign(null, Buffer.from(signed), privateKey).toString('base64') }); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const results = []; const mark = (n, d = {}) => { results.push({ n, ...d }); console.log('PASS ' + n); };

// 子进程模式：扮演「正在运行的软件」，调用更新器后退出
if (process.argv[2] === '--app') {
  (async () => {
    const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const zips = Object.fromEntries(Object.entries(cfg.zips).map(([u, f]) => [u, fs.readFileSync(f)]));
    const fetch = async (url) => { const u = url.split('?')[0]; if (u === cfg.feed) return new Response(cfg.manifest); if (zips[u]) return new Response(zips[u]); return new Response('nope', { status: 404 }); };
    const up = new Updater({ appRoot: cfg.appRoot, version: '1.0.0', dataDir: cfg.data, fetch, log: null, emit: () => {}, packaged: true, feeds: [cfg.feed], publicKey: cfg.pub, execPath: cfg.exe, platform: 'win32', arch: 'x64' });
    const st = await up.check({ manual: true });
    if (st.phase !== 'available' || !st.info.auto) throw new Error('check: ' + JSON.stringify(st));
    await up.download();
    up.launchApply();
    fs.writeFileSync(path.join(cfg.data, 'app-state.json'), JSON.stringify(up.state));
    process.exit(0);
  })().catch((e) => { fs.writeFileSync(path.join(path.dirname(process.argv[3]), 'app-error.txt'), String(e.stack)); process.exit(1); });
  return;
}

(async () => {
  // ── 1. 签名 ──
  const m0 = { version: '1.0.1', platforms: {} };
  assert.equal(openManifest(sign(m0), PUB).version, '1.0.1');
  const bad = JSON.parse(sign(m0)); bad.signed = bad.signed.replace('1.0.1', '9.9.9');
  assert.throws(() => openManifest(JSON.stringify(bad), PUB), /签名不对/);
  assert.throws(() => openManifest(sign(m0)), /签名不对/, 'the real release key does not accept a test signature');
  const evil = { version: '1.0.1', platforms: { 'win32-x64': { components: { app: { hash: 'x', sha256: 'y', urls: ['https://a/b'], paths: ['../outside'] } } } } };
  assert.equal(plan(evil, null, 'win32-x64').ok, false);
  mark('manifest signature is verified; tampered or unsafe manifests are refused');

  // ── 2. 一个假的已安装版本（Windows 布局） ──
  const mk = (root, files) => { for (const [rel, text] of Object.entries(files)) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } };
  const root = path.join(out, '最强网课教辅系统'), appRoot = path.join(root, 'resources', 'app'), data = path.join(out, 'data');
  fs.mkdirSync(data, { recursive: true });
  // 「重新打开」的是这个 cmd：写个标记说明被启动过
  const exe = path.join(root, 'ClassroomStudio.cmd');
  mk(root, {
    'ClassroomStudio.cmd': `@echo relaunched> "${path.join(out, 'relaunched.txt')}"\r\n`,
    'resources/app/dist/index.html': 'old ui', 'resources/app/dist/assets/old-123.js': 'old js',
    'resources/app/electron/main.cjs': 'old main', 'resources/app/package.json': '{"version":"1.0.0"}',
    'resources/app/bin/codex/VERSION': '0.163.0',
  });
  const build = { version: '1.0.0', components: { app: { hash: 'app-100' }, codex: { hash: 'codex-1' } } };
  fs.writeFileSync(path.join(appRoot, 'build.json'), JSON.stringify(build));

  // 新版本：app 变了，codex 没变
  const next = path.join(out, 'next');
  mk(next, { 'resources/app/dist/index.html': 'new ui', 'resources/app/dist/assets/new-456.js': 'new js', 'resources/app/electron/main.cjs': 'new main', 'resources/app/package.json': '{"version":"1.0.1"}' });
  fs.writeFileSync(path.join(next, 'resources/app/build.json'), JSON.stringify({ version: '1.0.1', components: { app: { hash: 'app-101' }, codex: { hash: 'codex-1' } } }));
  const appPaths = ['resources/app/dist', 'resources/app/electron', 'resources/app/package.json', 'resources/app/build.json'];
  const zip = path.join(out, 'app-1.0.1.zip');
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', next, ...appPaths]);
  const zbuf = fs.readFileSync(zip);
  const manifest = { version: '1.0.1', date: '2026-10-20', notes: ['测试更新'], platforms: { 'win32-x64': { components: {
    app: { hash: 'app-101', size: zbuf.length, sha256: sha(zbuf), urls: ['https://mirror.test/broken.zip', 'https://github.test/app.zip'], paths: appPaths },
    codex: { hash: 'codex-1', size: 400e6, sha256: 'unused', urls: ['https://mirror.test/codex.zip'], paths: ['resources/app/bin/codex'] },
  } } } };
  const p = plan(manifest, build, 'win32-x64');
  assert.deepEqual(p.need.map((x) => x.name), ['app']); assert.equal(p.bytes, zbuf.length);
  mark('only changed parts are downloaded (codex 400 MB skipped)', { bytes: p.bytes });

  // ── 3. 真走一遍 ──
  const cfgFile = path.join(out, 'app.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ appRoot, data, exe, pub: PUB, feed: 'https://feed.test/latest.json', manifest: sign(manifest), zips: { 'https://github.test/app.zip': zip } }));
  const runApp = () => new Promise((res) => spawn(process.execPath, [__filename, '--app', cfgFile], { stdio: 'inherit' }).on('exit', res));
  const code = await runApp();
  assert.equal(code, 0, fs.existsSync(path.join(out, 'app-error.txt')) ? fs.readFileSync(path.join(out, 'app-error.txt'), 'utf8') : 'app failed');
  const resultFile = path.join(data, 'updates', 'result.json');
  const waitFor = async (f, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fs.existsSync(f)) return; await new Promise((r) => setTimeout(r, 200)); } throw Error('timeout waiting for ' + f); };
  await waitFor(resultFile, 60000);
  const r = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(path.join(appRoot, 'dist/index.html'), 'utf8'), 'new ui');
  assert.ok(!fs.existsSync(path.join(appRoot, 'dist/assets/old-123.js')), 'old hashed assets are gone');
  assert.equal(fs.readFileSync(path.join(appRoot, 'bin/codex/VERSION'), 'utf8'), '0.163.0', 'codex untouched');
  assert.equal(JSON.parse(fs.readFileSync(path.join(appRoot, 'build.json'))).version, '1.0.1');
  await waitFor(path.join(out, 'relaunched.txt'), 15000);
  // 新版本启动时读结果并清理
  const up2 = new Updater({ appRoot, version: '1.0.1', dataDir: data, fetch, log: null, emit: () => {}, packaged: true, execPath: exe, platform: 'win32', arch: 'x64' });
  const taken = up2.takeResult();
  assert.equal(taken.to, '1.0.1');
  assert.ok(!fs.existsSync(path.join(root, '.update-stage')) && !fs.existsSync(path.join(root, '.update-backup')), 'stage and backup cleaned');
  mark('download (falls back to the second URL) → verify → swap with the PowerShell helper → relaunch → result read and cleaned');

  // ── 4. 文件被占用 → 回滚 ──
  fs.writeFileSync(path.join(appRoot, 'build.json'), JSON.stringify(build));
  fs.rmSync(path.join(out, 'relaunched.txt'), { force: true });
  const lockTarget = path.join(appRoot, 'package.json');
  // 不允许删除 / 改名的方式打开（Node 打开的文件允许改名，所以用 .NET 锁）
  const locker = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${lockTarget}','Open','Read','None'); Start-Sleep -Seconds 40; $f.Close()`], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now();
  assert.equal(await runApp(), 0);
  await waitFor(resultFile, 90000);
  const r2 = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''));
  locker.kill();
  assert.equal(r2.ok, false, 'locked file makes the swap fail');
  assert.equal(fs.readFileSync(path.join(appRoot, 'dist/index.html'), 'utf8'), 'new ui', 'already-moved parts restored (this install was at 1.0.1 content)');
  assert.ok(fs.existsSync(path.join(appRoot, 'electron/main.cjs')), 'nothing left missing');
  assert.ok(fs.existsSync(lockTarget));
  await waitFor(path.join(out, 'relaunched.txt'), 15000);
  mark('a locked file rolls the swap back and the old version still opens', { error: r2.error, seconds: Math.round((Date.now() - t0) / 1000) });

  console.log('RESULT ' + JSON.stringify(results));
  fs.rmSync(out, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results }, null, 2)); process.exit(1); });
