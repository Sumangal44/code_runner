import { posix, win32 } from "node:path";

export interface CommandInput {
  /** Full path to the code file being run, if any. */
  codeFile?: string;
  /** Path of the root workspace folder, if any. */
  workspaceFolder?: string;
  /** Python interpreter command, if resolved. */
  pythonPath?: string;
  /** Command-line arguments passed to the execution. */
  args?: string;
  /** Configured working directory. */
  cwd?: string;
  /** Environment variables map for placeholder substitution. */
  env?: Record<string, string | undefined>;
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
export function splitFilePath(
  codeFile: string,
  workspaceFolder?: string,
): {
  dir: string;
  dirWithoutTrailingSlash: string;
  baseName: string;
  baseNameWithoutExt: string;
  fileExt: string;
  relativeFile: string;
  relativeDir: string;
  driveLetter: string;
} {
  const pathModule = pathModuleFor(codeFile);
  const dir = pathModule.dirname(codeFile);
  const baseName = pathModule.basename(codeFile);
  const ext = pathModule.extname(codeFile);
  const baseNameWithoutExt = pathModule.basename(codeFile, ext);
  const fileExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const driveLetter = /^([A-Za-z]:).*/.exec(codeFile)?.[1] ?? "$driveLetter";

  let relativeFile = baseName;
  let relativeDir = ".";
  if (workspaceFolder) {
    try {
      const rel = pathModule.relative(workspaceFolder, codeFile);
      if (rel && !rel.startsWith("..")) {
        relativeFile = rel.split(pathModule.sep).join("/");
        const relD = pathModule.dirname(rel);
        relativeDir = relD === "." ? "." : relD.split(pathModule.sep).join("/");
      }
    } catch {
      // Fallback to baseName
    }
  }

  return {
    dir,
    dirWithoutTrailingSlash: dir.replace(/[\\/]+$/, ""),
    baseName,
    baseNameWithoutExt,
    fileExt,
    relativeFile,
    relativeDir,
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
 *   $fileNameWithExt          -> base name of the code file
 *   $fileNameWithoutExt       -> base name of the code file without extension
 *   $fileExt                  -> file extension without leading dot
 *   $relativeFile             -> relative path from workspace root
 *   $relativeDir              -> relative directory from workspace root
 *   $driveLetter              -> drive letter of the code file (Windows only)
 *   $pythonPath               -> resolved Python interpreter path
 *   $args / $arguments        -> command line arguments
 *   $cwd                      -> working directory (quoted)
 *   $env:VAR / ${env:VAR}     -> environment variable
 */
export function replacePlaceholders(executor: string, input: CommandInput): string {
  const pythonPath = input.pythonPath ?? "python";
  const args = input.args?.trim() ?? "";

  // Replace environment variables: $env:VAR or ${env:VAR}
  let result = executor.replace(
    /\$(?:\{env:([A-Za-z_][A-Za-z0-9_]*)\}|env:([A-Za-z_][A-Za-z0-9_]*))/g,
    (_match, p1: string | undefined, p2: string | undefined) => {
      const varName = p1 || p2 || "";
      return input.env?.[varName] ?? process.env[varName] ?? "";
    },
  );

  result = result
    .replace(/\$pythonPath/g, pythonPath)
    .replace(/\$(?:args|arguments)\b/g, args);

  if (input.cwd) {
    result = result.replace(/\$cwd/g, quote(input.cwd));
  }

  if (!input.codeFile) {
    if (input.workspaceFolder) {
      result = result.replace(/\$workspaceRoot/g, input.workspaceFolder);
    }
    return result;
  }

  const parts = splitFilePath(input.codeFile, input.workspaceFolder);
  const workspaceRoot = input.workspaceFolder ?? parts.dir;
  const cwd = input.cwd ?? parts.dir;

  return result
    .replace(/\$workspaceRoot/g, workspaceRoot)
    .replace(/\$fileNameWithoutExt/g, parts.baseNameWithoutExt)
    .replace(/\$fileNameWithExt/g, parts.baseName)
    .replace(/\$fullFileName/g, quote(input.codeFile))
    .replace(/\$fileName/g, parts.baseName)
    .replace(/\$fileExt/g, parts.fileExt)
    .replace(/\$relativeFile/g, parts.relativeFile)
    .replace(/\$relativeDir/g, parts.relativeDir)
    .replace(/\$driveLetter/g, parts.driveLetter)
    .replace(/\$dirWithoutTrailingSlash/g, quote(parts.dirWithoutTrailingSlash))
    .replace(/\$dir/g, quote(parts.dir))
    .replace(/\$cwd/g, quote(cwd));
}

/**
 * Builds the final command used to run a source file.
 *
 * If a placeholder such as $dir, $fileName etc. is present the file name is
 * inserted at that position; otherwise the file name is appended to the end
 * of the executor command (unless appendFile is false).
 * If command arguments are provided and not already substituted via $args,
 * they are appended to the command.
 */
export function buildCommand(
  executor: string,
  input: CommandInput,
  appendFile = true,
): string {
  const hasArgsPlaceholder = /\$(?:args|arguments)\b/.test(executor);
  const substituted = replacePlaceholders(executor, input);
  let finalCmd = substituted;

  if (substituted === executor && input.codeFile && appendFile) {
    finalCmd = `${executor} ${quote(input.codeFile)}`;
  }

  if (input.args && input.args.trim().length > 0 && !hasArgsPlaceholder) {
    finalCmd = `${finalCmd} ${input.args.trim()}`;
  }

  return finalCmd;
}
