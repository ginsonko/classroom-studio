'use strict';
// 软件独立的 Codex 配置目录与 Windows 安全沙箱预热：
// 1. 工坊和小羽统一使用软件数据目录下的 codex-home，不再读写老师电脑上的 ~/.codex（避免混入全局指令/技能/配置，也不读取任何外部 Key）。
// 2. Windows 上 Codex 0.163 若配置缺少 [windows] sandbox，会把 workspace-write 静默降为 read-only 导致写不出文件；
//    这里自动写入 [windows] sandbox = "elevated"。
// 3. 新配置目录首次初始化 Windows 沙箱约需 3～5 分钟：改成安装后 / 首次启动后台预热（跑一条零模型消耗的本地沙箱命令），
//    向界面实时推送进度；若老师在预热完成前发起任务，任务里同步显示进度并在就绪后自动开跑。
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const READY_FILE = '.cs-sandbox-ready.json';
const PREWARM_TIMEOUT_MS = 10 * 60 * 1000;

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGKILL');
}

/** 确保指定 CODEX_HOME 目录存在且写好隔离配置（绝不读取或复制用户 ~/.codex） */
function ensureCodexConfig(dir, { platform = process.platform, winSandbox = process.env.CS_CODEX_WIN_SANDBOX || 'elevated' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.toml');
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch { cur = ''; }
  if (platform === 'win32') {
    const want = `sandbox = ${JSON.stringify(winSandbox)}`;
    if (!/^\s*\[windows\]/m.test(cur)) {
      const prefix = cur.trim() ? cur.trimEnd() + '\n\n' : '# 最强网课教辅系统独立 Codex 配置（与本机 ~/.codex 隔离）\n';
      fs.writeFileSync(file, `${prefix}[windows]\n${want}\n`);
    } else if (!/^\s*sandbox\s*=/m.test(cur)) {
      fs.writeFileSync(file, cur.replace(/^\s*\[windows\]\s*$/m, `[windows]\n${want}`));
    }
  } else if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# 最强网课教辅系统独立 Codex 配置（与本机 ~/.codex 隔离）\n');
  }
  return dir;
}

class CodexHome {
  /**
   * @param {{dir: string, locate?: () => any, log?: any, emit?: (s: any) => void, platform?: string, winSandbox?: string, spawn?: Function, tickMs?: number, allowOverride?: boolean, timeoutMs?: number}} o
   */
  constructor(o) {
    this.dir = path.resolve(o.dir);
    this.locate = o.locate || (() => null);
    this.log = o.log;
    this.emitRaw = o.emit || (() => {});
    this.platform = o.platform || process.platform;
    this.winSandbox = o.winSandbox || process.env.CS_CODEX_WIN_SANDBOX || 'elevated';
    this.spawn = o.spawn || spawn;
    this.tickMs = Number(o.tickMs) > 0 ? Number(o.tickMs) : 4000;
    this.allowOverride = !!o.allowOverride;
    this.timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : PREWARM_TIMEOUT_MS;
    this.markerFile = path.join(this.dir, READY_FILE);
    this.listeners = new Set();
    this.job = null;
    this.ensureConfig();
    const ready = this.isReady();
    this.state = {
      phase: ready ? 'ready' : 'idle',
      step: ready ? 'AI 安全运行环境已就绪' : '',
      pct: ready ? 100 : 0,
      elapsedSec: 0,
      startedAt: 0,
      error: '',
    };
  }

  ensureConfig() {
    return ensureCodexConfig(this.dir, { platform: this.platform, winSandbox: this.winSandbox });
  }

  isReady() {
    if (this.platform !== 'win32') return true;
    try {
      const j = JSON.parse(fs.readFileSync(this.markerFile, 'utf8'));
      return !!(j && j.ok === true && j.sandbox === this.winSandbox);
    } catch { return false; }
  }

  view() {
    return { ...this.state, ready: this.state.phase === 'ready', home: this.dir.replace(/\\/g, '/') };
  }

