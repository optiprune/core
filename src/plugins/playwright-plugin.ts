import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PLAYWRIGHT_CONFIG_FILES = [
  "playwright.config.js",
  "playwright.config.ts",
  "playwright.config.mjs",
  "playwright.config.cjs"
];

const PLAYWRIGHT_PACKAGES = [
  "@playwright/test",
  "playwright",
  "playwright-core"
];

export const PlaywrightPlugin: AnalyzerPlugin = {
  name: "playwright-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    for (const configFile of PLAYWRIGHT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };

    return PLAYWRIGHT_PACKAGES.some((p) => p in allDeps);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Mark config files & packages as used
      for (const configFile of PLAYWRIGHT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        for (const pkgName of PLAYWRIGHT_PACKAGES) {
          if (
            pkg.dependencies?.[pkgName] ||
            pkg.devDependencies?.[pkgName] ||
            pkg.peerDependencies?.[pkgName]
          ) {
            adapter.markPackageAsUsed(pkgName);
          }
        }

        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              /\bplaywright\b/.test(scriptContent)
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

      // Protect Playwright config file
      if (PLAYWRIGHT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Mark Playwright specs, page objects, fixtures, and helpers as used
      if (
        /\.(spec|test)\.[jt]sx?$/.test(normalized) ||
        normalized.includes("/e2e/") ||
        normalized.includes("/tests/") ||
        normalized.includes("/page-objects/") ||
        normalized.includes("/fixtures/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (!PLAYWRIGHT_CONFIG_FILES.includes(basename)) return;

      // Handle config default export (e.g., export default defineConfig({...}))
      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }

      // Track reporter packages or testDir properties referenced in playwright.config.ts
      if (
        t.isObjectProperty(node) &&
        t.isIdentifier(node.key) &&
        node.key.name === "reporter"
      ) {
        if (t.isStringLiteral(node.value)) {
          adapter.markPackageAsUsed(node.value.value);
        } else if (t.isArrayExpression(node.value)) {
          for (const el of node.value.elements) {
            if (t.isArrayExpression(el) && t.isStringLiteral(el.elements[0])) {
              adapter.markPackageAsUsed(el.elements[0].value);
            }
          }
        }
      }
    }
  }
};

export default PlaywrightPlugin;