import path from "pathe";
import type { PluginAdapter } from "../types.js";

export function normalizedExtension(file: string): string {
  return path.extname(file.replace(/\\/g, "/").toLowerCase());
}

export async function markCompilerFiles(
  adapter: PluginAdapter,
  patterns: string[],
  packageNames: string[],
): Promise<void> {
  const files = await adapter.findFilesByGlob(patterns);
  for (const file of files) {
    adapter.markAsUsed(file);
    for (const packageName of packageNames) adapter.markPackageAsUsed(packageName);
  }
}
