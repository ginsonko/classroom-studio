'use strict';
// 中转站对账：用 Key 读站点上这个 Key 最近的真实扣费记录（new-api 的 GET /api/log/token，只读、不扣费），
// 逐笔对上账本：课上 AI 调用按请求 ID（响应头 X-Oneapi-Request-Id）对；后台任务按运行时间段 + 模型对。
// 对上的记录以实扣为准，并按实扣 ÷ 官方价重新算各模型的倍率，让以后的本地估算更准。
// 站点不支持时安静地退回估算，不影响上课。

const MIN_GAP = 15000;          // 两次对账至少间隔
const SOON = 20000;             // AI 调用后多久去对账（站点写日志有延迟）
const RETRY_UNSUPPORTED = 6 * 3600e3;
const GIVE_UP = 3 * 3600e3;     // 超过这么久、站点日志又已经覆盖到这个时间还找不到，就算对不上

function toCny(quota, site, usdRate) {
  const q = Number(quota) || 0, per = Number(site?.perUnit) || 500000;
  const units = q / per;
  if (site?.type === 'CNY') return units * (Number(site.rate) || 1);
  if (site?.type === 'CUSTOM') return units * (Number(site.custom) || 1);
  return units * (Number(usdRate) || 7.2);
}

/** 站点日志里的总 token 数（prompt 含缓存） */
const logTokens = (l) => (Number(l.prompt_tokens) || 0) + (Number(l.completion_tokens) || 0);

class Reconciler {
  constructor({ ledger, credentials, log, emit, fetchImpl }) {
    this.ledger = ledger;
    this.credentials = credentials;
    this.log = log;
    this.emit = emit || (() => {});
    this.fetch = fetchImpl || globalThis.fetch;
    this.timer = null; this.busy = null; this.last = 0; this.tick = null;
  }

  get enabled() { return this.ledger.budget.reconcile !== false; }

