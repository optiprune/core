import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TSUP_CONFIG_FILES = ["tsup.config.ts", "tsup.config.js", "tsup.config.json", "tsup.config.mjs"];

export const TsupPlugin: AnalyzerPlugin = {
  name: "tsup-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["tsup"] || pkg.tsup)) {
      return true;
    }
    for (const file of TSUP_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasTsup = pkg ? !!(pkg.devDependencies?.["tsup"]) : false;
      
      let hasConfigFile = false;
      for (const file of TSUP_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }
      if (pkg?.tsup) hasConfigFile = true;

      if (hasConfigFile && !hasTsup) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "tsup configuration found but 'tsup' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (TSUP_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const basename = path.basename(fileId);
      if (TSUP_CONFIG_FILES.includes(basename)) {
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
                } else if (t.isObjectExpression(val)) {
                  val.properties.forEach(p => {
                    if (t.isObjectProperty(p) && t.isStringLiteral(p.value)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, p.value.value));
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

export default TsupPlugin;
