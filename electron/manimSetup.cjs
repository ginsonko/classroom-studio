'use strict';
// manim 一键安装：全部装进数据目录 tools/manim，不改系统环境、不碰老师自己装的 Python。
// Windows：Python 官方的「嵌入式」便携包（11 MB）+ pip，再从国内 PyPI 镜像装 manim（约 380 MB，3~5 分钟）。
// macOS：没有便携包，用系统的 python3 建一个虚拟环境再装。
// manim 0.18 起用 PyAV 自带的 ffmpeg 库写视频，不需要另装 ffmpeg；公式（MathTex）要 LaTeX，太大不装，没有时用普通文字。
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { fastGet } = require('./fastget.cjs');

const PY = { version: '3.12.10', file: 'python-3.12.10-embed-amd64.zip', size: 11133606, sha256: '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3' };
const PY_URLS = [
  `https://mirrors.huaweicloud.com/python/${PY.version}/${PY.file}`,
  `https://registry.npmmirror.com/-/binary/python/${PY.version}/${PY.file}`,
  `https://www.python.org/ftp/python/${PY.version}/${PY.file}`,
];
const PIP = { file: 'pip-25.3-py3-none-any.whl', path: 'packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl', size: 1778622, sha256: '9655943313a94722b7774661c21049070f6bbb0a1516bf02f7c8d5d9201514cd' };
// 国内 PyPI 镜像（simple 索引 + 包文件前缀）；安装前逐个测速，用最快的，失败换下一个
const MIRRORS = [
  { name: '腾讯云', simple: 'https://mirrors.cloud.tencent.com/pypi/simple/', files: 'https://mirrors.cloud.tencent.com/pypi/' },
  { name: '阿里云', simple: 'https://mirrors.aliyun.com/pypi/simple/', files: 'https://mirrors.aliyun.com/pypi/' },
  { name: '华为云', simple: 'https://repo.huaweicloud.com/repository/pypi/simple/', files: 'https://repo.huaweicloud.com/repository/pypi/' },
  { name: '中科大', simple: 'https://mirrors.ustc.edu.cn/pypi/simple/', files: 'https://mirrors.ustc.edu.cn/pypi/' },
  { name: '清华', simple: 'https://pypi.tuna.tsinghua.edu.cn/simple/', files: 'https://pypi.tuna.tsinghua.edu.cn/' },
  { name: 'PyPI 官方', simple: 'https://pypi.org/simple/', files: 'https://files.pythonhosted.org/' },
];
const NEED_MB = 1200;
// 一次 manim 安装大约拉 35 个包，用来估算进度
const PACKAGES = 35;
const NET_ERROR = /ReadTimeout|ConnectTimeout|ConnectionError|Connection (?:reset|aborted|refused)|SSLError|ProxyError|HTTPError|HTTP error \d+|Could not fetch URL|No matching distribution|Max retries exceeded|IncompleteRead|THESE PACKAGES DO NOT MATCH THE HASHES/i;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

class ManimSetup {
  /** @param {{dir:string, fetch:Function, log?:any, emit?:(s:object)=>void, test?:boolean, mirrors?:typeof MIRRORS, pyUrls?:string[], pip?:typeof PIP, py?:typeof PY}} o */
  constructor(o) {
    this.dir = o.dir; this.fetch = o.fetch; this.log = o.log; this.emit = o.emit || (() => {});
    this.mirrors = o.mirrors || MIRRORS; this.pyUrls = o.pyUrls || PY_URLS; this.pipInfo = o.pip || PIP; this.py = o.py || PY;
    this.state = { phase: 'idle', step: '', pct: 0, lines: [] };
    this.child = null; this.abort = null; this.cancelled = false;
  }

  /** 装好的 Python（装完才写 ok.json，装到一半的不算） */
  python() {
    try {
      const ok = JSON.parse(fs.readFileSync(path.join(this.dir, 'ok.json'), 'utf8'));
      return ok && ok.python && fs.existsSync(ok.python) ? ok.python : null;
    } catch { return null; }
  }
  view() { return { ...this.state, lines: this.state.lines.slice(-40), installed: !!this.python(), platform: process.platform }; }

