'use strict';
// 读 zip（.csplugin 就是 zip）：只认「不压缩」和 deflate 两种，按中央目录读；
// 名字里有 .. 或绝对路径的条目拒绝（防止解压到插件文件夹外面），总大小、条目数有上限。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { zip } = require('./exporter.cjs');

function entries(buf, { maxFiles = 2000, maxBytes = 200 * 1024 * 1024 } = {}) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('不是有效的插件包（zip 结构不完整）');
  const count = buf.readUInt16LE(end + 10), cdOff = buf.readUInt32LE(end + 16);
  if (count > maxFiles) throw new Error('插件包里的文件太多');
  const out = [];
  let p = cdOff, total = 0;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('插件包目录损坏');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nlen);
    // 0x0800：UTF-8 文件名；不是的话多半是 Windows 资源管理器打的包（GBK），按 latin1 读出来至少不会乱码报错
    const name = (flags & 0x0800 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('插件包加了密码，打不开');
    if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) throw new Error('插件包里有不安全的路径：' + name);
    total += usize;
    if (total > maxBytes) throw new Error('插件包解压后太大');
    const lnlen = buf.readUInt16LE(loc + 26), lxlen = buf.readUInt16LE(loc + 28), start = loc + 30 + lnlen + lxlen;
    const comp = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp, { maxOutputLength: Math.max(usize, 1) });
    else throw new Error('插件包用了不支持的压缩方式');
    if (data.length !== usize) throw new Error('插件包里的文件损坏：' + name);
    out.push({ name, data });
  }
  return out;
}

/** 解压到 dest；如果所有文件都在同一个顶层文件夹里（老师直接压缩了整个文件夹），去掉这一层 */
function extract(buf, dest, opts) {
  const list = entries(buf, opts).filter((e) => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(e.name));
  const tops = new Set(list.map((e) => e.name.split('/')[0]));
  const strip = tops.size === 1 && list.every((e) => e.name.includes('/')) ? [...tops][0].length + 1 : 0;
  for (const e of list) {
    const rel = e.name.slice(strip);
    if (!rel) continue;
    const to = path.resolve(dest, rel);
    if (!to.startsWith(path.resolve(dest) + path.sep)) throw new Error('插件包里有不安全的路径：' + e.name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, e.data);
  }
  return list.length;
}

/** 把文件夹打成 zip（相对路径，正斜杠） */
function packFolder(dir, skip = () => false) {
  const items = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (skip(r) || e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) items.push({ name: r, data: fs.readFileSync(path.join(d, e.name)) });
    }
  };
  walk(dir, '');
  return zip(items);
}

module.exports = { entries, extract, packFolder };
