import * as vscode from "vscode";

import { CodeManager } from "./codeManager";

let codeManager: CodeManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  codeManager = new CodeManager();

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => codeManager?.onDidCloseTerminal()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("code-runner.run", (fileUri?: vscode.Uri) => {
      void codeManager?.run(undefined, fileUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("code-runner.runCustomCommand", () => {
      codeManager?.runCustomCommand();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("code-runner.runByLanguage", () => {
      codeManager?.runByLanguage();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("code-runner.stop", () => {
      codeManager?.stop();
    }),
  );

  if (codeManager) {
    context.subscriptions.push(codeManager);
  }
}

export function deactivate(): void {
  codeManager?.dispose();
  codeManager = undefined;
}
