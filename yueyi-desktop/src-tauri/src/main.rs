// 月忆 · Desktop — 主入口
// 2026-10-03 定案：浏览器打不开的根因是「WorkBuddy 工作目录被安全策略标记」，
// 从该目录启动的进程（及其子进程）受限（浏览器启动器崩、DCOM 拒绝）。与 PE
// subsystem/签名/stdio/COM 注册均无关（已逐一实验排除）。正式部署位置见
// C:\Users\31287\AppData\Local\Programs\月忆\（已实测放行）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eprintln!("YUEYI_MAIN_START args={:?}", std::env::args().collect::<Vec<String>>());
    // CLI 冒烟：不走 GUI，直接跑一次「截图 → OCR → AI → 入库」完整闭环
    if std::env::args().any(|a| a == "--capture-once") {
        yueyi_desktop_lib::cli_capture_once();
        return;
    }
    // CLI：--open-url <url> — 用与 GUI 完全相同的链路打开链接（诊断 / 自动化自测入口）
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--open-url") {
        yueyi_desktop_lib::cli_canary("main: --open-url branch entered");
        let raw = args.get(pos + 1).cloned().unwrap_or_default();
        let raw = raw.trim().to_string();
        if !raw.is_empty() {
            let u = if raw.starts_with("http://") || raw.starts_with("https://") {
                raw
            } else {
                format!("https://{}", raw)
            };
            yueyi_desktop_lib::open_url_in_browser(&u);
            // 给子进程完成转交 + 后台线程恢复/置前浏览器窗口留出时间
            std::thread::sleep(std::time::Duration::from_millis(3000));
        }
        yueyi_desktop_lib::cli_canary("main: --open-url branch done");
        return;
    }
    yueyi_desktop_lib::run()
}
