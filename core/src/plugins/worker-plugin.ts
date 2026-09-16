import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const WORKER_FILE_PATTERN = /\.(worker|sw)\.[jt]sx?$/i;

export const WorkerPlugin: AnalyzerPlugin = {
  name: "worker-plugin",
  version: "1.1.0",

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect Web Worker and Service Worker files matching standard naming conventions
      if (WORKER_FILE_PATTERN.test(normalized)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      // 1. Detect 'new Worker("./worker.js")' or 'new SharedWorker("./shared.js")'
      if (t.isNewExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === "Worker" || node.callee.name === "SharedWorker") {
          adapter.markAsUsed(fileId);

          // Attempt to mark the referenced worker script file as used
          const firstArg = node.arguments[0];
          if (t.isStringLiteral(firstArg)) {
            const relativeWorkerPath = firstArg.value;
            const dir = path.dirname(fileId);
            const resolvedWorker = path.normalize(path.join(dir, relativeWorkerPath));
            adapter.markAsUsed(resolvedWorker);
          }
        }
      }

      // 2. Detect 'navigator.serviceWorker.register("./sw.js")'
      if (
        t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === "register"
      ) {
        const obj = node.callee.object;
        if (
          t.isMemberExpression(obj) &&
          t.isIdentifier(obj.property) &&
          obj.property.name === "serviceWorker"
        ) {
          adapter.markAsUsed(fileId);

          const firstArg = node.arguments[0];
          if (t.isStringLiteral(firstArg)) {
            const relativeSwPath = firstArg.value;
            const dir = path.dirname(fileId);
            const resolvedSw = path.normalize(path.join(dir, relativeSwPath));
            adapter.markAsUsed(resolvedSw);
          }
        }
      }
    },
  },
};

export default WorkerPlugin;
