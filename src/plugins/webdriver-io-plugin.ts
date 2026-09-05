import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const WDIO_CONFIG_FILES = ["wdio.conf.js", "wdio.conf.ts", "wdio.conf.cjs", "wdio.conf.mjs"];

const WDIO_PACKAGES = [
  "webdriverio",
  "@wdio/cli",
  "@wdio/local-runner",
  "@wdio/mocha-framework",
  "@wdio/jasmine-framework",
  "@wdio/cucumber-framework",
  "@wdio/spec-reporter",
];

export const WebdriverIOPlugin: AnalyzerPlugin = {
  name: "webdriverio-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    for (const configFile of WDIO_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    return WDIO_PACKAGES.some((p) => p in allDeps);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      for (const configFile of WDIO_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        for (const pkgName of WDIO_PACKAGES) {
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
            if (typeof scriptContent === "string" && /\bwdio\b/.test(scriptContent)) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (WDIO_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }

      if (
        normalized.includes("/e2e/") ||
        normalized.includes("/test/specs/") ||
        /\.e2e\.[jt]sx?$/.test(normalized) ||
        /\.page\.[jt]sx?$/.test(normalized)
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (WDIO_CONFIG_FILES.includes(basename)) {
        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "exports" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "config"
        ) {
          adapter.markAsUsed(fileId, "config");
        }
      }
    },
  },
};

export default WebdriverIOPlugin;
