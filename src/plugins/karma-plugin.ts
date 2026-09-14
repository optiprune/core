import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Karma configuration files
 */
const KARMA_CONFIG_FILES = [
  "karma.conf.js",
  "karma.conf.ts",
  "karma.conf.cjs",
  "karma.conf.mjs",
  "karma.conf.coffee",
  ".karmarc",
];

const KARMA_PACKAGE_NAME = "karma";

/**
 * Normalizes Karma plugin shorthands into full npm package names
 */
function normalizeKarmaPlugin(
  type: "framework" | "launcher" | "preprocessor" | "reporter",
  name: string,
): string {
  // Direct package name or scoped package
  if (name.startsWith("karma-") || name.startsWith("@")) return name;

  switch (type) {
    case "framework":
      return `karma-${name}`;
    case "launcher":
      return `karma-${name.toLowerCase()}-launcher`;
    case "preprocessor":
      return `karma-${name}-preprocessor`;
    case "reporter":
      return `karma-${name}-reporter`;
  }
}

export const KarmaPlugin: AnalyzerPlugin = {
  name: "karma-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Karma config files
    for (const configFile of KARMA_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for Karma dependencies or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some((dep) => dep === KARMA_PACKAGE_NAME || dep.startsWith("karma-"))
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bkarma\b/.test(s) || s.includes("karma start")),
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

      // 1. Protect Karma config files
      for (const configFile of KARMA_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all karma-* dependencies in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === KARMA_PACKAGE_NAME || depName.startsWith("karma-")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Mark scripts running karma CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bkarma\b/.test(scriptContent) || scriptContent.includes("karma start"))
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

      // Protect configuration files
      if (KARMA_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Mark test files matching standard Karma patterns (*.spec.js, *.test.js, etc.)
      if (
        /\.(spec|test)\.[jt]sx?$/.test(normalized) ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (!KARMA_CONFIG_FILES.includes(basename)) return;

      // Mark module.exports = function(config) { ... }
      if (
        t.isAssignmentExpression(node) &&
        t.isMemberExpression(node.left) &&
        t.isIdentifier(node.left.object) &&
        node.left.object.name === "module" &&
        t.isIdentifier(node.left.property) &&
        node.left.property.name === "exports"
      ) {
        adapter.markAsUsed(fileId);
      }

      // Export default in ESM/TS Karma configs
      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }

      // Inspect config.set({ ... }) call AST properties to resolve plugins
      if (
        t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === "set" &&
        node.arguments.length > 0 &&
        t.isObjectExpression(node.arguments[0])
      ) {
        const configObj = node.arguments[0];

        for (const prop of configObj.properties) {
          if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

          const keyName = prop.key.name;

          // Process frameworks: ['jasmine', 'mocha', 'qunit']
          if (keyName === "frameworks" && t.isArrayExpression(prop.value)) {
            for (const el of prop.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(normalizeKarmaPlugin("framework", el.value));
              }
            }
          }

          // Process browsers: ['Chrome', 'Firefox', 'PhantomJS']
          if (keyName === "browsers" && t.isArrayExpression(prop.value)) {
            for (const el of prop.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(normalizeKarmaPlugin("launcher", el.value));
              }
            }
          }

          // Process reporters: ['progress', 'coverage', 'kjhtml']
          if (keyName === "reporters" && t.isArrayExpression(prop.value)) {
            for (const el of prop.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(normalizeKarmaPlugin("reporter", el.value));
              }
            }
          }

          // Process plugins array require/import strings: plugins: ['karma-jasmine', require('karma-chrome-launcher')]
          if (keyName === "plugins" && t.isArrayExpression(prop.value)) {
            for (const el of prop.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(el.value);
              } else if (
                t.isCallExpression(el) &&
                t.isIdentifier(el.callee) &&
                el.callee.name === "require"
              ) {
                if (el.arguments[0] && t.isStringLiteral(el.arguments[0])) {
                  adapter.markPackageAsUsed(el.arguments[0].value);
                }
              }
            }
          }
        }
      }
    },
  },
};

export default KarmaPlugin;
