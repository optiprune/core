import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const R_CONFIG_FILES = [
  "rsbuild.config.ts", "rsbuild.config.js",
  "rslib.config.ts", "rslib.config.js",
  "rolldown.config.ts", "rolldown.config.js"
];

export const RToolsPlugin: AnalyzerPlugin = {
  name: "r-tools-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasDep = !!(deps["@rsbuild/core"] || deps["@rslib/core"] || deps["rolldown"]);
    if (hasDep) return true;
    for (const file of R_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (R_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (["defineConfig", "defineRsbuildConfig", "defineRslibConfig"].includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default RToolsPlugin;
