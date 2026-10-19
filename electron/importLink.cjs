'use strict';
// 一键导入接收端（yinzi-import/1，和银子 API 站点 mod/import.js、万能创作终端 electron/import.cjs 同一份约定）。
// 站点令牌页「一键导入到软件 → 最强网课教辅系统」打开
//   classroom-studio://v1/import?data=<base64url JSON>      （或 ?ticket=…&site=… 一次性领取）
// 打不开时给「导入码」YZIMPORT1:<base64url JSON> 或 .yzimport 文件（内容同导入码）。
// 这里只解析和校验，不写任何设置；完整 Key 只留在主进程。
// 另外兼容老办法：粘贴单独的 sk- Key，或 CC Switch / Cherry Studio 等客户端的导入链接。
const TARGET = 'classroom-studio';
const SCHEME = 'classroom-studio';
const CODE_PREFIX = 'YZIMPORT1:';
const MAX_BYTES = 8 * 1024;
const MAX_LIFETIME_S = 600;
const CLOCK_SKEW_S = 120;
const OFFICIAL_DOMAINS = ['yinziapi.top', 'changfengapi.cn', 'fuyaoapi.cn', 'qingyunapi.cn'];
const TARGET_NAMES = { 'omni-creator': '万能创作终端', 'classroom-studio': '最强网课教辅系统' };

const MESSAGES = {
  bad_format: '导入内容不完整或已损坏，请回到网站重新点「一键导入」。',
  no_code: '没有找到导入内容。请在网站令牌页点「一键导入到软件」→「复制导入码」，再粘贴到这里。',
  expired: '导入链接已过期（10 分钟有效），请回到网站重新生成。',
  replayed: '这个导入链接已经用过了，请回到网站重新生成。',
  wrong_target: '这个导入是给「{target}」用的，请在网站上把「导入到」选成「最强网课教辅系统」后重新导入。',
  origin_mismatch: '导入内容里的接口地址和来源网站不一致，已拒绝。',
  missing_key: '这个导入只包含模型设置，但本机还没有 Key。请在网站勾选「同时导入密钥」后重新导入。',
  ticket_failed: '无法从网站领取导入内容（可能已被使用或过期），请重新生成。',
  too_large: '导入内容超过 8 KB，已拒绝。',
  insecure: '只接受 https:// 站点的导入。',
  upgrade_needed: '这个导入需要更新版本的最强网课教辅系统，请先升级软件。',
  no_slots: '这个导入里没有可用的文本模型或看图模型，请在网站勾选后重新导入。',
};

class ImportError extends Error {
  constructor(code, vars = {}) {
    let msg = MESSAGES[code] || MESSAGES.bad_format;
    for (const [k, v] of Object.entries(vars)) msg = msg.replace(`{${k}}`, v);
    super(msg);
    this.code = code;
  }
}

const isLoopback = (url) => url.protocol === 'http:' && url.hostname === '127.0.0.1';
function parseSiteUrl(value, dev) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new ImportError('bad_format'); }
  if (url.username || url.password) throw new ImportError('bad_format');
  if (url.protocol !== 'https:' && !(dev && isLoopback(url))) throw new ImportError('insecure');
  return url;
}
// eslint-disable-next-line no-control-regex
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const model = (v) => str(v?.model, 120) || '';
function isOfficial(origin) {
  const host = new URL(origin).hostname.toLowerCase();
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

/** 导入链接 / 导入码 / .yzimport 文件内容 → { data } 或 { ticket, site }；不是这个约定返回 null */
function parseInput(input) {
  const s = String(input || '').trim().replace(/^\uFEFF/, '');
  if (s.length > MAX_BYTES * 2) throw new ImportError('too_large');
  const code = s.match(/YZIMPORT1:([A-Za-z0-9_-]+={0,2})/);
  if (code) return { data: code[1] };
  const m = s.match(/classroom-studio:\/\/[^\s"'<>]+/i) || s.match(/omni-creator:\/\/[^\s"'<>]+/i);
  if (!m) return null;
  let url;
  try { url = new URL(m[0]); } catch { throw new ImportError('bad_format'); }
  // Windows 可能交来 classroom-studio://v1/import/?…：host 是 v1，path 是 /import
  const route = `${url.host}${url.pathname}`.replace(/\/+$/, '');
  const major = /^v(\d+)\/import$/.exec(route);
  if (!major) throw new ImportError('bad_format');
  if (major[1] !== '1') throw new ImportError('upgrade_needed');
  const data = url.searchParams.get('data');
  if (data) return { data };
  const ticket = url.searchParams.get('ticket'), site = url.searchParams.get('site');
  if (ticket && site) return { ticket, site };
  throw new ImportError('bad_format');
}

function decodeData(b64) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(b64)) throw new ImportError('bad_format');
  const buf = Buffer.from(b64, 'base64url');
  if (buf.length > MAX_BYTES) throw new ImportError('too_large');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf)); } catch { throw new ImportError('bad_format'); }
}

