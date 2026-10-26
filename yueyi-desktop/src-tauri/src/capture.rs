// ============ GDI 屏幕截图（Windows：全屏 / 活动窗口 / 区域） ============
#![cfg(windows)]

use std::io::BufWriter;
use std::path::PathBuf;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetDesktopWindow, GetForegroundWindow, GetSystemMetrics, GetTopWindow, GetWindow,
    GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    GW_HWNDNEXT, SM_CXSCREEN, SM_CXVIRTUALSCREEN, SM_CYSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

#[derive(Clone)]
pub struct CapturedImage {
    pub width: u32,
    pub height: u32,
    /// RGBA 像素（已在采集后原地完成 BGRA → RGBA 转换，避免保存时二次克隆）
    pub pixels: Vec<u8>,
}

#[derive(Debug, Default, Clone)]
pub struct BrowserContext {
    pub page_title: Option<String>,
    pub source_url: Option<String>,
}

/// 剥离浏览器窗口标题后缀，返回 (清理后的网页/视频标题, 浏览器类型标识)
fn parse_browser_window_title(raw_title: &str) -> Option<(String, &'static str)> {
    let t = raw_title.trim();
    if t.is_empty() {
        return None;
    }
    let suffixes: &[(&str, &str)] = &[
        (" - Google Chrome", "chrome"),
        (" - Chrome", "chrome"),
        (" - Microsoft\u{200b} Edge", "edge"),
        (" - Microsoft Edge", "edge"),
        (" - Mozilla Firefox", "firefox"),
        (" - Brave", "brave"),
        (" - Arc", "arc"),
    ];
    for (suf, kind) in suffixes {
        if let Some(stripped) = t.strip_suffix(suf) {
            let mut clean = stripped.trim().to_string();
            // Edge 常带 " - 个人" / " - 仕事" / "和另外 N 个页面"
            for extra in [" - 个人", " - Personal", " - Work"] {
                if let Some(s) = clean.strip_suffix(extra) {
                    clean = s.trim().to_string();
                }
            }
            if let Some(idx) = clean.find(" 和另外 ") {
                clean = clean[..idx].trim().to_string();
            }
            for audio in [" - Audio playing", " - 正在播放音频"] {
                if let Some(s) = clean.strip_suffix(audio) {
                    clean = s.trim().to_string();
                }
            }
            // 去除前缀消息计数如 "(2) "
            if clean.starts_with('(') {
                if let Some(close) = clean.find(") ") {
                    if clean[1..close].chars().all(|c| c.is_ascii_digit()) {
                        clean = clean[close + 2..].trim().to_string();
                    }
                }
            }
            if !clean.is_empty() {
                return Some((clean, kind));
            }
        }
    }
    None
}

/// 从本地 Chromium 内核浏览器（Chrome / Edge / Brave）的 History 数据库按标题反查最新访问 URL
/// 即使浏览器视频处于全屏播放状态（无地址栏），也能精确还原当前视频/网页 URL。
pub fn lookup_url_from_browser_history(page_title: &str, preferred_browser: &str) -> Option<String> {
    let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
    let base = PathBuf::from(local_app_data);

    let mut dirs: Vec<(&str, PathBuf)> = vec![
        ("chrome", base.join("Google").join("Chrome").join("User Data")),
        ("edge", base.join("Microsoft").join("Edge").join("User Data")),
        (
            "brave",
            base.join("BraveSoftware").join("Brave-Browser").join("User Data"),
        ),
    ];
    dirs.sort_by_key(|(k, _)| if *k == preferred_browser { 0 } else { 1 });

    let mut history_files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for (_, user_data) in dirs {
        if !user_data.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&user_data) {
            for e in entries.flatten() {
                let p = e.path().join("History");
                if p.is_file() {
                    let mtime = p
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    history_files.push((mtime, p));
                }
            }
        }
    }
    history_files.sort_by(|a, b| b.0.cmp(&a.0));

    // 生成去除了站点尾缀的核心标题（例如 "xxx - 哔哩哔哩" -> "xxx"）
    let core_title = page_title
        .split(" - ")
        .next()
        .unwrap_or(page_title)
        .split("_哔哩哔哩")
        .next()
        .unwrap_or(page_title)
        .trim();

    let tmp_db = std::env::temp_dir().join("yueyi_browser_hist_lookup.db");
    for (_, hist_path) in history_files.into_iter().take(4) {
        if std::fs::copy(&hist_path, &tmp_db).is_err() {
            continue;
        }
        if let Ok(conn) = rusqlite::Connection::open(&tmp_db) {
            // 1. 精确标题匹配
            if let Ok(url) = conn.query_row(
                "SELECT url FROM urls WHERE title = ?1 ORDER BY last_visit_time DESC LIMIT 1",
                rusqlite::params![page_title],
                |r| r.get::<_, String>(0),
            ) {
                if url.starts_with("http://") || url.starts_with("https://") {
                    return Some(url);
                }
            }
            // 2. 前缀 / 包含匹配（兼容视频播放页动态标题变化）
            if core_title.chars().count() >= 2 {
                let like_pat = format!("%{}%", core_title);
                if let Ok(url) = conn.query_row(
                    "SELECT url FROM urls
                     WHERE title LIKE ?1 OR (?2 LIKE '%' || title || '%' AND length(title) >= 3)
                     ORDER BY last_visit_time DESC LIMIT 1",
                    rusqlite::params![like_pat, page_title],
                    |r| r.get::<_, String>(0),
                ) {
                    if url.starts_with("http://") || url.starts_with("https://") {
                        return Some(url);
                    }
                }
            }
        }
    }
    None
}

