'use strict';
// AI bridge for the teacher windows: OpenAI-compatible chat API, key encrypted with Electron safeStorage.
// The key never leaves the main process; renderers only see whether one is saved and its last 4 chars.
const fs = require('fs');
const path = require('path');
const { safeStorage, shell, clipboard, dialog, BrowserWindow } = require('electron');
const { receive, ImportError } = require('./importLink.cjs');

const DEFAULT_BASE = 'https://api.yinziapi.top/v1';
const SITE = 'https://yinziapi.top/';
const TIMEOUT = 120000;
const MAX_TIMEOUT = 15 * 60000;
const modelCache = new Map();

/** 每次调用的超时：页面可以指定（夹在 10 秒 ~ 15 分钟）；没指定时按输出上限估（推理模型写长内容要好几分钟） */
function timeoutOf(value) {
  const t = Number(value?.timeout);
  if (Number.isFinite(t) && t > 0) return Math.round(Math.min(MAX_TIMEOUT, Math.max(10000, t)));
  const max = Number(value?.maxTokens) || 0;
  return Math.round(Math.max(TIMEOUT, Math.min(10 * 60000, 60000 + max * 40)));
}

function file(dataDir) { return path.join(dataDir, 'ai.json'); }

function load(dataDir) {
  try { return JSON.parse(fs.readFileSync(file(dataDir), 'utf8')) || {}; } catch { return {}; }
}

function save(dataDir, cfg) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = file(dataDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file(dataDir));
}

function readKey(cfg) {
  if (!cfg.key) return '';
  try {
    if (cfg.enc === 'safe') return safeStorage.decryptString(Buffer.from(cfg.key, 'base64'));
    return Buffer.from(cfg.key, 'base64').toString('utf8');
  } catch { return ''; }
}

function writeKey(cfg, key) {
  if (!key) { delete cfg.key; delete cfg.enc; delete cfg.hint; return; }
  if (safeStorage.isEncryptionAvailable()) { cfg.key = safeStorage.encryptString(key).toString('base64'); cfg.enc = 'safe'; }
  else { cfg.key = Buffer.from(key, 'utf8').toString('base64'); cfg.enc = 'plain'; }
  cfg.hint = key.slice(-4);
}

function publicConfig(cfg) {
  return {
    baseUrl: cfg.baseUrl || DEFAULT_BASE,
    model: cfg.model || '',
    visionModel: cfg.visionModel || '',
    imageModel: cfg.imageModel || '',
    hasKey: !!cfg.key && !!readKey(cfg),
    keyHint: cfg.hint || '',
    encrypted: cfg.enc === 'safe',
  };
}

function cleanBase(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return DEFAULT_BASE;
  if (!/^https?:\/\//i.test(s)) throw new Error('接口地址要以 http:// 或 https:// 开头');
  return s.replace(/\/chat\/completions$/i, '');
}

function explain(status, body) {
  let msg = '';
  try { const j = JSON.parse(body); msg = j?.error?.message || j?.message || j?.msg || ''; } catch { msg = String(body || '').slice(0, 200); }
  const tail = msg ? `（服务返回：${String(msg).slice(0, 200)}）` : '';
  if (status === 401 || status === 403) return 'API Key 无效、过期或没有这个模型的权限' + tail;
  if (status === 404) return '接口地址或模型名不对' + tail;
  if (status === 429) return '请求太频繁或额度不足，稍后再试' + tail;
  if (status === 400) return '模型不接受这个请求（可能不支持看图，或模型名不对）' + tail;
  if (status >= 500) return 'AI 服务暂时出错（' + status + '）' + tail;
  return 'AI 请求失败（' + status + '）' + tail;
}

async function request(cfg, pathname, init = {}, timeout = TIMEOUT) {
  const key = readKey(cfg);
  if (!key) throw new Error('还没有填写 API Key：在 AI 面板右上角的「设置」里填写');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(cleanBase(cfg.baseUrl) + pathname, {
      ...init,
      signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    // 中转站（new-api）的请求 ID：对账时用它在站点消费记录里找到这一笔
    const rid = res.headers.get('x-oneapi-request-id') || res.headers.get('x-request-id') || '';
    const tag = (j) => { if (rid && j && typeof j === 'object') Object.defineProperty(j, '__rid', { value: rid, enumerable: false }); return j; };
    if (res.ok && /event-stream/i.test(res.headers.get('content-type') || '')) return tag(await readStream(res));
    const text = await res.text();
    if (!res.ok) throw new Error(explain(res.status, text));
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('AI 服务返回的不是 JSON：' + text.slice(0, 120)); }
    return tag(j);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('AI 响应超时（' + Math.round(timeout / 1000) + ' 秒），可以换个更快的模型或稍后重试');
    if (e instanceof TypeError || /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|UND_ERR/i.test(String(e && (e.cause?.code || e.message)))) {
      throw new Error('连不上 AI 服务：' + (e.cause?.code || e.message) + '。请检查网络和接口地址');
    }
    throw e;
  } finally { clearTimeout(timer); }
}

/** 流式回复（SSE）拼回和非流式一样的结构：{ model, choices:[{ message, finish_reason }], usage } */
async function readStream(res) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', content = '', finish = '', model = '', usage = null, failed = null, done = false;
  const take = (line) => {
    if (!line.startsWith('data:')) return;
    const d = line.slice(5).trim();
    if (d === '[DONE]') { done = true; return; }
    let j; try { j = JSON.parse(d); } catch { return; }
    if (j.error) { failed = j.error; return; }
    if (j.model) model = j.model;
    if (j.usage) usage = j.usage;
    for (const c of Array.isArray(j.choices) ? j.choices : []) {
      const x = c.delta || c.message || {};
      if (typeof x.content === 'string') content += x.content;
      else if (Array.isArray(x.content)) content += x.content.map((p) => p?.text || '').join('');
      if (c.finish_reason) finish = c.finish_reason;
    }
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  }
  take((buf + dec.decode()).trim());
  if (failed) throw new Error('AI 服务出错：' + String(failed.message || JSON.stringify(failed)).slice(0, 200));
  // 既没有 [DONE] 也没有结束原因：网关中途断了，内容不完整
  if (!done && !finish) throw new Error('连不上 AI 服务：回复中途断开（已收到 ' + content.length + ' 字）。请检查网络和接口地址');
  return { model, choices: [{ message: { role: 'assistant', content }, finish_reason: finish || null }], usage };
}

