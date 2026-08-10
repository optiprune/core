import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ELEVENTY_CONFIG_FILES = [
  ".eleventy.js",
  ".eleventy.cjs",
  ".eleventy.mjs",
  "eleventy.config.js",
  "eleventy.config.cjs",
  "eleventy.config.mjs",
  "eleventy.config.ts"
];

const ELEVENTY_DIRECTORIES = [
  "_includes",
  "_layouts",
  "_data",
  "_site"
];

export const EleventyPlugin: AnalyzerPlugin = {
  name: "eleventy-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "@11ty/eleventy" ||
            dep.startsWith("@11ty/") ||
            dep.startsWith("eleventy-plugin-")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("eleventy ") ||
                s === "eleventy" ||
                s.includes("11ty ") ||
                s === "11ty")
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files
    for (const configFile of ELEVENTY_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 3. Check for standard 11ty template directories
    for (const dir of ELEVENTY_DIRECTORIES) {
      if (await adapter.folderExists(dir)) return true;
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

      const has11ty = Object.keys(allDeps).some(
        (p) =>
          p === "@11ty/eleventy" ||
          p.startsWith("@11ty/") ||
          p.startsWith("eleventy-plugin-")
      );

      // 1. Safeguard installed Eleventy core & plugins in package.json
      if (has11ty) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "@11ty/eleventy" ||
            depName.startsWith("@11ty/") ||
            depName.startsWith("eleventy-plugin-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of ELEVENTY_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Protect standard template & data directories
      for (const dir of ELEVENTY_DIRECTORIES) {
        if (await adapter.folderExists(dir)) {
          adapter.markAsUsed(dir);
        }
      }

      // 4. Track npm scripts invoking Eleventy CLI (eleventy or 11ty)
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("eleventy") || scriptContent.includes("11ty"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@11ty/eleventy");
          }
        }
      }

      // 5. Report missing dependency if configuration exists without @11ty/eleventy package
      if (hasConfigFile && !has11ty) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Eleventy configuration found, but '@11ty/eleventy' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Eleventy configuration files
      if (ELEVENTY_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@11ty/eleventy");
      }

      // Protect files inside _includes, _layouts, _data
      if (
        ELEVENTY_DIRECTORIES.some(
          (dir) =>
            normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)
        )
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@11ty/eleventy");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = ELEVENTY_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @11ty/* or eleventy-plugin-*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source.startsWith("@11ty/") ||
          source.startsWith("eleventy-plugin-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@11ty/*')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value.startsWith("@11ty/") ||
            arg.value.startsWith("eleventy-plugin-"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. In .eleventy.js / eleventy.config.js configuration files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@11ty/eleventy");
        }

        // CommonJS module.exports = function(eleventyConfig) { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@11ty/eleventy");
        }

        // Detect addPlugin calls: eleventyConfig.addPlugin(eleventyNavigation)
        if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
          const prop = node.callee.property;
          if (t.isIdentifier(prop) && prop.name === "addPlugin") {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@11ty/eleventy");
          }
        }
      }
    }
  }
};

export default EleventyPlugin;