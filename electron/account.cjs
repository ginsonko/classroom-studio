'use strict';
// 账号：玲珑账号（银子 API 商业版，只能在软件里注册 / 登录）和合作站账号（银子 API、长风、扶摇、青云的老账号，只登录）。
// 照搬玲珑工坊 0.7.0 的 yinzi-account.cjs：一切都在主进程里做，登录状态（站点会话 cookie）用系统安全存储加密，
// 登录后自动建一把名叫「玲珑课堂」的专用 Key（兼容找回旧名「最强网课教辅系统」）写进 AI 设置，页面只看得到账号名和余额，看不到 Key。
// 所有请求都带 X-Omni-Client: classroom/<版本>（站点用它统计来源、认注册来源；只是标识，不是凭证）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KEY_NAME = '玲珑课堂';
const LEGACY_KEY_NAMES = ['最强网课教辅系统'];
const TIMEOUT_MS = 20000;
const PAGE = 100;
const LINGLONG = { id: 'linglong', name: '玲珑账号', origin: 'https://yinziapi.top', api: 'https://api.yinziapi.top', app: true };
const PARTNERS = [
  { id: 'yinzi', name: '银子API', origin: 'https://yinziapi.top', api: 'https://api.yinziapi.top', loginOnly: true },
  { id: 'changfeng', name: '长风API', origin: 'https://changfengapi.cn', loginOnly: true },
  { id: 'fuyao', name: '扶摇API', origin: 'https://fuyaoapi.cn', loginOnly: true },
  { id: 'qingyun', name: '青云API', origin: 'https://qingyunapi.cn', loginOnly: true },
];
const SITES = [LINGLONG, ...PARTNERS];

class AccountError extends Error {
  constructor(message, code = '') { super(message); this.code = code; }
}

// 站点的原因码 → 老师看得懂的话（货舟交接单第 5 节同一张表）
const REASONS = [
  [/commercial_app_only/i, '这是玲珑账号，只能在软件里用「玲珑账号」登录', 'commercial_app_only'],
  [/commercial_disabled/i, '玲珑账号注册暂未开放，请稍后再试', 'commercial_disabled'],
  [/commercial_paused/i, '玲珑账号的收费功能临时维护，这次没有扣费，请稍后再试', 'commercial_paused'],
  // 站点还没把「玲珑课堂」加进认的客户端名单（register_source 只认 万能创作终端 / 玲珑工坊 / 货舟 / 玲珑课堂）
  [/x-omni-client|register_source|unknown client|未知(的)?客户端|客户端.{0,8}(不支持|未授权|不在)|来源.{0,6}(不支持|未知|不在)/i, '站点还没开通「玲珑课堂」这个客户端（需要站长把它加进站点白名单），玲珑账号暂时用不了。可以先用合作站账号登录，或跳过后用一键导入', 'client_unknown'],
];
function reason(text) {
  for (const [re, msg, code] of REASONS) if (re.test(String(text || ''))) return new AccountError(msg, code);
  return null;
}

/** 安全存储：Electron safeStorage；不可用时登录状态只留在内存里（关掉软件就要重新登录），绝不明文落盘 */
function makeCrypt(safeStorage) {
  const ok = (() => { try { return !!safeStorage?.isEncryptionAvailable(); } catch { return false; } })();
  return {
    available: ok,
    encrypt: (s) => (ok ? safeStorage.encryptString(String(s)).toString('base64') : null),
    decrypt: (v) => (ok && v ? safeStorage.decryptString(Buffer.from(String(v), 'base64')) : ''),
  };
}

