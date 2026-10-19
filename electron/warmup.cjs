'use strict';
// 课前检查：在看不见、静音的窗口里把网页课件真正打开一遍，记录打不开的资源、脚本报错、空白页面。
// 用学生窗口同一个会话，远程资源进了缓存，上课切过去更快。一次只检查一个页面。
const { BrowserWindow } = require('electron');

const short = (u) => { try { const x = new URL(u); return x.protocol === 'lesson:' ? decodeURIComponent(x.pathname.replace(/^\//, '')) : x.host + x.pathname.slice(0, 40); } catch { return String(u).slice(0, 60); } };

/** 截图里绝大多数像素同一种颜色、页面里也没有文字和图形 → 空白 */
function blankRatio(img) {
  const { width, height } = img.getSize();
  if (!width || !height) return 1;
  const bmp = img.toBitmap(), counts = new Map();
  let n = 0;
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const i = (y * width + x) * 4, k = (bmp[i] >> 3) << 10 | (bmp[i + 1] >> 3) << 5 | (bmp[i + 2] >> 3);
    counts.set(k, (counts.get(k) || 0) + 1); n++;
  }
  return Math.max(...counts.values()) / n;
}

async function checkHtml({ url, session, timeout = 20000, settle = 1500, log }) {
  const w = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { offscreen: true, session, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const wc = w.webContents, failed = [], errors = [], reqs = new Map(), t0 = Date.now();
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('console-message', (e, ...legacy) => {
    const level = e.level ?? legacy[0], message = e.message ?? legacy[1];
    if ((level === 'error' || level === 3) && errors.length < 5) errors.push(String(message).slice(0, 160));
  });
  try {
    // 没有页面的窗口上 Network.enable 会一直等，先开一个空白页
    await Promise.race([wc.loadURL('about:blank'), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
    try {
      wc.debugger.attach('1.3');
      wc.debugger.on('message', (_e, method, p) => {
        if (method === 'Network.requestWillBeSent') reqs.set(p.requestId, p.request.url);
        else if (method === 'Network.loadingFailed' && !p.canceled && !/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(p.errorText)) failed.push({ url: reqs.get(p.requestId) || '', error: p.errorText });
        else if (method === 'Network.responseReceived' && p.response.status >= 400) failed.push({ url: p.response.url, error: 'HTTP ' + p.response.status });
      });
      await Promise.race([wc.debugger.sendCommand('Network.enable'), new Promise((_, no) => setTimeout(() => no(Error('Network.enable 超时')), 3000))]);
    } catch (e) { log?.warn('课前检查', '无法记录网络请求', e.message); }
    let mainError = '';
    wc.on('did-fail-load', (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) mainError = desc || String(code); });
    const loaded = await Promise.race([
      wc.loadURL(url).then(() => true, (e) => { mainError ||= e.code || e.message; return false; }),
      new Promise((r) => setTimeout(() => r(null), timeout)),
    ]);
    const ms = Date.now() - t0;
    if (mainError) return { state: 'bad', ms, text: '网页打不开：' + mainError };
    if (loaded === null) return { state: 'warn', ms, text: `网页 ${Math.round(timeout / 1000)} 秒还没加载完，可能在等网络或很大的文件` };
    await new Promise((r) => setTimeout(r, settle));
    let content = 0, ratio = 0;
    try { content = await wc.executeJavaScript(`(() => { const b = document.body; if (!b) return 0; return (b.innerText || '').trim().length + document.querySelectorAll('canvas,svg,img,video,iframe,object,embed').length * 50; })()`, true); } catch {}
    try { ratio = blankRatio(await wc.capturePage()); } catch {}
    const uniq = [...new Map(failed.map((f) => [f.url, f])).values()];
    const out = { state: 'ok', ms, failed: uniq.slice(0, 8).map((f) => ({ url: short(f.url), error: f.error })), errors };
    if (ratio > 0.985 && content < 20) return { ...out, state: 'bad', text: '页面打开后是空白的' + (uniq.length ? `，有 ${uniq.length} 个文件没加载成功（${short(uniq[0].url)}）` : errors.length ? '，页面脚本报错：' + errors[0] : '') };
    if (uniq.length) return { ...out, state: 'warn', text: `有 ${uniq.length} 个文件没加载成功：${uniq.slice(0, 2).map((f) => short(f.url)).join('、')}${uniq.length > 2 ? ' 等' : ''}。上课时可能缺图或功能不全` };
    if (ms > 8000) return { ...out, state: 'warn', text: `网页能打开，但要 ${(ms / 1000).toFixed(1)} 秒，已提前加载好` };
    return { ...out, text: `网页能正常打开（${(ms / 1000).toFixed(1)} 秒）` + (errors.length ? `，页面脚本有 ${errors.length} 条报错，留意一下效果` : '') };
  } finally {
    try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch {}
    w.destroy();
  }
}

let queue = Promise.resolve();
/** 依次检查，避免同时开很多隐藏页面 */
function checkHtmlQueued(opts) { const job = queue.then(() => checkHtml(opts)); queue = job.catch(() => {}); return job; }

module.exports = { checkHtml: checkHtmlQueued, blankRatio };
