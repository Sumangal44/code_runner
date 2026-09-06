import { posix, win32 } from "node:path";

export interface CommandInput {
  /** Full path to the code file being run, if any. */
  codeFile?: string;
  /** Path of the root workspace folder, if any. */
  workspaceFolder?: string;
  /** Python interpreter command, if resolved. */
  pythonPath?: string;
}

const IS_WINDOWS_PATH = /^[A-Za-z]:[\\/]/;

function pathModuleFor(codeFile: string): typeof posix {
  return IS_WINDOWS_PATH.test(codeFile) ? win32 : posix;
}

/**
 * Splits a fully qualified file path into its components in a
 * cross-platform way. Handles both POSIX and Windows separators
 * so the logic behaves identically on Linux, macOS and Windows.
 */
export function splitFilePath(codeFile: string): {
  dir: string;
  dirWithoutTrailingSlash: string;
  baseName: string;
  baseNameWithoutExt: string;
  driveLetter: string;
} {
  const pathModule = pathModuleFor(codeFile);
  const dir = pathModule.dirname(codeFile);
  const baseName = pathModule.basename(codeFile);
  const baseNameWithoutExt = pathModule.basename(codeFile, pathModule.extname(codeFile));
  const driveLetter = /^([A-Za-z]:).*/.exec(codeFile)?.[1] ?? "$driveLetter";
  return {
    dir,
    dirWithoutTrailingSlash: dir.replace(/[\\/]+$/, ""),
    baseName,
    baseNameWithoutExt,
    driveLetter,
  };
}

function quote(value: string): string {
  return `"${value}"`;
}

/**
 * Substitutes the supported placeholders inside an executor command.
 *
 * Supported placeholders:
 *   $workspaceRoot            -> workspace root folder (or code file dir)
 *   $dir                      -> directory of the code file (quoted)
 *   $dirWithoutTrailingSlash  -> directory of the code file, no trailing slash (quoted)
 *   $fullFileName             -> full path of the code file (quoted)
 *   $fileName                 -> base name of the code file
 *   $fileNameWithoutExt       -> base name of the code file without extension
 *   $driveLetter              -> drive letter of the code file (Windows only)
 *   $pythonPath               -> resolved Python interpreter path
 */
export function replacePlaceholders(executor: string, input: CommandInput): string {
  if (!input.codeFile) {
    return executor;
  }

  const parts = splitFilePath(input.codeFile);
  const workspaceRoot = input.workspaceFolder ?? parts.dir;
  const pythonPath = input.pythonPath ?? "python";

  return executor
    .replace(/\$workspaceRoot/g, workspaceRoot)
    .replace(/\$fileNameWithoutExt/g, parts.baseNameWithoutExt)
    .replace(/\$fullFileName/g, quote(input.codeFile))
    .replace(/\$fileName/g, parts.baseName)
    .replace(/\$driveLetter/g, parts.driveLetter)
    .replace(/\$dirWithoutTrailingSlash/g, quote(parts.dirWithoutTrailingSlash))
    .replace(/\$dir/g, quote(parts.dir))
    .replace(/\$pythonPath/g, pythonPath);
}

/**
 * Builds the final command used to run a source file.
 *
 * If a placeholder such as $dir, $fileName etc. is present the file name is
 * inserted at that position; otherwise the file name is appended to the end
 * of the executor command (unless appendFile is false).
 */
export function buildCommand(
  executor: string,
  input: CommandInput,
  appendFile = true,
): string {
  const substituted = replacePlaceholders(executor, input);
  if (substituted !== executor || !input.codeFile) {
    return substituted;
  }
  return appendFile
    ? `${executor} ${quote(input.codeFile)}`
    : executor;
}
