// 保存板书：在看不见的画布上按原始矢量重画（不是截屏），所以长黑板能整条导出，多页黑板能拼成一张长图。
import type { Material, Stroke } from '../lib/types';
import { DARK_BOARDS, inkKey, resolveColor, useStore, type BoardSkin, type Pattern } from '../lib/store';
import { SCREEN, isLong, longRatio } from '../lib/longBoard';
import { host } from '../lib/host';
import { PAPER } from '../physics/sim/prim';
import { draw, type DrawCtx } from './draw';
import { selectionBounds } from './geometry';
import { boardImage } from './imgCache';
import { texMeasurer } from './texCache';

/** 导出宽度（像素）；一张图最高 MAX_H，超过就分成几张（Chromium 画布单边上限 32767） */
export const EXPORT_W = 1920;
const MAX_H = 30000;
const GAP = 28;

export type ExportMode = 'page' | 'stitch' | 'pages';

interface Skin { paper: string; rule: string; strong: string; dark: boolean; gap: string; label: string }

function skinOf(board: BoardSkin): Skin {
  const el = document.createElement('div');
  el.dataset.board = board; el.style.display = 'none'; document.body.appendChild(el);
  const cs = getComputedStyle(el), v = (k: string) => cs.getPropertyValue(k).trim();
  const dark = DARK_BOARDS.includes(board);
  const s = {
    paper: v('--paper') || PAPER[board] || '#fbf7ee',
    rule: v('--rule') || (dark ? 'rgba(255,255,255,.06)' : 'rgba(120,90,30,.1)'),
    strong: v('--rule-strong') || (dark ? 'rgba(255,255,255,.14)' : 'rgba(120,90,30,.22)'),
    dark, gap: dark ? '#050608' : '#c9ccd2', label: dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.38)',
  };
  el.remove();
  return s;
}

/** 底纹：和 stage.css 里的 [data-pattern] 一致（格子边长是页宽的 1/32，从页面左上角起算） */
function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, w: number, h: number, sk: Skin) {
  const c = w / 32, lw = Math.max(1, w / 1600);
  const hLines = (step: number, color: string, width = lw, from = 0) => { ctx.fillStyle = color; for (let y = from; y < h; y += step) ctx.fillRect(0, Math.round(y), w, width); };
  const vLines = (step: number, color: string, width = lw, from = 0) => { ctx.fillStyle = color; for (let x = from; x < w; x += step) ctx.fillRect(Math.round(x), 0, width, h); };
  switch (pattern) {
    case 'grid': hLines(c, sk.rule); vLines(c, sk.rule); break;
    case 'dots': ctx.fillStyle = sk.strong; for (let y = 0; y < h + c; y += c) for (let x = 0; x < w + c; x += c) { ctx.beginPath(); ctx.arc(x, y, 1.5 * lw, 0, Math.PI * 2); ctx.fill(); } break;
    case 'lines': hLines(c, sk.strong, lw, c - lw); break;
    case 'coord': hLines(c / 2.5, sk.rule); vLines(c / 2.5, sk.rule); hLines(c * 2, sk.strong); vLines(c * 2, sk.strong); break;
    case 'four': for (let y = 0; y < h; y += c * 2.5) { ctx.fillStyle = sk.strong; for (let k = 1; k <= 4; k++) ctx.fillRect(0, Math.round(y + k * c * .5 - lw), w, lw); ctx.fillStyle = sk.rule; ctx.fillRect(0, Math.round(y + c * 2.5 - 2 * lw), w, 2 * lw); } break;
    case 'tian': {
      hLines(c * 2, sk.strong, 1.5 * lw); vLines(c * 2, sk.strong, 1.5 * lw);
      ctx.save(); ctx.strokeStyle = sk.rule; ctx.lineWidth = lw; ctx.setLineDash([4 * lw, 4 * lw]); ctx.beginPath();
      for (let y = c; y < h; y += c * 2) { ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
      for (let x = c; x < w; x += c * 2) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
      ctx.stroke(); ctx.restore(); break;
    }
  }
}

const visible = (s: Stroke) => s.layer !== 'private';

/** 图片和公式先加载好：draw() 是同步的，没加载好只会画占位框 */
async function preload(strokes: Stroke[]) {
  const tex = strokes.filter((s) => s.tex);
  if (tex.length) { const m = await texMeasurer(); for (const s of tex) m(s.tex!); }
  const imgs = [...new Set(strokes.filter((s) => s.tool === 'image' && s.img).map((s) => s.img!))];
  const t0 = performance.now();
  while (imgs.some((src) => boardImage(src) === undefined) && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 60));
}

