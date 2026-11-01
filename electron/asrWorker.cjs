'use strict';
// 课后语音转写（在单独的进程里跑，崩了、卡了都不影响软件）：
// voice.webm 左声道是老师的麦克风，右声道是系统声音（学生）。每个声道用 ffmpeg 解成 16 kHz 单声道，
// 静音检测（silero VAD）切出说话的片段，再交给 SenseVoice 识别。全部在本机，不联网。
// 老录像没有 voice.webm 时 sides 给 [{side:null, who:'unknown'}]，直接把回放 MP4 的混音转成单声道。
// 用法：Electron 里 utilityProcess.fork 后 postMessage(job)；测试时 child_process.fork 后 send(job)，或 node asrWorker.cjs job.json
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const RATE = 16000, WINDOW = 512;
const round = (x) => Math.round(x * 100) / 100;
/** SenseVoice 的标签带尖括号：<|zh|> → zh */
const tag = (v) => String(v || '').replace(/^<\|/, '').replace(/\|>$/, '');
/** 这一句的音量（均方根），用来判断外放串音时哪边是真说话的人 */
function rms(samples) { let sum = 0; for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]; return Math.round(Math.sqrt(sum / Math.max(1, samples.length)) * 10000) / 10000; }

/** 一个声道：ffmpeg 解码 → VAD → 识别；onSegment 每认出一句调一次 */
function channel({ sherpa, recognizer, vadConfig, ffmpeg, voice, side, who, onSegment, onSeconds }) {
  return new Promise((resolve, reject) => {
    const vad = new sherpa.Vad(vadConfig, 60);
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', voice, '-map', '0:a:0', ...(side == null ? [] : ['-af', `pan=mono|c0=c${side}`]), '-ar', String(RATE), '-ac', '1', '-f', 'f32le', 'pipe:1'];
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 不支持就算了 */ }
    let rest = Buffer.alloc(0), queue = new Float32Array(0), total = 0, err = '', count = 0;
    const drain = () => {
      while (!vad.isEmpty()) {
        const seg = vad.front(false); vad.pop();
        const stream = recognizer.createStream();
        stream.acceptWaveform({ samples: seg.samples, sampleRate: RATE });
        recognizer.decode(stream);
        const r = recognizer.getResult(stream), text = String(r.text || '').trim();
        if (text) { count++; onSegment({ t0: round(seg.start / RATE), t1: round((seg.start + seg.samples.length) / RATE), who, text, lang: tag(r.lang), emo: tag(r.emotion), event: tag(r.event), rms: rms(seg.samples) }); }
      }
    };
    child.stdout.on('data', (buf) => {
      // 解码是同步的：处理这一块时不再读管道，ffmpeg 自己会等，内存不会越积越多
      const all = rest.length ? Buffer.concat([rest, buf]) : buf, usable = all.length - (all.length % 4);
      rest = all.subarray(usable);
      const floats = new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + usable));
      const merged = new Float32Array(queue.length + floats.length); merged.set(queue); merged.set(floats, queue.length);
      let k = 0;
      for (; k + WINDOW <= merged.length; k += WINDOW) vad.acceptWaveform(merged.subarray(k, k + WINDOW));
      queue = merged.slice(k); total += floats.length;
      drain(); onSeconds(total / RATE);
    });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0 && !total) return reject(new Error('音频解码失败：' + (err.trim() || '退出代码 ' + code)));
        if (queue.length) { const pad = new Float32Array(WINDOW); pad.set(queue); vad.acceptWaveform(pad); }
        vad.flush(); drain(); onSeconds(total / RATE);
        resolve({ seconds: total / RATE, segments: count });
      } catch (e) { reject(e); }
    });
  });
}

async function run(job, emit) {
  const t0 = Date.now();
  const sherpa = require(path.join(job.addonDir, 'sherpa-onnx-node'));
  const threads = Math.max(1, Math.min(4, job.threads || 2)), file = (k, name) => job[k] || path.join(job.modelDir, name);
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: { senseVoice: { model: file('model', 'model.int8.onnx'), language: job.language || 'auto', useInverseTextNormalization: 1 }, tokens: file('tokens', 'tokens.txt'), numThreads: threads, provider: 'cpu', debug: 0 },
  });
  const vadConfig = { sileroVad: { model: file('vad', 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, maxSpeechDuration: 15, windowSize: WINDOW }, sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0 };
  // 装组件时的自检：模型能加载就行
  if (job.check) { new sherpa.Vad(vadConfig, 1); emit({ type: 'done', segments: [], ms: Date.now() - t0 }); return; }
  const segments = [], sides = job.sides || [{ side: 0, who: 'teacher' }, { side: 1, who: 'student' }];
  const duration = job.duration || 0;
  for (const [i, s] of sides.entries()) {
    let last = 0;
    await channel({
      sherpa, recognizer, vadConfig, ffmpeg: job.ffmpeg, voice: job.voice, side: s.side, who: s.who,
      onSegment: (seg) => { segments.push(seg); emit({ type: 'segment', segment: seg }); },
      onSeconds: (sec) => { if (duration && Date.now() - last > 1000) { last = Date.now(); emit({ type: 'progress', progress: Math.min(0.99, (i + Math.min(1, sec / duration)) / sides.length) }); } },
    });
  }
  segments.sort((a, b) => a.t0 - b.t0);
  emit({ type: 'done', segments, ms: Date.now() - t0 });
}

const fail = (err) => ({ type: 'error', error: String(err?.message || err) });
if (process.parentPort) {
  process.parentPort.once('message', (e) => {
    run(e.data, (m) => process.parentPort.postMessage(m)).catch((err) => process.parentPort.postMessage(fail(err))).finally(() => setTimeout(() => process.exit(0), 50));
  });
} else if (process.send && require.main === module) {
  process.once('message', (job) => {
    run(job, (m) => process.send(m)).catch((err) => process.send(fail(err))).finally(() => setTimeout(() => process.exit(0), 50));
  });
} else if (require.main === module) {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  run(job, (m) => { if (m.type !== 'segment') process.stdout.write(JSON.stringify(m) + '\n'); }).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { run };
