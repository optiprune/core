import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const POSTCSS_FILES = ["postcss.config.js", "postcss.config.cjs", "postcss.config.mjs", ".postcssrc", ".postcssrc.json", ".postcssrc.yaml", ".postcssrc.yml", ".postcssrc.js"];

export const PostCSSPlugin: AnalyzerPlugin = {
  name: "postcss-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg?.devDependencies?.["postcss"] || pkg?.dependencies?.["postcss"]) {
      return true;
    }
    for (const file of POSTCSS_FILES) {
      if (await adapter.readFile(file) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasPostcssDep = pkg ? !!(pkg.dependencies?.["postcss"] || pkg.devDependencies?.["postcss"]) : false;
      
      let hasConfigFile = false;
      for (const file of POSTCSS_FILES) {
        if (await adapter.readFile(file) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasPostcssDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "PostCSS configuration found but 'postcss' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const fileName = path.basename(fileId);
      if (POSTCSS_FILES.some(pattern => fileName === pattern)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const fileName = path.basename(fileId);
      if (POSTCSS_FILES.some(pattern => fileName === pattern)) {
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

        // Detect plugins in postcss.config.js
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any).name || (node.key as any).value;
          if (keyName === "plugins") {
            if (node.value.type === "ArrayExpression") {
              node.value.elements.forEach((el: any) => {
                if (el.type === "CallExpression") {
                  if (el.callee.name === "require" && el.arguments[0]?.type === "Literal") {
                    adapter.markAsUsed(el.arguments[0].value);
                  }
                } else if (el.type === "Literal" && typeof el.value === "string") {
                  adapter.markAsUsed(el.value);
                }
              });
            } else if (node.value.type === "ObjectExpression") {
              node.value.properties.forEach((prop: any) => {
                const pluginName = (prop.key as any).name || (prop.key as any).value;
                if (pluginName) {
                  adapter.markAsUsed(pluginName);
                }
              });
            }
          }
        }
      }
    }
  }
};

export default PostCSSPlugin;
