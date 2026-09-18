import { parentPort } from 'node:worker_threads';
import { shared } from './shared.mjs';
parentPort.postMessage(shared('worker'));
parentPort.close();
