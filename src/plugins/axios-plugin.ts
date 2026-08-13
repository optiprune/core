import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const AXIOS_PACKAGES = [
  "axios",
  "axios-mock-adapter",
  "axios-retry",
  "axios-cache-interceptor",
  "axios-rate-limit",
  "redaxios"
];

const AXIOS_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "request",
  "create"
]);

export const AxiosPlugin: AnalyzerPlugin = {
  name: "axios-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    };

    return AXIOS_PACKAGES.some((pkgName) => pkgName in allDeps);
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

      // Protect all installed axios ecosystem packages in package.json
      // Do not treat a manifest entry as usage evidence.
    },

    onASTNode: (node, fileId, adapter) => {
      // 1. Detect ESM imports: import axios from 'axios'
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (AXIOS_PACKAGES.includes(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require calls: const axios = require('axios')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && AXIOS_PACKAGES.includes(arg.value)) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Axios instances and HTTP method invocations (axios.get, api.post, etc.)
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const prop = node.callee.property;
        const methodName = prop?.name || prop?.value;

        if (methodName && AXIOS_METHODS.has(methodName)) {
          adapter.markPackageAsUsed("axios");

          // Extract referenced handlers or config passed to axios method calls
          node.arguments.forEach((arg: any) => {
            if (t.isIdentifier(arg)) {
              adapter.markAsUsed(fileId, arg.name);
            } else if (t.isMemberExpression(arg) && t.isIdentifier(arg.object)) {
              adapter.markAsUsed(fileId, arg.object.name);
            }
          });
        }
      }

      // 4. Detect Axios Interceptors: axios.interceptors.request.use(...)
      if (t.isMemberExpression(node)) {
        const obj = node.object;
        const prop = node.property;

        const objName = (obj as any)?.name || (obj as any)?.value;
        const propName = prop?.name || prop?.value;

        if (objName === "interceptors" || propName === "interceptors") {
          adapter.markPackageAsUsed("axios");
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default AxiosPlugin;