  set(p) {
    if (p.line) { this.state.lines = [...this.state.lines, p.line].slice(-200); delete p.line; }
    Object.assign(this.state, p);
    this.emit(this.view());
  }
  say(step, pct) { this.set({ step, pct, line: step }); this.log?.info?.('manim 安装', step); }

  /** 开始安装（已在装时直接返回当前状态）；进度通过 emit 推给界面 */
  install() {
    if (this.state.phase === 'running') return this.view();
    this.cancelled = false;
    this.state = { phase: 'running', step: '准备安装', pct: 0, lines: [], started: Date.now() };
    this.emit(this.view());
    this.run().then(
      (version) => this.set({ phase: 'done', step: `安装完成：manim ${version}`, pct: 100, line: `安装完成：manim ${version}` }),
      (e) => { this.log?.warn?.('manim 安装失败', e.message); this.set({ phase: this.cancelled ? 'idle' : 'error', step: this.cancelled ? '已取消安装' : e.message, error: this.cancelled ? '' : e.message, line: (this.cancelled ? '已取消安装' : '失败：' + e.message) }); },
    );
    return this.view();
  }
  cancel() {
    if (this.state.phase !== 'running') return false;
    this.cancelled = true; this.abort?.abort(); killTree(this.child);
    return true;
  }
  async uninstall() {
    if (this.state.phase === 'running') throw Error('正在安装，先取消再删除');
    await fs.promises.rm(this.dir, { recursive: true, force: true, maxRetries: 3 });
    this.state = { phase: 'idle', step: '', pct: 0, lines: [] };
    return this.view();
  }

  check() { if (this.cancelled) throw Error('已取消'); }

  async run() {
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.rm(path.join(this.dir, 'ok.json'), { force: true });
    try {
      const st = await fs.promises.statfs(this.dir);
      const free = st.bavail * st.bsize / 1048576;
      if (free < NEED_MB) throw Error(`数据目录所在的磁盘只剩 ${Math.round(free)} MB，安装 manim 需要约 ${NEED_MB} MB`);
    } catch (e) { if (/磁盘/.test(e.message)) throw e; }
    const python = process.platform === 'win32' ? await this.portable() : await this.venv();
    this.check();
    let mirror = await this.pickMirror();
    this.check();
    if (process.platform === 'win32') {
      // 嵌入式 Python 读不到「隔离构建环境」里的包：先装好构建工具，manim 依赖里只有纯 Python 的 srt 需要现场打包
      this.say('安装打包工具（setuptools）', 20);
      mirror = await this.pipInstall(python, ['setuptools', 'wheel'], mirror, 20, 22);
    }
    this.say(`从${mirror.name}镜像下载并安装 manim（约 380 MB，通常 3~5 分钟）`, 22);
    mirror = await this.pipInstall(python, ['manim'], mirror, 22, 94, process.platform === 'win32' ? ['--no-build-isolation'] : []);
    this.check();
    this.say('检查 manim 能不能运行', 96);
    const v = await this.exec(python, ['-m', 'manim', '--version'], { timeout: 120000 });
    const version = /Manim Community v?([\d.]+)/i.exec(v.out)?.[1];
    if (!version) throw Error('manim 装好了但运行不起来：' + v.out.trim().split('\n').slice(-3).join(' / '));
    await fs.promises.writeFile(path.join(this.dir, 'ok.json'), JSON.stringify({ python, version, mirror: mirror.name, at: new Date().toISOString() }, null, 2));
    await fs.promises.rm(path.join(this.dir, 'download'), { recursive: true, force: true }).catch(() => {});
    return version;
  }

