"""把 macOS 版压缩包转成 .dmg 磁盘映像：双击就像插上一个 U 盘，把软件拖进「应用程序」即可，不用解压。

  py -3 scripts/make-dmg.py <mac zip> <out.dmg> [卷名]

在 Windows 上没有 hdiutil，所以自己写：
  1. 用 pycdlib 生成 ISO 9660 + Rock Ridge（保留可执行权限和符号链接，macOS 的 cd9660 驱动优先读 Rock Ridge）
     + Joliet（万一不读 Rock Ridge，至少文件名正确）；根目录多放一个指向 /Applications 的符号链接。
  2. 把 ISO 按 UDIF 格式（hdiutil 的 UDZO：zlib 分块压缩 + mish 块表 + koly 尾）打包成 .dmg。
  3. 写完后用本文件里的读取器把 .dmg 解回原始扇区，逐字节核对，再用 pycdlib 打开核对文件、权限和链接。
"""
import base64, io, os, plistlib, stat, struct, sys, tempfile, uuid, zipfile, zlib
from pathlib import Path

import pycdlib

SECTOR = 512
CHUNK = 0x800  # 每块 2048 个扇区（1 MiB）未压缩数据
README = """最强网课教辅系统 {version} · macOS 版（未经实机测试，遇到问题请到 QQ 群 1035471769 反馈）

安装（不用解压）：
  1. 把左边的「最强网课教辅系统」拖到右边的「Applications（应用程序）」文件夹上；
  2. 在「安装并打开.command」上点右键 → 打开 → 再点「打开」（只需要第一次），
     它会去掉系统的隔离标记并打开软件；以后从「启动台」或「应用程序」里直接打开。
  3. 如果第 2 步没反应：打开「终端」，输入下面两行（每行回车）：
       xattr -cr "/Applications/最强网课教辅系统.app"
       codesign --force --deep --sign - "/Applications/最强网课教辅系统.app"
  装好以后可以在访达左边栏「推出」这个磁盘映像。

macOS 版和 Windows 版的差别：
  · PPT / Word 课件直接打开：.pptx / .docx / .rtf 用内置排版显示；旧版 .ppt / .doc 会请 Keynote、Pages、
    PowerPoint 或 Word 帮忙导出（第一次会询问「是否允许控制」，请点「好」）；
  · 录课暂时只录画面和麦克风，不录电脑播放的声音；
  · 第一次录课时系统会询问「屏幕录制」权限，请在 系统设置 → 隐私与安全性 里允许。
"""


def build_iso(zip_path, iso_path, vol, version):
    z = zipfile.ZipFile(zip_path)
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=4, vol_ident=vol, sys_ident='MACOS', app_ident_str='CLASSROOMSTUDIO', joliet=3, rock_ridge='1.09')
    names = {}  # 目录 → 已用的 ISO 短名序号
    dirs = {'': '/'}

    def short(parent, is_dir):
        n = names.get(parent, 0) + 1
        names[parent] = n
        return ('D%05d' % n) if is_dir else ('F%05d.;1' % n)

    def ensure_dir(rel, mode=0o40755):
        if rel in dirs:
            return dirs[rel]
        parent, _, leaf = rel.rpartition('/')
        p = ensure_dir(parent)
        iso_p = (p.rstrip('/') + '/' + short(parent, True))
        iso.add_directory(iso_p, rr_name=leaf, joliet_path=joliet(rel), file_mode=mode)
        dirs[rel] = iso_p
        return iso_p

    def joliet(rel):
        return '/' + '/'.join(part[:64] for part in rel.split('/'))

    keep = []
    entries = sorted(z.infolist(), key=lambda i: (i.filename.rstrip('/').count('/'), i.filename))
    for info in entries:
        rel = info.filename.rstrip('/')
        mode = info.external_attr >> 16
        if info.is_dir():
            ensure_dir(rel, stat.S_IFDIR | (stat.S_IMODE(mode) or 0o755))
            continue
        parent, _, leaf = rel.rpartition('/')
        p = ensure_dir(parent)
        iso_p = p.rstrip('/') + '/' + short(parent, False)
        if stat.S_ISLNK(mode):
            target = z.read(info).decode('utf-8')
            iso.add_symlink(symlink_path=iso_p, rr_symlink_name=leaf, rr_path=target, joliet_path=joliet(rel))
            continue
        data = z.read(info)
        if rel == '先看我-macOS安装说明.txt':
            data = README.format(version=version).encode('utf-8')
        fp = io.BytesIO(data)
        keep.append(fp)
        iso.add_fp(fp, len(data), iso_path=iso_p, rr_name=leaf, joliet_path=joliet(rel), file_mode=stat.S_IFREG | (stat.S_IMODE(mode) or 0o644))
    iso.add_symlink(symlink_path='/' + short('', False), rr_symlink_name='Applications', rr_path='/Applications', joliet_path='/Applications')
    iso.write(iso_path)
    iso.close()


