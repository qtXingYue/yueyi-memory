// ============ 应用主入口：窗口 / 托盘 / 快捷键 / 捕获命令 ============

mod ai;
mod capture;
mod commands;
mod transfer;
mod ocr;
mod prompts;
mod state;
mod worker;

use state::{AppState, init_state};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WindowEvent,
};

/// URL percent 解码
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 在资源管理器中打开目录
pub fn open_in_explorer(path: &std::path::Path) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .arg(path)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
}

/// 在系统默认浏览器中打开外部链接（GUI 命令入口）。
/// 修复记录（2026-10-02）：本机实测直调 chrome.exe 子进程会秒退、
/// 在系统默认浏览器中打开外部链接，并把浏览器窗口带到前台。
///
/// 诊断结论（2026-10-02，Chrome 历史记录证实）：URL 每次都成功交给了系统
/// （Chrome 历史里能看到对应条目），真正的问题是浏览器窗口停在最小化状态、
/// 没有到前台，用户感知为"点了没反应"。因此：ShellExecuteW 打开 + 后台轮询激活。
/// 失败时返回真实错误，让前端能继续走下一级兜底。
#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    let raw = url.trim();
    if raw.is_empty() {
        return Err("链接为空".to_string());
    }
    let u = if !raw.starts_with("http://") && !raw.starts_with("https://") {
        format!("https://{}", raw)
    } else {
        raw.to_string()
    };

    // 800ms 内重复点同一链接直接忽略（防连点狂开标签页）
    {
        use std::sync::Mutex;
        use std::time::{Duration, Instant};
        static LAST: Mutex<Option<(String, Instant)>> = Mutex::new(None);
        if let Ok(mut last) = LAST.lock() {
            if let Some((lu, t)) = last.as_ref() {
                if *lu == u && t.elapsed() < Duration::from_millis(800) {
                    ui_report("open_external_url: debounced (same url within 800ms)".to_string());
                    return Ok(());
                }
            }
            *last = Some((u.clone(), Instant::now()));
        }
    }

    ui_report(format!("open_external_url: target={}", redacted_url(&u)));
    // open_url_in_browser 内部已把打开动作挪进 console 子进程（cmd start），
    // 并自带 activate 轮询；GUI 进程无需再绕子进程或重复轮询。
    open_url_in_browser(&u);
    Ok(())
}

/// CLI 诊断金丝雀：写 temp 目录，绕开 data_dir 依赖（排查 --open-url 静默失败用）
pub fn cli_canary(msg: &str) {
    use std::io::Write;
    let p = std::env::temp_dir().join("yueyi-cli-canary.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let ts = chrono::Local::now().format("%H:%M:%S%.3f");
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
}




/// 修复 GUI 子系统进程的 stdio 句柄（NULL → NUL 设备）。
/// 根因（2026-10-03 实证）：windows_subsystem="windows" 的进程没有控制台，stdio
/// 句柄为 NULL。ShellExecuteW 内部是在**调用进程内** CreateProcess 启动浏览器
/// （并非 explorer 转交），浏览器启动器继承这些 NULL 句柄后 CRT/Chromium CHECK
/// 失败（退出码 0x80000003）→ "提交成功（返回 42）但浏览器没打开"。
/// 对照：Python（控制台进程、有效 stdio 管道）同样调用 ShellExecuteW 秒开 Chrome。
#[cfg(windows)]
fn fixup_stdio_handles() {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetStdHandle(nStdHandle: u32, hHandle: isize) -> i32;
        fn CreateFileW(
            lpFileName: *const u16,
            dwDesiredAccess: u32,
            dwShareMode: u32,
            lpSecurityAttributes: *const std::ffi::c_void,
            dwCreationDisposition: u32,
            dwFlagsAndAttributes: u32,
            hTemplateFile: isize,
        ) -> isize;
    }
    // STD_INPUT_HANDLE=(DWORD)-10 / STD_OUTPUT_HANDLE=-11 / STD_ERROR_HANDLE=-12
    const STD_INPUT_HANDLE: u32 = u32::MAX - 9;
    const STD_OUTPUT_HANDLE: u32 = u32::MAX - 10;
    const STD_ERROR_HANDLE: u32 = u32::MAX - 11;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const OPEN_EXISTING: u32 = 3;
    const INVALID_HANDLE_VALUE: isize = -1;

    let name: Vec<u16> = "NUL\0".encode_utf16().collect();
    let h = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            0,
        )
    };
    if h == 0 || h == INVALID_HANDLE_VALUE {
        ui_report("fixup_stdio_handles: open NUL device failed".to_string());
        return;
    }
    unsafe {
        SetStdHandle(STD_INPUT_HANDLE, h);
        SetStdHandle(STD_OUTPUT_HANDLE, h);
        SetStdHandle(STD_ERROR_HANDLE, h);
    }
    ui_report("fixup_stdio_handles: stdio -> NUL device ok".to_string());
}

/// 首选打开方式：通过「运行中的 explorer 窗口」拿到 explorer 进程内的
/// IShellDispatch2，让 ShellExecute 真正执行在 explorer.exe 里（月忆只做
/// COM 跨进程调用，不创建任何子进程），彻底绕开「GUI 父进程的毒传染一切
/// 子进程、浏览器启动器必崩」的问题。
///
/// 注：Shell.Application 在本机只有 InProcServer32 注册（无 LocalServer32），
/// CLSCTX_LOCAL_SERVER 会报 0x80040154；in-proc 模式下 ShellExecute 仍在月忆
/// 进程内执行、无效。ShellWindows 集合（CLSID_ShellWindows）返回的窗口对象
/// 是 explorer 进程内实例的跨进程代理，其 .Application 即 explorer 内的
/// Shell dispatch（VBScript 经典技巧）。
#[cfg(windows)]
#[allow(dead_code)]
fn open_via_explorer_windows(url: &str) -> Result<(), String> {
    use windows::core::{BSTR, IUnknown, Interface, VARIANT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IShellDispatch2, IShellWindows, IWebBrowser2, ShellWindows};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        // 注意：ShellWindows 只有 LocalServer32 注册（rundll32 SHCreateLocalServerRunDll），
        // 用 INPROC_SERVER 会报 0x80040154；必须用 LOCAL_SERVER（SCM 启动，与月忆无父子关系）
        let sw: IShellWindows =
            CoCreateInstance::<Option<&IUnknown>, IShellWindows>(&ShellWindows, None, CLSCTX_LOCAL_SERVER)
                .map_err(|e| format!("CoCreateInstance(ShellWindows) failed: {e}"))?;
        let count = sw
            .Count()
            .map_err(|e| format!("ShellWindows.Count failed: {e}"))?;
        if count == 0 {
            return Err("no running explorer/IE windows to hand off".into());
        }

        let sfile = BSTR::from(url);
        let args = VARIANT::default();
        let dir = VARIANT::default();
        let op = VARIANT::from("open");
        let show = VARIANT::from(1i32);

        let mut last_err = String::from("no window accepted ShellExecute");
        for i in 0..count {
            let idx = VARIANT::from(i);
            let disp = match sw.Item(&idx) {
                Ok(d) => d,
                Err(e) => {
                    last_err = format!("Item({i}) failed: {e}");
                    continue;
                }
            };
            let wb: IWebBrowser2 = match disp.cast() {
                Ok(w) => w,
                Err(e) => {
                    last_err = format!("Item({i}) cast IWebBrowser2 failed: {e}");
                    continue;
                }
            };
            let app = match wb.Application() {
                Ok(a) => a,
                Err(e) => {
                    last_err = format!("Item({i}).Application failed: {e}");
                    continue;
                }
            };
            let sh: IShellDispatch2 = match app.cast() {
                Ok(s) => s,
                Err(e) => {
                    last_err = format!("Item({i}) cast IShellDispatch2 failed: {e}");
                    continue;
                }
            };
            match sh.ShellExecute(&sfile, &args, &dir, &op, &show) {
                Ok(()) => return Ok(()),
                Err(e) => last_err = format!("Item({i}) ShellExecute failed: {e}"),
            }
        }
        Err(last_err)
    }
}

/// 读取注册表字符串值（REG_SZ / REG_EXPAND_SZ 自动展开）。root 用 HKEY 预定义常量。
#[cfg(windows)]
fn reg_get_string(root: isize, subkey: &str, value: Option<&str>) -> Option<String> {
    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            hkey: isize,
            lpSubKey: *const u16,
            lpValue: *const u16,
            dwFlags: u32,
            pdwType: *mut u32,
            pvData: *mut u8,
            pcbData: *mut u32,
        ) -> i32;
    }
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;
    let sub: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let val: Option<Vec<u16>> = value.map(|v| v.encode_utf16().chain(std::iter::once(0)).collect());
    let mut buf = vec![0u16; 2048];
    let mut cb: u32 = (buf.len() * 2) as u32;
    let rc = unsafe {
        RegGetValueW(
            root,
            sub.as_ptr(),
            val.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut u8,
            &mut cb,
        )
    };
    if rc != 0 {
        return None;
    }
    let n = (cb as usize / 2).min(buf.len());
    let s = String::from_utf16_lossy(&buf[..n]);
    let s = s.trim_end_matches('\0').trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// 直接启动系统默认浏览器打开 URL（不经过 cmd / shell 解析）。
