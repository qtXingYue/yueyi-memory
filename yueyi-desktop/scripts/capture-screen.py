#!/usr/bin/env python
"""Capture the visible 月忆 window area from the desktop (BitBlt), fallback-friendly."""
import ctypes, struct, sys, time, zlib
from ctypes import wintypes
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
u = ctypes.windll.user32
g = ctypes.windll.gdi32
out = sys.argv[1] if len(sys.argv) > 1 else "yueyi-screen.png"
hwnd = u.FindWindowW("Tauri Window", "月忆")
if not hwnd:
    raise SystemExit("no window")
u.ShowWindow(hwnd, 9)
u.SetForegroundWindow(hwnd)
time.sleep(1.2)
class RECT(ctypes.Structure):
    _fields_=[("left",ctypes.c_long),("top",ctypes.c_long),("right",ctypes.c_long),("bottom",ctypes.c_long)]
r=RECT(); u.GetWindowRect(hwnd, ctypes.byref(r))
w,h=r.right-r.left,r.bottom-r.top
sdc=u.GetDC(0); mdc=g.CreateCompatibleDC(sdc); bmp=g.CreateCompatibleBitmap(sdc,w,h); g.SelectObject(mdc,bmp)
g.BitBlt(mdc,0,0,w,h,sdc,r.left,r.top,0x00CC0020)
class BIH(ctypes.Structure):
    _fields_=[("biSize",wintypes.DWORD),("biWidth",ctypes.c_long),("biHeight",ctypes.c_long),("biPlanes",wintypes.WORD),("biBitCount",wintypes.WORD),("biCompression",wintypes.DWORD),("biSizeImage",wintypes.DWORD),("biXPelsPerMeter",ctypes.c_long),("biYPelsPerMeter",ctypes.c_long),("biClrUsed",wintypes.DWORD),("biClrImportant",wintypes.DWORD)]
bi=BIH(); bi.biSize=ctypes.sizeof(bi); bi.biWidth=w; bi.biHeight=-h; bi.biPlanes=1; bi.biBitCount=32; bi.biCompression=0; bi.biSizeImage=w*h*4
buf=ctypes.create_string_buffer(w*h*4); g.GetDIBits(mdc,bmp,0,h,buf,ctypes.byref(bi),0)
raw=bytearray(buf.raw)
for i in range(0,len(raw),4): raw[i],raw[i+2]=raw[i+2],raw[i]
rows=bytearray()
for y in range(h): rows.append(0); rows+=raw[y*w*4:(y+1)*w*4]
def chunk(tag,data): return struct.pack(">I",len(data))+tag+data+struct.pack(">I",zlib.crc32(tag+data)&0xFFFFFFFF)
png=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,6,0,0,0))+chunk(b"IDAT",zlib.compress(bytes(rows),6))+chunk(b"IEND",b"")
open(out,"wb").write(png); print(f"saved {out} ({w}x{h})")
