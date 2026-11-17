// 1.7.0 B.2.2 / B.2.4 工坊成品自检：每轮结束自动打包 HTML、核对题库出处、检查公式，有问题自动让 AI 修（最多 2 轮），
// 报「找到真题 N 道，来源核对过 M 道，原创 K 道」；任务文件夹里装好课件设计包 .cs-kit，打包工具能用导播台自己的程序跑。
// 纯 Node + 假 CLI + 本机小网站，不联网。运行：node test/v170b-workshop.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-v170b-'));
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
process.env.CODEX_HOME = path.join(tmp, 'codex-home');
const { Agents } = require('../electron/agents.cjs');
const deliver = require('../electron/deliverCheck.cjs');

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok  ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '\n', e.stack); } };
const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('等待超时'); };

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html><body><p>海淀区 2024 年秋季教研通知，和题目无关。</p></body></html>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FAKE_SRC_URL = `http://127.0.0.1:${server.address().port}/paper.html`;
  const probed = [];
  const agents = new Agents({
    dir: path.join(tmp, 'agents'), emit: () => {},
    check: (t) => deliver.checkDeliverables(t.work, { since: (t.turnStart || 0) - 2000, skill: t.skill, fetch, probeHtml: async (f) => { probed.push(f); return { problems: [], note: '1 页' }; } }),
  });

  let task;
  await test('第一轮出处对不上 → 自动把问题清单发给 AI 修 → 第二轮改标原创后自检通过，报一句实话', async () => {
    task = agents.start({ engine: 'codex', prompt: '出超重与失重练习 BANKTEST', skill: 'practice-set', cap: 5 });
    await until(() => { const t = agents.tasks.get(task.id); return t.status === 'done' && !t.child && !t.exporting && t.events.some((e) => e.kind === 'out' && /成品自检通过/.test(e.text)); });
    const t = agents.tasks.get(task.id), texts = t.events.map((e) => e.text).join('\n');
    assert.match(texts, /成品自检发现 \d+ 个问题，已让 AI 自动修正（第 1 次）/);
    assert.match(texts, /找到真题 1 道，来源核对过 0 道，原创 0 道；1 道来源对不上/);
    assert.match(texts, /找到真题 0 道，来源核对过 0 道，原创 1 道/);
    const fixPrompt = t.events.filter((e) => e.kind === 'note' && /自动修正/.test(e.text));
    assert.equal(fixPrompt.length, 1);
    assert.equal(t.turns, 2);
    assert.equal(t.selfCheck.ok, true);
    const bank = JSON.parse(fs.readFileSync(path.join(t.work, '超重与失重-题库.json'), 'utf8'));
    assert.equal(bank.questions[0].source.check.label, '原创');
    assert.match(bank.sourceCheck.summary, /原创 1 道/);
  });

  await test('课件设计包装进任务文件夹（隐藏目录，不算成果）；HTML 每轮结束打包成单文件，源文件留在 .cs-src；打包工具用导播台的程序跑', async () => {
    const t = agents.tasks.get(task.id);
    for (const f of ['cs-deck.css', 'cs-deck.js', 'pack.cjs', 'pack.cmd', 'pack.sh', 'vendor/katex.min.js', '组件说明.md', '示例骨架.html']) assert.ok(fs.existsSync(path.join(t.work, '.cs-kit', f)), f);
    assert.ok(!agents.files(t.id).some((f) => f.name.startsWith('.cs-kit')), '设计包不该出现在成果文件里');
    const html = fs.readFileSync(path.join(t.work, '超重与失重.html'), 'utf8');
    assert.doesNotMatch(html, /href="\.cs-kit/); assert.match(html, /<style data-from="cs-deck.css">/); assert.match(html, /<script data-from="cs-deck.js">/);
    assert.ok(fs.existsSync(path.join(t.work, '.cs-src', '超重与失重.html')));
    assert.ok(probed.some((f) => f.endsWith('超重与失重.html')), '打包后的文件要过离屏自检');
    assert.equal(fs.readFileSync(path.join(t.work, 'env.log'), 'utf8'), process.execPath, 'CS_NODE 交给 CLI');
    // 打包工具：.cs-kit/pack.cmd 用 CS_NODE（这里就是 node）跑
    fs.writeFileSync(path.join(t.work, '.cs-src', '超重与失重.html'), fs.readFileSync(path.join(t.work, '.cs-src', '超重与失重.html'), 'utf8').replace('超重</h2>', '超重与失重</h2>'));
    const cmd = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', path.join(t.work, '.cs-kit', 'pack.cmd'), path.join('.cs-src', '超重与失重.html')]] : ['sh', [path.join(t.work, '.cs-kit', 'pack.sh'), path.join('.cs-src', '超重与失重.html')]];
    const out = execFileSync(cmd[0], cmd[1], { cwd: t.work, env: { ...process.env, CS_NODE: process.execPath }, encoding: 'utf8' });
    assert.match(out, /已打包/);
    assert.match(fs.readFileSync(path.join(t.work, '超重与失重.html'), 'utf8'), /超重与失重<\/h2>/);
  });

  await test('最多自动修 2 轮：一直修不好就停下来告诉老师；老师再发话时重新计数', async () => {
    const bad = new Agents({ dir: path.join(tmp, 'agents2'), emit: () => {}, check: async () => ({ files: ['x'], problems: ['第 2 页内容超出页面'], notes: [] }) });
    const t0 = bad.start({ engine: 'codex', prompt: '做个课件', cap: 5 });
    await until(() => { const t = bad.tasks.get(t0.id); return t.status === 'done' && !t.child && t.events.some((e) => e.kind === 'error' && /成品自检还有 1 个问题没解决/.test(e.text)); });
    const t = bad.tasks.get(t0.id);
    assert.equal(t.turns, 3);
    assert.equal(t.events.filter((e) => /已让 AI 自动修正/.test(e.text)).length, 2);
  });

  await test('Markdown 公式写错、引用不存在的图片 → 列进问题清单；改过的 Markdown 等自检结束后再导出', async () => {
    const work = path.join(tmp, 'md'); fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, '课件.md'), '# 超重\n\n$$F_N = \frac{m}{$$\n\n$\\frac{1}{2}mv^2$\n\n![电梯](配图/电梯.png)\n');
    const r = await deliver.checkDeliverables(work, { since: 0 });
    assert.equal(r.problems.length, 2, r.problems.join('\n'));
    assert.match(r.problems[0], /公式写错/); assert.match(r.problems[1], /图片不存在/);
  });

  await test('练习 / 作业 / 测验的题库每题必须写出处；其他成品的题库不强制', async () => {
    const work = path.join(tmp, 'bank'); fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, 'x-题库.json'), JSON.stringify({ questions: [{ stem: '题干一二三四五', answer: '1' }, { stem: '题干二三四五六', answer: '2', source: { kind: '原创' } }] }));
    const a = await deliver.checkDeliverables(work, { since: 0, skill: 'homework' });
    assert.match(a.problems.join('\n'), /第 1 题没写出处/);
    fs.utimesSync(path.join(work, 'x-题库.json'), new Date(), new Date());
    const b = await deliver.checkDeliverables(work, { since: 0, skill: 'lesson-notes' });
    assert.deepEqual(b.problems, []);
    fs.writeFileSync(path.join(work, 'y-题库.json'), '{ "questions": [ { "stem": "x", } ] }');
    const c = await deliver.checkDeliverables(work, { since: 0 });
    assert.match(c.problems.join('\n'), /不是合法的 JSON/);
  });

  server.close();
  const bad = results.filter((r) => r[0] !== 'ok');
  console.log(`RESULT ${results.length - bad.length}/${results.length} pass`);
  process.exit(bad.length ? 1 : 0);
})();
