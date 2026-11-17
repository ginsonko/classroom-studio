'use strict';
// AI 助教的内核：后台常驻一个 Codex app-server（JSON-RPC，一行一条），每段对话对应一个 thread。
// 软件自己的功能以 dynamicTools 交给 Codex；工具调用转给教师窗口执行（学生、课表、题库都在那里），
// 结果再回给 Codex。Codex 要运行命令、改文件、要更多权限时，同样转给教师窗口，老师点了才继续。
// Key 只经环境变量交给子进程；用导播台的 AI 接口时 Codex 用自己单独的配置目录，不碰老师本机的 Codex。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { locate } = require('./agents.cjs');
const kit = require('./agentKit.cjs');
const csTools = require('./csToolsMcp.cjs');
const tier = require('./tier.cjs');
const netRetry = require('./netRetry.cjs');
const { ensureCodexConfig } = require('./codexHome.cjs');

const KEY_ENV = 'CS_RELAY_API_KEY';
const ASK_MS = 30 * 60 * 1000;
const TURN_MS = 30 * 60 * 1000;
const KEEP_ITEMS = 600;
const EFFORTS = ['low', 'medium', 'high'];
const ACCESS = ['ask', 'common', 'full'];
/**
 * 三档权限 → Codex 的审批方式和沙箱。
 * ask：除了只读命令都问；common：命令在沙箱里跑（只能写工作目录、可以联网），要越界时才问；full：不问、不设沙箱。
 */
function accessPolicy(level, work) {
  if (level === 'full') return { approval: 'never', sandbox: 'danger-full-access', policy: { type: 'dangerFullAccess' } };
  if (level === 'ask') return { approval: 'untrusted', sandbox: 'workspace-write', policy: { type: 'workspaceWrite', writableRoots: [work], networkAccess: false } };
  return { approval: 'on-request', sandbox: 'workspace-write', policy: { type: 'workspaceWrite', writableRoots: [work], networkAccess: true } };
}
const toml = (s) => JSON.stringify(String(s));
const clip = (s, n = 4000) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const rid = () => crypto.randomBytes(6).toString('hex');
const NOTICE = /ignoring \d+ unrecognized|unrecognized configuration|Under-development features|deprecated|suppress_unstable/i;

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGKILL');
}

/** 累计用量 → 相对已记账部分的增量（账本格式：input 不含缓存命中） */
function usageDelta(total, seen) {
  const t = { i: Number(total?.inputTokens) || 0, c: Number(total?.cachedInputTokens) || 0, o: Number(total?.outputTokens) || 0 };
  const s = { i: Number(seen?.inputTokens) || 0, c: Number(seen?.cachedInputTokens) || 0, o: Number(seen?.outputTokens) || 0 };
  const fresh = t.i < s.i || t.c < s.c || t.o < s.o;
  const d = fresh ? t : { i: t.i - s.i, c: t.c - s.c, o: t.o - s.o };
  return { input: Math.max(0, d.i - d.c), cached: d.c, output: d.o };
}

