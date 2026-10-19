'use strict';
// manim 讲解动画（可选组件）：本机装了 manim（pip install manim）才可用，没装时只报告状态，不影响其它功能。
// 脚本由 AI 写，属于不可信代码：运行前做白名单检查（只许 manim / numpy / math，禁止文件、进程、网络等），
// 在独立的任务目录里运行，超时强制结束。这不是沙箱，只是挡住明显越界的写法。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { normal } = require('./files.cjs');

const SCENE = 'Explain';
const QUALITY = { draft: '-ql', normal: '-qm', hd: '-qh' };
const LIMIT_MIN = { draft: 6, normal: 12, hd: 25 };
const BANNED = [
  [/\b(?:os|sys|subprocess|shutil|socket|pathlib|urllib|requests|http|ctypes|importlib|pickle|glob|tempfile|threading|multiprocessing|webbrowser|builtins)\b/, '系统 / 网络模块'],
  [/\b(?:open|exec|eval|compile|__import__|globals|locals|vars|getattr|setattr|delattr|input|breakpoint|exit|quit)\s*\(/, '文件读写或动态执行'],
  [/__(?!init__)\w+__/, '双下划线属性'],
  [/\b(?:ImageMobject|SVGMobject|add_sound|Code)\s*\(/, '外部文件'],
  [/\bconfig\s*\.\s*\w+\s*=/, '修改渲染配置'],
];
const IMPORT_OK = /^(?:from\s+manim\s+import\s+\*|import\s+numpy\s+as\s+np|import\s+numpy|import\s+math|import\s+random|from\s+math\s+import\s+[\w ,]+)\s*(?:#.*)?$/;

/** 不合格时抛出中文原因；合格返回去掉 BOM / 统一换行后的脚本 */
function checkScript(code) {
  const src = String(code || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!src.trim()) throw Error('脚本是空的');
  if (src.length > 30000) throw Error('脚本太长（超过 3 万字符）');
  const lines = src.split('\n');
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (/^(?:import|from)\s/.test(line) && !IMPORT_OK.test(line)) throw Error(`第 ${i + 1} 行导入了不允许的模块：${line.slice(0, 60)}`);
    for (const [re, what] of BANNED) if (re.test(line.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""'))) throw Error(`第 ${i + 1} 行用到了不允许的写法（${what}）：${line.slice(0, 60)}`);
  }
  if (!new RegExp(`^class\\s+${SCENE}\\s*\\(\\s*(?:Scene|MovingCameraScene|ThreeDScene|ZoomedScene)\\s*\\)\\s*:`, 'm').test(src)) throw Error(`脚本里没有 class ${SCENE}(Scene)`);
  return src;
}

const run = (cmd, args, o = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: o.timeout ?? 30000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || ''), err }));
});
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}
async function findVideo(dir) {
  const out = [];
  const walk = async (d) => { for (const e of await fs.promises.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'partial_movie_files') await walk(p); } else if (e.name.endsWith('.mp4')) out.push(p); } };
  await walk(dir); return out[0] || null;
}

class Manim {
  constructor({ dir, log, test }) { this.dir = dir; this.log = log; this.test = test; this.info = null; this.jobs = new Map(); }

  /** 找 manim：环境变量 CS_MANIM（"程序|参数1|参数2"，off 表示关闭）→ PATH 里的 manim → py -3 -m manim → python -m manim */
  async status(force) {
    if (this.info && !force) return this.info;
    const tries = [];
    if (process.env.CS_MANIM) tries.push(process.env.CS_MANIM.split('|'));
    if (process.env.CS_MANIM !== 'off') tries.push(['manim'], ['py', '-3', '-m', 'manim'], ['python', '-m', 'manim']);
    let found = null;
    for (const [cmd, ...pre] of tries) {
      const r = await run(cmd, [...pre, '--version'], { timeout: 60000 });
      const v = /Manim Community v?([\d.]+)/i.exec(r.out);
      if (r.ok && v) { found = { cmd, pre, version: v[1] }; break; }
    }
    if (!found) return (this.info = { ok: false, error: '没有找到 manim。这是可选组件：安装 Python 3.10+ 后运行 pip install manim 即可启用。' });
    const tex = await run('latex', ['--version'], { timeout: 15000 });
    this.info = { ok: true, version: found.version, latex: tex.ok && /TeX/i.test(tex.out), cmd: found.cmd, pre: found.pre };
    this.log?.info('manim', `v${found.version} latex=${this.info.latex}`);
    return this.info;
  }
  view() { const i = this.info; return i ? { ok: i.ok, version: i.version, latex: i.latex, error: i.error } : null; }

