import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const EXPRESS_METHODS = new Set(["get", "post", "put", "delete", "patch", "use", "all", "param"]);

export const ExpressPlugin: AnalyzerPlugin = {
  name: "express-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.dependencies?.["express"] || pkg?.devDependencies?.["express"]);
  },

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark typical Express architecture files as used
      if (
        normalized.includes("/routes/") ||
        normalized.includes("/controllers/") ||
        normalized.includes("/middleware/") ||
        normalized.includes("/middlewares/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // 1. Detect require('express') or import express from 'express'
      if (t.isImportDeclaration(node) && node.source.value === "express") {
        adapter.markPackageAsUsed("express");
      }

      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value === "express") {
          adapter.markPackageAsUsed("express");
        }
      }

      // 2. Detect express calls: app.get(), app.use(), router.post(), etc.
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const prop = node.callee.property;
        const methodName = prop?.name || prop?.value;

        if (EXPRESS_METHODS.has(methodName)) {
          adapter.markPackageAsUsed("express");

          // Process arguments (middleware, routes, controllers)
          node.arguments.forEach((arg: any) => {
            // Case A: Identifier -> app.get('/route', handleRoute)
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            }

            // Case B: MemberExpression -> app.get('/route', controller.handleRoute)
            else if (t.isMemberExpression(arg)) {
              const obj = arg.object;
              const memberProp = arg.property;
              if (t.isIdentifier(obj)) {
                adapter.markAsUsed(fileId, obj.name);
              }
              if (t.isIdentifier(memberProp)) {
                adapter.markAsUsed(fileId, memberProp.name);
              }
            }

            // Case C: Array of Middleware -> app.use([auth, logger])
            else if (t.isArrayExpression(arg)) {
              arg.elements.forEach((el: any) => {
                if (t.isIdentifier(el)) {
                  adapter.markAsUsed(fileId, el.name);
                } else if (t.isMemberExpression(el) && t.isIdentifier(el.object)) {
                  adapter.markAsUsed(fileId, el.object.name);
                }
              });
            }

            // Case D: Direct require inside app.use -> app.use('/api', require('./routes/api'))
            else if (
              t.isCallExpression(arg) &&
              t.isIdentifier(arg.callee) &&
              arg.callee.name === "require"
            ) {
              const reqArg = arg.arguments[0];
              if (t.isStringLiteral(reqArg)) {
                adapter.markAsUsed(reqArg.value);
              }
            }
          });
        }
      }
    },
  },
};

export default ExpressPlugin;
