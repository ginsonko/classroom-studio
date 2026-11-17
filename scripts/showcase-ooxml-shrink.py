# 1.7.0-A 工人乙：PPTX/DOCX/PNG 媒体精简——相同图片去重、公式小图 16 色量化、插图/长图无抖动调色板量化（保留透明）；XML 结构、动画、可编辑文字不变
import sys, os, io, re, zipfile, hashlib
from PIL import Image

COLORS = int(os.environ.get('PALETTE', '64'))

def quantize_png(data, colors=COLORS):
    img = Image.open(io.BytesIO(data)).convert('RGBA')
    q = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    b = io.BytesIO()
    q.save(b, 'PNG', optimize=True, compress_level=9)
    return b.getvalue()

def shrink(path):
    with zipfile.ZipFile(path) as zin:
        order = [i.filename for i in zin.infolist()]
        files = {n: zin.read(n) for n in order}
    for n in order:
        if re.search(r'^(ppt|word)/media/.+\.png$', n) and len(files[n]) >= 400:
            c = 16 if len(files[n]) < 12 * 1024 else COLORS
            q = quantize_png(files[n], colors=c)
            if len(q) < len(files[n]) * 0.96:
                files[n] = q
    rename, seen = {}, {}
    for n in order:
        if not re.search(r'^(ppt|word)/media/', n):
            continue
        h = hashlib.sha1(files[n]).hexdigest()
        if h in seen:
            rename[n] = seen[h]
            del files[n]
        else:
            seen[h] = n
    for n in list(files):
        if n.endswith('.rels') and rename:
            t = files[n].decode('utf8')
            for old, new in rename.items():
                t = t.replace('media/' + old.split('/media/')[1] + '"', 'media/' + new.split('/media/')[1] + '"')
            files[n] = t.encode('utf8')
    if rename:
        ct = '[Content_Types].xml'
        t = files[ct].decode('utf8')
        for old in rename:
            t = re.sub(r'<Override PartName="/' + re.escape(old) + r'"[^>]*/>', '', t)
        files[ct] = t.encode('utf8')
    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n in [n for n in order if n in files]:
            z.writestr(n, files[n])
    before = os.path.getsize(path)
    os.replace(tmp, path)
    print(f'{os.path.basename(path)}: {before // 1024} KB -> {os.path.getsize(path) // 1024} KB (dedup {len(rename)})')

def shrink_png_file(path):
    data = open(path, 'rb').read()
    q = quantize_png(data, colors=48)
    if len(q) < len(data):
        open(path, 'wb').write(q)
    print(f'{os.path.basename(path)}: {len(data) // 1024} KB -> {os.path.getsize(path) // 1024} KB')

for p in sys.argv[1:]:
    (shrink_png_file if p.lower().endswith('.png') else shrink)(p)
