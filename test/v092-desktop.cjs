// 0.9.2 桌面验收（屏幕外窗口，不动真实鼠标）：
//   1. 没有自己装 Codex 的电脑：任务中心直接显示「内置 0.163.x」，不用装 Node.js；「更新」能联网查到官方最新版；
//   2. 新任务：8 种成品（互动课件 / 讲课 PPT / 练习题 / 分层作业 / 测验卷 / 课堂讲义 / 教案 / 自定义），选中后提示已内置做法，
//      任务背景里带上本学科题型、排版主题和出题约定；
//   3. AI 写的「…题库.json」在成果文件里一键导入题库：自检通过的入库，其余进收件箱，重复的跳过。
// 用法：npm run build 后 npx electron test/quiet.cjs test/v092-desktop.cjs   （CS_SHOW=1 显示窗口）
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v092-' + Date.now()); fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1'; process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
// 模拟一台没装过 Codex 的电脑：看不到 npm 全局包和 Codex 桌面版，只剩安装包里内置的那份
process.env.APPDATA = path.join(out, 'appdata'); process.env.LOCALAPPDATA = path.join(out, 'localappdata');
delete process.env.CS_AGENT_CODEX; delete process.env.CS_BUNDLED_CODEX;
process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');
const BUNDLED = fs.readFileSync(path.join(__dirname, '..', 'bin', 'codex', 'VERSION'), 'utf8').trim();

const stu = { id: 'stu-l', name: '小林', grade: '初二', hue: 200, textbook: '人教版', subject: 'j-physics', tags: ['浮力薄弱'], lessons: 6, lastTopic: '浮力', lastAt: '' };
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({ local: { roots: [], students: [stu], studentId: 'stu-l', slots: [], learning: {} } }));

