'use strict';
// 档位：省钱优先 / 均衡 / 质量优先。只对银子 API 系站点（玲珑账号和四个合作站）生效：每个请求带上
// X-Route-Scope（站点用它在这把 Key 自己的线路范围里再挑一遍，只会收窄、不会放宽）。手填的第三方 Key 一律不带。
// 值和玲珑工坊 0.7.0 一样（routing.cjs 的 PRESETS）：省钱优先不收窄，均衡 = B 级以上，质量优先 = A 级。
// 请求头只能是 ASCII，这三个值都是。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const HEADER = 'X-Route-Scope';
// 客户端来源：发到我们站点和合作站的每个请求（账号接口、模型调用、工坊拉起的 Codex / Claude Code）都带，站点按它认来源、算倍率。
// 版本号从软件自己的 package.json 读，不写死；站点只认前缀 classroom/。第三方 Key 一律不带。
const CLIENT_HEADER = 'X-Omni-Client';
const CLIENT = 'classroom/' + String(require(path.join(__dirname, '..', 'package.json')).version || '0');
const APPLIED = 'x-route-scope-applied';
const TIERS = {
  save: { name: '省钱优先', scope: '', hint: '挑最便宜的线路，日常聊天、查资料够用' },
  balanced: { name: '均衡', scope: 'B', hint: '只用评级 B 以上的线路，价格和效果折中' },
  quality: { name: '质量优先', scope: 'tier=A', hint: '只用评级最高的线路，做要交出去的成品时用' },
};
const IDS = Object.keys(TIERS);
// 用在哪 → 默认档位（设计稿 D.2）：小羽和课堂 AI 均衡；工坊出成品质量优先；后台自动（总结、录像分析）均衡
const USES = { chat: 'balanced', workshop: 'quality', background: 'balanced' };
const USE_NAMES = { chat: '小羽和课堂 AI', workshop: 'AI 工坊出成品', background: '后台自动（课后总结、录像分析）' };
const HOSTS = ['yinziapi.top', 'changfengapi.cn', 'fuyaoapi.cn', 'qingyunapi.cn'];
// 媒体（图片、视频）线路也有评级，带上档位会把它们都筛掉：只给文字接口带
const TEXT_CALL = /\/(chat\/completions|completions|responses|messages)(\/|$)/;
// 客户端发了站点不认识的 X-Route-Scope 值：属于客户端缺陷，记入缺陷日志且绝不重发掩盖
const INVALID_SCOPE = /无法识别的分组范围|不合法的分组范围|无效的分组范围|invalid route scope|unrecognized route scope/i;
// 站点返回 400「没有可用分组」：Key 自身分组与档位无交集（站点不扣费），去掉 X-Route-Scope 重发一次
const NO_GROUP_400 = /没有可用分组|按评级自动筛选.*没有|no eligible automatic route|未包含可用线路/i;
// 503 无可用渠道（课堂 AI 兼容）
const NO_CHANNEL_503 = /没有可用分组|没有分组|按评级自动筛选.*没有|no eligible automatic route|未包含可用线路|No available channel|没有可用渠道|无可用渠道|没有可用线路/i;
// 已知偏弱的模型（设计稿 D.3）：老师反馈过 gpt-6.1-sol 做课件不行，另加各家的小模型
const WEAK = /(?:^|[-_.:/])(mini|nano|lite|flash|luna|haiku|tiny|small|sol)(?=$|[-_.:/\d])|gpt-3\.5|gpt-4o-mini|6\.1-sol/i;
const COMPLAINT = /不对|错了|有错|不是这样|重做|重新做|再做一遍|太笨|好笨|真笨|笨死|不行|不好用|做得不好|不太好|做得(很)?差|太差|胡说|乱写|瞎写|没用|看不懂|不满意/;

let extraHosts = [];
/** 测试用：把模拟站点也当成银子 API 系 */
function setTestHosts(list) { extraHosts = (list || []).map((h) => String(h).toLowerCase()); }

function hostOf(u) { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ''; } }
/** 这个接口地址是不是银子 API 系的站点（玲珑账号和四个合作站），只有它们认档位 */
function applies(baseUrl) {
  const h = hostOf(baseUrl);
  if (!h) return false;
  return [...HOSTS, ...extraHosts].some((d) => h === d || h.endsWith('.' + d));
}
const clean = (t, use = 'chat') => (IDS.includes(t) ? t : USES[use] || 'balanced');
const scopeOf = (tier) => TIERS[tier]?.scope || '';

