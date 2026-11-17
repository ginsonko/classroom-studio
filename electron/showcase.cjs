'use strict';
// 工坊与小羽共用的「炫技示例」宿主服务：
// 1. 读取 electron/agent-kit/examples/manifest.json（缺省时可按固定顺序回退读各技能 _showcase/card.json）
// 2. 通过只读 showcase://asset/<相对路径> 安全提供预览视频、轮播图与成品资源（严格限制在 examples 目录内，防路径穿越与软链逃逸）
// 3. showcase.open(id, index)：只在老师预监 / 老师端内置预览打开完整示例，绝不推上学生窗口
// 4. 任务启动带 styleRef 时：把样板路径 .cs-kit/examples/<路径> 写入任务参考说明（任务背景.md 与提示词），并确保样板文件就位
const fs = require('node:fs');
const path = require('node:path');
const { within } = require('./core.cjs');
const { normal } = require('./files.cjs');
const spec = require('./pluginSpec.cjs');

const FIXED_ORDER = [
  ['html', 'courseware-html'],
  ['ppt', 'lecture-slides'],
  ['quiz', 'practice-set'],
  ['homework', 'homework'],
  ['test', 'quiz-paper'],
  ['notes', 'lesson-notes'],
  ['plan', 'lesson-plan'],
  ['plugin', 'plugin-dev'],
  ['free', 'custom'],
];

const normSlash = (p) => String(p || '').replace(/\\/g, '/');

function cleanRelPath(raw) {
  const s = normSlash(raw).trim();
  if (!s || s.includes('\0') || s.includes(':')) throw new Error('示例资源路径不正确');
  const parts = s.split('/');
  if (parts.some((seg) => !seg || seg === '.' || seg === '..')) throw new Error('示例资源路径超出允许范围');
  return parts.join('/');
}

class Showcase {
  constructor({ rootDir, files, plugins, notify, log } = {}) {
    this._rootDir = rootDir || '';
    this.files = files || null;
    this.plugins = plugins || null;
    this.notify = notify || (() => {});
    this.log = log || null;
  }

  dir() {
    if (process.env.CS_SHOWCASE_DIR) return path.resolve(process.env.CS_SHOWCASE_DIR);
    return this._rootDir ? path.resolve(this._rootDir) : path.join(__dirname, 'agent-kit', 'examples');
  }

  /** 将相对 examples 的路径安全解析为真实磁盘路径；任何越界、软链逃逸或不存在都抛错 */
  resolveRel(rel, { mustExist = true } = {}) {
    const clean = cleanRelPath(rel);
    const baseDir = this.dir();
    if (!fs.existsSync(baseDir)) {
      if (!mustExist) return { clean, file: path.resolve(baseDir, ...clean.split('/')) };
      throw new Error('内置示例目录不存在');
    }
    const root = fs.realpathSync(baseDir);
    const target = path.resolve(root, ...clean.split('/'));
    if (!within(root, target) || root === target) throw new Error('示例资源路径超出示例目录');
    if (!mustExist && !fs.existsSync(target)) return { clean, file: target };
    if (!fs.existsSync(target)) throw new Error('找不到这个示例文件：' + clean);
    const real = fs.realpathSync(target);
    if (!within(root, real) || root === real) throw new Error('示例资源链接超出示例目录');
    return { clean, file: real };
  }

  /** 解析 showcase://asset/<路径> 协议请求，仅返回真实文件 */
  resolveProtocolUrl(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch { throw new Error('无效的示例地址'); }
    if (u.protocol !== 'showcase:' || u.hostname !== 'asset') throw new Error('不支持的示例地址');
    const decoded = u.pathname.replace(/^\/+/, '').split('/').map((seg) => decodeURIComponent(seg)).join('/');
    const { file } = this.resolveRel(decoded, { mustExist: true });
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('示例资源不是文件');
    return file;
  }

  assetUrl(rel) {
    const clean = cleanRelPath(rel);
    return 'showcase://asset/' + clean.split('/').map(encodeURIComponent).join('/');
  }

