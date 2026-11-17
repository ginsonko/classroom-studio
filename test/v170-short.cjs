// 1.7.0 第 3 项（主进程）：不到 1 分钟（可选 5 分钟）的录像不算上课：不转码、不触发回放生成；10 秒内可撤销；只删这一段
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Recording } = require('../electron/recording.cjs');

const root = fs.mkdtempSync(path.join(process.env.CS_TEST_OUT || os.tmpdir(), 'v170-short-'));
const dir = path.join(root, 'recordings');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 一段以前的录像：无论如何都不能被碰
const oldFolder = path.join(dir, '2026-01-01T00-00-00-000Z-aaaaaaaa');
fs.mkdirSync(oldFolder, { recursive: true });
fs.writeFileSync(path.join(oldFolder, 'recording.json'), JSON.stringify({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z', phase: 'complete', startedAt: 1, endedAt: 20000 }));
fs.writeFileSync(path.join(oldFolder, '课堂回放.mp4'), 'old');

function make(limit) {
  const events = [], stopped = [], saved = [];
  const rec = new Recording({ directory: dir, ffmpeg: 'ffmpeg', onChange: (s) => events.push(s), send: () => {}, onSaved: (r) => saved.push(r), shortLimit: () => limit, onStopped: (r) => stopped.push(r), undoMs: 300 });
  rec.convert = async () => { await sleep(20); return 'x.mp4'; };
  return { rec, events, stopped, saved };
}
async function lesson(rec, seconds) {
  await rec.start({ recordings: dir, title: '测试课', studentId: 's1' });
  const id = rec.current.id;
  await rec.ready({ recordId: id, audio: { microphone: true, system: true } });
  await rec.chunk({ recordId: id, seq: 0, bytes: new Uint8Array(1000) });
  rec.current.startedAt = Date.now() - seconds * 1000;
  await rec.stop();
  await rec.stopped({ recordId: id });
  return id;
}
const folders = () => fs.readdirSync(dir).sort();

test('40 秒的录像：不排队转码、不算下课，状态带 discarded，300ms 后只删它自己的文件夹', async () => {
  const { rec, events, stopped, saved } = make(60);
  const id = await lesson(rec, 40);
  const last = events[events.length - 1];
  assert.equal(last.phase, 'idle'); assert.equal(last.discarded.id, id); assert.equal(last.discarded.seconds, 40);
  assert.equal(rec.jobs.length, 0, '没有转码任务');
  assert.deepEqual(stopped.map((x) => x.kept), [false]);
  assert.equal(folders().length, 2, '撤销期内文件还在');
  assert.ok(!(await rec.list()).some((r) => r.id === id), '回放列表里看不到它');
  await sleep(500);
  assert.deepEqual(folders(), [path.basename(oldFolder)], '只删了这一段');
  assert.ok(fs.existsSync(path.join(oldFolder, '课堂回放.mp4')), '旧录像原封不动');
  assert.equal(saved.length, 0);
  assert.equal(rec.status.discarded, null);
});
test('撤销：留下来，照常转码、生成回放、算一节课', async () => {
  const { rec, stopped, saved } = make(60);
  const id = await lesson(rec, 30);
  await rec.keepShort(id);
  assert.equal(rec.status.phase === 'saved' || rec.status.phase === 'complete', true);
  assert.deepEqual(stopped.map((x) => x.kept), [false, true]);
  await sleep(500);
  assert.equal(saved.length, 1, '回放生成了'); assert.ok(folders().length === 2, '文件夹还在');
  await assert.rejects(rec.keepShort('nope'), /撤销不了/);
});
test('够长的录像（90 秒，阈值 1 分钟）照常保存；阈值 5 分钟时 4 分钟的也丢弃；关掉后都保留', async () => {
  let m = make(60); await lesson(m.rec, 90); assert.deepEqual(m.stopped.map((x) => x.kept), [true]); await sleep(100); assert.equal(m.saved.length, 1);
  m = make(300); await lesson(m.rec, 240); assert.deepEqual(m.stopped.map((x) => x.kept), [false]); await sleep(500);
  m = make(0); await lesson(m.rec, 5); assert.deepEqual(m.stopped.map((x) => x.kept), [true]); await sleep(100);
});
test('上次关软件时还在撤销期的短录像：启动时删掉；别的录像不动', async () => {
  const f = path.join(dir, 'zz-left'); fs.mkdirSync(f);
  fs.writeFileSync(path.join(f, 'recording.json'), JSON.stringify({ id: 'left', createdAt: '2026-11-17T00:00:00.000Z', phase: 'discarding', startedAt: 1000, endedAt: 31000 }));
  const fake = path.join(dir, 'zz-long'); fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'recording.json'), JSON.stringify({ id: 'long', createdAt: '2026-11-17T00:00:00.000Z', phase: 'discarding', startedAt: 1000, endedAt: 3600000 }));
  const { rec } = make(60); await rec.resume();
  assert.ok(!fs.existsSync(f)); assert.ok(fs.existsSync(fake), '超过 10 分钟的绝不当短录像删'); assert.ok(fs.existsSync(oldFolder));
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
