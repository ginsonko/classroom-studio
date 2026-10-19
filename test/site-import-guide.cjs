// 和银子 API 站点真实代码联调 + 配置说明截图：
// test/fixtures/yinzi-site/ 里是站点公开的 mod/hub.js（智能路由页、新建密钥）、mod/import.js（一键导入）和基础样式，
// 用假数据挂起来，按老师的真实点击路径走：智能路由 → 新建智能密钥 → 创建 → 一键导入到软件 → 选「最强网课教辅系统」→ 导入到软件；
// 站点生成的链接 / 导入码交给导播台，导播台弹确认框（官方站点、只显示 Key 尾号）；再用本地假 API 走一遍导入并测试。
// 不联网、不用真 Key。截图上画好红框和序号，供 reports 里的图片版说明使用。
// 用法：npx electron test/quiet.cjs test/site-import-guide.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'guide-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [{ id: 'stu-1', name: '小林' }], slots: [], learning: {} } }));
const FIX = path.join(__dirname, 'fixtures/yinzi-site');
const FAKE_KEY = 'sk-guide' + '0'.repeat(32) + 'a1b2';
const results = [];
const mark = (name) => { results.push({ name, ok: true }); console.log('PASS ' + name); };
const { app, BrowserWindow, screen } = require('electron');
const errors = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); });
require('../electron/main.cjs');

function fail(error) { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: error.stack, results, consoleErrors: errors, out }, null, 2)); console.error(error); console.error('RESULT ' + out); app.exit(1); }

