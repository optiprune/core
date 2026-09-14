import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Bumpp configuration files
 */
const BUMPP_CONFIG_FILES = [
  "bumpp.config.ts",
  "bumpp.config.js",
  "bumpp.config.mjs",
  "bumpp.config.cjs",
];

const BUMPP_PACKAGE_NAME = "bumpp";

/**
 * Extracts and processes the `execute` command string from bumpp config objects
 */
function processBumppConfigObject(configObj: any, adapter: any): void {
  if (!configObj) return;

  const extractExecute = (execVal: any) => {
    if (typeof execVal === "string") {
      const tokens = execVal.split(/\s+/);
      for (const token of tokens) {
        const clean = token.replace(/^["']|["']$/g, "");
        if (!clean.startsWith("-") && /\.[jt]sx?$/.test(clean)) {
          adapter.markAsUsed(clean);
        }
      }
    }
  };

  if (t.isObjectExpression(configObj)) {
    for (const prop of configObj.properties) {
      if (t.isObjectProperty(prop)) {
        const keyName = prop.key?.name || prop.key?.value;
        if (keyName === "execute") {
          if (t.isStringLiteral(prop.value)) {
            extractExecute(prop.value.value);
          }
        }
      }
    }
  } else if (typeof configObj === "object" && configObj.execute) {
    extractExecute(configObj.execute);
  }
}

export const BumppPlugin: AnalyzerPlugin = {
  name: "bumpp-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Bumpp configuration files
    for (const configFile of BUMPP_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, bumpp dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.bumpp) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (BUMPP_PACKAGE_NAME in allDeps) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bbumpp\b/.test(s) || s.includes("bumpp ")),
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
      let hasConfigFile = false;

      // 1. Protect dedicated configuration files
      for (const configFile of BUMPP_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      const allDeps = pkg
        ? {
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
          }
        : {};

      const isDep = BUMPP_PACKAGE_NAME in allDeps;

      if (pkg) {
        // 2. Protect bumpp package in package.json
        if (isDep) {
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
        }

        // 3. Process inline package.json#bumpp block
        if (pkg.bumpp) {
          hasConfigFile = true;
          adapter.markAsUsed("package.json", "bumpp");
          processBumppConfigObject(pkg.bumpp, adapter);
        }

        // 4. Mark scripts executing bumpp CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bbumpp\b/.test(scriptContent) || scriptContent.includes("bumpp "))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
              adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
            }
          }
        }
      }

      // 5. Emit missing dependency finding if config exists without bumpp package
      if (hasConfigFile && !isDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Bumpp configuration found, but 'bumpp' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (BUMPP_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = BUMPP_CONFIG_FILES.includes(basename);

      // 1. Inspect JS/TS config files (bumpp.config.ts, etc.)
      if (isConfigFile) {
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

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
          if (t.isCallExpression(node.declaration) && node.declaration.arguments[0]) {
            processBumppConfigObject(node.declaration.arguments[0], adapter);
          } else if (t.isObjectExpression(node.declaration)) {
            processBumppConfigObject(node.declaration, adapter);
          }
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
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
          processBumppConfigObject(node.right, adapter);
        }
      }

      // 2. Retain imports from bumpp across any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === BUMPP_PACKAGE_NAME || source.startsWith("bumpp/")) {
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default BumppPlugin;
