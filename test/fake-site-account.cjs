'use strict';
// 测试用的假站点（银子 API 商业版 v4 的接口形状，按货舟交接单和预发交接写）：账号、专用 Key、充值、明细、价格板、
// 单次报价、OpenAI 兼容接口。不联网、不花钱。记下每个请求的方法、路径和几个关心的请求头，测试据此断言。
//   opts.caps：null = 站点还没上线 v4（capabilities 404）；对象 = 开放的功能
//   opts.clients：认的 X-Omni-Client 前缀；没给就都认
const http = require('node:http');
const crypto = require('node:crypto');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function start(opts = {}) {
  const st = {
    caps: opts.caps === undefined ? { app_login: true, commercial_register: true, price_board: true, commercial_quote: true } : opts.caps,
    clients: opts.clients || null,
    users: new Map([['teacher', { id: 7, password: 'pass-1234', commercial: true, quota: 25 * 500000 }], ['otp', { id: 8, password: 'pass-1234', otp: '123456', commercial: true, quota: 500000 }], ['plain', { id: 9, password: 'pass-1234', commercial: false, quota: 3 * 500000 }]]),
    sessions: new Map(), tokens: [], nextToken: 100, log: [], quotes: new Map(), price: 0.12, sent: [],
    models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.4', 'claude-opus-5-5', 'gpt-image-2', 'smart-image'],
  };
  const keyOf = (t) => 'sk-fake' + crypto.createHash('sha256').update(String(t.id)).digest('hex').slice(0, 24);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), p = u.pathname;
      const h = (n) => req.headers[n.toLowerCase()] || '';
      st.log.push({ method: req.method, path: p, client: h('x-omni-client'), scope: h('x-route-scope'), quote: h('x-parameter-quote'), auth: h('authorization') ? 'bearer' : '', cookie: h('cookie') ? 'yes' : '' });
      const j = (code, v, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(v)); };
      const ok = (data, extra) => j(200, { success: true, message: '', data }, extra);
      const fail = (message, code = 200) => j(code, { success: false, message });
      let b = {}; try { b = body ? JSON.parse(body) : {}; } catch { b = {}; }
      const sid = /session=([^;]+)/.exec(h('cookie'))?.[1] || '';
      const who = st.sessions.get(sid);
      const me = who ? [...st.users.entries()].find(([, v]) => v.id === who.id) : null;
      const needLogin = () => { if (!who || String(who.id) !== h('new-api-user')) { j(401, { success: false, message: '未登录' }); return true; } return false; };
      const clientOk = () => !st.clients || st.clients.some((c) => h('x-omni-client').startsWith(c));
      const session = (id) => { const s = crypto.randomBytes(8).toString('hex'); st.sessions.set(s, { id }); return { 'set-cookie': `session=${s}; Path=/; HttpOnly` }; };

      if (p === '/api/status') return ok({ quota_per_unit: 500000, email_verification: true, password_login_enabled: true, top_up_link: '' });
      if (p === '/api/app/v1/capabilities') return st.caps ? ok(st.caps) : j(404, { message: 'not found' });
      if (p === '/api/app/v1/login' || p === '/api/user/login') {
        const appPath = p.startsWith('/api/app');
        if (appPath && !st.caps?.app_login) return j(404, { message: 'not found' });
        if (appPath && !clientOk()) return fail('unknown client: X-Omni-Client not allowed');
        const usr = st.users.get(String(b.username || ''));
        if (!usr || usr.password !== b.password) return fail('用户名或密码错误');
        if (!appPath && usr.commercial) return fail('commercial_app_only');
        if (usr.otp) { const s = crypto.randomBytes(8).toString('hex'); st.sessions.set(s, { pending: usr.id }); return ok({ require_2fa: true }, { 'set-cookie': `session=${s}; Path=/` }); }
        return ok({ id: usr.id, username: b.username }, session(usr.id));
      }
      if (p === '/api/app/v1/login/2fa' || p === '/api/user/login/2fa') {
        const pend = st.sessions.get(sid);
        const usr = [...st.users.entries()].find(([, v]) => v.id === pend?.pending);
        if (!usr || b.code !== usr[1].otp) return fail('验证码不对');
        return ok({ id: usr[1].id, username: usr[0] }, session(usr[1].id));
      }
      if (p === '/api/verification') return st.caps?.commercial_register ? ok(true) : fail('commercial_disabled');
      if (p === '/api/app/v1/register') {
        if (!st.caps?.commercial_register) return fail('commercial_disabled');
        if (!clientOk()) return fail('register_source: unknown client');
        if (b.verification_code !== '888888') return fail('验证码错误');
        st.users.set(b.username, { id: 20 + st.users.size, password: b.password, commercial: true, quota: 0, client: h('x-omni-client') });
        return ok(true);
      }
      if (p === '/api/user/self') { if (needLogin()) return; return ok({ id: who.id, username: me[0], quota: me[1].quota, used_quota: 2 * 500000, request_count: 42, group: 'vip', ...(me[1].commercial ? { commercial: { enabled: true } } : {}) }); }
      if (p === '/api/smart-router/options') { if (needLogin()) return; return ok({ enabled: true, default_policy: { mode: 'cheap' } }); }
      if (p === '/api/token/' && req.method === 'GET') { if (needLogin()) return; return ok({ items: st.tokens.filter((t) => t.user === who.id).map((t) => ({ ...t, key: 'sk-****' })) }); }
      if (p === '/api/token/' && req.method === 'POST') { if (needLogin()) return; st.tokens.push({ id: st.nextToken++, user: who.id, name: b.name, status: 1, group: b.group, routing_policy: b.routing_policy, unlimited_quota: true }); return ok(null); }
      if (p === '/api/token/' && req.method === 'PUT') { if (needLogin()) return; const t = st.tokens.find((x) => x.id === b.id); if (t) t.status = b.status; return ok(null); }
      const km = /^\/api\/token\/(\d+)\/key$/.exec(p);
      if (km) { if (needLogin()) return; const t = st.tokens.find((x) => x.id === Number(km[1]) && x.user === who.id); return t ? ok({ key: keyOf(t).slice(3) }) : fail('没有这个 Key'); }
      if (p === '/api/user/topup/info') { if (needLogin()) return; return ok({ enable_online_topup: true, enable_redemption: true, pay_methods: [{ type: 'alipay', name: '支付宝' }, { type: 'wxpay', name: '微信' }, { type: 'stripe', name: 'Stripe' }], min_topup: 1, amount_options: [10, 30, 50, 100] }); }
      if (p === '/api/user/amount') { if (needLogin()) return; return ok(String(Number(b.amount) * 1)); }
      if (p === '/api/user/pay') { if (needLogin()) return; return j(200, { message: 'success', url: 'https://pay.example.test/submit', data: { out_trade_no: 'T1', money: String(b.amount) } }); }
      if (p === '/api/user/topup') { if (needLogin()) return; if (b.key !== 'GIFT-10') return fail('兑换码无效'); me[1].quota += 10 * 500000; return ok(10 * 500000); }
      if (p === '/api/log/self') { if (needLogin()) return; return ok({ items: [{ created_at: Math.floor(Date.now() / 1000) - 60, model_name: 'gpt-6-astra', token_name: '最强网课教辅系统', quota: 0.31 * 500000, prompt_tokens: 1200, completion_tokens: 300, use_time: 4, group: 'vip', other: '{"ratio":1.5}' }], total: 1 }); }
      if (p === '/api/log/self/stat') { if (needLogin()) return; return ok({ quota: 0.31 * 500000 }); }
      if (p === '/api/app/v1/price-board') {
        if (needLogin()) return;
        if (!st.caps?.price_board) return j(404, {});
        const tier = (id, k) => ({ id, sections: [{ kind: 'text', items: [{ model: 'gpt-6-astra', available: true, unit: 'per_1m_tokens', input_cny: 2 * k, output_cny: 8 * k, configured: true, group_ratio: 1.5, original_price: 1 }] }, { kind: 'image', items: [{ model: 'gpt-image-2', available: true, unit: 'per_image', min_cny: 0.12, max_cny: 0.12 }] }] });
        return ok({ revision: 'r1', notice: '仅估算，随时波动，以实际账单为准', tiers: [tier('save', 1), tier('balanced', 1.2), tier('quality', 2)] });
      }
      if (p === '/api/media/parameter-quote') {
        if (needLogin()) return;
        if (!st.tokens.some((t) => t.id === Number(u.searchParams.get('token_id')) && t.user === who.id)) return fail('token 不属于你');
        const q = 'q1.' + crypto.randomBytes(6).toString('hex');
        st.quotes.set(q, { fields: b.fields, cny: st.price, exp: Date.now() + 300000 });
        return ok({ supported: true, quote_id: q, offer: { payable_quota: Math.round(st.price * 500000), payable_cny: st.price, payable_exact: true, unit: 'per_image', units: Number(b.fields?.n) || 1, expires_at_sec: Math.floor(Date.now() / 1000) + 300 } });
      }
      // ── OpenAI 兼容接口 ──
      if (p.startsWith('/v1/')) {
        const key = h('authorization').replace(/^Bearer\s+/i, '');
        const tok = st.tokens.find((t) => keyOf(t) === key);
        if (!tok && !key.startsWith('sk-own')) return j(401, { error: { message: 'invalid api key' } });
        const owner = tok ? [...st.users.values()].find((x) => x.id === tok.user) : null;
        if (p === '/v1/models') return j(200, { data: st.models.map((id) => ({ id })) });
        if (p === '/v1/chat/completions') {
          st.sent.push({ path: p, scope: h('x-route-scope'), model: b.model });
          if (h('x-route-scope') === 'tier=A' && opts.noRouteA) return j(400, { error: { message: '这个范围里没有可用分组' } });
          if (owner && owner.quota <= 0) return j(402, { error: { message: '余额不足' } });
          return j(200, { model: b.model, choices: [{ message: { role: 'assistant', content: b.response_format ? '{"ok":true}' : '在线' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }, h('x-route-scope') ? { 'x-route-scope-applied': `${h('x-route-scope')}; groups=3` } : {});
        }
        if (p === '/v1/responses') { st.sent.push({ path: p, scope: h('x-route-scope'), model: b.model }); return j(200, { model: b.model, output_text: '在线', usage: { input_tokens: 5, output_tokens: 2 } }); }
        if (p === '/v1/images/generations') {
          st.sent.push({ path: p, scope: h('x-route-scope'), quote: h('x-parameter-quote'), model: b.model });
          if (owner?.commercial) {
            const q = st.quotes.get(h('x-parameter-quote'));
            if (!q) return j(400, { error: { code: 'quote_required', message: '请先报价' } });
            if (q.exp < Date.now() || q.fields?.prompt !== b.prompt) return j(409, { error: { code: 'price_changed', message: '价格变了' } });
            st.quotes.delete(h('x-parameter-quote'));
            owner.quota -= Math.round(q.cny * 500000);
          }
          return j(200, { data: [{ b64_json: PNG }] });
        }
        return j(404, { error: { message: 'no such api' } });
      }
      j(404, { message: 'not found' });
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    ok({ url, st, close: () => new Promise((r) => server.close(() => r())), keyOf });
  }));
}

module.exports = { start };
