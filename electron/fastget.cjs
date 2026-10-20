'use strict';
// 多线路分段下载（软件里用）：同一个文件从 GitHub 原站、各个国内加速代理、我们的镜像同时分段下载。
// 调度见 fastcore.cjs（和官网共用）；这里负责断点续传记录、写文件、逐段 / 整体 sha256 校验。
const fs = require('node:fs');
const crypto = require('node:crypto');
const { run, NoRange } = require('./fastcore.cjs');

// 免费的 GitHub 下载加速代理（用法：前缀 + GitHub 原地址）。会失效，所以运行时还会拉一份最新名单（见 updater.cjs）
const PROXIES = ['https://gh-proxy.org/', 'https://gh.catmak.name/', 'https://gh-proxy.com/', 'https://cdn.gh-proxy.org/', 'https://ghm.078465.xyz/', 'https://ghproxy.net/'];
// 官网网页里只能用允许跨域（CORS）的代理；gh.catmak.name、ghproxy.net 不带跨域头
const BROWSER_PROXIES = PROXIES.filter((p) => !/catmak\.name|ghproxy\.net/.test(p));
const GH = /^https:\/\/(github\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//;

/** 把清单里的地址展开成全部线路：GitHub 地址前面加上各个加速代理；其余地址原样保留 */
function expand(urls, proxies = PROXIES) {
  const out = [];
  for (const u of urls) {
    if (GH.test(u)) for (const p of proxies) out.push(p + u);
    out.push(u);
  }
  return [...new Set(out)];
}

/** 名单里的代理只接受 https 前缀，最多 16 个 */
function cleanProxies(list) {
  if (!Array.isArray(list)) return null;
  const ok = list.filter((p) => typeof p === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?\/([\w.-]+\/)*$/i.test(p)).slice(0, 16);
  return ok.length ? ok : null;
}

const host = (u) => { try { return new URL(u).host; } catch { return u; } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * 下载一个文件到 file。
 * @param {{urls:string[], size:number, sha256:string, file:string, fetch:Function, proxies?:string[], onBytes?:(n:number)=>void, signal?:AbortSignal,
 *          log?:any, chunkSize?:number, chunkSums?:string[], chunk?:number, conns?:number, perSource?:number, stallMs?:number, minPiece?:number}} o
 * @returns {Promise<{bytes:number, ms:number, sources:Record<string,number>}>}
 */
async function fastGet(o) {
  const size = Number(o.size) || 0;
  if (!size) return single(o);
  // 清单里有每段的 sha256 时按清单的分段大小下，每段到手就校验，返回错内容的线路立刻停用
  const sums = Array.isArray(o.chunkSums) && o.chunkSize ? o.chunkSums : null;
  const chunk = sums ? o.chunkSize : o.chunk || 4 << 20;
  const n = Math.ceil(size / chunk), stateFile = o.file + '.state.json', t0 = Date.now();
  if (sums && sums.length !== n) throw new Error('更新清单里的分段校验信息不对');

  // 断点续传：同一个文件（大小、哈希、分段大小都一样）接着下
  let done = new Set();
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (s.sha256 === o.sha256 && s.size === size && s.chunk === chunk && fs.statSync(o.file).size === size) done = new Set(s.done.filter((i) => i >= 0 && i < n));
  } catch { /* 没有记录就从头下 */ }
  if (!done.size) { fs.writeFileSync(o.file, ''); fs.truncateSync(o.file, size); }
  const fd = fs.openSync(o.file, 'r+');
  const urls = expand(o.urls, o.proxies);
  let sources;
  try {
    sources = await run({
      urls, size, chunk, done, fetch: o.fetch, signal: o.signal, conns: o.conns, perSource: o.perSource, stallMs: o.stallMs, minPiece: o.minPiece,
      verify: sums ? (i, buf) => sha(buf) === sums[i] : null,
      write: (i, pos, buf) => {
        fs.writeSync(fd, buf, 0, buf.length, pos);
        try { fs.writeFileSync(stateFile, JSON.stringify({ sha256: o.sha256, size, chunk, done: [...done, i] })); } catch { /* 下次从头下而已 */ }
      },
      onProgress: (got) => o.onBytes?.(got),
      log: (...a) => o.log?.warn?.(...a),
    });
  } catch (e) {
    if (!(e instanceof NoRange) || o.signal?.aborted) throw e;
    fs.closeSync(fd); fs.rmSync(stateFile, { force: true });
    return single({ ...o, urls, expanded: true });
  } finally { try { fs.closeSync(fd); } catch { /* 已关 */ } }

  if (o.signal?.aborted) throw new Error('已取消');
  if (await shaFile(o.file) !== o.sha256) { fs.rmSync(o.file, { force: true }); fs.rmSync(stateFile, { force: true }); throw new Error('文件校验不通过（可能下载不完整）'); }
  fs.rmSync(stateFile, { force: true });
  const ms = Date.now() - t0;
  o.log?.info?.('下载完成', Math.round(size / 1048576) + 'MB', Math.round(ms / 1000) + '秒', JSON.stringify(sources));
  return { bytes: size, ms, sources };
}

function shaFile(file) {
  return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
}

/** 整文件顺序下载：按顺序试每条线路，边下边算 sha256（大小未知、或线路都不支持分段时用） */
async function single(o) {
  const errs = [], t0 = Date.now();
  for (const url of o.expanded ? o.urls : expand(o.urls, o.proxies)) {
    const ctl = new AbortController(); let last = Date.now();
    const stop = () => ctl.abort(); o.signal?.addEventListener('abort', stop);
    const watch = setInterval(() => { if (Date.now() - last > (o.stallMs || 15000) * 2) ctl.abort(); }, 1000);
    try {
      const r = await o.fetch(url, { signal: ctl.signal });
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
      const hash = crypto.createHash('sha256'), out = fs.createWriteStream(o.file);
      let got = 0, mark = 0;
      try {
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value); got += value.length; last = Date.now();
          if (!out.write(value)) await new Promise((res) => out.once('drain', res));
          if (got - mark > 512 * 1024) { mark = got; o.onBytes?.(got); }
        }
      } finally { await new Promise((res) => out.end(res)); }
      if (o.sha256 && hash.digest('hex') !== o.sha256) throw new Error('文件校验不通过（可能下载不完整）');
      o.onBytes?.(got);
      return { bytes: got, ms: Date.now() - t0, sources: { [host(url)]: got } };
    } catch (e) { errs.push(host(url) + '：' + (o.signal?.aborted ? '已取消' : e.message)); fs.rmSync(o.file, { force: true }); if (o.signal?.aborted) break; }
    finally { clearInterval(watch); o.signal?.removeEventListener('abort', stop); }
  }
  throw new Error(errs.join('；'));
}

module.exports = { fastGet, expand, cleanProxies, PROXIES, BROWSER_PROXIES, shaFile };
