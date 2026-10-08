import os from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ModuleRecord } from "./types.js";

interface ParseTask {
  file: string;
  sourceText: string;
}

interface ParseResult {
  file: string;
  moduleRecord: ModuleRecord;
}

const MAX_WORKERS = 4;
const MIN_WORKER_TASKS = 20;

export async function parseModulesSynchronously(
  tasks: ParseTask[],
): Promise<Map<string, ModuleRecord>> {
  const { parseModule } = await import("./parser.js");
  const parsed = new Map<string, ModuleRecord>();
  for (const task of tasks) parsed.set(task.file, parseModule(task.sourceText, task.file));
  return parsed;
}

/**
 * Parse independent source files in worker threads. The pool is deliberately
 * bounded and only used for sufficiently large cache-miss batches: cached ASTs
 * stay on the fast path, while graph and plugin state remain single-threaded.
 */
export async function parseModulesInWorkers(
  tasks: ParseTask[],
): Promise<Map<string, ModuleRecord>> {
  if (tasks.length === 0) return new Map();

  const parallelism = os.availableParallelism?.() ?? os.cpus().length;
  const workerUrl = new URL("./parse-worker.js", import.meta.url);
  const workerCount = Math.min(tasks.length, MAX_WORKERS, Math.max(0, parallelism - 1));

  // Worker startup and structured-clone overhead is larger than the benefit for
  // small batches. A 2-vCPU host also intentionally stays synchronous because
  // one worker would leave no useful parallel parser capacity.
  if (
    tasks.length <= MIN_WORKER_TASKS ||
    workerCount < 2 ||
    !existsSync(fileURLToPath(workerUrl))
  ) {
    return parseModulesSynchronously(tasks);
  }

  const parsed = new Map<string, ModuleRecord>();
  const workers: Worker[] = [];
  let nextTask = 0;
  let completed = 0;
  let settled = false;

  const runWorkers = new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    const assign = (worker: Worker): void => {
      const task = tasks[nextTask];
      if (!task) return;
      nextTask += 1;
      worker.postMessage(task);
    };

    try {
      for (let i = 0; i < workerCount; i += 1) {
        const worker = new Worker(workerUrl);
        workers.push(worker);
        worker.on("message", (result: ParseResult) => {
          if (settled) return;
          parsed.set(result.file, result.moduleRecord);
          completed += 1;
          if (completed === tasks.length) finish();
          else assign(worker);
        });
        worker.once("error", (error) => finish(error));
        worker.once("exit", (code) => {
          // Workers stay alive waiting for work. An exit before every task has
          // completed is always abnormal and must reject instead of hanging.
          if (!settled && code !== 0) {
            finish(new Error(`Parser worker exited with code ${code}`));
          } else if (!settled && completed < tasks.length) {
            finish(new Error("Parser worker exited before completing its tasks"));
          }
        });
        assign(worker);
      }
    } catch (error) {
      finish(error);
    }
  });

  try {
    await runWorkers;
    return parsed;
  } catch {
    // Worker startup, structured-clone, or transport failures should not make
    // analysis unusable. Reparse on the main thread; parser errors still
    // propagate normally from parseModule.
    return parseModulesSynchronously(tasks);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
