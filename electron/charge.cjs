'use strict';
// 玲珑账号的价格板、单次报价和收费闸（照搬玲珑工坊 0.7.0 的 commerce-board / commerce-offer / commerce-gate）。
// 玲珑商业账号画图必须先报价：主进程用登录会话问站点这一张多少钱，老师确认后，用同一把 Key 带 X-Parameter-Quote 提交；
// 不带报价站点会回 400 quote_required，不扣钱。普通账号、合作站账号、第三方 Key 照旧，不报价、不弹框。
// 软件里会画图的地方（工坊配图、课堂动画配图、课件插图）都走 ai.cjs 的 image()，闸就装在那一处。

// ── 价格板 ───────────────────────────────────────────
const TIER_IDS = ['save', 'balanced', 'quality'];
const TIER_NAMES = { save: '省钱优先', balanced: '均衡', quality: '质量优先' };
const KINDS = ['text', 'image'];
const UNITS = { text: ['per_1m_tokens'], image: ['per_image', 'per_request'] };
const NOTICE = '仅估算，以实际账单为准';
const NOT_LIVE = '价格板还没开通：站点上线玲珑账号以后这里会自动显示，不用更新软件';
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function cleanItem(it, kind) {
  const model = txt(it?.model, 120);
  if (!model || /^sk-/i.test(model)) return null;
  const out = { model, configured: it.configured === true };
  const priced = kind === 'text' ? pos(it.input_cny) && pos(it.output_cny) : pos(it.min_cny) && pos(it.max_cny) && it.min_cny <= it.max_cny;
  // 没有能用的数就写「暂无报价」，绝不显示 0 元或自己编一个
  if (it.available !== true || !UNITS[kind].includes(it.unit) || !priced) return { ...out, available: false, message: txt(it.message, 80) };
  Object.assign(out, { available: true, unit: it.unit });
  return kind === 'text' ? Object.assign(out, { input_cny: it.input_cny, output_cny: it.output_cny }) : Object.assign(out, { min_cny: it.min_cny, max_cny: it.max_cny });
}

/** 站点的价格板 → 界面用的样子。只留白名单字段：分组、倍率、原价、加价一律过不去 */
function normalizeBoard(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tiers)) return { ready: false, reason: '站点返回的价格板不完整' };
  const tiers = TIER_IDS.map((id) => {
    const t = data.tiers.find((x) => x?.id === id) || {};
    const sections = KINDS.map((kind) => {
      const sec = (Array.isArray(t.sections) ? t.sections : []).find((x) => x?.kind === kind) || {};
      const seen = new Set();
      const items = (Array.isArray(sec.items) ? sec.items : []).map((it) => cleanItem(it, kind)).filter((it) => it && !seen.has(it.model) && seen.add(it.model));
      const ordered = [...items.filter((i) => i.configured), ...items.filter((i) => !i.configured)].slice(0, 60);
      return { kind, items: ordered, ...(ordered.some((i) => i.available) ? {} : { none: txt(sec.message, 80) || '这个档位现在没有能用的线路' }) };
    });
    return { id, name: TIER_NAMES[id], sections };
  });
  return { ready: true, revision: txt(data.revision, 80), notice: /仅估算/.test(String(data.notice || '')) ? txt(data.notice, 60) : NOTICE, tiers };
}

async function fetchBoard(account, { configured = {}, last = null } = {}) {
  try {
    if (account.kind !== 'linglong') return { ready: false, reason: '价格板只对玲珑账号开放' };
    const caps = await account.appCaps();
    if (!caps?.price_board) return { ready: false, reason: NOT_LIVE };
    if (!account.state.keyId) return { ready: false, reason: '还没有软件专用的 Key，请点「重新连接」' };
    const q = new URLSearchParams({ token_id: String(account.state.keyId) });
    for (const k of KINDS) if (configured[k]?.length) q.set(`configured.${k}`, configured[k].join(','));
    const r = await account.req('GET', `/api/app/v1/price-board?${q}`, { headers: last?.ready && last.revision ? { 'If-None-Match': `"${last.revision}"` } : undefined });
    if (r.notModified && last?.ready) return last;
    return normalizeBoard(r.json?.data);
  } catch (e) { return { ready: false, reason: e?.code === 'http' ? NOT_LIVE : txt(e?.message || '读取价格板失败', 120) }; }
}