/// 自动检测当前屏幕顶层浏览器窗口的标题与网址
pub fn detect_browser_context() -> BrowserContext {
    unsafe {
        let self_pid = std::process::id();
        let mut candidates: Vec<HWND> = Vec::new();
        let fg = GetForegroundWindow();
        if !fg.0.is_null() {
            candidates.push(fg);
        }
        let mut cur = GetTopWindow(HWND::default()).unwrap_or_default();
        let mut steps = 0;
        while !cur.0.is_null() && steps < 120 {
            steps += 1;
            if IsWindowVisible(cur).as_bool() && !IsIconic(cur).as_bool() {
                let mut pid = 0u32;
                GetWindowThreadProcessId(cur, Some(&mut pid));
                if pid != self_pid && !candidates.contains(&cur) {
                    candidates.push(cur);
                }
            }
            cur = GetWindow(cur, GW_HWNDNEXT).unwrap_or_default();
        }

        for hwnd in candidates {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == self_pid {
                continue;
            }
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                if (rect.right - rect.left) < 200 || (rect.bottom - rect.top) < 120 {
                    continue;
                }
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len <= 0 {
                continue;
            }
            let raw_title = String::from_utf16_lossy(&buf[..len as usize]);
            if let Some((page_title, browser_kind)) = parse_browser_window_title(&raw_title) {
                let source_url = lookup_url_from_browser_history(&page_title, browser_kind);
                return BrowserContext {
                    page_title: Some(page_title),
                    source_url,
                };
            }
        }
        BrowserContext::default()
    }
}

/// 获取鼠标光标所在显示器的矩形区域 (left, top, width, height)，多显示器自动跟随鼠标
pub fn get_cursor_monitor_rect() -> (i32, i32, i32, i32) {
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
            if !hmon.is_invalid() {
                let mut mi = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                if GetMonitorInfoW(hmon, &mut mi).as_bool() {
                    let r = mi.rcMonitor;
                    let w = (r.right - r.left).max(1);
                    let h = (r.bottom - r.top).max(1);
                    return (r.left, r.top, w, h);
                }
            }
        }
        let w = GetSystemMetrics(SM_CXSCREEN).max(1);
        let h = GetSystemMetrics(SM_CYSCREEN).max(1);
        (0, 0, w, h)
    }
}

