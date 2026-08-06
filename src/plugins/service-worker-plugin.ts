import { AnalyzerPlugin } from "../types.js";

export const ServiceWorkerPlugin: AnalyzerPlugin = {
  name: "service-worker-plugin",
  version: "1.0.0",
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (fileId.includes("service-worker") || fileId.endsWith("sw.js") || fileId.endsWith("sw.ts")) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Erkennt Service Worker Registrierung: navigator.serviceWorker.register(...)
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
        if (node.callee.property.type === "Identifier" && node.callee.property.name === "register") {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ServiceWorkerPlugin;
