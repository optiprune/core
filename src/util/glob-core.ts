import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseAndConvertGitignorePatterns } from "./parse-and-convert-gitignores.js";

export interface ParsedGitignores {
  gitignoreFiles: string[];
  ignores: Set<string>;
  unignores: Set<string>;
}

export async function findAndParseGitignores(cwd: string): Promise<ParsedGitignores> {
  const files: string[] = [];
  const ignores = new Set<string>();
  const unignores = new Set<string>();
  const ancestors: string[] = [];
  let current = cwd;
  while (true) {
    ancestors.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const directory of ancestors) {
    const file = join(directory, ".gitignore");
    if (!existsSync(file)) continue;
    files.push(relative(cwd, file) || ".gitignore");
    for (const { pattern, negated } of parseAndConvertGitignorePatterns(
      readFileSync(file, "utf8"),
    )) {
      (negated ? unignores : ignores).add(pattern);
    }
  }
  return { gitignoreFiles: files, ignores, unignores };
}
