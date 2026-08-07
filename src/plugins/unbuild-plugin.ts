import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const UNBUILD_CONFIG_FILES = ["build.config.ts", "build.config.js"];

export const UnbuildPlugin: AnalyzerPlugin = {
  name: "unbuild-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["unbuild"])) {
      return true;
    }
    for (const file of UNBUILD_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasUnbuild = pkg ? !!(pkg.devDependencies?.["unbuild"]) : false;
      
      let hasConfigFile = false;
      for (const file of UNBUILD_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasUnbuild) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "unbuild configuration found but 'unbuild' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (UNBUILD_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const basename = path.basename(fileId);
      if (UNBUILD_CONFIG_FILES.includes(basename)) {
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
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === "entries") {
                const val = prop.value;
                if (t.isArrayExpression(val)) {
                  val.elements.forEach(el => {
                    if (t.isStringLiteral(el)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, el.value));
                    } else if (t.isObjectExpression(el)) {
                      el.properties.forEach(p => {
                        if (t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === "input" && t.isStringLiteral(p.value)) {
                          adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, p.value.value));
                        }
                      });
                    }
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

export default UnbuildPlugin;