def crc(data, prev=0):
    return zlib.crc32(data, prev) & 0xFFFFFFFF


def build_udif(iso_path, dmg_path, name):
    size = os.path.getsize(iso_path)
    pad = (-size) % SECTOR
    sectors = (size + pad) // SECTOR
    chunks, data_crc, raw_crc, off = [], 0, 0, 0
    with open(iso_path, 'rb') as src, open(dmg_path, 'wb') as out:
        sec = 0
        while sec < sectors:
            n = min(CHUNK, sectors - sec)
            buf = src.read(n * SECTOR)
            if len(buf) < n * SECTOR:
                buf += b'\0' * (n * SECTOR - len(buf))
            raw_crc = crc(buf, raw_crc)
            if not buf.strip(b'\0'):
                chunks.append((0x00000002, sec, n, off, 0))  # 全零：不占空间
            else:
                comp = zlib.compress(buf, 9)
                out.write(comp)
                data_crc = crc(comp, data_crc)
                chunks.append((0x80000005, sec, n, off, len(comp)))
                off += len(comp)
            sec += n
        chunks.append((0xFFFFFFFF, sectors, 0, off, 0))
        mish = struct.pack('>4sIQQQIi', b'mish', 1, 0, sectors, 0, CHUNK + 8, -2) + b'\0' * 24
        mish += struct.pack('>II', 2, 32) + struct.pack('>I', raw_crc) + b'\0' * 124
        mish += struct.pack('>I', len(chunks))
        for t, s, c, o, l in chunks:
            mish += struct.pack('>IIQQQQ', t, 0, s, c, o, l)
        plist = {'resource-fork': {
            'blkx': [{'Attributes': '0x0050', 'CFName': name, 'Data': mish, 'ID': '-1', 'Name': name}],
            'plst': [{'Attributes': '0x0050', 'Data': b'\0' * 0x600, 'ID': '0', 'Name': ''}],
        }}
        xml = plistlib.dumps(plist, fmt=plistlib.FMT_XML)
        xml_off = off
        out.write(xml)
        master = crc(struct.pack('>I', raw_crc))
        koly = struct.pack('>4sIIIQQQQQII16sII', b'koly', 4, 512, 1, 0, 0, off, 0, 0, 1, 1, uuid.uuid4().bytes, 2, 32)
        koly += struct.pack('>I', data_crc) + b'\0' * 124
        koly += struct.pack('>QQ', xml_off, len(xml)) + b'\0' * 120
        koly += struct.pack('>II', 2, 32) + struct.pack('>I', master) + b'\0' * 124
        koly += struct.pack('>IQIII', 1, sectors, 0, 0, 0)
        assert len(koly) == 512, len(koly)
        out.write(koly)
    return sectors


