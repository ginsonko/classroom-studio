'use strict';
// AI bridge for the teacher windows: OpenAI-compatible chat API, key encrypted with Electron safeStorage.
// The key never leaves the main process; renderers only see whether one is saved and its last 4 chars.
const fs = require('fs');
const path = require('path');
const { safeStorage, shell, clipboard, dialog, BrowserWindow } = require('electron');
const { receive, ImportError } = require('./importLink.cjs');
const tier = require('./tier.cjs');
const netRetry = require('./netRetry.cjs');

const DEFAULT_BASE = 'https://api.yinziapi.top/v1';
const SITE = 'https://yinziapi.top/';
const TIMEOUT = 120000;
const MAX_TIMEOUT = 15 * 60000;
const modelCache = new Map();
const CLASS_AI = /^(课堂 AI|AI 讲题|AI 画图|AI 问答|AI 演示|AI 立体演示|课堂动画|manim|手写公式)/;

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
    // 玲珑账号 / 合作站账号登录后自动建的专用 Key：页面上不显示尾号，只显示是哪个账号管的
    keyHint: cfg.account ? '' : cfg.hint || '',
    encrypted: cfg.enc === 'safe',
    account: cfg.account || null,
    tested: !!cfg.key && cfg.tested === cfg.hint,
    tierSite: tier.applies(cfg.baseUrl || DEFAULT_BASE),
  };
}

/** 这把 Key 测通过了：记下尾号，换了 Key 就不算 */
function markTested(dataDir, cfg = load(dataDir)) { if (cfg.key && cfg.tested !== cfg.hint) { cfg.tested = cfg.hint; save(dataDir, cfg); } }

/** 账号登录后：专用 Key 写进 AI 设置（Key 只在主进程），记下是哪个账号管的 */
function setAccountKey(dataDir, { baseUrl, key, account }) {
  const cfg = load(dataDir);
  // 老师原来自己配的连接（一键导入、手填）先收起来，退出账号时原样放回去
  if (!cfg.account && cfg.key) cfg.prev = Object.fromEntries(['baseUrl', 'key', 'enc', 'hint', 'model', 'visionModel', 'imageModel', 'tested'].filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]]));
  const sameSite = cfg.baseUrl && cleanBase(cfg.baseUrl) === cleanBase(baseUrl);
  cfg.baseUrl = cleanBase(baseUrl);
  writeKey(cfg, key);
  cfg.account = account;
  delete cfg.tested;
  // 换了站点：原来的模型名多半对不上，清掉让页面按新 Key 的模型列表重新挑
  if (!sameSite) { cfg.model = ''; cfg.visionModel = ''; cfg.imageModel = ''; }
  save(dataDir, cfg);
  modelCache.delete(cfg.baseUrl);
  return publicConfig(cfg);
}
/** 退出账号：账号管的那把 Key 从 AI 设置里拿掉（站点上的 Key 不动），登录前老师自己配的连接放回去 */
function clearAccountKey(dataDir) {
  const cfg = load(dataDir);
  if (!cfg.account) return publicConfig(cfg);
  writeKey(cfg, ''); delete cfg.account; delete cfg.tested;
  const prev = cfg.prev; delete cfg.prev;
  if (prev) Object.assign(cfg, prev);
  save(dataDir, cfg);
  modelCache.clear();
  return publicConfig(cfg);
}
/**
 * 启动时判断「有没有一把测通过的 Key」：测过的直接算；1.7.0 以前配的 Key 没测过记录，免费读一次模型列表（不扣费），
 * 读通了就补记。Key 无效（401/403）算没有；网络不通时不知道，按有算（别在断网时拦老师）。
 */
