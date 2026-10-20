// 1.1.0 AI 工坊：做插件的任务（插件写在任务的 plugin 文件夹、自动校验并让 AI 修、按素材需求生图）、
// 思考档位、附件、在已装插件上改、预览目录挂到 plugin://dev-… 再装上（留 AI 修改前的历史）。
// 纯 Node + 假 CLI，不联网。运行：node test/v110-workshop.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-v110w-'));
process.env.CS_AGENT_CODEX = path.join(__dirname, 'fake-agent.cjs');
process.env.CODEX_HOME = path.join(tmp, 'codex-home');
const { Agents } = require('../electron/agents.cjs');
const { Plugins } = require('../electron/plugins.cjs');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.stack]); } };
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('等待超时'); };
const argsOf = (t) => fs.readFileSync(path.join(t.work, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const settled = (id) => until(() => { const t = agents.tasks.get(id); return t.status === 'done' && !t.child && !t.exporting && t.events.some((e) => (e.kind === 'out' && /检查通过/.test(e.text)) || (e.kind === 'error' && /没通过检查/.test(e.text))); });

const asked = [];
const agents = new Agents({
  dir: path.join(tmp, 'agents'), emit: () => {},
  imageGen: async (v) => { asked.push(v); return { image: 'data:image/png;base64,' + PNG, cny: 0.2, model: 'img-1' }; },
});
const plugins = new Plugins({ dir: path.join(tmp, 'plugins') });
const ref = path.join(tmp, 'ref.png');
fs.writeFileSync(ref, Buffer.from(PNG, 'base64'));

(async () => {
  let first;
  await test('做插件：附件和思考档位传给 Codex，插件技能和参考资料装进任务，用插件专用的工作手册', async () => {
    first = agents.start({ engine: 'codex', prompt: '做一个骰子 PLUGINBAD ASSET', kind: 'plugin', effort: 'high', attachments: [ref], cap: 5 });
    assert.equal(first.kind, 'plugin'); assert.equal(first.effort, 'high'); assert.deepEqual(first.formats, []); assert.equal(first.skill, 'plugin-dev');
    await settled(first.id);
    const t = agents.tasks.get(first.id), a = argsOf(t);
    const one = a[0];
    assert.equal(one[0], 'exec'); assert.notEqual(one[1], 'resume');
    const i = one.indexOf('-i');
    assert.ok(i > 0 && i < one.indexOf('--json'), '图片参数在 --json 前面');
    assert.equal(path.resolve(one[i + 1]), path.join(t.work, '附件', 'ref.png'));
    assert.ok(one.includes('model_reasoning_effort="high"'), one.join(' '));
    assert.ok(one.find((x) => x.startsWith('developer_instructions=')).includes('AI 工坊里的插件工程师'));
    assert.equal(one.at(-1), '-');
    const skill = path.join(t.work, '.agents', 'skills', 'plugin-dev');
    for (const f of ['SKILL.md', 'reference/sdk.js', 'reference/ui.css', 'examples/class-timer/plugin.json', 'examples/math-solids/shapes/cone.svg']) assert.ok(fs.existsSync(path.join(skill, f)), f);
    assert.ok(t.events.some((e) => e.kind === 'user' && /附件：ref\.png/.test(e.text)));
  });

  await test('每轮结束自动校验：有问题自动让 AI 修一次，第二轮不再附图，修好后检查通过', () => {
    const t = agents.tasks.get(first.id), a = argsOf(t);
    assert.equal(t.turns, 2);
    assert.equal(a[1][1], 'resume'); assert.ok(!a[1].includes('-i'), '图片只附一次');
    assert.ok(t.events.some((e) => e.kind === 'note' && /自动修正（第 1 次）/.test(e.text)));
    assert.ok(t.check.ok, JSON.stringify(t.check)); assert.equal(t.check.id, 'dice-roller'); assert.equal(t.fixes, 0);
  });

  await test('素材需求.json：生成插件里缺的图片，跳出插件文件夹的路径不理，已有的不重复生成', () => {
    const t = agents.tasks.get(first.id);
    assert.equal(asked.length, 1, '两轮都写了素材需求，只生成一次');
    assert.equal(asked[0].feature, 'AI 工坊·插件素材'); assert.equal(asked[0].size, '1024x1024');
    assert.ok(fs.readFileSync(path.join(t.pluginDir, 'img', 'bg.png')).length > 50);
    assert.ok(!fs.existsSync(path.join(t.work, 'evil.png')));
    assert.ok(t.events.some((e) => e.kind === 'file' && e.text === '新建 plugin/img/bg.png'));
  });

  await test('预览：任务的插件挂到 plugin://dev-…，装上后进入已装插件', () => {
    const t = agents.tasks.get(first.id);
    const id = plugins.setDev(t.id, t.pluginDir), k = id.slice(4);
    const r = plugins.resolve(`plugin://${id}/index.html`);
    assert.ok(r && r.file.endsWith('index.html')); assert.equal(r.manifest.id, 'dice-roller');
    assert.ok(plugins.resolve(`plugin://${id}/__cs/sdk.js`));
    assert.equal(plugins.resolve(`plugin://${id}/../task.json`), null);
    assert.deepEqual(plugins.checkDev(k).problems, []);
    const p = plugins.installDev(k);
    assert.equal(p.id, 'dice-roller'); assert.equal(p.version, '1.0.0'); assert.ok(p.active);
    assert.ok(!fs.existsSync(path.join(plugins.installedDir, 'dice-roller', 'args.log')));
  });

  await test('在已装插件上改：复制一份进任务改，装上时版本号变了、旧版存进「AI 修改前」历史', async () => {
    const t0 = agents.start({ engine: 'codex', prompt: '按钮大一点 PLUGIN', kind: 'plugin', pluginFrom: path.join(plugins.installedDir, 'dice-roller') });
    assert.equal(t0.effort, '');
    await settled(t0.id);
    const t = agents.tasks.get(t0.id);
    assert.ok(!argsOf(t)[0].some((x) => /model_reasoning_effort/.test(x)), '默认档位不传');
    assert.equal(t.turns, 1); assert.ok(t.check.ok);
    assert.equal(fs.readFileSync(path.join(plugins.installedDir, 'dice-roller', 'index.html'), 'utf8').includes('改过'), false, '装上前原插件不变');
    const k = plugins.setDev(t.id, t.pluginDir).slice(4);
    const p = plugins.installDev(k);
    assert.equal(p.version, '1.0.1');
    assert.ok(fs.readFileSync(path.join(plugins.installedDir, 'dice-roller', 'index.html'), 'utf8').includes('改过'));
    const h = plugins.history('dice-roller');
    assert.equal(h[0].reason, 'AI 修改前'); assert.equal(h[0].version, '1.0.0');
  });

  await test('继续对话可以带附件（同名自动改名）；改思考档位下一轮生效', async () => {
    agents.configure(first.id, { effort: 'bogus' });
    agents.configure(first.id, { effort: 'xhigh' });
    const t = agents.tasks.get(first.id);
    assert.equal(t.effort, 'xhigh');
    assert.ok(t.events.some((e) => e.kind === 'note' && e.text.includes('思考档位改为极高')));
    const before = argsOf(t).length;
    agents.inject(first.id, '颜色换成蓝的 PLUGIN', [ref]);
    await until(() => argsOf(t).length > before);
    await settled(first.id);
    const last = argsOf(t)[before];
    assert.equal(last[1], 'resume');
    assert.equal(path.resolve(last[last.indexOf('-i') + 1]), path.join(t.work, '附件', 'ref-2.png'));
    assert.ok(last.includes('model_reasoning_effort="xhigh"'));
    assert.ok(t.events.some((e) => e.kind === 'user' && /附件：ref-2\.png/.test(e.text)));
  });

  await test('附件太多 / 不存在时直接报错，不留下半个任务；Claude 高档位给思考预算', () => {
    const n = fs.readdirSync(agents.dir).length;
    assert.throws(() => agents.start({ engine: 'codex', prompt: 'x', attachments: Array(9).fill(ref) }), /最多 8 个/);
    assert.throws(() => agents.start({ engine: 'codex', prompt: 'x', attachments: [path.join(tmp, 'nope.png')] }), /找不到附件/);
    assert.equal(fs.readdirSync(agents.dir).length, n);
    assert.equal(agents.env({ engine: 'claude', effort: 'xhigh' }).MAX_THINKING_TOKENS, '31999');
    assert.equal(agents.env({ engine: 'claude', effort: 'low' }).MAX_THINKING_TOKENS, process.env.MAX_THINKING_TOKENS);
  });

  await test('普通备课任务不受影响：没有 plugin 文件夹、照常用备课工作手册', async () => {
    const t0 = agents.start({ engine: 'codex', prompt: '浮力课件' });
    await until(() => { const t = agents.tasks.get(t0.id); return t.status === 'done' && !t.child; });
    const t = agents.tasks.get(t0.id);
    assert.equal(t.kind, ''); assert.equal(t.pluginDir, undefined); assert.equal(t.check, undefined);
    assert.ok(argsOf(t)[0].find((x) => x.startsWith('developer_instructions=')).includes('备课助手'));
    assert.throws(() => agents.checkPlugin(t), /不是做插件的/);
  });

  agents.stopAll();
  const bad = results.filter((r) => r[0] !== 'ok');
  for (const r of results) console.log(r[0] === 'ok' ? 'PASS' : 'FAIL', r[1], r[2] ? '\n' + r[2] : '');
  console.log(`v110 workshop: ${results.length - bad.length}/${results.length} passed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 子进程还占着 */ }
  process.exit(bad.length ? 1 : 0);
})();
