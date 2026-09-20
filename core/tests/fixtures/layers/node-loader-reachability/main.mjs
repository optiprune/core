import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
const load = createRequire(import.meta.url);
load('./side-effect.cjs');
new Worker(new URL('./worker.mjs', import.meta.url));
new Worker(new globalThis.URL('./worker.mjs', import.meta.url));
function shadowed(load) {
  load('./not-a-loader.cjs');
}
