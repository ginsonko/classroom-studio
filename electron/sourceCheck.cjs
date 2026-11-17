'use strict';
// 来源核对：题库里标了出处的题，交付前由软件自己抽查——网址打得开、下载到的原文（或老师拖进来的原卷）里确实有这道题。
// 核对不上的题标「来源未核实」，不许叫真题。结果写回题库文件（每题 source.check），任务里报一句实话：
// 「找到真题 N 道，来源核对过 M 道，原创 K 道」。只在主进程运行；网络走注入的 fetch（Electron net，跟随系统代理）。
const fs = require('node:fs');
const path = require('node:path');

const MAX_CHECK = 60, MAX_BYTES = 8 * 1024 * 1024, TIMEOUT_MS = 15000, CONCURRENCY = 3;
const PASS = 0.45;

// ── 文字归一化：去掉 LaTeX 命令、空白、标点，全角转半角，只留汉字、字母、数字 ──
function norm(s) {
  return String(s || '')
    .replace(/\\(?:mathrm|text|mathbf|boldsymbol|operatorname|textbf|rm|it|left|right|displaystyle|dfrac|tfrac|frac|sqrt|cdot|times|quad|qquad|,|;|!|\s)/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}
/** 题干去掉开头的题号、出处括注、分值，选项单独算 */
function stemCore(stem) {
  return String(stem || '')
    .replace(/^\s*(?:\d{1,3}\s*[.．、]|第\s*\d+\s*题)\s*/, '')
    .replace(/^[（(【\[][^）)】\]]{2,40}[）)】\]]\s*/, '')
    .replace(/[（(]\s*\d+\s*分\s*[）)]/g, '');
}
/** 题干里的数字在原文里出现了几成（真题改了数字就是改编，不能叫真题） */
function numberHit(stem, text) {
  // 选项之前的题干；「图 4 条件文字化：…」这种把原图写成文字的补充说明不算（原卷里是图，没有这些数字）
  const body = stemCore(stem).split(/\n\s*[A-DＡ-Ｄ][.．、:：]|[\s\u3000]A[.．、:：]/)[0]
    .split('\n').filter((l) => !/^\s*[（(【]?\s*(图\s*\d*[^，。]{0,8}(文字化|文字说明|条件|描述|说明)|注)/.test(l)).join('\n');
  const nums = [...new Set(norm(body).match(/\d+/g) || [])];
  if (!nums.length) return 1;
  const t = norm(text);
  return nums.filter((n) => t.includes(n)).length / nums.length;
}
const grams = (s, n = 6) => { const out = new Set(); for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n)); return out; };

/** 题干在原文里出现了多少：6 字片段命中比例；题干很短时要求整体出现 */
function matchScore(stem, text) {
  const q = norm(stemCore(stem)).slice(0, 400), t = norm(text);
  if (!q || !t) return 0;
  if (q.length < 14) return t.includes(q) ? 1 : 0;
  const g = grams(q); let hit = 0;
  for (const x of g) if (t.includes(x)) hit++;
  return g.size ? hit / g.size : 0;
}

