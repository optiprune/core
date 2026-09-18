import { Worker } from 'node:worker_threads';
import { shared } from './shared.mjs';

const workerUrl = new URL('./worker.mjs', import.meta.url);
const result = await new Promise((resolve, reject) => {
  const worker = new Worker(workerUrl, { type: 'module' });
  worker.once('message', resolve);
  worker.once('error', reject);
});
console.log(`${shared('master')}|${result}`);
