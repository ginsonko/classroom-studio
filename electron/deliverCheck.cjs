'use strict';
// 工坊每轮结束的成品自检（插件以外的所有成品）：照插件「每轮自动检查、最多修 2 轮」的做法推广。
// - HTML：先打包成单文件，再在离屏窗口里点一遍（htmlProbe，由主进程注入）
// - 题库 JSON：合法 JSON、每题有题干答案；练习 / 作业 / 测验的题必须带出处，并做来源核对（sourceCheck）
// - Markdown：公式能不能渲染（用设计包里的 KaTeX 逐个试），引用的图片在不在
// 返回 { problems: [...给 AI 的修改清单], notes: [...给老师看的结果], bank: [...来源核对结果] }
const fs = require('node:fs');
const path = require('node:path');
const { packFile } = require('./agent-kit/kit/pack.cjs');
const source = require('./sourceCheck.cjs');

let katex = null;
// 设计包里的 katex.min.js 是 UMD 脚本；开发目录的 package.json 是 type: module，不能直接 require，按 CommonJS 包一层执行
function tex() {
  if (katex === null) {
    try {
      const mod = { exports: {} };
      new Function('module', 'exports', fs.readFileSync(path.join(__dirname, 'agent-kit', 'kit', 'vendor', 'katex.min.js'), 'utf8'))(mod, mod.exports);
      katex = typeof mod.exports.renderToString === 'function' ? mod.exports : false;
    } catch { katex = false; }
  }
  return katex || null;
}

const SKIP_DIR = /^(\.|附件$|plugin$|资料$|下载$|node_modules$|_deps$)/;
/** 这一轮新写或改过的成品文件（不含隐藏目录、附件、资料、下载） */
function changedFiles(work, since) {
  const out = [];
  const walk = (d, depth) => {
    let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && depth < 3) walk(p, depth + 1); continue; }
      if (!e.isFile() || ['任务背景.md', '进度.md', '素材需求.json'].includes(e.name)) continue;
      try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch { /* 刚删 */ }
      if (out.length > 200) return;
    }
  };
  walk(work, 0);
  return out;
}

/** Markdown 里每个公式试着用 KaTeX 渲染一遍；本地图片要真实存在 */
function checkMarkdown(file) {
  const md = fs.readFileSync(file, 'utf8'), name = path.basename(file), problems = [];
  const k = tex();
  if (k) {
    const bad = [];
    const re = /\$\$([\s\S]+?)\$\$|\$((?:\\\$|[^$\n])+?)\$/g;
    for (let m; (m = re.exec(md)) && bad.length < 5;) {
      const body = (m[1] ?? m[2]).trim();
      if (/\\ce\{/.test(body)) continue;
      try { k.renderToString(body, { throwOnError: true, displayMode: !!m[1], strict: 'ignore' }); }
      catch (e) { bad.push(`\`${body.slice(0, 50)}\`（${String(e.message).replace(/^KaTeX parse error:\s*/, '').slice(0, 60)}）`); }
    }
    if (bad.length) problems.push(`「${name}」里有公式写错了，排版时会显示成红字：${bad.join('；')}`);
  }
  const imgs = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((s) => !/^(https?:|data:)/i.test(s));
  const miss = imgs.filter((s) => { try { return !fs.existsSync(path.resolve(path.dirname(file), decodeURI(s))); } catch { return true; } });
  if (miss.length) problems.push(`「${name}」引用的图片不存在：${miss.slice(0, 4).join('、')}（要么生成 / 放进这个文件，要么删掉这行）`);
  const remote = [...md.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]);
  if (remote.length) problems.push(`「${name}」引用了网络图片，导出时显示不出来：${remote.slice(0, 2).join('、')}（下载到文件夹里再引用）`);
  return problems;
}

