// AI 助手存档验收（纯 Node）：node test/archive-logic.cjs
const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Archive } = require('../electron/archive.cjs');

let n = 0;
const ok = async (name, fn) => { await fn(); n += 1; console.log('ok', name); };
const PNG = 'data:image/png;base64,' + Buffer.alloc(400, 7).toString('base64');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-arc-'));
  const cache = path.join(root, 'manim'); fs.mkdirSync(cache);
  const video = path.join(cache, 'v.mp4'); fs.writeFileSync(video, 'fake-mp4');
  const A = new Archive({ dir: path.join(root, 'archive'), copyFrom: [cache] });

  await ok('存一条讲题：截图拆成文件，JSON 里只留路径', async () => {
    const r = await A.add({ id: 'abcdef1', action: 'explain', ask: '斜面上的物块', at: Date.UTC(2026, 9, 18, 8), subject: 'physics', studentId: 's1', studentName: '小明', title: '斜面受力', text: '正交分解 mg sinθ', out: { kind: 'explain', data: { title: '斜面受力' } }, meta: { model: 'm1', ms: 900, image: PNG } });
    assert.equal(r.id, 'abcdef1');
    const e = await A.get('abcdef1');
    assert.ok(!JSON.stringify(e).includes('base64'), '不该存 base64');
    assert.ok(fs.existsSync(e.meta.image), '截图文件存在');
    assert.equal(e.meta.model, 'm1');
  });

  await ok('讲解动画：视频从 manim 缓存复制进存档，截帧也拆成文件', async () => {
    await A.add({ id: 'anim0001', action: 'anim', ask: '单摆', at: Date.UTC(2026, 9, 19, 8), out: { kind: 'anim', data: { title: '单摆周期' }, video: { id: 'v', video, ms: 1, bytes: 8, sheet: PNG } } });
    const e = await A.get('anim0001');
    assert.notEqual(path.resolve(e.out.video.video), path.resolve(video));
    assert.equal(fs.readFileSync(e.out.video.video, 'utf8'), 'fake-mp4');
    assert.ok(fs.existsSync(e.out.video.sheet));
  });

  await ok('缓存以外的路径不复制（不能借存档读任意文件）', async () => {
    const outside = path.join(root, 'secret.mp4'); fs.writeFileSync(outside, 'x');
    await A.add({ id: 'anim0002', action: 'anim', ask: 'x', out: { kind: 'anim', data: { title: 't' }, video: { video: outside } } });
    assert.equal((await A.get('anim0002')).out.video.video, outside);
    assert.ok(!fs.readdirSync(A.media).some((f) => f.startsWith('anim0002')));
  });

  await ok('列表：新的在前、跨月份、搜索、按功能 / 学生筛选、分页', async () => {
    await A.add({ id: 'ask00001', action: 'ask', ask: '动量守恒的条件', at: Date.UTC(2026, 8, 30, 8), text: '系统合外力为零', studentId: 's2', studentName: '小红' });
    const all = await A.list({});
    assert.deepEqual(all.items.map((x) => x.id), ['anim0002', 'anim0001', 'abcdef1', 'ask00001']);
    assert.equal(all.total, 4);
    assert.deepEqual((await A.list({ q: '合外力' })).items.map((x) => x.id), ['ask00001'], '搜正文');
    assert.deepEqual((await A.list({ q: '小明 斜面' })).items.map((x) => x.id), ['abcdef1'], '多个词都要命中');
    assert.deepEqual((await A.list({ action: 'anim' })).items.length, 2);
    assert.deepEqual((await A.list({ studentId: 's2' })).items.map((x) => x.id), ['ask00001']);
    assert.deepEqual((await A.list({ before: Date.UTC(2026, 9, 18, 9), limit: 1 })).items.map((x) => x.id), ['abcdef1']);
    assert.ok(all.items[2].thumb.endsWith('.png'), '列表带缩略图');
    assert.ok(fs.existsSync(path.join(A.dir, '2026-09.jsonl')) && fs.existsSync(path.join(A.dir, '2026-10.jsonl')));
  });

  await ok('删除：记录和它的文件一起删', async () => {
    const e = await A.get('abcdef1');
    assert.equal(await A.remove('abcdef1'), true);
    assert.ok(!fs.existsSync(e.meta.image));
    await assert.rejects(A.get('abcdef1'));
    assert.equal(await A.remove('abcdef1'), false);
    assert.equal((await A.list({})).total, 3);
  });

  await ok('坏数据：未知动作拒绝，写坏的行跳过', async () => {
    await assert.rejects(A.add({ action: 'rm -rf' }));
    fs.appendFileSync(path.join(A.dir, '2026-10.jsonl'), '{"id":"half');
    assert.equal((await A.list({})).total, 3);
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`PASS ${n}/6`);
})().catch((e) => { console.error(e); process.exit(1); });
