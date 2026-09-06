import type { TextDocument } from "vscode";

import type { CommandExecutor } from "./commandResolver";

export interface ScriptConfig {
  executorMap: Record<string, string>;
  executorMapByGlob: Record<string, string>;
  executorMapByFileExtension: Record<string, string>;
  defaultLanguage: string;
  respectShebang: boolean;
  shebang?: string;
}

export interface RunInput {
  document?: TextDocument;
  fileName?: string;
  fileExtension?: string;
  languageId?: string;
}

/**
 * Represents the plan for running a snippet or file. Produced synchronously
 * so it can be unit tested without a live VS Code host.
 */
export interface SnippetPlan {
  languageId: string;
  executor?: CommandExecutor;
  content?: string;
  tmpFile?: boolean;
}

/**
 * Fragments of a textual placeholder substitution job that can be executed
 * against a concrete file path. Kept independent of the VS Code API.
 */
export interface PlaceholderInput {
  codeFile: string;
  workspaceFolder?: string;
  pythonPath?: string;
}
