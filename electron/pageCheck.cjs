'use strict';
// page_check 截图自检：在看不见的离屏窗口里打开 AI 做的 HTML / 本机预览页，截图给模型看，
// 同时收集控制台报错、未捕获异常、加载失败的资源、横向溢出和文字溢出；默认把按钮各点一遍、滑块各拖一遍、
// 输入框各填一个值，看会不会报错。每次用一个全新的内存分区，跑完就销毁；网页弹的 alert 不会出现在老师桌面上，
// 也不会真的跳转到别的网页。安全模式下页面不能联网（外网请求被拦，记进报告）。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const policy = require('./ai-browser-policy.cjs');
const { fail, clip } = require('./toolHost.cjs');

const LOAD_MS = 20000;
const MAX_H = 12000;
const MAX_AUTO = 20;
const SHOT_W = 1600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };
const inside = (root, f) => { const r = path.relative(path.resolve(root), path.resolve(f)); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
const short = (u) => { try { const x = new URL(u); return x.protocol === 'file:' ? path.basename(fileURLToPath(x)) : x.host + x.pathname; } catch { return clip(u, 80); } };

// 先于页面脚本运行：对话框只记下来，不弹出来
const PRELUDE = String.raw`(() => {
  const note = (k, m) => console.info('[page_check:' + k + '] ' + String(m == null ? '' : m).slice(0, 200));
  window.alert = (m) => note('alert', m);
  window.confirm = (m) => { note('confirm', m); return true; };
  window.prompt = (m, d) => { note('prompt', m); return d == null ? '' : d; };
  window.print = () => note('print', '');
})()`;

// 页面里可以点的、拖的、填的东西（不碰外链）
const CANDIDATES = String.raw`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.disabled; };
  const sel = (el) => { if (el.id) return '#' + CSS.escape(el.id); const parts = []; for (let n = el; n && n.nodeType === 1 && parts.length < 5; n = n.parentElement) { let s = n.tagName.toLowerCase(); if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((x) => x.tagName === n.tagName) : []; if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')'; parts.unshift(s); } return parts.join(' > '); };
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.name || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
  const out = { buttons: [], ranges: [], inputs: [], selects: [] };
  for (const el of document.querySelectorAll('button, [role=button], input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio], summary, [onclick]:not(a)')) {
    if (el.closest('a[href]') || !vis(el)) continue;
    out.buttons.push({ sel: sel(el), label: label(el) });
  }
  for (const el of document.querySelectorAll('input[type=range]')) if (vis(el)) out.ranges.push({ sel: sel(el), label: (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.title || el.name || el.id || '滑块').trim().slice(0, 30), min: Number(el.min || 0), max: Number(el.max || 100) });
  for (const el of document.querySelectorAll('input:not([type]), input[type=text], input[type=number], input[type=search], textarea')) if (vis(el) && !el.readOnly) out.inputs.push({ sel: sel(el), label: label(el), num: el.type === 'number' });
  for (const el of document.querySelectorAll('select')) if (vis(el) && el.options.length > 1) out.selects.push({ sel: sel(el), label: label(el) });
  return out;
})()`;

const LAYOUT = String.raw`(() => {
  const se = document.scrollingElement || document.documentElement, vw = innerWidth;
  const out = { overflowX: Math.max(se.scrollWidth, document.body ? document.body.scrollWidth : 0) > vw + 1, pageW: se.scrollWidth, pageH: Math.max(se.scrollHeight, document.body ? document.body.scrollHeight : 0), wide: [], clipped: [], texErrors: [], blank: !(document.body && document.body.innerText.trim()) && !document.querySelector('canvas,svg,img,video') };
  document.querySelectorAll('.katex-error').forEach((e) => { if (out.texErrors.length < 6) out.texErrors.push((e.getAttribute('title') || e.textContent || '').trim().slice(0, 160)); });
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && out.texErrors.length < 6; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || /SCRIPT|STYLE|TEXTAREA|CODE|PRE/.test(p.tagName) || p.closest('.katex')) continue;
      if (/\$[^$\n]*\\[a-zA-Z]{2,}[^$\n]*\$/.test(n.textContent)) out.texErrors.push('公式没有渲染：' + n.textContent.trim().slice(0, 60));
    }
  }
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (out.overflowX && r.right > vw + 2 && out.wide.length < 10 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 2)) out.wide.push(name(el) + '（右边超出 ' + Math.round(r.right - vw) + 'px）');
    const cs = getComputedStyle(el);
    if (out.clipped.length < 10 && /hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY + cs.textOverflow) && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) && el.innerText && el.innerText.trim() && el.children.length < 6) out.clipped.push(name(el) + '「' + el.innerText.trim().replace(/\s+/g, ' ').slice(0, 24) + '」');
  }
  return out;
})()`;

class PageCheck {
  /** @param {{electron: any, allowed?: (file: string) => boolean, log?: any}} o allowed：老师授权过的其他文件夹 */
  constructor(o) { this.electron = o.electron; this.allowed = o.allowed || (() => false); this.log = o.log; this.queue = Promise.resolve(); }

  session(session) {
    if (this.ses) return this.ses;
    const ses = session.fromPartition('cs-pagecheck');
    const cx = () => this.ctx || { tg: {}, offline: true, failed: [], notes: [] };
    ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (_e, item) => { cx().notes.push(`页面想下载「${item.getFilename()}」（已拦住）`); item.cancel(); });
    ses.webRequest.onBeforeRequest((d, cb) => {
      let u; try { u = new URL(d.url); } catch { return cb({ cancel: true }); }
      if (/^(file|data|blob|devtools|chrome-extension):$/.test(u.protocol)) return cb({ cancel: false });
      const c = cx();
      if (/^(https?|wss?):$/.test(u.protocol)) {
        const local = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(u.hostname);
        const block = local ? !c.tg.local || u.host !== c.tg.local : c.offline || !policy.checkUrl(d.url.replace(/^ws/, 'http')).ok;
        if (block) { c.failed.push(`${short(d.url)}（${local ? '本机其他地址' : c.offline ? '安全模式不能联网' : '局域网地址'}，已拦住）`); return cb({ cancel: true }); }
        return cb({ cancel: false });
      }
      cb({ cancel: true });
    });
    ses.webRequest.onCompleted((d) => { if (d.statusCode >= 400) cx().failed.push(`${short(d.url)}（HTTP ${d.statusCode}）`); });
    ses.webRequest.onErrorOccurred((d) => { if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(d.error)) cx().failed.push(`${short(d.url)}（${d.error.replace('net::', '').replace('ERR_FILE_NOT_FOUND', '找不到文件')}）`); });
    this.ses = ses;
    return ses;
  }

  call(s, a) {
    const job = this.queue.then(() => this.run(s, a));
    this.queue = job.catch(() => {});
    return job;
  }

  target(s, a) {
    if (a.file) {
      const f = path.resolve(s.work, String(a.file));
      if (!inside(s.work, f) && !this.allowed(f)) return { error: `只能检查任务文件夹里的文件（${s.work}）` };
      if (!fs.existsSync(f)) return { error: `找不到文件：${a.file}` };
      if (!/\.(html?|svg|xhtml)$/i.test(f)) return { error: 'file 要写 .html 文件' };
      return { url: pathToFileURL(f).href, file: f };
    }
    if (a.url) {
      const u = String(a.url);
      if (/^file:/i.test(u)) { let f; try { f = fileURLToPath(u); } catch { return { error: 'file: 地址不对' }; } return this.target(s, { file: f }); }
      let x; try { x = new URL(u); } catch { return { error: 'url 格式不对' }; }
      if (!/^https?:$/.test(x.protocol) || !/^(127\.0\.0\.1|localhost|\[::1\])$/i.test(x.hostname)) return { error: 'url 只能是 http://127.0.0.1 或 http://localhost 的本机预览地址；公网网页用 browser_screenshot' };
      return { url: x.href, local: x.host };
    }
    return { error: '写 file（任务文件夹里的 .html）或 url（本机预览地址）' };
  }

  async run(s, a) {
    const tg = this.target(s, a);
    if (tg.error) return fail(tg.error);
    const width = Math.round(Math.min(3840, Math.max(200, Number(a.width) || 1280)));
    const height = Math.round(Math.min(2160, Math.max(200, Number(a.height) || 800)));
    const steps = Array.isArray(a.steps) ? a.steps.slice(0, 30) : [];
    const auto = a.auto != null ? Boolean(a.auto) : !steps.length;
    const waitMs = Math.min(10000, Math.max(0, Number(a.wait_ms ?? 800)));
    const offline = s.perm === 'safe';
    const { BrowserWindow, session } = this.electron;
    const errors = [], warnings = [], failed = [], notes = [], navs = [];
    // 一次只检查一个页面（call 排队），分区只建一个，拦截规则看当前这次检查
    this.ctx = { tg, offline, failed, notes };
    const ses = this.session(session);
    await ses.clearStorageData().catch(() => {});
    await ses.clearCache().catch(() => {});
    const w = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, paintWhenInitiallyHidden: true, webPreferences: { offscreen: true, session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
    const wc = w.webContents;
    wc.setAudioMuted(true);
    wc.setFrameRate(30);
    wc.setWindowOpenHandler(({ url }) => { navs.push(`打开新窗口 ${short(url)}`); return { action: 'deny' }; });
    wc.on('will-navigate', (e) => { e.preventDefault(); navs.push(`跳转到 ${short(e.url)}`); });
    wc.on('will-attach-webview', (e) => e.preventDefault());
    const dbg = wc.debugger;
    const where = (u, l, c) => (u ? `（${short(u)}:${(l ?? 0) + 1}${c != null ? ':' + (c + 1) : ''}）` : '');
    const images = [];
    const shot = async (label) => {
      wc.invalidate();
      await sleep(150);
      let img = await within(wc.capturePage(), 10000, '截图超时');
      if (img.isEmpty()) { await sleep(400); img = await within(wc.capturePage(), 10000, '截图超时'); }
      const sz = img.getSize();
      if (sz.width > SHOT_W) img = img.resize({ width: SHOT_W, quality: 'good' });
      images.push({ label, data: img.toPNG().toString('base64'), mimeType: 'image/png', size: img.getSize() });
    };
    try {
      // 窗口还没有页面时调试命令会一直等：先开一个空白页，再连调试通道、再打开要检查的页面
      await within(wc.loadURL('about:blank'), 10000, '离屏窗口没有启动').catch(() => {});
      dbg.attach('1.3');
      dbg.on('message', (_e, method, p) => {
        if (method === 'Runtime.exceptionThrown') {
          const d = p.exceptionDetails || {}, desc = d.exception?.description || d.exception?.value || d.text || '';
          const top = d.stackTrace?.callFrames?.[0];
          errors.push(`${/in promise/i.test(d.text || '') ? '未处理的 Promise 拒绝' : '未捕获异常'}：${clip(String(desc).split('\n')[0], 240)}${where(d.url || top?.url, d.lineNumber ?? top?.lineNumber, d.columnNumber ?? top?.columnNumber)}`);
        } else if (method === 'Runtime.consoleAPICalled') {
          const msg = (p.args || []).map((x) => x.value ?? x.description ?? x.type).join(' ');
          const top = p.stackTrace?.callFrames?.[0];
          // Electron 自己的安全提示不是页面的问题
          if (/Electron Security Warning/.test(msg) || /electron\/js2c/.test(top?.url || '')) return;
          if (/^\[page_check:(alert|confirm|prompt|print)\]/.test(msg)) notes.push(`页面弹出了${{ alert: '提示框', confirm: '确认框', prompt: '输入框', print: '打印' }[msg.match(/page_check:(\w+)/)[1]]}：${clip(msg.replace(/^\[page_check:\w+\]\s*/, ''), 100)}`);
          else if (p.type === 'error' || p.type === 'assert') errors.push(`console.error：${clip(msg, 240)}${where(top?.url, top?.lineNumber, top?.columnNumber)}`);
          else if (p.type === 'warning') warnings.push(`${clip(msg, 200)}${where(top?.url, top?.lineNumber)}`);
        } else if (method === 'Log.entryAdded') {
          const e = p.entry || {};
          if (e.level === 'error' && e.source !== 'network') errors.push(`${e.source === 'security' ? '安全策略' : '浏览器'}报错：${clip(e.text, 240)}${where(e.url, e.lineNumber)}`);
        } else if (method === 'Page.javascriptDialogOpening') void dbg.sendCommand('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      });
      for (const m of ['Runtime.enable', 'Log.enable', 'Page.enable']) await within(dbg.sendCommand(m), 10000, '调试通道没有响应');
      await within(dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE }), 10000, '调试通道没有响应');
      const cdp = (m, p) => within(dbg.sendCommand(m, p || {}), 10000, '页面没有响应');
      const evaluate = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value; };

      let loadErr = null;
      await within(wc.loadURL(tg.url), LOAD_MS, `页面 ${LOAD_MS / 1000} 秒都没有加载完（可能卡在死循环或在等外网资源）`).catch((e) => { loadErr = e; });
      if (loadErr && !/ERR_ABORTED/.test(loadErr.message)) {
        if (/秒都没有加载完/.test(loadErr.message)) notes.push(loadErr.message); else return fail(`页面打不开：${loadErr.message.replace(/^.*?(ERR_\w+).*$/, '$1')}`);
      }
      await evaluate("Promise.race([Promise.all([document.fonts ? document.fonts.ready : 0, ...Array.from(document.images).map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))]), new Promise((r) => setTimeout(r, 5000))]).then(() => 1)").catch(() => {});
      await sleep(waitMs);
      const title = await evaluate('document.title').catch(() => '');
      const layout = (await evaluate(LAYOUT).catch(() => null)) || {};
      if (a.full_page && layout.pageH > height) {
        const h = Math.min(MAX_H, layout.pageH);
        w.setContentSize(width, h); await sleep(500);
        await shot(`整页（${width}×${h}${layout.pageH > MAX_H ? `，页面共 ${layout.pageH} 像素，只截了前 ${MAX_H}` : ''}）`);
        w.setContentSize(width, height); await sleep(300);
      } else await shot(`打开后（${width}×${height}）`);

      const center = async (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
      const mouse = (type, x, y, buttons = 0) => cdp('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      const click = async (sel) => { const c = await center(sel); if (!c) return '找不到这个元素'; await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); return ''; };
      const drag = async (sel, dx, dy) => { const c = await center(sel); if (!c) return '找不到这个元素'; await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', c.x + (dx * i) / 8, c.y + (dy * i) / 8, 1); await sleep(16); } await mouse('mouseReleased', c.x + dx, c.y + dy); return ''; };
      const done = [];
      const act = async (label, fn) => {
        const before = errors.length;
        let r = '';
        try { r = (await fn()) || ''; } catch (e) { r = e.message; }
        await sleep(180);
        const added = errors.length - before;
        done.push(`${r ? '✗' : added ? '⚠' : '✓'} ${label}${r ? `：${r}` : ''}${added ? `（之后出现 ${added} 个报错，见上面）` : ''}`);
        if (added) for (let i = before; i < errors.length; i++) errors[i] += `　← ${label}后`;
      };
      let acted = false;
      for (const st of steps) {
        if (!st || typeof st !== 'object') continue;
        acted = true;
        if (st.click) await act(`点 ${clip(st.click, 60)}`, () => click(String(st.click)));
        else if (st.drag) await act(`拖 ${clip(st.drag, 60)}（${Number(st.dx) || 0}, ${Number(st.dy) || 0}）`, () => drag(String(st.drag), Number(st.dx) || 0, Number(st.dy) || 0));
        else if (st.type) await act(`在 ${clip(st.type, 60)} 输入「${clip(st.text, 30)}」`, async () => { const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(String(st.type))}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if ('value' in el) el.value = ''; return true; })()`); if (!ok) return '找不到这个元素'; await cdp('Input.insertText', { text: String(st.text ?? '') }); return ''; });
        else if (st.press) await act(`按 ${clip(st.press, 20)}`, async () => { const k = policy.parseKey(st.press); if (!k) return '不认识这个键'; const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: k.modifiers || 0 }; await cdp('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text } : {}) }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); return ''; });
        else if (st.wait != null) { await sleep(Math.min(5000, Math.max(0, Number(st.wait) || 0))); done.push(`· 等了 ${Math.min(5000, Number(st.wait) || 0)} 毫秒`); }
        else if (st.shot && images.length < 3) { await shot(`第 ${done.length} 步之后`); done.push('· 截了一张图'); }
        else done.push(`✗ 看不懂这一步：${clip(JSON.stringify(st), 80)}`);
      }
      let found = null, kitReport = null;
      if (auto) {
        const hasKit = await evaluate('!!(window.CS && typeof CS.selfTest === "function")').catch(() => false);
        if (hasKit) {
          acted = true;
          kitReport = await evaluate('CS.selfTest()').catch((e) => ({ errors: [e.message] }));
          if (kitReport) {
            done.push(`✓ 课件设计包逐页自检（${kitReport.pages || 1} 页，点了 ${kitReport.controls?.buttons || 0} 个按钮、拖了 ${kitReport.controls?.sliders || 0} 个滑块、${kitReport.controls?.quizzes || 0} 道点选题）`);
            for (const e of kitReport.errors || []) errors.push(`课件自检报错：${clip(e, 240)}`);
            for (const o of (kitReport.overflow || []).slice(0, 6)) {
              if (width >= height && o.page) notes.push(`课件溢出：第 ${o.page} 页超出页面（「${clip(o.what, 80)}」）`);
            }
          }
        } else {
          found = (await evaluate(CANDIDATES).catch(() => null)) || { buttons: [], ranges: [], inputs: [], selects: [] };
          for (const r of found.ranges.slice(0, MAX_AUTO)) { acted = true; await act(`拖滑块「${r.label}」到最小、中间、最大`, async () => { for (const v of [r.min, (r.min + r.max) / 2, r.max]) { await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(r.sel)}); if (!el) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(String(v))}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(120); } return ''; }); }
          for (const x of found.inputs.slice(0, MAX_AUTO)) { acted = true; await act(`在输入框「${x.label}」填 ${x.num ? '3' : 'test'}`, async () => { await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(x.sel)}); if (!el) return; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(x.num ? '3' : 'test')}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`); return ''; }); }
          for (const x of found.selects.slice(0, MAX_AUTO)) { acted = true; await act(`下拉框「${x.label}」换一个选项`, async () => { await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(x.sel)}); if (!el) return; el.selectedIndex = el.options.length - 1; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`); return ''; }); }
          for (const x of found.buttons.slice(0, MAX_AUTO)) { acted = true; await act(`点「${x.label}」`, () => click(x.sel)); }
        }
      }
      if (acted) { await sleep(400); await evaluate('window.scrollTo(0, 0)').catch(() => {}); await shot('操作之后'); }
      const after = acted ? (await evaluate(LAYOUT).catch(() => null)) || layout : layout;
      const texErrors = [...new Set([...(layout.texErrors || []), ...(after.texErrors || []), ...(kitReport?.texErrors || [])])];
      const deckOverflow = width >= height ? (kitReport?.overflow || []).filter((o) => o.page) : [];

      const problems = errors.length + failed.length + texErrors.length + deckOverflow.length + (after.overflowX ? 1 : 0) + (after.clipped?.length ? 1 : 0) + (after.blank ? 1 : 0);
      const lines = [`page_check：${tg.file ? path.relative(s.work, tg.file) || path.basename(tg.file) : tg.url}${title ? `（标题「${clip(title, 60)}」）` : ''}，窗口 ${width}×${height}${offline ? '，安全模式：页面不能联网' : ''}`, ''];
      lines.push(`控制台报错（${errors.length}）：`, ...(errors.length ? errors.slice(0, 30).map((x) => '- ' + x) : ['- 没有']));
      lines.push(`加载失败的资源（${failed.length}）：`, ...(failed.length ? [...new Set(failed)].slice(0, 20).map((x) => '- ' + x) : ['- 没有']));
      if (texErrors.length) lines.push(`公式错误（${texErrors.length}）：`, ...texErrors.slice(0, 10).map((x) => '- ' + x));
      if (deckOverflow.length) lines.push(`课件页面溢出（${deckOverflow.length}）：`, ...deckOverflow.slice(0, 6).map((o) => `- 第 ${o.page} 页超出页面（「${clip(o.what, 80)}」）`));
      if (warnings.length) lines.push(`控制台警告（${warnings.length}，仅供参考）：`, ...warnings.slice(0, 8).map((x) => '- ' + x));
      if (after.blank) lines.push('页面是空白的：没有文字也没有画布、图片（脚本可能没跑起来）。');
      lines.push(after.overflowX ? `横向溢出：页面宽 ${after.pageW}px，比窗口宽 ${width}px 还宽，会出现左右滚动条${after.wide?.length ? `；超出的元素：${after.wide.join('、')}` : ''}` : '横向溢出：没有');
      lines.push(after.clipped?.length ? `文字溢出（被截断，最多列 10 个）：${after.clipped.join('、')}` : '文字溢出：没有发现');
      if (steps.length || auto) lines.push('', `操作（${done.length}）：`, ...(done.length ? done.map((x) => '- ' + x) : [auto ? '- 页面里没有找到按钮、滑块或输入框' : '- 没有']));
      if (found && (found.buttons.length > MAX_AUTO || found.ranges.length > MAX_AUTO)) lines.push(`（按钮 ${found.buttons.length} 个、滑块 ${found.ranges.length} 个，只自动试了前 ${MAX_AUTO} 个；其余的用 steps 指定）`);
      if (navs.length) lines.push(`页面想跳走（已拦住，没有真的跳）：${[...new Set(navs)].slice(0, 6).join('、')}`);
      if (notes.length) lines.push(...[...new Set(notes)].slice(0, 8).map((x) => '· ' + x));
      lines.push('', `截图：${images.map((x, i) => `第 ${i + 1} 张 ${x.label}`).join('；')}`);
      lines.push(problems ? `结论：发现 ${problems} 个问题，改完再用 page_check 查一次。` : '结论：没有发现问题。再对照截图看看版面、文字、公式是不是你想要的样子。');
      return { text: lines.join('\n'), isError: false, images: images.slice(0, 4).map(({ data, mimeType }) => ({ data, mimeType })), report: { errors, failed, texErrors, deckOverflow, layout: after, problems } };
    } catch (e) {
      return fail(`page_check 没做完：${e.message}`);
    } finally {
      try { dbg.detach(); } catch { /* 已断开 */ }
      try { w.destroy(); } catch { /* 已关 */ }
      void ses.clearStorageData().catch(() => {});
    }
  }
}

module.exports = { PageCheck };