  /** 读取原始 manifest.json，并按固定顺序补入已落盘但尚未汇总进 manifest.json 的各目录 _showcase/card.json */
  rawManifest() {
    const base = this.dir();
    const mf = path.join(base, 'manifest.json');
    let topic = '高一物理 · 超重与失重（人教版必修一）';
    let version = 1;
    const byId = new Map();
    if (fs.existsSync(mf)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^\uFEFF/, ''));
        if (parsed && Array.isArray(parsed.items)) {
          if (parsed.topic) topic = String(parsed.topic);
          if (parsed.version) version = Number(parsed.version) || 1;
          for (const it of parsed.items) {
            if (it && it.id) byId.set(String(it.id), it);
          }
        }
      } catch (e) {
        this.log?.warn('读取 examples/manifest.json 失败', e.message);
      }
    }
    for (const [id, folder] of FIXED_ORDER) {
      if (byId.has(id)) continue;
      const cf = path.join(base, folder, '_showcase', 'card.json');
      if (!fs.existsSync(cf)) continue;
      try {
        const card = JSON.parse(fs.readFileSync(cf, 'utf8').replace(/^\uFEFF/, ''));
        if (card && card.id) byId.set(String(card.id), card);
      } catch { /* ignore broken card */ }
    }
    const ordered = [];
    for (const [id] of FIXED_ORDER) {
      if (byId.has(id)) {
        ordered.push(byId.get(id));
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) ordered.push(rest);
    return { version, topic, items: ordered };
  }

  /** 返回给渲染进程的安全清单（附带 showcase:// 预览地址，不暴露本机绝对路径） */
  manifest() {
    const raw = this.rawManifest();
    const safeUrl = (rel) => {
      if (!rel) return '';
      try {
        this.resolveRel(rel, { mustExist: true });
        return this.assetUrl(rel);
      } catch {
        return '';
      }
    };
    const items = (Array.isArray(raw.items) ? raw.items : []).map((it) => {
      const p = it.preview || {};
      const preview = p.type === 'video'
        ? {
            type: 'video',
            src: String(p.src || ''),
            poster: String(p.poster || ''),
            srcUrl: safeUrl(p.src),
            posterUrl: safeUrl(p.poster),
          }
        : {
            type: 'slides',
            images: Array.isArray(p.images) ? p.images.map(String) : [],
            imageUrls: (Array.isArray(p.images) ? p.images : []).map(safeUrl).filter(Boolean),
          };
      const full = (Array.isArray(it.full) ? it.full : []).map((f) => ({
        label: String(f?.label || it.label || '示例'),
        file: String(f?.file || ''),
        kind: String(f?.kind || 'pdf'),
      }));
      return {
        id: String(it.id || ''),
        skill: String(it.skill || ''),
        label: String(it.label || ''),
        one: String(it.one || ''),
        highlights: Array.isArray(it.highlights) ? it.highlights.map(String).slice(0, 6) : [],
        when: Array.isArray(it.when) ? it.when.map(String).slice(0, 8) : [],
        formats: String(it.formats || ''),
        cost: String(it.cost || ''),
        preview,
        full,
        styleRef: Array.isArray(it.styleRef) ? it.styleRef.map(String) : [],
      };
    });
    return {
      version: Number(raw.version) || 1,
      topic: String(raw.topic || ''),
      items,
    };
  }

  /**
   * 在老师预监 / 内置离线预览打开完整示例（绝不推上学生窗口）：
   * - html / pdf / pptx / docx / png：授权给老师端资源读取并返回规范化路径 + showcase:// URL，渲染进程放入老师预监（cue）与示例预览抽屉
   * - plugin：挂载到 plugins.setDev('showcase-...', dir) 供老师实时交互试玩，同时检查是否可按示例插件暂存安装
   */
  open(input) {
    const req = typeof input === 'string' ? { id: input, index: 0 } : (input || {});
    const targetId = String(req.id || '').trim();
    if (!targetId) throw new Error('请指定要查看的示例类型');
    const mf = this.manifest();
    const item = mf.items.find((x) => x.id === targetId || (x.skill && x.skill === targetId));
    if (!item) throw new Error(`还没有「${targetId}」类型的示例`);
    if (!item.full.length) throw new Error(`「${item.label}」暂时没有可打开的完整示例文件`);
    const idx = Math.max(0, Math.min(Number.isInteger(Number(req.index)) ? Number(req.index) : 0, item.full.length - 1));
    const entry = item.full[idx];
    const { clean, file } = this.resolveRel(entry.file, { mustExist: true });

    let payload;
    if (entry.kind === 'plugin') {
      const st = fs.statSync(file);
      if (!st.isDirectory()) throw new Error('插件示例应为包含 plugin.json 的文件夹');
      if (!this.plugins) throw new Error('插件模块尚未就绪');
      const check = spec.checkFolder(file);
      const devKey = `showcase-${item.id}-${idx}`;
      const devId = this.plugins.setDev(devKey, file);
      const folderName = path.basename(file);
      const canStageExample = this.plugins.examples().some((ex) => ex.folder === folderName);
      if (this.files) this.files.authorize(file, true);
      payload = {
        ok: true,
        id: item.id,
        index: idx,
        label: item.label,
        item,
        entry,
        kind: 'plugin',
        pluginPreview: {
          id: devId,
          folder: canStageExample ? folderName : '',
          path: normal(file),
          manifest: check.manifest,
          problems: check.problems,
        },
      };
    } else {
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error('示例成品文件不存在');
      const normPath = this.files ? this.files.authorize(file, false) : normSlash(file);
      payload = {
        ok: true,
        id: item.id,
        index: idx,
        label: item.label,
        item,
        entry,
        kind: entry.kind,
        path: normPath,
        url: this.assetUrl(clean),
      };
    }

    // 只通知老师窗口（main.cjs 的 notify 只发给 role === 'teacher'，学生窗口绝不会收到）
    this.notify('showcaseOpen', { showcase: payload });
    return payload;
  }

  /**
   * 任务启动前处理 styleRef：
   * 把 .cs-kit/examples/<路径> 写入任务参考说明（任务背景.md 与提示词），并返回待确保落位的样板文件列表
   */
  prepareStart(v = {}) {
    const raw = v.styleRef;
    if (!raw) return { context: v.context, prompt: v.prompt, copies: [], styleRef: null };

    let refId = '';
    let label = '';
    let relList = [];
    if (typeof raw === 'string') {
      refId = raw.trim();
    } else if (Array.isArray(raw)) {
      relList = raw;
    } else if (typeof raw === 'object') {
      refId = String(raw.id || '').trim();
      label = String(raw.label || '').trim();
      if (Array.isArray(raw.paths)) relList = raw.paths;
      else if (Array.isArray(raw.files)) relList = raw.files;
    }

    if ((!relList.length || !label) && refId) {
      const hit = this.rawManifest().items?.find((x) => x.id === refId || (x.skill && x.skill === refId));
      if (!hit && !relList.length) throw new Error('找不到所选的风格参考示例：' + refId);
      if (hit) {
        if (!label) label = String(hit.label || refId);
        if (!relList.length && Array.isArray(hit.styleRef)) relList = hit.styleRef;
      }
    }

    const cleanRels = [];
    const copies = [];
    for (const r of relList) {
      let stripped = normSlash(r).trim().replace(/^\.?\/?\.cs-kit\/examples\//, '');
      if (!stripped) continue;
      const clean = cleanRelPath(stripped);
      if (clean.split('/').includes('_showcase')) throw new Error('风格参考样板不能引用 _showcase 预览目录');
      cleanRels.push(clean);
      const { file } = this.resolveRel(clean, { mustExist: true });
      copies.push({ clean, file });
    }

    if (!cleanRels.length) return { context: v.context, prompt: v.prompt, copies: [], styleRef: null };
    const displayLabel = label || refId || '内置';
    const kitPaths = cleanRels.map((c) => `.cs-kit/examples/${c}`);
    const refBlock = [
      '',
      '## 风格参考（老师指定）',
      `老师选择了「风格参考：${displayLabel} 示例」。`,
      `参考样板路径：${kitPaths.join('、')}`,
      '动手前请先阅读上述样板文件，对齐它的结构层次、版面设计与互动/排版水准，照这个风格做；但所有正文内容、题目与数据必须严格围绕本任务的主题与学生情况完成，不要照抄样板原题或原主题内容。',
    ].join('\n');

    // Agents 将任务背景限制在 20,000 字内，预留老师明确选定的风格参考说明。
    const baseCtx = String(v.context || '').trim().slice(0, Math.max(0, 20000 - refBlock.length - 1));
    const context = baseCtx ? `${baseCtx}\n${refBlock}` : `# 任务背景（导播台自动生成）\n${refBlock}`;
    const basePrompt = String(v.prompt || '').trim();
    const promptNote = kitPaths.some((kp) => basePrompt.includes(kp))
      ? ''
      : `\n\n（风格参考：请参照任务文件夹内样板 ${kitPaths.join('、')} 的风格与质量水准制作。）`;

    return {
      context,
      prompt: basePrompt + promptNote,
      copies,
      styleRef: { id: refId, label: displayLabel, paths: kitPaths },
    };
  }

  /** 任务目录建好后确保 styleRef 引用的样板文件在 .cs-kit/examples/<路径> 就位（包括做插件任务） */
  installReferences(task, prep) {
    if (!task?.work || !prep?.copies?.length) return;
    for (const { clean, file } of prep.copies) {
      try {
        const dest = path.join(task.work, '.cs-kit', 'examples', ...clean.split('/'));
        const st = fs.statSync(file);
        if (st.isDirectory()) {
          fs.cpSync(file, dest, {
            recursive: true,
            filter: (src) => {
              if (fs.lstatSync(src).isSymbolicLink()) throw new Error('风格样板不能包含符号链接');
              this.resolveRel(normSlash(path.relative(this.dir(), src)));
              return path.basename(src) !== '_showcase';
            },
          });
        } else if (st.isFile()) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(file, dest);
        }
      } catch (e) {
        throw new Error('复制风格参考样板失败：' + clean + '，' + e.message);
      }
    }
  }

  handle(method, value) {
    switch (method) {
      case 'showcase.manifest': return this.manifest();
      case 'showcase.open': return this.open(value);
      default: throw new Error('未知的示例操作：' + method);
    }
  }
}

module.exports = { Showcase, cleanRelPath, FIXED_ORDER };
