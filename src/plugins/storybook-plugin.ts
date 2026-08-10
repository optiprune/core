import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const STORY_FILE_REGEX = /\.(stories|story)\.[jt]sx?$/;

const STORYBOOK_CONFIG_FILES = [
  ".storybook/main.ts",
  ".storybook/main.js",
  ".storybook/main.mjs",
  ".storybook/main.cjs",
  ".storybook/preview.ts",
  ".storybook/preview.js",
  ".storybook/preview.mjs",
  ".storybook/preview.jsx",
  ".storybook/preview.tsx",
  ".storybook/manager.ts",
  ".storybook/manager.js"
];

const STORYBOOK_FRAMEWORK_PACKAGES = [
  "storybook",
  "@storybook/react",
  "@storybook/react-vite",
  "@storybook/react-webpack5",
  "@storybook/vue3",
  "@storybook/vue3-vite",
  "@storybook/angular",
  "@storybook/nextjs",
  "@storybook/svelte",
  "@storybook/svelte-vite",
  "@storybook/sveltekit",
  "@storybook/html",
  "@storybook/html-vite",
  "@storybook/addon-essentials",
  "@storybook/addon-links",
  "@storybook/addon-interactions",
  "@storybook/addon-a11y",
  "@storybook/addon-docs",
  "@storybook/blocks",
  "@storybook/testing-library",
  "@storybook/test"
];

export const StorybookPlugin: AnalyzerPlugin = {
  name: "storybook-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "storybook" || dep.startsWith("@storybook/")
        )
      ) {
        return true;
      }
    }

    return await adapter.folderExists(".storybook");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasStorybook = Object.keys(allDeps).some(
        (p) => p === "storybook" || p.startsWith("@storybook/")
      );

      const hasStorybookDir = await adapter.folderExists(".storybook");

      // 1. Mark installed Storybook framework and addon packages as used
      if (hasStorybook) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "storybook" || depName.startsWith("@storybook/")) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect .storybook directory
      if (hasStorybookDir) {
        adapter.markAsUsed(".storybook");
      }

      // 3. Track npm scripts invoking Storybook (e.g. "storybook": "storybook dev -p 6006")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("storybook") || scriptContent.includes("build-storybook"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("storybook");
          }
        }
      }

      if (hasStorybookDir && !hasStorybook) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Storybook configuration directory (.storybook) found, but 'storybook' or '@storybook/*' packages are not listed in package.json.",
          evidence: { hasStorybookDir }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Protect Storybook configuration files
      if (
        normalized.includes(".storybook/") ||
        STORYBOOK_CONFIG_FILES.some((cfg) => normalized.endsWith(cfg))
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("storybook");
      }

      // 2. Protect Component Story files
      if (STORY_FILE_REGEX.test(normalized)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("storybook");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const isConfigFile = normalized.includes(".storybook/");
      const isStoryFile = STORY_FILE_REGEX.test(normalized);

      // 1. Detect ESM imports from Storybook packages in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "storybook" || source.startsWith("@storybook/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Storybook configuration files (.storybook/main.ts, preview.ts, etc.)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("storybook");
        }

        // Extract addons inside .storybook/main.ts: addons: ['@storybook/addon-essentials', ...]
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "addons") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(el.value);
              } else if (t.isObjectExpression(el)) {
                el.properties.forEach((prop: any) => {
                  if (
                    t.isObjectProperty(prop) &&
                    t.isIdentifier(prop.key) &&
                    prop.key.name === "name" &&
                    t.isStringLiteral(prop.value)
                  ) {
                    adapter.markPackageAsUsed(prop.value.value);
                  }
                });
              }
            });
          }
        }
      }

      // 3. In Component Story files (*.stories.tsx / *.story.js)
      if (isStoryFile) {
        // Protect Component Meta export: export default { title: 'Button', component: Button }
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("storybook");
        }

        // Protect Named Story exports: export const Primary = { args: { ... } }
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          const decl = node.declaration;
          if (t.isVariableDeclaration(decl)) {
            for (const d of decl.declarations) {
              if (t.isIdentifier(d.id)) {
                adapter.markAsUsed(fileId, d.id.name);
                adapter.markPackageAsUsed("storybook");
              }
            }
          } else if (t.isFunctionDeclaration(decl) && decl.id) {
            adapter.markAsUsed(fileId, decl.id.name);
            adapter.markPackageAsUsed("storybook");
          }
        }
      }
    }
  }
};

export default StorybookPlugin;