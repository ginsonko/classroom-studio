'use strict';
// 插件协议 cs-plugin/1：plugin.json 的校验规则。导播台安装插件、AI 工坊里的校验脚本都用这一份，规则只写一处。
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL = 'cs-plugin/1';
const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const VERSION = /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/;
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const LIMITS = { files: 600, bytes: 40 * 1024 * 1024, file: 16 * 1024 * 1024 };
const BLOCKED = /\.(exe|dll|bat|cmd|com|msi|ps1|psm1|vbs|vbe|wsf|scr|sh|bash|zsh|command|app|node|so|dylib|lnk|jar|reg|cpl|sys|drv)$/i;

const PERMISSIONS = {
  student: '读取当前学生的名字和学科',
  board: '往黑板上放图片、文字',
  present: '把插件页面投到学生画面',
  'bank.read': '读取题库里的题目',
  'bank.write': '往题库收件箱里加题',
  ai: '调用 AI（文字、看图），花费记入账本',
  'ai.image': '调用 AI 生成图片，花费记入账本',
  files: '请老师选文件，把选中的文件交给插件读取',
};
/** 学科大类（初中、小学的同名学科算一类） */
const SUBJECTS = ['physics', 'math', 'chem', 'bio', 'chinese', 'english', 'history', 'geo', 'politics', 'science'];
const PLACES = ['console', 'dock'];
const DOC_KINDS = ['homework', 'paper', 'wrongbook', 'lesson', 'all'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v) => (Array.isArray(v) ? v : []);
/** 插件内的相对路径：不能是绝对路径，不能有 ..，统一成正斜杠 */
function relPath(v) {
  const s = str(v, 200).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some((p) => p === '..' || p === '')) return '';
  return s;
}

/**
 * 校验并规整 plugin.json。返回 { manifest, problems }；problems 非空就不能安装。
 * hasFile(rel) 用来检查引用的文件在不在（不传就不检查）。
 */
