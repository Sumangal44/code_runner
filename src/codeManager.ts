import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import kill from "tree-kill";

import * as vscode from "vscode";

import { buildCommand } from "./commandBuilder";
import { resolveExecutor } from "./commandResolver";
import type { ScriptConfig } from "./config";
import { Telemetry } from "./telemetry";
import { getConfiguration, getPythonPath } from "./utility";

export class CodeManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private terminal: vscode.Terminal | undefined;

  private document: vscode.TextDocument | undefined;
  private config: vscode.WorkspaceConfiguration;
  private appInsights: Telemetry;

  private runFromExplorer = false;
  private isRunning = false;
  private isTmpFile = false;

  private process?: ChildProcess & {
    pid: number;
  };

  private codeFile = "";
  private cwd = "";
  private workspaceFolder = "";
  private lastArguments = "";
  private statusBarItem?: vscode.StatusBarItem;
  private timeoutTimer?: NodeJS.Timeout;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Code");
    this.appInsights = new Telemetry();
    this.config = getConfiguration("code-runner");
    this.initStatusBar();
  }

  onDidCloseTerminal(): void {
    this.terminal = undefined;
  }

  private initStatusBar(): void {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.updateStatusBar(false);
  }

  private updateStatusBar(running: boolean): void {
    if (!this.statusBarItem) {
      return;
    }
    const showButton = this.config.get<boolean>("showRunButtonInStatusBar", true);
    if (!showButton) {
      this.statusBarItem.hide();
      return;
    }
    if (running) {
      this.statusBarItem.text = "$(debug-stop) Stop Code";
      this.statusBarItem.tooltip = "Click to stop running code";
      this.statusBarItem.command = "code-runner.stop";
    } else {
      this.statusBarItem.text = "$(play) Run Code";
      this.statusBarItem.tooltip = "Click to run code";
      this.statusBarItem.command = "code-runner.run";
    }
    this.statusBarItem.show();
  }

  async run(languageId?: string, fileUri?: vscode.Uri, customArgs?: string): Promise<void> {
    if (this.isRunning) {
      vscode.window.showInformationMessage("Code is already running!");
      return;
    }

    this.runFromExplorer = this.checkIsRunFromExplorer(fileUri);
    if (this.runFromExplorer && fileUri) {
      this.document = await vscode.workspace.openTextDocument(fileUri);
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No code found or selected.");
        return;
      }
      this.document = editor.document;
    }

    this.initialize();

    const fileExtension = this.extensionOf(this.document.fileName);
    const executor = this.getExecutor(languageId, fileExtension);
    if (!executor) {
      vscode.window.showInformationMessage("Code language not supported or defined.");
      return;
    }

    this.getCodeFileAndExecute(fileExtension, executor, true, customArgs);
  }

  async runWithArguments(fileUri?: vscode.Uri): Promise<void> {
    const args = await vscode.window.showInputBox({
      prompt: "Enter command-line arguments to pass to the program",
      value: this.lastArguments,
      placeHolder: "e.g. arg1 arg2 --flag",
    });
    if (args === undefined) {
      return;
    }
    this.lastArguments = args;
    await this.run(undefined, fileUri, args);
  }

  async copyRunCommand(fileUri?: vscode.Uri): Promise<void> {
    this.runFromExplorer = this.checkIsRunFromExplorer(fileUri);
    if (this.runFromExplorer && fileUri) {
      this.document = await vscode.workspace.openTextDocument(fileUri);
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No code found or selected.");
        return;
      }
      this.document = editor.document;
    }

    this.initialize();

    const fileExtension = this.extensionOf(this.document.fileName);
    const executor = this.getExecutor(undefined, fileExtension);
    if (!executor) {
      vscode.window.showInformationMessage("Code language not supported or defined.");
      return;
    }

    this.codeFile = this.document.fileName;
    const command = await this.getFinalCommandToRunCodeFile(executor, true);
    await vscode.env.clipboard.writeText(command);
    vscode.window.showInformationMessage(`Copied run command to clipboard: ${command}`);
  }

  clearOutput(): void {
    this.outputChannel.clear();
  }

  runCustomCommand(): void {
    if (this.isRunning) {
      vscode.window.showInformationMessage("Code is already running!");
      return;
    }

    this.runFromExplorer = false;
    const editor = vscode.window.activeTextEditor;
    this.document = editor?.document;

    this.initialize();

    const executor = this.config.get<string>("customCommand", "echo Hello");
    if (this.document) {
      this.getCodeFileAndExecute(this.extensionOf(this.document.fileName), executor, false);
    } else {
      void this.executeCommand(executor, false);
    }
  }

  runByLanguage(): void {
    this.appInsights.sendEvent("runByLanguage");
    const executorMap = getConfiguration("code-runner", this.document).get<Record<string, string>>(
      "executorMap",
      {},
    );
    void vscode.window
      .showQuickPick(Object.keys(executorMap), { placeHolder: "Type or select language to run" })
      .then((languageId) => {
        if (languageId !== undefined) {
          void this.run(languageId);
        }
      });
  }

  stop(): void {
    this.appInsights.sendEvent("stop");
    this.stopRunning();
  }

  dispose(): void {
    this.stopRunning();
    this.statusBarItem?.dispose();
    this.appInsights.dispose();
  }

  private checkIsRunFromExplorer(fileUri?: vscode.Uri): boolean {
    if (!fileUri?.fsPath) {
      return false;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return true;
    }
    return fileUri.fsPath !== editor.document.uri.fsPath;
  }

  private stopRunning(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    if (this.isRunning && this.process) {
      this.isRunning = false;
      this.updateStatusBar(false);
      void vscode.commands.executeCommand("setContext", "code-runner.codeRunning", false);
      kill(this.process.pid);
    }
  }

  private initialize(): void {
    this.config = getConfiguration("code-runner", this.document);
    this.cwd = this.config.get<string>("cwd", "");

    if (this.cwd) {
      return;
    }

    this.workspaceFolder = this.getWorkspaceFolder();
    if (
      (this.config.get<boolean>("fileDirectoryAsCwd", false) || !this.workspaceFolder) &&
      this.document &&
      !this.document.isUntitled
    ) {
      this.cwd = this.document.fileName.split(/[\\/]/).slice(0, -1).join("/") || "/";
    } else {
      this.cwd = this.workspaceFolder;
    }

    if (!this.cwd) {
      this.cwd = os.tmpdir();
    }
  }

  private getWorkspaceFolder(): string {
    if (!vscode.workspace.workspaceFolders) {
      return "";
    }
    if (this.document) {
      const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
      if (folder) {
        return folder.uri.fsPath;
      }
    }
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }

  private getCodeFileAndExecute(
    fileExtension: string,
    executor: string,
    appendFile = true,
    customArgs?: string,
  ): void {
    const activeTextEditor = vscode.window.activeTextEditor;
    const selection = activeTextEditor?.selection;
    const ignoreSelection = this.config.get<boolean>("ignoreSelection", false);

    if (
      (this.runFromExplorer || !selection || selection.isEmpty || ignoreSelection) &&
      this.document &&
      !this.document.isUntitled
    ) {
      this.isTmpFile = false;
      this.codeFile = this.document.fileName;

      if (this.config.get<boolean>("saveAllFilesBeforeRun", false)) {
        void vscode.workspace
          .saveAll()
          .then(() => void this.executeCommand(executor, appendFile, customArgs));
        return;
      }
      if (this.config.get<boolean>("saveFileBeforeRun", false)) {
        void this.document
          .save()
          .then(() => void this.executeCommand(executor, appendFile, customArgs));
        return;
      }
    } else if (this.document) {
      let text =
        this.runFromExplorer || !selection || selection.isEmpty || ignoreSelection
          ? this.document.getText()
          : this.document.getText(selection);

      const languageId = this.languageIdOf(this.document);
      if (languageId === "php") {
        text = text.trim();
        if (!text.startsWith("<?php")) {
          text = "<?php\r\n" + text;
        }
      }

      this.isTmpFile = true;
      const folder = this.document.isUntitled
        ? this.cwd
        : this.document.fileName.split(/[\\/]/).slice(0, -1).join("/") || "/";
      this.createRandomFile(text, folder, fileExtension);
    }

    void this.executeCommand(executor, appendFile, customArgs);
  }

  private createRandomFile(content: string, folder: string, fileExtension: string): void {
    const languageIdToFileExtensionMap = this.config.get<Record<string, string>>(
      "languageIdToFileExtensionMap",
      {},
    );
    const languageId = this.document ? this.languageIdOf(this.document) : "";

    let fileType = languageIdToFileExtensionMap[languageId] ?? "";
    if (!fileType) {
      fileType = fileExtension || `.${languageId}`;
    }

    const temporaryFileName = this.config.get<string>("temporaryFileName", "tempCodeRunnerFile");
    const tmpFileNameWithoutExt = temporaryFileName || `temp${this.rndName()}`;
    this.codeFile = join(folder, tmpFileNameWithoutExt + fileType);
    writeFileSync(this.codeFile, content);
  }

  private extensionOf(fileName: string): string {
    const idx = fileName.lastIndexOf(".");
    return idx >= 0 ? fileName.slice(idx) : "";
  }

  private languageIdOf(document: vscode.TextDocument): string {
    return document.languageId;
  }

  private rndName(): string {
    return randomBytes(5).toString("hex");
  }

  private getExecutor(languageId: string | undefined, fileExtension: string): string | undefined {
    if (!this.document) {
      return undefined;
    }

    const scriptConfig: ScriptConfig = {
      executorMap: this.config.get<Record<string, string>>("executorMap", {}),
      executorMapByGlob: this.config.get<Record<string, string>>("executorMapByGlob", {}),
      executorMapByFileExtension: this.config.get<Record<string, string>>(
        "executorMapByFileExtension",
        {},
      ),
      defaultLanguage: this.config.get<string>("defaultLanguage", ""),
      respectShebang: this.config.get<boolean>("respectShebang", true),
      shebang: this.document.lineCount > 0 ? this.document.lineAt(0).text : "",
    };

    const resolvedLanguageId = languageId ?? this.languageIdOf(this.document);
    const respectShebang = languageId === undefined && scriptConfig.respectShebang;
    const resolved = resolveExecutor(
      scriptConfig,
      resolvedLanguageId,
      fileExtension,
      basenameOf(this.document.fileName),
      respectShebang,
    );
    return resolved?.executor;
  }

  private async executeCommand(
    executor: string,
    appendFile = true,
    customArgs?: string,
  ): Promise<void> {
    if (this.config.get<boolean>("runInTerminal", false)) {
      await this.executeCommandInTerminal(executor, appendFile, customArgs);
    } else {
      await this.executeCommandInOutputChannel(executor, appendFile, customArgs);
    }
  }

  private async getFinalCommandToRunCodeFile(
    executor: string,
    appendFile = true,
    customArgs?: string,
  ): Promise<string> {
    let pythonPath = "python";
    if (executor.includes("$pythonPath")) {
      pythonPath = await getPythonPath(this.document);
    }
    const customEnv = this.config.get<Record<string, string>>("customEnv", {});
    return buildCommand(
      executor,
      {
        codeFile: this.codeFile,
        workspaceFolder: this.workspaceFolder,
        pythonPath,
        args: customArgs,
        cwd: this.cwd,
        env: customEnv,
      },
      appendFile,
    );
  }

  private changeExecutorFromCmdToPs(executor: string): string {
    if (executor.includes(" && ") && this.isPowershellOnWindows()) {
      let replacement = "; if ($?) {";
      executor = executor.replace("&&", replacement);
      replacement = "} " + replacement;
      executor = executor.replace(/&&/g, replacement);
      executor = executor.replace(/\$dir\$fileNameWithoutExt/g, ".\\$fileNameWithoutExt");
      return executor + " }";
    }
    return executor;
  }

  private isPowershellOnWindows(): boolean {
    if (os.platform() !== "win32") {
      return false;
    }
    const defaultProfile = vscode.workspace
      .getConfiguration("terminal")
      .get<string>("integrated.defaultProfile.windows");
    if (defaultProfile) {
      if (defaultProfile.toLowerCase().includes("powershell")) {
        return true;
      }
      if (defaultProfile === "Command Prompt") {
        return false;
      }
    }
    const windowsShell = vscode.env.shell;
    return Boolean(windowsShell && windowsShell.toLowerCase().includes("powershell"));
  }

  private changeFilePathForBashOnWindows(command: string): string {
    if (os.platform() !== "win32") {
      return command;
    }
    const windowsShell = vscode.env.shell;
    const terminalRoot = this.config.get<string>("terminalRoot", "");
    if (windowsShell && terminalRoot) {
      return command
        .replace(/([A-Za-z]):\\/g, (_match, p1: string) => `${terminalRoot}${p1.toLowerCase()}/`)
        .replace(/\\/g, "/");
    }
    if (
      windowsShell &&
      windowsShell.toLowerCase().includes("bash") &&
      windowsShell.toLowerCase().includes("windows")
    ) {
      return command
        .replace(/([A-Za-z]):\\/g, (_match, p1: string) => `/mnt/${p1.toLowerCase()}/`)
        .replace(/\\/g, "/");
    }
    return command;
  }

  private async executeCommandInTerminal(
    executor: string,
    appendFile = true,
    customArgs?: string,
  ): Promise<void> {
    let isNewTerminal = false;
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal("Code");
      isNewTerminal = true;
    }
    this.terminal.show(this.config.get<boolean>("preserveFocus", true));
    this.sendRunEvent(executor, true);

    const psExecutor = this.changeExecutorFromCmdToPs(executor);
    const command = this.changeFilePathForBashOnWindows(
      await this.getFinalCommandToRunCodeFile(psExecutor, appendFile, customArgs),
    );

    if (this.config.get<boolean>("clearPreviousOutput", false) && !isNewTerminal) {
      await vscode.commands.executeCommand("workbench.action.terminal.clear");
    }
    if (this.config.get<boolean>("fileDirectoryAsCwd", false)) {
      const cwd = this.changeFilePathForBashOnWindows(this.cwd);
      this.terminal.sendText(`cd "${cwd}"`);
    }
    this.terminal.sendText(command);
  }

  private async executeCommandInOutputChannel(
    executor: string,
    appendFile = true,
    customArgs?: string,
  ): Promise<void> {
    this.isRunning = true;
    this.updateStatusBar(true);
    void vscode.commands.executeCommand("setContext", "code-runner.codeRunning", true);

    if (this.config.get<boolean>("clearPreviousOutput", false)) {
      this.outputChannel.clear();
    }

    const showExecutionMessage = this.config.get<boolean>("showExecutionMessage", true);
    this.outputChannel.show(this.config.get<boolean>("preserveFocus", true));

    const command = await this.getFinalCommandToRunCodeFile(executor, appendFile, customArgs);
    if (showExecutionMessage) {
      this.outputChannel.appendLine(`[Running] ${command}`);
    }
    this.sendRunEvent(executor, false);

    const customEnv = this.config.get<Record<string, string>>("customEnv", {});
    const env: NodeJS.ProcessEnv = { ...process.env, ...customEnv };

    if (os.platform() === "darwin" && !env.JAVA_HOME) {
      try {
        const javaHome = execSync("/usr/libexec/java_home 2>/dev/null", { encoding: "utf8" }).trim();
        if (javaHome) {
          env.JAVA_HOME = javaHome;
          env.PATH = `${javaHome}/bin:${env.PATH ?? ""}`;
        }
      } catch {
        // Fall through to system PATH
      }
    }

    const startTime = Date.now();
    const child = spawn(command, { cwd: this.cwd, shell: true, env });
    this.process = child as ChildProcess & { pid: number };

    const timeout = this.config.get<number>("timeout", 0);
    if (timeout > 0) {
      this.timeoutTimer = setTimeout(() => {
        if (this.isRunning) {
          this.outputChannel.appendLine(
            `\n[Timeout] Process exceeded timeout of ${timeout}ms. Stopping...`,
          );
          this.stopRunning();
        }
      }, timeout);
    }

    child.stdout.on("data", (data) => this.outputChannel.append(data.toString()));
    child.stderr.on("data", (data) => this.outputChannel.append(data.toString()));

    child.on("close", (code) => {
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = undefined;
      }
      this.isRunning = false;
      this.updateStatusBar(false);
      void vscode.commands.executeCommand("setContext", "code-runner.codeRunning", false);
      const elapsed = (Date.now() - startTime) / 1000;
      this.outputChannel.appendLine("");
      if (showExecutionMessage) {
        this.outputChannel.appendLine(`[Done] exited with code=${code} in ${elapsed} seconds`);
        this.outputChannel.appendLine("");
      }
      if (this.isTmpFile && this.codeFile) {
        try {
          rmSync(this.codeFile, { force: true });
        } catch {
          // Best effort cleanup.
        }
      }
    });
  }

  private sendRunEvent(executor: string, runFromTerminal: boolean): void {
    this.appInsights.sendEvent(executor, {
      runFromTerminal: String(runFromTerminal),
      runFromExplorer: String(this.runFromExplorer),
      isTmpFile: String(this.isTmpFile),
    });
  }
}

function basenameOf(fileName: string): string {
  const normalized = fileName.split(/[\\/]/).pop() ?? fileName;
  return normalized;
}
