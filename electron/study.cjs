'use strict';
// 学情库：题目、作答记录、课后总结、作业。单独存成 DATA/study/study.json，
// 和 workspace.json 分开——课堂状态每 0.6 秒保存一次，不该每次都重写整个题库。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJSON, readJSON, cleanTemps } = require('./core.cjs');
const { normal } = require('./files.cjs');

const LISTS = ['questions', 'attempts', 'lessons', 'homework', 'notes', 'preps'];
const KINDS = { homework: '作业', paper: '试卷', wrongbook: '错题本', lesson: '课后总结', courseware: 'AI课件', prep: '备课' };
// 资料整理索引、AI 自动处理的设置和记录：各存一个 JSON，和学情库放在一起
const STORES = { catalog: 'catalog.json', autopilot: 'autopilot.json' };
const FORMATS = ['pdf', 'docx', 'pptx', 'png'];

function normalize(d) {
  const out = { version: 1, portraits: {} };
  for (const k of LISTS) out[k] = Array.isArray(d?.[k]) ? d[k].filter((x) => x && typeof x === 'object' && typeof x.id === 'string').slice(-20000) : [];
  if (d?.portraits && typeof d.portraits === 'object' && !Array.isArray(d.portraits)) out.portraits = d.portraits;
  return out;
}
const safeName = (s) => String(s || '未命名').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名';
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

class Study {
  constructor({ dir, exportDoc, log }) {
    this.dir = dir; this.file = path.join(dir, 'study.json'); this.img = path.join(dir, 'img');
    this.exportDoc = exportDoc; this.log = log; this.queue = Promise.resolve();
    fs.mkdirSync(this.img, { recursive: true });
  }
  async load() { cleanTemps(this.file); return normalize(await readJSON(this.file, null)); }
  save(data) {
    const v = normalize(data);
    const job = this.queue.catch(() => {}).then(() => atomicJSON(this.file, v));
    this.queue = job;
    return job.then(() => ({ questions: v.questions.length, attempts: v.attempts.length }));
  }
  /** 题图（data URL）→ study/img/<uuid>.png，返回正斜杠绝对路径 */
  async image(dataUrl) {
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
    if (!m || dataUrl.length > 30 * 1024 * 1024) throw Error('题图数据无效');
    const file = path.join(this.img, crypto.randomUUID() + (m[1] === 'png' ? '.png' : '.jpg'));
    await fs.promises.writeFile(file, Buffer.from(m[2], 'base64'));
    return normal(file);
  }
  /** 读题图给 AI 看（只允许学情库自己的图片） */
  async imageData(p) {
    const file = path.resolve(String(p || '')), rel = path.relative(this.img, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('只能读取题库里的图片');
    const ext = path.extname(file).toLowerCase();
    return `data:image/${ext === '.png' ? 'png' : 'jpeg'};base64,` + (await fs.promises.readFile(file)).toString('base64');
  }
  /**
   * 写一份 Markdown 文档并导出。Markdown 里的题图写成 ![题图](img:<文件名>)。
   * 返回 { md, out:[生成的文件], errors:[失败原因] }。
   */
  async document({ kind, title, markdown, formats }) {
    if (!KINDS[kind]) throw Error('未知的文档类型');
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 2 * 1024 * 1024) throw Error('文档内容为空或太大');
    const want = (Array.isArray(formats) ? formats : ['docx', 'pdf']).filter((f) => FORMATS.includes(f));
    const folder = path.join(this.dir, KINDS[kind]);
    await fs.promises.mkdir(folder, { recursive: true });
    const file = path.join(folder, `${safeName(title)}-${stamp()}.md`);
    const md = markdown.replace(/\]\(img:([0-9a-f-]{36}\.(?:png|jpg))\)/g, '](../img/$1)');
    await fs.promises.writeFile(file, md, 'utf8');
    if (!want.length) return { md: normal(file), out: [], errors: [] };
    // 插件提供的导出模板（学校统一试卷样式等）：只影响 PDF / 长图，Word 照常
    const css = this.templateCss ? this.templateCss(kind) : '';
    const r = await this.exportDoc(file, want, css ? { css } : undefined);
    this.log?.info('学情文档导出', KINDS[kind], path.basename(file), r.out.length, r.errors);
    return { md: normal(file), out: r.out.map(normal), errors: r.errors };
  }
  /** 老师自己的技能包（只是步骤清单，不含代码） */
  async skills() { const v = await readJSON(path.join(this.dir, 'skills.json'), []); return Array.isArray(v) ? v.slice(0, 50) : []; }
  async saveSkills(list) {
    if (!Array.isArray(list) || JSON.stringify(list).length > 200000) throw Error('技能包数据无效');
    await atomicJSON(path.join(this.dir, 'skills.json'), list.slice(0, 50));
  }
  /** 导出一个技能包到 study/技能包/<名字>.json，返回路径 */
  async exportSkill({ name, json }) {
    if (typeof json !== 'string' || json.length > 50000) throw Error('技能包数据无效');
    JSON.parse(json);
    const folder = path.join(this.dir, '技能包'); await fs.promises.mkdir(folder, { recursive: true });
    const file = path.join(folder, safeName(name) + '.json'); await fs.promises.writeFile(file, json, 'utf8');
    return normal(file);
  }
  async store(name) { if (!STORES[name]) throw Error('未知的存储'); return readJSON(path.join(this.dir, STORES[name]), null); }
  async saveStore({ name, value }) {
    if (!STORES[name]) throw Error('未知的存储');
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 20 * 1024 * 1024) throw Error('数据无效或太大');
    const file = path.join(this.dir, STORES[name]);
    const job = this.queue.catch(() => {}).then(() => atomicJSON(file, value));
    this.queue = job; await job; return true;
  }
  folder(kind) { const f = kind && KINDS[kind] ? path.join(this.dir, KINDS[kind]) : this.dir; fs.mkdirSync(f, { recursive: true }); return f; }
}

module.exports = { Study, normalize, safeName };