// ── 单次报价 ─────────────────────────────────────────
const OFFER_UNITS = ['per_image', 'per_request', 'per_second'];
const pos0 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const int = (v) => Number.isSafeInteger(v) && v >= 0;
function normalizeOffer(o, quoteId) {
  if (!o || typeof o !== 'object' || !int(o.payable_quota) || !pos0(o.payable_cny) || typeof o.payable_exact !== 'boolean') return null;
  if (!OFFER_UNITS.includes(o.unit) || !(Number.isInteger(o.units) && o.units > 0) || !Number.isSafeInteger(o.expires_at_sec) || o.expires_at_sec <= 0) return null;
  const out = { quoteId: String(quoteId || ''), payableCny: o.payable_cny, exact: o.payable_exact, unit: o.unit, units: o.units, expiresAt: o.expires_at_sec * 1000 };
  if (!o.payable_exact) {
    if (!int(o.payable_min_quota) || o.payable_min_quota > o.payable_quota || !pos0(o.payable_min_cny)) return null;
    out.minCny = o.payable_min_cny;
  }
  return out.quoteId ? out : null;
}
async function requestOffer(account, { mode, fields }) {
  const tokenId = account.state.keyId;
  if (!tokenId) return { ok: false, reason: '还没有软件专用的 Key，请在账号页点「重新连接」' };
  let json;
  try { ({ json } = await account.req('POST', `/api/media/parameter-quote?token_id=${encodeURIComponent(String(tokenId))}`, { body: { mode: String(mode || 'images'), group: '', fields: fields || {} } })); }
  catch (e) { return { ok: false, reason: `没拿到报价，这次先不画：${txt(e?.message, 120)}` }; }
  if (json?.data?.supported === false) return { ok: false, unsupported: true, reason: '这个模型没有单次报价' };
  const offer = normalizeOffer(json?.data?.offer, json?.data?.quote_id);
  return offer ? { ok: true, offer } : { ok: false, reason: '网站给的报价不完整，这次先不画' };
}
/** 站点拒绝提交的原因：409 价格变了 / 400 没报价 / 503 维护；别的返回 null */
function refusal(status, text) {
  let j = null; try { j = JSON.parse(String(text || '')); } catch { j = null; }
  const code = j?.code || j?.error?.code || '';
  if (status === 409 && (code === 'price_changed' || !code)) return 'price_changed';
  if (status === 400 && code === 'quote_required') return 'quote_required';
  if (status === 503 && code === 'commercial_paused') return 'paused';
  return null;
}
const offerLive = (offer, now = Date.now()) => !!offer?.quoteId && offer.expiresAt > now;

class GateError extends Error { constructor(message, code) { super(message); this.code = code; } }

// ── 收费闸 ───────────────────────────────────────────
const MAX_ROUNDS = 3;
class ChargeGate {
  /**
   * @param {{account: any, confirm: {ask(item: any): Promise<{yes: boolean, reason?: string}>}, preauth?: (item: any) => {note?: (cny: number) => void} | null, log?: any, now?: () => number}} o
   * preauth：工坊任务自己的花费上限（开工时老师定的），装得下就不再弹框，钱记进任务账
   */
  constructor(o) { this.account = o.account; this.confirm = o.confirm; this.preauth = o.preauth || (() => null); this.log = o.log; this.now = o.now || Date.now; this.who = null; }

  /** 这次画图要不要过闸：登录了玲珑账号，并且画图走的就是这个账号的站点 */
  covers(baseUrl) { return this.account?.kind === 'linglong' && this.account.ownsOrigin(baseUrl); }

  async commercial() {
    const uid = this.account.state?.userId;
    if (this.who?.uid === uid) return this.who.v;
    let v = true;
    // 读不到就当商业账号：宁可报价，也不裸提交
    try { v = (await this.account.self()).commercial === true; } catch { v = true; }
    this.who = { uid, v };
    return v;
  }

  async approve(item, raised = false) {
    const pre = this.preauth(item);
    if (pre) return { yes: true, cny: item.offer.payableCny, via: 'cap', note: pre.note };
    const r = await this.confirm.ask({ ...item, raised });
    return { ...r, cny: item.offer.payableCny, via: 'user' };
  }

