// 0.9.2：内置 Codex CLI（选哪一份、在导播台里更新）、内置技能和工作手册、AI 出的题导入题库。
// 纯 Node，不启动 Electron，不联网（更新用假的 npm 源）。运行：node test/v092-agents.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-v092-'));
// 隔离老师自己的安装：没有 npm 全局包、PATH 里没有 codex.exe、没有 Codex 桌面版
process.env.APPDATA = path.join(tmp, 'appdata');
process.env.LOCALAPPDATA = path.join(tmp, 'localappdata');
process.env.PATH = path.dirname(process.execPath);
process.env.CODEX_HOME = path.join(tmp, 'codex-home');
delete process.env.CS_AGENT_CODEX; delete process.env.CS_AGENT_CLAUDE;

const { Agents, locate } = require('../electron/agents.cjs');
const { cmpVersion, stageCodex } = require('../electron/codexDist.cjs');
const kit = require('../electron/agentKit.cjs');

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.stack]); } };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('等待超时'); };

/** 一份假的 Codex 目录：bin/codex.exe 用 node.exe 冒充（--version 输出 node 的版本号） */
const NODE_VER = process.versions.node;
function fakeCodexDir(dir, ver) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(dir, 'bin', 'codex.exe'));
  fs.writeFileSync(path.join(dir, 'VERSION'), ver + '\n');
  return dir;
}