def read_udif(dmg_path, out_path):
    """独立按格式把 .dmg 解回原始扇区（用来核对上面写的东西）。"""
    with open(dmg_path, 'rb') as f:
        f.seek(-512, 2)
        koly = f.read(512)
        sig, ver, hsize, flags = struct.unpack('>4sIII', koly[:16])
        assert sig == b'koly' and ver == 4 and hsize == 512
        data_len = struct.unpack('>Q', koly[32:40])[0]
        data_crc_type = struct.unpack('>I', koly[80:84])[0]
        data_crc = struct.unpack('>I', koly[88:92])[0]
        xml_off, xml_len = struct.unpack('>QQ', koly[216:232])
        assert struct.unpack('>II', koly[352:360]) == (2, 32)
        master_crc = struct.unpack('>I', koly[360:364])[0]
        sector_count = struct.unpack('>Q', koly[492:500])[0]
        f.seek(xml_off)
        pl = plistlib.loads(f.read(xml_len))
        blkx = pl['resource-fork']['blkx']
        assert len(blkx) == 1
        m = blkx[0]['Data']
        assert m[:4] == b'mish'
        total = struct.unpack('>Q', m[16:24])[0]
        raw_crc_want = struct.unpack('>I', m[72:76])[0]
        n = struct.unpack('>I', m[200:204])[0]
        assert total == sector_count
        f.seek(0)
        dcrc = crc(f.read(data_len))
        assert data_crc_type == 2 and dcrc == data_crc, 'data fork crc'
        assert master_crc == crc(struct.pack('>I', raw_crc_want)), 'master crc'
        rcrc = 0
        with open(out_path, 'wb') as o:
            for i in range(n):
                t, _, s, c, off, ln = struct.unpack('>IIQQQQ', m[204 + i * 40: 244 + i * 40])
                if t == 0xFFFFFFFF:
                    assert s == total
                    break
                if t == 0x80000005:
                    f.seek(off)
                    buf = zlib.decompress(f.read(ln))
                elif t in (0, 2):
                    buf = b'\0' * (c * SECTOR)
                else:
                    raise AssertionError('chunk type %x' % t)
                assert len(buf) == c * SECTOR and o.tell() == s * SECTOR
                rcrc = crc(buf, rcrc)
                o.write(buf)
        assert rcrc == raw_crc_want, 'blkx crc'


def verify(zip_path, iso_path):
    z = zipfile.ZipFile(zip_path)
    iso = pycdlib.PyCdlib()
    iso.open(iso_path)
    seen = 0
    for info in z.infolist():
        rel = info.filename.rstrip('/')
        mode = info.external_attr >> 16
        rec = iso.get_record(rr_path='/' + rel)
        rr = rec.rock_ridge
        if stat.S_ISLNK(mode):
            assert rr.is_symlink() and rr.symlink_path().decode() == z.read(info).decode(), rel
        elif info.is_dir():
            assert rec.is_dir(), rel
        else:
            assert stat.S_IMODE(rr.get_file_mode()) == (stat.S_IMODE(mode) or 0o644), (rel, oct(rr.get_file_mode()))
            if rel != '先看我-macOS安装说明.txt':
                b = io.BytesIO(); iso.get_file_from_iso_fp(b, rr_path='/' + rel)
                assert b.getvalue() == z.read(info), rel
        seen += 1
    app = iso.get_record(rr_path='/Applications').rock_ridge
    assert app.is_symlink() and app.symlink_path() == b'/Applications'
    iso.close()
    return seen


if __name__ == '__main__':
    zip_path, dmg_path = sys.argv[1], sys.argv[2]
    vol = sys.argv[3] if len(sys.argv) > 3 else 'CLASSROOMSTUDIO'
    version = Path(zip_path).stem.split('-')[1]
    tmp = Path(tempfile.mkdtemp(prefix='dmg-', dir=os.environ.get('CS_DMG_TMP')))
    iso = tmp / 'image.iso'
    build_iso(zip_path, str(iso), vol, version)
    sectors = build_udif(str(iso), dmg_path, 'whole disk (ISO9660 : 0)')
    back = tmp / 'back.iso'
    read_udif(dmg_path, str(back))
    with open(iso, 'rb') as a, open(back, 'rb') as b:
        while True:
            x = a.read(8 << 20); y = b.read(len(x))
            if not x:
                assert not b.read(1).strip(b'\0'), 'trailing data'
                break
            assert x == y, 'roundtrip mismatch'
    n = verify(zip_path, str(back))
    print('DMG', dmg_path, os.path.getsize(dmg_path), 'bytes', sectors, 'sectors', n, 'entries verified')
    for p in (iso, back):
        p.unlink()
    tmp.rmdir()
