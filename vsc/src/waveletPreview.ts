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

import * as path from "node:path";
import * as vscode from "vscode";

type WaveletPreviewMessage = {
  type: "load";
  fileName: string;
  script: string;
  bootstrap: string;
  modules: Record<string, string>;
};

const MAX_MODULE_FILES = 400;
const MAX_MODULE_DEPTH = 10;

export class WaveletPreviewManager {
  private readonly panelsByFsPath = new Map<string, vscode.WebviewPanel>();
  private bootstrapSource: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(async (event) => {
        const panel = this.panelsByFsPath.get(event.document.uri.fsPath);
        if (!panel) return;
        await this.updatePanel(panel, event.document.uri, event.document.getText());
      })
    );
  }

  async preview(uri?: vscode.Uri): Promise<void> {
    const resolved = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!resolved) {
      void vscode.window.showErrorMessage("EMWaver: Open a .emw file to preview.");
      return;
    }

    if (resolved.scheme !== "file" || !resolved.fsPath.toLowerCase().endsWith(".emw")) {
      void vscode.window.showErrorMessage("EMWaver: Preview works on .emw files only.");
      return;
    }

    const existing = this.panelsByFsPath.get(resolved.fsPath);
    if (existing) {
      existing.reveal(existing.viewColumn ?? this.getPreferredViewColumn(), false);
      const doc = await vscode.workspace.openTextDocument(resolved);
      await this.updatePanel(existing, resolved, doc.getText());
      return;
    }

    const title = `Wavelet Preview: ${path.basename(resolved.fsPath)}`;
    const panel = vscode.window.createWebviewPanel(
      "emwaver.waveletPreview",
      title,
      { viewColumn: this.getPreferredViewColumn(), preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );

    panel.webview.html = this.getHtml(panel.webview);
    this.panelsByFsPath.set(resolved.fsPath, panel);
    panel.onDidDispose(() => {
      this.panelsByFsPath.delete(resolved.fsPath);
    });
    panel.webview.onDidReceiveMessage((message) => {
      try {
        if (!message || typeof message !== "object") return;
        if (message.type === "log" && typeof message.line === "string") {
          this.output.appendLine(`[wavelet] ${message.line}`);
        }
      } catch (err) {
        this.output.appendLine(`Wavelet preview message error: ${String(err)}`);
      }
    });

    const doc = await vscode.workspace.openTextDocument(resolved);
    await this.updatePanel(panel, resolved, doc.getText());
  }

  private async updatePanel(panel: vscode.WebviewPanel, uri: vscode.Uri, script: string): Promise<void> {
    try {
      const bootstrap = await this.getBootstrapSource();
      const modules = await this.collectModuleSources(uri);

      const message: WaveletPreviewMessage = {
        type: "load",
        fileName: path.basename(uri.fsPath),
        script,
        bootstrap,
        modules,
      };

      void panel.webview.postMessage(message);
    } catch (err) {
      this.output.appendLine(`Wavelet preview update failed: ${String(err)}`);
      void vscode.window.showErrorMessage(`EMWaver: Failed to preview wavelet (${String(err)}).`);
    }
  }

  private async getBootstrapSource(): Promise<string> {
    if (this.bootstrapSource !== undefined) return this.bootstrapSource;
    const bootstrapUri = vscode.Uri.joinPath(this.context.extensionUri, "media", "wavelet_bootstrap.emw");
    const raw = await vscode.workspace.fs.readFile(bootstrapUri);
    this.bootstrapSource = new TextDecoder("utf-8").decode(raw);
    return this.bootstrapSource;
  }

  private async collectModuleSources(entryUri: vscode.Uri): Promise<Record<string, string>> {
    const baseDirFsPath = path.dirname(entryUri.fsPath);
    const baseDirUri = vscode.Uri.file(baseDirFsPath);
    const sources: Record<string, string> = {};

    type WorkItem = { uri: vscode.Uri; depth: number };
    const queue: WorkItem[] = [{ uri: baseDirUri, depth: 0 }];
    let fileCount = 0;

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      if (item.depth > MAX_MODULE_DEPTH) continue;

      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(item.uri);
      } catch {
        continue;
      }

      for (const [name, type] of entries) {
        if (name.startsWith(".")) continue;
        if (name === "node_modules" || name === "dist" || name === "build" || name === "target") continue;

        const childUri = vscode.Uri.joinPath(item.uri, name);
        if (type === vscode.FileType.Directory) {
          queue.push({ uri: childUri, depth: item.depth + 1 });
          continue;
        }

        if (type !== vscode.FileType.File) continue;
        if (!name.toLowerCase().endsWith(".emw") && !name.toLowerCase().endsWith(".js")) continue;

        if (childUri.fsPath === entryUri.fsPath) continue;

        if (fileCount >= MAX_MODULE_FILES) return sources;
        fileCount += 1;

        try {
          const raw = await vscode.workspace.fs.readFile(childUri);
          const text = new TextDecoder("utf-8").decode(raw);
          const rel = path.relative(baseDirFsPath, childUri.fsPath).split(path.sep).join("/");
          sources[rel] = text;
        } catch {
          // Ignore unreadable modules.
        }
      }
    }

    return sources;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "waveletPreview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "waveletPreview.css"));

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Wavelet Preview</title>
  </head>
  <body>
    <div id="preview" class="previewRoot"></div>
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

  private getPreferredViewColumn(): vscode.ViewColumn {
    return vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;
  }
}
