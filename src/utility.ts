import * as vscode from "vscode";

/**
 * Resolves the VS Code configuration for the given section and document.
 * If a document is provided the configuration is resolved per resource,
 * which is required for multi-root workspaces.
 */
export function getConfiguration(
  section?: string,
  document?: vscode.TextDocument,
): vscode.WorkspaceConfiguration {
  return document
    ? vscode.workspace.getConfiguration(section, document.uri)
    : vscode.workspace.getConfiguration(section);
}

/**
 * Best-effort resolution of the Python interpreter path (set by
 * "Python: Select Interpreter"). Falls back to `python` when the
 * Python extension is missing or fails.
 */
export async function getPythonPath(document?: vscode.TextDocument): Promise<string> {
  try {
    const extension = vscode.extensions.getExtension("ms-python.python");
    if (!extension) {
      return "python";
    }

    const settings = extension.exports?.settings;
    if (!settings) {
      return "python";
    }

    if (typeof settings.getExecutionDetails === "function") {
      const details = settings.getExecutionDetails(document?.uri);
      const execCommand = details?.execCommand;
      return execCommand && execCommand.length > 0 ? execCommand.join(" ") : "python";
    }

    if (typeof settings.getExecutionCommand === "function") {
      const execCommand = settings.getExecutionCommand(document?.uri);
      return execCommand && execCommand.length > 0 ? execCommand.join(" ") : "python";
    }
  } catch {
    // Fall through to the default interpreter name.
  }

  return process.platform === "win32" ? "python" : "python3";
}
