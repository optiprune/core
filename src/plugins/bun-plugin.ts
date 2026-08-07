import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const BUN_CONFIG_FILES = ["bunfig.toml", "bun.lockb"];

export const BunPlugin: AnalyzerPlugin = {
  name: "bun-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.dependencies?.["bun-types"] || pkg.devDependencies?.["bun-types"])) {
      return true;
    }
    for (const file of BUN_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (BUN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      // Bun entry points are often defined in package.json scripts or bunfig.toml
      // For now, mark conventional files
      if (basename === "index.ts" || basename === "main.ts" || basename === "server.ts") {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect Bun global usage
      if (t.isIdentifier(node) && node.name === "Bun") {
        adapter.markAsUsed(fileId);
      }
      
      // Detect Bun.serve, Bun.file, Bun.password, etc.
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        if (t.isIdentifier(obj) && obj.name === "Bun") {
          adapter.markAsUsed(fileId);
        }
      }

      // Detect imports from "bun"
      if (t.isImportDeclaration(node) && node.source.value === "bun") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default BunPlugin;
