import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "node:path";

/**
 * Nuxt Plugin
 * Handles Nuxt-specific patterns: pages, layouts, middleware, composables, auto-imports, etc.
 */
export const NuxtPlugin: AnalyzerPlugin = {
  name: "nuxt-plugin",
  version: "1.0.1", // Incrementing version for the update
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["nuxt"] || pkg.devDependencies?.["nuxt"]);
      if (hasDep) return true;
    }
    // Fallback: If we see nuxt.config.ts or nuxt.config.js, enable it
    const nuxtConfigTs = await adapter.readFile("nuxt.config.ts");
    const nuxtConfigJs = await adapter.readFile("nuxt.config.js");
    return !!nuxtConfigTs || !!nuxtConfigJs;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark Nuxt conventional directories as entry points
      const nuxtPatterns = [
        "pages/", "layouts/", "middleware/", "composables/", "components/", "plugins/", "app.vue",
        "server/api/", "server/routes/", "server/middleware/"
      ];

      if (nuxtPatterns.some(pattern => fileId.includes(pattern))) {
        adapter.markAsUsed(fileId);
      }

      // Mark .vue files in these directories
      if ((fileId.includes("pages/") || fileId.includes("layouts/") || fileId.includes("components/")) && fileId.endsWith(".vue")) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Nuxt composables (useRouter, useFetch, useAsyncData, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const composableName = node.callee.name;
        const nuxtComposables = [
          "useRouter", "useRoute", "useFetch", "useAsyncData", "useLazyFetch", "useLazyAsyncData",
          "useHead", "useState", "useError", "useNuxtData", "useRequestHeaders", "useCookie",
          "useDirectives", "useAppConfig", "useRuntimeConfig", "useHydration", "useRequestEvent",
          "useRequestURL", "useSeoMeta", "useServerHead", "useServerSeoMeta", "useContentHead",
          "useContentSeoMeta", "useContentState", "useLocalePath", "useLocaleRoute", "useSwitchLocalePath",
          "useBrowserLocale", "useCookieLocale", "useSetLocaleCookie", "useAsyncLocaleData",
          "useI18n", "useStrapiClient", "useStrapiUser", "useStrapiAuth", "useStrapiMedia"
        ];
        if (nuxtComposables.includes(composableName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt definePageMeta, defineRouteRules, defineNuxtPlugin, defineNuxtRouteMiddleware, defineNuxtComponent
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const defineName = node.callee.name;
        const nuxtDefines = [
          "definePageMeta", "defineRouteRules", "defineNuxtPlugin", "defineNuxtRouteMiddleware",
          "defineNuxtComponent", "defineNuxtLink", "defineNuxtConfig", "defineEventHandler",
          "defineAppConfig", "defineServerMiddleware", "defineServerApi", "defineServerRoute"
        ];
        if (nuxtDefines.includes(defineName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt middleware definitions (export default function or arrow function)
      if (fileId.includes("middleware/") && t.isExportDefaultDeclaration(node)) {
        if (t.isFunctionDeclaration(node.declaration) || t.isFunctionExpression(node.declaration) || t.isArrowFunctionExpression(node.declaration)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt plugin definitions (export default defineNuxtPlugin(...))
      if (fileId.includes("plugins/") && t.isExportDefaultDeclaration(node)) {
        if (t.isCallExpression(node.declaration) && t.isIdentifier(node.declaration.callee) && node.declaration.callee.name === "defineNuxtPlugin") {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt config file analysis (nuxt.config.ts/js)
      if (fileId.includes("nuxt.config.") && t.isExportDefaultDeclaration(node)) {
        if (t.isCallExpression(node.declaration) && t.isIdentifier(node.declaration.callee) && node.declaration.callee.name === "defineNuxtConfig") {
          if (node.declaration.arguments.length > 0 && t.isObjectExpression(node.declaration.arguments[0])) {
            const nuxtConfigObject = node.declaration.arguments[0];
            for (const prop of nuxtConfigObject.properties) {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                const propName = prop.key.name;

                // Handle `alias` in `resolve`
                if (propName === "alias" && t.isObjectExpression(prop.value)) {
                  prop.value.properties.forEach(aliasProp => {
                    if (t.isObjectProperty(aliasProp) && t.isStringLiteral(aliasProp.value)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, aliasProp.value.value));
                    }
                  });
                }

                // Handle `modules`
                if (propName === "modules" && t.isArrayExpression(prop.value)) {
                  prop.value.elements.forEach(moduleName => {
                    if (t.isStringLiteral(moduleName)) {
                      // Mark module as used, assuming it refers to a local path or a package
                      adapter.markAsUsed(moduleName.value);
                    }
                  });
                }

                // Handle `components` directory auto-imports
                if (propName === "components" && (t.isBooleanLiteral(prop.value) && prop.value.value === true || t.isObjectExpression(prop.value) || t.isArrayExpression(prop.value))) {
                  // If components are enabled, mark the default components directory as used
                  adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, "components"));
                }

                // Handle `plugins` directory auto-imports
                if (propName === "plugins" && (t.isBooleanLiteral(prop.value) && prop.value.value === true || t.isObjectExpression(prop.value) || t.isArrayExpression(prop.value))) {
                  // If plugins are enabled, mark the default plugins directory as used
                  adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, "plugins"));
                }

                // Handle `buildModules` (Nuxt 2, but good to have)
                if (propName === "buildModules" && t.isArrayExpression(prop.value)) {
                  prop.value.elements.forEach(moduleName => {
                    if (t.isStringLiteral(moduleName)) {
                      adapter.markAsUsed(moduleName.value);
                    }
                  });
                }
              }
            }
          }
        }
      }

      // Nuxt auto-imported composables (starting with \'use\') in composables/ directory
      if (fileId.includes("composables/") && t.isIdentifier(node) && node.name.startsWith("use")) {
        adapter.markAsUsed(fileId, node.name);
      }

      // Nuxt auto-imported components (e.g., <NuxtLink>, <ClientOnly>)
      if (t.isJSXElement(node) && t.isJSXIdentifier(node.openingElement.name)) {
        const componentName = node.openingElement.name.name;
        if (componentName.startsWith("Nuxt") || componentName.startsWith("ClientOnly") || componentName.startsWith("ServerOnly")) {
          adapter.markAsUsed(fileId, componentName);
        }
      }
    }
  }
};

export default NuxtPlugin;
