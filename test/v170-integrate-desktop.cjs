'use strict';
// 1.7.0 合并后桌面联调验收（本地模拟服务器 + 离线页面，零模型花费，严禁真实键鼠）：
// 1. 必修1 界面进度：沙箱预热 running 时工坊显示进度条与耗时文案、小羽抽屉显示预热提示，failed 时可点「重试准备」，ready 后消失
// 2. 必修7 跨分支联调：
//    - 工具分支 web_fetch 抓静态真题卷落盘「资料/来源」并写「索引.md」→ 即使原网址随后 403，技能分支 deliverCheck / sourceCheck 也能直接用归档原文核对通过
//    - 动态 JS 渲染真题页（纯 HTTP fetch 只能拿到空壳「加载中」）→ deliverCheck 自动通过 WebTools 隐藏浏览器渲染兜底核对通过，并识别改了数字的假真题
//    - 课件设计包（.cs-kit）多页 HTML 课件同时走工具分支 page_check（带截图返回）与技能分支 deliverCheck（pack 单文件 + probeHtml），两边一致检出 KaTeX 公式错误，修好后两边一致通过
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const out = path.join(process.env.CS_TEST_OUT || path.join(__dirname, '../.out/A'), 'v170-integrate-' + Date.now());
fs.mkdirSync(out, { recursive: true });
process.env.CS_TEST = '1';
process.env.CS_ALLOW_LOCAL_WEB = '1';
process.env.CS_DATA_DIR = path.join(out, 'data');
fs.mkdirSync(process.env.CS_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CS_DATA_DIR, 'workspace.json'), JSON.stringify({
  settings: { autoAnalyze: false, autoMap: false, transcribe: false },
  local: { roots: [], students: [], slots: [], learning: {} },
}));

const electron = require('electron');
const { app, dialog } = electron;
dialog.showErrorBox = () => {};
const errors = [];
const fatal = (why, e) => { console.error('FAIL', why, e?.stack || e); app.exit(1); };
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (ev) => {
    if (ev.level === 'error' && wc.getURL().startsWith('studio://')) errors.push(String(ev.message).slice(0, 300));
  });
});

require('../electron/main.cjs');
const kit = require('../electron/agentKit.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = '') => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(120);
  }
  throw new Error('Timed out: ' + what + (last ? ' (' + last.message + ')' : ''));
};

const timer = setTimeout(() => fatal('timeout', '桌面联调超过 5 分钟'), 5 * 60000);

