import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const C8_CONFIG_FILES = [
  ".c8rc",
  ".c8rc.json",
  "c8.config.js",
  "c8.config.cjs",
  "c8.config.mjs",
  "c8.config.ts",
];

const C8_PACKAGE_NAME = "c8";

/**
 * Extracts custom c8 reporter packages from a configuration object
 */
function extractReporterPackages(configObj: any, adapter: any): void {
  if (!configObj) return;

  const processReporters = (reporterVal: any) => {
    if (!reporterVal) return;

    const list = Array.isArray(reporterVal) ? reporterVal : [reporterVal];
    for (const item of list) {
      if (typeof item === "string" && !item.startsWith(".") && !item.startsWith("/")) {
        // Exclude standard built-in istanbul reporters
        const builtInReporters = new Set([
          "clover",
          "cobertura",
          "html",
          "json",
          "json-summary",
          "lcov",
          "lcovonly",
          "none",
          "teamcity",
          "text",
          "text-lcov",
          "text-summary",
        ]);

        if (!builtInReporters.has(item)) {
          adapter.markPackageAsUsed(item);
        }
      }
    }
  };

  // If node is an AST ObjectExpression
  if (t.isObjectExpression(configObj)) {
    for (const prop of configObj.properties) {
      if (t.isObjectProperty(prop)) {
        const keyName = prop.key?.name || prop.key?.value;
        if (keyName === "reporter") {
          if (t.isStringLiteral(prop.value)) {
            processReporters(prop.value.value);
          } else if (t.isArrayExpression(prop.value)) {
            for (const el of prop.value.elements) {
              if (t.isStringLiteral(el)) processReporters(el.value);
            }
          }
        }
      }
    }
  }
  // If config is a raw parsed JS object (e.g. from .c8rc.json)
  else if (typeof configObj === "object") {
    if (configObj.reporter) {
      processReporters(configObj.reporter);
    }
  }
}

export const C8Plugin: AnalyzerPlugin = {
  name: "c8-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    // 1. Check for c8 configuration files
    for (const configFile of C8_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline c8 config, dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.c8) return true;

      const hasDep =
        (pkg.dependencies && pkg.dependencies[C8_PACKAGE_NAME]) ||
        (pkg.devDependencies && pkg.devDependencies[C8_PACKAGE_NAME]) ||
        (pkg.peerDependencies && pkg.peerDependencies[C8_PACKAGE_NAME]);

      if (hasDep) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && /\bc8\b/.test(s))) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      let hasConfigFile = false;

      // 1. Protect c8 configuration files
      for (const configFile of C8_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // Parse JSON config files directly for custom reporters
      if (await adapter.folderExists(".c8rc")) {
        const c8Json = await adapter.readJson(".c8rc");
        if (c8Json) extractReporterPackages(c8Json, adapter);
      }
      if (await adapter.folderExists(".c8rc.json")) {
        const c8Json = await adapter.readJson(".c8rc.json");
        if (c8Json) extractReporterPackages(c8Json, adapter);
      }

      const isDep = pkg
        ? !!(
            (pkg.dependencies && pkg.dependencies[C8_PACKAGE_NAME]) ||
            (pkg.devDependencies && pkg.devDependencies[C8_PACKAGE_NAME]) ||
            (pkg.peerDependencies && pkg.peerDependencies[C8_PACKAGE_NAME])
          )
        : false;

      if (pkg) {
        // 2. Protect c8 dependency
        if (isDep) {
          adapter.markPackageAsUsed(C8_PACKAGE_NAME);
        }

        // 3. Protect package.json#c8 field & extract custom reporters
        if (pkg.c8) {
          hasConfigFile = true;
          adapter.markAsUsed("package.json", "c8");
          extractReporterPackages(pkg.c8, adapter);
        }

        // 4. Mark scripts invoking c8 CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (typeof scriptContent === "string" && /\bc8\b/.test(scriptContent)) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
              adapter.markPackageAsUsed(C8_PACKAGE_NAME);
            }
          }
        }
      }

      // 5. Emit missing-dependency finding if config exists without c8 package
      if (hasConfigFile && !isDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "c8 configuration found, but 'c8' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (C8_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed(C8_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = C8_CONFIG_FILES.includes(basename);

      if (!isConfigFile) return;

      // 1. Process ESM imports & CJS require in c8.config.js
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source && !source.startsWith(".") && !source.startsWith("/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      if (
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

      // 2. Export Default / CommonJS module.exports extraction
      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
        extractReporterPackages(node.declaration, adapter);
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
        extractReporterPackages(node.right, adapter);
      }
    },
  },
};

export default C8Plugin;
