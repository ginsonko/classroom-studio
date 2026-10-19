'use strict';
// AI 账本：所有 AI 花费（课上直接调用 + 后台智能体任务）记在同一本账上，按价格表折成人民币，
// 并执行"单任务 / 每天 / 每月"三层上限。token 数是可靠的；金额是按价格表的估算，以中转站实际扣费为准。
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BUDGET = {
  caps: { task: 5, day: 20, month: 200 },          // 元
  warnAt: 0.8,
  usdRate: 7.2,                                     // Claude Code 只给美元估算时用来换算
  // 中转站倍率：按官方价估算后再乘这个数。中转站常有折扣，老师可以用「按实际扣费校准」自动算出来。
  factor: 1,
  // 每百万 token 的官方价（元，按 7.2 汇率折算）。模型名包含左边的文字就用这一行，越长越优先；'*' 是兜底价。
  prices: {
    '*': { input: 9, cached: 0.9, output: 72 },
    'gpt-5': { input: 9, cached: 0.9, output: 72 },
    'gpt-5-mini': { input: 1.8, cached: 0.18, output: 14.4 },
    'gpt-5-nano': { input: 0.36, cached: 0.04, output: 2.9 },
    'gpt-4.1': { input: 14.4, cached: 3.6, output: 57.6 },
    'gpt-4o': { input: 18, cached: 9, output: 72 },
    'gpt-4o-mini': { input: 1.1, cached: 0.54, output: 4.3 },
    'claude-sonnet': { input: 21.6, cached: 2.16, output: 108 },
    'claude-opus': { input: 36, cached: 3.6, output: 180 },
    'claude-haiku': { input: 7.2, cached: 0.72, output: 36 },
    'gemini-2.5-pro': { input: 9, cached: 2.25, output: 72 },
    'gemini-2.5-flash': { input: 2.2, cached: 0.54, output: 18 },
    'deepseek': { input: 2, cached: 0.2, output: 3 },
    'qwen': { input: 2.4, cached: 0.6, output: 9.6 },
    'kimi': { input: 4, cached: 1, output: 16 },
    'glm': { input: 4, cached: 0.8, output: 16 },
  },
};
const crypto = require('node:crypto');
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = (t) => dayOf(t).slice(0, 7);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

