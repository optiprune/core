import path from "pathe";
import { parsePluginJson, parsePluginYaml } from "./json-utils.js";

export { parsePluginJson, parsePluginYaml };

export function staticPropertyName(node: any): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier" && !node.computed) return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

export function packageRoot(specifier: string): string {
  const value = specifier.replace(/\\/g, "/").replace(/^node:/, "");
  if (value.startsWith("@")) return value.split("/").slice(0, 2).join("/");
  return value.split("/")[0] ?? value;
}

export function normalizeRelativeFile(sourceFile: string, value: string): string {
  const normalizedSource = sourceFile.replace(/\\/g, "/");
  const normalizedValue = value.replace(/\\/g, "/");
  if (normalizedValue.startsWith("/")) return normalizedValue.slice(1);
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(normalizedSource), normalizedValue),
  );
}

/** Tokenize a shell-like command without treating words inside arguments as executables. */
export function tokenizeCommand(script: unknown): string[] {
  if (typeof script !== "string") return [];
  const cleaned = script.replace(/(^|\s)#.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, " ");
  return (
    cleaned
      .match(/&&|\|\||[;|]|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g)
      ?.map((token) => token.replace(/^(?:"|')|(?:"|')$/g, "")) ?? []
  );
}

/** Conservative command detection that rejects echo/text mentions and arbitrary substrings. */
export function hasCommand(script: unknown, commands: string[]): boolean {
  const tokens = tokenizeCommand(script);
  const names = new Set(commands);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const executable = token?.split(/[\\/]/).pop();
    if (!executable || !names.has(executable)) continue;
    let segmentStart = i;
    while (segmentStart > 0 && !["&&", "||", ";", "|"].includes(tokens[segmentStart - 1] ?? ""))
      segmentStart--;
    const command = tokens[segmentStart];
    const prior = tokens.slice(segmentStart, i);
    if (
      segmentStart === i ||
      command === "npx" ||
      command === "bunx" ||
      ((prior.includes("exec") || prior.includes("dlx") || prior.includes("x")) &&
        ["npm", "pnpm", "yarn", "bun"].includes(command ?? ""))
    )
      return true;
  }
  return false;
}

export function isPathLike(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.includes("\\");
}

export async function fileExists(adapter: any, fileName: string): Promise<boolean> {
  if (typeof adapter.fileExists === "function") return adapter.fileExists(fileName);
  return adapter.folderExists(fileName);
}