  /** Windows：下载便携 Python，打开 site-packages，用 pip 的 wheel 自举出 pip */
  async portable() {
    const dl = path.join(this.dir, 'download'), py = path.join(this.dir, 'python');
    await fs.promises.mkdir(dl, { recursive: true });
    this.say(`下载 Python ${this.py.version} 便携版（11 MB）`, 1);
    const zip = path.join(dl, this.py.file);
    await this.get(this.pyUrls, this.py, zip, 1, 9);
    this.say('解压 Python', 10);
    await fs.promises.rm(py, { recursive: true, force: true, maxRetries: 3 });
    await fs.promises.mkdir(py, { recursive: true });
    // Windows 10 起自带 tar（bsdtar），能解 zip；-m 不还原文件时间（还原失败会让退出码非 0）
    const t = await this.exec('tar', ['-xmf', zip, '-C', py], { timeout: 120000 });
    const exe = path.join(py, 'python.exe');
    if (!fs.existsSync(exe)) throw Error('Python 解压失败：' + t.out.trim().slice(-200));
    const pth = fs.readdirSync(py).find((f) => /^python\d+\._pth$/.test(f));
    if (!pth) throw Error('Python 便携包里缺少 ._pth 文件');
    const zipName = fs.readdirSync(py).find((f) => /^python\d+\.zip$/.test(f)) || 'python312.zip';
    await fs.promises.writeFile(path.join(py, pth), [zipName, '.', 'Lib\\site-packages', 'import site', ''].join('\r\n'));
    this.check();
    this.say('下载 pip', 12);
    const whl = path.join(dl, this.pipInfo.file);
    await this.get(this.mirrors.map((m) => m.files + this.pipInfo.path), this.pipInfo, whl, 12, 14);
    this.say('安装 pip', 15);
    // 不能直接 python pip.whl/pip：pip 发现 argv[0] 叫 pip 会拒绝「修改自己」，用 runpy 绕过去
    const boot = `import sys,runpy;sys.path.insert(0,${JSON.stringify(whl)});sys.argv=['pip','install','--no-index','--no-warn-script-location',${JSON.stringify(whl)}];runpy.run_module('pip',run_name='__main__',alter_sys=True)`;
    const r = await this.exec(exe, ['-c', boot], { timeout: 180000 });
    if (!/Successfully installed pip/i.test(r.out)) throw Error('pip 安装失败：' + r.out.trim().split('\n').slice(-3).join(' / '));
    return exe;
  }

  /** macOS / Linux：系统 python3（3.9 以上）建虚拟环境 */
  async venv() {
    const v = await this.exec('python3', ['--version'], { timeout: 30000 }).catch(() => ({ out: '' }));
    const m = /Python 3\.(\d+)/.exec(v.out);
    if (!m || Number(m[1]) < 9) throw Error('没有找到 Python 3.9 以上版本。请先从 python.org 安装 Python 3，再点一键安装');
    this.say('创建独立的 Python 环境', 8);
    const env = path.join(this.dir, 'venv');
    await fs.promises.rm(env, { recursive: true, force: true });
    const r = await this.exec('python3', ['-m', 'venv', env], { timeout: 180000 });
    const exe = path.join(env, 'bin', 'python');
    if (!fs.existsSync(exe)) throw Error('创建 Python 环境失败：' + r.out.trim().slice(-200));
    return exe;
  }