/** Student window → JPEG data URL, at most 1280 px wide (enough for reading a problem, small enough to upload). */
async function studentShot(windows) {
  const w = windows.get('student');
  if (!w || w.isDestroyed()) throw new Error('学生窗口没有打开，无法读取学生画面');
  // 窗口刚显示、还没画出第一帧时 Chromium 会报 UnknownVizError 或给空图：稍等重试几次
  let img = null;
  for (let i = 0; i < 4; i++) {
    try { img = await w.webContents.capturePage(); if (!img.isEmpty()) break; } catch (e) { if (i === 3) throw new Error('截取学生画面失败：' + e.message); }
    w.webContents.invalidate(); await new Promise((r) => setTimeout(r, 250));
  }
  if (!img || img.isEmpty()) throw new Error('学生画面是空的（窗口可能被最小化）');
  const { width } = img.getSize();
  if (width > 1280) img = img.resize({ width: 1280, quality: 'good' });
  return 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64');
}

function sanitizeMessages(list) {
  if (!Array.isArray(list)) throw new Error('消息格式不对');
  return list.slice(-24).map((m) => {
    const role = ['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user';
    if (Array.isArray(m?.content)) return { role, content: m.content.filter((c) => c && (c.type === 'text' || c.type === 'image_url')).slice(0, 8) };
    return { role, content: String(m?.content ?? '').slice(0, 20000) };
  });
}

async function chat(cfg, value, windows) {
  const messages = sanitizeMessages(value?.messages);
  let image = '';
  if (value?.image === 'student') image = await studentShot(windows);
  else if (typeof value?.image === 'string' && value.image.startsWith('data:image/')) image = value.image;
  if (image) {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    if (last) {
      const text = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }];
      last.content = [...text, { type: 'image_url', image_url: { url: image } }];
    }
  }
  const model = String(value?.model || (image && cfg.visionModel) || cfg.model || '').trim();
  if (!model) throw new Error('还没有选择模型：在 AI 设置里点「读取模型列表」后选一个');
  const body = { model, messages, temperature: typeof value?.temperature === 'number' ? value.temperature : 0.3 };
  if (value?.maxTokens) body.max_tokens = Math.min(16000, Number(value.maxTokens) || 2000);
  if (value?.json) body.response_format = { type: 'json_object' };
  const timeout = timeoutOf(value);
  // 长调用用流式：中转站 / CDN 对长时间没有数据的连接会断开（常见 100 秒），流式时推理过程也在持续传数据
  if (value?.stream ?? timeout > TIMEOUT) { body.stream = true; body.stream_options = { include_usage: true }; }
  const t0 = Date.now();
  // 网关偶尔断连（实测见过 UND_ERR_SOCKET）或 502/503/504：隔两秒重试一次，老师不用自己再点
  const post = async () => {
    try { return await request(cfg, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, timeout); }
    catch (e) {
      if (!/连不上 AI 服务|暂时出错（50[234]）/.test(String(e.message))) throw e;
      await new Promise((ok) => setTimeout(ok, 2000));
      return request(cfg, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, timeout);
    }
  };
  let r;
  try { r = await post(); }
  catch (e) {
    if (!/400|不接受/.test(String(e.message))) throw e;
    // 有的网关不认 stream_options / 流式，或不认 response_format：依次去掉再试
    if (body.stream) {
      delete body.stream; delete body.stream_options;
      try { r = await post(); } catch (e2) { if (!(value?.json && /400|不接受/.test(String(e2.message)))) throw e2; }
    }
    if (!r && value?.json) { delete body.response_format; r = await post(); }
    if (!r) throw e;
  }
  const choice = r?.choices?.[0];
  const content = typeof choice?.message?.content === 'string' ? choice.message.content
    : Array.isArray(choice?.message?.content) ? choice.message.content.map((c) => c.text || '').join('') : '';
  if (process.env.CS_AI_DUMP) dump(body, choice, r.usage, Date.now() - t0);
  if (!content) throw new Error(choice?.finish_reason === 'length' ? '模型的回答太长被截断了（还没写出内容就到了长度上限），请重试' : '模型没有返回内容' + (choice?.finish_reason ? '（' + choice.finish_reason + '）' : ''));
  return { content, model: r.model || model, ms: Date.now() - t0, usage: r.usage || null, sawImage: !!image, finish: choice?.finish_reason || '', rid: r.__rid || '' };
}

