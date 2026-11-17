// 1.7.0 验收：真的 codex.exe / claude 子进程、小羽内核、课堂 AI 直连，各自发出的请求头，在本机模拟服务器上抓下来核对。
// 每种情况开一个独立的模拟服务器（不同端口）：「我们站点」用 127.0.0.1（测试时当成站点域名），「第三方」用 localhost（不在站点域名表里）。
// 不联网、不发真实模型请求：子进程的配置目录都换成临时目录（CODEX_HOME / CLAUDE_CONFIG_DIR），不读老师本机的配置和 Key。
// 用法：npx electron test/quiet.cjs test/v170-real-cli-headers.cjs   结果写到 CS_TEST_OUT（默认 .out）下的 real-cli-headers.json
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const os = require('node:os');
const assert = require('node:assert/strict');
const { app } = require('electron');
const outDir = path.resolve(process.env.CS_TEST_OUT || path.join(__dirname, '../.out')); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(outDir, 'realcli-'));
// 子进程只看临时配置：不读老师本机 ~/.codex、~/.claude 里的设置、MCP、Key
for (const k of Object.keys(process.env)) if (/^(OPENAI_|ANTHROPIC_|CODEX_|CLAUDE_)/.test(k)) delete process.env[k];
process.env.CODEX_HOME = path.join(tmp, 'codex-home'); fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home'); fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'; process.env.DISABLE_AUTOUPDATER = '1'; process.env.DISABLE_TELEMETRY = '1';
const tier = require('../electron/tier.cjs');
tier.setTestHosts(['127.0.0.1']);
const VERSION = require('../package.json').version, WANT = 'classroom/' + VERSION;
const HIDE = /^(authorization|x-api-key|cookie)$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 模拟服务器：OpenAI /v1/responses（SSE）、/v1/chat/completions、/v1/models；Anthropic /v1/messages ──
function server() {
  const got = [];
  const sse = (res, events) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const [ev, d] of events) res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`); res.end(); };
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const p = new URL(req.url, 'http://x').pathname;
      got.push({ method: req.method, path: p, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HIDE.test(k))) });
      let b = {}; try { b = JSON.parse(body || '{}'); } catch { b = {}; }
      if (p.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'gpt-6-astra' }, { id: 'claude-opus-5-5' }] })); }
      if (p.endsWith('/responses')) return sse(res, [
        ['response.created', { type: 'response.created', response: { id: 'resp_1', object: 'response', status: 'in_progress', output: [] } }],
        ['response.output_item.done', { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '在线', annotations: [] }] } }],
        ['response.completed', { type: 'response.completed', response: { id: 'resp_1', object: 'response', status: 'completed', output: [], usage: { input_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 7 } } }],
      ]);
      if (p.endsWith('/messages')) {
        const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: b.model || 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } };
        if (!b.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ...msg, content: [{ type: 'text', text: '在线' }], stop_reason: 'end_turn' })); }
        return sse(res, [
          ['message_start', { type: 'message_start', message: msg }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '在线' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
          ['message_stop', { type: 'message_stop' }],
        ]);
      }
      if (p.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ model: b.model, choices: [{ message: { role: 'assistant', content: '在线' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })); }
      res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ port: srv.address().port, got, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) })));
}
const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(200); } throw new Error('等不到：' + what); };
// 只留要核对的几项：路径、来源头、档位头、谁发的（user-agent 前 40 字）
const brief = (r) => ({ path: r.path, 'x-omni-client': r.headers['x-omni-client'] || '（没有）', 'x-route-scope': r.headers['x-route-scope'] || '（没有）', 'user-agent': String(r.headers['user-agent'] || '').slice(0, 40), headers: Object.keys(r.headers).sort().join(',') });

(async () => {
  await app.whenReady();
  const results = [];
  const { Agents, locate } = require('../electron/agents.cjs');
  const { Assistant } = require('../electron/assistant.cjs');
  const bins = { codex: locate('codex', ''), claude: locate('claude', '') };
  console.log('codex =', bins.codex?.cmd, bins.codex?.version, '| claude =', bins.claude?.cmd, bins.claude?.version);
  const cases = [];
  for (const kind of ['site', 'third']) for (const who of ['工坊 Codex', '工坊 Claude Code', '小羽（Codex 内核）', '课堂 AI 直连']) cases.push({ kind, who });
  try {
    for (const c of cases) {
      const s = await server();
      const host = c.kind === 'site' ? '127.0.0.1' : 'localhost';
      const baseUrl = `http://${host}:${s.port}/v1`;
      const cred = () => ({ baseUrl, key: 'sk-test-not-real', model: c.who.includes('Claude') ? 'claude-opus-5-5' : 'gpt-6-astra' });
      const isModel = (r) => /\/(responses|messages|chat\/completions)$/.test(r.path);
      let stop = async () => {};
      try {
        if (c.who.startsWith('工坊')) {
          const engine = c.who.includes('Claude') ? 'claude' : 'codex';
          const ag = new Agents({ dir: path.join(tmp, 'agents-' + c.kind + engine), credentials: cred, log: null, tierOf: () => 'quality' });
          const t = ag.start({ engine, title: '抓请求头', prompt: '只回复两个字：在线', useStudioKey: true, permission: 'safe', cap: 1, model: cred().model });
          stop = async () => { try { ag.stop(t.id); } catch { /* 已经结束 */ } await sleep(800); };
        } else if (c.who.startsWith('小羽')) {
          const as = new Assistant({ dir: path.join(tmp, 'as-' + c.kind), credentials: cred, tierOf: () => 'balanced', log: null });
          const chat = as.create({ title: 't' });
          as.send({ id: chat.id, text: '只回复两个字：在线', studio: true }).catch(() => {});
          stop = async () => { as.stopAll(); await sleep(800); };
        } else {
          const ai = require('../electron/ai.cjs');
          const dataDir = path.join(tmp, 'ai-' + c.kind); fs.mkdirSync(dataDir, { recursive: true });
          const ctx = { dataDir, windows: new Map(), tiers: new tier.TierStore(path.join(dataDir, 'tiers.json')) };
          await ai.handle('ai.setConfig', { baseUrl, key: 'sk-test-not-real', model: 'gpt-6-astra' }, ctx);
          await ai.handle('ai.chat', { messages: [{ role: 'user', content: '在线？' }], feature: 'AI 讲题' }, ctx);
          await ai.handle('ai.modelList', { refresh: true }, ctx);
        }
        await until(() => s.got.some(isModel), 120000, c.who + ' 的模型请求');
        await sleep(500);
      } finally { await stop(); }
      const model = s.got.filter((r) => /\/(responses|messages|chat\/completions|models)$/.test(r.path));
      const row = { kind: c.kind === 'site' ? '我们站点（127.0.0.1，按站点域名处理）' : '第三方（localhost，不在站点域名表）', who: c.who, baseUrl, requests: model.map(brief) };
      results.push(row);
      console.log(`\n[${c.kind}] ${c.who}  ${baseUrl}`); for (const r of row.requests) console.log('  ', r.path, '| X-Omni-Client:', r['x-omni-client'], '| X-Route-Scope:', r['x-route-scope'], '|', r['user-agent']);
      await s.close();
    }
    fs.writeFileSync(path.join(outDir, 'real-cli-headers.json'), JSON.stringify({ version: VERSION, bins: { codex: bins.codex?.cmd + ' ' + (bins.codex?.version || ''), claude: bins.claude?.cmd + ' ' + (bins.claude?.version || '') }, results }, null, 2));
    // 判定：我们站点的每个模型请求都带 classroom/<版本>，第三方一个都不带
    for (const r of results) {
      assert.ok(r.requests.length, r.who + ' 没抓到请求');
      for (const q of r.requests) {
        if (r.kind.startsWith('我们')) assert.equal(q['x-omni-client'], WANT, `${r.who} ${q.path} 没带来源头`);
        else { assert.equal(q['x-omni-client'], '（没有）', `${r.who} ${q.path} 第三方不该带`); assert.equal(q['x-route-scope'], '（没有）'); }
      }
    }
    console.log('\nRESULT pass ' + results.length);
    app.exit(0);
  } catch (e) {
    fs.writeFileSync(path.join(outDir, 'real-cli-headers.json'), JSON.stringify({ error: String(e.stack || e), results }, null, 2));
    console.error('FAIL', e.stack || e); app.exit(1);
  }
})();
