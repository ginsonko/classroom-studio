// 1.7.0 AI 工具（cs_tools）验收：每个工具真调一次。
//   1. MCP 服务：真的起 csToolsMcp.cjs 子进程走 JSON-RPC，按档位列出工具（安全模式只有 page_check），tools/call 能用
//   2. 联网：web_search 搜到结果、结果页存进「资料/来源」并记进索引；web_fetch 抓公开网页、原文落盘
//   3. 内置浏览器：打开公开网页 → snapshot 拿编号 → 点击跳转 → 读正文 → 截图；面板自动打开；handoff 等老师点「继续」
//   4. 截图自检：带报错的 HTML 能报出未捕获异常、点按钮后的报错、找不到的图片、横向溢出；干净的页面报「没有发现问题」；
//      安全模式下外网脚本被拦
//   5. 键鼠：设置关着时弹卡片，点「不允许」被拒；点「这次允许」后能用；老师动键鼠就暂停；上课中拒绝；密码框不打字（假的键鼠组件）
//      CS_DESK_REAL=1 时再用真的键鼠组件在一个单独进程的靶子窗口里点中按钮、打字（会真的动鼠标，只在人工验收时开）
//   6. 工坊参数：Codex 常用权限带 web_search="live" 和 cs_tools，安全模式 web_search="disabled"；Claude 带 --mcp-config 和对应 allowedTools
// 用法：npx vite build --outDir .out/dist-me 后
//   CS_DIST=.out/dist-me CS_TEST_OUT=.out/tools-test npx electron test/quiet.cjs test/v170-tools.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict'); const { spawn } = require('node:child_process');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v170-tools-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
const DATA = process.env.CS_DATA_DIR; fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({ settings: { autoAnalyze: false, autoMap: false, transcribe: false }, local: { roots: [], students: [], slots: [], learning: {} } }));
const LOG = path.join(out, 'test.log');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); fs.appendFileSync(LOG, s + '\n'); console.log(s); };

const electron = require('electron'); const { app, dialog } = electron; const errors = [];
dialog.showErrorBox = (t, c) => log('（已拦下错误框）', t, c);
const fatal = (why, e) => { log('FAIL', why, String(e?.stack || e)); app.exit(1); };
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (ev) => { if (ev.level === 'error' && wc.getURL().startsWith('studio://')) errors.push(String(ev.message).slice(0, 300)); }); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const results = [];
const mark = (name, d = {}) => { results.push({ name, ok: true, ...d }); log('PASS ' + name, Object.keys(d).length ? d : ''); };
const timer = setTimeout(() => fatal('timeout', '20 分钟没跑完'), 20 * 60000);

