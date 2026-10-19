// 打 zip 包：流式 deflate（几百 MB 的大文件不一次读进内存）、中文名走 UTF-8 标志、
// 保留 unix 执行位（macOS 的 .app 和命令行工具解压出来才能直接运行）。
// 读：读 central directory 里每个文件的 unix 权限（重打包 Electron 官方包时用）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = typeof zlib.crc32 === 'function'
  ? () => { let v = 0; return { update(buf) { v = zlib.crc32(buf, v); }, digest: () => v >>> 0 }; }
  : () => {
    let crc = 0xffffffff;
    return {
      update(buf) { let c = crc; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); crc = c; },
      digest: () => (crc ^ 0xffffffff) >>> 0,
    };
  };

const dosTime = (d) => {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
};

/**
 * entries: [{ name: 'posix/路径', file: 绝对路径, mode?: 0o755 }] 或 { name, data: Buffer, mode?, mtime? }
 * onBytes(累计解压前字节数) 用于进度。
 */
export async function writeZip(outFile, entries, { onBytes } = {}) {
  const fd = fs.openSync(outFile, 'w');
  const central = [];
  let offset = 0, fed = 0;
  const write = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
  try {
    for (const e of entries) {
      const clean = e.name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
      const name = Buffer.from(clean + (e.dir ? '/' : ''), 'utf8');
      if (!clean.length || e.name.includes('..')) throw new Error('zip 里有不安全的名字：' + e.name);
      let mode = e.mode ?? (e.dir ? 0o755 : 0o644);
      if (!(mode & 0o170000)) mode |= e.dir ? 0o040000 : 0o100000;
      const method = e.dir ? 0 : 8;
      const mtime = e.mtime ?? (e.file ? fs.statSync(e.file).mtime : new Date());
      const { date, time } = dosTime(mtime);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
      head.writeUInt16LE(method, 8); head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12);
      head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
      const at = offset;
      write(head); write(name);
      let usize = 0, csize = 0, digest = 0;
      if (!e.dir) {
        const crc = crc32();
        const def = zlib.createDeflateRaw({ level: 6 });
        def.on('data', (out) => { write(out); csize += out.length; });
        const finished = new Promise((res, rej) => { def.once('end', res); def.once('error', rej); });
        const pump = async (chunk) => {
          crc.update(chunk); usize += chunk.length;
          if (!def.write(chunk)) await new Promise((res) => def.once('drain', res));
        };
        if (e.data) await pump(e.data);
        else {
          const stream = fs.createReadStream(e.file, { highWaterMark: 1 << 20 });
          for await (const chunk of stream) {
            await pump(chunk);
            fed += chunk.length;
            onBytes?.(fed);
          }
        }
        def.end();
        await finished;
        digest = crc.digest();
        // 回填本地头里的校验和与大小
        const fix = Buffer.alloc(12);
        fix.writeUInt32LE(digest, 0); fix.writeUInt32LE(csize, 4); fix.writeUInt32LE(usize, 8);
        fs.writeSync(fd, fix, 0, 12, at + 14);
      }
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x033f, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(method, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
      c.writeUInt32LE(digest, 16); c.writeUInt32LE(csize, 20); c.writeUInt32LE(usize, 24);
      c.writeUInt16LE(name.length, 28); c.writeUInt32LE((((mode & 0xffff) << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38); c.writeUInt32LE(at, 42);
      central.push(Buffer.concat([c, name]));
    }
    const cdAt = offset;
    for (const c of central) write(c);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdAt, 12); end.writeUInt32LE(cdAt, 16);
    write(end);
  } finally {
    fs.closeSync(fd);
  }
}

/** 收集一个目录里的所有文件：zip 名 = prefix + 相对路径；modeMap(相对路径)→unix 权限；skip(相对路径)→跳过 */
export async function entriesFromDir(dir, prefix = '', { modeMap = new Map(), exec = () => false, skip = () => false } = {}) {
  const out = [];
  // 空目录也要记一条（如 Electron 的 Dictionaries、*.lproj），否则解压后缺目录
  const walk = async (d, rel) => {
    const names = (await fs.promises.readdir(d)).sort().filter((name) => !skip(rel ? rel + '/' + name : name));
    const self = rel ? prefix + rel : prefix.replace(/\/+$/, '');
    if (!names.length && self) out.push({ name: self, dir: true, mode: 0o40755 });
    for (const name of names) {
      const full = path.join(d, name), r = rel ? rel + '/' + name : name;
      const st = await fs.promises.lstat(full);
      if (st.isDirectory()) await walk(full, r);
      else if (st.isSymbolicLink()) out.push({ name: prefix + r, data: Buffer.from(await fs.promises.readlink(full), 'utf8'), mode: 0o120777 });
      else {
        const mode = modeMap.get(r) ?? (exec(r) ? 0o755 : 0o644);
        out.push({ name: prefix + r, file: full, mode, mtime: st.mtime });
      }
    }
  };
  await walk(dir, '');
  return out;
}

/** 读 zip 的 central directory：Map<文件名, { mode, size, at, method, csize }>（不解压） */
export function zipModes(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const tail = Buffer.alloc(22 + 65536);
    const size = fs.fstatSync(fd).size, n = Math.min(tail.length, size);
    fs.readSync(fd, tail, 0, n, size - n);
    for (let i = n - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) !== 0x06054b50) continue;
      const count = tail.readUInt16LE(i + 10), cdAt = tail.readUInt32LE(i + 16);
      const map = new Map();
      let p = cdAt;
      for (let k = 0; k < count; k++) {
        const h = Buffer.alloc(46);
        fs.readSync(fd, h, 0, 46, p);
        if (h.readUInt32LE(0) !== 0x02014b50) break;
        const nameLen = h.readUInt16LE(28), extraLen = h.readUInt16LE(30), commentLen = h.readUInt16LE(32);
        const nb = Buffer.alloc(nameLen);
        fs.readSync(fd, nb, 0, nameLen, p + 46);
        map.set(nb.toString('utf8'), {
          mode: (h.readUInt32LE(38) >>> 16) & 0xffff, size: h.readUInt32LE(24),
          csize: h.readUInt32LE(20), method: h.readUInt16LE(10), at: h.readUInt32LE(42),
        });
        p += 46 + nameLen + extraLen + commentLen;
      }
      return map;
    }
    throw new Error('不是 zip 文件：' + file);
  } finally {
    fs.closeSync(fd);
  }
}

/** 读 zip 里一个（小）条目的内容——软链接的目标路径就存在这里 */
export function zipEntryData(file, info) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = Buffer.alloc(30);
    fs.readSync(fd, h, 0, 30, info.at);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 本地头损坏');
    const off = info.at + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    const raw = Buffer.alloc(info.csize);
    fs.readSync(fd, raw, 0, info.csize, off);
    return info.method === 8 ? zlib.inflateRawSync(raw) : raw;
  } finally {
    fs.closeSync(fd);
  }
}
