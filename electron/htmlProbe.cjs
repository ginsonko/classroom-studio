'use strict';
// 成品 HTML 自检：在离屏窗口里打开（断网：只许读本地文件），横屏 1280×720 和手机竖屏 390×844 各跑一遍。
// 用了课件设计包的页面跑 CS.selfTest()（逐页显示、点遍按钮、拖遍滑块、点选题）；没用的页面按通用办法点按钮、拖滑块、
// 找没渲染的公式和超出窗口的内容。返回问题清单（中文，直接发给 AI 修）。
const path = require('node:path');

const GENERIC = `(() => {
  const out = { errors: [], texErrors: [], overflow: [], external: [], controls: { buttons: 0, sliders: 0, quizzes: 0 }, pages: 1 };
  document.querySelectorAll('.katex-error').forEach((e) => out.texErrors.push((e.getAttribute('title') || e.textContent).slice(0, 160)));
  // 没渲染的公式：正文里还留着 $…\\frac…$ 这种写法
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let raw = 0;
  for (let n = walker.nextNode(); n && raw < 3; n = walker.nextNode()) {
    const p = n.parentElement; if (!p || /SCRIPT|STYLE|TEXTAREA|CODE|PRE/.test(p.tagName)) continue;
    if (/\\$[^$\\n]*[a-zA-Z\\\\][^$\\n]*\\$/.test(n.textContent)) { out.texErrors.push('公式没有渲染：' + n.textContent.trim().slice(0, 60)); raw++; }
  }
  document.querySelectorAll('button').forEach((b) => { if (b.disabled || out.controls.buttons >= 40) return; out.controls.buttons++; try { b.click(); } catch (e) { out.errors.push('按钮「' + b.textContent.trim().slice(0, 12) + '」：' + e.message); } });
  document.querySelectorAll('input[type=range]').forEach((s) => { out.controls.sliders++; const v = s.value; [s.min, s.max, v].forEach((x) => { s.value = x; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }); });
  if (document.documentElement.scrollWidth > innerWidth + 2) out.overflow.push({ page: 0, what: '页面比窗口宽' });
  return out;
})()`;

/** 打开一个 HTML 文件跑自检；electron = require('electron')（测试里可以注入） */
async function probeHtml(file, { electron, sizes = [[1280, 720], [390, 844]], timeout = 20000 } = {}) {
  const { BrowserWindow, session } = electron;
  const problems = [], notes = [];
  let usesKit = false;
  for (const [w, h] of sizes) {
    const part = 'cs-probe-' + Math.random().toString(36).slice(2);
    const ses = session.fromPartition(part);
    const blocked = new Set();
    ses.webRequest.onBeforeRequest((d, cb) => { if (/^(file|data|blob|devtools):/i.test(d.url)) return cb({}); blocked.add(d.url.slice(0, 120)); cb({ cancel: true }); });
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { partition: part, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const consoleErr = [];
    win.webContents.on('console-message', (...a) => { const e = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2], lineNumber: a[3] }; if (e.level === 'error' || e.level === 3) consoleErr.push(String(e.message).slice(0, 200)); });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    const label = w < h ? '手机竖屏' : '横屏';
    try {
      const load = win.loadFile(file).catch((e) => { throw new Error('打不开：' + e.message); });
      await Promise.race([load, new Promise((_, rej) => setTimeout(() => rej(new Error('打开超过 20 秒')), timeout))]);
      const js = (s) => win.webContents.executeJavaScript(s, true);
      for (let i = 0; i < 60; i++) { if (await js('!!(document.body && (document.body.dataset.csReady === "1" || !window.CS))')) break; await new Promise((r) => setTimeout(r, 100)); }
      await js('document.fonts ? document.fonts.ready.then(() => 1) : 1');
      await new Promise((r) => setTimeout(r, 600));
      usesKit = await js('!!(window.CS && CS.selfTest)');
      const r = await Promise.race([js(usesKit ? 'CS.selfTest()' : GENERIC), new Promise((_, rej) => setTimeout(() => rej(new Error('自检脚本超过 15 秒没结束（可能有死循环）')), 15000))]);
      await new Promise((r2) => setTimeout(r2, 300));
      // 同一个错误课件自己记一次、控制台又报一次：去掉行号后去重
      const seen = new Set(), errs = [...(r.errors || []), ...consoleErr].filter((e) => { const k = String(e).replace(/（第 \d+ 行）$/, '').replace(/^Uncaught /, ''); if (seen.has(k)) return false; seen.add(k); return true; });
      for (const e of errs.slice(0, 6)) problems.push(`${label}：脚本报错 ${e}`);
      for (const e of [...new Set(r.texErrors || [])].slice(0, 5)) problems.push(`${label}：公式错误 ${e}`);
      if (w >= h) for (const o of (r.overflow || []).slice(0, 6)) problems.push(`第 ${o.page} 页内容超出页面（「${o.what}」），字太多或元素太大，拆页或缩小`);
      else for (const o of (r.overflow || []).filter((x) => !x.page).slice(0, 2)) problems.push(`${label}：${o.what}`);
      const ext = [...new Set([...(r.external || []), ...blocked])];
      if (ext.length && w >= h) problems.push('引用了网络资源，离线打不开：' + ext.slice(0, 4).join('、') + '（改用 .cs-kit 里的本地文件，或把图片存进文件夹）');
      if (w >= h) notes.push(`${r.pages || 1} 页，点了 ${r.controls?.buttons || 0} 个按钮、拖了 ${r.controls?.sliders || 0} 个滑块、${r.controls?.quizzes || 0} 道点选题`);
    } catch (e) {
      problems.push(`${label}：${e.message}`);
    } finally { win.destroy(); }
  }
  return { file: path.basename(file), usesKit, problems: [...new Set(problems)], note: notes.join('；') };
}

module.exports = { probeHtml };
