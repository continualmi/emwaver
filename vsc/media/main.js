/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();

  const statusEl = document.getElementById("status");
  const deviceStatusEl = document.getElementById("deviceStatus");
  const buildBtn = document.getElementById("build");
  const flashBtn = document.getElementById("flash");
  const previewBtn = document.getElementById("previewWavelet");
  const connectBtn = document.getElementById("connectDevice");
  const disconnectBtn = document.getElementById("disconnectDevice");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setDeviceStatus(text) {
    if (deviceStatusEl) deviceStatusEl.textContent = text;
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

  if (connectBtn) {
    connectBtn.addEventListener("click", () => {
      setDeviceStatus("Device: Connecting…");
      vscode.postMessage({ type: "connectDevice" });
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", () => {
      setDeviceStatus("Device: Disconnecting…");
      vscode.postMessage({ type: "disconnectDevice" });
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "status" && typeof msg.status === "string") {
      setStatus(msg.status);
    }
    if (msg.type === "deviceStatus" && msg.device && typeof msg.device === "object") {
      const device = msg.device;
      if (device.connected) {
        const addr = device.address ? ` ${device.address}` : "";
        setDeviceStatus(`Device: ${device.label || "Connected"}${addr}`);
      } else {
        setDeviceStatus("Device: Disconnected");
      }
    }
  });

  vscode.postMessage({ type: "requestDeviceStatus" });
})();