// 没指定生图模型时，从服务的模型列表里按这个顺序挑第一个有的
const IMAGE_MODELS = [/^gpt-image/i, /seedream/i, /nano-banana|gemini.*image/i, /^flux/i, /^dall-e-3/i, /imagen/i, /qwen-image|wanx|cogview|kolors/i, /image/i];

async function pickImageModel(cfg) {
  let ids = modelCache.get(cfg.baseUrl || DEFAULT_BASE)?.models;
  if (!ids) {
    try {
      const r = await request(cfg, '/models', { method: 'GET' }, 30000);
      ids = (Array.isArray(r?.data) ? r.data : []).map((m) => String(typeof m === 'string' ? m : m?.id || '')).filter(Boolean);
      modelCache.set(cfg.baseUrl || DEFAULT_BASE, { at: Date.now(), models: ids, hint: cfg.hint });
    } catch { ids = []; }
  }
  for (const re of IMAGE_MODELS) { const m = ids.find((x) => re.test(x)); if (m) return m; }
  return '';
}

/** 文生图（OpenAI 兼容 /images/generations）。结果统一成 data: 地址，插件页面和黑板都能直接用 */
async function image(cfg, value) {
  const prompt = String(value?.prompt || '').trim().slice(0, 4000);
  if (!prompt) throw new Error('请写清楚要画什么');
  const model = String(value?.model || cfg.imageModel || await pickImageModel(cfg)).trim();
  if (!model) throw new Error('当前 AI 服务里没有找到生图模型。可以在 AI 设置里填写生图模型名');
  const size = /^\d{3,4}x\d{3,4}$/.test(String(value?.size || '')) ? value.size : '1024x1024';
  const t0 = Date.now();
  const r = await request(cfg, '/images/generations', { method: 'POST', body: JSON.stringify({ model, prompt, size, n: 1 }) }, 5 * 60000);
  const d = Array.isArray(r?.data) ? r.data[0] : null;
  let url = d?.b64_json ? 'data:image/png;base64,' + d.b64_json : String(d?.url || '');
  if (/^https?:/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('生成的图片下载失败（' + res.status + '）');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 30 * 1024 * 1024) throw new Error('生成的图片太大');
    url = 'data:' + (res.headers.get('content-type') || 'image/png').split(';')[0] + ';base64,' + buf.toString('base64');
  }
  if (!url.startsWith('data:image/')) throw new Error('生图服务没有返回图片');
  return { image: url, model: r.model || model, ms: Date.now() - t0, usage: r.usage || null, content: '', rid: r.__rid || '', revised: String(d?.revised_prompt || '') };
}