/** 题库 JSON：格式 + 出处 */
async function checkBankFile(file, { work, needSource, fetch, webFetch, pdfText, log }) {
  const name = path.basename(file), problems = [], notes = [];
  let bank;
  try { bank = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return { problems: [`「${name}」不是合法的 JSON（${String(e.message).slice(0, 80)}）：检查引号、逗号、反斜杠要写两个`], notes, result: null }; }
  const list = Array.isArray(bank) ? bank : Array.isArray(bank?.questions) ? bank.questions : null;
  if (!list || !list.length) return { problems: [`「${name}」里没有 questions 题目列表`], notes, result: null };
  const empty = list.map((q, i) => (!String(q?.stem || '').trim() || !String(q?.answer || '').trim() ? i + 1 : 0)).filter(Boolean);
  if (empty.length) problems.push(`「${name}」第 ${empty.slice(0, 8).join('、')} 题缺题干或答案`);
  if (needSource) {
    const none = list.map((q, i) => (q && (q.source || q.cite || q['出处']) ? 0 : i + 1)).filter(Boolean);
    if (none.length) problems.push(`「${name}」第 ${none.slice(0, 10).join('、')} 题没写出处（source）：真题写卷名、年份、地区、题号、网址；自己出的写 {"kind": "原创"}`);
  }
  const r = await source.checkBank(bank, { work, fetch, webFetch, pdfText, log });
  source.annotate(bank, r);
  try { fs.writeFileSync(file, JSON.stringify(bank, null, 2)); } catch { /* 写不回去也不影响报告 */ }
  notes.push(`「${name}」${source.summary(r)}`);
  const bad = source.problems(r, bank);
  if (bad.length) problems.push(`「${name}」有 ${r.unverified} 道题的出处核对不上（软件打开了你写的网址 / 本地原文，没找到这道题）。逐条处理：找到正确的出处网址或把原文存进「资料/来源」后写进 source.file；找不到就把 kind 改成「改编」或「原创」，练习卷和答案里也不能再写成真题：\n` + bad.map((s) => '  - ' + s).join('\n'));
  return { problems, notes, result: r };
}

/**
 * 检查任务这一轮改过的成品。opts：{ since, skill, probeHtml(file), fetch, pdfText, log }
 * 练习 / 作业 / 测验（practice-set / homework / quiz-paper）的题库必须带出处。
 */
async function checkDeliverables(work, opts = {}) {
  const files = changedFiles(work, opts.since || 0);
  const problems = [], notes = [], banks = [];
  const needSource = ['practice-set', 'homework', 'quiz-paper'].includes(opts.skill || '');
  for (const f of files.filter((x) => /\.html?$/i.test(x))) {
    try {
      const r = packFile(f);
      if (r.packed) notes.push(`「${path.basename(r.out)}」已打包成单文件（${Math.round(r.size / 1024)} KB），微信里离线能打开；源文件在 .cs-src`);
      if (r.missing.length) problems.push(`「${path.basename(f)}」引用的文件找不到：${r.missing.slice(0, 5).join('、')}`);
      if (opts.probeHtml) {
        const p = await opts.probeHtml(r.out);
        problems.push(...p.problems.map((s) => `「${path.basename(r.out)}」${s}`));
        if (p.note) notes.push(`「${path.basename(r.out)}」自检：${p.note}${p.problems.length ? `，发现 ${p.problems.length} 个问题` : '，没有发现问题'}`);
      }
    } catch (e) { problems.push(`「${path.basename(f)}」检查失败：${e.message}`); }
  }
  for (const f of files.filter((x) => /题库\.json$/i.test(x))) {
    const r = await checkBankFile(f, { work, needSource, fetch: opts.fetch, webFetch: opts.webFetch, pdfText: opts.pdfText, log: opts.log });
    problems.push(...r.problems); notes.push(...r.notes); if (r.result) banks.push({ file: f, ...r.result });
  }
  for (const f of files.filter((x) => /\.(md|markdown)$/i.test(x))) { try { problems.push(...checkMarkdown(f)); } catch { /* 读不了就算了 */ } }
  return { files, problems, notes, banks };
}

module.exports = { checkDeliverables, checkMarkdown, checkBankFile, changedFiles };
