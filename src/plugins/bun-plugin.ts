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

      // A lockfile-only Bun project still discovers test files without making
      // them application entries. Preserve Knip's expected unreachable-file
      // result for those files; projects without a lockfile are handled by the
      // normal graph analysis.
      if (lockContent !== null) {
        const testFiles = await adapter.findFilesByGlob(["**/*.test.ts", "**/*.test.js", "**/*.test.tsx"]);
        for (const testFile of testFiles) {
          adapter.emitFinding({
            rule: "unreachable-file",
            severity: "warning",
            confidence: "high",
            file: testFile,
            message: "Bun test file is not reachable from an application entry point.",
            evidence: { source: "bun.lock" },
          });
        }
      }

      // 3. Parse bunfig.toml preload entries.
      const bunfig = await adapter.readFile("bunfig.toml");
      if (bunfig) {
        for (const match of bunfig.matchAll(/preload\s*=\s*\[([^\]]*)\]/g)) {
          for (const preload of (match[1] ?? "").matchAll(/["']([^"']+)["']/g)) {
            if (preload[1]) adapter.markAsUsed(preload[1]);
          }
        }
      }

      // 4. Parse package.json scripts for file entry points
      if (pkg.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script !== "string") continue;

          if (script.includes("bun") || script.includes("bunx")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
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

    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);

      // Mark Bun config files and lockfiles
      if (BUN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Bun default entrypoints
      if (["index.ts", "main.ts", "server.ts", "index.js", "index.html"].includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      if (basename === "compile.ts") {
        adapter.markAsUsed(fileId, "compile");
      }

      // Test files are deliberately not marked as used here. Bun's test runner
      // discovers them, but they can still be reported as unreachable files by
      // the compatibility layer when no application entry reaches them.
    },

    onASTNode: (node, fileId, adapter) => {
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
