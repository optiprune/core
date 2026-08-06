import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Vue.js Plugin
 * Handles Vue.js-specific patterns: .vue components, composition API, lifecycle hooks, etc.
 */
export const VueJsPlugin: AnalyzerPlugin = {
  name: "vuejs-plugin",
  version: "1.0.1", // Incrementing version for the update
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["vue"] || pkg.devDependencies?.["vue"]);
      if (hasDep) return true;
    }
    // Fallback: If we see .vue files, enable it
    // This might need a more robust check, e.g., globbing for .vue files
    const vueConfig = await adapter.readFile("vite.config.ts"); // Revert to original check or similar
    return !!vueConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Vue components are entry points by nature if they are not imported elsewhere
      // For now, we mark all .vue files as potentially used, further analysis will refine
      if (fileId.endsWith(".vue")) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Mark the file as used if any Vue-specific API is detected
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const apiName = node.callee.name;
        const vueAPIs = [
          // Composition API lifecycle hooks
          "onMounted", "onUpdated", "onUnmounted", "onBeforeMount", "onBeforeUpdate", "onBeforeUnmount",
          "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
          // Reactivity APIs
          "ref", "reactive", "computed", "watch", "watchEffect", "provide", "inject",
          // Component definition helpers
          "defineComponent", "defineProps", "defineEmits", "defineExpose", "defineOptions", "defineSlots",
          // Vue Router (common usage)
          "useRouter", "useRoute",
          // Pinia (common usage)
          "defineStore", "useStore",
          // More Vue 3 Composition API and utilities
          "h", "resolveComponent", "resolveDirective", "withDirectives", "withModifiers",
          "nextTick", "markRaw", "toRaw", "toRef", "toRefs", "unref", "isRef", "customRef",
          "isProxy", "isReactive", "isReadonly", "isShallow", "shallowRef", "shallowReactive", "shallowReadonly",
          "triggerRef", "effect", "effectScope", "getCurrentScope", "onScopeDispose",
          "watchPostEffect", "watchSyncEffect",
          // Teleport, Suspense, Transition, KeepAlive (components, but often used as functions in render context)
          "Teleport", "Suspense", "Transition", "KeepAlive"
        ];
        if (vueAPIs.includes(apiName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Handle <script setup> implicit exports
      // In a compiled Vue SFC, top-level declarations in <script setup> are implicitly exposed.
      // We need to identify these declarations and mark them as used.
      if (t.isProgram(node)) {
        for (const statement of node.body) {
          if (t.isVariableDeclaration(statement)) {
            for (const declarator of statement.declarations) {
              if (t.isIdentifier(declarator.id)) {
                adapter.markAsUsed(fileId, declarator.id.name);
              }
            }
          } else if (t.isFunctionDeclaration(statement) && statement.id) {
            adapter.markAsUsed(fileId, statement.id.name);
          } else if (t.isClassDeclaration(statement) && statement.id) {
            adapter.markAsUsed(fileId, statement.id.name);
          }
        }
      }

      // Handle options API properties within defineComponent
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === 'defineComponent' && node.arguments.length > 0 && t.isObjectExpression(node.arguments[0])) {
        const optionsObject = node.arguments[0];
        for (const prop of optionsObject.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            const propName = prop.key.name;
            // Mark common options API properties as used
            if (['props', 'emits', 'data', 'methods', 'computed', 'watch', 'setup'].includes(propName)) {
              adapter.markAsUsed(fileId, propName);
            }
          }
        }
      }

      // Vue template refs ($refs)
      if (t.isMemberExpression(node) && t.isIdentifier(node.property) && node.property.name === '$refs') {
        adapter.markAsUsed(fileId);
      }

      // Components used in JSX/TSX (e.g., <MyComponent />)
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
        const componentName = node.openingElement.name.name;
        if (componentName[0] === componentName[0].toUpperCase()) {
          adapter.markAsUsed(fileId, componentName);
        }
      }
    }
  }
};

export default VueJsPlugin;
