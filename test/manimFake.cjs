// 一键安装 manim 的离线测试环境：本机起一个假的 PyPI 镜像 + Python 下载站。
// Python 便携包和 pip 用真的（第一次从国内镜像下载后缓存在 .out/cache），manim / setuptools / wheel 换成几 KB 的假包：
// `python -m manim --version` 会打印 "Manim Community v0.22.0"，render 时生成一个很小的假 mp4（够测流程）。
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const crypto = require('node:crypto');
const JSZip = require('jszip');
const { PY, PIP } = require('../electron/manimSetup.cjs');

const CACHE = path.join(__dirname, '../.out/cache');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function cached(file, urls, want) {
  fs.mkdirSync(CACHE, { recursive: true });
  const p = path.join(CACHE, file);
  if (fs.existsSync(p) && sha(fs.readFileSync(p)) === want) return fs.readFileSync(p);
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) continue;
      const b = Buffer.from(await r.arrayBuffer());
      if (sha(b) !== want) continue;
      fs.writeFileSync(p, b); return b;
    } catch {}
  }
  throw Error('下载测试用的 ' + file + ' 失败');
}

async function wheel(name, version, files) {
  const z = new JSZip(), di = `${name}-${version}.dist-info`;
  for (const [f, s] of Object.entries(files)) z.file(f, s);
  z.file(`${di}/METADATA`, `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`);
  z.file(`${di}/WHEEL`, 'Wheel-Version: 1.0\nGenerator: classroom-studio-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n');
  z.file(`${di}/RECORD`, [...Object.keys(files), `${di}/METADATA`, `${di}/WHEEL`, `${di}/RECORD`].map((f) => f + ',,').join('\n') + '\n');
  return { file: `${name}-${version}-py3-none-any.whl`, data: await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) };
}

const MAIN = `import sys
if '--version' in sys.argv:
    print('Manim Community v0.22.0')
    sys.exit(0)
print('fake manim: rendering is not supported', file=sys.stderr)
sys.exit(1)
`;

/** o.fail：这些镜像的包文件返回 500（测换镜像）；o.slow：这些镜像的索引页慢 300ms；o.slowPy：Python 包慢慢传（测取消） */
async function fakeMirror(o = {}) {
  const py = await cached(PY.file, [`https://mirrors.huaweicloud.com/python/${PY.version}/${PY.file}`, `https://registry.npmmirror.com/-/binary/python/${PY.version}/${PY.file}`, `https://www.python.org/ftp/python/${PY.version}/${PY.file}`], PY.sha256);
  const pip = await cached(PIP.file, ['https://mirrors.cloud.tencent.com/pypi/' + PIP.path, 'https://mirrors.aliyun.com/pypi/' + PIP.path, 'https://files.pythonhosted.org/' + PIP.path], PIP.sha256);
  const pkgs = {
    manim: await wheel('manim', '0.22.0', { 'manim/__init__.py': '__version__ = "0.22.0"\n', 'manim/__main__.py': MAIN }),
    setuptools: await wheel('setuptools', '80.0.0', { 'setuptools_fake/__init__.py': '' }),
    wheel: await wheel('wheel', '0.45.0', { 'wheel_fake/__init__.py': '' }),
  };
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]); hits.push(u);
    const send = (code, body, type = 'application/octet-stream') => { res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) }); res.end(body); };
    if (u === '/py/' + PY.file) {
      if (!o.slowPy) return send(200, py);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': py.length });
      let at = 0; const t = setInterval(() => { if (res.destroyed || at >= py.length) { clearInterval(t); res.end(); return; } res.write(py.subarray(at, at + 16384)); at += 16384; }, 200);
      req.on('close', () => clearInterval(t));
      return;
    }
    const m = /^\/m\/(\w+)\/(.*)$/.exec(u);
    if (!m) return send(404, 'not found', 'text/plain');
    const [, mirror, rest] = m;
    const page = /^simple\/([\w-]+)\/$/.exec(rest);
    if (page) {
      const p = pkgs[page[1]];
      const go = () => (p ? send(200, `<!DOCTYPE html><html><body><a href="../../packages/${p.file}#sha256=${sha(p.data)}">${p.file}</a></body></html>`, 'text/html') : send(404, 'no such package', 'text/plain'));
      if (o.slow?.includes(mirror)) setTimeout(go, 300); else go();
      return;
    }
    if (rest.endsWith(PIP.file)) return send(200, pip);
    if ((o.fail || []).includes(mirror)) return send(500, 'Internal Server Error', 'text/plain');
    const f = Object.values(pkgs).find((p) => rest === 'packages/' + p.file);
    return f ? send(200, f.data) : send(404, 'not found', 'text/plain');
  });
  await new Promise((r) => server.listen(o.port || 0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, hits, server, mirror: (name, id) => fakeUrls(base).mirror(name, id), pyUrls: fakeUrls(base).pyUrls, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

/** 服务器还没起来时就要用的地址（桌面测试要在启动程序前写进环境变量） */
function fakeUrls(base) {
  return {
    mirror: (name, id) => ({ name, simple: `${base}/m/${id}/simple/`, files: `${base}/m/${id}/` }),
    pyUrls: [`${base}/py/missing.zip`, `${base}/py/${PY.file}`],
  };
}

module.exports = { fakeMirror, fakeUrls, CACHE };
