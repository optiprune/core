import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const BUN_CONFIG_FILES = ["bunfig.toml", "bun.lockb", "bun.lock"];

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 
  'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 
  'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
]);

// Bun built-in modules (e.g. bun:sqlite, bun:ffi)
const BUN_BUILTINS = new Set([
  'bun', 'bun:sqlite', 'bun:ffi', 'bun:jsc', 'bun:wrap', 'bun:test'
]);

export const BunPlugin: AnalyzerPlugin = {
  name: "bun-plugin",
  version: "1.2.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.dependencies?.["bun-types"] || pkg.devDependencies?.["bun-types"] || pkg.dependencies?.["bun"] || pkg.devDependencies?.["bun"])) {
      return true;
    }
    for (const file of BUN_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
    }
    if (pkg?.scripts) {
      for (const script of Object.values(pkg.scripts) as string[]) {
        if (typeof script === "string" && script.includes("bun")) return true;
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
          // Robust clean-up for Bun's text lockfile trailing commas before parsing
          const cleanJson = lockContent
            .replace(/,\s*([\]}])/g, '$1')
            .replace(/\/\/.*/g, ''); // remove single line comments
          const lock = JSON.parse(cleanJson);
          
          if (lock.workspaces && typeof lock.workspaces === 'object') {
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

      // 2. Parse package.json scripts for script file targets
      if (pkg.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script !== "string") continue;
          
          if (script.includes("bun")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
          }

          const tokens = script.split(/\s+/);
          for (const token of tokens) {
            // Clean quotes (Fixed regex typo)
            const clean = token.replace(/^["']|["']$/g, '');
            if (clean.includes('/') || clean.endsWith('.ts') || clean.endsWith('.js') || clean.endsWith('.jsx') || clean.endsWith('.tsx') || clean.endsWith('.html')) {
              adapter.markAsUsed(clean);
            }
          }
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      
      // Mark Bun config files
      if (BUN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      
      // Bun default entrypoints
      if (['index.ts', 'main.ts', 'server.ts', 'index.js', 'index.html'].includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Bun native test runner file patterns (*.test.ts, *.spec.ts, *_test.ts, __tests__/*)
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
      // 1. Detect Bun global usage: Bun.serve, Bun.file, Bun.password, etc.
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        if (t.isIdentifier(obj) && obj.name === "Bun") {
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect imports from "bun", "bun:*", or Node built-ins
      if (
        t.isImportDeclaration(node) || 
        t.isExportNamedDeclaration(node) || 
        (node as any).type === 'ExportAllDeclaration'
      ) {
        const specifier = (node as any).source?.value;
        if (specifier) {
          if (BUN_BUILTINS.has(specifier) || specifier.startsWith("bun:") || specifier.startsWith("node:")) {
            adapter.markAsUsed(fileId, specifier);
          } else {
            const root = specifier.split("/")[0];
            if (NODE_BUILTINS.has(root)) {
              adapter.markAsUsed(fileId, specifier);
            }
          }
        }
      }

      // 3. Mark relative dynamic imports
      if (node.type === "CallExpression" && node.callee?.type === "Import") {
        const arg = node.arguments?.[0];
        if (arg?.type === "StringLiteral" || arg?.type === "Literal") {
          const val = arg.value;
          if (typeof val === "string" && (val.startsWith(".") || val.startsWith("/"))) {
            adapter.markAsUsed(fileId, val);
          }
        }
      }
    }
  }
};

export default BunPlugin;