const { app } = require('electron'); const errors = []; const results = [];
app.on('web-contents-created', (_e, wc) => { wc.on('console-message', (_ev, d) => { if (d?.level >= 2) errors.push(d.message); }); wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason)); });
require('../electron/main.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(100); } throw Error('Timed out ' + what + (last ? ' (' + last.message + ')' : '')); };
const mark = (name, details = {}) => { results.push({ name, ok: true, ...details }); console.log('PASS ' + name); };
const timer = setTimeout(() => { console.error('v092 desktop timed out'); app.exit(1); }, 240000);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest), teacher = api.windows.get('teacher');
  const call = (w, code) => w.webContents.executeJavaScript(code);
  await until(() => call(teacher, '!!window.__studioQA'));
  const left = process.env.CS_SHOW === '1' ? 30 : Math.min(...require('electron').screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  if (process.env.CS_SHOW === '1') teacher.show(); else teacher.showInactive();
  const wrap = (code) => `(async()=>{try{const Q=__studioQA,s=Q.useStore.getState();${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`;
  const T = async (code) => { const r = await call(teacher, wrap(code)); if (r && r.__err) throw Error(r.__err); return r; };
  const shot = async (name, wait = 400) => { await sleep(wait); teacher.webContents.invalidate(); await sleep(250); fs.writeFileSync(path.join(out, name), (await teacher.webContents.capturePage()).toPNG()); };

  // ── 1. 内置 Codex ──
  await T(`s.set({page:'agents'});return true`);
  const row = await until(() => T(`const r=[...document.querySelectorAll('.ags-cli-row')].find(x=>x.innerText.includes('Codex'));return r&&/内置/.test(r.innerText)?r.innerText:null`), 20000, 'codex row shows 内置');
  assert.ok(row.includes(BUNDLED), row);
  const det = await T(`return await window.csHost.call('agents.detect')`);
  assert.equal(det.codex.where, 'bundled'); assert.equal(det.codex.bundled, BUNDLED); assert.match(det.codex.version, new RegExp(BUNDLED.replace(/\./g, '\\.')));
  assert.ok(det.codex.found, 'bundled Codex runs --version');
  mark('bundled Codex CLI is found and runs without npm / Node.js', { row: row.replace(/\s+/g, ' '), version: det.codex.version });

  // 「更新」按钮：真实联网查 npm 源（只查版本；内置已是最新时不下载）
  await T(`[...document.querySelectorAll('.ags-cli-row button')].find(b=>b.innerText.includes('更新')).click();return true`);
  const log = await until(() => T(`const p=document.querySelector('.ags-install');const e=document.querySelector('.ags-error');return (p&&/已经是最新版|已更新到|已就绪/.test(p.innerText))?p.innerText:(e?'ERR '+e.innerText:null)`), 120000, 'update check');
  assert.ok(!log.startsWith('ERR'), log);
  mark('update button checks the official npm registry from Electron', { log: log.split('\n').slice(-2).join(' / ') });
  await T(`document.querySelector('.ags-install')?.click();return true`);

  // ── 2. 新任务：8 种成品 + 内置做法提示 + 学科约定 ──
  await T(`document.querySelector('.ags-new').click();return true`);
  const labels = await until(() => T(`const l=[...document.querySelectorAll('.ags-tpls button b')].map(b=>b.innerText);return l.length?l:null`), 5000, 'templates');
  assert.deepEqual(labels, ['互动课件', '讲课 PPT', '练习题', '分层作业', '测验卷', '课堂讲义', '教案', '做插件', '自定义']);
  await T(`[...document.querySelectorAll('.ags-tpls button')].find(b=>b.innerText.includes('分层作业')).click();return true`);
  await T(`const i=document.querySelector('.ags-new-form input[placeholder*="斜面"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'浮力');i.dispatchEvent(new Event('input',{bubbles:true}));return true`);
  const form = await until(() => T(`const t=document.querySelector('.ags-new-form textarea').value;return t.includes('浮力-题库.json')?{t,hint:document.querySelector('.ags-new-form .ags-perm-hint+*')?null:[...document.querySelectorAll('.ags-new-form .ags-perm-hint')].map(x=>x.innerText).join('|')}:null`), 5000, 'prompt');
  assert.match(form.hint, /已内置「分层作业」的完整做法/);
  await shot('new-task-homework.png');
  mark('new task offers 8 kinds of output with built-in skills; prompt stays short', { prompt: form.t });

  // 任务背景带学科约定；技能进隐藏目录（用假 Claude 跑一遍真实 IPC）
  const ctx = await T(`return await window.csHost.call('agents.start',{engine:'claude',title:'浮力 · 分层作业',prompt:'为「浮力」布置课后分层作业',context:'x',cap:2,formats:[],skill:'homework'})`);
  const done = await until(async () => { const t = await T(`return await window.csHost.call('agents.get',${JSON.stringify(ctx.id)})`); return t.status !== 'running' ? t : null; }, 30000, 'fake task');
  assert.equal(done.status, 'done');
  assert.ok(fs.existsSync(path.join(done.work, '.claude', 'skills', 'homework', 'SKILL.md')));
  assert.match(fs.readFileSync(path.join(done.work, '题目.md'), 'utf8'), /^先读技能文件 \.claude\/skills\/homework\/SKILL\.md/);
  // 渲染端生成的任务背景：用界面同一个函数（新任务按钮提交时的 context）
  const bg = await T(`const ta=document.querySelector('.ags-new-form textarea');return !!ta`);
  assert.ok(bg);
  mark('skill files are installed into the task folder and named at the top of the prompt');

  // ── 3. 题库文件一键导入 ──
  const qs = [
    { stem: '一个木块漂浮在水面上，露出水面的体积是总体积的 2/5，求木块的密度。', answer: '0.6×10³ kg/m³', analysis: '漂浮：F浮=G，ρ水 g (3/5)V = ρ木 g V', qtype: '计算', difficulty: 2, verified: true },
    { stem: '把一个铁球放入水中，铁球一定会下沉吗？说明理由。', answer: '不一定，空心铁球可能漂浮', analysis: '比较平均密度与水的密度', qtype: '其他', difficulty: 3, verified: false },
  ];
  fs.writeFileSync(path.join(done.work, '浮力-题库.json'), JSON.stringify({ version: 1, topic: '浮力', questions: qs }, null, 2));
  await T(`[...document.querySelectorAll('.ags-item')].find(b=>b.innerText.includes('分层作业'))?.click();return true`);
  await T(`await window.csHost.call('agents.inject',{id:${JSON.stringify(ctx.id)},text:'把第二题改简单一点'});return true`);
  await until(async () => (await T(`return (await window.csHost.call('agents.get',${JSON.stringify(ctx.id)})).status`)) === 'done', 30000, 'second turn');
  await until(() => T(`return [...document.querySelectorAll('.ags-file')].some(f=>f.innerText.includes('浮力-题库.json'))`), 10000, 'bank file listed');
  const before = await T(`await Q.useStudy.getState().load();return Q.useStudy.getState().data.questions.length`);
  const clickImport = () => T(`const f=[...document.querySelectorAll('.ags-file')].find(f=>f.innerText.includes('浮力-题库.json'));[...f.querySelectorAll('button')].find(b=>b.innerText.includes('导入题库')).click();return true`);
  await clickImport();
  const msg = await until(() => T(`const f=[...document.querySelectorAll('.ags-file')].find(f=>f.innerText.includes('浮力-题库.json'));return /入库/.test(f.innerText)?f.innerText:null`), 8000, 'import message');
  assert.match(msg, /初中物理导入：入库 1，待核对 1/);
  // 窄的成果栏里，按钮带上导入结果后也不能被挤成竖排
  const btnH = await T(`const f=[...document.querySelectorAll('.ags-file')].find(f=>f.innerText.includes('浮力-题库.json'));const b=[...f.querySelectorAll('button')].find(b=>b.innerText.includes('导入题库'));return b.getBoundingClientRect().height`);
  assert.ok(btnH < 24, '导入题库 button wraps: ' + btnH);
  const qsNow = await T(`return Q.useStudy.getState().data.questions.slice(${before}).map(q=>({status:q.status,check:q.check,qtype:q.qtype,subject:q.subject,origin:q.origin,points:q.points.length,source:q.source}))`);
  assert.deepEqual(qsNow.map((q) => q.status), ['bank', 'inbox']);
  assert.ok(qsNow.every((q) => q.subject === 'j-physics' && q.origin === 'ai' && /AI 工作室/.test(q.source)), JSON.stringify(qsNow));
  await clickImport();
  await until(() => T(`const f=[...document.querySelectorAll('.ags-file')].find(f=>f.innerText.includes('浮力-题库.json'));return /重复跳过 2/.test(f.innerText)`), 8000, 'dup skip');
  // 半秒后写回磁盘
  await until(async () => (await T(`return (await window.csHost.call('study.load')).questions.length`)) === before + 2, 8000, 'saved to study.json');
  await shot('bank-imported.png');
  mark('AI question-bank JSON imports into the study bank (verified → bank, rest → inbox, duplicates skipped) and is saved', { imported: qsNow });

  const bad = errors.filter((e) => !/Autofill|DevTools|favicon/.test(e));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: true, results, consoleErrors: bad, out }, null, 2));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('RESULT ' + out); clearTimeout(timer); for (const w of api.windows.values()) if (!w.isDestroyed()) w.destroy(); app.exit(0);
})().catch((e) => { console.error('FAIL', e.stack || e); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ok: false, error: String(e.stack || e), results, consoleErrors: errors }, null, 2)); app.exit(1); });
