'use strict';
// web_search / web_fetch：在看不见的浏览器窗口（独立分区 persist:cs-web，跟随系统代理，和 Chrome 打开的一样）里
// 打开必应搜索页或目标网页，把结果读出来；搜索结果页和网页原文都存进任务文件夹的「资料/来源/」，
// 「资料/来源/索引.md」记下每一条的出处网址，方便老师核对。
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./ai-browser-policy.cjs');
const page = require('./ai-browser-page.cjs');
const text = require('./ai-browser-text.cjs');
const { fail, clip, urlRefusal } = require('./toolHost.cjs');

const PARTITION = 'persist:cs-web';
const WORLD = 1177;
const LOAD_MS = 25000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const slug = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '网页';

// 必应结果页：标题、网址、摘要。必应的跳转链接（/ck/a?…&u=a1<base64>）解开成真实网址
const BING = String.raw`(() => {
  const out = [];
  for (const li of document.querySelectorAll('#b_results > li.b_algo')) {
    const a = li.querySelector('h2 a'); if (!a) continue;
    const cap = li.querySelector('.b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_lineclamp4, .b_snippet, p');
    out.push({ title: (a.innerText || '').trim(), url: a.href, snippet: (cap ? cap.innerText : '').trim().replace(/\s+/g, ' ').slice(0, 320), site: ((li.querySelector('cite') || {}).innerText || '').trim().slice(0, 120) });
  }
  const t = document.title + ' ' + (document.body ? document.body.innerText.slice(0, 400) : '');
  return { items: out, title: document.title, url: location.href, blocked: /人机|验证|captcha|unusual traffic/i.test(t) && !out.length };
})()`;
const BAIDU = String.raw`(() => {
  const out = [];
  for (const r of document.querySelectorAll('#content_left > .result, #content_left > .c-container')) {
    const a = r.querySelector('h3 a'); if (!a) continue;
    const cap = r.querySelector('.c-abstract, [class*="content-right"], .c-span-last, [class*="summary"]');
    out.push({ title: (a.innerText || '').trim(), url: a.href, snippet: (cap ? cap.innerText : r.innerText).trim().replace(/\s+/g, ' ').slice(0, 320), site: ((r.querySelector('.c-showurl, [class*="source"]') || {}).innerText || '').trim().slice(0, 120) });
  }
  return { items: out, title: document.title, url: location.href, blocked: /安全验证|百度安全/.test(document.title) && !out.length };
})()`;

function unBing(u) {
  try {
    const x = new URL(u);
    if (!/bing\.com$/i.test(x.hostname) || !x.pathname.startsWith('/ck/')) return u;
    const v = x.searchParams.get('u') || '';
    if (!v.startsWith('a1')) return u;
    const real = Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^https?:\/\//i.test(real) ? real : u;
  } catch { return u; }
}

class WebTools {
  /** @param {{electron: any, host: import('./toolHost.cjs').ToolHost, log?: any, allowLocalhost?: boolean}} o */
  constructor(o) {
    this.electron = o.electron;
    this.host = o.host;
    this.log = o.log;
    this.allowLocalhost = !!o.allowLocalhost;
    this.cache = new Map();
    this.queue = Promise.resolve();
  }

  urlPolicy() {
    return { allowLocalhost: this.allowLocalhost };
  }

  session() {
    if (this.ses) return this.ses;
    const ses = this.electron.session.fromPartition(PARTITION);
    ses.setUserAgent(ses.getUserAgent().replace(/\s(?!(Mozilla|AppleWebKit|Chrome|Safari)\/)[^\s()]+\/[^\s()]+/g, ''));
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    // 只拦本机和局域网地址（离线联调显式开启 allowLocalhost 时除外）；页面里的图片、脚本照常加载（读正文要用）
    ses.webRequest.onBeforeRequest((d, cb) => {
      let ok = true;
      try { const u = new URL(d.url); if (/^https?:$/.test(u.protocol)) ok = policy.checkUrl(d.url, this.urlPolicy()).ok; else ok = /^(data|blob):$/.test(u.protocol); } catch { ok = false; }
      cb({ cancel: !ok });
    });
    ses.on('will-download', (e, item) => { item.cancel(); });
    this.ses = ses;
    return ses;
  }

  /** 一次只开一个隐藏窗口，读完就关 */
  withPage(url, fn) {
    const job = this.queue.then(() => this.open(url, fn));
    this.queue = job.catch(() => {});
    return job;
  }