async function keyUsable(dataDir) {
  const cfg = load(dataDir);
  if (!cfg.key || !readKey(cfg)) return false;
  if (cfg.tested === cfg.hint) return true;
  try { await request(cfg, '/models', { method: 'GET' }, 8000); markTested(dataDir, cfg); return true; }
  catch (e) { return !(e.status === 401 || e.status === 403); }
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
  if (/no eligible|未包含可用线路|没有可用线路|无可用渠道|no available channel|没有分组/i.test(msg)) return '这把 Key 的分组里没有这个模型能用的线路（请在站点给 Key 勾上对应分组，或重新点「站点一键导入」）' + tail;
  if (/insufficient|余额不足|额度不足|quota|欠费/i.test(msg) || status === 402) return '账户余额或额度不足，请到站点充值' + tail;
  if (status === 401 || status === 403) return 'API Key 无效、过期或没有这个模型的权限' + tail;
  if (status === 404) return '接口地址或模型名不对' + tail;
  if (status === 429) return '请求太频繁或额度不足，稍后再试' + tail;
  if (status === 400) return '模型不接受这个请求（可能不支持看图，或模型名不对）' + tail;
  if (status >= 500) return 'AI 服务暂时出错（' + status + '）' + tail;
  return 'AI 请求失败（' + status + '）' + tail;
}

/**
 * init.tier：这次请求的档位（只有银子 API 系站点的文字接口会带上 X-Route-Scope）。档位里没有能用的线路时站点不扣费，
 * 这里按 Key 自己的范围再发一次：档位是偏好，不能因为它让请求失败。抛出的错误带 status / body，收费闸要看。
 */
async function request(cfg, pathname, init = {}, timeout = TIMEOUT) {
  const key = readKey(cfg);
  if (!key) throw new Error('还没有填写 API Key：在 AI 面板右上角的「设置」里填写');
  const { tier: tierId, signal, ...rest } = init;
  const url = cleanBase(cfg.baseUrl) + pathname;
  // 站点请求头（来源 + 档位）统一由 tier.siteHeaders 判断：我们站点和合作站带，第三方不带
  const scoped = tier.siteHeaders(url, tierId);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  // 老师点了停止 / 关掉了面板：外面的 signal 一取消，这次请求立刻断开，也不再重试
  const cancel = () => ctl.abort();
  if (signal?.aborted) throw netRetry.abortErrorOf();
  signal?.addEventListener?.('abort', cancel, { once: true });
  const go = (extra) => fetch(url, { ...rest, signal: ctl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...extra, ...(rest.headers || {}) } });
  try {
    const res = await tier.sendWithScopeFallback((extra) => go(extra), {
      scoped, url, who: 'classroom-ai', allow503: true, log: rest.log,
    });
    // 中转站（new-api）的请求 ID：对账时用它在站点消费记录里找到这一笔；X-Route-Scope-Applied：站点这次实际用的线路范围
    const rid = res.headers.get('x-oneapi-request-id') || res.headers.get('x-request-id') || '';
    const applied = res.headers.get(tier.APPLIED) || '';
    const tag = (j) => { if (j && typeof j === 'object') { if (rid) Object.defineProperty(j, '__rid', { value: rid, enumerable: false }); if (applied) Object.defineProperty(j, '__applied', { value: applied, enumerable: false }); } return j; };
    if (res.ok && /event-stream/i.test(res.headers.get('content-type') || '')) return tag(await readStream(res));
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(explain(res.status, text)), { status: res.status, body: text.slice(0, 2000) });
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('AI 服务返回的不是 JSON：' + text.slice(0, 120)); }
    return tag(j);
  } catch (e) {
    if (signal?.aborted) throw netRetry.abortErrorOf();
    if (e && e.name === 'AbortError') throw new Error('AI 响应超时（' + Math.round(timeout / 1000) + ' 秒），可以换个更快的模型或稍后重试');
    if (e instanceof TypeError || /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|EPIPE|socket hang up|terminated|UND_ERR/i.test(String(e && (e.cause?.code || e.code || e.message)))) {
      throw Object.assign(new Error('连不上 AI 服务：' + (e.cause?.code || e.code || e.message) + '。请检查网络和接口地址'), { code: e.cause?.code || e.code || '' });
    }
    throw e;
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', cancel); }
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
    if (Array.isArray(m?.content)) return { role, content: m.content.filter((c) => c && (c.type === 'text' || c.type === 'image_url')).slice(0, 16) };
    return { role, content: String(m?.content ?? '').slice(0, 20000) };
  });
}

