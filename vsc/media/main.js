/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();

  const statusEl = document.getElementById("status");
  const buildBtn = document.getElementById("build");
  const flashBtn = document.getElementById("flash");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  if (buildBtn) {
    buildBtn.addEventListener("click", () => {
      setStatus("Starting build…");
      vscode.postMessage({ type: "run", action: "build" });
    });
  }

  if (flashBtn) {
    flashBtn.addEventListener("click", () => {
      setStatus("Starting flash…");
      vscode.postMessage({ type: "run", action: "flash" });
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "status" && typeof msg.status === "string") {
      setStatus(msg.status);
    }
  });
})();

