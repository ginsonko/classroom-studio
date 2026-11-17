// 1.7.0 B：课件设计包。示例骨架三种风格逐页截图 + 自检（点按钮、拖滑块、点选题）；
// 打包成单文件后断网打开，公式（KaTeX 字体内嵌）正常渲染、没有外部请求；手机竖屏改成长页。
// 运行：npx electron test/quiet.cjs test/v170b-kit-desktop.cjs   截图在 .out/v170b-kit/
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const { app, BrowserWindow, session } = require('electron');
const { packFile } = require('../electron/agent-kit/kit/pack.cjs');

const KIT = path.join(__dirname, '../electron/agent-kit/kit');
const out = process.env.CS_TEST_OUT || path.join(__dirname, '../.out/v170b-kit'); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok  ', name); } catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '\n', e.stack); } };
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('timed out'); app.exit(1); }, 180000);

async function open(file, { w = 1280, h = 720, offline = false } = {}) {
  const part = 'kit-' + Math.random().toString(36).slice(2);
  const ses = session.fromPartition(part);
  const requests = [];
  ses.webRequest.onBeforeRequest((d, cb) => { if (!/^(file|data|devtools|chrome-extension):/.test(d.url)) { requests.push(d.url); return cb({ cancel: offline }); } cb({}); });
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { partition: part, offscreen: true, sandbox: true } });
  await win.loadFile(file);
  for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('document.body.dataset.csReady === "1"')); i++) await sleep(50);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
  await sleep(250);
  return { win, requests, js: (s) => win.webContents.executeJavaScript(s) };
}
const shot = async (w, name) => { await sleep(450); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };

