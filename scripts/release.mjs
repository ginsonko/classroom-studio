// 1.0.0 正式发布打包：Windows x64 + macOS arm64/x64 完整安装包、分块更新包、签名的 latest.json。
//   node scripts/release.mjs [--skip-build] [--only win32-x64,darwin-arm64,darwin-x64]
// 大文件缓存（Electron / Codex / FFmpeg 的原始下载）放在 CS_RELEASE_CACHE（默认系统临时目录），已存在就不重下。
// 打包前需要：npm install、node scripts/fetch-codex.mjs、把 Windows 版 ffmpeg.exe 放进 bin/。
// 签名私钥在 %USERPROFILE%\.classroom-studio-release\update-ed25519-private.pem（不进仓库、不进安装包）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeZip, entriesFromDir, zipModes, zipEntryData } from './zipfile.mjs';

const require = createRequire(import.meta.url);
const { stageCodex } = require('../electron/codexDist.cjs');
const { openManifest } = require('../electron/updater.cjs');
const { PROXIES, BROWSER_PROXIES } = require('../electron/fastget.cjs');

const appRoot = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
// 写进 ClassroomStudio.exe 和 Info.plist 的版本号。如果用软件版本号，runtime 分块每次发版都会变，老师每次更新都要重下 150 MB；
// 只在换 Electron 版本时改它。软件自己显示和比较的版本来自 resources/app/package.json，不看这里。
const RUNTIME_VERSION = '1.0.1';
const NAME = '最强网课教辅系统';
const CODEX_VER = fs.readFileSync(path.join(appRoot, 'bin/codex/VERSION'), 'utf8').trim();
const CACHE = process.env.CS_RELEASE_CACHE || path.join(os.tmpdir(), 'cs-release-cache');
const STAGE = process.env.CS_RELEASE_STAGE || path.join(CACHE, 'stage-' + version);
const OUT = path.resolve(appRoot, '../release/dist-' + version);
const MIRROR = `https://classroom.yinziapi.top/update/${version}/`;
const GITHUB = `https://github.com/ginsonko/classroom-studio/releases/download/v${version}/`;
const KEY_FILE = path.join(os.homedir(), '.classroom-studio-release', 'update-ed25519-private.pem');
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = arg('--only')?.split(',');
const PLATFORMS = ['win32-x64', 'darwin-arm64', 'darwin-x64'].filter((p) => !only || only.includes(p));

// 浏览器预览用的样稿（mock）桌面版用不到，也不该随安装包发出去
const keep = (src) => !/[\\/]dist[\\/]mock([\\/]|$)/.test(src);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const shaFile = (f) => sha(fs.readFileSync(f));
const CHUNK = 4 << 20;
/** 每 4 MB 一段的 sha256，写进签名清单，下载时每段到手就能校验 */
function chunkSums(f) {
  const fd = fs.openSync(f, 'r'), buf = Buffer.allocUnsafe(CHUNK), out = [];
  try { for (let pos = 0, n; (n = fs.readSync(fd, buf, 0, CHUNK, pos)) > 0; pos += n) out.push(sha(buf.subarray(0, n))); } finally { fs.closeSync(fd); }
  return { size: CHUNK, sha256: out };
}
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);

