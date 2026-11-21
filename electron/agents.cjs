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
const spec = require('./pluginSpec.cjs');
const csTools = require('./csToolsMcp.cjs');
const tier = require('./tier.cjs');
const netRetry = require('./netRetry.cjs');
const { CodexHome, ensureCodexConfig } = require('./codexHome.cjs');

const ENGINES = { codex: 'Codex CLI', claude: 'Claude Code' };
const PACKAGES = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' };
const TURN_LIMIT_MS = 60 * 60 * 1000;
const WRAP_RATIO = 0.75;
const wrapGrace = (cap) => Math.min(0.2, Math.max(0.05, Number(cap || 0) * 0.15));
// 这些错误多半是网络或中转站一时的问题，会话还在，可以自动接着做
const RECOVERABLE = /stream disconnected|connection (reset|closed|error)|ECONNRESET|ETIMEDOUT|socket hang up|timed out|502|503|504|Bad Gateway|Service Unavailable|reconnect/i;
const KEEP_EVENTS = 400;
// 权限：safe 只读写任务文件夹；full（默认）再允许运行命令、联网查资料；danger 完全访问（不限目录、不再询问）
const PERMISSIONS = ['safe', 'full', 'danger'];
const PERMISSION_NAME = { safe: '安全模式', full: '常用权限', danger: '完全访问' };
const SAFE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite'];
const FULL_TOOLS = [...SAFE_TOOLS, 'Bash', 'WebSearch', 'WebFetch', 'NotebookEdit', 'mcp__cs_tools'];
// 安全模式也能用截图自检（只看本机文件，页面不能联网）
const SAFE_MCP = ['mcp__cs_tools__page_check'];
const KEY_ENV = 'CS_RELAY_API_KEY';
// 思考档位：Codex 的 model_reasoning_effort；Claude 只在高档位时加思考预算
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const EFFORT_NAME = { low: '低', medium: '中', high: '高', xhigh: '极高' };
const CLAUDE_THINK = { high: '16000', xhigh: '31999' };
const ATTACH_MAX = 8, ATTACH_BYTES = 20 * 1024 * 1024, ASSETS_PER_TURN = 6, AUTO_FIX = 2;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;
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
function findRollout(id, home = codexHome()) {
  if (!/^[\w-]{3,80}$/.test(String(id || ''))) return '';
  const root = path.join(home, 'sessions'), pad = (n) => String(n).padStart(2, '0');
  for (let k = 0; k < 8; k++) {
    const d = new Date(Date.now() - k * 864e5), dir = path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
    try { const f = fs.readdirSync(dir).find((n) => n.endsWith(id + '.jsonl')); if (f) return path.join(dir, f); } catch { /* 这天没有 */ }
  }
  return '';
}

