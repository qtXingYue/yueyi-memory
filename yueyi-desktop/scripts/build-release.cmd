@echo off
setlocal
rem Yueyi one-click release build.
rem 1) copy esbuild to a normal directory (WorkBuddy workspace blocks it)
rem 2) vite build
rem 3) cargo release with isolated CARGO_TARGET_DIR

cd /d "%~dp0.."
set "ROOT=%CD%"
set "ESB_DIR=%TEMP%\yueyi-esbuild"
set "ESB=%ESB_DIR%\esbuild.exe"
set "CARGO_TARGET_DIR=%TEMP%\yueyi-target"

if not exist "%ESB%" (
  if not exist "%ESB_DIR%" mkdir "%ESB_DIR%"
  copy /Y "%ROOT%\node_modules\esbuild\node_modules\@esbuild\win32-x64\esbuild.exe" "%ESB%" >nul
  if errorlevel 1 (
    echo [FAIL] esbuild.exe not found. Run npm ci first.
    exit /b 1
  )
)

set "ESBUILD_BINARY_PATH=%ESB%"
echo [1/3] Frontend build...
call npm run build
if errorlevel 1 (
  echo [FAIL] frontend build failed
  exit /b 1
)

echo [2/3] Rust release build...
pushd src-tauri
call cargo build --release
set "CARGO_RESULT=%ERRORLEVEL%"
popd
if not "%CARGO_RESULT%"=="0" (
  echo [FAIL] rust build failed
  exit /b 1
)

echo [3/3] Done
echo EXE: %CARGO_TARGET_DIR%\release\yueyi-desktop.exe
echo Copy it to %%LOCALAPPDATA%%\Programs\YueyiApp\yueyi-desktop.exe
exit /b 0
