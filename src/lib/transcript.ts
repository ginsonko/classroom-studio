// 课堂原话（transcript.json）的纯函数：字幕定位、搜索、学生发言段。不依赖界面，Node 里能直接测。
export type Speaker = 'teacher' | 'student' | 'unknown';
export interface TranscriptSeg { t0: number; t1: number; who: Speaker; text: string; emo?: string; event?: string }
export interface Transcript { v: number; engine: string; at: string; split: 'channel' | 'mixed'; source: string; seconds: number | null; ms: number; segments: TranscriptSeg[] }
export const WHO_NAME: Record<Speaker, string> = { teacher: '老师', student: '学生', unknown: '' };

/** 播放到这一刻对应哪一句（二分查找；落在两句之间时返回 -1） */
export function lineAt(segs: TranscriptSeg[], t: number): number {
  let lo = 0, hi = segs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].t0 <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  // 字幕在一句说完后多留 1.5 秒，免得一闪就没
  return best >= 0 && t <= segs[best].t1 + 1.5 ? best : -1;
}

/** 搜索：几个词用空格隔开，都出现才算 */
export function matchLine(text: string, q: string): boolean {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

/** 学生说话的时间段合并成几块（进度条上标出学生发言多的地方） */
export function talkBands(segs: TranscriptSeg[], duration: number, who: Speaker = 'student', gap = 8): { from: number; to: number }[] {
  if (!duration) return [];
  const out: { from: number; to: number }[] = [];
  for (const s of segs) {
    if (s.who !== who) continue;
    const last = out[out.length - 1];
    if (last && s.t0 - last.to <= gap) last.to = Math.max(last.to, s.t1);
    else out.push({ from: s.t0, to: s.t1 });
  }
  return out.map((b) => ({ from: Math.max(0, b.from / duration), to: Math.min(1, b.to / duration) }));
}