  /** 逐个镜像取 manim 的索引页，按响应时间排序 */
  async pickMirror() {
    this.say('测试 PyPI 镜像速度', 17);
    const probe = async (m) => {
      const t0 = Date.now();
      try {
        const r = await this.fetch(m.simple + 'manim/', { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'pip/25.3' } });
        const body = r.ok ? await r.text() : '';
        return /manim-\d/.test(body) ? { m, ms: Date.now() - t0 } : null;
      } catch { return null; }
    };
    const res = (await Promise.all(this.mirrors.map(probe))).filter(Boolean).sort((a, b) => a.ms - b.ms);
    if (!res.length) throw Error('连不上任何 PyPI 镜像，请检查网络后重试');
    this.order = res.map((x) => x.m);
    this.set({ line: '可用镜像：' + res.map((x) => `${x.m.name} ${x.ms}ms`).join('，') });
    return res[0].m;
  }

  /** pip install；网络类错误换下一个镜像再试（最多 3 个）。返回实际装成功的镜像 */
  async pipInstall(python, pkgs, first, p0, p1, extra = []) {
    const order = [first, ...(this.order || []).filter((m) => m !== first)].slice(0, 3);
    let last = '', net = false;
    for (const m of order) {
      this.check();
      let seen = 0;
      // 下载占这一段的大头，剩下的留给解压安装；换镜像重试时进度不往回走
      const dlEnd = p0 + (p1 - p0) * 0.88, pct = (v) => Math.max(this.state.pct, v);
      const onLine = (l) => {
        if (/^(Collecting|Downloading|Installing collected|Successfully|Building|Using cached)/.test(l.trim())) this.set({ line: l.trim().slice(0, 160) });
        if (/^Collecting /.test(l.trim())) { seen++; this.set({ pct: pct(p0 + (dlEnd - p0) * Math.min(1, seen / PACKAGES)) }); }
        if (/^Installing collected packages/.test(l.trim())) this.set({ step: '安装下载好的包' + (p1 - p0 > 10 ? '（解压大约要 1 分钟）' : ''), pct: pct(dlEnd) });
      };
      const args = ['-m', 'pip', 'install', ...pkgs, '-i', m.simple, '--prefer-binary', '--no-cache-dir', '--no-warn-script-location', '--disable-pip-version-check', '--progress-bar', 'off', '--timeout', '30', '--retries', '3', ...extra];
      const r = await this.exec(python, args, { timeout: 30 * 60000, onLine });
      if (r.code === 0) return m;
      this.check();
      last = r.out.trim().split('\n').filter((l) => /error|Error/.test(l)).slice(-4).join(' / ') || r.out.trim().split('\n').slice(-3).join(' / ');
      if (process.platform === 'darwin' && /pkg-config|cairo/i.test(r.out)) throw Error('macOS 上还需要 cairo：先安装 Homebrew，在终端运行 brew install cairo pkg-config，然后再点一键安装');
      net = NET_ERROR.test(r.out);
      this.set({ line: `${m.name}镜像出错：${last.slice(0, 300)}` });
      if (!net) break;
      if (m !== order.at(-1)) this.set({ line: `换下一个镜像重试` });
    }
    // 原始报错已经写进安装记录，界面上给老师看一句能看懂的
    throw Error(net ? '从 PyPI 镜像下载失败（网络不稳定或镜像暂时出错），稍后点「重试安装」再试' : 'pip 安装出错：' + last.slice(0, 200));
  }

  async get(urls, info, file, p0, p1) {
    this.abort = new AbortController();
    try {
      await fastGet({ urls, size: info.size, sha256: info.sha256, file, fetch: this.fetch, signal: this.abort.signal, log: this.log, proxies: [], conns: 4, onBytes: (n) => this.set({ pct: p0 + (p1 - p0) * Math.min(1, n / info.size) }) });
    } catch (e) {
      this.check();
      this.set({ line: '下载出错：' + String(e.message).slice(0, 400) });
      throw Error(`下载 ${path.basename(file)} 失败（网络不稳定或下载站暂时出错），稍后点「重试安装」再试`);
    } finally { this.abort = null; }
    this.check();
  }

  /** 运行一个命令，逐行回调输出；不受老师自己的 pip 配置、PYTHONPATH 影响 */
  exec(cmd, args, { timeout = 60000, onLine } = {}) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PIP_NO_INPUT: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
      for (const k of ['PYTHONHOME', 'PYTHONPATH', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'PIP_REQUIRE_VIRTUALENV', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete env[k];
      let child;
      try { child = spawn(cmd, args, { cwd: this.dir, windowsHide: true, env, detached: process.platform !== 'win32' }); }
      catch (e) { reject(e); return; }
      this.child = child;
      let out = '', buf = '';
      const take = (d) => {
        const s = d.toString('utf8'); out = (out + s).slice(-60000); buf += s;
        const parts = buf.split(/\r?\n/); buf = parts.pop();
        for (const l of parts) if (l.trim()) onLine?.(l);
      };
      child.stdout.on('data', take); child.stderr.on('data', take);
      const timer = setTimeout(() => { out += '\n超时'; killTree(child); }, timeout);
      child.on('error', (e) => { clearTimeout(timer); this.child = null; reject(Error(`运行 ${path.basename(cmd)} 失败：${e.message}`)); });
      child.on('close', (code) => { clearTimeout(timer); this.child = null; if (buf.trim()) onLine?.(buf); resolve({ code, out }); });
    });
  }
}

module.exports = { ManimSetup, MIRRORS, PY, PIP };