/**
 * 公共判断（唯一一处）：发到 url 的请求该带哪些站点请求头。
 * 银子 API 系站点（玲珑账号、四个合作站）：一律带 X-Omni-Client；文字接口再按档位带 X-Route-Scope（省钱优先不带，图片视频不带）。
 * 第三方站点：什么都不带。text 不给时按路径判断是不是文字接口。
 */
function siteHeaders(url, tier = '', { text } = {}) {
  if (!applies(url)) return {};
  const out = { [CLIENT_HEADER]: CLIENT };
  let isText = text;
  if (isText === undefined) { try { isText = TEXT_CALL.test(new URL(String(url)).pathname); } catch { isText = false; } }
  const s = isText && tier ? scopeOf(tier) : '';
  if (s) out[HEADER] = s;
  return out;
}
/** 只要档位那一个头（老调用方用） */
function headersFor(url, tier, o = {}) { const h = siteHeaders(url, tier, o); return h[HEADER] ? { [HEADER]: h[HEADER] } : {}; }
/** Codex：在 provider 配置里加静态请求头（每轮都是新进程，下一轮就生效）；第三方地址返回 [] */
function codexArgs(baseUrl, tier, provider = 'classroom') {
  const h = siteHeaders(baseUrl, tier, { text: true });
  const kv = Object.entries(h).map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`);
  return kv.length ? ['-c', `model_providers.${provider}.http_headers={ ${kv.join(', ')} }`] : [];
}
/** Claude Code：自定义请求头环境变量（"名字: 值"，一行一个）；第三方地址返回 {} */
function claudeEnv(baseUrl, tier) {
  const h = siteHeaders(baseUrl, tier, { text: true });
  const lines = Object.entries(h).map(([k, v]) => `${k}: ${v}`);
  return lines.length ? { ANTHROPIC_CUSTOM_HEADERS: lines.join(String.fromCharCode(10)) } : {};
}
/**
 * 主进程里其它直接用 fetch 发到站点的请求（以后新加的模型调用也算）兜底补上来源头：包一层全局 fetch，
 * 只在命中站点域名、而且调用方没自己设过时加；第三方地址原样放行。
 */
function installFetch(g = globalThis) {
  const orig = g.fetch;
  if (typeof orig !== 'function' || orig.siteHeaders) return;
  const wrapped = function siteFetch(input, init) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const add = siteHeaders(url, '', { text: false });
    if (!add[CLIENT_HEADER]) return orig(input, init);
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    if (!headers.has(CLIENT_HEADER)) headers.set(CLIENT_HEADER, add[CLIENT_HEADER]);
    return orig(input, { ...(init || {}), headers });
  };
  wrapped.siteHeaders = true;
  g.fetch = wrapped;
}

const isInvalidScope = (status, text) => status === 400 && INVALID_SCOPE.test(String(text || ''));
const isNoGroup400 = (status, text) => status === 400 && !isInvalidScope(status, text) && NO_GROUP_400.test(String(text || ''));
const isNoRoute = (status, text) => isNoGroup400(status, text) || (status === 503 && !INVALID_SCOPE.test(String(text || '')) && NO_CHANNEL_503.test(String(text || '')));
const weakModel = (m) => WEAK.test(String(m || ''));
// 工坊没选模型时用的推荐强模型（设计稿 E.5）：AI 设置里的模型是偏弱的（如 6.1-sol）也不用它
const STRONG_DEFAULT = 'gpt-6-astra';
const strongModel = (m) => { const v = String(m || '').trim(); return v && !weakModel(v) ? v : STRONG_DEFAULT; };
const complaint = (t) => COMPLAINT.test(String(t || '').slice(0, 200));

// ── 缺陷日志（记录「无法识别的分组范围」等客户端范围协议缺陷，绝不记录任何 Key） ──
let defaultDefectDir = '';
let defaultLog = null;
const defectMem = [];
const fallbackMem = [];
const scrubSecret = (s) => String(s ?? '').replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1***').replace(/(Bearer\s+)\S+/gi, '$1***');

function setDefectLogger({ dir = '', log = null } = {}) {
  if (dir !== undefined) defaultDefectDir = dir;
  if (log !== undefined) defaultLog = log;
}
function recentDefects() { return [...defectMem]; }
function clearDefects() { defectMem.length = 0; }
function recentFallbacks() { return [...fallbackMem]; }
function clearFallbacks() { fallbackMem.length = 0; }
function recordDefect(info = {}, { dir = defaultDefectDir, log = defaultLog } = {}) {
  const entry = {
    at: new Date().toISOString(),
    kind: info.kind || 'invalid_route_scope',
    who: String(info.who || 'unknown'),
    url: scrubSecret(info.url || ''),
    scope: String(info.scope || ''),
    status: Number(info.status) || 400,
    message: scrubSecret(String(info.message || '').slice(0, 500)),
  };
  defectMem.push(entry);
  if (defectMem.length > 50) defectMem.splice(0, defectMem.length - 50);
  (log || defaultLog)?.error?.('[缺陷] 无法识别的分组范围', entry.who, entry.scope, entry.url, entry.message);
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'defects.jsonl'), JSON.stringify(entry) + '\n');
    } catch { /* 磁盘异常不影响主流程 */ }
  }
  return entry;
}

/**
 * 发往我们站点的请求共用兜底函数（课堂 AI、工坊 Codex/Claude、小羽共用）：
 * - 带了 X-Route-Scope 时，收到 400 且是「没有可用分组」→ 去掉 X-Route-Scope 重发一次（X-Omni-Client 保留）；
 * - 收到 400 且是「无法识别的分组范围」→ 记进缺陷日志，不重发；
 * - 其它 400 一律不重发；
 * - allow503=true 时兼容课堂 AI 对 503 无可用渠道的去档位重试。
 */
async function sendWithScopeFallback(doSend, { scoped = {}, url = '', who = '', allow503 = false, log, defectDir, onFallback, onDefect } = {}) {
  const scopeKey = Object.keys(scoped).find((k) => k.toLowerCase() === HEADER.toLowerCase());
  const scopeVal = scopeKey ? scoped[scopeKey] : '';
  const res = await doSend(scoped);
  if (!scopeVal) return res;
  if (res.status !== 400 && !(allow503 && res.status === 503)) return res;
  const bodyText = await res.clone().text().catch(() => '');
  if (isInvalidScope(res.status, bodyText)) {
    const rec = recordDefect({ who, url, scope: scopeVal, status: res.status, message: bodyText }, { dir: defectDir, log });
    onDefect?.(rec);
    return res;
  }
  const retry = res.status === 400 ? isNoGroup400(400, bodyText) : isNoRoute(res.status, bodyText);
  if (!retry) return res;
  const keep = {};
  for (const [k, v] of Object.entries(scoped)) if (k.toLowerCase() !== HEADER.toLowerCase()) keep[k] = v;
  const fb = { at: new Date().toISOString(), kind: 'no_group_fallback', who: String(who || 'unknown'), url: scrubSecret(url || ''), scope: String(scopeVal || ''), status: res.status };
  fallbackMem.push(fb);
  if (fallbackMem.length > 50) fallbackMem.splice(0, fallbackMem.length - 50);
  onFallback?.({ who, url, scope: scopeVal, status: res.status });
  return doSend(keep);
}

// ── 本机回环站点转发（只用于命中 applies(baseUrl) 的工坊/小羽 CLI 子进程；第三方站点直连不经过这里） ──
const HOP_REQ = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive']);
const HOP_RES = new Set(['connection', 'content-length', 'transfer-encoding', 'content-encoding', 'keep-alive']);
let relaySrv = null;
let relayReady = null;
const relayRoutes = new Map();

function ensureSiteRelay() {
  if (relayReady) return relayReady;
  relayReady = new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const m = /^\/__cs_site\/([a-f0-9]+)(\/.*)?$/i.exec(req.url || '');
      const route = m ? relayRoutes.get(m[1]) : null;
      if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"unknown relay route"}'); return; }
      const tail = m[2] || '';
      const upstreamUrl = route.base + tail;
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const baseHeaders = {}, scoped = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v === undefined || HOP_REQ.has(k.toLowerCase())) continue;
          const val = Array.isArray(v) ? v.join(', ') : String(v);
          if (k.toLowerCase() === HEADER.toLowerCase()) scoped[HEADER] = val;
          else if (k.toLowerCase() === CLIENT_HEADER.toLowerCase()) scoped[CLIENT_HEADER] = val;
          else baseHeaders[k] = val;
        }
        const ctl = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
        const fetchFn = route.fetch || globalThis.fetch;
        try {
          const up = await sendWithScopeFallback(
            (extra) => fetchFn(upstreamUrl, {
              method: req.method,
              headers: { ...baseHeaders, ...extra },
              body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
              signal: ctl.signal,
            }),
            { scoped, url: upstreamUrl, who: route.who, allow503: false, log: route.log, defectDir: route.defectDir, onFallback: route.onFallback, onDefect: route.onDefect },
          );
          const outHeaders = {};
          up.headers.forEach((v, k) => { if (!HOP_RES.has(k.toLowerCase())) outHeaders[k] = v; });
          res.writeHead(up.status, outHeaders);
          res.flushHeaders?.();
          if (!up.body) { res.end(); return; }
          const stream = Readable.fromWeb(up.body);
          stream.on('error', () => { try { res.end(); } catch { /* 已关 */ } });
          stream.pipe(res);
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: { message: '本地转发连接上游失败：' + String(e?.message || e).slice(0, 200) } }));
          } else {
            try { res.end(); } catch { /* 已关 */ }
          }
        }
      });
    });
    srv.on('error', () => { relaySrv = null; resolve(0); });
    srv.listen(0, '127.0.0.1', () => {
      srv.unref?.();
      relaySrv = srv;
      resolve(srv.address().port);
    });
  });
  return relayReady;
}
// 模块加载即在后台绑好本机回环端口（unref 不阻塞进程退出），同步生成参数时也能直接拿到端口
void ensureSiteRelay();

function relayBaseUrl(baseUrl, opts = {}) {
  if (!applies(baseUrl)) return baseUrl;
  if (!relaySrv?.listening) return baseUrl;
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  const id = crypto.createHash('sha1').update((opts.key || '') + '|' + (opts.who || '') + '|' + base).digest('hex').slice(0, 16);
  relayRoutes.set(id, { base, who: opts.who || 'cli', fetch: opts.fetch, log: opts.log, defectDir: opts.defectDir, onFallback: opts.onFallback, onDefect: opts.onDefect });
  if (relayRoutes.size > 400) relayRoutes.delete(relayRoutes.keys().next().value);
  return `http://127.0.0.1:${relaySrv.address().port}/__cs_site/${id}`;
}

