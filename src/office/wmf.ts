// 精简的 WMF 播放器：直接画到 canvas。专门照顾 MathType 公式预览图的写法——
// 文字用 SetTextAlign(TA_UPDATECP) + MoveTo 定位、ExtTextOut 带逐字间距、希腊字母用 Greek 字符集、运算符用 Symbol 字体。
// 通用的线条、多边形、矩形、椭圆和嵌入的位图也能画，够显示 Word / PPT 里常见的旧式剪贴画。

const SYMBOL: Record<number, string> = {};
// Symbol 字体的 0x20–0xFE 对应的 Unicode 字符；没列出的按原样
const SYMBOL_ROWS: [number, string][] = [
  [0x22, '∀'], [0x24, '∃'], [0x27, '∋'], [0x2a, '∗'], [0x2d, '−'], [0x40, '≅'],
  [0x41, 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'], [0x5c, '∴'], [0x5e, '⊥'], [0x60, '‾'],
  [0x61, 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'], [0x7e, '∼'],
  [0xa0, '€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊〈®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪'],
  [0xf1, '〉∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭'],
];
for (const [start, chars] of SYMBOL_ROWS) [...chars].forEach((c, i) => { SYMBOL[start + i] = c; });

const CHARSET: Record<number, string> = {
  0: 'windows-1252', 1: 'windows-1252', 161: 'windows-1253', 162: 'windows-1254', 177: 'windows-1255', 178: 'windows-1256',
  186: 'windows-1257', 204: 'windows-1251', 238: 'windows-1250', 222: 'windows-874', 163: 'windows-1258',
  134: 'gbk', 136: 'big5', 128: 'shift_jis', 129: 'euc-kr',
};
const DBCS = new Set([134, 136, 128, 129]);

type Pen = { kind: 'pen'; style: number; width: number; color: string };
type Brush = { kind: 'brush'; style: number; color: string };
type Font = { kind: 'font'; height: number; weight: number; italic: boolean; charset: number; face: string; escapement: number };
type Obj = Pen | Brush | Font | { kind: 'other' };
type State = {
  wx: number; wy: number; wex: number; wey: number;
  pen: Pen; brush: Brush; font: Font; textColor: string; bkColor: string; bkMode: number; align: number; fill: CanvasFillRule;
  cx: number; cy: number;
};

const color = (dv: DataView, at: number) => `rgb(${dv.getUint8(at)},${dv.getUint8(at + 1)},${dv.getUint8(at + 2)})`;

function decodeText(bytes: Uint8Array, font: Font): { chars: string[]; widths: number[] } {
  // widths[i] = 字符 i 占的字节数（ExtTextOut 的间距数组按字节给）
  const symbol = font.charset === 2 || /^symbol$/i.test(font.face);
  if (symbol) return { chars: [...bytes].map((b) => SYMBOL[b] ?? String.fromCharCode(b)), widths: bytes.length ? [...bytes].map(() => 1) : [] };
  const label = CHARSET[font.charset] ?? 'windows-1252';
  if (!DBCS.has(font.charset)) {
    const s = new TextDecoder(label).decode(bytes);
    return { chars: [...s], widths: [...s].map(() => 1) };
  }
  const chars: string[] = [], widths: number[] = [], dec = new TextDecoder(label);
  for (let i = 0; i < bytes.length;) {
    const n = bytes[i] >= 0x81 && i + 1 < bytes.length ? 2 : 1;
    chars.push(dec.decode(bytes.subarray(i, i + n))); widths.push(n); i += n;
  }
  return { chars, widths };
}

function family(face: string) {
  const f = face.replace(/["\\]/g, '');
  if (/^symbol$/i.test(f) || /^mt extra/i.test(f)) return '"Times New Roman", "STIX Two Math", "Cambria Math", serif';
  return `"${f}", "Times New Roman", "PingFang SC", "Songti SC", serif`;
}

/** DIB（位图信息头 + 像素）补上文件头变成 BMP，交给浏览器解码 */
async function dibImage(dib: Uint8Array) {
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = dv.getUint32(0, true);
  let colors = 0;
  if (headerSize >= 40) {
    const bits = dv.getUint16(14, true), compression = dv.getUint32(16, true), used = dv.getUint32(32, true);
    colors = (used || (bits <= 8 ? 1 << bits : 0)) * 4 + (compression === 3 && headerSize === 40 ? 12 : 0);
  } else if (headerSize === 12) {
    const bits = dv.getUint16(10, true);
    colors = (bits <= 8 ? 1 << bits : 0) * 3;
  }
  const file = new Uint8Array(14 + dib.length), fv = new DataView(file.buffer);
  file[0] = 0x42; file[1] = 0x4d; fv.setUint32(2, file.length, true); fv.setUint32(10, 14 + headerSize + colors, true);
  file.set(dib, 14);
  return createImageBitmap(new Blob([file], { type: 'image/bmp' }));
}

/** 可放置 WMF（带 0x9AC6CDD7 头）→ PNG。不认识的格式返回 null */
export async function wmfToPng(data: Uint8Array, maxScale = 3): Promise<Uint8Array | null> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 40 || dv.getUint32(0, true) !== 0x9ac6cdd7) return null;
  const left = dv.getInt16(6, true), top = dv.getInt16(8, true), right = dv.getInt16(10, true), bottom = dv.getInt16(12, true);
  const inch = dv.getUint16(14, true) || 1440;
  const W = Math.max(1, Math.abs(right - left) / inch * 96), H = Math.max(1, Math.abs(bottom - top) / inch * 96);
  const scale = Math.max(1, Math.min(maxScale, 4096 / Math.max(W, H)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * scale); canvas.height = Math.ceil(H * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const black = 'rgb(0,0,0)';
  let st: State = {
    wx: left, wy: top, wex: right - left || 1, wey: bottom - top || 1,
    pen: { kind: 'pen', style: 0, width: 0, color: black }, brush: { kind: 'brush', style: 0, color: 'rgb(255,255,255)' },
    font: { kind: 'font', height: 12, weight: 400, italic: false, charset: 0, face: 'Times New Roman', escapement: 0 },
    textColor: black, bkColor: 'rgb(255,255,255)', bkMode: 2, align: 0, fill: 'evenodd', cx: 0, cy: 0,
  };
  const stack: State[] = [], objects: (Obj | null)[] = [];
  const X = (x: number) => (x - st.wx) / st.wex * W, Y = (y: number) => (y - st.wy) / st.wey * H;
  const sx = () => Math.abs(W / st.wex), sy = () => Math.abs(H / st.wey);
  const add = (o: Obj) => { const i = objects.indexOf(null); if (i >= 0) objects[i] = o; else objects.push(o); };
  const stroke = () => { if (st.pen.style === 5) return; ctx.lineWidth = Math.max(0.6, st.pen.width * sx()); ctx.strokeStyle = st.pen.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); };
  const fill = () => { if (st.brush.style === 1) return; ctx.fillStyle = st.brush.color; ctx.fill(st.fill); };
  const points = (at: number, n: number) => { ctx.moveTo(X(dv.getInt16(at, true)), Y(dv.getInt16(at + 2, true))); for (let i = 1; i < n; i++) ctx.lineTo(X(dv.getInt16(at + i * 4, true)), Y(dv.getInt16(at + i * 4 + 2, true))); };

  const text = (x: number, y: number, bytes: Uint8Array, dx: number[] | null, opts: number, rect: number[] | null) => {
    const f = st.font, { chars, widths } = decodeText(bytes, f);
    if (!chars.length) return;
    const updateCp = (st.align & 1) !== 0;
    if (updateCp) { x = st.cx; y = st.cy; }
    if (rect && (opts & 2)) { ctx.fillStyle = st.bkColor; ctx.fillRect(X(rect[0]), Y(rect[1]), X(rect[2]) - X(rect[0]), Y(rect[3]) - Y(rect[1])); }
    const px = Math.abs(f.height) * sy() * (f.height > 0 ? 0.82 : 1) || 12;
    ctx.save();
    ctx.font = `${f.italic ? 'italic ' : ''}${f.weight >= 600 ? 'bold ' : ''}${px}px ${family(f.face)}`;
    ctx.fillStyle = st.textColor;
    const v = st.align & 24;
    ctx.textBaseline = v === 24 ? 'alphabetic' : v === 8 ? 'bottom' : 'top';
    const h = st.align & 6;
    // 每个字的横向位置（逻辑单位，相对起点）
    let offsets: number[], total: number;
    if (dx && dx.length >= widths.reduce((a, b) => a + b, 0)) {
      offsets = []; total = 0; let k = 0;
      for (const n of widths) { offsets.push(total); for (let j = 0; j < n; j++) total += dx[k++]; }
    } else {
      offsets = []; total = 0;
      for (const c of chars) { offsets.push(total); total += ctx.measureText(c).width / sx(); }
    }
    const dir = Math.sign(st.wex) || 1;
    const start = h === 2 ? x - total * dir : h === 6 ? x - total * dir / 2 : x;
    const ox = X(start), oy = Y(y);
    if (f.escapement) { ctx.translate(ox, oy); ctx.rotate(-f.escapement / 10 * Math.PI / 180); ctx.translate(-ox, -oy); }
    if (st.bkMode === 2 && !(opts & 2)) { /* 不透明背景：MathType 不用，跳过以免盖住相邻符号 */ }
    chars.forEach((c, i) => ctx.fillText(c, X(start + offsets[i] * dir), oy));
    ctx.restore();
    if (updateCp) { if (h === 0) st.cx = x + total * dir; else if (h === 2) st.cx = x - total * dir; }
  };

  let p = 22;
  if (p + 18 > data.length) return null;
  p += dv.getUint16(p + 2, true) * 2;
  let drawn = 0;
  while (p + 6 <= data.length) {
    const size = dv.getUint32(p, true) * 2, fn = dv.getUint16(p + 4, true), a = p + 6;
    if (size < 6 || p + size > data.length) break;
    const i16 = (k: number) => dv.getInt16(a + k * 2, true);
    switch (fn) {
      case 0x0000: p = data.length; continue;
      case 0x020b: st.wy = i16(0); st.wx = i16(1); break; // SetWindowOrg
      case 0x020c: st.wey = i16(0) || 1; st.wex = i16(1) || 1; break; // SetWindowExt
      case 0x0209: st.textColor = color(dv, a); break;
      case 0x0201: st.bkColor = color(dv, a); break;
      case 0x0102: st.bkMode = i16(0); break;
      case 0x012e: st.align = dv.getUint16(a, true); break;
      case 0x0106: st.fill = i16(0) === 2 ? 'nonzero' : 'evenodd'; break;
      case 0x001e: stack.push({ ...st }); break; // SaveDC
      case 0x0127: { const n = i16(0); const k = n < 0 ? -n : 1; for (let j = 0; j < k && stack.length; j++) st = stack.pop()!; break; }
      case 0x02fa: add({ kind: 'pen', style: dv.getUint16(a, true) & 0xff, width: i16(1), color: color(dv, a + 6) }); break;
      case 0x02fc: add({ kind: 'brush', style: dv.getUint16(a, true), color: color(dv, a + 2) }); break;
      case 0x02fb: {
        let face = '';
        for (let k = 18; k < Math.min(50, size - 6) && data[a + k]; k++) face += String.fromCharCode(data[a + k]);
        add({ kind: 'font', height: i16(0), escapement: i16(2), weight: i16(4), italic: data[a + 10] !== 0, charset: data[a + 13], face: face || 'Times New Roman' });
        break;
      }
      case 0x00f7: case 0x01f9: case 0x0142: case 0x06ff: add({ kind: 'other' }); break; // 调色板、图案画刷、区域：占对象槽位
      case 0x012d: { const o = objects[dv.getUint16(a, true)]; if (o?.kind === 'pen') st.pen = o; else if (o?.kind === 'brush') st.brush = o; else if (o?.kind === 'font') st.font = o; break; }
      case 0x01f0: { const k = dv.getUint16(a, true); if (k < objects.length) objects[k] = null; break; }
      case 0x0214: st.cy = i16(0); st.cx = i16(1); break; // MoveTo
      case 0x0213: { const y = i16(0), x = i16(1); ctx.beginPath(); ctx.moveTo(X(st.cx), Y(st.cy)); ctx.lineTo(X(x), Y(y)); stroke(); st.cx = x; st.cy = y; drawn++; break; }
      case 0x0325: { ctx.beginPath(); points(a + 2, i16(0)); stroke(); drawn++; break; } // Polyline
      case 0x0324: { ctx.beginPath(); points(a + 2, i16(0)); ctx.closePath(); fill(); stroke(); drawn++; break; } // Polygon
      case 0x0538: { // PolyPolygon
        const n = i16(0); let at = a + 2 + n * 2;
        ctx.beginPath();
        for (let k = 0; k < n; k++) { const c = i16(1 + k); points(at, c); ctx.closePath(); at += c * 4; }
        fill(); stroke(); drawn++; break;
      }
      case 0x041b: case 0x061c: { // Rectangle / RoundRect（圆角按直角画）
        const o = fn === 0x061c ? 2 : 0, b = i16(o), r = i16(o + 1), t = i16(o + 2), l = i16(o + 3);
        ctx.beginPath(); ctx.rect(X(l), Y(t), X(r) - X(l), Y(b) - Y(t)); fill(); stroke(); drawn++; break;
      }
      case 0x0418: { // Ellipse
        const b = i16(0), r = i16(1), t = i16(2), l = i16(3);
        ctx.beginPath(); ctx.ellipse((X(l) + X(r)) / 2, (Y(t) + Y(b)) / 2, Math.abs(X(r) - X(l)) / 2, Math.abs(Y(b) - Y(t)) / 2, 0, 0, Math.PI * 2); fill(); stroke(); drawn++; break;
      }
      case 0x0521: { // TextOut
        const len = i16(0), bytes = data.subarray(a + 2, a + 2 + len), at = a + 2 + len + (len % 2);
        text(dv.getInt16(at + 2, true), dv.getInt16(at, true), bytes, null, 0, null); drawn++; break;
      }
      case 0x0a32: { // ExtTextOut
        const y = i16(0), x = i16(1), len = i16(2), opts = dv.getUint16(a + 6, true);
        let at = a + 8, rect: number[] | null = null;
        if (opts & 6 && size - 6 >= 8 + 8 + len) { rect = [dv.getInt16(at, true), dv.getInt16(at + 2, true), dv.getInt16(at + 4, true), dv.getInt16(at + 6, true)]; at += 8; }
        const bytes = data.subarray(at, at + len); at += len + (len % 2);
        const dx: number[] = [];
        while (dx.length < len && at + 2 <= p + size) { dx.push(dv.getInt16(at, true)); at += 2; }
        text(x, y, bytes, dx.length === len ? dx : null, opts, rect); drawn++; break;
      }
      case 0x0f43: case 0x0b41: case 0x0940: { // StretchDIB / DIBStretchBlt / DIBBitBlt
        let k = 2; // 跳过光栅操作码
        if (fn === 0x0f43) k++; // colorUsage
        const fields = fn === 0x0940 ? 6 : 8;
        const v = Array.from({ length: fields }, (_, j) => i16(k + j));
        const dib = data.subarray(a + (k + fields) * 2, p + size);
        if (dib.length < 40) break;
        const [dh, dw, dy, dxx] = fn === 0x0940 ? [v[2], v[3], v[4], v[5]] : [v[4], v[5], v[6], v[7]];
        try { const img = await dibImage(dib); ctx.drawImage(img, X(dxx), Y(dy), X(dxx + dw) - X(dxx), Y(dy + dh) - Y(dy)); img.close(); drawn++; } catch { /* 位图坏了就跳过 */ }
        break;
      }
      default: break;
    }
    p += size;
  }
  if (!drawn) return null;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