  async render({ code, quality = 'normal', title = '讲解动画', job } = {}) {
    const src = checkScript(code);
    const info = await this.status();
    if (!info.ok) throw Error(info.error);
    const id = /^[\w-]{6,40}$/.test(job || '') ? job : crypto.randomUUID();
    const dir = path.join(this.dir, id);
    await fs.promises.rm(dir, { recursive: true, force: true }); await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'scene.py'), src, 'utf8');
    const args = [...info.pre, 'render', QUALITY[quality] || '-qm', '--format', 'mp4', '--media_dir', 'media', '--disable_caching', '--progress_bar', 'none', '-v', 'WARNING', 'scene.py', SCENE];
    const t0 = Date.now(); let output = '';
    const code_ = await new Promise((resolve, reject) => {
      const child = spawn(info.cmd, args, { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, detached: process.platform !== 'win32' });
      // 实测 40 秒左右的动画 720p 要渲染约 4 分钟（每帧重画 always_redraw）；按画质给上限
      const timer = setTimeout(() => { this.jobs.get(id).timedOut = true; killTree(child); }, LIMIT_MIN[quality] * 60000 || 600000);
      this.jobs.set(id, { child, timedOut: false, cancelled: false });
      const take = (d) => { output = (output + d.toString('utf8')).slice(-20000); };
      child.stdout.on('data', take); child.stderr.on('data', take);
      child.on('error', (e) => { clearTimeout(timer); reject(Error('启动 manim 失败：' + e.message)); });
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
    });
    const state = this.jobs.get(id); this.jobs.delete(id);
    if (state?.cancelled) throw Error('已取消渲染');
    if (state?.timedOut) throw Error(`渲染超过 ${LIMIT_MIN[quality] || 10} 分钟，已停止。可以让动画短一点，或改用「草稿」画质。`);
    const found = code_ === 0 ? await findVideo(path.join(dir, 'media', 'videos')) : null;
    if (!found) { const e = Error('manim 渲染失败'); e.log = tail(output) + await texError(dir, output); throw e; }
    const safe = String(title).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').trim().slice(0, 40) || '讲解动画';
    const video = path.join(dir, safe + '.mp4');
    await fs.promises.rename(found, video);
    // 中间文件（分段视频、公式缓存）可能有几百 MB，只留成片和脚本
    await fs.promises.rm(path.join(dir, 'media'), { recursive: true, force: true }).catch(() => {});
    this.prune(id).catch(() => {});
    const ms = Date.now() - t0, { duration, sheet } = await contactSheet(video, dir);
    return { id, video: normal(video), ms, bytes: (await fs.promises.stat(video)).size, duration, sheet };
  }
  /** 取消一个任务（同一个任务的各版脚本用「任务号-版次」做目录名，按前缀匹配） */
  cancel(id) {
    let hit = false;
    for (const [k, j] of this.jobs) if (id && (k === id || k.startsWith(id + '-'))) { j.cancelled = true; killTree(j.child); hit = true; }
    return hit;
  }
  /** 只保留最近 30 个动画 */
  async prune(keep) {
    const items = [];
    for (const e of await fs.promises.readdir(this.dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && e.name !== keep && !this.jobs.has(e.name)) items.push({ p: path.join(this.dir, e.name), t: (await fs.promises.stat(path.join(this.dir, e.name))).mtimeMs });
    items.sort((a, b) => b.t - a.t);
    for (const it of items.slice(29)) await fs.promises.rm(it.p, { recursive: true, force: true }).catch(() => {});
  }
  handle(method, value) {
    if (method === 'manim.status') return this.status(!!value?.force).then(() => this.view());
    if (method === 'manim.check') { checkScript(value?.code); return true; }
    if (method === 'manim.render') return this.render(value || {}).catch((e) => { throw Error(e.message + (e.log ? '\n' + e.log : '')); });
    if (method === 'manim.cancel') return this.cancel(String(value || ''));
    throw Error('未知的 manim 操作');
  }
}
/** LaTeX 编译失败时 manim 只说「看日志」：从最新的 .log 里取出 "! 错误" 那几行和出错的公式 */
async function texError(dir, output) {
  if (!/latex error|LaTeX compilation error/i.test(output)) return '';
  const logs = [];
  const walk = async (d) => { for (const e of await fs.promises.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.log')) logs.push({ p, t: (await fs.promises.stat(p)).mtimeMs }); } };
  await walk(path.join(dir, 'media'));
  const last = logs.sort((a, b) => b.t - a.t)[0];
  if (!last) return '';
  const lines = (await fs.promises.readFile(last.p, 'utf8').catch(() => '')).split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('!'));
  if (i < 0) return '';
  const tex = await fs.promises.readFile(last.p.replace(/\.log$/, '.tex'), 'utf8').catch(() => '');
  const body = /\\begin\{(?:align\*|center)\}([\s\S]*?)\\end\{(?:align\*|center)\}/.exec(tex)?.[1]?.trim();
  return '\nLaTeX 报错：' + lines.slice(i, i + 4).filter(Boolean).join(' / ') + (body ? '\n出错的公式：' + body.slice(0, 300) : '');
}

/** 成片按时间均匀截 6 帧拼成 3×2 的 JPEG（给老师预览、给视觉模型审片）。ffmpeg 是 manim 的依赖，没有就跳过。 */
async function contactSheet(video, dir) {
  const probe = await run('ffmpeg', ['-hide_banner', '-i', video], { timeout: 20000 });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(probe.out);
  const duration = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  if (!duration) return { duration, sheet: '' };
  const file = path.join(dir, 'sheet.jpg');
  const r = await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', (duration * 0.06).toFixed(2), '-i', video, '-vf', `fps=6/${(duration * 0.93).toFixed(2)},scale=640:-2,tile=3x2`, '-frames:v', '1', '-q:v', '4', file], { timeout: 60000 });
  if (!r.ok || !fs.existsSync(file)) return { duration, sheet: '' };
  return { duration, sheet: 'data:image/jpeg;base64,' + (await fs.promises.readFile(file)).toString('base64') };
}

/** Python 报错：去掉 ANSI 颜色和 rich 的边框，只留最后 30 行（给 AI 修脚本用） */
function tail(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').split('\n')
    .map((l) => l.replace(/[│┃]/g, '').replace(/^[\s┌┐└┘─━╭╮╰╯]+$/, '').trimEnd())
    .filter((l) => l.trim() && !/^\s*Manim Community v/.test(l)).slice(-30).join('\n').slice(-3000);
}

module.exports = { Manim, checkScript, SCENE };
