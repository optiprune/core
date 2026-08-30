import { readFileSync } from "node:fs";
import picomatch from "picomatch";
import {
  convertGitignoreToPicomatchIgnorePatterns,
  expandIgnorePatterns,
} from "./parse-and-convert-gitignores.js";

export interface CodeownersMatcher {
  (filePath: string): string[];
}

export function parseCodeowners(content: string): CodeownersMatcher {
  const matchers = content
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((rule) => {
      const [path, ...owners] = rule.trim().split(/\s+/);
      const { pattern } = convertGitignoreToPicomatchIgnorePatterns(path ?? "");
      return { owners, match: picomatch(expandIgnorePatterns([pattern], true)) };
    });
  return (filePath: string) => {
    for (const matcher of [...matchers].reverse())
      if (matcher.match(filePath)) return matcher.owners;
    return [];
  };
}

export function createOwnershipEngine(filePath: string): CodeownersMatcher {
  return parseCodeowners(readFileSync(filePath, "utf8"));
}
