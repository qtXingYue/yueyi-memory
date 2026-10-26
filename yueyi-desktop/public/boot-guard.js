// 引导期错误可视化 —— 桌面端无 devtools 时用于定位白屏原因
// 独立文件而非内联脚本，以满足严格 CSP（script-src 'self'）
(function () {
  function show(tag, msg) {
    try {
      var el = document.getElementById("boot-error");
      if (!el) {
        el = document.createElement("pre");
        el.id = "boot-error";
        el.style.cssText =
          "position:fixed;inset:0;z-index:99999;margin:0;padding:24px;" +
          "background:#12141A;color:#E06C75;font:13px/1.6 Consolas,monospace;" +
          "white-space:pre-wrap;overflow:auto";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent += "[" + tag + "] " + msg + "\n\n";
    } catch (e) {}
  }

  function isMounted() {
    var root = document.getElementById("root");
    return !!(root && root.children && root.children.length > 0);
  }

  window.addEventListener("error", function (e) {
    // 资源加载失败（script/link/img）在 capture 阶段触发，e.target 指向 DOM 元素
    var t = e.target;
    if (t && t !== window) {
      if ((t.tagName === "SCRIPT" || t.tagName === "LINK") && !isMounted()) {
        show("resource", t.tagName + " 加载失败: " + (t.src || t.href || "?"));
      }
      // 忽略 <img> 等非致命资源加载错误，绝不弹出全屏遮罩
      return;
    }
    if (!isMounted() && (e.message || e.filename)) {
      show("error", (e.message || "") + "\n" + (e.filename || "") + ":" + (e.lineno || ""));
    }
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    if (isMounted()) return;
    var r = e.reason;
    show("promise", (r && (r.stack || r.message)) || String(r));
  });

  window.__yueyiShowBootError = show;

  setTimeout(function () {
    var root = document.getElementById("root");
    if (root && !root.children.length) {
      var scripts = Array.prototype.map
        .call(document.querySelectorAll("script"), function (s) {
          return s.src || "(inline)";
        })
        .join(", ");
      show(
        "boot",
        "root 仍为空 —— 脚本可能未执行或渲染失败\n" +
          "URL: " + location.href + "\n" +
          "脚本: " + scripts
      );
    }
  }, 2500);
})();
