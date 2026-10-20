'use strict';
// 软件更新：查新版本 → 只下载变了的部分 → 校验 → 退出后由小脚本换文件并重新打开。从不强制。
//
// 安装包分成几块（components）：app（界面和主程序，几十 MB）、codex、ffmpeg、runtime（Electron 运行环境）。
// 每块有内容哈希，记在 resources/app/build.json；新版本清单里哈希没变的块不下载。
// 清单 latest.json = {signed:"<JSON 字符串>", sig:"<ed25519 签名>"}，签名用发布者私钥，公钥写在这里，
// 镜像服务器被人改了文件也装不上去。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { cmpVersion } = require('./codexDist.cjs');
const { fastGet, expand, cleanProxies, PROXIES } = require('./fastget.cjs');

const PUBLIC_KEY = 'MCowBQYDK2VwAyEARNUkTZas3hGgS3PI6vDyxt+JCTvvV6MMKK9fsa9bJTI=';
// 所有来源同时问，GitHub 地址还会经各个国内加速代理再问一遍，谁先回来用谁（取版本最高的）
const FEEDS = ['https://classroom.yinziapi.top/update/latest.json', 'https://github.com/ginsonko/classroom-studio/releases/latest/download/latest.json'];
// 最新的加速代理名单（代理常失效，不用发新版就能换）。内容只影响走哪条线路，下载的文件仍按签名清单里的 sha256 校验
const MIRROR_LISTS = ['https://classroom.yinziapi.top/update/mirrors.json', 'https://raw.githubusercontent.com/ginsonko/classroom-studio/main/mirrors.json'];
const PAGE = 'https://classroom.yinziapi.top/#download';
const STAGE = '.update-stage', BACKUP = '.update-backup';

/** 这台电脑上的安装位置。Windows 是 exe 所在文件夹，macOS 是 .app 本身 */
function install({ execPath = process.execPath, platform = process.platform } = {}) {
  if (platform === 'win32') return { root: path.dirname(execPath), launch: execPath, appRel: path.join('resources', 'app') };
  if (platform === 'darwin') { const app = path.resolve(execPath, '../../..'); return { root: app, launch: app, appRel: path.join('Contents', 'Resources', 'app') }; }
  return null;
}

/** 清单验签；不对就当没拿到 */
function openManifest(text, publicKey = PUBLIC_KEY) {
  const outer = JSON.parse(text);
  if (typeof outer?.signed !== 'string' || typeof outer?.sig !== 'string') throw new Error('更新清单格式不对');
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  if (!crypto.verify(null, Buffer.from(outer.signed, 'utf8'), key, Buffer.from(outer.sig, 'base64'))) throw new Error('更新清单签名不对，已忽略');
  const m = JSON.parse(outer.signed);
  if (!/^\d+\.\d+\.\d+$/.test(m?.version || '')) throw new Error('更新清单里的版本号不对');
  return m;
}

/** 一个块该不该下：本机没有记录、哈希不同，都要下 */
function plan(manifest, build, key) {
  const target = manifest.platforms?.[key];
  if (!target) return { ok: false, reason: '这个版本暂时没有适合本机系统的更新包' };
  const parts = Object.entries(target.components || {}).map(([name, c]) => ({ name, ...c }));
  if (!parts.length) return { ok: false, reason: '更新清单里没有更新包' };
  for (const p of parts) {
    if (!Array.isArray(p.paths) || !p.paths.length || !p.sha256 || !Array.isArray(p.urls) || !p.urls.length) return { ok: false, reason: '更新清单不完整' };
    for (const rel of p.paths) if (path.isAbsolute(rel) || rel.split(/[\\/]/).some((s) => s === '..' || s === '')) return { ok: false, reason: '更新清单里有不安全的路径' };
  }
  const need = parts.filter((p) => build?.components?.[p.name]?.hash !== p.hash);
  return { ok: true, need, bytes: need.reduce((s, p) => s + (Number(p.size) || 0), 0), full: target.full || null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 4 << 20 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().slice(0, 400))) : resolve(out))));