// ── 原文抽文字 ──
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±', le: '≤', ge: '≥', ne: '≠', minus: '−' };
function htmlText(html) {
  return String(html)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? all));
}
function docxText(buf) {
  const { entries } = require('./zipkit.cjs');
  const doc = entries(buf, { maxBytes: 64 * 1024 * 1024 }).find((e) => e.name === 'word/document.xml');
  if (!doc) return '';
  return doc.data.toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
}
/** 按内容判断格式抽文字；PDF 交给注入的 pdfText（主进程用离屏页面里的 pdf.js） */
async function textOf(buf, hint, pdfText) {
  const head = buf.subarray(0, 8).toString('latin1');
  if (head.startsWith('%PDF-') || /\.pdf$/i.test(hint)) { if (!pdfText) return { text: '', why: 'PDF 原文需要导播台里的 PDF 读取（这里没有）' }; return { text: await pdfText(buf) }; }
  if (head.startsWith('PK') && /\.docx$|word/i.test(hint)) return { text: docxText(buf) };
  if (head.startsWith('PK')) { try { return { text: docxText(buf) }; } catch { return { text: '', why: '压缩包，不是网页或文档' }; } }
  let s = buf.toString('utf8');
  if (/\uFFFD/.test(s.slice(0, 2000)) && /charset=["']?gb/i.test(buf.subarray(0, 4000).toString('latin1'))) { try { s = new TextDecoder('gbk').decode(buf); } catch { /* 没有 gbk 解码器 */ } }
  return { text: /<html|<body|<div|<p[\s>]/i.test(s.slice(0, 20000)) ? htmlText(s) : s };
}

async function fetchText(url, { fetch, pdfText, timeout = TIMEOUT_MS }) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'text/html,application/pdf,*/*' } });
    if (!r.ok) return { ok: false, why: `网址打不开（HTTP ${r.status}）` };
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return { ok: true, text: '', why: '原文太大，没有下载' };
    const buf = Buffer.from(await r.arrayBuffer());
    const finalUrl = r.url || url;
    if (/login|passport|signin|\/user\/auth/i.test(finalUrl) && finalUrl !== url) return { ok: true, text: '', why: '网址要求登录' };
    const t = await textOf(buf.subarray(0, MAX_BYTES), (r.headers.get('content-type') || '') + ' ' + url, pdfText);
    return { ok: true, text: t.text, why: t.why };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? '网址 15 秒没有响应' : '网址打不开（' + String(e.message || e).slice(0, 80) + '）' };
  } finally { clearTimeout(timer); }
}

// ── 题库里的出处 ──
const KINDS = { 真题: 'real', 原题: 'real', 改编: 'adapted', 变式: 'adapted', 原创: 'original', 自编: 'original' };
/** 读一道题的出处：source 可以是对象，也可以是一句话（「2024 北京海淀高一期中 第 7 题」）；没写类别时，有网址 / 卷名就算真题 */
function citeOf(q) {
  const s = q && (q.source ?? q.cite ?? q.出处);
  const o = typeof s === 'string' ? { title: s } : s && typeof s === 'object' ? s : {};
  const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
  const cite = { kind: '', title: str(o.title ?? o.paper ?? o.卷名), no: str(o.no ?? o.number ?? o.题号, 40), year: str(o.year ?? o.年份, 10), region: str(o.region ?? o.地区, 40), url: str(o.url ?? o.link ?? o.网址, 1000), file: str(o.file ?? o.path ?? o.本地文件, 400) };
  const k = str(o.kind ?? o.type ?? o.类别, 10);
  cite.kind = KINDS[k] || (/^(real|adapted|original)$/.test(k) ? k : '') || (/原创|自编/.test(cite.title) ? 'original' : /改编|变式/.test(cite.title) ? 'adapted' : cite.url || cite.file || cite.title ? 'real' : 'original');
  return cite;
}

function inside(work, rel) {
  if (!work || !rel) return '';
  const check = (cand) => {
    const full = path.resolve(work, cand), r = path.relative(work, full);
    return r && !r.startsWith('..') && !path.isAbsolute(r) && fs.existsSync(full) && fs.statSync(full).isFile() ? full : '';
  };
  const direct = check(rel);
  if (direct) return direct;
  const base = path.basename(String(rel));
  if (base && base === String(rel).replace(/^[./\\]+/, '')) {
    for (const sub of ['资料/来源', '下载', '附件']) {
      const hit = check(path.join(sub, base));
      if (hit) return hit;
    }
  }
  return '';
}

function cleanUrlKey(u) {
  try { const x = new URL(String(u || '').trim()); x.hash = ''; return x.href.replace(/\/+$/, ''); } catch { return String(u || '').trim(); }
}

