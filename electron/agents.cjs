'use strict';
// 后台 AI 任务中心：在每个任务自己的文件夹里无界面地运行 Codex CLI / Claude Code，
// 实时转发进度、记账、到额度自动停止。只在主进程运行，Key 只经环境变量交给子进程。
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const { stageCodex, latestVersion, cmpVersion, dirVersion, codexBin } = require('./codexDist.cjs');
const kit = require('./agentKit.cjs');

const ENGINES = { codex: 'Codex CLI', claude: 'Claude Code' };
const PACKAGES = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' };
const TURN_LIMIT_MS = 30 * 60 * 1000;
const KEEP_EVENTS = 400;
// 权限：safe 只读写任务文件夹；full（默认）再允许运行命令、联网查资料；danger 完全访问（不限目录、不再询问）
const PERMISSIONS = ['safe', 'full', 'danger'];
const PERMISSION_NAME = { safe: '安全模式', full: '常用权限', danger: '完全访问' };
const SAFE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite'];
const FULL_TOOLS = [...SAFE_TOOLS, 'Bash', 'WebSearch', 'WebFetch', 'NotebookEdit'];
const KEY_ENV = 'CS_RELAY_API_KEY';
const toml = (s) => JSON.stringify(String(s));

const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';
// 从「访达」打开的 macOS 程序只拿到很短的 PATH，Homebrew / npm 装的命令要自己补上
const EXTRA_PATH = WIN ? [] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin')];
if (!WIN) process.env.PATH = [...new Set([...String(process.env.PATH || '').split(':'), ...EXTRA_PATH])].filter(Boolean).join(':');

function findOnPath(name) {
  for (const dir of [...String(process.env.PATH || '').split(path.delimiter), ...EXTRA_PATH]) {
    if (!dir) continue;
    const p = path.join(dir.replace(/^"|"$/g, ''), name);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* 下一个 */ }
  }
  return '';
}

function npmRoot() {
  if (WIN) return path.join(process.env.APPDATA || '', 'npm', 'node_modules');
  return ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', path.join(os.homedir(), '.npm-global', 'lib', 'node_modules')].find((d) => fs.existsSync(d)) || '/usr/local/lib/node_modules';
}

/** 安装包里内置的 Codex CLI（bin/codex）；CS_BUNDLED_CODEX 给测试指定别的目录 */
function bundledCodexDir() {
  return process.env.CS_BUNDLED_CODEX !== undefined ? process.env.CS_BUNDLED_CODEX : path.join(__dirname, '..', 'bin', 'codex');
}

