import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Capacitor configuration files
 */
const CAPACITOR_CONFIG_FILES = [
  "capacitor.config.json",
  "capacitor.config.ts",
  "capacitor.config.js",
  "capacitor.config.cjs",
  "capacitor.config.mjs"
];

const CAPACITOR_CORE_PACKAGES = [
  "@capacitor/core",
  "@capacitor/cli",
  "@capacitor/ios",
  "@capacitor/android"
];

/**
 * Helper to process capacitor.config properties
 */
function processCapacitorConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Protect web build output directory (e.g. webDir: "dist" or "build" or "www")
  if (typeof config.webDir === "string" && !config.webDir.includes("*")) {
    adapter.markAsUsed(config.webDir);
  }

  // Protect custom plugin configurations if defined inside config.plugins
  if (config.plugins && typeof config.plugins === "object") {
    for (const pluginKey of Object.keys(config.plugins)) {
      // Common mapping: Camera -> @capacitor/camera
      const possiblePkg = `@capacitor/${pluginKey.toLowerCase()}`;
      adapter.markPackageAsUsed(possiblePkg);
    }
  }
}

export const CapacitorPlugin: AnalyzerPlugin = {
  name: "capacitor-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Capacitor config files
    for (const configFile of CAPACITOR_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check for Capacitor native directories
    if (
      (await adapter.folderExists("android")) ||
      (await adapter.folderExists("ios"))
    ) {
      // Verify if package.json has @capacitor/core to avoid false positives on non-Capacitor native apps
      const pkg = await adapter.readJson("package.json");
      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };
        if ("@capacitor/core" in allDeps || "@capacitor/cli" in allDeps) {
          return true;
        }
      }
    }

    // 3. Check package.json for @capacitor/* dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep.startsWith("@capacitor/") || dep.startsWith("capacitor-")
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
              (/\bcap\b/.test(s) || /\bcapacitor\b/.test(s) || s.includes("npx cap"))
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

      // 1. Protect dedicated Capacitor configuration files
      for (const configFile of CAPACITOR_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect Capacitor native platform folders if present
      if (await adapter.folderExists("android")) {
        adapter.markAsUsed("android");
      }
      if (await adapter.folderExists("ios")) {
        adapter.markAsUsed("ios");
      }

      if (pkg) {
        // 3. Protect all @capacitor/* and capacitor-* packages in package.json dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@capacitor/") || depName.startsWith("capacitor-")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Mark scripts executing capacitor CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bcap\b/.test(scriptContent) ||
                /\bcapacitor\b/.test(scriptContent) ||
                scriptContent.includes("npx cap"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse capacitor.config.json if present
      if (await adapter.folderExists("capacitor.config.json")) {
        const configData = await adapter.readJson("capacitor.config.json");
        if (configData) {
          processCapacitorConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (CAPACITOR_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Protect native Android & iOS files
      if (
        normalized.includes("/android/") ||
        normalized.startsWith("android/") ||
        normalized.includes("/ios/") ||
        normalized.startsWith("ios/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (capacitor.config.ts, capacitor.config.js, etc.)
      if (
        basename.startsWith("capacitor.config.") &&
        (basename.endsWith(".ts") ||
          basename.endsWith(".js") ||
          basename.endsWith(".cjs") ||
          basename.endsWith(".mjs"))
      ) {
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

        // AST Property Inspection for "webDir"
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "webDir" &&
          t.isStringLiteral(node.value)
        ) {
          adapter.markAsUsed(node.value.value);
        }
      }

      // Retain imports from @capacitor/* in application code
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@capacitor/") || source.startsWith("capacitor-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default CapacitorPlugin;