# 1.7.0-A 工人乙：PDF 体积精简（扁平插图与渐变横幅调色板量化 / JPEG 择优、字体子集化 + 去除冗余 hinting 字节码、对象流压缩），文字层与矢量字形轮廓完全不变
import sys, os, io, fitz
from PIL import Image
from fontTools.ttLib import TTFont

COLORS = int(os.environ.get('PALETTE', '64'))
JPGQ = int(os.environ.get('JPGQ', '72'))

def best_stream(img):
    out = []
    q = img.convert('RGB').quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    b = io.BytesIO(); q.save(b, 'PNG', optimize=True, compress_level=9); out.append(b.getvalue())
    b = io.BytesIO(); img.convert('RGB').save(b, 'JPEG', quality=JPGQ, optimize=True); out.append(b.getvalue())
    return min(out, key=len)

def dehint_pdf_fonts(d):
    for xr in range(1, d.xref_length()):
        obj = d.xref_object(xr)
        if '/Length1 ' not in obj:
            continue
        raw = d.xref_stream(xr)
        if not raw or len(raw) < 4096:
            continue
        try:
            tt = TTFont(io.BytesIO(raw))
            for tag in ('fpgm', 'prep', 'cvt ', 'hdmx', 'VDMX', 'LTSH', 'gasp'):
                if tag in tt:
                    del tt[tag]
            if 'glyf' in tt:
                glyf = tt['glyf']
                for gname in glyf.keys():
                    g = glyf[gname]
                    if hasattr(g, 'removeHinting'):
                        g.removeHinting()
            out = io.BytesIO()
            tt.save(out)
            nb = out.getvalue()
            if len(nb) < len(raw):
                d.update_stream(xr, nb)
                d.xref_set_key(xr, 'Length1', str(len(nb)))
        except Exception:
            pass

def shrink(path):
    d = fitz.open(path)
    done = set()
    for page in d:
        for im in page.get_images(full=True):
            xref, smask = im[0], im[1]
            if xref in done or smask:
                continue
            done.add(xref)
            raw = d.xref_stream_raw(xref) or b''
            if len(raw) < 3 * 1024:
                continue
            pix = fitz.Pixmap(d, xref)
            if pix.alpha or pix.n != 3:
                continue
            img = Image.open(io.BytesIO(pix.tobytes('png')))
            s = best_stream(img)
            if len(s) < len(raw) * 0.92:
                page.replace_image(xref, stream=s)
    try:
        d.subset_fonts()
    except Exception as e:
        print('subset skip:', e)
    dehint_pdf_fonts(d)
    tmp = path + '.tmp'
    d.save(tmp, garbage=4, deflate=True, deflate_fonts=True, clean=True, use_objstms=1)
    d.close()
    before = os.path.getsize(path)
    if os.path.getsize(tmp) < before:
        os.replace(tmp, path)
    else:
        os.remove(tmp)
    print(f'{os.path.basename(path)}: {before // 1024} KB -> {os.path.getsize(path) // 1024} KB')

for p in sys.argv[1:]:
    shrink(p)
