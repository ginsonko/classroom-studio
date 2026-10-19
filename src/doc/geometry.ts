export type Rect = [number, number, number, number];

export function clampRegion(b: number[]): Rect {
  const x = Math.max(0, Math.min(1, Number.isFinite(b[0]) ? b[0] : 0));
  const y = Math.max(0, Math.min(1, Number.isFinite(b[1]) ? b[1] : 0));
  return [x, y, Math.max(0, Math.min(1 - x, Number.isFinite(b[2]) ? b[2] : 0)), Math.max(0, Math.min(1 - y, Number.isFinite(b[3]) ? b[3] : 0))];
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - x, h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
  return w > 0 && h > 0 ? [x, y, w, h] : null;
}

/** v3 检测：优先蓝色标题条+均匀分隔线；只有几何符合时才等分，不盲目把 A4 切半。 */
export function detectSlideBoxes(data: Uint8ClampedArray, W: number, H: number, pw: number, ph: number): Rect[] {
  const blue = new Float64Array(H), flat = new Float64Array(H), light = new Float64Array(H), side = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    const sums = [0, 0, 0], sq = [0, 0, 0]; let nBlue = 0, sl = 0, sr = 0;
    for (let x = 0; x < W; x++) {
      const at = (y * W + x) * 4, r = data[at], g = data[at + 1], b = data[at + 2];
      const cs = [r, g, b];
      for (let c = 0; c < 3; c++) { sums[c] += cs[c]; sq[c] += cs[c] * cs[c]; }
      if (Math.max(r, g, b) - Math.min(r, g, b) > 50 && b > r + 30) nBlue++;
      if (x >= 1 && x <= 3) sl += Math.min(r, g, b);
      if (x >= W - 4 && x <= W - 2) sr += Math.min(r, g, b);
    }
    blue[y] = nBlue / W;
    flat[y] = sums.reduce((s, n, c) => s + Math.sqrt(Math.max(0, sq[c] / W - (n / W) ** 2)), 0) / 3;
    light[y] = (sums[0] + sums[1] + sums[2]) / (3 * W);
    side[y] = Math.min(sl, sr) / 3;
  }
  const filled = Array.from(side.keys()).filter((y) => side[y] < 244);
  if (!filled.length) return [[0, 0, 1, 1]];
  const top = filled[0], bottom = filled.at(-1)! + 1, starts = [top];
  for (let y = top + 8; y < bottom - 8; y++) {
    let sep = false;
    for (let k = Math.max(0, y - 6); k < y; k++) if (flat[k] < 12 && light[k] > 170) sep = true;
    const band = (blue[y] + blue[y + 1] + blue[y + 2] + blue[y + 3]) / 4 > .7;
    if (y - starts.at(-1)! > H * .15 && band && sep && blue[y - 1] < .5) { starts.push(y); y += 19; }
  }
  const out: Rect[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]; let e = starts[i + 1] ?? bottom;
    for (let k = 0; k < 6 && e - s > 10 && flat[e - 1] < 8 && light[e - 1] > 225; k++) e--;
    const h = (e - s) / H;
    if (h < .08) continue;
    let done = false;
    for (const asp of [9 / 16, 3 / 4]) {
      const ch = pw * asp / ph, n = Math.round(h / ch);
      if (n >= 2 && n <= 8 && Math.abs(h - n * ch) < .025) {
        for (let j = 0; j < n; j++) out.push(clampRegion([0, s / H + j * ch, 1, ch]));
        done = true; break;
      }
    }
    if (!done) out.push(clampRegion([0, s / H, 1, h]));
  }
  // 单块裁切无充分分隔证据，不截掉正文的页眉/页脚。
  return out.length > 1 ? out : [[0, 0, 1, 1]];
}
