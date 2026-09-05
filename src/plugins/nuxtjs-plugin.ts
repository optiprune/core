import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NUXT_CONFIG_FILES = [
  "nuxt.config.ts",
  "nuxt.config.js",
  "nuxt.config.mjs",
  "nuxt.config.cjs",
  "app.config.ts",
  "app.config.js",
];

const NUXT_ECOSYSTEM_PACKAGES = [
  "@pinia/nuxt",
  "@nuxtjs/tailwindcss",
  "@nuxtjs/i18n",
  "@nuxt/content",
  "@nuxt/image",
  "@nuxt/ui",
  "@nuxt/devtools",
  "@vueuse/nuxt",
];

const NUXT_COMPOSABLES = new Set([
  "useRouter",
  "useRoute",
  "useFetch",
  "useAsyncData",
  "useLazyFetch",
  "useLazyAsyncData",
  "useHead",
  "useState",
  "useError",
  "useNuxtData",
  "useRequestHeaders",
  "useCookie",
  "useNuxtApp",
  "useDirectives",
  "useAppConfig",
  "useRuntimeConfig",
  "useHydration",
  "useRequestEvent",
  "useRequestURL",
  "useSeoMeta",
  "useServerHead",
  "useServerSeoMeta",
  "useContentHead",
  "useContentSeoMeta",
  "useContentState",
  "useLocalePath",
  "useLocaleRoute",
  "useSwitchLocalePath",
  "useBrowserLocale",
  "useCookieLocale",
  "useSetLocaleCookie",
  "useAsyncLocaleData",
  "useI18n",
  "usePinia",
  "defineStore",
  "storeToRefs",
]);

const NUXT_DEFINES = new Set([
  "definePageMeta",
  "defineRouteRules",
  "defineNuxtPlugin",
  "defineNuxtRouteMiddleware",
  "defineNuxtComponent",
  "defineNuxtLink",
  "defineNuxtConfig",
  "defineEventHandler",
  "defineAppConfig",
  "defineServerMiddleware",
  "defineServerApi",
  "defineServerRoute",
  "defineRenderHandler",
  "defineNitroPlugin",
]);

const NITRO_UTILS = new Set([
  "readBody",
  "readRawBody",
  "getQuery",
  "getRouterParams",
  "getRouterParam",
  "createError",
  "sendRedirect",
  "setResponseStatus",
  "appendHeader",
  "setCookie",
  "deleteCookie",
]);

async function hasNuxtRuntimeEvidence(
  adapter: import("../types.js").PluginAdapter,
): Promise<boolean> {
  return (
    (await adapter.folderExists("app.vue")) ||
    (await adapter.folderExists("pages")) ||
    (await adapter.folderExists("server/api")) ||
    (await adapter.folderExists("server/routes"))
  );
}

function hasNuxtScript(pkg: any): boolean {
  return Object.values(pkg?.scripts ?? {}).some(
    (script) =>
      typeof script === "string" &&
      /(?:^|\s)(?:pnpm\s+exec\s+|yarn\s+|bunx\s+|npx\s+)?(?:nuxt|nuxi)(?:\s|$)/.test(script),
  );
}

