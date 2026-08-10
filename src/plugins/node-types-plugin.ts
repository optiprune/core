import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
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
  "test",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib"
]);

interface NodePluginState {
  hasTypesNode: boolean;
  usedBuiltins: Set<string>;
}

export const NodeBuiltinPlugin: AnalyzerPlugin = {
  name: "node-builtin-plugin",
  version: "1.1.0",

  detect: async () => true,

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasTypesNode = "@types/node" in allDeps;

      if (hasTypesNode) {
        adapter.markPackageAsUsed("@types/node");
      }

      (adapter as any).__nodePluginState = {
        hasTypesNode,
        usedBuiltins: new Set<string>()
      } as NodePluginState;
    },
    onASTNode: (node: any, fileId, adapter) => {
      const state = (adapter as any).__nodePluginState as NodePluginState | undefined;
      if (!state) return;

      let specifier: string | undefined;

      // 1. Static ESM imports / exports (import fs from 'fs', export * from 'node:path')
      if (
        t.isImportDeclaration(node) ||
        t.isExportNamedDeclaration(node) ||
        node.type === "ExportAllDeclaration"
      ) {
        specifier = node.source?.value;
      }

      // 2. CommonJS require('fs') and dynamic import('node:fs')
      if (t.isCallExpression(node)) {
        const isRequire =
          t.isIdentifier(node.callee) && node.callee.name === "require";
        const isImport = node.callee.type === "Import";

        if (isRequire || isImport) {
          const firstArg = node.arguments[0];
          if (t.isStringLiteral(firstArg)) {
            specifier = firstArg.value;
          }
        }
      }

      // Early exit if no valid specifier was found
      if (!specifier) return;

      // Clean prefix and extract base module name (e.g. "node:fs/promises" -> "fs")
      const isNodeProtocol = specifier.startsWith("node:");
      const cleanSpecifier = isNodeProtocol ? specifier.slice(5) : specifier;
      const rootModule = cleanSpecifier.split("/")[0] ?? "";

      if (isNodeProtocol || NODE_BUILTINS.has(rootModule)) {
        adapter.markAsUsed(fileId);
        state.usedBuiltins.add(specifier);

        if (state.hasTypesNode) {
          adapter.markPackageAsUsed("@types/node");
        }
      }
    },  

    onAnalysisComplete: async (adapter) => {
      const state = (adapter as any).__nodePluginState as NodePluginState | undefined;
      if (!state || state.hasTypesNode) return;

      if (state.usedBuiltins.size > 0) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "warning",
          confidence: "high",
          file: "package.json",
          message: `Node.js built-in module(s) [${Array.from(state.usedBuiltins).join(", ")}] are used, but '@types/node' is missing from package.json.`,
          evidence: {
            usedBuiltins: Array.from(state.usedBuiltins),
            missingPackage: "@types/node"
          }
        });
      }
    }
  }
};

export default NodeBuiltinPlugin;