/// 1. HKCU\...\UrlAssociations\https\UserChoice\ProgId → HKCR\<ProgId>\shell\open\command
///    例如 ChromeHTML → "C:\...\chrome.exe" --single-argument %1
/// 2. 注册表读不到时，按常见安装路径找 Chrome / Edge。
/// 浏览器进程用 Stdio::null()（有效的 NUL 句柄，规避 GUI 进程 NULL stdio 导致启动器崩溃），
/// 且不加 CREATE_NO_WINDOW（否则浏览器窗口可能无法正常显示）。
#[cfg(windows)]
fn launch_default_browser(url: &str) -> Result<String, String> {
    const HKCR: isize = 0x8000_0000u32 as i32 as isize;
    const HKCU: isize = 0x8000_0001u32 as i32 as isize;

    let spawn = |exe: &str, args: Vec<String>| -> Result<(), String> {
        let mut child = std::process::Command::new(exe)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn {exe} failed: {e}"))?;

        // 检查进程是否瞬间异常退出（例如遇到 Chrome 僵尸进程残留造成的 Profile 锁冲突 ExitCode 21）
        std::thread::sleep(std::time::Duration::from_millis(250));
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("{exe} exited immediately with code {:?}", status.code()));
                }
            }
            _ => {}
        }
        Ok(())
    };

    let mut failed_exes: Vec<String> = Vec::new();

    // 1. 注册表默认浏览器
    let scheme = if url.starts_with("http://") { "http" } else { "https" };
    let progid = reg_get_string(
        HKCU,
        &format!(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\{scheme}\UserChoice"),
        Some("ProgId"),
    );
    if let Some(progid) = progid.as_deref() {
        if let Some(cmdline) = reg_get_string(HKCR, &format!(r"{progid}\shell\open\command"), None) {
            // 拆出 exe 路径与参数模板
            let (exe, rest) = if let Some(stripped) = cmdline.strip_prefix('"') {
                match stripped.find('"') {
                    Some(end) => (stripped[..end].to_string(), stripped[end + 1..].to_string()),
                    None => (stripped.to_string(), String::new()),
                }
            } else {
                match cmdline.find(' ') {
                    Some(sp) => (cmdline[..sp].to_string(), cmdline[sp + 1..].to_string()),
                    None => (cmdline.clone(), String::new()),
                }
            };
            if std::path::Path::new(&exe).exists() {
                let mut args: Vec<String> = Vec::new();
                let mut has_placeholder = false;
                for tok in rest.split_whitespace() {
                    let t = tok.trim_matches('"');
                    if t == "%1" || t == "%L" || t == "%l" {
                        args.push(url.to_string());
                        has_placeholder = true;
                    } else if t.starts_with('%') {
                        // %* 等其他占位符丢弃
                    } else {
                        args.push(t.to_string());
                    }
                }
                if !has_placeholder {
                    args.push(url.to_string());
                }
                match spawn(&exe, args) {
                    Ok(()) => return Ok(format!("{progid} -> {exe}")),
                    Err(e) => {
                        ui_report(format!("launch_default_browser: default {exe} failed: {e}"));
                        failed_exes.push(exe.to_lowercase());
                    }
                }
            }
        }
    }

    // 2. 常见安装路径兜底（排除已失败的 exe）
    let mut candidates: Vec<String> = vec![
        r"C:\Program Files\Google\Chrome\Application\chrome.exe".into(),
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".into(),
    ];
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!(r"{local}\Google\Chrome\Application\chrome.exe"));
    }
    candidates.push(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe".into());
    candidates.push(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe".into());
    for exe in candidates {
        if failed_exes.iter().any(|f| f.eq_ignore_ascii_case(&exe)) {
            continue;
        }
        if std::path::Path::new(&exe).exists() {
            match spawn(&exe, vec!["--single-argument".into(), url.to_string()]) {
                Ok(()) => return Ok(format!("fallback path -> {exe}")),
                Err(e) => {
                    ui_report(format!("launch_default_browser: candidate {exe} failed: {e}"));
                    failed_exes.push(exe.to_lowercase());
                }
            }
        }
    }
    Err(format!("no usable browser succeeded (ProgId={:?})", progid))
}

/// 打开 URL 的核心实现（GUI 命令与 --open-url CLI 共用）。
/// 诊断结论（2026-10-02，Chrome 历史记录证实）：URL 每次都成功交给了系统
/// （Chrome 历史里能看到对应条目），真正的问题是浏览器窗口停在最小化状态、
/// 没有到前台，用户感知为"点了没反应"。因此这里只做两件事：
///   1. ShellExecuteW 打开（走系统默认浏览器关联，返回值 > 32 即成功）
///   2. 后台轮询 4 秒，把浏览器窗口恢复 + 提到前台
pub fn open_url_in_browser(u: &str) {
    ui_report(format!("open_external_url: target={}", redacted_url(&u)));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // 修复记录（2026-10-03 根因）：
        //   旧实现 `cmd /c start "" <url>` 没给 URL 加引号，URL 里的 `&` 被 cmd 当成
        //   命令分隔符截断（实测报错 'vd_source' 不是内部或外部命令），浏览器收不到
        //   完整地址；且 spawn().is_ok() 只代表 cmd 启动成功，掩盖了失败，导致
        //   ShellExecuteW 兜底永远不执行。ShellWindows COM 路径在本机恒报 0x80070005。
        // 新策略（每一级都可验证成败）：
        //   1. 读注册表拿系统默认浏览器的启动命令，直接 CreateProcess 浏览器 exe
        //      （若发生 ExitCode 21 锁冲突，自动尝试下一个可用浏览器如 Edge）
        //   2. rundll32.exe url.dll,FileProtocolHandler 协议兜底
        //   3. 带引号的 cmd start，并等待退出码 == 0 才算成功
        //   4. ShellExecuteW（先修 stdio 句柄）
        let mut done = match launch_default_browser(u) {
            Ok(desc) => {
                ui_report(format!("open_external_url: launched browser directly: {desc}"));
                true
            }
            Err(e) => {
                ui_report(format!("open_external_url: direct launch failed: {e}"));
                false
            }
        };

        if !done {
            let quoted = u.replace('"', "%22");
            let status = std::process::Command::new("rundll32.exe")
                .args(["url.dll,FileProtocolHandler", &quoted])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            match status {
                Ok(s) if s.success() => {
                    ui_report("open_external_url: opened via rundll32 FileProtocolHandler".to_string());
                    done = true;
                }
                _ => {}
            }
        }

        if !done {
            // URL 整体加双引号，`&` 不再被 cmd 解析；内部双引号转义为 %22
            let quoted = u.replace('"', "%22");
            let status = std::process::Command::new("cmd")
                .raw_arg(format!("/c start \"\" \"{}\"", quoted))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            match status {
                Ok(s) if s.success() => {
                    ui_report("open_external_url: opened via quoted cmd start".to_string());
                    done = true;
                }
                Ok(s) => ui_report(format!("open_external_url: cmd start exit code {:?}", s.code())),
                Err(e) => ui_report(format!("open_external_url: cmd start spawn error: {e}")),
            }
        }

        if !done {
            fixup_stdio_handles();
            #[link(name = "shell32")]
            extern "system" {
                fn ShellExecuteW(
                    hwnd: isize,
                    lpOperation: *const u16,
                    lpFile: *const u16,
                    lpParameters: *const u16,
                    lpDirectory: *const u16,
                    nShowCmd: i32,
                ) -> isize;
            }
            let op: Vec<u16> = "open\0".encode_utf16().collect();
            let file: Vec<u16> = format!("{}\0", u).encode_utf16().collect();
            let ret = unsafe {
                ShellExecuteW(0, op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1)
            };
            ui_report(format!("open_external_url: ShellExecuteW returned {}", ret));
        }

        // 后台轮询：等浏览器窗口出现后恢复 + 置前。
        // 轮询窗口放大到 ~30s：本机 Chrome 冷启动 + SDP 代理环境下，打开 YouTube 等
        // 海外页面从进程启动到窗口标题就绪实测约 27s，10s 的旧窗口会漏掉。
        // 先等 1.5s：直调 chrome 后 Chrome 需要时间把新标签切到目标窗口，
        // 立刻激活会拉起"旧状态"的窗口（用户看到的是别的页面）。
        let url_owned = u.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let hint = title_hint_from_url(&url_owned);
            for i in 0..300 {
                if activate_browser_window(&hint) {
                    ui_report("open_external_url: browser window activated".to_string());
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
                if i == 299 {
                    ui_report("open_external_url: browser window NOT activated (timeout)".to_string());
                }
            }
        });
    }

    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(u).spawn();
    }
}

/// 找到浏览器主窗口，先恢复最小化/隐藏再前台激活。
/// 用 QueryFullProcessImageNameW 按 exe 名精确判定（不能用窗口类名——>
/// Chrome_WidgetWin_1 被 WorkBuddy / Antigravity 等 Electron 应用共享）。
///
/// `prefer_title`：URL 域名推导的标题关键词（如 "bilibili"）。Chrome 多窗口时，
/// 新标签可能开在后台窗口——优先激活「标题含关键词」的窗口（Chrome 窗口标题 =
/// 活动标签标题），找不到再退回最后一个主窗口。
///
/// 修复记录（2026-10-03）：
///   1. 修复 UB：旧代码在回调里把 `*mut Ctx` 强转成 `*mut Vec<isize>` 再 push，
///      属于未定义行为（碰巧 Ctx 首字段是 Vec 才没炸，但 release 优化下不可靠）。
///   2. 移除每次枚举都刷屏的 `[enum#N]` 诊断日志。
///   3. 匹配不再要求 `IsWindowVisible==1`（Chrome 冷启动窗口可能短暂隐藏），
///      有标题即匹配，交给后续 ShowWindow 强制显示。
///   4. 用 AttachThreadInput 绕开 Windows 前台锁，SetForegroundWindow 成功率大增
///      （旧实现只裸调 SetForegroundWindow，实测返回 0）。
///   5. 用 GetClassNameW 只收「主窗口」（Chrome_WidgetWin_*/MozillaWindowClass），
///      否则 hits.last() 会误选到 Chrome 的 "Default IME" 输入法子窗口（类名 IME），
///      对它 ShowWindow/SetForegroundWindow 无效，用户仍"没反应"。
/// 从 URL 推导浏览器窗口标题关键词（Chrome 窗口标题 = "页面标题 - 浏览器名"，
/// 页面标题一般含站点名）。多窗口场景下用于锁定"打开了目标页面的那个窗口"。
fn title_hint_from_url(u: &str) -> String {
    let lower = u.to_lowercase();
    for (domain, hint) in [
        ("bilibili.com", "bilibili"),
        ("b23.tv", "bilibili"),
        ("youtube.com", "youtube"),
        ("youtu.be", "youtube"),
        ("zhihu.com", "知乎"),
        ("github.com", "github"),
        ("douyin.com", "抖音"),
        ("ixigua.com", "西瓜视频"),
        ("bing.com", "bing"),
    ] {
        if lower.contains(domain) {
            return hint.to_string();
        }
    }
    String::new()
}