/** 一段板面：页面坐标 [top, top + height)（按页宽计），画到 ctx 的 y0 像素处 */
function paintSlice(ctx: CanvasRenderingContext2D, strokes: Stroke[], top: number, height: number, y0: number, sk: Skin, board: BoardSkin, pattern: Pattern) {
  const W = EXPORT_W, H = Math.round(height * W);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y0, W, H); ctx.clip();
  ctx.fillStyle = sk.paper; ctx.fillRect(0, y0, W, H);
  // 底纹从页面顶上开始排：长黑板裁掉的上沿也要对齐
  ctx.save(); ctx.translate(0, y0 - (top * W) % (W / 32 * (pattern === 'four' ? 2.5 : pattern === 'tian' || pattern === 'coord' ? 2 : 1))); drawPattern(ctx, pattern, W, H + W / 8, sk); ctx.restore();
  ctx.setTransform(W, 0, 0, W, 0, y0 - top * W);
  const d: DrawCtx = { ctx, scale: W, dark: sk.dark, color: (id) => resolveColor(id, board, false) };
  for (const s of strokes) if (s.tool === 'image') draw(d, s);
  for (const s of strokes) if (s.tool !== 'image') draw(d, s);
  ctx.restore();
}

function toPng(canvas: HTMLCanvasElement) {
  try { return canvas.toDataURL('image/png'); }
  catch { throw new Error('板书里有外部图片，浏览器不允许导出。请把图片重新贴一次再保存'); }
  finally { canvas.width = 0; canvas.height = 0; }
}

/** 长黑板只导出写过的部分（下面留一点空白），至少一屏 */
export function longExtent(mat: Material, strokes: Stroke[]) {
  let bottom = 0;
  for (const s of strokes) { const b = selectionBounds([s]); if (Number.isFinite(b.y1)) bottom = Math.max(bottom, b.y1); }
  return Math.min(longRatio(mat), Math.max(SCREEN, bottom + SCREEN * .2));
}

/** 生成 PNG（data URL）。page：mode = 'page' 时导出哪一页 */
export async function boardPngs(mat: Material, page: number, mode: ExportMode): Promise<string[]> {
  const st = useStore.getState(), sk = skinOf(st.boardSkin), W = EXPORT_W;
  const inkOf = (i: number) => (st.ink[inkKey(mat.id, i)] ?? []).filter(visible);
  const make = (h: number) => { const c = document.createElement('canvas'); c.width = W; c.height = Math.max(1, Math.round(h)); return c; };

  if (isLong(mat)) {
    const strokes = inkOf(0); await preload(strokes);
    const total = longExtent(mat, strokes), per = MAX_H / W, out: string[] = [];
    for (let top = 0; top < total - 1e-6; top += per) {
      const h = Math.min(per, total - top), c = make(h * W);
      paintSlice(c.getContext('2d')!, strokes, top, h, 0, sk, st.boardSkin, st.pattern); out.push(toPng(c));
    }
    return out;
  }

  const pages = mat.pages.map((p, i) => ({ i, ratio: p.w > 0 ? p.h / p.w : SCREEN }));
  const pick = mode === 'page' ? pages.filter((p) => p.i === Math.min(page, pages.length - 1)) : pages;
  await preload(pick.flatMap((p) => inkOf(p.i)));
  if (mode !== 'stitch' || pick.length < 2) {
    return pick.map((p) => { const c = make(p.ratio * W); paintSlice(c.getContext('2d')!, inkOf(p.i), 0, p.ratio, 0, sk, st.boardSkin, st.pattern); return toPng(c); });
  }
  // 拼长图：页与页之间一道缝、右上角标页码；太长就分成几张
  const groups: typeof pick[] = [[]]; let h = 0;
  for (const p of pick) {
    const cur = groups.at(-1)!, add = p.ratio * W + (cur.length ? GAP : 0);
    if (cur.length && h + add > MAX_H) { groups.push([p]); h = p.ratio * W; } else { cur.push(p); h += add; }
  }
  return groups.map((g) => {
    const c = make(g.reduce((a, p, k) => a + p.ratio * W + (k ? GAP : 0), 0)), ctx = c.getContext('2d')!;
    ctx.fillStyle = sk.gap; ctx.fillRect(0, 0, c.width, c.height);
    let y = 0;
    for (const p of g) {
      paintSlice(ctx, inkOf(p.i), 0, p.ratio, y, sk, st.boardSkin, st.pattern);
      ctx.save(); ctx.font = '600 22px "Noto Sans SC", "Microsoft YaHei UI", sans-serif'; ctx.fillStyle = sk.label; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(`${p.i + 1} / ${pages.length}`, W - 22, y + 16); ctx.restore();
      y += p.ratio * W + GAP;
    }
    return toPng(c);
  });
}

/** 保存当前画面的板书。不是黑板（课件、网页、演示）时仍按学生画面截图保存 */
export async function saveBoard(mode: ExportMode = 'stitch'): Promise<string[] | null> {
  const st = useStore.getState(), mat = st.pgmMat;
  if (mat.kind !== 'board') { const f = await host.call<string | null>('exportBoard'); return f ? [f] : null; }
  const pngs = await boardPngs(mat, st.pgm.page, mode);
  return host.call<string[] | null>('exportBoard', { title: mat.title, pngs });
}