app.whenReady().then(async () => {
  const src = path.join(KIT, '示例骨架.html');
  await test('示例骨架：三种风格逐页渲染，自检没有报错、没有溢出、公式全部渲染', async () => {
    for (const style of ['clean', 'dark', 'hand']) {
      const p = await open(src);
      await p.js(`document.body.dataset.style = ${JSON.stringify(style)}; window.dispatchEvent(new Event('resize'))`);
      const n = await p.js('CS.deck.pages.length');
      assert.ok(n >= 6, '页数 ' + n);
      for (let i = 0; i < n; i++) { await p.js(`CS.go(${i}); (function(){ var pg = CS.deck.pages[${i}]; for (var k = 0; k < 12; k++) CS.next(); CS.go(${i}, { fromEnd: true }); })()`); await shot(p.win, `${style}-p${i + 1}.png`); }
      const r = await p.js('CS.selfTest()');
      assert.deepEqual(r.errors, [], style + ' 脚本报错');
      assert.deepEqual(r.texErrors, [], style + ' 公式错误');
      assert.deepEqual(r.external, []);
      assert.ok(r.controls.buttons >= 2 && r.controls.quizzes === 2, JSON.stringify(r.controls));
      if (style === 'clean') { assert.deepEqual(r.overflow, [], '溢出 ' + JSON.stringify(r.overflow)); assert.ok(await p.js('document.querySelectorAll(".katex").length') > 20); }
      p.win.destroy();
    }
  });
  await test('分步：下一步先逐条出现，再翻页；上一页回到上一页的最后一步', async () => {
    const p = await open(src);
    await p.js('CS.go(1)');
    assert.equal(await p.js('document.querySelectorAll(".cs-page.on .cs-step.cs-hidden").length'), 4);
    await p.js('CS.next()'); assert.equal(await p.js('document.querySelectorAll(".cs-page.on .cs-step.cs-hidden").length'), 3);
    for (let k = 0; k < 3; k++) await p.js('CS.next()');
    assert.equal(await p.js('CS.deck.i'), 1);
    await p.js('CS.next()'); assert.equal(await p.js('CS.deck.i'), 2);
    await p.js('CS.prev()'); assert.equal(await p.js('CS.deck.i'), 1);
    assert.equal(await p.js('document.querySelectorAll(".cs-page.on .cs-step.cs-hidden").length'), 0);
    p.win.destroy();
  });
  await test('点选题：点错显示正确答案和解析，计分更新', async () => {
    const p = await open(src);
    await p.js('CS.go(6)');
    await p.js('document.querySelector(".cs-quiz .cs-opts li").click()');
    assert.equal(await p.js('document.querySelector(".cs-quiz").classList.contains("done")'), true);
    assert.match(await p.js('document.querySelector(".cs-quiz .cs-explain").textContent'), /正确答案是 C/);
    assert.match(await p.js('document.querySelector(".cs-score").textContent'), /答对 0 \/ 2/);
    await shot(p.win, 'quiz-answered.png');
    p.win.destroy();
  });
  let packed;
  await test('打包成单文件：样式脚本字体全部内嵌，源文件留在 .cs-src', async () => {
    const dir = path.join(out, 'pack'); fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(KIT, path.join(dir, '.cs-kit'), { recursive: true });
    const html = fs.readFileSync(src, 'utf8').replace(/(href|src)="(vendor\/|cs-deck)/g, '$1=".cs-kit/$2');
    fs.writeFileSync(path.join(dir, '超重与失重.html'), html);
    const r = packFile(path.join(dir, '超重与失重.html'));
    assert.equal(r.packed, true); assert.deepEqual(r.missing, []); assert.deepEqual(r.external, []);
    assert.ok(r.inlined.length >= 4, r.inlined.join());
    assert.ok(fs.existsSync(path.join(dir, '.cs-src', '超重与失重.html')));
    assert.match(fs.readFileSync(path.join(dir, '.cs-src', '超重与失重.html'), 'utf8'), /href="\.\.\/\.cs-kit\/cs-deck\.css"/);
    assert.ok(r.size < 900 * 1024, '体积 ' + r.size);
    // 改源文件再打包：输出到上一级
    const again = packFile(path.join(dir, '.cs-src', '超重与失重.html'));
    assert.equal(again.out, path.join(dir, '超重与失重.html'));
    // 单独拷到别的地方（模拟微信转发出去，旁边没有 .cs-kit）
    packed = path.join(out, 'alone', '超重与失重.html'); fs.mkdirSync(path.dirname(packed), { recursive: true });
    fs.copyFileSync(r.out, packed);
    console.log('     单文件大小', (r.size / 1024).toFixed(0), 'KB');
  });
  await test('单文件断网打开：没有任何网络请求，KaTeX 字体加载成功，公式和动画正常', async () => {
    const p = await open(packed, { offline: true });
    assert.deepEqual(p.requests, []);
    await p.js('CS.go(2); for (var k = 0; k < 6; k++) CS.next(); document.fonts.ready.then(() => 1)'); await sleep(300);
    assert.equal(await p.js('document.fonts.check("24px KaTeX_Main") && document.fonts.check("24px KaTeX_Math")'), true);
    const loaded = await p.js(`[...document.fonts].filter(f => /KaTeX/.test(f.family) && f.status === "loaded").map(f => f.family + " " + f.style + " " + f.weight)`);
    console.log("     已加载的 KaTeX 字体", loaded.join("；"));
    assert.ok(loaded.length >= 2, "字体没加载");
    const r = await p.js('CS.selfTest()');
    assert.deepEqual(r.errors, []); assert.deepEqual(r.texErrors, []);
    await p.js('CS.go(3); CS._sims[CS._sims.length - 1].play()'); await sleep(1500);
    assert.ok(await p.js('CS._sims[CS._sims.length - 1].state.t') > 0.5);
    await shot(p.win, 'packed-offline-sim.png');
    await p.js('CS.go(2); for (var k = 0; k < 6; k++) CS.next()'); await shot(p.win, 'packed-offline-formula.png');
    p.win.destroy();
  });
  await test('手机竖屏：自动改成上下滑动的长页，分步内容全部显示，不出横向滚动条', async () => {
    const p = await open(packed, { w: 390, h: 844, offline: true });
    assert.equal(await p.js('document.body.classList.contains("cs-scroll")'), true);
    assert.equal(await p.js('document.querySelectorAll(".cs-step.cs-hidden").length'), 0);
    assert.ok(await p.js('document.documentElement.scrollWidth <= window.innerWidth + 1'), '横向溢出 ' + await p.js('[...document.querySelectorAll(".cs-page *")].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map(e => e.tagName + "." + e.className).join()'));
    await shot(p.win, 'phone-1.png');
    for (const k of [2, 3, 6]) {
      await p.js(`CS.deck.pages[${k}].scrollIntoView()`); await sleep(300);
      assert.ok(await p.js(`(function(){ var c = CS.deck.pages[${k}].querySelector('canvas'); if (!c) return true; var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (var i = 3; i < d.length; i += 16) if (d[i]) return true; return false; })()`), `第 ${k + 1} 页画布是空的`);
      await shot(p.win, `phone-p${k + 1}.png`);
    }
    p.win.destroy();
  });
  await test('导播台成品自检（htmlProbe）：好课件没问题；坏课件报出脚本错、公式错、外链、溢出', async () => {
    const { probeHtml } = require('../electron/htmlProbe.cjs');
    const good = await probeHtml(packed, { electron: require('electron') });
    assert.deepEqual(good.problems, [], good.problems.join('\n'));
    assert.equal(good.usesKit, true); assert.match(good.note, /8 页.*按钮.*滑块.*2 道点选题/);
    const badFile = path.join(out, 'alone', '坏课件.html');
    fs.writeFileSync(badFile, fs.readFileSync(packed, 'utf8')
      .replace('<h2>先看一个现象</h2>', '<h2>先看一个现象</h2><div style="width:3000px;height:40px">很长很长的一行</div><img src="https://cdn.example.com/x.png"><p>$\\frac{1}{$</p>')
      .replace('CS.ready(function () {', 'CS.ready(function () { CS.button(document.querySelector(".cs-cover"), "坏按钮", function () { undefinedFn(); });'));
    const bad = await probeHtml(badFile, { electron: require('electron') });
    const all = bad.problems.join('\n');
    console.log('     坏课件的问题：\n       ' + bad.problems.join('\n       '));
    assert.match(all, /脚本报错.*undefinedFn/);
    assert.match(all, /公式错误/);
    assert.match(all, /网络资源.*cdn\.example\.com/);
    assert.match(all, /第 2 页内容超出页面/);
    // 没用设计包的普通网页也能查
    const plain = path.join(out, 'alone', '普通.html');
    fs.writeFileSync(plain, '<!doctype html><meta charset="utf-8"><body><p>$F=ma$ 没渲染</p><button onclick="nope()">点我</button></body>');
    const p = await probeHtml(plain, { electron: require('electron') });
    assert.match(p.problems.join('\n'), /公式没有渲染/); assert.match(p.problems.join('\n'), /nope/);
  });
  const bad = results.filter((r) => r[0] !== 'ok');
  console.log(`RESULT ${results.length - bad.length}/${results.length} pass`);
  app.exit(bad.length ? 1 : 0);
});
