// 一键导入验收（yinzi-import/1，和银子 API 站点 mod/import.js 同一份约定）：
// 链接 / 导入码 / .yzimport 文件 / 一次性 ticket 都能收；过期、重放、给别的软件的、地址对不上的都拒绝；
// 确认框只显示 Key 尾号；确认后写入地址、Key、文本 / 看图模型并测试连接；合并 / 覆盖模式；也兼容粘贴单独的 Key。
// 用法：npx electron test/quiet.cjs test/import-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'import-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-1', name: '小林' }], slots: [], learning: {} } }));
const imp = require('../electron/importLink.cjs');
const results = [];
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const KEY = 'sk-yinzitest0000abcd1234';
let seq = 0;
// 和站点 buildPayload 一样的结构
const payload = (origin, o = {}) => {
  const iat = Math.floor((o.now ?? Date.now()) / 1000);
  const p = {
    schema: 'yinzi-import/1', target: o.target ?? 'classroom-studio', nonce: 'n' + Date.now().toString(36) + (seq++) + 'abcdefgh', iat, exp: iat + 600,
    site: { name: '银子 API', origin, brand: 'yinzi' },
    profile: { id: new URL(origin).host + '#token-7', name: '银子 API · 默认智能', mode: o.mode ?? 'merge' },
  };
  if (o.key !== false) p.credentials = { base_url: (o.base ?? origin) + '/v1', api_key: o.key ?? KEY, key_name: '默认智能', smart_routing: true };
  p.slots = o.slots ?? { text: { model: 'gpt-6.1-sol' }, vision: { model: 'gpt-6.1-sol' }, agent: { codex: { model: 'gpt-6-astra' }, claude: { model: 'claude-opus-5-5' } } };
  return p;
};
const link = (p) => `classroom-studio://v1/import?data=${Buffer.from(JSON.stringify(p)).toString('base64url')}`;

(async () => {
  // ── 1. 协议解析与校验 ──
  const O = 'https://api.yinziapi.top';
  const r1 = await imp.receive(link(payload(O)));
  assert.equal(r1.kind, 'yinzi'); assert.equal(r1.baseUrl, O + '/v1'); assert.equal(r1.key, KEY); assert.equal(r1.text, 'gpt-6.1-sol'); assert.equal(r1.smart, true); assert.equal(r1.site.official, true);
  assert.equal(r1.codex, 'gpt-6-astra'); assert.equal(r1.claude, 'claude-opus-5-5');
  assert.equal((await imp.receive('导入码：' + imp.encodeCode(payload(O)) + '\n')).key, KEY, 'YZIMPORT1 code inside text');
  assert.equal((await imp.receive(link(payload(O)).replace('v1/import?', 'v1/import/?'))).key, KEY, 'trailing slash from Windows');
  const rej = async (input, code, ctx) => { await assert.rejects(imp.receive(input, ctx), (e) => e.code === code || assert.fail(code + ' expected, got ' + e.code + ' ' + e.message)); };
  await rej(link(payload(O, { target: 'omni-creator' })), 'wrong_target');
  await rej(link(payload(O, { now: Date.now() - 20 * 60e3 })), 'expired');
  await rej(link(payload(O, { base: 'https://evil.example.com' })), 'origin_mismatch');
  await rej(link(payload('http://api.example.com')), 'insecure');
  await rej('classroom-studio://v2/import?data=xx', 'upgrade_needed');
  await rej(link({ ...payload(O), schema: 'yinzi-import/2' }), 'upgrade_needed');
  await rej(link(payload(O, { key: false, slots: { agent: { codex: { model: 'x' } } } })), 'no_slots');
  await rej('classroom-studio://v1/import?data=%%%', 'bad_format');
  await rej('随便一段话', 'no_code');
  const used = payload(O);
  await rej(link(used), 'replayed', { nonceUsed: (n) => n === used.nonce });
  assert.equal((await imp.receive('  ' + KEY + ' ')).key, KEY, 'bare key still works');
  const cc = await imp.receive('ccswitch://v1/import?resource=provider&app=codex&endpoint=' + encodeURIComponent(O + '/v1') + '&apiKey=' + KEY + '&model=gpt-5.4');
  assert.equal(cc.baseUrl, O + '/v1'); assert.equal(cc.text, 'gpt-5.4');
  assert.equal(imp.linkFromArgv(['ClassroomStudio.exe', link(used)]), link(used));
  assert.equal(imp.linkFromArgv(['ClassroomStudio.exe', 'C:\\x\\a.yzimport']), 'C:\\x\\a.yzimport');
  assert.equal(imp.linkFromArgv(['ClassroomStudio.exe']), '');
  mark('yinzi-import/1: link, code, Windows slash; rejects wrong target, expired, origin mismatch, http, v2, agent-only, garbage, replay; legacy key / cc-switch');
})().then(desktop).catch(fail);

function fail(error) { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, out }, null, 2)); console.error(error); console.error('RESULT ' + out); try { require('electron').app.exit(1); } catch { process.exit(1); } }