/** 读取 web_fetch / browser_read / browser_download 记下的「资料/来源/索引.md」，把网址对应到已落盘的原文文件 */
function archivedFilesForUrl(work) {
  const map = new Map();
  if (!work) return map;
  const idx = path.join(work, '资料', '来源', '索引.md');
  let raw = '';
  try { raw = fs.readFileSync(idx, 'utf8'); } catch { return map; }
  const add = (url, rel) => {
    const k = cleanUrlKey(url);
    const full = inside(work, rel);
    if (!k || !full) return;
    if (!map.has(k)) map.set(k, []);
    const arr = map.get(k);
    if (!arr.includes(full)) arr.push(full);
    if (/\.html?$/i.test(full)) {
      const md = full.replace(/\.html?$/i, '.md');
      if (fs.existsSync(md) && !arr.includes(md)) arr.push(md);
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    const m = /\]\((https?:\/\/[^)\s]+)\)\s*→\s*(\S+)/i.exec(line);
    if (m) add(m[1], m[2]);
  }
  return map;
}

/**
 * 核对一份题库。返回 { total, real, adapted, original, checked, verified, unverified, items: [{ i, kind, status, score, why }] }
 * status：verified 原文里找到了 / unverified 打开了但对不上 / unreachable 打不开 / missing 没写网址也没给原文 / skipped 超出抽查数量。
 * 同一个网址、同一份原文只下载一次；AI 用 web_fetch / 内置浏览器抓到「资料/来源」里的原文也会自动对上。
 */
