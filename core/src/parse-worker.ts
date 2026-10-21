import { parentPort } from "node:worker_threads";
import { parseModule } from "./parser.js";

if (!parentPort) {
  throw new Error("Parser worker must be started by node:worker_threads");
}

parentPort.on("message", (task: { file: string; sourceText: string }) => {
  try {
    const moduleRecord = parseModule(task.sourceText, task.file);
    parentPort!.postMessage({ file: task.file, moduleRecord });
  } catch (error) {
    throw error;
  }
});
