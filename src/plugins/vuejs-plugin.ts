import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VUE_CONFIG_FILES = [
  "vue.config.js",
  "vue.config.ts",
  "vue.config.cjs",
  "vue.config.mjs",
  "nuxt.config.js",
  "nuxt.config.ts"
];

const VUE_PACKAGES = [
  "vue",
  "vue-router",
  "pinia",
  "vuex",
  "@vue/compiler-sfc",
  "@vue/runtime-core",
  "@vue/server-renderer",
  "@vueuse/core",
  "vue-demi"
];

const VUE_COMPOSITION_APIS = new Set([
  // Lifecycle hooks
  "onMounted",
  "onUpdated",
  "onUnmounted",
  "onBeforeMount",
  "onBeforeUpdate",
  "onBeforeUnmount",
  "onActivated",
  "onDeactivated",
  "onErrorCaptured",
  "onRenderTracked",
  "onRenderTriggered",
  // Reactivity core & utilities
  "ref",
  "reactive",
  "computed",
  "watch",
  "watchEffect",
  "watchPostEffect",
  "watchSyncEffect",
  "provide",
  "inject",
  "toRef",
  "toRefs",
  "unref",
  "shallowRef",
  "shallowReactive",
  "readonly",
  // Compiler macros
  "defineComponent",
  "defineProps",
  "defineEmits",
  "defineExpose",
  "defineOptions",
  "defineSlots",
  "defineModel",
  "withDefaults",
  // Vue Router / Pinia
  "useRouter",
  "useRoute",
  "defineStore",
  "useStore"
]);

export const VueJsPlugin: AnalyzerPlugin = {
  name: "vuejs-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (VUE_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of VUE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("src/App.vue")) ||
      (await adapter.folderExists("App.vue"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasVueDep = VUE_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of VUE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // Safeguard installed Vue ecosystem packages in package.json
      if (hasVueDep) {
        for (const vuePkg of VUE_PACKAGES) {
          if (allDeps[vuePkg]) {
            adapter.markPackageAsUsed(vuePkg);
          }
        }
      }

      // Track npm scripts invoking Vue CLI or Nuxt
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("vue-cli-service") ||
              scriptContent.includes("nuxt "))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
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
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Vue SFC files (.vue) are active entry points
      if (normalized.endsWith(".vue")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vue");
      }

      // 2. Vue / Nuxt config files
      if (VUE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vue");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Detect ESM imports from Vue packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          VUE_PACKAGES.includes(source) ||
          source.startsWith("@vue/") ||
          source.startsWith("vue-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect Vue Composition API & Compiler Macro invocations
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const apiName = node.callee.name;
        if (VUE_COMPOSITION_APIS.has(apiName)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("vue");
        }
      }

      // 3. Handle <script setup> implicit top-level exports in .vue files
      if (t.isProgram(node) && normalized.endsWith(".vue")) {
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

      // 4. Handle Options API / defineComponent({ props, emits, methods, computed, setup })
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "defineComponent" &&
        node.arguments.length > 0
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && t.isObjectExpression(firstArg)) {
          for (const prop of firstArg.properties) {
            let propKeyName: string | null = null;

            if ((prop as any).key && t.isIdentifier((prop as any).key)) {
              propKeyName = (prop as any).key.name;
            }

            if (
              propKeyName &&
              [
                "props",
                "emits",
                "data",
                "methods",
                "computed",
                "watch",
                "setup",
                "components",
                "directives"
              ].includes(propKeyName)
            ) {
              adapter.markAsUsed(fileId, propKeyName);
            }
          }
        }
      }
    }
  }
};

export default VueJsPlugin;