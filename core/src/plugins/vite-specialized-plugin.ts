import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SPECIALIZED_VITE_PACKAGES = [
  "electron-vite",
  "laravel-vite-plugin",
  "vite-plugin-pwa",
  "@vite-pwa/assets-generator",
  "vite-plugin-windicss",
  "@unocss/vite",
  "vite-plugin-pages",
  "vite-plugin-vue-layouts",
  "vite-plugin-vue-layouts-next",
  "vite-plus",
  "wxt",
];

const ELECTRON_VITE_CONFIG_FILES = [
  "electron.vite.config.ts",
  "electron.vite.config.js",
  "electron.vite.config.mjs",
  "electron.vite.config.cjs",
];

const WXT_CONFIG_FILES = ["wxt.config.ts", "wxt.config.js", "wxt.config.mjs", "wxt.config.cjs"];

const VITE_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "pwa-assets.config.ts",
  "pwa-assets.config.js",
];

export const ViteSpecializedPlugin: AnalyzerPlugin = {
  name: "vite-specialized-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        SPECIALIZED_VITE_PACKAGES.some(
          (pkgName) =>
            pkgName in allDeps ||
            Object.keys(allDeps).some(
              (dep) => dep.startsWith("@wxt-dev/") || dep.startsWith("@vite-pwa/"),
            ),
        )
      ) {
        return true;
      }
    }

    for (const file of [...ELECTRON_VITE_CONFIG_FILES, ...WXT_CONFIG_FILES]) {
      if (await adapter.folderExists(file)) return true;
    }

    if (await adapter.folderExists("entrypoints")) return true;

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      // 1. Protect installed specialized Vite & WXT packages in package.json
      for (const depName of Object.keys(allDeps)) {
        if (
          SPECIALIZED_VITE_PACKAGES.includes(depName) ||
          depName.startsWith("@wxt-dev/") ||
          depName.startsWith("@vite-pwa/")
        ) {
          // A manifest entry alone is not evidence that this package is used.
          // Usage is marked by the config, script, import, or file hooks below.
        }
      }

      // 2. Protect Electron Vite & WXT configuration files
      for (const configFile of ELECTRON_VITE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
          adapter.markPackageAsUsed("electron-vite");
        }
      }

      for (const configFile of WXT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
          adapter.markPackageAsUsed("wxt");
        }
      }

      // 3. Protect WXT entrypoints directory
      if (await adapter.folderExists("entrypoints")) {
        adapter.markAsUsed("entrypoints");
      }

      // 4. Track npm scripts invoking electron-vite, wxt, or pwa-assets-generator
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string") {
            if (
              scriptContent.includes("electron-vite") ||
              scriptContent.includes("wxt") ||
              scriptContent.includes("pwa-assets-generator") ||
              scriptContent.includes("vite-plus") ||
              scriptContent.includes("vite build")
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Configuration files
      if (ELECTRON_VITE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("electron-vite");
      }

      if (WXT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("wxt");
      }

      if (basename.startsWith("pwa-assets.config.")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@vite-pwa/assets-generator");
      }

      // 2. WXT WebExtension Entrypoints (entrypoints/popup.html, entrypoints/background.ts, etc.)
      if (normalized.includes("/entrypoints/") || normalized.startsWith("entrypoints/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("wxt");
      }

      // Electron-Vite entry files are configuration-defined. Do not promote
      // conventional src/main, src/preload, or src/renderer files without a
      // corresponding config reference.

      // 4. File-Based Pages & Layouts Routing (vite-plugin-pages, vite-plugin-vue-layouts-next)
      if (
        normalized.includes("/src/pages/") ||
        normalized.includes("/src/layouts/") ||
        normalized.includes("/src/routes/")
      ) {
        adapter.markAsUsed(fileId);
      }

      // 5. Laravel Vite assets entry directory
      if (normalized.includes("resources/css/") || normalized.includes("resources/js/")) {
        if (
          basename === "app.js" ||
          basename === "app.ts" ||
          basename === "app.css" ||
          basename === "bootstrap.js"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("laravel-vite-plugin");
        }
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isElectronConfig = ELECTRON_VITE_CONFIG_FILES.includes(basename);
      const isWxtConfig = WXT_CONFIG_FILES.includes(basename);
      const isViteConfig = VITE_CONFIG_FILES.includes(basename);

      // 1. Protect ESM imports for specialized packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          SPECIALIZED_VITE_PACKAGES.includes(source) ||
          source.startsWith("@wxt-dev/") ||
          source.startsWith("@vite-pwa/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect electron-vite & WXT defineConfig(...)
      if (
        (isElectronConfig || isWxtConfig) &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "defineConfig"
      ) {
        adapter.markAsUsed(fileId);
        if (isElectronConfig) adapter.markPackageAsUsed("electron-vite");
        if (isWxtConfig) adapter.markPackageAsUsed("wxt");
      }

      // 3. Detect laravel({ input: [...] }) plugin calls in vite.config.ts/js
      if (
        isViteConfig &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "laravel"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("laravel-vite-plugin");

        const firstArg = node.arguments[0];
        if (firstArg && t.isObjectExpression(firstArg)) {
          for (const prop of firstArg.properties) {
            if (
              (prop as any).key &&
              t.isIdentifier((prop as any).key) &&
              (prop as any).key.name === "input"
            ) {
              const val = (prop as any).value;

              if (t.isStringLiteral(val)) {
                adapter.markAsUsed(val.value);
              }

              if (val && val.type === "ArrayExpression") {
                val.elements.forEach((el: any) => {
                  if (el && t.isStringLiteral(el)) {
                    adapter.markAsUsed(el.value);
                  }
                });
              }
            }
          }
        }
      }
    },
  },
};

export default ViteSpecializedPlugin;
