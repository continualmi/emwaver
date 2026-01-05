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
import { BuildFlashViewProvider } from "./view";
import { EmwaverBridgeClient, EmwaverDeviceManager } from "./deviceBridge";
import { WaveletCodeLensProvider } from "./waveletCodeLens";
import { WaveletPreviewManager } from "./waveletPreview";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("EMWaver");
  context.subscriptions.push(output);
  output.appendLine("Activating EMWaver extension…");

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "EMWaver";
  status.tooltip = "Open EMWaver Wavelets";
  status.command = "emwaver.openBuildFlash";
  status.show();
  context.subscriptions.push(status);

  const buildFlashProvider = new BuildFlashViewProvider(context, output);
  const bridge = new EmwaverBridgeClient(output);
  const deviceManager = new EmwaverDeviceManager(output, bridge);
  context.subscriptions.push(bridge, deviceManager);
  buildFlashProvider.setDeviceManager(deviceManager);
  const waveletPreview = new WaveletPreviewManager(context, output, deviceManager);

  try {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        BuildFlashViewProvider.viewType,
        buildFlashProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );
    output.appendLine(`Registered view provider: ${BuildFlashViewProvider.viewType}`);
  } catch (err) {
    output.appendLine(`Failed to register view provider: ${String(err)}`);
    throw err;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("emwaver.openBuildFlash", async () => {
      output.appendLine("Command: emwaver.openBuildFlash");
      await vscode.commands.executeCommand("workbench.view.extension.emwaver");
      await vscode.commands.executeCommand("emwaver.buildFlashView.focus");
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand("emwaver.previewWavelet", async (uri?: vscode.Uri) => {
      output.appendLine(`Command: emwaver.previewWavelet ${uri ? uri.fsPath : ""}`);
      await waveletPreview.preview(uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emwaver.connectDevice", async () => {
      output.appendLine("Command: emwaver.connectDevice");
      await deviceManager.connectInteractive();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emwaver.disconnectDevice", async () => {
      output.appendLine("Command: emwaver.disconnectDevice");
      await deviceManager.disconnect();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emwaver.sendDeviceCommand", async () => {
      output.appendLine("Command: emwaver.sendDeviceCommand");
      const text = await vscode.window.showInputBox({
        title: "EMWaver device command",
        prompt: "Unix-style device command (sent as a 64-byte packet).",
        placeHolder: "spi --open --name cc1101 ...",
      });
      if (!text) return;

      const bytes = await deviceManager.sendCommand(text);
      const ascii = Array.from(bytes)
        .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
        .join("");
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      output.appendLine(`RX ascii: ${ascii}`);
      output.appendLine(`RX hex:   ${hex}`);
      output.show(true);
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: "emw", scheme: "file" }],
      new WaveletCodeLensProvider()
    )
  );

  output.appendLine("EMWaver extension activated.");
}

export function deactivate() {}