/// 指定屏幕区域截图（支持多显示器虚拟桌面负坐标与跨屏区域，含锁屏/息屏安全降级）
pub fn capture_region(x: i32, y: i32, width: i32, height: i32) -> Result<CapturedImage, String> {
    unsafe {
        let mut hdc_screen = GetDC(HWND::default());
        if hdc_screen.is_invalid() {
            hdc_screen = GetDC(GetDesktopWindow());
        }

        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(GetSystemMetrics(SM_CXSCREEN)).max(1);
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(GetSystemMetrics(SM_CYSCREEN)).max(1);
        let v_right = vx + vw;
        let v_bottom = vy + vh;

        let rx = x.clamp(vx, (v_right - 1).max(vx));
        let ry = y.clamp(vy, (v_bottom - 1).max(vy));
        let rw = width.clamp(1, (v_right - rx).max(1));
        let rh = height.clamp(1, (v_bottom - ry).max(1));

        if hdc_screen.is_invalid() {
            // 极端无桌面会话兜底
            return Ok(CapturedImage {
                width: rw as u32,
                height: rh as u32,
                pixels: vec![20u8; (rw as usize) * (rh as usize) * 4],
            });
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbmp = CreateCompatibleBitmap(hdc_screen, rw, rh);
        let old = SelectObject(hdc_mem, HGDIOBJ::from(hbmp));

        let ok = BitBlt(
            hdc_mem,
            0,
            0,
            rw,
            rh,
            hdc_screen,
            rx,
            ry,
            SRCCOPY | CAPTUREBLT,
        )
        .or_else(|_| BitBlt(hdc_mem, 0, 0, rw, rh, hdc_screen, rx, ry, SRCCOPY));

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: rw,
                biHeight: -rh, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels = vec![0u8; (rw as usize) * (rh as usize) * 4];
        let ret = if ok.is_ok() {
            let lines = GetDIBits(
                hdc_mem,
                hbmp,
                0,
                rh as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            // 原地 BGRA → RGBA 转换（避免 save_png 时二次克隆大块像素内存）
            for px in pixels.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            lines
        } else {
            // 锁屏或显示器休眠时 GDI BitBlt 被系统拒绝，填充深色安全帧避免崩溃
            for px in pixels.chunks_exact_mut(4) {
                px[0] = 18;
                px[1] = 20;
                px[2] = 26;
                px[3] = 255;
            }
            rh
        };

        SelectObject(hdc_mem, old);
        let _ = DeleteObject(HGDIOBJ::from(hbmp));
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(HWND::default(), hdc_screen);

        if ret == 0 {
            return Err("GetDIBits 读取像素失败".into());
        }

        Ok(CapturedImage {
            width: rw as u32,
            height: rh as u32,
            pixels,
        })
    }
}

/// 全屏截图（自动截取鼠标当前所在的显示器，支持多显示器）
pub fn capture_full_screen() -> Result<CapturedImage, String> {
    let (mx, my, mw, mh) = get_cursor_monitor_rect();
    capture_region(mx, my, mw, mh)
}

/// 当前活动窗口截图（支持跨显示器/副屏窗口，若窗口尺寸异常则回退当前显示器全屏）
pub fn capture_active_window() -> Result<CapturedImage, String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.0.is_null() {
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                if w > 80 && h > 60 {
                    return capture_region(rect.left, rect.top, w, h);
                }
            }
        }
        capture_full_screen()
    }
}

/// 从已捕获的全屏快照中裁剪指定子区域（供可视化框选截图直接内存裁剪，毫秒级完成）
pub fn crop_captured_image(
    src: &CapturedImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<CapturedImage, String> {
    if src.width == 0 || src.height == 0 {
        return Err("源图像尺寸为空".into());
    }
    let cx = x.min(src.width.saturating_sub(1));
    let cy = y.min(src.height.saturating_sub(1));
    let cw = width.max(1).min(src.width.saturating_sub(cx));
    let ch = height.max(1).min(src.height.saturating_sub(cy));

    let mut out = Vec::with_capacity((cw as usize) * (ch as usize) * 4);
    let src_stride = (src.width as usize) * 4;
    let row_bytes = (cw as usize) * 4;

    for row in 0..ch {
        let sy = (cy + row) as usize;
        let start = sy * src_stride + (cx as usize) * 4;
        let end = start + row_bytes;
        if end <= src.pixels.len() {
            out.extend_from_slice(&src.pixels[start..end]);
        }
    }

    Ok(CapturedImage {
        width: cw,
        height: ch,
        pixels: out,
    })
}

/// 高性能保存 RGBA 像素为 PNG（使用 256KB BufWriter + Fast 压缩 + Sub 滤波器，大幅降低 2K/4K 编码耗时）
pub fn save_png(img: &CapturedImage, path: &PathBuf) -> Result<(), String> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::{ExtendedColorType, ImageEncoder};

    let expected_len = (img.width as usize)
        .checked_mul(img.height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or("像素缓冲尺寸溢出")?;
    if img.pixels.len() < expected_len {
        return Err("像素缓冲尺寸不匹配".into());
    }

    let file = std::fs::File::create(path).map_err(|e| format!("创建 PNG 文件失败: {}", e))?;
    let writer = BufWriter::with_capacity(256 * 1024, file);
    let encoder = PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::Sub);
    encoder
        .write_image(
            &img.pixels[..expected_len],
            img.width,
            img.height,
            ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("PNG 编码失败: {}", e))
}
