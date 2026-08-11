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
  "_data"
];

const ELEVENTY_TEMPLATE_EXTENSIONS = new Set([
  ".njk",
  ".liquid",
  ".hbs",
  ".mustache",
  ".pug",
  ".ejs",
  ".haml",
  ".11ty.js"
]);

export const EleventyPlugin: AnalyzerPlugin = {
  name: "eleventy-plugin",
  version: "1.1.0",

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
              (s.includes("eleventy") || s.includes("11ty"))
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

    // 3. Check for standard 11ty directories
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

      // Protect installed Eleventy core & ecosystem packages
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

      // Protect configuration files
      let hasConfigFile = false;
      for (const configFile of ELEVENTY_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // Protect template & data directories
      for (const dir of ELEVENTY_DIRECTORIES) {
        if (await adapter.folderExists(dir)) {
          adapter.markAsUsed(dir);
        }
      }

      // Track scripts
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

      // Report missing dependency error
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

      // 1. Config Files
      if (ELEVENTY_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@11ty/eleventy");
      }

      // 2. Convention folders (_includes, _layouts, _data) or 11tydata JS/TS files
      const isEleventyDir = ELEVENTY_DIRECTORIES.some(
        (dir) => normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)
      );
      const is11tyDataFile = normalized.includes(".11tydata.");

      if (isEleventyDir || is11tyDataFile) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@11ty/eleventy");
      }

      // 3. Eleventy template files (.njk, .liquid, .11ty.js, etc.)
      for (const ext of ELEVENTY_TEMPLATE_EXTENSIONS) {
        if (normalized.endsWith(ext)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@11ty/eleventy");
          break;
        }
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = ELEVENTY_CONFIG_FILES.includes(basename);
      const isDataOrTemplateScript =
        normalized.includes("_data/") || normalized.includes(".11tydata.");

      // 1. Mark all non-relative imports inside Eleventy Config files as used packages
      if (isConfigFile && t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (!source.startsWith(".") && !source.startsWith("/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Mark all non-relative require() calls inside Eleventy Config files as used packages
      if (
        isConfigFile &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && !arg.value.startsWith(".") && !arg.value.startsWith("/")) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Mark Default Exports in Config or Data files as used
      if (isConfigFile || isDataOrTemplateScript) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@11ty/eleventy");
        }

        // CJS module.exports = ...
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@11ty/eleventy");
        }
      }

      // 4. Detect eleventyConfig.addPlugin / addFilter / addTransform calls
      if (isConfigFile && t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const prop = node.callee.property;
        if (
          t.isIdentifier(prop) &&
          (prop.name.startsWith("add") || prop.name.startsWith("set"))
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@11ty/eleventy");
        }
      }
    }
  }
};

export default EleventyPlugin;