#[cfg(windows)]
fn activate_browser_window(prefer_title: &str) -> bool {
    // 直接用原始 API 声明，避免 windows crate 各版本签名差异
    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(cb: extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetClassNameW(hwnd: isize, class: *mut u16, max: i32) -> i32;
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: isize) -> i32;
        fn BringWindowToTop(hwnd: isize) -> i32;
        fn SwitchToThisWindow(hwnd: isize, alt_tab: i32);
        fn GetForegroundWindow() -> isize;
        fn GetCurrentThreadId() -> u32;
        fn AttachThreadInput(id_attach: u32, id_attach_to: u32, attach: i32) -> i32;
        fn IsWindow(hwnd: isize) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn CloseHandle(h: isize) -> i32;
        fn QueryFullProcessImageNameW(h: isize, flags: u32, name: *mut u16, size: *mut u32) -> i32;
    }

    const SW_RESTORE: i32 = 9;
    const SW_SHOW: i32 = 5;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const BROWSER_EXES: [&str; 6] = [
        "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe",
    ];

    struct Ctx {
        hits: Vec<isize>,
        titles: Vec<String>,
    }

    extern "system" fn enum_cb(hwnd: isize, lparam: isize) -> i32 {
        unsafe {
            let ctx = &mut *(lparam as *mut Ctx);
            // 有标题即可（不要求可见：冷启动窗口可能短暂隐藏）
            if GetWindowTextLengthW(hwnd) <= 0 {
                return 1;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return 1;
            }
            let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if hproc == 0 || hproc == -1 {
                return 1;
            }
            let mut buf = [0u16; 512];
            let mut len: u32 = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(hproc, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(hproc);
            if ok == 0 {
                return 1;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
            let file = std::path::Path::new(&path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if !BROWSER_EXES.contains(&file) {
                return 1;
            }
            // 只收浏览器「主窗口」：按类名排除输入法/工具子窗口。
            // （Chrome/Edge 主窗口类名 Chrome_WidgetWin_*，Firefox 是 MozillaWindowClass；
            //   输入法子窗口类名是 IME / MSCTFIME UI，标题却可能是 "Default IME"。
            //   若不按类名过滤，hits.last() 会误选到这些子窗口，激活了也看不到效果。）
            let mut cls = [0u16; 64];
            GetClassNameW(hwnd, cls.as_mut_ptr(), cls.len() as i32);
            let cls = String::from_utf16_lossy(&cls);
            let cls = cls.trim_end_matches('\0');
            if cls.starts_with("Chrome_WidgetWin") || cls == "MozillaWindowClass" {
                let mut tb = [0u16; 256];
                GetWindowTextW(hwnd, tb.as_mut_ptr(), tb.len() as i32);
                ctx.titles.push(String::from_utf16_lossy(&tb).to_lowercase());
                ctx.hits.push(hwnd);
            }
        }
        1 // 继续枚举
    }

    unsafe {
        let mut ctx = Ctx { hits: Vec::new(), titles: Vec::new() };
        EnumWindows(enum_cb, &mut ctx as *mut Ctx as isize);
        // 多窗口场景：Chrome 可能把新标签开在后台窗口——优先激活「标题含目标
        // 站点关键词」的窗口；没有匹配（单窗口/冷启动）再退回最后一个主窗口。
        let picked = if prefer_title.is_empty() {
            ctx.hits.last().copied()
        } else {
            let pl = prefer_title.to_lowercase();
            ctx.hits
                .iter()
                .zip(ctx.titles.iter())
                .rev()
                .find(|(_, t)| t.contains(&pl))
                .map(|(h, _)| *h)
                .or_else(|| ctx.hits.last().copied())
        };
        // EnumWindows 末尾通常是最近激活的窗口
        let Some(hwnd) = picked else {
            return false;
        };
        if IsWindow(hwnd) == 0 {
            return false;
        }

        // 1. 恢复窗口（最小化/隐藏 → 显示 + 置顶）
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_SHOW);
        BringWindowToTop(hwnd);

        // 2. 用 AttachThreadInput 把「当前线程」attach 到目标窗口线程，
        //    借到前台权限后 SetForegroundWindow（旧代码 attach 的是前台线程，无效）
        let target_tid = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
        let cur_tid = GetCurrentThreadId();
        let mut attached = false;
        if target_tid != 0 && target_tid != cur_tid {
            attached = AttachThreadInput(cur_tid, target_tid, 1) != 0;
        }
        let mut ok = SetForegroundWindow(hwnd) != 0;
        if attached {
            let _ = AttachThreadInput(cur_tid, target_tid, 0);
        }

        // 3. 降级 1：attach 到前台线程再试
        if !ok {
            let fg_hwnd = GetForegroundWindow();
            let fg_tid = if fg_hwnd != 0 {
                GetWindowThreadProcessId(fg_hwnd, std::ptr::null_mut())
            } else {
                0
            };
            if fg_tid != 0 && fg_tid != cur_tid {
                let _ = AttachThreadInput(cur_tid, fg_tid, 1);
                ok = SetForegroundWindow(hwnd) != 0;
                let _ = AttachThreadInput(cur_tid, fg_tid, 0);
            }
        }
        // 4. 降级 2：再次恢复后重试
        if !ok {
            ShowWindow(hwnd, SW_RESTORE);
            ok = SetForegroundWindow(hwnd) != 0;
        }
        // 5. 仍失败则 SwitchToThisWindow 强切（不受前台锁限制）
        if !ok {
            SwitchToThisWindow(hwnd, 1);
        }
        ui_report(format!("activate: hwnd=0x{hwnd:08x} SetForegroundWindow_ok={ok}"));
        true
    }
}


// ---------- 截图命令 ----------

/// P0-3 修复：截屏前统一隐藏速记条 (quick-note) 与主窗口 (main)，等待 DWM 动画消退，绝不把自身窗口截进画面
fn hide_app_windows_for_capture(app: &AppHandle) -> bool {
    let qn = app.get_webview_window("quick-note");
    let qn_was_visible = qn
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if qn_was_visible {
        if let Some(w) = &qn {
            let _ = w.hide();
        }
    }

    let main = app.get_webview_window("main");
    let main_was_visible = main
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
        && !main
            .as_ref()
            .and_then(|w| w.is_minimized().ok())
            .unwrap_or(false);
    if main_was_visible {
        if let Some(w) = &main {
            let _ = w.hide();
        }
    }

    if qn_was_visible || main_was_visible {
        std::thread::sleep(std::time::Duration::from_millis(240));
    }
    main_was_visible
}

fn do_capture_screenshot_with_note(
    app: &AppHandle,
    note: Option<String>,
) -> Result<commands::Memory, String> {
    #[cfg(windows)]
    {
        let was_visible = hide_app_windows_for_capture(app);

        let res = (|| -> Result<commands::Memory, String> {
            let ctx = capture::detect_browser_context();
            let img = capture::capture_full_screen()?;
            let path = worker::screenshot_path();
            capture::save_png(&img, &path)?;

            let input = commands::CreateMemoryInput {
                title: ctx.page_title,
                content: note.unwrap_or_default(),
                r#type: "screenshot".into(),
                source: Some("screenshot".into()),
                source_url: ctx.source_url,
                file_path: Some(path.to_string_lossy().to_string()),
                ocr_text: None,
                collection_id: None,
                tags: None,
            };
            let state = app.state::<AppState>();
            commands::create_memory(app.clone(), input, state)
        })();

        if was_visible {
            let _ = show_main_window(app.clone());
        }
        res
    }
    #[cfg(not(windows))]
    {
        let _ = note;
        Err("截图功能当前仅支持 Windows".into())
    }
}

fn do_capture_screenshot(app: &AppHandle) -> Result<commands::Memory, String> {
    do_capture_screenshot_with_note(app, None)
}

#[tauri::command]
async fn capture_screenshot(app: AppHandle) -> Result<commands::Memory, String> {
    do_capture_screenshot(&app)
}

#[tauri::command]
async fn capture_window_screenshot(app: AppHandle) -> Result<commands::Memory, String> {
    #[cfg(windows)]
    {
        let was_visible = hide_app_windows_for_capture(&app);

        let res = (|| -> Result<commands::Memory, String> {
            let ctx = capture::detect_browser_context();
            let img = capture::capture_active_window()?;
            let path = worker::screenshot_path();
            capture::save_png(&img, &path)?;

            let input = commands::CreateMemoryInput {
                title: ctx.page_title,
                content: String::new(),
                r#type: "screenshot".into(),
                source: Some("window_screenshot".into()),
                source_url: ctx.source_url,
                file_path: Some(path.to_string_lossy().to_string()),
                ocr_text: None,
                collection_id: None,
                tags: None,
            };
            let state = app.state::<AppState>();
            commands::create_memory(app.clone(), input, state)
        })();

        if was_visible {
            let _ = show_main_window(app.clone());
        }
        res
    }
    #[cfg(not(windows))]
    {
        Err("截图功能当前仅支持 Windows".into())
    }
}

#[tauri::command]
async fn capture_region_screenshot(
    app: AppHandle,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<commands::Memory, String> {
    #[cfg(windows)]
    {
        let was_visible = hide_app_windows_for_capture(&app);

        let res = (|| -> Result<commands::Memory, String> {
            let ctx = capture::detect_browser_context();
            let img = capture::capture_region(x, y, width, height)?;
            let path = worker::screenshot_path();
            capture::save_png(&img, &path)?;

            let input = commands::CreateMemoryInput {
                title: ctx.page_title,
                content: String::new(),
                r#type: "screenshot".into(),
                source: Some("region_screenshot".into()),
                source_url: ctx.source_url,
                file_path: Some(path.to_string_lossy().to_string()),
                ocr_text: None,
                collection_id: None,
                tags: None,
            };
            let state = app.state::<AppState>();
            commands::create_memory(app.clone(), input, state)
        })();

        if was_visible {
            let _ = show_main_window(app.clone());
        }
        res
    }
    #[cfg(not(windows))]
    {
        Err("截图功能当前仅支持 Windows".into())
    }
}

// ---------- P1-1：可视化区域框选截图（冻结当前屏幕 → 全屏交互拖拽框选 → 内存精准裁剪） ----------

#[cfg(windows)]
struct PendingRegionSession {
    img: capture::CapturedImage,
    ctx: capture::BrowserContext,
    preview_path: std::path::PathBuf,
    was_maximized: bool,
    saved_rect: Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>,
}

#[cfg(windows)]
static PENDING_REGION_SESSION: std::sync::Mutex<Option<PendingRegionSession>> =
    std::sync::Mutex::new(None);

#[derive(serde::Serialize)]
struct RegionCapturePreview {
    preview_path: String,
    width: u32,
    height: u32,
}

#[tauri::command]
async fn prepare_region_capture(app: AppHandle) -> Result<RegionCapturePreview, String> {
    #[cfg(windows)]
    {
        let (was_maximized, saved_rect) = if let Some(win) = app.get_webview_window("main") {
            let is_max = win.is_maximized().unwrap_or(false);
            let rect = match (win.outer_position(), win.outer_size()) {
                (Ok(p), Ok(s)) if p.x > -10000 && p.y > -10000 => Some((p, s)),
                _ => None,
            };
            (is_max, rect)
        } else {
            (false, None)
        };

        let _ = hide_app_windows_for_capture(&app);

        let ctx = capture::detect_browser_context();
        let img = capture::capture_full_screen()?;
        let preview_path = state::data_dir()
            .join("screenshots")
            .join(format!("region-preview-{}.png", uuid::Uuid::new_v4()));
        capture::save_png(&img, &preview_path)?;

        let width = img.width;
        let height = img.height;
        let preview_path_str = preview_path.to_string_lossy().to_string();

        // 清理上一次残留的预览图
        if let Ok(mut guard) = PENDING_REGION_SESSION.lock() {
            if let Some(old) = guard.take() {
                let _ = std::fs::remove_file(&old.preview_path);
            }
            *guard = Some(PendingRegionSession {
                img,
                ctx,
                preview_path,
                was_maximized,
                saved_rect,
            });
        }

        // 将主窗口展开为全屏画布供用户直接拖拽框选
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_fullscreen(true);
            let _ = win.set_focus();
        }

        Ok(RegionCapturePreview {
            preview_path: preview_path_str,
            width,
            height,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("区域截图当前仅支持 Windows".into())
    }
}

#[cfg(windows)]
fn restore_window_after_region(
    app: &AppHandle,
    was_maximized: bool,
    saved_rect: Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>,
) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_fullscreen(false);
        if was_maximized {
            let _ = win.maximize();
        } else if let Some((pos, size)) = saved_rect {
            let _ = win.set_size(tauri::Size::Physical(size));
            let _ = win.set_position(tauri::Position::Physical(pos));
        }
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
async fn commit_region_capture(
    app: AppHandle,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<commands::Memory, String> {
    #[cfg(windows)]
    {
        let session = PENDING_REGION_SESSION
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .ok_or("未找到活动的区域截图会话")?;

        let _ = std::fs::remove_file(&session.preview_path);
        restore_window_after_region(&app, session.was_maximized, session.saved_rect);

        let cropped = capture::crop_captured_image(&session.img, x, y, width, height)?;
        let path = worker::screenshot_path();
        capture::save_png(&cropped, &path)?;

        let input = commands::CreateMemoryInput {
            title: session.ctx.page_title,
            content: String::new(),
            r#type: "screenshot".into(),
            source: Some("region_screenshot".into()),
            source_url: session.ctx.source_url,
            file_path: Some(path.to_string_lossy().to_string()),
            ocr_text: None,
            collection_id: None,
            tags: None,
        };
        let state = app.state::<AppState>();
        commands::create_memory(app.clone(), input, state)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, x, y, width, height);
        Err("区域截图当前仅支持 Windows".into())
    }
}

#[tauri::command]
async fn cancel_region_capture(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        if let Ok(mut guard) = PENDING_REGION_SESSION.lock() {
            if let Some(session) = guard.take() {
                let _ = std::fs::remove_file(&session.preview_path);
                restore_window_after_region(&app, session.was_maximized, session.saved_rect);
                return Ok(());
            }
        }
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_fullscreen(false);
        }
    }
    Ok(())
}

/// 前端 UI 状态上报（P2-1：支持 1MB 自动日志轮转，避免日志无限膨胀）
#[tauri::command]
fn ui_report(info: String) {
    use std::io::Write;
    // CLI 诊断通道：--open-url 从终端/bash 跑时 stderr 可捕获；GUI 进程无控制台时静默无害
    eprintln!("[yueyi-ui] {}", info);
    let path = state::data_dir().join("ui-report.log");
    if let Ok(md) = std::fs::metadata(&path) {
        if md.len() > 1_048_576 {
            let old_path = state::data_dir().join("ui-report.old.log");
            let _ = std::fs::remove_file(&old_path);
            let _ = std::fs::rename(&path, &old_path);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let ts = chrono::Local::now().format("%H:%M:%S%.3f");
        let _ = writeln!(f, "[{}] {}", ts, info);
    }
}

// ---------- 剪贴板命令 ----------

fn do_save_clipboard(app: &AppHandle) -> Result<Option<commands::Memory>, String> {
    // 图片优先
    let mut clip = arboard::Clipboard::new().map_err(|e| format!("剪贴板不可用: {}", e))?;

    if let Ok(img_data) = clip.get_image() {
        let path = worker::screenshot_path().with_file_name(format!("clip-{}.png", uuid::Uuid::new_v4()));
        let width = img_data.width as u32;
        let height = img_data.height as u32;
        // arboard 是 RGBA
        let mut rgba = img_data.bytes.to_vec();
        let buffer = image::RgbaImage::from_raw(width, height, rgba.clone())
            .ok_or("剪贴板图片数据异常")?;
        buffer.save(&path).map_err(|e| format!("保存剪贴板图片失败: {}", e))?;
        rgba.clear();

        let input = commands::CreateMemoryInput {
            title: None,
            content: String::new(),
            r#type: "image".into(),
            source: Some("clipboard".into()),
            source_url: None,
            file_path: Some(path.to_string_lossy().to_string()),
            ocr_text: None,
            collection_id: None,
            tags: None,
        };
        let state = app.state::<AppState>();
        let m = commands::create_memory(app.clone(), input, state)?;
        return Ok(Some(m));
    }

    if let Ok(text) = clip.get_text() {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Ok(None);
        }
        // 判断 URL
        let is_url = text.starts_with("http://") || text.starts_with("https://");
        let is_code = text.contains("fn ") || text.contains("function ") || text.contains("def ")
            || text.contains("class ") || text.contains("import ") || text.contains("};");
        let r#type = if is_url {
            "link"
        } else if is_code && text.lines().count() > 2 {
            "code"
        } else {
            "clipboard"
        };
        let source_url = if is_url { Some(text.clone()) } else { None };
        let input = commands::CreateMemoryInput {
            title: None,
            content: text,
            r#type: r#type.into(),
            source: Some("clipboard".into()),
            source_url,
            file_path: None,
            ocr_text: None,
            collection_id: None,
            tags: None,
        };
        let state = app.state::<AppState>();
        let m = commands::create_memory(app.clone(), input, state)?;
        return Ok(Some(m));
    }

    Ok(None)
}