export const NuxtPlugin: AnalyzerPlugin = {
  name: "nuxt-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const hasNuxtDependency = Boolean(
      pkg?.dependencies?.["nuxt"] ||
      pkg?.devDependencies?.["nuxt"] ||
      pkg?.peerDependencies?.["nuxt"] ||
      pkg?.dependencies?.["nuxt3"] ||
      pkg?.devDependencies?.["nuxt3"] ||
      pkg?.peerDependencies?.["nuxt3"],
    );
    const hasNuxtConfig = (
      await Promise.all(
        NUXT_CONFIG_FILES.filter((file) => file.startsWith("nuxt.config")).map((file) =>
          adapter.folderExists(file),
        ),
      )
    ).some(Boolean);
    const discoveredConfigs =
      typeof (adapter as Partial<import("../types.js").PluginAdapter>).findFiles === "function"
        ? await adapter.findFiles(NUXT_CONFIG_FILES)
        : [];

    if (hasNuxtConfig || discoveredConfigs.length > 0) return true;
    if (!hasNuxtDependency) return false;
    return hasNuxtScript(pkg) || (await hasNuxtRuntimeEvidence(adapter));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };
      adapter.declareFramework("nuxt");

      // A Nuxt dependency declaration alone is not usage evidence. Config,
      // scripts, route files, and Nuxt-specific AST constructs are handled below.

      for (const configFile of NUXT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("nuxt") || scriptContent.includes("nuxi"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark Nuxt conventional directories as entry points (Supports Nuxt 3 & Nuxt 4 app/ directory structure)
      const nuxtDirectoryPatterns = [
        "/pages/",
        "/layouts/",
        "/middleware/",
        "/composables/",
        "/components/",
        "/plugins/",
        "/server/api/",
        "/server/routes/",
        "/server/middleware/",
        "/server/plugins/",
        "/server/utils/",
        "/utils/",
        "/app/pages/",
        "/app/layouts/",
        "/app/components/",
        "/app/composables/",
      ];

      if (nuxtDirectoryPatterns.some((pattern) => normalized.includes(pattern))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("nuxt");
      }

      // Mark root entry components
      const rootEntries = ["app.vue", "error.vue", "app/app.vue", "app/error.vue"];
      if (rootEntries.some((entry) => normalized.endsWith(entry))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("nuxt");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Nuxt Composables & Nitro Helpers
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const calleeName = node.callee.name;

        if (
          NUXT_COMPOSABLES.has(calleeName) ||
          NITRO_UTILS.has(calleeName) ||
          NUXT_DEFINES.has(calleeName)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("nuxt");
        }
      }

      // 2. Nuxt plugin & middleware default export handlers
      if (
        (normalized.includes("/plugins/") || normalized.includes("/middleware/")) &&
        t.isExportDefaultDeclaration(node)
      ) {
        adapter.markAsUsed(fileId);
      }

      // 3. Detailed nuxt.config AST inspection
      if (
        NUXT_CONFIG_FILES.some((cfg) => normalized.endsWith(cfg)) &&
        t.isExportDefaultDeclaration(node)
      ) {
        if (
          t.isCallExpression(node.declaration) &&
          t.isIdentifier(node.declaration.callee) &&
          node.declaration.callee.name === "defineNuxtConfig"
        ) {
          const configArg = node.declaration.arguments[0];

          if (t.isObjectExpression(configArg)) {
            configArg.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop)) {
                const propName = prop.key?.name || prop.key?.value;

                // Modules: ['@pinia/nuxt', './modules/my-module']
                if (
                  (propName === "modules" ||
                    propName === "buildModules" ||
                    propName === "extends") &&
                  t.isArrayExpression(prop.value)
                ) {
                  prop.value.elements.forEach((el: any) => {
                    if (t.isStringLiteral(el)) {
                      const modVal = el.value;
                      if (modVal.startsWith(".") || modVal.startsWith("/")) {
                        adapter.markAsUsed(modVal);
                      } else {
                        adapter.markPackageAsUsed(modVal);
                      }
                    }
                  });
                }

                // Components / Plugins directory overrides
                if (
                  (propName === "components" || propName === "plugins") &&
                  (t.isBooleanLiteral(prop.value) ||
                    t.isObjectExpression(prop.value) ||
                    t.isArrayExpression(prop.value))
                ) {
                  adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, propName));
                }
              }
            });
          }
        }
      }

      // 4. Nuxt / Vue Built-in components (<NuxtPage>, <NuxtLayout>, <NuxtLink>, <ClientOnly>, etc.)
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
        const componentName = node.openingElement.name.name;
        if (
          componentName.startsWith("Nuxt") ||
          componentName.startsWith("ClientOnly") ||
          componentName.startsWith("ServerOnly")
        ) {
          adapter.markAsUsed(fileId, componentName);
          adapter.markPackageAsUsed("nuxt");
        }
      }
    },
  },
};

export default NuxtPlugin;
