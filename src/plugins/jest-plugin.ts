import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const JEST_CONFIG_FILES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.cjs",
  "jest.config.mjs",
  "jest.config.json",
  "jest.setup.js",
  "jest.setup.ts"
];

export const JestPlugin: AnalyzerPlugin = {
  name: "jest-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg?.devDependencies?.["jest"] || pkg?.dependencies?.["jest"]) {
      return true;
    }
    for (const file of JEST_CONFIG_FILES) {
      if (await adapter.readFile(file) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasJestDep = pkg ? !!(pkg.dependencies?.["jest"] || pkg.devDependencies?.["jest"]) : false;
      
      let hasConfigFile = false;
      for (const file of JEST_CONFIG_FILES) {
        if (await adapter.readFile(file) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasJestDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Jest configuration found but 'jest' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const fileName = path.basename(fileId);
      if (JEST_CONFIG_FILES.some(pattern => fileName === pattern)) {
        adapter.markAsUsed(fileId);
      }
      
      // Mark test files as used
      if (
        fileId.includes(".test.") || 
        fileId.includes(".spec.") || 
        fileId.includes("__tests__/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const fileName = path.basename(fileId);
      
      // In Jest config files
      if (JEST_CONFIG_FILES.some(pattern => fileName === pattern)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
        if (
          node.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left.object?.name === "module" &&
          node.left.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // Detect setupFiles, setupFilesAfterEnv, and transform
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any).name || (node.key as any).value;
          if (["setupFiles", "setupFilesAfterEnv", "preset"].includes(keyName)) {
            if (node.value.type === "ArrayExpression") {
              node.value.elements.forEach((el: any) => {
                if (el.type === "Literal" && typeof el.value === "string") {
                  adapter.markAsUsed(el.value);
                }
              });
            } else if (node.value.type === "Literal" && typeof node.value.value === "string") {
              adapter.markAsUsed(node.value.value);
            }
          }
          
          if (keyName === "transform" && node.value.type === "ObjectExpression") {
            node.value.properties.forEach((prop: any) => {
              if (prop.value.type === "Literal" && typeof prop.value.value === "string") {
                adapter.markAsUsed(prop.value.value);
              } else if (prop.value.type === "ArrayExpression" && prop.value.elements[0]?.type === "Literal") {
                adapter.markAsUsed(prop.value.elements[0].value);
              }
            });
          }
        }
      }
      
      // In test files, mark globals as used (describe, it, test, expect)
      if (
        fileId.includes(".test.") || 
        fileId.includes(".spec.") || 
        fileId.includes("__tests__/")
      ) {
        if (node.type === "CallExpression" && node.callee.type === "Identifier") {
          const globals = ["describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "jest"];
          if (globals.includes(node.callee.name)) {
            adapter.markAsUsed("jest");
          }
        }
      }
    }
  }
};

export default JestPlugin;
