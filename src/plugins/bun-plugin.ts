import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const BUN_CONFIG_FILES = ["bunfig.toml", "bun.lockb", "bun.lock"];

const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

const BUN_BUILTINS = new Set([
  "bun",
  "bun:sqlite",
  "bun:ffi",
  "bun:jsc",
  "bun:wrap",
  "bun:test",
  "bun:main",
]);

async function markRelative(adapter: any, sourceFile: string, value: string): Promise<void> {
  if (value.startsWith(".") || value.startsWith("/")) {
    adapter.markRelativeFileAsUsed(sourceFile, value);
    const normalized = value.replace(/^\.\//, "");
    const target = path.isAbsolute(sourceFile)
      ? path.join(path.dirname(sourceFile), normalized)
      : normalized;
    const relativeTarget = path.isAbsolute(target)
      ? path.relative(adapter.getConfig().rootDir, target).replace(/\\/g, "/")
      : target;
    adapter.markAsUsed(relativeTarget);
    adapter.addEntryPatterns([relativeTarget]);
  }
}

function packageNameFromPreload(value: string): string {
  if (value.startsWith("@")) {
    const parts = value.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : value;
  }
  return value.split("/")[0] ?? value;
}

async function markBunCliPreloads(adapter: any, script: string): Promise<void> {
  for (const match of script.matchAll(/(?:^|\s)(?:-r|--preload|--require)\s+([^\s]+)/g)) {
    const value = match[1];
    if (!value) continue;
    const preload = value.replace(/^['"]|['"]$/g, "");
    if (preload.startsWith(".") || preload.startsWith("/")) {
      await markRelative(adapter, "package.json", preload);
    } else {
      adapter.markPackageAsUsed(packageNameFromPreload(preload));
    }
  }
}

async function markBunfigPreloads(adapter: any, source: string, configFile: string): Promise<void> {
  let section = "";
  let collecting = false;
  let values = "";
  for (const line of source.split(/\r?\n/)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      collecting = false;
      values = "";
      continue;
    }
    if (
      !collecting &&
      /^\s*preload\s*=\s*\[/.test(line) &&
      (section === "" || section === "test")
    ) {
      collecting = true;
      values = line.slice(line.indexOf("[") + 1);
    } else if (collecting) {
      values += `\n${line}`;
    }
    if (!collecting || !values.includes("]")) continue;
    for (const value of values.matchAll(/["']([^"']+)["']/g)) {
      if (value[1]) await markRelative(adapter, configFile, value[1]);
    }
    collecting = false;
    values = "";
  }
}

function isBunBuildCall(node: any): boolean {
  return (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object) &&
    node.callee.object.name === "Bun" &&
    t.isIdentifier(node.callee.property) &&
    node.callee.property.name === "build"
  );
}

function markBunBuildOptions(node: any, fileId: string, adapter: any): void {
  const options = node.arguments?.[0];
  if (!t.isObjectExpression(options)) return;
  for (const property of options.properties ?? []) {
    if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) continue;
    const key = property.key.name;
    if (!t.isArrayExpression(property.value)) continue;
    for (const element of property.value.elements ?? []) {
      if (!t.isStringLiteral(element)) continue;
      if (key === "entrypoints") markRelative(adapter, fileId, element.value);
      if (key === "external" && !element.value.startsWith(".")) {
        adapter.markPackageAsUsed(element.value);
      }
    }
  }
}

export const BunPlugin: AnalyzerPlugin = {
  name: "bun-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (
      pkg &&
      (pkg.dependencies?.["bun-types"] ||
        pkg.devDependencies?.["bun-types"] ||
        pkg.dependencies?.["bun"] ||
        pkg.devDependencies?.["bun"] ||
        pkg.packageManager?.startsWith("bun"))
    ) {
      return true;
    }

    for (const file of BUN_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
    }

    if (pkg?.scripts) {
      for (const script of Object.values(pkg.scripts) as string[]) {
        if (typeof script === "string" && (script.includes("bun") || script.includes("bunx"))) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const config = adapter.getConfig();
      const rootDir = config.rootDir;
      const bunfigSource = await adapter.readFile("bunfig.toml");
      if (bunfigSource) await markBunfigPreloads(adapter, bunfigSource, "bunfig.toml");

      // 1. Detect Bun Workspaces from bun.lock
      const lockContent = await adapter.readFile("bun.lock");
      if (lockContent) {
        try {
          const cleanJson = lockContent.replace(/,\s*([\]}])/g, "$1").replace(/\/\/.*/g, ""); // remove single line comments
          const lock = JSON.parse(cleanJson);

          if (lock.workspaces && typeof lock.workspaces === "object") {
            const packageMap = new Map();
            const topologicalOrder: string[] = [];

            for (const [relPath, wsMeta] of Object.entries(lock.workspaces)) {
              if (relPath === "") continue;

              const manifestPath = path.join(relPath, "package.json");
              const manifest = await adapter.readJson(manifestPath);
              if (manifest && manifest.name) {
                const pkgName = manifest.name;
                const location = path.join(rootDir, relPath);
                const allDeps = new Set([
                  ...Object.keys(manifest.dependencies || {}),
                  ...Object.keys(manifest.devDependencies || {}),
                  ...Object.keys(manifest.peerDependencies || {}),
                ]);

                packageMap.set(pkgName, {
                  name: pkgName,
                  location,
                  relativePath: relPath,
                  manifestPath: path.join(location, "package.json"),
                  dependencies: new Set(),
                  allDependencies: allDeps,
                });
                topologicalOrder.push(pkgName);
              }
            }

            if (packageMap.size > 0) {
              adapter.setMonorepo({
                rootPath: rootDir,
                packageMap,
                topologicalOrder,
              });
            }
          }
        } catch {
          // Ignore invalid lockfile parse errors gracefully
        }
      }

      const pkg = await adapter.readJson("package.json");
      if (!pkg) return;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      // 2. Protect types and runtime packages if present in package.json
      if (allDeps["bun-types"]) adapter.markPackageAsUsed("bun-types");
      if (allDeps["@types/bun"]) adapter.markPackageAsUsed("@types/bun");
      if (allDeps["bun"]) adapter.markPackageAsUsed("bun");

      // 3. Parse package.json scripts for file entry points
      if (pkg.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script !== "string") continue;

          if (script.includes("bun") || script.includes("bunx")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
            await markBunCliPreloads(adapter, script);
          }

          const tokens = script.split(/\s+/);
          for (const token of tokens) {
            const clean = token.replace(/^["']|["']$/g, "");

            // Ignore CLI flags (--foo), env vars (FOO=bar), or scoped packages (@scope/pkg)
            if (clean.startsWith("-") || clean.includes("=") || clean.startsWith("@")) {
              continue;
            }

            if (
              clean.endsWith(".ts") ||
              clean.endsWith(".js") ||
              clean.endsWith(".jsx") ||
              clean.endsWith(".tsx") ||
              clean.endsWith(".html")
            ) {
              adapter.markAsUsed(clean);
            }
          }
        }
      }
    },

    onFileStart: async (fileId, adapter) => {
      const basename = path.basename(fileId);

      // Mark Bun config files and lockfiles
      if (BUN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        if (basename === "bunfig.toml") {
          const source = await adapter.readFile("bunfig.toml");
          if (source) await markBunfigPreloads(adapter, source, fileId);
        }
      }

      // Bun default entrypoints
      if (["index.ts", "main.ts", "server.ts", "index.js", "index.html"].includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Bun native test runner file patterns
      const normalized = fileId.replace(/\\/g, "/");
      if (
        normalized.includes("/__tests__/") ||
        /\.(test|spec)\.[jt]sx?$/.test(normalized) ||
        /_test\.[jt]sx?$/.test(normalized)
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      if (isBunBuildCall(node)) markBunBuildOptions(node, fileId, adapter);
      // 1. Detect Global `Bun` identifier usage (Bun.serve, Bun.env, Bun.file, Bun.password, etc.)
      if (t.isIdentifier(node) && node.name === "Bun") {
        adapter.markAsUsed(fileId);
      }

      // 2. Detect Bun Shell syntax: $`ls -la`
      if (t.isTaggedTemplateExpression(node) && t.isIdentifier(node.tag) && node.tag.name === "$") {
        adapter.markAsUsed(fileId);
      }

      // 3. Detect imports/exports from "bun", "bun:*", "node:*", or Node built-ins
      if (
        t.isImportDeclaration(node) ||
        t.isExportNamedDeclaration(node) ||
        (node as any).type === "ExportAllDeclaration"
      ) {
        const specifier = (node as any).source?.value;
        if (specifier) {
          if (
            BUN_BUILTINS.has(specifier) ||
            specifier.startsWith("bun:") ||
            specifier.startsWith("node:")
          ) {
            adapter.markAsUsed(fileId, specifier);
          } else {
            const bare = specifier.replace(/^node:/, "");
            if (NODE_BUILTINS.has(bare)) {
              adapter.markAsUsed(fileId, specifier);
            }
          }
        }
      }

      // 4. Mark relative dynamic imports: import('./module.js')
      if (t.isCallExpression(node) && (node.callee as any)?.type === "Import") {
        const arg = node.arguments?.[0];
        if (t.isStringLiteral(arg)) {
          const val = arg.value;
          if (val.startsWith(".") || val.startsWith("/")) {
            adapter.markAsUsed(fileId, val);
          }
        }
      }
    },
  },
};

export default BunPlugin;