async function chat(cfg, value, windows, tierId = '', opts = {}) {
  const messages = sanitizeMessages(value?.messages);
  // 一次可以带多张图：学生画面 + 老师粘进来的题目照片 / 截图（顺序按老师给的来）
  const images = [];
  if (value?.image === 'student') images.push(await studentShot(windows));
  else if (typeof value?.image === 'string' && value.image.startsWith('data:image/')) images.push(value.image);
  for (const x of Array.isArray(value?.images) ? value.images : []) if (typeof x === 'string' && x.startsWith('data:image/')) images.push(x);
  const shots = images.slice(0, 8);
  if (shots.length) {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    if (last) {
      const text = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }];
      last.content = [...text, ...shots.map((url) => ({ type: 'image_url', image_url: { url } }))];
    }
  }
  const model = String(value?.model || (shots.length && cfg.visionModel) || cfg.model || '').trim();
  if (!model) throw new Error('还没有选择模型：在 AI 设置里点「读取模型列表」后选一个');
  const body = { model, messages, temperature: typeof value?.temperature === 'number' ? value.temperature : 0.3 };
  if (value?.maxTokens) body.max_tokens = Math.min(16000, Number(value.maxTokens) || 2000);
  if (value?.json) body.response_format = { type: 'json_object' };
  const timeout = timeoutOf(value);
  // 长调用用流式：中转站 / CDN 对长时间没有数据的连接会断开（常见 100 秒），流式时推理过程也在持续传数据
  if (value?.stream ?? timeout > TIMEOUT) { body.stream = true; body.stream_options = { include_usage: true }; }
  const t0 = Date.now();
  // 网关偶尔断连（实测见过 UND_ERR_SOCKET）、DNS 抖动、流中途断开或 502/503/504：按 1s、2s、4s、8s、15s 递增等待自动重试，最多 5 次；
  // 「没有可用分组 / 渠道」不在这里重试（request 里已经去掉档位头重发过一次），余额不足、Key 不对、内容拦截这些确定性错误也不重试
  const post = () => netRetry.retry(
    () => request(cfg, '/chat/completions', { method: 'POST', body: JSON.stringify(body), tier: tierId, signal: opts.signal }, timeout),
    { signal: opts.signal, delays: opts.delays, onRetry: opts.onRetry },
  );
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
  const applied = r.__applied || '';
  return { content, model: r.model || model, ms: Date.now() - t0, usage: r.usage || null, sawImage: shots.length > 0, finish: choice?.finish_reason || '', rid: r.__rid || '', tier: tierId && tier.applies(cfg.baseUrl || DEFAULT_BASE) ? tierId : '', lowRoute: tier.lowRoute(applied), weakModel: tier.weakModel(r.model || model) };
}