/** v1.1：用一次性 ticket 向站点领取导入内容 */
async function redeemTicket(ticket, siteValue, { fetchImpl = fetch, dev = false, timeoutMs = 10000 } = {}) {
  const site = parseSiteUrl(siteValue, dev);
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(String(ticket))) throw new ImportError('bad_format');
  let res;
  try {
    res = await fetchImpl(`${site.origin}/api/import/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw new ImportError('ticket_failed'); }
  if (!res.ok) throw new ImportError('ticket_failed');
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_BYTES * 2) throw new ImportError('too_large');
  let body;
  try { body = JSON.parse(text); } catch { throw new ImportError('ticket_failed'); }
  const payload = body?.data?.schema ? body.data : body;
  if (payload?.site?.origin && parseSiteUrl(payload.site.origin, dev).origin !== site.origin) throw new ImportError('origin_mismatch');
  return payload;
}

/** 校验并整理成导播台要用的样子；不认识的字段丢掉 */
function validatePayload(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ImportError('bad_format');
  const sm = /^yinzi-import\/(\d+)$/.exec(String(raw.schema || ''));
  if (!sm) throw new ImportError('bad_format');
  if (sm[1] !== '1') throw new ImportError('upgrade_needed');
  if (raw.target !== TARGET) {
    if (typeof raw.target === 'string' && raw.target) throw new ImportError('wrong_target', { target: TARGET_NAMES[raw.target] || raw.target.slice(0, 40) });
    throw new ImportError('bad_format');
  }
  const nonce = str(raw.nonce, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(nonce)) throw new ImportError('bad_format');
  const iat = Number(raw.iat), exp = Number(raw.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat || exp - iat > MAX_LIFETIME_S) throw new ImportError('bad_format');
  const nowS = (ctx.now ?? Date.now()) / 1000;
  if (nowS > exp + CLOCK_SKEW_S || nowS < iat - CLOCK_SKEW_S) throw new ImportError('expired');
  if (ctx.nonceUsed?.(nonce)) throw new ImportError('replayed');
  const siteUrl = parseSiteUrl(raw.site?.origin, ctx.dev);
  const out = {
    kind: 'yinzi', nonce, exp,
    site: { name: str(raw.site?.name, 40) || siteUrl.host, origin: siteUrl.origin, host: siteUrl.host, official: isOfficial(siteUrl.origin) },
    profile: str(raw.profile?.name, 60),
    mode: raw.profile?.mode === 'replace' ? 'replace' : 'merge',
    baseUrl: '', key: '', keyName: '', smart: false,
    text: model(raw.slots?.text), vision: model(raw.slots?.vision),
    codex: model(raw.slots?.agent?.codex), claude: model(raw.slots?.agent?.claude),
  };
  if (raw.credentials != null) {
    const c = raw.credentials, key = str(c.api_key, 400);
    if (!key) throw new ImportError('bad_format');
    const base = parseSiteUrl(c.base_url, ctx.dev);
    if (base.origin !== siteUrl.origin) throw new ImportError('origin_mismatch');
    out.baseUrl = `${base.origin}${base.pathname.replace(/\/+$/, '') || '/v1'}`;
    out.key = key; out.keyName = str(c.key_name, 60); out.smart = c.smart_routing === true;
  }
  // 智能体模型只给 AI 工作室当默认值，单独导入它们还不够让导播台用起来
  if (!out.text && !out.vision && !out.key) throw new ImportError('no_slots');
  return out;
}

// ── 老办法：单独的 Key，或其他客户端的导入链接 ─────────────────────
const LEGACY = /\b(ccswitch|cherrystudio|aionui|deepchat|ama|opencat):\/\/[^\s"'<>]+/i;
function legacyBase(u) {
  let s = String(u || '').trim();
  try { if (/%[0-9a-f]{2}/i.test(s)) s = decodeURIComponent(s); } catch { /* 原样 */ }
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try { url = new URL(s); } catch { throw new ImportError('bad_format'); }
  const p = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') || '/v1';
  return url.origin + p;
}
function legacy(src) {
  const m = src.match(LEGACY);
  let base = '', key = '', mdl = '';
  if (m) {
    let url;
    try { url = new URL(m[0]); } catch { throw new ImportError('bad_format'); }
    const q = url.searchParams, pick = (...n) => n.map((x) => q.get(x)).find(Boolean) || '';
    const data = q.get('data');
    if (data) {
      let j;
      try { j = JSON.parse(Buffer.from(decodeURIComponent(data), 'base64').toString('utf8')); } catch { throw new ImportError('bad_format'); }
      base = j.baseUrl || j.baseURL || ''; key = j.apiKey || '';
    } else { base = pick('endpoint', 'server', 'domain'); key = pick('apiKey', 'key', 'token'); mdl = pick('model').split(',')[0]; }
  } else {
    const bare = src.match(/\bsk-[A-Za-z0-9_-]{8,200}\b/);
    if (!bare) return null;
    key = bare[0];
  }
  key = str(key, 400);
  if (!key) throw new ImportError('missing_key');
  if (!/^[\x21-\x7e]{8,400}$/.test(key)) throw new ImportError('bad_format');
  const baseUrl = legacyBase(base);
  if (baseUrl && !/^https:/.test(baseUrl)) throw new ImportError('insecure');
  const origin = baseUrl ? new URL(baseUrl).origin : '';
  return {
    kind: 'legacy', nonce: '', exp: 0,
    site: origin ? { name: new URL(origin).host, origin, host: new URL(origin).host, official: isOfficial(origin) } : null,
    profile: '', mode: 'merge', baseUrl, key: key.startsWith('sk-') ? key : 'sk-' + key, keyName: '', smart: false, text: str(mdl, 120), vision: '', codex: '', claude: '',
  };
}

/**
 * 收到的任何东西（链接、导入码、文件内容、粘贴的文字）→ 校验后的导入内容。抛 ImportError。
 * @param {{now?: number, dev?: boolean, nonceUsed?: (n: string) => boolean, fetchImpl?: typeof fetch}} ctx
 */
async function receive(input, ctx = {}) {
  const s = String(input || '').trim();
  if (!s) throw new ImportError('no_code');
  const parsed = parseInput(s);
  if (parsed) {
    const raw = parsed.data ? decodeData(parsed.data) : await redeemTicket(parsed.ticket, parsed.site, ctx);
    return validatePayload(raw, ctx);
  }
  const old = legacy(s);
  if (old) return old;
  throw new ImportError('no_code');
}

/** Windows 把链接（或双击的 .yzimport 文件）作为启动参数交过来 */
function linkFromArgv(argv) {
  return (argv || []).find((a) => typeof a === 'string' && (a.toLowerCase().startsWith(SCHEME + ':') || /\.yzimport$/i.test(a))) || '';
}

const encodeCode = (payload) => CODE_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

module.exports = { TARGET, SCHEME, CODE_PREFIX, ImportError, parseInput, decodeData, validatePayload, redeemTicket, receive, linkFromArgv, encodeCode, isOfficial };
