// 1.7.0 B 真实验收（花钱，不进 run-all）：用工坊真跑「互动课件」「练习题」两种成品，主题「超重与失重」，
// 走新技能、课件设计包、每轮自检和来源核对；Key 用 .real\data 副本里的配置，模型 gpt-6-astra。
// 成品、事件记录、逐页截图放 CS_REAL_OUT（默认系统临时目录 cs-real170b）。
// 用法：CS_DIST=.out/dist-me npx electron test/quiet.cjs test/v170b-real-workshop.cjs [html|quiz]
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const REAL = process.env.CS_REAL_DATA || path.resolve(__dirname, '../../.real/data');
const root = process.env.CS_REAL_OUT || path.join(os.tmpdir(), 'cs-real170b'), DATA = path.join(root, 'data'), OUT = path.join(root, 'out-' + Date.now());
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(path.join(DATA, 'browser'), { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(path.join(REAL, 'browser', 'Local State'))) fs.copyFileSync(path.join(REAL, 'browser', 'Local State'), path.join(DATA, 'browser', 'Local State'));
for (const f of ['ai.json', 'ai-budget.json']) fs.copyFileSync(path.join(REAL, f), path.join(DATA, f));
const MODEL = process.env.CS_REAL_MODEL || 'gpt-6-astra';
{ const f = path.join(DATA, 'ai.json'), j = JSON.parse(fs.readFileSync(f, 'utf8')); j.model = MODEL; fs.writeFileSync(f, JSON.stringify(j, null, 2)); }
fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [], slots: [], learning: {} } }));
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = DATA;
const electron = require('electron'); const { app, BrowserWindow } = electron;
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* 再等 */ } await sleep(1000); } throw Error('timeout'); };
setTimeout(() => { console.error('timeout'); app.exit(1); }, 70 * 60000);

const CONTEXT = `# 任务背景（导播台自动生成）

老师：一对一高中物理家教，课上通过腾讯会议共享画面。

学生：小林
年级：高一
学科：高中物理
教材：人教版 2019 必修第一册
已上课：12 次
上次课：牛顿第二定律的应用
标签：计算细心、受力分析时爱漏力、方向判断容易乱

## 本学科约定
排版主题：Markdown 成品第一行写 <!-- cs:theme=physics -->
题型（题库文件的 qtype 只能用这些）：选择、填空、计算、实验、其他
难度：1 基础、2 巩固、3 中档、4 较难、5 压轴
出原创题的要求：情境真实、数据合理，g 取 10 m/s²
答案写法：选择题写选项字母；计算题写最终结果和单位

输出要求：所有文件保存在当前文件夹；文件名用中文。需要真题、教研资料时按工作手册联网查找并标出处（安全模式不能联网）。`;
const T = '超重与失重', who = '高一学生', book = '人教版 2019';
const JOBS = {
  html: { skill: 'courseware-html', formats: [], prompt: `给${who}上「${T}」新课用，教材${book}。做一份单文件 HTML 互动课件，学生在微信里点开就能用，上课我也直接共享这个文件。\n8～10 页，从生活现象引入；至少一页能拖参数的仿真动画（按真实公式算，读数跟着变）；公式清楚，推导一步步出现；最后 3 道点选小测，点了马上出对错和解析。\n保存为「${T}.html」。` },
  quiz: { skill: 'practice-set', formats: ['docx', 'pdf'], prompt: `给${who}课后巩固「${T}」用，教材${book}。出一套分层练习：基础 5 题 + 提高 3 题 + 拓展 2 题，优先从近三年本地区的期中期末、教研网公开的真题里选，每题标出处（卷名、年份、地区、题号、网址），找不到的用原创补并标「原创」，不要编出处。\n解析写关键步骤和易错点；另出一份学生手机看的长图版。\n文件：「${T}-练习.md」「${T}-答案.md」「${T}-题库.json」「${T}-学生长图.md」。` },
};

async function shotHtml(file, dir) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } });
  await win.loadFile(file); await sleep(1500);
  const n = await win.webContents.executeJavaScript('window.CS && CS.deck ? CS.deck.pages.length : 0');
  for (let i = 0; i < Math.max(1, n); i++) {
    if (n) await win.webContents.executeJavaScript(`CS.go(${i}, { fromEnd: true }); (CS._sims||[]).forEach(function(s){ if (s.canvas.el.closest('.cs-page.on')) { s.play && s.play(); } })`);
    await sleep(1400);
    fs.writeFileSync(path.join(dir, `页${String(i + 1).padStart(2, '0')}.png`), (await win.webContents.capturePage()).toPNG());
  }
  win.setContentSize(390, 844); await sleep(800);
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  fs.writeFileSync(path.join(dir, '手机-首屏.png'), (await win.webContents.capturePage()).toPNG());
  win.destroy();
  return n;
}

(async () => {
  const api = await until(() => globalThis.classroomStudioTest);
  const agents = api.agents;
  const which = process.argv.filter((a) => JOBS[a]); const list = which.length ? which : Object.keys(JOBS);
  const report = { model: MODEL, jobs: {} };
  const started = list.map((k) => ({ k, t: agents.start({ engine: 'codex', title: T + ' · ' + k, prompt: JOBS[k].prompt, context: CONTEXT, cap: 3.5, useStudioKey: true, formats: JOBS[k].formats, model: MODEL, permission: 'full', skill: JOBS[k].skill, effort: 'high' }) }));
  for (const { k, t } of started) {
    const t0 = Date.now();
    await until(() => { const x = agents.tasks.get(t.id); return ['done', 'failed', 'stopped', 'budget'].includes(x.status) && !x.child && !x.exporting && (x.status !== 'done' || x.selfCheck); }, 60 * 60000);
    await sleep(15000); // 等导出（autoExport 在自检之后）
    await until(() => !agents.tasks.get(t.id).exporting, 5 * 60000);
    const x = agents.tasks.get(t.id), dir = path.join(OUT, k);
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(x.work, path.join(dir, '成果'), { recursive: true, filter: (s) => !/[\\/]\.(agents|claude)([\\/]|$)/.test(s) && !/[\\/]\.cs-kit([\\/]|$)/.test(s) });
    fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(x.events, null, 1));
    const html = agents.files(t.id).find((f) => /\.html$/i.test(f.name) && !f.name.includes('/'));
    if (html) { const shots = path.join(dir, '截图'); fs.mkdirSync(shots, { recursive: true }); report.jobs[k] = { pages: await shotHtml(html.path, shots) }; }
    report.jobs[k] = { ...(report.jobs[k] || {}), status: x.status, turns: x.turns, cny: x.cny, model: x.model, minutes: Math.round((Date.now() - t0) / 60000), selfCheck: x.selfCheck, files: agents.files(t.id).map((f) => f.name + ' ' + Math.round(f.size / 1024) + 'KB'), outs: x.events.filter((e) => ['out', 'note', 'error'].includes(e.kind)).map((e) => e.kind + '：' + e.text.slice(0, 300)), last: x.events.filter((e) => e.kind === 'text').slice(-1)[0]?.text };
    console.log(k, JSON.stringify(report.jobs[k], null, 1));
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('OUT', OUT);
  app.exit(0);
})().catch((e) => { console.error(e); app.exit(1); });