/**
 * 站点回执（X-Route-Scope-Applied，有中文时是百分号编码）→ 这次是不是走了低评级线路。
 * 回执里带的评级（tier=C、tier>=C、grade=C…）低于 B 算低评级；读不出评级返回 false。
 */
function lowRoute(applied) {
  let a = String(applied || '');
  try { a = decodeURIComponent(a); } catch { /* 原样 */ }
  const m = /(?:tier|grade|level|评级)\s*(?:>=|=|:)?\s*([A-Z])\b/i.exec(a);
  return !!m && m[1].toUpperCase() > 'B';
}

class TierStore {
  constructor(file) { this.file = file; this.v = {}; try { this.v = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { this.v = {}; } }
  get(use) { return clean(this.v[use], use); }
  all() { return Object.fromEntries(Object.keys(USES).map((u) => [u, this.get(u)])); }
  set(use, tier) {
    if (!USES[use]) throw new Error('不认识的用途：' + use);
    if (!IDS.includes(tier)) throw new Error('档位只能是：' + IDS.map((k) => TIERS[k].name).join('、'));
    this.v[use] = tier;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.v, null, 2)); fs.renameSync(this.file + '.tmp', this.file);
    return this.all();
  }
  view(baseUrl) {
    return { uses: this.all(), defaults: { ...USES }, useNames: USE_NAMES, tiers: IDS.map((id) => ({ id, name: TIERS[id].name, hint: TIERS[id].hint })), applies: applies(baseUrl) };
  }
}

module.exports = {
  HEADER, CLIENT_HEADER, CLIENT, siteHeaders, installFetch, APPLIED, TIERS, IDS, USES, USE_NAMES, HOSTS,
  applies, clean, scopeOf, headersFor, codexArgs, claudeEnv,
  isInvalidScope, isNoGroup400, isNoRoute, sendWithScopeFallback,
  setDefectLogger, recordDefect, recentDefects, clearDefects, recentFallbacks, clearFallbacks,
  ensureSiteRelay, relayBaseUrl,
  weakModel, strongModel, STRONG_DEFAULT, complaint, lowRoute, TierStore, setTestHosts,
};
