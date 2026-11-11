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

/** Conservative command detection that avoids comments and arbitrary substrings. */
export function hasCommand(script: unknown, commands: string[]): boolean {
  if (typeof script !== "string") return false;
  const cleaned = script
    .replace(/(^|\s)#.*$/gm, "$1")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const names = commands.map((command) => command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?:^|[\\s;&|])(?:${names.join("|")})(?=$|[\\s;&|])`).test(cleaned);
}

export function isPathLike(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.includes("\\");
}

export async function fileExists(adapter: any, fileName: string): Promise<boolean> {
  if (typeof adapter.fileExists === "function") return adapter.fileExists(fileName);
  return adapter.folderExists(fileName);
}
