import { AnalyzerPlugin } from "../types.js";

/**
 * Node Built-in Plugin for OptiPrune
 * 
 * 1. Prevents flagging Node.js built-in modules (e.g., node:os, fs) as missing dependencies 
 *    if @types/node is present.
 * 2. Flags a missing devDependency if Node built-ins are used but @types/node is missing.
 */
export const NodeBuiltinPlugin: AnalyzerPlugin = {
  name: "node-builtin-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    // This plugin is always relevant for Node.js environments
    return true;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      if (!pkg) return;
      
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      
      const hasTypesNode = !!allDeps['@types/node'];
      
      // Node.js built-in modules list
      const nodeBuiltins = new Set([
        'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 
        'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 
        'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 
        'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 
        'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 
        'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
      ]);

      // Store state for use in other hooks
      (adapter as any).__nodePluginState = {
        hasTypesNode,
        nodeBuiltins,
        usedBuiltins: new Set<string>()
      };
    },
    onASTNode: (node: any, fileId, adapter) => {
      const state = (adapter as any).__nodePluginState;
      if (!state) return;

      // Check for imports/exports of Node.js built-ins
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        const specifier = node.source?.value;
        if (!specifier) return;

        const isNodeProtocol = specifier.startsWith('node:');
        const cleanSpecifier = isNodeProtocol ? specifier.slice(5) : specifier;
        const rootModule = cleanSpecifier.split('/')[0];

        if (isNodeProtocol || state.nodeBuiltins.has(rootModule)) {
          // 1. Mark as used to prevent core "missing-dependency" errors when types are present
          adapter.markAsUsed(fileId, specifier);
          
          // 2. Track for the missing types check
          state.usedBuiltins.add(specifier);
        }
      }
    },
    onAnalysisComplete: async (adapter) => {
      const state = (adapter as any).__nodePluginState;
      if (!state || state.hasTypesNode) return;

      if (state.usedBuiltins.size > 0) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "warning",
          confidence: "high",
          file: "package.json",
          message: `Node.js built-in module(s) [${Array.from(state.usedBuiltins).join(', ')}] are used, but '@types/node' is missing from package.json.`,
          evidence: { 
            usedBuiltins: Array.from(state.usedBuiltins),
            missingPackage: '@types/node'
          }
        });
      }
    }
  }
};

export default NodeBuiltinPlugin;
