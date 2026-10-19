// 中转站对账逻辑验收（纯 Node，不联网）：node test/reconcile-logic.cjs
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Ledger } = require('../electron/ledger.cjs');
const { Reconciler, toCny } = require('../electron/reconcile.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-rec-'));
const L = new Ledger(dir);
const now = Date.now();
// 两笔课上调用（带请求 ID）、一笔没有 ID 的、一笔后台任务
const a = L.record({ feature: '讲题', model: 'gpt-6.1-sol', usage: { input: 1399, output: 4426 }, rid: 'RID-A' });
const b = L.record({ feature: '问一问', model: 'gpt-6.1-sol', usage: { input: 1448, output: 1030 }, rid: 'RID-B' });
const c = L.record({ feature: '旧网关', model: 'gpt-6.1-sol', usage: { input: 100, output: 100 } });
const t = L.record({ source: 'task', feature: 'Codex CLI', model: 'gpt-6-astra', usage: { input: 20000, cached: 50000, output: 3000 }, taskId: 'task1', from: now - 600e3 });
t.at = now - 200e3; // 这一轮 200 秒前结束
const est0 = L.spent().day;
assert.ok(a.cny > 0.05, 'estimate with default prices is high: ' + a.cny);

const site = { success: true, data: { system_name: '银子 API', quota_display_type: 'CNY', quota_per_unit: 500000, usd_exchange_rate: 1 } };
const logs = [
  { type: 2, created_at: Math.floor(now / 1000), request_id: 'RID-A', model_name: 'gpt-6.1-sol', quota: 6353, prompt_tokens: 1399, completion_tokens: 4426 },
  { type: 2, created_at: Math.floor(now / 1000), request_id: 'RID-B', model_name: 'gpt-6.1-sol', quota: 1781, prompt_tokens: 1448, completion_tokens: 1030 },
  // 后台任务那一轮：两次请求，token 合计和账本接近
  { type: 2, created_at: Math.floor((now - 500e3) / 1000), request_id: 'T1', model_name: 'gpt-6-astra', quota: 20000, prompt_tokens: 40000, completion_tokens: 1500 },
  { type: 2, created_at: Math.floor((now - 300e3) / 1000), request_id: 'T2', model_name: 'gpt-6-astra', quota: 15000, prompt_tokens: 30000, completion_tokens: 1500 },
  // 同一时间段别的模型：不能算进任务
  { type: 2, created_at: Math.floor((now - 400e3) / 1000), request_id: 'X1', model_name: 'claude-opus-5-5', quota: 99999, prompt_tokens: 10, completion_tokens: 10 },
  { type: 5, created_at: Math.floor(now / 1000), request_id: 'ERR', model_name: 'gpt-6.1-sol', quota: 0 },
];
let calls = [];
const fetchImpl = async (url, init) => {
  calls.push(url);
  const body = url.endsWith('/api/status') ? site : url.endsWith('/api/log/token') ? (init.headers.authorization === 'Bearer sk-test' ? { success: true, data: logs } : { success: false, message: 'Token not provided' }) : {};
  return { status: 200, ok: true, text: async () => JSON.stringify(body) };
};
const events = [];
const R = new Reconciler({ ledger: L, credentials: () => ({ baseUrl: 'https://relay.example/v1', key: 'sk-test' }), fetchImpl, emit: (m) => events.push(m) });

(async () => {
  const s = await R.sync({ force: true });
  assert.equal(calls.filter((u) => u.endsWith('/api/log/token')).length, 1);
  assert.equal(+a.real.toFixed(6), +toCny(6353, { type: 'CNY', perUnit: 500000, rate: 1 }).toFixed(6));
  assert.equal(+a.real.toFixed(5), 0.01271);
  assert.equal(+b.real.toFixed(5), 0.00356);
  assert.ok(!Number.isFinite(c.real), 'no request id → stays estimated');
  assert.equal(+t.real.toFixed(4), 0.07, 'task matched by time window + model, other model excluded');
  assert.equal(s.matched, 3); assert.equal(s.pending, 1);
  assert.ok(L.spent().day < est0 / 3, 'day total now uses real cost: ' + L.spent().day + ' vs ' + est0);
  assert.equal(L.taskTotal('task1'), t.real);
  // 倍率按实扣、按模型分别重新算
  const mf = L.budget.modelFactors;
  assert.ok(mf['gpt-6.1-sol'] && mf['gpt-6.1-sol'].f < 0.5 && mf['gpt-6.1-sol'].n === 2 && mf['gpt-6-astra'].n === 1, JSON.stringify(mf));
  const next = L.record({ feature: '讲题', model: 'gpt-6.1-sol', usage: { input: 1399, output: 4426 } });
  assert.ok(Math.abs(next.cny - 0.01271) / 0.01271 < 0.2, 'new estimates use the calibrated factor: ' + next.cny);
  assert.ok(L.factorFor('unknown-model') === L.factor(), 'other models use the overall factor');
  assert.deepEqual(events.at(-1).tasks, ['task1']);
  // 结果持久化：重新打开账本还在
  const L2 = new Ledger(dir);
  assert.equal(+L2.entries.find((e) => e.id === a.id).real.toFixed(5), 0.01271);
  assert.equal(L2.summary().reconcile.matched, 3);
  // 再对一次不会重复认领
  calls = [];
  const s2 = await R.sync({ force: true });
  assert.equal(s2.matched, 3);
  // 站点不支持时：记下原因，继续用估算
  const L3 = new Ledger(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-rec-')));
  L3.record({ feature: 'x', model: 'm', usage: { input: 10, output: 10 }, rid: 'Z' });
  const R3 = new Reconciler({ ledger: L3, credentials: () => ({ baseUrl: 'https://other.example/v1', key: 'sk-test' }), fetchImpl: async (url) => ({ status: url.endsWith('/api/status') ? 200 : 404, ok: url.endsWith('/api/status'), text: async () => (url.endsWith('/api/status') ? '{"data":{}}' : 'not found') }) });
  const s3 = await R3.sync({ force: true });
  assert.match(s3.error, /不支持/); assert.equal(s3.matched, 0); assert.equal(L3.real.site.supported, false);
  // 关掉自动对账后 soon() 不排队
  L.setBudget({ reconcile: false }); R.soon(1); assert.equal(R.timer, null);
  console.log('reconcile-logic: 14 checks OK');
})().catch((e) => { console.error(e); process.exit(1); });
