import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TSDOWN_CONFIG_FILES = ["tsdown.config.ts", "tsdown.config.js"];

export const TsdownPlugin: AnalyzerPlugin = {
  name: "tsdown-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["tsdown"])) {
      return true;
    }
    for (const file of TSDOWN_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasTsdown = pkg ? !!(pkg.devDependencies?.["tsdown"]) : false;
      
      let hasConfigFile = false;
      for (const file of TSDOWN_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasTsdown) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "tsdown configuration found but 'tsdown' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (TSDOWN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const basename = path.basename(fileId);
      if (TSDOWN_CONFIG_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          
          let configObj = null;
          if (t.isObjectExpression(node.declaration)) {
            configObj = node.declaration;
          } else if (t.isCallExpression(node.declaration) && node.declaration.arguments.length > 0 && t.isObjectExpression(node.declaration.arguments[0])) {
            configObj = node.declaration.arguments[0];
          }

          if (configObj) {
            configObj.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === "entry") {
                const val = prop.value;
                if (t.isStringLiteral(val)) {
                  adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, val.value));
                } else if (t.isArrayExpression(val)) {
                  val.elements.forEach(el => {
                    if (t.isStringLiteral(el)) adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, el.value));
                  });
                }
              }
            });
          }
        }
      }
    }
  }
};

export default TsdownPlugin;