#[tauri::command]
async fn save_clipboard(app: AppHandle) -> Result<Option<commands::Memory>, String> {
    do_save_clipboard(&app)
}

// ---------- 悬浮速记（quick-note 窗口，后台线程按需创建，严禁在主线程同步 build 导致死锁） ----------

static QUICK_NOTE_BUILDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// 唤起速记前主窗口是否可见：速记收起后据此把主窗口放回任务栏
static QN_MAIN_WAS_VISIBLE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn show_quick_note(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Raycast/Spotlight 式聚焦：唤起速记条时收起主窗口，Esc/保存后恢复。
        if let Some(main) = app.get_webview_window("main") {
            let was_visible =
                main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false);
            QN_MAIN_WAS_VISIBLE.store(was_visible, std::sync::atomic::Ordering::SeqCst);
            let _ = main.hide();
        }
        if let Some(win) = app.get_webview_window("quick-note") {
            #[cfg(windows)]
            apply_quick_note_region(&win); // 每次唤起都重套区域，防止跨屏 DPI 变化后失效
            let _ = win.set_shadow(false);
            let _ = win.unminimize();
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit_to("quick-note", "quick-note-open", ());
            return;
        }

        if QUICK_NOTE_BUILDING
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_err()
        {
            return;
        }

        use tauri::{WebviewUrl, WebviewWindowBuilder};
        let build_qn = |data_dir: std::path::PathBuf| {
            WebviewWindowBuilder::new(&app, "quick-note", WebviewUrl::App("index.html".into()))
                .title("快速记录")
                .inner_size(600.0, 112.0)
                .resizable(false)
                .decorations(false)
                .transparent(false)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .center()
                .visible(false)
                .data_directory(data_dir)
                .build()
        };

        let built = match build_qn(state::webview_data_dir()) {
            Ok(w) => Ok(w),
            Err(e1) => {
                ui_report(format!("show_quick_note: primary webview2 dir failed ({}), retrying fallback", e1));
                let fb = state::data_dir().join(format!("webview2-qn-{}", std::process::id()));
                let _ = std::fs::create_dir_all(&fb);
                build_qn(fb)
            }
        };

        QUICK_NOTE_BUILDING.store(false, std::sync::atomic::Ordering::SeqCst);

        match built {
            Ok(win) => {
                // 首次创建不立即 show：窗口虽已是不透明实色，但页面渲染完成前
                // 会先露出 WebView 默认底色。等前端 bootstrap 渲染完成后
                // 调 quick_note_ready 再显示（见下方 command）。
                let _ = win.center();
            }
            Err(e) => {
                ui_report(format!("show_quick_note: build failed: {}", e));
                eprintln!("[yueyi] 悬浮速记窗口创建失败: {}", e);
            }
        }
    });
}

