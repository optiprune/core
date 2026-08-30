import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { toPosix } from "./path.js";

export const extensionAlias: Record<string, string[]> = {
  ".js": [".js", ".ts", ".tsx", ".d.ts"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts", ".d.mts"],
  ".cjs": [".cjs", ".cts", ".d.cts"],
};

const declarationAliases: Record<string, string[]> = {
  ".ts": [".d.ts", ".ts"],
  ".mts": [".d.mts", ".mts"],
  ".cts": [".d.cts", ".cts"],
  ".js": [".d.ts", ".js"],
  ".mjs": [".d.mts", ".mjs"],
  ".cjs": [".d.cts", ".cjs"],
};

function candidates(specifier: string, extensions: string[]): string[] {
  const extension = extname(specifier);
  if (extension && extensions.includes(extension))
    return [specifier, ...extensions.map((item) => specifier.slice(0, -extension.length) + item)];
  return [specifier, ...extensions.map((item) => specifier + item)];
}

function resolveFile(
  specifier: string,
  basePath: string,
  extensions: string[],
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const absolute = resolvePath(dirname(basePath), specifier);
  for (const candidate of candidates(absolute, extensions)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return toPosix(candidate);
  }
  for (const candidate of candidates(absolute, extensions)) {
    const index = resolvePath(candidate, "index");
    if (existsSync(index) && statSync(index).isFile()) return toPosix(index);
  }
  return undefined;
}

export const _resolveDeclarationSync = (specifier: string, containingFile: string) => {
  const sourceExtension = extname(specifier);
  const extensions = declarationAliases[sourceExtension] ?? [".d.ts", ".ts", ".js"];
  const path = resolveFile(specifier, containingFile, extensions);
  return path ? { path } : undefined;
};

export const _resolveModuleSync = (specifier: string, containingFile: string) =>
  resolveFile(specifier, containingFile, [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".json"]);

export const _resolveSync = _resolveModuleSync;
export const _createSyncModuleResolver =
  (extensions: string[]) => (specifier: string, basePath: string) =>
    resolveFile(specifier, basePath, extensions);
export const resolvePackageManifestPath = (packageName: string, baseDir: string) =>
  resolveFile(`${packageName}/package.json`, resolvePath(baseDir, "index.js"), [".json"]);
export const clearResolverCache = () => undefined;
