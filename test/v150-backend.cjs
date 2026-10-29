// 1.5.0 主进程部分：小羽三档权限、学情库外部修改监听、板书存档、课堂时间线、录像截帧和补写分析结果。
// 用法：node test/v150-backend.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { accessPolicy } = require('../electron/assistant.cjs');
const { Study } = require('../electron/study.cjs');
const { Recording, runProcess } = require('../electron/recording.cjs');

const ROOT = path.join(__dirname, '..'), FFMPEG = path.join(ROOT, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const tmp = fs.mkdtempSync(path.join(process.env.CS_TEST_OUT || os.tmpdir(), 'v150-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const T = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };

(async () => {
  await T('accessPolicy：完全访问 / 常用 / 每次都问', () => {
    const full = accessPolicy('full', 'W:/work');
    assert.equal(full.approval, 'never'); assert.equal(full.sandbox, 'danger-full-access'); assert.deepEqual(full.policy, { type: 'dangerFullAccess' });
    const common = accessPolicy('common', 'W:/work');
    assert.equal(common.approval, 'on-request'); assert.equal(common.sandbox, 'workspace-write');
    assert.deepEqual(common.policy, { type: 'workspaceWrite', writableRoots: ['W:/work'], networkAccess: true });
    const ask = accessPolicy('ask', 'W:/work');
    assert.equal(ask.approval, 'untrusted'); assert.equal(ask.policy.networkAccess, false);
    assert.deepEqual(accessPolicy(undefined, 'W:/work'), common, '没设置按「常用」');
  });

  await T('study.watch：别的程序改了 study.json 才通知，软件自己保存不算', async () => {
    const dir = path.join(tmp, 'study'), st = new Study({ dir, exportDoc: null, log: null });
    await st.load(); await st.save({ questions: [] });
    let hits = 0; st.watch(() => hits++);
    await st.save({ questions: [{ id: 'q1', stem: 'x' }] });
    await sleep(1500);
    assert.equal(hits, 0, '自己写的不通知');
    fs.writeFileSync(st.file, JSON.stringify({ version: 1, questions: [{ id: 'q1' }, { id: 'q2' }] }));
    await sleep(1500);
    assert.equal(hits, 1, '外部改了通知一次');
    assert.equal((await st.load()).questions.length, 2);
    st.watcher.close();
  });

  await T('study.board：板书 JPEG 存成学生名下的 PDF', async () => {
    const st = new Study({ dir: path.join(tmp, 'study2'), exportDoc: null, log: null });
    const jpg = await (async () => { const f = path.join(tmp, 'b.jpg'); await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180', '-frames:v', '1', f]); return 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64'); })();
    const file = await st.board({ student: '张三/李四', title: '电磁感应', pdf: [jpg, jpg] });
    assert.ok(file.includes('/板书/张三 李四/'), file);
    assert.ok(fs.readFileSync(file).subarray(0, 5).toString() === '%PDF-');
    await assert.rejects(() => st.board({ student: 'x', title: 'y', pdf: ['data:image/png;base64,AAA'] }), /板书页面数据无效/);
  });

  // 录像：造一段 30 秒的测试录像，走 chapter → stopped 之外的部分（frames / patchMeta 只要 recording.json + mp4）
  const rec = new Recording({ directory: path.join(tmp, 'rec'), ffmpeg: FFMPEG, onChange() {}, send() {}, onSaved() {} });
  await T('recording.chapter：录课时才记；连着翻页只留停下的那页；同样的不重复', () => {
    assert.equal(rec.chapter({ kind: 'page', title: 'x' }), false, '没在录不记');
    rec.current = { id: 'r1', startedAt: Date.now() - 5000, chapters: [] }; rec.status = { phase: 'recording' };
    assert.ok(rec.chapter({ kind: 'material', title: '  电磁感应 课件 ' }));
    rec.chapter({ kind: 'page', title: '第 2 页' }); rec.chapter({ kind: 'page', title: '第 3 页' }); rec.chapter({ kind: 'page', title: '第 4 页' });
    rec.chapter({ kind: 'attempt', title: '张三 错' }); rec.chapter({ kind: 'attempt', title: '张三 错' });
    rec.chapter({ kind: 'weird', title: '老师备注', ref: 'r'.repeat(300) });
    assert.equal(rec.chapter({ kind: 'note', title: '   ' }), false);
    const c = rec.current.chapters;
    assert.deepEqual(c.map((x) => x.kind), ['material', 'page', 'attempt', 'note']);
    assert.equal(c[0].title, '电磁感应 课件'); assert.equal(c[1].title, '第 4 页'); assert.equal(c[3].ref.length, 200);
    assert.ok(c.every((x) => x.t >= 4 && x.t < 10));
    rec.current = null; rec.status = { phase: 'idle' };
  });

  await T('recording.frames / patchMeta：按秒截帧成 data URL，分析结果补进 recording.json', async () => {
    const folder = path.join(tmp, 'rec', '2026-01-01-test');
    fs.mkdirSync(folder, { recursive: true });
    await runProcess(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10', '-t', '30', '-pix_fmt', 'yuv420p', path.join(folder, '课堂回放.mp4')], { timeout: 120000 });
    const meta = { id: 'rid1', title: '测试课', studentId: 's1', createdAt: '2026-01-01T00:00:00.000Z', phase: 'complete', startedAt: 1, endedAt: 30001, chapters: [{ t: 3, kind: 'material', title: 'a' }] };
    fs.writeFileSync(path.join(folder, 'recording.json'), JSON.stringify(meta));
    const got = await rec.frames('rid1', [2, 12.5, 25, 999]);
    assert.equal(got.length, 3, '超出时长的那张截不到，跳过');
    assert.ok(got.every((f) => f.url.startsWith('data:image/jpeg;base64,') && f.url.length > 2000));
    assert.equal(fs.readdirSync(path.join(folder, 'frames')).length, 3);
    await assert.rejects(() => rec.frames('nope', [1]), /找不到这段录像/);
    await rec.patchMeta('rid1', { analysis: { at: 'x', frames: 3, questions: 1, attempts: 0, map: 2, summary: '讲了楞次定律', weak: [] }, title: '不能改别的' });
    const row = (await rec.list()).find((r) => r.id === 'rid1');
    assert.equal(row.analysis.summary, '讲了楞次定律'); assert.equal(row.title, '测试课'); assert.equal(row.chapters.length, 1);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`PASS v150-backend ${n}/${n}`);
})().catch((e) => { console.error(e); process.exit(1); });
