'use strict';
/**
 * 玲珑课堂 1.8.0 综合桌面验收与二次冷启动回归测试（无头离屏运行，不碰真实键鼠、不联网扣费）：
 *
 * 覆盖五大核心支柱：
 * 1. 品牌升级「玲珑课堂」1.8.0 与向后兼容：
 *    - 窗口标题、WhatsNew 1.8.0 导览卡、说明书、双协议（classroom-studio:// 与 linglong-classroom://）；
 *    - 玲珑账号兼容复用老用户已有的「最强网课教辅系统」专用 Key，新用户建「玲珑课堂」专用 Key。
 * 2. 顶栏与浮层常驻「一键清空课面」：换学生留有上堂课笔迹时高亮「清空『某某』课面」，
 *    清前自动将写过的板书存 PDF 归到原学生名下，原位一键「恢复课面」完整找回笔迹。
 * 3. 上下课按钮三段式智能显隐（idle-prominent / idle-late → quiet + 双击折叠 → overtime）+
 *    动笔未录轻提醒（仅教师顶栏与浮层显示，学生窗口绝不露字，可静默）+
 *    自由拖动持久化 + 全屏课件右上角自动左移避让（不挡最小化/窗口化/关闭按钮）。
 * 4. 「课后发家长」统一交付抽屉 + 全站原地轻预览（QuickPreview）+ 原生拖拽硬链接重命名与剪贴板：
 *    - 超 1 小时回放优先勾选微信分段，原大文件默认不勾；
 *    - 带「答案/解析/教师版」的作业默认不勾选并收进折叠防误发栏；
 *    - 点击抽屉文件弹出 QuickPreview，绝不切回 console 页、绝不覆盖右侧 pvw 预监；
 *    - 触发原生拖拽与复制文件，生成干净好读的中文文件名硬链接并自动标记「已发家长」。
 * 5. workspace.json 无损瘦身与二次冷启动防黑屏验证：
 *    - 自动清理非活跃旧课件撤销栈，100% 保留全部历史与当前课堂 shared.ink 笔迹；
 *    - 带着预监、阅读器、自定义角标位置、已发记录退出存盘后，拉起第二个独立 Electron 进程验证二次冷启动零报错。
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

// ── 子进程模式：验证带着真实状态存盘后的第二次冷启动恢复零黑屏、零报错 ──
if (process.env.CS_SECOND_BOOT === '1') {
  process.env.CS_TEST = '1';
  const electron = require('electron');
  const { app } = electron;
  const bootErrors = [];
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (_ev, d) => { if (d?.level >= 3) bootErrors.push(d.message); });
    wc.on('render-process-gone', (_ev, d) => bootErrors.push('renderer-gone:' + d.reason));
  });
  require('../electron/main.cjs');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000, what = '') => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      try { const v = await fn(); if (v) return v; } catch { /* 轮询等待 */ }
      await sleep(120);
    }
    throw new Error('Second boot timed out: ' + what);
  };
  (async () => {
    const api = await until(() => globalThis.classroomStudioTest, 20000, 'api');
    const teacher = api.windows.get('teacher');
    const student = api.windows.get('student');
    const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4200;
    teacher.setBounds({ x: left, y: 40, width: 1440, height: 900 });
    student.setBounds({ x: left, y: 980, width: 1280, height: 720 });
    teacher.showInactive();
    student.showInactive();
    await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'), 20000, 'teacher QA');
    await until(() => student.webContents.executeJavaScript('!!window.__studioQA'), 20000, 'student QA');
    const stateCheck = await teacher.webContents.executeJavaScript(`(() => {
      const s = window.__studioQA.useStore.getState();
      const recover = document.querySelector('.recover-box, [data-qa="teacher-recover"]');
      return {
        hasRecoverCrash: !!recover,
        title: document.title,
        oldInkCount: (s.ink['old-courseware#0'] || []).length,
        hasReader: !!s.reader?.mat && typeof s.reader.mat.id === 'string',
      };
    })()`);
    assert.equal(stateCheck.hasRecoverCrash, false, '二次冷启动不应触发崩溃恢复页');
    assert.equal(stateCheck.oldInkCount, 2, '历史课件笔迹在二次冷启动后必须 100% 保留');
    assert.ok(stateCheck.hasReader, '二次冷启动后 reader 合法有效');
    const sentState = await api.deliverDrag.handle('deliver.sentState', {});
    assert.ok(sentState['rec:rec-long-1'], '已发家长记录跨重启持久化');
    assert.equal(bootErrors.length, 0, '二次冷启动无渲染错误: ' + bootErrors.join('; '));
    console.log('SECOND_BOOT_OK');
    app.exit(0);
  })().catch((err) => {
    console.error('SECOND_BOOT_FAIL', err);
    app.exit(1);
  });
  return;
}

