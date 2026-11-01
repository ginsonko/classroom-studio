'use strict';
// 语音转写组件：sherpa-onnx 的 Node 原生扩展 + SenseVoice 识别模型 + silero 静音检测模型，约 250 MB。
// 安装包里自带一份（bin/asr，老师不用再下载）；开发版或安装包里没有时，第一次要用时下载到数据目录 tools/asr，装完才写 ok.json，装到一半的不算。
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { fastGet } = require('./fastget.cjs');

const VERSION = '2.0.1';
const npm = (name) => [
  `https://registry.npmmirror.com/${name}/-/${name}-${VERSION}.tgz`,
  `https://mirrors.huaweicloud.com/repository/npm/${name}/-/${name}-${VERSION}.tgz`,
  `https://registry.npmjs.org/${name}/-/${name}-${VERSION}.tgz`,
];
const hf = (file) => ['hf-mirror.com', 'huggingface.co'].map((h) => `https://${h}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/${file}`);
const JS = { name: 'sherpa-onnx-node', size: 12709, sha256: '06ef8dfb9ea0f3cc77c1866620cbe05bf11b7dd70a973a454b77ce4a66cbcee1' };
const NATIVE = {
  'win32-x64': { name: 'sherpa-onnx-win-x64', size: 8779375, sha256: '217cec234c6026dbfd2b9c06523507180796fe4227c7cc9d11cfe218260a2519' },
  'darwin-arm64': { name: 'sherpa-onnx-darwin-arm64', size: 10013200, sha256: 'afc9415260e232c4dadc25a29a8645acb0ba06ef989060d32274f4c749a4830e' },
  'darwin-x64': { name: 'sherpa-onnx-darwin-x64', size: 11167483, sha256: 'e95e4addd3d02919ae61f311effd6e5349e00b50985c4a8c9a3bcb03dc6d6325' },
};
const MODELS = [
  { file: 'model.int8.onnx', size: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51', urls: hf('model.int8.onnx'), label: '语音识别模型（228 MB）' },
  { file: 'tokens.txt', size: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc', urls: hf('tokens.txt'), label: '识别词表' },
  { file: 'silero_vad.onnx', size: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', urls: ['https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx'], label: '静音检测模型' },
];
const ENGINE = 'sensevoice-int8-2024-07-17';
const NEED_MB = 600;

/** 这台电脑要下载的全部文件：先小后大，网络不通时尽早报错 */
function plan(platform = process.platform + '-' + process.arch) {
  const native = NATIVE[platform];
  if (!native) return null;
  return [
    { ...JS, kind: 'npm', file: JS.name + '.tgz', urls: npm(JS.name), label: '识别程序' },
    { ...native, kind: 'npm', file: native.name + '.tgz', urls: npm(native.name), label: `识别程序的本机组件（${Math.round(native.size / 1048576)} MB）` },
    ...MODELS.slice().reverse().map((m) => ({ ...m, kind: 'model' })),
  ];
}

class AsrSetup {
  /**
   * @param {{dir:string, bundled?:string, fetch:Function, log?:any, emit?:(s:object)=>void, verify?:(paths:object)=>Promise<void>, files?:object[], platform?:string, proxies?:string[]}} o
   * verify：装好后试着加载一次识别模型，加载不了就不算装好
   */
  constructor(o) {
    this.dir = o.dir; this.bundled = o.bundled; this.fetch = o.fetch; this.log = o.log; this.emit = o.emit || (() => {}); this.verify = o.verify;
    this.platform = o.platform || process.platform + '-' + process.arch;
    this.files = o.files || plan(this.platform);
    this.proxies = o.proxies;
    this.state = { phase: 'idle', step: '', pct: 0, lines: [] };
    this.abort = null; this.cancelled = false;
  }

  get total() { return (this.files || []).reduce((a, f) => a + f.size, 0); }

  /** 安装包自带的组件（文件齐、模型大小对得上才算）；软件运行期间不会变，查到一次就记住 */
  bundledPaths() {
    if (this.bundledHit !== undefined) return this.bundledHit;
    let hit = null;
    try {
      const native = NATIVE[this.platform], addonDir = path.join(this.bundled, 'node_modules'), modelDir = path.join(this.bundled, 'models');
      if (this.bundled && native && fs.existsSync(path.join(addonDir, 'sherpa-onnx-node', 'package.json')) && fs.existsSync(path.join(addonDir, native.name, 'package.json'))
        && MODELS.every((m) => fs.statSync(path.join(modelDir, m.file), { throwIfNoEntry: false })?.size === m.size)) hit = { addonDir, modelDir, engine: ENGINE, bundled: true };
    } catch { hit = null; }
    return (this.bundledHit = hit);
  }

  /** 能用的组件路径（先用安装包自带的）；都没有返回 null */
  paths() {
    const own = this.bundledPaths();
    if (own) return own;
    try {
      const ok = JSON.parse(fs.readFileSync(path.join(this.dir, 'ok.json'), 'utf8'));
      const addonDir = ok.addonDir || path.join(this.dir, 'node_modules'), modelDir = ok.modelDir || path.join(this.dir, 'models');
      if (!fs.existsSync(path.join(addonDir, 'sherpa-onnx-node'))) return null;
      if (!MODELS.every((m) => fs.existsSync(path.join(modelDir, m.file)))) return null;
      return { addonDir, modelDir, engine: ok.engine || ENGINE };
    } catch { return null; }
  }
  view() {
    return { ...this.state, lines: this.state.lines.slice(-40), installed: !!this.paths(), bundled: !!this.bundledPaths(), supported: !!this.files, platform: this.platform, mb: Math.round(this.total / 1048576) };
  }

  set(p) {
    if (p.line) { this.state.lines = [...this.state.lines, p.line].slice(-200); delete p.line; }
    Object.assign(this.state, p);
    this.emit(this.view());
  }
  say(step, pct) { this.set({ step, pct, line: step }); this.log?.info?.('语音组件', step); }

  install() {
    if (this.state.phase === 'running' || this.bundledPaths()) return this.view();
    this.cancelled = false;
    this.state = { phase: 'running', step: '准备下载', pct: 0, lines: [], started: Date.now() };
    this.emit(this.view());
    this.run().then(
      () => this.set({ phase: 'done', step: '语音组件装好了', pct: 100, line: '语音组件装好了' }),
      (e) => { this.log?.warn?.('语音组件安装失败', e.message); this.set({ phase: this.cancelled ? 'idle' : 'error', step: this.cancelled ? '已取消下载' : e.message, error: this.cancelled ? '' : e.message, line: this.cancelled ? '已取消下载' : '失败：' + e.message }); },
    );
    return this.view();
  }
  cancel() {
    if (this.state.phase !== 'running') return false;
    this.cancelled = true; this.abort?.abort();
    return true;
  }
  async uninstall() {
    if (this.state.phase === 'running') throw Error('正在下载，先取消再删除');
    if (this.bundledPaths()) throw Error('语音组件是安装包自带的，不能单独删除');
    await fs.promises.rm(this.dir, { recursive: true, force: true, maxRetries: 3 });
    this.state = { phase: 'idle', step: '', pct: 0, lines: [] };
    return this.view();
  }
  check() { if (this.cancelled) throw Error('已取消'); }

  async run() {
    if (!this.files) throw Error('这台电脑的系统暂时不支持本地语音转写');
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.rm(path.join(this.dir, 'ok.json'), { force: true });
    try {
      const st = await fs.promises.statfs(this.dir);
      const free = st.bavail * st.bsize / 1048576;
      if (free < NEED_MB) throw Error(`数据目录所在的磁盘只剩 ${Math.round(free)} MB，语音组件需要约 ${NEED_MB} MB`);
    } catch (e) { if (/磁盘/.test(e.message)) throw e; }
    const dl = path.join(this.dir, 'download'), mods = path.join(this.dir, 'node_modules'), models = path.join(this.dir, 'models');
    await fs.promises.mkdir(dl, { recursive: true });
    await fs.promises.mkdir(models, { recursive: true });
    const total = this.total;
    let before = 0;
    for (const f of this.files) {
      this.check();
      const p0 = 2 + 90 * before / total, p1 = 2 + 90 * (before + f.size) / total;
      const target = f.kind === 'model' ? path.join(models, f.file) : null;
      // 模型已经下过（上次装到一半失败）就不再下：大小对上再算一遍哈希
      if (target && await sameFile(target, f)) { this.set({ line: `已有${f.label}，跳过下载`, pct: p1 }); before += f.size; continue; }
      this.say(`下载${f.label}`, p0);
      const file = path.join(dl, f.file);
      await this.get(f, file, p0, p1);
      if (f.kind === 'npm') {
        this.check();
        const out = path.join(dl, 'x-' + f.name);
        await fs.promises.rm(out, { recursive: true, force: true });
        await fs.promises.mkdir(out, { recursive: true });
        const r = await tar(['-xzf', file, '-C', out]);
        if (!fs.existsSync(path.join(out, 'package', 'package.json'))) throw Error('解压识别程序失败：' + r.slice(-200));
        await fs.promises.mkdir(mods, { recursive: true });
        await fs.promises.rm(path.join(mods, f.name), { recursive: true, force: true, maxRetries: 3 });
        await fs.promises.rename(path.join(out, 'package'), path.join(mods, f.name));
      } else {
        await fs.promises.rm(target, { force: true });
        await fs.promises.rename(file, target);
      }
      before += f.size;
    }
    this.check();
    this.say('试着加载一次识别模型', 94);
    const paths = { addonDir: mods, modelDir: models, engine: ENGINE };
    if (this.verify) await this.verify(paths).catch((e) => { throw Error('语音组件下载好了，但是在这台电脑上运行不起来：' + e.message); });
    await fs.promises.writeFile(path.join(this.dir, 'ok.json'), JSON.stringify({ ...paths, version: VERSION, platform: this.platform, at: new Date().toISOString() }, null, 2));
    await fs.promises.rm(dl, { recursive: true, force: true }).catch(() => {});
  }

  async get(f, file, p0, p1) {
    this.abort = new AbortController();
    const once = (urls, proxies) => fastGet({ urls, size: f.size, sha256: f.sha256, file, fetch: this.fetch, signal: this.abort.signal, log: this.log, proxies, conns: 6, onBytes: (n) => this.set({ pct: Math.max(this.state.pct, p0 + (p1 - p0) * Math.min(1, n / f.size)) }) });
    try {
      try { await once(f.urls, this.proxies); }
      catch (e) {
        // 多条线路一起下时，只要有一条给的内容是错的整个文件就校验不过；这时一条一条单独再试
        this.check();
        this.set({ line: '下载出错：' + String(e.message).slice(0, 400) + '；换成逐条线路再试' });
        let done = false;
        for (const u of f.urls) {
          this.check();
          try { await once([u], []); done = true; break; } catch (e2) { this.check(); this.set({ line: '线路出错：' + String(e2.message).slice(0, 200) }); }
        }
        if (!done) throw e;
      }
    } catch (e) {
      this.check();
      throw Error(`下载${f.label}失败（网络不稳定或下载站暂时出错），稍后点「重试」再试`);
    } finally { this.abort = null; }
    this.check();
  }
}

async function sameFile(file, f) {
  try {
    if ((await fs.promises.stat(file)).size !== f.size) return false;
    const { shaFile } = require('./fastget.cjs');
    return (await shaFile(file)) === f.sha256;
  } catch { return false; }
}

/** Windows 10 起自带 tar（bsdtar），macOS 也有；-m 不还原文件时间 */
function tar(args) {
  return new Promise((resolve) => execFile('tar', ['-m', ...args], { windowsHide: true, timeout: 120000 }, (err, out, errOut) => resolve(String(out || '') + String(errOut || '') + (err ? String(err.message) : ''))));
}

module.exports = { AsrSetup, plan, MODELS, NATIVE, JS, ENGINE, VERSION };
