// 1.7.0 AI 工具真跑（花真钱，不在回归里跑）：用工坊真跑一个小任务，确认模型真的用了联网搜索 / 浏览器、出处能打开。
//   「查一道 2024 年北京高一物理期中关于超重失重的公开真题并附出处网址」，Codex + 导播台 AI 接口，常用权限，单任务上限 ¥3
//   CS_REAL_CLAUDE=1 时再用 Claude Code 跑一个很小的 page_check 任务，确认 Claude 内核也拿到了 cs_tools
// Key：测试进程在内存里读老师配好的 AI 接口（test/relay-key.cjs，只读 H:\ClassroomStudioData 的 ai.json 和 Local State，
//      不复制任何文件），经环境变量交给软件；测试数据目录里没有 ai.json。
// 用法：CS_DIST=.out/dist-me CS_TEST_OUT=.out/tools-real npx electron test/quiet.cjs test/v170-tools-real.cjs
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v170-real-' + Date.now()); fs.mkdirSync(out, { recursive: true });
const LOG = path.join(out, 'test.log');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'); fs.appendFileSync(LOG, s + '\n'); console.log(s); };
const electron = require('electron'); const { app, dialog } = electron;
dialog.showErrorBox = (t, c) => log('（已拦下错误框）', t, c);
const fatal = (why, e) => { log('FAIL', why, String(e?.stack || e)); app.exit(1); };
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));
try { Object.assign(process.env, require('./relay-key.cjs').relayEnv()); } catch (e) { fatal('读 AI 接口', e); }
if (!process.env.CS_TEST_RELAY_KEY) fatal('读 AI 接口', '本机还没有配置 AI 接口');
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
// 用一个干净的 Codex 目录，不碰老师本机 ~/.codex 的配置和会话记录
process.env.CODEX_HOME = path.join(out, 'codex-home'); fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ settings: { autoAnalyze: false, autoMap: false, transcribe: false }, local: { roots: [], students: [], slots: [], learning: {} } }));
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(1000); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const timer = setTimeout(() => fatal('timeout', '30 分钟没跑完'), 30 * 60000);

async function runTask(api, o) {
  const t0 = api.agents.start({ useStudioKey: true, formats: [], context: '# 任务背景（测试）\n\n学生：高一，北京，人教版 2019。', ...o });
  log('任务开始', t0.id, o.engine, o.permission);
  const t = await until(() => { const x = api.agents.get(t0.id); return x.status !== 'running' && !x.exporting ? x : null; }, 25 * 60000, '任务结束');
  for (const e of t.events) if (e.kind !== 'think') log(`  [${e.kind}]`, String(e.text).slice(0, 300).replace(/\n/g, ' / '));
  log('任务结束', t.status, `¥${t.cny}`, t.model, t.note || '');
  return t;
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest, 30000, '软件启动');
  await until(() => api.toolHost?.host, 10000, 'AI 工具接口');
  const det = await api.agents.detect();
  log('内核', JSON.stringify({ codex: det.codex.version, claude: det.claude.found ? det.claude.version : '无' }));
  // CS_REAL_ONLY=assistant：只用小羽（Codex app-server）跑一轮 page_check，花几毛钱确认小羽也拿到了 cs_tools
  if (process.env.CS_REAL_ONLY === 'assistant') {
    const as = api.assistant;
    fs.writeFileSync(path.join(as.work, 'hello.html'), '<!doctype html><meta charset="utf-8"><title>hi</title><body><h1>你好</h1><button onclick="nope()">点我</button></body>');
    const c = as.create({ title: '工具测试' });
    await as.send({ id: c.id, text: '用 cs_tools 的 page_check 工具检查当前文件夹里的 hello.html，把报告里「结论」那一行原样告诉我，别的不用做。', access: 'common', effort: 'low', studio: true });
    await until(() => !as.get(c.id).running, 5 * 60000, '小羽这一轮');
    const items = as.get(c.id).items;
    for (const it of items) log(`  [${it.kind}]`, it.label || it.name || '', String(it.text || it.output || '').slice(0, 200).replace(/\n/g, ' / '));
    const tool = items.find((x) => x.kind === 'tool' && x.name === 'page_check');
    assert.ok(tool && tool.status === 'done', '小羽要真的调用了 page_check');
    assert.match(items.filter((x) => x.kind === 'text').map((x) => x.text).join('\n'), /结论/);
    log('ALL PASS assistant', `¥${as.get(c.id).cny}`);
    clearTimeout(timer); app.exit(0); return;
  }
  const t = await runTask(api, { engine: 'codex', title: '超重失重真题', permission: 'full', cap: 3, prompt: '查一道 2024 年北京高一物理期中关于超重失重的公开真题并附出处网址。把题目原文、答案（网页上有的话）和出处网址写进「超重失重真题.md」。只要一道，找到就收尾。' });
  const tools = t.events.filter((e) => e.kind === 'tool').map((e) => e.text);
  assert.ok(tools.some((x) => /^(联网)?搜索|^抓网页|^浏览器/.test(x)), '模型要真的用了搜索或浏览器：' + tools.join(' | '));
  const src = path.join(t.work, '资料', '来源');
  assert.ok(fs.existsSync(src) && fs.readdirSync(src).length > 0, '资料/来源 里要有存档');
  const md = path.join(t.work, '超重失重真题.md');
  const answer = [fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '', ...t.events.filter((e) => e.kind === 'text').map((e) => e.text)].join('\n');
  const urls = [...new Set([...answer.matchAll(/https?:\/\/[^\s)）\]>"'，。]+/g)].map((m) => m[0].replace(/[.,;]$/, '')))];
  assert.ok(urls.length, '回答里要有出处网址');
  const ses = electron.session.fromPartition('persist:cs-web');
  const checked = [];
  for (const u of urls.slice(0, 5)) {
    let status = 0; try { status = (await ses.fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000) })).status; } catch (e) { status = -1; log('打不开', u, e.message); }
    checked.push({ u, status });
  }
  log('出处网址', checked);
  assert.ok(checked.some((c) => c.status >= 200 && c.status < 400), '至少一个出处能打开');
  assert.ok(t.cny <= 3.05, `花费要在 ¥3 以内（实际约 ¥${t.cny}）`);
  const result = { task: t.id, status: t.status, cny: t.cny, model: t.model, tools, sources: fs.readdirSync(src), urls: checked, file: fs.existsSync(md) ? md : '' };
  if (process.env.CS_REAL_CLAUDE === '1' && det.claude.found) {
    const c = await runTask(api, { engine: 'claude', title: 'Claude 自检', permission: 'safe', cap: 0.5, model: process.env.CS_CLAUDE_MODEL || 'claude-3-5-haiku-20241022', prompt: '写一个很小的 hello.html（一个标题、一个按钮，点按钮改标题），然后用 cs_tools 的 page_check 工具检查它，把检查结论那一行原样告诉我。不要做别的。' });
    result.claude = { status: c.status, cny: c.cny, tools: c.events.filter((e) => e.kind === 'tool').map((e) => e.text) };
    log('Claude', result.claude);
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  log('ALL PASS', JSON.stringify({ cny: t.cny, urls: checked.length }), out);
  clearTimeout(timer);
  app.exit(0);
})().catch((e) => fatal('test', e));
