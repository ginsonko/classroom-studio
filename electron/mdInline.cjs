'use strict';
// Markdown 课件：读文字（UTF-8，乱码时按 GBK），把引用的本地图片换成 data URL 交给隐藏排版页。
// 排版页没有读文件的权限，图片只能从这里给。Typora 等默认插入绝对路径，所以本机任何位置的图片都认，
// 但只认图片扩展名、限大小；网络共享路径（\\server\…）不碰，免得卡住。
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_TEXT = 5 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024, MAX_TOTAL = 150 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const MD_IMG = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(\s+"[^"\n]*")?\s*\)/g, HTML_IMG = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"'\n]+)\2/gi;

function decode(buf) {
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) { try { return new TextDecoder('gbk').decode(buf); } catch { /* 用 UTF-8 */ } }
  return utf8.replace(/^\uFEFF/, '');
}

/** 图片地址 → 本机文件（相对路径按 Markdown 所在文件夹算）；网址、data URL、网络共享返回 null */
function localImage(src, dir) {
  const s = String(src || '').trim().replace(/^<|>$/g, '');
  if (/^file:/i.test(s)) { try { return localImage(fileURLToPath(s), dir); } catch { return null; } }
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[a-z]:[\\/]/i.test(s);
  if (!s || scheme || /^[\\/]{2}/.test(s)) return null;
  let rel = s.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch { /* 原样 */ }
  const file = path.resolve(dir, rel);
  return /^[\\/]{2}/.test(file) ? null : file;
}

/**
 * 读 Markdown 并内联图片。返回 { text, missing }：missing 是找不到 / 太大 / 不是图片的引用。
 * 图片写法：![说明](images/a.png)、![说明](<带 空格.png> "标题")、<img src="images/a.png">。
 */
async function readMarkdown(file) {
  const st = await fs.promises.stat(file);
  if (st.size > MAX_TEXT) throw new Error('Markdown 文件超过 5 MB，请拆成几份再打开');
  const dir = path.dirname(fs.realpathSync(file));
  let text = decode(await fs.promises.readFile(file)), total = 0;
  const missing = [], cache = new Map();
  const inline = async (src) => {
    const f = localImage(src, dir);
    if (!f) return null;
    if (cache.has(f)) return cache.get(f);
    let url = '';
    try {
      const real = fs.realpathSync(f), mime = MIME[path.extname(real).toLowerCase()], s = await fs.promises.stat(real);
      if (!/^[\\/]{2}/.test(real) && mime && s.isFile() && s.size <= MAX_IMAGE && total + s.size <= MAX_TOTAL) {
        total += s.size;
        url = `data:${mime};base64,${(await fs.promises.readFile(real)).toString('base64')}`;
      }
    } catch { /* 找不到 */ }
    if (!url) missing.push(path.basename(f));
    cache.set(f, url);
    return url;
  };
  const swap = async (re, build) => {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      parts.push(text.slice(last, m.index));
      parts.push(await build(m));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    text = parts.join('');
  };
  await swap(MD_IMG, async (m) => {
    const url = await inline(m[2]);
    if (url === null) return m[0];
    return url ? `![${m[1]}](${url})` : `**[图片缺失：${m[1] || path.basename(m[2].replace(/^<|>$/g, ''))}]**`;
  });
  await swap(HTML_IMG, async (m) => {
    const url = await inline(m[3]);
    return url ? `${m[1]}${m[2]}${url}${m[2]}` : m[0];
  });
  return { text, missing };
}

/** 引用的本地图片的大小和修改时间：只换了图片、文字没动时，缓存也要失效 */
async function stamp(file) {
  const dir = path.dirname(fs.realpathSync(file)), text = decode(await fs.promises.readFile(file));
  const refs = new Set([...text.matchAll(MD_IMG)].map((m) => m[2]).concat([...text.matchAll(HTML_IMG)].map((m) => m[3])));
  const parts = [];
  for (const src of refs) {
    const f = localImage(src, dir);
    if (!f) continue;
    try { const s = await fs.promises.stat(f); parts.push(`${f}:${s.size}:${s.mtimeMs}`); } catch { parts.push(f + ':-'); }
  }
  return parts.sort().join('|');
}

module.exports = { readMarkdown, localImage, decode, stamp };