// 站点页面：真实模块 + 最小的宿主（h / dialog / toast / request 与站点 qs.js 一致）
const SITE_HTML = (endpoint) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>银子 API</title>
<style>${fs.readFileSync(path.join(FIX, 'core.css'), 'utf8').replaceAll(':host', ':root')}
html,body{margin:0;height:100%;background:var(--qs-bg)}
.qs-frame{display:block}
.site-top{display:flex;align-items:center;gap:22px;padding:14px 28px;border-bottom:1px solid var(--qs-line);font-size:.92rem;color:var(--qs-mute)}
.site-top b{color:var(--qs-fg);font-size:1.05rem;margin-right:12px}.site-top .on{color:var(--qs-fg);border-bottom:2px solid var(--qs-ac);padding-bottom:4px}
.site-main{max-width:980px;margin:22px auto;padding:0 20px}
.gd-mark{position:fixed;z-index:2147483600;border:3px solid #ff3b30;border-radius:12px;box-shadow:0 0 0 4px rgba(255,59,48,.25);pointer-events:none}
.gd-mark i{position:absolute;left:-16px;top:-16px;width:28px;height:28px;border-radius:50%;background:#ff3b30;color:#fff;font:700 16px/28px system-ui;text-align:center;font-style:normal}
</style></head><body><div class="qs-frame"><div class="site-top"><b>银子 API</b><span>首页</span><span>模型广场</span><span>密钥</span><span class="on">智能路由</span><span>用量</span><span>钱包</span></div><div class="site-main" id="root"></div></div><div class="qs-layer" id="layer"></div>
<script>
const mods = {}; window.__qs = { defineModule(m) { mods[m.id] = m; const s = document.createElement('style'); s.textContent = m.css || ''; document.head.append(s) } };
const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue
    if (k === 'class') n.className = v; else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v)
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) n.style.setProperty(p, val); else n.setAttribute(k, v === true ? '' : v) }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  return n }
const layer = document.getElementById('layer')
window.__site = { posted: [], links: [], copied: [] }
navigator.clipboard.writeText = async (t) => { __site.copied.push(t) }
const ui = {
  toast(t) { __site.toast = t },
  dialog(build, o = {}) { return new Promise((res) => { const scrim = h('div', { class: 'qs-scrim' }), box = h('div', { class: 'qs-dlg' + (o.wide ? ' wide' : '') + (o.cls ? ' ' + o.cls : '') })
    scrim.append(box); layer.append(scrim); const done = (v) => { scrim.remove(); res(v) }; build(box, done) }) },
}
const GROUPS = [
  { group: 'default', description: '默认分组', effective_ratio_ppm: 1000000, supported_model_count: 86, health_status: 'healthy' },
  { group: 'premium', description: '高可用', effective_ratio_ppm: 1500000, supported_model_count: 64, health_status: 'healthy' },
  { group: 'economy', description: '经济', effective_ratio_ppm: 600000, supported_model_count: 41, health_status: 'healthy' },
]
const app = { h, ui, qpu: 500000, currency: { sym: '¥', rate: 1, code: 'CNY' }, fmt: { money: (v) => '¥' + (+v || 0).toFixed(2) },
  state: { siteName: '银子 API', endpoint: ${JSON.stringify(endpoint)}, keys: [], groups: [{ name: 'default', ratio: 1, desc: '默认分组' }], groupColors: {}, user: { group: 'default' } },
  prefs: { get: (_k, d) => d, set() {} }, ensureKeys: async () => app.state.keys,
  async request(method, p, o = {}) {
    if (p === '/api/smart-router/options') return { enabled: true, default_for_new_keys: true, default_policy: { strategy: 'price' }, groups: GROUPS, model_count: 128, route_count: 36, max_attempts: 8, max_failure_threshold: 10, absolute_max_effective_ratio_ppm: 5000000, default_max_effective_ratio_ppm: 2000000, max_queue_wait_ms: 1000 }
    if (p === '/api/user/models') return ['gpt-6.1-sol', 'gpt-5.4', 'gpt-6.1-mini', 'claude-opus-5-5', 'gemini-3-pro']
    if (method === 'POST' && p === '/api/token/') { __site.posted.push(o.json); app.state.keys.push({ id: 7, name: o.json.name, smart: o.json.group === 'auto', status: 'on', group: o.json.group }); return {} }
    throw new Error('stub: ' + method + ' ' + p)
  },
  act: {
    copy() {}, copyKey() {}, editKey: async () => {},
    async createKey(o = {}) {
      let handle; const created = await ui.dialog((box, done) => { handle = mods.hub.mount(app, box, { view: 'editor', key: null, name: o.name, done }) }, { wide: true, cls: 'qs-hubdlg' }).finally(() => handle?.destroy?.())
      if (!created) return; const k = app.state.keys.find((x) => x.name === created.name); app.act.showKey(created.name, ${JSON.stringify(FAKE_KEY)}, k)
    },
    showKey(name, key, k) { return ui.dialog((box, done) => box.append(
      h('h3', {}, '「' + name + '」'), h('p', {}, '这是完整密钥，请妥善保存，不要发给别人。'), h('code', { class: 'qs-key' }, key.slice(0, 8) + '••••••••••••••••' + key.slice(-4)),
      h('p', { class: 'qs-mute' }, '接口地址：' + app.state.endpoint + '/v1'),
      h('div', { class: 'qs-btns' }, k?.status === 'on' ? h('button', { type: 'button', class: 'qs-btn', title: '导入到万能创作终端或最强网课教辅系统', onclick: () => { done(); app.act.importKey(k, key) } }, '一键导入到软件') : null,
        h('button', { type: 'button', class: 'qs-btn', onclick: () => done() }, '关闭'), h('button', { type: 'button', class: 'qs-btn pri', onclick: () => done() }, '复制密钥')))) },
    importKey(k, key) { let handle; return ui.dialog((box, done) => { handle = mods.import.mount(app, box, { key: { id: k.id, name: k.name, smart: k.smart }, fullKey: key, done, launch: (href) => __site.links.push(href) }) }, { cls: 'qs-imp' }).finally(() => handle?.destroy()) },
  },
}
window.__mark = (els) => { document.querySelectorAll('.gd-mark').forEach((m) => m.remove()); els.forEach((sel, i) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) throw new Error('mark: ' + sel); const r = e.getBoundingClientRect(); const m = h('div', { class: 'gd-mark', style: { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' } }, h('i', {}, i + 1)); document.body.append(m) }) }
window.__btn = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
</script><script src="/site/hub.js"></script><script src="/site/import.js"></script>
<script>mods.hub.mount(app, document.getElementById('root'), { view: 'smart' })</script></body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(60); } throw Error('Timed out ' + what); };
const shot = async (w, name) => { await sleep(450); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
const timer = setTimeout(() => { console.error('site import guide timed out'); app.exit(1); }, 120000);

// 假站点：页面、站点模块、/v1/models、/v1/chat/completions
const seen = [];
let siteEndpoint = '';
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.url.startsWith('/site.html')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(SITE_HTML(siteEndpoint)); }
    const m = /^\/site\/(hub|import)\.js$/.exec(req.url);
    if (m) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(fs.readFileSync(path.join(FIX, m[1] + '.js'))); }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: ['gpt-6.1-sol', 'gpt-5.4', 'gpt-6.1-mini', 'claude-opus-5-5', 'smart-image', 'smart-video', 'text-embedding-3-large'].map((id) => ({ id })) }));
    const j = JSON.parse(body || '{}');
    res.end(JSON.stringify({ model: j.model, choices: [{ message: { role: 'assistant', content: '在线' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
  });
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 40 : Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 40, width: 1280, height: 800 }); teacher.showInactive();
  const T = (code) => call(teacher, `(async()=>{const s=__studioQA.useStore.getState();${code}})()`);
  const cfg = () => T(`return await window.csHost.call('ai.getConfig')`);

  // 走一遍站点：返回站点生成的链接和导入码
  async function sitePass(endpoint, shots) {
    siteEndpoint = endpoint;
    const site = new BrowserWindow({ show: false, x: left, y: 60, width: 1180, height: 820, backgroundColor: '#0b0b0c', webPreferences: { sandbox: true, contextIsolation: true } });
    site.showInactive();
    await site.loadURL(origin + '/site.html');
    const S = (code) => call(site, `(async()=>{${code}})()`);
    await until(() => S(`return !!__btn('新建智能密钥')`), 8000, 'smart page');
    if (shots) { await S(`__mark([__btn('新建智能密钥')]);return 1`); await shot(site, 'site-1-smart.png'); }
    await S(`__btn('新建智能密钥').click();return 1`);
    await until(() => S(`return !!document.querySelector('.qs-hubdlg .qsh-seg button[aria-pressed=true]')`), 8000, 'key editor');
    const type = await S(`return document.querySelector('.qs-hubdlg .qsh-seg button[aria-pressed=true]').textContent`);
    assert.equal(type, '智能路由', 'new keys default to smart routing');
    await S(`const i=document.querySelector('.qs-hubdlg input');i.value='网课教辅';i.dispatchEvent(new Event('input'));return 1`);
    if (shots) {
      await S(`const seg=document.querySelector('.qs-hubdlg .qsh-seg');__mark([document.querySelector('.qs-hubdlg input'),seg,document.querySelector('.qsh-foot .pri')]);return 1`);
      await shot(site, 'site-2-editor.png');
    }
    await S(`document.querySelector('.qsh-foot .pri').click();return 1`);
    await until(() => S(`return !!__btn('一键导入到软件')`), 8000, 'show key');
    const posted = await S(`return __site.posted[0]`);
    assert.equal(posted.name, '网课教辅'); assert.equal(posted.group, 'auto', 'smart key → group auto'); assert.ok(JSON.parse(posted.routing_policy).allow_future_groups, 'all groups allowed');
    if (shots) { await S(`__mark([__btn('一键导入到软件')]);return 1`); await shot(site, 'site-3-key.png'); }
    await S(`__btn('一键导入到软件').click();return 1`);
    await until(() => S(`return !!document.querySelector('.qsi-slots')`), 8000, 'import form');
    await S(`[...document.querySelectorAll('input[name=qsi-target]')].find(i=>i.value==='classroom-studio').click();return 1`);
    await until(() => S(`return document.querySelectorAll('.qsi-slot').length===4`), 4000, 'classroom slots');
    const picked = await S(`return [...document.querySelectorAll('.qsi-slot select')].map(s=>s.getAttribute('aria-label')+'='+s.value)`);
    assert.deepEqual(picked, ['文本模型=gpt-6.1-sol', '看图模型=gpt-6.1-sol', 'Codex 智能体=gpt-6.1-sol', 'Claude 智能体=claude-opus-5-5'], 'site recommends gpt-6.1-sol');
    if (shots) {
      site.setContentSize(1180, 1240); await sleep(300);
      await S(`document.querySelector('.qs-imp').style.maxHeight='none';__mark([document.querySelector('input[value=classroom-studio]').closest('label'),__btn('导入到软件')]);return 1`);
      await shot(site, 'site-4-import.png');
      site.setContentSize(1180, 820); await sleep(300);
    }
    await S(`__btn('导入到软件').click();return 1`);
    const href = await until(() => S(`return __site.links[0]`), 4000, 'site link');
    await until(() => S(`return !!__btn('复制导入码')`), 4000, 'launched view');
    await S(`__btn('复制导入码').click();return 1`);
    const code = await until(() => S(`return __site.copied[0]`), 4000, 'import code');
    if (shots) { await S(`__mark([__btn('复制导入码')]);return 1`); await shot(site, 'site-5-code.png'); }
    site.destroy();
    return { href, code };
  }
  const dialogText = () => T(`return document.querySelector('.imp')?.innerText||''`);
  const offer = async (input) => { await api.offerLink(input); await until(() => T(`return !!document.querySelector('.imp')`), 8000, 'import dialog'); return dialogText(); };
  const click = (label) => T(`[...document.querySelectorAll('.imp-b button')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click();return true`);
  const markApp = (sels) => T(`document.querySelectorAll('.gd-mark').forEach(m=>m.remove());${JSON.stringify(sels)}.forEach((sel,i)=>{const e=document.querySelector(sel);if(!e)throw Error('mark '+sel);const r=e.getBoundingClientRect();const m=document.createElement('div');m.className='gd-mark';m.style.cssText='position:fixed;z-index:99999;pointer-events:none;border:3px solid #ff3b30;border-radius:10px;box-shadow:0 0 0 4px rgba(255,59,48,.25);left:'+(r.left-6)+'px;top:'+(r.top-6)+'px;width:'+(r.width+12)+'px;height:'+(r.height+12)+'px';m.innerHTML='<i style="position:absolute;left:-16px;top:-16px;width:28px;height:28px;border-radius:50%;background:#ff3b30;color:#fff;font:700 16px/28px system-ui;text-align:center;font-style:normal">'+(i+1)+'</i>';document.body.append(m)});return 1`);
  const unmarkApp = () => T(`document.querySelectorAll('.gd-mark').forEach(m=>m.remove());return 1`);

  // ── 1. 正式站点地址：站点生成的链接 → 导播台确认框显示官方站点 ──
  const official = await sitePass('https://yinziapi.top', true);
  assert.match(official.href, /^classroom-studio:\/\/v1\/import\?data=/); assert.match(official.code, /^YZIMPORT1:/);
  const t1 = await offer(official.href);
  assert.match(t1, /银子 API/); assert.doesNotMatch(t1, /未知站点/, 'yinziapi.top is official');
  assert.match(t1, /https:\/\/yinziapi\.top\/v1/); assert.match(t1, /a1b2/); assert.match(t1, /网课教辅/); assert.match(t1, /智能路由/); assert.match(t1, /gpt-6\.1-sol/);
  assert.ok(!(await T(`return document.documentElement.outerHTML`)).includes(FAKE_KEY), 'full key never in the teacher page');
  await markApp(['.imp-site', '.imp-b button:last-child']).catch(() => markApp(['.imp', '.imp-b button:last-child']));
  await shot(teacher, 'app-6-confirm.png'); await unmarkApp();
  await click('取消'); await until(() => T(`return !document.querySelector('.imp')`), 4000, 'cancelled');
  assert.equal((await cfg()).hasKey, false, 'cancel saves nothing');
  // 同一份导入码也能粘贴：AI 设置 → 一键导入
  await T(`s.set({aiOpen:true});return true`);
  await until(() => T(`return !!document.querySelector('.ai-ico[aria-label="AI 设置"]')`), 5000, 'ai panel');
  await T(`if(!document.querySelector('.ai-imp'))document.querySelector('.ai-ico[aria-label="AI 设置"]').click();return true`);
  await until(() => T(`return !!document.querySelector('.ai-imp input')`), 5000, 'quick import box');
  await markApp(['.ai-imp']); await shot(teacher, 'app-7-paste.png'); await unmarkApp();
  assert.match(await offer(official.code), /a1b2/, 'site import code accepted');
  await click('取消'); await until(() => T(`return !document.querySelector('.imp')`), 4000, 'cancelled 2');
  mark('real site modules: 智能路由 → 新建智能密钥 (defaults to smart, group auto) → 一键导入到软件 → 最强网课教辅系统 (gpt-6.1-sol) → link + code accepted by the app as official');

  // ── 2. 本地假站点：站点链接 → 导入并测试 → 设置写好 ──
  const local = await sitePass(origin, false);
  const t2 = await offer(local.href);
  assert.match(t2, /a1b2/);
  await click('导入并测试');
  await until(() => T(`return !!document.querySelector('.imp-msg.ok')`), 15000, 'import ok');
  await markApp(['.imp-msg.ok']); await shot(teacher, 'app-8-done.png'); await unmarkApp();
  const c = await cfg();
  assert.equal(c.baseUrl, origin + '/v1'); assert.equal(c.keyHint, 'a1b2'); assert.equal(c.model, 'gpt-6.1-sol'); assert.equal(c.visionModel, '');
  assert.ok(seen.some((r) => r.url === '/v1/chat/completions' && r.auth === 'Bearer ' + FAKE_KEY), 'connection tested with the imported key');
  // 本地假站点会显示“未知站点”，说明图只裁成功提示和按钮这一段
  const rect = await T(`const d=document.querySelector('.imp').getBoundingClientRect(),m=document.querySelector('.imp-msg.ok').getBoundingClientRect();return {x:d.x,y:m.y-14,width:d.width,height:d.bottom-m.y+14,viewW:innerWidth,viewH:innerHeight}`);
  fs.writeFileSync(path.join(out, 'app-8-done.rect.json'), JSON.stringify(rect));
  mark('site link from the real import module → 导入并测试 → base, key, model saved and tested');

  const logs = fs.readdirSync(path.join(process.env.CS_DATA_DIR, 'logs')).map((f) => fs.readFileSync(path.join(process.env.CS_DATA_DIR, 'logs', f), 'utf8')).join('');
  assert.ok(!logs.includes(FAKE_KEY) && !logs.includes('YZIMPORT1'), 'logs never contain keys or codes');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: errors, out }, null, 2));
  console.log('RESULT ' + out); clearTimeout(timer); server.close(); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
}).catch(fail);
