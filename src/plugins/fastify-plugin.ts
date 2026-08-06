import { AnalyzerPlugin } from "../types.js";

export const FastifyPlugin: AnalyzerPlugin = {
  name: "fastify-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.dependencies?.["fastify"]);
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Schützt Fastify-Registrierungen und Routen
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
        const methods = ["register", "get", "post", "put", "delete", "route"];
        if (node.callee.property.type === "Identifier" && methods.includes(node.callee.property.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default FastifyPlugin;
