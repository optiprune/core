import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const BUN_CONFIG_FILES = ["bunfig.toml", "bun.lockb"];

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 
  'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 
  'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
]);

/**
 * Enhanced BunPlugin for OptiPrune
 * 
 * 1. Resolves and marks Bun scripts (e.g. `bun test/...`, `bun run ...`) as used.
 * 2. Whitelists Node.js built-ins and local relative/absolute paths so they are never flagged as missing external packages.
 * 3. Handles Bun globals and imports correctly.
 */
export const BunPlugin: AnalyzerPlugin = {
  name: "bun-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.dependencies?.["bun-types"] || pkg.devDependencies?.["bun-types"])) {
      return true;
    }
    for (const file of BUN_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    // Also detect if scripts use "bun"
    if (pkg?.scripts) {
      for (const script of Object.values(pkg.scripts) as string[]) {
        if (script.includes("bun ")) return true;
      }
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (!pkg) return;

      // Extract binaries and files referenced in scripts (e.g., "bun test/integration/release.ts")
      if (pkg.scripts) {
        for (const script of Object.values(pkg.scripts) as string[]) {
          // Match paths or arguments in scripts, e.g. test/integration/release.ts, build, test, etc.
          const tokens = script.split(/\s+/);
          for (const token of tokens) {
            // Clean quotes or flags
            const clean = token.replace(/^["']|["ですので']$/g, '');
            if (clean.includes('/') || clean.endsWith('.ts') || clean.endsWith('.js')) {
              adapter.markAsUsed(clean);
            }
          }
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (BUN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      if (basename === "index.ts" || basename === "main.ts" || basename === "server.ts") {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // 1. Detect Bun global usage
      if (t.isIdentifier(node) && node.name === "Bun") {
        adapter.markAsUsed(fileId);
      }

      // 2. Detect Bun.serve, Bun.file, etc.
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        if (t.isIdentifier(obj) && obj.name === "Bun") {
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect imports from "bun" or node built-ins
      if (t.isImportDeclaration(node) || t.isExportNamedDeclaration(node) || (node as any).type === 'ExportAllDeclaration') {
        const specifier = (node as any).source?.value;
        if (specifier) {
          if (specifier === "bun" || specifier.startsWith("node:")) {
            adapter.markAsUsed(fileId, specifier);
          } else {
            const root = specifier.split("/")[0];
            if (NODE_BUILTINS.has(root)) {
              adapter.markAsUsed(fileId, specifier);
            }
          }
        }
      }

      // 4. Prevent flagging local paths (like perf/bench, test/integration/release) as missing external packages
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