/** 从 pos 开始读 rollout 新增的完整行：最新累计用量、模型名、实际生效的沙箱策略 */
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
      else if (j.type === 'turn_context') {
        if (p.model) out.model = String(p.model).slice(0, 80);
        if (p.sandbox_policy?.type) out.sandbox = String(p.sandbox_policy.type);
      }
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
      else if (it.type === 'mcp_tool_call') out.events.push({ kind: 'tool', text: csTools.label(it.tool, it.arguments, it.server) });
      break;
    case 'item.completed':
      if (it.type === 'agent_message') out.events.push({ kind: 'text', text: clip(it.text) });
      else if (it.type === 'reasoning') out.events.push({ kind: 'think', text: clip(it.text, 600) });
      else if (it.type === 'command_execution' && it.exit_code) out.events.push({ kind: 'error', text: `命令退出码 ${it.exit_code}：${clip(it.command, 160)}` });
      else if (it.type === 'file_change') out.events.push({ kind: 'file', text: (it.changes || []).map((c) => `${c.kind === 'add' ? '新建' : c.kind === 'delete' ? '删除' : '修改'} ${path.basename(String(c.path || ''))}`).join('，') || '修改文件' });
      else if (it.type === 'todo_list') out.events.push({ kind: 'plan', text: (it.items || []).map((x) => (x.completed ? '✓ ' : '· ') + x.text).join('\n') });
      else if (it.type === 'web_search') out.events.push({ kind: 'tool', text: '联网搜索：' + clip(it.query || it.action?.query || '', 200) });
      else if (it.type === 'mcp_tool_call' && (it.error || it.status === 'failed' || it.result?.isError || it.result?.is_error)) out.events.push({ kind: 'error', text: `${csTools.label(it.tool, it.arguments, it.server)} 没成功：${clip(it.error?.message || it.result?.content?.[0]?.text || '', 300)}` });
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
      else if (b.type === 'tool_use' && b.name.startsWith('mcp__')) out.events.push({ kind: 'tool', text: csTools.label(b.name.split('__').slice(2).join('__'), b.input, b.name.split('__')[1]) });
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
  constructor({ dir, ledger, credentials, log, emit, exporter, onCharge, toolsDir, fetch: fetchFn, imageGen, tools, tierOf, check, codexHome, autoPrewarm, turnLimitMs, retryDelays }) {
    this.dir = dir;
    /** AI 工具（toolHost.cjs）：联网搜索、内置浏览器、截图自检、键鼠；测试里可以没有 */
    this.tools = tools || null;
    this.tierOf = tierOf || (() => tier.USES.workshop);
    // 成品自检（deliverCheck）：主进程注入，参数是任务，返回 { problems, notes }；没注入时跳过（测试用的假 CLI 不跑）
    this.check = typeof check === 'function' ? check : null;
    this.imageGen = imageGen || null;
    this.toolsDir = toolsDir || '';
    this.turnLimitMs = Number(turnLimitMs) > 0 ? Number(turnLimitMs) : TURN_LIMIT_MS;
    // 自动重连的等待（默认 1s、2s、4s、8s、15s；测试可以传更短的）
    this.retryDelays = Array.isArray(retryDelays) ? retryDelays : null;
    this.autoPrewarm = !!autoPrewarm;
    this.codexHome = codexHome instanceof CodexHome
      ? codexHome
      : new CodexHome({
          dir: typeof codexHome === 'string' && codexHome ? codexHome : path.join(dir, 'codex-home'),
          locate: () => locate('codex', this.toolsDir),
          log,
          emit: (state) => this.emit?.({ type: 'warmup', state }),
        });
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
      if (this.codexHome && process.platform === 'win32') {
        this.installLog('codex', '正在后台预热 Windows 安全沙箱环境…');
        void this.codexHome.prewarm({ reason: 'update', force: true }).catch(() => {});
      }
      return { detect: await this.detect(), from, to, updated: true };
    } finally { this.updating = false; }
  }

  codexHomeDir() {
    return this.codexHome ? this.codexHome.ensureConfig() : ensureCodexConfig(path.join(this.dir, 'codex-home'));
  }

  warmupState() {
    return this.codexHome ? this.codexHome.view() : { phase: 'ready', ready: true, pct: 100, step: '', elapsedSec: 0, error: '' };
  }

  prewarmCodex(opts) {
    return this.codexHome ? this.codexHome.prewarm(opts) : Promise.resolve({ ok: true });
  }

  /** 这个任务这一轮用的模型：老师选的 → 走导播台中转站时用推荐强模型（AI 设置里的模型够强就用它） */
  modelFor(t) {
    if (t.pick) return t.pick;
    if (t.engine === 'codex' && t.useStudioKey && this.credentials) return tier.strongModel(this.credentials()?.model);
    return '';
  }

  public(t, withEvents = false) {
    const { child, queue, events, pending, procUsd, sendNow, turnOk, turnFailed, lastPrompt, watch, nextImages, wrapping, retryTimer, ...rest } = t;
    // modelName：任务卡片和详情头部显示的模型名（实际跑的 > 选的 > 默认会用的）；tierName：银子系站点的档位名
    const modelName = t.model || this.modelFor(t) || (t.engine === 'claude' ? 'Claude 默认模型' : 'Codex 默认模型');
    const site = this.tierApplies(t);
    return { ...rest, tierSite: site, modelName, tierName: site && t.tier ? tier.TIERS[t.tier]?.name || '' : '', queued: queue?.length || 0, ...(withEvents ? { events } : { last: events.at(-1) || null }) };
  }

  list() { return [...this.tasks.values()].sort((a, b) => b.created - a.created).map((t) => this.public(t)); }

  get(id) { const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务'); return this.public(t, true); }

  save(t) {
    const { child, queue, events, pending, procUsd, sendNow, turnOk, turnFailed, lastPrompt, watch, nextImages, wrapping, retryTimer, ...meta } = t;
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

  /**
   * kind = 'plugin'：AI 工坊做插件。插件写在 成果/plugin 里（pluginFrom 给了就先复制一份已装的插件进来改），
   * 每轮结束自动校验、按「素材需求.json」生成图片。attachments 是老师附上的文件路径。
   */
  start({ engine, title, prompt, context, cap, useStudioKey, formats, model, permission, skill, kind, effort, attachments, pluginFrom, tier: tierPick, styleRef }) {
    if (!ENGINES[engine]) throw new Error('请选择 Codex 或 Claude Code');
    if (!locate(engine, this.toolsDir)) throw new Error(ENGINES[engine] + ' 还没有安装：在任务中心点「安装」');
    const showcase = styleRef ? new (require('./showcase.cjs').Showcase)() : null;
    const reference = showcase?.prepareStart({ prompt, context, styleRef });
    if (reference) { prompt = reference.prompt; context = reference.context; }
    const text = String(prompt || '').trim();
    if (!text) throw new Error('请写下要 AI 做什么');
    this.ledger?.check();
    const plugin = kind === 'plugin';
    const id = new Date().toISOString().slice(0, 10) + '-' + crypto.randomBytes(3).toString('hex');
    const work = path.join(this.dir, id, '成果');
    fs.mkdirSync(work, { recursive: true });
    if (context) fs.writeFileSync(path.join(work, '任务背景.md'), String(context).slice(0, 20000));
    const capTask = Math.max(0.1, Math.min(Number(cap) || this.ledger?.budget.caps.task || 5, 1000));
    const t = { id, engine, title: clip(title || text.split('\n')[0], 60), prompt: text, cap: capTask, cny: 0, tokens: 0, turns: 0, status: 'running', created: Date.now(), updated: Date.now(), roundStart: Date.now(), work, useStudioKey: !!useStudioKey, session: '', model: '', pick: clip(model || '', 120).trim(), permission: PERMISSIONS.includes(permission) ? permission : 'full', formats: plugin ? [] : cleanFormats(formats ?? ['docx', 'pdf']), skill: plugin ? 'plugin-dev' : kit.skills().includes(skill) ? skill : '', kind: plugin ? 'plugin' : '', effort: EFFORTS.includes(effort) ? effort : '', tier: tier.IDS.includes(tierPick) ? tierPick : tier.clean(this.tierOf(), 'workshop'), events: [], queue: [] };
    let att;
    try {
      if (plugin) {
        t.pluginDir = path.join(work, 'plugin');
        if (pluginFrom) fs.cpSync(pluginFrom, t.pluginDir, { recursive: true });
        fs.mkdirSync(t.pluginDir, { recursive: true });
      }
      showcase?.installReferences(t, reference);
      att = this.attach(t, attachments);
    } catch (e) { fs.rmSync(path.join(this.dir, id), { recursive: true, force: true }); throw e; }
    this.tasks.set(id, t);
    this.save(t);
    this.push(t, { kind: 'user', text: clip(text, 2000) + att.label });
    this.run(t, kit.skillLead(engine, t.skill) + text + att.prompt);
    return this.public(t);
  }

  /** 老师附上的文件复制进任务的「附件」文件夹；图片下一轮直接附给 Codex（-i），其余让 AI 自己去读 */
  attach(t, list) {
    const src = (Array.isArray(list) ? list : []).map((p) => String(p || '')).filter(Boolean);
    if (!src.length) return { label: '', prompt: '' };
    if (src.length > ATTACH_MAX) throw new Error(`附件最多 ${ATTACH_MAX} 个`);
    const dir = path.join(t.work, '附件'), names = [];
    fs.mkdirSync(dir, { recursive: true });
    for (const f of src) {
      let st; try { st = fs.statSync(f); } catch { throw new Error('找不到附件：' + path.basename(f)); }
      if (!st.isFile()) throw new Error('附件只能是文件：' + path.basename(f));
      if (st.size > ATTACH_BYTES) throw new Error('附件太大（超过 20 MB）：' + path.basename(f));
      const ext = path.extname(f), stem = path.basename(f, ext).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '附件';
      let name = stem + ext, k = 1;
      while (fs.existsSync(path.join(dir, name))) name = `${stem}-${++k}${ext}`;
      fs.copyFileSync(f, path.join(dir, name));
      names.push('附件/' + name);
    }
    const imgs = names.filter((n) => IMAGE_FILE.test(n));
    if (t.engine === 'codex') t.nextImages = [...(t.nextImages || []), ...imgs.map((n) => path.join(t.work, n))];
    const how = imgs.length ? (t.engine === 'codex' ? '图片已经直接附在这条消息里；' : '图片可以用读取文件的工具直接查看；') : '';
    return {
      label: `\n附件：${names.map((n) => n.slice(3)).join('、')}`,
      prompt: `\n\n老师附上了 ${names.length} 个文件：${names.join('、')}（在当前文件夹的「附件」里）。${how}请先看附件再动手。`,
    };
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
      // 没选模型又走导播台的中转站：用 AI 设置里的模型（一键导入推荐的），不让 Codex 落到 Key 分组里没有的默认模型
      // 1.7.0：AI 设置里的模型偏弱（如 6.1-sol）或没填时，改用推荐的强模型，工坊出成品不落到弱模型上
      const pick = this.modelFor(t);
      if (pick) c.push('-c', `model=${toml(pick)}`);
      const eff = t.wrapping ? 'low' : t.effort;
      if (EFFORTS.includes(eff)) c.push('-c', `model_reasoning_effort=${toml(eff)}`);
      c.push('-c', `developer_instructions=${toml(kit.instructions(t.kind, perm) + this.toolsNote(perm))}`);
      // 联网搜索：常用权限以上打开 Codex 自带的 web_search；收尾轮强制关闭联网搜索，专心写文件
      if (this.tools) c.push('-c', `web_search=${!t.wrapping && this.tools.nativeSearch(perm) ? '"live"' : '"disabled"'}`, ...this.tools.codexArgs('task:' + t.id).args);
      if (t.useStudioKey && this.credentials) {
        // 用导播台的中转站：单独的 provider，Key 只通过环境变量传给 Codex；我们站点走本机转发层自动兜底 400「没有可用分组」
        const cred = this.credentials();
        const baseUrl = this.siteBaseUrl(t, cred.baseUrl);
        c.push('-c', 'model_provider="classroom"', '-c', `model_providers.classroom.name=${toml('玲珑课堂')}`, '-c', `model_providers.classroom.base_url=${toml(baseUrl)}`,
          '-c', `model_providers.classroom.env_key=${toml(KEY_ENV)}`, '-c', 'model_providers.classroom.wire_api="responses"');
        // 档位：只有银子 API 系站点认，每轮都是新进程，所以改了下一轮就生效
        c.push(...tier.codexArgs(cred.baseUrl, t.tier));
      }
      // 图片放在最前面：-i 能接多个值，紧跟在后面的 "-" 会被当成图片
      const common = [...(t.nextImages || []).flatMap((p) => ['-i', p]), '--json', '--skip-git-repo-check', ...c];
      // 提示词走标准输入（"-"），避免命令行长度和引号问题
      return t.session ? ['exec', 'resume', ...common, t.session, '-'] : ['exec', ...common, '-C', t.work, '-'];
    }
    // Claude Code 按官方美元价控制预算；中转站倍率小于 1 时同样的人民币能多用一些
    const left = Math.max(0.01, (t.cap - t.cny) / (this.ledger?.budget.usdRate || 7.2) / (this.ledger?.factorFor?.(t.pick || t.model || 'claude') || this.ledger?.factor() || 1));
    const access = perm === 'danger' ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits', '--allowedTools', (perm === 'full' ? FULL_TOOLS : [...SAFE_TOOLS, ...SAFE_MCP]).join(',')];
    const mcp = this.claudeMcp(t);
    return ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', ...access, ...(t.pick ? ['--model', t.pick] : []), ...(mcp ? ['--mcp-config', mcp] : []),
      '--append-system-prompt', kit.instructions(t.kind, perm) + this.toolsNote(perm),
      '--max-budget-usd', (Math.floor(left * 100) / 100).toFixed(2), ...(t.session ? ['--resume', t.session] : [])];
  }

  /** 给 AI 的工具说明（跟着档位走），接在开发者指令后面 */
  toolsNote(perm) { return this.tools ? '\n\n' + this.tools.note(perm) : ''; }

  /** Claude Code 的 MCP 配置写进任务的隐藏目录 .cs（令牌只在这次软件运行期间有效） */
  claudeMcp(t) {
    const cfg = this.tools?.claudeConfig('task:' + t.id);
    if (!cfg) return '';
    const f = path.join(t.work, '.cs', 'mcp.json');
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(cfg, null, 2)); return f; } catch (e) { this.log?.warn('MCP 配置写入失败', e); return ''; }
  }

  siteBaseUrl(t, rawBase) {
    return tier.relayBaseUrl(rawBase, {
      who: 'workshop-' + t.engine,
      key: 'task:' + (t.id || 'tmp') + ':' + t.engine,
      log: this.log,
      onFallback: () => {
        if (t.noRouteFallbackNoted) return;
        t.noRouteFallbackNoted = true;
        const name = tier.TIERS[t.tier]?.name || t.tier;
        this.push(t, { kind: 'note', text: `「${name}」档位没有可用分组，已自动去掉档位头、按令牌自己的范围重发一次` });
      },
    });
  }

  env(t) {
    const env = { ...process.env };
    if (t.engine === 'codex') env.CODEX_HOME = this.codexHomeDir();
    if (this.tools && t.engine === 'codex') Object.assign(env, this.tools.codexArgs('task:' + t.id).env);
    // 课件设计包的打包小工具（.cs-kit/pack.cmd）用导播台自己的程序以 Node 模式运行，老师不用装 Node
    env.CS_NODE = process.execPath;
    if (t.useStudioKey && this.credentials) {
      const c = this.credentials();
      if (!c.key) throw new Error('导播台里还没有保存 API Key');
      if (t.engine === 'codex') {
        const baseUrl = this.siteBaseUrl(t, c.baseUrl);
        env.OPENAI_BASE_URL = baseUrl; env.OPENAI_API_KEY = c.key; env.CODEX_API_KEY = c.key; env[KEY_ENV] = c.key;
      } else {
        const claudeBase = this.siteBaseUrl(t, c.baseUrl.replace(/\/v1$/, ''));
        env.ANTHROPIC_BASE_URL = claudeBase; env.ANTHROPIC_API_KEY = c.key; Object.assign(env, tier.claudeEnv(c.baseUrl, t.tier));
      }
    }
    if (t.engine === 'claude' && CLAUDE_THINK[t.effort] && !t.wrapping) env.MAX_THINKING_TOKENS = CLAUDE_THINK[t.effort];
    return env;
  }

  /** 对话中途换模型 / 权限：下一轮生效 */
  configure(id, { model, permission, effort, tier: tierPick } = {}) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const changes = [];
    if (model !== undefined && String(model).trim() !== (t.pick || '')) { t.pick = clip(String(model).trim(), 120); changes.push(t.pick ? `模型改为 ${t.pick}` : '模型改回默认'); }
    if (PERMISSIONS.includes(permission) && permission !== t.permission) { t.permission = permission; changes.push(`权限改为${PERMISSION_NAME[permission]}`); }
    if (effort !== undefined && (effort === '' || EFFORTS.includes(effort)) && effort !== (t.effort || '')) { t.effort = effort; changes.push(effort ? `思考档位改为${EFFORT_NAME[effort]}` : '思考档位改回默认'); }
    if (tier.IDS.includes(tierPick) && tierPick !== t.tier) { t.tier = tierPick; changes.push(`档位改为${tier.TIERS[tierPick].name}`); if (tierPick === 'quality') t.suggest = null; }
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
    const needWarm = t.engine === 'codex' && t.permission !== 'danger' && this.codexHome
      && (this.codexHome.state.phase === 'running' || (this.autoPrewarm && !this.codexHome.isReady()));
    if (needWarm) {
      this.setStatus(t, 'running', '正在准备安全运行环境…');
      this.push(t, { kind: 'status', text: '第一次使用正在准备 Windows 安全运行环境（约 3～5 分钟，只做这一次）…' });
      let lastBucket = 0;
      const off = this.codexHome.onProgress((st) => {
        if (st.phase !== 'running' || t.status !== 'running') return;
        const bucket = Math.floor((st.elapsedSec || 0) / 15);
        if (bucket > lastBucket) {
          lastBucket = bucket;
          this.push(t, { kind: 'status', text: st.step });
        }
      });
      void this.codexHome.prewarm({ reason: 'task' }).then((res) => {
        off();
        if (t.status === 'stopped') return;
        if (!res.ok) {
          const msg = `${res.error || '安全运行环境准备未完成'}。可以在任务里把权限切成「完全访问」后继续，或点「重试准备」。`;
          this.push(t, { kind: 'error', text: msg });
          this.setStatus(t, 'failed', '安全沙箱准备失败');
          return;
        }
        if (!res.cached && !res.skipped) this.push(t, { kind: 'note', text: '安全运行环境准备完成，开始执行任务' });
        this._spawnRun(t, text);
      });
      return;
    }
    if (t.useStudioKey && this.credentials) {
      try {
        const c = this.credentials();
        if (c.baseUrl && tier.applies(c.baseUrl) && tier.relayBaseUrl(c.baseUrl) === c.baseUrl) {
          void tier.ensureSiteRelay().then(() => { if (t.status !== 'stopped') this._spawnRun(t, text); });
          return;
        }
      } catch { /* 交给 _spawnRun 统一报错 */ }
    }
    this._spawnRun(t, text);
  }

  _spawnRun(t, text) {
    let spec, child;
    try {
      spec = locate(t.engine, this.toolsDir);
      if (!spec) throw new Error(ENGINES[t.engine] + ' 不见了，可能被卸载');
      if (!t.wrapping && t.cny >= t.cap) throw new Error(`本任务已花约 ¥${t.cny.toFixed(2)}，到了单任务上限 ¥${t.cap}`);
      this.ledger?.check();
      try { kit.installKit(t.work, t.engine, t.kind); } catch (e) { this.log?.warn('技能文件写入失败', e); }
      this.tools?.register('task:' + t.id, { title: t.title, work: t.work, perm: t.permission, source: 'task', wrapping: !!t.wrapping });
      const argv = this.args(t, text);
      t.nextImages = [];
      const childEnv = { ...this.env(t), ...spec.env };
      if (t.engine === 'codex') {
        ensureCodexConfig(childEnv.CODEX_HOME || this.codexHomeDir());
        t.rolloutHome = childEnv.CODEX_HOME || this.codexHomeDir();
      }
      child = spawn(spec.cmd, [...spec.pre, ...argv], { cwd: t.work, env: childEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      t.wrapping = false;
      this.push(t, { kind: 'error', text: e.message });
      this.setStatus(t, /上限/.test(e.message) ? 'budget' : 'failed', e.message);
      return;
    }
    t.child = child; t.turns += 1; t.pending = 0; t.procUsd = 0; t.live = 0; t.overCap = ''; t.turnOk = false; t.turnFailed = false; t.lastPrompt = text; t.turnStart = Date.now(); t.chargeFrom = t.turnStart;
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
    const limitMin = Math.max(1, Math.round(this.turnLimitMs / 60000));
    const timer = setTimeout(() => { this.push(t, { kind: 'error', text: `这一轮运行超过 ${limitMin} 分钟，已停止` }); this.halt(t, 'failed', '运行超时'); }, this.turnLimitMs);
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
      const wasWrapping = !!t.wrapping;
      t.wrapping = false;
      this.tools?.register('task:' + t.id, { title: t.title, work: t.work, perm: t.permission, source: 'task', wrapping: false });
      if (['stopped', 'budget', 'failed'].includes(t.status)) { this.save(t); this.emit({ type: 'task', task: this.public(t) }); return; }
      if (t.wrapNext) {
        t.wrapNext = false;
        t.wrapping = true;
        this.run(t, '【预算收尾·第一步必须先写成品文件】本任务预算即将用完。现在严禁再调用搜索、网页抓取或浏览器工具，也不要先输出长篇分析。第 1 步立即把目前已核实的内容写入目标成品文件落盘（按原定文件名和格式；找不到的参考答案或未找齐的部分直接写「未找到」或「待补充」）；确认成品文件写好后，再用 2～3 行简短收尾。');
        return;
      }
      if ((code || t.turnFailed) && !t.turnOk) {
        const why = errTail.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400);
        // 网络断了、中转站临时出错：会话还在，按 1s、2s、4s、8s、15s 递增等待自动接着做（Codex exec resume / Claude --resume），最多 5 次；
        // 余额不足（402）、Key 不对（401）、内容拦截（422）这类确定性错误重试也一样，直接报错
        const lastErr = [...t.events].reverse().find((e) => e.kind === 'error')?.text || '';
        const said = why + ' ' + lastErr;
        const delays = netRetry.delays(this.retryDelays);
        if (!wasWrapping && (t.session || t.turns <= 1) && (t.resumes || 0) < delays.length && t.cny < t.cap
          && (RECOVERABLE.test(said) || netRetry.isTransientText(said)) && !netRetry.isFatalText(said)) {
          const n = (t.resumes || 0) + 1;
          t.resumes = n;
          this.push(t, { kind: 'note', text: netRetry.retryText(n, delays.length), retry: n, retryMax: delays.length });
          this.setStatus(t, 'running', netRetry.retryText(n, delays.length));
          clearTimeout(t.retryTimer);
          const nextText = t.session ? '刚才网络连接断了。请接着刚才的进度继续把任务做完，已经做好的文件不用重做。' : (t.lastPrompt || t.prompt);
          t.retryTimer = setTimeout(() => {
            t.retryTimer = null;
            if (t.status !== 'running') return;
            this.run(t, nextText);
          }, delays[n - 1]);
          return;
        }
        if (code) this.push(t, { kind: 'error', text: `${ENGINES[t.engine]} 退出（代码 ${code}）${why ? '：' + why : ''}` });
        this.setStatus(t, 'failed', '运行出错');
        return;
      }
      t.turnOk = false; t.turnFailed = false; t.resumes = 0;
      if (t.queue.length) { this.run(t, t.queue.shift()); return; }
      this.setStatus(t, 'done', t.overCap ? '已完成，花费超过上限' : '');
      if (t.kind === 'plugin') void this.afterPlugin(t); else void this.afterTurn(t);
    });
  }

  /** 做插件的任务每轮结束：先按「素材需求.json」生成图片，再按插件协议校验；有问题自动让 AI 修（最多 AUTO_FIX 次） */
  async afterPlugin(t) {
    try { await this.makeAssets(t); } catch (e) { this.push(t, { kind: 'error', text: '生成素材图片失败：' + e.message }); }
    if (t.child) return;
    const r = this.checkPlugin(t);
    if (!r.problems.length) {
      t.fixes = 0; this.save(t);
      this.push(t, { kind: 'out', text: `插件「${r.manifest.name}」v${r.manifest.version} 检查通过：右侧可以试用，满意了点「装上」` });
      return;
    }
    if (!t.overCap && (t.fixes || 0) < AUTO_FIX && t.status === 'done' && t.cny < t.cap) {
      t.fixes = (t.fixes || 0) + 1;
      this.push(t, { kind: 'note', text: `插件检查发现 ${r.problems.length} 个问题，已让 AI 自动修正（第 ${t.fixes} 次）` });
      this.run(t, '导播台按插件协议 cs-plugin/1 校验了 plugin 文件夹，发现下面的问题。请逐条修正，改完用一两句话说明：\n' + r.problems.slice(0, 20).map((p) => '- ' + p).join('\n'));
      return;
    }
    this.suggestQuality(t, '插件自查没通过');
    this.push(t, { kind: 'error', text: '插件还没通过检查：' + r.problems.slice(0, 5).join('；') + (r.problems.length > 5 ? ` 等 ${r.problems.length} 个问题` : '') });
  }

  /** 按插件协议检查任务里的插件，结果记在任务上给界面显示 */
  checkPlugin(t) {
    if (!t.pluginDir) throw new Error('这个任务不是做插件的');
    let r;
    try { r = spec.checkFolder(t.pluginDir); } catch (e) { r = { manifest: null, problems: ['插件文件夹读不了：' + e.message] }; }
    t.check = { at: Date.now(), ok: !!r.manifest && !r.problems.length, problems: r.problems.slice(0, 30), id: r.manifest?.id || '', name: r.manifest?.name || '', version: r.manifest?.version || '' };
    this.save(t);
    this.emit({ type: 'task', task: this.public(t) });
    return r;
  }

  /**
   * AI 在「素材需求.json」里列出的图片：用老师的 AI 接口生成（已有的跳过）。插件的图存进插件文件夹；
   * 备课成品（PPT 情境图、课件插图）存在任务文件夹里 file 写的位置，例如「配图/电梯.png」。
   */
  async makeAssets(t) {
    const req = path.join(t.work, '素材需求.json');
    if (!this.imageGen || !fs.existsSync(req)) return;
    const plugin = t.kind === 'plugin', root = plugin ? t.pluginDir : t.work, shown = plugin ? 'plugin/' : '';
    let list;
    try { list = JSON.parse(fs.readFileSync(req, 'utf8').replace(/^\uFEFF/, '')); } catch { throw new Error('素材需求.json 不是合法的 JSON'); }
    const todo = [];
    for (const it of Array.isArray(list) ? list : Array.isArray(list?.images) ? list.images : []) {
      const rel = spec.relPath(it?.file), prompt = String(it?.prompt || '').trim();
      if (!rel || !prompt || !/\.(png|jpe?g|webp)$/i.test(rel)) continue;
      const out = path.join(root, rel);
      if (!fs.existsSync(out)) todo.push({ rel, out, prompt: prompt.slice(0, 2000), size: it.size });
    }
    if (!todo.length) return;
    if (todo.length > ASSETS_PER_TURN) this.push(t, { kind: 'note', text: `素材需求里有 ${todo.length} 张新图，这一轮先生成前 ${ASSETS_PER_TURN} 张` });
    t.exporting = true;
    try {
      for (const x of todo.slice(0, ASSETS_PER_TURN)) {
        this.push(t, { kind: 'status', text: `正在生成素材图片 ${x.rel}…` });
        const r = await this.imageGen({ prompt: x.prompt, size: x.size, feature: plugin ? 'AI 工坊·插件素材' : 'AI 工坊·配图', taskId: t.id });
        const m = /^data:image\/[\w+.-]+;base64,(.+)$/s.exec(String(r?.image || ''));
        if (!m) throw new Error('生图服务没有返回图片');
        fs.mkdirSync(path.dirname(x.out), { recursive: true });
        fs.writeFileSync(x.out, Buffer.from(m[1], 'base64'));
        this.push(t, { kind: 'file', text: '新建 ' + shown + x.rel });
        if (r.cny) { t.cny = Math.round((t.cny + Number(r.cny)) * 1e4) / 1e4; this.push(t, { kind: 'usage', text: `生成 ${x.rel} ${r.quoted != null ? '' : '约 '}¥${Number(r.cny).toFixed(2)}（已记入本任务账，任务累计 ¥${t.cny.toFixed(2)} / ¥${t.cap}）` }); }
      }
    } finally { t.exporting = false; this.save(t); this.emit({ type: 'task', task: this.public(t) }); }
  }

  /**
   * 备课成品每轮结束：先按「素材需求.json」生成配图，再做成品自检（HTML 打包并点一遍、题库出处核对、公式检查），
   * 有问题自动让 AI 修（最多 AUTO_FIX 次，和插件一样）；检查完把这一回合（含自动修的几轮）改过的 Markdown 排版导出。
   */
  async afterTurn(t) {
    try { await this.makeAssets(t); } catch (e) { this.push(t, { kind: 'error', text: '生成配图失败：' + e.message }); }
    if (t.child) return;
    let r = null;
    if (this.check) {
      t.exporting = true;
      this.push(t, { kind: 'status', text: '正在自检成品（打开课件点一遍、核对题目出处、检查公式）…' });
      try { r = await this.check(t); } catch (e) { this.push(t, { kind: 'error', text: '成品自检没做成：' + e.message }); }
      finally { t.exporting = false; this.save(t); this.emit({ type: 'task', task: this.public(t) }); }
    }
    if (t.child) return;
    for (const n of r?.notes || []) this.push(t, { kind: 'out', text: n });
    const problems = r?.problems || [];
    if (r) t.selfCheck = { at: Date.now(), ok: !problems.length, problems: problems.slice(0, 30), notes: (r.notes || []).slice(0, 20) };
    if (problems.length && !t.overCap && (t.fixes || 0) < AUTO_FIX && t.status === 'done' && t.cny < t.cap) {
      t.fixes = (t.fixes || 0) + 1; this.save(t);
      this.push(t, { kind: 'note', text: `成品自检发现 ${problems.length} 个问题，已让 AI 自动修正（第 ${t.fixes} 次）` });
      this.run(t, '导播台自动检查了你这一轮做的成品，发现下面的问题。请逐条修正（打包过的 HTML 改 .cs-src 里的源文件），改完再自查一遍，最后用一两句话说明改了什么：\n' + problems.slice(0, 20).map((p) => '- ' + p).join('\n'));
      return;
    }
    if (problems.length) this.push(t, { kind: 'error', text: `成品自检还有 ${problems.length} 个问题没解决：` + problems.slice(0, 3).map((p) => p.split('\n')[0]).join('；') + '。可以在下面直接告诉 AI 怎么改。' });
    else if (r?.files?.length) this.push(t, { kind: 'out', text: '成品自检通过' });
    t.fixes = 0; this.save(t);
    await this.autoExport(t);
  }

  /** 这一回合（老师发话后，含自动修正的几轮）新写或改过的 Markdown 自动排成 Word / PDF / PPT（老师一般不直接用 .md） */
  async autoExport(t) {
    const formats = cleanFormats(t.formats ?? ['docx', 'pdf']);
    if (!this.exporter || !formats.length) return;
    const since = Math.min(t.roundStart || Infinity, t.turnStart || Infinity) - 2000;
    const mds = this.files(t.id).filter((f) => /\.(md|markdown)$/i.test(f.name) && !['任务背景.md', '进度.md'].includes(f.name) && !/^(资料|下载|附件)\//.test(f.name) && f.mtime >= since);
    // 「…长图.md」是给学生手机看的：只排成一张长图 PNG
    for (const f of mds) await this.exportFile(t.id, f.path, /长图\.(md|markdown)$/i.test(f.name) ? ['png'] : formats).catch(() => {});
  }

  /** 把任务文件夹里的一个 Markdown 导出成指定格式 */
  async exportFile(id, file, formats) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    const full = path.resolve(String(file || '')), rel = path.relative(t.work, full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.(md|markdown)$/i.test(full)) throw new Error('只能转换这个任务文件夹里的 Markdown 文件');
    const want = [...new Set((Array.isArray(formats) ? formats : []).filter((k) => ['docx', 'pdf', 'pptx', 'png'].includes(k)))];
    if (!want.length) throw new Error('请选择要导出的格式');
    if (!this.exporter) throw new Error('导出功能不可用');
    const label = { docx: 'Word', pdf: 'PDF', pptx: 'PPT', png: '手机长图' };
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
    if (r.model) { t.model = r.model; if (tier.weakModel(r.model)) this.suggestQuality(t, `这次用的是偏弱的模型 ${clip(r.model, 40)}`); }
    for (const e of r.events) {
      this.push(t, e);
      if (e.kind === 'error' && !t.noRouteSaid && t.tier !== 'save' && this.tierApplies(t) && tier.isNoRoute(400, e.text)) { t.noRouteSaid = true; this.push(t, { kind: 'note', text: `「${tier.TIERS[t.tier].name}」档位现在没有能用的线路：点上面「模型 / 权限」换一个档位再继续` }); }
    }
    if (r.usage) {
      if (t.engine === 'codex') this.chargeCodex(t, r.usage, !r.failed);
      else this.chargeClaude(t, r);
    }
    if (r.turnDone) {
      if (r.failed) t.turnFailed = true;
      else t.turnOk = true;
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
      cny = delta * (this.ledger?.budget.usdRate || 7.2) * (this.ledger?.factorFor?.(t.model || t.pick || 'claude') ?? this.ledger?.factor() ?? 1);
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
    const overAt = t.wrapping ? t.cap + wrapGrace(t.cap) : t.cap;
    let over = '';
    if (finished ? t.cny >= t.cap : t.cny >= overAt) over = '到了单任务花费上限';
    else { try { this.ledger?.check(); } catch (err) { over = err.message; } }
    if (!over) return;
    if (finished) {
      // 这一轮已经做完，钱也已经花了：成果照常保留，只是不再接着跑排队的指令
      t.queue = []; t.overCap = over;
      this.push(t, { kind: 'note', text: over + '。这一轮已完成，继续追加前请先在「AI 账本」调高上限。' });
      return;
    }
    this.push(t, { kind: 'error', text: over + '，已自动停止' });
    this.halt(t, 'budget', t.cny >= overAt ? '到达花费上限' : '到达每日/每月上限');
  }

  /** 运行中定时读 Codex 的 rollout：检查沙箱是否被意外降为只读、显示实时花费，并在一轮还没结束时按 75% 提前收尾或按上限停下 */
  peekCodex(t, enforce = true) {
    if (!t.session) return;
    if (!t.rollout) { t.rollout = findRollout(t.session, t.rolloutHome); if (!t.rollout) return; t.rollPos = 0; }
    const r = readRollout(t.rollout, t.rollPos || 0);
    if (!r) return;
    t.rollPos = r.pos;
    if (r.model) t.model = r.model;
    if (r.sandbox) {
      t.actualSandbox = r.sandbox;
      if (enforce && t.status === 'running' && t.permission !== 'danger' && r.sandbox === 'read-only') {
        const msg = '安全沙箱被系统降为了只读（可能是磁盘格式不支持权限控制或沙箱尚未就绪），AI 无法写入成品文件，已立即停止避免白花钱。可将任务权限切换为「完全访问」后继续，或把软件数据目录放在 NTFS 磁盘上。';
        this.push(t, { kind: 'error', text: msg });
        this.halt(t, 'failed', '沙箱被降为只读');
        return;
      }
    }
    if (!r.total) return;
    t.rollTotal = tok(r.total);
    if (!enforce || t.status !== 'running' || !this.ledger) return;
    const usage = usageSince(t.rollTotal, t.codexSeen), live = this.ledger.cost(t.model || t.engine, usage);
    if (Math.abs(live - (t.live || 0)) >= 0.005) { t.live = Math.round(live * 1e4) / 1e4; this.emit({ type: 'task', task: this.public(t) }); }
    const hardCap = t.wrapping ? t.cap + wrapGrace(t.cap) : t.cap;
    if (t.cny + live >= hardCap) { t.codexSeen = t.rollTotal; this.record(t, usage, undefined, false); return; }
    // 花到上限的 75%（预留 25% 给收尾轮带上下文写成品）还没做完：先记账，停下这一步，接着同一个会话强制先写成品收尾
    if (!t.wrapped && t.session && t.child && t.cny + live >= t.cap * WRAP_RATIO) {
      t.wrapped = true; t.wrapNext = true;
      t.codexSeen = t.rollTotal; this.record(t, usage, undefined, false);
      this.push(t, { kind: 'note', text: `已花到本任务上限的 75%（¥${t.cny.toFixed(2)} / ¥${t.cap}），预留剩余预算让 AI 马上写成品收尾` });
      killTree(t.child);
    }
  }

  halt(t, status, note) {
    t.queue = [];
    clearTimeout(t.retryTimer); t.retryTimer = null;
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
  inject(id, text, attachments) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    let msg = String(text || '').trim(); if (!msg) throw new Error('指令是空的');
    const live = t.child && t.status === 'running';
    if (!live) {
      if (t.retryTimer) { clearTimeout(t.retryTimer); t.retryTimer = null; t.resumes = 0; }
      // 老师调高了单任务上限后，旧任务也按新上限继续
      const capNow = this.ledger?.budget.caps.task || 0;
      if (t.cny >= t.cap && t.cap >= capNow) throw new Error('这个任务已到花费上限；如需继续，请新建任务或在「AI 账本」里调高单任务上限');
      if (t.child) throw new Error('任务正在停止，请稍等几秒再继续');
      this.ledger?.check();
      if (t.cap < capNow) t.cap = capNow;
    }
    const att = this.attach(t, attachments);
    t.fixes = 0; if (!live) t.roundStart = Date.now();
    this.push(t, { kind: 'user', text: clip(msg, 2000) + att.label });
    // 老师连着两次说「不对」「重做」「太笨」：提醒一次切到质量优先
    t.complaints = tier.complaint(msg) ? (t.complaints || 0) + 1 : 0;
    if (t.complaints >= 2) this.suggestQuality(t, '你连着两次说做得不对');
    msg += att.prompt;
    if (live && t.sendNow && t.pending > 0) { t.sendNow(msg); return this.public(t); }
    if (live) { t.queue.push(msg); this.emit({ type: 'task', task: this.public(t) }); return this.public(t); }
    this.run(t, msg);
    return this.public(t);
  }

  /** 档位对这个任务起不起作用：用导播台的 AI 接口，并且接口是银子 API 系站点（玲珑账号、合作站） */
  tierApplies(t) {
    if (!t?.useStudioKey || !this.credentials) return false;
    try { return tier.applies(this.credentials().baseUrl); } catch { return false; }
  }

  /**
   * 「变笨了」主动推荐（设计稿 D.3）：效果可能不好时在任务里提醒「切到质量优先再做一遍」，同一任务只提醒一次。
   * 触发：老师连着两次说不对、自查或来源核对没通过、用的是已知偏弱的模型。别的模块（来源核对）也调这个。
   */
  suggestQuality(t, why) {
    if (typeof t === 'string') t = this.tasks.get(t);
    if (!t || t.suggested || t.tier === 'quality' || !this.tierApplies(t)) return false;
    t.suggested = true; t.suggest = { why: clip(why, 120), at: Date.now() };
    this.push(t, { kind: 'note', text: `${t.suggest.why}。可以切到质量优先再做一遍` });
    this.save(t);
    return true;
  }

  /** 老师点了「切到质量优先再做一遍」：换档（下一轮生效）并让 AI 把上一轮重新做一遍 */
  retryQuality(id) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    t.suggest = null;
    this.configure(id, { tier: 'quality' });
    return this.inject(id, '（已切到质量优先档位）上一轮的效果不太好，请把上一轮的成品重新认真做一遍：先对照要求逐条检查哪里没做好，改好、自查通过以后再交付。');
  }

  stop(id) {
    const t = this.tasks.get(id); if (!t) throw new Error('找不到这个任务');
    if (t.child) { this.push(t, { kind: 'status', text: '老师手动停止' }); this.halt(t, 'stopped', '已手动停止'); }
    // 正在等下一次自动重连：停掉计时，不再重试
    else if (t.retryTimer) { this.push(t, { kind: 'status', text: '老师手动停止，不再自动重连' }); this.halt(t, 'stopped', '已手动停止'); }
    return this.public(t);
  }

  remove(id) {
    const t = this.tasks.get(id); if (!t) return;
    if (t.child || t.retryTimer) throw new Error('任务还在运行，请先停止');
    this.tasks.delete(id);
    this.tools?.drop('task:' + id);
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

  stopAll() { for (const t of this.tasks.values()) { clearTimeout(t.retryTimer); t.retryTimer = null; } for (const t of this.tasks.values()) if (t.child) { t.status = 'stopped'; t.note = '导播台关闭'; this.save(t); killTree(t.child); } }
}

module.exports = { Agents, readCodex, readClaude, locate, bundledCodexDir, ENGINES, TURN_LIMIT_MS, WRAP_RATIO, wrapGrace };
