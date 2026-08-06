import { AnalyzerPlugin } from "../types.js";

export const WorkerPlugin: AnalyzerPlugin = {
  name: "worker-plugin",
  version: "1.0.0",
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Erkennt Web Worker Dateien anhand der Namenskonvention
      if (/\.(worker|sw)\.[jt]sx?$/.test(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Erkennt 'new Worker(...)' Instanziierung
      if (node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "Worker") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default WorkerPlugin;