  /**
   * 过闸提交一次。send(headers) 真正发出，返回 {status, text, value}；拒绝时抛 GateError（没提交，没扣费）。
   * @returns {Promise<{value: any, cny: number|null, via: string}>}
   */
  async run({ mode = 'images', fields, ctx }, send) {
    if (!(await this.commercial())) {
      const r = await send({});
      if (refusal(r.status, r.text) !== 'quote_required') return { value: r, cny: null, via: 'plain' };
      this.who = { uid: this.account.state?.userId, v: true };
    }
    const caps = await this.account.appCaps();
    if (!caps?.commercial_quote) throw new GateError('玲珑账号暂时不能画图（站点还没开放画图报价），这次没有提交，没有扣费', 'quote_unavailable');
    const ask = () => requestOffer(this.account, { mode, fields });
    const fail = (q) => new GateError(q.unsupported ? `「${fields.model || ''}」没有单次报价，玲珑账号暂时不能用它画图，换一个画图模型试试；没有扣费` : q.reason, q.unsupported ? 'quote_unsupported' : 'quote_failed');
    let q = await ask();
    if (!q.ok) throw fail(q);
    const item = { mode, model: String(fields.model || ''), offer: q.offer, ctx: ctx || null };
    let ok = await this.approve(item);
    for (let round = 0; ; round += 1) {
      if (!ok.yes) throw new GateError(ok.reason || '没有确认价格，这次没有画，没有扣费', 'quote_declined');
      if (offerLive(item.offer, this.now())) {
        const r = await send({ 'X-Parameter-Quote': item.offer.quoteId });
        const why = r.status >= 400 ? refusal(r.status, r.text) : null;
        if (why === 'paused') throw new GateError('玲珑账号的收费功能临时维护，这次没有扣费，请稍后再试', 'paused');
        if (why !== 'price_changed' || round >= MAX_ROUNDS) {
          if (r.status < 400) ok.note?.(item.offer.payableCny);
          this.log?.info?.('收费闸', mode, item.model, r.status, '¥' + item.offer.payableCny, ok.via);
          return { value: r, cny: r.status < 400 ? item.offer.payableCny : null, via: ok.via };
        }
      }
      q = await ask();
      if (!q.ok) throw fail(q);
      item.offer = q.offer;
      // 新价不高于已经同意的：直接用新报价发；更贵才再问一次
      if (q.offer.payableCny > ok.cny) ok = await this.approve(item, true);
    }
  }
}

/** 等老师确认的报价：同时到的几张合成一个对话框（「这批共 ¥x，N 张」），一次回答管全部；报价过期还没答就当没同意 */
class PriceConfirm {
  constructor({ emit, now = Date.now }) { this.emit = emit; this.now = now; this.open = null; this.n = 0; }
  view(b) {
    const items = b.items.map((x) => ({ mode: x.mode, model: x.model, cny: x.offer.payableCny, exact: x.offer.exact, minCny: x.offer.minCny ?? null, units: x.offer.units, raised: !!x.raised, feature: x.ctx?.feature || '' }));
    return { id: b.id, items, totalCny: Math.round(items.reduce((a, x) => a + x.cny, 0) * 1e4) / 1e4, count: items.reduce((a, x) => a + x.units, 0), exact: items.every((x) => x.exact), expiresAt: b.expiresAt };
  }
  ask(item) {
    return new Promise((resolve) => {
      if (!this.open) this.open = { id: `pc-${this.now().toString(36)}-${++this.n}`, items: [], waiters: [], expiresAt: Infinity, timer: null };
      const b = this.open;
      b.items.push(item); b.waiters.push(resolve);
      if (item.offer.expiresAt < b.expiresAt) {
        b.expiresAt = item.offer.expiresAt; clearTimeout(b.timer);
        b.timer = setTimeout(() => this.answer(b.id, false, '报价过期了还没确认，这次没有画，没有扣费'), Math.max(0, b.expiresAt - this.now()));
      }
      this.emit({ confirm: this.view(b) });
    });
  }
  answer(id, yes, reason) {
    const b = this.open;
    if (!b || b.id !== id) return false;
    this.open = null; clearTimeout(b.timer);
    for (const w of b.waiters) w(yes ? { yes: true } : { yes: false, reason: reason || '没有确认价格，这次没有画，没有扣费' });
    this.emit({ confirm: null, closed: id });
    return true;
  }
  pending() { return this.open ? this.view(this.open) : null; }
}

/** 工坊任务的长期授权：报价加上任务已经花的钱不超过任务上限（也不超过每月上限），就不弹框，记进任务账 */
function taskPreauth({ agents, ledger, now = Date.now }) {
  return (item) => {
    const id = item?.ctx?.taskId, a = typeof agents === 'function' ? agents() : agents;
    const t = id && a?.tasks?.get?.(id), cny = Number(item?.offer?.payableCny);
    if (!t || !(cny >= 0) || !(Number(t.cap) > 0)) return null;
    if (Number(t.cny || 0) + cny > Number(t.cap)) return null;
    const month = Number(ledger?.budget?.caps?.month);
    if (month > 0 && Number(ledger.spent?.(now())?.month || 0) + cny > month) return null;
    return { note: () => {} };
  };
}

module.exports = { normalizeBoard, fetchBoard, normalizeOffer, requestOffer, refusal, offerLive, ChargeGate, PriceConfirm, GateError, taskPreauth, TIER_NAMES, NOTICE, NOT_LIVE };