/// 给无边框速记窗套一个系统级圆角区域（Windows 上比 CSS 透明更可靠），
/// 并去掉 Win11 的 DWM 彩色/灰色窗口边框，避免浅色壁纸上出现一圈灰框。
#[cfg(windows)]
fn apply_quick_note_region(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};

    let (Ok(hwnd), Ok(size), Ok(scale)) = (win.hwnd(), win.outer_size(), win.scale_factor()) else {
        ui_report("quick-note region skipped: hwnd/size/scale unavailable".into());
        return;
    };
    let radius = (18.0 * scale) as i32;
    let rgn = unsafe {
        CreateRoundRectRgn(
            0,
            0,
            size.width as i32 + 1,
            size.height as i32 + 1,
            radius * 2,
            radius * 2,
        )
    };
    if rgn.is_invalid() {
        ui_report("quick-note region FAILED: CreateRoundRectRgn returned NULL".into());
        return;
    }
    unsafe {
        SetWindowRgn(HWND(hwnd.0), rgn, true);
        // DWMWA_BORDER_COLOR = 34，DWMWA_COLOR_NONE = 0xFFFFFFFE（Win10 上该调用会失败，忽略即可）
        let none = COLORREF(0xFF_FF_FF_FE);
        let _ = DwmSetWindowAttribute(
            HWND(hwnd.0),
            DWMWA_BORDER_COLOR,
            &none as *const COLORREF as *const std::ffi::c_void,
            std::mem::size_of::<COLORREF>() as u32,
        );
    }
    ui_report(format!(
        "quick-note region applied: {}x{} scale={:.2}",
        size.width, size.height, scale
    ));
}

/// 速记窗口前端渲染完成的通知：此时窗口内容可见，才执行显示。
#[tauri::command]
fn quick_note_ready(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("quick-note") {
        #[cfg(windows)]
        apply_quick_note_region(&win);
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

fn hide_quick_note(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("quick-note") {
        let _ = win.hide();
    }
}

/// 速记条因失焦/关闭而收起时，把原本可见的主窗口放回任务栏（不抢焦点）
fn restore_main_quietly(app: &AppHandle) {
    if QN_MAIN_WAS_VISIBLE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
        }
    }
}

#[tauri::command]
async fn show_quick_note_cmd(app: AppHandle) -> Result<(), String> {
    show_quick_note(&app);
    Ok(())
}

#[tauri::command]
async fn quick_note_save(app: AppHandle, text: String, mode: String) -> Result<i64, String> {
    let text = text.trim().to_string();
    if text.is_empty() && mode != "screenshot" {
        return Ok(0);
    }
    if mode == "screenshot" {
        // P0-3 修复：先彻底隐藏 quick-note，再调用截图（若用户同时填写了备注文本则随截图一并保存）
        hide_quick_note(&app);
        std::thread::sleep(std::time::Duration::from_millis(240));
        let note_opt = if text.is_empty() { None } else { Some(text) };
        let m = do_capture_screenshot_with_note(&app, note_opt);
        // 截图完成后把原本可见的主窗口放回任务栏（截图时它被临时隐藏了）
        restore_main_quietly(&app);
        let m = m?;
        worker::notify_captured(&app);
        worker::emit_update(
            &app,
            worker::MemoryUpdated {
                id: m.id,
                reason: "captured".into(),
                title: None,
                collection_name: None,
            },
        );
        return Ok(m.id);
    }
    let is_url = text.starts_with("http://") || text.starts_with("https://");
    let source_url = if is_url { Some(text.clone()) } else { None };
    let state = app.state::<AppState>();
    let m = commands::create_memory(
        app.clone(),
        commands::CreateMemoryInput {
            title: None,
            content: text,
            r#type: if is_url { "link".into() } else { "note".into() },
            source: Some("quick_note".into()),
            source_url,
            file_path: None,
            ocr_text: None,
            collection_id: None,
            tags: None,
        },
        state,
    )?;
    worker::emit_update(
        &app,
        worker::MemoryUpdated {
            id: m.id,
            reason: "captured".into(),
            title: None,
            collection_name: None,
        },
    );
    Ok(m.id)
}

#[tauri::command]
fn quick_note_dismiss(app: AppHandle) -> Result<(), String> {
    hide_quick_note(&app);
    // 恢复主窗口：唤起速记条时隐藏了它，取消/保存后放回来
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

#[cfg(windows)]
unsafe fn restore_and_focus_hwnd(h: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE,
        SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
    };
    #[link(name = "user32")]
    extern "system" {
        fn SwitchToThisWindow(hwnd: isize, fAltTab: i32);
        fn AttachThreadInput(idAttach: u32, idAttachTo: u32, fAttach: i32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
    }

    if IsIconic(h).as_bool() {
        let _ = ShowWindow(h, SW_RESTORE);
    } else {
        let _ = ShowWindow(h, SW_SHOW);
    }

    let fg = GetForegroundWindow();
    let fg_tid = GetWindowThreadProcessId(fg, None);
    let cur_tid = GetCurrentThreadId();
    if fg_tid != 0 && fg_tid != cur_tid {
        let _ = AttachThreadInput(fg_tid, cur_tid, 1);
        let _ = SetWindowPos(
            h,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let _ = SetWindowPos(
            h,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let _ = BringWindowToTop(h);
        let _ = SetForegroundWindow(h);
        SwitchToThisWindow(h.0 as isize, 1);
        let _ = AttachThreadInput(fg_tid, cur_tid, 0);
    } else {
        let _ = BringWindowToTop(h);
        let _ = SetForegroundWindow(h);
        SwitchToThisWindow(h.0 as isize, 1);
    }
}

fn ensure_reasonable_normal_rect(win: &tauri::WebviewWindow) {
    let is_max = win.is_maximized().unwrap_or(false);
    let is_min = win.is_minimized().unwrap_or(false);
    if is_max || is_min {
        return;
    }
    if let (Ok(Some(monitor)), Ok(win_size)) = (win.current_monitor(), win.outer_size()) {
        let mon_size = monitor.size();
        if win_size.width >= (mon_size.width as f64 * 0.94) as u32
            || win_size.height >= (mon_size.height as f64 * 0.92) as u32
        {
            let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1180.0, 760.0)));
            let _ = win.center();
        }
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    let do_restore = move |app_handle: &AppHandle| {
        if let Some(win) = app_handle.get_webview_window("main") {
            let _ = win.show();
            if win.is_minimized().unwrap_or(false) {
                let _ = win.unminimize();
            }
            #[cfg(windows)]
            if let Ok(hwnd) = win.hwnd() {
                unsafe {
                    restore_and_focus_hwnd(windows::Win32::Foundation::HWND(hwnd.0));
                }
            }
            ensure_reasonable_normal_rect(&win);
            let _ = win.set_focus();
        }
    };

    do_restore(&app);
    let _ = app.run_on_main_thread(move || {
        do_restore(&app_clone);
    });
    Ok(())
}

static SAVED_NORMAL_RECT: std::sync::Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>> =
    std::sync::Mutex::new(None);

#[cfg(windows)]
fn apply_modern_frameless_window(win: &tauri::WebviewWindow) {
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            dwAttribute: u32,
            pvAttribute: *const std::ffi::c_void,
            cbAttribute: u32,
        ) -> i32;
    }
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, HWND_TOP,
                SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_MAXIMIZEBOX,
                WS_MINIMIZEBOX, WS_SYSMENU,
            };
            let h_win = HWND(hwnd.0);
            let style = GetWindowLongW(h_win, GWL_STYLE) as u32;
            let _ = SetWindowLongW(
                h_win,
                GWL_STYLE,
                (style | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0 | WS_SYSMENU.0) as i32,
            );
            let _ = SetWindowPos(
                h_win,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
            );

            let h = hwnd.0 as isize;
            // DWMWA_WINDOW_CORNER_PREFERENCE (33) = DWMWCP_ROUND (2) -> 原生丝滑圆角与阴影
            let corner_pref: u32 = 2;
            let _ = DwmSetWindowAttribute(
                h,
                33,
                &corner_pref as *const u32 as *const _,
                std::mem::size_of::<u32>() as u32,
            );
            // DWMWA_BORDER_COLOR (34) = DWMWA_COLOR_NONE (0xFFFFFFFE) -> 移除刺眼的系统原生蓝/白外框
            let border_none: u32 = 0xFFFFFFFE;
            let _ = DwmSetWindowAttribute(
                h,
                34,
                &border_none as *const u32 as *const _,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

/// 读取「最小化到托盘」设置（默认 true）
fn should_minimize_to_tray(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return true;
    };
    let res = match state.db.try_lock() {
        Ok(conn) => {
            let v = state::get_setting(&conn, "minimize_to_tray");
            if v.is_empty() {
                true
            } else {
                v == "true"
            }
        }
        Err(_) => true,
    };
    res
}

/// 读取「关闭到托盘」设置（默认 true）
fn should_close_to_tray(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return true;
    };
    let res = match state.db.try_lock() {
        Ok(conn) => {
            let v = state::get_setting(&conn, "close_to_tray");
            if v.is_empty() {
                true
            } else {
                v == "true"
            }
        }
        Err(_) => true,
    };
    res
}