(async () => {
  await test('版本比较', () => {
    assert.ok(cmpVersion('0.163.0', '0.99.9') > 0);
    assert.equal(cmpVersion('0.163.0', '0.163.0'), 0);
    assert.ok(cmpVersion('', '0.1.0') < 0, '解析不了的当最旧');
  });

  const bundled = fakeCodexDir(path.join(tmp, 'bundled'), '0.163.0');
  process.env.CS_BUNDLED_CODEX = bundled;
  const tools = path.join(tmp, 'tools');

  await test('没有自己装的 Codex 时用内置的，不需要 node / npm', () => {
    const s = locate('codex', tools);
    assert.equal(s.where, 'bundled');
    assert.equal(s.version, '0.163.0');
    assert.equal(s.cmd, path.join(bundled, 'bin', 'codex.exe'));
    assert.deepEqual(s.pre, [], '直接运行 exe，不经过 node');
    assert.equal(locate('claude', tools), null, 'Claude 不内置');
  });

  await test('导播台更新下载的新版本优先于内置', () => {
    fakeCodexDir(path.join(tools, 'codex', '0.170.1'), '0.170.1');
    fakeCodexDir(path.join(tools, 'codex', '0.150.0'), '0.150.0');
    fs.mkdirSync(path.join(tools, 'codex', '0.180.0.new'), { recursive: true });
    const s = locate('codex', tools);
    assert.equal(s.where, 'private'); assert.equal(s.version, '0.170.1');
    fs.rmSync(path.join(tools, 'codex'), { recursive: true, force: true });
  });

  await test('老师自己用 npm 装的同版本 Codex 优先（登录和配置都在他自己的环境里），旧版本则让位给内置', () => {
    const pkg = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex');
    fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'bin', 'codex.js'), '');
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '0.163.0' }));
    assert.equal(locate('codex', tools).where, 'local');
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '0.120.0' }));
    assert.equal(locate('codex', tools).where, 'bundled');
    fs.rmSync(path.join(process.env.APPDATA, 'npm'), { recursive: true, force: true });
  });

  // 假的 npm 源：latest 和 <版本>-win32-x64 的元数据 + 一个按官方结构打的 tgz
  const pkgRoot = path.join(tmp, 'tgz-src');
  const vendor = path.join(pkgRoot, 'package', 'vendor', 'x86_64-pc-windows-msvc');
  fakeCodexDir(vendor, NODE_VER); fs.rmSync(path.join(vendor, 'VERSION'));
  fs.mkdirSync(path.join(vendor, 'codex-resources', 'voice'), { recursive: true });
  fs.writeFileSync(path.join(vendor, 'codex-resources', 'voice', 'big.dll'), 'x');
  fs.writeFileSync(path.join(vendor, 'codex-package.json'), JSON.stringify({ version: NODE_VER, target: 'x86_64-pc-windows-msvc' }));
  const tgz = path.join(tmp, 'codex.tgz');
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-czf', tgz, '-C', pkgRoot, 'package'], { windowsHide: true });
  const tgzBytes = fs.readFileSync(tgz);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(tgzBytes).digest('base64');
  const hits = [];
  const fakeFetch = (good) => async (url) => {
    hits.push(url);
    if (url.includes('npmmirror')) return new Response('down', { status: 503 });
    if (url.endsWith('/latest')) return Response.json({ version: NODE_VER });
    if (url.endsWith('-win32-x64')) return Response.json({ dist: { tarball: 'https://registry.npmjs.org/codex.tgz', integrity: good ? integrity : 'sha512-AAAA' } });
    if (url.endsWith('codex.tgz')) return new Response(tgzBytes, { headers: { 'content-length': String(tgzBytes.length) } });
    return new Response('nope', { status: 404 });
  };

  const events = [];
  const agents = new Agents({ dir: path.join(tmp, 'agents'), toolsDir: tools, fetch: fakeFetch(true), emit: (e) => events.push(e) });

  await test('更新：镜像源挂了换官方源，校验 sha512，跳过语音组件，装进工具目录并自动改用新版', async () => {
    const r = await agents.update('codex');
    assert.equal(r.updated, true); assert.equal(r.from, '0.163.0'); assert.equal(r.to, NODE_VER);
    const dir = path.join(tools, 'codex', NODE_VER);
    assert.ok(fs.existsSync(path.join(dir, 'bin', 'codex.exe')));
    assert.ok(!fs.existsSync(path.join(dir, 'codex-resources', 'voice')), '语音组件不带');
    assert.match(fs.readFileSync(path.join(dir, 'LICENSE.txt'), 'utf8'), /Apache License/);
    assert.match(fs.readFileSync(path.join(dir, 'NOTICE.txt'), 'utf8'), /unmodified binary/);
    assert.equal(r.detect.codex.where, 'private');
    assert.equal(r.detect.codex.bundled, '0.163.0');
    assert.ok(hits.some((u) => u.includes('npmmirror')) && hits.some((u) => u.includes('registry.npmjs.org')));
    assert.ok(events.some((e) => e.type === 'install' && /已就绪/.test(e.text)));
  });

  await test('再检查一次：已是最新，不重复下载', async () => {
    const n = hits.length;
    const r = await agents.update('codex');
    assert.equal(r.updated, false);
    assert.ok(!hits.slice(n).some((u) => u.endsWith('.tgz')));
  });

  await test('校验不通过的下载不会装上', async () => {
    const out = path.join(tmp, 'bad');
    await assert.rejects(stageCodex({ version: NODE_VER, out, fetch: fakeFetch(false), tmp }), /校验不通过/);
    assert.ok(!fs.existsSync(path.join(out, 'bin', 'codex.exe')));
  });

  await test('内置技能齐全，每份都有 name / description', () => {
    const ids = kit.skills();
    for (const id of ['courseware-html', 'lecture-slides', 'practice-set', 'homework', 'quiz-paper', 'lesson-notes', 'lesson-plan', 'question-json']) assert.ok(ids.includes(id), id);
    for (const id of ids) {
      const body = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-kit', 'skills', id, 'SKILL.md'), 'utf8');
      assert.match(body, new RegExp(`^---\\r?\\nname: ${id}\\r?\\ndescription: .{10,}`), id);
    }
    assert.ok(kit.instructions().length > 200 && kit.instructions().length < 4000, '工作手册长度合适');
  });

  process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
  process.env.CS_AGENT_CLAUDE = path.join(__dirname, 'fake-agent.cjs');
  const runner = new Agents({ dir: path.join(tmp, 'agents2'), toolsDir: tools, credentials: () => ({ baseUrl: 'https://x/v1', key: 'k' }) });

  await test('Codex 任务：技能放进隐藏目录、带上工作手册、提示词开头点名技能；技能不算成果', async () => {
    const t = runner.start({ engine: 'codex', prompt: '为「浮力」出一套分层练习', skill: 'practice-set' });
    await until(() => runner.get(t.id).status === 'done');
    const g = runner.get(t.id);
    assert.equal(g.skill, 'practice-set');
    assert.ok(fs.existsSync(path.join(g.work, '.agents', 'skills', 'practice-set', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(g.work, '.agents', 'skills', 'question-json', 'SKILL.md')));
    const args = JSON.parse(fs.readFileSync(path.join(g.work, 'args.log'), 'utf8').split('\n')[0]);
    const di = args[args.indexOf(args.find((a) => a.startsWith('developer_instructions=')))];
    assert.ok(di && /任务背景\.md/.test(JSON.parse(di.slice('developer_instructions='.length))), '工作手册作为开发者指令传入，TOML 字符串可解析');
    // 假 CLI 只回写提示词的前 40 个字
    assert.match(fs.readFileSync(path.join(g.work, '课件.html'), 'utf8'), /^<h1>先读技能文件 \.agents\/skills\/practice-set\/SKILL/);
    assert.equal(g.events[0].text, '为「浮力」出一套分层练习', '界面上显示老师原话');
    assert.ok(runner.files(t.id).every((f) => !f.name.startsWith('.')), '技能文件不出现在成果里');
  });

  await test('Claude 任务：技能放进 .claude/skills，工作手册走 --append-system-prompt', async () => {
    const t = runner.start({ engine: 'claude', prompt: '写教案', skill: 'lesson-plan', formats: [] });
    await until(() => runner.get(t.id).status === 'done');
    const g = runner.get(t.id);
    assert.ok(fs.existsSync(path.join(g.work, '.claude', 'skills', 'lesson-plan', 'SKILL.md')));
    const args = JSON.parse(fs.readFileSync(path.join(g.work, 'args.log'), 'utf8').split('\n')[0]);
    assert.match(args[args.indexOf('--append-system-prompt') + 1], /备课助手/);
    assert.match(fs.readFileSync(path.join(g.work, '题目.md'), 'utf8'), /^先读技能文件 \.claude\/skills\/lesson-plan\/SKILL\.md/);
  });

  await test('不认识的技能名忽略；自定义任务不加前缀', async () => {
    const t = runner.start({ engine: 'codex', prompt: '随便做点什么', skill: '../../etc' });
    await until(() => runner.get(t.id).status === 'done');
    assert.equal(runner.get(t.id).skill, '');
    assert.match(fs.readFileSync(path.join(runner.get(t.id).work, '课件.html'), 'utf8'), /^<h1>随便做点什么/);
  });

  await test('题库文件：只读任务文件夹里的 …题库.json，坏 JSON 给出能照做的提示', async () => {
    const t = runner.list()[0], work = runner.get(t.id).work;
    fs.writeFileSync(path.join(work, '浮力-题库.json'), '\uFEFF' + JSON.stringify({ version: 1, questions: [{ stem: '一块木头漂浮在水面上……', answer: '0.6', qtype: '计算', difficulty: 2, verified: true }] }));
    assert.equal(runner.readBank(t.id, path.join(work, '浮力-题库.json')).questions.length, 1);
    fs.writeFileSync(path.join(work, '坏-题库.json'), '{"questions": [ {"stem": "\\frac"} ]');
    assert.throws(() => runner.readBank(t.id, path.join(work, '坏-题库.json')), /修正题库文件的 JSON 格式/);
    assert.throws(() => runner.readBank(t.id, path.join(work, '..', 'task.json')), /只能导入/);
    assert.throws(() => runner.readBank(t.id, path.join(work, 'args.log')), /只能导入/);
  });

  runner.stopAll();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 进程可能还占着文件 */ }
  for (const r of results) console.log(r[0], r[1], r[2] ? '\n' + r[2] : '');
  const failed = results.filter((r) => r[0] !== 'ok').length;
  console.log(`${results.length - failed}/${results.length} 通过`);
  process.exit(failed ? 1 : 0);
})();
