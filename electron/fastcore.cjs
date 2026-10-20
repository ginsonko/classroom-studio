// 多线路分段下载的调度核心，软件（Node）和官网（浏览器）共用同一份。
//   一开始每条线路各给一段，按真实的下载速度给快线路多分；
//   某条线路卡住或明显比别的慢：停掉它，已经下到的部分留着，剩下的交给别的线路接着下；
//   没有新段可分时，把正在下的最大一块剩余部分对半分给空闲线路；
//   每段下完调用 verify（有清单哈希时逐段校验），对不上就停用提供它的线路、整段重下。
(function (root, make) { if (typeof module === 'object' && module.exports) module.exports = make(); else root.FastCore = make(); })(this, function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const host = (u) => { try { return new URL(u).host; } catch { return String(u); } };
  const median = (xs) => { const s = xs.filter((x) => x > 0).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

  class NoRange extends Error {}

  /**
   * @param {{urls:string[], size:number, chunk:number, done?:Set<number>, fetch:Function, signal?:AbortSignal,
   *   verify?:(i:number, buf:Uint8Array)=>Promise<boolean>|boolean, write:(i:number, pos:number, buf:Uint8Array)=>Promise<void>|void,
   *   onProgress?:(got:number, lines:number)=>void, log?:(...a:any[])=>void, conns?:number, perSource?:number, stallMs?:number, minPiece?:number}} o
   */
  async function run(o) {
    const size = o.size, chunk = o.chunk, n = Math.ceil(size / chunk);
    const conns = o.conns || 8, perSource = o.perSource || 3, stallMs = o.stallMs || 15000, minPiece = o.minPiece || 512 << 10;
    const done = o.done || new Set();
    const sources = o.urls.map((url) => ({ url, host: host(url), rate: 0, fails: 0, dead: false, active: 0, got: 0, norange: false }));
    const chunks = new Map(); // 段号 → { i, a, len, buf, filled, from:Set<source> }
    const tasks = [];          // 待下的区间 { c, start, end }（绝对位置，含两端）
    const running = new Set(); // { c, start, end, pos, s, t0, mark:[time,pos][], ctl }
    let doneBytes = 0;
    for (const i of done) doneBytes += Math.min(size, (i + 1) * chunk) - i * chunk;
    const fresh = (i) => { const a = i * chunk, len = Math.min(size, a + chunk) - a; const c = { i, a, len, buf: null, filled: 0, from: new Set() }; chunks.set(i, c); return { c, start: a, end: a + len - 1 }; };
    for (let i = 0; i < n; i++) if (!done.has(i)) tasks.push(fresh(i));

    const alive = () => sources.filter((s) => !s.dead);
    const known = () => median(alive().map((s) => s.rate));
    // 代理的速度时快时慢：闲了 20 秒以上的线路不再用旧的测速，重新给机会
    const stale = (s) => !s.active && Date.now() - (s.lastUse || 0) > 20000;
    // 没测过的线路按中位数乐观估计，保证每条都会被试到
    const score = (s) => ((stale(s) ? Math.max(s.rate, known()) : s.rate) || known() || 1) / (1 + s.fails) / (1 + s.active);
    const pick = (avoid) => alive().filter((s) => s.active < perSource && s !== avoid).sort((a, b) => score(b) - score(a))[0];
    const report = () => { let x = doneBytes; for (const c of chunks.values()) x += c.filled; o.onProgress?.(Math.min(size, x), new Set([...running].map((t) => t.s)).size); };

    const finishChunk = async (c) => {
      const ok = o.verify ? await o.verify(c.i, c.buf) : true;
      if (!ok) {
        // bad 不会因为后来下成功而清零：反复参与坏段的线路两次就停用
        for (const s of c.from) { s.bad = (s.bad || 0) + 1; s.fails += 2; if (c.from.size === 1 || s.bad >= 2) s.dead = true; }
        o.log?.('分段校验不对，重下', c.i, [...c.from].map((s) => s.host).join(','));
        tasks.unshift(fresh(c.i));
        return;
      }
      await o.write(c.i, c.a, c.buf);
      chunks.delete(c.i); done.add(c.i); doneBytes += c.len;
    };

    const runTask = async (t, s) => {
      const c = t.c; c.buf ||= new Uint8Array(c.len);
      const ctl = new AbortController(), stop = () => ctl.abort();
      const r = { ...t, pos: t.start, s, t0: Date.now(), last: Date.now(), mark: [], ctl, why: '' };
      running.add(r); s.active++;
      o.signal?.addEventListener('abort', stop);
      try {
        const res = await o.fetch(s.url, { headers: { Range: `bytes=${r.start}-${r.end}` }, signal: ctl.signal });
        if (res.status === 200) { s.norange = true; throw new NoRange('不支持分段'); }
        if (res.status !== 206) throw new Error('HTTP ' + res.status);
        const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(res.headers.get('content-range') || '');
        if (!m || +m[1] !== r.start || (m[3] !== '*' && +m[3] !== size)) throw new Error('分段范围不对');
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            // r.end 可能被别的线路分走一半而变小：只收到 r.end 为止
            const take = Math.min(value.length, r.end + 1 - r.pos);
            if (take > 0) { c.buf.set(take === value.length ? value : value.subarray(0, take), r.pos - c.a); r.pos += take; c.filled += take; s.got += take; c.from.add(s); r.last = Date.now(); }
            if (r.pos > r.end) break;
          }
        } finally { reader.cancel().catch(() => {}); }
        if (r.pos <= r.end) throw new Error('数据不完整');
        const sec = (Date.now() - r.t0) / 1000, bytes = r.end + 1 - r.start;
        if (sec > 0.3) s.rate = s.rate ? s.rate * 0.5 + (bytes / sec) * 0.5 : bytes / sec;
        s.fails = 0;
      } catch (e) {
        if (o.signal?.aborted) throw new Error('已取消');
        if (e instanceof NoRange) s.dead = true;
        else if (!r.why) { s.fails++; if (s.fails >= 3 || /范围/.test(e.message)) s.dead = true; }
        else if (r.why === '太慢') s.rate = Math.min(s.rate || Infinity, rateOf(r));
        o.log?.('换线路', s.host, r.why || e.message);
        if (r.pos <= r.end) tasks.unshift({ c, start: r.pos, end: r.end });
      } finally {
        o.signal?.removeEventListener('abort', stop);
        running.delete(r); s.active--; s.lastUse = Date.now();
      }
      if (c.filled >= c.len && chunks.get(c.i) === c) await finishChunk(c);
    };
    const rateOf = (r) => {
      const now = Date.now(), old = r.mark.find(([t]) => now - t <= 6000) || [r.t0, r.start];
      return (r.pos - old[1]) / Math.max(0.5, (now - old[0]) / 1000);
    };

    // 看门狗：卡住、或比别的线路慢很多时把它停掉（进度保留）
    const watch = setInterval(() => {
      const now = Date.now();
      for (const r of running) {
        r.mark.push([now, r.pos]); while (r.mark.length > 8) r.mark.shift();
        if (now - r.t0 > 3000) { const rt = rateOf(r); r.s.rate = r.s.rate ? r.s.rate * 0.8 + rt * 0.2 : rt; }
      }
      // 参照速度：正在下的各段的中位数，和最快线路的一半，取大的（只剩最后一段时也能发现它慢）
      const mid = median([...running].filter((r) => now - r.t0 > 4000).map(rateOf));
      const ref = Math.max(mid, Math.max(0, ...alive().filter((s) => !stale(s)).map((s) => s.rate)) / 2);
      for (const r of running) {
        if (r.why) continue;
        if (now - r.last > stallMs) { r.why = '卡住了'; r.ctl.abort(); continue; }
        const left = r.end + 1 - r.pos, rt = rateOf(r), alt = pick(r.s);
        // 剩得不多时只有收尾阶段（没有别的段可下）才值得换线路
        if (now - r.t0 > 8000 && ref > 0 && rt < ref / 4 && (left > minPiece || !tasks.length) && alt && (!alt.rate || alt.rate > rt * 3)) { r.why = '太慢'; r.ctl.abort(); }
      }
      report();
    }, 1000);

    try {
      await Promise.all([...Array(conns)].map(async (_, k) => {
        await sleep(k * 150);
        for (;;) {
          if (o.signal?.aborted) throw new Error('已取消');
          if (done.size >= n) return;
          if (!alive().length) {
            if (sources.some((s) => s.norange) && sources.every((s) => s.norange || s.fails)) throw new NoRange('所有线路都不支持分段');
            if (!sources.some((s) => s.revived)) { for (const s of sources) if (!s.norange) { s.dead = false; s.fails = 0; s.revived = true; } continue; }
            throw new Error('所有下载线路都失败了');
          }
          let t = tasks.shift();
          if (!t) {
            // 收尾：把剩得最多的那块对半分
            const big = [...running].filter((r) => r.end - r.pos > minPiece * 2).sort((a, b) => (b.end - b.pos) - (a.end - a.pos))[0];
            if (!big || !pick()) { await sleep(250); continue; }
            const mid = big.pos + Math.floor((big.end - big.pos) / 2);
            t = { c: big.c, start: mid + 1, end: big.end }; big.end = mid;
          }
          const s = pick();
          if (!s) { tasks.unshift(t); await sleep(250); continue; }
          await runTask(t, s);
        }
      }));
    } finally { clearInterval(watch); }
    report();
    const by = {}; for (const s of sources) if (s.got) by[s.host] = (by[s.host] || 0) + s.got;
    return by;
  }

  return { run, NoRange };
});