/** 试一次 Codex 实际用的接口（/responses，同一模型），只要几个字的回答 */
async function probeResponses(cfg, model) {
  const t0 = Date.now();
  const r = await request(cfg, '/responses', { method: 'POST', body: JSON.stringify({ model, input: '只回复两个字：在线', max_output_tokens: 16, store: false }) }, 60000);
  if (r?.error) throw new Error('AI 服务出错：' + String(r.error.message || JSON.stringify(r.error)).slice(0, 300));
  const text = typeof r?.output_text === 'string' ? r.output_text : (Array.isArray(r?.output) ? r.output : []).flatMap((o) => (Array.isArray(o?.content) ? o.content : [])).map((c) => c?.text || '').join('');
  return { content: text, model: r?.model || model, ms: Date.now() - t0, usage: r?.usage || null, rid: r?.__rid || '' };
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
async function image(cfg, value, gate) {
  const prompt = String(value?.prompt || '').trim().slice(0, 4000);
  if (!prompt) throw new Error('请写清楚要画什么');
  const model = String(value?.model || cfg.imageModel || await pickImageModel(cfg)).trim();
  if (!model) throw new Error('当前 AI 服务里没有找到生图模型。可以在 AI 设置里填写生图模型名');
  const size = /^\d{3,4}x\d{3,4}$/.test(String(value?.size || '')) ? value.size : '1024x1024';
  const t0 = Date.now();
  const body = { model, prompt, size, n: 1 };
  const send = (headers) => request(cfg, '/images/generations', { method: 'POST', body: JSON.stringify(body), headers }, 5 * 60000);
  let r, quoted = null;
  // 玲珑商业账号：先报价、老师确认（工坊任务在自己的上限内不问），再带着报价提交
  if (gate?.covers(cfg.baseUrl || DEFAULT_BASE)) {
    const out = await gate.run({ mode: 'images', fields: body, ctx: { feature: String(value?.feature || ''), taskId: value?.taskId || '' } }, async (headers) => {
      try { return { status: 200, value: await send(headers) }; }
      catch (e) { if (e.status) return { status: e.status, text: e.body, error: e }; throw e; }
    });
    if (out.value.error) throw out.value.error;
    r = out.value.value; quoted = out.cny;
  } else r = await send({});
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
  return { image: url, model: r.model || model, ms: Date.now() - t0, usage: r.usage || null, content: '', rid: r.__rid || '', revised: String(d?.revised_prompt || ''), quoted };
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

async function metered(ledger, feature, fn, reconciler, extra = {}) {
  ledger?.check();
  const r = await fn();
  if (ledger) {
    const u = usageOf(r.usage);
    // 网关没返回用量时按字数粗估，宁可多记不漏记；玲珑账号画图按站点报价（就是实扣）记
    const e = ledger.record({ source: 'chat', feature, model: r.model, usage: u ?? { input: 1500, output: Math.ceil(String(r.content || '').length * 1.2) }, rid: r.rid, ...(r.quoted != null ? { cny: r.quoted } : {}), ...(extra.taskId ? { taskId: extra.taskId } : {}) });
    r.cny = e.cny;
    if (r.rid) reconciler?.soon();
  }
  return r;
}

// 正在进行的课堂 AI 请求：reqId → AbortController
const running = new Map();

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
      // 老师自己改了地址或 Key：这个连接就归老师自己管了，不再算账号的
      if ((v.key !== undefined && String(v.key).trim()) || (v.baseUrl !== undefined && cfg.account && !tier.applies(cfg.baseUrl))) { delete cfg.account; delete cfg.prev; }
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
      if (p.key) { writeKey(cfg, p.key); delete cfg.account; delete cfg.prev; }
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
      // 小羽和 AI 工坊（Codex）走的是 /v1/responses：同一把 Key 聊天通、这条不通的情况很常见（Key 的分组里没有对应线路），一起测
      const agentModel = String(value?.agentModel || value?.model || cfg.model || '').trim();
      let agent = null;
      if (value?.agent !== false && agentModel) {
        try { const a = await metered(ledger, '连接测试', () => probeResponses(cfg, agentModel), reconciler); agent = { ok: true, model: a.model, ms: a.ms }; }
        catch (e) { agent = { ok: false, model: agentModel, message: String(e.message || e).slice(0, 600) }; }
      }
      markTested(dataDir);
      return { ok: true, model: r.model, ms: r.ms, reply: r.content.slice(0, 40), agent };
    }
    // use：chat（小羽和课堂 AI）/ workshop / background（课后总结、录像分析这些软件自己在后台发的）；value.tier 可以临时指定。
    // 没说用途时按功能名分：课堂上老师当场点的 AI（讲题、画板书、问答、演示、动画、公式识别）算课堂 AI，其余算后台
    case 'ai.chat': {
      const use = tier.USES[value?.use] ? value.use : CLASS_AI.test(String(value?.feature || '课堂 AI')) ? 'chat' : 'background';
      const t = ctx.tiers ? (tier.IDS.includes(value?.tier) ? value.tier : ctx.tiers.get(use)) : '';
      // reqId：页面可以用 ai.cancel 取消这次请求（连同还在等的自动重试）；重试时发 aiRetry 事件，页面显示「网络波动，正在自动重连（第 n/5 次）…」
      const reqId = String(value?.reqId || '').slice(0, 80);
      const ctl = new AbortController();
      if (reqId) running.set(reqId, ctl);
      const feature = String(value?.feature || '课堂 AI').slice(0, 40);
      const onRetry = ({ attempt, max, wait, error }) => {
        ctx.log?.info?.('课堂 AI 自动重连', feature, attempt + '/' + max, String(error?.message || '').slice(0, 120));
        ctx.emit?.('aiRetry', { reqId, feature, attempt, max, wait, message: netRetry.retryText(attempt, max) });
      };
      try { return await metered(ledger, feature, () => chat(cfg, value, windows, t, { signal: ctl.signal, onRetry }), reconciler); }
      catch (e) { if (ctl.signal.aborted) throw new Error('已取消'); throw e; }
      finally { if (reqId) running.delete(reqId); }
    }
    case 'ai.cancel': { const c = running.get(String(value?.reqId ?? value ?? '')); if (c) c.abort(); return !!c; }
    // 「帮我查查」：免费自检，不调用任何付费模型
    case 'ai.diagnose': return require('./diagnose.cjs').diagnose({ cfg: { ...publicConfig(cfg), keyHint: cfg.hint || '' }, key: readKey(cfg), account: ctx.account, tiers: ctx.tiers, codexHome: ctx.codexHome, fetch: ctx.fetch });
    case 'ai.image': return metered(ledger, String(value?.feature || 'AI 生图').slice(0, 40), () => image(cfg, value, ctx.gate), reconciler, { taskId: value?.taskId });
    case 'ai.tiers': return ctx.tiers ? ctx.tiers.view(cfg.baseUrl || DEFAULT_BASE) : null;
    case 'ai.setTier': if (!ctx.tiers) throw new Error('档位不可用'); ctx.tiers.set(String(value?.use || ''), String(value?.tier || '')); ctx.onTier?.(value); return ctx.tiers.view(cfg.baseUrl || DEFAULT_BASE);
    case 'ai.ledger': return ledger ? ledger.summary() : null;
    // 动手前估个价：看图的部分按看图模型、文字部分按文字模型，套账本里的价格表
    case 'ai.estimate': {
      if (!ledger) return null;
      const n = (v) => Math.max(0, Math.min(1e9, Number(v) || 0));
      const vm = cfg.visionModel || cfg.model, tm = cfg.model || cfg.visionModel;
      const cny = ledger.cost(vm, { input: n(value?.vision?.input), output: n(value?.vision?.output) }) + ledger.cost(tm, { input: n(value?.text?.input), output: n(value?.text?.output) });
      return { cny: Math.round(cny * 100) / 100, model: vm };
    }
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
  // 真实 AI 测试：Key 由测试进程在内存里读出后经环境变量给进来，测试数据目录里不放含 Key 的 ai.json
  if (process.env.CS_TEST === '1' && process.env.CS_TEST_RELAY_KEY) return { baseUrl: cleanBase(process.env.CS_TEST_RELAY_BASE), model: process.env.CS_TEST_RELAY_MODEL || '', key: process.env.CS_TEST_RELAY_KEY };
  const cfg = load(dataDir);
  return { baseUrl: cleanBase(cfg.baseUrl), model: cfg.model || '', key: readKey(cfg) };
}

module.exports = { handle, credentials, offerImport, setAccountKey, clearAccountKey, keyUsable, markTested, publicConfig: (dataDir) => publicConfig(load(dataDir)), DEFAULT_BASE, load, readKey, explain, _test: { chat, request } };
