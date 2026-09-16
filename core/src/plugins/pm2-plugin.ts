import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized PM2 configuration files
 */
const PM2_CONFIG_FILES = [
  "ecosystem.config.js",
  "ecosystem.config.cjs",
  "ecosystem.config.mjs",
  "ecosystem.config.json",
  "ecosystem.config.yaml",
  "ecosystem.config.yml",
  "pm2.config.js",
  "pm2.config.cjs",
  "pm2.config.mjs",
  "pm2.config.json",
];

const PM2_PACKAGES = ["pm2", "pm2-io", "@pm2/io"];

/**
 * Helper to process PM2 ecosystem config objects and mark script targets as used
 */
function processPm2Ecosystem(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  const apps = config.apps || (Array.isArray(config) ? config : null);
  if (Array.isArray(apps)) {
    for (const app of apps) {
      if (app && typeof app === "object" && typeof app.script === "string") {
        adapter.markAsUsed(app.script);
      }
    }
  }
}

export const Pm2Plugin: AnalyzerPlugin = {
  name: "pm2-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated PM2 ecosystem config files
    for (const configFile of PM2_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for pm2 dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => PM2_PACKAGES.includes(dep))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bpm2\b/.test(s) || s.includes("pm2 start")),
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

      // 1. Protect dedicated PM2 ecosystem files
      for (const configFile of PM2_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect pm2 and @pm2/io packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (PM2_PACKAGES.includes(depName)) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Mark npm scripts calling PM2 as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bpm2\b/.test(scriptContent) || scriptContent.includes("pm2 start"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 4. Parse standalone JSON ecosystem config if present
      const jsonConfigFile = (await adapter.folderExists("ecosystem.config.json"))
        ? "ecosystem.config.json"
        : (await adapter.folderExists("pm2.config.json"))
          ? "pm2.config.json"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processPm2Ecosystem(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect PM2 configuration files
      if (PM2_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("pm2");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect ecosystem.config.js / pm2.config.js AST for module.exports / export default
      if (PM2_CONFIG_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("pm2");
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
          adapter.markPackageAsUsed("pm2");
        }

        // Inspect AST for "script" string literals in app definitions (e.g., script: "./dist/index.js")
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "script" &&
          t.isStringLiteral(node.value)
        ) {
          adapter.markAsUsed(node.value.value);
        }
      }

      // 2. Retain imports from pm2 or @pm2/io
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (PM2_PACKAGES.includes(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default Pm2Plugin;
