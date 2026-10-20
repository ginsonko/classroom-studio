// 隐藏页面：载入片子、按时间出帧、导出 MP4。后台和测试都通过 window.__motion 驱动它。
import type { FilmSpec } from './core';
import { Film } from './stage';
import { exportMp4 } from './exportMp4';
import { SHOWCASE } from './showcase';

let film: Film | null = null;
let mp4: Uint8Array | null = null;
const signal = { cancelled: false };
let progress = { k: 0, frame: 0, total: 0 };

const api = {
  async load(spec?: FilmSpec) {
    film?.dispose(); film?.canvas.remove();
    film = new Film(spec ?? SHOWCASE);
    document.body.append(film.canvas);
    await film.load();
    film.render(0);
    return { duration: film.duration, shots: film.shots.map((s) => ({ name: s.spec.name, start: s.start, dur: s.dur })) };
  },
  frame(t: number, type = 'image/jpeg', q = 0.9) {
    if (!film) throw new Error('还没载入片子');
    const t0 = performance.now(); film.render(t);
    return { url: film.canvas.toDataURL(type, q), ms: performance.now() - t0 };
  },
  play(from = 0) { return film?.play(from); },
  async export(o: { fps?: number; bitrate?: number; music?: boolean; from?: number; to?: number } = {}) {
    if (!film) throw new Error('还没载入片子');
    signal.cancelled = false; mp4 = null;
    const r = await exportMp4(film, { ...o, signal, onProgress: (k, frame, total) => { progress = { k, frame, total }; } });
    mp4 = r.bytes;
    return { size: r.bytes.length, audio: r.audio, ms: r.ms, frames: r.frames };
  },
  showcase: SHOWCASE,
  gl() { const r = (film as unknown as { renderer: { getContext(): WebGL2RenderingContext; info: unknown } | null })?.renderer; return r ? { lost: r.getContext().isContextLost(), err: r.getContext().getError(), info: JSON.parse(JSON.stringify(r.info)) } : null; },
  progress: () => progress,
  cancel() { signal.cancelled = true; },
  /** 分块取出导出好的 MP4（base64） */
  chunk(i: number, size = 4 << 20) {
    if (!mp4) return null;
    const part = mp4.subarray(i * size, (i + 1) * size);
    if (!part.length) return null;
    let s = ''; for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode(...part.subarray(j, j + 0x8000));
    return btoa(s);
  },
};
(window as unknown as { __motion: typeof api }).__motion = api;
