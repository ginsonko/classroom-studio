// manim 一键安装（electron/manimSetup.cjs）离线测试：假 PyPI 镜像 + 真的 Python 便携包和 pip。
// 测速选镜像、Python 下载地址失效换下一个、包文件 500 换镜像、装完写 ok.json 并能运行、Manim 检测到便携版、取消、删除。
// 用法：node test/v120-manim-setup.cjs（只在 Windows 上跑完整安装）
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { ManimSetup } = require('../electron/manimSetup.cjs');
const { Manim } = require('../electron/manim.cjs');
const { fakeMirror } = require('./manimFake.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-manim-setup-'));
let pass = 0, fail = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.error('FAIL ' + name + '\n' + (e.stack || e)); } };
const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw Error('超时：' + what); };

(async () => {
  await test('测速：选最快的、没有 manim 的镜像不用、全都连不上时报错', async () => {
    const page = '<a href="x/manim-0.22.0-py3-none-any.whl">manim-0.22.0</a>';
    const delay = { 慢: 300, 快: 20, 坏: 5, 空: 5 };
    const fetch = async (u) => {
      const name = /\/\/(\S+?)\//.exec(u)[1];
      await new Promise((r) => setTimeout(r, delay[name]));
      if (name === '坏') return new Response('x', { status: 404 });
      return new Response(name === '空' ? '<html></html>' : page, { status: 200 });
    };
    const mirrors = Object.keys(delay).map((n) => ({ name: n, simple: `https://${n}/simple/`, files: `https://${n}/` }));
    const s = new ManimSetup({ dir: path.join(tmp, 'probe'), fetch, mirrors });
    const m = await s.pickMirror();
    assert.equal(m.name, '快');
    assert.deepEqual(s.order.map((x) => x.name), ['快', '慢']);
    assert.match(s.state.lines.at(-1), /可用镜像：快 \d+ms，慢 \d+ms/);
    const none = new ManimSetup({ dir: path.join(tmp, 'probe'), fetch: async () => { throw Error('offline'); }, mirrors });
    await assert.rejects(none.pickMirror(), /连不上任何 PyPI 镜像/);
  });

  if (process.platform !== 'win32') { console.log('SKIP 完整安装（只在 Windows 上测）'); return; }

  const fake = await fakeMirror({ fail: ['a'], slow: ['b'] });
  const dir = path.join(tmp, 'tools', 'manim');
  const events = [];
  // a 镜像索引页快、包文件 500；b 正常。Python 第一个下载地址 404
  const setup = new ManimSetup({ dir, fetch, mirrors: [fake.mirror('镜像A', 'a'), fake.mirror('镜像B', 'b')], pyUrls: fake.pyUrls, emit: (s) => events.push(s) });

  await test('离线完整安装：下载 Python、自举 pip、包文件出错换镜像、装完能运行', async () => {
    assert.equal(setup.python(), null);
    const first = setup.install();
    assert.equal(first.phase, 'running');
    assert.equal(setup.install().phase, 'running', '重复点安装不会再开一个');
    const end = await until(() => (setup.state.phase !== 'running' ? setup.view() : null), 300000, '安装结束');
    assert.equal(end.phase, 'done', end.step + '\n' + end.lines.join('\n'));
    assert.equal(end.pct, 100); assert.equal(end.installed, true);
    assert.match(end.step, /安装完成：manim 0\.22\.0/);
    const log = setup.state.lines.join('\n');
    assert.match(log, /下载 Python 3\.12\.10 便携版/);
    assert.match(log, /镜像A镜像出错：.*500/); assert.match(log, /换下一个镜像重试/);
    const exe = setup.python();
    assert.ok(exe && exe.startsWith(dir) && fs.existsSync(exe));
    const ok = JSON.parse(fs.readFileSync(path.join(dir, 'ok.json'), 'utf8'));
    assert.equal(ok.version, '0.22.0'); assert.equal(ok.mirror, '镜像B');
    assert.ok(!fs.existsSync(path.join(dir, 'download')), '下载的临时文件删掉了');
    assert.match(fs.readFileSync(path.join(dir, 'python', 'python312._pth'), 'utf8'), /Lib\\site-packages\r\nimport site/);
    assert.match(execFileSync(exe, ['-m', 'manim', '--version'], { encoding: 'utf8' }), /Manim Community v0\.22\.0/);
    assert.match(execFileSync(exe, ['-m', 'pip', '--version'], { encoding: 'utf8' }), /pip 25\.3/);
    // 进度只增不减（换镜像重试时也不倒退）
    const pcts = events.filter((e) => e.phase === 'running').map((e) => e.pct);
    for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] >= pcts[i - 1], `进度倒退：${pcts[i - 1]} → ${pcts[i]}`);
    assert.ok(fake.hits.includes('/py/missing.zip'), '试过第一个 Python 地址');
  });

  await test('Manim 优先用一键安装的 Python，CS_MANIM=own 时不找 PATH 里的', async () => {
    const prev = process.env.CS_MANIM; process.env.CS_MANIM = 'own';
    try {
      const m = new Manim({ dir: path.join(tmp, 'cache'), setup });
      const st = await m.status(true);
      assert.equal(st.ok, true); assert.equal(st.version, '0.22.0'); assert.equal(st.portable, true);
      assert.deepEqual(m.view(), { ok: true, version: '0.22.0', latex: m.view().latex, error: undefined, portable: true, installable: true });
      const empty = new Manim({ dir: path.join(tmp, 'cache'), setup: new ManimSetup({ dir: path.join(tmp, 'none'), fetch }) });
      const s2 = await empty.status(true);
      assert.equal(s2.ok, false); assert.equal(s2.installable, true); assert.match(s2.error, /一键安装/);
      const off = new Manim({ dir: path.join(tmp, 'cache') });
      assert.equal((await off.status(true)).installable, false, '没有 setup 时不显示一键安装');
    } finally { if (prev === undefined) delete process.env.CS_MANIM; else process.env.CS_MANIM = prev; }
  });

  await fake.close();

  await test('取消：下载中取消马上停下，状态回到 idle，没写 ok.json', async () => {
    const slow = await fakeMirror({ slowPy: true });
    try {
      const d2 = path.join(tmp, 'cancel');
      const s = new ManimSetup({ dir: d2, fetch, mirrors: [slow.mirror('镜像B', 'b')], pyUrls: slow.pyUrls.slice(1) });
      s.install();
      await until(() => /下载 Python/.test(s.state.step) && s.state.pct > 1.2, 30000, '开始下载');
      assert.equal(s.cancel(), true);
      const end = await until(() => (s.state.phase !== 'running' ? s.view() : null), 15000, '取消生效');
      assert.equal(end.phase, 'idle'); assert.equal(end.step, '已取消安装'); assert.equal(end.installed, false);
      assert.equal(s.cancel(), false, '没在装时取消返回 false');
      await assert.doesNotReject(s.uninstall());
      assert.ok(!fs.existsSync(d2));
    } finally { await slow.close(); }
  });

  await test('删除：正在装时拒绝，装好后删除整个目录', async () => {
    setup.state.phase = 'running';
    await assert.rejects(setup.uninstall(), /正在安装/);
    setup.state.phase = 'done';
    const v = await setup.uninstall();
    assert.equal(v.installed, false); assert.equal(v.phase, 'idle');
    assert.ok(!fs.existsSync(dir)); assert.equal(setup.python(), null);
  });
})().catch((e) => { fail++; console.error(e); }).finally(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
