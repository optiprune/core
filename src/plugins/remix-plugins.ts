import { AnalyzerPlugin } from "../types.js";

const REMIX_ROUTE_REGEX = /\/app\/(routes\/|root\.[jt]sx?$)/;
const REMIX_EXPORTS = new Set([
  "loader",
  "action",
  "meta",
  "headers",
  "links",
  "handle",
  "ErrorBoundary",
  "default",
]);

export const RemixPlugin: AnalyzerPlugin = {
  name: "remix-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    return "@remix-run/react" in deps || "@remix-run/serve" in deps || "react-router" in deps;
  },

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (REMIX_ROUTE_REGEX.test(fileId) || fileId.includes("/app/entry.")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      if (!REMIX_ROUTE_REGEX.test(fileId)) return;

      if (node.type === "ExportNamedDeclaration") {
        // export const loader = ... / export function loader() {}
        if (node.declaration) {
          const decl = node.declaration;
          if (decl.type === "FunctionDeclaration" && decl.id?.name && REMIX_EXPORTS.has(decl.id.name)) {
            adapter.markAsUsed(fileId, decl.id.name);
          } else if (decl.type === "VariableDeclaration") {
            for (const d of decl.declarations) {
              if (d.id?.type === "Identifier" && REMIX_EXPORTS.has(d.id.name)) {
                adapter.markAsUsed(fileId, d.id.name);
              }
            }
          }
        }
        // export { loader, action }
        if (node.specifiers) {
          for (const spec of node.specifiers) {
            const exportName = spec.exported?.name;
            if (exportName && REMIX_EXPORTS.has(exportName)) {
              adapter.markAsUsed(fileId, exportName);
            }
          }
        }
      }

      if (node.type === "ExportDefaultDeclaration") {
        adapter.markAsUsed(fileId, "default");
      }
    },
  },
};

export default RemixPlugin;