function desktop() {
  const { app } = require('electron'); const errors = [];
  app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); });
  require('../electron/main.cjs');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(60); } throw Error('Timed out ' + what); };
  const shot = async (w, name) => { await sleep(500); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  const timer = setTimeout(() => { console.error('import desktop timed out'); app.exit(1); }, 90000);
  // 假的银子 API：/v1/models、/v1/chat/completions、/api/import/redeem
  const seen = [], tickets = new Map();
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/import/redeem') {
        const t = JSON.parse(body || '{}').ticket, p = tickets.get(t); tickets.delete(t);
        if (!p) { res.statusCode = 410; return res.end('{"success":false}'); }
        return res.end(JSON.stringify({ success: true, data: p }));
      }
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: ['gpt-4o-mini', 'gpt-5.4', 'gpt-6.1-sol', 'gpt-6.1-mini', 'smart-image'].map((id) => ({ id })) }));
      const j = JSON.parse(body || '{}');
      res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: '在线' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    });
  });
  (async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher'), student = api.windows.get('student');
    const call = (w, code) => w.webContents.executeJavaScript(code);
    await until(() => call(teacher, '!!window.__studioQA'));
    // 截图要窗口可见：放到所有屏幕之外再 showInactive，不打扰桌面
    const left = process.env.CS_SHOW === '1' ? 40 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
    teacher.setBounds({ x: left, y: 40, width: 1360, height: 860 }); teacher.showInactive();
    const T = (code) => call(teacher, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);
    const cfg = () => T(`return await window.csHost.call('ai.getConfig')`);
    const dialogText = () => T(`return document.querySelector('.imp')?.innerText||''`);
    const click = (label) => T(`[...document.querySelectorAll('.imp-b button')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click();return true`);
    const offer = async (input) => { await T(`document.querySelector('.imp-b button:last-child')?.click();return true`); await until(() => T(`return !document.querySelector('.imp')`), 3000, 'previous dialog closed').catch(() => {}); await api.offerLink(input); await until(() => T(`return !!document.querySelector('.imp')`), 8000, 'import dialog'); return dialogText(); };
    assert.equal((await cfg()).hasKey, false, 'starts without key');

    // ── 2. 网站打开链接 → 确认框 → 写入、测试 ──
    const p1 = payload(origin);
    const t1 = await offer(link(p1));
    assert.match(t1, /银子 API/); assert.match(t1, /未知站点/, 'local origin is not official');
    assert.match(t1, /1234/); assert.match(t1, /智能路由/); assert.match(t1, /gpt-6\.1-sol/);
    assert.match(t1, /Codex 智能体\s*gpt-6-astra/); assert.match(t1, /Claude 智能体\s*claude-opus-5-5/);
    assert.ok(!(await T(`return document.documentElement.outerHTML`)).includes(KEY), 'full key never in the teacher page');
    await shot(teacher, 'import-confirm.png');
    await click('导入并测试');
    await until(() => T(`return !!document.querySelector('.imp-msg.ok')`), 15000, 'import ok');
    const c1 = await cfg();
    assert.equal(c1.baseUrl, origin + '/v1'); assert.equal(c1.keyHint, '1234'); assert.equal(c1.model, 'gpt-6.1-sol'); assert.equal(c1.visionModel, '', 'vision same as text → follows text');
    assert.ok(seen.some((r) => r.url === '/v1/chat/completions' && r.auth === 'Bearer ' + KEY), 'connection tested with the imported key');
    const agentPrefs = await T(`return ['codex','claude','studioKey'].map(k=>localStorage.getItem(k==='studioKey'?'cs.agent.studioKey':'cs.agent.model.'+k))`);
    assert.deepEqual(agentPrefs, ['gpt-6-astra', 'claude-opus-5-5', '1'], 'AI 工作室 defaults: per-engine models, uses the imported key');
    await shot(teacher, 'import-done.png');
    assert.equal(await call(student, `!!document.querySelector('.imp')`), false, 'student window never shows the dialog');
    mark('site link → confirm (key tail only) → saved base, key, models, AI 工作室 Codex / Claude models; connection tested');

    // ── 3. 同一个链接再打开：拒绝重放 ──
    assert.match(await offer(link(p1)), /已经用过了/);
    // 给万能创作终端的链接：说清楚
    assert.match(await offer(link(payload(origin, { target: 'omni-creator' }))), /万能创作终端/);
    mark('replayed link and link for the other app are refused with a clear reason');

    // ── 4. 合并：只改模型，不带 Key；覆盖：要勾选确认，没勾的清空 ──
    await T(`await window.csHost.call('ai.setConfig',{visionModel:'gpt-4o-mini'});return true`);
    const t4 = await offer(link(payload(origin, { key: false, slots: { text: { model: 'gpt-5.4' } } })));
    assert.match(t4, /不变（用本机已保存的 Key）/); assert.match(t4, /gpt-6\.1-sol\s*→?\s*gpt-5\.4/);
    await click('导入并测试'); await until(() => T(`return !!document.querySelector('.imp-msg.ok')`), 15000, 'merge ok');
    let c = await cfg(); assert.equal(c.keyHint, '1234'); assert.equal(c.model, 'gpt-5.4'); assert.equal(c.visionModel, 'gpt-4o-mini', 'merge keeps vision');
    await offer(link(payload(origin, { mode: 'replace', key: 'sk-replacekey77778888', slots: { text: { model: 'gpt-6.1-sol' } } })));
    assert.equal(await T(`return [...document.querySelectorAll('.imp-b button')].find(b=>b.innerText.includes('导入并测试')).disabled`), true, 'replace needs the checkbox');
    await shot(teacher, 'import-replace.png');
    await T(`document.querySelector('.imp-sure input').click();return true`);
    await click('导入并测试'); await until(() => T(`return !!document.querySelector('.imp-msg.ok')`), 15000, 'replace ok');
    c = await cfg(); assert.equal(c.keyHint, '8888'); assert.equal(c.model, 'gpt-6.1-sol'); assert.equal(c.visionModel, '', 'replace clears vision');
    mark('merge changes only the ticked model; replace asks for confirmation and clears the rest');

    // ── 5. 一次性 ticket、.yzimport 文件、粘贴导入码、取消 ──
    tickets.set('tkt_0123456789abcdef', payload(origin, { key: 'sk-ticketkey11112222' }));
    assert.match(await offer(`classroom-studio://v1/import?ticket=tkt_0123456789abcdef&site=${encodeURIComponent(origin)}`), /2222/);
    await click('取消'); await until(() => T(`return !document.querySelector('.imp')`), 4000, 'cancelled');
    assert.equal((await cfg()).keyHint, '8888', 'cancel keeps the old key');
    assert.match(await offer(`classroom-studio://v1/import?ticket=tkt_0123456789abcdef&site=${encodeURIComponent(origin)}`), /领取/, 'ticket is one-time');
    const file = path.join(out, 'site.yzimport'); fs.writeFileSync(file, imp.encodeCode(payload(origin, { key: 'sk-filekey33334444' })));
    assert.match(await offer(file), /4444/);
    await click('取消');
    await T(`s.set({aiOpen:true});return true`);
    await until(() => T(`return !!document.querySelector('.ai-ico[aria-label="AI 设置"]')`), 5000, 'ai panel');
    await T(`if(!document.querySelector('.ai-imp'))document.querySelector('.ai-ico[aria-label="AI 设置"]').click();return true`);
    await until(() => T(`return !!document.querySelector('.ai-imp input')`), 5000, 'quick import box');
    const code = imp.encodeCode(payload(origin, { key: 'sk-pastekey55556666', slots: { text: { model: 'gpt-5.4' }, vision: { model: 'gpt-6.1-sol' } } }));
    await T(`const i=document.querySelector('.ai-imp input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(code)});i.dispatchEvent(new Event('input',{bubbles:true}));return true`);
    await sleep(100); await T(`document.querySelector('.ai-imp-row button').click();return true`);
    await until(() => T(`return /6666/.test(document.querySelector('.imp')?.innerText||'')`), 5000, 'dialog from pasted code');
    await click('导入并测试'); await until(() => T(`return !!document.querySelector('.imp-msg.ok')`), 15000, 'paste ok');
    c = await cfg(); assert.equal(c.keyHint, '6666'); assert.equal(c.model, 'gpt-5.4'); assert.equal(c.visionModel, 'gpt-6.1-sol');
    await click('关闭');
    await until(() => T(`return document.querySelector('.ai-cfg > label input')?.value===${JSON.stringify(origin + '/v1')}`), 4000, 'settings form refreshed');
    await shot(teacher, 'import-settings.png');
    mark('one-time ticket, .yzimport file, pasted import code; cancel changes nothing; settings form refreshes');

    // ── 6. 只给 Key 的老办法：自动挑旗舰模型 ──
    await T(`await window.csHost.call('ai.setConfig',{model:'',visionModel:''});return true`);
    assert.match(await offer('sk-barekey99990000'), /自动挑选/);
    await click('导入并测试'); await until(() => T(`return !!document.querySelector('.imp-msg.ok')`), 15000, 'bare ok');
    assert.equal((await cfg()).model, 'gpt-6.1-sol', 'flagship picked, not a mini model');
    mark('bare key: model auto-picked (flagship, not mini)');

    const nonces = JSON.parse(fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'import-nonces.json'), 'utf8'));
    assert.ok(nonces.length >= 3 && !JSON.stringify(nonces).includes('sk-'), 'nonce log has no keys');
    const logs = fs.readdirSync(path.join(process.env.CS_DATA_DIR, 'logs')).map((f) => fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'logs', f), 'utf8')).join('');
    assert.ok(!/sk-[a-z]+key|YZIMPORT1/.test(logs), 'logs never contain keys or codes');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
    console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
  })().catch(fail);
}