  /** AI 调用记账后调用：过一会儿去对账 */
  soon(ms = SOON) {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.sync().catch(() => {}); }, ms);
  }

  start() {
    this.soon(8000);
    clearInterval(this.tick);
    // 还有没对上的记录时每 10 分钟再看一次
    this.tick = setInterval(() => { if (this.enabled && this.ledger.reconcileStats().pending) void this.sync().catch(() => {}); }, 600e3);
  }
  stop() { clearTimeout(this.timer); clearInterval(this.tick); }

  async getJson(url, headers = {}) {
    const r = await this.fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* 不是 JSON */ }
    return { status: r.status, ok: r.ok, j };
  }

  /** 站点计价单位（/api/status 是公开接口），一天读一次 */
  async site(origin) {
    const s = this.ledger.real.site;
    if (s && s.origin === origin && Date.now() - (s.at || 0) < 86400e3) return s;
    const { j } = await this.getJson(origin + '/api/status');
    const d = j?.data || {};
    const site = { origin, at: Date.now(), name: String(d.system_name || '').slice(0, 40), type: String(d.quota_display_type || (d.display_in_currency ? 'USD' : 'TOKENS')).toUpperCase(), perUnit: Number(d.quota_per_unit) || 500000, rate: Number(d.usd_exchange_rate) || 1, custom: Number(d.custom_currency_exchange_rate) || 1, supported: s?.origin === origin ? s.supported : undefined };
    this.ledger.real.site = site;
    return site;
  }

  async sync({ force = false } = {}) {
    if (this.busy) return this.busy;
    if (!force && Date.now() - this.last < MIN_GAP) return this.ledger.reconcileStats();
    this.busy = this.run(force).finally(() => { this.busy = null; this.last = Date.now(); });
    return this.busy;
  }

  async run(force) {
    const L = this.ledger, R = L.real;
    const c = this.credentials();
    if (!c?.key) { R.error = '还没有填写 API Key'; return L.reconcileStats(); }
    let origin; try { origin = new URL(c.baseUrl).origin; } catch { R.error = '接口地址不对'; return L.reconcileStats(); }
    const prev = R.site;
    if (!force && prev?.origin === origin && prev.supported === false && Date.now() - (prev.at || 0) < RETRY_UNSUPPORTED) return L.reconcileStats();
    let site;
    try { site = await this.site(origin); } catch (e) { R.error = '连不上中转站：' + e.message; L.saveReal(); return L.reconcileStats(); }
    let res;
    try { res = await this.getJson(origin + '/api/log/token', { authorization: 'Bearer ' + c.key }); }
    catch (e) { R.error = '读取消费记录失败：' + e.message; L.saveReal(); return L.reconcileStats(); }
    if (!res.ok || res.j?.success === false || !Array.isArray(res.j?.data)) {
      site.supported = false; site.at = Date.now();
      R.error = res.status === 404 ? '这个中转站还不支持按 Key 查询消费记录，继续用估算' : '中转站没有返回消费记录（' + res.status + (res.j?.message ? '，' + String(res.j.message).slice(0, 80) : '') + '），继续用估算';
      L.saveReal(); this.emit({ type: 'ledger' });
      return L.reconcileStats();
    }
    site.supported = true; R.error = '';
    const logs = res.j.data.filter((l) => Number(l.type) === 2 && l.created_at);
    const r = this.match(logs, site);
    R.lastSync = Date.now();
    if (r.changed) L.recalibrate();
    L.saveReal();
    if (r.changed) this.log?.info('对账', `新对上 ${r.changed} 笔，实扣合计 ¥${r.sum.toFixed(4)}`);
    this.emit({ type: 'ledger', changed: r.changed, tasks: [...r.tasks] });
    return L.reconcileStats();
  }

  /** 把站点日志对到账本记录上；返回新对上的笔数 */
  match(logs, site) {
    const L = this.ledger, R = L.real, usdRate = L.budget.usdRate;
    const byRid = new Map();
    for (const l of logs) for (const id of [l.request_id, l.upstream_request_id]) if (id) byRid.set(String(id), l);
    const claimed = new Set(R.claimed || []);
    for (const e of L.entries) if (e.rid && Number.isFinite(e.real)) claimed.add(e.rid);
    const oldest = logs.reduce((m, l) => Math.min(m, l.created_at * 1000), Infinity);
    let changed = 0, sum = 0;
    const tasks = new Set();
    // 1) 课上 AI 调用：按请求 ID
    for (const e of L.entries) {
      if (!e.rid || Number.isFinite(e.real) || e.miss) continue;
      const l = byRid.get(e.rid);
      if (l) {
        const cny = toCny(l.quota, site, usdRate);
        L.setReal(e, cny, { quota: Number(l.quota) || 0, n: 1 });
        claimed.add(String(l.request_id)); changed += 1; sum += cny;
      } else if (Date.now() - e.at > GIVE_UP && oldest < e.at - 60000) L.setReal(e, null);
    }
    // 2) 后台任务：这一轮运行时间段内、同模型、还没被别的记录认领的日志；token 数要大致对得上，避免把别的软件用同一个 Key 的消费算进来
    for (const e of L.entries) {
      if (e.source !== 'task' || Number.isFinite(e.real) || e.miss || !e.from) continue;
      const from = e.from - 5000, to = e.at + 90000;
      if (Date.now() < to) continue; // 等这一轮的日志都写进来
      const model = String(e.model || '').toLowerCase();
      const hit = logs.filter((l) => {
        const t = l.created_at * 1000;
        return t >= from && t <= to && !claimed.has(String(l.request_id)) && (!model || String(l.model_name || '').toLowerCase() === model || model.includes(String(l.model_name || '').toLowerCase()));
      });
      const mine = e.input + e.cached + e.output, theirs = hit.reduce((a, l) => a + logTokens(l), 0);
      if (hit.length && mine > 0 && theirs / mine > 0.5 && theirs / mine < 2) {
        const cny = hit.reduce((a, l) => a + toCny(l.quota, site, usdRate), 0);
        L.setReal(e, cny, { quota: hit.reduce((a, l) => a + (Number(l.quota) || 0), 0), n: hit.length });
        for (const l of hit) claimed.add(String(l.request_id));
        changed += 1; sum += cny; tasks.add(e.taskId);
      } else if (Date.now() - e.at > GIVE_UP && oldest < from) L.setReal(e, null);
    }
    // 认领表只留站点日志里还能看到的，免得越存越大
    const visible = new Set(logs.map((l) => String(l.request_id)));
    R.claimed = [...claimed].filter((id) => visible.has(id)).slice(-3000);
    return { changed, sum, tasks };
  }
}

module.exports = { Reconciler, toCny };
