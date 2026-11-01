'use strict';
// 课后语音转写：下课、回放生成完以后，在后台把这节课的话转成带说话人的文字（transcript.json，放在录像目录里）。
// 只在不上课的时候跑；转到一半又开始录课，就先停下，下课后从头再转（一小时的课只要几分钟）。
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { atomicJSON, readJSON } = require('./core.cjs');

const WORKER = path.join(__dirname, 'asrWorker.cjs');
const TRANSCRIPT = 'transcript.json';
const RECENT_DAYS = 7;

/** 默认在 Electron 的 utilityProcess 里跑（崩了不影响软件）；纯 Node 测试时用 child_process.fork */
function defaultFork(job, onMessage, { env } = {}) {
  let electron = null;
  try { electron = require('electron'); } catch { /* 纯 Node */ }
  const low = (pid) => { try { if (pid) os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 不支持就算了 */ } };
  let child, exited;
  if (electron && typeof electron === 'object' && electron.utilityProcess) {
    child = electron.utilityProcess.fork(WORKER, [], { serviceName: 'classroom-asr', stdio: 'ignore', env: { ...process.env, ...env } });
    child.on('spawn', () => low(child.pid));
    child.on('message', onMessage);
    exited = new Promise((resolve) => child.once('exit', resolve));
    child.postMessage(job);
  } else {
    child = require('node:child_process').fork(WORKER, [], { stdio: 'ignore', env: { ...process.env, ...env }, serialization: 'advanced' });
    low(child.pid);
    child.on('message', onMessage);
    exited = new Promise((resolve) => child.once('exit', resolve));
    child.send(job);
  }
  return { kill: () => { try { child.kill(); } catch { /* 已退出 */ } }, exited };
}

const plain = (s) => String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '');
const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
function overlapGrams(x, y) {
  const gx = grams(x), gy = grams(y);
  let hit = 0;
  for (const [g, n] of gx) hit += Math.min(n, gy.get(g) || 0);
  return hit;
}
/** 两句话的字面相似度（相邻两字的重合比例，0~1） */
function similar(a, b) {
  const x = plain(a), y = plain(b);
  if (!x || !y) return 0;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  return 2 * overlapGrams(x, y) / (x.length - 1 + y.length - 1);
}
/** 短的那句有多少落在长的那句里（0~1）。漏进麦克风的声音小，常常只认出半句 */
function cover(a, b) {
  const x = plain(a), y = plain(b);
  if (!x || !y) return 0;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length < 2) return l.includes(s) ? 1 : 0;
  return overlapGrams(s, l) / (s.length - 1);
}

/**
 * 外放串音：老师没戴耳机时，学生的声音会被麦克风再录一遍，两个声道在同一时间出现差不多的一句话。
 * 这种情况只留音量大的那边。
 */
function dedupeEcho(segments) {
  const list = segments.slice().sort((a, b) => a.t0 - b.t0), drop = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length && list[j].t0 < a.t1; j++) {
      const b = list[j];
      if (a.who === b.who || drop.has(a) || drop.has(b)) continue;
      const overlap = Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0), shorter = Math.min(a.t1 - a.t0, b.t1 - b.t0);
      if (overlap <= 0.5 * shorter || cover(a.text, b.text) < 0.8) continue;
      drop.add((a.rms || 0) >= (b.rms || 0) ? b : a);
    }
  }
  return list.filter((s) => !drop.has(s));
}

/** 存盘的格式：去掉只在合并时用的音量；情绪、事件只在不是默认值时保留 */
function clean(segments) {
  return segments.map((s) => {
    const o = { t0: s.t0, t1: s.t1, who: s.who, text: s.text };
    if (s.emo && s.emo !== 'NEUTRAL' && s.emo !== 'EMO_UNKNOWN') o.emo = s.emo;
    if (s.event && s.event !== 'Speech') o.event = s.event;
    return o;
  });
}

class Asr {
  /**
   * @param {{setup:any, recording:any, ffmpeg:string, log?:any, emit?:(m:object)=>void, enabled?:()=>boolean, busy?:()=>boolean,
   *          fork?:typeof defaultFork, threads?:number, poll?:number}} o
   */
  constructor(o) {
    this.o = o; this.setup = o.setup; this.recording = o.recording; this.log = o.log; this.emit = o.emit || (() => {});
    this.fork = o.fork || defaultFork; this.poll = o.poll || 3000;
    this.queue = []; this.current = null; this.paused = false; this.running = false; this.asked = false;
  }

