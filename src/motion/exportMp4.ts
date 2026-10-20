// 导出 MP4：逐帧渲染 → WebCodecs 硬件编码（H.264）→ mediabunny 封装；配乐用 AAC（不支持时退到 Opus）。
// 不依赖 ffmpeg，导出的画面和预览完全一致。
import { AudioBufferSource, BufferTarget, canEncodeAudio, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny';
import type { Film } from './stage';
import { makeScore } from './score';

export interface ExportOpts { fps?: number; bitrate?: number; music?: boolean; onProgress?: (k: number, frame: number, total: number) => void; signal?: { cancelled: boolean }; from?: number; to?: number }

export async function exportMp4(film: Film, o: ExportOpts = {}): Promise<{ bytes: Uint8Array; audio: string; ms: number; frames: number }> {
  const t0 = performance.now(), fps = o.fps ?? 30, from = o.from ?? 0, to = Math.min(film.duration, o.to ?? film.duration);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(film.canvas, { codec: 'avc', bitrate: o.bitrate ?? 14e6, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  let audio: AudioBufferSource | null = null, codec = '';
  if (o.music !== false && film.spec.music !== false) {
    codec = (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })) ? 'aac' : 'opus';
    audio = new AudioBufferSource({ codec: codec as 'aac' | 'opus', bitrate: 192e3 });
    output.addAudioTrack(audio);
  }
  await output.start();
  const total = Math.round((to - from) * fps);
  for (let i = 0; i < total; i++) {
    if (o.signal?.cancelled) { await output.cancel(); throw new Error('已取消导出'); }
    film.render(from + i / fps);
    await video.add(i / fps, 1 / fps);
    if (i % 10 === 0) o.onProgress?.(i / total, i, total);
  }
  if (audio) {
    let score = await makeScore(film.spec);
    if (from > 0 || to < film.duration) score = slice(score, from, to);
    await audio.add(score);
  }
  await output.finalize();
  o.onProgress?.(1, total, total);
  return { bytes: new Uint8Array(output.target.buffer!), audio: codec, ms: performance.now() - t0, frames: total };
}

function slice(b: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.floor(from * b.sampleRate), z = Math.min(b.length, Math.ceil(to * b.sampleRate));
  const out = new AudioBuffer({ length: Math.max(1, z - a), numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, z), c);
  return out;
}
