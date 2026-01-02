/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as vscode from "vscode";
import * as cp from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { expandCliPath } from "./cliPath";

type BridgeReq = { id: number; method: string; params?: unknown };
type BridgeRes =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };
type BridgeEvt = { event: string; data: unknown };

export type DeviceInfo = { transport: string; name?: string | null; address: string };
export type DeviceStatusSnapshot = {
  daemonRunning: boolean;
  daemonSocketPath?: string;
  device?: DeviceInfo;
};

function defaultDaemonSocketPath(): string {
  const envSocket = String(process.env.EMWAVER_DAEMON_SOCKET || "").trim();
  if (envSocket) return envSocket;

  const runtimeDir = String(process.env.XDG_RUNTIME_DIR || "").trim();
  if (runtimeDir) return path.join(runtimeDir, "emwaver.sock");

  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches", "emwaver", "emwaver.sock");
  }
  return path.join(home, ".cache", "emwaver", "emwaver.sock");
}

export class EmwaverBridgeClient implements vscode.Disposable {
  private socket: net.Socket | undefined;
  private socketPath: string | undefined;
  private rl: readline.Interface | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private onEventEmitter = new vscode.EventEmitter<BridgeEvt>();
  readonly onEvent = this.onEventEmitter.event;

  constructor(private readonly output: vscode.OutputChannel) {}

  async start(): Promise<void> {
    if (this.socket) return;

    const socketPath = defaultDaemonSocketPath();
    this.socketPath = socketPath;

    await this.ensureDaemonAndConnect(socketPath);
    await this.request("hello", {});
  }

  getSocketPathSnapshot(): string | undefined {
    return this.socketPath;
  }

  isSocketConnected(): boolean {
    return !!this.socket && !this.socket.destroyed;
  }

  private async ensureDaemonAndConnect(socketPath: string): Promise<void> {
    const tryConnect = async () => {
      const sock = await new Promise<net.Socket>((resolve, reject) => {
        const created = net.createConnection({ path: socketPath });
        const onError = (err: unknown) => {
          created.destroy();
          reject(err);
        };
        created.once("error", onError);
        created.once("connect", () => {
          created.off("error", onError);
          resolve(created);
        });
      });

      this.socket = sock;
      sock.on("error", (err) => {
        this.output.appendLine(`Daemon socket error: ${String(err)}`);
      });
      sock.on("close", () => {
        this.failAllPending(new Error("Daemon socket closed"));
        this.rl?.close();
        this.rl = undefined;
        this.socket = undefined;
      });

      const rl = readline.createInterface({ input: sock });
      this.rl = rl;
      rl.on("line", (line) => this.handleLine(line));
    };

    try {
      await tryConnect();
      return;
    } catch (err) {
      this.output.appendLine(`Daemon: not running at ${socketPath} (${String(err)})`);
    }

    await this.startDaemon();

    let lastErr: unknown;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await tryConnect();
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error(`Failed to connect to emwaver daemon at ${socketPath}: ${String(lastErr)}`);
  }

