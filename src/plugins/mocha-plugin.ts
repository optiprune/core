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
  ".mocharc.yml"
];

const MOCHA_ECOSYSTEM_PACKAGES = [
  "mocha",
  "chai",
  "sinon",
  "sinon-chai",
  "chai-as-promised",
  "supertest",
  "ts-node",
  "tsx"
];

export const MochaPlugin: AnalyzerPlugin = {
  name: "mocha-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (MOCHA_ECOSYSTEM_PACKAGES.some((pkgName) => pkgName in allDeps) || pkg.mocha) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("mocha") || s === "mocha")
          )
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
        ...pkg?.peerDependencies
      };

      const hasMochaDep = MOCHA_ECOSYSTEM_PACKAGES.some((p) => p in allDeps);

      // 1. Protect installed Mocha ecosystem packages in package.json
      if (hasMochaDep) {
        for (const mochaPkg of MOCHA_ECOSYSTEM_PACKAGES) {
          if (allDeps[mochaPkg]) {
            adapter.markPackageAsUsed(mochaPkg);
          }
        }
      }

      // 2. Protect standalone config files or package.json mocha block
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

        // Protect require modules defined in package.json mocha block
        if (Array.isArray(pkg.mocha.require)) {
          pkg.mocha.require.forEach((reqPkg: string) => {
            if (typeof reqPkg === "string") {
              if (reqPkg.startsWith(".") || reqPkg.startsWith("/")) {
                adapter.markAsUsed(reqPkg);
              } else {
                adapter.markPackageAsUsed(reqPkg);
              }
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
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
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
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = MOCHA_CONFIG_FILES.includes(basename);
      const isTestFile =
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/");

      // 1. Detect ESM imports for Mocha, Chai, Sinon, Supertest
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          MOCHA_ECOSYSTEM_PACKAGES.includes(source) ||
          source.startsWith("chai-") ||
          source.startsWith("sinon-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Mocha configuration files (.mocharc.js / .mocharc.cjs)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("mocha");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("mocha");
        }

        // Detect require: ['ts-node/register', 'chai/register-expect']
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "require") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                const reqVal = el.value;
                if (reqVal.startsWith(".") || reqVal.startsWith("/")) {
                  adapter.markAsUsed(reqVal);
                } else {
                  const pkgName = reqVal.split("/")[0];
                  if (pkgName) adapter.markPackageAsUsed(pkgName);
                }
              }
            });
          } else if (t.isStringLiteral(node.value)) {
            const reqVal = node.value.value;
            if (reqVal.startsWith(".") || reqVal.startsWith("/")) {
              adapter.markAsUsed(reqVal);
            } else {
              const pkgName = reqVal.split("/")[0];
              if (pkgName) adapter.markPackageAsUsed(pkgName);
            }
          }
        }
      }

      // 3. In Test files: Detect Mocha global hooks and assertions
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
            "afterEach"
          ]);

          if (mochaGlobals.has(node.callee.name)) {
            adapter.markPackageAsUsed("mocha");
          }
        }
      }
    }
  }
};

export default MochaPlugin;