async function checkBank(bank, { work = '', fetch: fetchFn, webFetch, pdfText, max = MAX_CHECK, log } = {}) {
  const list = Array.isArray(bank) ? bank : Array.isArray(bank?.questions) ? bank.questions : [];
  const items = list.map((q, i) => ({ i, cite: citeOf(q), stem: String(q?.stem || '') }));
  const claims = items.filter((x) => x.cite.kind === 'real' || x.cite.kind === 'adapted');
  // 超过上限时均匀抽查
  const step = claims.length > max ? claims.length / max : 1;
  const pick = new Set(); for (let k = 0; k < Math.min(max, claims.length); k++) pick.add(claims[Math.floor(k * step)].i);
  const archived = archivedFilesForUrl(work);
  const cache = new Map();
  const load = (key, fn) => { if (!cache.has(key)) cache.set(key, fn().catch((e) => ({ ok: false, why: String(e.message || e).slice(0, 120) }))); return cache.get(key); };
  const result = items.map((x) => ({ i: x.i, kind: x.cite.kind, status: x.cite.kind === 'original' ? 'original' : pick.has(x.i) ? '' : 'skipped', score: 0, why: '' }));
  const todo = claims.filter((x) => pick.has(x.i));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const x = todo[next++], r = result[x.i], { url, file } = x.cite;
      const tried = [];
      let best = 0, opened = false, nums = 1;
      const score = (text) => { const v = matchScore(x.stem, text); if (v > best) { best = v; nums = numberHit(x.stem, text); } };
      const local = inside(work, file);
      if (file && !local) tried.push(`本地原文「${file}」不存在`);
      const localFiles = [...(local ? [local] : []), ...(url ? (archived.get(cleanUrlKey(url)) || []) : [])];
      for (const lf of [...new Set(localFiles)]) {
        const t = await load('f:' + lf, async () => ({ ok: true, ...(await textOf(fs.readFileSync(lf), lf, pdfText)) }));
        opened = true; if (t.why) tried.push(t.why);
        score(t.text || '');
        if (best >= PASS && (nums >= 0.8 || x.cite.kind === 'adapted')) break;
      }
      if (best < PASS && /^https?:\/\//i.test(url) && fetchFn) {
        const t = await load('u:' + url, () => fetchText(url, { fetch: fetchFn, pdfText }));
        if (t.ok) { opened = true; score(t.text || ''); if (t.why) tried.push(t.why); }
        else tried.push(t.why);
      }
      if (best < PASS && /^https?:\/\//i.test(url) && typeof webFetch === 'function') {
        const t = await load('w:' + url, () => webFetch(url, work));
        if (t.ok) { opened = true; score(t.text || ''); if (t.why) tried.push(t.why); }
        else if (!opened && t.why) tried.push(t.why);
      } else if (best < PASS && url && !/^https?:\/\//i.test(url)) tried.push('网址格式不对');
      r.score = Math.round(best * 100) / 100;
      if (!url && !local) { r.status = 'missing'; r.why = '没写网址，也没有本地原文'; }
      else if (best >= PASS && (nums >= 0.8 || x.cite.kind === 'adapted')) r.status = 'verified';
      else if (best >= PASS) { r.status = 'unverified'; r.why = '原文里有相近的题，但数字对不上（改了数字就要标「改编」）'; }
      else if (!opened) { r.status = 'unreachable'; r.why = tried.join('；') || '打不开'; }
      else { r.status = 'unverified'; r.why = (tried.length ? tried.join('；') + '；' : '') + `原文里没找到这道题（相似度 ${Math.round(best * 100)}%）`; }
      log?.(`来源核对 #${x.i + 1} ${r.status} ${r.score}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const count = (k) => result.filter((r) => r.status === k).length;
  return {
    total: items.length, real: items.filter((x) => x.cite.kind === 'real').length, adapted: items.filter((x) => x.cite.kind === 'adapted').length,
    original: items.filter((x) => x.cite.kind === 'original').length, checked: todo.length, verified: count('verified'),
    unverified: count('unverified') + count('unreachable') + count('missing'), skipped: count('skipped'), items: result,
  };
}

const STATUS_NAME = { verified: '来源已核对', unverified: '来源未核实', unreachable: '来源未核实', missing: '来源未核实', skipped: '未抽查', original: '原创' };

/** 一句实话 */
function summary(r) {
  if (!r.total) return '题库里没有题';
  const real = r.real + r.adapted;
  const parts = [`找到真题 ${r.real} 道`];
  if (r.adapted) parts.push(`改编 ${r.adapted} 道`);
  parts.push(`来源核对过 ${r.verified} 道`);
  parts.push(`原创 ${r.original} 道`);
  let s = parts.join('，');
  if (r.unverified) s += `；${r.unverified} 道来源对不上，已标「来源未核实」`;
  if (r.skipped) s += `（共 ${real} 道标了出处，抽查了 ${r.checked} 道）`;
  return s;
}

/** 核对结果写回题库：每题 source.check = { status, label, score, why, at }；原文件格式（对象 / 数组）保持不变 */
function annotate(bank, r, at = new Date().toISOString()) {
  const list = Array.isArray(bank) ? bank : bank.questions;
  r.items.forEach((x) => {
    const q = list[x.i]; if (!q || typeof q !== 'object') return;
    const cite = citeOf(q), src = typeof q.source === 'object' && q.source ? q.source : (q.source = { ...(typeof q.source === 'string' ? { title: q.source } : {}), kind: cite.kind === 'real' ? '真题' : cite.kind === 'adapted' ? '改编' : '原创' });
    src.check = { status: x.status, label: STATUS_NAME[x.status] || x.status, ...(x.score ? { score: x.score } : {}), ...(x.why ? { why: x.why } : {}), at };
  });
  if (!Array.isArray(bank)) bank.sourceCheck = { at, summary: summary(r), verified: r.verified, unverified: r.unverified, original: r.original, real: r.real, adapted: r.adapted };
  return bank;
}

/** 给 AI 的修改清单：对不上的题逐条列出 */
function problems(r, bank) {
  const list = Array.isArray(bank) ? bank : bank.questions || [];
  return r.items.filter((x) => ['unverified', 'unreachable', 'missing'].includes(x.status)).slice(0, 15).map((x) => {
    const c = citeOf(list[x.i]); const stem = String(list[x.i]?.stem || '').replace(/\s+/g, ' ').slice(0, 30);
    return `第 ${x.i + 1} 题「${stem}…」标的出处「${[c.year, c.region, c.title, c.no].filter(Boolean).join(' ') || '（空）'}」${c.url ? ' ' + c.url : ''}：${x.why}`;
  });
}

module.exports = { checkBank, summary, annotate, problems, citeOf, matchScore, norm, htmlText, textOf, STATUS_NAME };