(async () => {
  // 本地模拟教研网服务器（纯本机 127.0.0.1，不连外网）
  let blockStatic = false;
  const srv = http.createServer((req, res) => {
    if (req.url === '/paper-static.html') {
      if (blockStatic) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('forbidden'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>2024北京海淀高一上期中物理</title><body>
        <h1>2024-2025学年北京市海淀区高一（上）期中物理试卷</h1>
        <p>7. 质量为 50 kg 的乘客站在电梯内的体重计上，电梯以 2 m/s² 的加速度匀加速上升，重力加速度 g 取 10 m/s²，此时体重计的示数为多少？</p>
        <p>A. 400 N　B. 500 N　C. 600 N　D. 700 N</p>
      </body>`);
      return;
    }
    if (req.url === '/paper-spa.html') {
      // 纯 HTTP 抓取只能看到「正在加载试卷…」，必须经 WebTools 隐藏浏览器执行脚本后才出现真题正文
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>2024北京西城高一期末物理</title><body>
        <div id="paper">正在加载试卷…</div>
        <script>
          const parts = ['12. 神舟飞船返回舱在距离地面 1.2 m 处启动反推发动机，', '质量为 3000 kg 的返回舱以 25 m/s² 的加速度匀减速下降，处于超重状态，求反推发动机提供的推力大小。'];
          document.getElementById('paper').innerHTML = '<article>' + parts.join('') + '</article>';
        </script>
      </body>`);
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  try {
    const api = await until(() => globalThis.classroomStudioTest, 20000, 'classroomStudioTest');
    const teacher = api.windows.get('teacher');
    const page = (code) => teacher.webContents.executeJavaScript(code);
    await until(() => page('!!document.querySelector(".ta")'), 30000, '教师窗口加载');
    const left = Math.min(...electron.screen.getAllDisplays().map((d) => d.bounds.x)) - 4000;
    teacher.setBounds({ x: left, y: 30, width: 1440, height: 900 });

    // ── 1. 必修1：界面显示后台沙箱预热进度条与失败重试 ──
    await page(`(() => {
      const btn = [...document.querySelectorAll('button, [role="tab"]')].find(b => b.textContent && b.textContent.includes('备课'));
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(300);
    await page(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent && (b.textContent.includes('AI 工坊') || b.textContent.includes('工坊')));
      if (btn) btn.click();
      return true;
    })()`);

    api.codexHome.update({ phase: 'running', pct: 42, elapsedSec: 55, step: '正在准备 AI 安全运行环境（首次使用约 3～5 分钟，已进行 55 秒）…', error: '' });
    await until(() => page(`document.querySelector('[data-qa="codex-warmup"]')?.innerText?.includes('55 秒')`), 8000, '工坊显示沙箱预热进度条');
    console.log('PASS 工坊界面实时显示 Codex 沙箱后台预热进度条与秒数');

    let retried = 0;
    const origPrewarm = api.codexHome.prewarm.bind(api.codexHome);
    api.codexHome.prewarm = async () => {
      retried += 1;
      api.codexHome.update({ phase: 'ready', pct: 100, elapsedSec: 1, step: 'AI 安全运行环境已就绪', error: '' });
      return { ok: true };
    };
    api.codexHome.update({ phase: 'failed', pct: 42, elapsedSec: 60, step: '沙箱准备测试失败', error: '沙箱准备测试失败' });
    await until(() => page(`!!document.querySelector('[data-qa="codex-warmup-failed"] button')`), 8000, '工坊显示预热失败与重试按钮');
    await page(`document.querySelector('[data-qa="codex-warmup-failed"] button').click(), true`);
    await until(() => retried === 1 && page(`!document.querySelector('[data-qa="codex-warmup"]') && !document.querySelector('[data-qa="codex-warmup-failed"]')`), 8000, '点击重试准备后恢复就绪');
    api.codexHome.prewarm = origPrewarm;
    console.log('PASS 预热失败提示与「重试准备」按钮工作正常');

    // ── 2. 必修7：web_fetch 归档 + 动态网页渲染兜底 + 来源核对联调 ──
    const work = path.join(out, 'joint-task');
    fs.mkdirSync(work, { recursive: true });
    kit.installKit(work, 'codex', '');
    api.toolHost.register('task:joint', { title: '联调任务', work, perm: 'full', source: 'task' });

    const fetched = await api.toolHost.call('task:joint', 'web_fetch', { url: `${base}/paper-static.html` });
    assert.equal(fetched.isError, undefined, fetched.text);
    assert.ok(fs.existsSync(path.join(work, '资料', '来源', '索引.md')), 'web_fetch 写入来源索引');
    // 关掉静态卷接口（返回 403），验证 sourceCheck 直接命中 web_fetch 已存进「资料/来源」的归档原文！
    blockStatic = true;

    const bankFile = path.join(work, '超重与失重-题库.json');
    fs.writeFileSync(bankFile, JSON.stringify({
      version: 1,
      topic: '超重与失重',
      questions: [
        {
          stem: '质量为 50 kg 的乘客站在电梯内的体重计上，电梯以 2 m/s² 的加速度匀加速上升，重力加速度 g 取 10 m/s²，此时体重计的示数为多少？\nA. 400 N\nB. 500 N\nC. 600 N\nD. 700 N',
          answer: 'C',
          qtype: '选择',
          difficulty: 2,
          verified: true,
          source: { kind: '真题', title: '2024北京海淀高一上期中物理', no: '第 7 题', year: '2024', region: '北京海淀', url: `${base}/paper-static.html` },
        },
        {
          stem: '神舟飞船返回舱在距离地面 1.2 m 处启动反推发动机，质量为 3000 kg 的返回舱以 25 m/s² 的加速度匀减速下降，处于超重状态，求反推发动机提供的推力大小。',
          answer: '1.05×10⁵ N',
          qtype: '计算',
          difficulty: 3,
          verified: true,
          source: { kind: '真题', title: '2024北京西城高一期末物理', no: '第 12 题', year: '2024', region: '北京西城', url: `${base}/paper-spa.html` },
        },
        {
          stem: '质量为 80 kg 的乘客站在电梯内的体重计上，电梯以 3 m/s² 的加速度匀加速上升，重力加速度 g 取 10 m/s²，此时体重计的示数为多少？',
          answer: '1040 N',
          qtype: '计算',
          difficulty: 2,
          verified: true,
          source: { kind: '真题', title: '2024北京海淀高一上期中物理', no: '第 7 题', year: '2024', region: '北京海淀', url: `${base}/paper-static.html` },
        },
      ],
    }, null, 2));

    const check1 = await api.checkDeliverables({ work, turnStart: Date.now() - 5000, skill: 'practice-set' });
    assert.equal(check1.banks.length, 1);
    assert.equal(check1.banks[0].verified, 2, '归档静态卷 + WebTools 渲染动态 SPA 卷均核对通过');
    assert.equal(check1.banks[0].unverified, 1, '改了数字的假真题被准确拦下');
    assert.ok(check1.problems.some((p) => p.includes('数字对不上')), check1.problems.join('\n'));
    console.log('PASS 来源核对与 web_fetch 归档索引 + 动态网页渲染兜底联调通过');

    // ── 3. 必修7：课件设计包（.cs-kit）× page_check 截图自检 × deliverCheck 单文件打包联调 ──
    const htmlFile = path.join(work, '超重与失重.html');
    const makeHtml = (formula) => `<!doctype html><html><head><meta charset="utf-8"><title>超重与失重</title>
      <link rel="stylesheet" href=".cs-kit/vendor/katex.min.css">
      <link rel="stylesheet" href=".cs-kit/cs-deck.css"></head>
      <body data-style="clean"><main class="cs-deck">
        <section class="cs-page"><h1>超重与失重</h1><p>电梯加速上升时的受力关系</p></section>
        <section class="cs-page"><h2>核心规律</h2><p>支持力公式：$${formula}$</p><button id="b1" onclick="this.dataset.clicked='1'">试一试</button></section>
      </main>
      <script src=".cs-kit/vendor/katex.min.js"></script>
      <script src=".cs-kit/vendor/auto-render.min.js"></script>
      <script src=".cs-kit/cs-deck.js"></script></body></html>`;

    // 先写一个带坏公式的第二页：验证 page_check 会自动跑 CS.selfTest() 检出第 2 页 KaTeX 报错并返回截图
    fs.writeFileSync(htmlFile, makeHtml('\\frac{1}{'));
    const pcBad = await api.toolHost.call('task:joint', 'page_check', { file: '超重与失重.html' });
    assert.ok(!pcBad.isError, pcBad.text);
    assert.ok(pcBad.images?.length >= 2, 'page_check 返回截图给模型');
    assert.match(pcBad.text, /课件设计包逐页自检/);
    assert.match(pcBad.text, /公式错误/);
    assert.match(pcBad.text, /结论：发现 \d+ 个问题/);

    // 修好公式后再过一遍 deliverCheck（单文件打包 + probeHtml）和 page_check：两边都零报错通过
    fs.writeFileSync(htmlFile, makeHtml('F_N = m(g + a)'));
    fs.unlinkSync(bankFile);
    const check2 = await api.checkDeliverables({ work, turnStart: Date.now() - 5000, skill: 'courseware-html' });
    assert.deepEqual(check2.problems, [], '修好公式后 deliverCheck 单文件打包与横竖屏探针零报错：' + check2.problems.join('; '));
    assert.ok(fs.existsSync(path.join(work, '.cs-src', '超重与失重.html')), '单文件打包保留 .cs-src 源文件');

    const pcGood = await api.toolHost.call('task:joint', 'page_check', { file: '超重与失重.html' });
    assert.match(pcGood.text, /结论：没有发现问题/, pcGood.text);
    console.log('PASS .cs-kit 课件设计包 × page_check 截图自检 × deliverCheck 打包探针联调通过');

    const ownErr = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
    assert.equal(ownErr.length, 0, '教师窗口控制台无报错：' + ownErr.join(' | '));
    console.log('ALL PASS v170-integrate-desktop');
    clearTimeout(timer);
    app.exit(0);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
})().catch((e) => fatal('run', e));
