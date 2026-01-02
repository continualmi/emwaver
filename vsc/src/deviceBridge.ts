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
import * as readline from "node:readline";
import { expandCliPath } from "./cliPath";

type BridgeReq = { id: number; method: string; params?: unknown };
type BridgeRes =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string } };
type BridgeEvt = { event: string; data: unknown };

export type DeviceInfo = { transport: string; name?: string | null; address: string };

export class EmwaverBridgeClient implements vscode.Disposable {
  private proc: cp.ChildProcessWithoutNullStreams | undefined;
  private rl: readline.Interface | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private onEventEmitter = new vscode.EventEmitter<BridgeEvt>();
  readonly onEvent = this.onEventEmitter.event;

  constructor(private readonly output: vscode.OutputChannel) {}

  async start(): Promise<void> {
    if (this.proc) return;

    const config = vscode.workspace.getConfiguration("emwaver");
    const cliPath = expandCliPath(config.get<string>("cliPath", "emwaver"));

    this.output.appendLine(`Device bridge: starting ${cliPath} connect --bridge`);

    const proc = cp.spawn(cliPath, ["connect", "--bridge"], {
      stdio: "pipe",
    });
    this.proc = proc;

    proc.on("error", (err) => {
      this.output.appendLine(`Device bridge: process error: ${String(err)}`);
      this.failAllPending(err);
      this.stop();
    });

    proc.on("exit", (code, signal) => {
      this.output.appendLine(`Device bridge: exited code=${String(code)} signal=${String(signal)}`);
      this.failAllPending(new Error("Bridge exited"));
      this.stop();
    });

    proc.stderr.on("data", (buf) => {
      const text = buf.toString("utf8").trim();
      if (text) this.output.appendLine(`[bridge] ${text}`);
    });

    const rl = readline.createInterface({ input: proc.stdout });
    this.rl = rl;
    rl.on("line", (line) => this.handleLine(line));

    await this.request("hello", {});
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = undefined;
    if (this.proc) {
      this.proc.kill();
    }
    this.proc = undefined;
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
      this.output.appendLine(`Device bridge: invalid json: ${trimmed.slice(0, 200)}`);
      return;
    }

    if (typeof parsed?.event === "string") {
      this.onEventEmitter.fire(parsed as BridgeEvt);
      return;
    }

    const res = parsed as BridgeRes;
    const pending = typeof res?.id === "number" ? this.pending.get(res.id) : undefined;
    if (!pending) {
      this.output.appendLine(`Device bridge: response without pending request id=${String(res?.id)}`);
      return;
    }
    this.pending.delete(res.id);
    if (res.ok) pending.resolve(res.result);
    else pending.reject(new Error(res.error?.message || "Bridge error"));
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.start();
    if (!this.proc) throw new Error("Bridge not running");

    const id = this.nextId++;
    const req: BridgeReq = { id, method, params };
    const payload = JSON.stringify(req) + "\n";
    this.proc.stdin.write(payload, "utf8");

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
  private readonly onStatusEmitter = new vscode.EventEmitter<DeviceInfo | undefined>();
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
        this.connectedDevice = {
          transport: String(data.transport ?? "ble"),
          address: String(data.address ?? ""),
          name: String(data.name ?? "EMWaver"),
        };
        this.refreshStatus();
        this.onStatusEmitter.fire(this.connectedDevice);
      }
      if (evt.event === "disconnected") {
        this.connectedDevice = undefined;
        this.refreshStatus();
        this.onStatusEmitter.fire(undefined);
      }
    });
  }

  getStatusSnapshot(): DeviceInfo | undefined {
    return this.connectedDevice;
  }

  private refreshStatus() {
    if (this.connectedDevice?.address) {
      this.statusItem.text = `EMWaver: ${this.connectedDevice.name ?? "Device"} (${this.connectedDevice.transport})`;
      this.statusItem.tooltip = `Connected: ${this.connectedDevice.address}\nClick to connect/change device`;
      this.statusItem.command = "emwaver.connectDevice";
    } else {
      this.statusItem.text = "EMWaver: Disconnected";
      this.statusItem.tooltip = "Click to connect to an EMWaver device";
      this.statusItem.command = "emwaver.connectDevice";
    }
  }

  async connectInteractive(): Promise<void> {
    const res = await this.bridge.request<{ devices: DeviceInfo[] }>("list_devices", {
      timeout_ms: 5000,
    });
    const devices = (res?.devices || []).slice();
    if (!devices.length) {
      void vscode.window.showWarningMessage("EMWaver: No devices found (is Bluetooth enabled?)");
      return;
    }

    const picks = devices.map((d) => ({
      label: d.name ? `${d.name}` : "(no name)",
      description: `${d.transport}:${d.address}`,
      detail: d.address,
      device: d,
    }));
    const chosen = await vscode.window.showQuickPick(picks, {
      title: "Connect to EMWaver device",
      placeHolder: "Select a device",
    });
    if (!chosen) return;

    const result = await this.bridge.request<{ device: DeviceInfo }>("connect", {
      address: chosen.device.address,
    });
    this.connectedDevice = result.device;
    this.refreshStatus();
  }

  async disconnect(): Promise<void> {
    await this.bridge.request("disconnect", {});
    this.connectedDevice = undefined;
    this.refreshStatus();
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
