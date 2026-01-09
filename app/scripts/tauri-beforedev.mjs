import http from "node:http";
import { spawn } from "node:child_process";

const DEV_URL = process.env.TAURI_DEV_URL || "http://127.0.0.1:1420/";

function devServerRunning(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(250, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function keepAlive() {
  // Tauri expects the beforeDevCommand process to stay alive.
  setInterval(() => {}, 60_000);
}

function spawnNpmDev() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const env = { ...process.env };
  if (!env.VITE_MONITOR && env.MONITOR) {
    env.VITE_MONITOR = env.MONITOR;
  }
  const child = spawn(npmCmd, ["run", "dev"], { stdio: "inherit", env });

  const forward = (signal) => child.kill(signal);
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code) => process.exit(code ?? 0));
}

if (await devServerRunning(DEV_URL)) {
  console.log(`[tauri-beforedev] Dev server already running at ${DEV_URL}`);
  keepAlive();
} else {
  console.log(`[tauri-beforedev] Starting dev server at ${DEV_URL}`);
  spawnNpmDev();
}

