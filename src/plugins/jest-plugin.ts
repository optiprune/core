import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const JEST_CONFIG_FILES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.cjs",
  "jest.config.mjs",
  "jest.config.json",
  "jest.setup.js",
  "jest.setup.ts",
  "jest.setup.cjs",
  "jest.setup.mjs"
];

const JEST_PACKAGES = [
  "jest",
  "@nx/jest",
  "ts-jest",
  "@swc/jest",
  "babel-jest",
  "jest-environment-jsdom",
  "jest-environment-node",
  "jest-extended"
];

export const JestPlugin: AnalyzerPlugin = {
  name: "jest-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (JEST_PACKAGES.some((pkgName) => pkgName in allDeps) || pkg.jest) {
        return true;
      }
    }

    for (const configFile of JEST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("__tests__");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasJestDep = JEST_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of JEST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      if (pkg?.jest) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "jest");
      }

      // Safeguard installed Jest ecosystem packages in package.json
      if (hasJestDep) {
        for (const jestPkg of JEST_PACKAGES) {
          if (allDeps[jestPkg]) {
            adapter.markPackageAsUsed(jestPkg);
          }
        }
      }

      // Track npm scripts invoking Jest
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("jest ") || scriptContent === "jest")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("jest");
          }
        }
      }

      if (hasConfigFile && !hasJestDep) {
        if (await adapter.folderExists("nx.json")) {
          adapter.markPackageAsUsed("@nx/jest");
        } else {
          adapter.markPackageAsUsed("jest");
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Mark configuration and setup files
      if (JEST_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("jest");
      }

      // 2. Mark test files and Jest manual mocks as used entry points
      if (
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/__tests__/") ||
        normalized.includes("/__mocks__/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("jest");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = JEST_CONFIG_FILES.includes(basename);
      const isTestFile =
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/__tests__/");

      // 1. In Jest config files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("jest");
        }

        // Handle module.exports = { ... }
        if (
          node.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          (node.left as any).object?.name === "module" &&
          (node.left as any).property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // Detect setupFiles, setupFilesAfterEnv, preset, transform, and testEnvironment
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any)?.name || (node.key as any)?.value;

          if (["setupFiles", "setupFilesAfterEnv", "preset", "testEnvironment"].includes(keyName)) {
            if ((node as any).value?.type === "ArrayExpression") {
              (node as any).value.elements.forEach((el: any) => {
                if (el?.type === "Literal" && typeof el.value === "string") {
                  adapter.markAsUsed(el.value);
                  if (!el.value.startsWith(".") && !el.value.startsWith("/")) {
                    adapter.markPackageAsUsed(el.value);
                  }
                }
              });
            } else if ((node as any).value?.type === "Literal" && typeof (node as any).value.value === "string") {
              const val = (node as any).value.value;
              adapter.markAsUsed(val);
              if (!val.startsWith(".") && !val.startsWith("/")) {
                adapter.markPackageAsUsed(val);
              }
            }
          }

          if (keyName === "transform" && (node as any).value?.type === "ObjectExpression") {
            (node as any).value.properties.forEach((prop: any) => {
              const propVal = prop?.value;
              if (propVal?.type === "Literal" && typeof propVal.value === "string") {
                adapter.markPackageAsUsed(propVal.value);
              } else if (
                propVal?.type === "ArrayExpression" &&
                propVal.elements[0]?.type === "Literal" &&
                typeof propVal.elements[0].value === "string"
              ) {
                adapter.markPackageAsUsed(propVal.elements[0].value);
              }
            });
          }
        }
      }

      // 2. In test files, mark Jest global usage
      if (isTestFile) {
        if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
          const jestGlobals = new Set([
            "describe",
            "it",
            "test",
            "expect",
            "beforeEach",
            "afterEach",
            "beforeAll",
            "afterAll",
            "jest"
          ]);

          if (jestGlobals.has(node.callee.name)) {
            adapter.markPackageAsUsed("jest");
          }
        }
      }
    }
  }
};

export default JestPlugin;