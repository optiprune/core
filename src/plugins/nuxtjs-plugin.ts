import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Nuxt Plugin
 * Handles Nuxt-specific patterns: pages, layouts, middleware, composables, auto-imports, etc.
 */
export const NuxtPlugin: AnalyzerPlugin = {
  name: "nuxt-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.['nuxt'] || pkg.devDependencies?.['nuxt']);
      if (hasDep) return true;
    }
    // Fallback: If we see nuxt.config.ts, enable it
    const nuxtConfig = await adapter.readFile('nuxt.config.ts');
    return !!nuxtConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark Nuxt conventional directories as entry points
      const nuxtPatterns = [
        'pages/', 'layouts/', 'middleware/', 'composables/', 'components/', 'plugins/', 'app.vue'
      ];

      if (nuxtPatterns.some(pattern => fileId.includes(pattern))) {
        adapter.markAsUsed(fileId);
      }

      // Mark .vue files in these directories
      if ((fileId.includes('pages/') || fileId.includes('layouts/') || fileId.includes('components/')) && fileId.endsWith('.vue')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Nuxt composables (useRouter, useFetch, useAsyncData, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const composableName = node.callee.name;
        if (['useRouter', 'useRoute', 'useFetch', 'useAsyncData', 'useLazyFetch', 'useLazyAsyncData', 'useHead', 'useState', 'useError', 'useNuxtData', 'useRequestHeaders', 'useCookie', 'useDirectives'].includes(composableName)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt definePageMeta
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'definePageMeta') {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt defineRouteRules
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'defineRouteRules') {
          adapter.markAsUsed(fileId);
        }
      }

      // Nuxt middleware definitions
      if (t.isExportDefaultDeclaration(node)) {
        if (t.isFunctionDeclaration(node.declaration) || t.isFunctionExpression(node.declaration)) {
          if (fileId.includes('middleware/')) {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Nuxt plugin definitions
      if (t.isExportDefaultDeclaration(node)) {
        if (t.isCallExpression(node.declaration) && t.isIdentifier(node.declaration.callee)) {
          if (node.declaration.callee.name === 'defineNuxtPlugin') {
            adapter.markAsUsed(fileId);
          }
        }
      }

      // Nuxt auto-imported composables (starting with 'use')
      if (t.isIdentifier(node) && node.name.startsWith('use')) {
        if (fileId.includes('composables/')) {
          adapter.markAsUsed(fileId, node.name);
        }
      }
    }
  }
};

export default NuxtPlugin;