function writable(dir) {
  try { const probe = path.join(dir, '.cs-write-probe'); fs.writeFileSync(probe, ''); fs.unlinkSync(probe); return true; } catch { return false; }
}

class Updater {
  /**
   * @param {{appRoot:string, version:string, dataDir:string, fetch:Function, log:any, emit:(m:object)=>void, packaged:boolean,
   *          feeds?:string[], publicKey?:string, execPath?:string, platform?:string, arch?:string}} o
   */
  constructor(o) {
    this.o = o; this.feeds = o.feeds || FEEDS; this.publicKey = o.publicKey || PUBLIC_KEY;
    this.platform = o.platform || process.platform; this.arch = o.arch || process.arch;
    this.where = install({ execPath: o.execPath, platform: this.platform });
    this.state = { phase: 'idle' }; this.manifest = null; this.job = null;
    this.mirrorLists = o.mirrorLists || (o.feeds ? [] : MIRROR_LISTS);
    this.proxies = (o.proxies !== undefined ? o.proxies : cleanProxies(readJSON(this.mirrorCache())?.proxies)) || PROXIES;
  }

  mirrorCache() { return path.join(this.o.dataDir, 'updates', 'mirrors.json'); }

  /** 拉最新的加速代理名单；拿不到就用上次存的或内置的 */
  async refreshMirrors() {
    if (!this.mirrorLists.length) return this.proxies;
    const urls = expand(this.mirrorLists, this.proxies);
    try {
      const list = await Promise.any(urls.map(async (u) => {
        const r = await this.o.fetch(u + '?t=' + Date.now(), { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const p = cleanProxies((await r.json())?.proxies);
        if (!p) throw new Error('名单是空的');
        return p;
      }));
      this.proxies = list;
      fs.mkdirSync(path.dirname(this.mirrorCache()), { recursive: true });
      fs.writeFileSync(this.mirrorCache(), JSON.stringify({ proxies: list, at: new Date().toISOString() }));
    } catch { /* 用现有名单 */ }
    return this.proxies;
  }

  get key() { return `${this.platform}-${this.arch}`; }
  build() { return readJSON(path.join(this.o.appRoot, 'build.json')); }
  set(p) { this.state = { ...this.state, ...p }; this.o.emit({ ...this.state }); return this.state; }

  /** 能不能在软件里一键更新；不能时说清楚原因，界面改成「去官网下载」 */
  autoBlocker() {
    if (!this.o.packaged) return '开发版不能自动更新';
    if (!this.where) return '这个系统暂不支持自动更新';
    if (path.resolve(this.where.root, this.where.appRel) !== path.resolve(this.o.appRoot)) return '安装目录结构和预期不一样';
    if (!this.build()) return '缺少安装信息（build.json），请下载完整安装包';
    if (!writable(this.where.root) || !writable(this.o.appRoot)) return '程序所在的文件夹没有写入权限（比如放在了 Program Files），请下载完整安装包';
    return '';
  }

  /** 所有来源同时问：第一个合格的回来后再等 1.5 秒，取其中版本最高的（防止某个镜像还没同步到新版本） */
  async fetchManifest() {
    const urls = this.o.feeds ? this.feeds : expand(this.feeds, this.proxies);
    const errs = [], got = [];
    await new Promise((resolve) => {
      let left = urls.length, grace = null;
      const settle = () => { if (--left === 0) resolve(); };
      for (const url of urls) {
        (async () => {
          const r = await this.o.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(12000) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          got.push({ manifest: openManifest(await r.text(), this.publicKey), from: new URL(url).host });
          if (!grace) grace = setTimeout(resolve, 1500);
        })().catch((e) => errs.push(new URL(url).host + '：' + e.message)).finally(settle);
      }
    });
    if (!got.length) throw new Error('查不到新版本（' + errs.slice(0, 4).join('；') + '）');
    return got.sort((a, b) => cmpVersion(b.manifest.version, a.manifest.version))[0];
  }

  /** 查新版本。manual=false 是启动后的静默检查，出错不打扰 */
  async check({ manual = false } = {}) {
    if (this.job) return this.state;
    if (['downloading', 'ready'].includes(this.state.phase)) return this.state;
    this.set({ phase: 'checking', error: '', manual });
    try {
      const { manifest, from } = await this.fetchManifest();
      this.manifest = manifest;
      const current = this.o.version, newer = cmpVersion(manifest.version, current) > 0;
      const blocker = this.autoBlocker(), p = plan(manifest, this.build(), this.key);
      const info = {
        current, latest: manifest.version, date: manifest.date || '', notes: Array.isArray(manifest.notes) ? manifest.notes.slice(0, 30).map(String) : [],
        page: manifest.page || PAGE, from, checkedAt: Date.now(),
        auto: newer && !blocker && p.ok, reason: blocker || (p.ok ? '' : p.reason),
        bytes: p.ok ? p.bytes : 0, parts: p.ok ? p.need.map((x) => x.name) : [], full: p.full,
      };
      this.o.log?.info('检查更新', current, '→', manifest.version, from, info.auto ? '可一键更新' : info.reason || '已是最新');
      return this.set({ phase: newer ? 'available' : 'latest', info });
    } catch (e) {
      this.o.log?.warn('检查更新失败', e.message);
      return this.set({ phase: manual ? 'error' : 'idle', error: e.message });
    }
  }

  stageDir() { return path.join(this.where.root, STAGE); }

  async download() {
    if (this.job) return this.job;
    this.job = this.doDownload().finally(() => { this.job = null; });
    return this.job;
  }

  async doDownload() {
    const m = this.manifest, info = this.state.info;
    if (!m || !info?.auto) throw new Error(info?.reason || '请先检查更新');
    const blocker = this.autoBlocker(); if (blocker) throw new Error(blocker);
    const p = plan(m, this.build(), this.key); if (!p.ok) throw new Error(p.reason);
    const dir = path.join(this.stageDir(), m.version), files = path.join(dir, 'files');
    // 同一版本上次没下完的保留（断点续传），别的版本清掉
    for (const old of fs.existsSync(this.stageDir()) ? fs.readdirSync(this.stageDir()) : []) if (old !== m.version) fs.rmSync(path.join(this.stageDir(), old), { recursive: true, force: true });
    fs.mkdirSync(files, { recursive: true });
    const doneFile = path.join(dir, 'done.json'), finished = readJSON(doneFile) || {};
    const total = p.bytes || 0; let done = 0;
    this.set({ phase: 'downloading', got: 0, total, error: '' });
    await this.refreshMirrors();
    try {
      for (const part of p.need) {
        if (finished[part.name] === part.sha256 && part.paths.every((rel) => fs.existsSync(path.join(files, rel)))) { done += Number(part.size) || 0; continue; }
        const zip = path.join(dir, part.name + '.zip');
        await this.fetchFile(part, zip, (n) => this.set({ got: done + n, total, part: part.name }));
        done += Number(part.size) || 0;
        this.set({ phase: 'downloading', got: done, part: part.name, note: '解压…' });
        await this.extract(zip, files);
        fs.rmSync(zip, { force: true });
        for (const rel of part.paths) if (!fs.existsSync(path.join(files, rel))) throw new Error(`更新包「${part.name}」里缺少 ${rel}`);
        finished[part.name] = part.sha256; fs.writeFileSync(doneFile, JSON.stringify(finished));
      }
      const paths = p.need.flatMap((x) => x.paths);
      fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ version: m.version, paths }, null, 2));
      this.o.log?.info('更新已下载', m.version, p.need.map((x) => x.name).join(','), Math.round(total / 1048576) + 'MB');
      return this.set({ phase: 'ready', note: '', dir, paths });
    } catch (e) {
      // 下了一半的留着，下次接着下；只有校验不通过的文件已在下载器里删掉
      this.o.log?.warn('下载更新失败', e.message);
      this.set({ phase: 'available', error: '下载更新失败：' + e.message, note: '' });
      throw e;
    }
  }

  /** 多线路分段下载（见 fastget.cjs）；校验不过就整块重下一次 */
  async fetchFile(part, file, onBytes) {
    const go = () => fastGet({ urls: part.urls, size: Number(part.size) || 0, sha256: part.sha256, file, fetch: this.o.fetch, proxies: this.proxies, onBytes, chunkSize: part.chunks?.size, chunkSums: part.chunks?.sha256, log: this.o.log, ...(this.o.fastget || {}) });
    try { return await go(); } catch (e) {
      if (!/校验不通过/.test(e.message)) throw e;
      return go();
    }
  }

  async extract(zip, dest) {
    if (this.platform === 'win32') {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      // -m：exFAT 等盘上恢复修改时间会失败并让 tar 整体报错退出
      await run(fs.existsSync(tar) ? tar : 'tar', ['-xmf', zip, '-C', dest]);
    } else await run('/usr/bin/ditto', ['-x', '-k', zip, dest]);
  }

  /** 写好换文件的脚本并在后台启动；调用方随后退出软件 */
  launchApply() {
    if (this.state.phase !== 'ready') throw new Error('更新还没下载好');
    const { dir, paths } = this.state, w = this.where, m = this.manifest;
    const job = {
      pid: process.pid, root: w.root, stage: path.join(dir, 'files'), backup: path.join(w.root, BACKUP),
      paths, launch: w.launch, from: this.o.version, to: m.version, result: path.join(this.o.dataDir, 'updates', 'result.json'),
    };
    fs.mkdirSync(path.dirname(job.result), { recursive: true });
    fs.rmSync(job.result, { force: true });
    fs.rmSync(job.backup, { recursive: true, force: true });
    const planFile = path.join(dir, 'apply.json');
    fs.writeFileSync(planFile, JSON.stringify(job, null, 2));
    let child;
    if (this.platform === 'win32') {
      const ps1 = path.join(dir, 'apply.ps1');
      // PowerShell 5.1 按 BOM 认 UTF-8，路径里有中文
      fs.writeFileSync(ps1, '\ufeff' + WIN_SCRIPT, 'utf8');
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      // 直接 detached 启动的 PowerShell 没有控制台会立刻退出，不 detached 又会跟着软件一起被关掉；
      // 经 cmd 的 start /b 转一手，脚本才能在软件退出后继续跑
      const args = [fs.existsSync(ps) ? ps : 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1, '-PlanPath', planFile];
      const line = 'start "" /b ' + args.map((a) => '"' + a + '"').join(' ');
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + line + '"'], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
    } else {
      const sh = path.join(dir, 'apply.sh');
      fs.writeFileSync(sh, MAC_SCRIPT, { mode: 0o755 });
      child = spawn('/bin/bash', [sh, planFile], { detached: true, stdio: 'ignore' });
    }
    child.unref();
    this.o.log?.info('开始安装更新', job.from, '→', job.to);
    return job;
  }

  /** 启动时看上次更新的结果，清理临时文件 */
  takeResult() {
    const file = path.join(this.o.dataDir, 'updates', 'result.json'), r = readJSON(file);
    if (!r) return null;
    fs.rmSync(file, { force: true });
    if (this.where) for (const d of [STAGE, BACKUP]) fs.rmSync(path.join(this.where.root, d), { recursive: true, force: true });
    this.o.log?.[r.ok ? 'info' : 'warn']('上次更新', r.from, '→', r.to, r.ok ? '成功' : r.error);
    return r;
  }
}

