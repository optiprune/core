import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VUE_CONFIG_FILES = ["vue.config.js", "vue.config.ts", "nuxt.config.js", "nuxt.config.ts"];

/**
 * Vue.js Plugin
 * Handles Vue.js-specific patterns: .vue components, composition API, lifecycle hooks, etc.
 */
export const VueJsPlugin: AnalyzerPlugin = {
  name: "vuejs-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.dependencies?.["vue"] || pkg.devDependencies?.["vue"])) {
      return true;
    }
    for (const file of VUE_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    // Check for any .vue files in the project root or src
    const hasVueFile = await adapter.readFile("src/App.vue") || await adapter.readFile("App.vue");
    return !!hasVueFile;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasVueDep = pkg ? !!(pkg.dependencies?.["vue"] || pkg.devDependencies?.["vue"]) : false;
      
      let hasConfigFile = false;
      for (const file of VUE_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasVueDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Vue configuration found but 'vue' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      // Vue components are entry points by nature
      if (fileId.endsWith(".vue")) {
        adapter.markAsUsed(fileId);
      }
      const fileName = path.basename(fileId);
      if (VUE_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Mark the file as used if any Vue-specific API is detected
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const apiName = node.callee.name;
        const vueAPIs = [
          "onMounted", "onUpdated", "onUnmounted", "onBeforeMount", "onBeforeUpdate", "onBeforeUnmount",
          "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
          "ref", "reactive", "computed", "watch", "watchEffect", "provide", "inject",
          "defineComponent", "defineProps", "defineEmits", "defineExpose", "defineOptions", "defineSlots",
          "useRouter", "useRoute", "defineStore", "useStore"
        ];
        if (vueAPIs.includes(apiName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Handle <script setup> implicit exports
      if (t.isProgram(node) && fileId.endsWith(".vue")) {
        for (const statement of node.body) {
          if (t.isVariableDeclaration(statement)) {
            for (const declarator of statement.declarations) {
              if (t.isIdentifier(declarator.id)) {
                adapter.markAsUsed(fileId, declarator.id.name);
              }
            }
          } else if (t.isFunctionDeclaration(statement) && statement.id) {
            adapter.markAsUsed(fileId, statement.id.name);
          }
        }
      }

      // Handle options API
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === 'defineComponent' && node.arguments.length > 0 && t.isObjectExpression(node.arguments[0])) {
        const optionsObject = node.arguments[0];
        for (const prop of optionsObject.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            const propName = prop.key.name;
            if (['props', 'emits', 'data', 'methods', 'computed', 'watch', 'setup'].includes(propName)) {
              adapter.markAsUsed(fileId, propName);
            }
          }
        }
      }
    }
  }
};

export default VueJsPlugin;
