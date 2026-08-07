import { AnalyzerPlugin } from "../types.js";

/**
 * Node Built-in Plugin for OptiPrune
 * Prevents flagging Node.js built-in modules (e.g., node:os, fs) as missing dependencies
 * if @types/node is present in package.json.
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

      if (hasTypesNode) {
        // We tell the adapter to treat these as "internally handled"
        // In the future, the PluginAdapter could have a 'registerExternalResolution' method
        adapter.attachMetadata(global, 'handled-builtins', Array.from(nodeBuiltins));
      }
    },
    onASTNode: (node: any, fileId, adapter) => {
      // Check for imports of Node.js built-ins
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        const specifier = node.source?.value;
        if (specifier && (specifier.startsWith('node:') || specifier === 'process')) {
          // Mark as handled to prevent "missing-dependency" errors
          adapter.markAsUsed(fileId, specifier);
        }
      }
    }
  }
};

export default NodeBuiltinPlugin;