function normalize(raw, hasFile) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, problems: ['plugin.json 不是一个 JSON 对象'] };
  if (raw.protocol !== PROTOCOL) bad(`protocol 必须是 "${PROTOCOL}"`);
  const id = str(raw.id, 40);
  if (!ID.test(id)) bad('id 只能用小写字母、数字和短横线，2–40 个字符，例如 "random-picker"');
  const name = str(raw.name, 30);
  if (!name) bad('缺少 name（插件名称）');
  const version = str(raw.version, 14) || '1.0.0';
  if (!VERSION.test(version)) bad('version 写成 1.0.0 这样的格式');
  const file = (v, what, ext) => {
    const rel = relPath(v);
    if (!rel) { bad(`${what}：路径不对（写插件文件夹里的相对路径）`); return ''; }
    if (ext && !ext.test(rel)) { bad(`${what}：${rel} 文件类型不对`); return ''; }
    if (hasFile && !hasFile(rel)) { bad(`${what}：找不到文件 ${rel}`); return ''; }
    return rel;
  };
  const permissions = [...new Set(list(raw.permissions).map((p) => str(p, 20)))];
  for (const p of permissions) if (!PERMISSIONS[p]) bad(`不认识的权限 "${p}"，可用：${Object.keys(PERMISSIONS).join('、')}`);
  const network = [...new Set(list(raw.network).map((h) => str(h, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')))].filter(Boolean);
  for (const h of network) if (!HOST.test(h)) bad(`network 里的 "${h}" 不是域名（只写域名，例如 api.example.com）`);
  if (network.length > 10) bad('network 最多 10 个域名');
  const subjects = list(raw.subjects).map((s) => str(s, 12)).filter((s) => SUBJECTS.includes(s));
  const icon = raw.icon ? file(raw.icon, 'icon', /\.(svg|png|jpe?g|webp)$/i) : '';
  const c = raw.contributes && typeof raw.contributes === 'object' ? raw.contributes : {};
  const ids = new Set();
  const key = (v, what) => {
    const k = str(v, 40);
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(k)) { bad(`${what}：id 只能用小写字母、数字和短横线`); return ''; }
    if (ids.has(what.split(' ')[0] + k)) bad(`${what}：id "${k}" 重复`);
    ids.add(what.split(' ')[0] + k);
    return k;
  };
  const size = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : d; };
  const HTML = /\.html?$/i;
  const contributes = {
    panels: list(c.panels).slice(0, 8).map((p, i) => ({
      id: key(p?.id ?? `panel${i + 1}`, 'panels'), title: str(p?.title, 20) || name, entry: file(p?.entry, `panels[${i}].entry`, HTML),
      where: (list(p?.where).filter((w) => PLACES.includes(w)).length ? list(p.where).filter((w) => PLACES.includes(w)) : PLACES),
      width: size(p?.width, 240, 900, 380), height: size(p?.height, 160, 800, 480),
    })),
    lessons: list(c.lessons).slice(0, 40).map((p, i) => ({
      id: key(p?.id ?? `lesson${i + 1}`, 'lessons'), title: str(p?.title, 40) || name, entry: file(p?.entry, `lessons[${i}].entry`, HTML),
      subject: SUBJECTS.includes(p?.subject) ? p.subject : '',
    })),
    pages: list(c.pages).slice(0, 4).map((p, i) => ({
      id: key(p?.id ?? `page${i + 1}`, 'pages'), title: str(p?.title, 12) || name, entry: file(p?.entry, `pages[${i}].entry`, HTML),
    })),
    shapes: list(c.shapes).slice(0, 12).map((g, i) => ({
      subject: SUBJECTS.includes(g?.subject) ? g.subject : '', group: str(g?.group, 16) || name,
      items: list(g?.items).slice(0, 80).map((it, k) => ({ name: str(it?.name, 20) || `图形 ${k + 1}`, file: file(it?.file, `shapes[${i}].items[${k}].file`, /\.(svg|png|jpe?g|webp)$/i), width: size(it?.width, 20, 1600, 0) })),
    })),
    skills: list(c.skills).slice(0, 8).map((s, i) => {
      const k = key(s?.id ?? `skill${i + 1}`, 'skills');
      if (k) file(`skills/${k}/SKILL.md`, `skills[${i}]`, /\.md$/i);
      return { id: k, label: str(s?.label, 12) || name, hint: str(s?.hint, 40), formats: list(s?.formats).filter((f) => ['docx', 'pdf', 'pptx'].includes(f)), prompt: str(s?.prompt, 400) };
    }),
    templates: list(c.templates).slice(0, 8).map((t, i) => ({
      id: key(t?.id ?? `template${i + 1}`, 'templates'), title: str(t?.title, 20) || name, css: file(t?.css, `templates[${i}].css`, /\.css$/i),
      kinds: list(t?.kinds).filter((k) => DOC_KINDS.includes(k)).length ? list(t.kinds).filter((k) => DOC_KINDS.includes(k)) : ['all'],
    })),
  };
  const count = Object.values(contributes).reduce((a, x) => a + x.length, 0);
  if (!count) bad('contributes 里至少要有一项（panels / lessons / pages / shapes / skills / templates）');
  const manifest = {
    protocol: PROTOCOL, id, name, version, author: str(raw.author, 40), description: str(raw.description, 300), homepage: /^https:\/\//.test(str(raw.homepage, 200)) ? str(raw.homepage, 200) : '',
    icon, subjects, permissions: permissions.filter((p) => PERMISSIONS[p]), network, contributes,
  };
  return { manifest, problems };
}

/** 扫一遍文件夹：文件数、大小、可执行文件 */
function scanFolder(dir) {
  const files = [], problems = [];
  let bytes = 0;
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.DS_Store' || e.name === 'Thumbs.db' || e.name === '__MACOSX') continue;
      const r = rel ? rel + '/' + e.name : e.name, full = path.join(d, e.name);
      if (e.isSymbolicLink()) { problems.push(`不能包含快捷方式 / 链接：${r}`); continue; }
      if (e.isDirectory()) { if (files.length <= LIMITS.files) walk(full, r); continue; }
      if (!e.isFile()) continue;
      if (BLOCKED.test(e.name)) problems.push(`不能包含可执行程序：${r}`);
      const n = fs.statSync(full).size;
      if (n > LIMITS.file) problems.push(`文件太大（超过 16 MB）：${r}`);
      bytes += n; files.push(r);
    }
  };
  walk(dir, '');
  if (files.length > LIMITS.files) problems.push(`文件太多（超过 ${LIMITS.files} 个）`);
  if (bytes > LIMITS.bytes) problems.push('插件太大（超过 40 MB）');
  return { files, bytes, problems };
}

/** 校验一个插件文件夹：plugin.json + 引用的文件 + 体积 */
function checkFolder(dir) {
  const scan = scanFolder(dir), have = new Set(scan.files);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
    return { manifest: null, problems: [fs.existsSync(path.join(dir, 'plugin.json')) ? 'plugin.json 不是合法的 JSON：' + e.message : '文件夹里没有 plugin.json', ...scan.problems], files: scan.files, bytes: scan.bytes };
  }
  const r = normalize(raw, (rel) => have.has(rel));
  return { manifest: r.manifest, problems: [...r.problems, ...scan.problems], files: scan.files, bytes: scan.bytes };
}

module.exports = { PROTOCOL, PERMISSIONS, SUBJECTS, LIMITS, normalize, checkFolder, scanFolder, relPath };
