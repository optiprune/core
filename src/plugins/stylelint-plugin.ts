import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const STYLELINT_FILES = [
  ".stylelintrc",
  ".stylelintrc.json",
  ".stylelintrc.yaml",
  ".stylelintrc.yml",
  ".stylelintrc.js",
  ".stylelintrc.cjs",
  ".stylelintrc.mjs",
  "stylelint.config.js",
  "stylelint.config.cjs",
  "stylelint.config.mjs",
  ".stylelintignore"
];

export const StylelintPlugin: AnalyzerPlugin = {
  name: "stylelint-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg?.devDependencies?.["stylelint"] || pkg?.dependencies?.["stylelint"]) {
      return true;
    }
    for (const file of STYLELINT_FILES) {
      if (await adapter.readFile(file) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasStylelintDep = pkg ? !!(pkg.dependencies?.["stylelint"] || pkg.devDependencies?.["stylelint"]) : false;
      
      let hasConfigFile = false;
      for (const file of STYLELINT_FILES) {
        if (await adapter.readFile(file) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasStylelintDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Stylelint configuration found but 'stylelint' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const fileName = path.basename(fileId);
      if (STYLELINT_FILES.some(pattern => fileName === pattern)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const fileName = path.basename(fileId);
      if (STYLELINT_FILES.some(pattern => fileName === pattern)) {
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

        // Detect extends, plugins, and customSyntax in JS-based configs
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any).name || (node.key as any).value;
          if (["extends", "plugins", "customSyntax"].includes(keyName)) {
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
        }
      }
    }
  }
};

export default StylelintPlugin;
