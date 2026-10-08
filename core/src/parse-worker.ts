import { parentPort } from "node:worker_threads";
import { parseModule } from "./parser.js";

if (!parentPort) {
  throw new Error("Parser worker must be started by node:worker_threads");
}

parentPort.on("message", ({ file, sourceText }: { file: string; sourceText: string }) => {
  const moduleRecord = parseModule(sourceText, file);
  parentPort!.postMessage({ file, moduleRecord });
});