class Ledger {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'ai-ledger.jsonl');
    this.cfgFile = path.join(dir, 'ai-budget.json');
    this.realFile = path.join(dir, 'ai-real.json');
    this.entries = [];
    this.budget = structuredClone(DEFAULT_BUDGET);
    // 中转站对账结果：账本是只追加的 JSONL，实扣金额单独存，读账时覆盖到对应记录上
    this.real = { byKey: {}, claimed: [], lastSync: 0, site: null };
    try { this.real = { ...this.real, ...JSON.parse(fs.readFileSync(this.realFile, 'utf8')) }; } catch { /* 还没对过账 */ }
    try {
      const b = JSON.parse(fs.readFileSync(this.cfgFile, 'utf8'));
      // 0.4.0 默认的兜底价 20/5/80 明显偏高；老师没改过就换成新的默认值
      if (b.prices?.['*'] && b.prices['*'].input === 20 && b.prices['*'].cached === 5 && b.prices['*'].output === 80) delete b.prices['*'];
      this.budget = { ...this.budget, ...b, caps: { ...this.budget.caps, ...b.caps }, prices: { ...this.budget.prices, ...b.prices } };
    } catch { /* 首次使用 */ }
    try {
      const month = monthOf(Date.now());
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); if (monthOf(e.at) === month) this.entries.push(e); } catch { /* 跳过坏行 */ }
      }
    } catch { /* 还没有账 */ }
    for (const e of this.entries) this.overlay(e);
  }

  /** 记录的对账键：0.9 起每笔都有 id，旧记录用时间戳 */
  keyOf(e) { return e.id || String(e.at); }
  overlay(e) {
    const r = this.real.byKey[this.keyOf(e)];
    if (r && Number.isFinite(r.cny)) { e.real = r.cny; e.realQuota = r.quota; e.realN = r.n; } else { delete e.real; }
    if (r?.miss) e.miss = true;
  }
  /** 实际计入合计的金额：对上账的用中转站实扣，否则用估算 */
  eff(e) { return Number.isFinite(e.real) ? e.real : e.cny; }
  saveReal() {
    try { fs.mkdirSync(this.dir, { recursive: true }); const tmp = this.realFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.real)); fs.renameSync(tmp, this.realFile); } catch { /* 对账结果下次还能再算 */ }
  }
  /** 对账：把实扣金额写到记录上（cny = null 表示站点上找不到这笔，不再反复找） */
  setReal(e, cny, extra = {}) {
    const k = this.keyOf(e);
    this.real.byKey[k] = cny === null ? { miss: true, at: e.at } : { cny: Math.round(cny * 1e6) / 1e6, at: e.at, ...extra };
    this.overlay(e);
  }
  /** 官方价估算（去掉当时的倍率），用来算倍率 */
  official(e) { return e.f > 0 ? e.cny / e.f : this.cost(e.model, e) / this.factorFor(e.model); }

  /** 按已对上账的记录重新算各模型的倍率：倍率 = 实扣 ÷ 官方价估算 */
  recalibrate() {
    const by = {};
    let real = 0, off = 0;
    for (const e of this.entries) {
      if (!Number.isFinite(e.real) || e.source === 'adjust') continue;
      const o = this.official(e); if (!(o > 0)) continue;
      const m = String(e.model || '').toLowerCase();
      by[m] ??= { real: 0, off: 0, n: 0 }; by[m].real += e.real; by[m].off += o; by[m].n += 1;
      real += e.real; off += o;
    }
    const mf = {};
    for (const [m, v] of Object.entries(by)) if (v.off > 0.0002) mf[m] = { f: Math.min(10, Math.max(0.001, v.real / v.off)), n: v.n };
    this.budget.modelFactors = mf;
    if (off > 0.0002) this.budget.factor = Math.min(10, Math.max(0.001, real / off));
    try { fs.writeFileSync(this.cfgFile, JSON.stringify(this.budget, null, 2)); } catch { /* 下次再存 */ }
    return { factor: this.factor(), modelFactors: mf };
  }

  /** 价格表里匹配到的那一行（模型名包含它，越长越优先；都不匹配是 '*'） */
  priceKey(model) {
    const p = this.budget.prices, m = String(model || '').toLowerCase();
    return Object.keys(p).filter((k) => k !== '*' && m.includes(k.toLowerCase())).sort((a, b) => b.length - a.length)[0] ?? '*';
  }
  price(model) { return this.budget.prices[this.priceKey(model)] ?? DEFAULT_BUDGET.prices['*']; }

  /** usage 统一为 { input（不含缓存命中）, cached, output }；已乘中转站倍率 */
  cost(model, u) {
    const p = this.price(model);
    return (num(u.input) * p.input + num(u.cached) * p.cached + num(u.output) * p.output) / 1e6 * this.factorFor(model);
  }

  factor() { const f = Number(this.budget.factor); return Number.isFinite(f) && f > 0 ? f : 1; }
  /** 这个模型的倍率：对账算出过这个模型的就用它自己的（同一价格行里的模型实际价差很大），否则用总倍率 */
  factorFor(model) { const f = Number(this.budget.modelFactors?.[String(model || '').toLowerCase()]?.f); return Number.isFinite(f) && f > 0 ? f : this.factor(); }

  record({ source = 'chat', feature = '', model = '', usage = {}, cny, taskId, student, rid, from } = {}) {
    const u = { input: num(usage.input), cached: num(usage.cached), output: num(usage.output) };
    const e = { id: crypto.randomBytes(5).toString('hex'), at: Date.now(), source, feature: String(feature).slice(0, 40), model: String(model).slice(0, 80), ...u, cny: Number.isFinite(cny) ? cny : this.cost(model, u), f: this.factorFor(model), ...(taskId ? { taskId } : {}), ...(student ? { student } : {}), ...(rid ? { rid: String(rid).slice(0, 80) } : {}), ...(from ? { from } : {}) };
    e.cny = Math.round(e.cny * 1e5) / 1e5;
    if (monthOf(e.at) !== monthOf(this.entries[0]?.at ?? e.at)) this.entries = [];
    this.entries.push(e);
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); } catch { /* 记账失败不影响上课 */ }
    return e;
  }

  spent(now = Date.now()) {
    const d = dayOf(now), m = monthOf(now);
    let day = 0, month = 0;
    for (const e of this.entries) { if (monthOf(e.at) === m) { const c = this.eff(e); month += c; if (dayOf(e.at) === d) day += c; } }
    return { day, month };
  }

  /** 还能花多少（元）；任何一层到顶都返回 0 */
  room(now = Date.now()) {
    const s = this.spent(now), c = this.budget.caps;
    return Math.max(0, Math.min(c.day - s.day, c.month - s.month));
  }

  /** 发起一次 AI 调用前检查；超额直接拒绝 */
  check(now = Date.now()) {
    const s = this.spent(now), c = this.budget.caps;
    if (s.day >= c.day) throw new Error(`今天的 AI 花费已到上限（约 ¥${s.day.toFixed(2)} / ¥${c.day}）。可以在「AI 账本」里调高上限。`);
    if (s.month >= c.month) throw new Error(`本月的 AI 花费已到上限（约 ¥${s.month.toFixed(2)} / ¥${c.month}）。可以在「AI 账本」里调高上限。`);
  }

  summary(now = Date.now()) {
    const s = this.spent(now), c = this.budget.caps, d = dayOf(now);
    const byFeature = {};
    for (const e of this.entries) if (dayOf(e.at) === d) { const k = e.source === 'task' || (e.source === 'adjust' && e.taskId) ? '后台任务' : e.feature || '其他'; byFeature[k] = (byFeature[k] ?? 0) + this.eff(e); }
    const tokens = this.entries.filter((e) => dayOf(e.at) === d).reduce((a, e) => a + e.input + e.cached + e.output, 0);
    const recent = this.entries.slice(-40).reverse().map(({ f, ...e }) => e);
    return { ...s, caps: c, warnAt: this.budget.warnAt, usdRate: this.budget.usdRate, factor: this.factor(), modelFactors: this.budget.modelFactors ?? {}, prices: this.budget.prices, byFeature, tokensToday: tokens, recent, reconcile: this.reconcileStats() };
  }

  /** 本月对账情况：多少笔对上了、估算和实扣各是多少 */
  reconcileStats() {
    let matched = 0, pending = 0, missed = 0, est = 0, real = 0;
    for (const e of this.entries) {
      if (e.source === 'adjust') continue;
      if (Number.isFinite(e.real)) { matched += 1; est += e.cny; real += e.real; } else if (e.miss) missed += 1; else pending += 1;
    }
    return { auto: this.budget.reconcile !== false, matched, pending, missed, est, real, lastSync: this.real.lastSync || 0, site: this.real.site || null, error: this.real.error || '' };
  }

  /**
   * 老师填入中转站显示的这个任务实际花了多少：
   * 1) 记一笔更正，让今天/本月的合计和中转站一致；2) 按比例调整倍率，以后的估算更准。
   */
  calibrate(taskId, actual) {
    const real = Number(actual);
    if (!taskId || !Number.isFinite(real) || real < 0) throw new Error('请填写实际花费（元）');
    const mine = this.entries.filter((e) => e.taskId === taskId);
    const est = mine.reduce((a, e) => a + this.eff(e), 0);
    if (!mine.length) throw new Error('本月账本里没有这个任务的记录');
    // 每笔记录都带着当时的倍率，先还原成官方价，重复校准也不会越乘越偏
    // 0.4.0 的旧记录没有倍率，用当前价格表按 token 重新算官方价
    const official = mine.filter((e) => e.source !== 'adjust').reduce((a, e) => a + this.official(e), 0);
    if (official > 0 && real > 0) this.budget.factor = Math.min(10, Math.max(0.001, real / official));
    const e = { at: Date.now(), source: 'adjust', feature: '按实际扣费校准', model: '', input: 0, cached: 0, output: 0, cny: Math.round((real - est) * 1e5) / 1e5, taskId };
    this.entries.push(e);
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); fs.writeFileSync(this.cfgFile, JSON.stringify(this.budget, null, 2)); } catch { /* 记账失败不影响上课 */ }
    return { factor: this.factor(), total: real, summary: this.summary() };
  }

  /** 这个任务在本月账本里的合计（含校准更正） */
  taskTotal(taskId) { return this.entries.filter((e) => e.taskId === taskId).reduce((a, e) => a + this.eff(e), 0); }

  setBudget(v = {}) {
    const b = this.budget;
    if (v.caps) for (const k of ['task', 'day', 'month']) if (Number.isFinite(Number(v.caps[k])) && Number(v.caps[k]) >= 0) b.caps[k] = Math.min(100000, Number(v.caps[k]));
    if (Number.isFinite(Number(v.usdRate)) && Number(v.usdRate) > 0) b.usdRate = Number(v.usdRate);
    if (Number.isFinite(Number(v.factor)) && Number(v.factor) > 0 && Number(v.factor) !== b.factor) { b.factor = Math.min(10, Math.max(0.001, Number(v.factor))); b.modelFactors = {}; }
    if (typeof v.reconcile === 'boolean') b.reconcile = v.reconcile;
    if (v.prices && typeof v.prices === 'object') {
      const next = {};
      for (const [k, p] of Object.entries(v.prices).slice(0, 60)) {
        const key = String(k).trim().slice(0, 80); if (!key || !p) continue;
        next[key] = { input: num(p.input), cached: num(p.cached), output: num(p.output) };
      }
      next['*'] ??= b.prices['*'];
      b.prices = next;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.cfgFile, JSON.stringify(b, null, 2));
    return this.summary();
  }
}

module.exports = { Ledger, DEFAULT_BUDGET, dayOf, monthOf };
