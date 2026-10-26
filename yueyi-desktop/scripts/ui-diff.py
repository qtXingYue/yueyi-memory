#!/usr/bin/env python
"""离线视觉回归：比较两张窗口截图，输出差异比例与差异图。

不依赖 Pillow / Playwright，只支持本项目 capture-window.py 产出的
8-bit RGB/RGBA、非隔行 PNG（这正是 WebView2 截图的格式）。

用法：
    python scripts/ui-diff.py baseline.png current.png
    python scripts/ui-diff.py baseline.png current.png --threshold 0.005 --pixel 8 --out diff.png

退出码：
    0 = 通过（差异像素占比 <= threshold）
    1 = 超标
    2 = 参数/格式错误
"""
import argparse
import struct
import sys
import zlib


def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} 不是 PNG")
    pos = 8
    width = height = bitdepth = colortype = interlace = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bitdepth, colortype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    if bitdepth != 8 or colortype not in (2, 6) or interlace != 0:
        raise ValueError(f"仅支持 8-bit RGB/RGBA 非隔行 PNG（当前 bit={bitdepth}, color={colortype}）")
    bpp = 4 if colortype == 6 else 3
    raw = zlib.decompress(bytes(idat))
    stride = width * bpp
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(height):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(a + b - c - a), abs(a + b - c - b), abs(a + b - c - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif f != 0:
            raise ValueError(f"未知 PNG 过滤器 {f}")
        out += line
        prev = line
    return width, height, bpp, bytes(out)


def write_png(path, width, height, rgba):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        rows += rgba[y * stride:(y + 1) * stride]
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("baseline")
    ap.add_argument("current")
    ap.add_argument("--threshold", type=float, default=0.005,
                    help="允许的差异像素占比（默认 0.5%%）")
    ap.add_argument("--pixel", type=int, default=8,
                    help="单像素判定的通道差阈值（默认 8）")
    ap.add_argument("--out", default="", help="输出差异图路径（可选）")
    args = ap.parse_args()

    try:
        w1, h1, bpp1, a = read_png(args.baseline)
        w2, h2, bpp2, b = read_png(args.current)
    except Exception as e:
        print(f"读取失败：{e}")
        return 2

    if (w1, h1) != (w2, h2):
        print(f"尺寸不一致：baseline {w1}x{h1} vs current {w2}x{h2}")
        if args.out:
            print("尺寸不同，未生成差异图")
        return 1

    total = w1 * h1
    diff = 0
    sum_delta = 0
    diff_rgba = bytearray(total * 4)

    for i in range(total):
        o1 = i * bpp1
        o2 = i * bpp2
        dr = abs(a[o1] - b[o2])
        dg = abs(a[o1 + 1] - b[o2 + 1])
        db = abs(a[o1 + 2] - b[o2 + 2])
        delta = max(dr, dg, db)
        sum_delta += dr + dg + db
        changed = delta > args.pixel
        if changed:
            diff += 1
        o = i * 4
        if changed:
            diff_rgba[o:o + 4] = bytes((255, 64, 64, 255))
        else:
            lum = (a[o1] * 30 + a[o1 + 1] * 59 + a[o1 + 2] * 11) // 100
            dim = 40 + lum * 35 // 100
            diff_rgba[o:o + 4] = bytes((dim, dim, dim, 255))

    ratio = diff / total if total else 0
    mean_delta = sum_delta / (total * 3) if total else 0
    print(f"尺寸 {w1}x{h1} · 差异像素 {diff}/{total}（{ratio:.3%}）· 平均通道差 {mean_delta:.2f}")
    print(f"阈值：像素差 > {args.pixel}，占比 <= {args.threshold:.3%}")

    if args.out:
        write_png(args.out, w1, h1, diff_rgba)
        print(f"差异图：{args.out}")

    if ratio > args.threshold:
        print("结果：FAIL")
        return 1
    print("结果：PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
