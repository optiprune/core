import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PANDA_CONFIG_FILES = ["panda.config.ts", "panda.config.js", "panda.config.mjs", "panda.config.cjs"];

export const PandaCssPlugin: AnalyzerPlugin = {
  name: "panda-css-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["@pandacss/dev"] || pkg.dependencies?.["@pandacss/dev"])) {
      return true;
    }
    for (const file of PANDA_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasPanda = pkg ? !!(pkg.dependencies?.["@pandacss/dev"] || pkg.devDependencies?.["@pandacss/dev"]) : false;
      
      let hasConfigFile = false;
      for (const file of PANDA_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasPanda) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Panda CSS configuration found but '@pandacss/dev' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (PANDA_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect Panda CSS API usage: css(), stack(), vstack(), hstack(), box(), etc.
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const pandaAPIs = ["css", "stack", "vstack", "hstack", "box", "flex", "grid", "container", "circle", "square"];
        if (pandaAPIs.includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect imports from styled-system (default Panda output directory)
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.includes("styled-system")) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default PandaCssPlugin;
