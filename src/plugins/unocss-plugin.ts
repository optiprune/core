import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const UNOCSS_CONFIG_FILES = ["uno.config.ts", "uno.config.js", "unocss.config.ts", "unocss.config.js"];

export const UnocssPlugin: AnalyzerPlugin = {
  name: "unocss-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["unocss"] || pkg.dependencies?.["unocss"])) {
      return true;
    }
    for (const file of UNOCSS_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasUno = pkg ? !!(pkg.dependencies?.["unocss"] || pkg.devDependencies?.["unocss"]) : false;
      
      let hasConfigFile = false;
      for (const file of UNOCSS_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasUno) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "UnoCSS configuration found but 'unocss' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (UNOCSS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Handle uno.config.ts exports
      const basename = path.basename(fileId);
      if (UNOCSS_CONFIG_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
      }
      
      // Detect UnoCSS shortcuts or themes in config
      if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
        if (["shortcuts", "theme", "rules", "presets"].includes(node.key.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default UnocssPlugin;