const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out'), 'v180-' + Date.now());
fs.mkdirSync(out, { recursive: true });
const DATA = path.join(out, 'data');
process.env.CS_TEST = '1';
process.env.CS_DATA_DIR = DATA;
process.env.CS_SYNTHETIC_RECORD = '1';
process.env.CS_SHORT_DROP = '0';

fs.mkdirSync(path.join(DATA, 'study'), { recursive: true });
const workDir = path.join(out, 'work');
fs.mkdirSync(workDir, { recursive: true });

// 准备真实测试文件：家长反馈长图（合法最小 PNG）、板书 PDF、普通作业与答案解析版作业
const MIN_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJg==', 'base64');
const MIN_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');
const parentPng = path.join(DATA, 'study', '林晓-11月21日-家长版反馈.png');
const boardPdf = path.join(DATA, 'study', '林晓-11月21日-课堂板书.pdf');
const hwStudent = path.join(workDir, '林晓-受力分析课后巩固.pdf');
const hwAnswer = path.join(workDir, '林晓-受力分析课后巩固-答案解析版.pdf');
fs.writeFileSync(parentPng, MIN_PNG);
fs.writeFileSync(boardPdf, MIN_PDF);
fs.writeFileSync(hwStudent, MIN_PDF);
fs.writeFileSync(hwAnswer, MIN_PDF);

const now = new Date();
const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// 统一以该堂课开课时刻所在自然日作为课次日期，避免凌晨 00:00~02:00 运行测试时跨午夜拆成两天
const recStartMs = now.getTime() - 7200_000;
const recEndMs = now.getTime() - 3300_000;
const todayStr = dk(new Date(recStartMs));

// 准备一段 65 分钟的已完成录像及对应的 2 段微信分段文件（按 recording.cjs 真实 parts 结构写入）
const recFolder = path.join(DATA, 'recordings', '2026-11-21T12-00-00-000Z-reclong1');
const splitDir = path.join(recFolder, '微信分段');
fs.mkdirSync(splitDir, { recursive: true });
fs.writeFileSync(path.join(recFolder, '课堂回放.mp4'), Buffer.alloc(2048, 1));
const part1Name = '林晓 11月21日 第1段（共2段）.mp4';
const part2Name = '林晓 11月21日 第2段（共2段）.mp4';
fs.writeFileSync(path.join(splitDir, part1Name), Buffer.alloc(1024, 2));
fs.writeFileSync(path.join(splitDir, part2Name), Buffer.alloc(1024, 3));
fs.writeFileSync(path.join(recFolder, 'recording.json'), JSON.stringify({
  id: 'rec-long-1',
  title: '受力分析与正交分解',
  studentId: 'stu-a',
  createdAt: new Date(recStartMs).toISOString(),
  phase: 'complete',
  startedAt: recStartMs,
  endedAt: recEndMs, // 65 分钟（> 58 分钟阈值）
  parts: [
    { file: part1Name, seconds: 1950, bytes: 1024 },
    { file: part2Name, seconds: 1950, bytes: 1024 },
  ],
  chapters: [],
}));

// 构造带有 20 个已关闭历史旧课件陈年撤销栈 + 历史笔迹的初始 workspace.json，验证启动与存盘无损瘦身
const bloatedHistory = {};
for (let i = 0; i < 20; i++) {
  bloatedHistory[`closed-ppt-${i}#0|teacher`] = {
    undo: Array.from({ length: 40 }, (_, k) => ({ before: [], after: [{ id: `s-${i}-${k}`, tool: 'pen', author: 'teacher', color: '#fff', size: 3, pts: [0.1, 0.1, 0.5, 0.4, 0.3, 0.5] }] })),
    redo: [],
  };
}
const sampleStroke = (id, x = 0.15) => ({ id, tool: 'pen', author: 'teacher', color: '#ffffff', size: 3, pts: [x, 0.2, 0.5, x + 0.2, 0.35, 0.5] });

