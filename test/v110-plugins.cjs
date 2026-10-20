'use strict';
// 插件平台主进程逻辑：协议校验、zip 安全、安装/历史/回退/复制/导出/数据/出错停用/安全模式
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const spec = require('../electron/pluginSpec.cjs');
const zipkit = require('../electron/zipkit.cjs');
const { Plugins } = require('../electron/plugins.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-plugins-'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '\n ', e.stack); } };
const make = () => new Plugins({ dir: path.join(tmp, 'data-' + Math.random().toString(36).slice(2)), log: null });

t('manifest normalize rejects bad id / unknown permission / missing files', () => {
  const r = spec.normalize({ protocol: 'cs-plugin/1', id: 'Bad Id', name: 'x', version: '1.0.0', permissions: ['root'], contributes: { panels: [{ id: 'm', title: 'M', entry: 'nope.html' }] } }, () => false);
  assert.ok(r.problems.length >= 2, r.problems.join('|'));
  const ok = spec.normalize({ protocol: 'cs-plugin/1', id: 'good-one', name: '好', version: '1.0.0', permissions: ['board'], network: ['api.example.com'], contributes: { panels: [{ id: 'm', title: 'M', entry: 'index.html' }] } }, () => true);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.manifest.network, ['api.example.com']);
});

t('zip rejects path traversal', () => {
  const evil = require('../electron/exporter.cjs').zip([{ name: '../evil.txt', data: Buffer.from('x') }]);
  assert.throws(() => zipkit.entries(evil));
});

t('zip pack/extract round trip strips single top folder', () => {
  const src = path.join(tmp, 'rt', 'inner'); fs.mkdirSync(path.join(src, 'a'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a', 'b.txt'), '你好');
  const z = require('../electron/exporter.cjs').zip([{ name: 'top/a/b.txt', data: fs.readFileSync(path.join(src, 'a', 'b.txt')) }]);
  const out = path.join(tmp, 'rt-out'); zipkit.extract(z, out);
  assert.equal(fs.readFileSync(path.join(out, 'a', 'b.txt'), 'utf8'), '你好');
});

t('install examples, resolve plugin:// files, sdk injection', () => {
  const p = make();
  const ex = p.examples();
  assert.ok(ex.length >= 3);
  for (const e of ex) { const s = p.stageExample(e.folder); assert.deepEqual(s.problems, []); p.install(s.token); }
  const l = p.list();
  assert.equal(l.items.length, ex.length);
  assert.ok(l.items.every((x) => x.active));
  const r = p.resolve('plugin://class-timer/index.html');
  assert.ok(r && fs.existsSync(r.file));
  assert.ok(p.resolve('plugin://class-timer/__cs/sdk.js'));
  assert.equal(p.resolve('plugin://class-timer/../../state.json'), null);
  assert.equal(p.resolve('plugin://class-timer/__cs/../plugins.cjs'), null);
  const html = p.inject(Buffer.from('<!doctype html><html><head><title>x</title></head></html>')).toString();
  assert.ok(html.indexOf('<script>') > html.indexOf('<head>') && html.indexOf('<script>') < html.indexOf('<title>'));
  assert.ok(p.csp(p.manifest('class-timer')).includes("connect-src 'self'"));
  p.setEnabled('class-timer', false);
  assert.equal(p.resolve('plugin://class-timer/index.html'), null);
});

t('history, rollback, duplicate, pack, remove', () => {
  const p = make();
  const s = p.stageExample('random-picker'); p.install(s.token);
  const s2 = p.stageExample('random-picker'); assert.equal(s2.existing.version, '1.0.0'); p.install(s2.token);
  const h = p.history('random-picker');
  assert.equal(h.length, 1); assert.equal(h[0].reason, '更新前'); assert.equal(h[0].version, '1.0.0');
  p.rollback('random-picker', h[0].name);
  assert.equal(p.history('random-picker').length, 2);
  const d = p.duplicate('random-picker');
  assert.equal(d.id, 'random-picker-copy'); assert.match(d.name, /副本/);
  const pk = p.pack('random-picker');
  assert.ok(pk.data.length > 100 && pk.name.endsWith('.csplugin'));
  const f = path.join(tmp, 'rp.csplugin'); fs.writeFileSync(f, pk.data);
  const q = make(); const st = q.stage(f); assert.deepEqual(st.problems, []); q.install(st.token);
  assert.ok(q.list().items[0].active);
  p.remove('random-picker');
  assert.ok(!p.list().items.find((x) => x.id === 'random-picker'));
  assert.ok(p.history('random-picker').some((x) => x.reason === '删除前'));
});

t('storage limits and error auto-disable', () => {
  const p = make();
  const s = p.stageExample('class-timer'); p.install(s.token);
  p.storage('class-timer', 'set', 'a', { x: 1 });
  assert.deepEqual(p.storage('class-timer', 'get', 'a'), { x: 1 });
  assert.deepEqual(p.storage('class-timer', 'keys'), ['a']);
  assert.throws(() => p.storage('class-timer', 'set', 'big', 'x'.repeat(2.2 * 1024 * 1024)));
  assert.throws(() => p.storage('../x', 'get', 'a'));
  let r; for (let i = 0; i < 8; i++) r = p.error('class-timer', 'boom');
  assert.equal(r.disabled, true);
  assert.equal(p.list().items[0].active, false);
  assert.match(p.list().items[0].disabledReason, /自动停用/);
});

t('safe mode after two unstable boots', () => {
  const dir = path.join(tmp, 'boot');
  const a = new Plugins({ dir }); const s = a.stageExample('class-timer'); a.install(s.token);
  new Plugins({ dir });
  const c = new Plugins({ dir });
  assert.equal(c.safeMode, true); assert.equal(c.isActive('class-timer'), false);
  c.stable();
  const d = new Plugins({ dir }); assert.equal(d.safeMode, false); assert.equal(d.isActive('class-timer'), true);
});

t('stage rejects executables', () => {
  const dir = path.join(tmp, 'evil'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ protocol: 'cs-plugin/1', id: 'evil-one', name: '坏', version: '1.0.0', contributes: { panels: [{ id: 'm', title: 'M', entry: 'index.html' }] } }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>x</p>');
  fs.writeFileSync(path.join(dir, 'run.exe'), 'MZ');
  const p = make(); const s = p.stage(dir);
  assert.ok(s.problems.length > 0);
  assert.throws(() => p.install(s.token));
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