  get threads() { return this.o.threads || Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4))); }

  view() {
    return {
      setup: this.setup.view(), enabled: this.o.enabled ? this.o.enabled() : true, paused: this.paused,
      current: this.current ? { id: this.current.id, title: this.current.title, pct: this.current.pct || 0 } : null,
      queue: this.queue.map((q) => q.id),
    };
  }
  changed() { this.emit({ type: 'asr', state: this.view() }); }

  /** 回放生成完时调用：开着自动转写、有 voice.webm 就排队；组件没装时提醒一次 */
  async offer(rec) {
    if (this.o.enabled && !this.o.enabled()) return false;
    const item = (await this.recording.list()).find((r) => r.id === rec.id);
    if (!item || !fs.existsSync(path.join(item.folder, 'voice.webm'))) return false;
    if (!this.setup.paths()) {
      if (!this.asked && this.setup.files) { this.asked = true; this.emit({ type: 'asrNeeded', record: { id: item.id, title: item.title, studentId: item.studentId }, mb: this.setup.view().mb }); }
      return false;
    }
    return this.enqueue(item);
  }

  /** 最近几天有双声道音轨、还没转写过的录像（刚装好组件、或软件重启后接着转） */
  async resumeRecent() {
    if (!this.setup.paths() || (this.o.enabled && !this.o.enabled())) return 0;
    const since = Date.now() - RECENT_DAYS * 86400000;
    let n = 0;
    for (const r of await this.recording.list().catch(() => [])) {
      // phase 为 running 的是上次转到一半软件被关掉了
      if (r.phase !== 'complete' || (r.transcript && r.transcript.phase !== 'running') || Date.parse(r.createdAt) < since) continue;
      if (!fs.existsSync(path.join(r.folder, 'voice.webm'))) continue;
      if (this.enqueue(r)) n++;
    }
    return n;
  }

  /** 排队（同一段不重复排）；手动点的老录像没有 voice.webm 时转回放里的混音 */
  enqueue(item) {
    if (this.current?.id === item.id || this.queue.some((q) => q.id === item.id)) return false;
    this.queue.push({ id: item.id, title: item.title, studentId: item.studentId, folder: item.folder });
    this.changed();
    void this.pump();
    return true;
  }
  drop(id) {
    if (this.current?.id === id) throw Error('正在转写这节课的语音，转完再删除');
    const n = this.queue.length; this.queue = this.queue.filter((q) => q.id !== id);
    if (n !== this.queue.length) this.changed();
  }

  idle() { return !(this.o.busy && this.o.busy()); }
  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        if (!this.idle()) { if (!this.paused) { this.paused = true; this.changed(); } await this.wait(this.poll); continue; }
        if (this.paused) { this.paused = false; this.changed(); }
        const item = this.queue.shift();
        this.current = { ...item, pct: 0 }; this.changed();
        const r = await this.transcribe(item).catch((e) => ({ error: e }));
        this.current = null;
        if (r.interrupted) { this.queue.unshift(item); this.changed(); continue; }
        this.changed();
      }
    } finally { this.running = false; }
  }

  /** 转一段录像。返回 {interrupted:true} 表示中途开始上课被停下了 */
  async transcribe(item) {
    const paths = this.setup.paths();
    if (!paths) throw Error('语音组件还没装好');
    const meta = await readJSON(path.join(item.folder, 'recording.json'), null);
    if (!meta) throw Error('找不到这段录像的信息');
    const voice = path.join(item.folder, 'voice.webm'), mp4 = path.join(item.folder, '课堂回放.mp4');
    const channel = fs.existsSync(voice) && (await fsp.stat(voice)).size > 0;
    const source = channel ? voice : mp4;
    if (!fs.existsSync(source)) throw Error('录像文件不在了');
    const duration = meta.endedAt && meta.startedAt ? (meta.endedAt - meta.startedAt) / 1000 : 0;
    const job = {
      voice: source, ffmpeg: this.o.ffmpeg, addonDir: paths.addonDir, modelDir: paths.modelDir, threads: this.threads, duration,
      sides: channel ? [{ side: 0, who: 'teacher' }, { side: 1, who: 'student' }] : [{ side: null, who: 'unknown' }],
    };
    const t0 = Date.now();
    await this.recording.mergeMeta(item.folder, { transcript: { phase: 'running', at: new Date().toISOString() } }).catch(() => {});
    let result;
    try { result = await this.runJob(job, (p) => { if (this.current) { this.current.pct = p; this.changed(); } }); }
    catch (e) {
      if (e.interrupted) {
        await this.recording.mergeMeta(item.folder, { transcript: null }).catch(() => {});
        this.log?.info?.('语音转写', '开始上课，先停下', item.id);
        return { interrupted: true };
      }
      this.log?.warn?.('语音转写失败', item.id, e.message);
      await this.recording.mergeMeta(item.folder, { transcript: { phase: 'error', error: e.message, at: new Date().toISOString() } }).catch(() => {});
      this.emit({ type: 'asrDone', record: { id: item.id, title: item.title, studentId: item.studentId }, error: e.message });
      throw e;
    }
    const segments = clean(channel ? dedupeEcho(result.segments) : result.segments.slice().sort((a, b) => a.t0 - b.t0));
    const out = { v: 1, engine: paths.engine, at: new Date().toISOString(), split: channel ? 'channel' : 'mixed', source: path.basename(source), seconds: duration || null, ms: Date.now() - t0, segments };
    await atomicJSON(path.join(item.folder, TRANSCRIPT), out);
    const counts = { teacher: 0, student: 0, unknown: 0 };
    for (const s of segments) counts[s.who] = (counts[s.who] || 0) + 1;
    await this.recording.mergeMeta(item.folder, { transcript: { phase: 'done', at: out.at, engine: out.engine, split: out.split, count: segments.length, counts, ms: out.ms } });
    this.log?.info?.('语音转写完成', item.id, segments.length + ' 句', Math.round(out.ms / 1000) + ' 秒');
    this.emit({ type: 'asrDone', record: { id: item.id, title: item.title, studentId: item.studentId }, count: segments.length });
    return { segments };
  }

  /** 跑一次 worker；正在跑时开始上课就杀掉，抛出 interrupted */
  runJob(job, onProgress) {
    return new Promise((resolve, reject) => {
      let settled = false, result = null, error = null, interrupted = false;
      const env = {};
      if (process.platform === 'darwin') {
        const native = fs.readdirSync(job.addonDir).find((d) => /^sherpa-onnx-darwin-/.test(d));
        if (native) env.DYLD_LIBRARY_PATH = path.join(job.addonDir, native);
      }
      const w = this.fork(job, (m) => {
        if (m?.type === 'progress') onProgress?.(m.progress);
        else if (m?.type === 'done') result = m;
        else if (m?.type === 'error') error = m.error;
      }, { env });
      // 一小时的课 2 个线程大约 4 分钟；按课长给足时间，卡死了也能收场
      const limit = Math.max(10 * 60000, (job.duration || 3600) * 1000);
      const timer = setTimeout(() => { error = '语音转写超时'; w.kill(); }, limit);
      const watch = job.check ? null : setInterval(() => { if (!this.idle()) { interrupted = true; w.kill(); } }, this.poll);
      w.exited.then(() => {
        clearTimeout(timer); if (watch) clearInterval(watch);
        if (settled) return; settled = true;
        if (result) resolve(result);
        else if (interrupted) reject(Object.assign(Error('开始上课，转写先停下'), { interrupted: true }));
        else reject(Error(error || '语音转写进程意外退出'));
      });
    });
  }

  /** 装组件时的自检：加载一次模型 */
  async check(paths) {
    await this.runJob({ check: true, ffmpeg: this.o.ffmpeg, addonDir: paths.addonDir, modelDir: paths.modelDir, threads: 1 });
  }

  async transcript(id) {
    const item = (await this.recording.list()).find((r) => r.id === id);
    if (!item) throw Error('找不到这段录像');
    return readJSON(path.join(item.folder, TRANSCRIPT), null);
  }

  /** 在转写过的课里搜原话：几个词用空格隔开，都出现才算；最多 200 条，新课在前 */
  async search({ q, studentId, limit = 200 } = {}) {
    const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length) return [];
    const out = [], max = Math.max(1, Math.min(500, Number(limit) || 200));
    for (const r of await this.recording.list()) {
      if (studentId && r.studentId !== studentId) continue;
      if (r.transcript?.phase !== 'done') continue;
      const t = await readJSON(path.join(r.folder, TRANSCRIPT), null);
      for (const s of t?.segments || []) {
        const text = String(s.text || '').toLowerCase();
        if (!words.every((w) => text.includes(w))) continue;
        out.push({ id: r.id, title: r.title, studentId: r.studentId ?? null, createdAt: r.createdAt, t0: s.t0, t1: s.t1, who: s.who, text: s.text });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  async handle(method, value) {
    if (method === 'asr.state') return this.view();
    if (method === 'asr.search') return this.search(value || {});
    if (method === 'asr.install') { const v = this.setup.install(); this.changed(); return v; }
    if (method === 'asr.cancelInstall') return this.setup.cancel();
    if (method === 'asr.uninstall') { if (this.current) throw Error('正在转写，转完再删除语音组件'); this.queue = []; const v = await this.setup.uninstall(); this.changed(); return v; }
    if (method === 'asr.transcript') return this.transcript(String(value || ''));
    if (method === 'asr.transcribe') {
      const item = (await this.recording.list()).find((r) => r.id === String(value || ''));
      if (!item) throw Error('找不到这段录像');
      if (item.phase !== 'complete') throw Error('回放生成完以后才能转写');
      if (!this.setup.paths()) throw Error('先在「设置 → 录课」里下载语音组件');
      this.enqueue(item);
      return this.view();
    }
    throw Error('未知的语音转写操作：' + method);
  }
}

module.exports = { Asr, dedupeEcho, similar, cover, defaultFork, TRANSCRIPT };