fs.writeFileSync(path.join(DATA, 'study', 'study.json'), JSON.stringify({
  questions: [],
  attempts: [],
  homework: [{
    id: 'hw-1',
    studentId: 'stu-a',
    at: new Date(recEndMs + 300_000).toISOString(),
    createdAt: new Date(recEndMs + 300_000).toISOString(),
    title: '受力分析课后巩固',
    questionIds: ['q1'],
    files: [hwStudent.replace(/\\/g, '/'), hwAnswer.replace(/\\/g, '/')],
  }],
  notes: [],
  portraits: {},
  sorts: [],
  preps: [],
  lessons: [{
    id: 'les-1',
    studentId: 'stu-a',
    date: todayStr,
    at: new Date(recEndMs + 100_000).toISOString(),
    topic: '受力分析与正交分解',
    minutes: 65,
    summary: '梳理了弹力方向判断与斜面正交分解步骤。',
    strengths: ['斜面建系熟练'],
    problems: ['静摩擦力方向偶尔漏判'],
    next: ['巩固临界态受力分析'],
    parent: '林晓家长您好，今天一起梳理了受力分析与正交分解，孩子课堂互动很积极！',
    files: [parentPng.replace(/\\/g, '/')],
    homework: '完成课后巩固 5 题',
    via: 'ai',
  }],
  files: [
    { id: 'f-board', studentId: 'stu-a', at: new Date(recEndMs + 200_000).toISOString(), kind: 'board', title: '受力分析课堂板书', path: boardPdf.replace(/\\/g, '/'), via: 'manual' },
    { id: 'f-hw-stu', studentId: 'stu-a', at: new Date(recEndMs + 250_000).toISOString(), kind: 'material', title: '受力分析课后巩固', path: hwStudent.replace(/\\/g, '/'), via: 'assistant' },
    { id: 'f-hw-ans', studentId: 'stu-a', at: new Date(recEndMs + 260_000).toISOString(), kind: 'material', title: '受力分析课后巩固-答案解析版', path: hwAnswer.replace(/\\/g, '/'), via: 'assistant' },
  ],
}));

fs.writeFileSync(path.join(DATA, 'workspace.json'), JSON.stringify({
  shared: {
    pgmMat: { id: 'board', kind: 'board', title: '课堂黑板', pages: [{ w: 1600, h: 900 }], total: 1 },
    pgm: { materialId: 'board', page: 0, slide: 0, fit: 'page', zoom: 1 },
    ink: {
      'old-courseware#0': [sampleStroke('old-1', 0.12), sampleStroke('old-2', 0.32)],
      'board#0': [sampleStroke('cur-1', 0.25)],
    },
    answerGuard: true,
  },
  history: bloatedHistory,
  settings: { autoAnalyze: false, autoMap: false, transcribe: false, shortDrop: false },
  local: {
    roots: [workDir],
    students: [
      { id: 'stu-a', name: '林晓', grade: '高一', hue: 195, textbook: '人教版 2019', tags: [], lessons: 1, lastTopic: '受力分析', lastAt: todayStr, subject: 'physics' },
      { id: 'stu-b', name: '陈默', grade: '高二', hue: 150, textbook: '人教版 2019', tags: [], lessons: 5, lastTopic: '电场强度', lastAt: todayStr, subject: 'physics' },
    ],
    studentId: 'stu-a',
    classOf: 'stu-a',
    slots: [],
    learning: {},
  },
}));

const electron = require('electron');
const { app } = electron;
const site = require('./fake-site-account.cjs');
const { receive, encodeCode } = require('../electron/importLink.cjs');
const { Account } = require('../electron/account.cjs');

const errors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, d) => { if (d?.level >= 3) errors.push(d.message); });
  wc.on('render-process-gone', (_ev, d) => errors.push('renderer-gone:' + d.reason));
});
require('../electron/main.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => {
  const t = Date.now();
  let last;
  while (Date.now() - t < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(120);
  }
  throw new Error('Timed out ' + what + (last ? ' (' + last.message + ')' : ''));
};
const timer = setTimeout(() => { console.error('v180-linglong timed out'); app.exit(1); }, 300000);
const pass = (msg) => console.log('PASS ' + msg);

