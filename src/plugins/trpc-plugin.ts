import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const TRPC_PACKAGES = [
  "@trpc/server",
  "@trpc/client",
  "@trpc/react-query",
  "@trpc/next",
  "@trpc/tanstack-react-query"
];

const TRPC_PROCEDURE_METHODS = new Set([
  "query",
  "mutation",
  "subscription",
  "input",
  "output",
  "use",
  "middleware"
]);

export const TrpcPlugin: AnalyzerPlugin = {
  name: "trpc-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    };

    return TRPC_PACKAGES.some((pkgName) => pkgName in allDeps);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (!pkg) return;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      // Protect all installed @trpc/* packages in package.json
      // Do not treat a manifest entry as usage evidence.
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark conventional tRPC directory layouts and router files
      if (
        normalized.includes("/trpc/") ||
        normalized.includes("/routers/") ||
        normalized.includes("/server/trpc") ||
        normalized.includes("/api/trpc") ||
        normalized.endsWith("router.ts") ||
        normalized.endsWith("router.js") ||
        normalized.endsWith("trpc.ts") ||
        normalized.endsWith("trpc.js")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@trpc/server");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // 1. Detect @trpc/* import statements
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@trpc/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@trpc/*')
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value.startsWith("@trpc/")) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect tRPC init: initTRPC.create() or t.router()
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        const prop = node.callee.property;

        const objName = obj?.name || obj?.value;
        const propName = prop?.name || prop?.value;

        if (objName === "initTRPC" && propName === "create") {
          adapter.markPackageAsUsed("@trpc/server");
          adapter.markAsUsed(fileId);
        }

        // Detect procedure builder chains (e.g. publicProcedure.input(...).query(...))
        if (propName && TRPC_PROCEDURE_METHODS.has(propName)) {
          adapter.markPackageAsUsed("@trpc/server");
          adapter.markAsUsed(fileId);

          // Extract resolver handlers: .query(({ ctx, input }) => handler(input))
          node.arguments.forEach((arg: any) => {
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            } else if (t.isMemberExpression(arg) && t.isIdentifier(arg.object)) {
              adapter.markAsUsed(fileId, arg.object.name);
            }
          });
        }
      }

      // 4. Detect router definitions: router({ getUser: publicProcedure... }) or createTRPCRouter({...})
      if (t.isCallExpression(node)) {
        const calleeName = t.isIdentifier(node.callee) ? node.callee.name : null;

        if (calleeName && (calleeName === "router" || calleeName === "createTRPCRouter" || calleeName.endsWith("Router"))) {
          adapter.markPackageAsUsed("@trpc/server");
          adapter.markAsUsed(fileId);

          const routerObj = node.arguments[0];
          if (t.isObjectExpression(routerObj)) {
            routerObj.properties.forEach((prop: any) => {
              const keyName = prop.key?.name || prop.key?.value;
              if (keyName) {
                // Mark procedure endpoints as active symbols
                adapter.markAsUsed(fileId, keyName);
              }
            });
          }
        }
      }
    }
  }
};

export default TrpcPlugin;