class Account {
  /**
   * @param {{dir: string, crypt: {available: boolean, encrypt(s: string): string|null, decrypt(v: string): string}, client: string,
   *   sites?: any[], fetchImpl?: typeof fetch, now?: () => number, keyName?: string}} o
   */
  constructor(o) {
    this.sites = o.sites || SITES;
    this.crypt = o.crypt;
    this.fetch = o.fetchImpl || ((...a) => fetch(...a));
    this.now = o.now || Date.now;
    this.client = String(o.client || '').slice(0, 64);
    this.keyName = o.keyName || KEY_NAME;
    this.file = path.join(o.dir, 'account.json');
    this.caps = new Map();
    this.pending = null;
    this.mem = '';
    this.unit = 500000;
    this.state = {};
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { this.state = {}; }
    if (!this.state.prefs) this.state.prefs = {};
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  site(id = this.state.site) {
    const s = this.sites.find((x) => x.id === id) || this.sites[0];
    return { ...s, api: s.api || s.origin };
  }

  get signedIn() { return !!(this.state.userId && this.cookie()); }
  get kind() { return this.signedIn ? (this.site().app ? 'linglong' : 'partner') : ''; }

  /** 页面能看到的：没有 cookie、没有 Key */
  view() {
    const s = this.signedIn ? this.site() : null;
    return {
      signedIn: this.signedIn, kind: this.kind,
      site: s ? { id: s.id, name: s.name, origin: s.origin } : null,
      username: this.signedIn ? this.state.username || '' : '',
      hasKey: !!this.state.keyId, pending2fa: !!this.pending,
      sites: this.sites.map((x) => ({ id: x.id, name: x.name, origin: x.origin, app: !!x.app, loginOnly: !!x.loginOnly })),
      secure: this.crypt.available, never: !!this.state.prefs.never,
    };
  }

  cookie() {
    if (this.mem) return this.mem;
    try { return this.state.cookie ? this.crypt.decrypt(this.state.cookie) : ''; } catch { return ''; }
  }

  /** 站点管理接口的一次调用；auth = 带上登录状态 */
  async req(method, p, { body, auth = true, site, cookie, headers: extra } = {}) {
    const s = site || this.site();
    const headers = { ...(extra || {}), accept: 'application/json', 'accept-language': 'zh-CN,zh;q=0.9' };
    if (this.client) headers['X-Omni-Client'] = this.client;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const jar = cookie ?? (auth ? this.cookie() : '');
    if (auth && !jar) throw new AccountError('请先登录', 'signed_out');
    if (jar) headers.cookie = jar;
    if (auth && this.state.userId) headers['New-Api-User'] = String(this.state.userId);
    let res;
    try {
      res = await this.fetch(`${s.origin}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new AccountError(e?.name === 'TimeoutError' ? `${s.name}响应超时，请稍后再试` : `连不上${s.name}，请检查网络（开了代理的话试试关掉或换一个）`, 'network');
    }
    const set = (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean);
    const session = set.map((c) => /^\s*(session=[^;]*)/.exec(c)?.[1]).find(Boolean) || '';
    if (res.status === 401 && auth) {
      this.signOut();
      throw new AccountError('登录已过期，请重新登录', 'expired');
    }
    if (res.status === 429) throw new AccountError('操作太频繁，请过一会儿再试（登录、取 Key、充值有频率限制）', 'rate_limited');
    if (res.status === 304) return { json: null, session, notModified: true, status: 304 };
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok || !json) {
      const why = reason(text);
      if (why) throw why;
      if (res.status === 402) throw new AccountError('账户余额不足，请先充值', 'balance');
      if (res.status === 401) throw new AccountError(String(json?.message || '用户名、密码或验证码不对').slice(0, 200), 'denied');
      throw Object.assign(new AccountError(`${s.name}返回错误（${res.status}）`, 'http'), { status: res.status });
    }
    // 支付接口出错时回 {message: 'error', data: '原因'}，不是 success=false
    if (json.success === false || json.message === 'error') {
      const why = String((json.success === false ? json.message : json.data) || '操作失败').slice(0, 200);
      throw reason(why) || reason(json.code) || new AccountError(why, 'site');
    }
    return { json, session, status: res.status };
  }

  async readUnit(site) {
    try {
      const { json } = await this.req('GET', '/api/status', { auth: false, site });
      const u = Number(json?.data?.quota_per_unit);
      if (u > 0) this.unit = u;
      return json?.data || {};
    } catch { return {}; }
  }

  /**
   * 站点开放了哪些软件功能（/api/app/v1/capabilities，商业版 v4）：没上线、404、读不到都当「全没开」。
   * 登录了就带上会话，站点按这个账号回答；五分钟缓存，登录、退出时清掉。
   */
  async appCaps(site = this.site(), { anon = false } = {}) {
    if (!site.app) return null;
    const jar = !anon && this.state.site === site.id && this.state.userId ? this.cookie() : '';
    const id = `${site.id}:${jar ? this.state.userId : 0}`;
    const hit = this.caps.get(id);
    if (hit && this.now() - hit.at < 300000) return hit.v;
    let v = null;
    try {
      v = (await this.req('GET', '/api/app/v1/capabilities', { auth: false, site, cookie: jar, headers: jar ? { 'New-Api-User': String(this.state.userId) } : undefined })).json?.data || null;
    } catch { v = null; }
    this.caps.set(id, { at: this.now(), v });
    return v;
  }

  /** 登录页要知道的：站点连不连得上、能不能注册、要不要邮箱验证码、玲珑账号能不能登录 */
  async siteInfo(siteId) {
    const site = this.site(siteId);
    const d = await this.readUnit(site);
    const reachable = Object.keys(d).length > 0;
    if (!site.app) return { site: site.id, reachable, register: false, login: reachable && d.password_login_enabled !== false, emailVerification: !!d.email_verification, note: reachable ? '' : `连不上${site.name}，请检查网络` };
    const caps = await this.appCaps(site, { anon: true });
    const login = !!caps?.app_login, register = !!caps?.commercial_register;
    return {
      site: site.id, reachable, login, register, emailVerification: d.email_verification !== false, caps: caps || null,
      // 开关接口拿不到（站点还没上线 v4）或没开：写「注册暂未开放」，页面隐藏注册；合作站登录和自配 Key 照常可用
      note: !reachable ? `连不上${site.name}，请检查网络` : !caps ? '注册暂未开放：玲珑账号还在开通中，开放后这里会自动出现，不用更新软件。现在可以先用合作站账号登录，或跳过自己配 Key。'
        : !login ? '注册暂未开放，玲珑账号登录也暂未开放，请稍后再试；合作站账号和自配 Key 照常可用' : !register ? '注册暂未开放，已有玲珑账号可以直接登录' : '',
    };
  }

  cny(quota) { return Math.round((Number(quota) || 0) / this.unit * 100) / 100; }

  finishLogin(site, data, session) {
    if (!session) throw new AccountError('登录没有成功（网站没有返回登录状态）', 'no_session');
    const enc = this.crypt.encrypt(session);
    this.mem = enc ? '' : session;
    this.state = { site: site.id, userId: Number(data.id), username: String(data.username || ''), cookie: enc || '', at: this.now(), prefs: this.state.prefs || {} };
    this.pending = null;
    this.caps.clear();
    this.persist();
    return this.view();
  }

  async login({ site: siteId, username, password }) {
    const site = this.site(siteId);
    const u = String(username || '').trim();
    if (!u || !password) throw new AccountError('请填写用户名和密码');
    await this.readUnit(site);
    if (site.app && !(await this.appCaps(site, { anon: true }))?.app_login) throw new AccountError('玲珑账号登录暂未开放（站点正在升级），开放后这里会自动能用。现在可以先用合作站账号登录，或跳过自己配', 'app_login_off');
    const { json, session } = await this.req('POST', site.app ? '/api/app/v1/login' : '/api/user/login', { auth: false, site, body: { username: u, password: String(password) } });
    if (json.data?.require_2fa) {
      this.pending = { site: site.id, cookie: session };
      return { ...this.view(), need2fa: true };
    }
    return this.finishLogin(site, json.data || {}, session);
  }

  async verify2fa(code) {
    if (!this.pending) throw new AccountError('请先输入用户名和密码');
    const site = this.site(this.pending.site);
    const { json, session } = await this.req('POST', site.app ? '/api/app/v1/login/2fa' : '/api/user/login/2fa', { auth: false, site, cookie: this.pending.cookie, body: { code: String(code || '').trim() } });
    return this.finishLogin(site, json.data || {}, session || this.pending.cookie);
  }

  async sendCode({ site: siteId, email }) {
    const site = this.site(siteId);
    if (site.loginOnly) throw new AccountError(`${site.name}的账号请在${site.name}网站注册，软件里只能登录`, 'login_only');
    const e = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new AccountError('请填写正确的邮箱');
    if (!(await this.appCaps(site, { anon: true }))?.commercial_register) throw new AccountError('注册暂未开放，请稍后再试', 'commercial_disabled');
    await this.req('GET', `/api/verification?email=${encodeURIComponent(e)}&turnstile=`, { auth: false, site });
    return true;
  }

  async register({ site: siteId, username, password, email, code, aff }) {
    const site = this.site(siteId);
    if (site.loginOnly) throw new AccountError(`${site.name}的账号请在${site.name}网站注册，软件里只能登录`, 'login_only');
    const body = { username: String(username || '').trim(), password: String(password || ''), email: String(email || '').trim(), verification_code: String(code || '').trim() };
    if (aff) body.aff_code = String(aff).trim();
    if (!body.username || body.password.length < 8) throw new AccountError('用户名不能为空，密码至少 8 位');
    // 只走软件注册接口：开了才注册，免得在网页那边注册出一个没打标的普通账号
    if (!(await this.appCaps(site, { anon: true }))?.commercial_register) throw new AccountError('注册暂未开放，请稍后再试', 'commercial_disabled');
    await this.req('POST', '/api/app/v1/register', { auth: false, site, body });
    return this.login({ site: site.id, username: body.username, password: body.password });
  }

  signOut() {
    this.state = { prefs: this.state.prefs || {} };
    this.mem = ''; this.pending = null; this.caps.clear();
    this.persist();
    return this.view();
  }

  setPrefs(p) { this.state.prefs = { ...this.state.prefs, ...p }; this.persist(); return this.view(); }

  async self() {
    const status = await this.readUnit();
    const { json } = await this.req('GET', '/api/user/self');
    const d = json.data || {};
    // 只挑能给老师看的字段：不要分组、倍率、原价
    return {
      username: d.username || this.state.username, displayName: d.display_name || '', email: d.email || '',
      balance: this.cny(d.quota), used: this.cny(d.used_quota), requests: Number(d.request_count) || 0,
      topupLink: status.top_up_link || '', commercial: d.commercial?.enabled === true,
    };
  }

  async rawKeys() {
    const { json } = await this.req('GET', `/api/token/?p=1&size=${PAGE}`);
    const d = json.data;
    return Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : [];
  }

  /**
   * 软件专用的 Key：按名字找，没有就新建（不限额、不过期；站点有智能路由就开着，档位才起作用），停用了就重新启用。
   * 返回完整 Key 只给主进程写 AI 设置用。
   */
  async ensureKey() {
    const list = await this.rawKeys();
    // 优先匹配当前配置的 keyName，同时兼容线上老用户已有的历史专用 Key 名，避免升级后多建一把重复 Key
    const matchNames = this.keyName === KEY_NAME ? [this.keyName, ...LEGACY_KEY_NAMES] : [this.keyName];
    let k = list.find((t) => matchNames.includes(t.name) && Number(t.status) === 1) || list.find((t) => matchNames.includes(t.name));
    if (!k) {
      let policy = '';
      try { const { json } = await this.req('GET', '/api/smart-router/options'); if (json.data?.enabled) policy = JSON.stringify(json.data.default_policy || {}); } catch { policy = ''; }
      const before = new Set(list.map((t) => Number(t.id)));
      await this.req('POST', '/api/token/', { body: { name: this.keyName, remain_quota: 0, unlimited_quota: true, expired_time: -1, model_limits_enabled: false, model_limits: '', allow_ips: '', group: policy ? 'auto' : '', cross_group_retry: false, routing_policy: policy } });
      k = (await this.rawKeys()).filter((t) => !before.has(Number(t.id)) && t.name === this.keyName).sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!k) throw new AccountError('专用 Key 已经建好，但没找到它，请稍后点「重新连接」');
    } else if (Number(k.status) !== 1) await this.req('PUT', '/api/token/?status_only=true', { body: { id: Number(k.id), status: 1 } });
    const { json } = await this.req('POST', `/api/token/${Number(k.id)}/key`);
    const key = String(json.data?.key || '');
    if (!key) throw new AccountError('没取到专用 Key，请稍后点「重新连接」');
    this.state.keyId = Number(k.id); this.persist();
    return { id: Number(k.id), key: key.startsWith('sk-') ? key : `sk-${key}`, baseUrl: this.site().api.replace(/\/+$/, '') + '/v1' };
  }

  async topupInfo() {
    const { json } = await this.req('GET', '/api/user/topup/info');
    const d = json.data || {};
    return {
      online: !!d.enable_online_topup, redeem: d.enable_redemption !== false,
      methods: (d.pay_methods || []).filter((m) => m?.type && !['stripe', 'waffo', 'waffo_pancake', 'creem'].includes(m.type)).map((m) => ({ type: String(m.type), name: String(m.name || m.type), min: Number(m.min_topup) || 0 })),
      min: Number(d.min_topup) || 1, options: (d.amount_options || []).map(Number).filter((n) => n > 0), link: String(d.topup_link || ''),
    };
  }

  async price(amount) {
    const { json } = await this.req('POST', '/api/user/amount', { body: { amount: Math.floor(Number(amount)) } });
    return Number(json.data) || 0;
  }

  /** 发起在线支付：返回支付网关地址和要提交的表单字段 */
  async pay(amount, method) {
    const n = Math.floor(Number(amount));
    if (!(n > 0)) throw new AccountError('请输入充值金额');
    const { json } = await this.req('POST', '/api/user/pay', { body: { amount: n, payment_method: String(method || '') } });
    const url = String(json.url || '');
    if (!/^https?:\/\//i.test(url)) throw new AccountError('网站没有返回支付地址');
    return { url, fields: Object.fromEntries(Object.entries(json.data || {}).map(([k, v]) => [k, String(v)])) };
  }

  async redeem(code) {
    const key = String(code || '').trim();
    if (!key) throw new AccountError('请输入兑换码');
    const { json } = await this.req('POST', '/api/user/topup', { body: { key } });
    return { added: this.cny(json.data) };
  }

  /** 消费明细：站点实扣的金额（type=2 消费），不用本机估价 */
  async logs({ page = 1, size = 20, days = 30 } = {}) {
    await this.readUnit();
    const end = Math.floor(this.now() / 1000), start = end - Math.max(1, Number(days) || 30) * 86400;
    const q = { type: '2', token_name: '', model_name: '', start_timestamp: String(start), end_timestamp: String(end) };
    const [{ json }, stat] = await Promise.all([
      this.req('GET', `/api/log/self?${new URLSearchParams({ p: String(page), page_size: String(Math.min(100, size)), ...q })}`),
      this.req('GET', `/api/log/self/stat?${new URLSearchParams(q)}`).catch(() => null),
    ]);
    const d = json.data || {};
    const items = (Array.isArray(d.items) ? d.items : []).map((l) => ({ at: Number(l.created_at) * 1000, model: String(l.model_name || ''), key: String(l.token_name || ''), cost: this.cny(l.quota), input: Number(l.prompt_tokens) || 0, output: Number(l.completion_tokens) || 0, seconds: Number(l.use_time) || 0 }));
    return { items, total: Number(d.total) || items.length, page: Number(page), spent: stat ? this.cny(stat.json.data?.quota) : null };
  }

  /** 这个接口地址是不是登录的这个站 */
  ownsOrigin(origin) {
    if (!this.signedIn) return false;
    try {
      const s = this.site(), host = new URL(String(origin)).host.toLowerCase();
      return [s.api, s.origin].some((u) => u && new URL(u).host.toLowerCase() === host);
    } catch { return false; }
  }
}

/** 支付网关要表单 POST 时用的自动提交页 */
function paymentPage(url, fields) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const inputs = Object.entries(fields || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const nonce = crypto.randomBytes(8).toString('hex');
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; form-action https: http:"><title>正在打开支付页…</title><p style="font:14px sans-serif;color:#555">正在打开支付页…</p><form id="f" method="post" action="${esc(url)}">${inputs}</form><script nonce="${nonce}">document.getElementById('f').submit()</script>`;
}

module.exports = { Account, AccountError, makeCrypt, paymentPage, reason, KEY_NAME, SITES, LINGLONG, PARTNERS };