(async () => {
  const api = await until(() => globalThis.classroomStudioTest, 25000, 'test api');
  const teacher = api.windows.get('teacher');
  await api.dock.ensure();
  const student = await api.makeWindow('student');
  const dock = api.windows.get('dock');

  const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4200;
  teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });
  student.setBounds({ x: left, y: 980, width: 1280, height: 720 });
  teacher.showInactive();
  student.showInactive();

  const runIn = (w) => async (code) => {
    const r = await w.webContents.executeJavaScript(`(async()=>{try{const Q=window.__studioQA;${code}}catch(e){return {__err:String(e&&e.stack||e)}}})()`);
    if (r && r.__err) throw new Error('page error: ' + r.__err);
    return r;
  };
  const T = runIn(teacher);
  const S = runIn(student);
  const D = runIn(dock);

  await until(() => teacher.webContents.executeJavaScript('!!window.__studioQA'), 20000, 'teacher QA');
  await until(() => student.webContents.executeJavaScript('!!window.__studioQA'), 20000, 'student QA');
  await until(() => dock.webContents.executeJavaScript('!!window.__studioQA'), 20000, 'dock QA');
  await until(() => T(`return Q.useStudy.getState().loaded`), 15000, 'study loaded');

  // 关闭首次登录引导面板，以免遮挡点击
  await T(`Q.account.useAccount.setState({ checked: true, panel: null }); return true`);

  // ═══════════════════════════════════════════════════════════════
  // 1. 品牌升级「玲珑课堂」1.8.0、双协议导入、玲珑账号旧专用 Key 兼容复用
  // ═══════════════════════════════════════════════════════════════
  assert.equal(teacher.getTitle(), '玲珑课堂 · 教师端', '教师端窗口标题应为玲珑课堂');
  const docTitle = await T(`return document.title`);
  assert.match(docTitle, /玲珑课堂/, '页面标题包含玲珑课堂');

  // 验证 linglong-classroom:// 新协议与 target='linglong-classroom' 均能通过校验
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    schema: 'yinzi-import/1',
    target: 'linglong-classroom',
    nonce: 'nonce_180_test_abcd',
    iat: nowSec - 5,
    exp: nowSec + 300,
    site: { name: '银子 API', origin: 'https://yinziapi.top' },
    credentials: { api_key: 'sk-yinzitest1234567890abcdef', base_url: 'https://yinziapi.top/v1', key_name: '玲珑课堂', smart_routing: true },
    slots: { text: { model: 'gpt-6-astra' } },
  };
  const b64 = encodeCode(payload).slice('YZIMPORT1:'.length);
  const parsedNewScheme = await receive(`linglong-classroom://v1/import?data=${b64}`);
  assert.equal(parsedNewScheme.keyName, '玲珑课堂');
  assert.equal(parsedNewScheme.text, 'gpt-6-astra');

  // 验证玲珑账号：老用户已有「最强网课教辅系统」专用 Key 时直接复用不新建；新用户自动建「玲珑课堂」
  const fakeSite = await site.start();
  try {
    const sites = [{ id: 'linglong', name: '玲珑账号', origin: fakeSite.url, app: true }];
    const crypt = { available: true, encrypt: (s) => 'E:' + s, decrypt: (s) => s.slice(2) };
    const accOld = new Account({ dir: path.join(out, 'acc-old'), crypt, client: 'classroom/1.8.0', sites });
    await accOld.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' });
    fakeSite.st.tokens.push({ id: 99, user: accOld.state.userId, name: '最强网课教辅系统', status: 1, group: 'auto', routing_policy: '{}', unlimited_quota: true });
    const reused = await accOld.ensureKey();
    assert.equal(reused.id, 99, '老用户已有的「最强网课教辅系统」专用 Key 应直接沿用');
    assert.equal(fakeSite.st.tokens.length, 1, '不应重复新建第二把 Key');

    fakeSite.st.tokens.length = 0;
    const accNew = new Account({ dir: path.join(out, 'acc-new'), crypt, client: 'classroom/1.8.0', sites });
    await accNew.login({ site: 'linglong', username: 'teacher', password: 'pass-1234' });
    await accNew.ensureKey();
    assert.equal(fakeSite.st.tokens.length, 1);
    assert.equal(fakeSite.st.tokens[0].name, '玲珑课堂', '新用户建立的专用 Key 名字应为「玲珑课堂」');
  } finally {
    await fakeSite.close();
  }
  pass('1. 品牌升级「玲珑课堂」、双协议导入与玲珑账号新旧专用 Key 无缝兼容通过');

  // ═══════════════════════════════════════════════════════════════
  // 2. 常驻「一键清空上堂课课面」+ 自动归档板书 PDF + 一键「恢复课面」
  // ═══════════════════════════════════════════════════════════════
  // 初始画面属于 stu-a（林晓）且黑板有笔迹；现在切换到 stu-b（陈默）
  await T(`Q.useStore.getState().set({ page: 'console', classOf: 'stu-a', studentId: 'stu-b' }); return true`);
  await until(() => T(`
    const btn = document.querySelector('[data-qa="top-clear-class"]');
    return btn && btn.classList.contains('stale') && btn.innerText.includes('林晓');
  `), 8000, '顶栏高亮提示清空上堂课课面');
  await until(() => D(`return !!document.querySelector('[data-qa="dock-clear-class"]')`), 8000, '浮层同步显示清空课面按钮');

  const filesBeforeClear = await T(`return Q.useStudy.getState().data.files.filter(f => f.studentId === 'stu-a' && f.kind === 'board').length`);
  await T(`document.querySelector('[data-qa="top-clear-class"]').click(); return true`);

  await until(() => T(`return (Q.useStore.getState().ink['board#0'] || []).length === 0`), 10000, '点击清空后黑板笔迹已擦净');
  const filesAfterClear = await until(() => T(`
    const n = Q.useStudy.getState().data.files.filter(f => f.studentId === 'stu-a' && f.kind === 'board').length;
    return n > ${filesBeforeClear} ? n : 0;
  `), 10000, '清空前自动将上堂课板书存为 PDF 归入原学生名下');
  assert.ok(filesAfterClear > filesBeforeClear);

  // 原位出现「恢复课面」，点击后恢复笔迹
  await until(() => T(`return !!document.querySelector('[data-qa="top-restore-class"]')`), 6000, '清空后出现恢复课面按钮');
  await until(() => D(`return !!document.querySelector('[data-qa="dock-restore-class"]')`), 6000, '浮层同步出现恢复课面按钮');
  await T(`document.querySelector('[data-qa="top-restore-class"]').click(); return true`);
  await until(() => T(`return (Q.useStore.getState().ink['board#0'] || []).length === 1`), 8000, '一键恢复课面找回原笔迹');
  pass('2. 顶栏与浮层常驻「一键清空课面」（自动存 PDF 归档）与一键「恢复课面」通过');

  // ═══════════════════════════════════════════════════════════════
  // 3. 上下课按钮三段式显隐 + 动笔未录轻提醒 + 自由拖动与占满课件避让
  // ═══════════════════════════════════════════════════════════════
  // 切回 stu-a，排一节 8 分钟后开始的课（课前 12 分钟窗口内），验证开课前醒目状态（idle-prominent）显示学生名字
  const startSoon = new Date(Date.now() + 8 * 60_000);
  const startSoonHour = startSoon.getHours() + startSoon.getMinutes() / 60;
  await T(`
    const st = Q.useStore.getState();
    st.set({
      studentId: 'stu-a',
      classOf: 'stu-a',
      slots: [{ id: 'slot-soon', studentId: 'stu-a', day: (${startSoon.getDay()} + 6) % 7, date: '${dk(startSoon)}', start: ${startSoonHour}, len: 1, topic: '受力分析', repeat: false }],
    });
    Q.autoRecord.tick();
    return true;
  `);
  await until(() => S(`
    const el = document.querySelector('[data-qa="class-corner"]');
    const pill = el?.querySelector('.cc-pill');
    return el && el.dataset.state === 'idle' && pill?.classList.contains('idle-prominent') && el.innerText.includes('林晓');
  `), 8000, '开课前学生窗按钮醒目显示学生姓名');

  // 未开录时在黑板上连写 3 笔 → 触发教师顶栏与浮层的「已在写板书 · 点此开录」，且学生窗口绝不出现该提醒文字
  await T(`
    const st = Q.useStore.getState();
    st.addStroke('board#0', { id: 'live-unrec-1', tool: 'pen', author: 'teacher', color: '#fff', size: 3, pts: [0.2, 0.2, 0.5, 0.4, 0.28, 0.5] });
    st.addStroke('board#0', { id: 'live-unrec-2', tool: 'pen', author: 'teacher', color: '#fff', size: 3, pts: [0.22, 0.3, 0.5, 0.45, 0.36, 0.5] });
    st.addStroke('board#0', { id: 'live-unrec-3', tool: 'pen', author: 'teacher', color: '#fff', size: 3, pts: [0.24, 0.38, 0.5, 0.48, 0.44, 0.5] });
    Q.autoRecord.tick();
    return true;
  `);
  await until(() => T(`return !!document.querySelector('[data-qa="top-unrecorded"]')`), 8000, '教师顶栏出现动笔未录提醒');
  await until(() => D(`return !!document.querySelector('[data-qa="dock-unrecorded"]')`), 8000, '教师浮层出现动笔未录提醒');
  const studentText = await S(`return document.body.innerText`);
  assert.doesNotMatch(studentText, /已在写板书|没录·点我开录/, '学生共享窗口绝不露出动笔未录提醒文字');

  // 点静默按钮可收起本节动笔未录提醒
  await T(`document.querySelector('[data-qa="top-unrecorded"] .tb-unrec-x').click(); return true`);
  await until(() => T(`return !document.querySelector('[data-qa="top-unrecorded"]')`), 5000, '动笔未录静默生效');

  // 开始上课录课（课还未到下课点）→ 学生窗角标自动进入低调半透明 quiet 模式，双击可折叠成微标
  await S(`document.querySelector('[data-qa="class-start"]').click(); return true`);
  await until(() => api.recording.status.phase === 'recording', 15000, '开始录课');
  await T(`Q.autoRecord.tick(); return true`);
  const quietInfo = await until(() => S(`
    const el = document.querySelector('[data-qa="class-corner"]');
    const pill = el?.querySelector('.cc-pill');
    if (!el || el.dataset.state !== 'quiet' || !pill?.classList.contains('quiet')) return null;
    const op = parseFloat(getComputedStyle(pill).opacity);
    return op <= 0.5 ? { state: el.dataset.state, op } : null;
  `), 8000, '上课中角标进入半透明 quiet 低调态');
  assert.equal(quietInfo.state, 'quiet');

  await S(`document.querySelector('[data-qa="class-corner"] .cc-pill').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true`);
  await until(() => S(`return !!document.querySelector('[data-qa="class-mini"]')`), 5000, '双击折叠为微缩角标');
  await S(`document.querySelector('[data-qa="class-mini"]').click(); return true`);
  await until(() => S(`return !document.querySelector('[data-qa="class-mini"]')`), 5000, '点击展开微缩角标');

  // 把录像开始时刻拨到 65 分钟前，并排一节 62 分钟前开始、2 分钟前已下课的课 → 学生窗角标自动切换为高可见度 overtime 提醒下课
  const dAgo = new Date(Date.now() - 62 * 60_000);
  const startAgoHour = dAgo.getHours() + dAgo.getMinutes() / 60;
  api.recording.update({ startedAt: Date.now() - 65 * 60_000 });
  await T(`
    Q.useStore.getState().set({
      slots: [{ id: 'slot-over', studentId: 'stu-a', day: (${dAgo.getDay()} + 6) % 7, date: '${dk(dAgo)}', start: ${startAgoHour}, len: 1, topic: '受力分析', repeat: false }],
    });
    Q.autoRecord.tick();
    return true;
  `);
  await until(() => S(`
    const el = document.querySelector('[data-qa="class-corner"]');
    return el && el.dataset.state === 'overtime' && /到点/.test(el.innerText);
  `), 8000, '到下课点自动恢复高亮提醒');
  await until(() => T(`return /到点/.test(document.querySelector('[data-qa="top-rec-btn"]')?.innerText || '')`), 6000, '教师顶栏同步高亮到点下课');

  // 停止录像并等待收尾
  await T(`await Q.recordingMod.stopRecording(); return true`);
  await until(() => !api.recording.live, 20000, '录像停止完成');

  // 测试占满窗口课件时右上角自动左移避让 + 自由拖动持久化
  await S(`localStorage.removeItem('cs.classCorner.pos.v1'); return true`);
  await T(`
    const mat = { id: 'full-doc-1', kind: 'image', title: '占满讲义', pages: [{ w: 1600, h: 900, src: 'data:image/png;base64,${MIN_PNG.toString('base64')}' }], total: 1 };
    const st = Q.useStore.getState();
    st.cue(mat);
    st.take();
    return true;
  `);
  const dodgeCheck = await until(() => S(`
    const corner = document.querySelector('[data-qa="class-corner"]');
    const fullbar = document.querySelector('.desk-fullbar');
    if (!corner || !corner.classList.contains('dodged')) return null;
    if (fullbar) {
      const a = corner.getBoundingClientRect(), b = fullbar.getBoundingClientRect();
      if (b.width > 0 && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) return null;
    }
    return { dodged: true, right: corner.style.right };
  `), 8000, '占满课件时角标自动左移让开右上角窗口控制条');
  assert.equal(dodgeCheck.dodged, true);

  // 模拟按住角标拖到左上区域 (x=180, y=36)，验证写入 localStorage
  await S(`
    const c = document.querySelector('[data-qa="class-corner"]');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: r.left + 8, clientY: r.top + 8 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 180, clientY: 36 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 180, clientY: 36 }));
    return true;
  `);
  const savedPos = await until(() => S(`return localStorage.getItem('cs.classCorner.pos.v1')`), 5000, '拖动位置写入本机存储');
  assert.equal(JSON.parse(savedPos).sideX, 'left');
  pass('3. 上下课按钮三段式防漏录、动笔未录轻提醒、自动避让右上角课件按钮与自由拖动记忆全部通过');

  // ═══════════════════════════════════════════════════════════════
  // 4. 「课后发家长」统一交付抽屉 + 全站原地轻预览 + 原生拖拽硬链接重命名
  // ═══════════════════════════════════════════════════════════════
  // 先在导播台放一个特定的预监课件 keep-pvw-test，再切到「回放」页，验证轻预览绝不改 page、绝不改 pvw
  await T(`
    const keepMat = { id: 'keep-pvw-test', kind: 'board', title: '下节课预监课件', pages: [{ w: 1600, h: 900 }], total: 1 };
    Q.useStore.getState().set({
      page: 'replay',
      pvw: { mat: keepMat, view: { materialId: 'keep-pvw-test', page: 0, slide: 0, fit: 'page', zoom: 1 } },
    });
    return true;
  `);

  await until(() => T(`return !!document.querySelector('[data-qa="top-deliver-btn"]')`), 6000, '顶栏常驻发家长按钮');
  // 直接指定打开 65 分钟那堂课 rec-long-1
  await T(`
    const btn = document.querySelector('[data-qa="top-deliver-btn"]');
    btn.click();
    return true;
  `);
  await until(() => T(`return !!document.querySelector('[data-qa="deliver-drawer"]')`), 8000, '打开课后发家长抽屉');

  // 等待录像列表异步加载完毕并选中包含「65 分钟」且带「分段×2」的那堂课（rec-long-1）
  await until(() => T(`
    const row = [...document.querySelectorAll('[data-qa="dlv-lesson-item"]')].find(el => el.innerText.includes('65 分钟') && el.innerText.includes('分段×2'));
    if (!row) return false;
    if (!row.classList.contains('on')) row.click();
    return row.classList.contains('on') && !!document.querySelector('[data-qa="deliver-drawer"] [data-qa="dlv-item-video"]');
  `), 8000, '选中 65 分钟带分段回放的课次');

  // 验证：① 微信分段默认勾选，65分钟完整大文件默认不勾；② 答案解析版默认收进防误发折叠栏且未勾选
  const checkSummary = await until(() => T(`
    const drawer = document.querySelector('[data-qa="deliver-drawer"]');
    if (!drawer) return null;
    const ansFold = drawer.querySelector('[data-qa="dlv-answer-guard"]');
    if (!ansFold) return null;
    const checkedLabels = [...drawer.querySelectorAll('.dlv-item.on b')].map(b => b.innerText);
    return {
      hasAnsFold: !!ansFold,
      ansFoldText: ansFold.innerText,
      checkedLabels,
    };
  `), 8000, '微信分段优先与答案版折叠防误发检查');
  assert.ok(checkSummary.hasAnsFold, '应存在答案版折叠防误发区');
  assert.ok(checkSummary.checkedLabels.some((t) => t.includes('微信分段 1/2')), '超 1 小时课应默认勾选微信分段: ' + JSON.stringify(checkSummary.checkedLabels));
  assert.ok(checkSummary.checkedLabels.some((t) => t.includes('家长版课后反馈长图')), '应默认勾选家长版课后反馈长图');
  assert.ok(!checkSummary.checkedLabels.some((t) => t.includes('完整未分段原片')), '超 1 小时完整原片默认不重复勾选');
  assert.ok(!checkSummary.checkedLabels.some((t) => t.includes('答案解析')), '答案解析版绝不能默认勾选');

  // 在抽屉里点击预览第一个文件 → 弹出 QuickPreview，且 page 仍为 replay，pvw 仍为 keep-pvw-test
  await T(`
    const prevBtn = document.querySelector('[data-qa="deliver-drawer"] [data-qa="dlv-item-preview"]');
    if (!prevBtn) throw new Error('找不到抽屉内预览按钮');
    prevBtn.click();
    return true;
  `);
  const previewGuard = await until(() => T(`
    const qp = document.querySelector('[data-qa="quick-preview"]');
    if (!qp) return null;
    const st = Q.useStore.getState();
    return { page: st.page, pvwId: st.pvw?.mat?.id, title: qp.innerText };
  `), 8000, '原地轻预览弹出');
  assert.equal(previewGuard.page, 'replay', '原地预览绝不能跳回 console 上课页');
  assert.equal(previewGuard.pvwId, 'keep-pvw-test', '原地预览绝不能覆盖右侧正在准备的 pvw 预监');

  // 关闭轻预览
  await T(`document.querySelector('[data-qa="qp-close"]').click(); return true`);
  await until(() => T(`return !document.querySelector('[data-qa="quick-preview"]')`), 5000, '关闭轻预览');

  // 触发底部「按住拖进微信」原生拖拽，核验硬链接中文文件名与自动已发标记
  await T(`
    const handle = document.querySelector('[data-qa="dlv-drag-all"]');
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  `);
  const dragResult = await until(() => api.deliverDrag.lastDrag, 6000, '主进程收到原生文件拖出请求');
  assert.ok(dragResult.files.length >= 4, '应拖出微信分段 2 段 + 家长长图 + 板书 + 学生版作业: ' + JSON.stringify(dragResult.files));
  assert.ok(dragResult.files.every((f) => fs.existsSync(f)), '所有硬链接暂存文件真实存在且可读');
  assert.ok(dragResult.files.some((f) => /林晓.*第1段/.test(path.basename(f))), '文件名已美化为带学生姓名的清晰中文名: ' + JSON.stringify(dragResult.files));
  assert.ok(!dragResult.files.some((f) => /答案解析/.test(path.basename(f))), '拖出列表不含未勾选的答案解析版');

  // 验证一键复制文件列表接口
  const copyRes = await T(`return await Q.host.call('deliver.copyFiles', { lessonKey: 'rec:rec-long-1', items: [{ path: ${JSON.stringify(parentPng)}, niceName: '林晓-11月21日-课后反馈长图.png' }] })`);
  assert.equal(copyRes.ok, true);
  assert.equal(copyRes.count, 1);
  pass('4. 「课后发家长」抽屉、微信分段优先、答案版折叠防误发、原地 QuickPreview 不串台与硬链接原生拖出全部通过');

  // ═══════════════════════════════════════════════════════════════
  // 5. workspace.json 无损瘦身 + 二次冷启动恢复防黑屏验证
  // ═══════════════════════════════════════════════════════════════
  await T(`await Q.flushStore(); return true`);
  await api.saving();
  const diskWs = JSON.parse(fs.readFileSync(path.join(DATA, 'workspace.json'), 'utf8'));
  const remainingHistoryKeys = Object.keys(diskWs.history || {});
  assert.ok(!remainingHistoryKeys.some((k) => k.startsWith('closed-ppt-')), '20 个早已关闭的历史课件撤销栈应被全部清理: ' + remainingHistoryKeys.join(','));
  assert.equal((diskWs.shared?.ink?.['old-courseware#0'] || []).length, 2, '历史课件的真实笔迹必须一笔不漏完整保留');

  // 将刚落盘的真实数据文件拷到独立目录（排除父进程仍占用的 browser GPU 缓存目录）拉起第二个独立 Electron 进程验证二次冷启动
  clearTimeout(timer);
  const DATA2 = out + '-boot2';
  fs.mkdirSync(path.join(DATA2, 'study'), { recursive: true });
  fs.copyFileSync(path.join(DATA, 'workspace.json'), path.join(DATA2, 'workspace.json'));
  if (fs.existsSync(path.join(DATA, 'deliver-sent.json'))) fs.copyFileSync(path.join(DATA, 'deliver-sent.json'), path.join(DATA2, 'deliver-sent.json'));
  if (fs.existsSync(path.join(DATA, 'study', 'study.json'))) fs.copyFileSync(path.join(DATA, 'study', 'study.json'), path.join(DATA2, 'study', 'study.json'));
  for (const w of electron.BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.destroy();
  }
  const second = spawnSync(process.execPath, [path.join(__dirname, 'quiet.cjs'), __filename], {
    env: { ...process.env, CS_SECOND_BOOT: '1', CS_DATA_DIR: DATA2 },
    encoding: 'utf8',
    timeout: 60000,
  });
  const secondOut = (second.stdout || '') + '\n' + (second.stderr || '');
  assert.equal(second.status, 0, '二次冷启动子进程退出码应为 0:\n' + secondOut);
  assert.match(secondOut, /SECOND_BOOT_OK/, '二次冷启动子进程应输出 SECOND_BOOT_OK:\n' + secondOut);
  pass('5. workspace.json 陈年撤销栈无损瘦身（历史笔迹 100% 保留）与二次冷启动防黑屏验证通过');

  assert.equal(errors.length, 0, '全程零严重控制台报错: ' + errors.join('; '));
  console.log('ALL PASS v180-linglong');
  app.exit(0);
})().catch((err) => {
  console.error('FAIL v180-linglong:', err);
  app.exit(1);
});
