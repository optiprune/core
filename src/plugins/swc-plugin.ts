import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * SWC Plugin
 * Handles SWC-specific patterns: .swcrc, swc config files, and @swc/core usages.
 */
export const SwcPlugin: AnalyzerPlugin = {
  name: "swc-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["@swc/core"] || pkg.devDependencies?.["@swc/core"]);
      if (hasDep) return true;
    }
    const configFiles = [".swcrc", "swc.config.js", "swc.config.json"];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const swcFiles = [".swcrc", "swc.config.js", "swc.config.json"];
      if (swcFiles.some(f => fileId.endsWith(f))) {
        adapter.markAsUsed(fileId);
        // SWC configuration implies @swc/core is needed
        adapter.markAsUsed("@swc/core");
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect SWC API usage: transform, transformSync, parse, parseSync
      if (t.isCallExpression(node)) {
        if (t.isMemberExpression(node.callee)) {
          const obj = (node.callee as any).object;
          const prop = (node.callee as any).property;
          if (t.isIdentifier(obj) && t.isIdentifier(prop)) {
            if (["transform", "transformSync", "parse", "parseSync", "bundle"].includes(prop.name)) {
              adapter.markAsUsed(fileId);
              adapter.markAsUsed("@swc/core");
            }
          }
        }
        if (t.isIdentifier(node.callee)) {
          if (["transform", "transformSync", "parse", "parseSync"].includes(node.callee.name)) {
            adapter.markAsUsed(fileId);
            adapter.markAsUsed("@swc/core");
          }
        }
      }

      // Detect imports from @swc/core
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "@swc/core") {
          adapter.markAsUsed(fileId);
          adapter.markAsUsed("@swc/core");
        }
      }
    }
  }
};