#[tauri::command]
fn window_control(app: AppHandle, action: String) -> Result<bool, String> {
    let Some(win) = app.get_webview_window("main") else {
        return Ok(false);
    };
    match action.as_str() {
        "drag" => {
            let w2 = win.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = w2.start_dragging();
            });
            Ok(win.is_maximized().unwrap_or(false))
        }
        "minimize" => {
            // P0-6 修复：遵循「最小化到托盘」开关，开启时隐藏至系统托盘，关闭时正常最小化到任务栏
            if should_minimize_to_tray(&app) {
                let _ = win.hide();
                worker::notify(&app, "月忆", "已最小化到系统托盘，点击托盘图标即可展开窗口");
            } else {
                let _ = win.minimize();
            }
            Ok(false)
        }
        "toggle_maximize" => {
            let is_max = win.is_maximized().unwrap_or(false);
            if is_max {
                let _ = win.unmaximize();
                #[cfg(windows)]
                if let Ok(hwnd) = win.hwnd() {
                    unsafe {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNORMAL};
                        let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNORMAL);
                    }
                }
                if let Ok(guard) = SAVED_NORMAL_RECT.lock() {
                    if let Some((pos, size)) = *guard {
                        let _ = win.set_size(tauri::Size::Physical(size));
                        let _ = win.set_position(tauri::Position::Physical(pos));
                    } else {
                        ensure_reasonable_normal_rect(&win);
                    }
                } else {
                    ensure_reasonable_normal_rect(&win);
                }
                Ok(false)
            } else {
                if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
                    if pos.x > -1000 && pos.y > -1000 {
                        if let Ok(mut guard) = SAVED_NORMAL_RECT.lock() {
                            *guard = Some((pos, size));
                        }
                    }
                }
                let _ = win.maximize();
                Ok(true)
            }
        }
        "is_maximized" => Ok(win.is_maximized().unwrap_or(false)),
        "close" => {
            if should_close_to_tray(&app) {
                let _ = win.hide();
                worker::notify(&app, "月忆", "已隐藏到系统托盘，点击托盘图标即可展开窗口");
            } else {
                app.exit(0);
                std::process::exit(0);
            }
            Ok(false)
        }
        _ => Ok(false),
    }
}

// ---------- 主窗口关闭 / 最小化 → 托盘行为 ----------

fn on_window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    if label == "main" {
        match event {
            WindowEvent::Focused(true) => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            WindowEvent::Resized(_) => {
                // P0-6 修复：当用户通过任务栏图标或 Win+Down 最小化窗口时，若开启了「最小化到托盘」则自动收起至托盘
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_minimized().unwrap_or(false) && should_minimize_to_tray(app) {
                        let _ = win.unminimize();
                        let _ = win.hide();
                        worker::notify(app, "月忆", "已最小化到系统托盘，点击托盘图标即可展开窗口");
                    }
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                if should_close_to_tray(app) {
                    api.prevent_close();
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.hide();
                    }
                    worker::notify(app, "月忆", "已隐藏到系统托盘，点击托盘图标即可展开窗口");
                } else {
                    app.exit(0);
                    std::process::exit(0);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ai::{AiConfig, AiService};
    use crate::prompts;

    #[cfg(windows)]
    #[test]
    #[ignore = "requires live screen/AI"]
    fn capture_and_ocr_smoke() {
        let img = crate::capture::capture_full_screen().expect("GDI 截图失败");
        println!("✓ 截屏成功：{}x{}，{} 字节像素", img.width, img.height, img.pixels.len());
        assert!(img.width > 0 && img.height > 0);

        let path = crate::worker::screenshot_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        crate::capture::save_png(&img, &path).expect("PNG 保存失败");
        println!("✓ PNG 已保存：{:?}", path);
        let path_str = path.to_string_lossy().to_string();
        match crate::ocr::ocr_image_file(&path_str) {
            Ok(text) => println!("✓ OCR 成功，识别 {} 字：{}", text.chars().count(), text.chars().take(150).collect::<String>()),
            Err(e) => println!("⚠ OCR 降级（不影响保存）：{}", e),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    #[ignore = "requires live screen/AI"]
    fn real_screenshot_ocr_test() {
        let sample = std::path::PathBuf::from(r"C:\Users\31287\YueyiData\screenshots\220ac336-53c7-405f-9ce0-740ad976a892.png");
        if !sample.exists() {
            println!("跳过：样本截图不存在");
            return;
        }
        let text = crate::ocr::ocr_image_file(&sample.to_string_lossy()).expect("OCR 执行失败");
        println!("✓ 样本图 OCR 成功，识别字数：{}，前 100 字：{}", text.chars().count(), text.chars().take(100).collect::<String>());
        assert!(text.chars().count() > 0, "OCR 应该识别出文字");
    }

    #[test]
    #[ignore = "requires live screen/AI"]
    fn deepseek_real_connection() {
        let key = std::env::var("DEEPSEEK_API_KEY").unwrap_or_default();
        if key.is_empty() {
            println!("跳过：未提供 DEEPSEEK_API_KEY 环境变量");
            return;
        }
        let config = AiConfig {
            api_key: key,
            base_url: std::env::var("DEEPSEEK_BASE_URL")
                .unwrap_or_else(|_| "https://api.deepseek.com".into()),
            model: std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-chat".into()),
        };
        let provider = AiService::provider(config);
        assert_eq!(provider.name(), "DeepSeek");
        match provider.test_connection() {
            Ok(_) => println!("✓ DeepSeek 连接成功"),
            Err(e) => panic!("连接失败：{}", e),
        }
    }

    #[test]
    #[ignore = "requires live screen/AI"]
    fn deepseek_real_pipeline() {
        let key = std::env::var("DEEPSEEK_API_KEY").unwrap_or_default();
        if key.is_empty() {
            return;
        }
        let config = AiConfig {
            api_key: key,
            base_url: std::env::var("DEEPSEEK_BASE_URL")
                .unwrap_or_else(|_| "https://api.deepseek.com".into()),
            model: std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-chat".into()),
        };
        let provider = AiService::provider(config);

        let input = prompts::PromptInput {
            content: "今天学习了 Transformer 的注意力机制，主要是 Self-Attention 的 QKV 计算过程，以及多头注意力的拼接方式。",
            ocr_text: "",
            memory_type: "note",
            collections: "学习资料, 工作记录, 灵感碎片, 生活日常, 待整理",
        };

        let title = provider
            .chat(&prompts::generate_title(&input), Some(60))
            .expect("标题生成失败");
        println!("生成标题 → {}", title.trim());
        assert!(!title.trim().is_empty());

        let tags_raw = provider
            .chat(&prompts::extract_tags(&input), Some(100))
            .expect("标签提取失败");
        let tags: Vec<String> = AiService::parse_json_loose(&tags_raw).expect("标签 JSON 解析失败");
        println!("提取标签 → {:?}", tags);
        assert!(!tags.is_empty());

        let category = provider
            .chat(&prompts::classify_memory(&input), Some(30))
            .expect("分类失败");
        println!("自动分类 → {}", category.trim());

        let answer = provider
            .chat(&prompts::answer_question("我之前学过什么？", &[]), Some(200))
            .expect("问答失败");
        println!("无记忆时回答 → {}", answer.trim());
        assert!(answer.contains("没") || answer.contains("未") || answer.contains("不"));
    }
}

// ============ CLI 冒烟入口：不走 GUI，跑一次完整捕获闭环 ============
//
//   yueyi-desktop.exe --capture-once
//
// 流程：截图 → 保存 PNG → 入库 → OCR → DeepSeek（标题/摘要/标签/分类）→ 更新
// 等价于用户在 GUI 中按下 Alt+Shift+S 后的全部行为，便于自动化验证与排障。
pub fn cli_capture_once() {
    println!("月忆 · 命令行捕获测试");
    println!("────────────────────────────");

    state::load_env_file();
    let conn = state::init_db().expect("数据库初始化失败");

    #[cfg(windows)]
    {
        match capture::capture_full_screen() {
            Ok(img) => {
                println!("✓ 截屏成功：{}x{}", img.width, img.height);
                let path = worker::screenshot_path();
                match capture::save_png(&img, &path) {
                    Ok(_) => println!("✓ PNG 保存：{}", path.display()),
                    Err(e) => {
                        println!("✗ PNG 保存失败：{}", e);
                        return;
                    }
                }
                let path_str = path.to_string_lossy().to_string();
                let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                conn.execute(
                    "INSERT INTO memories(type, source, file_path, created_at, updated_at, ai_status, metadata)
                     VALUES ('screenshot', 'screenshot', ?1, ?2, ?2, 'pending', '{}')",
                    rusqlite::params![path_str, now],
                )
                .expect("写入记忆失败");
                let id = conn.last_insert_rowid();
                println!("✓ 已入库：memory #{}", id);

                // OCR
                let mut ocr_text = String::new();
                match ocr::ocr_image_file(&path_str) {
                    Ok(t) if !t.is_empty() => {
                        println!("✓ OCR 识别 {} 字", t.chars().count());
                        let _ = conn.execute(
                            "UPDATE memories SET ocr_text = ?1 WHERE id = ?2",
                            rusqlite::params![t, id],
                        );
                        ocr_text = t;
                    }
                    Ok(_) => println!("⚠ OCR 未识别到文字（原图已保存）"),
                    Err(e) => println!("⚠ OCR 降级：{}（原图已保存）", e),
                }

                // AI 流水线
                let config = state::load_ai_config(&conn);
                if config.api_key.trim().is_empty() {
                    println!("· 未配置 API Key，跳过 AI 整理（记忆已保存为「待整理」）");
                    let _ = conn.execute(
                        "UPDATE memories SET ai_status = 'failed' WHERE id = ?1",
                        rusqlite::params![id],
                    );
                    return;
                }

                let content = if ocr_text.is_empty() { String::new() } else { ocr_text.clone() };
                let collections: Vec<String> = {
                    let mut stmt = conn.prepare("SELECT name FROM collections").unwrap();
                    stmt.query_map([], |r| r.get::<_, String>(0))
                        .unwrap()
                        .filter_map(|r| r.ok())
                        .collect()
                };
                let input = prompts::PromptInput {
                    content: &content,
                    ocr_text: &ocr_text,
                    memory_type: "screenshot",
                    collections: &collections.join(", "),
                };
                let provider = ai::AiService::provider(config);
                let _ = conn.execute(
                    "UPDATE memories SET ai_status = 'processing' WHERE id = ?1",
                    rusqlite::params![id],
                );

                let mut ai_ok = 0usize;
                let title = match provider.chat(&prompts::generate_title(&input), Some(60)) {
                    Ok(t) => {
                        ai_ok += 1;
                        t.trim().to_string()
                    }
                    Err(e) => {
                        println!("⚠ 标题生成失败：{}", e);
                        content.chars().take(24).collect()
                    }
                };
                println!("✓ AI 标题 → {}", title);

                let summary = match provider.chat(&prompts::summarize(&input), Some(200)) {
                    Ok(s) => {
                        ai_ok += 1;
                        s.trim().to_string()
                    }
                    Err(_) => String::new(),
                };
                println!("✓ AI 摘要 → {}", summary.chars().take(80).collect::<String>());

                let tags_raw = match provider.chat(&prompts::extract_tags(&input), Some(100)) {
                    Ok(t) => {
                        ai_ok += 1;
                        t
                    }
                    Err(_) => String::new(),
                };
                let tags: Vec<String> =
                    ai::AiService::parse_json_loose(&tags_raw).unwrap_or_default();
                println!("✓ AI 标签 → {:?}", tags);

                let category = match provider.chat(&prompts::classify_memory(&input), Some(30)) {
                    Ok(c) => {
                        ai_ok += 1;
                        c.trim().to_string()
                    }
                    Err(_) => String::new(),
                };
                println!("✓ AI 分类 → {}", category);

                if ai_ok == 0 {
                    let _ = conn.execute(
                        "UPDATE memories SET ai_status = 'failed' WHERE id = ?1",
                        rusqlite::params![id],
                    );
                    println!("✗ AI 全部步骤失败，已标记为 failed（支持后续自动重试）");
                    return;
                }

                let coll_id: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM collections WHERE name = ?1",
                        rusqlite::params![category],
                        |r| r.get::<_, i64>(0),
                    )
                    .map(Some)
                    .unwrap_or(None);

                let _ = conn.execute(
                    "UPDATE memories SET title = ?1, summary = ?2, ai_category = ?3,
                     collection_id = COALESCE(?4, collection_id), ai_status = 'done'
                     WHERE id = ?5",
                    rusqlite::params![title, summary, category, coll_id, id],
                );
                for tag in &tags {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO tags(name) VALUES (?1)",
                        rusqlite::params![tag],
                    );
                    if let Ok(tid) = conn.query_row(
                        "SELECT id FROM tags WHERE name = ?1",
                        rusqlite::params![tag],
                        |r| r.get::<_, i64>(0),
                    ) {
                        let _ = conn.execute(
                            "INSERT OR IGNORE INTO memory_tags(memory_id, tag_id) VALUES (?1, ?2)",
                            rusqlite::params![id, tid],
                        );
                    }
                }
                println!("✓ 记忆 #{} 整理完成", id);
                println!("────────────────────────────");
                println!("闭环验证完成，可在 GUI 时间线中查看该记忆。");
            }
            Err(e) => println!("✗ 截图失败：{}", e),
        }
    }
}

// ---------- 应用运行 ----------

// ---------- 全局快捷键动态注册（P0-4 冲突检测告警 + P0-6 第三个全局快捷键实现） ----------

static LAST_SHORTCUT_ERRORS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub fn register_global_shortcuts(
    app: &AppHandle,
    shot_str: &str,
    note_str: &str,
    search_str: &str,
) -> Vec<String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut errors: Vec<String> = Vec::new();

    // 1. 全屏截图快捷键
    let s1 = shot_str.trim();
    if !s1.is_empty() {
        match Shortcut::from_str(s1) {
            Ok(shot_sc) => {
                if let Err(e) = gs.on_shortcut(shot_sc, move |app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let app = app.clone();
                    std::thread::spawn(move || match do_capture_screenshot(&app) {
                        Ok(m) => {
                            worker::notify_captured(&app);
                            let _ = app.emit(
                                "memory-updated",
                                worker::MemoryUpdated {
                                    id: m.id,
                                    reason: "captured".into(),
                                    title: None,
                                    collection_name: None,
                                },
                            );
                            let _ = app.emit("open-drawer-payload", m.id);
                        }
                        Err(err) => {
                            let _ = app.emit("capture-error", err);
                        }
                    });
                }) {
                    errors.push(format!(
                        "快捷键「{}」（全屏截图）已被其他软件占用，请在设置中更换（{}）",
                        s1, e
                    ));
                }
            }
            Err(_) => {
                errors.push(format!("快捷键「{}」（全屏截图）格式无效", s1));
            }
        }
    }

    // 2. 悬浮速记快捷键
    let s2 = note_str.trim();
    if !s2.is_empty() {
        match Shortcut::from_str(s2) {
            Ok(note_sc) => {
                if let Err(e) = gs.on_shortcut(note_sc, move |app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    show_quick_note(app);
                }) {
                    errors.push(format!(
                        "快捷键「{}」（悬浮速记）已被其他软件占用，请在设置中更换（{}）",
                        s2, e
                    ));
                }
            }
            Err(_) => {
                errors.push(format!("快捷键「{}」（悬浮速记）格式无效", s2));
            }
        }
    }

    // 3. 全局快速搜索快捷键（P0-6：唤醒主窗口并直接打开全局搜索/命令面板）
    let s3 = search_str.trim();
    // 若快捷键为应用内默认 Ctrl+K，仅当非冲突时注册为全局热键；若用户自定义了如 Alt+Shift+F 等全局热键，冲突时明确报错
    if !s3.is_empty() {
        match Shortcut::from_str(s3) {
            Ok(search_sc) => {
                if let Err(e) = gs.on_shortcut(search_sc, move |app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let _ = show_main_window(app.clone());
                    let _ = app.emit("open-global-search", ());
                }) {
                    if !s3.eq_ignore_ascii_case("Ctrl+K") {
                        errors.push(format!(
                            "快捷键「{}」（全局快速搜索）已被其他软件占用，请在设置中更换（{}）",
                            s3, e
                        ));
                    }
                }
            }
            Err(_) => {
                errors.push(format!("快捷键「{}」（全局快速搜索）格式无效", s3));
            }
        }
    }

    if let Ok(mut guard) = LAST_SHORTCUT_ERRORS.lock() {
        *guard = errors.clone();
    }

    if !errors.is_empty() {
        let joined = errors.join("；");
        let _ = app.emit("shortcut-error", joined.clone());
        worker::notify(app, "月忆 · 全局快捷键冲突", &errors.join("\n"));
    }

    errors
}