const pkgVersion = (file) => { try { return String(JSON.parse(fs.readFileSync(file, 'utf8')).version || ''); } catch { return ''; } };
const viaNode = (script) => {
  const node = findOnPath('node' + EXE);
  return node ? { cmd: node, pre: [script], env: {} } : { cmd: process.execPath, pre: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
};
const exeSpec = (cmd, where, ver = '') => ({ cmd, pre: [], env: {}, where, version: ver });

/** 老师自己装的：npm 全局、PATH 里的、Codex 桌面版、Claude 官方安装程序 */
function userSpecs(engine) {
  const out = [];
  if (engine === 'codex') {
    const js = path.join(npmRoot(), '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(js)) out.push({ ...viaNode(js), where: 'local', version: pkgVersion(path.join(npmRoot(), '@openai', 'codex', 'package.json')) });
    for (const exe of [findOnPath('codex' + EXE), ...(WIN ? [path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin', 'codex.exe')] : [])]) if (exe && fs.existsSync(exe)) { out.push(exeSpec(exe, 'local')); break; }
  } else if (engine === 'claude') {
    const pkg = path.join(npmRoot(), '@anthropic-ai', 'claude-code'), ver = pkgVersion(path.join(pkg, 'package.json'));
    if (fs.existsSync(path.join(pkg, 'bin', 'claude' + EXE))) out.push(exeSpec(path.join(pkg, 'bin', 'claude' + EXE), 'local', ver));
    else if (fs.existsSync(path.join(pkg, 'cli.js'))) out.push({ ...viaNode(path.join(pkg, 'cli.js')), where: 'local', version: ver });
    for (const exe of [findOnPath('claude' + EXE), path.join(os.homedir(), '.local', 'bin', 'claude' + EXE)]) if (exe && fs.existsSync(exe)) { out.push(exeSpec(exe, 'local')); break; }
  }
  return out;
}

/** 导播台带的 Codex：内置的那份，以及之后在导播台里更新下载的（toolsDir/codex/<版本>） */
function shippedSpecs(engine, toolsDir) {
  if (engine !== 'codex') return [];
  const out = [], bundled = bundledCodexDir(), bv = dirVersion(bundled);
  if (bv) out.push(exeSpec(codexBin(bundled), 'bundled', bv));
  const root = toolsDir ? path.join(toolsDir, 'codex') : '';
  let names = []; try { names = root ? fs.readdirSync(root) : []; } catch { /* 没更新过 */ }
  for (const n of names) { const v = dirVersion(path.join(root, n)); if (v && v === n) out.push(exeSpec(codexBin(path.join(root, n)), 'private', v)); }
  return out;
}

/**
 * 找到可执行入口：{ cmd, pre, env, where, version }。版本最新的优先；同版本时老师自己装的优先
 * （登录、配置都在他自己的环境里），其次是导播台更新下载的，最后是内置的。
 * CS_AGENT_<ENGINE> 用于测试时指定假的 CLI 脚本。
 */
function locate(engine, toolsDir) {
  const override = process.env['CS_AGENT_' + engine.toUpperCase()];
  if (override) return /\.(c|m)?js$/.test(override) ? { ...viaNode(override), where: 'override', version: '' } : exeSpec(override, 'override');
  const shipped = shippedSpecs(engine, toolsDir);
  const all = [...userSpecs(engine), ...shipped.filter((s) => s.where === 'private'), ...shipped.filter((s) => s.where === 'bundled')];
  return all.sort((a, b) => cmpVersion(b.version, a.version))[0] || null;
}

function version(spec) {
  return new Promise((resolve) => {
    execFile(spec.cmd, [...spec.pre, '--version'], { timeout: 15000, windowsHide: true, env: { ...process.env, ...spec.env } }, (err, out) => {
      resolve(err ? '' : String(out).trim().split(/\r?\n/).pop().slice(0, 60));
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGKILL');
}

const NOTICE = /ignoring \d+ unrecognized|unrecognized configuration|Under-development features|deprecated|suppress_unstable|warning/i;
const clip = (s, n = 4000) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };

const cleanFormats = (f) => [...new Set((Array.isArray(f) ? f : []).filter((k) => ['docx', 'pdf', 'pptx'].includes(k)))];

function codexHome() { return process.env.CODEX_HOME || path.join(os.homedir(), '.codex'); }

/** Codex 每个会话都会写一份 rollout 日志，里面有实时的累计用量和实际使用的模型 */
function findRollout(id) {
  if (!/^[\w-]{3,80}$/.test(String(id || ''))) return '';
  const root = path.join(codexHome(), 'sessions'), pad = (n) => String(n).padStart(2, '0');
  for (let k = 0; k < 8; k++) {
    const d = new Date(Date.now() - k * 864e5), dir = path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
    try { const f = fs.readdirSync(dir).find((n) => n.endsWith(id + '.jsonl')); if (f) return path.join(dir, f); } catch { /* 这天没有 */ }
  }
  return '';
}

/** 从 pos 开始读 rollout 新增的完整行：最新累计用量、模型名 */
function readRollout(file, pos) {
  let size; try { size = fs.statSync(file).size; } catch { return null; }
  if (size <= pos) return { pos };
  const start = Math.max(pos, size - 16 * 1024 * 1024), buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const end = buf.lastIndexOf(10);
  if (end < 0) return { pos };
  const out = { pos: start + end + 1 };
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line.includes('"token_count"') && !line.includes('"turn_context"')) continue;
    try {
      const j = JSON.parse(line), p = j.payload || {};
      if (p.type === 'token_count' && p.info?.total_token_usage) out.total = p.info.total_token_usage;
      else if (j.type === 'turn_context' && p.model) out.model = String(p.model).slice(0, 80);
    } catch { /* 半行或坏行 */ }
  }
  return out;
}

const tok = (u) => ({ input_tokens: Number(u?.input_tokens) || 0, cached_input_tokens: Number(u?.cached_input_tokens) || 0, output_tokens: Number(u?.output_tokens) || 0 });

/** 累计用量 → 相对已记账部分的增量（账本格式：input 不含缓存命中） */
function usageSince(total, seen) {
  const a = tok(total), b = tok(seen);
  const fresh = a.input_tokens < b.input_tokens || a.cached_input_tokens < b.cached_input_tokens || a.output_tokens < b.output_tokens;
  const d = fresh ? a : { input_tokens: a.input_tokens - b.input_tokens, cached_input_tokens: a.cached_input_tokens - b.cached_input_tokens, output_tokens: a.output_tokens - b.output_tokens };
  return { input: Math.max(0, d.input_tokens - d.cached_input_tokens), cached: d.cached_input_tokens, output: d.output_tokens };
}
/** 把 Codex `exec --json` 的一行事件翻译成界面事件；usage 单独返回给记账 */
function readCodex(j) {
  const out = { events: [] };
  const it = j.item || {};
  switch (j.type) {
    case 'thread.started': out.session = j.thread_id; break;
    case 'turn.completed': out.usage = j.usage; out.turnDone = true; break;
    case 'turn.failed': out.events.push({ kind: 'error', text: j.error?.message || '这一轮失败了' }); out.turnDone = true; out.failed = true; break;
    // Codex 把配置提醒也当作 error 事件发出来（例如「ignoring unrecognized configuration」），这些不是任务出错
    case 'error': out.events.push({ kind: NOTICE.test(j.message || '') ? 'note' : 'error', text: j.message || '出错' }); break;
    case 'item.started':
      if (it.type === 'command_execution') out.events.push({ kind: 'cmd', text: clip(it.command, 300) });
      break;
    case 'item.completed':
      if (it.type === 'agent_message') out.events.push({ kind: 'text', text: clip(it.text) });
      else if (it.type === 'reasoning') out.events.push({ kind: 'think', text: clip(it.text, 600) });
      else if (it.type === 'command_execution' && it.exit_code) out.events.push({ kind: 'error', text: `命令退出码 ${it.exit_code}：${clip(it.command, 160)}` });
      else if (it.type === 'file_change') out.events.push({ kind: 'file', text: (it.changes || []).map((c) => `${c.kind === 'add' ? '新建' : c.kind === 'delete' ? '删除' : '修改'} ${path.basename(String(c.path || ''))}`).join('，') || '修改文件' });
      else if (it.type === 'todo_list') out.events.push({ kind: 'plan', text: (it.items || []).map((x) => (x.completed ? '✓ ' : '· ') + x.text).join('\n') });
      else if (it.type === 'web_search') out.events.push({ kind: 'tool', text: '搜索：' + clip(it.query, 200) });
      else if (it.type === 'mcp_tool_call') out.events.push({ kind: 'tool', text: '工具：' + (it.tool || it.server || '') });
      // Codex 把老师本机 config.toml 的配置提醒也当 error 项发出来，任务本身不受影响
      else if (it.type === 'error') out.events.push(/ignoring .*configuration setting|Under-development features|deprecated/i.test(String(it.message || '')) ? { kind: 'note', text: clip(it.message, 300) } : { kind: 'error', text: clip(it.message, 600) });
      break;
    default: break;
  }
  return out;
}

function toolLine(b) {
  const i = b.input || {};
  const what = i.file_path || i.path || i.command || i.pattern || i.url || i.description || '';
  return `${b.name}${what ? '：' + clip(path.basename(String(what)) === String(what) ? what : String(what), 200) : ''}`;
}

/** Claude Code `--output-format stream-json` 的一行事件 */
function readClaude(j) {
  const out = { events: [] };
  if (j.type === 'system' && j.subtype === 'init') { out.session = j.session_id; out.model = j.model; }
  else if (j.type === 'assistant') {
    for (const b of j.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) out.events.push({ kind: 'text', text: clip(b.text) });
      else if (b.type === 'tool_use' && /Write|Edit/.test(b.name)) out.events.push({ kind: 'file', text: `${b.name === 'Write' ? '新建' : '修改'} ${path.basename(String(b.input?.file_path || b.input?.path || '文件'))}` });
      else if (b.type === 'tool_use') out.events.push({ kind: b.name === 'Bash' ? 'cmd' : 'tool', text: toolLine(b) });
      else if (b.type === 'thinking' && b.thinking) out.events.push({ kind: 'think', text: clip(b.thinking, 600) });
    }
  } else if (j.type === 'result') {
    out.turnDone = true;
    out.session = j.session_id;
    const u = j.usage || {};
    out.usage = { input_tokens: (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0), cached_input_tokens: Number(u.cache_read_input_tokens) || 0, output_tokens: Number(u.output_tokens) || 0, separateCached: true };
    if (Number.isFinite(j.total_cost_usd)) out.usd = j.total_cost_usd;
    if (j.is_error || (j.subtype && j.subtype !== 'success')) { out.failed = true; out.events.push({ kind: 'error', text: j.subtype === 'error_max_budget_usd' ? '达到本任务的花费上限，已停止' : clip(j.result || j.subtype || '任务出错', 600) }); }
  }
  return out;
}

class Agents {
  constructor({ dir, ledger, credentials, log, emit, exporter, onCharge, toolsDir, fetch: fetchFn }) {
    this.dir = dir;
    this.toolsDir = toolsDir || '';
    this.fetch = fetchFn || ((...a) => fetch(...a));
    this.onCharge = onCharge || (() => {});
    this.ledger = ledger;
    this.credentials = credentials;
    this.log = log;
    this.emit = emit || (() => {});
    this.exporter = exporter || null;
    this.tasks = new Map();
    fs.mkdirSync(dir, { recursive: true });
    for (const id of fs.readdirSync(dir)) {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, id, 'task.json'), 'utf8'));
        // 上次关闭时还在跑的任务，进程已经不在了
        if (t.status === 'running') { t.status = 'stopped'; t.note = '导播台关闭时中断，可以继续'; }
        t.exporting = false;
        t.events = this.readEvents(t.id); t.queue = [];
        this.tasks.set(t.id, t);
      } catch { /* 不是任务目录 */ }
    }
  }

  readEvents(id) {
    try { return fs.readFileSync(path.join(this.dir, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-KEEP_EVENTS).map((l) => JSON.parse(l)); } catch { return []; }
  }

  async detect() {
    const out = {};
    for (const engine of Object.keys(ENGINES)) {
      const spec = locate(engine, this.toolsDir);
      out[engine] = {
        name: ENGINES[engine], found: !!spec, version: spec ? await version(spec) : '', pkg: PACKAGES[engine],
        where: spec?.where || '', bundled: shippedSpecs(engine, this.toolsDir).find((s) => s.where === 'bundled')?.version || '',
        // 没有 npm 时 Claude Code 走 Anthropic 官方安装程序
        native: engine === 'claude' && process.platform === 'win32',
      };
      if (spec && !out[engine].version) out[engine].found = false;
    }
    out.npm = !!findOnPath('npm.cmd');
    return out;
  }

  installLog(engine, text) { String(text).split(/\r?\n/).filter((s) => s.trim()).forEach((s) => this.emit({ type: 'install', engine, text: clip(s, 300) })); }

  /** 子进程输出逐行推给界面，结束后返回新的检测结果 */
  runInstall(engine, cmd, args, opts) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { windowsHide: true, ...opts });
      const line = (b) => this.installLog(engine, b);
      child.stdout.on('data', line); child.stderr.on('data', line);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(this.detect()) : reject(new Error('安装失败（退出码 ' + code + '），详情见任务中心的安装日志'))));
    });
  }

  /**
   * 安装：Codex 直接从 npm 源下载官方原生版（不需要 Node.js / npm）；
   * Claude Code 有 npm 用 npm，没有就用 Anthropic 官方安装程序。只在老师点「安装」时运行。
   */
  async install(engine) {
    if (!PACKAGES[engine]) throw new Error('未知的智能体');
    if (engine === 'codex') return (await this.update('codex')).detect;
    const npm = findOnPath(WIN ? 'npm.cmd' : 'npm');
    if (npm) return this.runInstall(engine, npm, ['install', '-g', PACKAGES[engine]], { shell: WIN });
    if (!WIN) {
      this.installLog(engine, '没有 npm，改用 Anthropic 官方安装程序（https://claude.ai/install.sh）');
      return this.runInstall(engine, '/bin/bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], {});
    }
    this.installLog(engine, '没有 npm，改用 Anthropic 官方安装程序（https://claude.ai/install.ps1）');
    return this.runInstall(engine, 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], {});
  }

  /**
   * 检查并更新 Codex：新版本下载到导播台自己的工具目录（不动老师自己装的那份），
   * 之后自动用版本最新的那个。返回 { detect, from, to, updated }。
   */
  async update(engine = 'codex') {
    if (engine !== 'codex') throw new Error('只有 Codex 支持在导播台里更新');
    if (!this.toolsDir) throw new Error('工具目录不可用');
    if (this.updating) throw new Error('正在更新，请稍等');
    this.updating = true;
    try {
      const cur = locate('codex', this.toolsDir), from = cur?.version || '';
      this.installLog('codex', '检查 Codex 的最新版本…');
      const to = await latestVersion(this.fetch);
      if (from && cmpVersion(to, from) <= 0) {
        this.installLog('codex', `已经是最新版 ${from}`);
        return { detect: await this.detect(), from, to, updated: false };
      }
      this.installLog('codex', from ? `发现新版本 ${to}（现在是 ${from}）` : `下载 Codex ${to}`);
      const root = path.join(this.toolsDir, 'codex');
      fs.mkdirSync(root, { recursive: true });
      await stageCodex({ version: to, out: path.join(root, to), fetch: this.fetch, tmp: this.toolsDir, onProgress: (m) => this.installLog('codex', m) });
      // 旧的下载版删掉；正在被任务使用的删不掉就留着，下次再清
      for (const n of fs.readdirSync(root)) if (n !== to && !n.startsWith(to + '.')) { try { fs.rmSync(path.join(root, n), { recursive: true, force: true }); } catch { /* 正在用 */ } }
      this.installLog('codex', `Codex ${to} 已就绪，之后的新任务都用它`);
      return { detect: await this.detect(), from, to, updated: true };
    } finally { this.updating = false; }
  }

  public(t, withEvents = false) {
    const { child, queue, events, pending, procUsd, sendNow, turnOk, watch, ...rest } = t;
    return { ...rest, queued: queue?.length || 0, ...(withEvents ? { events } : { last: events.at(-1) || null }) };
  }

  list() { return [...this.tasks.values()].sort((a, b) => b.created - a.created).map((t) => this.public(t)); }

  get(id) { const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务'); return this.public(t, true); }

  save(t) {
    const { child, queue, events, pending, procUsd, sendNow, turnOk, watch, ...meta } = t;
    try { fs.writeFileSync(path.join(this.dir, t.id, 'task.json'), JSON.stringify(meta, null, 2)); } catch (e) { this.log?.warn('任务保存失败', e); }
  }

  push(t, ev) {
    const e = { at: Date.now(), ...ev };
    t.events.push(e);
    if (t.events.length > KEEP_EVENTS) t.events.splice(0, t.events.length - KEEP_EVENTS);
    try { fs.appendFileSync(path.join(this.dir, t.id, 'events.jsonl'), JSON.stringify(e) + '\n'); } catch { /* 日志失败不影响任务 */ }
    this.emit({ type: 'task', task: this.public(t), event: e });
  }

  setStatus(t, status, note) {
    t.status = status; if (note !== undefined) t.note = note; t.updated = Date.now();
    this.save(t);
    this.emit({ type: 'task', task: this.public(t) });
  }

  start({ engine, title, prompt, context, cap, useStudioKey, formats, model, permission, skill }) {
    if (!ENGINES[engine]) throw new Error('请选择 Codex 或 Claude Code');
    if (!locate(engine, this.toolsDir)) throw new Error(ENGINES[engine] + ' 还没有安装：在任务中心点「安装」');
    const text = String(prompt || '').trim();
    if (!text) throw new Error('请写下要 AI 做什么');
    this.ledger?.check();
    const id = new Date().toISOString().slice(0, 10) + '-' + crypto.randomBytes(3).toString('hex');
    const work = path.join(this.dir, id, '成果');
    fs.mkdirSync(work, { recursive: true });
    if (context) fs.writeFileSync(path.join(work, '任务背景.md'), String(context).slice(0, 20000));
    const capTask = Math.max(0.1, Math.min(Number(cap) || this.ledger?.budget.caps.task || 5, 1000));
    const t = { id, engine, title: clip(title || text.split('\n')[0], 60), prompt: text, cap: capTask, cny: 0, tokens: 0, turns: 0, status: 'running', created: Date.now(), updated: Date.now(), work, useStudioKey: !!useStudioKey, session: '', model: '', pick: clip(model || '', 120).trim(), permission: PERMISSIONS.includes(permission) ? permission : 'full', formats: cleanFormats(formats ?? ['docx', 'pdf']), skill: kit.skills().includes(skill) ? skill : '', events: [], queue: [] };
    this.tasks.set(id, t);
    this.save(t);
    this.push(t, { kind: 'user', text: clip(text, 2000) });
    this.run(t, kit.skillLead(engine, t.skill) + text);
    return this.public(t);
  }

  args(t, text) {
    const perm = PERMISSIONS.includes(t.permission) ? t.permission : 'safe';
    if (t.engine === 'codex') {
      const c = [];
      if (perm === 'danger') c.push('-c', 'sandbox_mode="danger-full-access"', '-c', 'approval_policy="never"');
      else {
        // 只允许写任务文件夹；常用权限再放开联网（查资料、下载素材）
        c.push('-c', 'sandbox_mode="workspace-write"');
        if (perm === 'full') c.push('-c', 'sandbox_workspace_write.network_access=true');
      }
      if (t.pick) c.push('-c', `model=${toml(t.pick)}`);
      c.push('-c', `developer_instructions=${toml(kit.instructions())}`);
      if (t.useStudioKey && this.credentials) {
        // 用导播台的中转站：单独的 provider，Key 只通过环境变量传给 Codex
        const cred = this.credentials();
        c.push('-c', 'model_provider="classroom"', '-c', `model_providers.classroom.name=${toml('最强网课教辅系统')}`, '-c', `model_providers.classroom.base_url=${toml(cred.baseUrl)}`,
          '-c', `model_providers.classroom.env_key=${toml(KEY_ENV)}`, '-c', 'model_providers.classroom.wire_api="responses"');
      }
      const common = ['--json', '--skip-git-repo-check', ...c];
      // 提示词走标准输入（"-"），避免命令行长度和引号问题
      return t.session ? ['exec', 'resume', ...common, t.session, '-'] : ['exec', ...common, '-C', t.work, '-'];
    }
    // Claude Code 按官方美元价控制预算；中转站倍率小于 1 时同样的人民币能多用一些
    const left = Math.max(0.01, (t.cap - t.cny) / (this.ledger?.budget.usdRate || 7.2) / (this.ledger?.factorFor?.(t.pick || t.model || 'claude') || this.ledger?.factor() || 1));
    const access = perm === 'danger' ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits', '--allowedTools', (perm === 'full' ? FULL_TOOLS : SAFE_TOOLS).join(',')];
    return ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', ...access, ...(t.pick ? ['--model', t.pick] : []),
      '--append-system-prompt', kit.instructions(),
      '--max-budget-usd', left.toFixed(2), ...(t.session ? ['--resume', t.session] : [])];
  }

  env(t) {
    const env = { ...process.env };
    if (t.useStudioKey && this.credentials) {
      const c = this.credentials();
      if (!c.key) throw new Error('导播台里还没有保存 API Key');
      if (t.engine === 'codex') { env.OPENAI_BASE_URL = c.baseUrl; env.OPENAI_API_KEY = c.key; env.CODEX_API_KEY = c.key; env[KEY_ENV] = c.key; }
      else { env.ANTHROPIC_BASE_URL = c.baseUrl.replace(/\/v1$/, ''); env.ANTHROPIC_API_KEY = c.key; }
    }
    return env;
  }

  /** 对话中途换模型 / 权限：下一轮生效 */
  configure(id, { model, permission } = {}) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const changes = [];
    if (model !== undefined && String(model).trim() !== (t.pick || '')) { t.pick = clip(String(model).trim(), 120); changes.push(t.pick ? `模型改为 ${t.pick}` : '模型改回默认'); }
    if (PERMISSIONS.includes(permission) && permission !== t.permission) { t.permission = permission; changes.push(`权限改为${PERMISSION_NAME[permission]}`); }
    if (changes.length) {
      this.push(t, { kind: 'note', text: changes.join('，') + (t.child ? '（下一轮生效）' : '') });
      this.save(t);
    }
    return this.public(t);
  }

  /** 对账后：任务花费改成账本里的合计（含中转站实扣） */
  refreshCost(ids) {
    for (const id of ids) {
      const t = this.tasks.get(id); if (!t || !this.ledger) continue;
      const total = Math.round(this.ledger.taskTotal(id) * 1e4) / 1e4;
      if (Math.abs(total - t.cny) < 1e-4) continue;
      const before = t.cny; t.cny = total; t.reconciled = true;
      this.push(t, { kind: 'usage', text: `已和中转站消费记录对账：本任务实扣 ¥${total.toFixed(2)}（之前估算 ¥${before.toFixed(2)}）` });
      this.save(t);
    }
  }

  run(t, text) {
    let spec, child;
    try {
      spec = locate(t.engine, this.toolsDir);
      if (!spec) throw new Error(ENGINES[t.engine] + ' 不见了，可能被卸载');
      if (t.cny >= t.cap) throw new Error(`本任务已花约 ¥${t.cny.toFixed(2)}，到了单任务上限 ¥${t.cap}`);
      this.ledger?.check();
      try { kit.installKit(t.work, t.engine); } catch (e) { this.log?.warn('技能文件写入失败', e); }
      child = spawn(spec.cmd, [...spec.pre, ...this.args(t, text)], { cwd: t.work, env: { ...this.env(t), ...spec.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.push(t, { kind: 'error', text: e.message });
      this.setStatus(t, /上限/.test(e.message) ? 'budget' : 'failed', e.message);
      return;
    }
    t.child = child; t.turns += 1; t.pending = 0; t.procUsd = 0; t.live = 0; t.overCap = ''; t.turnStart = Date.now(); t.chargeFrom = t.turnStart;
    if (t.engine === 'codex') {
      // 0.4.0 留下的任务没有记下已记账的累计用量：以续接前 rollout 里的累计值为起点
      if (t.session && !t.codexSeen) { this.peekCodex(t, false); if (t.rollTotal) t.codexSeen = t.rollTotal; }
      clearInterval(t.watch);
      t.watch = setInterval(() => { try { this.peekCodex(t); } catch (e) { this.log?.warn('读取 Codex 用量失败', e); } }, 3000);
    }
    this.setStatus(t, 'running', '');
    const send = (msg) => { t.pending += 1; child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: msg }] } }) + '\n'); };
    child.stdin.on('error', () => {});
    if (t.engine === 'claude') send(text); else child.stdin.end(text);
    t.sendNow = t.engine === 'claude' ? send : null;
    const timer = setTimeout(() => { this.push(t, { kind: 'error', text: '这一轮运行超过 30 分钟，已停止' }); this.halt(t, 'failed', '运行超时'); }, TURN_LIMIT_MS);
    let buf = '', errTail = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        this.onEvent(t, j);
      }
    });
    child.stderr.on('data', (c) => { errTail = (errTail + c).slice(-2000); });
    child.on('error', (e) => { this.push(t, { kind: 'error', text: '无法启动：' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (t.child !== child) return;
      clearInterval(t.watch); t.watch = null;
      t.child = null; t.sendNow = null; t.live = 0;
      if (['stopped', 'budget', 'failed'].includes(t.status)) { this.save(t); this.emit({ type: 'task', task: this.public(t) }); return; }
      if (code && !t.turnOk) {
        const why = errTail.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400);
        this.push(t, { kind: 'error', text: `${ENGINES[t.engine]} 退出（代码 ${code}）${why ? '：' + why : ''}` });
        this.setStatus(t, 'failed', '运行出错');
        return;
      }
      t.turnOk = false;
      if (t.queue.length) { this.run(t, t.queue.shift()); return; }
      this.setStatus(t, 'done', t.overCap ? '已完成，花费超过上限' : '');
      void this.autoExport(t);
    });
  }

  /** 这一轮新写或改过的 Markdown 自动排成 Word / PDF / PPT（老师一般不直接用 .md） */
  async autoExport(t) {
    const formats = cleanFormats(t.formats ?? ['docx', 'pdf']);
    if (!this.exporter || !formats.length) return;
    const since = (t.turnStart || 0) - 2000;
    const mds = this.files(t.id).filter((f) => /\.(md|markdown)$/i.test(f.name) && f.name !== '任务背景.md' && f.mtime >= since);
    for (const f of mds) await this.exportFile(t.id, f.path, formats).catch(() => {});
  }

  /** 把任务文件夹里的一个 Markdown 导出成指定格式 */
  async exportFile(id, file, formats) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const full = path.resolve(String(file || '')), rel = path.relative(t.work, full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.(md|markdown)$/i.test(full)) throw new Error('只能转换这个任务文件夹里的 Markdown 文件');
    const want = cleanFormats(formats);
    if (!want.length) throw new Error('请选择要导出的格式');
    if (!this.exporter) throw new Error('导出功能不可用');
    const label = { docx: 'Word', pdf: 'PDF', pptx: 'PPT' };
    t.exporting = true;
    this.push(t, { kind: 'status', text: `正在把「${path.basename(full)}」排版成 ${want.map((k) => label[k]).join(' / ')}…` });
    try {
      const r = await this.exporter(full, want);
      if (r.out.length) this.push(t, { kind: 'out', text: '排版完成：' + r.out.map((p) => path.basename(p)).join('、') + '（在右侧「成果文件」里点开）' });
      for (const e of r.errors) this.push(t, { kind: 'error', text: '导出失败：' + e });
      return { out: r.out.map((p) => p.replace(/\\/g, '/')), errors: r.errors };
    } catch (e) {
      this.push(t, { kind: 'error', text: '导出失败：' + e.message });
      throw e;
    } finally { t.exporting = false; this.save(t); this.emit({ type: 'task', task: this.public(t) }); }
  }

  onEvent(t, j) {
    const r = t.engine === 'codex' ? readCodex(j) : readClaude(j);
    if (r.session) t.session = r.session;
    if (r.model) t.model = r.model;
    for (const e of r.events) this.push(t, e);
    if (r.usage) {
      if (t.engine === 'codex') this.chargeCodex(t, r.usage, !r.failed);
      else this.chargeClaude(t, r);
    }
    if (r.turnDone) {
      if (!r.failed) t.turnOk = true;
      if (t.engine === 'claude') {
        t.pending -= 1;
        // 没有待处理的追加指令就关掉输入，让这一轮正常结束
        if (t.pending <= 0 && t.child) t.child.stdin.end();
      }
    }
  }

  /**
   * Codex：用 rollout 里的累计用量减去已记账的部分，续接（resume）时不会重复记账。
   * 找不到 rollout 时退回 turn.completed 的 usage。finished = 这一轮已正常做完。
   */
  chargeCodex(t, reported, finished) {
    this.peekCodex(t, false);
    const total = t.rollTotal ? tok(t.rollTotal) : tok(reported);
    const usage = usageSince(total, t.codexSeen);
    t.codexSeen = total;
    this.record(t, usage, undefined, finished);
  }

  chargeClaude(t, r) {
    const u = r.usage;
    const usage = { input: Number(u.input_tokens) || 0, cached: Number(u.cached_input_tokens) || 0, output: Number(u.output_tokens) || 0 };
    let cny;
    if (Number.isFinite(r.usd)) {
      // result 里的美元数在同一进程内可能是累计值，只记新增部分；Claude Code 按官方价算，再乘中转站倍率
      const delta = r.usd >= t.procUsd ? r.usd - t.procUsd : r.usd;
      t.procUsd = Math.max(t.procUsd, r.usd);
      cny = delta * (this.ledger?.budget.usdRate || 7.2) * (this.ledger?.factor() ?? 1);
    }
    this.record(t, usage, cny, !r.failed);
  }

  record(t, usage, cny, finished) {
    const from = t.chargeFrom || t.turnStart || Date.now();
    const e = this.ledger ? this.ledger.record({ source: 'task', feature: ENGINES[t.engine], model: t.model || t.pick || t.engine, usage, cny, taskId: t.id, from })
      : { cny: cny ?? 0 };
    t.chargeFrom = Date.now();
    this.onCharge();
    t.cny = Math.round((t.cny + e.cny) * 1e4) / 1e4;
    t.tokens += usage.input + usage.cached + usage.output;
    t.live = 0;
    this.push(t, { kind: 'usage', text: `本轮约 ¥${e.cny.toFixed(2)}，任务累计 ¥${t.cny.toFixed(2)} / ¥${t.cap}` });
    let over = '';
    if (t.cny >= t.cap) over = '到了单任务花费上限';
    else { try { this.ledger?.check(); } catch (err) { over = err.message; } }
    if (!over) return;
    if (finished) {
      // 这一轮已经做完，钱也已经花了：成果照常保留，只是不再接着跑排队的指令
      t.queue = []; t.overCap = over;
      this.push(t, { kind: 'note', text: over + '。这一轮已完成，继续追加前请先在「AI 账本」调高上限。' });
      return;
    }
    this.push(t, { kind: 'error', text: over + '，已自动停止' });
    this.halt(t, 'budget', t.cny >= t.cap ? '到达花费上限' : '到达每日/每月上限');
  }

  /** 运行中定时读 Codex 的 rollout：显示实时花费，并在一轮还没结束时就能按上限停下 */
  peekCodex(t, enforce = true) {
    if (!t.session) return;
    if (!t.rollout) { t.rollout = findRollout(t.session); if (!t.rollout) return; t.rollPos = 0; }
    const r = readRollout(t.rollout, t.rollPos || 0);
    if (!r) return;
    t.rollPos = r.pos;
    if (r.model) t.model = r.model;
    if (!r.total) return;
    t.rollTotal = tok(r.total);
    if (!enforce || t.status !== 'running' || !this.ledger) return;
    const usage = usageSince(t.rollTotal, t.codexSeen), live = this.ledger.cost(t.model || t.engine, usage);
    if (Math.abs(live - (t.live || 0)) >= 0.005) { t.live = Math.round(live * 1e4) / 1e4; this.emit({ type: 'task', task: this.public(t) }); }
    if (t.cny + live >= t.cap) { t.codexSeen = t.rollTotal; this.record(t, usage, undefined, false); }
  }

  halt(t, status, note) {
    t.queue = [];
    clearInterval(t.watch); t.watch = null;
    const child = t.child;
    this.setStatus(t, status, note);
    killTree(child);
  }

  /** 老师按中转站后台填入这个任务的实际花费：更正账本、调整倍率 */
  calibrate(id, actual) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    if (!this.ledger) throw new Error('账本不可用');
    const r = this.ledger.calibrate(id, actual);
    t.cny = Math.round(this.ledger.taskTotal(id) * 1e4) / 1e4;
    t.calibrated = true;
    this.push(t, { kind: 'usage', text: `已按实际扣费校准：本任务 ¥${t.cny.toFixed(2)}；以后的估算按 ${r.factor.toFixed(3)} 倍官方价计算` });
    this.save(t);
    return { factor: r.factor, task: this.public(t) };
  }
  /** 追加指令：Claude 运行中直接写进输入流；其他情况排队，本轮结束后接着上一轮继续 */
  inject(id, text) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const msg = String(text || '').trim(); if (!msg) throw new Error('指令是空的');
    const live = t.child && t.status === 'running';
    if (!live) {
      // 老师调高了单任务上限后，旧任务也按新上限继续
      const capNow = this.ledger?.budget.caps.task || 0;
      if (t.cny >= t.cap && t.cap >= capNow) throw new Error('这个任务已到花费上限；如需继续，请新建任务或在「AI 账本」里调高单任务上限');
      if (t.child) throw new Error('任务正在停止，请稍等几秒再继续');
      this.ledger?.check();
      if (t.cap < capNow) t.cap = capNow;
    }
    this.push(t, { kind: 'user', text: clip(msg, 2000) });
    if (live && t.sendNow && t.pending > 0) { t.sendNow(msg); return this.public(t); }
    if (live) { t.queue.push(msg); this.emit({ type: 'task', task: this.public(t) }); return this.public(t); }
    this.run(t, msg);
    return this.public(t);
  }

  stop(id) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    if (t.child) { this.push(t, { kind: 'status', text: '老师手动停止' }); this.halt(t, 'stopped', '已手动停止'); }
    return this.public(t);
  }

  remove(id) {
    const t = this.tasks.get(id); if (!t) return;
    if (t.child) throw new Error('任务还在运行，请先停止');
    this.tasks.delete(id);
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
  }

  files(id) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const out = [];
    const walk = (d, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
        else { const s = fs.statSync(p); out.push({ path: p.replace(/\\/g, '/'), name: path.relative(t.work, p).replace(/\\/g, '/'), size: s.size, mtime: s.mtimeMs }); }
        if (out.length > 200) return;
      }
    };
    try { walk(t.work, 0); } catch { /* 文件夹被删 */ }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /** 读任务文件夹里 AI 写的「…题库.json」，交给界面导入题库 */
  readBank(id, file) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const full = path.resolve(String(file || '')), rel = path.relative(t.work, full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/题库\.json$/i.test(full)) throw new Error('只能导入这个任务文件夹里的题库文件');
    if (fs.statSync(full).size > 2 * 1024 * 1024) throw new Error('题库文件太大');
    try { return JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('题库文件不是合法的 JSON，可以让 AI「修正题库文件的 JSON 格式」：' + clip(e.message, 120)); }
  }

  stopAll() { for (const t of this.tasks.values()) if (t.child) { t.status = 'stopped'; t.note = '导播台关闭'; this.save(t); killTree(t.child); } }
}

module.exports = { Agents, readCodex, readClaude, locate, bundledCodexDir, ENGINES };
