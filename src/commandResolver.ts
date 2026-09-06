import micromatch from "micromatch";

import type { ScriptConfig } from "./config";

const SHEBANG_PATTERN = /^#!(?!\[)/;

export interface CommandExecutor {
  executor: string;
  languageId: string;
}

/**
 * Determines the executor command for a given language and file by checking,
 * in order: shebang, executorMapByGlob, executorMap, executorMapByFileExtension
 * and finally defaultLanguage.
 */
export function resolveExecutor(
  config: ScriptConfig,
  languageId: string,
  fileExtension: string,
  fileName: string,
  respectShebang: boolean,
): CommandExecutor | undefined {
  // 1. Shebang.
  if (respectShebang) {
    const shebang = config.shebang;
    if (shebang && SHEBANG_PATTERN.test(shebang)) {
      return { executor: shebang.slice(2), languageId };
    }
  }

  // 2. Glob match against the file name.
  if (config.executorMapByGlob && fileName) {
    for (const glob of Object.keys(config.executorMapByGlob)) {
      if (micromatch.isMatch(fileName, glob)) {
        return {
          executor: config.executorMapByGlob[glob],
          languageId,
        };
      }
    }
  }

  // 3. Language id.
  if (config.executorMap[languageId] != null) {
    return { executor: config.executorMap[languageId], languageId };
  }

  // 4. File extension.
  if (fileExtension && config.executorMapByFileExtension[fileExtension] != null) {
    return {
      executor: config.executorMapByFileExtension[fileExtension],
      languageId: fileExtension,
    };
  }

  // 5. Default language.
  if (config.defaultLanguage) {
    const executor = config.executorMap[config.defaultLanguage];
    if (executor != null) {
      return { executor, languageId: config.defaultLanguage };
    }
  }

  return undefined;
}