// 等主程序退出 → 把要换的路径挪进备份 → 新文件挪进来；任何一步失败都按原路挪回去。
// 同一个盘内挪动（暂存和备份都在安装目录里）是瞬间完成的，杀毒软件占用时多试几次。
const WIN_SCRIPT = String.raw`param([string]$PlanPath)
$ErrorActionPreference = 'Stop'
$logFile = Join-Path (Split-Path -Parent $PlanPath) 'apply.log'
function L([string]$t) { Add-Content -LiteralPath $logFile -Value ((Get-Date).ToString('HH:mm:ss.fff') + ' ' + $t) -Encoding UTF8 }
L 'start'
$p = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
for ($i = 0; $i -lt 240 -and (Get-Process -Id $p.pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
L 'app exited'
Start-Sleep -Milliseconds 1200
function Retry([scriptblock]$Do) { for ($i = 0; $i -lt 40; $i++) { try { & $Do; return } catch { if ($i -eq 39) { throw } ; Start-Sleep -Milliseconds 500 } } }
$moved = New-Object System.Collections.ArrayList
$result = [ordered]@{ ok = $false; from = $p.from; to = $p.to; at = (Get-Date).ToString('o') }
try {
  foreach ($rel in $p.paths) {
    $target = Join-Path $p.root $rel; $src = Join-Path $p.stage $rel; $bak = Join-Path $p.backup $rel
    $had = Test-Path -LiteralPath $target
    if ($had) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bak) | Out-Null; Retry { Move-Item -LiteralPath $target -Destination $bak -Force } }
    [void]$moved.Add(@{ rel = $rel; had = $had; placed = $false })
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Retry { Move-Item -LiteralPath $src -Destination $target -Force }
    $moved[$moved.Count - 1].placed = $true
    L ('placed ' + $rel)
  }
  $result.ok = $true
} catch {
  $result.error = $_.Exception.Message
  L ('failed: ' + $result.error)
  for ($i = $moved.Count - 1; $i -ge 0; $i--) {
    $m = $moved[$i]; $target = Join-Path $p.root $m.rel; $bak = Join-Path $p.backup $m.rel
    try {
      if ($m.placed -and (Test-Path -LiteralPath $target)) { Retry { Remove-Item -LiteralPath $target -Recurse -Force } }
      if ($m.had) { Retry { Move-Item -LiteralPath $bak -Destination $target -Force } }
    } catch { $result.rollback = 'failed: ' + $_.Exception.Message }
  }
}
$json = $result | ConvertTo-Json -Compress
[IO.File]::WriteAllText($p.result, $json, (New-Object Text.UTF8Encoding $false))
L ('done ' + $json)
Start-Process -FilePath $p.launch -WorkingDirectory $p.root
`;

