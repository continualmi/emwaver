/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();

  const statusEl = document.getElementById("status");
  const buildBtn = document.getElementById("build");
  const flashBtn = document.getElementById("flash");
  const previewBtn = document.getElementById("previewWavelet");

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

  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      setStatus("Opening wavelet preview…");
      vscode.postMessage({ type: "previewWavelet" });
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
