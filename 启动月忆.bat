@echo off
chcp 65001 >nul
rem 2026-10-03：月忆正式启动器。
rem 部署目录必须为纯 ASCII（中文路径会导致 WebView2 白屏），
rem 且不能放在 WorkBuddy 工作目录下（该目录被安全策略标记，
rem 从那里启动的进程无法打开浏览器）。
start "" "C:\Users\31287\AppData\Local\Programs\YueyiApp\yueyi-desktop.exe"
exit