/** 走一遍真的 MCP stdio 服务 */
function mcpSession(host, key) {
  const mcp = require('../electron/csToolsMcp.cjs'), sp = mcp.serverSpec(host, key);
  const child = spawn(sp.command, sp.args, { env: { ...process.env, ...sp.env, ...sp.vars }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', seq = 0; const wait = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); wait.get(m.id)?.(m); wait.delete(m.id); } catch { /* 不是 JSON */ } } });
  const rpc = (method, params = {}) => new Promise((ok, no) => { const id = ++seq; const t = setTimeout(() => no(Error('MCP 超时 ' + method)), 300000); wait.set(id, (m) => { clearTimeout(t); m.error ? no(Error(m.error.message)) : ok(m.result); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { rpc, close: () => { try { child.stdin.end(); child.kill(); } catch { /* 已退出 */ } } };
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const page = (code) => teacher.webContents.executeJavaScript(code);
  await until(() => page('!!document.querySelector(".ta")'), 30000, '教师窗口');
  const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  const shot = async (name) => { teacher.webContents.invalidate(); await sleep(400); try { fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); } catch { /* 屏幕外窗口有时截不了 */ } };
  const th = await until(() => api.toolHost, 10000, 'toolHost');
  assert.ok(th.host?.url, 'AI 工具接口应该已经启动');
  const work = path.join(out, 'task-work'); fs.mkdirSync(work, { recursive: true });
  th.register('task:t-full', { title: '测试任务', work, perm: 'full', source: 'task' });
  th.register('task:t-safe', { title: '安全任务', work, perm: 'safe', source: 'task' });

  log('— 1. MCP 服务');
  // ── 1. MCP 服务 ────────────────────────────────────────────
  {
    const full = mcpSession(th, 'task:t-full'), safe = mcpSession(th, 'task:t-safe');
    await full.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const fl = (await full.rpc('tools/list')).tools.map((t) => t.name);
    await safe.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const sl = (await safe.rpc('tools/list')).tools.map((t) => t.name);
    for (const n of ['web_search', 'web_fetch', 'browser_open', 'browser_read', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_fill', 'browser_scroll', 'browser_screenshot', 'browser_download', 'browser_back', 'browser_handoff', 'page_check', 'screen_capture', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll', 'desktop_move']) assert.ok(fl.includes(n), '常用权限应该有 ' + n);
    assert.deepEqual(sl, ['page_check'], '安全模式只有 page_check');
    const desc = (await full.rpc('tools/list')).tools.find((t) => t.name === 'desktop_click').description;
    assert.match(desc, /老师在设置里关掉了这项/, '键鼠默认关着，工具说明里要写会弹卡片');
    const bad = mcpSession({ url: th.host.url, tokenFor: () => 'x'.repeat(40) }, 'task:t-full');
    await bad.rpc('initialize', {});
    assert.equal((await bad.rpc('tools/list')).tools.length, 0, '令牌不对时一个工具都不给');
    bad.close();
    fs.writeFileSync(path.join(work, 'ok.html'), '<!doctype html><meta charset="utf-8"><title>好页面</title><body style="font:16px sans-serif"><h1>匀变速直线运动</h1><p>v = v0 + at</p><button onclick="document.querySelector(\'p\').textContent=\'ok\'">变一下</button></body>');
    log('  tools/list 通过，试 tools/call page_check');
    const r = await safe.rpc('tools/call', { name: 'page_check', arguments: { file: 'ok.html' } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    assert.equal(r.content[1]?.type, 'image', 'page_check 要把截图返回给模型');
    const denied = await safe.rpc('tools/call', { name: 'web_search', arguments: { query: 'x' } });
    assert.ok(denied.isError && /安全模式/.test(denied.content[0].text), '安全模式调 web_search 要被拒');
    full.close(); safe.close();
    mark('MCP 服务按档位列工具、令牌校验、tools/call', { full: fl.length, safe: sl.length });
  }
  const call = (key, name, args) => th.call(key, name, args);

  const ONLY = process.env.CS_DESK_ONLY === '1';
  log('— 2. 联网搜索 / 抓网页');
  // ── 2. 联网搜索 / 抓网页 ────────────────────────────────────
  let firstUrl = '';
  if (!ONLY) {
    const r = await call('task:t-full', 'web_search', { query: '2024 北京 高一物理 期中 超重失重', count: 5 });
    assert.ok(!r.isError, r.text);
    const urls = [...r.text.matchAll(/网址：(https?:\/\/\S+)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 2, '至少两条带网址的结果：' + r.text.slice(0, 400));
    firstUrl = urls.find((u) => !/bing\.com|baidu\.com/.test(u)) || urls[0];
    const dir = path.join(work, '资料', '来源');
    const saved = fs.readdirSync(dir);
    assert.ok(saved.some((f) => /搜索.*\.md$/.test(f)) && saved.some((f) => /搜索.*\.html$/.test(f)), '搜索结果页要存成 .md 和 .html');
    assert.match(fs.readFileSync(path.join(dir, '索引.md'), 'utf8'), /搜索：2024 北京/);
    mark('web_search 搜到结果并落盘来源', { n: urls.length, first: firstUrl });
    const f = await call('task:t-full', 'web_fetch', { url: 'https://www.gov.cn/' });
    assert.ok(!f.isError, f.text);
    assert.match(f.text, /出处：https:\/\/www\.gov\.cn/);
    const html = fs.readdirSync(dir).filter((x) => /\.html$/.test(x) && !/搜索/.test(x));
    assert.ok(html.length >= 1 && fs.statSync(path.join(dir, html[0])).size > 1000, '网页原文要存下来');
    mark('web_fetch 抓公开网页并存原文', { chars: (f.text.match(/共 (\d+) 字/) || [])[1] });
    const internal = await call('task:t-full', 'web_fetch', { url: 'http://192.168.1.1/' });
    assert.ok(internal.isError && /局域网/.test(internal.text));
    mark('web_fetch 拒绝局域网地址');
  }

  log('— 3. 内置浏览器');
  // ── 3. 内置浏览器 ────────────────────────────────────────────
  if (!ONLY) {
    const o = await call('task:t-full', 'browser_open', { url: 'https://example.com/' });
    assert.ok(!o.isError, o.text);
    await until(() => page('!!document.querySelector("[data-qa=aitools-browser]")'), 8000, 'AI 浏览器面板自动打开');
    const s = await call('task:t-full', 'browser_snapshot', {});
    assert.ok(!s.isError, s.text);
    const ref = (s.text.match(/\[(e\d+)\][^\n]*(Learn more|More information)/i) || s.text.match(/\[(e\d+)\][^\n]*链接/) || [])[1];
    assert.ok(ref, '应该有可点的链接编号：' + s.text.slice(0, 600));
    const before = th.parts.browser.tab('task:t-full').wc.getURL();
    const c = await call('task:t-full', 'browser_click', { ref });
    assert.ok(!c.isError, c.text);
    await until(() => th.parts.browser.tab('task:t-full').wc.getURL() !== before, 15000, '点击后跳转');
    const rd = await call('task:t-full', 'browser_read', {});
    assert.ok(!rd.isError && /共 \d+ 字/.test(rd.text), rd.text.slice(0, 300));
    assert.ok(fs.readdirSync(path.join(work, '资料', '来源')).some((f) => /浏览器-.*\.md$/.test(f)), '浏览器读过的正文也要存进资料/来源');
    const sc = await call('task:t-full', 'browser_screenshot', {});
    assert.ok(sc.images?.[0]?.data?.length > 1000, '截图要有图片');
    const back = await call('task:t-full', 'browser_back', {});
    assert.ok(!back.isError, back.text);
    await shot('browser-pane.png');
    mark('浏览器打开公开网页、snapshot、点击、读正文、截图、后退', { ref, to: th.parts.browser.tab('task:t-full').wc.getURL() });
    // 交给老师：等面板里点「继续」
    const h = call('task:t-full', 'browser_handoff', { reason: '测试：请点继续', timeout_s: 20 });
    await until(() => page('!!document.querySelector("[data-qa=aitools-browser-resume]")'), 8000, '面板上的「继续」');
    await page('document.querySelector("[data-qa=aitools-browser-resume]").click(), true');
    const hr = await h;
    assert.match(hr.text, /老师已完成/);
    mark('browser_handoff 等老师在面板里点「继续」');
    const lan = await call('task:t-full', 'browser_open', { url: 'http://127.0.0.1:1/' });
    assert.ok(lan.isError, '浏览器不能打开本机地址');
    mark('浏览器拒绝本机地址');
  }

  log('— 4. 截图自检');
  // ── 4. 截图自检 ──────────────────────────────────────────────
  if (!ONLY) {
    fs.writeFileSync(path.join(work, 'bad.html'), `<!doctype html><meta charset="utf-8"><title>有问题的课件</title>
<style>body{margin:0;font:16px sans-serif}.wide{width:1800px;height:20px;background:#9cf}.box{width:80px;height:20px;overflow:hidden;white-space:nowrap}</style>
<body><h1>超重与失重</h1><div class="wide">太宽了</div><div class="box">这一行文字太长了会被截断看不全</div>
<img src="missing-figure.png"><button id="go" onclick="startDemo()">开始演示</button>
<input type="range" id="a" min="0" max="10" oninput="if (this.value == 10) throw new Error('加速度太大，滑块处理出错')">
<script>window.addEventListener('load', () => { null.f(); }); alert('欢迎');</script></body>`);
    const r = await call('task:t-full', 'page_check', { file: 'bad.html' });
    assert.ok(!r.isError, r.text);
    log(r.text);
    assert.match(r.text, /未捕获异常：TypeError/, '加载时的异常');
    assert.match(r.text, /startDemo is not defined[^\n]*← 点「开始演示」后/, '点按钮后的报错要对上是哪个按钮');
    assert.match(r.text, /加速度太大/, '拖滑块后的报错');
    assert.match(r.text, /missing-figure\.png（找不到文件）/, '找不到的图片');
    assert.match(r.text, /横向溢出：页面宽/, '横向溢出');
    assert.match(r.text, /文字溢出（被截断/, '文字溢出');
    assert.match(r.text, /提示框：欢迎/, 'alert 不弹出来，只记下');
    assert.match(r.text, /结论：发现 \d+ 个问题/);
    assert.ok(r.images?.length >= 2, '打开后和操作之后各一张');
    fs.writeFileSync(path.join(out, 'page-check-bad.png'), Buffer.from(r.images[0].data, 'base64'));
    mark('page_check 报出带报错 HTML 的问题', { images: r.images.length });
    const ok = await call('task:t-full', 'page_check', { file: 'ok.html', width: 390, height: 844, steps: [{ click: 'button' }, { shot: true }] });
    assert.match(ok.text, /结论：没有发现问题/, ok.text);
    assert.match(ok.text, /✓ 点 button/);
    mark('page_check 干净页面没有问题、steps 按顺序执行');
    fs.writeFileSync(path.join(work, 'cdn.html'), '<!doctype html><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script><body>x</body>');
    const off = await call('task:t-safe', 'page_check', { file: 'cdn.html', auto: false });
    assert.match(off.text, /cdn\.jsdelivr\.net[^\n]*安全模式不能联网/, off.text);
    const outside = await call('task:t-full', 'page_check', { file: 'C:\\Windows\\win.ini' });
    assert.ok(outside.isError, '任务文件夹外面的文件不能检查');
    mark('page_check 安全模式拦外网、拒绝任务文件夹外的文件');
  }

  log('— 5. 键鼠（假的键鼠组件，不动真鼠标）');
  // ── 5. 键鼠（假的键鼠组件，不动真鼠标） ─────────────────────
  {
    const { EventEmitter } = require('node:events');
    const fake = Object.assign(new EventEmitter(), { sent: [], password: false, started: 0,
      start() { this.started++; return Promise.resolve({ pid: 1 }); },
      abort() { this.sent.push('abort'); },
      async send(op, args) { this.sent.push(op); if (op === 'probe') return { ok: true, desktop: 'Default', at: { title: '记事本', exe: 'notepad.exe', pid: 4242, hwnd: 7 }, fg: { title: '记事本', exe: 'notepad.exe', pid: 4242, hwnd: 7 }, cursor: [10, 10], password: this.password }; if (this.stopUser && /click|type|key/.test(op)) return { ok: false, stopped: 'user' }; return { ok: true, cursor: [args.x || 0, args.y || 0] }; } });
    const { Desk } = require('../electron/desk.cjs');
    th.parts.desk = new Desk({ electron, host: th, helper: fake, log: { info() {}, warn() {} }, emit: (m) => th.emit(m) });
    assert.equal(th.settings.desk, false, '键鼠默认关');
    const p1 = call('task:t-full', 'desktop_click', { x: 10, y: 10 });
    await until(() => page('!!document.querySelector("[data-qa=aitools-confirm]")'), 8000, '键鼠授权卡片');
    await shot('desk-confirm.png');
    await page('document.querySelector("[data-qa=aitools-confirm-deny]").click(), true');
    const r1 = await p1;
    assert.ok(r1.isError && r1.code === 'declined', JSON.stringify(r1));
    assert.ok(!fake.sent.includes('click'), '拒绝后不能点');
    mark('键鼠关着时弹卡片，点「不允许」被拒');
    const p2 = call('task:t-full', 'desktop_click', { x: 10, y: 10 });
    await until(() => page('!!document.querySelector("[data-qa=aitools-confirm-once]")'), 8000, '第二张卡片');
    await page('document.querySelector("[data-qa=aitools-confirm-once]").click(), true');
    const r2 = await p2;
    assert.ok(!r2.isError, r2.text);
    assert.ok(fake.sent.includes('guard') && fake.sent.includes('click'), '同意后先装键鼠监测再点击');
    await until(() => page('!!document.querySelector("[data-qa=aitools-desk]")'), 5000, '顶栏键鼠状态条');
    mark('点「这次允许」后能点击，顶栏显示键鼠状态');
    fake.password = true;
    const pw = await call('task:t-full', 'desktop_type', { text: 'secret' });
    assert.ok(pw.isError && pw.code === 'password', '密码框不打字');
    fake.password = false;
    mark('焦点在密码框时拒绝打字');
    fake.emit('event', { event: 'user', kind: 'mouse' });
    await until(() => th.parts.desk.state()?.paused, 3000, '老师动键鼠后暂停');
    const r3 = await call('task:t-full', 'desktop_key', { keys: 'ctrl+s' });
    assert.ok(r3.isError && r3.code === 'paused', '暂停时不能继续操作');
    await page('[...document.querySelectorAll("[data-qa=aitools-desk] button")].find(b=>b.textContent.includes("继续")).click(), true');
    await until(() => th.parts.desk.state() && !th.parts.desk.state().paused, 3000, '点继续');
    const r4 = await call('task:t-full', 'desktop_key', { keys: 'ctrl+s' });
    assert.ok(!r4.isError, r4.text);
    const bad = await call('task:t-full', 'desktop_key', { keys: 'ctrl+alt+delete' });
    assert.ok(bad.isError, '安全键不能按');
    mark('老师动键鼠就暂停，点「继续」后接着做；安全键被拒');
    const saveIn = th.inClass; th.inClass = () => '正在录课';
    const cls = await call('task:t-full', 'desktop_click', { x: 1, y: 1 });
    th.inClass = saveIn;
    assert.ok(cls.isError && cls.code === 'class', '上课中不能用键鼠');
    mark('上课中拒绝键鼠');
    const safeDesk = await call('task:t-safe', 'desktop_click', { x: 1, y: 1 });
    assert.ok(safeDesk.isError && /安全模式/.test(safeDesk.text));
    th.parts.desk.stopAll('测试结束');
    await until(() => page('!document.querySelector("[data-qa=aitools-desk]")'), 5000, '状态条消失');
    mark('安全模式没有键鼠；停止后状态条消失');
  }

  log('— 5b. 真的键鼠（人工验收时 CS_DESK_REAL=1）');
  // ── 5b. 真的键鼠（人工验收时 CS_DESK_REAL=1） ───────────────
  if (process.env.CS_DESK_REAL === '1') {
    assert.equal(process.env.CS_DESK_PRECHECK_CONFIRMED, '1', '须先获得本次授权并人工检查截图；不沿用旧授权');
    const acceptance = require('./desk-acceptance.cjs');
    const { Desk } = require('../electron/desk.cjs');
    th.parts.desk = new Desk({ electron, host: th, dir: path.join(out, 'desk-helper'), log: { info: (...a) => log('[desk]', ...a), warn: (...a) => log('[desk warn]', ...a) }, emit: (m) => th.emit(m) });
    th.register('task:t-desk', { title: '键鼠测试', work, perm: 'full', source: 'task' });
    th.setSettings({ desk: true });
    try {
      const front = await th.parts.desk.helper.send('probe', { focus: true });
      acceptance.preflight(front, th.parts.desk.displays(), true);
    } catch (e) {
      th.setSettings({ desk: false }); th.parts.desk.helper.stop(); throw e;
    }
    const target = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'desk-target.cjs')], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    target.stderr.on('data', () => {});
    const lines = []; target.stdout.setEncoding('utf8'); target.stdout.on('data', (d) => lines.push(...String(d).split(/\r?\n/).filter(Boolean)));
    try {
      const ready = JSON.parse((await until(() => lines.find((l) => l.startsWith('READY ')), 30000, '靶子窗口')).slice(6));
      assert.ok(ready.focused, '靶子未取得焦点，禁止尝试点击激活');
      const cap = await call('task:t-desk', 'screen_capture', {});
      assert.ok(!cap.isError, cap.text);
      const policy = require('../electron/desk-policy.cjs'), { listDisplays } = require('../electron/displays.cjs');
      const list = listDisplays(electron.screen), shots = th.parts.desk.shots.get('task:t-desk').sizes;
      const toShot = (r) => acceptance.targetPoint(r, list, shots);
      const pb = toShot(ready.btn), pi = toShot(ready.inp);
      log('  靶子', JSON.stringify(ready), '截图尺寸', JSON.stringify(shots), '换算', JSON.stringify(pb), '屏幕', JSON.stringify(list.map((d) => ({ i: d.index, phys: d.phys, scale: d.scale }))));
      const checkAt = async (p) => {
        const xy = th.parts.desk.point({key:'task:t-desk'}, {x:p.x,y:p.y,display:p.index}, list);
        acceptance.requireTarget(await th.parts.desk.helper.send('probe', {...xy,focus:true}), ready, true);
      };
      await checkAt(pb);
      const c = await call('task:t-desk', 'desktop_click', { x: pb.x, y: pb.y, display: pb.index });
      log('  点击结果', c.text, '靶子输出', lines.join(' | '));
      assert.ok(!c.isError, c.text);
      await sleep(1500); log('  点击后靶子输出', lines.join(' | '));
      await until(() => lines.includes('CLICKED'), 8000, '靶子按钮被点中');
      await checkAt(pi);
      const ic = await call('task:t-desk', 'desktop_click', { x: pi.x, y: pi.y, display: pi.index });
      assert.ok(!ic.isError, ic.text);
      await checkAt(pi);
      const t = await call('task:t-desk', 'desktop_type', { text: 'abc' });
      assert.ok(!t.isError, t.text);
      await until(() => lines.some((l) => l === 'TYPED:abc'), 8000, '靶子输入框收到 abc');
      // 不把 Electron 的桌面 DIP 坐标误当截图像素来恢复光标，也不做额外真实移动。
      mark('真的键鼠：在单独进程的靶子窗口里点中按钮、打字', { btn: pb, typed: 'abc' });
    } finally {
      th.parts.desk.stopAll('测试结束'); th.setSettings({ desk: false });
      th.parts.desk.helper.stop();
      try { target.kill(); } catch { /* 已退出 */ }
    }
  }

  log('— 6. 工坊给内核的参数');
  // ── 6. 工坊给内核的参数 ─────────────────────────────────────
  {
    const ag = api.agents;
    const mk = (engine, permission) => ({ id: 't-' + engine + permission, engine, permission, work, title: 'x', kind: '', pick: '', effort: '', cap: 5, cny: 0, session: '', nextImages: [] });
    const cf = ag.args(mk('codex', 'full'), 'hi').join(' ');
    assert.match(cf, /web_search="live"/); assert.match(cf, /mcp_servers\.cs_tools\.command=/); assert.match(cf, /default_tools_approval_mode="approve"/);
    assert.ok(!cf.includes(th.tokenFor('task:t-codexfull')), '令牌不能出现在命令行里');
    assert.match(cf, /page_check/, '开发者指令里要写工具说明');
    const cs = ag.args(mk('codex', 'safe'), 'hi').join(' ');
    assert.match(cs, /web_search="disabled"/);
    const env = ag.env(mk('codex', 'full'));
    assert.equal(env.CS_TOOLS_TOKEN, th.tokenFor('task:t-codexfull'));
    const cl = ag.args(mk('claude', 'full'), 'hi');
    const cfg = cl[cl.indexOf('--mcp-config') + 1];
    assert.ok(fs.existsSync(cfg) && JSON.parse(fs.readFileSync(cfg, 'utf8')).mcpServers.cs_tools, 'Claude 的 MCP 配置文件');
    assert.match(cl[cl.indexOf('--allowedTools') + 1], /mcp__cs_tools(,|$)/);
    const cls = ag.args(mk('claude', 'safe'), 'hi');
    assert.match(cls[cls.indexOf('--allowedTools') + 1], /mcp__cs_tools__page_check/);
    assert.doesNotMatch(cls[cls.indexOf('--allowedTools') + 1], /mcp__cs_tools(,|$)/);
    mark('工坊 Codex / Claude 参数按档位带上联网搜索和 cs_tools');
  }

  log('— 7. 设置开关');
  // ── 7. 设置开关 ─────────────────────────────────────────────
  {
    await page('document.querySelector(".rail button[aria-label=\\"AI\\"], .rail [data-tip=\\"AI\\"]")?.click(), true').catch(() => {});
    await th.setSettings({ browser: false });
    assert.ok(!th.caps('task:t-full').groups.includes('browser'));
    const r = await call('task:t-full', 'browser_open', { url: 'https://example.com/' });
    assert.ok(r.isError && /关掉了内置浏览器/.test(r.text));
    th.setSettings({ browser: true, search: false });
    assert.ok(!th.caps('task:t-full').groups.includes('web') && !th.nativeSearch('full'));
    th.setSettings({ search: true });
    assert.ok(fs.existsSync(path.join(DATA, 'ai-tools.json')));
    mark('AI 设置里的开关：关掉浏览器 / 搜索后不再提供');
  }

  const own = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  if (own.length) log('教师窗口报错：', own);
  assert.equal(own.length, 0, '教师窗口不能有报错');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  log(`ALL PASS ${results.length} 项，输出在 ${out}`);
  clearTimeout(timer);
  app.exit(0);
})().catch((e) => fatal('test', e));
