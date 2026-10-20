'use strict';
// 插件管理：安装（先放进暂存区校验，老师看过权限再装）、开关、删除、导出、复制、历史版本、出错自动停用、
// 插件自己的数据、给 plugin:// 协议找文件。插件放在数据目录里，导播台升级不会动它们。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const spec = require('./pluginSpec.cjs');
const zipkit = require('./zipkit.cjs');

const KIT = path.join(__dirname, 'plugin-kit');
const KEEP_HISTORY = 20;
const ERROR_WINDOW = 60 * 1000, ERROR_LIMIT = 8;
const DATA_LIMIT = 2 * 1024 * 1024;
const DOC_KINDS = ['homework', 'paper', 'wrongbook', 'lesson'];

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, f); };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
// Windows 上插件页面刚被读过时，杀毒软件或还没关的文件句柄会让改名短暂失败（EPERM / EBUSY）
const retry = (fn, times = 8) => {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= times || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60 * (i + 1));
    }
  }
};

class Plugins {
  constructor({ dir, log, emit }) {
    this.dir = dir; this.log = log; this.emit = emit || (() => {});
    this.installedDir = path.join(dir, 'installed'); this.historyDir = path.join(dir, 'history');
    this.stagingDir = path.join(dir, 'staging'); this.dataDir = path.join(dir, 'data');
    this.stateFile = path.join(dir, 'state.json'); this.bootFile = path.join(dir, 'booting.json');
    for (const d of [this.installedDir, this.historyDir, this.dataDir]) fs.mkdirSync(d, { recursive: true });
    // 上次没装完的暂存区直接清掉
    this.trashDir = path.join(dir, 'trash');
    for (const d of [this.stagingDir, this.trashDir]) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 被占用就留着 */ }
    this.state = { paused: false, items: {}, templates: {}, ...readJSON(this.stateFile, {}) };
    this.cache = new Map(); this.errors = new Map(); this.dev = new Map();
    // 连续两次启动都没走到「稳定」（大概率是插件把软件弄崩了）：这次不加载插件
    const boot = readJSON(this.bootFile, { count: 0 });
    this.safeMode = process.argv.includes('--no-plugins') || (Number(boot.count) || 0) >= 2;
    try { writeJSON(this.bootFile, { count: (Number(boot.count) || 0) + 1 }); } catch { /* 只读磁盘 */ }
    this.scan();
  }

  /** 软件正常运行一段时间后调用：清掉启动计数 */
  stable() { try { writeJSON(this.bootFile, { count: 0 }); } catch { /* ignore */ } }

  save() { try { writeJSON(this.stateFile, this.state); } catch (e) { this.log?.warn('插件状态保存失败', e); } }
  changed() { this.save(); this.emit({ type: 'plugins' }); }

  scan() {
    this.cache.clear();
    for (const e of fs.readdirSync(this.installedDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const raw = readJSON(path.join(this.installedDir, e.name, 'plugin.json'), null);
      const r = spec.normalize(raw, (rel) => fs.existsSync(path.join(this.installedDir, e.name, rel)));
      if (!r.manifest || r.manifest.id !== e.name) { this.log?.warn('插件目录无效，已跳过', e.name, r.problems.join('；')); continue; }
      this.cache.set(e.name, { manifest: r.manifest, problems: r.problems });
      if (!this.state.items[e.name]) this.state.items[e.name] = { enabled: true, installedAt: Date.now(), updatedAt: Date.now() };
    }
    for (const id of Object.keys(this.state.items)) if (!this.cache.has(id)) delete this.state.items[id];
  }

  isActive(id) { const s = this.state.items[id]; return !!s?.enabled && !this.state.paused && !this.safeMode && this.cache.has(id) && !this.cache.get(id).problems.length; }

  list() {
    return {
      paused: !!this.state.paused, safeMode: this.safeMode, templates: { ...this.state.templates },
      permissionNames: spec.PERMISSIONS,
      items: [...this.cache.values()].map(({ manifest, problems }) => {
        const s = this.state.items[manifest.id] || {};
        return { ...manifest, enabled: !!s.enabled, active: this.isActive(manifest.id), installedAt: s.installedAt || 0, updatedAt: s.updatedAt || 0, disabledReason: s.disabledReason || '', problems };
      }).sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    };
  }

  manifest(id) {
    if (id.startsWith('dev-')) { const d = this.dev.get(id.slice(4)); return d ? spec.checkFolder(d).manifest : null; }
    return this.cache.get(id)?.manifest || null;
  }

  // ── plugin:// ──
  /** plugin://<id>/<路径> → 文件；/__cs/ 下是导播台提供的 SDK 和样式。插件停用时找不到 */
  resolve(url) {
    let u; try { u = new URL(url); } catch { return null; }
    const id = u.hostname.toLowerCase(), rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    let root;
    if (id.startsWith('dev-')) root = this.dev.get(id.slice(4));
    else if (this.isActive(id)) root = path.join(this.installedDir, id);
    if (!root) return null;
    if (rel.startsWith('__cs/') && !['__cs/sdk.js', '__cs/ui.css'].includes(rel)) return null;
    const base = rel.startsWith('__cs/') ? KIT : root, file = path.resolve(base, rel.startsWith('__cs/') ? rel.slice(5) : rel);
    if (!file.startsWith(path.resolve(base) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return { id, file, manifest: rel.startsWith('__cs/') ? null : this.manifest(id) };
  }

  /** 插件页面的内容安全策略：只能连自己（plugin://<id>）和 plugin.json 里写明的域名 */
  csp(manifest) {
    const net = (manifest?.network || []).map((h) => 'https://' + h).join(' ');
    return [
      "default-src 'self' data: blob:", "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:", "style-src 'self' 'unsafe-inline' data:",
      `img-src 'self' data: blob: ${net}`, `media-src 'self' data: blob: ${net}`, `font-src 'self' data: ${net}`, `connect-src 'self' data: blob: ${net}`,
      "worker-src 'self' blob:", "frame-src 'self' blob: data:", "object-src 'none'", "base-uri 'self'", "form-action 'none'",
    ].map((s) => s.trim()).join('; ');
  }

  sdk() { if (!this.sdkText) this.sdkText = fs.readFileSync(path.join(KIT, 'sdk.js'), 'utf8'); return this.sdkText; }

  /** 把 SDK 插在 <head> 后面（没有就在 <html> / doctype 后面），插件代码一开始就能用 window.cs */
  inject(buf) {
    const head = buf.subarray(0, 8192).toString('latin1');
    let at = 0;
    for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) { const m = re.exec(head); if (m) { at = m.index + m[0].length; break; } }
    return Buffer.concat([buf.subarray(0, at), Buffer.from('<script>' + this.sdk().replace(/<\/script/gi, '<\\/script') + '</script>', 'utf8'), buf.subarray(at)]);
  }

  // ── 安装 ──
  stageDir() { const token = crypto.randomBytes(8).toString('hex'), dir = path.join(this.stagingDir, token); fs.mkdirSync(dir, { recursive: true }); return { token, dir }; }

  /** 文件夹 / .csplugin / .zip → 暂存区，返回校验结果给老师确认 */
  stage(source) {
    const src = path.resolve(String(source || ''));
    if (!fs.existsSync(src)) throw new Error('找不到这个插件文件');
    const { token, dir } = this.stageDir();
    try {
      if (fs.statSync(src).isDirectory()) {
        const scan = spec.scanFolder(src);
        if (scan.files.length > spec.LIMITS.files || scan.bytes > spec.LIMITS.bytes) throw new Error(scan.problems.join('；'));
        fs.cpSync(src, dir, { recursive: true, filter: (f) => !/[\\/](\.git|node_modules|__MACOSX)([\\/]|$)/.test(f) });
      } else {
        if (fs.statSync(src).size > spec.LIMITS.bytes) throw new Error('插件包太大（超过 40 MB）');
        zipkit.extract(fs.readFileSync(src), dir, { maxBytes: spec.LIMITS.bytes, maxFiles: spec.LIMITS.files + 50 });
        // 包里多套了一层文件夹、而 plugin.json 在下一层：挪上来
        if (!fs.existsSync(path.join(dir, 'plugin.json'))) {
          const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'plugin.json')));
          if (subs.length === 1) { const inner = path.join(dir, subs[0].name); for (const n of fs.readdirSync(inner)) fs.renameSync(path.join(inner, n), path.join(dir, n)); fs.rmdirSync(inner); }
        }
      }
    } catch (e) { this.discard(token); throw e; }
    return this.inspect(token);
  }

  inspect(token) {
    const dir = this.staged(token), r = spec.checkFolder(dir);
    const old = r.manifest && this.cache.get(r.manifest.id)?.manifest;
    return { token, manifest: r.manifest, problems: r.problems, files: r.files.length, bytes: r.bytes, existing: old ? { version: old.version, name: old.name, permissions: old.permissions, network: old.network } : null, permissionNames: spec.PERMISSIONS };
  }

  staged(token) {
    if (!/^[0-9a-f]{16}$/.test(String(token))) throw new Error('安装信息已失效，请重新导入');
    const dir = path.join(this.stagingDir, token);
    if (!fs.existsSync(dir)) throw new Error('安装信息已失效，请重新导入');
    return dir;
  }

  discard(token) { try { fs.rmSync(path.join(this.stagingDir, String(token).replace(/[^0-9a-f]/g, '')), { recursive: true, force: true }); } catch { /* ignore */ } }

  install(token, reason = 'update') {
    const dir = this.staged(token), r = spec.checkFolder(dir);
    if (!r.manifest || r.problems.length) throw new Error('插件不能安装：' + r.problems.slice(0, 3).join('；'));
    const id = r.manifest.id, to = path.join(this.installedDir, id);
    if (fs.existsSync(to)) { this.snapshot(id, reason); this.dropDir(to); }
    try { retry(() => fs.renameSync(dir, to)); } catch { fs.cpSync(dir, to, { recursive: true }); this.discard(token); }
    const prev = this.state.items[id];
    this.state.items[id] = { enabled: true, installedAt: prev?.installedAt || Date.now(), updatedAt: Date.now() };
    this.errors.delete(id);
    this.scan(); this.changed();
    this.log?.info('插件已安装', id, r.manifest.version);
    return this.list().items.find((x) => x.id === id);
  }

  /** 先改名挪进回收区再删：旧目录删不干净（文件还被占用）也不挡新版本落位 */
  dropDir(dir) {
    const aside = path.join(this.trashDir, path.basename(dir) + '-' + crypto.randomBytes(4).toString('hex'));
    try { fs.mkdirSync(this.trashDir, { recursive: true }); retry(() => fs.renameSync(dir, aside)); } catch { retry(() => fs.rmSync(dir, { recursive: true, force: true })); return; }
    try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* 下次启动再清 */ }
  }

  // ── 历史版本 ──
  snapshot(id, reason) {
    const src = path.join(this.installedDir, id), m = this.cache.get(id)?.manifest;
    if (!fs.existsSync(src)) return;
    const dir = path.join(this.historyDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${stamp()}__v${m?.version || '0'}__${reason}.csplugin`), zipkit.packFolder(src));
    const all = fs.readdirSync(dir).filter((n) => n.endsWith('.csplugin')).sort();
    for (const n of all.slice(0, Math.max(0, all.length - KEEP_HISTORY))) fs.rmSync(path.join(dir, n), { force: true });
  }

  history(id) {
    const dir = path.join(this.historyDir, this.safeId(id));
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.csplugin')); } catch { /* 没有历史 */ }
    const REASON = { update: '更新前', rollback: '回退前', removed: '删除前', ai: 'AI 修改前', manual: '手动保存' };
    return names.sort().reverse().map((n) => {
      const [s, v, why] = n.replace(/\.csplugin$/, '').split('__');
      const at = Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
      return { name: n, at: Number.isFinite(at) ? at : 0, version: (v || '').replace(/^v/, ''), reason: REASON[why] || why || '', bytes: fs.statSync(path.join(dir, n)).size };
    });
  }

  rollback(id, name) {
    id = this.safeId(id);
    const file = path.join(this.historyDir, id, path.basename(String(name)));
    if (!fs.existsSync(file)) throw new Error('找不到这个历史版本');
    const { token, dir } = this.stageDir();
    try { zipkit.extract(fs.readFileSync(file), dir); } catch (e) { this.discard(token); throw e; }
    const r = spec.checkFolder(dir);
    if (r.manifest?.id !== id) { this.discard(token); throw new Error('历史版本和这个插件对不上'); }
    return this.install(token, 'rollback');
  }

  safeId(id) { const s = String(id || ''); if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(s)) throw new Error('插件 id 不对'); return s; }

  // ── 管理 ──
  setEnabled(id, on) {
    id = this.safeId(id);
    const s = this.state.items[id]; if (!s) throw new Error('没有这个插件');
    s.enabled = !!on; if (on) { s.disabledReason = ''; this.errors.delete(id); }
    this.changed();
    return this.list();
  }

  setPaused(on) { this.state.paused = !!on; if (!on) this.safeMode = false; this.changed(); return this.list(); }

  remove(id) {
    id = this.safeId(id);
    if (!this.cache.has(id)) throw new Error('没有这个插件');
    this.snapshot(id, 'removed');
    this.dropDir(path.join(this.installedDir, id));
    fs.rmSync(path.join(this.dataDir, id + '.json'), { force: true });
    delete this.state.items[id];
    for (const [k, v] of Object.entries(this.state.templates)) if (String(v).startsWith(id + '/')) delete this.state.templates[k];
    this.scan(); this.changed();
    return this.list();
  }

  /** 导出成 .csplugin（zip） */
  pack(id) { id = this.safeId(id); if (!this.cache.has(id)) throw new Error('没有这个插件'); return { name: `${this.cache.get(id).manifest.name}-${this.cache.get(id).manifest.version}.csplugin`, data: zipkit.packFolder(path.join(this.installedDir, id)) }; }

  /** 复制一份再改：新 id、名称后面加「副本」 */
  duplicate(id) {
    id = this.safeId(id);
    const m = this.cache.get(id)?.manifest; if (!m) throw new Error('没有这个插件');
    let n = 1, nid = `${id}-copy`.slice(0, 40);
    while (this.cache.has(nid)) nid = `${id}-copy${++n}`.slice(0, 40);
    const { token, dir } = this.stageDir();
    fs.cpSync(path.join(this.installedDir, id), dir, { recursive: true });
    const raw = readJSON(path.join(dir, 'plugin.json'), {});
    writeJSON(path.join(dir, 'plugin.json'), { ...raw, id: nid, name: `${m.name}（副本）`.slice(0, 30) });
    return this.install(token, 'update');
  }

  /** 插件页面报错：一分钟内太多次就停用，免得影响上课 */
  error(id, message) {
    if (id.startsWith('dev-')) return { disabled: false };
    id = this.safeId(id);
    const now = Date.now(), list = (this.errors.get(id) || []).filter((t) => now - t < ERROR_WINDOW);
    list.push(now); this.errors.set(id, list);
    this.log?.warn('插件出错', id, String(message).slice(0, 300));
    const s = this.state.items[id];
    if (s?.enabled && list.length >= ERROR_LIMIT) {
      s.enabled = false; s.disabledReason = `一分钟内出错 ${list.length} 次，已自动停用。最后一次：${String(message).slice(0, 120)}`;
      this.changed();
      return { disabled: true, name: this.cache.get(id)?.manifest.name || id };
    }
    return { disabled: false };
  }

  // ── 插件自己的数据 ──
  storage(id, op, key, value) {
    const dev = String(id).startsWith('dev-');
    const file = path.join(this.dataDir, (dev ? 'dev-' + String(id).slice(4).replace(/[^a-z0-9-]/gi, '') : this.safeId(id)) + '.json');
    const data = readJSON(file, {});
    if (op === 'keys') return Object.keys(data);
    const k = String(key ?? '').slice(0, 100);
    if (!k) throw new Error('缺少 key');
    if (op === 'get') return data[k] ?? null;
    if (op === 'remove') { delete data[k]; writeJSON(file, data); return true; }
    if (op === 'set') {
      if (value === undefined) delete data[k]; else data[k] = JSON.parse(JSON.stringify(value));
      if (Buffer.byteLength(JSON.stringify(data)) > DATA_LIMIT) throw new Error('插件数据超过 2 MB，存不下了');
      writeJSON(file, data); return true;
    }
    throw new Error('不支持的操作');
  }

  // ── 扩展点：技能、导出模板 ──
  /** 启用中的插件带的 AI 技能，任务中心里多一种任务 */
  skills() {
    const out = [];
    for (const { manifest: m } of this.cache.values()) {
      if (!this.isActive(m.id)) continue;
      for (const s of m.contributes.skills) out.push({ key: `plugin-${m.id}-${s.id}`.slice(0, 80), dir: path.join(this.installedDir, m.id, 'skills', s.id), label: s.label, hint: s.hint || m.name, formats: s.formats, prompt: s.prompt, plugin: m.name });
    }
    return out;
  }

  setTemplate(kind, ref) {
    if (!DOC_KINDS.includes(kind)) throw new Error('不认识的文档类型');
    if (!ref) delete this.state.templates[kind];
    else {
      const [id, tid] = String(ref).split('/');
      const t = this.cache.get(id)?.manifest.contributes.templates.find((x) => x.id === tid);
      if (!t) throw new Error('找不到这个模板');
      this.state.templates[kind] = `${id}/${tid}`;
    }
    this.changed();
    return this.list();
  }

  /** 某类文档当前用的模板样式（CSS 文本）；插件停用或模板不在了就用默认 */
  templateCss(kind) {
    const ref = this.state.templates[kind];
    if (!ref) return '';
    const [id, tid] = ref.split('/'), t = this.isActive(id) && this.cache.get(id)?.manifest.contributes.templates.find((x) => x.id === tid);
    if (!t) return '';
    try { return fs.readFileSync(path.join(this.installedDir, id, t.css), 'utf8').slice(0, 300000); } catch { return ''; }
  }

  // ── 示例插件 ──
  examples() {
    const root = path.join(KIT, 'examples');
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* 没带示例 */ }
    return names.map((n) => { const r = spec.checkFolder(path.join(root, n)); return r.manifest ? { folder: n, ...r.manifest, installed: this.cache.has(r.manifest.id) } : null; }).filter(Boolean);
  }

  stageExample(folder) {
    const dir = path.join(KIT, 'examples', path.basename(String(folder)));
    if (!fs.existsSync(path.join(dir, 'plugin.json'))) throw new Error('没有这个示例插件');
    return this.stage(dir);
  }

  // ── AI 工坊：正在开发的插件（plugin://dev-<名字>/） ──
  setDev(name, dir) { const k = String(name).replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 30); if (!k) throw new Error('名字不对'); if (dir) this.dev.set(k, dir); else this.dev.delete(k); return 'dev-' + k; }
  checkDev(name) { const d = this.dev.get(String(name)); if (!d) throw new Error('没有这个开发中的插件'); return spec.checkFolder(d); }
  /** 把开发中的插件装上（先留历史版本） */
  installDev(name) {
    const d = this.dev.get(String(name)); if (!d) throw new Error('没有这个开发中的插件');
    const { token, dir } = this.stageDir();
    fs.cpSync(d, dir, { recursive: true, filter: (f) => !/[\\/](\.git|node_modules|\.agents|\.claude|\.codex)([\\/]|$)/.test(f) });
    const r = spec.checkFolder(dir);
    if (!r.manifest || r.problems.length) { this.discard(token); throw new Error('插件还不能安装：' + r.problems.slice(0, 3).join('；')); }
    return this.install(token, 'ai');
  }
}

module.exports = { Plugins, DOC_KINDS };
