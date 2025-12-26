import * as vscode from "vscode";

type BuildFlashAction = "build" | "flash";

export class BuildFlashViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "emwaver.buildFlashView";

  private view: vscode.WebviewView | undefined;
  private terminal: vscode.Terminal | undefined;
  private terminalCwd: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.output.appendLine("Resolving Build & Flash view…");
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        if (!message || typeof message !== "object") return;
        if (message.type === "run" && (message.action === "build" || message.action === "flash")) {
          await this.runAction(message.action);
        }
      } catch (err) {
        this.output.appendLine(`Webview message handler error: ${String(err)}`);
        throw err;
      }
    });
  }

  async runAction(action: BuildFlashAction) {
    this.output.appendLine(`Action: ${action}`);
    const cwd = await this.getWorkingDirectory();
    if (!cwd) return;

    const config = vscode.workspace.getConfiguration("emwaver");
    const cliPath = config.get<string>("cliPath", "emwaver");

    const args =
      action === "build"
        ? config.get<string[]>("buildArgs", [])
        : config.get<string[]>("flashArgs", []);

    const cmd = [cliPath, action, ...args];

    const commandLine = this.toShellCommand(cmd);
    const terminal = this.getOrCreateTerminal(cwd);
    terminal.show(true);
    terminal.sendText(commandLine);

    this.view?.webview.postMessage({ type: "status", status: `Running: ${cmd.join(" ")}` });
  }

  private async getWorkingDirectory(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("emwaver");
    const configured = config.get<string>("workingDirectory", "").trim();
    if (configured) return configured;

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const folder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    const chosen = folder ?? vscode.workspace.workspaceFolders?.[0];

    if (!chosen) {
      void vscode.window.showErrorMessage("EMWaver: Open a folder/workspace first.");
      return undefined;
    }

    return chosen.uri.fsPath;
  }

  private getOrCreateTerminal(cwd: string): vscode.Terminal {
    if (this.terminal && this.terminalCwd === cwd) return this.terminal;
    this.terminal?.dispose();
    this.terminal = vscode.window.createTerminal({ name: "EMWaver", cwd });
    this.terminalCwd = cwd;
    this.context.subscriptions.push(this.terminal);
    return this.terminal;
  }

  private toShellCommand(parts: string[]): string {
    return parts.map(this.quoteIfNeeded).join(" ");
  }

  private quoteIfNeeded(part: string): string {
    if (!part) return "\"\"";
    if (!/[\\s"]/u.test(part)) return part;
    return `"${part.replaceAll("\"", "\\\"")}"`;
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
        <button class="primary" id="build">Build</button>
        <button class="primary" id="flash">Flash</button>
      </div>
      <div class="status" id="status">Idle</div>
      <div class="hint">
        Runs <code>emwaver build</code> / <code>emwaver flash</code> in the EMWaver terminal.
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
}