fn ensure_main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window("main") {
        return Some(w);
    }
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let build_with_dir = |data_dir: std::path::PathBuf| {
        let builder = if let Some(cfg) = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == "main")
        {
            WebviewWindowBuilder::from_config(app, cfg).unwrap_or_else(|_| {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            })
        } else {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("月忆")
                .inner_size(1180.0, 760.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .decorations(false)
        };
        builder.visible(false).data_directory(data_dir).build()
    };

    let primary_dir = state::webview_data_dir();
    match build_with_dir(primary_dir) {
        Ok(w) => Some(w),
        Err(e1) => {
            ui_report(format!(
                "ensure_main_window: primary webview2 dir failed ({}), retrying fallback",
                e1
            ));
            let fallback_dir = state::data_dir().join(format!("webview2-{}", std::process::id()));
            let _ = std::fs::create_dir_all(&fallback_dir);
            match build_with_dir(fallback_dir) {
                Ok(w) => Some(w),
                Err(e2) => {
                    ui_report(format!("ensure_main_window: fallback failed: {}", e2));
                    None
                }
            }
        }
    }
}


/// 图片协议只允许读取应用自己的截图/附件目录，防止被用来读任意本地文件。
fn allowed_image_path(path: &std::path::Path) -> bool {
    let Ok(canon) = path.canonicalize() else {
        return false;
    };
    let base = crate::state::data_dir();
    for sub in ["screenshots", "attachments"] {
        if let Ok(root) = base.join(sub).canonicalize() {
            if canon.starts_with(&root) {
                return true;
            }
        }
    }
    false
}


/// 日志只保留 scheme/host/path，避免记录查询参数里的令牌和私密信息。
fn redacted_url(u: &str) -> String {
    u.split(['?', '#']).next().unwrap_or(u).to_string()
}


