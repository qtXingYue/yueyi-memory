#!/usr/bin/env python
"""月忆 UI 回归截图工具（Windows）

用 PrintWindow 捕获「月忆」主窗口，不依赖第三方库：
    python scripts/capture-window.py out.png
可选：--theme night 只是提示，主题需在应用内切换。

捕获前会尝试把窗口置前；DPI 感知已开启，200% 缩放下仍输出完整尺寸。
"""
import ctypes
import struct
import sys
import time
import zlib
from ctypes import wintypes

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

u = ctypes.windll.user32
g = ctypes.windll.gdi32
out = sys.argv[1] if len(sys.argv) > 1 else "yueyi-window.png"
title = sys.argv[2] if len(sys.argv) > 2 else "月忆"

hwnd = u.FindWindowW("Tauri Window", title)
if not hwnd:
    raise SystemExit(f"找不到「{title}」窗口，请先启动应用")

u.ShowWindow(hwnd, 9)  # SW_RESTORE：即使窗口被最小化也能恢复后截图
u.SetForegroundWindow(hwnd)
time.sleep(1.0)


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


r = RECT()
u.GetWindowRect(hwnd, ctypes.byref(r))
w, h = r.right - r.left, r.bottom - r.top

hdc = u.GetWindowDC(hwnd)
mdc = g.CreateCompatibleDC(hdc)
bmp = g.CreateCompatibleBitmap(hdc, w, h)
g.SelectObject(mdc, bmp)
u.PrintWindow(hwnd, mdc, 2)  # PW_RENDERFULLCONTENT


class BIH(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long),
                ("biHeight", ctypes.c_long), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


bi = BIH()
bi.biSize = ctypes.sizeof(bi)
bi.biWidth = w
bi.biHeight = -h
bi.biPlanes = 1
bi.biBitCount = 32
bi.biCompression = 0
bi.biSizeImage = w * h * 4

buf = ctypes.create_string_buffer(w * h * 4)
g.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bi), 0)

raw = bytearray(buf.raw)
for i in range(0, len(raw), 4):
    raw[i], raw[i + 2] = raw[i + 2], raw[i]

rows = bytearray()
for y in range(h):
    rows.append(0)
    rows += raw[y * w * 4:(y + 1) * w * 4]


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(
        ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
    )


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(rows), 6))
png += chunk(b"IEND", b"")

with open(out, "wb") as f:
    f.write(png)

print(f"saved {out} ({w}x{h})")
