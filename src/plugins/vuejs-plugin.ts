import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Vue.js Plugin
 * Handles Vue.js-specific patterns: .vue components, composition API, lifecycle hooks, etc.
 */
export const VueJsPlugin: AnalyzerPlugin = {
  name: "vuejs-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['vue'] || pkg.devDependencies?.['vue']);
      if (hasDep) return true;
    }
    // Fallback: If we see .vue files, enable it
    const vueConfig = await adapter.readFile('vite.config.ts');
    return !!vueConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Vue components are entry points by nature
      if (fileId.endsWith('.vue')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Vue Composition API lifecycle hooks
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const hookName = node.callee.name;
        if (['onMounted', 'onUpdated', 'onUnmounted', 'onBeforeMount', 'onBeforeUpdate', 'onBeforeUnmount', 'onActivated', 'onDeactivated', 'onErrorCaptured', 'onRenderTracked', 'onRenderTriggered'].includes(hookName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Vue reactive/ref declarations
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const apiName = node.callee.name;
        if (['ref', 'reactive', 'computed', 'watch', 'watchEffect', 'provide', 'inject'].includes(apiName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Vue defineComponent
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'defineComponent') {
          adapter.markAsUsed(fileId);
        }
      }

      // Vue defineProps, defineEmits, defineExpose
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const defineName = node.callee.name;
        if (['defineProps', 'defineEmits', 'defineExpose', 'defineOptions', 'defineSlots'].includes(defineName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Vue template refs ($refs)
      if (t.isIdentifier(node) && node.name === '$refs') {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default VueJsPlugin;
