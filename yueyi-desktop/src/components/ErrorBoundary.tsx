import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** 渲染异常兜底：单页崩溃不把整个窗口变成白屏 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ui_report", {
          info: `React ErrorBoundary: ${error.message}\n${info.componentStack ?? ""}`,
        });
      } catch {
        /* 非 Tauri 环境 */
      }
    })();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-base p-8 text-center">
        <div className="max-w-md rounded-2xl border border-base-border bg-base-panel p-6 shadow-lg">
          <h1 className="text-[18px] font-semibold text-ink">页面渲染出错</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
            记忆数据保存在本机，不会丢失。可以先重新加载；如果反复出现，把错误信息发给我。
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-base-panel2 p-2 text-left font-mono text-[12px] text-ink-faint">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => this.setState({ error: null })}
            >
              返回界面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
