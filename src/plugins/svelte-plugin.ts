import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SVELTE_CONFIG_FILES = ["svelte.config.js", "svelte.config.ts", "svelte.config.cjs", "svelte.config.mjs"];

/**
 * Svelte Plugin
 * Handles Svelte-specific patterns and lifecycle methods.
 */
export const SveltePlugin: AnalyzerPlugin = {
  name: "svelte-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg && (pkg.dependencies?.['svelte'] || pkg.devDependencies?.['svelte'])) {
      return true;
    }
    for (const file of SVELTE_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasSvelteDep = pkg ? !!(pkg.dependencies?.['svelte'] || pkg.devDependencies?.['svelte']) : false;
      
      let hasConfigFile = false;
      for (const file of SVELTE_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasSvelteDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Svelte configuration found but 'svelte' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      // Svelte components are entry points by nature
      if (fileId.endsWith('.svelte')) {
        adapter.markAsUsed(fileId);
      }
      const fileName = path.basename(fileId);
      if (SVELTE_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Svelte lifecycle methods
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (['onMount', 'onDestroy', 'beforeUpdate', 'afterUpdate', 'tick', 'createEventDispatcher', 'setContext', 'getContext'].includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Svelte stores ($ prefix)
      if (t.isIdentifier(node) && node.name.startsWith('$')) {
        const storeName = node.name.slice(1);
        adapter.markAsUsed(fileId, storeName);
      }

      // Handle svelte.config.js exports
      const fileName = path.basename(fileId);
      if (SVELTE_CONFIG_FILES.includes(fileName)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
        if (
          node.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left.object?.name === "module" &&
          node.left.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }
        
        // Detect preprocessors in svelte.config.js
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any).name || (node.key as any).value;
          if (keyName === "preprocess") {
            adapter.markAsUsed(fileId);
          }
        }
      }
    }
  }
};

export default SveltePlugin;