/** 实测用：CS_AI_DUMP=目录 时把请求（图片换成占位）和回复原文存下来，方便核对提示词效果。不含 Key。 */
function dump(body, choice, usage, ms) {
  try {
    const fs = require('node:fs'), path = require('node:path');
    fs.mkdirSync(process.env.CS_AI_DUMP, { recursive: true });
    const messages = body.messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map((c) => c.type === 'image_url' ? '[图片 ' + Math.round(String(c.image_url?.url || '').length / 1365) + ' KB]' : c.text) : m.content }));
    fs.writeFileSync(path.join(process.env.CS_AI_DUMP, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.json'), JSON.stringify({ model: body.model, max_tokens: body.max_tokens, json: !!body.response_format, ms, usage, finish: choice?.finish_reason, messages, reply: choice?.message?.content }, null, 2));
  } catch { /* 只是诊断 */ }
}

function usageOf(u) {
  if (!u) return null;
  const prompt = Number(u.prompt_tokens ?? u.input_tokens) || 0, cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens) || 0;
  return { input: Math.max(0, prompt - cached), cached, output: Number(u.completion_tokens ?? u.output_tokens) || 0 };
}

async function metered(ledger, feature, fn, reconciler) {
  ledger?.check();
  const r = await fn();
  if (ledger) {
    const u = usageOf(r.usage);
    // 网关没返回用量时按字数粗估，宁可多记不漏记
    const e = ledger.record({ source: 'chat', feature, model: r.model, usage: u ?? { input: 1500, output: Math.ceil(String(r.content || '').length * 1.2) }, rid: r.rid });
    r.cny = e.cny;
    if (r.rid) reconciler?.soon();
  }
  return r;
}

