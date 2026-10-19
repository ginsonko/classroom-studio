'use strict';
// 官方 Codex CLI（Apache-2.0）原生版（Windows x64、macOS arm64 / x64）：打包时内置，装好后也能在导播台里一键更新。
// 来源是 npm 上的 @openai/codex@<版本>-<系统>-<架构>，原样使用二进制，附 LICENSE / NOTICE；
// 只跳过可选的语音组件（任务不用语音输入）。不需要 Node.js / npm。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const TARGETS = {
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', exe: '.exe' },
  'darwin-arm64': { triple: 'aarch64-apple-darwin', exe: '' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', exe: '' },
};
const targetOf = (platform = process.platform, arch = process.arch) => {
  const key = platform + '-' + arch, t = TARGETS[key];
  if (!t) throw new Error('内置 Codex 暂不支持这个系统：' + key);
  return { key, ...t };
};
const TRIPLE = TARGETS['win32-x64'].triple;
/** 一个 Codex 目录里的主程序 */
const codexBin = (dir, platform = process.platform) => path.join(dir, 'bin', 'codex' + (platform === 'win32' ? '.exe' : ''));
// 国内镜像通常快得多；两边都查，版本取较新的，下载失败换另一个
const REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org'];
const SKIP = [path.join('codex-resources', 'voice')];
const LICENSE_DIR = path.join(__dirname, 'codex-license');

/** x.y.z 数字比较；解析不了的当最旧 */
function cmpVersion(a, b) {
  const p = (v) => (/(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')) || [0, -1, -1, -1]).slice(1).map(Number);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** 一个 Codex 目录（bin/codex(.exe) + VERSION）的版本；不完整返回 '' */
function dirVersion(dir, platform = process.platform) {
  if (!dir || !fs.existsSync(codexBin(dir, platform))) return '';
  return readText(path.join(dir, 'VERSION')).trim();
}

async function getJson(fetchFn, url) {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/** 最新版本号：两个源都问，取较新的 */
async function latestVersion(fetchFn = fetch) {
  const got = await Promise.allSettled(REGISTRIES.map((reg) => getJson(fetchFn, `${reg}/@openai/codex/latest`)));
  const vers = got.filter((g) => g.status === 'fulfilled' && /^\d+\.\d+\.\d+$/.test(g.value?.version)).map((g) => g.value.version);
  if (!vers.length) throw new Error('连不上 npm 源，暂时查不到 Codex 的新版本：' + (got.find((g) => g.status === 'rejected')?.reason?.message || ''));
  return vers.sort(cmpVersion).pop();
}

/** 边下载边算 sha512，和 npm 登记的 integrity 对上才算数 */
async function download(fetchFn, url, file, integrity, onProgress) {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error(`${url} → ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha512'), out = fs.createWriteStream(file);
  let got = 0, step = 0;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value); got += value.length;
      if (!out.write(value)) await new Promise((res) => out.once('drain', res));
      const pct = total ? Math.floor((got / total) * 10) : 0;
      if (pct > step) { step = pct; onProgress?.(`已下载 ${Math.round(got / 1048576)} MB / ${Math.round(total / 1048576)} MB`); }
    }
  } finally { await new Promise((res) => out.end(res)); }
  const want = String(integrity || '');
  if (want.startsWith('sha512-') && 'sha512-' + hash.digest('base64') !== want) throw new Error('下载的文件校验不通过（可能被截断或篡改）');
}

function tarExe() {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
}

const run = (cmd, args, timeout = 10 * 60 * 1000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
});

// 刚运行过的 exe 会被杀毒软件扫描几秒，这期间整个目录改不了名：多等几次，实在不行就复制
async function moveDir(from, to) {
  for (let i = 0; i < 20; i++) {
    try { fs.renameSync(from, to); return; } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e; }
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}

/**

 * 把指定版本（默认最新）放到 out 目录：bin/codex(.exe)、codex-resources、codex-path、LICENSE.txt、NOTICE.txt、VERSION。
 * tgz 给了就用本地包（打包脚本离线用）。已是这个版本时什么也不做。返回版本号。
 * platform / arch 可以和本机不同（在 Windows 上给 macOS 打包），这时只检查文件齐全，不试运行。
 */
async function stageCodex({ version, out, fetch: fetchFn = fetch, tmp = os.tmpdir(), tgz = '', onProgress, platform = process.platform, arch = process.arch } = {}) {
  const t = targetOf(platform, arch), native = platform === process.platform && arch === process.arch;
  const ver = version || (await latestVersion(fetchFn));
  if (!/^\d+\.\d+\.\d+$/.test(ver)) throw new Error('Codex 版本号不对：' + ver);
  if (dirVersion(out, platform) === ver) return ver;
  const work = fs.mkdtempSync(path.join(tmp, 'cs-codex-'));
  try {
    if (!tgz) {
      tgz = path.join(work, 'codex.tgz');
      let lastErr;
      for (const reg of REGISTRIES) {
        try {
          const meta = await getJson(fetchFn, `${reg}/@openai/codex/${ver}-${t.key}`);
          onProgress?.(`从 ${new URL(reg).host} 下载 Codex ${ver}…`);
          await download(fetchFn, meta.dist.tarball, tgz, meta.dist.integrity, onProgress);
          lastErr = null; break;
        } catch (e) { lastErr = e; onProgress?.(`这个源不行（${e.message}），换一个`); }
      }
      if (lastErr) throw lastErr;
    }
    onProgress?.('解压…');
    await run(tarExe(), ['-xzf', tgz, '-C', work]);
    const src = path.join(work, 'package', 'vendor', t.triple);
    const meta = JSON.parse(readText(path.join(src, 'codex-package.json')) || '{}');
    if (meta.version !== ver) throw new Error(`安装包里的版本是 ${meta.version || '未知'}，不是 ${ver}`);
    // 先装到旁边的临时目录，验证能运行再换上，坏包不会覆盖好的
    const next = out + '.new';
    fs.rmSync(next, { recursive: true, force: true });
    fs.cpSync(src, next, { recursive: true, filter: (p) => !SKIP.some((s) => path.relative(src, p).startsWith(s)) });
    if (native) {
      const said = await run(codexBin(next, platform), ['--version'], 30000).catch(() => '');
      if (!said.includes(ver)) throw new Error('新版 Codex 运行检查没通过');
    } else if (!fs.existsSync(codexBin(next, platform))) throw new Error('安装包里没有 Codex 主程序');
    fs.copyFileSync(path.join(LICENSE_DIR, 'LICENSE.txt'), path.join(next, 'LICENSE.txt'));
    fs.writeFileSync(path.join(next, 'NOTICE.txt'), [
      `Codex CLI ${ver} (${t.triple}), unmodified binary from the npm package @openai/codex@${ver}-${t.key}.`,
      'Source: https://github.com/openai/codex',
      'Licensed under the Apache License, Version 2.0 (see LICENSE.txt).',
      'The optional voice runtime is not included.',
      '',
      readText(path.join(LICENSE_DIR, 'NOTICE.txt')).trim(),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(next, 'VERSION'), ver + '\n');
    fs.rmSync(out, { recursive: true, force: true });
    await moveDir(next, out);
    return ver;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { stageCodex, latestVersion, cmpVersion, dirVersion, codexBin, targetOf, TARGETS, TRIPLE, REGISTRIES };