/// 生成卡片用缩略图（最长边 640），失败时回退原图。
fn make_thumbnail(data: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(data).ok()?;
    let thumb = img.resize(640, 640, image::imageops::FilterType::Triangle);
    let mut out = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        ui_report(format!("PANIC: {}", info));
    }));

    // P1-3 单实例唤醒：通过内核命名互斥量精确判断是否有已运行的「月忆」实例（规避同名文件夹/浏览器标签误判，且进程退出后内核自动释放）
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn CreateMutexW(
                lpMutexAttributes: *const std::ffi::c_void,
                bInitialOwner: i32,
                lpName: *const u16,
            ) -> isize;
            fn GetLastError() -> u32;
            fn OpenMutexW(
                dwDesiredAccess: u32,
                bInheritHandle: i32,
                lpName: *const u16,
            ) -> isize;
        }
        unsafe {
            use windows::core::{w, PCWSTR};
            use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
            let mutex_name: Vec<u16> = "Local\\YueyiDesktopSingleInstance_v1\0"
                .encode_utf16()
                .collect();
            // 先探测已有实例：不要依赖 CreateMutexW 后的 GetLastError（可能是上次调用的残留 183）
            const SYNCHRONIZE: u32 = 0x0010_0000;
            let existing = OpenMutexW(SYNCHRONIZE, 0, mutex_name.as_ptr());
            if existing != 0 {
                let _ = GetLastError();
                let wakeup_file = state::data_dir().join("instance.wakeup");
                let _ = std::fs::write(&wakeup_file, "wakeup");
                if let Ok(hwnd) = FindWindowW(w!("Tao Window Class"), w!("月忆")) {
                    if !hwnd.0.is_null() {
                        restore_and_focus_hwnd(hwnd);
                    }
                } else if let Ok(hwnd) = FindWindowW(PCWSTR::null(), w!("月忆")) {
                    if !hwnd.0.is_null() {
                        restore_and_focus_hwnd(hwnd);
                    }
                }
                return;
            }
            // 进程存活期间持有；句柄随进程退出由内核释放
            let _handle = CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr());
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            on_window_event(window.app_handle(), window.label(), event);
            if window.label() == "quick-note" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        if let Some(w) = window.app_handle().get_webview_window("quick-note") {
                            let _ = w.hide();
                        }
                        restore_main_quietly(window.app_handle());
                    }
                    WindowEvent::Focused(false) => {
                        if let Some(w) = window.app_handle().get_webview_window("quick-note") {
                            let _ = w.hide();
                        }
                        restore_main_quietly(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .register_uri_scheme_protocol("yueyi-img", |_ctx, request| {
            // Windows WebView2: http://yueyi-img.localhost/C%3A%5CUsers%5C...png
            // macOS/Linux: yueyi-img://localhost/C%3A%5C... 或 yueyi-img://C%3A%5C...
            let uri_str = request.uri().to_string();
            let path_part = request.uri().path().trim_start_matches('/');
            let raw = if !path_part.is_empty() {
                path_part.trim_end_matches('/')
            } else {
                uri_str
                    .strip_prefix("http://yueyi-img.localhost/")
                    .or_else(|| uri_str.strip_prefix("https://yueyi-img.localhost/"))
                    .or_else(|| uri_str.strip_prefix("yueyi-img://localhost/"))
                    .or_else(|| uri_str.strip_prefix("yueyi-img://"))
                    .unwrap_or("")
                    .trim_start_matches('/')
                    .trim_end_matches('/')
            };
            let want_thumb = request
                .uri()
                .query()
                .map(|q| q.split('&').any(|kv| kv == "thumb=1"))
                .unwrap_or(false);
            let path = std::path::PathBuf::from(percent_decode(raw));
            if !allowed_image_path(&path) {
                return tauri::http::Response::builder()
                    .status(403)
                    .body(Vec::new())
                    .unwrap();
            }
            match std::fs::read(&path) {
                Ok(data) => {
                    let data = if want_thumb {
                        make_thumbnail(&data).unwrap_or(data)
                    } else {
                        data
                    };
                    let mime = match path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("png")
                        .to_lowercase()
                        .as_str()
                    {
                        "jpg" | "jpeg" => "image/jpeg",
                        "gif" => "image/gif",
                        "webp" => "image/webp",
                        _ => "image/png",
                    };
                    tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "public, max-age=31536000, immutable")
                        .status(200)
                        .body(data)
                        .unwrap_or_else(|_| {
                            tauri::http::Response::builder()
                                .status(500)
                                .body(Vec::new())
                                .unwrap()
                        })
                }
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .on_page_load(|webview, payload| {
            ui_report(format!("on_page_load: window={} url={} event={:?}", webview.label(), payload.url(), payload.event()));
            if webview.label() == "main" {
                if let Ok(guard) = LAST_SHORTCUT_ERRORS.lock() {
                    if !guard.is_empty() {
                        let msg = guard.join("；");
                        let app = webview.app_handle().clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(600));
                            let _ = app.emit("shortcut-error", msg);
                        });
                    }
                }
            }
        })
        .setup(|app| {
            init_state(app.handle());
            if let Some(w) = ensure_main_window(app.handle()) {
                if let Some(icon) = app.default_window_icon() {
                    let _ = w.set_icon(icon.clone());
                }
                #[cfg(windows)]
                apply_modern_frameless_window(&w);
                ui_report(format!("setup: main window url={:?}", w.url()));
                let _ = show_main_window(app.handle().clone());
            } else {
                ui_report("setup: main window NOT FOUND".into());
            }

            // P1-3：后台监听第二实例唤醒信号（确保主窗口隐藏在系统托盘时也能 100% 唤醒并聚焦）
            {
                let app_handle = app.handle().clone();
                let wakeup_file = state::data_dir().join("instance.wakeup");
                let _ = std::fs::remove_file(&wakeup_file);
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    if wakeup_file.exists() {
                        let _ = std::fs::remove_file(&wakeup_file);
                        let _ = show_main_window(app_handle.clone());
                    }
                });
            }

            // 读取初始今日数量与 3 个全局快捷键设置
            let (today_cnt, shot_str, note_str, search_str) = {
                let state = app.state::<AppState>();
                let res = match state.db.lock() {
                    Ok(conn) => {
                        let cnt: i64 = conn
                            .query_row(
                                "SELECT COUNT(*) FROM memories WHERE created_at >= date('now','localtime','start of day')",
                                [],
                                |r| r.get(0),
                            )
                            .unwrap_or(0);
                        let s1 = state::get_setting(&conn, "shortcut_screenshot");
                        let s2 = state::get_setting(&conn, "shortcut_quick_note");
                        let s3 = {
                            let v = state::get_setting(&conn, "shortcut_search");
                            if v.is_empty() { "Ctrl+K".into() } else { v }
                        };
                        (cnt, s1, s2, s3)
                    }
                    Err(_) => (0, "Alt+Shift+S".into(), "Alt+Shift+M".into(), "Ctrl+K".into()),
                };
                res
            };

            // ---- 托盘 ----
            let header = MenuItem::with_id(app, "header", "月忆", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "打开主窗口", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "快速记录", true, None::<&str>)?;
            let shot = MenuItem::with_id(app, "shot", "截图记忆", true, None::<&str>)?;
            let clip = MenuItem::with_id(app, "clip", "保存剪贴板", true, None::<&str>)?;
            let search = MenuItem::with_id(app, "search", "搜索记忆", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let today_item = MenuItem::with_id(app, "today", &format!("今日记忆：{}", today_cnt), false, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&header, &open, &quick, &shot, &clip, &search, &sep1, &today_item, &sep2, &settings_item, &quit],
            )?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("月忆 · Desktop")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = show_main_window(app.clone());
                    }
                    "quick" => show_quick_note(app),
                    "shot" => {
                        let app = app.clone();
                        std::thread::spawn(move || {
                            match do_capture_screenshot(&app) {
                                Ok(m) => {
                                    worker::notify_captured(&app);
                                    worker::emit_update(
                                        &app,
                                        worker::MemoryUpdated {
                                            id: m.id,
                                            reason: "captured".into(),
                                            title: None,
                                            collection_name: None,
                                        },
                                    );
                                    let _ = app.emit("open-drawer-payload", m.id);
                                }
                                Err(e) => {
                                    let _ = app.emit("capture-error", e);
                                }
                            }
                        });
                    }
                    "clip" => {
                        let app = app.clone();
                        std::thread::spawn(move || {
                            if let Ok(Some(m)) = do_save_clipboard(&app) {
                                worker::notify_captured(&app);
                                worker::emit_update(
                                    &app,
                                    worker::MemoryUpdated {
                                        id: m.id,
                                        reason: "captured".into(),
                                        title: None,
                                        collection_name: None,
                                    },
                                );
                            }
                        });
                    }
                    "search" => {
                        let _ = show_main_window(app.clone());
                        let _ = app.emit("tray-navigate", "search");
                    }
                    "settings" => {
                        let _ = show_main_window(app.clone());
                        let _ = app.emit("tray-navigate", "settings");
                    }
                    "quit" => {
                        app.exit(0);
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        let app = tray.app_handle().clone();
                        let _ = show_main_window(app);
                    }
                    _ => {}
                })
                .build(app)?;

            // ---- 全局快捷键 ----
            let _ = register_global_shortcuts(app.handle(), &shot_str, &note_str, &search_str);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_memories,
            commands::get_memory,
            commands::create_memory,
            commands::update_memory,
            commands::delete_memory,
            commands::list_trash,
            commands::restore_memory,
            commands::purge_memory,
            commands::empty_trash,
            commands::move_memories,
            commands::related_memories,
            commands::reanalyze_memory,
            commands::list_tags,
            commands::rename_tag,
            commands::delete_tag,
            commands::list_search_history,
            commands::clear_search_history,
            commands::today_stats,
            commands::search_memories,
            commands::list_collections,
            commands::reorder_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::set_collection_color,
            commands::update_collection_desc,
            commands::delete_collection,
            commands::list_reminders,
            commands::create_reminder,
            commands::complete_reminder,
            commands::delete_reminder,
            commands::suggest_collection_memories,
            commands::smart_fill_collection,
            commands::unlink_collection_memory,
            commands::generate_collection_summary,
            commands::import_files,
            commands::export_memory_markdown,
            commands::export_collection_markdown,
            commands::review_overview,
            commands::generate_weekly_review,
            commands::reveal_path,
            commands::open_path,
            commands::export_ics,
            commands::ai_ask,
            commands::ai_test_connection,
            commands::get_settings,
            commands::save_settings,
            commands::open_data_dir,
            commands::storage_info,
            commands::pick_export_path,
            commands::pick_import_path,
            commands::pick_backup_path,
            commands::pick_attachment_file,
            transfer::backup_database,
            transfer::export_data,
            transfer::import_data,
            commands::clear_all_data,
            capture_screenshot,
            capture_window_screenshot,
            capture_region_screenshot,
            prepare_region_capture,
            commit_region_capture,
            cancel_region_capture,
            save_clipboard,
            show_quick_note_cmd,
            quick_note_ready,
            quick_note_save,
            quick_note_dismiss,
            show_main_window,
            window_control,
            open_external_url,
            ui_report,
        ])
        .run(tauri::generate_context!())
        .expect("月忆启动失败");
}
