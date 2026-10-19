'use strict';
// AI 助手存档：每次讲题 / 演示 / 板书 / 问答 / 讲解动画的提问和成果。
// DATA/archive/<年-月>.jsonl 一行一条；截图、预览图从 JSON 里拆成文件放 media/，
// manim 视频从缓存（只留最近 30 个）复制过来，存档不会因为清缓存丢东西。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normal } = require('./files.cjs');

const ACTIONS = ['demo', 'explain', 'draw', 'ask', 'anim'];
const DATA_URL = /^data:(image\/(png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/;
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4' };
const MAX_ENTRY = 8 * 1024 * 1024;
const month = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const clip = (s, n) => String(s ?? '').slice(0, n);
const inside = (root, p) => { const rel = path.relative(root, p); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };

class Archive {
  constructor({ dir, copyFrom = [], log }) {
    this.dir = dir; this.media = path.join(dir, 'media'); this.copyFrom = copyFrom; this.log = log;
    this.queue = Promise.resolve();
    fs.mkdirSync(this.media, { recursive: true });
  }

  /** 把 data URL 写成文件，返回替换后的对象（深拷贝） */
  async extract(id, value) {
    let n = 0;
    const walk = async (v) => {
      if (typeof v === 'string') {
        const m = v.length > 200 ? DATA_URL.exec(v) : null;
        if (!m) return v;
        const file = path.join(this.media, `${id}-${n++}${EXT[m[1]]}`);
        await fs.promises.writeFile(file, Buffer.from(m[3], 'base64'));
        return normal(file);
      }
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x); return o; }
      return v;
    };
    return walk(value);
  }

  /** 讲解动画的视频在 manim 缓存里，复制一份进存档 */
  async keepVideo(id, out) {
    const src = out?.video?.video;
    if (typeof src !== 'string') return out;
    const abs = path.resolve(src);
    if (!this.copyFrom.some((r) => inside(r, abs)) || !fs.existsSync(abs)) return out;
    const file = path.join(this.media, `${id}-video.mp4`);
    await fs.promises.copyFile(abs, file);
    return { ...out, video: { ...out.video, video: normal(file) } };
  }

  async add(e) {
    if (!e || !ACTIONS.includes(e.action)) throw Error('存档内容无效');
    const id = /^[\w-]{6,40}$/.test(String(e.id || '')) ? String(e.id) : crypto.randomUUID();
    const at = Number.isFinite(Number(e.at)) ? Number(e.at) : Date.now();
    let out = e.out && typeof e.out === 'object' ? await this.extract(id, e.out) : undefined;
    out = await this.keepVideo(id, out);
    const meta = e.meta && typeof e.meta === 'object' ? await this.extract(id + 'm', { model: clip(e.meta.model, 80), ms: Number(e.meta.ms) || 0, image: e.meta.image }) : {};
    const row = {
      id, at, action: e.action, subject: clip(e.subject, 30), studentId: clip(e.studentId, 60), studentName: clip(e.studentName, 40),
      ask: clip(e.ask, 4000), title: clip(e.title, 120), text: clip(e.text, 6000), error: e.error ? clip(e.error, 1000) : undefined, out, meta,
    };
    const line = JSON.stringify(row);
    if (line.length > MAX_ENTRY) throw Error('这条内容太大，没有存档');
    const file = path.join(this.dir, month(at) + '.jsonl');
    const job = this.queue.catch(() => {}).then(() => fs.promises.appendFile(file, line + '\n'));
    this.queue = job;
    await job;
    return { id, at };
  }

  /** 月份文件，新的在前 */
  async files() {
    const names = await fs.promises.readdir(this.dir).catch(() => []);
    return names.filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort().reverse().map((n) => path.join(this.dir, n));
  }

  async read(file) {
    const text = await fs.promises.readFile(file, 'utf8').catch(() => '');
    const rows = [];
    for (const l of text.split('\n')) { if (!l.trim()) continue; try { rows.push(JSON.parse(l)); } catch { /* 写到一半的行 */ } }
    return rows;
  }

  /** 列表只给摘要；q 搜提问、标题和正文 */
  async list({ q = '', action = '', subject = '', studentId = '', before = Infinity, limit = 60 } = {}) {
    const words = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    let total = 0;
    for (const f of await this.files()) {
      const rows = (await this.read(f)).reverse();
      for (const r of rows) {
        total += 1;
        if (r.at >= before) continue;
        if (action && r.action !== action) continue;
        if (subject && r.subject !== subject) continue;
        if (studentId && r.studentId !== studentId) continue;
        if (words.length) { const hay = `${r.ask} ${r.title} ${r.text} ${r.studentName}`.toLowerCase(); if (!words.every((w) => hay.includes(w))) continue; }
        if (out.length < Math.min(200, Number(limit) || 60)) out.push({ id: r.id, at: r.at, action: r.action, subject: r.subject, studentName: r.studentName, ask: clip(r.ask, 240), title: r.title, error: r.error, model: r.meta?.model || '', thumb: r.meta?.image || r.out?.preview || '' });
      }
    }
    return { items: out, total, dir: normal(this.dir) };
  }

  async get(id) {
    for (const f of await this.files()) { const r = (await this.read(f)).find((x) => x.id === id); if (r) return r; }
    throw Error('找不到这条存档');
  }

  async remove(id) {
    const job = this.queue.catch(() => {}).then(async () => {
      for (const f of await this.files()) {
        const text = await fs.promises.readFile(f, 'utf8').catch(() => '');
        const lines = text.split('\n').filter(Boolean);
        const keep = lines.filter((l) => { try { return JSON.parse(l).id !== id; } catch { return true; } });
        if (keep.length === lines.length) continue;
        await fs.promises.writeFile(f, keep.length ? keep.join('\n') + '\n' : '');
        for (const n of await fs.promises.readdir(this.media).catch(() => [])) if (n.startsWith(id + '-') || n.startsWith(id + 'm-')) await fs.promises.rm(path.join(this.media, n), { force: true });
        return true;
      }
      return false;
    });
    this.queue = job;
    return job;
  }

  async handle(method, value) {
    switch (method) {
      case 'archive.add': return this.add(value);
      case 'archive.list': return this.list(value || {});
      case 'archive.get': return this.get(String(value || ''));
      case 'archive.remove': return this.remove(String(value || ''));
      default: throw Error('未知的存档操作：' + method);
    }
  }
}

module.exports = { Archive };
