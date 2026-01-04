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
import { EmwaverDeviceManager, DeviceInfo, DeviceStatusSnapshot } from "./deviceBridge";

export class BuildFlashViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "emwaver.buildFlashView";

  private view: vscode.WebviewView | undefined;
  private deviceManager: EmwaverDeviceManager | undefined;
  private deviceStatusDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  setDeviceManager(deviceManager: EmwaverDeviceManager) {
    this.deviceManager = deviceManager;
    this.deviceStatusDisposable?.dispose();
    this.deviceStatusDisposable = deviceManager.onStatusChanged((snapshot) => {
      void this.view?.webview.postMessage({
        type: "deviceStatus",
        device: this.toDeviceStatusPayload(snapshot),
      });
    });
    this.context.subscriptions.push(this.deviceStatusDisposable);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.output.appendLine("Resolving Wavelets view…");
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        if (!message || typeof message !== "object") return;
        if (message.type === "previewWavelet") {
          await vscode.commands.executeCommand("emwaver.previewWavelet");
        }
        if (message.type === "connectDevice") {
          await vscode.commands.executeCommand("emwaver.connectDevice");
        }
        if (message.type === "disconnectDevice") {
          await vscode.commands.executeCommand("emwaver.disconnectDevice");
        }
        if (message.type === "requestDeviceStatus") {
          const snapshot = this.deviceManager?.getStatusSnapshot();
          void this.view?.webview.postMessage({
            type: "deviceStatus",
            device: this.toDeviceStatusPayload(snapshot),
          });
        }
      } catch (err) {
        this.output.appendLine(`Webview message handler error: ${String(err)}`);
        throw err;
      }
    });

    const snapshot = this.deviceManager?.getStatusSnapshot();
    void this.view?.webview.postMessage({
      type: "deviceStatus",
      device: this.toDeviceStatusPayload(snapshot),
    });
  }


  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const nonce = this.getNonce();

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>EMWaver</title>
  </head>
  <body>
    <div class="container">
      <div class="row">
        <button class="primary" id="previewWavelet">Preview</button>
      </div>
      <div class="row">
        <button class="secondary" id="connectDevice">Connect</button>
        <button class="secondary" id="disconnectDevice">Disconnect</button>
      </div>
      <div class="status" id="deviceStatus">Device: Disconnected</div>
      <div class="status" id="status">Idle</div>
      <div class="hint">
        Previews the active <code>.emw</code> wavelet in an editor tab, and manages device connection.
      </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private getNonce(): string {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
  }

  private toDeviceStatusPayload(
    snapshot: DeviceStatusSnapshot | undefined
  ): { connected: boolean; label: string; address?: string; daemonRunning?: boolean } {
    if (!snapshot) return { connected: false, label: "Disconnected", daemonRunning: false };

    const info: DeviceInfo | undefined = snapshot.device;
    if (!info?.address) return { connected: false, label: "Disconnected", daemonRunning: snapshot.daemonRunning };

    const name = info.name || "Device";
    return {
      connected: true,
      label: `${name} (${info.transport})`,
      address: info.address,
      daemonRunning: snapshot.daemonRunning,
    };
  }
}
