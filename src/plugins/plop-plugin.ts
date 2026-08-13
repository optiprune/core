import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Plop configuration files
 */
const PLOP_CONFIG_FILES = [
  "plopfile.js",
  "plopfile.ts",
  "plopfile.mjs",
  "plopfile.cjs"
];

const PLOP_PACKAGES = ["plop", "node-plop"];

export const PlopPlugin: AnalyzerPlugin = {
  name: "plop-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Plop configuration files
    for (const configFile of PLOP_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check for common Plop template directories
    if (
      (await adapter.folderExists("plop-templates")) ||
      (await adapter.folderExists(".plop"))
    ) {
      return true;
    }

    // 3. Check package.json for plop dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => PLOP_PACKAGES.includes(dep))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bplop\b/.test(s) || s.includes("plop "))
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated Plop configuration files
      for (const configFile of PLOP_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect Plop generator templates directories
      if (await adapter.folderExists("plop-templates")) {
        adapter.markAsUsed("plop-templates");
      }
      if (await adapter.folderExists(".plop")) {
        adapter.markAsUsed(".plop");
      }

      if (pkg) {
        // 3. Protect plop and node-plop dependencies in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (PLOP_PACKAGES.includes(depName) || depName.startsWith("plop-pack-")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Mark npm scripts calling plop CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bplop\b/.test(scriptContent) || scriptContent.includes("plop "))
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

      // Protect plopfile configurations
      if (PLOP_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("plop");
      }

      // Protect template generator files (plop-templates/**, .plop/**, *.hbs)
      if (
        normalized.includes("/plop-templates/") ||
        normalized.startsWith("plop-templates/") ||
        normalized.includes("/.plop/") ||
        normalized.startsWith(".plop/") ||
        normalized.endsWith(".hbs") ||
        normalized.endsWith(".handlebars")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect plopfile.js / plopfile.ts AST for export default function(plop)
      if (PLOP_CONFIG_FILES.includes(basename)) {
        if (
          t.isExportDefaultDeclaration(node) ||
          t.isExportNamedDeclaration(node)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("plop");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("plop");
        }

        // Detect plop.setGenerator(...) or plop.load(...) calls to mark custom prompt/action packages as used
        if (
          t.isCallExpression(node) &&
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.object) &&
          node.callee.object.name === "plop" &&
          t.isIdentifier(node.callee.property)
        ) {
          if (node.callee.property.name === "load" && node.arguments[0]) {
            if (t.isStringLiteral(node.arguments[0])) {
              adapter.markPackageAsUsed(node.arguments[0].value);
            }
          }
        }
      }

      // 2. Retain imports from plop, node-plop, or plop-pack-*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          PLOP_PACKAGES.includes(source) ||
          source.startsWith("plop-pack-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default PlopPlugin;