  onProgress(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(patch) {
    Object.assign(this.state, patch);
    const v = this.view();
    try { this.emitRaw(v); } catch { /* 通知失败不影响预热 */ }
    for (const fn of [...this.listeners]) { try { fn(v); } catch { /* 单个监听报错忽略 */ } }
    return v;
  }

  /**
   * 后台预热 Windows 沙箱（零模型调用、不花钱）：用 codex sandbox 在临时目录跑一条写文件探测命令。
   * 多次同时调用会共用同一个 Promise。
   */
  prewarm({ reason = 'startup', force = false } = {}) {
    this.ensureConfig();
    if (!force && this.isReady()) {
      if (this.state.phase !== 'ready') this.update({ phase: 'ready', pct: 100, step: 'AI 安全运行环境已就绪', error: '' });
      return Promise.resolve({ ok: true, cached: true });
    }
    if (this.job) return this.job;
    const spec = this.locate();
    if (!spec) {
      this.update({ phase: 'idle', pct: 0, step: '尚未安装 Codex', error: '' });
      return Promise.resolve({ ok: false, missing: true });
    }
    if (spec.where === 'override' && !this.allowOverride) {
      this.update({ phase: 'ready', pct: 100, step: '测试环境跳过沙箱预热', error: '' });
      return Promise.resolve({ ok: true, skipped: true });
    }
    const probeDir = path.join(this.dir, 'warmup-probe');
    const probeFile = path.join(probeDir, 'probe.txt');
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch { /* 忽略残留 */ }
    fs.mkdirSync(probeDir, { recursive: true });
    const t0 = Date.now();
    this.log?.info?.('Codex 沙箱预热开始', reason, this.dir);
    this.update({
      phase: 'running',
      step: '正在后台准备 AI 安全运行环境（首次使用仅需一次，约 3～5 分钟）…',
      pct: 6,
      elapsedSec: 0,
      startedAt: t0,
      error: '',
    });

    this.job = new Promise((resolve) => {
      let errTail = '', settled = false;
      const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      const args = [...(spec.pre || []), 'sandbox', '-c', 'sandbox_mode="workspace-write"', '--', cmdExe, '/d', '/c', 'echo cs-sandbox-ok>probe.txt'];
      const env = { ...process.env, ...(spec.env || {}), CODEX_HOME: this.dir };
      let child;
      try {
        child = this.spawn(spec.cmd, args, { cwd: probeDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const msg = '启动沙箱初始化失败：' + (e.message || e);
        this.log?.warn?.('Codex 沙箱预热失败', msg);
        this.update({ phase: 'failed', step: msg, error: msg });
        this.job = null;
        resolve({ ok: false, error: msg });
        return;
      }
      const tick = setInterval(() => {
        const elapsedSec = Math.max(1, Math.round((Date.now() - t0) / 1000));
        const pct = Math.min(92, 8 + Math.round(84 * (1 - Math.exp(-elapsedSec / 120))));
        this.update({
          phase: 'running',
          elapsedSec,
          pct,
          step: `正在准备 AI 安全运行环境（首次使用约 3～5 分钟，已进行 ${elapsedSec} 秒）…`,
        });
      }, this.tickMs);
      tick.unref?.();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        killTree(child);
        const msg = '准备安全环境超时（超过 ' + Math.round(this.timeoutMs / 60000) + ' 分钟）';
        this.log?.warn?.('Codex 沙箱预热超时', msg);
        this.update({ phase: 'failed', step: msg, error: msg });
        this.job = null;
        resolve({ ok: false, error: msg });
      }, this.timeoutMs);
      timer.unref?.();
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (c) => { errTail = (errTail + c).slice(-1500); });
      const done = (code, spawnErr) => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        clearTimeout(timer);
        const elapsedSec = Math.round((Date.now() - t0) / 1000);
        const wrote = fs.existsSync(probeFile);
        try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch { /* 稍后清 */ }
        if (!spawnErr && code === 0 && wrote) {
          try {
            fs.writeFileSync(this.markerFile, JSON.stringify({ ok: true, at: new Date().toISOString(), sandbox: this.winSandbox, version: spec.version || '', elapsedSec }, null, 2));
          } catch { /* 标记写入失败下次再试 */ }
          this.log?.info?.('Codex 沙箱预热完成', elapsedSec + 's');
          this.update({ phase: 'ready', pct: 100, elapsedSec, step: 'AI 安全运行环境已就绪', error: '' });
          this.job = null;
          resolve({ ok: true, elapsedSec });
          return;
        }
        const raw = spawnErr ? String(spawnErr.message || spawnErr) : errTail.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 240);
        const msg = `安全运行环境没有准备好${raw ? '（' + raw + '）' : code ? '（退出码 ' + code + '）' : !wrote ? '（探测文件未能写入，可能是磁盘格式不支持 Windows 权限控制）' : ''}`;
        this.log?.warn?.('Codex 沙箱预热未通过', msg);
        this.update({ phase: 'failed', elapsedSec, step: msg, error: msg });
        this.job = null;
        resolve({ ok: false, error: msg });
      };
      child.on('error', (e) => done(1, e));
      child.on('close', (code) => done(code, null));
    });
    return this.job;
  }
}

module.exports = { CodexHome, ensureCodexConfig, READY_FILE };