const MAC_SCRIPT = String.raw`#!/bin/bash
PLAN="$1"
j() { /usr/bin/plutil -extract "$1" raw -o - "$PLAN"; }
PID=$(j pid); ROOT=$(j root); STAGE=$(j stage); BACKUP=$(j backup); LAUNCH=$(j launch); FROM=$(j from); TO=$(j to); RESULT=$(j result)
N=$(/usr/bin/plutil -extract paths raw -o - "$PLAN")
for i in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
sleep 1
OK=1; ERR=""; DONE=()
for ((i = 0; i < N; i++)); do
  REL=$(j "paths.$i")
  if [ -e "$ROOT/$REL" ]; then mkdir -p "$(dirname "$BACKUP/$REL")" && mv "$ROOT/$REL" "$BACKUP/$REL" || { OK=0; ERR="备份 $REL 失败"; break; }; HAD=1; else HAD=0; fi
  mkdir -p "$(dirname "$ROOT/$REL")"
  if mv "$STAGE/$REL" "$ROOT/$REL"; then DONE+=("$HAD:$REL"); else OK=0; ERR="放入 $REL 失败"; [ $HAD = 1 ] && mv "$BACKUP/$REL" "$ROOT/$REL"; break; fi
done
if [ $OK = 0 ]; then
  for ((k = ${"$"}{#DONE[@]} - 1; k >= 0; k--)); do E="${"$"}{DONE[$k]}"; H="${"$"}{E%%:*}"; R="${"$"}{E#*:}"; rm -rf "$ROOT/$R"; [ "$H" = 1 ] && mv "$BACKUP/$R" "$ROOT/$R"; done
fi
/usr/bin/codesign --force --deep --sign - "$ROOT" >/dev/null 2>&1 || true
/usr/bin/xattr -dr com.apple.quarantine "$ROOT" >/dev/null 2>&1 || true
if [ $OK = 1 ]; then printf '{"ok":true,"from":"%s","to":"%s"}' "$FROM" "$TO" > "$RESULT"; else printf '{"ok":false,"from":"%s","to":"%s","error":"%s"}' "$FROM" "$TO" "$ERR" > "$RESULT"; fi
/usr/bin/open -n "$LAUNCH"
`;

module.exports = { Updater, openManifest, plan, install, FEEDS, PUBLIC_KEY, WIN_SCRIPT, MAC_SCRIPT };
