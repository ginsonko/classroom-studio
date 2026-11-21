'use strict';
/**
 * 1.8.0「课后发家长」原生文件拖拽、剪贴板复制文件与发送状态记录模块。
 *
 * 设计目标：
 * 1. 网页普通 HTML5 dragstart 拖进电脑版微信只会变成一串路径文字，发不出文件；
 *    这里走 Electron 原生 webContents.startDrag({ file, files, icon })，向操作系统发出真实的 CF_HDROP 文件拖拽。
 * 2. 原始录像在文件夹里统一叫「课堂回放.mp4」、板书带时间戳串，直接发给家长不易分辨；
 *    这里在 DATA/cache/deliver-stage 下优先用硬链接（0 毫秒、0 额外磁盘占用，跨盘自动退回复制）
 *    生成干净好读的中文文件名（例如「林晓-11月21日-物理课回放.mp4」），原目录文件原封不动。
 * 3. 同时提供「一键复制所选文件到系统剪贴板」，方便老师切到微信窗口直接按 Ctrl+V 发送真实文件。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { nativeImage } = require('electron');
const { within, fixPath, atomicJSON } = require('./core.cjs');
const { normal } = require('./files.cjs');

/** 清理文件名中的非法字符，保留中文、字母、数字与常见括号横杠 */
function cleanFileName(name, fallbackExt = '') {
  let base = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 96);
  if (!base) base = '课堂文件';
  if (fallbackExt && !base.toLowerCase().endsWith(fallbackExt.toLowerCase())) {
    base += fallbackExt;
  }
  return base;
}

