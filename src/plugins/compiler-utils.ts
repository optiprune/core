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
  // A stylesheet extension alone is not evidence that every stylesheet is a
  // runtime entry, nor that the compiler package is actually used. Imports,
  // explicit build configuration, and CLI scripts are handled by the normal
  // graph/dependency analysis. Deliberately avoid blanket reachability here.
  void adapter;
  void patterns;
  void packageNames;
}
