'use strict';
// 不靠 Windows 上 PowerPoint / WPS 自动化时，把 PPT / Word / RTF 课件变成可显示的页面（macOS 主要走这里）。
// 依次尝试，前一种不可用或失败就换下一种：
//   1. LibreOffice（装了才用）：命令行静默转 PDF，什么格式都认
//   2. 内置排版（office.html 隐藏页）：PPTX → 逐页图片 + 每页文字；DOCX / RTF → PDF。文件里有图表时排到本机软件后面
//   3. macOS 本机软件：Keynote / Pages（苹果免费）、Microsoft PowerPoint / Word，用 AppleScript 导出 PDF
//   4. macOS 自带 textutil：老 .doc 至少保住文字和基本格式
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const MAC = process.platform === 'darwin';
const SLIDES = ['.ppt', '.pptx'];
const WORD = ['.doc', '.docx', '.rtf'];

function run(cmd, args, timeout, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(label + ' 超时没有完成')); }, timeout);
    child.stdout.on('data', (v) => { out = (out + v).slice(-4000); });
    child.stderr.on('data', (v) => { out = (out + v).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error((out.trim() || label + ' 退出代码 ' + code).slice(-300))); });
  });
}

/**
 * 关掉隐藏窗口并等它真正关完。直接 destroy() 沙盒页面后，同一个 session 下一个窗口加载 studio:// 页面会 ERR_FAILED，
 * 第二次转换 / 导出就失败了。
 */
function closeWindow(w) {
  if (!w || w.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { if (!w.isDestroyed()) w.destroy(); resolve(); }, 3000);
    w.once('closed', () => { clearTimeout(t); resolve(); });
    w.close();
  });
}

