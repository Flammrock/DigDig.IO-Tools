import { parentPort, workerData } from 'node:worker_threads';
import { resolveWasm } from '../../../packages/layout-resolver/src/index.mjs';

// The shared decoder reads the supplied copy; it never instantiates game bytes.
try { parentPort.postMessage(await resolveWasm(new Uint8Array(workerData))); }
catch (error) { parentPort.postMessage({ status: 'unsupported', message: `WASM analysis failed: ${String(error).slice(0, 600)}`, evidence: { reason: 'analysis-error' } }); }
