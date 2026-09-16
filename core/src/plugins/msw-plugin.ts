import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const MswPlugin: AnalyzerPlugin = {
  name: "msw-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["msw"] || pkg?.dependencies?.["msw"]);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Common entry points and file conventions for MSW setup
      if (
        fileId.includes("handlers") ||
        fileId.includes("mocks/") ||
        fileId.includes("msw/") ||
        fileId.includes("browser.") ||
        fileId.includes("server.")
      ) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // 1. Detect http/rest/graphql request handlers (e.g. http.get, rest.post, graphql.query)
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const objName = (node.callee.object as any)?.name;
        if (["rest", "http", "graphql", "ws"].includes(objName)) {
          // Mark second argument if it's an identifier (named resolver function)
          const handler = node.arguments[1];
          if (t.isIdentifier(handler)) {
            adapter.markAsUsed(fileId, handler.name);
          }
        }
      }

      // 2. Detect setupServer / setupWorker calls
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (["setupServer", "setupWorker"].includes(node.callee.name)) {
          // Mark arguments passed into setupServer/setupWorker as used
          node.arguments.forEach((arg) => {
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            } else if (t.isSpreadElement(arg) && t.isIdentifier(arg.argument)) {
              adapter.markAsUsed(fileId, arg.argument.name);
            }
          });
        }
      }
    },
  },
};

export default MswPlugin;
