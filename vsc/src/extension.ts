import * as vscode from "vscode";
import { BuildFlashViewProvider } from "./view";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("EMWaver");
  context.subscriptions.push(output);
  output.appendLine("Activating EMWaver extension…");

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "EMWaver";
  status.tooltip = "Open EMWaver Build & Flash";
  status.command = "emwaver.openBuildFlash";
  status.show();
  context.subscriptions.push(status);

  const buildFlashProvider = new BuildFlashViewProvider(context, output);

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
    vscode.commands.registerCommand("emwaver.build", async () => {
      output.appendLine("Command: emwaver.build");
      await buildFlashProvider.runAction("build");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emwaver.flash", async () => {
      output.appendLine("Command: emwaver.flash");
      await buildFlashProvider.runAction("flash");
    })
  );

  output.appendLine("EMWaver extension activated.");
}

export function deactivate() {}
