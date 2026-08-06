import { AnalyzerPlugin } from "../types.js";

export const HonoPlugin: AnalyzerPlugin = {
  name: "hono-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.dependencies?.["hono"]);
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Schützt Routen-Definitionen wie app.get(), app.post() etc.
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
        const methods = ["get", "post", "put", "delete", "patch", "all", "use", "route"];
        if (node.callee.property.type === "Identifier" && methods.includes(node.callee.property.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default HonoPlugin;
