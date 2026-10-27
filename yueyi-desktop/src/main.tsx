import React from "react";
import ReactDOM from "react-dom/client";
import ErrorBoundary from "./components/ErrorBoundary";
import "./ui/tokens.css";
import "./styles/globals.css";

// 诊断上报：把引导过程写入 %USERPROFILE%\YueyiData\ui-report.log
async function report(msg: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ui_report", { info: msg });
  } catch {
    /* 非 Tauri 环境 */
  }
}

window.addEventListener("error", (e) => {
  void report(`window.error: ${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  void report(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`);
});

async function bootstrap() {
  void report(`bootstrap start, href=${location.href}`);

  let isQuickNote = false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    isQuickNote = getCurrentWindow().label === "quick-note";
    void report(`window label resolved, quickNote=${isQuickNote}`);
  } catch (e) {
    void report(`getCurrentWindow failed: ${String(e)}`);
  }

  let App: React.ComponentType;
  try {
    App = !isQuickNote
      ? (await import("./App")).default
      : (await import("./components/QuickNote")).default;
    void report(`module imported ok, quickNote=${isQuickNote}`);
  } catch (e) {
    void report(`module import FAILED: ${String(e)}`);
    throw e;
  }

  if (isQuickNote) {
    document.body.classList.add("quick-note-mode");
    document.documentElement.classList.add("quick-note-mode");
  }

  const root = document.getElementById("root");
  void report(`root element: ${root ? "found" : "MISSING"}`);

  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );

  setTimeout(async () => {
    const n = root?.children.length ?? -1;
    await report(`after render: root children=${n}, bodyTextLen=${document.body.innerText.length}`);
  }, 800);
}

void bootstrap().catch((e) => {
  void report(`bootstrap REJECTED: ${String(e)}`);
  const el = document.getElementById("boot-error");
  if (el) el.textContent += "\nbootstrap failed: " + String(e);
});
