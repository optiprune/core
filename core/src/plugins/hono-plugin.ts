import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const HONO_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "all",
  "use",
  "route",
  "on",
  "basePath",
  "notFound",
  "onError",
]);

export const HonoPlugin: AnalyzerPlugin = {
  name: "hono-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(
      pkg?.dependencies?.["hono"] ||
      pkg?.devDependencies?.["hono"] ||
      pkg?.dependencies?.["@hono/node-server"] ||
      pkg?.devDependencies?.["@hono/node-server"]
    );
  },

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark standard Hono file structures and Cloudflare/Bun entry points
      if (
        normalized.includes("/routes/") ||
        normalized.includes("/api/") ||
        normalized.includes("/middleware/") ||
        normalized.endsWith("index.ts") ||
        normalized.endsWith("index.js")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // 1. Detect imports from "hono", "hono/*", or "@hono/*"
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "hono" || source.startsWith("hono/") || source.startsWith("@hono/")) {
          adapter.markPackageAsUsed(source.startsWith("@hono/") ? source : "hono");
        }
      }

      // 2. Detect CJS require("hono") or require("@hono/*")
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const val = arg.value;
          if (val === "hono" || val.startsWith("hono/") || val.startsWith("@hono/")) {
            adapter.markPackageAsUsed(val.startsWith("@hono/") ? val : "hono");
          }
        }
      }

      // 3. Detect Hono Client (RPC) calls: hc<AppType>('...')
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "hc") {
        adapter.markPackageAsUsed("hono");
        adapter.markAsUsed(fileId);
      }

      // 4. Detect Hono Route / Middleware calls (e.g. app.get(), app.use(), app.route())
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const prop = node.callee.property;
        const methodName = prop?.name || prop?.value;

        if (methodName && HONO_METHODS.has(methodName)) {
          adapter.markPackageAsUsed("hono");
          adapter.markAsUsed(fileId);

          // Extract and mark referenced route handlers and middleware functions
          node.arguments.forEach((arg: any) => {
            // Case A: Identifier -> app.get('/route', handleRoute)
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            }

            // Case B: MemberExpression -> app.get('/route', handlers.getUser)
            else if (t.isMemberExpression(arg)) {
              if (t.isIdentifier(arg.object)) {
                adapter.markAsUsed(fileId, arg.object.name);
              }
              if (t.isIdentifier(arg.property)) {
                adapter.markAsUsed(fileId, arg.property.name);
              }
            }

            // Case C: Array of Handlers/Middleware -> app.get('/route', [authMiddleware, routeHandler])
            else if (t.isArrayExpression(arg)) {
              arg.elements.forEach((el: any) => {
                if (t.isIdentifier(el)) {
                  adapter.markAsUsed(fileId, el.name);
                }
              });
            }
          });
        }
      }
    },
  },
};

export default HonoPlugin;
