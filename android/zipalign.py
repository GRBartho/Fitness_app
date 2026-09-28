"""Repackage an APK adding classes.dex, with stored entries 4-byte aligned
(and .so files page-aligned), like the SDK's zipalign."""
import sys, zipfile

src, dex, out = sys.argv[1:4]
NO_COMPRESS = ('.png', '.arsc', '.jpg', '.webp')

with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, 'w') as zout:
    items = [(i.filename, zin.read(i.filename)) for i in zin.infolist()]
    items.insert(1 if items and items[0][0] == 'AndroidManifest.xml' else 0, ('classes.dex', open(dex, 'rb').read()))
    for name, data in items:
        zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        stored = name.endswith(NO_COMPRESS)
        zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
        if stored:
            align = 4096 if name.endswith('.so') else 4
            data_start = zout.fp.tell() + 30 + len(name.encode())
            zi.extra = b'\0' * ((align - data_start % align) % align)
        zout.writestr(zi, data)
