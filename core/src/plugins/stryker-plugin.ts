import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Stryker Mutator configuration files
 */
const STRYKER_CONFIG_FILES = [
  "stryker.config.js",
  "stryker.config.mjs",
  "stryker.config.cjs",
  "stryker.config.json",
  "stryker.conf.js",
  "stryker.conf.json",
  ".stryker.conf.json",
];

const STRYKER_CORE_PACKAGE = "@stryker-mutator/core";
const STRYKER_CLI_PACKAGE = "@stryker-mutator/api";

/**
 * Normalizes plugin names referenced in Stryker config strings to full npm package names
 */
function normalizeStrykerPlugin(name: string): string {
  if (name.startsWith("@stryker-mutator/") || name.startsWith("stryker-")) {
    return name;
  }
  // Standard Stryker plugin naming convention
  return `@stryker-mutator/${name}-runner`;
}

/**
 * Helper to process Stryker configuration objects and extract plugins, testRunner, checkers, mutator, and reporters
 */
function processStrykerConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process explicit plugins array: plugins: ['@stryker-mutator/jest-runner', '@stryker-mutator/typescript-checker']
  if (config.plugins && Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(plugin);
      }
    }
  }

  // Process testRunner: 'jest' -> '@stryker-mutator/jest-runner'
  if (typeof config.testRunner === "string") {
    adapter.markPackageAsUsed(normalizeStrykerPlugin(config.testRunner));
  }

  // Process checkers array: checkers: ['typescript'] -> '@stryker-mutator/typescript-checker'
  if (config.checkers) {
    const checkersList = Array.isArray(config.checkers) ? config.checkers : [config.checkers];
    for (const checker of checkersList) {
      if (typeof checker === "string") {
        adapter.markPackageAsUsed(`@stryker-mutator/${checker}-checker`);
      }
    }
  }

  // Process mutator: 'typescript' -> '@stryker-mutator/typescript-checker'
  if (typeof config.mutator === "string") {
    if (config.mutator.includes("typescript")) {
      adapter.markPackageAsUsed("@stryker-mutator/typescript-checker");
    }
  }

  // Process reporters array: reporters: ['html', 'clear-text', 'progress', 'dashboard']
  if (config.reporters && Array.isArray(config.reporters)) {
    for (const reporter of config.reporters) {
      if (
        typeof reporter === "string" &&
        (reporter.startsWith("@") || reporter.startsWith("stryker-"))
      ) {
        adapter.markPackageAsUsed(reporter);
      }
    }
  }
}

export const StrykerPlugin: AnalyzerPlugin = {
  name: "stryker-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Stryker config files
    for (const configFile of STRYKER_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependencies, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.stryker) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === STRYKER_CORE_PACKAGE ||
            dep === STRYKER_CLI_PACKAGE ||
            dep.startsWith("@stryker-mutator/") ||
            dep.startsWith("stryker-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bstryker\b/.test(s) || s.includes("stryker run")),
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

      // 1. Mark dedicated configuration files as used
      for (const configFile of STRYKER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all @stryker-mutator/* and stryker-* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === STRYKER_CORE_PACKAGE ||
            depName === STRYKER_CLI_PACKAGE ||
            depName.startsWith("@stryker-mutator/") ||
            depName.startsWith("stryker-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Process inline package.json#stryker configuration block
        if (pkg.stryker) {
          adapter.markAsUsed("package.json", "stryker");
          processStrykerConfig(pkg.stryker, adapter);
        }

        // 4. Mark scripts running stryker CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bstryker\b/.test(scriptContent) || scriptContent.includes("stryker run"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config files if present
      const jsonConfigFile = (await adapter.folderExists("stryker.config.json"))
        ? "stryker.config.json"
        : (await adapter.folderExists("stryker.conf.json"))
          ? "stryker.conf.json"
          : (await adapter.folderExists(".stryker.conf.json"))
            ? ".stryker.conf.json"
            : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processStrykerConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (STRYKER_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS configuration files (stryker.config.js, stryker.conf.js, etc.)
      if (basename.startsWith("stryker.config.") || basename.startsWith("stryker.conf.")) {
        // Mark ES module default export / CommonJS module.exports
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
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
        }

        // AST Property Inspection for testRunner, plugins, and checkers
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          const keyName = node.key.name;

          // testRunner: 'jest' -> @stryker-mutator/jest-runner
          if (keyName === "testRunner" && t.isStringLiteral(node.value)) {
            adapter.markPackageAsUsed(normalizeStrykerPlugin(node.value.value));
          }

          // plugins: ['@stryker-mutator/vitest-runner']
          if (keyName === "plugins" && t.isArrayExpression(node.value)) {
            for (const el of node.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(el.value);
              }
            }
          }

          // checkers: ['typescript'] -> @stryker-mutator/typescript-checker
          if (keyName === "checkers") {
            if (t.isStringLiteral(node.value)) {
              adapter.markPackageAsUsed(`@stryker-mutator/${node.value.value}-checker`);
            } else if (t.isArrayExpression(node.value)) {
              for (const el of node.value.elements) {
                if (t.isStringLiteral(el)) {
                  adapter.markPackageAsUsed(`@stryker-mutator/${el.value}-checker`);
                }
              }
            }
          }
        }
      }
    },
  },
};

export default StrykerPlugin;
