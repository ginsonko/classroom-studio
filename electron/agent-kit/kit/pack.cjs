'use strict';
// 打包成单文件 HTML：把页面引用的本地样式、脚本、图片、字体全部内嵌，得到一个微信里离线点开就能用的文件。
// 源文件（引用 .cs-kit/… 的那份）另存到 .cs-src/ 里，以后改课件改那份，再打包一次。
// 命令行：pack.cmd 课件.html [输出.html]（mac：sh .cs-kit/pack.sh 课件.html）
// 导播台每轮结束也会自动对新改过的 HTML 跑一遍。
const fs = require('node:fs');
const path = require('node:path');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const MAX_ASSET = 8 * 1024 * 1024, MAX_TOTAL = 24 * 1024 * 1024;
const isRemote = (u) => /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(u);

function resolveLocal(base, ref) {
  let u = String(ref || '').trim().replace(/[?#].*$/, '');
  if (!u || isRemote(u)) return '';
  try { u = decodeURIComponent(u); } catch { /* 原样 */ }
  const p = path.resolve(base, u);
  try { return fs.statSync(p).isFile() ? p : ''; } catch { return ''; }
}

/** 把 HTML 字符串里的本地引用内嵌；返回 { html, inlined, missing, external } */
function inlineHtml(html, dir) {
  const inlined = [], missing = [], external = [];
  let total = 0;
  const dataUrl = (file) => {
    const ext = path.extname(file).toLowerCase(), type = MIME[ext];
    if (!type) return '';
    const size = fs.statSync(file).size;
    if (size > MAX_ASSET || total + size > MAX_TOTAL) { missing.push(path.basename(file) + '（太大，没有内嵌）'); return ''; }
    total += size; inlined.push(path.relative(dir, file).replace(/\\/g, '/'));
    return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  };
  const cssUrls = (css, base) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, q, ref) => {
    if (/^data:/i.test(ref)) return all;
    if (isRemote(ref)) { if (/^(https?:)?\/\//i.test(ref)) external.push(ref); return all; }
    const f = resolveLocal(base, ref); if (!f) { missing.push(ref); return all; }
    const d = dataUrl(f); return d ? `url("${d}")` : all;
  });
  const safeScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const safeStyle = (s) => s.replace(/<\/(style)/gi, '<\\/$1');
  let out = html;
  // <link rel="stylesheet" href="…">
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag); const ref = href && (href[1] ?? href[2] ?? href[3]);
    if (!ref) return tag;
    if (isRemote(ref)) { external.push(ref); return tag; }
    const f = resolveLocal(dir, ref); if (!f) { missing.push(ref); return tag; }
    inlined.push(path.relative(dir, f).replace(/\\/g, '/'));
    return `<style data-from="${path.basename(f)}">\n${safeStyle(cssUrls(fs.readFileSync(f, 'utf8'), path.dirname(f)))}\n</style>`;
  });
  // <script src="…"></script>
  out = out.replace(/<script\b([^>]*)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>\s*<\/script>/gi, (tag, pre, a, b, c, post) => {
    const ref = a ?? b ?? c;
    if (isRemote(ref)) { external.push(ref); return tag; }
    const f = resolveLocal(dir, ref); if (!f) { missing.push(ref); return tag; }
    inlined.push(path.relative(dir, f).replace(/\\/g, '/'));
    const attrs = (pre + ' ' + post).replace(/\s+/g, ' ').replace(/\b(defer|async)\b/gi, '').trim();
    return `<script${attrs ? ' ' + attrs : ''} data-from="${path.basename(f)}">\n${safeScript(fs.readFileSync(f, 'utf8'))}\n</script>`;
  });
  // 图片、音视频、svg <image>
  out = out.replace(/(<(?:img|source|audio|video|image|input)\b[^>]*?\b(?:src|href|xlink:href|poster)\s*=\s*)(["'])([^"']*)\2/gi, (all, head, q, ref) => {
    if (!ref || /^data:/i.test(ref)) return all;
    if (isRemote(ref)) { if (/^(https?:)?\/\//i.test(ref)) external.push(ref); return all; }
    const f = resolveLocal(dir, ref); if (!f) { missing.push(ref); return all; }
    const d = dataUrl(f); return d ? `${head}${q}${d}${q}` : all;
  });
  // <style> 块和 style="" 里的 url(…)
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, a, css, b) => (/data-from=/.test(a) ? all : a + cssUrls(css, dir) + b));
  out = out.replace(/\bstyle\s*=\s*"([^"]*url\([^"]*)"/gi, (all, css) => `style="${cssUrls(css, dir).replace(/"/g, '&quot;')}"`);
  // JS 里的 http 链接不算外部引用（解析、注释里常有）；只统计加载资源的标签
  return { html: out, inlined: [...new Set(inlined)], missing: [...new Set(missing)], external: [...new Set(external)] };
}

/** 有没有本地引用（判断这份是不是还没打包的源文件） */
function needsPack(html, dir) {
  const refs = [];
  html.replace(/<(?:link|script|img|source|audio|video|image)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi, (_, r) => { refs.push(r); return _; });
  return refs.some((r) => !/^data:/i.test(r) && !isRemote(r) && !!resolveLocal(dir, r));
}

/**
 * 打包一个文件。src 在 .cs-src 里时输出到上一级同名文件；src 在别处时先把源文件存一份到 .cs-src/，再原地写成单文件。
 * 返回 { packed, out, source, size, inlined, missing, external }
 */
function packFile(src, outFile) {
  const file = path.resolve(src);
  const html = fs.readFileSync(file, 'utf8'), dir = path.dirname(file);
  const inSrc = path.basename(dir) === '.cs-src';
  const out = path.resolve(outFile || (inSrc ? path.join(dir, '..', path.basename(file)) : file));
  if (!needsPack(html, dir)) return { packed: false, out: file, source: '', size: Buffer.byteLength(html), inlined: [], missing: [], external: inlineHtml(html, dir).external };
  let source = inSrc ? file : '';
  if (!inSrc && out === file) {
    source = path.join(dir, '.cs-src', path.basename(file));
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, rebase(html, dir, path.dirname(source)));
  }
  const r = inlineHtml(html, dir);
  const body = r.html.replace(/<head>/i, `<head>\n<!-- 单文件课件：由最强网课教辅系统打包，所有样式脚本已内嵌，可离线打开。源文件：.cs-src/${path.basename(file)} -->`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  return { packed: true, out, source, size: Buffer.byteLength(body), inlined: r.inlined, missing: r.missing, external: r.external };
}

/** 源文件挪进 .cs-src 后相对路径要往上一层：.cs-kit/x.css → ../.cs-kit/x.css */
function rebase(html, from, to) {
  const fix = (ref) => { if (!ref || isRemote(ref) || /^data:/i.test(ref) || path.isAbsolute(ref)) return ref; const f = path.resolve(from, ref); return path.relative(to, f).replace(/\\/g, '/'); };
  return html.replace(/(<(?:link|script|img|source|audio|video|image)\b[^>]*?\b(?:src|href|xlink:href)\s*=\s*)(["'])([^"']*)\2/gi, (all, head, q, ref) => `${head}${q}${fix(ref)}${q}`);
}

module.exports = { packFile, inlineHtml, needsPack };

if (require.main === module) {
  const [src, out] = process.argv.slice(2);
  if (!src) { console.log('用法：pack 课件.html [输出.html]'); process.exit(2); }
  try {
    const r = packFile(src, out);
    if (!r.packed) console.log(`「${path.basename(r.out)}」已经是单文件，不用打包。`);
    else console.log(`已打包：${r.out}（${(r.size / 1024).toFixed(0)} KB，内嵌 ${r.inlined.length} 个文件）${r.source ? '\n源文件存在：' + r.source + '（以后改这份，再打包）' : ''}`);
    if (r.missing.length) console.log('找不到或没内嵌：' + r.missing.join('、'));
    if (r.external.length) { console.log('还有外部网络引用（离线打不开）：' + r.external.join('、')); process.exitCode = 1; }
  } catch (e) { console.error('打包失败：' + e.message); process.exit(1); }
}
