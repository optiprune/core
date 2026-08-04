import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Svelte Plugin
 * Handles Svelte-specific patterns and lifecycle methods.
 */
export const SveltePlugin: AnalyzerPlugin = {
  name: "svelte-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (!pkg) return false;
    return !!(pkg.dependencies?.['svelte'] || pkg.devDependencies?.['svelte']);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Svelte components are entry points by nature
      if (fileId.endsWith('.svelte')) {
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
    }
  }
};

export default SveltePlugin;
