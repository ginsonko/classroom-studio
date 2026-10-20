// 联系表：把片子按时间截 8 帧拼成一张图（4×2），给 AI 审片、给老师当封面。
import type { FilmSpec } from './core';
import { Film } from './stage';

/** 每个镜头取「部件都出来以后」的时刻；镜头少时一个镜头取两帧 */
export function sheetTimes(shots: { start: number; dur: number }[], n = 8): number[] {
  const per = shots.length >= n ? 1 : Math.ceil(n / shots.length);
  const ts: number[] = [];
  for (const s of shots) for (let k = 0; k < per; k++) ts.push(s.start + s.dur * (per === 1 ? 0.72 : 0.38 + (0.5 * k) / (per - 1)));
  if (ts.length <= n) return ts;
  return Array.from({ length: n }, (_, i) => ts[Math.round((i * (ts.length - 1)) / (n - 1))]);
}

export async function filmSheet(spec: FilmSpec, o: { n?: number; cellW?: number } = {}): Promise<{ sheet: string; problems: string[]; duration: number }> {
  const film = new Film(spec);
  try {
    await film.load();
    const times = sheetTimes(film.shots, o.n ?? 8), cols = 4, rows = Math.ceil(times.length / cols);
    const cw = o.cellW ?? 480, ch = Math.round((cw * 9) / 16), gap = 4;
    const c = Object.assign(document.createElement('canvas'), { width: cols * cw + (cols - 1) * gap, height: rows * ch + (rows - 1) * gap });
    const g = c.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    times.forEach((t, i) => {
      film.render(t);
      const x = (i % cols) * (cw + gap), y = Math.floor(i / cols) * (ch + gap);
      g.drawImage(film.canvas, x, y, cw, ch);
      const tag = `${t.toFixed(1)}s · ${film.shotAt(t).spec.name ?? ''}`;
      g.font = '600 15px "Microsoft YaHei UI",sans-serif'; g.textBaseline = 'top';
      const w = g.measureText(tag).width;
      g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(x + 6, y + 6, w + 12, 22);
      g.fillStyle = '#fff'; g.fillText(tag, x + 12, y + 9);
    });
    return { sheet: c.toDataURL('image/jpeg', 0.82), problems: [...film.problems], duration: film.duration };
  } finally { film.dispose(); }
}
