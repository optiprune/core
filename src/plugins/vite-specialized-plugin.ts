import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SPECIALIZED_VITE_PACKAGES = [
  "electron-vite",
  "laravel-vite-plugin",
  "vite-plugin-pwa",
  "vite-plugin-windicss",
  "@unocss/vite"
];

const ELECTRON_VITE_CONFIG_FILES = [
  "electron.vite.config.ts",
  "electron.vite.config.js",
  "electron.vite.config.mjs",
  "electron.vite.config.cjs"
];

const VITE_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs"
];

export const ViteSpecializedPlugin: AnalyzerPlugin = {
  name: "vite-specialized-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (SPECIALIZED_VITE_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const file of ELECTRON_VITE_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      // 1. Protect installed specialized Vite packages in package.json
      for (const vitePkg of SPECIALIZED_VITE_PACKAGES) {
        if (allDeps[vitePkg]) {
          adapter.markPackageAsUsed(vitePkg);
        }
      }

      // 2. Protect Electron Vite configuration files
      for (const configFile of ELECTRON_VITE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
          adapter.markPackageAsUsed("electron-vite");
        }
      }

      // 3. Track npm scripts invoking electron-vite
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("electron-vite") ||
              scriptContent.includes("vite build"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Electron Vite configuration files
      if (ELECTRON_VITE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("electron-vite");
      }

      // 2. Electron Vite standard entry conventions (main, preload, renderer)
      if (
        normalized.includes("src/main/") ||
        normalized.includes("src/preload/") ||
        normalized.includes("src/renderer/")
      ) {
        if (
          basename === "index.ts" ||
          basename === "index.js" ||
          basename === "main.ts" ||
          basename === "main.js" ||
          basename === "index.html"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("electron-vite");
        }
      }

      // 3. Laravel Vite assets entry directory
      if (normalized.includes("resources/css/") || normalized.includes("resources/js/")) {
        if (basename === "app.js" || basename === "app.ts" || basename === "app.css" || basename === "bootstrap.js") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("laravel-vite-plugin");
        }
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isElectronConfig = ELECTRON_VITE_CONFIG_FILES.includes(basename);
      const isViteConfig = VITE_CONFIG_FILES.includes(basename);

      // 1. Protect ESM imports for electron-vite and laravel-vite-plugin
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (SPECIALIZED_VITE_PACKAGES.includes(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect electron-vite defineConfig(...)
      if (
        isElectronConfig &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "defineConfig"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("electron-vite");
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

        // Extract input asset strings inside laravel({ input: ['resources/js/app.js', ...] })
        const firstArg = node.arguments[0];
        if (firstArg && t.isObjectExpression(firstArg)) {
          for (const prop of firstArg.properties) {
            if (
              (prop as any).key &&
              t.isIdentifier((prop as any).key) &&
              (prop as any).key.name === "input"
            ) {
              const val = (prop as any).value;

              // String input: laravel({ input: 'resources/js/app.js' })
              if (t.isStringLiteral(val)) {
                adapter.markAsUsed(val.value);
              }

              // Array input: laravel({ input: ['resources/css/app.css', 'resources/js/app.js'] })
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
    }
  }
};

export default ViteSpecializedPlugin;