import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const MARKO_CONFIG_FILES = ["marko.json", "marko-taglib.json", "marko-tag.json"];

export const MarkoPlugin: AnalyzerPlugin = {
  name: "marko-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg?.dependencies?.["marko"] || pkg?.devDependencies?.["marko"]) {
      return true;
    }
    for (const file of MARKO_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasMarkoDep = pkg ? !!(pkg.dependencies?.["marko"] || pkg.devDependencies?.["marko"]) : false;

      let hasConfigFile = false;
      for (const file of MARKO_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasMarkoDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Marko configuration found but 'marko' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const fileName = path.basename(fileId);
      // Mark .marko files as used (they are entry points or components)
      if (fileId.endsWith(".marko")) {
        adapter.markAsUsed(fileId);
      }
      // Mark Marko config files as used
      if (MARKO_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
      // Convention: Files in components/ are usually used
      if (fileId.includes("/components/")) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Marko templates are often compiled to JS, but if we encounter Marko specific AST
      // (This depends on the parser, assuming standard JS AST if it's already parsed)
      
      // Detect Marko taglib imports in marko.json
      if (fileId.endsWith("marko.json") && node.type === "Property") {
        const keyName = node.key.name || node.key.value;
        if (keyName === "tags" || keyName === "taglib-imports") {
          if (node.value.type === "ArrayExpression") {
            node.value.elements.forEach((el: any) => {
              if (el.type === "Literal" && typeof el.value === "string") {
                adapter.markAsUsed(el.value);
              }
            });
          } else if (node.value.type === "ObjectExpression") {
            node.value.properties.forEach((prop: any) => {
              const val = prop.value;
              if (val.type === "Literal" && typeof val.value === "string") {
                adapter.markAsUsed(val.value);
              }
            });
          }
        }
      }
    }
  }
};

export default MarkoPlugin;
