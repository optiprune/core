import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const FASTIFY_METHODS = new Set([
  "register", 
  "get", 
  "post", 
  "put", 
  "delete", 
  "patch", 
  "head", 
  "options", 
  "all", 
  "route", 
  "addHook", 
  "decorate", 
  "decorateRequest", 
  "decorateReply"
]);

export const FastifyPlugin: AnalyzerPlugin = {
  name: "fastify-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(
      pkg?.dependencies?.["fastify"] || 
      pkg?.devDependencies?.["fastify"] ||
      pkg?.dependencies?.["fastify-plugin"] ||
      pkg?.devDependencies?.["fastify-plugin"]
    );
  },

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark typical Fastify file conventions as used
      if (
        normalized.includes("/plugins/") ||
        normalized.includes("/routes/") ||
        normalized.includes("/hooks/") ||
        normalized.includes("/services/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // 1. Detect import / require of "fastify" or "fastify-plugin"
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "fastify" || source === "fastify-plugin") {
          adapter.markPackageAsUsed(source);
        }
      }

      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && (arg.value === "fastify" || arg.value === "fastify-plugin")) {
          adapter.markPackageAsUsed(arg.value);
        }
      }

      // 2. Detect fastify-plugin / fp() wrapper call: fp(myPlugin)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && ["fp", "fastifyPlugin"].includes(node.callee.name)) {
        adapter.markPackageAsUsed("fastify-plugin");
        const pluginArg = node.arguments[0];
        if (t.isIdentifier(pluginArg)) {
          adapter.markAsUsed(fileId, pluginArg.name);
        }
      }

      // 3. Detect Fastify member expression calls (e.g., fastify.register, fastify.get, fastify.addHook)
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const prop = node.callee.property;
        const methodName = prop?.name || prop?.value;

        if (methodName && FASTIFY_METHODS.has(methodName)) {
          adapter.markPackageAsUsed("fastify");
          adapter.markAsUsed(fileId);

          node.arguments.forEach((arg: any) => {
            // Case A: fastify.register(userPlugin) or fastify.get('/route', routeHandler)
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            }

            // Case B: fastify.register(require('./routes/users'))
            else if (t.isCallExpression(arg) && t.isIdentifier(arg.callee) && arg.callee.name === "require") {
              const reqArg = arg.arguments[0];
              if (t.isStringLiteral(reqArg)) {
                adapter.markAsUsed(reqArg.value);
              }
            }

            // Case C: fastify.route({ method: 'GET', url: '/', handler: myHandler })
            else if (t.isObjectExpression(arg)) {
              arg.properties.forEach((p: any) => {
                const keyName = p.key?.name || p.key?.value;
                if (keyName === "handler" || keyName === "onRequest" || keyName === "preHandler") {
                  if (t.isIdentifier(p.value)) {
                    adapter.markAsUsed(fileId, p.value.name);
                  }
                }
              });
            }
          });
        }
      }
    }
  }
};

export default FastifyPlugin;