  private async startDaemon(): Promise<void> {
    const config = vscode.workspace.getConfiguration("emwaver");
    const cliPath = expandCliPath(config.get<string>("cliPath", "emwaver"));

    this.output.appendLine(`Daemon: starting via ${cliPath} daemon start`);
    const proc = cp.spawn(cliPath, ["daemon", "start"], {
      stdio: "ignore",
      detached: true,
    });
    proc.unref();

    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.once("error", (err) => {
        this.output.appendLine(`Daemon: failed to spawn: ${String(err)}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = undefined;
    if (this.socket) {
      this.socket.destroy();
    }
    this.socket = undefined;
  }

  private failAllPending(err: unknown) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.output.appendLine(`Daemon: invalid json: ${trimmed.slice(0, 200)}`);
      return;
    }

    if (typeof parsed?.event === "string") {
      this.onEventEmitter.fire(parsed as BridgeEvt);
      return;
    }

    const res = parsed as BridgeRes;
    const pending = typeof res?.id === "number" ? this.pending.get(res.id) : undefined;
    if (!pending) {
      this.output.appendLine(`Daemon: response without pending request id=${String(res?.id)}`);
      return;
    }
    this.pending.delete(res.id);
    if (res.ok) pending.resolve(res.result);
    else pending.reject(new Error(res.error?.message || "Bridge error"));
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.start();
    if (!this.socket) throw new Error("Daemon socket not connected");

    const id = this.nextId++;
    const req: BridgeReq = { id, method, params };
    const payload = JSON.stringify(req) + "\n";
    this.socket.write(payload, "utf8");

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  dispose() {
    void this.stop();
    this.onEventEmitter.dispose();
  }
}

export class EmwaverDeviceManager implements vscode.Disposable {
  private connectedDevice: DeviceInfo | undefined;
  private daemonRunning = false;
  private daemonSocketPath: string | undefined;
  private readonly onStatusEmitter = new vscode.EventEmitter<DeviceStatusSnapshot>();
  readonly onStatusChanged = this.onStatusEmitter.event;
  private readonly statusItem: vscode.StatusBarItem;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly bridge: EmwaverBridgeClient
  ) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.statusItem.command = "emwaver.connectDevice";
    this.statusItem.show();
    this.refreshStatus();

    this.bridge.onEvent((evt) => {
      if (evt.event === "connected") {
        const data: any = evt.data;
        this.daemonRunning = true;
        this.daemonSocketPath = this.bridge.getSocketPathSnapshot();
        this.connectedDevice = {
          transport: String(data.transport ?? "ble"),
          address: String(data.address ?? ""),
          name: String(data.name ?? "EMWaver"),
        };
        this.refreshStatus();
        this.onStatusEmitter.fire(this.getStatusSnapshot());
      }
      if (evt.event === "disconnected") {
        this.daemonRunning = true;
        this.daemonSocketPath = this.bridge.getSocketPathSnapshot();
        this.connectedDevice = undefined;
        this.refreshStatus();
        this.onStatusEmitter.fire(this.getStatusSnapshot());
      }
    });

    void this.refreshFromDaemon();
  }

  getStatusSnapshot(): DeviceStatusSnapshot {
    return {
      daemonRunning: this.daemonRunning,
      daemonSocketPath: this.daemonSocketPath,
      device: this.connectedDevice,
    };
  }

  private async refreshFromDaemon(): Promise<void> {
    try {
      await this.bridge.start();
      this.daemonRunning = this.bridge.isSocketConnected();
      this.daemonSocketPath = this.bridge.getSocketPathSnapshot();

      const status = await this.bridge.request<{ connected: boolean }>("connection_status", {});
      if (!status.connected) {
        this.connectedDevice = undefined;
        this.refreshStatus();
        this.onStatusEmitter.fire(this.getStatusSnapshot());
        return;
      }
      const res = await this.bridge.request<{ devices: DeviceInfo[] }>("list_connected", {});
      const first = Array.isArray(res?.devices) ? res.devices[0] : undefined;
      if (first?.address) {
        this.connectedDevice = first;
        this.refreshStatus();
        this.onStatusEmitter.fire(this.getStatusSnapshot());
      }
    } catch {
      this.daemonRunning = false;
      this.daemonSocketPath = this.bridge.getSocketPathSnapshot();
      this.connectedDevice = undefined;
      this.refreshStatus();
      this.onStatusEmitter.fire(this.getStatusSnapshot());
    }
  }

  private refreshStatus() {
    if (!this.daemonRunning) {
      this.statusItem.text = "EMWaver: Daemon offline";
      this.statusItem.tooltip = "Click to start the daemon and connect to an EMWaver device";
      this.statusItem.command = "emwaver.connectDevice";
      return;
    }

    if (this.connectedDevice?.address) {
      this.statusItem.text = `EMWaver: ${this.connectedDevice.name ?? "Device"} (${this.connectedDevice.transport})`;
      this.statusItem.tooltip = `Daemon: running (${this.daemonSocketPath ?? "default socket"})\nConnected: ${this.connectedDevice.address}\nClick to connect/change device`;
      this.statusItem.command = "emwaver.connectDevice";
    } else {
      this.statusItem.text = "EMWaver: Disconnected";
      this.statusItem.tooltip = `Daemon: running (${this.daemonSocketPath ?? "default socket"})\nClick to connect to an EMWaver device`;
      this.statusItem.command = "emwaver.connectDevice";
    }
  }

  async connectInteractive(): Promise<void> {
    try {
      await this.bridge.start();
      this.daemonRunning = this.bridge.isSocketConnected();
      this.daemonSocketPath = this.bridge.getSocketPathSnapshot();
    } catch (err) {
      this.daemonRunning = false;
      this.daemonSocketPath = this.bridge.getSocketPathSnapshot();
      this.connectedDevice = undefined;
      this.refreshStatus();
      this.onStatusEmitter.fire(this.getStatusSnapshot());
      void vscode.window.showErrorMessage(`EMWaver daemon not available: ${String(err)}`);
      return;
    }

    const status = await this.bridge.request<{ connected: boolean }>("connection_status", {});
    if (status.connected) {
      await this.refreshFromDaemon();
      return;
    }

    const result = await this.bridge.request<{ device: DeviceInfo }>("connect", {});
    this.connectedDevice = result.device;
    this.refreshStatus();
    this.onStatusEmitter.fire(this.getStatusSnapshot());
  }

  async disconnect(): Promise<void> {
    try {
      await this.bridge.request("disconnect", {});
    } finally {
      await this.refreshFromDaemon();
    }
  }

  async sendCommand(text: string, timeoutMs = 1500, packets = 1): Promise<Uint8Array> {
    const res = await this.bridge.request<{ bytes_b64: string }>("send_command", {
      text,
      timeout_ms: timeoutMs,
      packets,
    });
    const buf = Buffer.from(res.bytes_b64, "base64");
    return new Uint8Array(buf);
  }

  async write(bytes: Uint8Array): Promise<void> {
    const bytes_b64 = Buffer.from(bytes).toString("base64");
    await this.bridge.request("write", { bytes_b64 });
  }

  async connectionStatus(): Promise<"connected" | "disconnected"> {
    const res = await this.bridge.request<{ connected: boolean }>("connection_status", {});
    return res.connected ? "connected" : "disconnected";
  }

  dispose() {
    this.statusItem.dispose();
    this.onStatusEmitter.dispose();
  }
}