async function handle(method, value, ctx) {
  const { dataDir, windows, ledger, reconciler } = ctx;
  const cfg = load(dataDir);
  switch (method) {
    case 'ai.getConfig': return publicConfig(cfg);
    case 'ai.setConfig': {
      const v = value || {};
      if (v.baseUrl !== undefined) cfg.baseUrl = cleanBase(v.baseUrl);
      if (v.model !== undefined) cfg.model = String(v.model).trim().slice(0, 120);
      if (v.visionModel !== undefined) cfg.visionModel = String(v.visionModel).trim().slice(0, 120);
      if (v.imageModel !== undefined) cfg.imageModel = String(v.imageModel).trim().slice(0, 120);
      if (v.key !== undefined) writeKey(cfg, String(v.key).trim());
      save(dataDir, cfg);
      return publicConfig(cfg);
    }
    // 一键导入：链接先在主进程解析并暂存，页面只看到地址和 Key 尾号，老师确认后才写入
    case 'ai.importParse': return offerImport(value?.text, dataDir);
    case 'ai.importClipboard': return offerImport(clipboard.readText(), dataDir);
    case 'ai.importFile': {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(ctx.sender), { title: '选择导入文件', properties: ['openFile'], filters: [{ name: '导入文件', extensions: ['yzimport', 'txt'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      return offerImport(readImportFile(r.filePaths[0]), dataDir);
    }
    case 'ai.importPending': return pending && Date.now() - pending.at < 30 * 60e3 ? importSummary(cfg) : null;
    case 'ai.importCancel': pending = null; return null;
    case 'ai.openSite': if (!process.env.CS_TEST) await shell.openExternal(SITE); return SITE;
    case 'ai.importApply': {
      const p = pending;
      if (!p) throw new Error('导入内容已过期，请回到网站重新点一键导入');
      pending = null;
      if (p.kind === 'yinzi') {
        if (Date.now() / 1000 > p.exp + 120) throw new Error('导入链接已过期（10 分钟有效），请回到网站重新生成。');
        if (nonceUsed(dataDir, p.nonce)) throw new Error('这个导入链接已经用过了，请回到网站重新生成。');
        markNonce(dataDir, p.nonce, p.exp);
      }
      if (!p.key && !cfg.key) throw new Error('这个导入只包含模型设置，但本机还没有 Key。请在网站勾选「同时导入密钥」后重新导入。');
      if (p.baseUrl) cfg.baseUrl = cleanBase(p.baseUrl);
      if (p.key) writeKey(cfg, p.key);
      // 覆盖模式：没勾选的项目清空；合并模式：只改勾选的
      if (p.mode === 'replace') { cfg.model = p.text || ''; cfg.visionModel = p.vision && p.vision !== p.text ? p.vision : ''; }
      else {
        if (p.text) cfg.model = p.text;
        if (p.vision) cfg.visionModel = p.vision === cfg.model ? '' : p.vision;
      }
      save(dataDir, cfg);
      modelCache.delete(cfg.baseUrl || DEFAULT_BASE);
      return publicConfig(cfg);
    }
    case 'ai.models': {
      const r = await request(cfg, '/models', { method: 'GET' }, 30000);
      const ids = (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []).map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
      return [...new Set(ids)].sort();
    }
    // 模型选择器用：带缓存，读不到时返回原因而不是抛错（GET /models 不扣费）
    case 'ai.modelList': {
      const hit = modelCache.get(cfg.baseUrl || DEFAULT_BASE);
      if (hit && !value?.refresh && Date.now() - hit.at < 30 * 60e3 && hit.hint === cfg.hint) return { ok: true, models: hit.models, count: hit.models.length, cachedAt: hit.at };
      try {
        const r = await request(cfg, '/models', { method: 'GET' }, 30000);
        const ids = (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []).map((m) => String(typeof m === 'string' ? m : m?.id || '').trim().slice(0, 160)).filter(Boolean);
        const models = [...new Set(ids)].slice(0, 2000);
        modelCache.set(cfg.baseUrl || DEFAULT_BASE, { at: Date.now(), models, hint: cfg.hint });
        return { ok: true, models, count: models.length, cachedAt: Date.now() };
      } catch (e) { return { ok: false, message: e.message, models: [] }; }
    }
    case 'ai.test': {
      const r = await metered(ledger, '连接测试', () => chat(cfg, { messages: [{ role: 'user', content: '只回复两个字：在线' }], maxTokens: 20, model: value?.model }, windows), reconciler);
      return { ok: true, model: r.model, ms: r.ms, reply: r.content.slice(0, 40) };
    }
    case 'ai.chat': return metered(ledger, String(value?.feature || '课堂 AI').slice(0, 40), () => chat(cfg, value, windows), reconciler);
    case 'ai.image': return metered(ledger, String(value?.feature || 'AI 生图').slice(0, 40), () => image(cfg, value), reconciler);
    case 'ai.ledger': return ledger ? ledger.summary() : null;
    case 'ai.setBudget': { const s = ledger.setBudget(value); if (value?.reconcile === true) reconciler?.soon(500); return s; }
    case 'ai.reconcile': { if (!reconciler) throw new Error('对账不可用'); await reconciler.sync({ force: true }); return ledger.summary(); }
    case 'ai.screen': return studentShot(windows);
    default: throw new Error('未知的 AI 操作：' + method);
  }
}

// ── 一键导入 ────────────────────────────────────────────
let pending = null;
/** 确认框看到的东西：没有完整 Key，只有尾号 */
function importSummary(cfg) {
  const p = pending;
  return {
    kind: p.kind, site: p.site, profile: p.profile, mode: p.mode,
    baseUrl: p.baseUrl || cfg.baseUrl || DEFAULT_BASE, baseFrom: cfg.key ? cfg.baseUrl || DEFAULT_BASE : '',
    keyHint: p.key ? p.key.slice(-4) : '', keyName: p.keyName, smart: p.smart, replaces: !!(p.key && cfg.key),
    text: p.text, vision: p.vision, textFrom: cfg.model || '', visionFrom: cfg.visionModel || '',
    codex: p.codex || '', claude: p.claude || '',
  };
}
function nonceFile(dataDir) { return path.join(dataDir, 'import-nonces.json'); }
function nonceList(dataDir) { try { const v = JSON.parse(fs.readFileSync(nonceFile(dataDir), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
function nonceUsed(dataDir, n) { return nonceList(dataDir).some((x) => x.n === n); }
function markNonce(dataDir, n, exp) {
  const now = Date.now() / 1000;
  const list = nonceList(dataDir).filter((x) => x.exp + 3600 > now).concat({ n, exp }).slice(-200);
  fs.writeFileSync(nonceFile(dataDir), JSON.stringify(list));
}
function readImportFile(p) {
  if (fs.statSync(p).size > 64 * 1024) throw new ImportError('too_large');
  return fs.readFileSync(p, 'utf8');
}
/** 链接、导入码、文件内容或粘贴的文字 → 校验后暂存，等老师确认；失败抛错 */
async function offerImport(input, dataDir) {
  const text = /\.yzimport$/i.test(String(input || '').trim()) && fs.existsSync(String(input).trim()) ? readImportFile(String(input).trim()) : input;
  const p = await receive(text, { dev: !!process.env.CS_TEST, nonceUsed: (n) => nonceUsed(dataDir, n) });
  pending = { ...p, at: Date.now() };
  return importSummary(load(dataDir));
}

/** 只给主进程里的后台任务用：Key 不经过任何页面 */
function credentials(dataDir) {
  const cfg = load(dataDir);
  return { baseUrl: cleanBase(cfg.baseUrl), model: cfg.model || '', key: readKey(cfg) };
}

module.exports = { handle, credentials, offerImport, DEFAULT_BASE };