async function download(url, file, { shasum, shasums } = {}) {
  if (fs.existsSync(file)) {
    if (shasum && shaFile(file) !== shasum) { log('校验不过，重下', path.basename(file)); fs.rmSync(file); }
    else return file;
  }
  log('下载', url);
  const r = await fetch(url, { signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error(url + ' → ' + r.status);
  const out = fs.createWriteStream(file + '.part');
  const reader = r.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; out.write(value); }
  await new Promise((res) => out.end(res));
  fs.renameSync(file + '.part', file);
  if (shasum && shaFile(file) !== shasum) throw new Error(path.basename(file) + ' sha256 和官方清单对不上');
  return file;
}

/** 一组文件的内容哈希：相对路径 + 每文件 sha256 合在一起再哈希（重建时内容没变哈希就不变） */
function contentHash(items) {
  const h = crypto.createHash('sha256');
  for (const { rel, file, target, dir } of [...items].sort((a, b) => a.rel.localeCompare(b.rel))) h.update(rel + '\0' + (dir ? '/' : target !== undefined ? '->' + target : shaFile(file)) + '\n');
  return h.digest('hex');
}

async function collect(root, rels, links = []) {
  const items = [];
  for (const rel of rels) {
    if (links.some((l) => l.rel === rel)) continue;
    const full = path.join(root, ...rel.split('/'));
    const st = fs.statSync(full, { throwIfNoEntry: false });
    if (!st) throw new Error('打包缺文件：' + rel);
    if (st.isFile()) items.push({ rel, file: full });
    else for (const e of await entriesFromDir(full, rel + '/')) items.push({ rel: e.name, file: e.file, dir: e.dir });
  }
  return items;
}

function gunzipTo(gz, file, mode = 0o755) {
  if (fs.existsSync(file)) return file;
  fs.writeFileSync(file, zlib.gunzipSync(fs.readFileSync(gz)));
  return file;
}

// ── Windows ──
async function buildWin() {
  const root = path.join(STAGE, 'win32-x64', NAME);
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
  // Electron drops debug.log beside its exe when tests run it; shipping it would change the runtime hash and force a full runtime download.
  fs.cpSync(path.join(appRoot, 'node_modules/electron/dist'), root, { recursive: true, filter: (src) => path.basename(src) !== 'debug.log' });
  fs.renameSync(path.join(root, 'electron.exe'), path.join(root, 'ClassroomStudio.exe'));
  const { rcedit } = await import('rcedit');
  await rcedit(path.join(root, 'ClassroomStudio.exe'), {
    icon: path.join(appRoot, 'build/icon.ico'),
    'file-version': RUNTIME_VERSION + '.0', 'product-version': RUNTIME_VERSION + '.0',
    'version-string': { ProductName: NAME, FileDescription: NAME + '：一对一网课上课、录课、备课一体化', CompanyName: 'yinziapi.top', LegalCopyright: '开放源代码；个人老师免费，单位使用需授权' },
  });
  const appDir = path.join(root, 'resources/app');
  for (const n of ['dist', 'electron', 'bin']) fs.cpSync(path.join(appRoot, n), path.join(appDir, n), { recursive: true, filter: keep });
  writeAppMeta(appDir);
  log('win32-x64 组装完成');
  const topLevel = fs.readdirSync(root).filter((n) => n !== 'resources');
  const defs = [
    { name: 'app', paths: ['resources/app/dist', 'resources/app/electron', 'resources/app/package.json', 'resources/app/LICENSE.txt', 'resources/app/build.json'], hashOver: ['resources/app/dist', 'resources/app/electron', 'resources/app/package.json', 'resources/app/LICENSE.txt'] },
    { name: 'codex', paths: ['resources/app/bin/codex'] },
    { name: 'ffmpeg', paths: ['resources/app/bin/ffmpeg.exe', 'resources/app/bin/FFmpeg-README.txt'] },
    { name: 'runtime', paths: [...topLevel, ...(fs.existsSync(path.join(root, 'resources/default_app.asar')) ? ['resources/default_app.asar'] : [])] },
  ];
  return finishPlatform('win32-x64', root, defs, { zipRoot: NAME, extra: [{ name: NAME + '/许可协议.txt', file: path.join(appRoot, 'LICENSE') }] });
}

// ── macOS ──
async function buildMac(arch) {
  const key = 'darwin-' + arch;
  const zip = path.join(CACHE, `electron-v44.8.0-${key}.zip`);
  const modeMap = zipModes(zip);
  const work = path.join(STAGE, key);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  log(key, '解压 Electron…');
  // Windows 上 tar 建不了软链接（会报错退出），普通文件照样解出来；软链接从 zip 里单独读出来，打包时原样写回去
  spawnSync(tar, ['-xf', zip, '-C', work], { stdio: 'ignore' });
  if (!fs.existsSync(path.join(work, 'Electron.app/Contents/MacOS/Electron'))) throw new Error(key + ' Electron 解压失败');
  const links = [];
  for (const [name, info] of modeMap) {
    if ((info.mode & 0o170000) !== 0o120000 || !name.startsWith('Electron.app/')) continue;
    links.push({ rel: name.slice('Electron.app/'.length), target: zipEntryData(zip, info).toString('utf8') });
  }
  log(key, `软链接 ${links.length} 个`);
  const app = path.join(work, NAME + '.app');
  fs.renameSync(path.join(work, 'Electron.app'), app);
  fs.renameSync(path.join(app, 'Contents/MacOS/Electron'), path.join(app, 'Contents/MacOS/ClassroomStudio'));
  patchPlist(path.join(app, 'Contents/Info.plist'));
  fs.copyFileSync(path.join(appRoot, 'build/icon.icns'), path.join(app, 'Contents/Resources/icon.icns'));
  const appDir = path.join(app, 'Contents/Resources/app');
  for (const n of ['dist', 'electron']) fs.cpSync(path.join(appRoot, n), path.join(appDir, n), { recursive: true, filter: keep });
  fs.mkdirSync(path.join(appDir, 'bin'), { recursive: true });
  const codexOut = path.join(CACHE, 'codex-' + key);
  await stageCodex({ version: CODEX_VER, out: codexOut, tgz: path.join(CACHE, `codex-${CODEX_VER}-${key}.tgz`), platform: 'darwin', arch, onProgress: (m) => log('codex:', m) });
  fs.cpSync(codexOut, path.join(appDir, 'bin/codex'), { recursive: true });
  gunzipTo(path.join(CACHE, `ffmpeg-${key}.gz`), path.join(appDir, 'bin/ffmpeg'));
  writeAppMeta(appDir);
  log(key, '组装完成');
  // 继承自 Electron 官方包的文件用原来的 unix 权限；新增的命令行工具给执行位
  const origKey = (rel) => 'Electron.app/' + rel.replace(/^Contents\/MacOS\/ClassroomStudio$/, 'Contents/MacOS/Electron');
  const execNew = (rel) => /^Contents\/Resources\/app\/bin\/(codex\/(bin\/[^.]+|codex-path\/[^.]+)|ffmpeg)$/.test(rel);
  const defs = [
    { name: 'app', paths: ['Contents/Resources/app/dist', 'Contents/Resources/app/electron', 'Contents/Resources/app/package.json', 'Contents/Resources/app/LICENSE.txt', 'Contents/Resources/app/build.json'], hashOver: ['Contents/Resources/app/dist', 'Contents/Resources/app/electron', 'Contents/Resources/app/package.json', 'Contents/Resources/app/LICENSE.txt'] },
    { name: 'codex', paths: ['Contents/Resources/app/bin/codex'] },
    { name: 'ffmpeg', paths: ['Contents/Resources/app/bin/ffmpeg', 'Contents/Resources/app/bin/FFmpeg-README.txt'] },
    {
      name: 'runtime', paths: fs.readdirSync(path.join(app, 'Contents')).flatMap((n) =>
        n === 'Resources' ? fs.readdirSync(path.join(app, 'Contents/Resources')).filter((x) => x !== 'app').map((x) => 'Contents/Resources/' + x) : ['Contents/' + n]),
    },
  ];
  return finishPlatform(key, app, defs, {
    zipRoot: NAME + '.app', links, extra: macExtras(),
    mode: (rel) => { const m = modeMap.get(origKey(rel))?.mode; return m && (m & 0o170000) ? m : 0o100000 | (m || (execNew(rel) ? 0o755 : 0o644)); },
  });
}

// 没有苹果开发者签名：第一次打开要去掉「来自网络」标记并就地签名，否则会提示「已损坏」
function macExtras() {
  const fix = [
    '#!/bin/bash',
    '# 把软件挪进「应用程序」并去掉隔离标记，之后就能正常双击打开',
    'cd "$(dirname "$0")"',
    `APP="${NAME}.app"`,
    'if [ -d "$APP" ]; then rm -rf "/Applications/$APP" && cp -R "$APP" /Applications/ || { echo "复制失败，请手动把 $APP 拖进「应用程序」"; }; fi',
    'xattr -cr "/Applications/$APP" 2>/dev/null',
    'codesign --force --deep --sign - "/Applications/$APP" >/dev/null 2>&1',
    'echo "完成，正在打开…"',
    'open "/Applications/$APP"',
    '',
  ].join('\n');
  const readme = [
    `${NAME} ${version} · macOS 版（未经实机测试，遇到问题请到 QQ 群 1035471769 反馈）`,
    '',
    '安装：',
    '  1. 在「安装并打开.command」上点右键 → 打开 → 再点「打开」（只需要第一次）；',
    `     它会把「${NAME}」放进「应用程序」并去掉系统的隔离标记。`,
    '  2. 如果双击脚本没反应：打开「终端」，输入下面两行（每行回车）：',
    `       xattr -cr "/Applications/${NAME}.app"`,
    `       codesign --force --deep --sign - "/Applications/${NAME}.app"`,
    '',
    'macOS 版和 Windows 版的差别：',
    '  · PPT / Word 课件直接打开：.pptx / .docx / .rtf 用内置排版显示；旧版 .ppt / .doc 会请 Keynote、Pages、',
    '    PowerPoint 或 Word 帮忙导出（第一次会询问「是否允许控制」，请点「好」）；',
    '  · 录课暂时只录画面和麦克风，不录电脑播放的声音；',
    '  · 第一次录课时系统会询问「屏幕录制」权限，请在 系统设置 → 隐私与安全性 里允许。',
    '',
  ].join('\n');
  return [
    { name: '安装并打开.command', data: Buffer.from(fix, 'utf8'), mode: 0o100755 },
    { name: '先看我-macOS安装说明.txt', data: Buffer.from(readme, 'utf8'), mode: 0o100644 },
    { name: '许可协议.txt', file: path.join(appRoot, 'LICENSE'), mode: 0o100644 },
  ];
}

function patchPlist(file) {
  let p = fs.readFileSync(file, 'utf8');
  const set = (key, value) => { p = p.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`); };
  set('CFBundleExecutable', 'ClassroomStudio');
  set('CFBundleIdentifier', 'top.yinziapi.classroom');
  set('CFBundleName', NAME);
  set('CFBundleDisplayName', NAME);
  set('CFBundleIconFile', 'icon.icns');
  set('CFBundleShortVersionString', RUNTIME_VERSION);
  set('CFBundleVersion', RUNTIME_VERSION);
  p = p.replace('</dict>\n</plist>', `  <key>NSAppleEventsUsageDescription</key>
  <string>打开 PPT / Word 课件时，请 Keynote、Pages、PowerPoint 或 Word 帮忙导出成 PDF。</string>
  <key>CFBundleURLTypes</key>
  <array><dict><key>CFBundleURLName</key><string>一键导入</string><key>CFBundleURLSchemes</key><array><string>classroom-studio</string></array></dict></array>
  <key>CFBundleDocumentTypes</key>
  <array><dict><key>CFBundleTypeName</key><string>一键导入配置</string><key>CFBundleTypeExtensions</key><array><string>yzimport</string></array><key>CFBundleTypeRole</key><string>Viewer</string></dict></array>
</dict>
</plist>`);
  if (!p.includes('ClassroomStudio') || !p.includes('classroom-studio')) throw new Error('Info.plist 修改没生效');
  fs.writeFileSync(file, p);
}

function writeAppMeta(appDir) {
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'classroom-studio', version, main: 'electron/main.cjs', private: true }, null, 2));
  fs.copyFileSync(path.join(appRoot, 'LICENSE'), path.join(appDir, 'LICENSE.txt'));
  fs.writeFileSync(path.join(appDir, 'bin/FFmpeg-README.txt'), [
    'FFmpeg 静态编译版（GPL v3）。Windows 版来自 https://www.gyan.dev/ffmpeg/builds/ ，macOS 版来自 https://github.com/eugeneware/ffmpeg-static',
    '源代码与协议见 https://ffmpeg.org 。本软件只把它作为独立的录屏合成工具调用。',
    '',
  ].join('\n'));
}

/** 一个平台的收尾：build.json、分块 zip、整包 zip，返回 manifest 用的 components */
async function finishPlatform(key, root, defs, { zipRoot, mode, links = [], extra = [] } = {}) {
  const updateDir = path.join(OUT, 'update');
  fs.mkdirSync(updateDir, { recursive: true });
  const under = (rels) => links.filter((l) => rels.some((r) => l.rel === r || l.rel.startsWith(r + '/')));
  const toEntry = (i) => (i.dir ? { name: i.rel, dir: true } : i.target !== undefined ? { name: i.rel, data: Buffer.from(i.target, 'utf8'), mode: 0o120777 } : { name: i.rel, file: i.file, mode: mode?.(i.rel) ?? 0o644 });
  // 先算好所有块的哈希写进 build.json，app 块里带的 build.json 才是最终的
  const hashes = {};
  for (const d of defs) hashes[d.name] = contentHash([...(await collect(root, d.hashOver || d.paths, links)), ...under(d.hashOver || d.paths)]);
  fs.writeFileSync(path.join(root, key.startsWith('darwin') ? 'Contents/Resources/app/build.json' : 'resources/app/build.json'),
    JSON.stringify({ version, components: Object.fromEntries(Object.entries(hashes).map(([n, hash]) => [n, { hash }])) }, null, 2));
  const components = {};
  for (const d of defs) {
    const items = [...(await collect(root, d.paths, links)), ...under(d.paths)];
    const zipFile = path.join(updateDir, `${key}-${d.name}.zip`);
    log(key, d.name, `打包 ${items.length} 个文件…`);
    let last = 0;
    await writeZip(zipFile, items.map(toEntry), {
      onBytes: (n) => { if (n - last > 200 * 1048576) { last = n; log(key, d.name, Math.round(n / 1048576) + ' MB'); } },
    });
    const gh = GITHUB + `${key}-${d.name}.zip`;
    // 第一个地址给 1.1.x 及更早的软件用（它们按顺序试，国内多数连不上 GitHub 原站）；1.2.0 起会自动展开成全部加速线路并行下
    components[d.name] = { hash: hashes[d.name], size: fs.statSync(zipFile).size, sha256: shaFile(zipFile), chunks: chunkSums(zipFile), urls: [PROXIES[0] + gh, gh, MIRROR + `${key}-${d.name}.zip`], paths: d.paths };
  }
  const full = path.join(OUT, `${NAME}-${version}-${key === 'win32-x64' ? 'win-x64' : 'mac-' + key.split('-')[1]}.zip`);
  log(key, '整包…');
  const all = (await entriesFromDir(root, '')).map((e) => toEntry({ rel: e.name, file: e.file, dir: e.dir }));
  for (const l of links) all.push(toEntry(l));
  for (const e of all) e.name = zipRoot + '/' + e.name;
  await writeZip(full, [...all, ...extra]);
  log(key, '完成', full, Math.round(fs.statSync(full).size / 1048576) + ' MB');
  return components;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  if (!args.includes('--skip-build')) { log('构建前端…'); execFileSync('npm', ['run', 'build'], { cwd: appRoot, stdio: 'inherit', shell: true }); }
  if (!fs.existsSync(path.join(appRoot, 'dist/index.html'))) throw new Error('先 npm run build');

  if (PLATFORMS.some((p) => p.startsWith('darwin'))) {
    const sums = (await (await fetch('https://npmmirror.com/mirrors/electron/44.8.0/SHASUMS256.txt')).text());
    for (const arch of ['arm64', 'x64']) {
      if (!PLATFORMS.includes('darwin-' + arch)) continue;
      const name = `electron-v44.8.0-darwin-${arch}.zip`;
      const want = /^([0-9a-f]{64}) \*(.+)$/gm;
      let m, found = '';
      while ((m = want.exec(sums))) if (m[2].trim() === name) found = m[1];
      if (!found) throw new Error('官方校验清单里没有 ' + name);
      await download('https://npmmirror.com/mirrors/electron/44.8.0/' + name, path.join(CACHE, name), { shasum: found });
      await download(`https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.0/ffmpeg-darwin-${arch}.gz`, path.join(CACHE, `ffmpeg-darwin-${arch}.gz`));
    }
  }

  const platforms = {};
  for (const p of PLATFORMS) platforms[p] = { components: p === 'win32-x64' ? await buildWin() : await buildMac(p.split('-')[1]) };

  // 合并已存在的清单（--only 打一部分时保住其它平台的条目）
  const manifest = { version, date: new Date().toISOString().slice(0, 10), notes: NOTES, page: 'https://classroom.yinziapi.top/#download', platforms: {} };
  const prevFile = path.join(OUT, 'latest.json');
  if (fs.existsSync(prevFile) && only) { try { Object.assign(manifest.platforms, openManifest(fs.readFileSync(prevFile, 'utf8')).platforms); } catch { /* 重打 */ } }
  Object.assign(manifest.platforms, platforms);
  const signed = JSON.stringify(manifest);
  const sig = crypto.sign(null, Buffer.from(signed), fs.readFileSync(KEY_FILE)).toString('base64');
  fs.writeFileSync(prevFile, JSON.stringify({ signed, sig }));
  openManifest(fs.readFileSync(prevFile, 'utf8'));
  log('latest.json 已签名并自检通过');
  // 加速代理名单：放到镜像 /update/mirrors.json 和公开仓库根目录，软件和官网运行时读最新的
  fs.writeFileSync(path.join(OUT, 'mirrors.json'), JSON.stringify({ proxies: PROXIES, browser: BROWSER_PROXIES, updated: manifest.date }, null, 2));
  log('输出目录', OUT);
}

const NOTES = [
  '上课彩排（新）：第一次用跟着走一遍，「5 分钟会上课」7 步或「完整走一遍」22 步；你真的点、真的写，做对了自动打勾，练完的东西自动清掉。帮助 → 上课彩排',
  'AI 整理（新）：卷子照片、Word / PDF、家长微信消息一起丢进来，AI 认出是谁的、是什么，列整理单给你确认，再把题存进收件箱、对错记进学情、家长要求和调课记进档案；整批可撤销',
  '照片拆题更准：拍横了、拍倒了会先转正；一道大题的小问和题干框在一起；收件箱里的题可以删、可以撤销，整次导入也能撤回',
  '板书存 PDF（新）：A4 排版，长黑板自动切页，可选「打印省墨」白底；保存板书里点「存成 PDF」',
  '工具栏可以定制（新）：右键工具栏选要显示的工具，也可以一键换成「讲题常用 / 作图为主 / 全部工具」',
  '打字的内容双击就能接着改；贴上来的图片可以左转、右转、倒转、翻转，第二张会自动找空位放',
  '绘图库新增正棱台、空间直角坐标系；插件画的图形在哪用写清楚了，一键去绘图库',
  'AI 对话框按 Enter 直接发送，Shift+Enter 换行；想要插件直接说，会带到 AI 工坊',
  '官网新增「一图看懂」长图，适合转发给同事；帮助里也有入口',
];

main().catch((e) => { console.error('打包失败：', e.stack || e); process.exit(1); });
