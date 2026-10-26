#!/bin/bash
# Yueyi Desktop 构建辅助：包装 cargo，注入 MSVC + A盘 SDK + Rust 工具链环境
# 用法: ./cargo.sh <cargo args...>   例: ./cargo.sh build / check / tauri dev

TOOLCHAIN_BIN="$USERPROFILE/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin"
MSVC_BIN="/c/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64"

# 转成 Windows 路径
win_path() {
  echo "$1" | sed -e 's|^/c/|C:/|' -e 's|^/a/|A:/|' -e 's|^/|/|'
}

export PATH="$TOOLCHAIN_BIN:$MSVC_BIN:$PATH"
export RUSTC="$TOOLCHAIN_BIN/rustc.exe"
export CARGO="$TOOLCHAIN_BIN/cargo.exe"
export WindowsSdkDir='A:\Windows Kits\10'
export WindowsSDKVersion='10.0.26100.0\'

exec "$TOOLCHAIN_BIN/cargo.exe" "$@"