  async open(url, fn) {
    const { BrowserWindow } = this.electron;
    const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: this.session(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: true, spellcheck: false, safeDialogs: true } });
    const wc = w.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('login', (e, _d, _a, cb) => { e.preventDefault(); cb(); });
    // 网页弹的 alert/confirm 不能出现在老师桌面上
    wc.on('dom-ready', () => { wc.executeJavaScript('window.alert=()=>{};window.confirm=()=>false;window.prompt=()=>null;0').catch(() => {}); });
    try {
      let ready = false;
      wc.once('dom-ready', () => { ready = true; });
      const load = wc.loadURL(url).catch((e) => (/ERR_ABORTED/.test(e.message) ? null : Promise.reject(new Error(`打不开这个网页：${e.message.replace(/^.*?(ERR_\w+).*$/, '$1')}`))));
      let failed = null; load.catch((e) => { failed = e; });
      const end = Date.now() + LOAD_MS;
      while (Date.now() < end && !ready && !failed) await sleep(100);
      if (failed) throw failed;
      if (!ready) throw new Error('网页 25 秒都没有打开（网络慢或需要代理）');
      await Promise.race([load, sleep(4000)]);
      await sleep(900);
      return await fn(wc);
    } finally {
      try { w.destroy(); } catch { /* 已关 */ }
    }
  }

  run(wc, code) { return within(wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]), 15000, '网页没有响应'); }

  async call(s, name, a) {
    if (name === 'web_search') return this.search(s, a);
    if (name === 'web_fetch') return this.fetch(s, a);
    return fail(`没有这个工具：${name}`);
  }

  index(s, title, url, file) { this.host.recordSource(s, title, url, file); }

  async search(s, a) {
    const q = String(a.query || '').trim();
    if (!q) return fail('query 写要搜什么');
    const count = Math.max(1, Math.min(10, Math.trunc(Number(a.count)) || 6));
    const site = String(a.site || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const full = site ? `${q} site:${site}` : q;
    const engines = [
      { name: '必应', url: `https://www.bing.com/search?q=${encodeURIComponent(full)}&setlang=zh-CN&ensearch=0`, code: BING },
      { name: '百度', url: `https://www.baidu.com/s?wd=${encodeURIComponent(full)}`, code: BAIDU },
    ];
    let got = null, html = '', used = null, errors = [];
    for (const e of engines) {
      try {
        const r = await this.withPage(e.url, async (wc) => {
          let res = await this.run(wc, e.code);
          if (!res.items.length && !res.blocked) { await sleep(1500); res = await this.run(wc, e.code); }
          const raw = await this.run(wc, 'document.documentElement.outerHTML');
          return { res, raw };
        });
        if (r.res.items.length) { got = r.res; html = r.raw; used = e; break; }
        errors.push(`${e.name}${r.res.blocked ? '要求人机验证' : '没有结果'}`);
      } catch (err) { errors.push(`${e.name}：${err.message}`); }
    }
    if (!got) return fail(`没有搜到（${errors.join('；')}）。换个说法再搜，或用 browser_open 打开搜索页自己看。`);
    const items = got.items.map((x) => ({ ...x, url: unBing(x.url) })).filter((x) => /^https?:/i.test(x.url)).slice(0, count);
    const dir = this.host.sourcesDir(s), base = `${stamp()}-搜索-${slug(q)}`;
    const md = [`# 搜索：${q}${site ? `（只搜 ${site}）` : ''}`, '', `搜索引擎：${used.name}　时间：${new Date().toLocaleString('zh-CN')}　结果页：${got.url}`, '', ...items.map((x, i) => `${i + 1}. [${x.title}](${x.url})\n   ${x.snippet}`)].join('\n');
    fs.writeFileSync(path.join(dir, base + '.md'), md);
    fs.writeFileSync(path.join(dir, base + '.html'), html);
    this.index(s, `搜索：${q}`, got.url, `资料/来源/${base}.md`);
    const body = items.map((x, i) => `${i + 1}. ${x.title}\n   网址：${x.url}${x.site ? `\n   来源：${x.site}` : ''}\n   摘要：${x.snippet}`).join('\n\n');
    return { text: `${policy.wrapUntrusted(`搜索「${q}」（${used.name}）的前 ${items.length} 条结果：\n\n${body}`)}\n\n搜索结果页已存为 资料/来源/${base}.md（和 .html 原文）。要看全文用 web_fetch 网址；引用时写出处网址。` };
  }

  async fetch(s, a) {
    const c = policy.checkUrl(a.url, this.urlPolicy());
    if (!c.ok) return fail(urlRefusal(c), c.reason);
    if (!/^https?:/i.test(c.url)) return fail('只能抓 http / https 网页');
    const key = s.key + '\n' + c.url;
    let hit = this.cache.get(key);
    if (!hit || Date.now() - hit.at > 10 * 60 * 1000) {
      const dir = this.host.sourcesDir(s);
      const ses = this.session();
      let head = null;
      try { head = await within(ses.fetch(c.url, { method: 'GET', redirect: 'follow' }), 20000, '网页 20 秒没有响应'); } catch (e) { head = { error: e }; }
      const type = head?.headers?.get?.('content-type') || '';
      if (head && !head.error && head.ok && type && !/html|text\/plain|xml/i.test(type)) {
        // PDF、Word、图片等：原样存下来，让 AI 用命令去读
        const ext = /pdf/i.test(type) ? '.pdf' : /word|officedocument\.wordprocessing/i.test(type) ? '.docx' : /presentation/i.test(type) ? '.pptx' : /image\/(png|jpe?g|gif|webp)/i.test(type) ? '.' + type.split('/')[1].replace('jpeg', 'jpg').split(';')[0] : path.extname(new URL(c.url).pathname) || '.bin';
        const buf = Buffer.from(await head.arrayBuffer());
        if (buf.length > 50 * 1024 * 1024) return fail('文件超过 50 MB，没有保存');
        const name = `${stamp()}-${slug(decodeURIComponent(path.basename(new URL(c.url).pathname, path.extname(new URL(c.url).pathname))) || '文件')}${ext}`;
        fs.writeFileSync(path.join(dir, name), buf);
        this.index(s, name, c.url, `资料/来源/${name}`);
        return { text: `这个网址是文件（${type.split(';')[0]}，${(buf.length / 1024).toFixed(0)} KB），已原样保存为 资料/来源/${name}。${ext === '.pdf' ? '用命令把 PDF 的文字提取出来再读（例如 Python 的 pypdf）。' : ''}出处：${c.url}` };
      }
      if (head && !head.error && head.status >= 400) this.log?.info('web_fetch 状态码', head.status, c.url);
      try { await head?.body?.cancel?.(); } catch { /* 不要了 */ }
      const r = await this.withPage(c.url, async (wc) => {
        const res = await this.run(wc, page.read({ full: false }));
        const raw = await this.run(wc, 'document.documentElement.outerHTML');
        return { res, raw, url: wc.getURL(), title: wc.getTitle() };
      });
      const md = text.blocksToMarkdown(r.res.blocks || []);
      const base = `${stamp()}-${slug(r.title || new URL(c.url).hostname)}`;
      fs.writeFileSync(path.join(dir, base + '.html'), r.raw);
      fs.writeFileSync(path.join(dir, base + '.md'), `# ${r.title}\n\n出处：${r.url}\n抓取时间：${new Date().toLocaleString('zh-CN')}\n\n${md}\n`);
      this.index(s, r.title, r.url, `资料/来源/${base}.html`);
      hit = { at: Date.now(), md, title: r.title, url: r.url, base };
      this.cache.set(key, hit);
      if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
    }
    const pg = text.paginate(hit.md, a.start, Math.max(500, Math.min(40000, Number(a.max_chars) || 8000)));
    const head = `网页标题：${clip(hit.title, 200)}\n出处：${hit.url}\n第 ${pg.start}-${pg.end} 字，共 ${pg.total} 字`;
    const more = pg.next != null ? `\n\n还没读完，继续读用 web_fetch url=${hit.url} start=${pg.next}。` : '\n\n已读完。';
    return { text: `${policy.wrapUntrusted(`${head}\n\n${pg.text || '（没有读到文字：可能要登录、是图片或要点开才显示，可以用 browser_open 打开看）'}`)}${more}\n原文已存为 资料/来源/${hit.base}.html，正文存为 资料/来源/${hit.base}.md。` };
  }

  /** 供来源核对兜底调用：用隐藏浏览器打开动态渲染页面，取出渲染后的正文与 HTML（同时归档进任务的 资料/来源） */
  async fetchForSourceCheck(url, work) {
    const c = policy.checkUrl(url, this.urlPolicy());
    if (!c.ok || !/^https?:/i.test(c.url)) return { ok: false, why: c.ok ? '只能核对 http/https 网址' : urlRefusal(c) };
    try {
      const r = await this.withPage(c.url, async (wc) => {
        const res = await this.run(wc, page.read({ full: true }));
        const raw = await this.run(wc, 'document.documentElement.outerHTML');
        return { res, raw, url: wc.getURL(), title: wc.getTitle() };
      });
      if (/login|passport|signin|\/user\/auth/i.test(r.url) && r.url !== c.url) return { ok: true, text: '', why: '网址要求登录' };
      const md = text.blocksToMarkdown(r.res.blocks || []);
      if (work && this.host) {
        try {
          const fakeSession = { work };
          const dir = this.host.sourcesDir(fakeSession);
          const base = `${stamp()}-核对-${slug(r.title || new URL(c.url).hostname)}`;
          fs.writeFileSync(path.join(dir, base + '.html'), r.raw);
          fs.writeFileSync(path.join(dir, base + '.md'), `# ${r.title}\n\n出处：${r.url}\n抓取时间：${new Date().toLocaleString('zh-CN')}\n\n${md}\n`);
          this.host.recordSource(fakeSession, r.title, c.url, `资料/来源/${base}.html`);
        } catch { /* 存档失败不影响核对 */ }
      }
      return { ok: true, text: (md ? md + '\n' : '') + r.raw };
    } catch (e) {
      return { ok: false, why: e.message || String(e) };
    }
  }
}

module.exports = { WebTools, unBing, PARTITION };
