import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const AVA_CONFIG_FILES = ["ava.config.js", "ava.config.cjs", "ava.config.mjs", "ava.config.ts"];

const AVA_ECOSYSTEM_PACKAGES = ["ava", "@ava/typescript", "@ava/babel"];

/**
 * Normalizes package names from import/require specs (handles scoped packages)
 */
function extractPackageName(specifier: string): string | null {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] || null;
}

export const AvaPlugin: AnalyzerPlugin = {
  name: "ava-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      if ("ava" in allDeps || pkg.ava) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && (s.includes("ava") || s === "ava"))) {
          return true;
        }
      }
    }

    for (const configFile of AVA_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("test");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasAvaDep = "ava" in allDeps;

      // 1. Protect core ava package if installed
      if (hasAvaDep) {
        adapter.markPackageAsUsed("ava");
      }

      // 2. Protect standalone config files or package.json ava block
      let hasConfigFile = false;
      for (const configFile of AVA_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg?.ava) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "ava");

        // Protect require modules defined in package.json ava block
        if (Array.isArray(pkg.ava.require)) {
          pkg.ava.require.forEach((reqPkg: string) => {
            if (typeof reqPkg === "string") {
              const pkgName = extractPackageName(reqPkg);
              if (pkgName) {
                adapter.markPackageAsUsed(pkgName);
              } else {
                adapter.markAsUsed(reqPkg);
              }
            }
          });
        }

        // Protect @ava/typescript if typescript key exists in package.json ava block
        if (pkg.ava.typescript && "@ava/typescript" in allDeps) {
          adapter.markPackageAsUsed("@ava/typescript");
        }
      }

      // 3. Track npm scripts invoking Ava
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("ava") || scriptContent === "ava")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("ava");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without ava package
      if (hasConfigFile && !hasAvaDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Ava configuration found, but 'ava' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const root = adapter.getConfig().rootDir;
      const absolute = path.isAbsolute(fileId) ? fileId : path.resolve(root, fileId);
      const normalized = path.relative(root, absolute).replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (AVA_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("ava");
      }

      // Protect test files in test/ or matching *.test.* / *.spec.*
      if (
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("ava");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const root = adapter.getConfig().rootDir;
      const absolute = path.isAbsolute(fileId) ? fileId : path.resolve(root, fileId);
      const normalized = path.relative(root, absolute).replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = AVA_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for Ava and extensions (import test from 'ava')
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        const pkgName = extractPackageName(source);
        if (pkgName && (pkgName === "ava" || pkgName.startsWith("@ava/"))) {
          adapter.markPackageAsUsed(pkgName);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require(...) calls for Ava
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const pkgName = extractPackageName(arg.value);
          if (pkgName && (pkgName === "ava" || pkgName.startsWith("@ava/"))) {
            adapter.markPackageAsUsed(pkgName);
            adapter.markAsUsed(fileId);
          }
        }
      }

      // 3. In Ava configuration files (ava.config.js / ava.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("ava");
        }

        // CJS module.exports = { ... }
        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("ava");
        }

        // Detect require: ['ts-node/register'] or typescript config block
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          const keyName = node.key.name;

          if (keyName === "require") {
            const processReq = (el: any) => {
              if (t.isStringLiteral(el)) {
                const reqVal = el.value;
                const pkgName = extractPackageName(reqVal);
                if (pkgName) {
                  adapter.markPackageAsUsed(pkgName);
                } else {
                  adapter.markAsUsed(reqVal);
                }
              }
            };

            if (t.isArrayExpression(node.value)) {
              node.value.elements.forEach(processReq);
            } else if (t.isStringLiteral(node.value)) {
              processReq(node.value);
            }
          }

          if (keyName === "typescript") {
            adapter.markPackageAsUsed("@ava/typescript");
          }
        }
      }
    },
  },
};

export default AvaPlugin;