function findApp(name) {
  if (!MAC) return null;
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications']) {
    const p = path.join(dir, name + '.app');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findLibreOffice() {
  const candidates = MAC
    ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(os.homedir(), 'Applications/LibreOffice.app/Contents/MacOS/soffice')]
    : process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')]
      : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 每段 AppleScript 的参数：源文件、目标 PDF。没开着的软件用完就退出，开着的只关这一份文档
const SCRIPTS = {
  Keynote: [
    'on run argv',
    'set src to POSIX file (item 1 of argv)',
    'set dst to POSIX file (item 2 of argv)',
    'set wasRunning to application "Keynote" is running',
    'tell application "Keynote"',
    'set d to open src',
    'export d to dst as PDF',
    'close d saving no',
    'if not wasRunning then quit',
    'end tell',
    'end run',
  ],
  Pages: [
    'on run argv',
    'set src to POSIX file (item 1 of argv)',
    'set dst to POSIX file (item 2 of argv)',
    'set wasRunning to application "Pages" is running',
    'tell application "Pages"',
    'set d to open src',
    'export d to dst as PDF',
    'close d saving no',
    'if not wasRunning then quit',
    'end tell',
    'end run',
  ],
  'Microsoft PowerPoint': [
    'on run argv',
    'set src to POSIX file (item 1 of argv)',
    'set wasRunning to application "Microsoft PowerPoint" is running',
    'tell application "Microsoft PowerPoint"',
    'open src',
    'set p to active presentation',
    'save p in (POSIX file (item 2 of argv)) as save as PDF',
    'close p saving no',
    'if not wasRunning then quit',
    'end tell',
    'end run',
  ],
  'Microsoft Word': [
    'on run argv',
    'set src to POSIX file (item 1 of argv)',
    'set dst to (POSIX file (item 2 of argv)) as string',
    'set wasRunning to application "Microsoft Word" is running',
    'tell application "Microsoft Word"',
    'open src',
    'set d to active document',
    'save as d file name dst file format format PDF',
    'close d saving no',
    'if not wasRunning then quit',
    'end tell',
    'end run',
  ],
};

class OfficeConverter {
  /**
   * @param {{ makeWindow: () => import('electron').BrowserWindow, url: (file: string) => string, log?: { warn: Function } }} o
   *   makeWindow 返回能加载 studio://app/office.html 的离屏窗口；url 把本机文件变成该窗口能读的 lesson:// 地址
   */
  constructor({ makeWindow, url, log }) { this.makeWindow = makeWindow; this.url = url; this.log = log; }

  /** 本机能用的转换方式（按尝试顺序） */
  plan(input, ext) {
    const steps = [], natives = [];
    const libre = findLibreOffice();
    if (libre) steps.push({ name: 'LibreOffice', run: (o) => this.libre(libre, o) });
    if (MAC) {
      for (const app of SLIDES.includes(ext) ? ['Keynote', 'Microsoft PowerPoint'] : ['Pages', 'Microsoft Word']) {
        if (findApp(app)) natives.push({ name: app, run: (o) => this.appleScript(app, o) });
      }
    }
    const builtin = ext === '.pptx' ? { name: '内置排版', run: (o) => this.builtinSlides(o) }
      : ext === '.docx' || ext === '.rtf' ? { name: '内置排版', run: (o) => this.builtinDoc(o, ext) } : null;
    // 内置排版画不出图表：文件里有图表、本机又有 Keynote 等软件时，先让本机软件转
    const charts = builtin && natives.length && hasCharts(input, ext);
    if (builtin && !charts) steps.push(builtin);
    steps.push(...natives);
    if (builtin && charts) steps.push(builtin);
    if (MAC && WORD.includes(ext) && fs.existsSync('/usr/bin/textutil')) steps.push({ name: 'textutil', run: (o) => this.textutil(o) });
    return steps;
  }

  /**
   * 转换一份课件，返回 { render:'pdf', pdf } 或 { render:'images', images:[{path,w,h}] }（另写 slides/texts.json）。
   * folder 是这份文件专用的缓存目录。
   */
  async convert({ input, ext, folder, progress = () => {} }) {
    const steps = this.plan(input, ext), errors = [];
    for (const step of steps) {
      progress({ stage: 'opening', message: '正在用' + step.name + '转换' });
      try {
        const result = await step.run({ input, folder, progress });
        return { ...result, engine: step.name };
      } catch (e) {
        errors.push(step.name + '：' + String(e?.message || e).slice(0, 200));
        this.log?.warn('课件转换失败，换下一种方式', step.name, path.basename(input), e?.message);
      }
    }
    throw new Error(advice(ext) + (errors.length ? '（已尝试：' + errors.join('；') + '）' : ''));
  }

  /** 用指定的转换方式（和原课件同一种，画面才一致）；没有或失败时换内置排版 */
  async convertWith(engine, { input, ext, folder, progress = () => {} }) {
    const steps = this.plan(input, ext), builtin = steps.find((s) => s.name === '内置排版');
    const step = steps.find((s) => s.name === engine) ?? builtin;
    if (!step) throw new Error('没有可用的转换方式');
    try { return { ...await step.run({ input, folder, progress }), engine: step.name }; }
    catch (e) {
      if (!builtin || builtin === step) throw e;
      this.log?.warn('分步画面转换失败，改用内置排版', step.name, e?.message);
      return { ...await builtin.run({ input, folder, progress }), engine: builtin.name };
    }
  }

  async libre(soffice, { input, folder }) {
    const out = path.join(folder, 'lo');
    await fs.promises.rm(out, { recursive: true, force: true });
    await fs.promises.mkdir(out, { recursive: true });
    const profile = pathToFileURL(path.join(os.tmpdir(), 'classroom-studio-lo-profile')).href;
    await run(soffice, ['-env:UserInstallation=' + profile, '--headless', '--norestore', '--nologo', '--nodefault', '--convert-to', 'pdf', '--outdir', out, input], 180000, 'LibreOffice');
    const made = (await fs.promises.readdir(out)).find((n) => n.toLowerCase().endsWith('.pdf'));
    if (!made) throw new Error('没有生成 PDF');
    return this.keepPdf(path.join(out, made), folder);
  }

  async appleScript(app, { input, folder }) {
    // 微软 Office 是沙盒软件：直接写到本软件的缓存目录会弹「授予访问权限」，先写进它自己的容器目录再搬过来
    const box = { 'Microsoft PowerPoint': 'com.microsoft.Powerpoint', 'Microsoft Word': 'com.microsoft.Word' }[app];
    const boxDir = box && path.join(os.homedir(), 'Library/Containers', box, 'Data/Library/Caches');
    const tmp = boxDir && fs.existsSync(path.dirname(boxDir)) ? path.join(boxDir, `classroom-studio-${process.pid}-${Date.now()}.pdf`) : path.join(folder, 'export.pdf');
    await fs.promises.mkdir(path.dirname(tmp), { recursive: true }).catch(() => {});
    await fs.promises.rm(tmp, { force: true });
    const args = SCRIPTS[app].flatMap((line) => ['-e', line]);
    try { await run('/usr/bin/osascript', [...args, input, tmp], 180000, app); }
    catch (e) {
      // -1743：系统设置里没允许控制这个软件；-600 / -609：软件没能启动
      if (/-1743/.test(e.message)) throw new Error('没有允许控制 ' + app + '（系统设置 → 隐私与安全性 → 自动化）');
      throw e;
    }
    return this.keepPdf(tmp, folder);
  }

  async textutil({ input, folder }) {
    const html = path.join(folder, 'textutil.html');
    await run('/usr/bin/textutil', ['-convert', 'html', '-output', html, input], 120000, 'textutil');
    const w = this.makeWindow();
    try {
      await w.loadURL(this.url(html));
      const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
      const file = path.join(folder, 'document.pdf');
      await fs.promises.writeFile(file, pdf);
      return this.keepPdf(file, folder);
    } finally { await closeWindow(w); }
  }

  async keepPdf(file, folder) {
    const s = await fs.promises.stat(file).catch(() => null);
    if (!s || s.size < 1000) throw new Error('没有生成有效的 PDF');
    const head = Buffer.alloc(1024), h = await fs.promises.open(file, 'r');
    try { await h.read(head, 0, 1024, 0); } finally { await h.close(); }
    if (!head.includes(Buffer.from('%PDF-'))) throw new Error('生成的文件不是 PDF');
    const pdf = path.join(folder, 'document.pdf');
    if (path.resolve(file) !== path.resolve(pdf)) {
      try { await fs.promises.rename(file, pdf); }
      catch { await fs.promises.copyFile(file, pdf); await fs.promises.rm(file, { force: true }); }
    }
    return { render: 'pdf', pdf };
  }

  /** 打开隐藏排版页，返回 [窗口, 调用页面函数] */
  async page() {
    const w = this.makeWindow();
    await w.loadURL('studio://app/office.html');
    for (let i = 0; i < 200 && !(await w.webContents.executeJavaScript('!!window.csOffice')); i++) await new Promise((r) => setTimeout(r, 50));
    const call = (fn, ...a) => w.webContents.executeJavaScript(`window.csOffice.${fn}(${a.map((v) => JSON.stringify(v)).join(',')})`);
    return [w, call];
  }

  async builtinSlides({ input, folder, progress }) {
    const [w, call] = await this.page();
    try {
      const info = await call('slides', this.url(input), 1600);
      if (!info.count) throw new Error('没有可显示的幻灯片');
      w.setContentSize(info.width, Math.max(900, info.height));
      const dir = path.join(folder, 'slides');
      await fs.promises.rm(dir, { recursive: true, force: true });
      await fs.promises.mkdir(dir, { recursive: true });
      const frame = () => new Promise((r) => { const t = setTimeout(r, 500); w.webContents.once('paint', () => { clearTimeout(t); setTimeout(r, 30); }); w.webContents.invalidate(); });
      const images = [], texts = [];
      for (let i = 0; i < info.count; i++) {
        const r = await call('show', i);
        await frame();
        let img = await w.webContents.capturePage({ x: r.x, y: r.y, width: r.w, height: r.h });
        if (img.isEmpty()) throw new Error(`第 ${i + 1} 页截图失败`);
        if (img.getSize().width !== info.width) img = img.resize({ width: info.width, height: info.height, quality: 'best' });
        const file = path.join(dir, `slide-${String(i + 1).padStart(4, '0')}.png`);
        await fs.promises.writeFile(file, img.toPNG());
        images.push({ path: file, w: info.width, h: info.height });
        texts.push(r.lines || []);
        progress({ stage: 'exporting', done: i + 1, total: info.count });
      }
      await fs.promises.writeFile(path.join(dir, 'texts.json'), JSON.stringify(texts));
      return { render: 'images', images };
    } finally { await closeWindow(w); }
  }

  async builtinDoc({ input, folder, progress }, ext) {
    const [w, call] = await this.page();
    try {
      await call(ext === '.rtf' ? 'rtf' : 'docx', this.url(input));
      progress({ stage: 'exporting', message: '正在排版成 PDF' });
      const pdf = await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
      const file = path.join(folder, 'document.pdf');
      await fs.promises.writeFile(file, pdf);
      return this.keepPdf(file, folder);
    } finally { await closeWindow(w); }
  }
}

/** 文件里有没有图表（不解压：zip 的文件名本身是明文） */
function hasCharts(input, ext) {
  try {
    const buf = fs.readFileSync(input);
    return buf.includes(Buffer.from(ext === '.pptx' ? 'ppt/charts/' : 'word/charts/'));
  } catch { return false; }
}

function advice(ext) {
  if (ext === '.ppt') return '这份是旧版 .ppt 课件，本机没有能打开它的软件。请安装免费的 Keynote（App Store）或 LibreOffice，或在 PowerPoint / WPS 里另存为 .pptx 或 PDF 后再打开。';
  if (ext === '.doc') return '这份是旧版 .doc 文档，本机没能转换。请安装免费的 Pages（App Store）或 LibreOffice，或在 Word / WPS 里另存为 .docx 或 PDF 后再打开。';
  return '这份课件没能转换。请在 Keynote、PowerPoint 或 WPS 里另存为 PDF 后再打开。';
}

module.exports = { OfficeConverter, closeWindow, findLibreOffice, hasCharts };