/** 生成 64x64 兜底拖拽图标（当应用图标或图片缩略图不可用时使用，避免 startDrag 因空 icon 抛错） */
function fallbackDragIcon(iconPath) {
  if (iconPath && fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img.resize({ width: 48, height: 48, quality: 'good' });
  }
  // 最小合法 32x32 半透明深青圆角卡片 PNG（通过 SVG dataURL 构造）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <rect x="4" y="4" width="40" height="40" rx="10" fill="#132232" stroke="#3dd9eb" stroke-width="2.5"/>
    <path d="M16 15h11l7 7v11a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V17a2 2 0 0 1 2-2z" fill="#3dd9eb" fill-opacity=".22" stroke="#3dd9eb" stroke-width="2"/>
  </svg>`;
  const fromSvg = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  if (!fromSvg.isEmpty()) return fromSvg;
  // 极端环境下用 16x16 实色位图兜底，确保 Electron startDrag 永不崩溃
  const raw = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < raw.length; i += 4) { raw[i] = 61; raw[i + 1] = 217; raw[i + 2] = 235; raw[i + 3] = 230; }
  return nativeImage.createFromBitmap(raw, { width: 16, height: 16 });
}

class DeliverDrag {
  /**
   * @param {{dataDir:string, cacheDir:string, appIconPath?:string, getRecordingsDir:()=>string, files:any, log?:any, test?:boolean}} opts
   */
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.stageRoot = path.join(opts.cacheDir, 'deliver-stage');
    this.sentFile = path.join(opts.dataDir, 'deliver-sent.json');
    this.appIconPath = opts.appIconPath || '';
    this.getRecordingsDir = opts.getRecordingsDir;
    this.files = opts.files;
    this.log = opts.log;
    this.test = !!opts.test;
    /** 测试模式下记录最近一次触发的原生拖拽参数，便于无头自动化验收 */
    this.lastDrag = null;
    this.sentMap = this._loadSent();
    this._cleanOldStages();
  }

  _loadSent() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sentFile, 'utf8'));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  /** 启动时清理超过 3 天的临时硬链接目录，不积攒垃圾 */
  _cleanOldStages() {
    try {
      if (!fs.existsSync(this.stageRoot)) return;
      const now = Date.now();
      for (const name of fs.readdirSync(this.stageRoot)) {
        const dir = path.join(this.stageRoot, name);
        try {
          if (now - fs.statSync(dir).mtimeMs > 3 * 86400_000) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        } catch { /* 忽略被占用的文件 */ }
      }
    } catch { /* 忽略 */ }
  }

  /** 检查文件是否已登记在老师本机的学情记录（DATA/study/study.json：家长长图、板书、作业、学生资料）中，按 mtime 缓存 */
  _isRegisteredInStudy(actual) {
    try {
      const candidates = [path.join(this.dataDir, 'study', 'study.json'), path.join(this.dataDir, 'study.json')];
      const studyFile = candidates.find((f) => fs.existsSync(f));
      if (!studyFile) return false;
      const st = fs.statSync(studyFile);
      if (!this._studyCache || this._studyCache.mtimeMs !== st.mtimeMs || this._studyCache.file !== studyFile) {
        const raw = JSON.parse(fs.readFileSync(studyFile, 'utf8'));
        const set = new Set();
        const add = (p) => {
          if (typeof p !== 'string' || !p.trim()) return;
          try { set.add(path.resolve(fixPath(p)).toLowerCase()); } catch { /* 忽略非法路径 */ }
        };
        for (const f of raw?.files || []) add(f?.path);
        for (const l of raw?.lessons || []) {
          add(l?.cardPath); add(l?.pdfPath); add(l?.docxPath);
          if (Array.isArray(l?.files)) for (const x of l.files) add(typeof x === 'string' ? x : x?.path);
        }
        for (const h of [...(raw?.homework || []), ...(raw?.homeworks || [])]) {
          add(h?.path); add(h?.pdfPath); add(h?.docxPath); add(h?.answerPath);
          if (Array.isArray(h?.files)) for (const x of h.files) add(typeof x === 'string' ? x : x?.path);
        }
        for (const p of raw?.preps || []) {
          if (Array.isArray(p?.files)) for (const x of p.files) add(typeof x === 'string' ? x : x?.path);
        }
        this._studyCache = { file: studyFile, mtimeMs: st.mtimeMs, set };
      }
      return this._studyCache.set.has(path.resolve(actual).toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * 校验文件路径是否允许由老师端导出/拖出：
   * 允许 DATA 目录（学情、板书、工坊、助教、缓存）、当前录像目录、学情库已登记成果，以及老师已授权给资料库的目录。
   */
  resolveAllowedFile(rawPath) {
    const actual = fixPath(rawPath);
    if (!actual || !fs.existsSync(actual)) {
      throw new Error('找不到这个文件（可能已被移动或删除）：' + path.basename(String(rawPath || '')));
    }
    const st = fs.statSync(actual);
    if (!st.isFile()) throw new Error('只能发送文件，不能直接拖放文件夹');
    const recDir = this.getRecordingsDir?.() || '';
    const inSafeRoot = within(this.dataDir, actual)
      || (recDir && within(recDir, actual))
      || this._isRegisteredInStudy(actual);
    if (!inSafeRoot) {
      // 检查是否在老师已授权访问的课件/文件白名单内
      this.files.allowed(actual);
    }
    return { path: actual, size: st.size, mtimeMs: st.mtimeMs };
  }

  /**
   * 同步把一组待发文件准备成干净好读的文件名（同盘用硬链接 0ms 完成，跨盘或不支持硬链接时复制）。
   * @param {{path:string, niceName?:string}[]} items
   * @returns {string[]} 准备好的本机绝对路径数组
   */
  stageFilesSync(items) {
    if (!Array.isArray(items) || !items.length) return [];
    fs.mkdirSync(this.stageRoot, { recursive: true });
    const out = [];
    const usedNames = new Set();

    for (const raw of items.slice(0, 20)) {
      const entry = typeof raw === 'string' ? { path: raw } : (raw || {});
      const info = this.resolveAllowedFile(entry.path);
      const ext = path.extname(info.path);
      const wanted = entry.niceName ? cleanFileName(entry.niceName, ext) : path.basename(info.path);

      // 如果没有改名需求且未重名，直接使用原文件绝对路径
      if (wanted === path.basename(info.path) && !usedNames.has(wanted.toLowerCase())) {
        usedNames.add(wanted.toLowerCase());
        out.push(info.path);
        continue;
      }

      // 确保同一批次中不会出现同名覆盖
      let finalName = wanted;
      let seq = 2;
      while (usedNames.has(finalName.toLowerCase())) {
        const stem = ext ? wanted.slice(0, -ext.length) : wanted;
        finalName = `${stem}-${seq++}${ext}`;
      }
      usedNames.add(finalName.toLowerCase());

      // 按源文件指纹建稳定子目录，已存在且大小一致则直接复用
      const bucket = crypto.createHash('sha1').update(`${info.path}|${info.size}|${Math.floor(info.mtimeMs)}`).digest('hex').slice(0, 12);
      const dir = path.join(this.stageRoot, bucket);
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, finalName);

      let ready = false;
      try {
        const tst = fs.statSync(target);
        if (tst.isFile() && tst.size === info.size) ready = true;
        else fs.unlinkSync(target);
      } catch { /* 不存在，继续创建 */ }

      if (!ready) {
        try {
          // 优先硬链接：哪怕 600MB 的课堂回放 MP4 也只需 0.1 毫秒且不占双份空间
          fs.linkSync(info.path, target);
        } catch {
          // 跨盘（EXDEV）或文件系统不支持硬链接时退回常规复制（超大视频跨盘时不阻塞拖拽，直接退回原路径保流畅）
          if (info.size > 80 * 1024 * 1024) {
            out.push(info.path);
            continue;
          }
          fs.copyFileSync(info.path, target);
        }
      }
      out.push(target);
    }
    return out;
  }

  /** 为原生拖拽挑选清晰的拖拽缩略图（单张图片用自身缩略图，其余用应用图标） */
  pickDragIcon(files) {
    const first = files[0] || '';
    if (files.length === 1 && /\.(png|jpe?g|webp|bmp)$/i.test(first)) {
      try {
        const img = nativeImage.createFromPath(first);
        if (!img.isEmpty()) {
          const sz = img.getSize();
          const w = 72;
          const h = Math.max(36, Math.min(108, Math.round((sz.height / Math.max(1, sz.width)) * w)));
          return img.resize({ width: w, height: h, quality: 'good' });
        }
      } catch { /* 退回默认图标 */ }
    }
    return fallbackDragIcon(this.appIconPath);
  }

  /**
   * 响应渲染进程 dragstart 事件，启动操作系统级原生文件拖放。
   */
  startNativeDrag(webContents, payload) {
    const rawItems = Array.isArray(payload?.items) ? payload.items : (payload?.path ? [{ path: payload.path, niceName: payload.niceName }] : []);
    const ready = this.stageFilesSync(rawItems);
    if (!ready.length) return { ok: false, files: [] };
    const icon = this.pickDragIcon(ready);
    this.lastDrag = { at: Date.now(), files: ready.map(normal), lessonKey: String(payload?.lessonKey || '') };

    if (payload?.lessonKey) {
      this.markSent(String(payload.lessonKey), { channel: 'drag', count: ready.length });
    }

    // 测试环境下若未显式要求调用底层 OS 拖拽循环（避免无鼠标释放卡住测试进程），仅记录并返回
    if (this.test && process.env.CS_REAL_OS_DRAG !== '1') {
      return { ok: true, files: this.lastDrag.files, simulatedInTest: true };
    }

    webContents.startDrag({
      file: ready[0],
      ...(ready.length > 1 ? { files: ready } : {}),
      icon,
    });
    this.log?.info('课后交付原生拖出', ready.length, ready.map((f) => path.basename(f)).join('、'));
    return { ok: true, files: ready.map(normal) };
  }

  /**
   * 将一个或多个真实文件写入操作系统文件剪贴板（CF_HDROP / NSFilenamesPboardType），
   * 老师切到电脑版微信直接按 Ctrl+V / Cmd+V 即可发送整批文件。
   */
  async copyFilesToClipboard(payload) {
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const ready = this.stageFilesSync(rawItems);
    if (!ready.length) throw new Error('没有可复制的文件');

    if (this.test && process.env.CS_REAL_OS_CLIPBOARD !== '1') {
      this.lastCopy = { at: Date.now(), files: ready.map(normal) };
      if (payload?.lessonKey) this.markSent(String(payload.lessonKey), { channel: 'copy', count: ready.length });
      return { ok: true, count: ready.length, files: ready.map(normal) };
    }

    if (process.platform === 'win32') {
      // 使用 PowerShell Set-Clipboard -LiteralPath 写入标准 Windows 文件剪贴板（CF_HDROP），兼容中文与空格路径
      const quoted = ready.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      await new Promise((resolve, reject) => {
        execFile(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-Command', `Set-Clipboard -LiteralPath @(${quoted})`], { windowsHide: true, timeout: 15000 }, (err, _out, stderr) => {
          if (err) reject(new Error('写入系统剪贴板失败：' + String(stderr || err.message).trim().slice(0, 160)));
          else resolve();
        });
      });
    } else if (process.platform === 'darwin') {
      // macOS：单文件用 POSIX file 写入剪贴板
      const script = ready.length === 1
        ? `set the clipboard to (POSIX file ${JSON.stringify(ready[0])})`
        : `tell application "Finder" to set the clipboard to {${ready.map((p) => `POSIX file ${JSON.stringify(p)} as alias`).join(', ')}}`;
      await new Promise((resolve, reject) => {
        execFile('/usr/bin/osascript', ['-e', script], { timeout: 10000 }, (err, _out, stderr) => {
          if (err) reject(new Error('写入剪贴板失败：' + String(stderr || err.message).trim().slice(0, 160)));
          else resolve();
        });
      });
    } else {
      throw new Error('当前系统暂不支持复制文件到剪贴板，请直接拖进微信发送');
    }

    if (payload?.lessonKey) {
      this.markSent(String(payload.lessonKey), { channel: 'copy', count: ready.length });
    }
    this.log?.info('课后交付复制文件', ready.length, ready.map((f) => path.basename(f)).join('、'));
    return { ok: true, count: ready.length, files: ready.map(normal) };
  }

  /** 记录或取消某堂课「已发家长」标记 */
  markSent(lessonKey, meta = {}) {
    const key = String(lessonKey || '').trim().slice(0, 160);
    if (!key) return this.sentMap;
    if (meta.unset) {
      delete this.sentMap[key];
    } else {
      this.sentMap[key] = {
        at: new Date().toISOString(),
        channel: String(meta.channel || 'manual'),
        count: Number(meta.count) || 0,
      };
      // 只保留最近 400 条记录，防止无限增长
      const keys = Object.keys(this.sentMap);
      if (keys.length > 400) {
        for (const old of keys.slice(0, keys.length - 400)) delete this.sentMap[old];
      }
    }
    void atomicJSON(this.sentFile, this.sentMap).catch(() => {});
    return this.sentMap;
  }

  /** 为原地轻预览授权文件并返回可直接加载的 lesson:// URL 与元信息 */
  inspectForPreview(rawPath) {
    const info = this.resolveAllowedFile(rawPath);
    this.files.authorize(info.path, false);
    return {
      path: normal(info.path),
      url: this.files.url(info.path),
      size: info.size,
      mtimeMs: info.mtimeMs,
      ext: path.extname(info.path).slice(1).toLowerCase(),
      name: path.basename(info.path),
    };
  }

  async handle(method, value) {
    const v = value || {};
    switch (method) {
      case 'deliver.sentState':
        return { ...this.sentMap };
      case 'deliver.markSent':
        return { ...this.markSent(v.lessonKey, v) };
      case 'deliver.stage':
        return this.stageFilesSync(v.items || []).map(normal);
      case 'deliver.copyFiles':
        return this.copyFilesToClipboard(v);
      case 'deliver.previewInfo':
        return this.inspectForPreview(v.path ?? value);
      case 'deliver.lastDrag':
        return this.lastDrag;
      default:
        throw new Error('未知的课后交付操作：' + method);
    }
  }
}

module.exports = { DeliverDrag, cleanFileName };
