import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const MOCHA_CONFIG_FILES = [
  ".mocharc.json",
  ".mocharc.jsonc",
  ".mocharc.javascript",
  ".mocharc.js",
  ".mocharc.cjs",
  ".mocharc.mjs",
  ".mocharc.yaml",
  ".mocharc.yml",
];

const MOCHA_ECOSYSTEM_PACKAGES = [
  "mocha",
  "chai",
  "sinon",
  "sinon-chai",
  "chai-as-promised",
  "supertest",
];

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

export const MochaPlugin: AnalyzerPlugin = {
  name: "mocha-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if ("mocha" in allDeps || pkg.mocha) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some((s) => typeof s === "string" && (s.includes("mocha") || s === "mocha"))
        ) {
          return true;
        }
      }
    }

    for (const configFile of MOCHA_CONFIG_FILES) {
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

      const hasMochaDep = "mocha" in allDeps;

      // 1. Protect core Mocha package if present
      if (hasMochaDep) {
        adapter.markPackageAsUsed("mocha");
      }

      // 2. Protect standalone config files and package.json mocha config block
      let hasConfigFile = false;
      for (const configFile of MOCHA_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg?.mocha) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "mocha");

        if (Array.isArray(pkg.mocha.require)) {
          pkg.mocha.require.forEach((reqPkg: string) => {
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
      }

      // Read .mocharc.json directly if present
      if (await adapter.folderExists(".mocharc.json")) {
        const mochaJson = await adapter.readJson(".mocharc.json");
        if (mochaJson?.require) {
          const reqs = Array.isArray(mochaJson.require) ? mochaJson.require : [mochaJson.require];
          reqs.forEach((reqPkg: string) => {
            if (typeof reqPkg === "string") {
              const pkgName = extractPackageName(reqPkg);
              if (pkgName) adapter.markPackageAsUsed(pkgName);
            }
          });
        }
      }

      // 3. Track npm scripts invoking Mocha
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("mocha") || scriptContent === "mocha")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("mocha");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without mocha package
      if (hasConfigFile && !hasMochaDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Mocha configuration found, but 'mocha' is not listed in package.json.",
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
      if (MOCHA_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("mocha");
      }

      // Protect test files in test/ or matching *.test.* / *.spec.*
      if (
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("mocha");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const root = adapter.getConfig().rootDir;
      const absolute = path.isAbsolute(fileId) ? fileId : path.resolve(root, fileId);
      const normalized = path.relative(root, absolute).replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = MOCHA_CONFIG_FILES.includes(basename);
      const isTestFile =
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/");

      // 1. Detect ESM imports for Mocha ecosystem packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        const pkgName = extractPackageName(source);
        if (
          pkgName &&
          (MOCHA_ECOSYSTEM_PACKAGES.includes(pkgName) ||
            pkgName.startsWith("chai-") ||
            pkgName.startsWith("sinon-"))
        ) {
          adapter.markPackageAsUsed(pkgName);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require(...) calls for Mocha ecosystem packages
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const pkgName = extractPackageName(arg.value);
          if (
            pkgName &&
            (MOCHA_ECOSYSTEM_PACKAGES.includes(pkgName) ||
              pkgName.startsWith("chai-") ||
              pkgName.startsWith("sinon-"))
          ) {
            adapter.markPackageAsUsed(pkgName);
            adapter.markAsUsed(fileId);
          }
        }
      }

      // 3. In JS/TS configuration files (.mocharc.js / .mocharc.cjs)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("mocha");
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
          adapter.markPackageAsUsed("mocha");
        }

        // Detect require: ['ts-node/register', '@babel/register']
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "require") {
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
          } else {
            processReq(node.value);
          }
        }
      }

      // 4. In Test files: Detect Mocha global hooks
      if (isTestFile) {
        if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
          const mochaGlobals = new Set([
            "describe",
            "context",
            "it",
            "specify",
            "before",
            "after",
            "beforeEach",
            "afterEach",
          ]);

          if (mochaGlobals.has(node.callee.name)) {
            adapter.markPackageAsUsed("mocha");
          }
        }
      }
    },
  },
};

export default MochaPlugin;