/** 老师自己的 Codex 配置里装了哪些 MCP 服务（助教不需要它们，省得每轮多花几万 token） */
function userMcpNames(home) {
  try {
    const text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
    return [...new Set([...text.matchAll(/^\s*\[mcp_servers\.("?)([A-Za-z0-9_-]+)\1\]/gm)].map((m) => m[2]))];
  } catch { return []; }
}

/** 一条命令 / 一次改文件 / 一次加权限 → 给老师看的说明 */
function describeApproval(method, p) {
  if (method === 'item/commandExecution/requestApproval') {
    const cmd = String(p.command || '').replace(/^"?[A-Za-z]:\\\\?Windows\\\\?System32\\\\?WindowsPowerShell\\\\?v1\.0\\\\?powershell\.exe"?\s+(-NoProfile\s+)?-Command\s+/i, '');
    const net = p.networkApprovalContext ? `联网：${p.networkApprovalContext.host || ''}` : '';
    return { type: 'command', title: net ? 'AI 助教想要联网' : 'AI 助教想在你的电脑上运行命令', detail: clip(net || cmd.replace(/^"|"$/g, ''), 1200), reason: clip(p.reason || '', 400), cwd: p.cwd || '' };
  }
  if (method === 'item/fileChange/requestApproval') return { type: 'file', title: 'AI 助教想修改你电脑上的文件', detail: p.grantRoot ? `允许写入：${p.grantRoot}` : '', reason: clip(p.reason || '', 400) };
  if (method === 'item/permissions/requestApproval') {
    const fsP = p.permissions?.fileSystem || {}, list = [...(fsP.read || []).map((x) => '读取 ' + x), ...(fsP.write || []).map((x) => '写入 ' + x), ...(fsP.entries || []).map((e) => `${e.access === 'write' ? '写入' : e.access === 'read' ? '读取' : '禁止'} ${e.path?.path || e.path?.pattern || e.path?.value?.kind || ''}`)];
    if (p.permissions?.network?.enabled) list.push('联网');
    return { type: 'permissions', title: 'AI 助教想要更多权限', detail: list.join('\n') || '更多权限', reason: clip(p.reason || '', 400) };
  }
  if (method === 'item/tool/requestUserInput') return { type: 'input', title: 'AI 助教想问你', questions: (p.questions || []).slice(0, 4).map((q) => ({ id: String(q.id), header: clip(q.header, 40), question: clip(q.question, 400), options: (q.options || []).slice(0, 6).map((o) => ({ label: clip(o.label, 60), description: clip(o.description, 200) })), secret: !!q.isSecret })) };
  return null;
}

/** 老师的选择 → app-server 要的回复 */
function approvalReply(method, p, v) {
  const yes = v === 'accept' || v === 'session';
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: v === 'session' ? 'acceptForSession' : yes ? 'accept' : 'decline' };
  if (method === 'item/permissions/requestApproval') return yes ? { permissions: p.permissions || {}, scope: v === 'session' ? 'session' : 'turn' } : { permissions: {} };
  if (method === 'item/tool/requestUserInput') {
    const answers = {};
    for (const q of p.questions || []) { const a = v && typeof v === 'object' ? v[q.id] : ''; answers[q.id] = { answers: a ? [String(a)] : [] }; }
    return { answers };
  }
  return { decision: 'decline' };
}

class Assistant {
  constructor({ dir, toolsDir, ledger, credentials, log, emit, onCharge, fetch: fetchFn, tools, tierOf, codexHome, retryDelays }) {
    /** AI 工具（toolHost.cjs）：小羽一个会话「assistant」，工作区是助教的 workspace */
    this.tools = tools || null;
    this.tierOf = tierOf || (() => tier.USES.chat);
    this.dir = dir; this.toolsDir = toolsDir || ''; this.ledger = ledger; this.credentials = credentials; this.log = log;
    this.emit = emit || (() => {}); this.onCharge = onCharge || (() => {}); this.fetch = fetchFn;
    this.chatDir = path.join(dir, 'chats'); this.work = path.join(dir, 'workspace');
    this.codexHome = codexHome || null;
    this.home = typeof codexHome === 'string' && codexHome ? codexHome : codexHome?.dir || path.join(dir, 'home');
    for (const d of [this.chatDir, this.work, this.home]) fs.mkdirSync(d, { recursive: true });
    ensureCodexConfig(this.home);
    this.chats = new Map(); this.asks = new Map(); this.timers = new Map();
    this.server = null; this.byThread = new Map();
    // 网络波动自动重连（设计稿 E.3）：每段对话记住上一句话的发送参数和已经重连了几次；等待默认 1s、2s、4s、8s、15s
    this.lastOpts = new Map(); this.retries = new Map();
    this.retryDelays = Array.isArray(retryDelays) ? retryDelays : null;
    for (const n of fs.readdirSync(this.chatDir)) {
      if (!n.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(this.chatDir, n), 'utf8'));
        if (!c?.id) continue;
        // 上次关闭时还在跑的一轮，进程已经不在了
        if (c.running) { const t = c.turns?.find((x) => x.id === c.running); if (t) t.status = 'stopped'; c.running = null; }
        for (const it of c.items || []) if (it.status === 'run' || it.status === 'wait') it.status = 'stopped';
        this.chats.set(c.id, c);
      } catch { /* 坏文件跳过 */ }
    }
  }

  // ── 对话 ─────────────────────────────────────────
  meta(c) { return { id: c.id, title: c.title, created: c.created, updated: c.updated, running: !!c.running, retrying: !!this.retries?.get(c.id)?.timer, cny: c.cny || 0, source: c.source || '', persona: c.persona || '', count: c.items.filter((x) => x.kind === 'user').length }; }
  list() { return [...this.chats.values()].sort((a, b) => b.updated - a.updated).map((c) => this.meta(c)); }
  get(id) { const c = this.chats.get(id); if (!c) throw new Error('找不到这段对话'); return c; }
  create({ title, source, persona } = {}) {
    const now = Date.now(), c = { id: new Date(now).toISOString().slice(0, 10) + '-' + rid(), title: clip(title || '新对话', 40), created: now, updated: now, source: String(source || '').slice(0, 20), persona: String(persona || '').slice(0, 20), threadId: '', toolsSig: '', model: '', items: [], turns: [], cny: 0, running: null, usageSeen: null };
    this.chats.set(c.id, c); this.save(c, true); this.emit({ ev: 'chat', chat: this.meta(c) });
    return c;
  }
  rename(id, title) { const c = this.get(id); c.title = clip(String(title || '').trim() || c.title, 40); this.save(c, true); this.emit({ ev: 'chat', chat: this.meta(c) }); return this.meta(c); }
  remove(id) {
    const c = this.chats.get(id); if (!c) return;
    if (c.running) throw new Error('这段对话还在进行，先停下来再删除');
    this.chats.delete(id);
    try { fs.unlinkSync(path.join(this.chatDir, id + '.json')); } catch { /* 已经没了 */ }
    this.emit({ ev: 'removed', id });
  }
  save(c, now = false) {
    clearTimeout(this.timers.get(c.id));
    const write = () => {
      this.timers.delete(c.id);
      if (!this.chats.has(c.id)) return;
      if (c.items.length > KEEP_ITEMS) c.items.splice(0, c.items.length - KEEP_ITEMS);
      if (c.turns.length > 200) c.turns.splice(0, c.turns.length - 200);
      try { fs.writeFileSync(path.join(this.chatDir, c.id + '.json'), JSON.stringify(c)); } catch (e) { this.log?.warn('助教对话保存失败', e); }
    };
    if (now) write(); else this.timers.set(c.id, setTimeout(write, 400));
  }
  /** 新增或更新一条（按 id），推给界面 */
  put(c, item, persist = true) {
    const i = c.items.findIndex((x) => x.id === item.id);
    if (i >= 0) c.items[i] = { ...c.items[i], ...item }; else c.items.push({ at: Date.now(), ...item });
    c.updated = Date.now();
    this.emit({ ev: 'item', chatId: c.id, item: c.items[i >= 0 ? i : c.items.length - 1] });
    if (persist) this.save(c);
  }
  turnOf(c, turnId) { return c.turns.find((t) => t.id === turnId); }

  // ── app-server 进程 ───────────────────────────────
  /** 用哪套接口：导播台的中转站（有 Key 时默认）或老师自己登录的 Codex */
  plan(studio) {
    const cred = this.credentials ? this.credentials() : {};
    const useStudio = studio !== false && !!cred.key;
    if (studio === true && !cred.key) throw new Error('还没有配置导播台的 AI 接口：先在右侧「AI」面板的设置里导入银子 API 密钥，或在助教设置里改用自己的 Codex 登录');
    // base：接口地址 + Key 指纹（登录玲珑账号换了 Key 也要重启）；sig 再加上档位。只有档位变了时，原来的会话照样续接
    const base = useStudio ? 'studio:' + cred.baseUrl + '#' + crypto.createHash('sha256').update(String(cred.key)).digest('hex').slice(0, 12) : 'own';
    const t = useStudio && tier.applies(cred.baseUrl) ? tier.clean(this.tierOf(), 'chat') : '';
    return { useStudio, cred, base, tier: t, sig: base + '|' + tier.scopeOf(t) };
  }
  async ensureServer(studio) {
    const p = this.plan(studio);
    if (this.server && !this.server.dead && this.server.sig === p.sig) { await this.server.ready; return this.server; }
    // 只换了档位、别的对话还在跑：先不重启（会打断它），等它这一轮做完再换
    if (this.server && !this.server.dead && this.server.base === p.base && [...this.chats.values()].some((c) => c.running)) { await this.server.ready; return this.server; }
    if (this.server) this.shutdown(this.server.base === p.base ? '切换档位' : '切换 AI 接口');
    const spec = locate('codex', this.toolsDir);
    if (!spec) throw new Error('没有找到 Codex（AI 助教的内核）。请在「备课」页的任务中心点「安装」');
    await tier.ensureSiteRelay();
    ensureCodexConfig(this.home);
    const args = [...spec.pre, 'app-server'], env = { ...process.env, ...spec.env, CODEX_HOME: this.home };
    if (p.useStudio) {
      const baseUrl = tier.relayBaseUrl(p.cred.baseUrl, {
        who: 'assistant',
        key: 'assistant:' + p.base,
        log: this.log,
        onFallback: () => {
          const runChat = [...this.chats.values()].find((c) => c.running);
          if (runChat && !runChat.noRouteFallbackNoted) {
            runChat.noRouteFallbackNoted = true;
            const name = tier.TIERS[p.tier]?.name || p.tier;
            this.put(runChat, { id: 'n-' + rid(), kind: 'note', turn: runChat.running || '', text: `「${name}」档位没有可用分组，已自动去掉档位头、按令牌自己的范围重发一次` }, false);
          }
        },
      });
      env.OPENAI_BASE_URL = baseUrl; env.OPENAI_API_KEY = p.cred.key; env.CODEX_API_KEY = p.cred.key; env[KEY_ENV] = p.cred.key;
      args.push('-c', 'model_provider="classroom"', '-c', `model_providers.classroom.name=${toml('最强网课教辅系统')}`, '-c', `model_providers.classroom.base_url=${toml(baseUrl)}`,
        '-c', `model_providers.classroom.env_key=${toml(KEY_ENV)}`, '-c', 'model_providers.classroom.wire_api="responses"');
      // 档位：常驻进程启动时定下，换档后下一句话重启进程，再用 thread/resume 接回原来的会话
      args.push(...tier.codexArgs(p.cred.baseUrl, p.tier));
    }
    args.push('-c', 'suppress_unstable_features_warning=true');
    // cs_tools 和 Codex 自带的网页搜索：工具清单按「常用权限」列出，每次调用再按这一轮的权限检查
    if (this.tools) {
      this.tools.register('assistant', { title: '小羽', work: this.work, perm: 'common', source: 'assistant' });
      const m = this.tools.codexArgs('assistant');
      args.push(...m.args, '-c', `web_search=${this.tools.nativeSearch('common') ? '"live"' : '"disabled"'}`);
      Object.assign(env, m.env);
    }
    try { kit.installKit(this.work, 'codex'); } catch (e) { this.log?.warn('助教技能文件写入失败', e); }
    const child = spawn(spec.cmd, args, { cwd: this.work, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const s = { child, sig: p.sig, base: p.base, tier: p.tier, studio: p.useStudio, next: 0, wait: new Map(), dead: false, loaded: new Set(), errTail: '' };
    this.server = s;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        try { this.onMessage(s, m); } catch (e) { this.log?.warn('助教消息处理失败', e); }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (t) => { s.errTail = (s.errTail + t).slice(-3000); });
    child.stdin.on('error', () => {});
    const gone = (why) => {
      if (s.dead) return; s.dead = true;
      for (const w of s.wait.values()) w.no(new Error(why));
      s.wait.clear();
      for (const [threadId, chatId] of this.byThread) {
        const c = this.chats.get(chatId);
        if (c?.running && s.loaded.has(threadId)) this.finishTurn(c, c.running, 'failed', why);
      }
      for (const [k, a] of this.asks) if (a.server === s) { this.asks.delete(k); this.emit({ ev: 'askDone', reqId: k }); }
      if (this.server === s) this.server = null;
    };
    child.on('error', (e) => gone('Codex 启动失败：' + e.message));
    child.on('exit', (code) => gone(`AI 助教的内核退出了（${code ?? '已停止'}）${s.errTail && !NOTICE.test(s.errTail) ? '：' + clip(s.errTail.trim().split('\n').pop(), 300) : ''}`));
    s.ready = this.rpc(s, 'initialize', { clientInfo: { name: 'classroom-studio', title: '最强网课教辅系统', version: '1' }, capabilities: { experimentalApi: true } })
      .then(() => { this.write(s, { jsonrpc: '2.0', method: 'initialized' }); });
    s.ready.catch(() => {});
    await s.ready;
    return s;
  }
  write(s, m) { if (!s.dead) s.child.stdin.write(JSON.stringify(m) + '\n'); }
  rpc(s, method, params, ms = 120000) {
    return new Promise((ok, no) => {
      if (s.dead) { no(new Error('AI 助教的内核没有在运行')); return; }
      const id = ++s.next, t = setTimeout(() => { s.wait.delete(id); no(new Error('AI 助教的内核没有响应：' + method)); }, ms);
      s.wait.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, no: (e) => { clearTimeout(t); no(e); } });
      this.write(s, { jsonrpc: '2.0', id, method, params });
    });
  }
  shutdown(why = '已关闭') {
    const s = this.server; if (!s) return;
    this.server = null;
    s.child.removeAllListeners('exit');
    killTree(s.child);
    s.dead = true;
    for (const w of s.wait.values()) w.no(new Error(why));
    for (const c of this.chats.values()) if (c.running) this.finishTurn(c, c.running, 'stopped', why);
  }

  // ── 一轮对话 ─────────────────────────────────────
  /**
   * o: { id, text, context, images, files, base, developer, tools, toolsSig, model, effort, studio, seed }
   * text 是老师看到的原话；context 是附在前面的软件状态（老师看不到）。
   */
  async send(o = {}) {
    const c = this.get(o.id);
    const text = String(o.text || '').trim();
    if (!text) throw new Error('说点什么吧');
    this.ledger?.check();
    const images = (Array.isArray(o.images) ? o.images : []).filter((p) => typeof p === 'string' && fs.existsSync(p)).slice(0, 6);
    const files = (Array.isArray(o.files) ? o.files : []).map(String).slice(0, 12);
    const input = [{ type: 'text', text: (o.context ? String(o.context) + '\n\n' : '') + text }, ...images.map((p) => ({ type: 'localImage', path: p }))];
    if (c.running) {
      // 正在回答时老师又补了一句：插进这一轮（Codex 会在下一步看到）
      const s = this.server;
      if (!s || s.dead) throw new Error('上一轮还没结束，请稍等');
      this.put(c, { id: 'u-' + rid(), kind: 'user', turn: c.running, text: clip(text, 8000), files });
      await this.rpc(s, 'turn/steer', { threadId: c.threadId, expectedTurnId: c.running, input });
      return this.meta(c);
    }
    const resume = o.resume === true;
    if (!resume) {
      // 老师自己说了新的一句：之前的自动重连计数清零，等着的重连也取消
      this.cancelRetry(c);
      this.lastOpts.set(c.id, { ...o, resume: false });
      if (c.items.every((x) => x.kind !== 'user') && (!c.title || c.title === '新对话')) c.title = clip(text.replace(/\s+/g, ' '), 24);
      // 老师连着两次说「不对」「重做」「太笨」：这一轮答完，在回复下面提醒一次切到质量优先
      c.complaints = tier.complaint(text) ? (c.complaints || 0) + 1 : 0;
      if (c.complaints >= 2) c.pendingSuggest = '你连着两次说做得不对';
    }
    const local = 'u-' + rid();
    c.access = ACCESS.includes(o.access) ? o.access : 'common';
    const pol = accessPolicy(c.access, this.work);
    this.tools?.register('assistant', { title: '小羽', work: this.work, perm: c.access, source: 'assistant', chatId: c.id });
    if (this.tools) o = { ...o, developer: (o.developer ? o.developer + '\n\n' : '') + this.tools.note(c.access) };
    // 自动重连发的那句「接着做」不算老师说的话，显示成一条提示
    this.put(c, resume ? { id: local, kind: 'note', turn: '', text: '已重新连上，接着刚才的进度继续…' } : { id: local, kind: 'user', turn: '', text: clip(text, 8000), files });
    let s;
    try {
      s = await this.ensureServer(o.studio);
      // 走导播台的中转站又没选模型时，用 AI 设置里的模型（一键导入给的推荐模型），不让 Codex 落到它自己的默认模型（Key 的分组里常常没有）
      if (!o.model && s.studio) { const m = this.credentials?.().model; if (m) o = { ...o, model: m }; }
      const sig = String(o.toolsSig || '');
      let seed = '';
      // 1.7.0 以前存的 serverSig 是「studio:地址」：同一个地址也算同一个接口，会话照样续接
      const same = c.serverSig === s.base || (s.studio && c.serverSig === s.base.split('#')[0]);
      if (c.threadId && c.toolsSig === sig && same) {
        if (resume) s.loaded.delete(c.threadId);
        if (!s.loaded.has(c.threadId)) {
          try {
            await this.rpc(s, 'thread/resume', { threadId: c.threadId, cwd: this.work, baseInstructions: o.base || null, developerInstructions: o.developer || null, approvalPolicy: pol.approval, sandbox: pol.sandbox, excludeTurns: true });
            s.loaded.add(c.threadId); this.byThread.set(c.threadId, c.id);
          } catch (e) { this.log?.warn('助教续接对话失败，改开新会话', e?.message || e); c.threadId = ''; }
        }
      } else if (c.threadId) c.threadId = '';
      if (!c.threadId) {
        // 换了工具清单 / 换了接口：旧会话续接不了，开新会话并带上前面聊过的要点
        seed = c.items.some((x) => x.kind === 'user' && x.id !== local) ? this.recap(c, local) : '';
        const r = await this.rpc(s, 'thread/start', {
          cwd: this.work, approvalPolicy: pol.approval, sandbox: pol.sandbox, model: o.model || null,
          baseInstructions: o.base || null, developerInstructions: o.developer || null, dynamicTools: Array.isArray(o.tools) ? o.tools : [],
          serviceName: 'classroom-studio',
        });
        c.threadId = r.thread.id; c.toolsSig = sig; c.serverSig = s.base; c.model = r.model || r.thread?.model || o.model || ''; c.usageSeen = null;
        s.loaded.add(c.threadId); this.byThread.set(c.threadId, c.id);
      }
      if (tier.weakModel(o.model || c.model)) c.pendingSuggest = c.pendingSuggest || `这次用的是偏弱的模型 ${clip(o.model || c.model, 40)}`;
      c.tier = s.tier || '';
      if (seed) input[0].text = seed + '\n\n' + input[0].text;
      // 权限每轮都带上：老师中途改了档位，下一句话就按新的来，不用开新会话
      const r = await this.rpc(s, 'turn/start', { threadId: c.threadId, input, approvalPolicy: pol.approval, sandboxPolicy: pol.policy, ...(o.model ? { model: o.model } : {}), ...(EFFORTS.includes(o.effort) ? { effort: o.effort } : {}) });
      const turnId = r.turn.id;
      c.running = turnId;
      c.turns.push({ id: turnId, at: Date.now(), status: 'running', changes: [], cny: 0 });
      const u = c.items.find((x) => x.id === local); if (u) u.turn = turnId;
      this.put(c, { id: local, turn: turnId });
      clearTimeout(this.timers.get('turn:' + c.id));
      this.timers.set('turn:' + c.id, setTimeout(() => { if (c.running === turnId) { this.put(c, { id: 'e-' + rid(), kind: 'error', turn: turnId, text: '这一轮超过 30 分钟，已停止' }); void this.stop(c.id); } }, TURN_MS));
      this.emit({ ev: 'chat', chat: this.meta(c) });
      this.save(c, true);
      return this.meta(c);
    } catch (e) {
      // 启动阶段或重连时遇到临时网络波动：还有次数就接着按递增等待重连
      if (this.scheduleRetry(c, e.message || String(e))) { this.save(c, true); return this.meta(c); }
      this.put(c, { id: 'e-' + rid(), kind: 'error', turn: '', text: e.message || String(e) });
      this.save(c, true);
      throw e;
    }
  }
  /**
   * 这一轮因为网络波动失败了：等一会儿用 thread/resume 接回同一个会话，再让它接着做。最多 5 次；
   * 余额不足、Key 不对、内容拦截这些确定性错误不重试。返回 true 表示已经安排了重连。
   */
  scheduleRetry(c, error) {
    const base = this.lastOpts.get(c.id);
    if (!base || !netRetry.isTransientText(error) || netRetry.isFatalText(error)) return false;
    const ds = netRetry.delays(this.retryDelays);
    const r = this.retries.get(c.id) || { n: 0, timer: null };
    if (r.n >= ds.length) { this.retries.delete(c.id); return false; }
    r.n += 1;
    clearTimeout(r.timer);
    const n = r.n;
    this.put(c, { id: 'n-' + rid(), kind: 'note', turn: '', retry: n, retryMax: ds.length, text: netRetry.retryText(n, ds.length) }, false);
    this.log?.info?.('小羽自动重连', c.id, n + '/' + ds.length, clip(error, 160));
    r.timer = setTimeout(() => {
      r.timer = null;
      if (this.retries.get(c.id) !== r || c.running) return;
      const nextOpts = c.threadId
        ? { ...base, id: c.id, text: '刚才网络连接断了。请接着刚才的进度继续回答，已经做好的不用重做，也不用重复已经说过的话。', context: '', images: [], files: [], resume: true }
        : { ...base, id: c.id, resume: true };
      void this.send(nextOpts).catch(() => {});
    }, ds[n - 1]);
    this.retries.set(c.id, r);
    this.emit({ ev: 'chat', chat: this.meta(c) });
    return true;
  }
  /** 取消还在等的自动重连；返回 true 表示刚才确实有一个在等 */
  cancelRetry(c) {
    const r = this.retries.get(c.id);
    this.retries.delete(c.id);
    if (!r) return false;
    const waiting = !!r.timer;
    clearTimeout(r.timer);
    return waiting;
  }
  /** 新会话开头附上的前情：最近几轮老师说的和助教答的 */
  recap(c, skip) {
    const lines = c.items.filter((x) => x.id !== skip && (x.kind === 'user' || (x.kind === 'text' && x.phase !== 'commentary'))).slice(-16)
      .map((x) => (x.kind === 'user' ? '老师：' : '助教：') + clip(String(x.text || '').replace(/\s+/g, ' '), 300));
    return lines.length ? `【之前聊过的内容（软件更新后接着聊）】\n${lines.join('\n')}\n【以上是前情】` : '';
  }
  async stop(id) {
    const c = this.get(id);
    // 正在等自动重连：停掉，不再重试
    if (!c.running) { if (this.cancelRetry(c)) { this.put(c, { id: 'n-' + rid(), kind: 'note', turn: '', text: '已停止，不再自动重连' }, false); this.emit({ ev: 'chat', chat: this.meta(c) }); this.save(c, true); } return this.meta(c); }
    this.cancelRetry(c);
    const s = this.server, turnId = c.running;
    for (const [k, a] of this.asks) if (a.chatId === id) { this.asks.delete(k); a.resolve({ cancelled: true }); this.emit({ ev: 'askDone', reqId: k }); }
    if (s && !s.dead) { try { await this.rpc(s, 'turn/interrupt', { threadId: c.threadId, turnId }, 15000); } catch { /* 没响应就直接收尾 */ } }
    setTimeout(() => { if (c.running === turnId) this.finishTurn(c, turnId, 'stopped', '已停止'); }, 4000);
    return this.meta(c);
  }
  /** 「变笨了」提醒（设计稿 D.3）：一段对话只提醒一次；已经是质量优先、或档位不起作用（第三方 Key、自己的 Codex）时不提醒 */
  suggest(c, why, turnId = '') {
    if (!c || c.suggested || !c.tier || c.tier === 'quality') return false;
    c.suggested = true;
    this.put(c, { id: 's-' + rid(), kind: 'suggest', turn: turnId, text: clip(why, 120) }, false);
    return true;
  }
  finishTurn(c, turnId, status, error) {
    const errMsg = (error && error !== '这一轮失败了') ? error : (c.lastTurnErr?.turn === turnId ? c.lastTurnErr.text : error);
    c.lastTurnErr = null;
    // 网络波动导致这一轮失败：不报错，安排自动重连（同一会话 thread/resume 接着做）
    if (status === 'failed' && c.running === turnId && this.scheduleRetry(c, errMsg)) {
      const t0 = this.turnOf(c, turnId);
      if (t0 && t0.status === 'running') t0.status = 'failed';
      c.running = null;
      clearTimeout(this.timers.get('turn:' + c.id));
      for (const it of c.items) if (it.turn === turnId && (it.status === 'run' || it.streaming)) { it.status = it.status === 'run' ? 'stopped' : it.status; it.streaming = false; }
      this.emit({ ev: 'turn', chatId: c.id, turn: t0 || { id: turnId, status } });
      this.emit({ ev: 'chat', chat: this.meta(c) });
      this.save(c, true);
      return;
    }
    if (status === 'completed') this.retries.delete(c.id);
    if (c.pendingSuggest) { const why = c.pendingSuggest; c.pendingSuggest = ''; if (status === 'completed') this.suggest(c, why, turnId); }
    const t = this.turnOf(c, turnId);
    if (t && t.status === 'running') t.status = status;
    if (c.running === turnId) c.running = null;
    clearTimeout(this.timers.get('turn:' + c.id));
    for (const it of c.items) if (it.turn === turnId && (it.status === 'run' || it.streaming)) { it.status = it.status === 'run' ? (status === 'completed' ? 'done' : 'stopped') : it.status; it.streaming = false; }
    if (errMsg && status !== 'completed' && status !== 'stopped') this.put(c, { id: 'e-' + rid(), kind: 'error', turn: turnId, text: clip(errMsg, 800) }, false);
    else if (status === 'stopped') this.put(c, { id: 'n-' + rid(), kind: 'note', turn: turnId, text: '已停止' }, false);
    this.emit({ ev: 'turn', chatId: c.id, turn: t || { id: turnId, status } });
    this.emit({ ev: 'chat', chat: this.meta(c) });
    this.save(c, true);
  }
  /** 教师窗口撤销了一轮：记下来，界面上那一轮显示「已撤销」 */
  markUndone(id, turnId, note) {
    const c = this.get(id), t = this.turnOf(c, turnId);
    if (!t) throw new Error('找不到这一轮');
    t.undone = Date.now();
    this.put(c, { id: 'n-' + rid(), kind: 'note', turn: turnId, text: clip(note || '已撤销这一轮的操作', 400) }, false);
    this.emit({ ev: 'turn', chatId: c.id, turn: t });
    this.save(c, true);
    return t;
  }
  /** 定时任务 / 触发器写进对话里的一条提醒（不调用 AI） */
  notice(id, text) { const c = this.get(id); this.put(c, { id: 'n-' + rid(), kind: 'note', turn: '', text: clip(text, 2000) }); return this.meta(c); }

  // ── 收到 app-server 的消息 ─────────────────────────
  chatOf(threadId) { const id = this.byThread.get(threadId); return id ? this.chats.get(id) : null; }
  onMessage(s, m) {
    if (m.id !== undefined && !m.method) {
      const w = s.wait.get(m.id); if (!w) return; s.wait.delete(m.id);
      if (m.error) w.no(new Error(m.error.message || 'Codex 返回错误')); else w.ok(m.result);
      return;
    }
    if (m.method && m.id !== undefined) { void this.onRequest(s, m); return; }
    const p = m.params || {}, c = p.threadId ? this.chatOf(p.threadId) : null;
    if (!c) return;
    const turn = p.turnId || p.turn?.id || c.running || '';
    switch (m.method) {
      case 'item/started': this.onItem(c, p.item, turn, false); break;
      case 'item/completed': this.onItem(c, p.item, turn, true); break;
      case 'item/agentMessage/delta': {
        const it = c.items.find((x) => x.id === p.itemId);
        if (it) { it.text = (it.text || '') + String(p.delta || ''); this.emit({ ev: 'delta', chatId: c.id, itemId: p.itemId, delta: String(p.delta || '') }); }
        break;
      }
      case 'item/commandExecution/outputDelta': {
        const it = c.items.find((x) => x.id === p.itemId);
        if (it) it.output = clip((it.output || '') + String(p.delta || ''), 3000);
        break;
      }
      case 'thread/tokenUsage/updated': this.charge(c, p.tokenUsage?.total, turn); break;
      case 'error': if (!p.willRetry) { const txt = clip(p.error?.message || 'AI 出错了', 800); if (c.running) c.lastTurnErr = { turn, text: txt }; else this.put(c, { id: 'e-' + rid(), kind: 'error', turn, text: txt }); } break;
      case 'turn/completed': {
        const st = p.turn?.status, err = p.turn?.error?.message;
        this.finishTurn(c, p.turn?.id || turn, st === 'completed' ? 'completed' : st === 'interrupted' ? 'stopped' : 'failed', err || (st === 'failed' ? '这一轮失败了' : ''));
        break;
      }
      default: break;
    }
  }
  onItem(c, it, turn, done) {
    if (!it?.id) return;
    switch (it.type) {
      case 'agentMessage': {
        const text = String(it.text || '');
        if (done && !text.trim()) { const i = c.items.findIndex((x) => x.id === it.id); if (i >= 0) { c.items.splice(i, 1); this.emit({ ev: 'drop', chatId: c.id, itemId: it.id }); } return; }
        this.put(c, { id: it.id, kind: 'text', turn, phase: it.phase || '', text: done ? clip(text, 20000) : (c.items.find((x) => x.id === it.id)?.text ?? text), streaming: !done }, done);
        break;
      }
      case 'commandExecution':
        this.put(c, { id: it.id, kind: 'cmd', turn, command: clip(String(it.command || '').replace(/^"?[^"]*powershell\.exe"?\s+(-NoProfile\s+)?-Command\s+/i, '').replace(/^"|"$/g, ''), 600), status: done ? (it.exitCode ? 'fail' : it.status === 'declined' ? 'declined' : 'done') : 'run', exit: it.exitCode ?? null, ...(done ? { output: clip(it.aggregatedOutput ?? c.items.find((x) => x.id === it.id)?.output ?? '', 3000) } : {}) }, done);
        break;
      case 'fileChange':
        this.put(c, { id: it.id, kind: 'file', turn, files: (it.changes || []).slice(0, 20).map((x) => ({ path: String(x.path || ''), kind: x.kind?.type || x.kind || '' })), status: done ? (it.status === 'completed' ? 'done' : 'fail') : 'run' }, done);
        break;
      case 'webSearch':
        if (done) this.put(c, { id: it.id, kind: 'tool', turn, name: 'web_search', label: '联网搜索：' + clip(it.query || it.action?.query || '', 200), args: {}, status: 'done' });
        break;
      case 'mcpToolCall': {
        const failed = done && (it.status === 'failed' || it.error || it.result?.isError);
        const out = done ? clip((it.result?.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n') || it.error?.message || '', 1500) : '';
        this.put(c, { id: it.id, kind: 'tool', turn, name: String(it.tool || ''), server: String(it.server || ''), label: csTools.label(it.tool, it.arguments, it.server), args: it.arguments ?? {}, status: done ? (failed ? 'fail' : 'done') : 'run', ...(done ? { output: out } : {}) }, done);
        break;
      }
      case 'dynamicToolCall': {
        const cur = c.items.find((x) => x.id === it.id);
        if (!cur) this.put(c, { id: it.id, kind: 'tool', turn, name: it.tool, args: it.arguments ?? {}, status: done ? (it.success ? 'done' : 'fail') : 'run' }, done);
        else if (done && cur.status === 'run') this.put(c, { id: it.id, status: it.success ? 'done' : 'fail' });
        break;
      }
      default: break;
    }
  }
  charge(c, total, turn) {
    if (!total) return;
    const usage = usageDelta(total, c.usageSeen);
    c.usageSeen = total;
    if (!usage.input && !usage.cached && !usage.output) return;
    const e = this.ledger ? this.ledger.record({ source: 'assistant', feature: 'AI 助教', model: c.model || 'codex', usage }) : { cny: 0 };
    this.onCharge();
    c.cny = Math.round(((c.cny || 0) + e.cny) * 1e4) / 1e4;
    const t = this.turnOf(c, turn); if (t) t.cny = Math.round(((t.cny || 0) + e.cny) * 1e4) / 1e4;
    this.emit({ ev: 'chat', chat: this.meta(c) });
    try { this.ledger?.check(); } catch (err) { if (c.running) { this.put(c, { id: 'e-' + rid(), kind: 'error', turn, text: err.message + '，已自动停止' }); void this.stop(c.id); } }
  }

  // ── app-server 来问的：工具调用、审批 ─────────────────
  async onRequest(s, m) {
    const reply = (result) => this.write(s, { jsonrpc: '2.0', id: m.id, result });
    const fail = (message) => this.write(s, { jsonrpc: '2.0', id: m.id, error: { code: -32000, message } });
    const p = m.params || {}, c = p.threadId ? this.chatOf(p.threadId) : null;
    if (m.method === 'item/tool/call') {
      if (!c) { reply({ success: false, contentItems: [{ type: 'inputText', text: '对话已关闭' }] }); return; }
      const v = await this.ask(s, c, { kind: 'tool', tool: String(p.tool || ''), args: p.arguments ?? {}, callId: p.callId, turnId: p.turnId });
      if (v?.cancelled) { reply({ success: false, contentItems: [{ type: 'inputText', text: '老师停止了这一轮' }] }); return; }
      const ok = v?.ok !== false;
      const t = this.turnOf(c, p.turnId);
      if (t && Array.isArray(v?.changes) && v.changes.length) t.changes.push(...v.changes.slice(0, 500));
      this.put(c, { id: p.callId, kind: 'tool', turn: p.turnId, name: p.tool, args: p.arguments ?? {}, status: ok ? 'done' : 'fail', card: v?.card || null, undoable: !!v?.changes?.length });
      const items = [{ type: 'inputText', text: clip(typeof v?.text === 'string' ? v.text : JSON.stringify(v?.text ?? ''), 60000) }];
      for (const img of (Array.isArray(v?.images) ? v.images : []).slice(0, 4)) if (/^data:image\//.test(img)) items.push({ type: 'inputImage', imageUrl: img });
      reply({ success: ok, contentItems: items });
      return;
    }
    const d = describeApproval(m.method, p);
    if (d) {
      if (!c) { reply(approvalReply(m.method, p, 'decline')); return; }
      // 完全访问下 Codex 一般不会再来问；万一来了（比如要更多权限）直接同意，不打扰老师
      if (c.access === 'full' && d.type !== 'input') { reply(approvalReply(m.method, p, 'session')); return; }
      const id = 'a-' + rid();
      this.put(c, { id, kind: 'approval', turn: p.turnId, ...d, status: 'wait' });
      const v = await this.ask(s, c, { kind: 'approval', itemId: id, ...d, turnId: p.turnId });
      const choice = v?.cancelled ? 'decline' : v?.choice || 'decline';
      this.put(c, { id, status: choice === 'session' ? 'session' : choice === 'accept' ? 'yes' : 'no', ...(d.type === 'input' ? { answers: v?.answers || null } : {}) });
      reply(approvalReply(m.method, p, d.type === 'input' ? v?.answers || {} : choice));
      return;
    }
    if (m.method === 'mcpServer/elicitation/request') { reply({ action: 'decline', content: null }); return; }
    if (m.method === 'applyPatchApproval' || m.method === 'execCommandApproval') { reply({ decision: 'denied' }); return; }
    fail('不支持的请求：' + m.method);
  }
  /** 交给教师窗口处理，等它回话；教师窗口关了、对话停了就按取消处理 */
  ask(s, c, payload) {
    return new Promise((resolve) => {
      const reqId = 'q-' + rid();
      const timer = setTimeout(() => { this.asks.delete(reqId); this.emit({ ev: 'askDone', reqId }); resolve({ ok: false, text: '老师很久没有回应，这一步先跳过', cancelled: payload.kind === 'approval' }); }, ASK_MS);
      this.asks.set(reqId, { server: s, chatId: c.id, payload: { reqId, chatId: c.id, ...payload }, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      this.emit({ ev: 'ask', ask: { reqId, chatId: c.id, ...payload } });
    });
  }
  reply(reqId, value) {
    const a = this.asks.get(reqId);
    if (!a) return false;
    this.asks.delete(reqId);
    a.resolve(value);
    this.emit({ ev: 'askDone', reqId });
    return true;
  }
  /** 教师窗口刷新后重新拿还在等它回话的请求 */
  pending() { return [...this.asks.values()].map((a) => a.payload); }
  /** 教师窗口没了：还在等它执行的工具一律失败（不然 Codex 一直等） */
  windowGone() { for (const [k, a] of this.asks) { this.asks.delete(k); a.resolve({ ok: false, text: '教师窗口关闭了，这一步没有执行', cancelled: a.payload.kind === 'approval' }); } }

  status() {
    const spec = locate('codex', this.toolsDir);
    let studio = false; try { studio = !!this.credentials?.().key; } catch { /* 没配置 */ }
    const warmup = typeof this.codexHome?.view === 'function' ? this.codexHome.view() : null;
    return { found: !!spec, where: spec?.where || '', version: spec?.version || '', studioKey: studio, running: !!this.server && !this.server.dead, tier: tier.clean(this.tierOf(), 'chat'), tierSite: (() => { try { return tier.applies(this.credentials?.().baseUrl); } catch { return false; } })(), workspace: this.work.replace(/\\/g, '/'), warmup };
  }
  stopAll() { for (const c of this.chats.values()) this.cancelRetry(c); this.windowGone(); this.shutdown('导播台关闭'); for (const c of this.chats.values()) this.save(c, true); }
}

module.exports = { Assistant, usageDelta, describeApproval, approvalReply, userMcpNames, accessPolicy };
